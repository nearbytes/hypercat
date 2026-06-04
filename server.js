'use strict'

const Hyperswarm = require('hyperswarm')
const { topicFromName, topicPreview } = require('./topic')
const { deriveKey, createCipherPair } = require('./crypto')
const { pipePeer } = require('./pipe')
const { noopLogger } = require('./logger')

/**
 * Run hcat in server mode: announce a topic on the Hyperswarm DHT and serve
 * connecting peers. This is the `hcat -l <topic>` side; it behaves like
 * `nc -l <port>`.
 *
 * @param {object} opts
 * @param {string} opts.name - Human-readable topic name.
 * @param {boolean} [opts.keepOpen=false] - Keep serving after a peer leaves and
 *   accept many peers (broadcast hub). Like `nc -k`.
 * @param {string} [opts.secret] - Shared passphrase for the extra encryption layer.
 * @param {Array<{host:string,port:number}>} [opts.bootstrap] - Custom DHT
 *   bootstrap nodes (used by tests via a local testnet).
 * @param {import('stream').Readable} [opts.input=process.stdin]
 * @param {import('stream').Writable} [opts.output=process.stdout]
 * @param {object} [opts.log] - Logger ({ status, error, debug }).
 * @param {AbortSignal} [opts.signal] - Abort to shut down gracefully.
 * @returns {Promise<number>} Resolves to a process exit code.
 */
async function runServer (opts) {
  const {
    name,
    keepOpen = false,
    secret,
    bootstrap,
    input = process.stdin,
    output = process.stdout,
    log = noopLogger,
    signal
  } = opts

  const topic = topicFromName(name)
  const key = secret ? deriveKey(secret) : null
  const swarm = new Hyperswarm(bootstrap ? { bootstrap } : {})

  let resolveDone
  const done = new Promise((resolve) => { resolveDone = resolve })

  let cleaning = false
  const cleanup = async (code) => {
    if (cleaning) return
    cleaning = true
    try {
      await swarm.destroy()
    } catch (err) {
      log.debug(`swarm.destroy error: ${err.message}`)
    }
    resolveDone(code)
  }

  if (signal) {
    signal.addEventListener('abort', () => {
      log.status('\nShutting down.')
      cleanup(130)
    }, { once: true })
  }

  if (keepOpen) {
    // Broadcast hub: every peer's bytes go to our output, and our input is
    // fanned out live to every connected peer. We stay up until aborted.
    const writers = new Set()

    swarm.on('connection', (conn, info) => {
      log.status('Peer connected.')
      log.debug(`peer key: ${info.publicKey.toString('hex').slice(0, 12)}`)

      let writeTarget = conn
      if (key) {
        const { encryptor, decryptor } = createCipherPair(key)
        encryptor.pipe(conn)
        conn.pipe(decryptor).pipe(output, { end: false })
        decryptor.on('error', (err) => log.error(`decryption failed: ${err.message}`))
        writeTarget = encryptor
      } else {
        conn.pipe(output, { end: false })
      }

      writers.add(writeTarget)
      conn.on('error', (err) => log.debug(`peer error: ${err.message}`))
      conn.on('close', () => {
        writers.delete(writeTarget)
        log.status('Peer disconnected.')
      })
    })

    input.on('data', (chunk) => {
      for (const w of writers) w.write(chunk)
    })
  } else {
    // Single connection: serve the first peer, ignore the rest, exit on close.
    let accepted = false

    swarm.on('connection', (conn, info) => {
      if (accepted) {
        conn.destroy()
        return
      }
      accepted = true
      log.status('Peer connected.')
      log.debug(`peer key: ${info.publicKey.toString('hex').slice(0, 12)}`)

      pipePeer(conn, { input, output, key }).then((err) => {
        if (err) {
          log.error(err.message)
          cleanup(1)
        } else {
          log.status('Connection closed.')
          cleanup(0)
        }
      })
    })
  }

  const discovery = swarm.join(topic, { server: true, client: false })
  await discovery.flushed()

  log.status(`Announcing on topic: ${name} (${topicPreview(topic)})...`)
  log.status('Waiting for a peer to connect...')

  return done
}

module.exports = { runServer }
