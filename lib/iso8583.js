// ============================================================================
//  Encoder / Parser ISO 8583:1987 con PERFILES de red (genérico / Visa / MC).
//
//  Cada perfil define:
//    - header   : bytes fijos antes del MTI (TPDU en genérico, vacío en marcas)
//    - mtiEnc   : 'bcd' (MTI empaquetado) o 'ascii' (4 chars)
//    - fields   : diccionario de Data Elements (con nombres por marca)
//    - mtis     : MTIs por defecto (auth / financial)
//
//  Wire layout: [len:2][header:H][mti:M][bitmap:8 ó 16][campos...]
//
//  IMPORTANTE: los perfiles Visa/Mastercard son APROXIMACIONES DIDÁCTICAS
//  basadas en el estándar público ISO 8583:1987. Las especificaciones reales
//  de cada marca (Visa BASE I / VIP, Mastercard CIS / MIP) son confidenciales
//  y no se replican byte-por-byte.
// ============================================================================

'use strict';

const ebcdic = require('./ebcdic');

// ----------------------------------------------------------------------------
// Codec de texto (ASCII o EBCDIC CP037)
// ----------------------------------------------------------------------------
function encodeText(str, encoding) {
  return encoding === 'ebcdic' ? ebcdic.asciiToEbcdic(str) : Buffer.from(str, 'ascii');
}
function decodeText(buf, encoding) {
  return encoding === 'ebcdic' ? ebcdic.ebcdicToAscii(buf) : buf.toString('ascii');
}

const ACCOUNT_TYPES = {
  '000000': 'Cuenta principal',
  '001000': 'Ahorro',
  '002000': 'Corriente',
  '003000': 'Crédito',
};

