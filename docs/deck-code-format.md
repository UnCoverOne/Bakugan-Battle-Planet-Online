# Portable Deck Codes (BBP2)

**Current export prefix:** `BBP2.`  
**Accepted import prefixes:** `BBP2.` and legacy `BBP1.`

## Purpose

A Deck Code is a self-contained **deck recipe**, not a Deck Library record. New codes contain only:

- Character catalogue identities (ordered).
- BakuCore catalogue identities (ordered, including duplicates).
- Main Deck catalogue identities with copy counts.
- Selected format: Standard, Singleton, or Competitive.
- Optional active **non-default** card and BakuCore printings.

The exporter intentionally excludes the deck's name, description, creator, visibility,
publication/export timestamp, factions, and chosen featured card. Importing BBP2 gives
the deck a local **Imported Deck** name (uniquified by the Deck Library), makes it
Private, derives factions from the Character team, and selects a featured card.

BBP2 requires neither a server nor a lookup table tied to the current catalogue
ordering. It is synchronous, so all existing copy-code and share/export actions
continue to work without changing their calling convention.

## Wire format

After `BBP2.`, the body is unpadded Base64URL of compact binary data:

| Field | Encoding |
|---|---|
| Format | Single byte: 0 Standard, 1 Singleton, 2 Competitive |
| Characters | Varint count, followed by that many card-ID tokens |
| BakuCores | Varint count, followed by that many core-ID tokens |
| Main Deck | Varint number of unique catalogue IDs, followed by (card-ID token, varint copies) pairs |
| Printing preferences | Varint count, followed by (kind, source-ID, selected-printing-ID) triples |
| Integrity | Four-byte little-endian CRC-32 of the prior bytes |

All variable integers use unsigned base-128 varints. The Main Deck ID groups
are sorted by catalogue ID for reproducible codes, so the deck's *order of entries*
is not preserved; identities and quantities are preserved.

**Card IDs:** For canonical `<prefix>-<number>` IDs, the varint token
is `number * 32 + setTag * 2`. The set tag registry is frozen inside
`lib/deck-code-v2.ts`: BB, BR, AA, AV, FF, DI, PS1, SV, CP, EX in that
order. Odd token 1 is reserved for a length-prefixed UTF-8 literal ID, so
unrecognised future ID shapes still encode without a breaking change.

**Core IDs:** `core-N` and `aa-core-N` use `N * 4 + 0/1`.
Token 2 is the literal escape. Core alternate printings of the form
`aa-printing-N` use `N * 2`, with token 1 as the literal escape.

**Printing preferences:** Kind 0 is a card preference, with the playable
source card's catalogue ID plus the preferred card printing ID. Kind 1 is a
BakuCore preference, with its canonical core ID plus alternate core printing ID.
The current `cardPrintingKey`/`corePrintingKey` is recomputed on import.
Unused preferences are omitted; no long construction-identity strings are stored.

## Safety and forwards compatibility

- The decoder rejects invalid checksums, malformed integers, invalid counts,
  unknown playable catalogue IDs, trailing payload data, and oversized codes.
- A 200-card ceiling prevents excessively large binary allocations; this is **not**
  a permitted deck size. The Deck Library applies the real selected-format
  construction rules after decoding.
- Competitive imports use the currently published deck size and restrictions,
  not a hardcoded 40-card limit. Import is held until those rules are available.
- **Do not reorder the existing card-set tag registry.** Adding a new set
  should append a new stable tag if one is free; the literal-ID escape works
  if none is available.
- CRC-32 detects accidental corruption. It is **not a signature** and does not
  authenticate the deck or its creator.

BBP1 imports retain their older name, description and printings; their format
is now preserved, including Competitive. New exports always use BBP2.

## Regression coverage

`tests/deck-code-v2.test.ts` covers round-trip content and format preservation,
deterministic/short codes, printing preferences, multiple catalogue sets,
corruption/size rejection and BBP1 compatibility. The existing
`tests/deck-printings.test.ts` covers card and core alternate-printing selections.

Run locally with `node --import tsx --test tests/deck-code-v2.test.ts tests/deck-printings.test.ts`,
followed by `npm test` for the full project regression/build pipeline.
