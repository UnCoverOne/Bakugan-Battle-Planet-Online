import { getDatabase, requireAdministrator } from "../../../../lib/account-server";
import {
  abortMusicUpload,
  beginMusicUpload,
  deleteMusicTrack,
  finalizeMusicUpload,
  listMusicTracks,
  MAX_MUSIC_TRACK_BYTES,
  MUSIC_UPLOAD_CHUNK_BYTES,
  storeMusicUploadChunk,
  SUPPORTED_MUSIC_CATEGORIES,
  updateMusicTrack,
} from "../../../../lib/music-server";
import { assertSameOrigin, enforceD1RateLimit, requestClientKey } from "../../../../lib/request-security";
import { serverErrorResponse, ValidationError } from "../../../../lib/server-errors";

export const dynamic = "force-dynamic";

const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
});

async function jsonBody(request: Request) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    throw new ValidationError("Administrator request is not valid JSON.");
  }
}

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    await requireAdministrator(request);
    const db = await getDatabase();
    return json({
      tracks: await listMusicTracks(db),
      categories: SUPPORTED_MUSIC_CATEGORIES,
      maxTrackBytes: MAX_MUSIC_TRACK_BYTES,
      uploadChunkBytes: MUSIC_UPLOAD_CHUNK_BYTES,
      correlationId,
    });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Music administration is unavailable.", {
      route: "/api/admin/music",
      method: "GET",
    });
  }
}

export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const administrator = await requireAdministrator(request);
    const db = await getDatabase();
    await enforceD1RateLimit(db, `admin-music:${administrator.id}:${requestClientKey(request)}`, 60, 60_000);
    const body = await jsonBody(request);
    const action = String(body.action ?? "");

    if (action === "begin-upload") {
      const upload = await beginMusicUpload(db, {
        fileName: body.fileName,
        byteLength: body.byteLength,
        metadata: body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
          ? body.metadata as never
          : {},
      }, administrator.id);
      return json({ ...upload, correlationId }, 201);
    }

    if (action === "finalize-upload") {
      const uploadId = String(body.uploadId ?? "");
      if (!uploadId) throw new ValidationError("Music upload ID is required.");
      const track = await finalizeMusicUpload(db, uploadId, administrator.id);
      return json({ track, correlationId }, 201);
    }

    throw new ValidationError("Music administrator action is invalid.");
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Music track could not be imported.", {
      route: "/api/admin/music",
      method: "POST",
    });
  }
}

export async function PUT(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const administrator = await requireAdministrator(request);
    const db = await getDatabase();
    await enforceD1RateLimit(db, `admin-music-chunk:${administrator.id}:${requestClientKey(request)}`, 600, 60_000);
    const url = new URL(request.url);
    const uploadId = String(url.searchParams.get("upload") ?? "");
    const chunkIndex = Number(url.searchParams.get("index"));
    if (!uploadId) throw new ValidationError("Music upload ID is required.");
    const data = await request.arrayBuffer();
    const result = await storeMusicUploadChunk(db, uploadId, chunkIndex, data, administrator.id);
    return json({ ...result, correlationId });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Music upload chunk could not be stored.", {
      route: "/api/admin/music",
      method: "PUT",
    });
  }
}

export async function PATCH(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const administrator = await requireAdministrator(request);
    const db = await getDatabase();
    await enforceD1RateLimit(db, `admin-music:${administrator.id}:${requestClientKey(request)}`, 120, 60_000);
    const body = await jsonBody(request);
    const id = String(body.id ?? "");
    if (!id) throw new ValidationError("Music track ID is required.");
    const track = await updateMusicTrack(db, id, {
      name: String(body.name ?? ""),
      artist: String(body.artist ?? ""),
      intenseLeadInMs: Number(body.intenseLeadInMs ?? 4_000),
      enabled: body.enabled !== false,
      categories: body.categories as never,
      weight: Number(body.weight ?? 10),
      loop: Boolean(body.loop),
      gainDb: Number(body.gainDb ?? 0),
    }, administrator.id);
    return json({ track, correlationId });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Music track could not be updated.", {
      route: "/api/admin/music",
      method: "PATCH",
    });
  }
}

export async function DELETE(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const administrator = await requireAdministrator(request);
    const db = await getDatabase();
    await enforceD1RateLimit(db, `admin-music:${administrator.id}:${requestClientKey(request)}`, 120, 60_000);
    const url = new URL(request.url);
    const uploadId = String(url.searchParams.get("upload") ?? "");
    if (uploadId) {
      await abortMusicUpload(db, uploadId, administrator.id);
      return json({ ok: true, correlationId });
    }
    const id = String(url.searchParams.get("id") ?? "");
    if (!id) throw new ValidationError("Music track ID is required.");
    await deleteMusicTrack(db, id);
    return json({ ok: true, correlationId });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Music track could not be deleted.", {
      route: "/api/admin/music",
      method: "DELETE",
    });
  }
}
