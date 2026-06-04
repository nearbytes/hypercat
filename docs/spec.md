## Cursor AI Prompt

Build a command-line tool called `hcat` (hypercat) that works like netcat but uses  Hyperswarm topics instead of IP addresses and ports.

## Behavior

Like netcat, the tool is asymmetric:
- One side runs as **server** (listens/announces on a topic)
- One side runs as **client** (connects to a topic)

### Server mode
```
hcat -l <topic-name>
```
- Announces itself on the hyperswarm DHT under the given topic
- Waits for a single client to connect
- Once connected, pipes stdin → peer and peer → stdout
- Behaves like `nc -l <port>`

### Client mode
```
hcat <topic-name>
```
- Looks up the topic on the hyperswarm DHT
- Connects to the server
- Pipes stdin → peer and peer → stdout
- Behaves like `nc <host> <port>`

## Key Requirements

- Topic name is a human-readable string (e.g. "my-tunnel"), internally hashed 
  to a 32-byte buffer using sha256
- stdin/stdout piping so it works with unix pipes:
    echo "hello" | hcat <topic>
    hcat -l <topic> > received_file.txt
- Graceful exit when connection closes
- No port forwarding or public IP needed (pure P2P via hyperswarm)

## Tech Stack
- Node.js
- hyperswarm (npm)
- commander or minimist for CLI args

## Project Structure
hcat/
  index.js       # CLI entry point
  server.js      # server mode logic
  client.js      # client mode logic
  topic.js       # helper: string -> 32-byte topic hash
  package.json

## Extra (optional, implement if straightforward)
- `-k` flag: keep server alive after client disconnects (like nc -k)
- `--encrypt` flag: encrypt the stream using a shared secret (noise protocol 
  or similar, hyperswarm already uses noise so this may be free)
- Print connection status messages to stderr (not stdout, so pipes are not 
  polluted), e.g.:
    "Announcing on topic: my-tunnel..." 
    "Peer connected."
    "Connection closed."
