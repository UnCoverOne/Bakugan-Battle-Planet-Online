import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { STARTER_DECKS, type DeckRecord } from "../lib/data";
import { createTrainingLobbyState, syncTrainingBotForLobby } from "../lib/training-lobby";
import { updateLobbySettings } from "../lib/lobby";

test("Training lobby uses the administrator-selected AI deck instead of the built-in fallback", () => {
  const selectedAiDeck: DeckRecord = {
    ...STARTER_DECKS[0],
    id: "admin-selected-training-ai",
    name: "Administrator Selected AI",
    factions: [...STARTER_DECKS[0].factions],
    bakuganIds: [...STARTER_DECKS[0].bakuganIds],
    coreIds: [...STARTER_DECKS[0].coreIds],
    cardIds: [...STARTER_DECKS[0].cardIds],
    tags: [...(STARTER_DECKS[0].tags ?? [])],
  };
  const state = createTrainingLobbyState(
    "TRAIN2",
    "bo1",
    "player-1",
    "Player 1",
    STARTER_DECKS[1],
    selectedAiDeck,
  );
  const bot = state.players.find((player) => player.id === "training-bot");
  assert.ok(bot);
  assert.deepEqual(
    bot.bakugan.map((bakugan) => bakugan.character.catalogId),
    selectedAiDeck.bakuganIds,
  );
  assert.equal((state as typeof state & { trainingAiDeck?: DeckRecord }).trainingAiDeck?.id, selectedAiDeck.id);
});

test("Training lobby keeps its selected AI source deck when lobby rules are resynchronised", () => {
  const selectedAiDeck: DeckRecord = {
    ...STARTER_DECKS[0],
    id: "admin-selected-training-ai",
    name: "Administrator Selected AI",
    factions: [...STARTER_DECKS[0].factions],
    bakuganIds: [...STARTER_DECKS[0].bakuganIds],
    coreIds: [...STARTER_DECKS[0].coreIds],
    cardIds: [...STARTER_DECKS[0].cardIds],
    tags: [...(STARTER_DECKS[0].tags ?? [])],
  };
  let state = createTrainingLobbyState("TRAIN3", "bo1", "player-1", "Player 1", STARTER_DECKS[1], selectedAiDeck);
  state = updateLobbySettings(state, "player-1", "standard", "battle-brawlers");
  state = syncTrainingBotForLobby(state);
  const bot = state.players.find((player) => player.id === "training-bot");
  assert.ok(bot);
  assert.deepEqual(
    bot.bakugan.map((bakugan) => bakugan.character.catalogId),
    selectedAiDeck.bakuganIds,
  );
});

test("Match Creation clears completed-session state before opening another lobby and loads AI selection from the server", async () => {
  const creation = await readFile(new URL("../components/routes/MatchCreationScreen.tsx", import.meta.url), "utf8");
  assert.match(creation, /resetPreviousSession/);
  assert.match(creation, /primeMatchStore\(\{ route: "play", match: null, online: false/);
  assert.match(creation, /setMatch\(null\)/);
  assert.match(creation, /fetch\("\/api\/ai-decks", \{ cache: "no-store" \}\)/);
  assert.match(creation, /createTrainingLobbyState\([\s\S]*result\.deck\)/);
  assert.doesNotMatch(creation, /matchError/);
});

test("AI deck endpoint only chooses enabled legal administrator resources", async () => {
  const route = await readFile(new URL("../app/api/ai-decks/route.ts", import.meta.url), "utf8");
  assert.match(route, /item\.enabled && validateDeck\(item\.deck\)\.isLegal/);
  assert.doesNotMatch(route, /randomAiDeck/);
  assert.doesNotMatch(route, /STARTER_DECKS/);
});
