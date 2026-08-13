# Match records and replay system

## Player experience

The Match Records screen is a short, useful list: the latest ten completed matches, newest first. Opening a current record launches an immersive read-only board with play/pause, previous/next frame, 0.5–4× speed, a scrubber, phase/result markers, keyboard navigation, and nearby action context. `Escape` returns to records; Space toggles playback; Left/Right step; Home/End jump.

Legacy records still open their chronological event log. A missing local archive or incompatible build produces a specific recovery message rather than a broken board.

## Storage model

| Data | Storage | Retention |
| --- | --- | --- |
| Online replay payload | `match_replays` | While at least one retained participant points to it |
| Player record + perspective | `match_replay_participants` | Latest 10 per user |
| Lifetime idempotency ledger | `match_stat_events` | Account lifetime |
| Lifetime totals | `account_match_stats` | Account lifetime |
| Training replay payload | Browser IndexedDB | Latest 10 on that device |
| Legacy event log | Existing history record | Latest 10 during migration |

The online payload is shared: a two-player match does not store two copies. Participant authorization is checked before reconstruction, and the response contains only the caller's projected states.

## Completion flow

1. The match reducer records every accepted command in `__engine.replay`.
2. A completed series creates a compact archive and final digest.
3. D1 atomically inserts the shared replay, participant summaries, idempotent stat events, recomputed lifetime totals, retention deletes, and orphan cleanup.
4. The player-facing summary synchronizes through existing account data, capped at ten.
5. Replay loading checks ownership and the exact version profile, reconstructs and verifies the match, projects hidden information, then sends the first frame plus deltas.

Durable Object alarms use the same reducer, command receipt, event store, and archive path as HTTP actions. Timer and disconnect outcomes are therefore replayable instead of becoming unexplained snapshot mutations.

## Rollout

Migration `0005_replay_archive.sql` is additive. Existing match and history tables remain readable. New records use schema version 3 and identify `server`, `local`, or `legacy` replay storage. Deploy the D1 migration before the Worker. No destructive backfill is required; old log-only records age out naturally as the latest-ten window fills.

Operational checks:

- monitor replay reconstruction failures by replay ID and recorded version profile;
- compare stored archive bytes with the previous snapshot/log footprint;
- track replay load latency and payload size;
- verify participant retention never exceeds ten;
- verify orphan replay cleanup and stat-event growth during scheduled maintenance.
