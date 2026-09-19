import type { AccountDatabase } from "./account-server";
import {
  MUSIC_CATEGORIES,
  normalizeMusicCategories,
  type MusicManifest,
  type MusicTrack,
  type MusicTrackMetadata,
} from "./music";
import { ValidationError } from "./server-errors";

const MUSIC_CHUNK_BYTES = 256 * 1024;
export const MAX_MUSIC_TRACK_BYTES = 20 * 1024 * 1024;
const MAX_MUSIC_DURATION_MS = 60 * 60 * 1000;

let musicSchemaReady = false;

type MusicTrackRow = {
  id: string;
  name: string;
  source_name: string;
  mime_type: string;
  byte_length: number;
  duration_ms: number;
  enabled: number;
  categories_json: string;
  weight: number;
  loop: number;
  gain_db: number;
  revision: number;
  created_at: number;
  updated_at: number;
};

export async function ensureMusicSchema(db: AccountDatabase) {
  if (musicSchemaReady) return;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS music_tracks (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, source_name TEXT NOT NULL, mime_type TEXT NOT NULL, byte_length INTEGER NOT NULL, duration_ms INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, categories_json TEXT NOT NULL, weight INTEGER NOT NULL DEFAULT 10, loop INTEGER NOT NULL DEFAULT 0, gain_db REAL NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS music_tracks_enabled_idx ON music_tracks(enabled, updated_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS music_track_chunks (track_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (track_id, chunk_index), FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE)"),
    db.prepare("CREATE INDEX IF NOT EXISTS music_track_chunks_track_idx ON music_track_chunks(track_id, chunk_index)"),
  ]);
  musicSchemaReady = true;
}

function parseCategories(value: string) {
  try {
    return normalizeMusicCategories(JSON.parse(value));
  } catch {
    return [];
  }
}

function toTrack(row: MusicTrackRow): MusicTrack {
  return {
    id: row.id,
    name: row.name,
    sourceName: row.source_name,
    mimeType: "audio/ogg",
    bytes: row.byte_length,
    durationMs: row.duration_ms,
    enabled: Boolean(row.enabled),
    categories: parseCategories(row.categories_json),
    weight: row.weight,
    loop: Boolean(row.loop),
    gainDb: row.gain_db,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    url: `/api/music?track=${encodeURIComponent(row.id)}&v=${row.revision}`,
  };
}

export async function listMusicTracks(db: AccountDatabase): Promise<MusicTrack[]> {
  await ensureMusicSchema(db);
  const result = await db.prepare(
    "SELECT id, name, source_name, mime_type, byte_length, duration_ms, enabled, categories_json, weight, loop, gain_db, revision, created_at, updated_at FROM music_tracks ORDER BY updated_at DESC",
  ).all() as { results?: MusicTrackRow[] };
  return (result.results ?? []).map(toTrack);
}

export async function getMusicManifest(db: AccountDatabase): Promise<MusicManifest> {
  const tracks = (await listMusicTracks(db)).filter((track) => track.enabled);
  return {
    revision: Math.max(0, ...tracks.map((track) => track.updatedAt)),
    tracks,
  };
}

function normalizeMetadata(value: Partial<MusicTrackMetadata>): MusicTrackMetadata {
  const name = String(value.name ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!name) throw new ValidationError("Track name is required.");
  const categories = normalizeMusicCategories(value.categories);
  if (!categories.length) throw new ValidationError("Choose at least one music category.");
  const weight = Math.round(Number(value.weight ?? 10));
  if (!Number.isFinite(weight) || weight < 1 || weight > 100) {
    throw new ValidationError("Track weight must be between 1 and 100.");
  }
  const gainDb = Number(value.gainDb ?? 0);
  if (!Number.isFinite(gainDb) || gainDb < -12 || gainDb > 6) {
    throw new ValidationError("Track volume trim must be between -12 dB and +6 dB.");
  }
  const durationMs = Math.round(Number(value.durationMs ?? 0));
  if (!Number.isFinite(durationMs) || durationMs < 250 || durationMs > MAX_MUSIC_DURATION_MS) {
    throw new ValidationError("Track duration is invalid.");
  }
  return {
    name,
    enabled: value.enabled !== false,
    categories,
    weight,
    loop: Boolean(value.loop),
    gainDb: Math.round(gainDb * 10) / 10,
    durationMs,
  };
}

function safeSourceName(value: string) {
  const name = value.trim().replace(/[\\/]+/g, "-").replace(/[^a-zA-Z0-9._ ()-]+/g, "").slice(0, 160);
  return name || "imported-track.opus";
}

