import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("card flights prepare assets and use an overlap handoff instead of blank frames", () => {
  for (const name of ["DrawAnimationLayer", "DiscardFlipAnimationLayer"]) {
    const source = read(`components/game-screen-v2/${name}.tsx`);
    const css = read(`components/game-screen-v2/${name}.module.css`);
    assert.match(source, /prepareAnimationAssets/);
    assert.match(source, /phase: "prepared"/);
    assert.match(source, /phase: "running"/);
    assert.match(source, /phase: "settling"/);
    assert.doesNotMatch(css, /animation-play-state:\s*paused/);
    assert.match(css, /will-change:\s*transform, opacity/);
  }
});

test("viewport stability ignores scroll and match publication is selector-aware and deferred", () => {
  const viewport = read("components/game-screen-v2/ViewportStabilityGuard.tsx");
  const store = read("components/game-screen-v2/matchStore.ts");
  assert.doesNotMatch(viewport, /visualViewport\?\.addEventListener\("scroll"/);
  assert.match(viewport, /bbp-viewport-stable/);
  assert.match(store, /shallowSelectorEqual/);
  assert.match(store, /scheduleMatchPersistence/);
  assert.match(store, /keepNewerInMemoryMatch/);
  assert.match(store, /pendingPersistedMatch\.id === inMemoryMatch\.id/);
  assert.match(store, /snapshot = \{ \.\.\.snapshot, match: normalized \};\s*notify\(\);/);
});

test("presentation systems queue work and avoid document-wide mutation observers", () => {
  const phase = read("components/game-screen-v2/PhaseTransitionLayer.tsx");
  const brawl = read("components/game-screen-v2/BrawlExperienceLayer.tsx");
  const cards = read("components/game-screen-v2/GameplayCardPresentationLayer.tsx");
  const cores = read("components/game-screen-v2/BakuCoreLayer.tsx");
  assert.match(phase, /transitionQueue/);
  assert.match(brawl, /resolutionQueue/);
  assert.match(brawl, /if \(resolvingEffect \|\| effectBurst \|\| !resolutionQueue\.length\) return/);
  assert.match(brawl, /if \(!effectBurst\) return;/);
  assert.doesNotMatch(phase, /new MutationObserver/);
  assert.doesNotMatch(cards, /new MutationObserver/);
  assert.doesNotMatch(cores, /new MutationObserver/);
  assert.match(cores, /preparedTransferCells/);
  assert.match(cores, /data-active=\{active/);
});

test("batch rows remain mounted, docking is transform-only, and modal exits are explicit", () => {
  const brawl = read("components/game-screen-v2/BrawlExperienceLayer.tsx");
  const brawlCss = read("components/game-screen-v2/BrawlExperienceLayer.module.css");
  const roll = read("components/game-screen-v2/RollResultLayer.tsx");
  const tie = read("components/game-screen-v2/TieBreakLayer.tsx");
  assert.doesNotMatch(brawl, /key=\{batchKey\}/);
  assert.match(brawlCss, /--brawl-dock-offset/);
  assert.doesNotMatch(brawlCss, /transition:\s*left/);
  assert.match(roll, /data-state=\{presence\}/);
  assert.match(tie, /presenceState/);
  assert.match(tie, /forceVisible/);
});
