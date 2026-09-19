import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { muxOggOpus } from "../lib/music-import-client";
import {
  MUSIC_CATEGORIES,
  musicCategoryForRoute,
  musicGain,
  weightedMusicTrack,
  type MusicTrack,
} from "../lib/music";
import type { MatchState } from "../lib/game";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const tracks: MusicTrack[] = [
  {
    id: "a",
    name: "A",
    sourceName: "a.opus",
    mimeType: "audio/ogg",
    bytes: 1000,
    durationMs: 60_000,
    enabled: true,
    categories: ["battle"],
    weight: 1,
    loop: false,
    gainDb: 0,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    url: "/a",
  },
  {
    id: "b",
    name: "B",
    sourceName: "b.opus",
    mimeType: "audio/ogg",
    bytes: 1000,
    durationMs: 60_000,
    enabled: true,
    categories: ["battle", "battle-intense"],
    weight: 9,
    loop: false,
    gainDb: -3,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    url: "/b",
  },
];

test("music categories cover menu, Training, battle intensity, and results", () => {
  assert.deepEqual(MUSIC_CATEGORIES, [
    "menu",
    "deck-builder",
    "training",
    "battle",
    "battle-intense",
    "victory",
    "defeat",
  ]);
  const base = {
    id: "match",
    phase: "draw",
    winner: "",
    format: "bo1",
    gameNumber: 1,
  } as MatchState;
  assert.equal(musicCategoryForRoute("/play/match", base, false, "p1"), "training");
  assert.equal(musicCategoryForRoute("/play/match", base, true, "p1"), "battle");
  assert.equal(musicCategoryForRoute("/builder/deck", null, false, "p1"), "deck-builder");
  assert.equal(musicCategoryForRoute("/", null, false, "p1"), "menu");
  assert.equal(musicCategoryForRoute("/play/match", { ...base, phase: "result", winner: "p1" } as MatchState, true, "p1"), "victory");
  assert.equal(musicCategoryForRoute("/play/match", { ...base, phase: "result", winner: "p2" } as MatchState, true, "p1"), "defeat");
  assert.equal(musicCategoryForRoute("/play/match", { ...base, format: "bo3", gameNumber: 3 } as MatchState, true, "p1"), "battle-intense");
});

test("weighted selection avoids an immediate repeat when alternatives exist", () => {
  assert.equal(weightedMusicTrack(tracks, "battle", "a", 0)?.id, "b");
  assert.equal(weightedMusicTrack(tracks, "battle", "b", 0)?.id, "a");
  assert.equal(weightedMusicTrack(tracks, "battle-intense", "", 0)?.id, "b");
  assert.equal(weightedMusicTrack(tracks, "training", "", 0), null);
});

test("music volume combines channel, master, and per-track trim", () => {
  assert.equal(musicGain(50, 50, 0), .25);
  assert.equal(musicGain(0, 100, 6), 0);
  assert.ok(musicGain(100, 100, -6) > .49 && musicGain(100, 100, -6) < .51);
});

test("browser converter muxes encoded Opus packets into an Ogg stream", async () => {
  const blob = muxOggOpus(
    [Uint8Array.from([1, 2, 3]), Uint8Array.from([4, 5, 6])],
    1_920,
    2,
    312,
    123,
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "OggS");
  assert.equal(blob.type, "audio/ogg");
  assert.ok(blob.size > 60);
});

test("music management is admin-only and gameplay playback stays native and deferred", async () => {
  const [adminRoute, publicRoute, server, admin, layer, settings] = await Promise.all([
    read("app/api/admin/music/route.ts"),
    read("app/api/music/route.ts"),
    read("lib/music-server.ts"),
    read("components/routes/MusicAdmin.tsx"),
    read("components/application/MusicLayer.tsx"),
    read("components/routes/SettingsScreen.tsx"),
  ]);
  assert.match(adminRoute, /requireAdministrator\(request\)/);
  assert.match(adminRoute, /assertSameOrigin\(request\)/);
  assert.match(admin, /convertMusicFileToOpus/);
  assert.match(admin, /import\("\.\.\/\.\.\/lib\/music-import-client"\)/);
  assert.match(server, /music_track_chunks/);
  assert.match(server, /content-range/);
  assert.match(server, /accept-ranges/);
  assert.match(publicRoute, /getMusicManifest/);
  assert.match(layer, /new Audio\(\)/);
  assert.match(layer, /preload = "none"/);
  assert.match(layer, /requestIdleCallback/);
  assert.doesNotMatch(layer, /AudioContext|decodeAudioData|AudioEncoder/);
  assert.match(settings, /label="Music"/);
  assert.match(settings, /musicVolume/);
});
