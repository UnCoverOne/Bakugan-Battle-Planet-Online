import { getDatabase } from "../../../lib/account-server";
import { assertSameOrigin, enforceD1RateLimit, RateLimitError, requestClientKey } from "../../../lib/request-security";

export const dynamic = "force-dynamic";

const allowedMetrics = new Set(["CLS", "INP", "LCP", "TTFB"]);
const allowedDevices = new Set(["small", "medium", "large"]);

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const db = await getDatabase();
    await db.prepare(
      "CREATE TABLE IF NOT EXISTS rum_events (id TEXT PRIMARY KEY, route TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL, device TEXT NOT NULL, created_at INTEGER NOT NULL)",
    ).run();
    await enforceD1RateLimit(db, `rum:${requestClientKey(request)}`, 40, 60_000);
    const body = await request.json() as { route?: unknown; metric?: unknown; value?: unknown; device?: unknown };
    const route = typeof body.route === "string" ? body.route.slice(0, 120) : "";
    const metric = typeof body.metric === "string" ? body.metric : "";
    const value = Number(body.value);
    const device = typeof body.device === "string" ? body.device : "";
    if (!route.startsWith("/") || !allowedMetrics.has(metric) || !Number.isFinite(value) || value < 0 || value > 120_000 || !allowedDevices.has(device)) {
      return new Response(null, { status: 422 });
    }
    await db.prepare(
      "INSERT INTO rum_events (id, route, metric, value, device, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), route, metric, value, device, Date.now()).run();
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return new Response(null, { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } });
    }
    return new Response(null, { status: 400 });
  }
}
