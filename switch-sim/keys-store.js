// ============================================================================
//  KEYS STORE — llavero criptográfico para pruebas.
//
//  Guarda llaves 3DES (en claro, solo para laboratorio) con su tipo y KCV.
//  Tipos típicos de un switch/HSM:
//    ZMK  Zone Master Key      · cifra otras llaves entre instituciones
//    ZPK  Zone PIN Key         · cifra PIN blocks entre zonas
//    TMK  Terminal Master Key  · protege llaves del terminal
//    TPK  Terminal PIN Key     · cifra el PIN en el terminal (PEK)
//    PVK  PIN Verification Key  · verifica PINs (PVV/offset)
//
//  ⚠️ Guardar llaves en claro es SOLO para simulación/pruebas. Un HSM real
//     nunca expone una llave en claro.
// ============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const crypto8583 = require('../lib/crypto8583');
const keyvault = require('../lib/keyvault');

const FILE = path.join(__dirname, '..', 'config', 'keys.json');

const KEY_TYPES = ['ZMK', 'ZPK', 'TMK', 'TPK', 'PVK', 'BDK', 'MAC'];

// Llaves de ejemplo (valores de laboratorio, no de producción).
const DEFAULTS = [
  { id: 'zpk-demo', name: 'ZPK de prueba',   type: 'ZPK', keyHex: '0123456789ABCDEFFEDCBA9876543210', desc: 'PIN key entre zonas' },
  { id: 'tpk-demo', name: 'TPK del terminal', type: 'TPK', keyHex: '1A2B3C4D5E6F70819AABBCCDDEEFF001', desc: 'PIN key del POS' },
];

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (Array.isArray(parsed)) { cache = parsed.map(fromStored); return cache; }
  } catch (_) { /* sembrar defaults */ }
  cache = DEFAULTS.map(normalize);
  persist();
  return cache;
}

// Persiste solo la forma cifrada: nunca se escribe keyHex en claro a disco.
function persist() {
  const onDisk = cache.map(k => ({
    id: k.id, name: k.name, type: k.type, desc: k.desc, keyHexEnc: keyvault.seal(k.keyHex),
  }));
  try { fs.writeFileSync(FILE, JSON.stringify(onDisk, null, 2)); }
  catch (err) { console.error('No se pudo guardar keys.json:', err.message); }
}

// Reconstruye un registro en memoria a partir de lo guardado (cifrado) en disco.
function fromStored(k) {
  let keyHex = '';
  try { keyHex = keyvault.unseal(k.keyHexEnc); } catch (_) { keyHex = ''; }
  return normalize({ ...k, keyHex });
}

function normalize(k) {
  const keyHex = String(k.keyHex || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  let kcv = '';
  try { kcv = crypto8583.kcv(keyHex); } catch (_) { kcv = '—'; }
  return {
    id:     String(k.id || genId(k.name)),
    name:   String(k.name || 'Llave'),
    type:   KEY_TYPES.includes(k.type) ? k.type : 'ZPK',
    keyHex,
    bytes:  keyHex.length / 2,
    kcv,
    desc:   String(k.desc || ''),
  };
}

function genId(name) {
  const slug = String(name || 'key').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  return `${slug || 'key'}-${Date.now().toString(36)}`;
}

// Vista pública: nunca expone keyHex (igual que un HSM real, la llave no sale).
function getAll() { return load().map(({ keyHex, ...rest }) => ({ ...rest })); }

// Uso interno (resolveKey, etc.): incluye keyHex en claro para operar.
function getById(id) { return load().find(k => k.id === id) || null; }

function save(key) {
  const list = load();
  const k = normalize(key);
  if (![8, 16, 24].includes(k.bytes)) throw new Error(`longitud de llave inválida: ${k.bytes} bytes (esperado 8, 16 o 24)`);
  const idx = list.findIndex(x => x.id === k.id);
  if (idx === -1) list.push(k); else list[idx] = k;
  persist();
  const { keyHex, ...pub } = k;
  return pub;
}

function remove(id) {
  const list = load();
  const idx = list.findIndex(k => k.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  persist();
  return true;
}

function reset() { cache = DEFAULTS.map(normalize); persist(); return getAll(); }

module.exports = { getAll, getById, save, remove, reset, KEY_TYPES };
