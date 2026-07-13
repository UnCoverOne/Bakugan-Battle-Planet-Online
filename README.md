# Bakugan: Battle Planet Online

A full-stack, browser-playable vertical slice of the 2019 Bakugan: Battle Planet TCG. It includes the Battle Planet card catalogue and artwork, deck building, account/profile UI, match setup, training play, room-code multiplayer, the shared BakuCore field, server-authoritative game state, best-of-one/best-of-three matches, reconnect handling, undo restrictions, logs, timers, and the tabletop match interface.

## Stack

- Next.js 16 App Router and React 19
- Vinext and the Cloudflare Vite plugin
- Cloudflare Workers for the application/API runtime
- Cloudflare D1 for durable match state
- Wrangler 4 for local development and deployment

## Quick start

Requirements: Node.js 22.13 or newer, npm, Git, and a Linux/macOS shell. Windows users should use WSL 2 for the included shell scripts.

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. Local D1 data is stored by Wrangler/Miniflare under ignored project directories.

## Verify

```bash
npm run lint
npm test
npm run cf:dry-run
```

The dry run requires replacing the placeholder D1 database ID in `wrangler.jsonc` with a real database ID.

## Deploy

Read [SELF_HOSTING.md](SELF_HOSTING.md) for the complete local, GitHub, Cloudflare Workers, D1, CI/CD, custom-domain, backup, and troubleshooting procedure.

## Important deployment note

This is a full-stack application, not a static export. Room-code multiplayer calls `/api/game` and stores match state in the `DB` D1 binding. Use Cloudflare Workers (shown in the same **Workers & Pages** area of Cloudflare's dashboard). A static-only Cloudflare Pages or GitHub Pages deployment will render assets but cannot run matches.

## Main project areas

- `app/` — UI, routes, and server API
- `lib/game.ts` — deterministic game rules and state transitions
- `lib/catalog.generated.json` — Battle Planet card catalogue
- `public/assets/` — card, BakuCore, playmat, logo, symbol, and visual assets
- `db/` and `drizzle/` — D1 schema and migration
- `tests/` — engine and rendered-app checks
- `worker/` — Cloudflare Worker entry
- `wrangler.jsonc` — self-host deployment configuration
- `deploy/` — optional GitHub Actions workflow template

## Commercial assets

See [LICENSE-ASSETS.md](LICENSE-ASSETS.md). Do not assume that code access grants independent rights to third-party artwork or trademarks.
