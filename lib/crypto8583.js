// ============================================================================
//  CRYPTO 8583 — criptografía real de pagos (3DES, PIN blocks, KCV).
//
//  Implementa lo que hace un HSM/switch para la parte de PIN:
//   - Cifrado 3DES (TDEA) de doble y triple longitud, modo ECB.
//   - KCV (Key Check Value): cifra 8 bytes de ceros y toma los primeros 3.
//   - PIN blocks ISO 9564-1 Formato 0 (ANSI X9.8), Formato 1 y Formato 3.
//   - Cifrado/descifrado y verificación de PIN contra una llave (PEK/ZPK).
//
//  Es criptografía DE VERDAD: las llaves se usan tal cual para cifrar con el
//  módulo `crypto` nativo. No hay nada "simulado" en el cálculo.
// ============================================================================

'use strict';

const crypto = require('crypto');

// --- Helpers de bytes ---
function hexToBuf(hex) {
  const clean = String(hex).replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2 !== 0) throw new Error('hex de longitud impar');
  return Buffer.from(clean, 'hex');
}

function xorHex(a, b) {
  const ba = hexToBuf(a), bb = hexToBuf(b);
  const n = Math.min(ba.length, bb.length);
  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i++) out[i] = ba[i] ^ bb[i];
  return out.toString('hex').toUpperCase();
}

// Normaliza una llave 3DES: 16 bytes (2-key) → expande a 24 (K1K2K1).
// 8 bytes (single DES) → expande a 24 (K1K1K1). 24 bytes → tal cual.
function normalizeKey(keyHex) {
  const buf = hexToBuf(keyHex);
  if (buf.length === 24) return buf;
  if (buf.length === 16) return Buffer.concat([buf, buf.slice(0, 8)]);   // K1K2K1
  if (buf.length === 8)  return Buffer.concat([buf, buf, buf]);          // K1K1K1
  throw new Error(`longitud de llave inválida: ${buf.length} bytes (esperado 8, 16 o 24)`);
}

// 3DES-ECB de un solo bloque de 8 bytes (sin padding).
function tdesEncryptBlock(dataBuf, keyHex) {
  const key = normalizeKey(keyHex);
  const c = crypto.createCipheriv('des-ede3', key, null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(dataBuf), c.final()]);
}

function tdesDecryptBlock(dataBuf, keyHex) {
  const key = normalizeKey(keyHex);
  const d = crypto.createDecipheriv('des-ede3', key, null);
  d.setAutoPadding(false);
  return Buffer.concat([d.update(dataBuf), d.final()]);
}

// --- KCV (Key Check Value) ---
// Cifra 8 bytes de 0x00 con la llave y devuelve los primeros 3 bytes (6 hex).
function kcv(keyHex) {
  const enc = tdesEncryptBlock(Buffer.alloc(8, 0), keyHex);
  return enc.slice(0, 3).toString('hex').toUpperCase();
}

// --- PIN block (claro) según formato ISO 9564-1 ---
function buildClearPinBlock(pin, pan, format) {
  pin = String(pin).replace(/\D/g, '');
  if (pin.length < 4 || pin.length > 12) throw new Error('PIN debe tener 4 a 12 dígitos');
  const L = pin.length.toString(16).toUpperCase();

  if (format === '1') {
    // Formato 1: 1 + L + PIN + relleno aleatorio. No usa PAN.
    let blk = '1' + L + pin;
    while (blk.length < 16) blk += Math.floor(Math.random() * 16).toString(16).toUpperCase();
    return blk.slice(0, 16);
  }

  // Formato 0 (relleno F) y Formato 3 (relleno aleatorio A–F)
  const pad = (format === '3')
    ? () => (10 + Math.floor(Math.random() * 6)).toString(16).toUpperCase()  // A–F
    : () => 'F';
  const fmtDigit = (format === '3') ? '3' : '0';
  let pinField = fmtDigit + L + pin;
  while (pinField.length < 16) pinField += pad();
  pinField = pinField.slice(0, 16);

  // Campo PAN: 12 dígitos más a la derecha del PAN excluyendo el dígito verificador.
  const panDigits = String(pan).replace(/\D/g, '');
  if (panDigits.length < 13) throw new Error('PAN demasiado corto para formato 0/3');
  const pan12 = panDigits.slice(0, -1).slice(-12);
  const panField = '0000' + pan12;

  return xorHex(pinField, panField);   // 16 hex = 8 bytes claros
}

// Recupera el PIN a partir de un PIN block claro (post-descifrado).
function extractPinFromClear(clearHex, pan, format) {
  if (format === '1') {
    const L = parseInt(clearHex[1], 16);
    return clearHex.slice(2, 2 + L);
  }
  const panDigits = String(pan).replace(/\D/g, '');
  const pan12 = panDigits.slice(0, -1).slice(-12);
  const panField = '0000' + pan12;
  const pinField = xorHex(clearHex, panField);
  const L = parseInt(pinField[1], 16);
  if (isNaN(L) || L < 4 || L > 12) throw new Error('PIN block inválido o llave/PAN incorrectos');
  return pinField.slice(2, 2 + L);
}

