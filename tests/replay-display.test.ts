import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { makePlayer, STARTER_DECKS } from "../lib/data";
import {
  archiveReplayRecording,
  compactReplayCommand,
  createReplayRecording,
} from "../lib/engine/replay-codec";
import {
  buildProjectedReplayBundle,
  encodeReplayTransport,
} from "../lib/engine/replay-playback";
import { initializeMatch, reduceMatch } from "../lib/engine/reducer";
import type { ReplayFrame, ReplayRecording } from "../lib/engine/replay-types";
import type { CommandEnvelope, GameCommand } from "../lib/engine/types";
import { buildDisplayableReplayArchive } from "../lib/replay-finalization";
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

test("a newly completed match produces displayable board replay frames", () => {
  const first = makePlayer("next-version-a", "Alpha", STARTER_DECKS[0]);
  const second = makePlayer("next-version-b", "Beta", STARTER_DECKS[1]);
  let state = initializeMatch("NEXT01", "bo1", [first, second], {
    commandId: "next-version-create",
    actorId: first.id,
    issuedAt: 1_900_000_000_000,
    randomSeed: "next-version-create-seed",
    requestHash: "next-version-create-request",
  }).state;
  const recording = createReplayRecording(state);
  let sequence = 0;
  const apply = (actorId: string, command: GameCommand) => {
    sequence += 1;
    const envelope: CommandEnvelope = {
      commandId: `next-version-${sequence}`,
      gameId: state.id,
      actorId,
      expectedVersion: state.version,
      issuedAt: 1_900_000_000_000 + sequence,
      randomSeed: `next-version-seed-${sequence}`,
      requestHash: `next-version-request-${sequence}`,
      command,
    };
    recording.commands.push(compactReplayCommand(envelope));
    state = reduceMatch(state, envelope).state;
  };

  apply(first.id, { type: "SET_LOBBY_READY", ready: true });
  apply(second.id, { type: "SET_LOBBY_READY", ready: true });
  apply(first.id, { type: "START_MATCH" });
  apply(second.id, { type: "CONCEDE" });

  const archive = buildDisplayableReplayArchive(recording, state, 1_900_000_001_000);
  const bundle = buildProjectedReplayBundle(archive, first.id);
  const gameplayIndex = firstGameplayReplayFrameIndex(bundle.frames);
  assert.equal(archive.recording.commands.length, 4);
  assert.ok(bundle.frames.length > 1);
  assert.notEqual(bundle.frames[gameplayIndex].state.phase, "lobby");
  assert.equal(bundle.frames.at(-1)?.state.phase, "result");
  assert.equal(bundle.frames.at(-1)?.state.winner, first.id);
});

test("an interrupted command journal recovers to a displayable final-board replay", () => {
  const { state } = replayFixture();
  const completed = structuredClone(state);
  completed.phase = "result";
  completed.winner = completed.players[0].id;
  completed.resultReason = "Recovery fixture";
  completed.version += 3;
  const stale: ReplayRecording = createReplayRecording(state);

  const archive = buildDisplayableReplayArchive(stale, completed, 1_900_000_001_000);
  const bundle = buildProjectedReplayBundle(archive, completed.players[0].id);
  assert.equal(archive.recording.commands.length, 0);
  assert.equal(bundle.frames.length, 1);
  assert.equal(bundle.frames[0].state.phase, "result");
  assert.equal(bundle.frames[0].state.winner, completed.players[0].id);
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
