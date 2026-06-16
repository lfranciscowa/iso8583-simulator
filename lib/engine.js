// ============================================================================
//  Engine — núcleo de procesamiento de una transacción.
//
//  Toma una trama entrante (request), la parsea, la pasa por el switch
//  simulado y construye la respuesta. Es independiente del transporte:
//  lo usan tanto el servidor TCP como la API HTTP.
// ============================================================================

'use strict';

const iso8583    = require('./iso8583');
const ebcdic     = require('./ebcdic');
const mockSwitch = require('../switch-sim/mock-switch');

// MTI de respuesta = MTI de request + 10 (0200→0210, 0800→0810)
function responseMti(requestMti) {
  const n = parseInt(requestMti, 10);
  if (Number.isNaN(n)) return requestMti;
  return String(n + 10).padStart(4, '0');
}

// Resuelve el encoding efectivo: 'auto' detecta en la trama entrante.
function resolveEncoding(configured, payload, profileArg) {
  if (configured === 'auto') {
    const profile = iso8583.getProfile(profileArg);
    const headerLen = Buffer.from(profile.headerHex || '', 'hex').length;
    const dataStart = 2 + headerLen + (profile.mtiEnc === 'ascii' ? 4 : 2) + 8;
    return ebcdic.looksLikeEbcdic(payload.slice(dataStart)) ? 'ebcdic' : 'ascii';
  }
  return configured;
}

// ----------------------------------------------------------------------------
// processTransaction(payload, opts)
//   payload: Buffer de la trama (con LOTR/TPDU como espera iso8583)
//   opts: { encoding, rules, latencyMs }
//
// Devuelve { ok, encoding, request, response, sim } o { ok:false, error }
// ----------------------------------------------------------------------------
async function processTransaction(payload, opts = {}) {
  const profile  = opts.profile || 'generic';
  const encoding = resolveEncoding(opts.encoding || 'ascii', payload, profile);

  let requestParsed;
  try {
    requestParsed = iso8583.parseResponse(payload, encoding, profile);
  } catch (err) {
    return { ok: false, stage: 'parse-request', error: err.message };
  }
  if (requestParsed.error) {
    return { ok: false, stage: 'parse-request', error: requestParsed.error };
  }

  let simResult;
  try {
    simResult = await mockSwitch.process(requestParsed, { rules: opts.rules, latencyMs: opts.latencyMs });
  } catch (err) {
    return { ok: false, stage: 'switch-sim', error: err.message };
  }

  let responseBuf, responseParsed;
  try {
    const respFields = { ...simResult.fields };
    // Eco de campos de correlación que el host real refleja
    for (const de of [3, 11, 41, 42]) {
      if (requestParsed.fields?.[de] !== undefined) respFields[de] = requestParsed.fields[de];
    }
    responseBuf = iso8583.buildMessage({
      mti: responseMti(requestParsed.mti),
      fields: respFields,
      encoding,
      profile,
    });
    responseParsed = iso8583.parseResponse(responseBuf, encoding, profile);
  } catch (err) {
    return { ok: false, stage: 'build-response', error: err.message };
  }

  return {
    ok: true,
    encoding,
    profile,
    request:  { hex: payload.toString('hex').toUpperCase(), length: payload.length, parsed: requestParsed },
    response: { hex: responseBuf.toString('hex').toUpperCase(), length: responseBuf.length, parsed: responseParsed, buffer: responseBuf },
    sim: { matchedRule: simResult.matchedRule, latencyMs: simResult.latencyMs },
  };
}

module.exports = { processTransaction, responseMti, resolveEncoding };
