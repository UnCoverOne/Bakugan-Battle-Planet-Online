import type { AccountDatabase } from "./account-server";
import {
  MUSIC_CATEGORIES,
  MUSIC_GAIN_MAX_DB,
  MUSIC_GAIN_MIN_DB,
  normalizeMusicCategories,
  type MusicManifest,
  type MusicTrack,
  type MusicTrackMetadata,
} from "./music";
import { ValidationError } from "./server-errors";

export const MUSIC_UPLOAD_CHUNK_BYTES = 64 * 1024;
export const LEGACY_MUSIC_UPLOAD_CHUNK_BYTES = 256 * 1024;
export const MAX_MUSIC_UPLOAD_CHUNK_BYTES = Math.max(
  MUSIC_UPLOAD_CHUNK_BYTES,
  LEGACY_MUSIC_UPLOAD_CHUNK_BYTES,
);
export const MAX_MUSIC_TRACK_BYTES = 20 * 1024 * 1024;
const MAX_MUSIC_DURATION_MS = 60 * 60 * 1000;
const MUSIC_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

let musicSchemaReady = false;

type MusicTrackRow = {
  id: string;
  name: string;
  artist: string;
  source_name: string;
  mime_type: string;
  byte_length: number;
  duration_ms: number;
  bitrate_bps: number;
  intense_lead_in_ms: number;
  enabled: number;
  categories_json: string;
  weight: number;
  loop: number;
  gain_db: number;
  revision: number;
  created_at: number;
  updated_at: number;
  chunk_bytes?: number;
};

type MusicUploadRow = {
  id: string;
  administrator_id: string;
  source_name: string;
  byte_length: number;
  chunk_count: number;
  metadata_json: string;
  created_at: number;
};

