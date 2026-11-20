# Evo-to-Character relationship audit

**Status: DRAFT — not yet approved for gameplay.** Generated 20 November 2026 against the `redesign/frontend-clean-slate` controlled catalogue.

## Deliverables

- [Machine-readable mapping](../content/evo-character-relationships.audit.json): all 336 Evos with stable Character IDs, confidence, raw catalogue identifiers, source references and review candidates.
- [Reviewable CSV](../content/evo-character-relationships.audit.csv): identical coverage, one Evo per row.
- [Automated audit tests](../tests/evo-character-relationship-audit.test.ts): completeness, referential integrity and known relationship regressions.

**Coverage:** all 1,734 controlled catalogue records, including 336 Evos and 644 Character records.

| Set | Evos | Unique candidate | Manual review |
| --- | ---: | ---: | ---: |
| Battle Brawlers (BB) | 66 | 66 | 0 |
| Bakugan Resurgence (BR) | 81 | 81 | 0 |
| Age of Aurelus (AA) | 85 | 85 | 0 |
| Armored Elite (AV) | 41 | 41 | 0 |
| Fusion Force (FF) | 26 | 25 | 1 |
| Shields of Vestroia (SV) | 20 | 14 | 6 |
| Blind Box 1 (PS1) | 16 | 16 | 0 |
| EX | 1 | 1 | 0 |
| **Total** | **336** | **329** | **7** |

**Confidence distinction:** `mapped_candidate` means the controlled catalogue yields one exact playable Character candidate under the rules below. It does **not** mean that all 329 were independently checked against a printed scan, official ruling or card-index entry. Eight highlighted relationships have `reviewState: "source_checked"` and an evidence URL; the other 321 mapped candidates still require final source review before use in the engine. `needs_review` entries have **no approved target** and should not be consumed by gameplay.

## Mapping method

1. Read the original `evolvesFrom` transcription, without overwriting it. It is stored as `catalogueEvoIdentifier`, since source workbooks can be erroneous.
2. Preserve faction(s), including dual factions and the distinction between normal and Ultra versions. Normalize spacing, punctuation and `&` versus `x` only for character-name lookup.
3. Honor explicit set qualifications such as `[AV]` and `AV`. Otherwise prefer one exact eligible Character within the Evo's set; if none, accept **only one** exact match from a prior compatible expansion. Never accept future-set matches or all same-named Characters.
4. For Fusion Evo IDs, match the fused `b` face, storing `requiresFusedFace: true`. An implementation must separately check that the Bakugan is fused. Do not mistake a fused Character face for an alternate printing.
5. Where source data conflicts, a target is missing, or distinct Character versions remain plausible, put the Evo into `needs_review`. Do not choose the first match.

The matching policy is a **first-pass candidate generator**, not an official card-identity rule. The published set listings, original Evo-identification artwork and relevant rulings must settle outstanding uncertainties.

## Source-checked anchor cases

| Evo | Character | Finding |
| --- | --- | --- |
| `bb-219` Aquos Hyper Pegatrix | `bb-292` | **Not** `av-172`; Battle Brawlers identity |
| `bb-270` Pyrus Titan Dragonoid | `bb-343` | **Not** `av-233` |
| `aa-78` Aquos Diamond Vicerox | `br-179` | Valid cross-expansion relationship |
| `av-117` Aquos Hyper Dragonoid | `av-160` | Explicit `[AV]` |
| `br-114` Darkus Hyper Pegatrix | `bb-323` | Original catalogue has a false `Ultra` qualifier |
| `av-144` Diamond Gillator Ultra | `av-246` | Original catalogue omits `Ultra` |
| `sv-143` Ventus Titan Pegatrix Ultra | `av-264` | Published clarification overrides mismatching Evo artwork |
| `ex-2` Dragonoid Maximus | `ex-1` | Unique paired EX identity |

The first seven entries have their supporting sources attached in the JSON; the EX pair is supported by its two-card catalogue. Notable references: [Battle Brawlers](https://bakugan.wiki/wiki/Battle_Brawlers_(set)), [Bakugan Resurgence](https://bakugan.wiki/wiki/Bakugan_Resurgence), [Age of Aurelus](https://bakugan.wiki/wiki/Age_of_Aurelus), [Armored Elite](https://bakugan.wiki/wiki/Armored_Elite), [Ventus Titan Pegatrix Ultra ruling](https://bakugan.wiki/wiki/Ventus_Titan_Pegatrix_Ultra_(Shields_of_Vestroia)), and [Diamond Gillator Ultra](https://bakugan.wiki/wiki/Diamond_Gillator_Ultra_(Armored_Elite)).

## Seven records requiring individual review

| Evo | Candidate Character(s) | Reason |
| --- | --- | --- |
| `ff-129` | `ff-164`, `ff-222`; also `bb-302` | Source claims `[AV]`, but the catalogue contains no corresponding AV Character; distinguish the regular/Epic FF versions using the artwork |
| `sv-137` | `sv-253` | Source claims an AV Character that does not exist in the controlled catalogue |
| `sv-139` | `sv-220b`, `sv-260b` | Two Pyrus/Aurelus fused Character versions |
| `sv-141` | `bb-357`, `av-234` | Evo identification missing entirely from source |
| `sv-146` | `sv-206b` (metadata discrepancy) | Intended Ventus/Haos fused identity cannot be matched to the source's one-faction Character metadata |
| `sv-149` | `sv-220b`, `sv-260b` | Possible source-name/type inconsistency; distinct regular/Epic fused versions |
| `sv-261` | none | The required Haos/Pyrus fusion Character is not present |

**Do not treat `candidateCharacterIds` in these seven records as permitted gameplay targets.** The target fields are empty by design.

## Integration guidance (not yet performed)

When each unresolved entry has been reviewed, the registry can become a shared source of truth for the Inspector's `Evolves from` / `Evolutions` links and the engine's `play.evolvesFrom`. A strict target checker must distinguish the Character version and require fusion for `requiresFusedFace` targets. Keep original identifiers and the review provenance for future corrections. Replace the Inspector's `matchesBase` and gameplay's `evoIdentities` inference **only after** full source verification and gameplay regression testing.

The files delivered here are standalone mapping/audit artefacts. **No gameplay logic or Inspector behaviour has been changed.**
