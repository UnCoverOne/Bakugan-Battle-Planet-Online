# Authoritative lobby preparation (staged)

Migration 0019 stores canonical deck snapshots, readiness, the pinned published Ranked ruleset and server-assigned Training AI deck in the lobby row. Preparation commands are authenticated and version-checked in a single D1 write. Configuration/deck/identity/membership changes and completion clear readiness as applicable; stale versions cannot overwrite new selections. Reconnect after 30 seconds clears the returning member's readiness, and Start rejects unreachable seats. Deck snapshots are independent of saved deck edits/deletion. Incompatible selections remain visible after settings changes, with short validation labels.

The projected preparation response exposes own deck snapshots, Casual opponent previews (not full deck lists), and only selection counts/readiness for Ranked opponents. No member identity keys or private Ranked choices are returned. The existing game projection is used only after the managed series starts. Ranked configuration is fixed to BO3/Competitive/Battle Brawlers, with the published deck size and restrictions; the existing admin ruleset does not yet include a configurable meta. Ruleset publication invalidates preparation readiness on synchronization; activation also checks the current DB ruleset version.

Training has one human seat; only enabled server-configured AI decks may be selected. Automatic selection prefers the latest compatible era and can construct a legal Singleton adaptation. No manual AI selector or reroll command. A missing AI deck blocks readiness/start, not membership. The explicit sync command retries unavailable AI assignment. The initial creation handler attempts synchronization; failure does not invalidate admission.

Start validates all committed snapshots again, binds online series atomically using migration 0018, and requires two reachable ready humans (or one ready human plus a legal bot in Training). Ranked begins with locked rosters in the ban stage of the existing engine; no ban or round-select controls belong to lobby preparation. Casual starts actual gameplay directly. The initializer configures the engine before the genesis snapshot, and readiness uses the configured Competitive deck size. The existing engine still calls its internal ban/select phase "lobby"; the UI must route using the persistent series binding, not that phase.

Training uses a separate durable local-series registration with a server-created genesis, one membership, optimistic checkpoint revision and explicit completion. Checkpoints are client-owned private local-game state; never use them to settle Ranked BP or as authoritative online match results. Explicit departure or one-hour expiry abandons active Training and releases membership. Client wiring, local replay integration and cross-device checkpoint/controller reconciliation remain outstanding.

## Staged API

All requests currently fail closed at the existing session cutover gate.
- sync-preparation: membershipId
- select-decks: membershipId, expectedVersion, decks (0–1 or 0–3)
- set-ready: membershipId, expectedVersion, ready
- update-settings: membershipId, expectedVersion, structure, format, meta
- start-series: membershipId, expectedVersion, commandId
- recover-training: membershipId, seriesId
- checkpoint-training / complete-training: membershipId, seriesId, expectedRevision, state

The new recovery response includes projected preparation. Start returns a series identity, not controller secrets. Online authenticated credential claim/recovery (including guests), live publication, application-wide presence, navigation, legacy entry-point migration, Ranked gameplay presentation and unified chat remain cutover gates. No production migration or deployment.