export async function ensureMusicSchema(db: AccountDatabase) {
  if (musicSchemaReady) return;
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS music_tracks (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, artist TEXT NOT NULL DEFAULT '', source_name TEXT NOT NULL, mime_type TEXT NOT NULL, byte_length INTEGER NOT NULL, duration_ms INTEGER NOT NULL, bitrate_bps INTEGER NOT NULL DEFAULT 96000, intense_lead_in_ms INTEGER NOT NULL DEFAULT 4000, enabled INTEGER NOT NULL DEFAULT 1, categories_json TEXT NOT NULL, weight INTEGER NOT NULL DEFAULT 10, loop INTEGER NOT NULL DEFAULT 0, gain_db REAL NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT)"),
    db.prepare("CREATE INDEX IF NOT EXISTS music_tracks_enabled_idx ON music_tracks(enabled, updated_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS music_track_chunks (track_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (track_id, chunk_index), FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE)"),
    db.prepare("CREATE INDEX IF NOT EXISTS music_track_chunks_track_idx ON music_track_chunks(track_id, chunk_index)"),
    db.prepare("CREATE TABLE IF NOT EXISTS music_uploads (id TEXT PRIMARY KEY NOT NULL, administrator_id TEXT NOT NULL, source_name TEXT NOT NULL, byte_length INTEGER NOT NULL, chunk_count INTEGER NOT NULL, metadata_json TEXT NOT NULL, created_at INTEGER NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS music_uploads_created_idx ON music_uploads(created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS music_upload_chunks (upload_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (upload_id, chunk_index), FOREIGN KEY (upload_id) REFERENCES music_uploads(id) ON DELETE CASCADE)"),
    db.prepare("CREATE INDEX IF NOT EXISTS music_upload_chunks_upload_idx ON music_upload_chunks(upload_id, chunk_index)"),
  ]);
  const columns = await db.prepare("PRAGMA table_info(music_tracks)").all() as {
    results?: Array<{ name: string }>;
  };
  const names = new Set((columns.results ?? []).map((column) => column.name));
  const addColumn = async (name: string, sql: string) => {
    if (names.has(name)) return;
    try {
      await db.prepare(sql).run();
    } catch (error) {
      if (!/duplicate column/i.test(error instanceof Error ? error.message : String(error))) throw error;
    }
  };
  await addColumn("artist", "ALTER TABLE music_tracks ADD COLUMN artist TEXT NOT NULL DEFAULT ''");
  await addColumn("bitrate_bps", "ALTER TABLE music_tracks ADD COLUMN bitrate_bps INTEGER NOT NULL DEFAULT 96000");
  await addColumn("intense_lead_in_ms", "ALTER TABLE music_tracks ADD COLUMN intense_lead_in_ms INTEGER NOT NULL DEFAULT 4000");
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
    artist: row.artist ?? "",
    sourceName: row.source_name,
    mimeType: "audio/ogg",
    bytes: row.byte_length,
    durationMs: row.duration_ms,
    bitrate: Number(row.bitrate_bps) || 96_000,
    intenseLeadInMs: Number.isFinite(Number(row.intense_lead_in_ms)) ? Number(row.intense_lead_in_ms) : 4_000,
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
    "SELECT id, name, artist, source_name, mime_type, byte_length, duration_ms, bitrate_bps, intense_lead_in_ms, enabled, categories_json, weight, loop, gain_db, revision, created_at, updated_at FROM music_tracks ORDER BY updated_at DESC",
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
  const artist = String(value.artist ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  const categories = normalizeMusicCategories(value.categories);
  if (!categories.length) throw new ValidationError("Choose at least one music category.");
  const weight = Math.round(Number(value.weight ?? 10));
  if (!Number.isFinite(weight) || weight < 1 || weight > 100) {
    throw new ValidationError("Track weight must be between 1 and 100.");
  }
  const gainDb = Number(value.gainDb ?? 0);
  if (!Number.isFinite(gainDb) || gainDb < MUSIC_GAIN_MIN_DB || gainDb > MUSIC_GAIN_MAX_DB) {
    throw new ValidationError(`Track volume trim must be between ${MUSIC_GAIN_MIN_DB} dB and +${MUSIC_GAIN_MAX_DB} dB.`);
  }
  const durationMs = Math.round(Number(value.durationMs ?? 0));
  if (!Number.isFinite(durationMs) || durationMs < 250 || durationMs > MAX_MUSIC_DURATION_MS) {
    throw new ValidationError("Track duration is invalid.");
  }
  const bitrate = Math.round(Number(value.bitrate ?? 96_000));
  if (!Number.isFinite(bitrate) || bitrate < 16_000 || bitrate > 512_000) {
    throw new ValidationError("Track bitrate is invalid.");
  }
  const intenseLeadInMs = Math.round(Number(value.intenseLeadInMs ?? 4_000));
  if (!Number.isFinite(intenseLeadInMs) || intenseLeadInMs < 0 || intenseLeadInMs > 15_000) {
    throw new ValidationError("Intense lead-in must be between 0 and 15 seconds.");
  }
  return {
    name,
    artist,
    enabled: value.enabled !== false,
    categories,
    weight,
    loop: Boolean(value.loop),
    gainDb: Math.round(gainDb * 10) / 10,
    durationMs,
    bitrate,
    intenseLeadInMs,
  };
}

export function musicUploadChunkBytes(byteLength: number, chunkCount: number) {
  const candidates = [
    MUSIC_UPLOAD_CHUNK_BYTES,
    LEGACY_MUSIC_UPLOAD_CHUNK_BYTES,
  ];
  for (const candidate of candidates) {
    if (Math.ceil(byteLength / candidate) === chunkCount) return candidate;
  }
  return MUSIC_UPLOAD_CHUNK_BYTES;
}

function safeSourceName(value: string) {
  const name = value.trim().replace(/[\\/]+/g, "-").replace(/[^a-zA-Z0-9._ ()-]+/g, "").slice(0, 160);
  return name || "imported-track.opus";
}

