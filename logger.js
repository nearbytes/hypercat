'use strict'

// Status/diagnostic output ALWAYS goes to stderr so that stdout stays a clean
// data channel for pipes (e.g. `hcat -l topic > file`). This mirrors how netcat
// keeps its chatter off stdout.

/**
 * Build a logger writing to stderr.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.quiet=false] - Suppress status messages (errors still print).
 * @param {boolean} [opts.verbose=false] - Print extra [hcat] diagnostics.
 * @param {import('stream').Writable} [opts.stream=process.stderr]
 * @returns {{status: Function, error: Function, debug: Function}}
 */
function createLogger ({ quiet = false, verbose = false, stream = process.stderr } = {}) {
  const write = (line) => stream.write(line + '\n')
  return {
    status: quiet ? () => {} : (msg) => write(msg),
    error: (msg) => write(`hcat: ${msg}`),
    debug: (verbose && !quiet) ? (msg) => write(`[hcat] ${msg}`) : () => {}
  }
}

const noopLogger = { status () {}, error () {}, debug () {} }

module.exports = { createLogger, noopLogger }
