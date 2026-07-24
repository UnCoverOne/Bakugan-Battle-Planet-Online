import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../tests/game-engine.test.ts", import.meta.url);
let source = await readFile(path, "utf8");

const oldImport = `  CENTER_CELL, HEX_CELLS, beginCorePlacement, cardChoiceSpec, createMatch, discardToHandLimit, energizeCard,
  legalPlacementCells, normalizeMatchState, passPriority, placeCore, playCard, selectBakugan,
  setReady, startNextSeriesGame, targetCore, totalPower, type MatchState,
} from "../lib/game";
import { drawTurnCard } from "../lib/turnStart";
import { flipDamageCard, resolveManualDamage } from "../lib/manualDamage";
`;
const newImport = `  CENTER_CELL, HEX_CELLS, beginCorePlacement, cardChoiceSpec, createMatch, discardToHandLimit, energizeCard,
  legalPlacementCells, normalizeMatchState, orderTriggers, passPriority, placeCore, playCard, selectBakugan,
  setReady, startNextSeriesGame, submitCardChoice, targetCore, totalPower, type MatchState,
} from "../lib/game";
import { drawTurnCard } from "../lib/turnStart";
import { flipDamageCard, resolveManualDamage } from "../lib/manualDamage";
import { timeoutChoicesForFields } from "../lib/engine/timeout-policy";
`;
if (!source.includes(oldImport)) throw new Error("Game-engine import anchor is missing.");
source = source.replace(oldImport, newImport);

const oldLoop = `  let triggerWindows = 0;
  while (state.phase === "endPlay" && triggerWindows < 20) {
    state = passWindow(state);
    triggerWindows += 1;
  }
  assert.ok(triggerWindows < 20, "Discard-trigger resolution must terminate.");
`;
const newLoop = `  let triggerWindows = 0;
  while (state.phase === "endPlay" && triggerWindows < 40) {
    if (state.pendingChoice) {
      const fields = state.pendingChoice.schema.fields.filter((field) => field.chooserId === state.priority);
      state = submitCardChoice(state, state.priority, timeoutChoicesForFields(state, state.priority, fields));
    } else {
      const triggerOrder = state.triggerOrders.find((request) => request.controllerId === state.priority && !request.orderedIds);
      state = triggerOrder
        ? orderTriggers(state, state.priority, triggerOrder.id, triggerOrder.triggerIds)
        : passWindow(state);
    }
    triggerWindows += 1;
  }
  assert.ok(triggerWindows < 40, "Discard-trigger and choice resolution must terminate.");
`;
if (!source.includes(oldLoop)) throw new Error("End Phase loop anchor is missing.");
source = source.replace(oldLoop, newLoop);

await writeFile(path, source);
