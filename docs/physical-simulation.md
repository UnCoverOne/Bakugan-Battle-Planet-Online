# Physical simulation rules module

The online game treats tabletop motion as a versioned digital-adaptation rules domain rather than an incidental collection of random numbers inside the match kernel.

## Module boundary

`lib/rules/physical-simulation.ts` owns every rule that translates a selected Bakugan and secret BakuCore target into a physical result:

- projected Hide Matrix geometry;
- roll lane and pickup window;
- per-Bakugan accuracy threshold;
- undershoot, overshoot, left/right skew, closed miss, and open-without-Core deviation;
- four-BakuCore magnet rotation phase;
- Double Core chance and before/after/side selection;
- contested primary and secondary pickup resolution;
- animation path generation;
- all-closed repeat attempts.

`lib/game.ts` remains responsible for applying the final simulation result to authoritative game state: opening Bakugan, attaching BakuCores, publishing logs, creating rules events, and advancing to the Power Step.

## Versioned profile

`BATTLE_PLANET_PHYSICAL_SIMULATION_PROFILE` is immutable and identified by the match's `digitalAdaptationVersion`. A replay therefore records both its random draws and the profile that interpreted them.

The profile currently declares:

- an 1,800 × 1,000 projected play surface;
- a four-BakuCore magnet phase period;
- miss outcome weights;
- 40/40/20 Double Core selection for before/after/side;
- normalized-accuracy priority for contested primary pickups;
- primary-pickup priority over secondary pickups;
- an explicit all-closed repeat policy and a 64-attempt fail-closed limit.

Changing these values is a rules change. It requires a new digital-adaptation version, focused simulation tests, replay review, and the permanent physical-simulation CI gate.

## Contested BakuCore policy

The simulator intentionally models the ordinary physical result instead of forcing the rare tabletop end state where two opened Bakugan remain attached to one BakuCore.

When two primary pickup paths claim the same BakuCore:

1. Each result is ranked by `accuracyRoll / rollAccuracy`.
2. The lower normalized value wins because it represents the stronger roll relative to that Bakugan's accuracy profile.
3. Player ID is the deterministic tie-break.
4. The winner takes the BakuCore.
5. The other Bakugan opens without a BakuCore.

This represents blocking, displacement, or deflection without pretending that the software can identify which physical mechanism happened. The decision is emitted as structured collision metadata and included in the public match log.

A primary pickup always takes precedence over another Bakugan's attempted secondary Double Core pickup.

## Determinism and random input

The module receives a `PhysicalRandomSource`; it never creates its own entropy. Every draw is range-checked. The engine's deterministic runtime provides the source during authoritative commands, so a command envelope and physical profile reproduce the same attempts, paths, outcomes, and collisions.

All-closed attempts are retained in the simulation result rather than discarded. This makes repeat behavior inspectable in logs and tests.

## Failure policy

Invalid profiles and invalid random values fail before state application. Reaching the repeated-roll limit is converted by the game kernel into an engine runtime-limit fault. The engine then suspends the match through the existing structured `ENGINE_FAULT` path instead of inventing an opening result or choosing a winner.
