# Frontend clean-slate branch

This branch was created from `main` to rebuild presentation without altering the production application.

## Phase 1: safe and reversible shell reset

- `app/frontend-clean-slate.css` is loaded **last** in `app/layout.tsx`.
- It replaces accumulated shared header/chrome styling with a small, neutral baseline.
- The original page components, including the immersive match interface, remain mounted.
- The existing global CSS is **not deleted yet**. Many selectors are still consumed by route components; deleting styles blindly would disable affordances or hide controls.
- `AppProvider`, account and guest synchronization, multiplayer, the game engine, D1 persistence, APIs, static content and deployment settings are unchanged.
- No changes to `main` are intended. Do not merge until all feature and UI regressions are checked.

## Next safe steps

1. Capture baseline bundle sizes, network payloads, React commits, and DOM node counts for each route.
2. Inventory global CSS selectors and determine which are used by each route and component.
3. Extract a small design-token and component-primitives layer, then replace route CSS incrementally.
4. Refactor `AppShell` into smaller presentation components without changing authentication, session-resume, offline, account, social or navigation behavior.
5. Rebuild each screen in isolation; remove its old styling only after behavioral and visual regression tests pass.
6. Profile first load and in-match updates separately. Hidden DOM, mounted overlays and lazy components are different from visible elements and can each affect performance.

## Verification (required before claiming parity)

```sh
npm ci
npm run lint
npm run test:performance
npm run test:visual
npm test
```

Note: some scripts may require local Cloudflare environment setup. For preview deployments use isolated non-production credentials and a separate D1 database; a separate Git branch does **not** isolate external storage or worker deployments.

## Scope of the first commit

This is a **presentation baseline**, not a complete CSS removal or a fully redesigned game interface. The legacy route styles intentionally remain so that functionality is preserved while we progressively migrate.

## Cloudflare Worker Preview deployment

`wrangler preview` requires a `previews` section. The branch declares Preview image and Durable Object bindings. Durable Object namespaces are automatically isolated for each Preview.

**Data isolation is deliberately incomplete until separate resources exist.** The Preview configuration intentionally omits `DB` (D1) and `MUSIC_BUCKET` (R2), rather than binding to production. This allows an isolated visual shell to be tested but account, match persistence, and media operations depending on these bindings will not work correctly until staging resources are configured.

To enable full functionality:

1. Create a new D1 database and R2 bucket for previews (do not reuse production names or IDs).
2. Add `previews.d1_databases` with binding `DB`, its staging `database_name` and real `database_id`. Add `previews.r2_buckets` with binding `MUSIC_BUCKET` and its staging `bucket_name`.
3. Use a separate migration config pointing only to the staging D1 database; apply all required schema migrations before gameplay/auth tests.
4. Ensure preview secrets and other remote bindings are configured separately.
5. Run the Preview deployment, and test auth, deck saving, multiplayer and social features against staging data.

Never run the production `cf:migrate` / `cf:publish` scripts to set up the preview: they explicitly target the production configuration.
