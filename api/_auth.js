const crypto = require('crypto');

const TTL_MS = 12 * 60 * 60 * 1000;

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 24) throw new Error('SESSION_SECRET não configurado ou muito curto.');
  return value;
}

function signBody(body) {
  return crypto.createHmac('sha256', secret()).update(body).digest('base64url');
}

function signSession(role) {
  const payload = { role: String(role), exp: Date.now() + TTL_MS, iat: Date.now() };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${signBody(body)}`;
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function verifySession(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.', 2);
  if (!safeEqual(signBody(body), sig)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!payload || !['1','2','3'].includes(String(payload.role)) || Number(payload.exp) < Date.now()) return null;
  return payload;
}

function passwordForRole(role) {
  const map = {
    '1': process.env.NS_ACCESS1_PASSWORD,
    '2': process.env.NS_ACCESS2_PASSWORD,
    '3': process.env.NS_ACCESS3_PASSWORD,
  };
  return map[String(role)] || '';
}

function passwordMatches(input, expected) {
  const a = crypto.createHash('sha256').update(String(input || '')).digest();
  const b = crypto.createHash('sha256').update(String(expected || '')).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = { signSession, verifySession, passwordForRole, passwordMatches, TTL_MS };
