from pathlib import Path

ROOT = Path('.')


def replace_once(path: str, old: str, new: str) -> None:
    file = ROOT / path
    text = file.read_text()
    if old not in text:
        raise AssertionError(f'Anchor missing in {path}: {old[:120]!r}')
    file.write_text(text.replace(old, new, 1))


# Action HUD: expose the authoritative manual tie-break flip as a normal action.
replace_once(
    'components/game-screen-v2/matchHudState.ts',
    'import { hasPendingDraws } from "../../lib/drawQueue";\n',
    'import { hasPendingDraws } from "../../lib/drawQueue";\n'
    'import { playerCanFlipTieBreak } from "../../lib/manualTieBreak";\n',
)
replace_once(
    'components/game-screen-v2/matchHudState.ts',
    '  | "draw-card"\n',
    '  | "draw-card"\n  | "flip-tie-break"\n',
)
replace_once(
    'components/game-screen-v2/matchHudState.ts',
    '    "draw-card": !completed && playerCanDrawTurnCard(match, player?.id, now),\n',
    '    "draw-card": !completed && playerCanDrawTurnCard(match, player?.id, now),\n'
    '    "flip-tie-break": !completed && playerCanFlipTieBreak(match, player?.id),\n',
)
replace_once(
    'components/game-screen-v2/matchHudState.ts',
    '  if (actions.exit) return ["exit"];\n'
    '  if (actions["play-flip"] || actions["skip-flip"]) {\n',
    '  if (actions.exit) return ["exit"];\n'
    '  if (actions["flip-tie-break"]) return ["flip-tie-break", null];\n'
    '  if (actions["play-flip"] || actions["skip-flip"]) {\n',
)

replace_once(
    'components/game-screen-v2/MatchHudLayer.tsx',
    '  onSelectedCharacterChange,\n  onDrawCard,\n  onActivateReroll,\n',
    '  onSelectedCharacterChange,\n  onDrawCard,\n  onFlipTieBreakCard,\n  onActivateReroll,\n',
)
replace_once(
    'components/game-screen-v2/MatchHudLayer.tsx',
    '  onSelectedCharacterChange: (bakuganId: string) => void;\n'
    '  onDrawCard: MatchActionHandler;\n'
    '  onActivateReroll: MatchActionHandler;\n',
    '  onSelectedCharacterChange: (bakuganId: string) => void;\n'
    '  onDrawCard: MatchActionHandler;\n'
    '  onFlipTieBreakCard: MatchActionHandler;\n'
    '  onActivateReroll: MatchActionHandler;\n',
)
replace_once(
    'components/game-screen-v2/MatchHudLayer.tsx',
    '    "draw-card": {\n'
    '      label: "Draw",\n'
    '      active: false,\n'
    '      onClick: () => void run(onDrawCard),\n'
    '    },\n'
    '    "activate-reroll": {\n',
    '    "draw-card": {\n'
    '      label: "Draw",\n'
    '      active: false,\n'
    '      onClick: () => void run(onDrawCard),\n'
    '    },\n'
    '    "flip-tie-break": {\n'
    '      label: "Flip Top Card",\n'
    '      active: true,\n'
    '      onClick: () => void run(onFlipTieBreakCard),\n'
    '    },\n'
    '    "activate-reroll": {\n',
)
replace_once(
    'components/game-screen-v2/GameplayClient.tsx',
    '          onDrawCard={drawCard}\n          onActivateReroll={activateReroll}\n',
    '          onDrawCard={drawCard}\n'
    '          onFlipTieBreakCard={flipTieBreak}\n'
    '          onActivateReroll={activateReroll}\n',
)
replace_once(
    'components/game-screen-v2/TieBreakLayer.tsx',
    '? "Click your Deck on the playmat to flip its top card."',
    '? "Click your Deck or use Flip Top Card in the Action HUD."',
)
replace_once(
    'components/game-screen-v2/TieBreakLayer.tsx',
    '{isLocal && canFlip ? "CLICK YOUR DECK" : "WAITING FOR FLIP"}',
    '{isLocal && canFlip ? "DECK OR ACTION HUD" : "WAITING FOR FLIP"}',
)

