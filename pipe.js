'use strict'

const { createCipherPair } = require('./crypto')

/**
 * Wire a duplex peer connection to a local input/output pair, exactly like
 * netcat wires a socket to stdin/stdout.
 *
 * Semantics (chosen to match `nc` as closely as possible):
 *   - local input  -> peer   (what we type/pipe in is sent)
 *   - peer         -> output (what the peer sends is written out)
 *   - When local input reaches EOF we half-close the write side so the peer
 *     observes EOF but can keep sending.
 *   - When the peer finishes sending (read side ends) we end our write side too,
 *     so the connection tears down cleanly in both directions (no RST).
 *   - We never call .end() on `output` (it may be process.stdout, which must not
 *     be closed); we resolve once the connection is fully closed.
 *
 * All data stays as Buffers end-to-end, so binary streams pass through untouched.
 *
 * @param {import('stream').Duplex} conn - Peer connection (already Noise-encrypted).
 * @param {object} opts
 * @param {import('stream').Readable} opts.input - Local input (e.g. process.stdin).
 * @param {import('stream').Writable} opts.output - Local output (e.g. process.stdout).
 * @param {Buffer} [opts.key] - Optional AES key enabling the extra encryption layer.
 * @returns {Promise<Error|null>} Resolves to a fatal error (e.g. bad secret) or
 *   null on a clean close. Transport resets after the peer leaves are not fatal.
 */
function pipePeer (conn, { input, output, key }) {
  return new Promise((resolve) => {
    let settled = false
    let fatal = null

    const finish = () => {
      if (settled) return
      settled = true
      // Stop forwarding local input into a dead connection.
      input.unpipe()
      resolve(fatal)
    }

    // Mirror the peer's EOF: once it stops sending, close our write side so the
    // socket can shut down gracefully instead of being reset on swarm teardown.
    conn.on('end', () => { if (conn.writable && !conn.writableEnded) conn.end() })

    // A transport error after the peer has gone (reset/closed) is expected and
    // not a failure of *this* program; let `close` resolve us with no error.
    conn.on('error', () => finish())
    conn.on('close', finish)

    if (key) {
      const { encryptor, decryptor } = createCipherPair(key)
      const onCryptoError = (err) => { fatal = err; conn.destroy() }

      input.pipe(encryptor).pipe(conn)
      encryptor.on('error', onCryptoError)
      decryptor.on('error', onCryptoError)
      conn.pipe(decryptor).pipe(output, { end: false })
    } else {
      input.pipe(conn)
      conn.pipe(output, { end: false })
    }
  })
}

module.exports = { pipePeer }
