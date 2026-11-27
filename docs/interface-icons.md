# Interface icons

Use the shared `LucideIcon` adapter for general-purpose interface symbols. The catalogue vendors the exact SVG children from Lucide v0.468.0, with upstream blob hashes and the original licence in THIRD-PARTY-NOTICES.md. No icon package or lockfile change is required. Add future icons from the official tagged upstream SVG source rather than drawing an approximation. Use a descriptive accessible name on icon-only controls; glyphs are decorative by default. Keep Bakugan faction artwork, BakuCore art, fusion symbols, gameplay phase illustrations, roll paths, game grids and other mechanic-specific drawings independent.

Run `node --import tsx --test tests/lucide-icons.test.ts` and the normal build/visual suite. Verify interface alignment at desktop and mobile sizes, including match controls, deck inspection, filters, account dialogs and replay controls.
