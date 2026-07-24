# Game and rules engine architecture

The online match service is divided into explicit layers:

```text
HTTP/API command
  -> command parsing and seat authorization
  -> typed command envelope
  -> deterministic game reducer
  -> native typed rules dispatcher
  -> domain events and command receipt
  -> compare-and-swap persistence
  -> seat-specific state and event projection
```

English card text is presentation data. Matches execute reviewed `RuleDefinition` records from the typed Battle Planet catalogue; runtime regular-expression compilation is not part of card resolution.

## Deterministic kernel contract

`reduceMatch` is synchronous and receives every external input that can influence a transition:

- the authoritative state and expected version;
- the actor and typed command;
- a fixed command timestamp;
- a stable random seed;
- a unique command ID and request hash.

The reducer scopes the fixed clock and seeded random source to one synchronous transition and restores the host runtime afterward. Given the same state and command envelope, the reducer produces the same state, events, and command receipt. No database, HTTP, logging, or asynchronous operation is permitted inside the reducer.

## Native rules engine

`lib/rules/` owns card semantics and is the only rules-command boundary used by the reducer.

- `model.ts` defines effects, conditions, choices, triggers, costs, modifiers, replacements, payments, and serializable rule objects.
- `catalogue.ts` materializes the 374 reviewed Battle Planet definitions and rejects unknown or altered card text.
- `objects.ts` creates independently identified card, trigger, and copy objects for the batch.
- `executor.ts` executes sequences, conditions, replacements, and prevention nodes without interpreting display text.
- `choices.ts` distinguishes announcement, payment, and resolution choices.
- `costs.ts` declares, calculates, and commits payment transactions.
- `triggers.ts` matches events by relationship, card type, optionality, limits, and intervening conditions.
- `modifiers.ts` evaluates characteristics through ordered layers and applies protections such as ShadowStrike by filtering prohibited reductions.
- `replacements.ts` transforms proposed events one replacement at a time and re-evaluates the resulting event.
- `identity.ts` separates definition, printing, instance, and Character identity; Evo legality is based on canonical Character IDs.

Unsupported or modified catalogue text throws `UnsupportedCardTextError` instead of resolving partially. Production tests require all catalogue definitions to validate.

## Rule objects and the batch

Every card, trigger, and copy on the batch is a versioned `RuleObject` with:

- stable definition and ability IDs;
- an exact source reference;
- controller and independent choice-set identity;
- pending, resolving, resolved, or negated status;
- a serializable execution cursor;
- the event that created a trigger.

Negation targets the exact batch object. Copies begin with new choices and do not inherit the original object's selections.

## Choices and costs

Selections that affect playing legality are made during announcement. X and additional costs are made during payment. Optional and explicitly deferred decisions are made during resolution. Each choice declares its chooser and visibility.

Energy cards may only be uncharged for an active declared payment. The payment transaction records calculated Energy, selected Energy cards, and additional costs before the card enters the batch.

## Continuous effects and protection

Characteristic evaluation is ordered through base, set, BakuCore, continuous, temporary, protection, and final layers. B-Power, Damage Rating, FrostStrike, DoubleStrike, and ShadowStrike are calculated by the same evaluator. ShadowStrike prevents negative card, BakuCore, temporary, and continuous modifiers rather than only selected temporary maps.

## Damage Flips

Playing a revealed Flip creates a normal batch object and opens a priority window. Stop is part of the Flip object's resolution; negating that object prevents Stop and the remainder of its text. Damage resumes only after the response window and batch have completed.

## Domain event history

Every accepted transition produces a monotonically sequenced event stream. Events are persisted in `match_events`; snapshots remain in `matches` and `match_snapshots` for fast loading. Events carry `public`, `controller`, or `server` visibility.

## Idempotent commands

Every mutating request receives a command ID. The command receipt is stored in the match snapshot and durably in `match_commands`. A retry with the same command ID and request hash is acknowledged without applying the transition again. Reusing an ID for a different request is rejected.

## Phase state machine

The public phase value remains available to clients while the engine maintains a structured Lobby, Setup, Roll, Brawl, or Result phase projection. Phase-specific commands and every resulting transition are validated centrally.

## Play metadata

`lib/engine/play-pipeline.ts` now contains presentation and event metadata only: source zone, payment mode, copy status, response-window behavior, and destination. It is not an execution adapter. Card commands are executed directly by `lib/rules/runtime.ts`.

## Persistence transaction

The compare-and-swap state update, domain event inserts, command receipt, and periodic snapshot are submitted in one D1 batch. Event and receipt inserts are conditioned on the saved snapshot's `lastCommandId`, so a losing concurrent command cannot append history for a state it did not commit. Presence remains separate from gameplay state.
