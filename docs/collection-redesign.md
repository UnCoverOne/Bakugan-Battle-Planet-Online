# Collection redesign

Collection is the account-specific counterpart to the Compendium. It uses the same navigation, search, responsive sidebar, card/core artwork, density settings and pagination. All catalogue identities are visible by default. Detailed view retains the name, compact view retains all three counters; neither displays information tags.

## Counters

The counter strip displays Standard, Foil and Wishlist, including zero. Pressing a counter opens a fixed-position portal above it (below or clamped if necessary). The editor never participates in gallery layout. Minus and plus operate on the selected physical printing, and typed quantities apply on Enter or blur; Escape dismisses the editor. An outside click closes it. Multiple eligible printings require an explicit choice. Set filters scope both the gallery and the aggregate quantities to the eligible sets. Fused card backs map to their physical fronts.

## Data

Collection status and individual quantity filters (0, 1, 2, 3+) supplement the shared catalogue filters. The unified sorting field includes catalogue and quantity orderings. Standard and foil alone contribute to total ownership; wishlist is independent. The existing account data gate, AppProvider, collection update function, local cache and D1 entity are unchanged. No schema migration is required.

## Verification

Run the collection and compendium regression tests, then the visual collection spec (the latter uses a mocked account, not real collection data):

```sh
node --import tsx --test tests/collection.test.ts tests/compendium-experience.test.ts
npm run check:palette
npm run lint
npm run build
npm run test:visual -- tests/visual/collection.spec.ts
```

For real persistence verification, use a dedicated test account and follow [the collection persistence runbook](collection-persistence-runbook.md). Do not use production data for visual tests.
