// ============================================================================
//  ATM STORE — cuentas y retiros simulados del cajero automático
//
//  En memoria: cada tarjeta tiene saldo y acumulado de retiros del día.
//  Los retiros aprobados se guardan para poder aplicar reversos (totales o
//  por dispensado incompleto) sin devolver el dinero dos veces.
//  El PAN se indexa por hash SHA-256; solo se conserva la versión enmascarada.
// ============================================================================

'use strict';

const crypto = require('crypto');
const { maskPan } = require('../lib/mask');

const MAX_WITHDRAWALS = 5000;

const accounts = new Map();
const withdrawals = new Map();

const panHash = (pan) => crypto.createHash('sha256').update(String(pan || '')).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

function getAccount(pan, initialBalance) {
  const hash = panHash(pan);
  let acct = accounts.get(hash);
  if (!acct) {
    acct = { panMasked: maskPan(String(pan || '')), balance: initialBalance, withdrawnToday: 0, day: today() };
    accounts.set(hash, acct);
  }
  if (acct.day !== today()) {
    acct.day = today();
    acct.withdrawnToday = 0;
  }
  return acct;
}

function recordWithdrawal(pan, stan, amount) {
  const key = `${panHash(pan)}:${stan}`;
  withdrawals.set(key, { amount, reversed: false, refunded: 0, createdAt: new Date().toISOString() });
  if (withdrawals.size > MAX_WITHDRAWALS) withdrawals.delete(withdrawals.keys().next().value);
}

function findWithdrawal(pan, stan) {
  return withdrawals.get(`${panHash(pan)}:${stan}`) || null;
}

function list() {
  return [...accounts.values()].map((a) => ({ ...a }));
}

function reset() {
  accounts.clear();
  withdrawals.clear();
}

module.exports = { getAccount, recordWithdrawal, findWithdrawal, list, reset };
