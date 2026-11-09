# Frontend clean-slate branch

This branch intentionally removes the existing shared visual presentation while preserving the application's functional systems.

## Current reset

- `app/layout.tsx` imports **only** `app/blank-slate.css` (basic accessibility and document-flow mechanics, with no branded visual language).
- Existing global style layers, hero polish, font loader and branded favicon are no longer loaded.
- `components/application/AppShell.jsx` is now a native HTML navigation and control shell, retaining account access, sign-out with unsynced data recovery, match resume, social provider, toasts, offline status, version checks and account loading gates.
- Home uses `components/routes/BlankDashboardScreen.tsx`, with plain links and stored data summaries, not the old branded hero or its artwork.
- The original `DashboardScreen.tsx` and historical CSS files remain in Git as a reference and are not imported by the shared layout.

## Route-level styling reduction

All **80 CSS Modules** used by application and game components have been rewritten to retain structural mechanics (layout, visibility, geometry, pointer interactions, and scrolling) while removing decorative declarations (colours, gradients, shadows, background imagery, clip-paths, typography overrides, and animation/transition effects). This includes decks, collection, compendium, match creation, lobby, settings, profiles, admin, dialogs, filters, and the gameplay board. This is a bulk CSS-only reduction; state-management and engine files were not changed.

Older, unimported global stylesheets remain in the repository for now as historical references. Individual components can still render decorative image elements, inline style attributes, SVG ornamentation, and visual design embedded directly in JSX. Those are **not** fully stripped by this pass. Some layout elements may also appear broken or visually ambiguous because their former background and decoration were removed.

No build, browser verification, or end-to-end testing has been performed for this latest bulk reset; full feature parity is not yet confirmed.

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
2. Audit remaining JSX inline styles, decorative SVGs and image elements per route.
3. Replace visual components with native HTML controls without removing their state and event handlers.
4. Keep functional images such as card artwork only where necessary for gameplay; remove decorative-only assets.
5. Remove unreferenced visual CSS and assets from the branch after each tested migration.
6. Verify all routes, mobile, keyboard interaction, authentication, local/cloud persistence and multiplayer before merging.
