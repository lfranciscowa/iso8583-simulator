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

// Limpieza periódica de sesiones expiradas (evita fuga de memoria). unref()
// para no impedir que el proceso termine.
const SWEEP_MS = 10 * 60 * 1000;
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) if (s.exp < now) sessions.delete(token);
}, SWEEP_MS);
if (sweepTimer.unref) sweepTimer.unref();

// ── Rate limiting / anti fuerza bruta para el login ──────────────────────────
const MAX_ATTEMPTS = 8;            // intentos fallidos permitidos por ventana
const WINDOW_MS    = 15 * 60 * 1000; // ventana de conteo (15 min)
const LOCK_MS      = 15 * 60 * 1000; // bloqueo tras superar el máximo (15 min)
const loginAttempts = new Map();   // ip -> { count, first, lockedUntil }

const attemptsSweep = setInterval(() => {
  const now = Date.now();
  for (const [ip, a] of loginAttempts) {
    if ((a.lockedUntil || 0) < now && (now - a.first) > WINDOW_MS) loginAttempts.delete(ip);
  }
}, WINDOW_MS);
if (attemptsSweep.unref) attemptsSweep.unref();

// Devuelve { allowed, retryAfterMs }. Llamar ANTES de validar credenciales.
function checkRateLimit(ip) {
  const a = loginAttempts.get(ip);
  if (!a) return { allowed: true, retryAfterMs: 0 };
  const now = Date.now();
  if (a.lockedUntil && a.lockedUntil > now) {
    return { allowed: false, retryAfterMs: a.lockedUntil - now };
  }
  return { allowed: true, retryAfterMs: 0 };
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  let a = loginAttempts.get(ip);
  if (!a || (now - a.first) > WINDOW_MS) a = { count: 0, first: now, lockedUntil: 0 };
  a.count += 1;
  if (a.count >= MAX_ATTEMPTS) a.lockedUntil = now + LOCK_MS;
  loginAttempts.set(ip, a);
}

function clearAttempts(ip) { loginAttempts.delete(ip); }

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

// La cookie lleva el flag Secure si estamos en producción o si se fuerza por
// env (SIM_SECURE_COOKIES=true). En Render (HTTPS) debe ir Secure siempre.
function secureCookies() {
  return process.env.NODE_ENV === 'production' || process.env.SIM_SECURE_COOKIES === 'true';
}

function setSessionCookie(res, token) {
  const secure = secureCookies() ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

// Rutas exentas del login de sesión (tienen su propio control o son públicas).
const OPEN_PATHS = new Set(['/api/login', '/api/session', '/api/pos-tcp']);

// Middleware: si el login está habilitado, exige sesión válida para /api/*
// (excepto las rutas en OPEN_PATHS).
function requireAuth(req, res, next) {
  if (!isEnabled()) return next();
  // Montado con app.use('/api', ...), req.path es relativo (p.ej. '/pos-tcp');
  // reconstruimos la ruta completa para comparar contra OPEN_PATHS.
  const fullPath = (req.baseUrl || '') + req.path;
  if (OPEN_PATHS.has(fullPath)) return next();
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, error: 'no autenticado' });
  next();
}

// Guard para el bridge POS (/api/pos-tcp). Si SIM_BRIDGE_API_KEY está definida,
// exige el header x-api-key. Si no se define, la ruta queda abierta (compat).
function requireBridgeKey(req, res, next) {
  const expected = process.env.SIM_BRIDGE_API_KEY;
  if (!expected) return next();
  const got = req.get('x-api-key') || '';
  if (timingSafeEqual(got, expected)) return next();
  return res.status(401).json({ ok: false, error: 'api key inválida' });
}

module.exports = {
  isEnabled, checkCredentials, createSession, destroySession,
  getSession, setSessionCookie, clearSessionCookie, requireAuth, requireBridgeKey,
  checkRateLimit, recordFailedAttempt, clearAttempts, secureCookies, SESSION_COOKIE,
};
