import { AuthorizationError, RateLimitError } from "./server-errors";

export { RateLimitError } from "./server-errors";

type RateLimitDatabase = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      first<T>(): Promise<T | null>;
    };
  };
};

export function assertSameOrigin(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    throw new AuthorizationError(
      "Cross-site state changes are not allowed.",
      "Request was rejected because sec-fetch-site was cross-site.",
    );
  }
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).origin !== new URL(request.url).origin) {
    throw new AuthorizationError(
      "Request origin is not allowed.",
      `Request origin ${origin} did not match ${new URL(request.url).origin}.`,
    );
  }
}

export async function enforceD1RateLimit(
  database: RateLimitDatabase,
  key: string,
  maximum: number,
  windowMs: number,
) {
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  await database.prepare(
    "INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1",
  ).bind(key, windowStart).run();
  const row = await database.prepare("SELECT count FROM rate_limits WHERE key = ? AND window_start = ?")
    .bind(key, windowStart).first<{ count: number }>();
  if (Number(row?.count ?? 0) > maximum) {
    throw new RateLimitError(Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)));
  }
}

export function requestClientKey(request: Request) {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anonymous";
}
