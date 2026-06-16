// ============================================================================
//  RULES STORE — reglas del switch simulado, editables desde la UI.
//
//  Las reglas se guardan en formato DECLARATIVO (campo/operador/valor) en
//  config/rules.json, para poder crearlas, editarlas, reordenarlas y borrarlas
//  desde el panel web sin tocar código ni usar eval().
//
//  Cada regla declarativa se "compila" a una función test() que el mock-switch
//  evalúa contra el request parseado.
//
//  Formato de una regla:
//  {
//    id:           'mi-regla',
//    desc:         'Descripción legible',
//    responseCode: '51',
//    match:        'all' | 'any',          // cómo combinar condiciones
//    conditions:   [ { field: '4', op: 'gt', value: '100000' }, ... ]
//  }
//  Una regla SIN condiciones es "catch-all" (siempre matchea) y debe ir última.
// ============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const RULES_FILE = path.join(__dirname, '..', 'config', 'rules.json');

// ----------------------------------------------------------------------------
// Operadores soportados. 'field' puede ser un número de DE ('2','4'...) o 'mti'.
// ----------------------------------------------------------------------------
const OPS = {
  gt:         { label: 'mayor que (>)',        fn: (a, b) => Number(a) > Number(b) },
  gte:        { label: 'mayor o igual (>=)',   fn: (a, b) => Number(a) >= Number(b) },
  lt:         { label: 'menor que (<)',        fn: (a, b) => Number(a) < Number(b) },
  lte:        { label: 'menor o igual (<=)',   fn: (a, b) => Number(a) <= Number(b) },
  eq:         { label: 'igual a (=)',          fn: (a, b) => String(a) === String(b) },
  ne:         { label: 'distinto de (!=)',     fn: (a, b) => String(a) !== String(b) },
  endsWith:   { label: 'termina en',           fn: (a, b) => String(a).endsWith(String(b)) },
  startsWith: { label: 'empieza con',          fn: (a, b) => String(a).startsWith(String(b)) },
  contains:   { label: 'contiene',             fn: (a, b) => String(a).includes(String(b)) },
  regex:      { label: 'regex',                fn: (a, b) => { try { return new RegExp(b).test(String(a)); } catch { return false; } } },
};

// ----------------------------------------------------------------------------
// Reglas por defecto (equivalentes a las originales del mock-switch).
// ----------------------------------------------------------------------------
const DEFAULT_RULES = [
  { id: 'monto-alto-fondos-insuficientes', desc: 'Monto (DE4) mayor a 100000 → fondos insuficientes', responseCode: '51', match: 'all', conditions: [{ field: '4', op: 'gt', value: '100000' }] },
  { id: 'pan-termina-0000-tarjeta-invalida', desc: 'PAN (DE2) termina en 0000 → tarjeta inválida', responseCode: '14', match: 'all', conditions: [{ field: '2', op: 'endsWith', value: '0000' }] },
  { id: 'pan-termina-9999-denegada', desc: 'PAN (DE2) termina en 9999 → denegada genérica', responseCode: '05', match: 'all', conditions: [{ field: '2', op: 'endsWith', value: '9999' }] },
  { id: 'monto-cero-transaccion-invalida', desc: 'Monto (DE4) igual a 0 → transacción inválida', responseCode: '12', match: 'all', conditions: [{ field: '4', op: 'eq', value: '0' }] },
  { id: 'default-aprobada', desc: 'Cualquier otro caso → aprobada', responseCode: '00', match: 'all', conditions: [] },
];

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(RULES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      cache = parsed.map(normalize);
      return cache;
    }
  } catch (_) { /* archivo no existe o inválido → sembramos defaults */ }
  cache = DEFAULT_RULES.map(normalize);
  persist();
  return cache;
}

function persist() {
  try {
    fs.writeFileSync(RULES_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error('No se pudo guardar rules.json:', err.message);
  }
}

function normalize(rule) {
  return {
    id: String(rule.id || genId(rule.desc)),
    desc: String(rule.desc || ''),
    responseCode: String(rule.responseCode ?? '00'),
    match: rule.match === 'any' ? 'any' : 'all',
    conditions: Array.isArray(rule.conditions)
      ? rule.conditions
          .filter((c) => c && c.field != null && OPS[c.op])
          .map((c) => ({ field: String(c.field), op: c.op, value: String(c.value ?? '') }))
      : [],
  };
}

function genId(desc) {
  const slug = String(desc || 'regla').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return `${slug || 'regla'}-${Date.now().toString(36)}`;
}

function fieldValue(request, field) {
  if (field === 'mti') return request.mti;
  return request.fields?.[field];
}

// Compila una regla declarativa a { id, desc, responseCode, test }
function compile(rule) {
  return {
    id: rule.id,
    desc: rule.desc,
    responseCode: rule.responseCode,
    test: (request) => {
      if (!rule.conditions.length) return true; // catch-all
      const results = rule.conditions.map((c) => {
        const op = OPS[c.op];
        if (!op) return false;
        return op.fn(fieldValue(request, c.field) ?? '', c.value);
      });
      return rule.match === 'any' ? results.some(Boolean) : results.every(Boolean);
    },
  };
}

// ----------------------------------------------------------------------------
// API pública
// ----------------------------------------------------------------------------
function getRules() {
  return load().map((r) => ({ ...r, conditions: r.conditions.map((c) => ({ ...c })) }));
}

function getCompiledRules() {
  return load().map(compile);
}

function addRule(rule) {
  const list = load();
  const r = normalize({ ...rule, id: rule.id || genId(rule.desc) });
  // Insertar antes del primer catch-all para que las reglas nuevas tengan efecto.
  const catchAllIdx = list.findIndex((x) => x.conditions.length === 0);
  if (catchAllIdx === -1) list.push(r);
  else list.splice(catchAllIdx, 0, r);
  persist();
  return r;
}

function updateRule(id, patch) {
  const list = load();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  list[idx] = normalize({ ...list[idx], ...patch, id });
  persist();
  return list[idx];
}

function deleteRule(id) {
  const list = load();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  persist();
  return true;
}

function reorderRules(orderedIds) {
  const list = load();
  const byId = new Map(list.map((r) => [r.id, r]));
  const next = [];
  for (const id of orderedIds) if (byId.has(id)) { next.push(byId.get(id)); byId.delete(id); }
  for (const r of byId.values()) next.push(r); // los no mencionados quedan al final
  cache = next;
  persist();
  return getRules();
}

function resetRules() {
  cache = DEFAULT_RULES.map(normalize);
  persist();
  return getRules();
}

module.exports = {
  OPS,
  DEFAULT_RULES,
  getRules,
  getCompiledRules,
  addRule,
  updateRule,
  deleteRule,
  reorderRules,
  resetRules,
};