// ----------------------------------------------------------------------------
// Diccionario estándar ISO 8583:1987 (base común de Visa y Mastercard).
// DEs que se empaquetan en BCD: 2, 32, 33, 35 (PAN, IDs, track2).
// ----------------------------------------------------------------------------
const STD_FIELDS = {
  2:   { type: 'LLVAR',  maxLen: 19,  name: 'PAN' },
  3:   { type: 'n',      length: 6,   name: 'Processing code' },
  4:   { type: 'n',      length: 12,  name: 'Amount, transaction' },
  5:   { type: 'n',      length: 12,  name: 'Amount, settlement' },
  6:   { type: 'n',      length: 12,  name: 'Amount, cardholder billing' },
  7:   { type: 'n',      length: 10,  name: 'Transmission date & time' },
  9:   { type: 'n',      length: 8,   name: 'Conversion rate, settlement' },
  10:  { type: 'n',      length: 8,   name: 'Conversion rate, cardholder' },
  11:  { type: 'n',      length: 6,   name: 'STAN' },
  12:  { type: 'n',      length: 6,   name: 'Time, local (hhmmss)' },
  13:  { type: 'n',      length: 4,   name: 'Date, local (MMDD)' },
  14:  { type: 'n',      length: 4,   name: 'Card expiry (YYMM)' },
  15:  { type: 'n',      length: 4,   name: 'Settlement date' },
  16:  { type: 'n',      length: 4,   name: 'Conversion date' },
  18:  { type: 'n',      length: 4,   name: 'Merchant category code' },
  19:  { type: 'n',      length: 3,   name: 'Acquiring country code' },
  20:  { type: 'n',      length: 3,   name: 'PAN country code' },
  22:  { type: 'n',      length: 4,   name: 'POS entry mode' },
  23:  { type: 'n',      length: 4,   name: 'Card sequence number' },
  24:  { type: 'n',      length: 4,   name: 'NII / Function code' },
  25:  { type: 'n',      length: 4,   name: 'POS condition code' },
  26:  { type: 'n',      length: 4,   name: 'POS PIN capture code' },
  28:  { type: 'an',     length: 9,   name: 'Amount, transaction fee' },
  32:  { type: 'LLVAR',  maxLen: 11,  name: 'Acquiring institution ID' },
  33:  { type: 'LLVAR',  maxLen: 11,  name: 'Forwarding institution ID' },
  35:  { type: 'LLVAR',  maxLen: 37,  name: 'Track 2 data', allowSep: true },
  37:  { type: 'an',     length: 12,  name: 'Retrieval reference number' },
  38:  { type: 'an',     length: 6,   name: 'Authorization ID response' },
  39:  { type: 'an',     length: 2,   name: 'Response code' },
  41:  { type: 'an',     length: 8,   name: 'Terminal ID' },
  42:  { type: 'an',     length: 15,  name: 'Merchant ID' },
  43:  { type: 'an',     length: 40,  name: 'Card acceptor name/location' },
  44:  { type: 'LLVAR',  maxLen: 25,  name: 'Additional response data' },
  45:  { type: 'LLVAR',  maxLen: 76,  name: 'Track 1 data' },
  46:  { type: 'LLLVAR', maxLen: 999, name: 'Additional data (ISO)' },
  47:  { type: 'LLLVAR', maxLen: 999, name: 'Additional data (national)' },
  48:  { type: 'LLLVAR', maxLen: 999, name: 'Additional data (private)' },
  49:  { type: 'n',      length: 3,   name: 'Currency code, transaction' },
  50:  { type: 'n',      length: 3,   name: 'Currency code, settlement' },
  51:  { type: 'n',      length: 3,   name: 'Currency code, cardholder' },
  52:  { type: 'b',      length: 8,   name: 'PIN data', binaryData: true },
  53:  { type: 'n',      length: 16,  name: 'Security control info' },
  54:  { type: 'LLLVAR', maxLen: 120, name: 'Additional amounts' },
  55:  { type: 'LLLVAR', maxLen: 999, name: 'ICC / EMV data', binaryData: true },
  56:  { type: 'LLLVAR', maxLen: 999, name: 'Reserved ISO' },
  57:  { type: 'LLLVAR', maxLen: 999, name: 'Reserved national' },
  58:  { type: 'LLLVAR', maxLen: 999, name: 'Reserved national' },
  59:  { type: 'LLLVAR', maxLen: 999, name: 'Reserved national' },
  60:  { type: 'LLLVAR', maxLen: 999, name: 'Reserved private' },
  61:  { type: 'LLLVAR', maxLen: 999, name: 'Reserved private' },
  62:  { type: 'LLLVAR', maxLen: 999, name: 'Reserved private' },
  63:  { type: 'LLLVAR', maxLen: 999, name: 'Reserved private' },
  64:  { type: 'b',      length: 8,   name: 'MAC (message auth code)', binaryData: true },
  70:  { type: 'n',      length: 3,   name: 'Network management code' },
  90:  { type: 'n',      length: 42,  name: 'Original data elements' },
  95:  { type: 'an',     length: 42,  name: 'Replacement amounts' },
  100: { type: 'LLVAR',  maxLen: 11,  name: 'Receiving institution ID' },
  102: { type: 'LLVAR',  maxLen: 28,  name: 'Account identification 1' },
  103: { type: 'LLVAR',  maxLen: 28,  name: 'Account identification 2' },
  128: { type: 'b',      length: 8,   name: 'MAC extendido (bitmap secundario)', binaryData: true },
};

// DEs que viajan en BCD (dígitos empaquetados) dentro de LLVAR.
const BCD_LLVAR = new Set([2, 32, 33, 35]);

function mergeFields(overrides) {
  const out = {};
  for (const de of Object.keys(STD_FIELDS)) out[de] = { ...STD_FIELDS[de] };
  for (const de of Object.keys(overrides || {})) out[de] = { ...(out[de] || {}), ...overrides[de] };
  return out;
}

// ----------------------------------------------------------------------------
// PERFILES de red
// ----------------------------------------------------------------------------
const PROFILES = {
  generic: {
    id: 'generic',
    name: 'Genérico (switch/adquirente)',
    headerHex: '6000500100',     // TPDU clásico
    mtiEnc: 'bcd',
    mtis: { auth: '0200', financial: '0200', reversal: '0420', network: '0800' },
    // DE32 como n4 (BCD fijo), no LLVAR: así lo envía el switch AS/400 real
    // que está simulando este perfil (ver visual-admin/csr/lib/iso8583.js).
    fields: mergeFields({
      32: { type: 'n', length: 4, name: 'Acquiring institution ID' },
    }),
  },
  visa: {
    id: 'visa',
    name: 'Visa (BASE I-like)',
    headerHex: '',               // marcas: sin TPDU
    mtiEnc: 'bcd',
    mtis: { auth: '0100', financial: '0200', reversal: '0400', network: '0800' },
    fields: mergeFields({
      48: { name: 'Additional data — private (Visa)' },
      62: { name: 'Custom payment service (Visa)' },
      63: { name: 'Reserved private (Visa)' },
    }),
  },
  mastercard: {
    id: 'mastercard',
    name: 'Mastercard (CIS-like)',
    headerHex: '',
    mtiEnc: 'bcd',
    mtis: { auth: '0100', financial: '0200', reversal: '0400', network: '0800' },
    fields: mergeFields({
      48: { name: 'Additional data — private (Mastercard)' },
      61: { name: 'POS data (Mastercard)' },
      62: { name: 'Intra-network data (Mastercard)' },
      63: { name: 'Reserved private (Mastercard)' },
    }),
  },
};

