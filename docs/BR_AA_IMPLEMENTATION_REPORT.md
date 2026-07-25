# Bakugan Resurgence and Age of Aurelus implementation report

## Scope

This change extends the simulator from the 374-card Battle Brawlers catalogue to all three first-year sets:

| Set | Collector sequence | Catalogue records | Action | Flip | Hero | Evo | Character |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Battle Brawlers | 1–374 | 374 | 137 | 49 | 29 | 66 | 93 |
| Bakugan Resurgence | 1–248 | 249 | 59 | 17 | 8 | 81 | 84 |
| Age of Aurelus | 1–220 | 220 | 50 | 16 | 10 | 85 | 59 |
| **Total** |  | **843** | **246** | **82** | **47** | **232** | **236** |

Bakugan Resurgence contains two supplied printings at collector number 221. They are retained as separate canonical records (`br-221-pyravian-ultra` and `br-221-artulean-ultra`) while both display `221/248 BR`.

## Implementation

- Added compact, typed source rows for all 249 Bakugan Resurgence records and all 220 Age of Aurelus records.
- Added set-aware canonical IDs, collector labels, metadata, set counts, and validation.
- Preserved the original 374 Battle Brawlers IDs and legacy content lock.
- Extended the card rules compiler to use set-qualified identities instead of collector numbers, preventing collisions such as BB, BR, and AA card 1.
- Added same-set-first Evo identity resolution with a fallback to compatible first-year Character printings.
- Added parsing for the additional printed effects used by these sets, including broader triggered, continuous, cost-reduction, alternative-cost, search, reveal, copy, attach/remove, and free-play structures.
- Added the two new sets to the compendium, with a set filter, set badges, set-aware collector labels, search terms, detail metadata, and missing-image fallback.
- Updated content and application version identifiers.
- Added regression tests for counts, IDs, duplicate BR 221 handling, collector labels, provenance, Evo identity resolution, and preservation of the Battle Brawlers authoring workflow.

## Data corrections and normalization

The supplied data was preserved except where a clear identity or transcription issue prevented reliable implementation:

- Corrected the final Bakugan Resurgence collector order to `247 Ventus Vicerox` and `248 Aquos Phaedrus`, matching the supplied scans.
- Corrected `Hyper Serpeteze`/`Aquos Serpeteze` to `Hyper Serpenteze`/`Aquos Serpenteze`.
- Corrected `Divine Inspriation` to `Divine Inspiration`.
- Corrected BR 152 to `Diamond Webam Ultra`.
- Corrected `Crescent Fear` to `Crescent Claw`.
- Restored Age of Aurelus 77's Evo target as `Fade Ninja`.
- Normalized blank effects, numeric costs, rarity names, BakuCore tokens, and Diamond display names into the existing game schema.

## Card art

The supplied archives contain usable scans for 426 of the 469 added catalogue records. Those entries resolve through the supplied filenames using the Bakugan Wiki MediaWiki file redirect. The remaining 43 records use the simulator's existing missing-card placeholder. The compendium falls back to that placeholder if a remote scan cannot load.

No unprovided scan was fabricated. The duplicate BR 221 records only include one supplied scan (Artulean Ultra); Pyravian Ultra therefore uses the placeholder.

## Validation performed

- Parsed both supplied workbooks and both image archives.
- Confirmed 249 BR records, 220 AA records, and 843 total records.
- Confirmed full collector-number coverage: BR 1–248 (with two records at 221) and AA 1–220.
- Confirmed globally unique canonical IDs and stable slugs.
- Confirmed the aggregate card-type totals shown above.
- Syntax-transpiled all new and changed TypeScript/TSX files locally.
- Added repository tests for catalogue structure, set counts, typed definition generation, provenance, collector labels, and Evo identity selection.

## Known execution boundary

Every card is now present in the catalogue, deck-building data, selection UI, compendium, source/provenance pipeline, and typed rules-definition layer. Effects expressible through the simulator's existing rule actions are compiled into executable actions.

The current engine does not yet expose dedicated runtime primitives for every physical-game operation introduced or heavily used by BR/AA. In particular, single-Bakugan rerolls, BakuCore swaps, arbitrary opponent-hand inspection/play, coin flips, some multi-branch Battle Mastery choices, and several stateful replacement effects still require additional executor/UI work for exhaustive automatic resolution. These cards remain available and retain their exact printed text and structured definition, but this pull request should not be described as complete rules automation for every complex interaction until those primitives and golden match tests are added.

## Deployment

Merging the pull request will make the three-set catalogue available to the normal Cloudflare deployment pipeline. The live Worker is not changed by this branch until it is merged and deployed.
