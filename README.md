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
- [Symmetric mode](#symmetric-mode)
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

**Prefer not to pick server vs client?** Use [symmetric mode](#symmetric-mode)
instead — run the same command on both sides:

```sh
# Terminal 1 and 2 — identical command, any order
hcat -s my-tunnel
```

## Symmetric mode

Symmetric mode (`-s`) is for when you want both machines to run the **same
command** — no `-l` on one side and a bare topic on the other. It works like
[hyperbeam](https://github.com/holepunchto/hyperbeam): each peer both announces
and looks up the topic, so startup order does not matter and neither side needs
to know whether it is "server" or "client".

```sh
# on BOTH machines — copy-paste the same line
hcat -s my-tunnel
```

Type in either window; output appears in the other. Press `Ctrl-D` to send EOF,
or `Ctrl-C` to quit.

> **First contact can take a while.** Between two real machines on the public
> DHT, both sides can sit on `Waiting for a peer to connect...` for anything
> from a few seconds to a minute or so while the DHT propagates the topic and
> NAT hole-punching completes. This is normal — keep both running and wait for
> `Peer connected.` to appear. Anything you type *before* that point is not
> lost: stdin is buffered and flushed to the peer the moment the connection is
> established (so early lines arrive in one burst once you pair up).

### When to use `-s` vs `-l` / no flag

| Situation | Use |
|---|---|
| One machine is clearly the receiver (file sink, log collector) | `hcat -l topic` on receiver, `hcat topic` on sender |
| Two peers are equals (chat, ad-hoc tunnel, either may start first) | `hcat -s topic` on **both** |
| You do not want to explain "run this on A, that on B" | `hcat -s topic` on **both** |

### Symmetric recipes

**Interactive two-way chat**

```sh
hcat -s chatroom        # window 1
hcat -s chatroom        # window 2
```

**Send a one-off message** (one side pipes in and exits; the other stays up
until it receives EOF)

```sh
echo "hello" | hcat -s my-tunnel    # sender
hcat -s my-tunnel                   # receiver prints it
```

**Transfer a file**

```sh
# receiver
hcat -s transfer > received.iso

# sender
cat ubuntu.iso | hcat -s transfer
```

**Pipe a directory (tar over hcat)**

```sh
# receiver
hcat -s move | tar xzf -

# sender
tar czf - ./project | hcat -s move
```

**Add encryption** (same secret on both sides; topic alone is not a password)

```sh
hcat -s vault --encrypt "correct horse battery staple"
```

Or via environment variable:

```sh
export HCAT_SECRET="correct horse battery staple"
hcat -s vault
```

**Broadcast hub** (many senders → one long-lived receiver)

```sh
hcat -sk logsink > app.log
```

**Time-box waiting for a peer**

```sh
hcat -s my-tunnel --timeout 30   # exit non-zero if no peer within 30s
```

**Keep stdout clean for redirects**

```sh
hcat -s my-tunnel 2>/dev/null > only_payload.bin
```

### Symmetric troubleshooting

- **Both sides show "Waiting for a peer to connect..." for a while** — this is
  expected, not a failure. Across the public DHT, first contact between two real
  machines often takes several seconds and sometimes up to a minute (DHT
  propagation + NAT hole-punching). Just leave both running until you see
  `Peer connected.`; the session works from there. Compare the **topic id** in
  parentheses (e.g. `08d2feb8d700`) on both sides — if it matches, you are on
  the same topic and only need to wait.
- **You typed before it connected and worried the text was lost** — it is not.
  stdin is buffered, so lines entered before `Peer connected.` are delivered in
  one burst as soon as the peer arrives.
- **It connects faster locally than between machines** — same-host or same-LAN
  peers pair almost instantly; cross-Internet peers behind NAT take longer.
- **Want to see what is happening while you wait** — add `--verbose` (or `-d`)
  on both sides to print discovery progress and peer counts on stderr.
- **`decryption failed` or garbled output** — both sides must use the same
  `--encrypt` secret (or both use `HCAT_SECRET`).

## Usage

```text
Usage: hcat [options] <topic>

Arguments:
  topic                    human-readable topic name to listen on or connect to

Options:
  -l, --listen             server mode: announce and listen on the topic (like nc -l)
  -s, --symmetric          symmetric mode: run the same command on both sides
                           (hyperbeam-style; no -l needed)
  -k, --keep-open          keep serving after a peer leaves; accept many peers
                           (like nc -k)
  -e, --encrypt <secret>   add an AES-256-GCM layer using a shared passphrase
                           (env: HCAT_SECRET)
  -w, --timeout <seconds>  client: give up if no peer is found in this many
                           seconds (0 = forever)
  -q, --quiet              suppress status messages on stderr
  -v, --verbose            print discovery diagnostics on stderr
  -d, --debug              same as --verbose (topic id, DHT refresh, swarm stats)
  -V, --version            output the version number
  -h, --help               display help for command
```

### Modes

| You run | Role | Like |
|---|---|---|
| `hcat -l <topic>` | **server** — announces the topic, waits for a peer | `nc -l <port>` |
| `hcat <topic>` | **client** — looks up the topic, connects | `nc <host> <port>` |
| `hcat -s <topic>` | **symmetric** — run the *same* command on both sides | `hyperbeam` |

Either side may send and receive; the roles only describe who announces and who
looks up. Startup order does not matter — a client started first will keep
looking until the server appears. For the symmetric alternative, see
[Symmetric mode](#symmetric-mode).

## Common recipes

These examples use classic server/client mode (`-l` on one side). For the same
tasks with **identical commands on both sides**, see
[Symmetric recipes](#symmetric-recipes).

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
   a **direct** connection (hole-punched through NAT when possible). In symmetric
   mode (`-s`) both peers announce *and* look up, so there is no fixed
   server/client and the same command works on either side (`symmetric.js`).
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
├── symmetric.js # symmetric mode (announce + lookup; same command both sides)
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
  `--verbose` or `--debug` on **both** sides and compare the printed **topic id**
  (12 hex chars); if they differ, the topic names do not match. While waiting,
  `peers=0` means the DHT has not found a server yet; `peers>0` with no
  connection often means NAT/firewall trouble. Or use `--timeout <s>` to fail fast.
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
