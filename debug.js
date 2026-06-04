'use strict'

const { topicPreview } = require('./topic')

/**
 * Log rendezvous details so two sides can compare topic id and options.
 *
 * @param {object} log
 * @param {object} opts
 * @param {'server'|'client'} opts.role
 * @param {string} opts.name
 * @param {Buffer} opts.topic
 * @param {string} [opts.secret]
 */
function logSessionDetails (log, { role, name, topic, secret }) {
  log.debug(`role: ${role}`)
  log.debug(`topic name: "${name}" (${name.length} chars, case/space sensitive)`)
  log.debug(`topic id: ${topicPreview(topic)} — both sides must show the same id`)
  log.debug(`encrypt: ${secret ? 'on (--encrypt / HCAT_SECRET)' : 'off'}`)
}

/**
 * Log Hyperswarm peer/connect counts when they change (verbose/debug only).
 *
 * @param {import('hyperswarm')} swarm
 * @param {object} log
 */
function attachSwarmDiagnostics (swarm, log) {
  let last = ''
  swarm.on('update', () => {
    const line = `peers=${swarm.peers.size} connecting=${swarm.connecting} open=${swarm.connections.size}`
    if (line === last) return
    last = line
    log.debug(`swarm: ${line}`)
  })
}

module.exports = { logSessionDetails, attachSwarmDiagnostics }
