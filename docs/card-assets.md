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

Regenerate supplied native scans with:

```sh
npm run assets:native -- --archive path/to/cards.zip
```
