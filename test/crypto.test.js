'use strict'

const test = require('node:test')
const assert = require('node:assert')
const crypto = require('crypto')
const { pipeline } = require('stream/promises')
const { PassThrough } = require('stream')

const { deriveKey, createCipherPair, KEY_BYTES } = require('../crypto')

function collect (stream) {
  const chunks = []
  stream.on('data', (c) => chunks.push(c))
  return () => Buffer.concat(chunks)
}

async function roundTrip (key, input) {
  const { encryptor } = createCipherPair(key)
  const { decryptor } = createCipherPair(key)
  const src = new PassThrough()
  const got = collect(decryptor)
  encryptor.pipe(decryptor)
  src.pipe(encryptor)
  src.end(input)
  await new Promise((resolve, reject) => {
    decryptor.on('end', resolve)
    decryptor.on('error', reject)
  })
  return got()
}

test('deriveKey returns a 32-byte key', () => {
  const key = deriveKey('hunter2')
  assert.strictEqual(key.length, KEY_BYTES)
})

test('same secret derives the same key', () => {
  assert.deepStrictEqual(deriveKey('s3cr3t'), deriveKey('s3cr3t'))
})

test('deriveKey rejects empty secret', () => {
  assert.throws(() => deriveKey(''), TypeError)
})

test('encrypt/decrypt round-trips a string', async () => {
  const key = deriveKey('correct horse battery staple')
  const out = await roundTrip(key, Buffer.from('hello, peer!'))
  assert.strictEqual(out.toString(), 'hello, peer!')
})

test('encrypt/decrypt round-trips random binary data across many chunks', async () => {
  const key = deriveKey('binary-secret')
  const { encryptor } = createCipherPair(key)
  const { decryptor } = createCipherPair(key)
  encryptor.pipe(decryptor)
  const got = collect(decryptor)

  const blobs = Array.from({ length: 50 }, () => crypto.randomBytes(1 + Math.floor(Math.random() * 4096)))
  const expected = Buffer.concat(blobs)

  const ended = new Promise((resolve, reject) => {
    decryptor.on('end', resolve)
    decryptor.on('error', reject)
  })
  for (const b of blobs) encryptor.write(b)
  encryptor.end()
  await ended

  assert.deepStrictEqual(got(), expected)
})

test('wrong secret fails authentication', async () => {
  const { encryptor } = createCipherPair(deriveKey('right-secret'))
  const { decryptor } = createCipherPair(deriveKey('wrong-secret'))
  encryptor.pipe(decryptor)
  decryptor.resume()

  const errored = new Promise((resolve) => decryptor.on('error', resolve))
  encryptor.end(Buffer.from('top secret'))
  const err = await errored
  assert.match(err.message, /decryption failed/)
})

test('the wire bytes are not plaintext', async () => {
  const key = deriveKey('s')
  const { encryptor } = createCipherPair(key)
  const got = collect(encryptor)
  await pipeline(
    (async function * () { yield Buffer.from('PLAINTEXT-MARKER') })(),
    encryptor
  )
  assert.ok(!got().includes(Buffer.from('PLAINTEXT-MARKER')))
})
