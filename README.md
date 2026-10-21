# Warehouse

An internal-network file explorer. Point it at a directory and it indexes everything inside: EXIF/GPS
data, audio tags, PDF text, content-type sniffing, and image thumbnails — then serves a browsable
web UI over that index. Designed to run unauthenticated on a trusted internal network.

## Features

- Background indexing on startup — walks the content root and keeps re-crawling, no manual re-index step.
- Rich per-file metadata extraction (EXIF/IPTC/XMP/GPS, audio tags, PDF text, content-type/magic-byte sniffing).
- Thumbnails and full-size previews for images.
- Full-text search over metadata, built on SQLite FTS5 (API route pending — see [`docs/ROADMAP.md`](docs/ROADMAP.md)).

## Getting Started

```bash
npm install
NUXT_CONTENT_ROOT=/path/to/your/files npm run dev
```

Then open `http://localhost:3000`.

## Docker

```bash
docker compose up
```

See `docker-compose.yml` — mount the directory you want indexed and point `NUXT_CONTENT_ROOT` at
it inside the container.

## Project Docs

- [`docs/ROADMAP.md`](docs/ROADMAP.md) — what's shipped, what's next.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — settled technical/UI decisions and why.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — current system structure.
- [`CLAUDE.md`](CLAUDE.md) — instructions for AI coding agents working in this repo.
