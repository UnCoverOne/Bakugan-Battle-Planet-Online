# Armored Alliance content implementation

The catalogue now includes Armored Elite (AV), Fusion Force (FF), Shields of Vestroia (SV), Blind Box 1 (PS1), Cubbo Pack (CP), and Diamond Indomitable (DI). Together these add 889 records and bring the simulator catalogue to 1,734 cards.

## Runtime support

- `Flip Hero` cards are legal Flip responses and enter the Hero zone after resolving.
- `Baku-Gear` cards choose a Bakugan, occupy its gear slot, and contribute their printed B-Power and Damage bonuses.
- Dual-faction cards expose both factions for deck validation and card filtering.
- Fusion character faces retain pair and face metadata; the reverse face supplies the fused characteristics.
- Armored Alliance keywords are tagged for search and rules provenance: Boost, Sync, Trifecta, Rapid Fire, Empower, Baku-Gear, and Fusion.

## Reproducible import

Run `scripts/import-armored-alliance.py` with the supplied PDFs and image archives to rebuild the generated TypeScript rows and optimized full/thumbnail WebP scans. Records without a supplied image use the repository's missing-card artwork.

The importer preserves collector suffixes such as `203a`, creates stable unique catalogue IDs, and contains explicit corrections for cards whose spreadsheet rows were incomplete but whose printed scans were readable.
