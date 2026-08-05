import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STARTER_DECKS, makePlayer } from "../lib/data";
import {
  CHAT_MESSAGE_LIMIT,
  addChatMessage,
  cardEventLogEntries,
  chatEntries,
  eventLogEntries,
  matchTimeLabel,
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
const brawlCss = readFileSync(
  new URL("../components/game-screen-v2/BrawlExperienceLayer.module.css", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../app/api/game/route.ts", import.meta.url),
  "utf8",
);
const game = readFileSync(new URL("../lib/game.ts", import.meta.url), "utf8");
const manualDamage = readFileSync(new URL("../lib/manualDamage.ts", import.meta.url), "utf8");

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

test("the communication layer provides docked Event Log and responsive chat drawers", () => {
  assert.match(layer, /className=\{styles\.eventDock\}/);
  assert.match(layer, /aria-label="Event Log"/);
  assert.match(layer, /aria-expanded=\{eventLogOpen\}/);
  assert.match(layer, /className=\{styles\.chatDock\}/);
  assert.match(layer, /className=\{styles\.chatHandle\}/);
  assert.match(layer, /aria-expanded=\{chatOpen\}/);
  assert.match(layer, /className=\{styles\.chatBox\}/);
  assert.match(layer, /aria-label="Chat message"/);
  assert.match(layer, /maxLength=\{240\}/);
  assert.match(layer, /useState<EventFilter>\("cards"\)/);
  assert.match(layer, /EVENT_FILTERS\s*=\s*\["cards",\s*"all",\s*"game",\s*"random",\s*"system",\s*"connection"\]/);
  assert.match(layer, /className=\{styles\.eventFilters\}\s+aria-label="Event filters"/);
  assert.doesNotMatch(layer, /aria-label="Event Log views"|styles\.eventTabs/);
  assert.match(layer, /cardEventLogEntries\(communication\.match\)/);
  assert.match(layer, /cardArtSource\(entry\.card, "thumbnail"\)/);
  assert.match(layer, /batchStyles\.batchHex/);
  assert.match(layer, /cardEventActor\(communication\.match, entry\.playerId\)/);
  assert.match(layer, /data-local=\{entry\.playerId === actorId/);
  assert.match(layer, /matchTimeLabel\(communication\.match, entry\.at\)/);
  assert.doesNotMatch(layer, /dateTime=\{new Date\(entry\.at\)/);
  assert.match(css, /\.cardActor\s*\{/);
  assert.match(brawlCss, /\.batchHex img[\s\S]*object-position:\s*center 28%[\s\S]*transform:\s*scale\(1\.34\)/);
  assert.match(css, /\.cardEntries[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.cardEvent[\s\S]*grid-template-columns:\s*clamp\(3\.25rem,\s*7vw,\s*4rem\)\s+minmax\(0,\s*1fr\)/);
  assert.match(css, /\.cardEvent\[data-local="false"\][\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+clamp\(3\.25rem,\s*7vw,\s*4rem\)/);
  assert.match(css, /\.cardEvent\[data-local="false"\]\s+\.cardPreview[\s\S]*grid-column:\s*2/);
  assert.match(css, /\.eventDock[\s\S]*left:\s*0[\s\S]*translate\(calc\(-100%\s*\+\s*var\(--event-tab-width\)\)/);
  assert.match(css, /\.chatBox[\s\S]*right:\s*calc\(var\(--screen-edge\)\s*\+\s*var\(--player-hud-width\)\s*\+\s*var\(--chat-gap\)\)/);
  assert.match(css, /@media \(max-width:\s*760px\) and \(orientation:\s*portrait\)[\s\S]*\.chatDock[\s\S]*right:\s*0[\s\S]*translate\(100%,\s*-50%\)/);
});

test("Event Log timestamps use elapsed match time instead of local or server wall time", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("CLOCK01", "bo1", [player, opponent]);
  match.log[0].at = 1_000_000;
  assert.equal(matchTimeLabel(match, 1_000_000), "00:00");
  assert.equal(matchTimeLabel(match, 1_065_000), "01:05");
  assert.equal(matchTimeLabel(match, 4_661_000), "1:01:01");
  assert.equal(matchTimeLabel(match, 500_000), "00:00", "clock-domain skew cannot create negative match time");
});

test("discard choices stay on the hand and Action HUD instead of the modal queue", () => {
  const hud = readFileSync(new URL("../components/game-screen-v2/MatchHudLayer.tsx", import.meta.url), "utf8");
  const hand = readFileSync(new URL("../components/game-screen-v2/CardHandLayer.tsx", import.meta.url), "utf8");
  const queue = readFileSync(new URL("../components/game-screen-v2/ChoiceQueueLayer.tsx", import.meta.url), "utf8");
  const runtime = readFileSync(new URL("../components/game-screen-v2/GameplayRuntime.tsx", import.meta.url), "utf8");
  assert.match(hud, /label:\s*discardRequirement[\s\S]*`Discard \$\{selectedDiscardCardIds\.length\}\/\$\{discardRequirement\.maximum\}`/);
  assert.match(hand, /actionMode === "discard"[\s\S]*onDiscardCardSelect/);
  assert.match(queue, /field\.id !== "discardCardIds"/);
  assert.doesNotMatch(runtime, /MatchDecisionLayer/);
});

test("the card timeline keeps structured card plays and effects in chronological log order", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("CARD01", "bo1", [player, opponent]);
  const card = player.hand[0];
  match.log = [
    { id: "noise", at: 10, kind: "game", message: "Dan passed priority." },
    { id: "play", at: 20, kind: "game", message: "played", cardCatalogId: card.catalogId, cardInstanceId: card.id, cardEvent: "played", playerId: player.id },
    { id: "effect", at: 30, kind: "game", message: "resolved", cardCatalogId: card.catalogId, cardInstanceId: card.id, cardEvent: "effect", playerId: player.id },
  ];

  const entries = cardEventLogEntries(match);
  assert.deepEqual(entries.map((entry) => [entry.id, entry.card.id, entry.cardEvent, entry.playerId]), [
    ["play", card.id, "played", player.id],
    ["effect", card.id, "effect", player.id],
  ]);
});

test("saved legacy matches derive card plays and resolutions without showing unrelated events", () => {
  const player = makePlayer("player-a", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("player-b", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("CARD02", "bo1", [player, opponent]);
  const card = player.hand[0];
  match.log = [
    { id: "play", at: 10, kind: "game", message: `${player.name} added ${card.name} to the batch for 2 Energy.` },
    { id: "pass", at: 20, kind: "game", message: `${opponent.name} passed priority.` },
    { id: "effect", at: 30, kind: "game", message: `${card.name} finished resolving its typed rule program.` },
  ];

  const entries = cardEventLogEntries(match);
  assert.deepEqual(entries.map((entry) => entry.cardEvent), ["played", "effect"]);
  assert.ok(entries.every((entry) => entry.playerId === player.id));
});

test("paid, free, revealed, and Flip plays record structured card identities", () => {
  assert.match(game, /added \$\{card\.name\} to the batch[\s\S]*card, "played"/);
  assert.match(game, /played \$\{selected\.name\} from hand for free[\s\S]*selected, "played"/);
  assert.match(game, /played discarded \$\{card\.name\} for free[\s\S]*card, "played"/);
  assert.match(game, /played the revealed \$\{revealed\.name\} for free[\s\S]*revealed, "played"/);
  assert.match(game, /finished resolving its typed rule program[\s\S]*pending\.card, "effect", pending\.controllerId/);
  assert.match(manualDamage, /added \$\{stateFlip\.name\} to the batch[\s\S]*stateFlip, "played", playerId/);
});

test("online chat uses the authoritative match endpoint without replacing gameplay undo history", () => {
  assert.match(route, /command:\s*apiActionToCommand\(body\.action as ApiAction,\s*payload\)/);
  assert.doesNotMatch(route, /preparePendingDraw|reconcile|rewind/i);
  assert.match(route, /const previous = body\.action === "chat" \? record\.previous : before/);
});


test("inactive desktop chat is click-through except for its more-visible input", () => {
  assert.match(
    css,
    /\.chatBox\[data-focused="false"\]\s*\{[\s\S]*?pointer-events:\s*none;/,
  );
  assert.match(
    css,
    /\.chatBox\[data-focused="false"\]\s+\.chatForm input\s*\{[\s\S]*?opacity:\s*\.78;[\s\S]*?pointer-events:\s*auto;/,
  );
  assert.match(
    css,
    /\.chatBox\[data-focused="false"\]\s+\.chatForm button\s*\{[\s\S]*?pointer-events:\s*none;/,
  );
});
