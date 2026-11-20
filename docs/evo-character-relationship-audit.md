# Evo-to-Character relationship audit — Epic Character update

**Status: DRAFT, not approved for gameplay.** Updated 20 November 2026 against `redesign/frontend-clean-slate`.

## Files

- [Full 336-Evo mapping (JSON)](../content/evo-character-relationships.audit.json)
- [Full 336-Evo mapping (CSV)](../content/evo-character-relationships.audit.csv)
- [Epic-to-regular Character pairing audit (JSON)](../content/epic-character-equivalences.audit.json)
- [Integrity and regression tests](../tests/evo-character-relationship-audit.test.ts)

## Corrected rule

**An Evo can be played on either the regular Character Card or the corresponding Epic Character Card.** Epic Character cards are variants of their respective Characters, including Fusion versions, not separate incompatible Evo bases. This project rule was confirmed by the user and aligns with the [Epic Character Card overview](https://bakugan.wiki/wiki/Epic_Character_Card).

**Do not confuse an Epic Character counterpart with another, unrelated, same-name Bakugan.** For example, Aquos Hyper Pegatrix BB 219 is linked to BB 292, **not** AV 172. The existence of a later Epic does not turn every same-name Character into a legal target.

The `targetCharacterIds` array deliberately allows **multiple legal catalogue Character IDs** for one Evo. `epicCharacterTargetIds` identifies which targets are Epic variants. The `requiresFusedFace` flag still applies to all targets of a Fusion Evo. Epic Fusion Characters must remain distinct from both their corresponding regular Fusion Character and their unfused face.

### Relationship coverage

| Expansion | Evos | Mapped candidates | Individual review |
| --- | ---: | ---: | ---: |
| BB | 66 | 66 | 0 |
| BR | 81 | 81 | 0 |
| AA | 85 | 85 | 0 |
| AV | 41 | 41 | 0 |
| FF | 26 | 25 | 1 |
| SV | 20 | 15 | 5 |
| PS1 | 16 | 16 | 0 |
| EX | 1 | 1 | 0 |
| **Total** | **336** | **330** | **6** |

- **23 Evo records** now have two candidate Character IDs instead of one, for **353 proposed target links**.
- **89 Epic Character catalogue records** were examined (including each side of Epic Fusion cards).
- **54 Epic-to-regular counterpart relationships** resolve uniquely under the conservative catalogue pairing rule.
- **35 Epic Character records** have no uniquely matched regular counterpart in the controlled catalogue. These may be Epic-only representations or incomplete/irregular catalogue metadata; they are **not** automatically missing game cards. They remain documented in the separate Epic pairing audit.
- Eight original Evo relationships have individual source references; most other relationships, including newly inferred Epic equivalences, **still require printed-artwork/source verification** before enabling strict gameplay validation.

### Examples of valid alternative Character IDs

| Evo | Regular Character | Epic Character | Notes |
| --- | --- | --- | --- |
| `av-118` Aquos Hyper Howlkor Ultra | `av-166` | `ff-217` | Epic was published in a later set |
| `av-131` Darkus Hyper Pegatrix | `av-205` | `ff-224` | Does **not** imply BB 323 |
| `ff-133` Darkus Hyper Tretorous Ultra | `av-210` | `ff-226` | Earlier audit incorrectly selected only the Epic card |
| `ff-135` Darkus Maximus Gillator Ultra | `av-208` | `ff-225` | Earlier audit selected only the Epic card |
| `ps1-1` Aquos Hyper Howlkor | `av-165` | `ff-216` | Explicit `AV` base, later Epic version |
| `sv-135` Darkus/Aquos Diamond Howlkor x Ramparian | `ff-171b` | `sv-226b` | **Fused** face required for both |
| `sv-139` Pyrus/Aurelus Diamond Pharol x Gillator Ultra | `sv-220b` | `sv-260b` | Resolved the previous ordinary/Epic ambiguity |

The `sv-139` mapping is now a **catalogue-inferred candidate**, not an independently scan-confirmed ruling. The other six pending cases remain unapproved.

### Six remaining Evo review cases

| Evo ID | Candidate(s) | Why still unresolved |
| --- | --- | --- |
| `ff-129` | `ff-164` + `ff-222` (regular/Epic), possibly `bb-302` | Source Evo ID explicitly claims `[AV]`, but no corresponding AV Character exists. Epic equivalence alone does not resolve the set conflict |
| `sv-137` | `sv-253` | Source claims an AV version but only SV Epic is catalogued |
| `sv-141` | `bb-357`, `av-234` | Evo's identification is missing from source |
| `sv-146` | `sv-206b` | The dual-faction fused identity is inconsistent with available Character metadata |
| `sv-149` | `sv-220b` + `sv-260b` (regular/Epic) | Their Epic equivalence is clear, but the Evo's source name and identification still need independent review |
| `sv-261` | None | Intended Haos/Pyrus fused Character is not in the controlled catalogue |

**No production integration:** No Inspector or gameplay rules were changed by this audit. Neither `candidateCharacterIds` on an unresolved record nor the separate Epic pairing candidates should grant legal game targets automatically.

## How pairing candidates were generated

1. Recognize Epic cards from the catalogue's `Epic Character` rarity, rather than their statistics or effect text.
2. Compare normalized **Character name, all factions, and Fusion face**. A regular Fusion's front side is compared through the identity of its paired fused side to avoid mixing different dual-faction versions that share a front-side name.
3. Prefer a regular Character in the Epic's own release; otherwise select the nearest earlier compatible set **when exactly one candidate remains**. Never select a different-name, different-faction, or future set card solely for convenience.
4. Extend a mapped Evo's valid Character IDs in both directions along uniquely resolved regular↔Epic pairings. This includes cases where the previous draft identified *only* the Epic version.
5. Keep source conflicts and missing/ambiguous counterpart entries explicit. This is not a substitute for validating the actual Evo identification graphic and any published corrections.

Examples of the same-name but **wrong set/version** that stay excluded: `bb-219` → `bb-292` **not** `av-172`; `bb-270` → `bb-343` **not** `av-233`.

## Earlier source-checked anchors

- `bb-219` → `bb-292` ([Battle Brawlers](https://bakugan.wiki/wiki/Battle_Brawlers_(set)))
- `bb-270` → `bb-343`
- `aa-78` → `br-179` ([Age of Aurelus](https://bakugan.wiki/wiki/Age_of_Aurelus))
- `av-117` → `av-160` ([Armored Elite](https://bakugan.wiki/wiki/Armored_Elite))
- `br-114` → `bb-323` (catalogue says incorrect Pegatrix Ultra; [Bakugan Resurgence](https://bakugan.wiki/wiki/Bakugan_Resurgence))
- `av-144` → `av-246` (catalogue drops Ultra; [Diamond Gillator Ultra](https://bakugan.wiki/wiki/Diamond_Gillator_Ultra_(Armored_Elite)))
- `sv-143` → `av-264` ([specific card/ruling](https://bakugan.wiki/wiki/Ventus_Titan_Pegatrix_Ultra_(Shields_of_Vestroia)))
- `ex-2` → `ex-1`

**Deployment warning:** The current game engine's `evoIdentities()` and the Inspector's `matchesBase()` still use their original inference logic. These data artefacts are a **reviewed candidate registry**, not a running rules change. Before wiring this into gameplay, confirm the remaining identity disputes and visually review inferred equivalences.
