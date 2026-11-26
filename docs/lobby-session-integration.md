# Session integration: staged server boundary

This phase adds the authenticated command/recovery boundary, not the live cutover. `/api/lobby/session` intentionally returns 503 before reading or writing any session data. Existing /api/game routes, invitations and local Training continue to use legacy state. Never remove the gate independently of those entry points.

## Contract
GET resolves verified membership; POST bootstrap establishes an opaque persistent HttpOnly guest cookie, then the next request can use it. The token digest, not the token, is stored in D1. Signed-in accounts use existing account authentication. All mutations require a server-resolved identity; the client cannot claim an account/player ID. Same-origin and rate limits apply. Guests are scoped to a verified cookie, not a real-world person; losing it prevents recovery and the membership will expire.

Create and join take stable command IDs. Admission receipts are inserted in the same D1 batch as membership; duplicate requests return the original admission even after departure, and reuse with different parameters conflicts. Joining by room code does not require a deck. Training codes are not externally joinable. The recovery response reports active membership, no membership, missing identity, or an account/guest conflict. Explicit idle guest adoption preserves the membership ID and rejects an occupied account; explicit departure can resolve either verified membership. Active series adoption/leave requires the engine bridge. No automatic account overwrite.

Expiry sweeps now skip active series until game concession/settlement and credential revocation can be coordinated. Their membership remains reserved; late heartbeats cannot resurrect an elapsed lease. This is intentionally conservative and not the final one-hour active-series departure implementation.

## Legacy cutover
The read-only inventory helper identifies all legacy account seats, including malformed snapshots, and distinguishes completed from unfinished series. It is not a migration or a public endpoint. Do not silently pick the most recent unfinished match. Before cutover, reconcile conflicting seats and guests, preserve unfinished series, settle/expire only via the authoritative engine, and prove no legacy create/join path bypasses membership. Completed legacy games do not establish persistent lobby membership because legacy clients never recorded explicit departure.

Remaining work: controller/seat binding and revocation, actual engine series bridge and active-series leave/expiry, guest and account sign-in/out/deletion UI reconciliation, global application heartbeat, route/navigation changes, invitation routing, legacy data migration, shared chat and readiness. Production migration 0017 and 0016 are required before enabling the endpoint. Run D1/Durable Object and browser concurrency tests before cutover.

## Managed engine bridge

See [managed series bridge](lobby-series-bridge.md) for the transactional engine/series binding, credential fencing, private coordinator departure operations and scheduled recovery. The public session endpoint remains gated until canonical lobby preparation, Training, credential recovery and all entry points are migrated.