function getProfile(p) {
  if (p && typeof p === 'object' && p.fields) return p;
  return PROFILES[p] || PROFILES.generic;
}

// Compat: FIELD_DEF = diccionario del perfil genérico
const FIELD_DEF = PROFILES.generic.fields;

// ----------------------------------------------------------------------------
// Diccionario de códigos de respuesta (DE 39)
// ----------------------------------------------------------------------------
const RESPONSE_CODES = {
  '00': '✅ Aprobada', '01': 'Referirse al emisor', '03': 'Comercio inválido',
  '04': 'Capturar tarjeta', '05': '❌ Denegada', '12': 'Transacción inválida',
  '13': 'Monto inválido', '14': 'Tarjeta inválida', '30': 'Error de formato',
  '41': 'Tarjeta extraviada', '43': 'Tarjeta robada', '51': 'Fondos insuficientes',
  '54': 'Tarjeta vencida', '55': 'PIN incorrecto', '57': 'Transacción no permitida',
  '58': 'Terminal no autorizada', '61': 'Excede límite de retiro', '62': 'Tarjeta restringida',
  '65': 'Excede frecuencia de retiro', '75': 'PIN bloqueado', '76': 'Cuenta no encontrada',
  '78': 'Cuenta inválida', '91': '⚠️ Switch fuera de servicio', '92': 'Ruta no encontrada',
  '94': 'Transacción duplicada', '96': 'Mal funcionamiento del sistema',
};

function describeResponseCode(code) {
  return RESPONSE_CODES[code] || `Código ${code}`;
}

// ----------------------------------------------------------------------------
// BCD packing
// ----------------------------------------------------------------------------
function bcdPack(digits, expectedBytes, allowSep = false) {
  let s = String(digits);
  if (allowSep) s = s.replace(/=/g, 'D');
  if (s.length % 2 !== 0) s = s + '0';
  const buf = Buffer.alloc(expectedBytes, 0);
  for (let i = 0; i < s.length && i / 2 < expectedBytes; i += 2) {
    buf[i / 2] = parseInt(s.substr(i, 2), 16);
  }
  return buf;
}

function bcdUnpack(buf, totalDigits) {
  let s = '';
  for (const b of buf) {
    s += ((b >> 4) & 0xF).toString(16) + (b & 0xF).toString(16);
  }
  return s.toUpperCase().substr(0, totalDigits);
}

// MTI según perfil
function encodeMti(mti, mtiEnc) {
  return mtiEnc === 'ascii' ? Buffer.from(mti, 'ascii') : bcdPack(mti, 2);
}
function decodeMti(buf, mtiEnc) {
  return mtiEnc === 'ascii' ? buf.toString('ascii') : bcdUnpack(buf, 4);
}
function mtiByteLen(mtiEnc) {
  return mtiEnc === 'ascii' ? 4 : 2;
}

// ----------------------------------------------------------------------------
// Bitmap
// ----------------------------------------------------------------------------
function buildBitmap(des) {
  const hasSecondary = des.some(d => d > 64);
  const active = des.slice();
  if (hasSecondary && !active.includes(1)) active.push(1);
  const bitmap = Buffer.alloc(hasSecondary ? 16 : 8, 0);
  for (const d of active) {
    if (d < 1 || d > 128) continue;
    const idx = (d - 1) >> 3;
    const bit = 7 - ((d - 1) & 7);
    bitmap[idx] |= (1 << bit);
  }
  return bitmap;
}

