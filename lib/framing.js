// ============================================================================
//  Framing — manejo del prefijo de longitud en el stream TCP.
//
//  Las tramas ISO 8583 viajan sobre TCP precedidas por un prefijo que indica
//  la longitud del mensaje. El formato varía por plataforma; este módulo lo
//  hace configurable (tamaño, codificación, si se incluye a sí mismo).
// ============================================================================

'use strict';

// Lee la longitud declarada del prefijo de `buf` según la config de framing.
function readPrefixLength(buf, framing) {
  const { prefixBytes, prefixEncoding } = framing;
  if (buf.length < prefixBytes) return null;

  let len;
  if (prefixEncoding === 'binary') {
    len = prefixBytes === 2 ? buf.readUInt16BE(0)
        : prefixBytes === 4 ? buf.readUInt32BE(0)
        : buf.readUIntBE(0, prefixBytes);
  } else if (prefixEncoding === 'bcd') {
    len = parseInt(buf.slice(0, prefixBytes).toString('hex'), 10);
  } else { // ascii
    len = parseInt(buf.slice(0, prefixBytes).toString('ascii'), 10);
  }

  if (framing.prefixIncludesSelf) len -= prefixBytes;
  return len;
}

// Construye el buffer del prefijo para un payload de longitud `payloadLen`.
function writePrefix(payloadLen, framing) {
  const { prefixBytes, prefixEncoding, prefixIncludesSelf } = framing;
  const declared = prefixIncludesSelf ? payloadLen + prefixBytes : payloadLen;

  if (prefixEncoding === 'binary') {
    const b = Buffer.alloc(prefixBytes);
    b.writeUIntBE(declared, 0, prefixBytes);
    return b;
  } else if (prefixEncoding === 'bcd') {
    const hex = String(declared).padStart(prefixBytes * 2, '0');
    return Buffer.from(hex, 'hex');
  } else { // ascii
    return Buffer.from(String(declared).padStart(prefixBytes, '0'), 'ascii');
  }
}

// ----------------------------------------------------------------------------
// FrameReader — acumula chunks TCP y emite mensajes completos.
//   onMessage(payloadBuffer)  se llama por cada trama completa (sin prefijo).
// ----------------------------------------------------------------------------
class FrameReader {
  constructor(framing, onMessage) {
    this.framing = framing;
    this.onMessage = onMessage;
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let guard = 0;
    while (guard++ < 1000) {
      const len = readPrefixLength(this.buffer, this.framing);
      if (len === null) break;                       // falta el prefijo completo
      const total = this.framing.prefixBytes + len;
      if (this.buffer.length < total) break;          // falta payload
      const payload = this.buffer.slice(this.framing.prefixBytes, total);
      this.buffer = this.buffer.slice(total);
      this.onMessage(payload);
    }
  }
}

module.exports = { readPrefixLength, writePrefix, FrameReader };