async function cleanupStaleMusicUploads(db: AccountDatabase) {
  const cutoff = Date.now() - MUSIC_UPLOAD_TTL_MS;
  await db.batch([
    db.prepare("DELETE FROM music_upload_chunks WHERE upload_id IN (SELECT id FROM music_uploads WHERE created_at < ?)").bind(cutoff),
    db.prepare("DELETE FROM music_uploads WHERE created_at < ?").bind(cutoff),
  ]);
}

export async function beginMusicUpload(
  db: AccountDatabase,
  value: {
    fileName?: unknown;
    byteLength?: unknown;
    metadata?: Partial<MusicTrackMetadata>;
  },
  administratorId: string,
) {
  await ensureMusicSchema(db);
  await cleanupStaleMusicUploads(db);
  const sourceName = safeSourceName(String(value.fileName ?? ""));
  if (!/\.opus$/i.test(sourceName)) {
    throw new ValidationError("Administrator imports must be converted to an .opus file first.");
  }
  const byteLength = Math.round(Number(value.byteLength ?? 0));
  if (!Number.isFinite(byteLength) || byteLength < 1_000 || byteLength > MAX_MUSIC_TRACK_BYTES) {
    throw new ValidationError(`Optimized track must be between 1 KB and ${Math.floor(MAX_MUSIC_TRACK_BYTES / 1024 / 1024)} MB.`);
  }
  const metadata = normalizeMetadata(value.metadata ?? {});
  const id = `music-${crypto.randomUUID()}`;
  const chunkCount = Math.ceil(byteLength / MUSIC_UPLOAD_CHUNK_BYTES);
  await db.prepare(
    "INSERT INTO music_uploads (id, administrator_id, source_name, byte_length, chunk_count, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    id,
    administratorId,
    sourceName,
    byteLength,
    chunkCount,
    JSON.stringify(metadata),
    Date.now(),
  ).run();
  return { uploadId: id, chunkBytes: MUSIC_UPLOAD_CHUNK_BYTES, chunkCount };
}

async function musicUploadById(
  db: AccountDatabase,
  uploadId: string,
  administratorId: string,
) {
  const upload = await db.prepare(
    "SELECT id, administrator_id, source_name, byte_length, chunk_count, metadata_json, created_at FROM music_uploads WHERE id = ?",
  ).bind(uploadId).first<MusicUploadRow>();
  if (!upload || upload.administrator_id !== administratorId) {
    throw new ValidationError("The music upload is no longer available.");
  }
  return upload;
}

export async function storeMusicUploadChunk(
  db: AccountDatabase,
  uploadId: string,
  chunkIndex: number,
  data: ArrayBuffer,
  administratorId: string,
) {
  await ensureMusicSchema(db);
  const upload = await musicUploadById(db, uploadId, administratorId);
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= upload.chunk_count) {
    throw new ValidationError("Music upload chunk index is invalid.");
  }
  const chunkBytes = musicUploadChunkBytes(upload.byte_length, upload.chunk_count);
  const expectedBytes = chunkIndex === upload.chunk_count - 1
    ? upload.byte_length - chunkIndex * chunkBytes
    : chunkBytes;
  if (data.byteLength !== expectedBytes) {
    throw new ValidationError("Music upload chunk size is invalid.");
  }
  await db.prepare(
    "INSERT INTO music_upload_chunks (upload_id, chunk_index, data) VALUES (?, ?, ?) ON CONFLICT(upload_id, chunk_index) DO UPDATE SET data = excluded.data",
  ).bind(uploadId, chunkIndex, data).run();
  return { ok: true, chunkIndex };
}

