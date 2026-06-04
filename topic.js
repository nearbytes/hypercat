'use strict'

const crypto = require('crypto')

// Hyperswarm topics are always exactly 32 bytes. We let users name a topic with
// any human-readable string (e.g. "my-tunnel") and derive the 32-byte topic
// deterministically with SHA-256 so that both sides land on the same DHT topic
// without exchanging anything but the name.
const TOPIC_BYTES = 32

/**
 * Derive a 32-byte Hyperswarm topic from a human-readable name.
 *
 * The mapping is deterministic: the same name always yields the same topic, on
 * any machine, so `hcat -l my-tunnel` and `hcat my-tunnel` rendezvous purely
 * from the shared string.
 *
 * @param {string} name - Human-readable topic name.
 * @returns {Buffer} 32-byte topic buffer.
 */
function topicFromName (name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('topic name must be a non-empty string')
  }

  return crypto.createHash('sha256').update(name, 'utf8').digest()
}

/**
 * Short, human-friendly hex preview of a topic, handy for status logs.
 *
 * @param {Buffer} topic - 32-byte topic buffer.
 * @returns {string} First 12 hex characters of the topic.
 */
function topicPreview (topic) {
  return topic.toString('hex').slice(0, 12)
}

module.exports = { topicFromName, topicPreview, TOPIC_BYTES }
