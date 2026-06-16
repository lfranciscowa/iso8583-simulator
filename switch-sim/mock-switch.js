// ============================================================================
//  MOCK SWITCH — generador de respuestas ISO 8583 simuladas
//
//  Reemplaza la conexión a un switch bancario real. Recibe los datos ya
//  parseados de una trama de request y devuelve los datos para construir
//  la respuesta (DE 39 + campos relevantes), aplicando reglas de negocio
//  configurables y latencia simulada.
//
//  Esto es lo único que un sandbox necesita para ser útil: un comportamiento
//  determinístico y explicable, no una réplica fiel de un switch real.
// ============================================================================

'use strict';

const rulesStore = require('./rules-store');
const keysStore  = require('./keys-store');
const crypto8583 = require('../lib/crypto8583');
const config     = require('../config/default');

// ----------------------------------------------------------------------------
// Validación de PIN (DE52). Solo se invoca si la trama trae DE52.
// Descifra el PIN block con la TPK configurada y lo compara con el esperado.
// Devuelve { checked, ok, recoveredPin?, error? }.
// ----------------------------------------------------------------------------
function validatePin(request, pinCfg) {
  const cfg = { ...config.pin, ...(pinCfg || {}) };
  const de52 = request.fields?.[52];
  if (!de52) return { checked: false };           // sin PIN → no se valida
  if (!cfg.validate) return { checked: false };   // validación desactivada

  const pan = String(request.fields?.[2] || '');
  const key = keysStore.getById(cfg.keyId);
  if (!key || !key.keyHex) {
    return { checked: true, ok: false, error: `TPK '${cfg.keyId}' no encontrada` };
  }
  const res = crypto8583.verifyPin(String(de52), pan, key.keyHex, cfg.expected, cfg.format);
  return { checked: true, ok: res.ok, recoveredPin: res.recoveredPin, error: res.error, keyKcv: res.keyKcv };
}

// ----------------------------------------------------------------------------
// Reglas por defecto — evaluadas en orden, la primera que matchea decide
// la respuesta. Pensadas para que el usuario pueda "provocar" cada código
// de respuesta con datos de prueba predecibles.
// ----------------------------------------------------------------------------
const DEFAULT_RULES = [
  {
    id: 'monto-alto-fondos-insuficientes',
    desc: 'Monto (DE4) mayor a 100000 → fondos insuficientes',
    test: (req) => Number(req.fields?.[4] || 0) > 100000,
    responseCode: '51',
  },
  {
    id: 'pan-termina-0000-tarjeta-invalida',
    desc: 'PAN (DE2) termina en 0000 → tarjeta inválida',
    test: (req) => /0000$/.test(String(req.fields?.[2] || '')),
    responseCode: '14',
  },
  {
    id: 'pan-termina-9999-denegada',
    desc: 'PAN (DE2) termina en 9999 → denegada genérica',
    test: (req) => /9999$/.test(String(req.fields?.[2] || '')),
    responseCode: '05',
  },
  {
    id: 'monto-cero-transaccion-invalida',
    desc: 'Monto (DE4) igual a 0 → transacción inválida',
    test: (req) => Number(req.fields?.[4] || 0) === 0,
    responseCode: '12',
  },
  {
    id: 'default-aprobada',
    desc: 'Cualquier otro caso → aprobada',
    test: () => true,
    responseCode: '00',
  },
];

function genAuthId() {
  return String(Math.floor(100000 + Math.random() * 900000)).slice(0, 6);
}

function genRrn() {
  const ts = Date.now().toString().slice(-9);
  return ts.padStart(12, '0');
}

// ----------------------------------------------------------------------------
// process(request, opts)
//   request: { mti, fields }  — salida de iso8583.parseResponse / build inverso
//   opts:    { rules, latencyMs }
//
// Devuelve: { responseCode, fields, matchedRule, latencyMs }
// ----------------------------------------------------------------------------
async function process(request, opts = {}) {
  // Prioridad: reglas pasadas por opts → reglas editadas en la UI (store) → defaults.
  let rules;
  if (Array.isArray(opts.rules) && opts.rules.length) {
    rules = opts.rules;
  } else {
    try { rules = rulesStore.getCompiledRules(); } catch { rules = DEFAULT_RULES; }
    if (!rules.length) rules = DEFAULT_RULES;
  }
  const latencyMs = opts.latencyMs ?? randomLatency();

  if (latencyMs > 0) await sleep(latencyMs);

  // --- Validación de PIN (DE52) antes de las reglas de negocio ---
  // Si la trama trae DE52 y el PIN no descifra/coincide → DE39 = 55.
  const pinCheck = validatePin(request, opts.pin);
  if (pinCheck.checked && !pinCheck.ok) {
    const fields = { 39: '55', 37: genRrn() };
    return {
      responseCode: '55',
      matchedRule: { id: 'pin-incorrecto', desc: 'DE52 presente: PIN incorrecto o no descifrable → 55' },
      pin: pinCheck,
      fields,
      latencyMs,
    };
  }

  const matched = rules.find((r) => safeTest(r, request)) || DEFAULT_RULES[DEFAULT_RULES.length - 1];

  const fields = {};
  fields[39] = matched.responseCode;
  if (matched.responseCode === '00') {
    fields[38] = genAuthId();
  }
  fields[37] = genRrn();

  return {
    responseCode: matched.responseCode,
    matchedRule: { id: matched.id, desc: matched.desc },
    pin: pinCheck.checked ? pinCheck : undefined,
    fields,
    latencyMs,
  };
}

function safeTest(rule, request) {
  try { return !!rule.test(request); } catch (_) { return false; }
}

function randomLatency() {
  // Latencia simulada realista: 80–450ms
  return 80 + Math.floor(Math.random() * 370);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { process, DEFAULT_RULES };