// ----------------------------------------------------------------------------
// Codificar campo individual
// ----------------------------------------------------------------------------
function encodeField(de, value, encoding, fieldDef) {
  const def = fieldDef[de];
  if (!def) throw new Error(`DE ${de} no definido en el perfil`);
  const v = String(value);

  if (def.type === 'n') {
    if (v.length > def.length) throw new Error(`DE ${de} (${def.name}) excede ${def.length} dígitos: "${v}"`);
    if (!/^\d*$/.test(v)) throw new Error(`DE ${de} (${def.name}) debe ser numérico: "${v}"`);
    const expectedBytes = Math.ceil(def.length / 2);
    const padded = v.padStart(expectedBytes * 2, '0');
    return bcdPack(padded, expectedBytes);
  }

  if (def.type === 'an') {
    const padded = v.padEnd(def.length, ' ').slice(0, def.length);
    return encodeText(padded, encoding);
  }

  if (def.type === 'b') {
    if (!/^[0-9a-fA-F]*$/.test(v) || v.length % 2 !== 0) {
      throw new Error(`DE ${de} (${def.name}) debe ser hex de longitud par`);
    }
    const buf = Buffer.alloc(def.length, 0);
    Buffer.from(v, 'hex').copy(buf);
    return buf;
  }

  if (def.type === 'LLVAR') {
    if (v.length > def.maxLen) throw new Error(`DE ${de} excede ${def.maxLen} chars`);
    const lenByte = bcdPack(v.length.toString().padStart(2, '0'), 1);
    const dataBytes = BCD_LLVAR.has(de)
      ? bcdPack(v, Math.ceil(v.length / 2), def.allowSep)
      : encodeText(v, encoding);
    return Buffer.concat([lenByte, dataBytes]);
  }

  if (def.type === 'LLLVAR') {
    if (v.length > def.maxLen) throw new Error(`DE ${de} excede ${def.maxLen} chars`);
    let dataBytes;
    if (def.binaryData) {
      if (v.length % 2 !== 0) throw new Error(`DE ${de} (binario): hex debe tener longitud par`);
      dataBytes = Buffer.from(v, 'hex');
    } else {
      dataBytes = encodeText(v, encoding);
    }
    const lenBytes = bcdPack(dataBytes.length.toString().padStart(4, '0'), 2);
    return Buffer.concat([lenBytes, dataBytes]);
  }

  throw new Error(`Tipo no soportado: ${def.type}`);
}

// ----------------------------------------------------------------------------
// Construir mensaje completo
// ----------------------------------------------------------------------------
function buildMessage(opts) {
  const { mti, fields, encoding = 'ascii' } = opts;
  const profile = getProfile(opts.profile);
  if (!mti || !/^\d{4}$/.test(mti)) throw new Error(`MTI inválido: "${mti}" (debe ser 4 dígitos)`);

  const sortedDEs = Object.keys(fields)
    .map(Number)
    .filter(n => fields[n] !== undefined && fields[n] !== '' && fields[n] !== null)
    .sort((a, b) => a - b);

  const headerBuf = Buffer.from(profile.headerHex || '', 'hex');
  const mtiBuf    = encodeMti(mti, profile.mtiEnc);
  const bitmapBuf = buildBitmap(sortedDEs);
  const fieldBufs = sortedDEs.map(de => encodeField(de, fields[de], encoding, profile.fields));

  const body = Buffer.concat([headerBuf, mtiBuf, bitmapBuf, ...fieldBufs]);

  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(body.length, 0);
  return Buffer.concat([lenBuf, body]);
}

