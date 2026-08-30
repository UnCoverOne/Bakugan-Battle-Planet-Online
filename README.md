# Bakugan: Battle Planet Online

A full-stack, browser-playable simulator for the 2019 Bakugan: Battle Planet TCG. It includes the complete Battle Planet and Armored Alliance era catalogues, deck building, persistent guest profiles, email/password accounts, cross-device data sync, match setup, training play, room-code multiplayer, the shared BakuCore field, server-authoritative game state, best-of-one/best-of-three matches, reconnect handling, undo restrictions, logs, timers, and the tabletop match interface.

## Included card sets

| Set | Code | Catalogue records |
| --- | --- | ---: |
| Battle Brawlers | BB | 374 |
| Bakugan Resurgence | BR | 249 |
| Age of Aurelus | AA | 220 |
| Promo Exclusives | EX | 2 |
| Armored Elite | AV | 272 |
| Fusion Force | FF | 276 |
| Shields of Vestroia | SV | 310 |
| Blind Box 1 | PS1 | 21 |
| Cubbo Pack | CP | 6 |
| Diamond Indomitable | DI | 4 |
| **Total** |  | **1,734** |

Bakugan Resurgence contains two known printings numbered 221, so its 248 collector numbers produce 249 catalogue records.

## Stack

- Next.js 16 App Router and React 19
- Vinext and the Cloudflare Vite plugin
- Cloudflare Workers for the application/API runtime
- Cloudflare D1 for durable match state, account records, sessions, and synced user data
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

This is a full-stack application, not a static export. Room-code multiplayer calls `/api/game`; account access uses `/api/auth`; and cross-device persistence uses `/api/user-data`. All durable server data uses the `DB` D1 binding. Use Cloudflare Workers (shown in the same **Workers & Pages** area of Cloudflare's dashboard). A static-only Cloudflare Pages or GitHub Pages deployment will render assets but cannot run matches, accounts, or cloud sync.

## Persistence and accounts

- Logged-out users keep decks, settings, drafts, match history, navigation state, and active state in browser storage.
- Registration is the only local-to-account import boundary. The user may import the current guest data or create an empty account; the selected initial snapshot is stored atomically with the new account.
- Existing-account login always loads D1 account data and never merges guest browser data. If account data cannot be loaded, signed-in routes remain blocked instead of falling back to the guest snapshot.
- While signed in, guest browser storage is read-only and unchanged. Account edits use in-memory account state and are written only to D1; logging out flushes pending writes and restores the preserved guest snapshot.
- Cloud writes use an optimistic revision number. When two signed-in sessions edit concurrently, the client can merge account revisions, keeps the newest edit for each shared deck, and carries deck deletions with bounded tombstones.
- Passwords are never stored in plaintext. The server derives a salted PBKDF2-SHA-256 hash and stores only the hash, salt, and iteration count.
- Login uses an opaque session token in a `HttpOnly`, `SameSite=Lax` cookie; only a SHA-256 hash of the token is stored in D1.
- Deleting an account removes its cloud data and restores the separate guest data saved in that browser.

## Main project areas

- `app/` — UI, routes, and server API
- `lib/engine/` — typed commands, deterministic reduction, phase validation, domain events, idempotency, persistence, and client projections
- `lib/game.ts` — Battle Planet rules and legacy-compatible state transitions used behind the engine boundary
- `lib/content/generated/` — generated card records for all post-Battle Brawlers sets
- `lib/content/card-set-extensions.ts` — set-row normalization, scan mapping, mechanics tags, and provenance
- `docs/engine-architecture.md` — command, reducer, event-store, projection, and migration architecture
- `lib/persistence.ts` — versioned browser/cloud snapshots and conflict merging
- `lib/account-server.ts` — password hashing, session cookies, and account helpers
- `lib/catalog.generated.json` — Battle Brawlers card catalogue
- `public/assets/` — Battle Brawlers card, BakuCore, playmat, logo, symbol, and visual assets
- `db/` and `drizzle/` — D1 schema and migration
- `tests/` — engine and rendered-app checks
- `worker/` — Cloudflare Worker entry
- `wrangler.jsonc` — self-host deployment configuration
- `deploy/` — optional GitHub Actions workflow template

## Commercial assets

See [LICENSE-ASSETS.md](LICENSE-ASSETS.md). Do not assume that code access grants independent rights to third-party artwork or trademarks.
