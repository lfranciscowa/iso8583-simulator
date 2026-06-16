// Suite de validación rápida (sin dependencias de testing).
'use strict';
const assert = require('assert');
const iso = require('../lib/iso8583');
const ebcdic = require('../lib/ebcdic');
const { processTransaction } = require('../lib/engine');
const { writePrefix, readPrefixLength, FrameReader } = require('../lib/framing');

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  console.log('  ✅', name);
  passed++;
}

(async () => {
  console.log('EBCDIC codec');
  ok('dígitos 0-9', ebcdic.asciiToEbcdic('0123456789').toString('hex').toUpperCase() === 'F0F1F2F3F4F5F6F7F8F9');
  ok('roundtrip texto', ebcdic.ebcdicToAscii(ebcdic.asciiToEbcdic('Hello 123')) === 'Hello 123');

  console.log('ISO 8583 build/parse');
  for (const enc of ['ascii', 'ebcdic']) {
    const buf = iso.buildMessage({ mti: '0210', fields: { 39: '00', 41: 'TERM0001' }, encoding: enc });
    const p = iso.parseResponse(buf, enc);
    ok(`${enc} roundtrip DE41`, p.fields[41] === 'TERM0001');
    ok(`${enc} roundtrip DE39`, p.fields[39] === '00');
  }

  console.log('Perfiles de red');
  for (const prof of ['generic', 'visa', 'mastercard']) {
    const buf = iso.buildMessage({ mti: '0100', fields: { 2: '4111111111111111', 4: '000000015000', 49: '840' }, encoding: 'ascii', profile: prof });
    const p = iso.parseResponse(buf, 'ascii', prof);
    ok(`${prof} roundtrip DE2/DE4/DE49`, p.fields[2] === '4111111111111111' && p.fields[4] === '000000015000' && p.fields[49] === '840');
  }
  const visaTx = await processTransaction(iso.buildMessage({ mti: '0100', fields: { 2: '4111111111111111', 4: '000000010000', 11: '000001' }, encoding: 'ascii', profile: 'visa' }), { encoding: 'ascii', profile: 'visa' });
  ok('visa 0100→0110 aprobada', visaTx.ok && visaTx.response.parsed.mti === '0110' && visaTx.response.parsed.responseCode === '00');

  console.log('Framing');
  ok('prefix binary 2b', readPrefixLength(writePrefix(100, { prefixBytes: 2, prefixEncoding: 'binary', prefixIncludesSelf: false }), { prefixBytes: 2, prefixEncoding: 'binary', prefixIncludesSelf: false }) === 100);
  ok('prefix ascii 4b', readPrefixLength(writePrefix(250, { prefixBytes: 4, prefixEncoding: 'ascii', prefixIncludesSelf: false }), { prefixBytes: 4, prefixEncoding: 'ascii', prefixIncludesSelf: false }) === 250);

  console.log('FrameReader (mensajes fragmentados)');
  const fr = []; const reader = new FrameReader({ prefixBytes: 2, prefixEncoding: 'binary', prefixIncludesSelf: false }, (m) => fr.push(m));
  const msg = iso.buildMessage({ mti: '0200', fields: { 39: '00' }, encoding: 'ascii' });
  const full = Buffer.concat([writePrefix(msg.length, { prefixBytes: 2, prefixEncoding: 'binary', prefixIncludesSelf: false }), msg]);
  reader.push(full.slice(0, 3)); reader.push(full.slice(3)); // fragmentado
  ok('reensambla 1 mensaje', fr.length === 1 && fr[0].length === msg.length);

  console.log('Engine (switch simulado)');
  const approved = await processTransaction(iso.buildMessage({ mti: '0200', fields: { 2: '4111111111111111', 4: '000000010000', 11: '000001' }, encoding: 'ascii' }), { encoding: 'ascii' });
  ok('aprobada DE39=00', approved.ok && approved.response.parsed.responseCode === '00');
  const denied = await processTransaction(iso.buildMessage({ mti: '0200', fields: { 2: '4111111111111111', 4: '000000200000', 11: '000002' }, encoding: 'ascii' }), { encoding: 'ascii' });
  ok('fondos insuf DE39=51', denied.ok && denied.response.parsed.responseCode === '51');

  console.log('Criptografía (3DES / PIN block ISO 9564)');
  const crypto8583 = require('../lib/crypto8583');
  const zpk = '0123456789ABCDEFFEDCBA9876543210';
  ok('KCV determinístico', crypto8583.kcv(zpk) === '08D7B4');
  for (const fmt of ['0', '1', '3']) {
    const e = crypto8583.encryptPin('1234', '4111113054813216', zpk, fmt);
    const d = crypto8583.decryptPin(e.encryptedPinBlock, '4111113054813216', zpk, fmt);
    ok(`PIN block F${fmt} cifra/descifra`, d.pin === '1234');
  }
  ok('verify PIN correcto', crypto8583.verifyPin(crypto8583.encryptPin('5678', '4111113054813216', zpk, '0').encryptedPinBlock, '4111113054813216', zpk, '5678', '0').ok === true);
  ok('verify PIN incorrecto', crypto8583.verifyPin(crypto8583.encryptPin('5678', '4111113054813216', zpk, '0').encryptedPinBlock, '4111113054813216', zpk, '0000', '0').ok === false);

  console.log('MAC (Retail MAC / ISO 9797-1 Alg 3)');
  const macData = '0200723A00000000000000001234000000015000';
  const mac1 = crypto8583.computeRetailMAC(macData, zpk);
  ok('MAC 8 bytes', mac1.length === 16);
  ok('MAC determinístico', mac1 === crypto8583.computeRetailMAC(macData, zpk));
  ok('MAC cambia con la data', mac1 !== crypto8583.computeRetailMAC(macData.slice(0, -1) + '1', zpk));
  ok('verify MAC correcto', crypto8583.verifyRetailMAC(macData, mac1, zpk).ok === true);
  ok('verify MAC alterado', crypto8583.verifyRetailMAC(macData, mac1.slice(0, -2) + '00', zpk).ok === false);

  console.log(`\n✅ ${passed} pruebas OK`);
})().catch((e) => { console.error('\n❌ FALLO:', e.message); process.exit(1); });
