// ============================================================================
//  ATM — lado host de las transacciones de cajero automático
//
//  Reconoce por código de procesamiento (DE 3):
//    01xxxx  retiro de efectivo      → exige PIN, valida denominación, saldo y límite diario
//    31xxxx  consulta de saldo       → exige PIN, devuelve saldos en DE 54
//  y sus reversos (MTI x4xx): total, o parcial por dispensado incompleto con el
//  monto realmente entregado en DE 95. El retiro original se ubica por el STAN
//  de DE 90 (posiciones 5-10) o, si no viene, por DE 11.
//
//  Simula el mensaje ISO 8583 que llega al host, no el protocolo del cajero
//  (NDC/DDC), que es propietario de cada fabricante.
// ============================================================================

'use strict';

const store = require('../switch-sim/atm-store');

const OPS = { '01': 'retiro', '31': 'consulta' };
const money = (n) => (n / 100).toFixed(2);

function applies(request) {
  const op = String(request.fields?.[3] || '').slice(0, 2);
  return op in OPS;
}

// DE 54: tipo de cuenta(2) + tipo de monto(2) + moneda(3) + signo(1) + monto(12)
function additionalAmounts(accountType, currency, balance) {
  const amt = (type) => `${accountType}${type}${currency}${balance < 0 ? 'D' : 'C'}${String(Math.abs(balance)).padStart(12, '0')}`;
  return amt('01') + amt('02');
}

function result(responseCode, id, desc, detail, extraFields = {}) {
  return {
    responseCode,
    matchedRule: { id, desc },
    fields: { 39: responseCode, ...extraFields },
    atm: detail,
  };
}

function process(request, cfg, { genAuthId }) {
  const f = request.fields || {};
  const pan = String(f[2] || '');
  const pc = String(f[3] || '');
  const op = pc.slice(0, 2);
  const accountType = pc.slice(2, 4) || '00';
  const currency = String(f[49] || '840').padStart(3, '0');
  const amount = parseInt(f[4] || '0', 10) || 0;
  const acct = store.getAccount(pan, cfg.balance);
  const balanceFields = () => ({ 54: additionalAmounts(accountType, currency, acct.balance) });
  const detail = (kind, extra = {}) => ({ op: OPS[op], kind, balance: acct.balance, withdrawnToday: acct.withdrawnToday, ...extra });

  if (String(request.mti || '')[1] === '4') return reversal();

  if (!f[52]) {
    return result('55', 'atm-pin-requerido', 'Cajero: el PIN (DE 52) es obligatorio', detail('rechazo'));
  }

  if (op === '31') {
    return result('00', 'atm-consulta', 'Cajero: consulta de saldo', detail('consulta'), { 38: genAuthId(), ...balanceFields() });
  }

  if (!amount || amount % cfg.noteUnit !== 0) {
    return result('13', 'atm-monto-invalido', `Cajero: el monto debe ser múltiplo de la denominación (${money(cfg.noteUnit)})`, detail('rechazo'));
  }
  if (amount > acct.balance) {
    return result('51', 'atm-fondos-insuficientes', 'Cajero: fondos insuficientes', detail('rechazo'));
  }
  if (acct.withdrawnToday + amount > cfg.dailyLimit) {
    return result('61', 'atm-limite-diario', `Cajero: excede el límite diario de retiro (${money(cfg.dailyLimit)})`, detail('rechazo'));
  }

  acct.balance -= amount;
  acct.withdrawnToday += amount;
  store.recordWithdrawal(pan, String(f[11] || ''), amount);
  return result('00', 'atm-retiro', 'Cajero: retiro aprobado', detail('retiro', { amount }), { 38: genAuthId(), ...balanceFields() });

  function reversal() {
    const originalStan = f[90] ? String(f[90]).slice(4, 10) : String(f[11] || '');
    const tx = store.findWithdrawal(pan, originalStan);
    if (!tx) {
      return result('25', 'atm-original-no-encontrada', `Cajero: no se encuentra el retiro original (STAN ${originalStan})`, detail('reverso-rechazado', { originalStan }));
    }
    if (tx.reversed) {
      return result('00', 'atm-reverso-duplicado', 'Cajero: reverso duplicado, ya aplicado (no se acredita de nuevo)', detail('reverso-duplicado', { originalStan, refunded: 0 }), balanceFields());
    }
    const dispensed = f[95] ? parseInt(String(f[95]).slice(0, 12), 10) || 0 : 0;
    if (dispensed > tx.amount) {
      return result('13', 'atm-dispensado-invalido', 'Cajero: el monto dispensado (DE 95) supera el retiro original', detail('reverso-rechazado', { originalStan }));
    }
    const refund = tx.amount - dispensed;
    acct.balance += refund;
    acct.withdrawnToday = Math.max(0, acct.withdrawnToday - refund);
    tx.reversed = true;
    tx.refunded = refund;
    const partial = dispensed > 0;
    return result(
      '00',
      partial ? 'atm-reverso-parcial' : 'atm-reverso-total',
      partial ? `Cajero: dispensado incompleto, se devuelve ${money(refund)}` : 'Cajero: reverso total del retiro',
      detail(partial ? 'reverso-parcial' : 'reverso-total', { originalStan, dispensed, refunded: refund }),
      balanceFields(),
    );
  }
}

module.exports = { applies, process, additionalAmounts };
