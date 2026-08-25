'use strict';

/** Lightweight TCP/TLS reachability probe used by admin connectivity tests. */

const net = require('net');
const tls = require('tls');

function probe({ host, port, tls: useTls, timeout = 8000 }) {
  return new Promise((resolve) => {
    const start = Date.now();
    const onDone = (ok, error) => {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve({ ok, latencyMs: Date.now() - start, error: error || null });
    };

    const opts = { host, port, timeout };
    const socket = useTls
      ? tls.connect({ ...opts, rejectUnauthorized: false }, () => onDone(true))
      : net.connect(opts, () => onDone(true));

    socket.on('timeout', () => onDone(false, 'Connection timed out'));
    socket.on('error', (err) => onDone(false, err.message));
  });
}

module.exports = { probe };
