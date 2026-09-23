const TABLE = 'ns_embalagens_state';
const ROW_ID = 'main';
const MAX_STATE_BYTES = 4_000_000;
const HISTORY_PREFIX = 'hist_';
const HISTORY_KEEP = 20;

function getConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
  if (!url || !key) {
    const err = new Error('Variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não configuradas no Vercel.');
    err.code = 'SUPABASE_ENV_MISSING';
    throw err;
  }
  return { url: url.replace(/\/$/, ''), key };
}

async function supabase(path, options = {}) {
  const { url, key } = getConfig();
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const response = await fetch(`${url}/rest/v1/${path}`, { ...options, headers });
  const text = await response.text();
  let body = null;

  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }

  if (!response.ok) {
    const error = new Error(
      typeof body === 'string'
        ? body
        : (body?.message || body?.hint || `Supabase HTTP ${response.status}`)
    );
    error.status = response.status;
    error.details = body;
    throw error;
  }

  return body;
}

async function getRow() {
  const rows = await supabase(
    `${TABLE}?id=eq.${encodeURIComponent(ROW_ID)}&select=id,payload,updated_at,updated_by&limit=1`,
    { method: 'GET', headers: { Accept: 'application/json' } }
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function json(res, status, body) {
  return res.status(status).json(body);
}

function normalizeExpectedUpdatedAt(value) {
  if (value == null || value === '') return null;
  return String(value);
}

function normalizeClientId(value) {
  const s = String(value || 'painel_ns').replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 120);
  return s || 'painel_ns';
}

function normalizeSaveId(value) {
  const s = String(value || '').replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 160);
  return s || null;
}

