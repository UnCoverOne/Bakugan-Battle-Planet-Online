# Bakugan: Battle Planet Online

A full-stack, browser-playable simulator for the 2019 Bakugan: Battle Planet TCG. It includes the complete **Battle Brawlers**, **Bakugan Resurgence**, and **Age of Aurelus** catalogues, deck building, persistent guest profiles, email/password accounts, cross-device data sync, match setup, training play, room-code multiplayer, the shared BakuCore field, server-authoritative game state, best-of-one/best-of-three matches, reconnect handling, undo restrictions, logs, timers, and the tabletop match interface.

## Included card sets

| Set | Code | Catalogue records |
| --- | --- | ---: |
| Battle Brawlers | BB | 374 |
| Bakugan Resurgence | BR | 249 |
| Age of Aurelus | AA | 220 |
| **Total** |  | **843** |

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

- Logged-out users keep decks, settings, drafts, match history, navigation state, and an active match in browser `localStorage`.
- Signed-in users use D1 as the durable account source; browser storage is an offline cache and is not merged back into the account on every resumed session.
- Cloud writes use an optimistic revision number. When two devices edit concurrently, the client merges unique decks and history records, keeps the newest edit for each shared deck, carries deck deletions with bounded tombstones, and retries after explicit conflict review.
- Passwords are never stored in plaintext. The server derives a salted PBKDF2-SHA-256 hash and stores only the hash, salt, and iteration count.
- Login uses an opaque session token in a `HttpOnly`, `SameSite=Lax` cookie; only a SHA-256 hash of the token is stored in D1.
- Signing out retains the browser copy. Deleting an account removes the cloud copy but deliberately leaves local data until the user separately deletes browser data.

## Main project areas

- `app/` — UI, routes, and server API
- `lib/engine/` — typed commands, deterministic reduction, phase validation, domain events, idempotency, persistence, and client projections
- `lib/game.ts` — Battle Planet rules and legacy-compatible state transitions used behind the engine boundary
- `lib/content/generated/` — generated Bakugan Resurgence and Age of Aurelus card records
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
