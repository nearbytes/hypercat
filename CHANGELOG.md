# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-04

### Added

- Initial release of `hcat`, a netcat-style stdin/stdout pipe over Hyperswarm
  topics (no IPs, ports, or port forwarding).
- Server mode (`-l, --listen`) and client mode, mirroring `nc -l <port>` and
  `nc <host> <port>`.
- Human-readable topic names hashed to 32-byte Hyperswarm topics with SHA-256.
- Binary-safe, backpressure-aware bidirectional piping with netcat-style
  half-close on EOF and clean two-way shutdown.
- `-k, --keep-open` broadcast-hub mode: keep serving and fan input out to all
  connected peers.
- `-e, --encrypt <secret>` optional AES-256-GCM layer (scrypt-derived key) on
  top of Hyperswarm's built-in Noise transport encryption; also readable from
  the `HCAT_SECRET` environment variable.
- `-w, --timeout <seconds>` client connection timeout; client keeps refreshing
  discovery so startup order does not matter.
- `-q, --quiet` and `-v, --verbose` controls; all status output goes to stderr
  to keep stdout a clean data channel.
- Unit tests for topic hashing and the encryption layer, plus integration tests
  that exercise the full path over a local DHT testnet.
- Documentation: README, built-in `--help` with examples, and this changelog.

[1.0.0]: https://github.com/nearbytes/hypercat/releases/tag/v1.0.0
