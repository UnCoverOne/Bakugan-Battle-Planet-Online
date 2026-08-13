import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { STARTER_DECKS, type DeckRecord } from "../lib/data";
import { createTrainingLobbyState, syncTrainingBotForLobby } from "../lib/training-lobby";
import { setLobbyReady, startLobbyMatch } from "../lib/lobby";
import { archiveReplay, replayStateHash } from "../lib/engine/replay-codec";
import { buildReplayFrames } from "../lib/engine/replay-playback";
import { ENGINE_METADATA_KEY } from "../lib/engine/types";

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

test("Training lobby keeps its selected AI source deck when the bot is resynchronised", () => {
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
  state = syncTrainingBotForLobby(state);
  const bot = state.players.find((player) => player.id === "training-bot");
  assert.ok(bot);
  assert.deepEqual(
    bot.bakugan.map((bakugan) => bakugan.character.catalogId),
    selectedAiDeck.bakuganIds,
  );
});

test("the current Training lobby path starts a reconstructable replay when gameplay begins", () => {
  let state = createTrainingLobbyState(
    "REPLAY",
    "bo1",
    "player-1",
    "Player 1",
    STARTER_DECKS[0],
    STARTER_DECKS[1],
  );
  assert.equal(state[ENGINE_METADATA_KEY]?.replay, undefined);

  state = setLobbyReady(state, "player-1", true);
  state = startLobbyMatch(state, "player-1");

  assert.ok(state[ENGINE_METADATA_KEY]?.replay);
  const archive = archiveReplay(state, 1_900_000_000_000);
  assert.ok(archive);
  const playback = buildReplayFrames(archive);
  assert.equal(playback.frames.length, 1);
  assert.equal(replayStateHash(playback.frames[0].state), archive.finalStateHash);
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
