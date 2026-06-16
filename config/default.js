// ============================================================================
//  Configuración del simulador ISO 8583
//
//  Todo es sobrescribible por variables de entorno para que el simulador se
//  pueda conectar a cualquier plataforma sin tocar código.
// ============================================================================

'use strict';

module.exports = {
  // --- Servidor TCP (recibe transacciones de cualquier cliente/host) ---
  tcp: {
    host: process.env.SIM_TCP_HOST || '0.0.0.0',
    port: parseInt(process.env.SIM_TCP_PORT || '8583', 10),
  },

  // --- API HTTP + UI web ---
  http: {
    port: parseInt(process.env.PORT || '4100', 10),
  },

  // --- Encoding de los campos de texto de la trama ---
  //   'ascii'  : campos an/ans en ASCII
  //   'ebcdic' : campos an/ans en EBCDIC (CP037)
  //   'auto'   : detectar automáticamente en cada trama entrante
  encoding: process.env.SIM_ENCODING || 'auto',

  // --- Perfil de red: 'generic' | 'visa' | 'mastercard' ---
  profile: process.env.SIM_PROFILE || 'generic',

  // --- Framing: cómo viene delimitada la trama en el stream TCP ---
  //   prefixBytes: tamaño del prefijo de longitud (2 = más común)
  //   prefixIncludesSelf: si la longitud declarada incluye los propios
  //                       bytes del prefijo
  //   prefixEncoding: 'binary' (big-endian) | 'bcd' | 'ascii'
  framing: {
    prefixBytes: parseInt(process.env.SIM_PREFIX_BYTES || '2', 10),
    prefixIncludesSelf: process.env.SIM_PREFIX_INCLUDES_SELF === 'true',
    prefixEncoding: process.env.SIM_PREFIX_ENCODING || 'binary',
  },

  // --- Comportamiento del switch simulado ---
  sim: {
    // Latencia fija en ms; si es null se usa latencia aleatoria realista
    latencyMs: process.env.SIM_LATENCY_MS ? parseInt(process.env.SIM_LATENCY_MS, 10) : null,
  },

  // --- Validación de PIN (DE52) ---
  //  Solo se aplica si la trama TRAE DE52. Sin DE52, el flujo es idéntico
  //  al actual (no se valida PIN). Con DE52, el switch descifra el PIN block
  //  con la TPK indicada y lo compara contra el PIN esperado:
  //    - PIN correcto   → sigue el flujo normal de reglas (puede aprobar).
  //    - PIN incorrecto → DE39 = 55 (PIN incorrecto).
  //    - no se puede descifrar (llave/PAN mal) → DE39 = 55.
  pin: {
    validate: process.env.SIM_PIN_VALIDATE !== 'false',   // default: validar si llega DE52
    expected: process.env.SIM_PIN_EXPECTED || '1234',     // PIN "correcto" de laboratorio
    keyId:    process.env.SIM_PIN_KEY_ID  || 'tpk-demo',  // TPK con la que el POS cifró
    format:   process.env.SIM_PIN_FORMAT  || '0',         // ISO 9564-1 formato 0
  },
};