export async function finalizeMusicUpload(
  db: AccountDatabase,
  uploadId: string,
  administratorId: string,
) {
  await ensureMusicSchema(db);
  const upload = await musicUploadById(db, uploadId, administratorId);
  const aggregate = await db.prepare(
    "SELECT COUNT(*) AS chunk_count, COALESCE(SUM(length(data)), 0) AS byte_length FROM music_upload_chunks WHERE upload_id = ?",
  ).bind(uploadId).first<{ chunk_count: number; byte_length: number }>();
  if (
    Number(aggregate?.chunk_count ?? 0) !== upload.chunk_count
    || Number(aggregate?.byte_length ?? 0) !== upload.byte_length
  ) {
    throw new ValidationError("The music upload is incomplete. Retry the import.");
  }
  let metadata: MusicTrackMetadata;
  try {
    metadata = normalizeMetadata(JSON.parse(upload.metadata_json) as Partial<MusicTrackMetadata>);
  } catch {
    throw new ValidationError("The music upload metadata is invalid.");
  }
  const now = Date.now();
  await db.batch([
    db.prepare(
      "INSERT INTO music_tracks (id, name, artist, source_name, mime_type, byte_length, duration_ms, bitrate_bps, intense_lead_in_ms, enabled, categories_json, weight, loop, gain_db, revision, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, 'audio/ogg', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
    ).bind(
      upload.id,
      metadata.name,
      metadata.artist,
      upload.source_name,
      upload.byte_length,
      metadata.durationMs,
      metadata.bitrate,
      metadata.intenseLeadInMs,
      metadata.enabled ? 1 : 0,
      JSON.stringify(metadata.categories),
      metadata.weight,
      metadata.loop ? 1 : 0,
      metadata.gainDb,
      now,
      now,
      administratorId,
    ),
    db.prepare(
      "INSERT INTO music_track_chunks (track_id, chunk_index, data) SELECT ?, chunk_index, data FROM music_upload_chunks WHERE upload_id = ? ORDER BY chunk_index",
    ).bind(upload.id, upload.id),
    db.prepare("DELETE FROM music_upload_chunks WHERE upload_id = ?").bind(upload.id),
    db.prepare("DELETE FROM music_uploads WHERE id = ?").bind(upload.id),
  ]);
  return (await listMusicTracks(db)).find((track) => track.id === upload.id)!;
}

export async function abortMusicUpload(
  db: AccountDatabase,
  uploadId: string,
  administratorId: string,
) {
  await ensureMusicSchema(db);
  await musicUploadById(db, uploadId, administratorId);
  await db.batch([
    db.prepare("DELETE FROM music_upload_chunks WHERE upload_id = ?").bind(uploadId),
    db.prepare("DELETE FROM music_uploads WHERE id = ?").bind(uploadId),
  ]);
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
    "UPDATE music_tracks SET name = ?, artist = ?, intense_lead_in_ms = ?, enabled = ?, categories_json = ?, weight = ?, loop = ?, gain_db = ?, revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ?",
  ).bind(
    normalized.name,
    normalized.artist,
    normalized.intenseLeadInMs,
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
    "SELECT music_tracks.id, music_tracks.name, music_tracks.artist, music_tracks.source_name, music_tracks.mime_type, music_tracks.byte_length, music_tracks.duration_ms, music_tracks.bitrate_bps, music_tracks.intense_lead_in_ms, music_tracks.enabled, music_tracks.categories_json, music_tracks.weight, music_tracks.loop, music_tracks.gain_db, music_tracks.revision, music_tracks.created_at, music_tracks.updated_at, COALESCE((SELECT length(data) FROM music_track_chunks WHERE track_id = music_tracks.id ORDER BY chunk_index LIMIT 1), 0) AS chunk_bytes FROM music_tracks WHERE music_tracks.id = ?",
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
  const storedChunkBytes = Number(row.chunk_bytes ?? 0) > 0
    ? Number(row.chunk_bytes)
    : MUSIC_UPLOAD_CHUNK_BYTES;
  const firstChunk = Math.floor(range.start / storedChunkBytes);
  const lastChunk = Math.floor(range.end / storedChunkBytes);
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
  const sourceStart = range.start - firstChunk * storedChunkBytes;
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
