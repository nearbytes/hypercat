# hcat

**netcat for the peer-to-peer age.**

`hcat` (hypercat) works like [`netcat`](https://en.wikipedia.org/wiki/Netcat),
but instead of IP addresses and ports it connects two machines through a
[Hyperswarm](https://github.com/holepunchto/hyperswarm) **topic** — a shared,
human-readable name. There are no ports to forward, no public IP to expose, and
no relay server in the middle: peers find each other over a distributed hash
table (DHT) and talk directly, end-to-end encrypted.

```sh
# machine A — listen on a topic
hcat -l my-tunnel

# machine B — connect to the same topic, anywhere in the world
echo "hello" | hcat my-tunnel
```

---

## Table of contents

- [Why](#why)
- [Install](#install)
- [Quick start](#quick-start)
- [Usage](#usage)
- [Common recipes](#common-recipes)
- [How it works](#how-it-works)
- [Security model](#security-model)
- [Exit codes](#exit-codes)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

## Why

Classic `netcat` is the universal pipe between two machines — but it needs a
reachable host and port. Behind NAT, on hotel Wi-Fi, or across clouds, that
usually means port forwarding, a VPN, or a relay.

`hcat` removes that requirement. Pick any string as a topic, run one side as a
listener and the other as a connector, and you have a direct, encrypted byte
pipe between the two. It composes with Unix pipes exactly like `nc` does.

## Install

Requires **Node.js >= 18**.

```sh
# Run without installing
npx hcat --help

# Install globally
npm install -g hcat
hcat --help

# From a clone
git clone https://github.com/nearbytes/hypercat.git
cd hypercat
npm install
npm link        # puts `hcat` on your PATH
```

## Quick start

Open two terminals (they can be on different machines / networks):

```sh
# Terminal 1 (server): announce a topic and wait
hcat -l my-tunnel

# Terminal 2 (client): connect and start typing
hcat my-tunnel
```

Whatever you type in one window appears in the other. Press `Ctrl-D` to send
EOF, or `Ctrl-C` to quit.

## Usage

```text
Usage: hcat [options] <topic>

Arguments:
  topic                    human-readable topic name to listen on or connect to

Options:
  -l, --listen             server mode: announce and listen on the topic (like nc -l)
  -k, --keep-open          keep serving after a peer leaves; accept many peers
                           (implies -l, like nc -k)
  -e, --encrypt <secret>   add an AES-256-GCM layer using a shared passphrase
                           (env: HCAT_SECRET)
  -w, --timeout <seconds>  client: give up if no peer is found in this many
                           seconds (0 = forever)
  -q, --quiet              suppress status messages on stderr
  -v, --verbose            print extra diagnostics on stderr
  -V, --version            output the version number
  -h, --help               display help for command
```

### Modes

| You run | Role | Like |
|---|---|---|
| `hcat -l <topic>` | **server** — announces the topic, waits for a peer | `nc -l <port>` |
| `hcat <topic>` | **client** — looks up the topic, connects | `nc <host> <port>` |

Either side may send and receive; the roles only describe who announces and who
looks up. Startup order does not matter — a client started first will keep
looking until the server appears.

## Common recipes

**Send a one-off message**

```sh
echo "hello" | hcat my-tunnel            # client
hcat -l my-tunnel                        # server prints it
```

**Transfer a file**

```sh
# receiver
hcat -l transfer > received.iso

# sender
cat ubuntu.iso | hcat transfer
# or
hcat transfer < ubuntu.iso
```

Binary data passes through untouched (no newline/encoding mangling), so
archives, images, and disk images all work.

**Pipe a directory across the network (tar over hcat)**

```sh
# receiver
hcat -l move | tar xzf -

# sender
tar czf - ./project | hcat move
```

**Interactive two-way chat**

```sh
hcat -l chatroom        # window 1
hcat chatroom           # window 2
```

**Add an encryption / access-control layer**

A topic name is only a rendezvous point; anyone who knows it can connect.
`--encrypt` adds a pre-shared passphrase so only holders of the secret can
exchange data:

```sh
hcat -l vault --encrypt "correct horse battery staple"
hcat vault    --encrypt "correct horse battery staple"
```

The secret can also be supplied via the `HCAT_SECRET` environment variable to
keep it out of shell history:

```sh
export HCAT_SECRET="correct horse battery staple"
hcat -l vault
hcat vault
```

**Broadcast hub (keep the server open for many peers)**

```sh
# one long-lived sink that prints everything every peer sends, and
# forwards anything typed locally to all connected peers
hcat -lk logsink > app.log
```

**Time-box a client connection**

```sh
hcat my-tunnel --timeout 30   # exit non-zero if no peer within 30s
```

**Keep pipes clean**

All status text goes to stderr, so redirects and pipes only ever see peer data:

```sh
hcat -l my-tunnel 2>/dev/null > only_payload.bin
```

## How it works

```
   topic name ──sha256──▶ 32-byte topic
        │                       │
   "my-tunnel"          hyperswarm.join(topic)
        │                       │
   ┌────┴─────┐           ┌─────┴──────┐
   │  server  │  ◀──DHT──▶│   client   │
   │ (-l)     │  rendezvous           │
   └────┬─────┘           └─────┬──────┘
        │   direct, Noise-encrypted   │
        │   peer-to-peer connection   │
   stdin/stdout  ◀───────────▶  stdin/stdout
```

1. The topic name is hashed with SHA-256 into the 32-byte topic Hyperswarm
   expects (`topic.js`). Both sides derive the same topic from the same name.
2. The server announces the topic on the DHT; the client looks it up. They make
   a **direct** connection (hole-punched through NAT when possible).
3. Every connection is end-to-end encrypted with the
   [Noise protocol](https://noiseprotocol.org/) by Hyperswarm itself.
4. `hcat` then wires the connection to stdin/stdout, with netcat-style
   half-close: local EOF closes the write side but keeps receiving (`pipe.js`).

### Project layout

```text
hcat/
├── index.js     # CLI entry point (argument parsing, signals, exit codes)
├── server.js    # server mode (announce + serve)
├── client.js    # client mode (lookup + connect)
├── topic.js     # topic name -> 32-byte topic hash
├── crypto.js    # optional shared-secret AES-256-GCM layer
├── pipe.js      # bidirectional stdin/stdout <-> peer piping
├── logger.js    # stderr status/error/debug logging
└── test/        # unit + integration tests (real local DHT testnet)
```

## Security model

- **Transport encryption is always on.** Hyperswarm connections use the Noise
  protocol, so traffic is encrypted and integrity-protected on the wire whether
  or not you pass `--encrypt`.
- **A topic name is not a password.** It is a public rendezvous label. Anyone
  who knows or guesses the name can connect to your listener.
- **Use `--encrypt` for confidentiality/access control.** It derives a key from
  your passphrase with `scrypt` and wraps the stream in AES-256-GCM, so only
  peers holding the same secret can read the data. A wrong secret fails closed
  (the connection errors out instead of leaking plaintext).
- **Choose unguessable topic names** for anything sensitive, and combine them
  with `--encrypt`. Treat well-known names like `test` as public.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Connection completed and closed cleanly |
| `1` | Error (e.g. wrong `--encrypt` secret, or client `--timeout` elapsed with no peer) |
| `130` | Interrupted with `Ctrl-C` (SIGINT) |

## Troubleshooting

- **It hangs on "Waiting for a peer to connect..."** — that is expected; the
  server waits indefinitely. Start the client on the other side with the exact
  same topic name.
- **The client never connects.** Confirm both sides use the identical topic
  string (it is case- and whitespace-sensitive). First connections over the
  public DHT can take a few seconds while NAT hole-punching happens. Use
  `--verbose` to see discovery diagnostics, or `--timeout <s>` to fail fast.
- **`decryption failed` errors.** The two sides are using different `--encrypt`
  secrets, or only one side passed `--encrypt`.
- **Garbled output.** One side used `--encrypt` and the other did not.

## Development

```sh
npm install
npm test          # runs unit tests + integration tests over a local DHT testnet
```

The integration tests spin up an in-process Hyperswarm DHT (`hyperdht/testnet`)
so the full server/client/crypto path is exercised without touching the public
network. `server.js` and `client.js` accept injected `input`/`output` streams
and `bootstrap` nodes precisely so they can be driven from tests and embedded in
other programs.

## License

[MIT](./LICENSE) © Alexander Kurz
