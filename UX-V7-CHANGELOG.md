# UX V7 update

The match screen has been rebuilt around a fixed three-column game layout to bring the implementation closer to the approved mock-up and improve play clarity.

## Main changes

- Unified top status banner with player identity, round score, turn, timer, major phase, and nested Brawl step progression.
- Reduced and framed the active playmat so side information no longer floats over unused board space.
- Added dedicated left and right rails for the event log, player status, combat preview, Batch, and public game zones.
- Removed AI accuracy and target-calculation details from the player-facing log and roll result presentation.
- Added a persistent Batch panel with newest-first resolution order.
- Reworked opponent deck, hand, Bakugan team, Energy, and discard presentation into a single shelf.
- Added explicit OPEN, CLOSED, and BRAWLING states to Bakugan team cards.
- Rebuilt the combat preview with leader status, base/modifier breakdowns, and secondary Damage treatment.
- Replaced unexplained numbered BakuCore markers with contextual core-type labels and target/held states.
- Reworked the hand into an integrated dock with legal-card illumination, illegal-state explanations, contextual inspection, and clearer pass wording.
- Rebuilt Hero, discard, deck, and Energy zones with distinct labels, counts, and card previews.
- Added responsive scaling rules for 1220 px and 1550 px desktop breakpoints.

## Verification

- ESLint completed with no errors.
- Production build completed successfully.
- Automated rendered HTML test passed.
- Artifact validation passed.
