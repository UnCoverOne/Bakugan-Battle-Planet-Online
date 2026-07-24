# Card content, quality and online operations

## Schema-controlled content

`lib/catalog.generated.json` remains the version-controlled canonical card dataset. Its contract is declared by `content/card-catalogue.schema.json` and enforced by `lib/content/catalogue.ts`. `content/card-content.lock.json` binds every canonical card ID and printed effect text to the reviewed typed `RuleDefinition`, provenance sources and a per-card golden test identity.

Content changes must update the source data, typed implementation and lock together. `npm run validate:content` rejects missing IDs, duplicate numbers, wrong type counts, altered effect text, unsupported rule nodes, missing provenance or a stale content lock.

## Rules authority hierarchy

Machine-readable sources are stored in `content/rules-sources.json`. Specific later official rulings outrank the general Complete Rulebook for the interaction they address. The Complete Rulebook supplies general procedures, the Glossary supplies defined terms, printed card text supplies canonical characteristics, and the digital policy is used only for online-only behavior such as roll profiles and timeout handling.

Every typed card definition contains its authority order and citations. Non-obvious implementations—triggers, replacements, continuous effects, copying, negation, free play, additional costs, Evo identity and damage Flips—must cite a rules authority beyond the card printing.

## Independent version profile

Each authoritative match, event, observation and replay records:

- application version;
- engine version;
- rules profile version;
- card catalogue version;
- digital adaptation version;
- content schema version.

Old snapshots are normalized by filling absent fields; their retained profile is not rewritten once present. This keeps replays reproducible after future errata or digital balancing changes.

## Event-oriented responses

Mutating game responses expose acceptance, previous/new versions, public events, seat-private events and a seat-safe state patch. A complete projected state remains temporarily available for client compatibility and reconnect. Periodic authoritative snapshots continue to be stored in D1.

## Quality gates

The content/quality workflow requires:

1. schema and content-lock validation;
2. 374 typed card/provenance golden checks;
3. canonical phase state/UI snapshots;
4. seeded replay determinism;
5. seat redaction and patch reconstruction;
6. invalid-command fuzz/property tests;
7. runtime budget tests;
8. the 18-item conformance matrix;
9. the complete production build, repository test suite, lint and Worker dry run.

## Observability and runtime safety

Structured observations include command acceptance/rejection, duration, events/effects per command, trigger depth, pending choice type, version conflicts, unsupported-rule attempts, timeout resolution and match termination reasons. Error context includes game/command IDs, event sequence, all version identifiers, phase, active effect and source card definition.

Hard limits are:

- trigger-chain depth: 100;
- effect steps per command: 1,000;
- replacement iterations: 50;
- pending choices: 20.

A limit breach suspends the authoritative match, stores a structured fault in engine metadata and emits an `ENGINE_FAULT` event. It never invents a winner. Optional timeout choices are declined; required private discards prefer the lowest-cost legal cards; deck ordering preserves the revealed order; disconnected players receive bounded connection grace; repeated competitive decision timeouts concede rather than allowing indefinite automated strategic play.
