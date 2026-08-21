const { signSession, passwordForRole, passwordMatches, TTL_MS } = require('./_auth');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

  try {
    const { role, password } = req.body || {};
    const r = String(role || '');
    if (!['1','2','3'].includes(r)) return res.status(400).json({ error: 'Acesso inválido.' });
    const expected = passwordForRole(r);
    if (!expected) return res.status(500).json({ error: `Senha do Acesso ${r} não configurada na Vercel.` });
    if (!passwordMatches(password, expected)) {
      await new Promise(resolve => setTimeout(resolve, 250));
      return res.status(401).json({ error: 'Senha incorreta.' });
    }
    const token = signSession(r);
    return res.status(200).json({ ok: true, token, role: r, expiresInSeconds: Math.floor(TTL_MS / 1000) });
  } catch (e) {
    console.error('auth:', e);
    return res.status(500).json({ error: 'Falha na autenticação do servidor.' });
  }
};
