import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// These contracts protect the cross-layer sequencing that prevents one visual
// representation from disappearing before its animated replacement is ready.
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

test("automatic turn draws publish one draw per version so draw flights stay observable", () => {
  const client = read("components/game-screen-v2/GameplayClient.tsx");
  const drawLayer = read("components/game-screen-v2/DrawAnimationLayer.tsx");
  const continuity = read("components/game-screen-v2/presentationContinuity.ts");

  assert.doesNotMatch(client, /dispatchLocalGameAction\(next, trainingBot\.id, "draw"\)/);
  assert.match(client, /The Training AI[\s\S]*dedicated action loop[\s\S]*deck-to-hand animation/);
  assert.match(drawLayer, /isLiveMatchTransition\(previous, match, document\.visibilityState\)/);
  assert.match(continuity, /current\.version === previous\.version \+ 1/);
});

test("settings split Video and Audio controls while match Settings stays gameplay-only", () => {
  const menu = read("components/game-screen-v2/GameMenuHud.tsx");
  const client = read("components/game-screen-v2/GameplayClient.tsx");
  const fullSettings = read("components/routes/SettingsScreen.tsx");
  const sound = read("components/game-screen-v2/GameplaySoundLayer.tsx");

  assert.doesNotMatch(client, /writeGameRoute\("settings"\)/);
  assert.doesNotMatch(menu, /onOpenSettings/);
  assert.match(menu, /role="dialog"/);
  assert.match(menu, /aria-modal="true"/);
  assert.match(menu, /"Gameplay" \| "Video" \| "Audio" \| "Accessibility"/);
  assert.doesNotMatch(menu, /Audio & visual/);
  assert.doesNotMatch(fullSettings, /"Audio & visual"/);

  for (const source of [menu, fullSettings]) {
    for (const videoOption of ["Preview scaling", "Text scaling", "Reduced motion"]) {
      assert.match(source, new RegExp(videoOption));
    }
    for (const audioOption of [
      "Game Sounds",
      "Game Sounds volume",
      "UI Sounds",
      "UI Sounds volume",
      "Music",
      "Music volume",
      "Master Volume",
    ]) assert.match(source, new RegExp(audioOption));
  }

  assert.doesNotMatch(fullSettings, /Music playback is not implemented yet/);
  assert.match(sound, /gameSoundVolume/);
  assert.match(sound, /masterVolume/);
  for (const unrelated of ["Data & sync", "Privacy", "Danger zone", "Delete cloud account"]) {
    assert.doesNotMatch(menu, new RegExp(unrelated));
  }
  assert.match(menu, /setOpen\(false\);[\s\S]*setSettingsOpen\(true\)/);
});

