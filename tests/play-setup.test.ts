import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  classifyPlaySetupFailure,
  createPlaySetupState,
  normalizeRoomCode,
  playSetupStartBlockers,
  restorePlaySetupState,
  transitionPlaySetup,
  type PlaySetupEnvironment,
} from "../lib/play-setup-machine";

const legalEnvironment: PlaySetupEnvironment = {
  selectedDeck: { id: "legal", isLegal: true, issues: [] },
  connection: "online",
  authentication: "guest",
};

test("the state machine enforces Mode → Loadout → Ready and supports backward navigation", () => {
  const initial = createPlaySetupState({ selectedDeckId: "legal" });
  const loadout = transitionPlaySetup(initial, { type: "NEXT" }, legalEnvironment);
  assert.equal(loadout.step, "loadout");
  const ready = transitionPlaySetup(loadout, { type: "NEXT" }, legalEnvironment);
  assert.equal(ready.step, "ready");
  assert.equal(ready.status, "editing");
  const back = transitionPlaySetup(ready, { type: "BACK" }, legalEnvironment);
  assert.equal(back.step, "loadout");
  const mode = transitionPlaySetup(back, { type: "BACK" }, legalEnvironment);
  assert.equal(mode.step, "mode");
});

test("invalid decks block forward and URL navigation with the centralized reason", () => {
  const invalidEnvironment: PlaySetupEnvironment = {
    ...legalEnvironment,
    selectedDeck: {
      id: "draft",
      isLegal: false,
      issues: [{ code: "cores.exactly_six", message: "BakuCore configuration must contain exactly six BakuCores." }],
    },
  };
  const loadout = createPlaySetupState({ step: "loadout", selectedDeckId: "draft" });
  const next = transitionPlaySetup(loadout, { type: "NEXT" }, invalidEnvironment);
  assert.equal(next.step, "loadout");
  assert.equal(next.status, "failed");
  assert.equal(next.failure?.message, invalidEnvironment.selectedDeck?.issues[0].message);
  const forward = transitionPlaySetup(loadout, { type: "NAVIGATE", step: "ready" }, invalidEnvironment);
  assert.equal(forward.step, "loadout");
  assert.equal(forward.failure?.kind, "validation");
});

test("room, connection, and authentication failures all produce explicit launch blockers", () => {
  let setup = createPlaySetupState({ step: "ready", mode: "join", selectedDeckId: "legal", joinCode: "BP" });
  let blockers = playSetupStartBlockers(setup, legalEnvironment);
  assert.ok(blockers.some((blocker) => blocker.code === "room.code_required"));

  setup = { ...setup, joinCode: "BP7K3M" };
  blockers = playSetupStartBlockers(setup, { ...legalEnvironment, connection: "offline" });
  assert.ok(blockers.some((blocker) => blocker.code === "connection.offline"));

  blockers = playSetupStartBlockers(setup, { ...legalEnvironment, authentication: "failed" });
  assert.ok(blockers.some((blocker) => blocker.code === "authentication.failed"));
});

test("there is one guarded launch transition and typed launch failures", () => {
  const ready = createPlaySetupState({ step: "ready", mode: "online", selectedDeckId: "legal" });
  const launching = transitionPlaySetup(ready, { type: "LAUNCH" }, legalEnvironment);
  assert.equal(launching.status, "launching");
  assert.equal(launching.failure, null);

  const connection = classifyPlaySetupFailure("Network connection unavailable.");
  assert.equal(connection.kind, "connection");
  const authentication = classifyPlaySetupFailure("Invalid match seat capability.");
  assert.equal(authentication.kind, "authentication");
  const room = classifyPlaySetupFailure("Match room not found.");
  assert.equal(room.kind, "room");
});

test("session restoration preserves choices but never restores a stale launch status", () => {
  const fallback = createPlaySetupState({ mode: "solo" });
  const restored = restorePlaySetupState({
    step: "ready",
    mode: "join",
    format: "bo3",
    selectedDeckId: "deck-7",
    joinCode: "bp7k3m",
    status: "launching",
  }, fallback);
  assert.deepEqual(
    { step: restored.step, mode: restored.mode, format: restored.format, deck: restored.selectedDeckId, code: restored.joinCode },
    { step: "ready", mode: "join", format: "bo3", deck: "deck-7", code: "BP7K3M" },
  );
  assert.equal(restored.status, "editing");
  assert.equal(normalizeRoomCode("bpo1-7k3m"), "BP7K3M");
});

test("the Play route distinguishes starting training from creating or joining a room", async () => {
  const [route, css, decks] = await Promise.all([
    readFile(new URL("../components/routes/PlayRoutes.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/routes/PlayRoutes.module.css", import.meta.url), "utf8"),
    readFile(new URL("../components/routes/DeckRoutes.tsx", import.meta.url), "utf8"),
  ]);
  for (const contract of [
    "Mode",
    "Loadout",
    "Ready",
    "playSetupReducer",
    "playSetupStartBlockers",
    "LoadoutVisual",
    "Six BakuCores",
    "Create Room",
    "Join Room",
    "Connection failed",
    "Authentication failed",
    "Creating private room…",
    "Joining room",
  ]) assert.match(route, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(route, /setup\.mode === "solo" \? "START MATCH" : setup\.mode === "online" \? "CREATE ROOM" : "JOIN ROOM"/);
  assert.match(route, /setup\.mode === "solo" \? "Start Match" : setup\.mode === "online" \? "Create Room" : "Join Room"/);
  assert.doesNotMatch(route, /deckLeadCard|confirmation-lead/);
  assert.match(route, /cardArtSource\(character\.character,\s*"full"\)/);
  assert.match(route, /returnTo=.*step=loadout/);
  assert.match(css, /\.launchDock\s*\{[^}]*position:\s*fixed/s);
  assert.match(css, /\.stepRail/);
  assert.match(decks, /router\.push\(returnTo \?\?/);
  assert.match(decks, /← Match setup/);
});