async function insertFirstRow({ state, now, updatedBy }) {
  const rows = await supabase(`${TABLE}?select=id,updated_at,updated_by`, {
    method: 'POST',
    headers: {
      Prefer: 'return=representation',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      id: ROW_ID,
      payload: state,
      updated_at: now,
      updated_by: updatedBy,
    }),
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function compareAndSwapRow({ state, expectedUpdatedAt, now, updatedBy }) {
  /*
   * CAS (compare-and-swap) atômico no próprio UPDATE:
   * só atualiza a linha se updated_at ainda for exatamente a versão lida
   * pelo navegador. Se outro cliente salvou antes, 0 linhas são alteradas.
   */
  const filter = `${TABLE}?id=eq.${encodeURIComponent(ROW_ID)}` +
    `&updated_at=eq.${encodeURIComponent(expectedUpdatedAt)}` +
    `&select=id,updated_at,updated_by`;

  const rows = await supabase(filter, {
    method: 'PATCH',
    headers: {
      Prefer: 'return=representation',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      payload: state,
      updated_at: now,
      updated_by: updatedBy,
    }),
  });

  return Array.isArray(rows) && rows.length ? rows[0] : null;
}


async function archiveRow(row, reason = 'before_write') {
  if (!row || !row.payload || typeof row.payload !== 'object') return null;
  const ts = Date.now();
  const id = `${HISTORY_PREFIX}${ts}_${Math.random().toString(36).slice(2, 8)}`;
  const rows = await supabase(`${TABLE}?select=id,updated_at,updated_by`, {
    method: 'POST',
    headers: { Prefer: 'return=representation', Accept: 'application/json' },
    body: JSON.stringify({
      id,
      payload: row.payload,
      updated_at: row.updated_at || new Date().toISOString(),
      updated_by: `history:${reason}:${row.updated_by || 'unknown'}`.slice(0, 240),
    }),
  });
  try { await trimHistory(); } catch (e) { console.warn('NS history trim:', e?.message || e); }
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function listHistory(limit = HISTORY_KEEP) {
  const safe = Math.max(1, Math.min(100, Number(limit) || HISTORY_KEEP));
  const rows = await supabase(`${TABLE}?id=like.${encodeURIComponent(HISTORY_PREFIX + '*')}&select=id,updated_at,updated_by&order=updated_at.desc&limit=${safe}`, {
    method: 'GET', headers: { Accept: 'application/json' },
  });
  return Array.isArray(rows) ? rows : [];
}

async function getHistoryRow(id) {
  if (!id || !String(id).startsWith(HISTORY_PREFIX)) return null;
  const rows = await supabase(`${TABLE}?id=eq.${encodeURIComponent(String(id))}&select=id,payload,updated_at,updated_by&limit=1`, {
    method: 'GET', headers: { Accept: 'application/json' },
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function trimHistory() {
  const rows = await supabase(`${TABLE}?id=like.${encodeURIComponent(HISTORY_PREFIX + '*')}&select=id,updated_at&order=updated_at.desc&limit=100`, {
    method: 'GET', headers: { Accept: 'application/json' },
  });
  const old = (Array.isArray(rows) ? rows : []).slice(HISTORY_KEEP);
  for (const row of old) {
    await supabase(`${TABLE}?id=eq.${encodeURIComponent(row.id)}`, {
      method: 'DELETE', headers: { Prefer: 'return=minimal' },
    });
  }
}

async function restoreHistory({ historyId, expectedUpdatedAt, clientId, saveId }) {
  const current = await getRow();
  if (!current) {
    const e = new Error('Não existe linha main para restaurar.'); e.status = 409; throw e;
  }
  if (!expectedUpdatedAt || String(current.updated_at || '') !== String(expectedUpdatedAt)) {
    const e = new Error('Conflito de versão antes da restauração. Releia o banco e tente novamente.');
    e.status = 409; e.current = current; throw e;
  }
  const hist = await getHistoryRow(historyId);
  if (!hist) { const e = new Error('Snapshot de histórico não encontrado.'); e.status = 404; throw e; }
  await archiveRow(current, 'before_restore');
  const now = new Date().toISOString();
  const updatedBy = `restore:${normalizeClientId(clientId)}:${normalizeSaveId(saveId) || historyId}`.slice(0, 240);
  const saved = await compareAndSwapRow({ state: hist.payload, expectedUpdatedAt, now, updatedBy });
  if (!saved) { const e = new Error('Conflito durante a restauração; nenhum dado foi sobrescrito.'); e.status = 409; throw e; }
  return { saved, history: hist };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(204).end();
  }

  try {
    if (req.method === 'GET') {
      if (String(req.query?.history || '') === '1') {
        const rows = await listHistory(Number(req.query?.limit) || HISTORY_KEEP);
        return json(res, 200, { ok: true, history: rows });
      }
      const historyId = String(req.query?.historyId || '');
      if (historyId) {
        const row = await getHistoryRow(historyId);
        if (!row) return json(res, 404, { ok: false, error: 'Snapshot não encontrado.' });
        return json(res, 200, { ok: true, snapshot: row });
      }
      const row = await getRow();
      if (!row) {
        return json(res, 200, {
          ok: true,
          exists: false,
          state: null,
          updatedAt: null,
          updatedBy: null,
        });
      }

      return json(res, 200, {
        ok: true,
        exists: true,
        state: row.payload || {},
        updatedAt: row.updated_at || null,
        updatedBy: row.updated_by || null,
      });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST, OPTIONS');
      return json(res, 405, { ok: false, error: 'Método não permitido.' });
    }

    const action = String(req.body?.action || '');
    const expectedUpdatedAt = normalizeExpectedUpdatedAt(req.body?.expectedUpdatedAt);
    if (action === 'restoreHistory') {
      const historyId = String(req.body?.historyId || '');
      if (!historyId) return json(res, 400, { ok: false, error: 'historyId obrigatório.' });
      const restored = await restoreHistory({ historyId, expectedUpdatedAt, clientId, saveId });
      return json(res, 200, { ok: true, restored: true, updatedAt: restored.saved?.updated_at || null, updatedBy: restored.saved?.updated_by || null, historyId });
    }

    const state = req.body && req.body.state;
    const clientId = normalizeClientId(req.body?.clientId);
    const saveId = normalizeSaveId(req.body?.saveId);

    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return json(res, 400, { ok: false, error: 'state obrigatório.' });
    }

    const serialized = JSON.stringify(state);
    const bytes = Buffer.byteLength(serialized, 'utf8');
    if (bytes > MAX_STATE_BYTES) {
      return json(res, 413, {
        ok: false,
        error: `A base ultrapassou ${Math.round(MAX_STATE_BYTES / 1_000_000)} MB.`,
        bytes,
        limit: MAX_STATE_BYTES,
      });
    }

    const current = await getRow();
    const now = new Date().toISOString();
    const updatedBy = saveId ? `${clientId}:${saveId}`.slice(0, 240) : clientId;

    /* Primeira gravação: só é aceita quando realmente não existe linha. */
    if (!current) {
      if (expectedUpdatedAt) {
        return json(res, 409, {
          ok: false,
          conflict: true,
          error: 'Conflito de versão: o navegador esperava uma base existente, mas a linha não foi encontrada.',
          updatedAt: null,
        });
      }

      try {
        const saved = await insertFirstRow({ state, now, updatedBy });
        return json(res, 200, {
          ok: true,
          saved: true,
          created: true,
          updatedAt: saved?.updated_at || now,
          updatedBy: saved?.updated_by || updatedBy,
          saveId,
        });
      } catch (error) {
        /* Outra máquina pode ter criado a linha exatamente entre GET e INSERT. */
        if (Number(error.status) === 409 || String(error.details?.code || '') === '23505') {
          const latest = await getRow();
          return json(res, 409, {
            ok: false,
            conflict: true,
            error: 'Conflito de versão: outra sessão inicializou o banco antes desta gravação.',
            updatedAt: latest?.updated_at || null,
            updatedBy: latest?.updated_by || null,
            saveId,
          });
        }
        throw error;
      }
    }

    /*
     * REGRA CRÍTICA:
     * se a linha já existe, todo escritor precisa provar qual versão leu.
     * Cliente antigo/sem precondição NÃO pode sobrescrever a base inteira.
     */
    if (!expectedUpdatedAt) {
      return json(res, 428, {
        ok: false,
        error: 'Precondição obrigatória ausente. Atualize o painel: expectedUpdatedAt é necessário para impedir perda de dados.',
        updatedAt: current.updated_at || null,
        updatedBy: current.updated_by || null,
      });
    }

    if (String(current.updated_at || '') !== expectedUpdatedAt) {
      return json(res, 409, {
        ok: false,
        conflict: true,
        error: 'Conflito de versão: o banco foi alterado por outra sessão. Releia, faça o merge e tente novamente.',
        expectedUpdatedAt,
        updatedAt: current.updated_at || null,
        updatedBy: current.updated_by || null,
        saveId,
      });
    }

    /* Preserva a versão atual ANTES de qualquer sobrescrita. */
    await archiveRow(current, 'before_write');
    const saved = await compareAndSwapRow({ state, expectedUpdatedAt, now, updatedBy });

    /*
     * Mesmo depois da checagem acima, outra sessão pode salvar entre o GET e o PATCH.
     * O filtro updated_at do PATCH é o que torna a operação atomicamente segura.
     */
    if (!saved) {
      const latest = await getRow();
      return json(res, 409, {
        ok: false,
        conflict: true,
        error: 'Conflito de versão durante a gravação. Nenhum dado foi sobrescrito.',
        expectedUpdatedAt,
        updatedAt: latest?.updated_at || null,
        updatedBy: latest?.updated_by || null,
        saveId,
      });
    }

    return json(res, 200, {
      ok: true,
      saved: true,
      created: false,
      updatedAt: saved.updated_at || now,
      updatedBy: saved.updated_by || updatedBy,
      saveId,
    });
  } catch (error) {
    console.error('NS sync error:', error.details || error);
    let message = error.message || 'Erro interno na sincronização.';

    if (String(error.details?.code || '') === '42P01' || /does not exist/i.test(message)) {
      message = 'A tabela ns_embalagens_state ainda não existe no Supabase.';
    }

    return json(
      res,
      error.status && error.status >= 400 ? error.status : 500,
      {
        ok: false,
        error: message,
        code: error.code || 'SYNC_ERROR',
      }
    );
  }
};
