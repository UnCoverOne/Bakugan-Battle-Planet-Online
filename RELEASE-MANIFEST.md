# Release manifest

- Package: Bakugan Battle Planet Online self-hostable source
- Prepared: 2026-07-14
- Website source revision: the Git commit used to build this archive (`git rev-parse HEAD`).
- Card catalogue records: 374
- Optimized full-card images: 364
- Optimized BakuCore images: 52
- Runtime: Cloudflare Worker plus static assets
- Persistent storage: Cloudflare D1 binding `DB`

## Self-host additions

- Preserved the OpenAI Sites project identifier for the managed deployment; it is ignored by the Cloudflare configuration.
- Added `wrangler.jsonc` with a clearly marked placeholder D1 database ID.
- Added Cloudflare build/deploy scripts to `package.json`.
- Added `SELF_HOSTING.md`, a GitHub Actions template, asset notice, and project README.

## Match UX revision

- Rebuilt the match as an immersive, full-viewport tabletop.
- Enlarged the legal play area, true axial hex matrix, BakuCores, Bakugan, hand, and match HUD.
- Moved primary card interaction to the hand with legal-state styling and a readable card inspector.
- Added active phase progress, turn status, stronger priority instructions, and expanded combat math.
- Centred the hand, corrected BakuCore and card-back assets, mirrored the opponent zones, restored visible actions, and unified card inspectors.

## Verification completed

- `npm ci`: passed with the locked dependency tree.
- `npm run build`: passed; Vinext produced the Worker and client assets.
- artifact validation: passed; the ESM Worker exposes `default.fetch`.
- rendered application test: passed.
- `npm run lint`: completed with zero errors and existing non-blocking warnings.
- Wrangler deployment dry run: passed; detected 487 static files and both `DB` and `ASSETS` bindings.

Generated directories and credentials are not included in the release archive. Recreate dependencies and builds using the commands in `SELF_HOSTING.md`.
