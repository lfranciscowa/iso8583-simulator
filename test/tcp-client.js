// Cliente de prueba: simula una plataforma externa conectándose al simulador.
'use strict';
const net = require('net');
const iso = require('../lib/iso8583');
const { writePrefix, readPrefixLength } = require('../lib/framing');

const framing = { prefixBytes: 2, prefixEncoding: 'binary', prefixIncludesSelf: false };
const encoding = process.argv[2] || 'ascii';
const amount   = process.argv[3] || '000000015000';

const fields = { 2:'4111111111111111', 3:'000000', 4:amount, 11:'000123', 41:'TERM0001', 42:'MERCH00000001' };
const reqBuf = iso.buildMessage({ mti:'0200', fields, encoding });
const frame  = Buffer.concat([writePrefix(reqBuf.length, framing), reqBuf]);

const sock = net.connect(8583, '127.0.0.1', () => sock.write(frame));
let acc = Buffer.alloc(0);
sock.on('data', (c) => {
  acc = Buffer.concat([acc, c]);
  const len = readPrefixLength(acc, framing);
  if (len !== null && acc.length >= 2 + len) {
    const payload = acc.slice(2, 2 + len);
    const p = iso.parseResponse(payload, encoding);
    console.log(`[${encoding}] respuesta MTI=${p.mti} DE39=${p.responseCode} (${p.responseMsg}) DE38=${p.authCode||'-'} DE41=${JSON.stringify(p.fields[41])}`);
    sock.end();
  }
});
sock.on('error', (e) => { console.error('client error', e.message); process.exit(1); });
