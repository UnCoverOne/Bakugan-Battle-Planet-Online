import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STARTER_DECKS, makePlayer } from "../lib/data";
import {
  CHAT_MESSAGE_LIMIT,
  addChatMessage,
  chatEntries,
  eventLogEntries,
  normalizeChatMessage,
} from "../lib/chat";
import { createMatch } from "../lib/game";

const layer = readFileSync(
  new URL("../components/game-screen-v2/MatchCommunicationLayer.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../components/game-screen-v2/MatchCommunicationLayer.module.css", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../app/api/game/route.ts", import.meta.url),
  "utf8",
);

test("chat messages are sanitized, attributed, synchronized, and excluded from the Event Log", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("CHAT01", "bo1", [player, opponent]);
  const originalVersion = match.version;
  const originalLogLength = match.log.length;

  const next = addChatMessage(match, player.id, "  Hello\n\tBrawlers!  ", 1234);
  assert.equal(match.version, originalVersion, "the source state remains immutable");
  assert.equal(match.log.length, originalLogLength);
  assert.equal(next.version, originalVersion + 1);
  assert.equal(chatEntries(next).length, 1);
  assert.deepEqual(chatEntries(next)[0], {
    id: chatEntries(next)[0].id,
    at: 1234,
    kind: "chat",
    message: "Hello Brawlers!",
    playerId: player.id,
    author: player.name,
  });
  assert.equal(eventLogEntries(next).length, originalLogLength);
});

test("chat validation rejects empty messages and caps the payload", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("CHAT02", "bo1", [player, opponent]);

  assert.throws(() => addChatMessage(match, player.id, " \n\t "), /Enter a chat message/);
  assert.equal(normalizeChatMessage("x".repeat(CHAT_MESSAGE_LIMIT + 20)).length, CHAT_MESSAGE_LIMIT);
});

test("the communication layer provides a left slide-out Event Log and chat beside the player HUD", () => {
  assert.match(layer, /className=\{styles\.eventDock\}/);
  assert.match(layer, /aria-label="Event Log"/);
  assert.match(layer, /aria-expanded=\{eventLogOpen\}/);
  assert.match(layer, /className=\{styles\.chatBox\}/);
  assert.match(layer, /aria-label="Chat message"/);
  assert.match(layer, /maxLength=\{240\}/);
  assert.match(css, /\.eventDock[\s\S]*left:\s*0[\s\S]*translate\(calc\(-100%\s*\+\s*var\(--event-tab-width\)\)/);
  assert.match(css, /\.chatBox[\s\S]*right:\s*calc\(var\(--screen-edge\)\s*\+\s*var\(--player-hud-width\)\s*\+\s*var\(--chat-gap\)\)/);
});

test("online chat uses the authoritative match endpoint without replacing gameplay undo history", () => {
  assert.match(route, /case "chat":\s*state\s*=\s*addChatMessage/);
  assert.doesNotMatch(route, /preparePendingDraw|reconcile|rewind/i);
  assert.match(route, /body\.action\s*===\s*"chat"\s*\?\s*record\.previous\s*:\s*before/);
});