export async function importMusicTrack(
  db: AccountDatabase,
  file: File,
  metadata: Partial<MusicTrackMetadata>,
  administratorId: string,
) {
  await ensureMusicSchema(db);
  const normalized = normalizeMetadata(metadata);
  const sourceName = safeSourceName(file.name);
  const extensionLooksOpus = /\.opus$/i.test(sourceName);
  const supportedMime = file.type === "audio/ogg" || file.type === "audio/opus" || !file.type;
  if (!extensionLooksOpus || !supportedMime) {
    throw new ValidationError("Administrator imports must be converted to an .opus file first.");
  }
  if (file.size < 1_000 || file.size > MAX_MUSIC_TRACK_BYTES) {
    throw new ValidationError(`Optimized track must be between 1 KB and ${Math.floor(MAX_MUSIC_TRACK_BYTES / 1024 / 1024)} MB.`);
  }

  const id = `music-${crypto.randomUUID()}`;
  const now = Date.now();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const statements = [
    db.prepare(
      "INSERT INTO music_tracks (id, name, source_name, mime_type, byte_length, duration_ms, enabled, categories_json, weight, loop, gain_db, revision, created_at, updated_at, updated_by) VALUES (?, ?, ?, 'audio/ogg', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
    ).bind(
      id,
      normalized.name,
      sourceName,
      bytes.byteLength,
      normalized.durationMs,
      normalized.enabled ? 1 : 0,
      JSON.stringify(normalized.categories),
      normalized.weight,
      normalized.loop ? 1 : 0,
      normalized.gainDb,
      now,
      now,
      administratorId,
    ),
  ];
  for (let offset = 0, index = 0; offset < bytes.byteLength; offset += MUSIC_CHUNK_BYTES, index += 1) {
    const chunk = bytes.slice(offset, Math.min(bytes.byteLength, offset + MUSIC_CHUNK_BYTES));
    statements.push(
      db.prepare("INSERT INTO music_track_chunks (track_id, chunk_index, data) VALUES (?, ?, ?)")
        .bind(id, index, chunk.buffer),
    );
  }
  await db.batch(statements);
  return (await listMusicTracks(db)).find((track) => track.id === id)!;
}

export async function updateMusicTrack(
  db: AccountDatabase,
  id: string,
  metadata: Partial<MusicTrackMetadata>,
  administratorId: string,
) {
  await ensureMusicSchema(db);
  const current = (await listMusicTracks(db)).find((track) => track.id === id);
  if (!current) throw new ValidationError("The selected music track no longer exists.");
  const normalized = normalizeMetadata({ ...current, ...metadata, durationMs: current.durationMs });
  const result = await db.prepare(
    "UPDATE music_tracks SET name = ?, enabled = ?, categories_json = ?, weight = ?, loop = ?, gain_db = ?, revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ?",
  ).bind(
    normalized.name,
    normalized.enabled ? 1 : 0,
    JSON.stringify(normalized.categories),
    normalized.weight,
    normalized.loop ? 1 : 0,
    normalized.gainDb,
    Date.now(),
    administratorId,
    id,
  ).run();
  if (!result.meta?.changes) throw new ValidationError("The selected music track no longer exists.");
  return (await listMusicTracks(db)).find((track) => track.id === id)!;
}

export async function deleteMusicTrack(db: AccountDatabase, id: string) {
  await ensureMusicSchema(db);
  await db.batch([
    db.prepare("DELETE FROM music_track_chunks WHERE track_id = ?").bind(id),
    db.prepare("DELETE FROM music_tracks WHERE id = ?").bind(id),
  ]);
}

function chunkBytes(value: unknown) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) return Uint8Array.from(value.map(Number));
  return new Uint8Array();
}

function parseRange(range: string | null, length: number) {
  if (!range) return { start: 0, end: length - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (!match) return null;
  if (!match[1] && !match[2]) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, length - suffix);
    end = length - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : length - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= length || end < start) {
    return null;
  }
  return { start, end: Math.min(length - 1, end), partial: true };
}

export async function musicTrackResponse(
  db: AccountDatabase,
  id: string,
  request: Request,
) {
  await ensureMusicSchema(db);
  const row = await db.prepare(
    "SELECT id, name, source_name, mime_type, byte_length, duration_ms, enabled, categories_json, weight, loop, gain_db, revision, created_at, updated_at FROM music_tracks WHERE id = ?",
  ).bind(id).first<MusicTrackRow>();
  if (!row || !row.enabled) return new Response("Track not found.", { status: 404 });
  const etag = `"${row.id}-${row.revision}"`;
  if (request.headers.get("if-none-match") === etag && !request.headers.get("range")) {
    return new Response(null, { status: 304, headers: { etag } });
  }
  const range = parseRange(request.headers.get("range"), row.byte_length);
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: { "content-range": `bytes */${row.byte_length}`, "accept-ranges": "bytes" },
    });
  }
  const firstChunk = Math.floor(range.start / MUSIC_CHUNK_BYTES);
  const lastChunk = Math.floor(range.end / MUSIC_CHUNK_BYTES);
  const result = await db.prepare(
    "SELECT chunk_index, data FROM music_track_chunks WHERE track_id = ? AND chunk_index BETWEEN ? AND ? ORDER BY chunk_index",
  ).bind(id, firstChunk, lastChunk).all() as {
    results?: Array<{ chunk_index: number; data: unknown }>;
  };
  const pieces = (result.results ?? []).map((entry) => chunkBytes(entry.data));
  const combinedLength = pieces.reduce((sum, piece) => sum + piece.byteLength, 0);
  const combined = new Uint8Array(combinedLength);
  let cursor = 0;
  for (const piece of pieces) {
    combined.set(piece, cursor);
    cursor += piece.byteLength;
  }
  const sourceStart = range.start - firstChunk * MUSIC_CHUNK_BYTES;
  const requestedLength = range.end - range.start + 1;
  const body = combined.slice(sourceStart, sourceStart + requestedLength);
  if (body.byteLength !== requestedLength) return new Response("Track data is incomplete.", { status: 503 });

  const headers = new Headers({
    "content-type": "audio/ogg",
    "content-length": String(body.byteLength),
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=31536000, immutable",
    etag,
  });
  if (range.partial) headers.set("content-range", `bytes ${range.start}-${range.end}/${row.byte_length}`);
  return new Response(body, { status: range.partial ? 206 : 200, headers });
}

export const SUPPORTED_MUSIC_CATEGORIES = MUSIC_CATEGORIES;
