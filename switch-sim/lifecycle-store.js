// ============================================================================
//  LIFECYCLE STORE — identificadores de enlace emitidos por el switch simulado
//
//  Guarda en memoria los TLID (Mastercard) y Transaction ID (Visa) generados
//  en autorizaciones aprobadas, para validar que las transacciones posteriores
//  (reversos, devoluciones, cobros con tarjeta guardada) los reenvíen.
//
//  El PAN nunca se guarda en claro: se indexa por hash SHA-256 y solo se
//  conserva la versión enmascarada para mostrar.
// ============================================================================

'use strict';

const crypto = require('crypto');
const { maskPan } = require('../lib/mask');

const MAX_RECORDS = 5000;

const byLinkId = new Map();
const byPanHash = new Map();

function panHash(pan) {
  return crypto.createHash('sha256').update(String(pan || '')).digest('hex');
}

function add({ network, linkId, pan, mti, stan, amount }) {
  const hash = panHash(pan);
  const record = {
    network,
    linkId,
    panHash: hash,
    panMasked: maskPan(String(pan || '')),
    mti,
    stan: stan || null,
    amount: amount || null,
    createdAt: new Date().toISOString(),
  };
  byLinkId.set(linkId, record);
  if (!byPanHash.has(hash)) byPanHash.set(hash, []);
  byPanHash.get(hash).push(record);

  if (byLinkId.size > MAX_RECORDS) {
    const oldest = byLinkId.keys().next().value;
    remove(oldest);
  }
  return record;
}

function remove(linkId) {
  const record = byLinkId.get(linkId);
  if (!record) return;
  byLinkId.delete(linkId);
  const list = byPanHash.get(record.panHash) || [];
  const rest = list.filter((r) => r.linkId !== linkId);
  if (rest.length) byPanHash.set(record.panHash, rest);
  else byPanHash.delete(record.panHash);
}

function get(linkId) {
  return byLinkId.get(linkId) || null;
}

function hasHistoryForPan(pan, network) {
  const list = byPanHash.get(panHash(pan)) || [];
  return list.some((r) => r.network === network);
}

function list() {
  return [...byLinkId.values()]
    .reverse()
    .map(({ panHash: _omit, ...pub }) => pub);
}

function reset() {
  byLinkId.clear();
  byPanHash.clear();
}

module.exports = { add, get, hasHistoryForPan, list, reset, panHash };
