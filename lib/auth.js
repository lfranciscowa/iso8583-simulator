// ============================================================================
//  AUTH — login simple por sesión para proteger la API y la UI.
//
//  Configuración por variables de entorno:
//    SIM_ADMIN_USER  : usuario (default 'admin')
//    SIM_ADMIN_PASS  : contraseña en texto plano (solo para arranque rápido)
//  Si ninguna está definida, el login queda DESHABILITADO (modo laboratorio
//  abierto, como antes) — útil para desarrollo local.
// ============================================================================

'use strict';

const crypto = require('crypto');

const SESSION_COOKIE = 'sim_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

const sessions = new Map(); // token -> { user, exp }

function isEnabled() {
  return !!process.env.SIM_ADMIN_PASS;
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function checkCredentials(user, pass) {
  const expectedUser = process.env.SIM_ADMIN_USER || 'admin';
  const expectedPass = process.env.SIM_ADMIN_PASS;
  if (!expectedPass) return false;
  return timingSafeEqual(user || '', expectedUser) && timingSafeEqual(pass || '', expectedPass);
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { user, exp: Date.now() + SESSION_TTL_MS });
  return token;
}

function destroySession(token) {
  sessions.delete(token);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function getSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(token); return null; }
  return { token, ...s };
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

// Middleware: si el login está habilitado, exige sesión válida para /api/*
// (excepto /api/login y /api/session).
function requireAuth(req, res, next) {
  if (!isEnabled()) return next();
  if (req.path === '/api/login' || req.path === '/api/session') return next();
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'no autenticado' });
  next();
}

module.exports = {
  isEnabled, checkCredentials, createSession, destroySession,
  getSession, setSessionCookie, clearSessionCookie, requireAuth, SESSION_COOKIE,
};
