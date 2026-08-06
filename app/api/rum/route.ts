import { getDatabase } from "../../../lib/account-server";
import { assertSameOrigin, enforceD1RateLimit, requestClientKey } from "../../../lib/request-security";
import { ValidationError, serverErrorResponse } from "../../../lib/server-errors";

export const dynamic = "force-dynamic";

const allowedMetrics = new Set(["CLS", "INP", "LCP", "TTFB"]);
const allowedDevices = new Set(["small", "medium", "large"]);

export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const db = await getDatabase();
    await db.prepare(
      "CREATE TABLE IF NOT EXISTS rum_events (id TEXT PRIMARY KEY, route TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL, device TEXT NOT NULL, created_at INTEGER NOT NULL)",
    ).run();
    await enforceD1RateLimit(db, `rum:${requestClientKey(request)}`, 40, 60_000);
    let body: { route?: unknown; metric?: unknown; value?: unknown; device?: unknown };
    try {
      body = await request.json() as typeof body;
    } catch {
      throw new ValidationError("Telemetry request is not valid JSON.");
    }
    const route = typeof body.route === "string" ? body.route.slice(0, 120) : "";
    const metric = typeof body.metric === "string" ? body.metric : "";
    const value = Number(body.value);
    const device = typeof body.device === "string" ? body.device : "";
    if (!route.startsWith("/") || !allowedMetrics.has(metric) || !Number.isFinite(value) || value < 0 || value > 120_000 || !allowedDevices.has(device)) {
      throw new ValidationError("Telemetry payload is invalid.");
    }
    await db.prepare(
      "INSERT INTO rum_events (id, route, metric, value, device, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), route, metric, value, device, Date.now()).run();
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store", "x-correlation-id": correlationId },
    });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Telemetry could not be recorded.", {
      route: "/api/rum",
      method: "POST",
    });
  }
}
