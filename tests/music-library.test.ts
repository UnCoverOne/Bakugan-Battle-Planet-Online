import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { muxOggOpus } from "../lib/music-import-client";
import {
  LEGACY_MUSIC_UPLOAD_CHUNK_BYTES,
  MUSIC_UPLOAD_CHUNK_BYTES,
  musicUploadChunkBytes,
} from "../lib/music-server";
import {
  BATTLE_TO_INTENSE_CROSSFADE_MS,
  DEFAULT_INTENSE_LEAD_IN_MS,
  INTENSE_TO_BATTLE_CROSSFADE_MS,
  MUSIC_CATEGORIES,
  MUSIC_GAIN_MAX_DB,
  MUSIC_GAIN_MIN_DB,
  MUSIC_LIBRARY_UPDATED_EVENT,
  STANDARD_MUSIC_CROSSFADE_MS,
  musicBattleIntensity,
  musicCategoryForRoute,
  musicGain,
  normalizeMusicCategories,
  weightedMusicTrack,
  type MusicTrack,
} from "../lib/music";
import type { MatchState } from "../lib/game";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const tracks: MusicTrack[] = [
  {
    id: "a",
    name: "A",
    artist: "Artist A",
    sourceName: "a.opus",
    mimeType: "audio/ogg",
    bytes: 1000,
    durationMs: 60_000,
    bitrate: 96_000,
    intenseLeadInMs: 4_000,
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
    artist: "Artist B",
    sourceName: "b.opus",
    mimeType: "audio/ogg",
    bytes: 1000,
    durationMs: 60_000,
    bitrate: 96_000,
    intenseLeadInMs: 4_000,
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

test("offline and online matches share Battle music and intensity follows deck pressure", () => {
  assert.deepEqual(MUSIC_CATEGORIES, [
    "menu",
    "deck-builder",
    "core-placement",
    "battle",
    "battle-intense",
    "victory",
    "defeat",
  ]);
  assert.deepEqual(normalizeMusicCategories(["training"]), ["battle"]);
  const player = (id: string, deck: number) => ({ id, deck, deckCards: Array.from({ length: deck }) }) as never;
  const base = {
    id: "match",
    phase: "draw",
    winner: "",
    format: "bo3",
    gameNumber: 3,
    turn: 6,
    pendingDamage: 0,
    pendingLoser: "",
    players: [player("p1", 20), player("p2", 20)],
  } as MatchState;
  assert.equal(musicCategoryForRoute("/play/match", base, false, "p1"), "battle");
  assert.equal(musicCategoryForRoute("/play/match", base, true, "p1"), "battle");
  assert.equal(musicCategoryForRoute("/play/match", { ...base, phase: "startingPlayer" } as MatchState, false, "p1"), "core-placement");
  assert.equal(musicCategoryForRoute("/play/match", { ...base, phase: "placement" } as MatchState, true, "p1"), "core-placement");
  assert.equal(musicCategoryForRoute("/play/match", { ...base, phase: "retract" } as MatchState, false, "p1"), "battle");
  assert.equal(musicBattleIntensity(base), null);
  const lowLife = { ...base, players: [player("p1", 8), player("p2", 20)] } as MatchState;
  assert.equal(musicBattleIntensity(lowLife), "low-life");
  assert.equal(musicCategoryForRoute("/play/match", lowLife, false, "p1"), "battle-intense");
  const lethalPressure = {
    ...base,
    phase: "damage",
    pendingLoser: "p2",
    pendingDamage: 9,
    players: [player("p1", 20), player("p2", 12)],
  } as MatchState;
  assert.equal(musicBattleIntensity(lethalPressure), "lethal-pressure");
  assert.equal(musicCategoryForRoute("/play/match", lethalPressure, true, "p1"), "battle-intense");
  const notQuiteLethal = {
    ...base,
    phase: "damage",
    pendingLoser: "p2",
    pendingDamage: 8,
    players: [player("p1", 20), player("p2", 12)],
  } as MatchState;
  assert.equal(musicBattleIntensity(notQuiteLethal), null);
  assert.equal(musicCategoryForRoute("/builder/deck", null, false, "p1"), "deck-builder");
  assert.equal(musicCategoryForRoute("/", null, false, "p1"), "menu");
  assert.equal(musicCategoryForRoute("/play/match", { ...base, phase: "result", winner: "p1" } as MatchState, true, "p1"), "victory");
  assert.equal(musicCategoryForRoute("/play/match", { ...base, phase: "result", winner: "p2" } as MatchState, true, "p1"), "defeat");
});

test("music transition timing uses the agreed lead-in and crossfades", () => {
  assert.equal(DEFAULT_INTENSE_LEAD_IN_MS, 4_000);
  assert.equal(BATTLE_TO_INTENSE_CROSSFADE_MS, 6_000);
  assert.equal(INTENSE_TO_BATTLE_CROSSFADE_MS, 3_500);
  assert.equal(STANDARD_MUSIC_CROSSFADE_MS, 2_500);
});

test("weighted selection avoids an immediate repeat when alternatives exist", () => {
  assert.equal(weightedMusicTrack(tracks, "battle", "a", 0)?.id, "b");
  assert.equal(weightedMusicTrack(tracks, "battle", "b", 0)?.id, "a");
  assert.equal(weightedMusicTrack(tracks, "battle-intense", "", 0)?.id, "b");
});

test("music volume combines channel, master, and the full per-track trim range", () => {
  assert.equal(MUSIC_GAIN_MIN_DB, -30);
  assert.equal(MUSIC_GAIN_MAX_DB, 12);
  assert.equal(MUSIC_LIBRARY_UPDATED_EVENT, "bbp-music-library-updated");
  assert.equal(musicGain(50, 50, 0), .25);
  assert.equal(musicGain(0, 100, MUSIC_GAIN_MAX_DB), 0);
  assert.ok(musicGain(100, 100, -6) > .49 && musicGain(100, 100, -6) < .51);
  assert.ok(musicGain(100, 100, MUSIC_GAIN_MIN_DB) > .031 && musicGain(100, 100, MUSIC_GAIN_MIN_DB) < .032);
  assert.equal(musicGain(25, 100, MUSIC_GAIN_MAX_DB), 0.9952679263837431);
});

test("music upload sessions keep their original chunk size across deployments", () => {
  const bytes = 700_000;
  assert.equal(
    musicUploadChunkBytes(bytes, Math.ceil(bytes / MUSIC_UPLOAD_CHUNK_BYTES)),
    MUSIC_UPLOAD_CHUNK_BYTES,
  );
  assert.equal(
    musicUploadChunkBytes(bytes, Math.ceil(bytes / LEGACY_MUSIC_UPLOAD_CHUNK_BYTES)),
    LEGACY_MUSIC_UPLOAD_CHUNK_BYTES,
  );
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
  assert.match(admin, /begin-upload/);
  assert.match(admin, /method: "PUT"/);
  assert.match(admin, /uploadMusicChunk/);
  assert.match(admin, /attempt < 3/);
  assert.match(admin, /cf-error-type/);
  assert.match(admin, /readJsonResponse/);
  assert.match(admin, /draft\.artist.*formatDuration\(track\.durationMs\).*Opus.*formatBitrate\(track\.bitrate\).*formatBytes\(track\.bytes\)/);
  assert.match(admin, /Field label="Artist"/);
  assert.match(admin, /Field label="Intense lead-in"/);
  assert.match(admin, /musicGain/);
  assert.match(admin, /previewRef\.current\.volume = previewVolume/);
  assert.match(admin, /MUSIC_GAIN_MIN_DB/);
  assert.match(admin, /MUSIC_GAIN_MAX_DB/);
  assert.match(admin, /MUSIC_LIBRARY_UPDATED_EVENT/);
  assert.match(admin, /notifyMusicLibraryUpdated\(\)/);
  assert.match(admin, /intenseLeadInMs/);
  assert.doesNotMatch(admin, /"training"/);
  assert.match(admin, /trackMetadataFromFile/);
  assert.doesNotMatch(admin, /track\.sourceName}.*revision/);
  assert.doesNotMatch(admin, /draft\.enabled \? "ENABLED" : "DISABLED"/);
  assert.doesNotMatch(admin, /new FormData\(\)/);
  assert.match(adminRoute, /beginMusicUpload/);
  assert.match(adminRoute, /artist: String\(body\.artist/);
  assert.match(adminRoute, /storeMusicUploadChunk/);
  assert.match(adminRoute, /request\.arrayBuffer\(\)/);
  assert.doesNotMatch(adminRoute, /request\.formData\(\)/);
  assert.match(server, /ALTER TABLE music_tracks ADD COLUMN artist/);
  assert.match(server, /ALTER TABLE music_tracks ADD COLUMN bitrate_bps/);
  assert.match(server, /ALTER TABLE music_tracks ADD COLUMN intense_lead_in_ms/);
  assert.match(server, /metadata\.artist/);
  assert.match(server, /metadata\.bitrate/);
  assert.match(server, /metadata\.intenseLeadInMs/);
  assert.match(server, /music_upload_chunks/);
  assert.match(server, /MUSIC_UPLOAD_CHUNK_BYTES = 64 \* 1024/);
  assert.match(server, /LEGACY_MUSIC_UPLOAD_CHUNK_BYTES = 256 \* 1024/);
  assert.match(server, /musicUploadChunkBytes\(upload\.byte_length, upload\.chunk_count\)/);
  assert.match(server, /length\(data\).*AS chunk_bytes/);
  assert.match(server, /storedChunkBytes/);
  assert.match(server, /music_track_chunks/);
  assert.match(server, /content-range/);
  assert.match(server, /accept-ranges/);
  assert.match(publicRoute, /getMusicManifest/);
  const worker = await read("worker/index.ts");
  assert.match(worker, /url\.pathname === "\/api\/admin\/music" && sanitizedRequest\.method === "PUT"/);
  assert.match(worker, /MAX_MUSIC_UPLOAD_CHUNK_BYTES/);
  assert.match(worker, /storeMusicUploadChunk/);
  assert.match(worker, /fastPath: true/);
  assert.match(layer, /\[new Audio\(\), new Audio\(\)\]/);
  assert.match(layer, /preload = "none"/);
  assert.match(layer, /requestAnimationFrame/);
  assert.match(layer, /musicBattleIntensity/);
  assert.match(layer, /intenseThroughTurn/);
  assert.match(layer, /BATTLE_TO_INTENSE_CROSSFADE_MS/);
  assert.match(layer, /outgoingRemainingMs - fadeDurationMs/);
  assert.match(layer, /requestIdleCallback/);
  assert.match(layer, /MUSIC_LIBRARY_UPDATED_EVENT/);
  assert.match(layer, /fetch\("\/api\/music", \{ cache: "no-store" \}\)/);
  assert.match(layer, /tracksRef\.current\[index\] = replacement/);
  assert.match(layer, /applyVolumes\(\);\s*for \(const index of \[0, 1\] as const\)/);
  assert.doesNotMatch(layer, /AudioContext|decodeAudioData|AudioEncoder/);
  assert.match(settings, /label="Music"/);
  assert.match(settings, /musicVolume/);
});
