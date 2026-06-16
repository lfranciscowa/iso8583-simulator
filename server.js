// ============================================================================
//  ISO 8583 SIMULATOR — proceso principal
//
//  Levanta dos cosas a la vez:
//   1. Servidor TCP  : recibe transacciones de cualquier plataforma externa.
//   2. API HTTP + UI : panel web para armar tramas de prueba, ver el tráfico
//                      en vivo y configurar el comportamiento del simulador.
// ============================================================================

'use strict';

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');

const config     = require('./config/default');
const iso8583    = require('./lib/iso8583');
const mockSwitch = require('./switch-sim/mock-switch');
const rulesStore = require('./switch-sim/rules-store');
const scenarioStore = require('./switch-sim/scenarios-store');
const binesStore = require('./switch-sim/bines-store');
const keysStore = require('./switch-sim/keys-store');
const crypto8583 = require('./lib/crypto8583');
const tcpServer  = require('./tcp-server');
const { processTransaction } = require('./lib/engine');
const { writePrefix } = require('./lib/framing');
const auth = require('./lib/auth');
const { maskHistoryEntry } = require('./lib/mask');

const keyvault = require('./lib/keyvault');

const app = express();

// Detrás del proxy de Render/Cloudflare: confiar en X-Forwarded-* para obtener
// la IP real del cliente (necesario para el rate-limit del login).
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Cabeceras de seguridad (equivalente ligero a helmet, sin dependencia extra).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');                 // anti-clickjacking
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  // HSTS solo sobre HTTPS (producción) para no romper el desarrollo local.
  if (auth.secureCookies()) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

// CORS restringido: por defecto NO se permite ningún origen cruzado (la UI es
// del mismo origen y el bridge POS es servidor-a-servidor, sin CORS). Para
// habilitar orígenes concretos, define SIM_CORS_ORIGINS (lista separada por comas).
const corsOrigins = (process.env.SIM_CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: corsOrigins.length ? corsOrigins : false }));

app.use(express.json({ limit: '256kb' }));

// --- Login / sesión ---
app.post('/api/login', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const { allowed, retryAfterMs } = auth.checkRateLimit(ip);
  if (!allowed) {
    res.setHeader('Retry-After', Math.ceil(retryAfterMs / 1000));
    return res.status(429).json({ ok: false, error: `demasiados intentos. Reintenta en ${Math.ceil(retryAfterMs / 60000)} min` });
  }
  const { user, password } = req.body || {};
  if (!auth.checkCredentials(user, password)) {
    auth.recordFailedAttempt(ip);
    return res.status(401).json({ ok: false, error: 'usuario o contraseña incorrectos' });
  }
  auth.clearAttempts(ip);
  const token = auth.createSession(user || process.env.SIM_ADMIN_USER || 'admin');
  auth.setSessionCookie(res, token);
  res.json({ ok: true, user: user || 'admin' });
});

app.post('/api/logout', (req, res) => {
  const session = auth.getSession(req);
  if (session) auth.destroySession(session.token);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  if (!auth.isEnabled()) return res.json({ enabled: false, authenticated: true });
  const session = auth.getSession(req);
  res.json({ enabled: true, authenticated: !!session, user: session?.user || null });
});

// A partir de aquí, toda la API (salvo login/session) requiere sesión si
// SIM_ADMIN_PASS está configurada.
app.use('/api', auth.requireAuth);

app.use(express.static(path.join(__dirname, 'public')));

// --- Perfiles de red disponibles ---
app.get('/api/profiles', (req, res) => {
  res.json({
    profiles: Object.values(iso8583.PROFILES).map(p => ({ id: p.id, name: p.name, mtis: p.mtis, mtiEnc: p.mtiEnc, hasHeader: !!p.headerHex })),
  });
});

// --- Diccionarios para la UI (según perfil) ---
app.get('/api/template', (req, res) => {
  const profile = iso8583.getProfile(req.query.profile);
  res.json({
    profile: profile.id,
    fieldDef: profile.fields,
    mtis: profile.mtis,
    accountTypes: iso8583.ACCOUNT_TYPES,
    responseCodes: iso8583.RESPONSE_CODES,
  });
});

// Reglas activas (declarativas, editables). Incluye operadores disponibles para la UI.
app.get('/api/rules', (req, res) => {
  res.json({ rules: rulesStore.getRules(), ops: Object.keys(rulesStore.OPS).map(k => ({ op: k, label: rulesStore.OPS[k].label })) });
});

