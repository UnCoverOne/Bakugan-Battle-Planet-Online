# Evo-to-Character relationship audit

**Status: ACTIVE IN COMPENDIUM AND GAMEPLAY — user-confirmed exceptions incorporated; catalogue-inferred entries still require source review.** Updated 20 November 2026.

## Deliverables

- [Complete mapping (JSON)](../content/evo-character-relationships.audit.json), all 336 entries
- [Generated runtime registry](../content/evo-character-targets.json), compact Character IDs used by the game and Inspector
- [Shared registry API](../lib/evo-relationships.ts), including a reverse index for Character → Evo links
- [Reviewable mapping (CSV)](../content/evo-character-relationships.audit.csv), all 336 entries
- [Epic Character equivalence audit](../content/epic-character-equivalences.audit.json), 89 Epic records
- [Catalogue relationship validation tests](../tests/evo-character-relationship-audit.test.ts)

The mapping contains **335 Evos with at least one candidate legal Character target**, **one cancelled Evo with no target**, and **zero unresolved Evo identities** among the six previously disputed records. There are **359 target links**, including 24 Evo records with multiple regular/Epic variants. There are 8 earlier source-checked relationships and 5 newly user-confirmed legal mappings; **other catalogue-inferred candidates are not independently verified**.

## Six confirmed resolutions

These six entries were supplied and confirmed by the user on 20 November 2026. Original `catalogueEvoIdentifier` source values are preserved as-is and may be erroneous. The confirmed Character IDs take precedence in this audit.

| Evo | Confirmed target IDs | Notes |
| --- | --- | --- |
| `ff-129` — Aurelus Maximus Howlkor Ultra | `ff-164`, `ff-222` | Both regular and Epic; ignore erroneous `[AV]` in source |
| `sv-137` — Haos Maximus Gillator Ultra | `sv-253` | Only specified Epic Character target |
| `sv-141` — Pyrus Titan Dragonoid Ultra | `av-234` | Source omitted Evo identifier |
| `sv-146` — Ventus Diamond Maxotaur x Zentaur | **`sv-206b` only** | Fused only; **not `sv-206a`** |
| `sv-149` — Pyrus Diamond Pharol & Gillator Ultra | **`sv-220b` only** | Fused only; **not `sv-220a`** |
| `sv-261` — Haos Diamond Cyndeous x Skorporos | **None** | Cancelled; no corresponding Character, no playable evolution target |

The source data for SV 149 currently uses the name `Pyrus Pharol & Gillator Ultra`; the user-confirmed title is recorded in `confirmedEvoName` without silently altering the original catalogue row. `sv-149` is kept distinct from `sv-139`: `sv-139` remains mapped as a regular/Epic pair to `sv-220b` and `sv-260b`, whereas the explicitly confirmed `sv-149` mapping contains **only `sv-220b`**. In each case a Fusion Evo requires the correct **fused (b) face**, not its unfused (a) face.

The `sv-261` catalogue entry is preserved for traceability but marked `status: "cancelled_no_target"`. The absence of targets is deliberate and **must not** be treated as a fallback to name-based matching or as an unfinished audit.

## Current mapping coverage

| Expansion | Evos | Mapped | Cancelled | Unresolved |
| --- | ---: | ---: | ---: | ---: |
| Battle Brawlers (BB) | 66 | 66 | 0 | 0 |
| Bakugan Resurgence (BR) | 81 | 81 | 0 | 0 |
| Age of Aurelus (AA) | 85 | 85 | 0 | 0 |
| Armored Elite (AV) | 41 | 41 | 0 | 0 |
| Fusion Force (FF) | 26 | 26 | 0 | 0 |
| Shields of Vestroia (SV) | 20 | 19 | 1 | 0 |
| Blind Box 1 (PS1) | 16 | 16 | 0 | 0 |
| EX | 1 | 1 | 0 | 0 |
| **Total** | **336** | **335** | **1** | **0** |

### Regular and Epic Character rule

An Evo can evolve both the corresponding regular Character and its Epic Character variant, unless a specifically established target restriction applies. Different set versions sharing only a name are **not** necessarily compatible. The Epic equivalence audit documents **54 candidate counterpart pairings** from 89 Epic records, with 35 lacking a unique regular counterpart in the available catalogue. Those 35 are *pairing audit items*, not six unresolved Evo IDs.

Examples: `av-118` targets `av-166` and Epic `ff-217`; `ff-133` targets `av-210` and Epic `ff-226`. `bb-219` targets `bb-292`, **not** the unrelated same-name `av-172`.

### Provenance and safety

- `reviewState: "source_checked"`: linked earlier external card reference (8).
- `reviewState: "user_confirmed"`: direct user correction for five playable Evos and one cancelled Evo (6).
- `reviewState: "catalogue_inferred"`: uniquely identified through catalogue name, identity, faction, Fusion face and release history; **not yet independently verified**.
- `status: "mapped_candidate"`: one or more proposed legal Character IDs in `targetCharacterIds`.
- `status: "cancelled_no_target"`: no legal Character target; never fallback to other same-name cards.

## Runtime integration

The Compendium Inspector now reads exact Evo→Character and Character→Evo links from `lib/evo-relationships.ts`. It displays every compatible regular/Epic Character, links fused-only Evos to the **b face**, and explains that a cancelled Evo has no legal target.

The game engine compiles `play.evolvesFrom` from the same runtime registry, not from character-name/set inference. `canonicalEvoTargetAllowed` checks the **active Character face**: the fused `b` side is only targetable while the Bakugan is actually fused. All gameplay entry points using that validator inherit the new restrictions, including free-play and queued effects. Existing legal Evo stacking remains unchanged.

The compact runtime file is derived from the audit document; to update both, edit `content/evo-character-relationships.audit.json`, then run `node scripts/generate-evo-targets.mjs --write`. The regression suite checks every entry for exact consistency and tests version-specific, regular/Epic, fused-only and cancelled behaviour. A `--check` mode is available for CI or verification without changing files.

**Source verification remains necessary.** Most of the 335 active mappings are still catalogue-inferred. The Inspector and game now enforce those explicit candidate IDs rather than permissive name matching, but those relationships must be corrected if authoritative scans or rulings reveal further discrepancies.
