import { getDatabase, requireAdministrator } from "../../../../lib/account-server";
import {
  deleteMusicTrack,
  importMusicTrack,
  listMusicTracks,
  MAX_MUSIC_TRACK_BYTES,
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

function parseMetadata(form: FormData) {
  let categories: unknown = [];
  try {
    categories = JSON.parse(String(form.get("categories") ?? "[]"));
  } catch {
    throw new ValidationError("Music categories are invalid.");
  }
  return {
    name: String(form.get("name") ?? ""),
    enabled: String(form.get("enabled") ?? "true") === "true",
    categories,
    weight: Number(form.get("weight") ?? 10),
    loop: String(form.get("loop") ?? "false") === "true",
    gainDb: Number(form.get("gainDb") ?? 0),
    durationMs: Number(form.get("durationMs") ?? 0),
  };
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
    await enforceD1RateLimit(db, `admin-music:${administrator.id}:${requestClientKey(request)}`, 12, 60_000);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ValidationError("Choose an optimized Opus file to import.");
    const track = await importMusicTrack(db, file, parseMetadata(form), administrator.id);
    return json({ track, correlationId }, 201);
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Music track could not be imported.", {
      route: "/api/admin/music",
      method: "POST",
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
    const body = await request.json() as Record<string, unknown>;
    const id = String(body.id ?? "");
    if (!id) throw new ValidationError("Music track ID is required.");
    const track = await updateMusicTrack(db, id, {
      name: String(body.name ?? ""),
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
    await enforceD1RateLimit(db, `admin-music:${administrator.id}:${requestClientKey(request)}`, 60, 60_000);
    const id = new URL(request.url).searchParams.get("id") ?? "";
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
