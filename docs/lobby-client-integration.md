# Application-wide persistent lobby integration (staged)

The single PERSISTENT_LOBBY_ENABLED build-time constant controls the public session API and the application-wide provider/route switch. It remains false. No production cutover or database migration is included.

Controller recovery is membership-scoped for both authenticated accounts and verified guest cookies. The session endpoint resolves the active seat and forwards only verified private coordinator requests. The MatchRoom serializes claims with engine commands, reuses valid presented credentials, otherwise rotates by capability-version compare-and-swap and closes stale sockets. An active socket requires an explicit takeover. The response includes only the viewer's projected state and own credentials. Legacy resume refuses managed series. Public leave is routed through the existing private departure coordinator for active online seats.

The global provider lives above the application shell, independent of the current route. It polls every 12 seconds with a ten-second request timeout, and wakes on focus, visibility changes and reconnection. Identity changes cancel stale requests; unknown/unavailable recovery never permits admission. Guest bootstrap is explicit before admission, and account/guest conflict is presented without silently discarding either. Heartbeats renew membership across all pages; no unload, navigation or socket closure issues a leave command.

Play resolves membership; navigation preserves its slot width and becomes Return to Lobby. The home hero uses the same membership decision, and the old active-match list is suppressed in managed mode. Direct invitation links prefill the room code; an existing membership takes precedence. Important opponent/series changes observed while browsing other pages use the existing global notification mechanism. Game routes require a current series and a controller claim or private Training recovery. Return to Lobby does not end membership. A launch observed while viewing the same idle lobby enters the gameplay route, not while browsing another page. Internal engine ban/select/intermission phases have transitional gameplay-route controls; they are not preparation lobby stages. The transitional lobby controls are functional staging UI, not the approved final responsive presentation. Existing gameplay and lobby chat remain separate until the next phase.

Local Training checkpoints use optimistic revisions, flush periodically and after state changes, and attempt a flush before Return to Lobby. Conflicting checkpoints stop automatic writes and block further gameplay until explicit recovery retrieves the current server copy. The initial local replay journal may be initialized from the genesis; recovery of historical replay journals across devices remains outstanding. Browser suspension or termination can interrupt an unsaved checkpoint, so the last confirmed server checkpoint is the recovery point.

Remaining cutover gates: reconcile legacy account/guest sessions and all social invitation and dashboard entry paths; implement unified chat, final lobby/gameplay phase presentation, account sign-out/deletion policy and robust local replay/controller reconciliation; validate result/settlement delivery and current-series guards end to end; run the full build, repository tests, Cloudflare and browser multi-device tests. Do not flip the gate merely to preview the staged UI.

## Local verification

The routing helper and two regression tests were copied from the committed GitHub blobs and their Git hashes verified. Both tests passed on Node 22 using native TypeScript stripping (only the test import was adapted to include the .ts suffix for Node). Full repository build, browser, controller claim and Cloudflare tests remain unexecuted because the local environment cannot resolve github.com.

## Unified communication

See [persistent lobby communication](lobby-chat.md). The common chat provider and membership-scoped API are staged behind the same disabled cutover flag. Final responsive placement remains part of the next design phase.
