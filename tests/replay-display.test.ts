import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { makePlayer, STARTER_DECKS } from "../lib/data";
import {
  archiveReplayRecording,
  createReplayRecording,
} from "../lib/engine/replay-codec";
import {
  buildProjectedReplayBundle,
  encodeReplayTransport,
} from "../lib/engine/replay-playback";
import { initializeMatch } from "../lib/engine/reducer";
import type { ReplayFrame } from "../lib/engine/replay-types";
import {
  reconstructLocalReplay,
  reconstructServerReplay,
} from "../lib/replay-playback-client";
import { firstGameplayReplayFrameIndex } from "../lib/replay-view";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function replayFixture() {
  const first = makePlayer("display-a", "Alpha", STARTER_DECKS[0]);
  const second = makePlayer("display-b", "Beta", STARTER_DECKS[1]);
  const state = initializeMatch("SHOW01", "bo1", [first, second], {
    commandId: "display-create",
    actorId: first.id,
    issuedAt: 1_900_000_000_000,
    randomSeed: "display-create-seed",
    requestHash: "display-create-request",
  }).state;
  return {
    archive: archiveReplayRecording(createReplayRecording(state), state, 1_900_000_001_000),
    playerId: first.id,
    state,
  };
}

test("replay playback remains available when module workers are unavailable", async () => {
  const { archive, playerId } = replayFixture();
  assert.equal(typeof Worker, "undefined");

  const local = await reconstructLocalReplay(archive, playerId);
  assert.equal(local.frames.length, 1);
  assert.equal(local.frames[0].state.id, archive.replayId);

  const transport = encodeReplayTransport(buildProjectedReplayBundle(archive, playerId));
  const server = await reconstructServerReplay(transport);
  assert.equal(server.frames.length, 1);
  assert.equal(server.frames[0].state.id, archive.replayId);
});

test("the theatre opens on gameplay instead of an empty lobby frame", () => {
  const { state } = replayFixture();
  const gameplay = structuredClone(state);
  gameplay.phase = "energize";
  const frames = [
    { index: 0, at: 1, commandType: "CREATE_MATCH", label: "Match created", state },
    { index: 1, at: 2, commandType: "START_MATCH", label: "Gameplay begins", state: gameplay },
  ] satisfies ReplayFrame[];
  assert.equal(firstGameplayReplayFrameIndex(frames), 1);
  assert.equal(firstGameplayReplayFrameIndex(frames.slice(0, 1)), 0);
});

test("the replay surface has an embedded board layer, readiness grace, and visible recovery UI", async () => {
  const [theatre, theatreCss, gameScreen, gameScreenCss, localStore, client] = await Promise.all([
    source("components/replay/ReplayTheatre.tsx"),
    source("components/replay/ReplayTheatre.module.css"),
    source("components/game-screen-v2/GameScreen.tsx"),
    source("components/game-screen-v2/GameScreen.module.css"),
    source("lib/replay-local-store.ts"),
    source("lib/replay-playback-client.ts"),
  ]);

  assert.match(theatre, /presentationMode="replay"/);
  assert.match(theatre, /Replay could not be displayed/);
  assert.match(theatre, /Retry replay/);
  assert.match(theatreCss, /\.board[\s\S]*z-index:\s*1/);
  assert.match(gameScreen, /data-presentation-mode=\{presentationMode\}/);
  assert.match(gameScreenCss, /\.replayScreen[\s\S]*position:\s*absolute/);
  assert.match(localStore, /loadLocalReplayWhenReady/);
  assert.match(client, /resolveWithFallback/);
  assert.match(client, /Replay reconstruction worker timed out/);
});
