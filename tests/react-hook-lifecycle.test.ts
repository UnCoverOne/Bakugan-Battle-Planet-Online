import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { CardChoices } from "../lib/game";
import type { ChoiceField } from "../lib/rules/choices";
import {
  reconcileChoiceAnswers,
  reconcileOrderedIds,
  retainLegalSelection,
} from "../components/game-screen-v2/choiceSelectionContinuity";
import { isLiveMatchTransition } from "../components/game-screen-v2/presentationContinuity";

function field(
  id: ChoiceField["id"],
  optionIds: string[],
  overrides: Partial<ChoiceField> = {},
): ChoiceField {
  return {
    id,
    kind: "card",
    label: String(id),
    chooserId: "player-1",
    visibility: "private",
    timing: "resolve",
    minimum: 0,
    maximum: 3,
    required: false,
    options: optionIds.map((optionId) => ({ id: optionId, label: optionId })),
    ...overrides,
  };
}

test("updated legal options retain legal selections and discard invalid ones", () => {
  const answers: CardChoices = {
    targetBakuganId: "bakugan-a",
    targetEnergyIds: ["energy-a", "energy-b"],
    mode: "aggressive",
  };
  const next = reconcileChoiceAnswers(answers, [
    field("targetBakuganId", ["bakugan-a", "bakugan-c"], { maximum: 1 }),
    field("targetEnergyIds", ["energy-b", "energy-c"]),
  ]);

  assert.deepEqual(next, {
    targetBakuganId: "bakugan-a",
    targetEnergyIds: ["energy-b"],
  });
});

test("updated order options keep legal user ordering and append new entries", () => {
  assert.deepEqual(
    reconcileOrderedIds(["card-c", "card-a", "removed"], ["card-a", "card-b", "card-c", "card-d"]),
    ["card-c", "card-a", "card-b", "card-d"],
  );
  assert.equal(retainLegalSelection("card-c", ["card-a", "card-c"]), "card-c");
  assert.equal(retainLegalSelection("removed", ["card-a", "card-c"]), "");
});

test("presentation events only run for adjacent visible match snapshots", () => {
  const previous = { id: "match-1", version: 8 };
  assert.equal(isLiveMatchTransition(previous as never, { id: "match-1", version: 9 } as never), true);
  assert.equal(isLiveMatchTransition(previous as never, { id: "match-1", version: 12 } as never), false);
  assert.equal(isLiveMatchTransition(previous as never, { id: "match-2", version: 9 } as never), false);
  assert.equal(isLiveMatchTransition(previous as never, { id: "match-1", version: 9 } as never, "hidden"), false);
});

test("automatic action scheduling wakes on reconnect and visible-tab resume", () => {
  const source = readFileSync(new URL("../components/game-screen-v2/GameplayClient.tsx", import.meta.url), "utf8");
  assert.match(source, /addEventListener\("online", resume\)/);
  assert.match(source, /addEventListener\("visibilitychange", resumeVisibleTab\)/);
  assert.match(source, /Math\.max\(0, match\.deadline - Date\.now\(\)\)/);
  assert.match(source, /automaticPassSchedule\.current\.dueAt - Date\.now\(\)/);
});
