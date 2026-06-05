'use strict'

const Hyperswarm = require('hyperswarm')
const { topicFromName, topicPreview } = require('./topic')
const { deriveKey, createCipherPair } = require('./crypto')
const { pipePeer } = require('./pipe')
const { noopLogger } = require('./logger')
const { logSessionDetails, attachSwarmDiagnostics } = require('./debug')

/**
 * Run hcat in symmetric mode: both sides run the SAME command
 * (`hcat -s <topic>`) and rendezvous as equals, in the spirit of
 * [hyperbeam](https://github.com/holepunchto/hyperbeam). There is no
 * server/client distinction — each peer both announces the topic and looks it
 * up (`swarm.join(topic, { server: true, client: true })`), so whoever starts
 * first simply waits for the other and order never matters.
 *
 * Apart from that symmetry it behaves exactly like the rest of hcat: it pipes
 * stdin/stdout to the first peer, honours `--encrypt`, and supports `--keep-open`
 * as a many-peer broadcast hub.
 *
 * @param {object} opts
 * @param {string} opts.name - Human-readable topic name.
 * @param {boolean} [opts.keepOpen=false] - Keep serving after a peer leaves and
 *   accept many peers (broadcast hub). Like `nc -k`.
 * @param {string} [opts.secret] - Shared passphrase for the extra encryption layer.
 * @param {number} [opts.timeoutMs=0] - Give up if no peer is found in this many
 *   milliseconds. 0 waits forever. Ignored with `keepOpen`.
 * @param {Array<{host:string,port:number}>} [opts.bootstrap] - Custom DHT
 *   bootstrap nodes (used by tests via a local testnet).
 * @param {import('stream').Readable} [opts.input=process.stdin]
 * @param {import('stream').Writable} [opts.output=process.stdout]
 * @param {object} [opts.log] - Logger ({ status, error, debug }).
 * @param {AbortSignal} [opts.signal] - Abort to shut down gracefully.
 * @returns {Promise<number>} Resolves to a process exit code.
 */
async function runSymmetric (opts) {
  const {
    name,
    keepOpen = false,
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
  logSessionDetails(log, { role: 'symmetric', name, topic, secret })
  attachSwarmDiagnostics(swarm, log)

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
    // Single connection: pair with one peer, exit when that session closes.
    //
    // Symmetry has a cost: when two peers join at the same instant, both dial
    // each other, and Hyperswarm's dedup briefly emits a "loser" connection that
    // is torn down within milliseconds before the surviving connection arrives.
    // If we committed (and piped stdin) to that first connection we'd exit on a
    // dead socket and never see the survivor. So we treat a freshly emitted
    // connection only as a *candidate*: we wait a short settle window, discard it
    // if it dies in the meantime (and keep waiting), and only commit — wiring up
    // stdin/stdout — once it has proven stable. Late extra peers are dropped.
    const SETTLE_MS = 800
    let candidate = null
    let settleTimer = null

    const commit = (conn, info) => {
      connected = true
      candidate = null
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
    }

    swarm.on('connection', (conn, info) => {
      if (connected || candidate) {
        // Already paired, or already settling another candidate: drop extras.
        conn.destroy()
        return
      }
      candidate = conn
      log.debug(`candidate peer ${info.publicKey.toString('hex').slice(0, 12)}; settling ${SETTLE_MS}ms`)

      const onEarlyExit = () => {
        if (candidate !== conn) return
        // A dedup loser that died before settling: discard and keep waiting.
        candidate = null
        if (settleTimer) { clearTimeout(settleTimer); settleTimer = null }
        log.debug('candidate dropped before settling; waiting for a stable peer')
      }
      conn.once('close', onEarlyExit)
      conn.once('error', onEarlyExit)

      settleTimer = setTimeout(() => {
        settleTimer = null
        if (candidate !== conn) return
        conn.removeListener('close', onEarlyExit)
        conn.removeListener('error', onEarlyExit)
        commit(conn, info)
      }, SETTLE_MS)
      if (typeof settleTimer.unref === 'function') settleTimer.unref()
    })
  }

  // The heart of symmetric mode: every peer both announces AND looks up the
  // topic, so two identical `hcat -s <topic>` invocations always find each other.
  const discovery = swarm.join(topic, { server: true, client: true })
  log.status(`Joining topic: ${name} (${topicPreview(topic)})...`)

  await discovery.flushed()
  log.debug('DHT announce flush complete.')
  await swarm.flush()
  log.debug('Initial discovery flush complete.')

  log.status('Waiting for a peer to connect...')

  // Keep re-running the LOOKUP (client side only) until we pair up, so two peers
  // that start at the same instant — neither announced yet when the other first
  // looked — still find each other on the next pass, and so a peer can join at
  // any later time. We deliberately do NOT refresh the server side here: the
  // initial announce persists, and re-announcing would tear down and renegotiate
  // the freshly established connection (connection churn).
  let refreshCount = 0
  if (!connected && !keepOpen) {
    refreshTimer = setInterval(() => {
      if (connected) return
      refreshCount++
      log.debug(`refreshing DHT lookup #${refreshCount} (peers=${swarm.peers.size})`)
      discovery.refresh({ client: true }).catch((err) => log.debug(`refresh error: ${err.message}`))
    }, 3000)
    if (typeof refreshTimer.unref === 'function') refreshTimer.unref()
  }

  if (timeoutMs > 0 && !keepOpen) {
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

module.exports = { runSymmetric }