# Brawl Preview: mark and style the stat that currently decides Victor.
replace_once(
    'components/game-screen-v2/brawlState.ts',
    'export type BrawlCombatantView = {\n',
    'export type BrawlVictorStat = "power" | "damage";\n\n'
    '/** The stat currently used to determine the Brawl Victor. */\n'
    'export function brawlVictorStat(\n'
    '  match: Pick<MatchState, "victorByDamage"> | null | undefined,\n'
    '): BrawlVictorStat {\n'
    '  return match?.victorByDamage ? "damage" : "power";\n'
    '}\n\n'
    'export type BrawlCombatantView = {\n',
)
replace_once(
    'components/game-screen-v2/BrawlExperienceLayer.tsx',
    '  batchHudShouldRender,\n  brawlCombatants,\n  effectAnimationKind,\n',
    '  batchHudShouldRender,\n  brawlCombatants,\n  brawlVictorStat,\n  effectAnimationKind,\n',
)
replace_once(
    'components/game-screen-v2/BrawlExperienceLayer.tsx',
    '  powerStepStatus,\n  type BrawlCombatantView,\n',
    '  powerStepStatus,\n  type BrawlCombatantView,\n  type BrawlVictorStat,\n',
)
replace_once(
    'components/game-screen-v2/BrawlExperienceLayer.tsx',
    'function BrawlCombatant({\n'
    '  view,\n'
    '  owner,\n'
    '  pulsing,\n'
    '}: {\n'
    '  view: BrawlCombatantView;\n'
    '  owner: "player" | "opponent";\n'
    '  pulsing: boolean;\n'
    '}) {\n',
    'function BrawlCombatant({\n'
    '  view,\n'
    '  owner,\n'
    '  pulsing,\n'
    '  decidingStat,\n'
    '}: {\n'
    '  view: BrawlCombatantView;\n'
    '  owner: "player" | "opponent";\n'
    '  pulsing: boolean;\n'
    '  decidingStat: BrawlVictorStat;\n'
    '}) {\n',
)
replace_once(
    'components/game-screen-v2/BrawlExperienceLayer.tsx',
    '<div className={styles.stat} data-stat="power">',
    '<div\n'
    '          className={styles.stat}\n'
    '          data-stat="power"\n'
    '          data-deciding={decidingStat === "power" ? "true" : "false"}\n'
    '        >',
)
replace_once(
    'components/game-screen-v2/BrawlExperienceLayer.tsx',
    '<div className={styles.stat} data-stat="damage">',
    '<div\n'
    '          className={styles.stat}\n'
    '          data-stat="damage"\n'
    '          data-deciding={decidingStat === "damage" ? "true" : "false"}\n'
    '        >',
)
replace_once(
    'components/game-screen-v2/BrawlExperienceLayer.tsx',
    '  const status = powerStepStatus(experience.match);\n',
    '  const status = powerStepStatus(experience.match);\n'
    '  const decidingStat = brawlVictorStat(experience.match);\n',
)
replace_once(
    'components/game-screen-v2/BrawlExperienceLayer.tsx',
    '              owner="player"\n'
    '              pulsing={pulsingBakugan.has(combatants[0].bakuganId)}\n'
    '            />\n',
    '              owner="player"\n'
    '              pulsing={pulsingBakugan.has(combatants[0].bakuganId)}\n'
    '              decidingStat={decidingStat}\n'
    '            />\n',
)
replace_once(
    'components/game-screen-v2/BrawlExperienceLayer.tsx',
    '              owner="opponent"\n'
    '              pulsing={pulsingBakugan.has(combatants[1].bakuganId)}\n'
    '            />\n',
    '              owner="opponent"\n'
    '              pulsing={pulsingBakugan.has(combatants[1].bakuganId)}\n'
    '              decidingStat={decidingStat}\n'
    '            />\n',
)
replace_once(
    'components/game-screen-v2/BrawlExperienceLayer.module.css',
    '.combatant[data-owner="opponent"] .stat strong {\n'
    '  color: #ff5a4d;\n'
    '}\n',
    '.combatant[data-owner="opponent"] .stat strong {\n'
    '  color: #ff5a4d;\n'
    '}\n\n'
    '.stat[data-deciding="true"] {\n'
    '  position: relative;\n'
    '  border-color: rgba(255, 226, 118, 0.82);\n'
    '  background:\n'
    '    linear-gradient(135deg, rgba(255, 214, 78, 0.16), rgba(255, 255, 255, 0.055));\n'
    '  box-shadow:\n'
    '    inset 0 0 0 1px rgba(255, 245, 196, 0.12),\n'
    '    0 0 0.48rem rgba(255, 205, 54, 0.24);\n'
    '}\n\n'
    '.stat[data-deciding="true"]::after {\n'
    '  content: "VICTOR";\n'
    '  position: absolute;\n'
    '  top: 0.14rem;\n'
    '  right: 0.22rem;\n'
    '  color: rgba(255, 230, 128, 0.9);\n'
    '  font-size: clamp(0.3rem, 0.38vw, 0.42rem);\n'
    '  font-weight: 950;\n'
    '  letter-spacing: 0.09em;\n'
    '  line-height: 1;\n'
    '}\n\n'
    '.stat[data-deciding="true"] > span,\n'
    '.stat[data-deciding="true"] > strong {\n'
    '  color: #ffe783;\n'
    '  text-shadow: 0 0 0.32rem rgba(255, 213, 58, 0.42);\n'
    '}\n',
)

