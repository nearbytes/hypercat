'use strict'

const test = require('node:test')
const assert = require('node:assert')
const crypto = require('crypto')
const { PassThrough } = require('stream')
const createTestnet = require('hyperdht/testnet')

const { runServer } = require('../server')
const { runClient } = require('../client')

function collect (stream) {
  const chunks = []
  stream.on('data', (c) => chunks.push(c))
  return () => Buffer.concat(chunks)
}

// Each test runs a real (but local) Hyperswarm DHT so server and client
// rendezvous exactly like they would on the public network, just faster.

test('client -> server: one-way message', { timeout: 30000 }, async (t) => {
  const testnet = await createTestnet(3)
  t.after(() => testnet.destroy())
  const bootstrap = testnet.bootstrap

  const serverOut = new PassThrough()
  const serverGot = collect(serverOut)

  const serverDone = runServer({
    name: 'one-way',
    bootstrap,
    input: new PassThrough(),
    output: serverOut
  })

  const clientIn = new PassThrough()
  const clientDone = runClient({
    name: 'one-way',
    bootstrap,
    input: clientIn,
    output: new PassThrough()
  })

  clientIn.end(Buffer.from('hello from the client'))

  assert.strictEqual(await clientDone, 0)
  assert.strictEqual(await serverDone, 0)
  assert.strictEqual(serverGot().toString(), 'hello from the client')
})

test('bidirectional exchange', { timeout: 30000 }, async (t) => {
  const testnet = await createTestnet(3)
  t.after(() => testnet.destroy())
  const bootstrap = testnet.bootstrap

  const serverOut = new PassThrough()
  const clientOut = new PassThrough()
  const serverGot = collect(serverOut)
  const clientGot = collect(clientOut)

  const serverIn = new PassThrough()
  const clientIn = new PassThrough()

  const serverDone = runServer({ name: 'two-way', bootstrap, input: serverIn, output: serverOut })
  const clientDone = runClient({ name: 'two-way', bootstrap, input: clientIn, output: clientOut })

  serverIn.end(Buffer.from('ping from server'))
  clientIn.end(Buffer.from('pong from client'))

  await Promise.all([clientDone, serverDone])
  assert.strictEqual(serverGot().toString(), 'pong from client')
  assert.strictEqual(clientGot().toString(), 'ping from server')
})

test('encrypted binary transfer round-trips intact', { timeout: 30000 }, async (t) => {
  const testnet = await createTestnet(3)
  t.after(() => testnet.destroy())
  const bootstrap = testnet.bootstrap
  const secret = 'correct horse battery staple'

  const serverOut = new PassThrough()
  const serverGot = collect(serverOut)

  const serverDone = runServer({ name: 'enc', secret, bootstrap, input: new PassThrough(), output: serverOut })

  const payload = crypto.randomBytes(256 * 1024) // 256 KiB binary blob
  const clientIn = new PassThrough()
  const clientDone = runClient({ name: 'enc', secret, bootstrap, input: clientIn, output: new PassThrough() })

  clientIn.end(payload)

  assert.strictEqual(await clientDone, 0)
  assert.strictEqual(await serverDone, 0)
  assert.deepStrictEqual(serverGot(), payload)
})