// --- API de alto nivel ---

// Cifra un PIN → devuelve el PIN block cifrado (lo que viaja en DE52).
function encryptPin(pin, pan, keyHex, format = '0') {
  const clear = buildClearPinBlock(pin, pan, format);
  const enc = tdesEncryptBlock(hexToBuf(clear), keyHex);
  return {
    format,
    clearPinBlock: clear,
    encryptedPinBlock: enc.toString('hex').toUpperCase(),
    keyKcv: kcv(keyHex),
  };
}

// Descifra un PIN block y devuelve el PIN recuperado.
function decryptPin(encryptedHex, pan, keyHex, format = '0') {
  const dec = tdesDecryptBlock(hexToBuf(encryptedHex), keyHex);
  const clearHex = dec.toString('hex').toUpperCase();
  const pin = extractPinFromClear(clearHex, pan, format);
  return { format, clearPinBlock: clearHex, pin, keyKcv: kcv(keyHex) };
}

// Verifica que un PIN block cifrado corresponda a un PIN esperado.
function verifyPin(encryptedHex, pan, keyHex, expectedPin, format = '0') {
  try {
    const { pin, clearPinBlock } = decryptPin(encryptedHex, pan, keyHex, format);
    return { ok: pin === String(expectedPin), recoveredPin: pin, clearPinBlock, keyKcv: kcv(keyHex) };
  } catch (err) {
    return { ok: false, error: err.message, keyKcv: kcv(keyHex) };
  }
}

// --- MAC (Message Authentication Code) ---
//
// Retail MAC = ISO 9797-1 Algoritmo 3 / ANSI X9.19 / X9.9:
//   1. Dividir el mensaje en bloques de 8 bytes. Si el último es parcial,
//      rellenarlo con 0x00 (padding método 1) o 0x80 0x00... (método ISO).
//   2. CBC con la mitad izquierda de la llave (K1) sobre todos los bloques
//      → resultado intermedio.
//   3. Descifrar ese resultado con la mitad derecha (K2).
//   4. Volver a cifrar con K1.
//   => MAC = 8 bytes (16 hex). En la trama ISO se coloca en DE64 o DE128.
//
// macData = todo el mensaje ISO EXCEPTO los 8 bytes donde iría el MAC,
//           típicamente desde el MTI hasta el último campo antes del DE64.

// Single DES vía 3DES con llave K1K1K1 (OpenSSL 3 deshabilita 'des-ecb' suelto,
// pero 'des-ede3' con las tres mitades iguales == single DES).
function desEnc(block8, k8) { return tdesEncryptBlock(block8, k8.toString('hex')); }
function desDec(block8, k8) { return tdesDecryptBlock(block8, k8.toString('hex')); }

function computeRetailMAC(dataHex, keyHex) {
  const dataBuf = hexToBuf(dataHex);
  const key = normalizeKey(keyHex);
  const k1 = key.slice(0, 8);   // primera mitad
  const k2 = key.slice(8, 16);  // segunda mitad

  // Padding método 1: relleno con 0x00 hasta múltiplo de 8
  const padLen = (8 - (dataBuf.length % 8)) % 8;
  const padded = Buffer.concat([dataBuf, Buffer.alloc(padLen, 0)]);

  // CBC con K1 (single DES) sobre todos los bloques
  let prev = Buffer.alloc(8, 0);
  let inter = prev;
  for (let i = 0; i < padded.length; i += 8) {
    const block = padded.slice(i, i + 8);
    const xored = Buffer.alloc(8);
    for (let j = 0; j < 8; j++) xored[j] = prev[j] ^ block[j];
    inter = desEnc(xored, k1);
    prev = inter;
  }

  // Transformación final: descifrar con K2, volver a cifrar con K1
  const mac = desEnc(desDec(inter, k2), k1);
  return mac.toString('hex').toUpperCase();
}

// Verifica que un MAC recibido (hex 16 chars) sea correcto para los datos dados.
function verifyRetailMAC(dataHex, macHex, keyHex) {
  const expected = computeRetailMAC(dataHex, keyHex);
  const received = macHex.toUpperCase();
  return { ok: expected === received, expected, received, keyKcv: kcv(keyHex) };
}

// Genera una llave 3DES aleatoria con paridad impar por byte (estilo HSM).
function generateKey(bytes = 16) {
  if (![8, 16, 24].includes(bytes)) bytes = 16;
  const buf = crypto.randomBytes(bytes);
  for (let i = 0; i < buf.length; i++) {
    let b = buf[i], ones = 0;
    for (let k = 1; k < 8; k++) if (b & (1 << k)) ones++;
    if (ones % 2 === 0) b ^= 1; else b &= 0xFE;
    buf[i] = b;
  }
  const hex = buf.toString('hex').toUpperCase();
  return { keyHex: hex, kcv: kcv(hex), bytes };
}

module.exports = {
  kcv, encryptPin, decryptPin, verifyPin, generateKey,
  computeRetailMAC, verifyRetailMAC,
  tdesEncryptBlock, tdesDecryptBlock, normalizeKey, buildClearPinBlock,
};
