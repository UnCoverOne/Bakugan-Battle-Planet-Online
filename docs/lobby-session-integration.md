# Persistent lobby integration

The lobby membership architecture, engine series bridge, preparation, application recovery, shared chat and responsive lobby presentation are staged. Public cutover remains disabled. The live site still uses the legacy fallback until migrations, operational drain and full verification are complete.

- [Membership architecture](lobby-session-architecture.md)
- [Managed engine bridge](lobby-series-bridge.md)
- [Authoritative preparation](lobby-preparation.md)
- [Application-wide recovery](lobby-client-integration.md)
- [Shared communication](lobby-chat.md)
- [Responsive presentation](lobby-presentation.md)
- [Migration and retirement](lobby-cutover.md)

Identity is server-derived from authenticated accounts or verified guest cookies. Admission is atomic and receipt-based. Membership survives navigation and completed series, expires after one hour unreachable, and ends on explicit leave or expiry. Active online departure is settled by the engine before membership release. Training has server-registered private checkpoints and automatic AI selection. Ranked rosters are prepared in the lobby and ban/round selection belong to the game.

Both cutover flags remain false. See the migration document for the legacy drain, social invitation admission, result recovery and cleanup process. Do not remove the fallback or enable the public route independently of those gates.
