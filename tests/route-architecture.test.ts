import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const routes = [
  "app/(workspace)/dashboard/page.tsx",
  "app/(workspace)/decks/page.tsx",
  "app/(workspace)/decks/[id]/page.tsx",
  "app/(workspace)/decks/public/page.tsx",
  "app/(workspace)/decks/public/[id]/page.tsx",
  "app/(workspace)/builder/[id]/page.tsx",
  "app/(workspace)/compendium/[[...segments]]/page.tsx",
  "app/(workspace)/play/page.tsx",
  "app/(workspace)/play/lobby/page.tsx",
  "app/(workspace)/play/match/page.tsx",
  "app/(workspace)/play/result/page.tsx",
  "app/(workspace)/history/[[...segments]]/page.tsx",
  "app/(workspace)/profile/[[...segments]]/page.tsx",
  "app/(workspace)/settings/page.tsx",
];
const source = (path: string) => readFileSync(path, "utf8");

test("product screens are represented by App Router modules", () => {
  for (const path of routes) assert.equal(existsSync(path), true, `${path} should exist`);
});

test("workspace routes have loading, error, and not-found boundaries", () => {
  for (const path of ["app/(workspace)/loading.tsx", "app/(workspace)/error.tsx", "app/(workspace)/not-found.tsx"]) assert.equal(existsSync(path), true, `${path} should exist`);
});

test("the root layout owns shared persistence and account providers", () => {
  const layout = source("app/layout.tsx");
  assert.match(layout, /<AppProvider>/);
  assert.match(layout, /<AppShell>/);
});

test("the root graph has no static catalogue, reference, or gameplay imports", () => {
  const root = `${source("app/page.tsx")}\n${source("components/application/AppProvider.jsx")}`;
  assert.doesNotMatch(root, /from ["'][^"']*lib\/reference["']/);
  assert.doesNotMatch(root, /from ["'][^"']*lib\/data["']/);
  assert.doesNotMatch(root, /from ["'][^"']*GameplayRuntime["']/);
});

test("catalogue and reference data are route-local and gameplay is dynamically isolated", () => {
  assert.match(source("components/routes/DeckRoutes.tsx"), /from ["']\.\.\/\.\.\/lib\/data["']/);
  assert.match(source("components/routes/CompendiumScreen.tsx"), /from ["']\.\.\/\.\.\/lib\/reference["']/);
  const runtime = source("components/routes/MatchRuntime.tsx");
  assert.match(runtime, /dynamic\(/);
  assert.match(runtime, /import\(["']\.\.\/game-screen-v2\/GameplayRuntime["']\)/);
  assert.match(runtime, /ssr:\s*false/);
});

test("the match route primes live provider state before gameplay mounts", () => {
  const runtime = source("components/routes/MatchRuntime.tsx");
  const store = source("components/game-screen-v2/matchStore.ts");

  assert.match(runtime, /useApp\(\)/);
  assert.match(runtime, /primeMatchStore\(\{/);
  assert.match(runtime, /bootstrappedMatchId !== match\.id/);
  assert.match(runtime, /MATCH COULD NOT BE RESTORED/);

  assert.match(store, /export function primeMatchStore/);
  assert.match(store, /gameplayRouteForPathname\(window\.location\.pathname\)/);
  assert.match(store, /readStorage\(sessionStorage, CAPABILITY_KEY\)/);
  assert.match(store, /candidate\.version >= snapshot\.match\.version/);
});
