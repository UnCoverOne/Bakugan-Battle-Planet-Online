# Frontend clean-slate branch

This branch intentionally removes the existing shared visual presentation while preserving the application's functional systems.

## Current reset

- `app/layout.tsx` imports **only** `app/blank-slate.css` (basic accessibility and document-flow mechanics, with no branded visual language).
- Existing global style layers, hero polish, font loader and branded favicon are no longer loaded.
- `components/application/AppShell.jsx` is now a native HTML navigation and control shell, retaining account access, sign-out with unsynced data recovery, match resume, social provider, toasts, offline status, version checks and account loading gates.
- Home uses `components/routes/BlankDashboardScreen.tsx`, with plain links and stored data summaries, not the old branded hero or its artwork.
- The original `DashboardScreen.tsx` and historical CSS files remain in Git as a reference and are not imported by the shared layout.

## Not yet completed

Route-level CSS Modules and presentation components still exist. The deck builder, compendium, game board, match creation, account dialogs and other feature screens are **not yet blank-slate**. Some may appear partially broken because their legacy layouts rely on removed global styling. Complete feature-preserving refactoring must be done screen by screen. No build or end-to-end verification has been performed for the current reset.

**Do not merge into main or treat as feature-parity release until route tests pass.**

## Protected systems

Engine, APIs, D1 persistence, user storage, match state, server bindings and content records have not been intentionally modified by the visual reset.

## Safe verification

```sh
npm ci
npm run lint
npm run test:performance
npm run test:visual
npm test
```

Cloudflare Worker previews require separate D1/R2 resources before exercising stateful functions. Do not point a Preview at production or use the production migration/publish scripts.

## Follow-up migration

1. Capture baseline performance and browser screenshots.
2. Audit route-specific CSS Modules and inline styles for each route.
3. Replace visual components with native HTML controls without removing their state and event handlers.
4. Keep functional images such as card artwork only where necessary for gameplay; remove decorative-only assets.
5. Remove unreferenced visual CSS and assets from the branch after each tested migration.
6. Verify all routes, mobile, keyboard interaction, authentication, local/cloud persistence and multiplayer before merging.
