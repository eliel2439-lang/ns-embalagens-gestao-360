const { verifySession } = require('./_auth');

const TABLE = 'ns_embalagens_state';
const ROW_ID = 'main';

function env() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados.');
  return { url, key };
}

async function sb(path, options = {}) {
  const { url, key } = env();
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const response = await fetch(`${url}/rest/v1/${path}`, { ...options, headers });
  const text = await response.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (!response.ok) {
    const err = new Error(data?.message || data?.hint || `Supabase respondeu ${response.status}.`);
    err.status = response.status;
    err.details = data;
    throw err;
  }
  return data;
}

async function getRow() {
  const rows = await sb(`${TABLE}?id=eq.${encodeURIComponent(ROW_ID)}&select=id,payload,updated_at,updated_by&limit=1`, { method: 'GET' });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

const allowedKeysByRole = {
  '2': new Set(['metas','producao','updatedAt','fechamentos']),
  '3': new Set(['metas','producao','fretes','freteAnual','updatedAt','fechamentos']),
};

function same(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

function mergeByRole(role, previous, next) {
  if (role === '1' || !previous) return next;
  const allowed = allowedKeysByRole[role] || new Set();
  const merged = { ...previous };
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(next, key)) merged[key] = next[key];
  }
  return merged;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({ error: 'Método não permitido.' });

  let session;
  try { session = verifySession(req); } catch (e) { return res.status(500).json({ error: e.message }); }
  if (!session) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });

  try {
    if (req.method === 'GET') {
      const row = await getRow();
      if (!row) return res.status(200).json({ ok: true, exists: false, state: null, updatedAt: null });
      return res.status(200).json({ ok: true, exists: true, state: row.payload || {}, updatedAt: row.updated_at, updatedBy: row.updated_by || null });
    }

    const next = req.body && req.body.state;
    if (!next || typeof next !== 'object' || Array.isArray(next)) return res.status(400).json({ error: 'Estado inválido.' });
    const serialized = JSON.stringify(next);
    if (Buffer.byteLength(serialized, 'utf8') > 4_000_000) return res.status(413).json({ error: 'A base ultrapassou 4 MB. Será necessário migrar para tabelas normalizadas.' });

    const current = await getRow();
    const safeState = mergeByRole(String(session.role), current?.payload || null, next);

    const now = new Date().toISOString();
    const result = await sb(`${TABLE}?on_conflict=id`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ id: ROW_ID, payload: safeState, updated_at: now, updated_by: `acesso_${session.role}` }),
    });
    const row = Array.isArray(result) && result.length ? result[0] : null;
    return res.status(200).json({ ok: true, updatedAt: row?.updated_at || now, updatedBy: row?.updated_by || `acesso_${session.role}` });
  } catch (e) {
    console.error('sync:', e.details || e);
    const status = Number(e.status) || 500;
    let message = e.message || 'Falha ao sincronizar.';
    if (String(e.details?.code || '') === '42P01' || /does not exist/i.test(message)) message = 'Tabela do Supabase não encontrada. Execute o arquivo supabase.sql no SQL Editor do Supabase.';
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
  }
};
