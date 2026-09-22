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
import { ServiceUnavailableError, ValidationError } from "./server-errors";

export const MAX_MUSIC_TRACK_BYTES = 20 * 1024 * 1024;
const MAX_MUSIC_DURATION_MS = 60 * 60 * 1000;
const MUSIC_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

type MusicTrackRow = {
  id: string; name: string; artist: string; source_name: string; mime_type: string;
  byte_length: number; duration_ms: number; bitrate_bps: number; intense_lead_in_ms: number;
  enabled: number; categories_json: string; weight: number; loop: number; gain_db: number;
  revision: number; created_at: number; updated_at: number; object_key: string;
};

type MusicUploadRow = {
  id: string; administrator_id: string; source_name: string; byte_length: number;
  metadata_json: string; created_at: number;
};

function parseCategories(value: string) {
  try { return normalizeMusicCategories(JSON.parse(value)); } catch { return []; }
}

function trackObjectKey(id: string) { return `tracks/${id}.opus`; }

function toTrack(row: MusicTrackRow): MusicTrack {
  return {
    id: row.id, name: row.name, artist: row.artist ?? "", sourceName: row.source_name,
    mimeType: "audio/ogg", bytes: row.byte_length, durationMs: row.duration_ms,
    bitrate: Number(row.bitrate_bps) || 96_000,
    intenseLeadInMs: Number.isFinite(Number(row.intense_lead_in_ms)) ? Number(row.intense_lead_in_ms) : 4_000,
    enabled: Boolean(row.enabled), categories: parseCategories(row.categories_json),
    weight: row.weight, loop: Boolean(row.loop), gainDb: row.gain_db, revision: row.revision,
    createdAt: row.created_at, updatedAt: row.updated_at,
    url: `/api/music?track=${encodeURIComponent(row.id)}&v=${row.revision}`,
  };
}

export async function listMusicTracks(db: AccountDatabase): Promise<MusicTrack[]> {
  const result = await db.prepare(
    "SELECT id, name, artist, source_name, mime_type, byte_length, duration_ms, bitrate_bps, intense_lead_in_ms, enabled, categories_json, weight, loop, gain_db, revision, created_at, updated_at, object_key FROM music_tracks ORDER BY updated_at DESC",
  ).all() as { results?: MusicTrackRow[] };
  return (result.results ?? []).map(toTrack);
}

export async function getMusicManifest(db: AccountDatabase): Promise<MusicManifest> {
  const tracks = (await listMusicTracks(db)).filter((track) => track.enabled);
  return { revision: Math.max(0, ...tracks.map((track) => track.updatedAt)), tracks };
}