app.post('/api/rules', (req, res) => {
  try { res.json({ ok: true, rule: rulesStore.addRule(req.body || {}) }); }
  catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

app.put('/api/rules/:id', (req, res) => {
  const updated = rulesStore.updateRule(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ ok: false, error: 'regla no encontrada' });
  res.json({ ok: true, rule: updated });
});

app.delete('/api/rules/:id', (req, res) => {
  const removed = rulesStore.deleteRule(req.params.id);
  if (!removed) return res.status(404).json({ ok: false, error: 'regla no encontrada' });
  res.json({ ok: true });
});

app.post('/api/rules/reorder', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  res.json({ ok: true, rules: rulesStore.reorderRules(ids) });
});

app.post('/api/rules/reset', (req, res) => {
  res.json({ ok: true, rules: rulesStore.resetRules() });
});

// --- Escenarios de prueba guardables ---
app.get('/api/scenarios', (req, res) => {
  res.json({ scenarios: scenarioStore.getAll() });
});

app.post('/api/scenarios', (req, res) => {
  try { res.json({ ok: true, scenario: scenarioStore.save(req.body || {}) }); }
  catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

app.delete('/api/scenarios/:id', (req, res) => {
  const removed = scenarioStore.remove(req.params.id);
  if (!removed) return res.status(404).json({ ok: false, error: 'escenario no encontrado' });
  res.json({ ok: true });
});

app.post('/api/scenarios/reset', (req, res) => {
  res.json({ ok: true, scenarios: scenarioStore.reset() });
});

// --- Catálogo de BINes para pruebas ---
app.get('/api/bines', (req, res) => {
  res.json({ bines: binesStore.getAll() });
});

app.post('/api/bines', (req, res) => {
  try { res.json({ ok: true, bin: binesStore.save(req.body || {}) }); }
  catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

app.delete('/api/bines/:bin', (req, res) => {
  const removed = binesStore.remove(req.params.bin);
  if (!removed) return res.status(404).json({ ok: false, error: 'BIN no encontrado' });
  res.json({ ok: true });
});

app.post('/api/bines/reset', (req, res) => {
  res.json({ ok: true, bines: binesStore.reset() });
});

// Generar un PAN válido (Luhn) a partir de un BIN
app.get('/api/bines/:bin/pan', (req, res) => {
  const length = parseInt(req.query.length, 10) || 16;
  res.json({ ok: true, pan: binesStore.generatePan(req.params.bin, length) });
});

// --- Llavero criptográfico ---
app.get('/api/keys', (req, res) => {
  res.json({ keys: keysStore.getAll(), types: keysStore.KEY_TYPES });
});

app.post('/api/keys', (req, res) => {
  try { res.json({ ok: true, key: keysStore.save(req.body || {}) }); }
  catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

app.delete('/api/keys/:id', (req, res) => {
  const removed = keysStore.remove(req.params.id);
  if (!removed) return res.status(404).json({ ok: false, error: 'llave no encontrada' });
  res.json({ ok: true });
});

app.post('/api/keys/reset', (req, res) => {
  res.json({ ok: true, keys: keysStore.reset() });
});

// Generar una llave 3DES aleatoria (con paridad)
app.get('/api/keys/generate', (req, res) => {
  const bytes = parseInt(req.query.bytes, 10) || 16;
  res.json({ ok: true, ...crypto8583.generateKey(bytes) });
});

// KCV de una llave arbitraria
app.post('/api/crypto/kcv', (req, res) => {
  try { res.json({ ok: true, kcv: crypto8583.kcv(req.body.keyHex) }); }
  catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// Resolver la llave: por keyId del llavero o keyHex directo
function resolveKey(body) {
  if (body.keyId) {
    const k = keysStore.getById(body.keyId);
    if (!k) throw new Error('llave no encontrada en el llavero');
    return k.keyHex;
  }
  if (body.keyHex) return body.keyHex;
  throw new Error('falta keyId o keyHex');
}

// Cifrar PIN → PIN block (DE52)
app.post('/api/crypto/pinblock', (req, res) => {
  try {
    const { pin, pan, format = '0' } = req.body || {};
    const keyHex = resolveKey(req.body || {});
    res.json({ ok: true, ...crypto8583.encryptPin(pin, pan, keyHex, String(format)) });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// Descifrar PIN block → PIN
app.post('/api/crypto/pinblock/decrypt', (req, res) => {
  try {
    const { encryptedPinBlock, pan, format = '0' } = req.body || {};
    const keyHex = resolveKey(req.body || {});
    res.json({ ok: true, ...crypto8583.decryptPin(encryptedPinBlock, pan, keyHex, String(format)) });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// Verificar PIN block contra un PIN esperado
app.post('/api/crypto/pinblock/verify', (req, res) => {
  try {
    const { encryptedPinBlock, pan, expectedPin, format = '0' } = req.body || {};
    const keyHex = resolveKey(req.body || {});
    res.json({ ok: true, ...crypto8583.verifyPin(encryptedPinBlock, pan, keyHex, expectedPin, String(format)) });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// Calcular MAC (Retail MAC / ISO 9797-1 Alg 3) sobre datos en hex
app.post('/api/crypto/mac', (req, res) => {
  try {
    const { dataHex } = req.body || {};
    if (!dataHex) throw new Error('falta dataHex');
    const keyHex = resolveKey(req.body || {});
    res.json({ ok: true, mac: crypto8583.computeRetailMAC(dataHex, keyHex), keyKcv: crypto8583.kcv(keyHex) });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

// Verificar un MAC recibido contra los datos
app.post('/api/crypto/mac/verify', (req, res) => {
  try {
    const { dataHex, mac } = req.body || {};
    if (!dataHex || !mac) throw new Error('faltan dataHex o mac');
    const keyHex = resolveKey(req.body || {});
    res.json({ ok: true, ...crypto8583.verifyRetailMAC(dataHex, mac, keyHex) });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

app.get('/api/config', (req, res) => {
  res.json({ tcp: config.tcp, encoding: config.encoding, framing: config.framing, profile: config.profile });
});

// --- Armar trama sin enviar ---
app.post('/api/build', (req, res) => {
  const { mti, fields, encoding = 'ascii', profile = 'generic' } = req.body || {};
  try {
    const buf = iso8583.buildMessage({ mti, fields, encoding, profile });
    res.json({ ok: true, hex: buf.toString('hex').toUpperCase(), length: buf.length, parsed: iso8583.parseResponse(buf, encoding, profile) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// --- Enviar trama al switch simulado (flujo completo, sin TCP) ---
app.post('/api/send', async (req, res) => {
  const { mti, fields, encoding = 'ascii', profile = 'generic', rules, latencyMs } = req.body || {};
  try {
    const payload = iso8583.buildMessage({ mti, fields, encoding, profile });
    const result = await processTransaction(payload, { encoding, profile, rules, latencyMs });
    if (!result.ok) return res.status(400).json(result);
    delete result.response.buffer;
    // Registrar en historial (misma estructura que las TX TCP), con PAN enmascarado
    history.unshift(maskHistoryEntry({
      id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      type: 'transaction', source: 'ui', ts: Date.now(),
      peer: 'UI', encoding: result.encoding, profile: result.profile,
      reqMti: result.request.parsed.mti, respMti: result.response.parsed.mti,
      responseCode: result.response.parsed.responseCode,
      matchedRule: result.sim.matchedRule, elapsedMs: result.sim.latencyMs,
      request: result.request, response: { hex: result.response.hex, length: result.response.length, parsed: result.response.parsed },
    }));
    if (history.length > 500) history.pop();
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// --- Bridge HTTP: recibe una trama cruda (hex) y devuelve la respuesta cruda ---
// Mismo contrato que el POS-Client de Visual Admin en modo BRIDGE
// (POS_BRIDGE_URL). Permite que el POS le hable al simulador por HTTPS cuando
// ambos corren en Render y no hay TCP público entre servicios.
//   Entrada:  { hexMessage, profile?, encoding? }
//   Salida:   { ok, responseHex, elapsedMs, responseCode }
app.post('/api/pos-tcp', auth.requireBridgeKey, async (req, res) => {
  const { hexMessage, profile = 'generic', encoding = 'auto' } = req.body || {};
  if (!hexMessage) return res.status(400).json({ ok: false, error: 'hexMessage requerido' });
  const t0 = Date.now();
  try {
    const clean = String(hexMessage).replace(/[^0-9a-fA-F]/g, '');
    if (!clean.length || clean.length % 2 !== 0) {
      return res.status(400).json({ ok: false, error: 'hexMessage inválido (longitud impar o vacío)' });
    }
    const payload = Buffer.from(clean, 'hex');
    const result = await processTransaction(payload, { encoding, profile });
    if (!result.ok) return res.status(400).json({ ok: false, error: `${result.stage}: ${result.error}` });

    // Registrar en historial para que la transacción se vea en la UI del simulador
    history.unshift(maskHistoryEntry({
      id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      type: 'transaction', source: 'bridge', ts: Date.now(),
      peer: 'POS (bridge)', encoding: result.encoding, profile: result.profile,
      reqMti: result.request.parsed.mti, respMti: result.response.parsed.mti,
      responseCode: result.response.parsed.responseCode,
      matchedRule: result.sim.matchedRule, elapsedMs: result.sim.latencyMs,
      request: result.request,
      response: { hex: result.response.hex, length: result.response.length, parsed: result.response.parsed },
    }));
    if (history.length > 500) history.pop();

    res.json({
      ok: true,
      responseHex: result.response.hex,
      responseCode: result.response.parsed.responseCode,
      elapsedMs: Date.now() - t0,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// --- Inspector: parsear cualquier hex pegado ---
app.post('/api/inspect', (req, res) => {
  const { hex, encoding = 'auto', profile = 'generic' } = req.body || {};
  if (!hex) return res.status(400).json({ ok: false, error: 'hex requerido' });
  try {
    const clean = String(hex).replace(/[^0-9a-fA-F]/g, '');
    if (!clean.length || clean.length % 2 !== 0) return res.status(400).json({ ok: false, error: 'hex inválido (longitud impar o vacío)' });
    const buf = Buffer.from(clean, 'hex');
    const { resolveEncoding } = require('./lib/engine');
    const enc = resolveEncoding(encoding, buf, profile);
    const parsed = iso8583.parseResponse(buf, enc, profile);
    res.json({ ok: true, encoding: enc, profile, length: buf.length, parsed });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// --- Historial de transacciones (en memoria, máx. 500) ---
const history = [];
tcpServer.onTransaction((evt) => {
  if (evt.type === 'transaction') {
    history.unshift(maskHistoryEntry({ ...evt, id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}` }));
    if (history.length > 500) history.pop();
  }
});

app.get('/api/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
  res.json({ total: history.length, items: history.slice(0, limit).map(maskHistoryEntry) });
});

app.delete('/api/history', (req, res) => {
  history.length = 0;
  res.json({ ok: true });
});

// Exportar historial en CSV o JSON
app.get('/api/history/export', (req, res) => {
  const fmt = req.query.format === 'json' ? 'json' : 'csv';
  if (fmt === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename="iso8583-history.json"');
    res.setHeader('Content-Type', 'application/json');
    return res.send(JSON.stringify(history, null, 2));
  }
  // CSV
  const cols = ['ts','peer','encoding','reqMti','respMti','responseCode','elapsedMs','matchedRule'];
  const rows = history.map(t => cols.map(c => {
    const v = c === 'matchedRule' ? (t.matchedRule?.id || '') : (t[c] ?? '');
    return `"${String(v).replace(/"/g, '""')}"`;
  }).join(','));
  res.setHeader('Content-Disposition', 'attachment; filename="iso8583-history.csv"');
  res.setHeader('Content-Type', 'text/csv');
  res.send([cols.join(','), ...rows].join('\r\n'));
});


app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`event: ready\ndata: {}\n\n`);
  const off = tcpServer.onTransaction((evt) => {
    const masked = evt.type === 'transaction' ? maskHistoryEntry(evt) : evt;
    res.write(`data: ${JSON.stringify(masked)}\n\n`);
  });
  const hb = setInterval(() => res.write(`:hb\n\n`), 15000);
  req.on('close', () => { off(); clearInterval(hb); });
});

// --- Avisos de seguridad al arranque ---
if (!auth.isEnabled()) {
  console.warn('⚠️  LOGIN DESHABILITADO: define SIM_ADMIN_PASS para proteger la UI/API.');
}
if (keyvault.usingDefaultSecret()) {
  console.warn('⚠️  SIM_MASTER_KEY no definida: se usa la KEK de laboratorio (NO segura). Define SIM_MASTER_KEY en producción.');
}
if (!auth.secureCookies()) {
  console.warn('ℹ️  Cookies sin flag Secure (desarrollo). En producción define NODE_ENV=production o SIM_SECURE_COOKIES=true.');
}

// --- Arrancar ambos servidores ---
tcpServer.start();
app.listen(config.http.port, () => {
  console.log(`🧪 API + UI en http://localhost:${config.http.port}`);
});
