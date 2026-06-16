// ============================================================================
//  MASK — enmascaramiento de PAN según PCI-DSS (primeros 6 + últimos 4).
// ============================================================================

'use strict';

function maskPan(pan) {
  const s = String(pan || '');
  if (s.includes('*')) return s;   // ya enmascarado: idempotente
  const digits = s.replace(/\D/g, '');
  if (digits.length < 10) return digits.replace(/./g, '*');
  const first6 = digits.slice(0, 6);
  const last4 = digits.slice(-4);
  const middle = '*'.repeat(digits.length - 10);
  return `${first6}${middle}${last4}`;
}

// Enmascara DE2 (PAN) dentro de un objeto `fields` de un mensaje parseado.
function maskFields(fields) {
  if (!fields || typeof fields !== 'object') return fields;
  const out = { ...fields };
  if (out[2]) out[2] = maskPan(out[2]);
  return out;
}

// Enmascara recursivamente cualquier `fields[2]` dentro de request/response.
function maskHistoryEntry(entry) {
  const out = { ...entry };
  if (out.request?.parsed?.fields) out.request = { ...out.request, parsed: { ...out.request.parsed, fields: maskFields(out.request.parsed.fields) } };
  if (out.response?.parsed?.fields) out.response = { ...out.response, parsed: { ...out.response.parsed, fields: maskFields(out.response.parsed.fields) } };
  return out;
}

module.exports = { maskPan, maskFields, maskHistoryEntry };