function normalizeMetadata(value: Partial<MusicTrackMetadata>): MusicTrackMetadata {
  const name = String(value.name ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!name) throw new ValidationError("Track name is required.");
  const artist = String(value.artist ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  const categories = normalizeMusicCategories(value.categories);
  if (!categories.length) throw new ValidationError("Choose at least one music category.");
  const weight = Math.round(Number(value.weight ?? 10));
  if (!Number.isFinite(weight) || weight < 1 || weight > 100) throw new ValidationError("Track weight must be between 1 and 100.");
  const gainDb = Number(value.gainDb ?? 0);
  if (!Number.isFinite(gainDb) || gainDb < MUSIC_GAIN_MIN_DB || gainDb > MUSIC_GAIN_MAX_DB) {
    throw new ValidationError(`Track volume trim must be between ${MUSIC_GAIN_MIN_DB} dB and +${MUSIC_GAIN_MAX_DB} dB.`);
  }
  const durationMs = Math.round(Number(value.durationMs ?? 0));
  if (!Number.isFinite(durationMs) || durationMs < 250 || durationMs > MAX_MUSIC_DURATION_MS) throw new ValidationError("Track duration is invalid.");
  const bitrate = Math.round(Number(value.bitrate ?? 96_000));
  if (!Number.isFinite(bitrate) || bitrate < 16_000 || bitrate > 512_000) throw new ValidationError("Track bitrate is invalid.");
  const intenseLeadInMs = Math.round(Number(value.intenseLeadInMs ?? 4_000));
  if (!Number.isFinite(intenseLeadInMs) || intenseLeadInMs < 0 || intenseLeadInMs > 15_000) throw new ValidationError("Intense lead-in must be between 0 and 15 seconds.");
  return { name, artist, enabled: value.enabled !== false, categories, weight, loop: Boolean(value.loop), gainDb: Math.round(gainDb * 10) / 10, durationMs, bitrate, intenseLeadInMs };
}

function safeSourceName(value: string) {
  const name = value.trim().replace(/[\\/]+/g, "-").replace(/[^a-zA-Z0-9._ ()-]+/g, "").slice(0, 160);
  return name || "imported-track.opus";
}

async function cleanupStaleMusicUploads(db: AccountDatabase, bucket: R2Bucket) {
  const cutoff = Date.now() - MUSIC_UPLOAD_TTL_MS;
  const stale = await db.prepare("SELECT id FROM music_uploads WHERE created_at < ?").bind(cutoff).all<{ id: string }>();
  const ids = (stale.results ?? []).map((row) => row.id);
  if (ids.length) await bucket.delete(ids.map(trackObjectKey));
  await db.prepare("DELETE FROM music_uploads WHERE created_at < ?").bind(cutoff).run();
}

export async function beginMusicUpload(
  db: AccountDatabase,
  bucket: R2Bucket,
  value: { fileName?: unknown; byteLength?: unknown; metadata?: Partial<MusicTrackMetadata> },
  administratorId: string,
) {
  await cleanupStaleMusicUploads(db, bucket);
  const sourceName = safeSourceName(String(value.fileName ?? ""));
  if (!/\.opus$/i.test(sourceName)) throw new ValidationError("Administrator imports must be converted to an .opus file first.");
  const byteLength = Math.round(Number(value.byteLength ?? 0));
  if (!Number.isFinite(byteLength) || byteLength < 1_000 || byteLength > MAX_MUSIC_TRACK_BYTES) {
    throw new ValidationError(`Optimized track must be between 1 KB and ${Math.floor(MAX_MUSIC_TRACK_BYTES / 1024 / 1024)} MB.`);
  }
  const metadata = normalizeMetadata(value.metadata ?? {});
  const id = `music-${crypto.randomUUID()}`;
  await db.prepare(
    "INSERT INTO music_uploads (id, administrator_id, source_name, byte_length, chunk_count, metadata_json, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
  ).bind(id, administratorId, sourceName, byteLength, JSON.stringify(metadata), Date.now()).run();
  return { uploadId: id };
}

async function musicUploadById(db: AccountDatabase, uploadId: string, administratorId: string) {
  const upload = await db.prepare(
    "SELECT id, administrator_id, source_name, byte_length, metadata_json, created_at FROM music_uploads WHERE id = ?",
  ).bind(uploadId).first<MusicUploadRow>();
  if (!upload || upload.administrator_id !== administratorId) throw new ValidationError("The music upload is no longer available.");
  return upload;
}

export async function storeMusicUploadObject(
  db: AccountDatabase, bucket: R2Bucket, uploadId: string, data: ReadableStream,
  byteLength: number, administratorId: string,
) {
  const upload = await musicUploadById(db, uploadId, administratorId);
  if (!Number.isSafeInteger(byteLength) || byteLength !== upload.byte_length) throw new ValidationError("Music upload size is invalid.");
  await bucket.put(trackObjectKey(upload.id), data, {
    httpMetadata: { contentType: "audio/ogg" }, customMetadata: { sourceName: upload.source_name },
  });
  return { ok: true };
}

export async function finalizeMusicUpload(db: AccountDatabase, bucket: R2Bucket, uploadId: string, administratorId: string) {
  const upload = await musicUploadById(db, uploadId, administratorId);
  const objectKey = trackObjectKey(upload.id);
  const object = await bucket.head(objectKey);
  if (!object || object.size !== upload.byte_length) throw new ValidationError("The music upload is incomplete. Retry the import.");
  let metadata: MusicTrackMetadata;
  try { metadata = normalizeMetadata(JSON.parse(upload.metadata_json) as Partial<MusicTrackMetadata>); }
  catch { throw new ValidationError("The music upload metadata is invalid."); }
  const now = Date.now();
  await db.batch([
    db.prepare(
      "INSERT INTO music_tracks (id, name, artist, source_name, mime_type, byte_length, duration_ms, bitrate_bps, intense_lead_in_ms, enabled, categories_json, weight, loop, gain_db, revision, created_at, updated_at, updated_by, object_key) VALUES (?, ?, ?, ?, 'audio/ogg', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)",
    ).bind(upload.id, metadata.name, metadata.artist, upload.source_name, upload.byte_length, metadata.durationMs, metadata.bitrate, metadata.intenseLeadInMs, metadata.enabled ? 1 : 0, JSON.stringify(metadata.categories), metadata.weight, metadata.loop ? 1 : 0, metadata.gainDb, now, now, administratorId, objectKey),
    db.prepare("DELETE FROM music_uploads WHERE id = ?").bind(upload.id),
  ]);
  return (await listMusicTracks(db)).find((track) => track.id === upload.id)!;
}

export async function abortMusicUpload(db: AccountDatabase, bucket: R2Bucket, uploadId: string, administratorId: string) {
  const upload = await musicUploadById(db, uploadId, administratorId);
  await Promise.all([
    bucket.delete(trackObjectKey(upload.id)),
    db.prepare("DELETE FROM music_uploads WHERE id = ?").bind(upload.id).run(),
  ]);
}

export async function updateMusicTrack(db: AccountDatabase, id: string, metadata: Partial<MusicTrackMetadata>, administratorId: string) {
  const current = (await listMusicTracks(db)).find((track) => track.id === id);
  if (!current) throw new ValidationError("The selected music track no longer exists.");
  const normalized = normalizeMetadata({ ...current, ...metadata, durationMs: current.durationMs });
  const result = await db.prepare(
    "UPDATE music_tracks SET name = ?, artist = ?, intense_lead_in_ms = ?, enabled = ?, categories_json = ?, weight = ?, loop = ?, gain_db = ?, revision = revision + 1, updated_at = ?, updated_by = ? WHERE id = ?",
  ).bind(normalized.name, normalized.artist, normalized.intenseLeadInMs, normalized.enabled ? 1 : 0, JSON.stringify(normalized.categories), normalized.weight, normalized.loop ? 1 : 0, normalized.gainDb, Date.now(), administratorId, id).run();
  if (!result.meta?.changes) throw new ValidationError("The selected music track no longer exists.");
  return (await listMusicTracks(db)).find((track) => track.id === id)!;
}

export async function deleteMusicTrack(db: AccountDatabase, bucket: R2Bucket, id: string) {
  const row = await db.prepare("SELECT object_key FROM music_tracks WHERE id = ?").bind(id).first<{ object_key: string }>();
  if (row?.object_key) await bucket.delete(row.object_key);
  await db.prepare("DELETE FROM music_tracks WHERE id = ?").bind(id).run();
}

function parseRange(range: string | null, length: number) {
  if (!range) return { start: 0, end: length - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, length - suffix); end = length - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : length - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= length || end < start) return null;
  return { start, end: Math.min(length - 1, end), partial: true };
}

