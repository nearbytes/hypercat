'use strict'

const Hyperswarm = require('hyperswarm')
const { topicFromName, topicPreview } = require('./topic')
const { deriveKey } = require('./crypto')
const { pipePeer } = require('./pipe')
const { noopLogger } = require('./logger')

/**
 * Run hcat in client mode: look up a topic on the Hyperswarm DHT, connect to
 * the first peer announcing it, and pipe stdin/stdout. This is the
 * `hcat <topic>` side; it behaves like `nc <host> <port>`.
 *
 * @param {object} opts
 * @param {string} opts.name - Human-readable topic name.
 * @param {string} [opts.secret] - Shared passphrase for the extra encryption layer.
 * @param {number} [opts.timeoutMs=0] - Give up if no peer is found in this many
 *   milliseconds. 0 waits forever (like `nc` without `-w`).
 * @param {Array<{host:string,port:number}>} [opts.bootstrap] - Custom DHT
 *   bootstrap nodes (used by tests via a local testnet).
 * @param {import('stream').Readable} [opts.input=process.stdin]
 * @param {import('stream').Writable} [opts.output=process.stdout]
 * @param {object} [opts.log] - Logger ({ status, error, debug }).
 * @param {AbortSignal} [opts.signal] - Abort to shut down gracefully.
 * @returns {Promise<number>} Resolves to a process exit code.
 */
async function runClient (opts) {
  const {
    name,
    secret,
    timeoutMs = 0,
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

  let connected = false
  let timer = null
  let refreshTimer = null
  let cleaning = false
  const cleanup = async (code) => {
    if (cleaning) return
    cleaning = true
    if (timer) clearTimeout(timer)
    if (refreshTimer) clearInterval(refreshTimer)
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

  swarm.on('connection', (conn, info) => {
    if (connected) {
      conn.destroy()
      return
    }
    connected = true
    if (timer) { clearTimeout(timer); timer = null }
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
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

  const discovery = swarm.join(topic, { server: false, client: true })
  log.status(`Looking up topic: ${name} (${topicPreview(topic)})...`)

  // Wait for the initial round of discovery/connection attempts to settle.
  await swarm.flush()
  log.debug('Initial discovery flush complete.')

  // The server may not be announcing yet (or may restart later). Keep refreshing
  // the lookup until we connect, so order of startup doesn't matter.
  if (!connected) {
    refreshTimer = setInterval(() => {
      if (connected) return
      discovery.refresh({ client: true }).catch((err) => log.debug(`refresh error: ${err.message}`))
    }, 3000)
    if (typeof refreshTimer.unref === 'function') refreshTimer.unref()
  }

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      if (!connected) {
        log.error(`no peer found on topic "${name}" within ${timeoutMs / 1000}s`)
        cleanup(1)
      }
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
  }

  return done
}

module.exports = { runClient }
