# Collection persistence recovery and verification

The signed-in collection uses the `collection:main` entry in the `user_data_entities`
Cloudflare D1 table. Each entry is keyed by catalogue ID and contains
`standard`, `foil`, and `wishlist` quantities.

## Production prerequisites

1. Run `npm run cf:migrate` against the correct production database. In
   particular, `migrations/0008_collection_entity.sql` widens the historic
   `user_data_entities.entity_type` SQLite CHECK constraint.
2. Run `npm run cf:verify-collection`. Deployment is now blocked if the
   connected remote D1 table does not support `collection`.
3. To inspect manually, use:
   ```sh
   npx wrangler d1 execute DB --remote --config wrangler.jsonc --yes \
     --command "SELECT sql FROM sqlite_master WHERE type='table' AND name='user_data_entities'"
   ```
   The returned SQL must include `'collection'` in the allowed entity types.

## Account-level smoke test

Use a non-production test account or a dedicated catalogue entry. Avoid
overwriting real user quantities during testing.

1. Log in and wait until the account collection has loaded.
2. Add distinct non-zero values to a card's standard, foil, and wishlist counts,
   plus a BakuCore count.
3. Wait for the collection header to read **Synced to your account**. If it reads
   **Collection sync failed**, stop: do not clear browser data.
4. Check the authenticated browser Network tab: a `PUT /api/user-data` should
   include a `collection:main` update and succeed. The response should include
   a `collection:main` revision.
5. Request `GET /api/user-data` with the same signed-in session. Verify its
   `data.collection` has the exact quantities and `revisions.collection:main`
   exists.
6. Log out and log back in on the same browser; then sign in on a different
   browser or device and verify all quantities.
7. Edit a different card on the second device, then refocus the first. Check
   both devices converge without losing the previously saved counts.

## Failure classification

- `PUT` fails with a D1 CHECK/constraint error: production collection schema
  is outdated. Apply the migration; do **not** treat the save as complete.
- `PUT` returns a validation error: inspect the `collection:main` payload.
  Normalisation requires non-negative integer counters up to 999 and catalogue
  IDs up to 160 characters.
- `PUT` returns 409: the entity revision changed elsewhere. The client must
  merge counter deltas and retry rather than replace the whole collection.
- `GET` has no `collection:main` revision despite a locally cached non-empty
  collection: the client attempts safe recovery from that same account's browser
  cache and re-uploads the missing entity.
- `GET` has an explicitly revisioned empty `collection:main`: do not silently
  overwrite it from a stale browser cache. Investigate audit history/backups.

## Preserving existing data

Do not delete the site data or account cache while diagnosing an affected
account. The per-account `bbp-account-cache-v2:<user-id>` browser entry may
contain the only remaining copy of unsynced collection quantities. Keep any
manual export private. Users who changed devices and have neither a D1 copy
nor a browser cache cannot be automatically recovered by this patch.
