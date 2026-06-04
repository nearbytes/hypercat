'use strict'

const crypto = require('crypto')
const { Transform } = require('stream')

// --- About this layer -------------------------------------------------------
//
// Hyperswarm connections are ALREADY end-to-end encrypted and authenticated
// with the Noise protocol (XX handshake). So the wire is private regardless of
// this module.
//
// What Noise does NOT give you: a topic name is a rendezvous point, and anyone
// who guesses/learns the name can connect. The `--encrypt <secret>` flag adds a
// pre-shared-secret layer so that only peers holding the same passphrase can
// exchange (and decrypt) data. It is defence-in-depth and access control, not a
// replacement for Noise.
//
// Framing on the wire (per chunk):
//   [ uint32 BE length ][ 12-byte nonce ][ ciphertext ][ 16-byte GCM tag ]
// where `length` counts nonce + ciphertext + tag.

const NONCE_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32
const LENGTH_BYTES = 4
const MAX_FRAME_BYTES = 64 * 1024 * 1024 // 64 MiB guard against bad/hostile input

// Fixed application-specific salt. The passphrase is the secret, not the salt,
// and both sides must derive the same key, so a constant salt is correct here.
const KDF_SALT = Buffer.from('hcat:v1:aes-256-gcm', 'utf8')

/**
 * Derive a 32-byte key from a passphrase using scrypt.
 *
 * @param {string} secret - Shared passphrase.
 * @returns {Buffer} 32-byte key.
 */
function deriveKey (secret) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new TypeError('encryption secret must be a non-empty string')
  }
  return crypto.scryptSync(Buffer.from(secret, 'utf8'), KDF_SALT, KEY_BYTES)
}

/**
 * Transform that encrypts each chunk into an authenticated frame.
 *
 * @param {Buffer} key - 32-byte key from {@link deriveKey}.
 * @returns {Transform}
 */
function createEncryptor (key) {
  return new Transform({
    transform (chunk, _enc, cb) {
      try {
        if (chunk.length === 0) return cb()
        const nonce = crypto.randomBytes(NONCE_BYTES)
        const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce)
        const ciphertext = Buffer.concat([cipher.update(chunk), cipher.final()])
        const tag = cipher.getAuthTag()
        const length = Buffer.allocUnsafe(LENGTH_BYTES)
        length.writeUInt32BE(nonce.length + ciphertext.length + tag.length, 0)
        cb(null, Buffer.concat([length, nonce, ciphertext, tag]))
      } catch (err) {
        cb(err)
      }
    }
  })
}

/**
 * Transform that reassembles frames and decrypts them. Emits an error if a
 * frame fails authentication (wrong secret or tampered data).
 *
 * @param {Buffer} key - 32-byte key from {@link deriveKey}.
 * @returns {Transform}
 */
function createDecryptor (key) {
  let buffered = Buffer.alloc(0)

  return new Transform({
    transform (chunk, _enc, cb) {
      buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk])

      try {
        while (buffered.length >= LENGTH_BYTES) {
          const frameLen = buffered.readUInt32BE(0)

          if (frameLen < NONCE_BYTES + TAG_BYTES || frameLen > MAX_FRAME_BYTES) {
            throw new Error('invalid encrypted frame length (wrong secret?)')
          }
          if (buffered.length < LENGTH_BYTES + frameLen) break // wait for more

          const frame = buffered.subarray(LENGTH_BYTES, LENGTH_BYTES + frameLen)
          buffered = buffered.subarray(LENGTH_BYTES + frameLen)

          const nonce = frame.subarray(0, NONCE_BYTES)
          const tag = frame.subarray(frame.length - TAG_BYTES)
          const ciphertext = frame.subarray(NONCE_BYTES, frame.length - TAG_BYTES)

          const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce)
          decipher.setAuthTag(tag)
          const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
          if (plaintext.length > 0) this.push(plaintext)
        }
        cb()
      } catch (err) {
        cb(new Error(`decryption failed: ${err.message}`))
      }
    }
  })
}

/**
 * Build a fresh encryptor/decryptor pair for a single connection.
 *
 * @param {Buffer} key - 32-byte key from {@link deriveKey}.
 * @returns {{ encryptor: Transform, decryptor: Transform }}
 */
function createCipherPair (key) {
  return { encryptor: createEncryptor(key), decryptor: createDecryptor(key) }
}

module.exports = {
  deriveKey,
  createEncryptor,
  createDecryptor,
  createCipherPair,
  NONCE_BYTES,
  TAG_BYTES,
  KEY_BYTES
}
