// ============================================================================
//  Enlace de transacciones — Mastercard TLID (DE105) / Visa Transaction ID (DE62)
//
//  Aproximación didáctica basada en información pública de los mandatos:
//   - Mastercard: TLID de 22 caracteres en DE105. Desde el 23-oct-2026 el
//     comercio debe reenviar el TLID guardado en toda transacción relacionada
//     (recurrentes, cuotas, credencial guardada); reversos y devoluciones
//     también lo llevan.
//   - Visa: Transaction ID de 15 dígitos (DE62.2) que se captura en la
//     transacción inicial y se reenvía en las posteriores.
//  El formato exacto de sub-elementos de cada marca es confidencial: aquí el
//  identificador viaja como el valor completo del campo.
// ============================================================================

'use strict';

const crypto = require('crypto');
const store  = require('../switch-sim/lifecycle-store');

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const NETWORKS = {
  mastercard: {
    field: 105,
    label: 'TLID',
    pattern: /^[A-Z0-9]{22}$/,
    generate: () => Array.from(crypto.randomBytes(22), (b) => ALNUM[b % ALNUM.length]).join(''),
  },
  visa: {
    field: 62,
    label: 'Transaction ID',
    pattern: /^\d{15}$/,
    generate: () => Array.from(crypto.randomBytes(15), (b) => String(b % 10)).join(''),
  },
};

function classify(request) {
  const f = request.fields || {};
  if (String(request.mti || '')[1] === '4') return 'reversal';
  if (String(f[3] || '').startsWith('20')) return 'refund';
  if (String(f[22] || '').startsWith('10')) return 'cof';
  return 'purchase';
}

const KIND_LABEL = {
  reversal: 'reverso',
  refund: 'devolución',
  cof: 'cobro con credencial guardada',
  purchase: 'compra',
};

function evaluate(request, profileId, cfg = {}) {
  const net = NETWORKS[profileId];
  const mode = cfg.mode || 'warn';
  if (mode === 'off' || !net) return { applicable: false };

  const fields = request.fields || {};
  const pan = String(fields[2] || '');
  const raw = fields[net.field];
  const linkIn = raw === undefined || raw === '' ? null : String(raw).trim().toUpperCase();
  const kind = classify(request);
  const findings = [];
  let known = null;

  if (linkIn) {
    if (!net.pattern.test(linkIn)) {
      findings.push({ level: 'error', code: 'LINK_FORMAT', msg: `${net.label} en DE${net.field} con formato inválido: "${linkIn}"` });
    } else {
      known = store.get(linkIn);
      if (!known) {
        findings.push({ level: 'error', code: 'LINK_UNKNOWN', msg: `${net.label} ${linkIn} no fue emitido por este switch` });
      } else if (known.panHash !== store.panHash(pan)) {
        findings.push({ level: 'error', code: 'LINK_PAN_MISMATCH', msg: `${net.label} ${linkIn} pertenece a otra tarjeta` });
        known = null;
      }
    }
  }

  const priorHistory = kind === 'cof' && store.hasHistoryForPan(pan, profileId);
  const needsLink = kind === 'reversal' || kind === 'refund' || priorHistory;

  if (needsLink && !linkIn) {
    findings.push({
      level: 'error',
      code: 'LINK_MISSING',
      msg: `Falta el ${net.label} en DE${net.field}: un ${KIND_LABEL[kind]} debe reenviar el identificador de la transacción original`,
    });
  }
  if (kind === 'cof' && !linkIn && !priorHistory) {
    findings.push({
      level: 'info',
      code: 'LINK_INITIAL',
      msg: `Primera transacción con credencial guardada: el switch emite el ${net.label} y el comercio debe guardarlo para los cobros siguientes`,
    });
  }

  return {
    applicable: true,
    mode,
    network: profileId,
    field: net.field,
    label: net.label,
    kind,
    linkIn,
    known: !!known,
    findings,
    violation: findings.some((x) => x.level === 'error'),
  };
}

// Completa la respuesta: reenvía el identificador conocido o emite uno nuevo
// cuando la transacción es una compra/credencial guardada aprobada.
function finalize(evaluation, request, responseFields) {
  if (!evaluation || !evaluation.applicable) return evaluation;
  const net = NETWORKS[evaluation.network];

  if (evaluation.known) {
    responseFields[net.field] = evaluation.linkIn;
    return evaluation;
  }

  const approved = responseFields[39] === '00';
  const issuable = evaluation.kind === 'purchase' || evaluation.kind === 'cof';
  if (approved && issuable && !evaluation.violation) {
    const linkId = net.generate();
    const f = request.fields || {};
    store.add({ network: evaluation.network, linkId, pan: f[2], mti: request.mti, stan: f[11], amount: f[4] });
    responseFields[net.field] = linkId;
    evaluation.issued = linkId;
  }
  return evaluation;
}

module.exports = { evaluate, finalize, classify, NETWORKS };
