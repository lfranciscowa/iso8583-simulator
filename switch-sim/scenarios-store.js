// ============================================================================
//  SCENARIOS STORE — escenarios de prueba guardables.
//
//  Un escenario captura todo lo necesario para reproducir una transacción:
//  perfil, MTI, encoding y los Data Elements. Se guardan en config/scenarios.json
//  para reutilizarlos con un clic (ej: "compra aprobada", "reverso", "timeout").
// ============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'config', 'scenarios.json');

// Escenarios de ejemplo precargados la primera vez.
const DEFAULTS = [
  { id: 'compra-aprobada', name: 'Compra aprobada', profile: 'generic', mti: '0200', encoding: 'ascii', expectedCode: '00',
    fields: { 2: '4111111111111111', 3: '000000', 4: '000000015000', 11: '000123', 41: 'TERM0001', 42: 'MERCH00000001', 49: '840' } },
  { id: 'fondos-insuficientes', name: 'Fondos insuficientes', profile: 'generic', mti: '0200', encoding: 'ascii', expectedCode: '51',
    fields: { 2: '4111111111111111', 3: '000000', 4: '000000200000', 11: '000124', 41: 'TERM0001', 42: 'MERCH00000001', 49: '840' } },
  { id: 'visa-auth', name: 'Visa · autorización (0100)', profile: 'visa', mti: '0100', encoding: 'ascii', expectedCode: '00',
    fields: { 2: '4111111111111111', 3: '000000', 4: '000000010000', 11: '000200', 41: 'TERM0001', 49: '840' } },
  { id: 'mc-auth-ebcdic', name: 'Mastercard · auth EBCDIC', profile: 'mastercard', mti: '0100', encoding: 'ebcdic', expectedCode: '00',
    fields: { 2: '5555555555554444', 3: '000000', 4: '000000025000', 11: '000201', 41: 'TERM0009', 49: '840' } },
];

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (Array.isArray(parsed)) { cache = parsed.map(normalize); return cache; }
  } catch (_) { /* no existe → sembrar defaults */ }
  cache = DEFAULTS.map(normalize);
  persist();
  return cache;
}

function persist() {
  try { fs.writeFileSync(FILE, JSON.stringify(cache, null, 2)); }
  catch (err) { console.error('No se pudo guardar scenarios.json:', err.message); }
}

function normalize(s) {
  return {
    id: String(s.id || genId(s.name)),
    name: String(s.name || 'Escenario'),
    profile: String(s.profile || 'generic'),
    mti: String(s.mti || '0200'),
    encoding: s.encoding === 'ebcdic' ? 'ebcdic' : 'ascii',
    expectedCode: s.expectedCode ? String(s.expectedCode) : null,
    fields: (s.fields && typeof s.fields === 'object') ? s.fields : {},
  };
}

function genId(name) {
  const slug = String(name || 'escenario').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return `${slug || 'escenario'}-${Date.now().toString(36)}`;
}

function getAll() { return load().map(s => ({ ...s, fields: { ...s.fields } })); }

function save(scenario) {
  const list = load();
  const s = normalize(scenario);
  const idx = list.findIndex(x => x.id === s.id || x.name.toLowerCase() === s.name.toLowerCase());
  if (idx === -1) list.push(s); else { s.id = list[idx].id; list[idx] = s; }
  persist();
  return s;
}

function remove(id) {
  const list = load();
  const idx = list.findIndex(s => s.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  persist();
  return true;
}

function reset() { cache = DEFAULTS.map(normalize); persist(); return getAll(); }

module.exports = { getAll, save, remove, reset };
