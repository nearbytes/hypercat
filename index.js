#!/usr/bin/env node
'use strict'

const { Command, Option, InvalidArgumentError } = require('commander')
const pkg = require('./package.json')
const { runServer } = require('./server')
const { runClient } = require('./client')
const { createLogger } = require('./logger')

function parseTimeout (value) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new InvalidArgumentError('timeout must be a non-negative number of seconds')
  }
  return seconds
}

const EXAMPLES = `
Examples:
  # Receiver announces a topic, sender connects to it
  hcat -l my-tunnel                 # one terminal/machine (server)
  hcat my-tunnel                    # another terminal/machine (client)

  # Send a one-off message
  echo "hello" | hcat my-tunnel

  # Receive a file
  hcat -l my-tunnel > received.txt
  cat bigfile.iso | hcat my-tunnel  # on the sender

  # Interactive two-way chat (type in both windows)
  hcat -l chatroom
  hcat chatroom

  # Long-lived broadcast hub: many senders -> one receiver
  hcat -lk logsink > app.log

  # Add a shared-secret layer on top of Hyperswarm's built-in encryption
  hcat -l secret-room --encrypt "correct horse battery staple"
  hcat secret-room --encrypt "correct horse battery staple"

  # Give up if no peer shows up within 30s (client only)
  hcat my-tunnel --timeout 30

Notes:
  * A topic name is a rendezvous string, NOT a password. Anyone who knows the
    name can connect. Use --encrypt for access control / confidentiality.
  * Status messages go to stderr; stdout carries only peer data, so pipes and
    redirects stay clean.
`

function buildProgram () {
  const program = new Command()

  program
    .name('hcat')
    .description(pkg.description)
    .argument('<topic>', 'human-readable topic name to listen on or connect to')
    .option('-l, --listen', 'server mode: announce and listen on the topic (like nc -l)')
    .option('-k, --keep-open', 'keep serving after a peer leaves; accept many peers (implies -l, like nc -k)')
    .addOption(new Option('-e, --encrypt <secret>', 'add an AES-256-GCM layer using a shared passphrase').env('HCAT_SECRET'))
    .option('-w, --timeout <seconds>', 'client: give up if no peer is found in this many seconds (0 = forever)', parseTimeout, 0)
    .option('-q, --quiet', 'suppress status messages on stderr')
    .option('-v, --verbose', 'print extra diagnostics on stderr')
    .version(pkg.version, '-V, --version', 'output the version number')
    .addHelpText('after', EXAMPLES)
    .showHelpAfterError('(add --help for usage)')

  return program
}

async function main (argv) {
  const program = buildProgram()
  program.parse(argv)

  const topic = program.args[0]
  const opts = program.opts()
  const log = createLogger({ quiet: opts.quiet, verbose: opts.verbose })

  const isServer = Boolean(opts.listen || opts.keepOpen)

  const controller = new AbortController()
  const onSignal = () => controller.abort()
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  const common = {
    name: topic,
    secret: opts.encrypt,
    log,
    signal: controller.signal
  }

  try {
    const code = isServer
      ? await runServer({ ...common, keepOpen: Boolean(opts.keepOpen) })
      : await runClient({ ...common, timeoutMs: opts.timeout * 1000 })
    return code
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
}

if (require.main === module) {
  main(process.argv)
    .then((code) => { process.exitCode = code })
    .catch((err) => {
      process.stderr.write(`hcat: ${err && err.message ? err.message : err}\n`)
      process.exitCode = 1
    })
}

module.exports = { main, buildProgram }
