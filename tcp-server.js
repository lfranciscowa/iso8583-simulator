// ============================================================================
//  Servidor TCP — recibe transacciones ISO 8583 de cualquier plataforma.
//
//  Escucha en un puerto, acepta conexiones de hosts/clientes externos,
//  reensambla cada trama según el framing configurado, la procesa con el
//  engine (switch simulado) y devuelve la respuesta por el mismo socket.
//
//  Soporta payloads en ASCII o EBCDIC (auto-detectado o forzado por config).
// ============================================================================

'use strict';

const net = require('net');
const config = require('./config/default');
const { FrameReader, writePrefix } = require('./lib/framing');
const { processTransaction } = require('./lib/engine');

const listeners = new Set(); // callbacks para streaming a la UI (SSE)

function onTransaction(cb) { listeners.add(cb); return () => listeners.delete(cb); }
function emit(evt) { for (const cb of listeners) { try { cb(evt); } catch (_) {} } }

function start(opts = {}) {
  const cfg = { ...config, ...opts };
  const { host, port } = cfg.tcp;

  const server = net.createServer((socket) => {
    const peer = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`🔌 Conexión de ${peer}`);
    emit({ type: 'connect', peer, ts: Date.now() });

    const reader = new FrameReader(cfg.framing, async (payload) => {
      const t0 = Date.now();
      // En el cable viaja UN solo prefijo de longitud (LOTR, el del framing).
      // El parser interno espera el mensaje con su length de 2B BE al frente,
      // así que lo re-anteponemos al payload ya desenmarcado.
      const innerLen = Buffer.alloc(2);
      innerLen.writeUInt16BE(payload.length, 0);
      const result = await processTransaction(Buffer.concat([innerLen, payload]), {
        encoding: cfg.encoding,
        profile: cfg.profile,
        latencyMs: cfg.sim.latencyMs,
      });

      if (!result.ok) {
        console.error(`⚠️  ${peer} · error ${result.stage}: ${result.error}`);
        emit({ type: 'error', peer, stage: result.stage, error: result.error, ts: Date.now() });
        return;
      }

      // Responder también con UN solo prefijo: quitamos el length interno del
      // buffer construido y enmarcamos el cuerpo con el framing configurado.
      const respBody = result.response.buffer.slice(2);
      const frame = Buffer.concat([writePrefix(respBody.length, cfg.framing), respBody]);
      socket.write(frame);

      const rc = result.response.parsed.responseCode;
      console.log(`✅ ${peer} · ${result.encoding} · MTI ${result.request.parsed.mti}→${result.response.parsed.mti} · DE39=${rc} · ${Date.now() - t0}ms`);
      emit({
        type: 'transaction', peer, ts: Date.now(),
        encoding: result.encoding,
        reqMti: result.request.parsed.mti,
        respMti: result.response.parsed.mti,
        responseCode: rc,
        matchedRule: result.sim.matchedRule,
        elapsedMs: Date.now() - t0,
        request: result.request,
        response: { hex: result.response.hex, length: result.response.length, parsed: result.response.parsed },
      });
    });

    socket.on('data', (chunk) => reader.push(chunk));
    socket.on('error', (e) => { console.error(`❌ ${peer}: ${e.message}`); emit({ type: 'sock-error', peer, error: e.message }); });
    socket.on('close', () => { console.log(`🔌 ${peer} cerró`); emit({ type: 'disconnect', peer, ts: Date.now() }); });
  });

  server.listen(port, host, () => {
    console.log(`📡 Simulador TCP escuchando en ${host}:${port}`);
    console.log(`   encoding=${cfg.encoding} · framing=${cfg.framing.prefixBytes}b/${cfg.framing.prefixEncoding}`);
  });

  return server;
}

module.exports = { start, onTransaction };

// Permite ejecutarlo standalone: `node tcp-server.js`
if (require.main === module) start();
