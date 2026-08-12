import { getDatabase, getSessionUser } from "../../../lib/account-server";
import {
  CARD_CATALOGUE_VERSION,
  CONTENT_SCHEMA_VERSION,
  DIGITAL_ADAPTATION_VERSION,
  ENGINE_VERSION,
  RULES_VERSION,
} from "../../../lib/engine";
import { buildProjectedReplayBundle, encodeReplayTransport } from "../../../lib/engine/replay-playback";
import type { ReplayArchive } from "../../../lib/engine/replay-types";
import { loadRecentReplaySummaries, loadReplayForUser } from "../../../lib/replay-archive-server";
import { AuthenticationError, ConflictError, ValidationError, serverErrorResponse } from "../../../lib/server-errors";

export const dynamic = "force-dynamic";

const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "private, no-store, max-age=0" },
});

function assertCompatible(archive: ReplayArchive) {
  const expected = {
    engineVersion: ENGINE_VERSION,
    rulesVersion: RULES_VERSION,
    cardCatalogueVersion: CARD_CATALOGUE_VERSION,
    digitalAdaptationVersion: DIGITAL_ADAPTATION_VERSION,
    contentSchemaVersion: CONTENT_SCHEMA_VERSION,
  };
  const mismatch = Object.entries(expected).find(([key, value]) => (
    archive.versions[key as keyof typeof expected] !== value
  ));
  if (mismatch) {
    throw new ConflictError(
      "This replay was recorded with a game version that is not available in this build.",
      `Replay ${mismatch[0]} ${String(archive.versions[mismatch[0] as keyof typeof expected])} does not match ${String(mismatch[1])}.`,
    );
  }
}

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const user = await getSessionUser(request);
    if (!user) throw new AuthenticationError();
    const replayId = new URL(request.url).searchParams.get("id")?.trim() ?? "";
    const database = await getDatabase();
    if (!replayId) return json({ records: await loadRecentReplaySummaries(database, user.id), correlationId });
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(replayId)) throw new ValidationError("Replay ID is invalid.");
    const row = await loadReplayForUser(database, replayId, user.id);
    if (!row) return json({ error: "Replay not found.", code: "NOT_FOUND", correlationId }, 404);
    let archive: ReplayArchive;
    try { archive = JSON.parse(row.archive_json) as ReplayArchive; } catch { throw new ConflictError("This replay archive is damaged."); }
    assertCompatible(archive);
    const bundle = encodeReplayTransport(buildProjectedReplayBundle(archive, row.player_id));
    return json({ bundle, correlationId });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Could not load replay.", { route: "/api/replays", method: "GET" });
  }
}
