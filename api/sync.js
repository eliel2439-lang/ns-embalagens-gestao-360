const TABLE = 'ns_embalagens_state';
const ROW_ID = 'main';

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
    const error = new Error(typeof body === 'string' ? body : (body?.message || body?.hint || `Supabase HTTP ${response.status}`));
    error.status = response.status;
    error.details = body;
    throw error;
  }
  return body;
}

async function getRow() {
  const rows = await supabase(`${TABLE}?id=eq.${encodeURIComponent(ROW_ID)}&select=id,payload,updated_at,updated_by&limit=1`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
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
      const row = await getRow();
      if (!row) return res.status(200).json({ ok: true, exists: false, state: null, updatedAt: null });
      return res.status(200).json({
        ok: true,
        exists: true,
        state: row.payload || {},
        updatedAt: row.updated_at || null,
        updatedBy: row.updated_by || null,
      });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST, OPTIONS');
      return res.status(405).json({ ok: false, error: 'Método não permitido.' });
    }

    const state = req.body && req.body.state;
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      return res.status(400).json({ ok: false, error: 'state obrigatório.' });
    }

    const serialized = JSON.stringify(state);
    if (Buffer.byteLength(serialized, 'utf8') > 4_000_000) {
      return res.status(413).json({ ok: false, error: 'A base ultrapassou 4 MB.' });
    }

    const now = new Date().toISOString();
    const rows = await supabase(`${TABLE}?on_conflict=id&select=id,updated_at,updated_by`, {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=representation',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        id: ROW_ID,
        payload: state,
        updated_at: now,
        updated_by: 'painel_ns',
      }),
    });

    const saved = Array.isArray(rows) && rows.length ? rows[0] : null;
    return res.status(200).json({
      ok: true,
      saved: true,
      updatedAt: saved?.updated_at || now,
      updatedBy: saved?.updated_by || 'painel_ns',
    });
  } catch (error) {
    console.error('NS sync error:', error.details || error);
    let message = error.message || 'Erro interno na sincronização.';
    if (String(error.details?.code || '') === '42P01' || /does not exist/i.test(message)) {
      message = 'A tabela ns_embalagens_state ainda não existe no Supabase.';
    }
    return res.status(error.status && error.status >= 400 ? error.status : 500).json({
      ok: false,
      error: message,
      code: error.code || 'SYNC_ERROR',
    });
  }
};