export async function musicTrackResponse(db: AccountDatabase, bucket: R2Bucket, id: string, request: Request) {
  const row = await db.prepare(
    "SELECT id, enabled, byte_length, revision, object_key FROM music_tracks WHERE id = ?",
  ).bind(id).first<Pick<MusicTrackRow, "id" | "enabled" | "byte_length" | "revision" | "object_key">>();
  if (!row || !row.enabled || !row.object_key) return new Response("Track not found.", { status: 404 });
  const etag = `"${row.id}-${row.revision}"`;
  if (request.headers.get("if-none-match") === etag && !request.headers.get("range")) return new Response(null, { status: 304, headers: { etag } });
  const range = parseRange(request.headers.get("range"), row.byte_length);
  if (!range) return new Response(null, { status: 416, headers: { "content-range": `bytes */${row.byte_length}`, "accept-ranges": "bytes" } });
  const requestedLength = range.end - range.start + 1;
  const object = await bucket.get(row.object_key, range.partial ? { range: { offset: range.start, length: requestedLength } } : undefined);
  if (!object?.body) throw new ServiceUnavailableError("Music is temporarily unavailable.", `R2 object ${row.object_key} is missing.`);
  const headers = new Headers({
    "content-type": "audio/ogg", "content-length": String(requestedLength), "accept-ranges": "bytes",
    "cache-control": "public, max-age=31536000, immutable", etag,
  });
  if (range.partial) headers.set("content-range", `bytes ${range.start}-${range.end}/${row.byte_length}`);
  return new Response(object.body, { status: range.partial ? 206 : 200, headers });
}

export const SUPPORTED_MUSIC_CATEGORIES = MUSIC_CATEGORIES;