test("full Settings prioritizes gameplay controls and keeps account management minimal", () => {
  const settings = read("components/routes/SettingsScreen.tsx");
  const primitives = read("components/design-system/primitives.tsx");
  const menu = read("components/game-screen-v2/GameMenuHud.tsx");

  assert.match(
    settings,
    /const SECTIONS = \[\s*"Gameplay",\s*"Video",\s*"Audio",\s*"Accessibility",\s*"Account",\s*\] as const;/,
  );
  assert.match(settings, /useState<Section>\("Gameplay"\)/);

  for (const gameplayOption of ["Automatic Draw", "Automatic Pass", "Match-log detail"]) {
    assert.match(settings, new RegExp(gameplayOption));
    assert.match(menu, new RegExp(gameplayOption));
  }
  assert.doesNotMatch(settings, /Default match-log detail/);

  for (const removedSection of ["Data & sync", "Privacy", "Danger zone"]) {
    assert.doesNotMatch(settings, new RegExp(`"${removedSection}"`));
  }
  assert.doesNotMatch(settings, /Sync now/);
  assert.doesNotMatch(settings, /Allow match-record links/);
  assert.doesNotMatch(settings, /Public deck attribution/);

  assert.doesNotMatch(settings, /Client preferences/);
  assert.doesNotMatch(settings, /Preferences save immediately\. Identity, password, and destructive changes always require an explicit action\./);
  assert.doesNotMatch(settings, /description="(?:Manage the signed-in account|Control supporting information|Adjust match presentation|Control game, interface|Strengthen interface legibility)/);
  assert.match(primitives, /eyebrow\?: ReactNode/);
  assert.match(primitives, /\{eyebrow && <span className=\{styles\.eyebrow\}>\{eyebrow\}<\/span>\}/);

  assert.doesNotMatch(settings, /signOutAccount/);
  assert.doesNotMatch(settings, />\s*Log out\s*</);
  assert.match(settings, /section === "Account"[\s\S]*Delete cloud account/);
  assert.match(settings, /section === "Account"[\s\S]*Delete local browser data/);
  assert.match(settings, /Delete local browser data[\s\S]*Export first/);
  assert.doesNotMatch(settings, /Music playback is not implemented yet/);
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

test("presentation systems discard stale phase callouts and avoid document-wide mutation observers", () => {
  const phase = read("components/game-screen-v2/PhaseTransitionLayer.tsx");
  const brawl = read("components/game-screen-v2/BrawlExperienceLayer.tsx");
  const cards = read("components/game-screen-v2/GameplayCardPresentationLayer.tsx");
  const cores = read("components/game-screen-v2/BakuCoreLayer.tsx");
  assert.doesNotMatch(phase, /transitionQueue/);
  assert.match(phase, /seenTransitionSignatures/);
  assert.match(phase, /phaseTransitionShouldPresent/);
  assert.match(brawl, /resolutionQueue/);
  assert.match(brawl, /if \(resolvingEffect \|\| effectBurst \|\| !resolutionQueue\.length\) return/);
  assert.match(brawl, /if \(!effectBurst\) return;/);
  assert.doesNotMatch(phase, /new MutationObserver/);
  assert.doesNotMatch(cards, /new MutationObserver/);
  assert.doesNotMatch(cores, /new MutationObserver/);
  assert.match(cores, /preparedTransferCells/);
  assert.match(cores, /data-active=\{active/);
  assert.match(cores, /completedTraceSignature !== resultSignature/);
  assert.doesNotMatch(cores, /\[tracingSignature,/);
  assert.match(cores, /y=\{-GRID_HEIGHT \* 2\}/);
  assert.match(cores, /height=\{GRID_HEIGHT \* 5\}/);
});

test("batch rows remain mounted, docking is transform-only, and modal exits are explicit", () => {
  const brawl = read("components/game-screen-v2/BrawlExperienceLayer.tsx");
  const brawlCss = read("components/game-screen-v2/BrawlExperienceLayer.module.css");
  const roll = read("components/game-screen-v2/RollResultLayer.tsx");
  const tie = read("components/game-screen-v2/TieBreakLayerImpl.tsx");
  assert.doesNotMatch(brawl, /key=\{batchKey\}/);
  assert.match(brawlCss, /--brawl-dock-offset/);
  assert.doesNotMatch(brawlCss, /transition:\s*left/);
  assert.match(roll, /data-state=\{presence\}/);
  assert.match(tie, /presenceState/);
  assert.match(tie, /forceVisible/);
});


test("BakuCore effect choices hide the Batch behind an explicit reveal control", () => {
  const brawl = read("components/game-screen-v2/BrawlExperienceLayer.tsx");
  const css = read("components/game-screen-v2/BrawlExperienceLayer.module.css");

  assert.match(brawl, /field\.chooserId === localChoicePlayerId && field\.kind === "core"/);
  assert.match(brawl, /setBatchRevealOpen\(false\);[\s\S]*\[coreTargetChoiceId\]/);
  assert.match(brawl, /coreTargetingBatchControl[\s\S]*batchVisible/);
  assert.match(brawl, /SHOW BATCH \(\$\{combinedBatch\.length\}\)/);
  assert.match(brawl, /HIDE BATCH/);
  assert.match(brawl, /aria-expanded=\{batchRevealOpen\}/);
  assert.match(css, /\.batchVisibilityToggle \{/);
  assert.match(css, /pointer-events:\s*auto/);
});

test("completed match dialog separates board inspection from exiting the match", () => {
  const coordinator = read("components/game-screen-v2/MatchStateCoordinator.tsx");
  const css = read("components/game-screen-v2/MatchResultDialog.module.css");

  assert.match(coordinator, /complete \? "EXIT MATCH" : "CONTINUE SERIES"/);
  assert.doesNotMatch(coordinator, /RETURN TO PLAY/);
  assert.match(coordinator, /aria-label="Close match complete window"/);
  assert.match(coordinator, /if \(complete\) \{\s*onDismiss\(\);/);
  assert.match(coordinator, /\{!complete \? \([\s\S]*VIEW MATCH RECORD/);
  assert.match(coordinator, /onDismiss=\{\(\) => \{\s*if \(resultKey\) setDismissedResultKey\(resultKey\);/);
  assert.match(coordinator, /onContinue=\{\(\) => \{[\s\S]*finalizeCompletedMatchExit\(\)[\s\S]*router\.replace\("\/play\/result"\);/);
  assert.match(css, /\.closeAction \{[\s\S]*position: absolute;[\s\S]*right:/);
  assert.match(css, /\.actions\[data-single="true"\]/);
});

test("Training AI worker failures are bounded and recover across match steps", () => {
  const client = read("components/game-screen-v2/GameplayClient.tsx");
  const readiness = read("lib/opponentAiCanAct.ts");

  assert.match(client, /OPPONENT_AI_DECISION_TIMEOUT_MS = 8_000/);
  assert.match(client, /pending\.reject\(new Error\("The opponent AI decision timed out\."\)\)/);
  assert.match(client, /window\.clearTimeout\(pending\.timeoutId\)/);
  assert.match(client, /if \(!requestStarted && botActionKey\.current === key\)/);
  assert.match(client, /recoverOpponentAiCommand/);
  assert.match(readiness, /PRIORITY_PHASES\.has\(match\.phase\)[\s\S]*type: "PASS_PRIORITY"/);
  assert.match(readiness, /match\.phase === "handLimit"[\s\S]*type: "DISCARD_TO_HAND_LIMIT"/);
  assert.match(readiness, /match\.phase === "damage"[\s\S]*type: "PLAY_DAMAGE_FLIP"/);
});

test("Energy zones show total cards and stage a white-light Energize arrival", () => {
  const screen = read("components/game-screen-v2/GameScreen.tsx");
  const client = read("components/game-screen-v2/GameplayClient.tsx");
  const layer = read("components/game-screen-v2/EnergyArrivalLayer.tsx");
  const css = read("components/game-screen-v2/GameScreen.module.css");
  assert.match(screen, /\{safeCardCount\(energy\.cards\.length\)\}/);
  assert.match(client, /<EnergyArrivalLayer/);
  assert.match(layer, /energizeTransitions/);
  assert.match(layer, /dataset\.energizing = "true"/);
  assert.match(css, /@keyframes energy-zone-light-frame/);
  assert.match(css, /@keyframes energy-card-materialize/);
  assert.match(css, /@keyframes energy-lightning-flash/);
  assert.match(css, /@keyframes energy-lightning-bolt/);
  assert.match(css, /prefers-reduced-motion[\s\S]*energyZone\[data-energizing/);
});

test("board target choices use the existing Tips and Action HUDs with accessible Character Cards", () => {
  const choices = read("components/game-screen-v2/ChoiceQueueLayer.tsx");
  const targetCss = read("components/game-screen-v2/ChoiceQueueLayer.module.css");
  const bridge = read("components/game-screen-v2/boardChoiceHud.ts");
  const tips = read("components/game-screen-v2/SelectionInteractionLayer.tsx");
  const actions = read("components/game-screen-v2/MatchHudLayer.tsx");
  const placement = read("components/game-screen-v2/CorePlacementLayer.tsx");
  const placementLayout = read("components/game-screen-v2/corePlacementLayout.ts");
  const placementCss = read("components/game-screen-v2/CorePlacementLayer.module.css");

  assert.match(choices, /publishBoardChoiceHud/);
  assert.match(choices, /return \(\) => clearBoardChoiceHud\(boardHudId\)/);
  assert.match(choices, /element\.tabIndex = 0/);
  assert.match(choices, /element\.setAttribute\("aria-pressed"/);
  assert.doesNotMatch(choices, /styles\.targetPrompt/);
  assert.doesNotMatch(targetCss, /\.targetPrompt/);
  assert.match(bridge, /Confirm the target or cancel the card/);
  assert.match(tips, /activeBoardChoice\?\.prompt[\s\S]*playerActionTooltip/);
  assert.match(actions, /label="Cancel Card"/);
  assert.match(actions, /label=\{activeBoardChoice\?\.busy \? "Locking…" : "Confirm Target"\}/);
  assert.match(actions, /disabled=\{!activeBoardChoice\?\.canConfirm\}/);

  assert.match(placement, /<CorePlacementMatrix/);
  assert.match(placementLayout, /CORE_PLACEMENT_MATRIX_BASE_WIDTH_REM = 38/);
  assert.match(placementLayout, /CORE_PLACEMENT_MATRIX_BASE_HEIGHT_REM = 42\.6/);
  assert.match(placementLayout, /availableWidth \/ \(CORE_PLACEMENT_MATRIX_BASE_WIDTH_REM \* rootFontSizePx\)/);
  assert.match(placementLayout, /availableHeight \/ \(CORE_PLACEMENT_MATRIX_BASE_HEIGHT_REM \* rootFontSizePx\)/);
  assert.match(placementCss, /\.matrixGrid \{[^}]*scale\(var\(--matrix-scale, 1\)\)/);
  assert.match(placementCss, /grid-template-rows: 7\.2rem minmax\(0, 1fr\)/);
  assert.doesNotMatch(placementCss, /\.matrix \{[^}]*min-height:\s*28rem/);
});

test("Home display font is build-generated and does not rely on runtime registration", () => {
  const dashboard = read("components/routes/DashboardScreen.tsx");
  const layout = read("app/layout.tsx");
  const css = read("app/display-font.css");
  const build = read("scripts/build-verified.sh");
  const generator = read("scripts/build-display-font.mjs");
  const packageJson = read("package.json");

  assert.doesNotMatch(dashboard, /DISPLAY_FONT_PARTS|FontFace|useHomeDisplayFont|loadDisplayFont/);
  assert.doesNotMatch(layout, /DisplayFontLoader/);
  assert.match(layout, /import "\.\/display-font\.css"/);
  assert.match(css, /@font-face[\s\S]*rbno31-bold-italic\.woff2[\s\S]*font-display:\s*swap/);
  assert.match(css, /\.bakugan-home-hero-copy h1 span \{[\s\S]*color:\s*#e8ecef[\s\S]*-webkit-text-fill-color:\s*#e8ecef/);
  assert.match(css, /@supports \(\(-webkit-background-clip: text\) or \(background-clip: text\)\)/);
  assert.match(generator, /part-02a\.txt[\s\S]*part-02g\.txt/);
  assert.match(generator, /toString\("ascii"\) !== "wOF2"/);
  assert.match(build, /build-display-font\.mjs/);
  assert.match(packageJson, /"font:build": "node scripts\/build-display-font\.mjs"/);
});
