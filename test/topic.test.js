'use strict'

const test = require('node:test')
const assert = require('node:assert')
const crypto = require('crypto')

const { topicFromName, topicPreview, TOPIC_BYTES } = require('../topic')

test('topic is a 32-byte buffer', () => {
  const topic = topicFromName('my-tunnel')
  assert.ok(Buffer.isBuffer(topic))
  assert.strictEqual(topic.length, TOPIC_BYTES)
  assert.strictEqual(topic.length, 32)
})

test('topic derivation is deterministic', () => {
  assert.deepStrictEqual(topicFromName('hello'), topicFromName('hello'))
})

test('different names give different topics', () => {
  assert.notDeepStrictEqual(topicFromName('a'), topicFromName('b'))
})

test('matches a plain sha256 of the name', () => {
  const expected = crypto.createHash('sha256').update('my-tunnel', 'utf8').digest()
  assert.deepStrictEqual(topicFromName('my-tunnel'), expected)
})

test('rejects empty / non-string names', () => {
  assert.throws(() => topicFromName(''), TypeError)
  assert.throws(() => topicFromName(null), TypeError)
  assert.throws(() => topicFromName(42), TypeError)
})

test('preview is 12 hex chars', () => {
  const preview = topicPreview(topicFromName('hello'))
  assert.strictEqual(preview.length, 12)
  assert.match(preview, /^[0-9a-f]{12}$/)
})
