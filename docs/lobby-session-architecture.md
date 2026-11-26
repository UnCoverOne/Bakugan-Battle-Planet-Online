# Persistent lobby session architecture — foundation

## Authority and cutover status

This is an additive foundation, **not a production cutover**. Existing match routes and clients still use the legacy match/seat model. The staged session endpoint is explicitly disabled; no public mutation or shadow write is enabled. See [integration contract](lobby-session-integration.md). Do not enable the new service on a subset of modes: that would break the single-membership invariant. Apply migration 0016 before using the service.

D1 is the authoritative membership store across all rooms; a room-scoped Durable Object alone cannot enforce the cross-room identity constraint. A partial unique index permits at most one active membership per authenticated identity. A D1 transactional batch creates the room and its first membership together. Admission triggers enforce room capacity, account-only Ranked and no admission during an active series. The oldest remaining human membership is host; Mira Nova is not a membership. Closure is triggered by the last active membership ending.

The lobby UUID and public room code are independent of series and game IDs. Series pointers do not control membership. Current/previous series pointers are reserved for the next integration phase, not an implemented series lifecycle. The service does not depend on game phases, routes, socket disconnects or deck legality.

Identity keys must be constructed by the server from a verified account or durable guest credential. Never trust a request-supplied player ID. The account/guest identity reconciliation policy must be implemented before enabling this service.

## Presence and departure

All authenticated website activity can renew the current membership through the scoped heartbeat. No heartbeat after the one-hour deadline can restore an expired membership. At 30 seconds the presence helper reports disconnected; this is not departure. Expiry and explicit leave leave a durable departure reason. A new membership receives a new ID, so delayed commands from the previous seat cannot affect it.

Expiry currently runs on demand at service entry points or through the explicit sweep method, excluding active series pending settlement integration. A production alarm/scheduled sweep is still required to release inactive rooms without incoming requests. Do not run this sweep for active game sessions until the departure/forfeit and credential-revocation bridge is implemented. Explicit leave during an active series is intentionally rejected at this stage; a coordinated command must settle the game/series before completing departure. There must be no public path that calls the raw expiry/leave operations without this orchestration.

## Approved cutover contract

- All modes use the same membership service. Training gameplay may stay local, but its membership is server registered.
- Resolve membership globally; /play opens the existing lobby, otherwise creation. The navigation label is Return to Lobby during membership. No page navigation, game result or transport disconnection clears membership. No forced redirect merely from a game phase change.
- Account and verified guest recovery reuse the membership and recover or rotate controller credentials. Prevent stale controllers from executing commands. Reconcile sign-in and account deletion explicitly.
- New rooms admit players without decks; readiness validates committed deck snapshots. One deck in Casual/Training, three distinct Competitive decks in Ranked. Mira Nova's deck is automatically assigned, visible and read-only. Ranked opponent previews are concealed in the lobby. Ruleset controls Ranked configuration.
- Once a series starts, retain the lobby's membership, code and chat; lock configuration/decks until series completion. Return to Game is available to either player. Ban and round selection are game phases, never lobby stages.
- After completion, archive using distinct immutable series/game identities, clear the active-series pointer, reset readiness and retain selected decks/configuration. Preserve idempotent replay/stat/BP settlement.
- Use a single lobby-owned chat stream across lobby, match and intermission (system messages only for Training); do not leak hidden Ranked choices. Keep detailed game log separate.
- Leave or expire releases membership, revokes credentials, settles an ongoing series according to the approved concession rules, transfers host, and closes when empty. No manual kick feature.

## Integration gates before rollout

1. Design guest identity and account reconciliation; resolve legacy accounts with multiple unfinished rooms. Never silently pick or discard an active game. Backfill or explicitly reconcile legacy memberships before switching routes.
2. Route all create/join/resume/leave paths (including invitations, Training and social entry points) through the new authority. Use an idempotent coordinator for transitions involving the existing engine and D1; no split-brain dual writes. Return explicit conflict/retry responses.
3. Integrate series IDs, preparation snapshots, readiness/configuration permissions and the shared chat stream. Connect MatchRoom authorization and controller revocation, durable departure/settlement, deadline alarms, and cleanup. Exclude active lobby references from legacy match retention cleanup.
4. Implement global heartbeat/recovery and route guards. Unknown membership or failed recovery must block creation; explicit user navigation must not be treated as departure.
5. Test race conditions across rooms, retries, competing devices, guest sign-in, expiry during every game phase, replay/BP exactly-once semantics, and browser navigation in Cloudflare preview before enabling any cutover.

## Tests

`node --import tsx --test tests/lobby-session-foundation.test.ts` exercises the actual migration and service against Node SQLite via a minimal D1 adapter. It covers membership uniqueness/transaction rollback, capacity, Ranked admission, heartbeat/expiry boundary, host succession, closure, stale identities and independence from series references. It is not a substitute for a real D1/Durable Object concurrency test.
