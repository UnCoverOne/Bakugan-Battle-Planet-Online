# Lobby migration and retirement

## Current state

The persistent-session integration remains staged. Both build-time flags are false. No production migration, legacy room deletion, account mutation or deployment is included.

The new managed social invitation path references the actual lobby and inviter membership. Accepting an invite inserts the recipient membership and marks the invitation accepted in one D1 batch. It requires the inviter still to be the host of an open online lobby, rejects existing account or presented guest membership, and refuses expired invitations. Old invitations are not silently reinterpreted as new room codes. Leaving the host seat or starting a series cancels its pending managed invitations.

Signing out does not leave an account's lobby. Local controller credentials are cleared; the account retains its membership until an explicit departure or the agreed one-hour expiry. Managed game HTTP and WebSocket admission require both controller credentials and the verified membership identity. Account deletion must first leave the lobby; migration 0021 protects the same transaction that deletes user data. No implicit forfeiture or reassignment.

A completed series can be recovered read-only by its original active membership even after its controller was revoked. The previous series result is available from the lobby. Replacement opponents cannot recover the former occupant's result.

## Operational cutover

1. Back up D1 and verify the full build, isolated engine regressions, local migrations 0016–0021, multiplayer and guest flows, and responsive browser tests. No production deletion or direct state mutation.
2. Apply additive migrations. Deploy a drain release with LEGACY_LOBBY_CREATION_CLOSED true and PERSISTENT_LOBBY_ENABLED false. Existing legacy online rooms can still join/finish; no new rooms are opened. Resolve stale or malformed legacy snapshots explicitly. The drain retention job preserves unfinished/unknown legacy rooms. Existing browser-only Training cannot be inventoried centrally: users should finish those sessions before final cutover; do not silently import or rewrite a local replay.
3. Run npm run inspect:lobby-cutover -- --remote (read-only counts). The inventory must report zero unfinished and zero unknown rooms. A BO3 game result is not a completed series. Reconcile unresolved rows using the existing engine/settlement path; do not delete them merely to pass the check. Managed admissions also enforce the inventory precondition.
4. Only after those checks pass, enable the persistent-session flag in a separate reviewed release. Old create/join/resume/gameplay APIs refuse legacy admissions/controllers; old completed records/replays remain. The flag is not an environment-variable shortcut around the tests.
5. After live validation, remove the legacy fallback route components and account resume UI/API, legacy-only admission branches and old art proven exclusive to those screens. Do not remove historical engine commands or replay decoders. Run npm run audit:lobby -- --after-cutover and the full test suite before retiring the compatibility layer.

## Cleanup audit

The older duplicate LobbyRoomScreen and stylesheet were removed. The active StreamlinedLobbyRoomScreen fallback and its structural CSS remain intentionally while the gate is disabled. Winner art is still used by the legacy result screen; group art is still used by the streamlined fallback; burst art is referenced by gameplay foundation; character/faction artwork can be addressed dynamically. Do not delete assets based only on their names.

npm run audit:lobby inventories all tracked source files and top-level image references, fails on reintroduced duplicate files/imports, and lists unreferenced asset candidates for review. It does not automatically delete dynamic assets or archived content. The strict after-cutover mode additionally rejects known compatibility files. The audit is wired into npm test. The complete checkout audit and build still require a connected checkout or CI.
