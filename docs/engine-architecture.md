# Game engine architecture

The online match service is divided into explicit layers:

```text
HTTP/API command
  -> command parsing and seat authorization
  -> typed command envelope
  -> deterministic reducer
  -> domain events and command receipt
  -> compare-and-swap persistence
  -> seat-specific state and event projection
```

Card play commands enter a single compatibility play pipeline before reaching the existing Battle Planet resolver. This keeps the live card catalogue operational while the rules engine is migrated from text-driven execution to typed abilities.

## Deterministic kernel contract

`reduceMatch` is synchronous and receives every external input that can influence a transition:

- the authoritative state and expected version;
- the actor and typed command;
- a fixed command timestamp;
- a stable random seed;
- a unique command ID and request hash.

The reducer temporarily supplies the fixed clock and seeded random source to the legacy transition functions. The patch is scoped to one synchronous call and restored in a `finally` block. Given the same state and command envelope, the reducer produces the same state, events, and command receipt.

No database, HTTP, logging, or asynchronous operation is permitted inside the reducer.

## Domain event history

Every accepted transition produces a monotonically sequenced event stream. Events are persisted in `match_events`; snapshots remain in `matches` and `match_snapshots` for fast loading. The event stream records command boundaries, phase and priority transitions, card-zone movement, energy changes, Bakugan and BakuCore changes, batch changes, damage, logs, and match completion.

Events carry visibility metadata:

- `public`: safe for both seats;
- `controller`: visible only to one player;
- `server`: audit/replay data that is never sent to a client.

## Idempotent commands

Every mutating request receives a command ID. Modern clients should send `commandId` or `x-command-id`; older clients receive a deterministic ID derived from the request body, actor, and expected version.

The command receipt is stored both:

- in the match snapshot as a bounded recent-receipt cache; and
- durably in `match_commands`.

A retry with the same command ID and request hash is acknowledged without applying the transition again. Reusing an ID for a different request is rejected.

## Phase state machine

The legacy phase value remains part of the public state for client compatibility. The engine also maintains a structured phase projection with these areas:

- Lobby
- Setup
- Roll
- Brawl
- Result

Phase-specific commands are validated centrally, and every transition is checked against the declared transition graph before persistence.

## Unified play pipeline

These server commands use one play boundary:

- prepare a card play;
- announce, pay for, and play a hand card;
- reveal a damage Flip;
- play a revealed damage Flip.

The pipeline records a `PlayContext` containing source zone, payment mode, copy status, response-window behavior, and post-resolution destination. The compatibility adapter delegates to the current card resolver, allowing mechanics to migrate incrementally without changing the API contract.

## Persistence transaction

The compare-and-swap state update, domain event inserts, command receipt, and periodic snapshot are submitted in one D1 batch. Event and receipt inserts are conditioned on the saved snapshot's `lastCommandId`, so a losing concurrent command cannot append history for a state it did not commit.

Presence remains separate from gameplay state and does not participate in gameplay version conflicts.
