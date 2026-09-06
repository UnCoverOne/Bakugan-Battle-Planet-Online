# Card asset contract

Card scans are stored in two variants:

- `full/` preserves the supplied scan's native pixel dimensions (with EXIF
  orientation normalized and a transparent rounded-corner mask).
- `thumb/` is a proportional 160x224 canvas for hands, catalogues and other
  repeated small surfaces.

Use `cardArtSource(card, "thumbnail")` (or the shared responsive card image)
for dense surfaces and `cardArtSource(card, "full")` for inspectors, enlarged
previews and exports. Flip cards use the same physical portrait canvas; the
readable presentation applies the shared rotate/scale transform in `CardArt`.

## Importing any set

The native importer recognizes all current set codes: BB, BR, AA, AV, FF, SV,
PS1, CP, DI, EX and GG. Card filenames normally include the code (for example
`Aquofreeze_Beam_ENG_2_CO_FF.png`). If an exported filename omits the final
`_{SET}` token, the importer infers the code from the archive name (for
example `Armored Elite Card Images.zip` → AV or `DI Card Images.zip` → DI).

Pass one `--archive` option for each ZIP. The first copy of a duplicate card
wins; byte-identical duplicates are skipped and conflicting copies stop the
import so an incorrect image cannot silently replace a card.

```sh
npm run assets:native -- \
  --archive "D:/Channel/B2/Card Images/ZIP Files/Age of Aurelus Card Images.zip" \
  --archive "D:/Channel/B2/Card Images/ZIP Files/Armored Elite Card Images.zip" \
  --archive "D:/Channel/B2/Card Images/ZIP Files/Bakugan Resurgence Card Images.zip" \
  --archive "D:/Channel/B2/Card Images/ZIP Files/Battle Brawlers Card Images.zip" \
  --archive "D:/Channel/B2/Card Images/ZIP Files/CP Card Images.zip" \
  --archive "D:/Channel/B2/Card Images/ZIP Files/DI Card Images.zip" \
  --archive "D:/Channel/B2/Card Images/ZIP Files/EX Card Images.zip" \
  --archive "D:/Channel/B2/Card Images/ZIP Files/Fusion Force Card Images.zip" \
  --archive "D:/Channel/B2/Card Images/ZIP Files/Geogan Generations Card Images.zip" \
  --archive "D:/Channel/B2/Card Images/ZIP Files/Missing Card Images.zip" \
  --archive "D:/Channel/B2/Card Images/ZIP Files/PS1 Card Images.zip" \
  --archive "D:/Channel/B2/Card Images/ZIP Files/Shields of Vestroia Card Images 1.zip" \
  --archive "D:/Channel/B2/Card Images/ZIP Files/Shields of Vestroia Card Images 2.zip"
```

Known Flip/Flip Hero ranges are applied automatically for BB, BR, AA, AV, FF
and SV. For a new set, add its range without changing the importer, for example:

```sh
npm run assets:native -- --archive "path/to/new-set.zip" --flip-range GG:1-20
```