// ----------------------------------------------------------------------------
// Parser
// ----------------------------------------------------------------------------
function parseResponse(buf, encoding = 'ascii', profileArg) {
  const profile  = getProfile(profileArg);
  const fieldDef = profile.fields;
  const headerLen = Buffer.from(profile.headerHex || '', 'hex').length;
  const mtiLen    = mtiByteLen(profile.mtiEnc);
  const bitmapStart = 2 + headerLen + mtiLen;
  const dataStart   = bitmapStart + 8;

  if (buf.length < dataStart) {
    return { error: 'Mensaje demasiado corto', rawHex: buf.toString('hex').toUpperCase() };
  }

  const out = { rawHex: buf.toString('hex').toUpperCase(), profile: profile.id };
  out.declaredLen = buf.readUInt16BE(0);
  out.header      = headerLen ? buf.slice(2, 2 + headerLen).toString('hex').toUpperCase() : '';
  out.mti         = decodeMti(buf.slice(2 + headerLen, bitmapStart), profile.mtiEnc);

  const primary = buf.slice(bitmapStart, bitmapStart + 8);
  out.bitmapHex = primary.toString('hex').toUpperCase();
  out.bitmapBin = [...primary].map(b => b.toString(2).padStart(8, '0')).join(' ');

  // Bitmap secundario si DE1 está presente
  let bmBytes = primary;
  let offset = dataStart;
  if (primary[0] & 0x80) {
    if (buf.length >= dataStart + 8) {
      bmBytes = Buffer.concat([primary, buf.slice(dataStart, dataStart + 8)]);
      offset += 8;
    }
  }
  out.dataHex = buf.slice(offset).toString('hex').toUpperCase();

  const presentDEs = [];
  for (let i = 1; i < bmBytes.length * 8; i++) { // i=0 es DE1 (indicador), DEs desde 2
    const byteIdx = i >> 3;
    const bitIdx  = 7 - (i & 7);
    if (bmBytes[byteIdx] & (1 << bitIdx)) presentDEs.push(i + 1);
  }
  out.presentDEs = presentDEs;

  try {
    const fields = {};
    for (const de of presentDEs) {
      const def = fieldDef[de];
      if (!def) { out.parseWarning = `DE ${de} no conocido, parseo abortado en offset ${offset}`; break; }

      if (def.type === 'n') {
        const bytes = Math.ceil(def.length / 2);
        if (offset + bytes > buf.length) break;
        // En longitudes impares hay un nibble de relleno a la izquierda → tomar los últimos N dígitos
        fields[de] = bcdUnpack(buf.slice(offset, offset + bytes), bytes * 2).slice(-def.length);
        offset += bytes;
      } else if (def.type === 'an') {
        if (offset + def.length > buf.length) break;
        fields[de] = decodeText(buf.slice(offset, offset + def.length), encoding);
        offset += def.length;
      } else if (def.type === 'b') {
        if (offset + def.length > buf.length) break;
        fields[de] = buf.slice(offset, offset + def.length).toString('hex').toUpperCase();
        offset += def.length;
      } else if (def.type === 'LLVAR') {
        if (offset + 1 > buf.length) break;
        const dataLen = parseInt(bcdUnpack(buf.slice(offset, offset + 1), 2), 10);
        offset += 1;
        if (BCD_LLVAR.has(de)) {
          const bytes = Math.ceil(dataLen / 2);
          if (offset + bytes > buf.length) break;
          let unpacked = bcdUnpack(buf.slice(offset, offset + bytes), bytes * 2);
          if (def.allowSep) unpacked = unpacked.replace(/D/gi, '=');
          fields[de] = unpacked.substr(0, dataLen);
          offset += bytes;
        } else {
          if (offset + dataLen > buf.length) break;
          fields[de] = decodeText(buf.slice(offset, offset + dataLen), encoding);
          offset += dataLen;
        }
      } else if (def.type === 'LLLVAR') {
        if (offset + 2 > buf.length) break;
        const dataLen = parseInt(bcdUnpack(buf.slice(offset, offset + 2), 4), 10);
        offset += 2;
        if (offset + dataLen > buf.length) break;
        fields[de] = def.binaryData
          ? buf.slice(offset, offset + dataLen).toString('hex').toUpperCase()
          : decodeText(buf.slice(offset, offset + dataLen), encoding);
        offset += dataLen;
      }
    }

    out.fields = fields;
    if (fields[39]) { out.responseCode = fields[39]; out.responseMsg = describeResponseCode(fields[39]); }
    if (fields[38]) out.authCode = fields[38];
    if (fields[37]) out.retrievalRef = fields[37];
  } catch (err) {
    out.parseError = err.message;
  }

  return out;
}

module.exports = {
  buildMessage,
  parseResponse,
  PROFILES,
  getProfile,
  FIELD_DEF,
  STD_FIELDS,
  ACCOUNT_TYPES,
  RESPONSE_CODES,
  bcdPack,
  bcdUnpack,
  describeResponseCode,
};
