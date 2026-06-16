// ============================================================================
//  BINES STORE — catálogo de BINes (Bank Identification Numbers) para pruebas.
//
//  Un BIN es el prefijo del PAN (primeros 6-8 dígitos) que identifica la marca,
//  el banco emisor y el tipo de tarjeta. Sirve para saber con qué número de
//  tarjeta probar cada caso. Se guardan en config/bines.json.
// ============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'config', 'bines.json');

// BINes de prueba conocidos (públicos, usados en sandboxes de pagos).
const DEFAULTS = [
  { bin: '411111', brand: 'visa',       profile: 'visa',       length: 16, bank: 'Visa Test Bank',        type: 'credito', desc: 'Visa clásica de prueba (aprueba)' },
  { bin: '424242', brand: 'visa',       profile: 'visa',       length: 16, bank: 'Stripe Test',           type: 'credito', desc: 'Visa sandbox Stripe' },
  { bin: '400000', brand: 'visa',       profile: 'visa',       length: 16, bank: 'Visa Generic',          type: 'debito',  desc: 'Visa débito genérica' },
  { bin: '555555', brand: 'mastercard', profile: 'mastercard', length: 16, bank: 'Mastercard Test Bank',  type: 'credito', desc: 'Mastercard clásica de prueba' },
  { bin: '510510', brand: 'mastercard', profile: 'mastercard', length: 16, bank: 'Mastercard Generic',    type: 'credito', desc: 'Mastercard genérica' },
  { bin: '222100', brand: 'mastercard', profile: 'mastercard', length: 16, bank: 'Mastercard 2-Series',   type: 'credito', desc: 'Rango nuevo 2221-2720' },
  { bin: '378282', brand: 'amex',       profile: 'generic',    length: 15, bank: 'American Express',       type: 'credito', desc: 'Amex de prueba (15 díg.)' },
  { bin: '601111', brand: 'discover',   profile: 'generic',    length: 16, bank: 'Discover',               type: 'credito', desc: 'Discover de prueba' },
  { bin: '589562', brand: 'maestro',    profile: 'mastercard', length: 16, bank: 'Maestro',                type: 'debito',  desc: 'Maestro débito' },
  { bin: '627780', brand: 'otra',       profile: 'generic',    length: 16, bank: 'BIN local / privado',    type: 'debito',  desc: 'Ejemplo BIN doméstico' },
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
  catch (err) { console.error('No se pudo guardar bines.json:', err.message); }
}

function normalize(b) {
  const bin = String(b.bin || '').replace(/\D/g, '');
  const length = Math.max(12, Math.min(19, parseInt(b.length, 10) || 16));
  return {
    bin,
    brand:   String(b.brand   || 'otra'),
    profile: String(b.profile || 'generic'),
    length,
    bank:    String(b.bank    || ''),
    type:    String(b.type    || 'credito'),
    desc:    String(b.desc    || ''),
  };
}

function getAll() { return load().map(b => ({ ...b })); }

function save(bin) {
  const list = load();
  const b = normalize(bin);
  if (!b.bin || b.bin.length < 4) throw new Error('BIN inválido (mínimo 4 dígitos)');
  const idx = list.findIndex(x => x.bin === b.bin);
  if (idx === -1) list.push(b); else list[idx] = b;
  persist();
  return b;
}

function remove(bin) {
  const list = load();
  const idx = list.findIndex(b => b.bin === String(bin));
  if (idx === -1) return false;
  list.splice(idx, 1);
  persist();
  return true;
}

function reset() { cache = DEFAULTS.map(normalize); persist(); return getAll(); }

// Genera un PAN válido (algoritmo de Luhn) a partir de un BIN y longitud.
function generatePan(bin, length) {
  const cleanBin = String(bin).replace(/\D/g, '');
  const len = Math.max(12, Math.min(19, parseInt(length, 10) || 16));
  let body = cleanBin.slice(0, len - 1);
  while (body.length < len - 1) body += Math.floor(Math.random() * 10);
  // Calcular dígito verificador de Luhn
  let sum = 0, alt = true;
  for (let i = body.length - 1; i >= 0; i--) {
    let n = parseInt(body[i], 10);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  const check = (10 - (sum % 10)) % 10;
  return body + check;
}

module.exports = { getAll, save, remove, reset, generatePan };
