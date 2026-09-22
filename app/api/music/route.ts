import { getDatabase, getMusicBucket } from "../../../lib/account-server";
import { getMusicManifest, musicTrackResponse } from "../../../lib/music-server";
import { serverErrorResponse, ValidationError } from "../../../lib/server-errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const db = await getDatabase();
    const url = new URL(request.url);
    const trackId = url.searchParams.get("track");
    if (trackId) {
      if (!/^music-[a-z0-9-]{8,}$/i.test(trackId)) throw new ValidationError("Music track ID is invalid.");
      return musicTrackResponse(db, await getMusicBucket(), trackId, request);
    }
    return Response.json(await getMusicManifest(db), {
      headers: { "cache-control": "public, max-age=30, stale-while-revalidate=300" },
    });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Music is temporarily unavailable.", {
      route: "/api/music",
      method: "GET",
    });
  }
}