# Keep the existing full-object HUD assertions in sync with the new action key.
replace_once(
    'tests/match-hud-state.test.ts',
    '  return {\n'
    '    "draw-card": false,\n'
    '    "activate-reroll": false,\n',
    '  return {\n'
    '    exit: false,\n'
    '    "draw-card": false,\n'
    '    "flip-tie-break": false,\n'
    '    "activate-reroll": false,\n'
    '    discard: false,\n',
)

(ROOT / 'tests/tie-break-hud-victor-highlight.test.ts').write_text('''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch } from "../lib/game";
import { passPriorityWithTieBreak } from "../lib/manualTieBreak";
import {
  compactMatchHudSlots,
  visibleMatchHudActions,
} from "../components/game-screen-v2/matchHudState";
import { brawlVictorStat } from "../components/game-screen-v2/brawlState";

function tiedPowerState() {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("HUD-TIE", "bo1", [first, second]);
  state.turn = 1;
  state.phase = "power";
  state.startingPlayer = first.id;
  state.priority = second.id;
  state.passes = [first.id];
  state.selected[first.id] = first.bakugan[0].id;
  state.selected[second.id] = second.bakugan[0].id;
  first.bakugan[0].open = true;
  second.bakugan[0].open = true;
  first.bakugan[0].bPower = 500;
  second.bakugan[0].bPower = 500;
  first.bakugan[0].character.bPower = 500;
  second.bakugan[0].character.bPower = 500;
  return state;
}

test("the Action HUD offers the local tie-break flip in its primary slot", () => {
  const state = tiedPowerState();
  const tieBreak = passPriorityWithTieBreak(state, state.players[1].id);
  const actions = visibleMatchHudActions({
    match: tieBreak,
    playerId: tieBreak.players[0].id,
    mode: null,
    selectedCardId: "",
    selectionPending: false,
  });

  assert.equal(actions["flip-tie-break"], true);
  assert.deepEqual(compactMatchHudSlots(actions), ["flip-tie-break", null]);
});

test("the Brawl Preview highlights the stat that currently decides Victor", () => {
  const state = tiedPowerState();
  assert.equal(brawlVictorStat(state), "power");
  state.victorByDamage = true;
  assert.equal(brawlVictorStat(state), "damage");

  const layer = readFileSync(
    new URL("../components/game-screen-v2/BrawlExperienceLayer.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL("../components/game-screen-v2/BrawlExperienceLayer.module.css", import.meta.url),
    "utf8",
  );
  const gameplay = readFileSync(
    new URL("../components/game-screen-v2/GameplayClient.tsx", import.meta.url),
    "utf8",
  );

  assert.match(layer, /data-deciding=\{decidingStat === "power"/);
  assert.match(layer, /data-deciding=\{decidingStat === "damage"/);
  assert.match(css, /\.stat\[data-deciding="true"\]/);
  assert.match(gameplay, /onFlipTieBreakCard=\{flipTieBreak\}/);
});
''')
