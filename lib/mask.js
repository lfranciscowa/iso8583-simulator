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

// Enmascara Track 2 (DE35): PAN[=|D]expiry+service+discrecional.
// El PAN se enmascara y TODO lo posterior al separador se oculta (lleva
// fecha de expiración, código de servicio y datos discrecionales/PVV/CVV).
function maskTrack2(t2) {
  const s = String(t2 || '');
  if (s.includes('*')) return s;
  const m = s.match(/^(\d+)([=D])(.*)$/i);
  if (!m) return maskPan(s);
  return `${maskPan(m[1])}${m[2]}${'*'.repeat(m[3].length)}`;
}

// Enmascara Track 1 (DE45): oculta cualquier secuencia larga de dígitos (PAN)
// y los datos discrecionales tras el último separador.
function maskTrack1(t1) {
  const s = String(t1 || '');
  if (s.includes('*')) return s;
  // Formato: %B<PAN>^NOMBRE^<expiry><service><discrecional>
  const m = s.match(/^(%?B?)(\d{10,19})(\^[^^]*\^)(.*)$/i);
  if (m) return `${m[1]}${maskPan(m[2])}${m[3]}${'*'.repeat(m[4].length)}`;
  return s.replace(/\d{10,19}/g, d => maskPan(d));
}

// Enmascara DE2 (PAN) y demás campos sensibles dentro de un objeto `fields`.
function maskFields(fields) {
  if (!fields || typeof fields !== 'object') return fields;
  const out = { ...fields };
  if (out[2])  out[2]  = maskPan(out[2]);       // PAN
  if (out[14]) out[14] = '****';                 // fecha de expiración
  if (out[35]) out[35] = maskTrack2(out[35]);    // Track 2
  if (out[45]) out[45] = maskTrack1(out[45]);    // Track 1
  if (out[52]) out[52] = '****';                 // PIN block
  return out;
}

// Enmascara recursivamente cualquier `fields[2]` dentro de request/response.
function maskHistoryEntry(entry) {
  const out = { ...entry };
  if (out.request?.parsed?.fields) out.request = { ...out.request, parsed: { ...out.request.parsed, fields: maskFields(out.request.parsed.fields) } };
  if (out.response?.parsed?.fields) out.response = { ...out.response, parsed: { ...out.response.parsed, fields: maskFields(out.response.parsed.fields) } };
  return out;
}

module.exports = { maskPan, maskTrack2, maskTrack1, maskFields, maskHistoryEntry };
