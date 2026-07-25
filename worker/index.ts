/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { concedeMatch, normalizeMatchState, redactForPlayer, type MatchState } from "../lib/game";
import { nextMatchAlarmAt, resolveExpiredDeadline } from "../lib/deadlines";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MATCHES: DurableObjectNamespace;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

type HibernatingState = {
  acceptWebSocket(socket: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    deleteAll(): Promise<void>;
    setAlarm(timestamp: number): Promise<void>;
  };
};

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (item) => item.toString(16).padStart(2, "0")).join("");
}

export class MatchRoom {
  constructor(private state: HibernatingState, private env: Env) {}

  private async publish(match: MatchState) {
    await this.state.storage.put("snapshot", match);
    await this.state.storage.setAlarm(nextMatchAlarmAt(match));
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment?.() as { playerId?: string } | undefined;
      if (attachment?.playerId) socket.send(JSON.stringify({ type: "state", state: redactForPlayer(match, attachment.playerId) }));
    }
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/publish") {
      const match = await request.json() as MatchState;
      await this.publish(match);
      return new Response(null, { status: 204 });
    }

    if (request.method === "POST" && url.pathname === "/action") {
      const code = String(url.searchParams.get("code") ?? "").toUpperCase();
      const originalUrl = request.headers.get("x-original-url") ?? "https://match.invalid/api/game";
      const headers = new Headers(request.headers);
      headers.set("x-match-coordinator", "durable-object");
      headers.delete("x-original-url");
      const internalRequest = new Request(originalUrl, { method: "POST", headers, body: request.body, duplex: "half" } as RequestInit & { duplex: "half" });
      const context: ExecutionContext = { waitUntil: () => undefined, passThroughOnException: () => undefined };
      const response = await handler.fetch(internalRequest, this.env, context);
      const row = await this.env.DB.prepare("SELECT state_json FROM matches WHERE code = ?").bind(code).first<{ state_json: string }>();
      if (row?.state_json) await this.publish(JSON.parse(row.state_json) as MatchState);
      return response;
    }

    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket required", { status: 426 });
    const code = String(url.searchParams.get("code") ?? "").toUpperCase();
    const playerId = String(url.searchParams.get("playerId") ?? "");
    const protocols = (request.headers.get("sec-websocket-protocol") ?? "").split(",").map((value) => value.trim());
    const capability = protocols.find((value) => value.startsWith("cap."))?.slice(4)
      ?? String(url.searchParams.get("capability") ?? "");
    const seat = await this.env.DB.prepare("SELECT capability_hash FROM match_seats WHERE code = ? AND player_id = ?")
      .bind(code, playerId).first<{ capability_hash: string }>();
    if (!seat || !capability || seat.capability_hash !== await sha256(capability)) return new Response("Forbidden", { status: 403 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment?.({ playerId });
    this.state.acceptWebSocket(server, [playerId]);
    await this.env.DB.prepare(
      "INSERT INTO match_presence (code, player_id, last_seen, connected) VALUES (?, ?, ?, 1) ON CONFLICT(code, player_id) DO UPDATE SET last_seen = excluded.last_seen, connected = 1",
    ).bind(code, playerId, Date.now()).run();
    let snapshot = await this.state.storage.get<MatchState>("snapshot");
    if (!snapshot) {
      const row = await this.env.DB.prepare("SELECT state_json FROM matches WHERE code = ?").bind(code).first<{ state_json: string }>();
      if (row?.state_json) {
        snapshot = JSON.parse(row.state_json) as MatchState;
        await this.state.storage.put("snapshot", snapshot);
      }
    }
    if (snapshot) server.send(JSON.stringify({ type: "state", state: redactForPlayer(snapshot, playerId) }));
    if (snapshot) await this.state.storage.setAlarm(nextMatchAlarmAt(snapshot));
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "sec-websocket-protocol": "bbp-match-v1" },
    } as ResponseInit & { webSocket: WebSocket });
  }

  async webSocketClose(socket: WebSocket) {
    const attachment = socket.deserializeAttachment?.() as { playerId?: string } | undefined;
    const snapshot = await this.state.storage.get<MatchState>("snapshot");
    if (attachment?.playerId && snapshot?.code) {
      await this.env.DB.prepare("UPDATE match_presence SET connected = 0, last_seen = ? WHERE code = ? AND player_id = ?")
        .bind(Date.now(), snapshot.code, attachment.playerId).run();
      await this.state.storage.setAlarm(Math.min(nextMatchAlarmAt(snapshot), Date.now() + 2 * 60 * 1_000));
    }
  }
  async webSocketError(socket: WebSocket) { await this.webSocketClose(socket); }

  async alarm() {
    const stored = await this.state.storage.get<MatchState>("snapshot");
    if (!stored) return;
    const now = Date.now();
    const snapshot = normalizeMatchState(stored);
    if (["lobby", "result"].includes(snapshot.phase)) {
      if (!this.state.getWebSockets().length) await this.state.storage.deleteAll();
      else await this.state.storage.setAlarm(nextMatchAlarmAt(snapshot, now));
      return;
    }

    let next = resolveExpiredDeadline(snapshot, now);
    if (next.version === snapshot.version) {
      const presence = await this.env.DB.prepare(
        "SELECT player_id, last_seen FROM match_presence WHERE code = ? AND connected = 0 ORDER BY last_seen ASC LIMIT 1",
      ).bind(snapshot.code).first<{ player_id: string; last_seen: number }>();
      if (presence && now - Number(presence.last_seen) >= 2 * 60 * 1_000) {
        next = concedeMatch(snapshot, presence.player_id);
        next.resultReason = "Opponent abandoned the match";
        next.log.push({
          id: `${now}-abandonment`, at: now, kind: "system",
          message: `${snapshot.players.find((player) => player.id === presence.player_id)?.name ?? "A player"} abandoned the match after two minutes disconnected.`,
        });
      }
    }

    if (next.version !== snapshot.version) {
      const saved = await this.env.DB.prepare(
        "UPDATE matches SET state_json = ?, previous_state_json = ?, updated_at = ? WHERE code = ? AND CAST(json_extract(state_json, '$.version') AS INTEGER) = ?",
      ).bind(JSON.stringify(next), JSON.stringify(snapshot), now, snapshot.code, snapshot.version).run();
      if (Number(saved.meta?.changes ?? 0) > 0) {
        if (next.version % 5 === 0 || next.phase === "result") await this.env.DB.prepare(
          "INSERT OR REPLACE INTO match_snapshots (code, version, state_json, created_at) VALUES (?, ?, ?, ?)",
        ).bind(snapshot.code, next.version, JSON.stringify(next), now).run();
        await this.publish(next);
        return;
      }
      const row = await this.env.DB.prepare("SELECT state_json FROM matches WHERE code = ?")
        .bind(snapshot.code).first<{ state_json: string }>();
      if (row?.state_json) await this.publish(normalizeMatchState(JSON.parse(row.state_json) as MatchState));
      return;
    }

    await this.state.storage.setAlarm(Math.max(now + 30_000, nextMatchAlarmAt(snapshot, now)));
  }
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self' ws: wss:",
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob: https://bakugan.wiki https://*.bakugan.wiki",
    "media-src 'self' blob:",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
  ].join("; "),
  "permissions-policy": "camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function withSecurityHeaders(response: Response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function withCacheHeaders(response: Response, cacheControl: string) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", cacheControl);
  headers.set("cdn-cache-control", cacheControl);
  return withSecurityHeaders(new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  }));
}

function isFingerprintedAsset(pathname: string, searchParams?: URLSearchParams) {
  return /(?:^|[._-])[a-f0-9]{8,}(?:[._-]|$)/i.test(pathname)
    || /^[a-f0-9]{8}$/i.test(searchParams?.get("v") ?? "");
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/game" && request.method === "POST" && request.headers.get("x-match-coordinator") !== "durable-object") {
      const body = await request.clone().json().catch(() => null) as { action?: string; code?: string } | null;
      const code = String(body?.code ?? "").toUpperCase();
      if (body?.action !== "create" && /^[A-Z2-9]{6}$/.test(code)) {
        const headers = new Headers(request.headers);
        headers.set("x-original-url", request.url);
        return env.MATCHES.getByName(code).fetch(new Request(`https://match.internal/action?code=${code}`, {
          method: "POST",
          headers,
          body: request.body,
          duplex: "half",
        } as RequestInit & { duplex: "half" }));
      }
    }

    if (url.pathname === "/api/game/socket") {
      const code = String(url.searchParams.get("code") ?? "").toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(code)) return new Response("Invalid room code", { status: 400 });
      return env.MATCHES.getByName(code).fetch(request);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const optimized = await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      return withSecurityHeaders(optimized);
    }

    if (
      request.method === "GET"
      && (url.pathname.startsWith("/assets/") || url.pathname === "/favicon.svg" || url.pathname === "/sw.js")
    ) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) {
        const immutable = isFingerprintedAsset(url.pathname, url.searchParams) && url.pathname !== "/sw.js";
        const artwork = /^\/assets\/(?:cards|cores)\//.test(url.pathname);
        return withCacheHeaders(
          asset,
          immutable
            ? "public, max-age=31536000, immutable"
            : artwork
              ? "public, max-age=604800, stale-while-revalidate=2592000"
              : url.pathname === "/sw.js"
                ? "no-cache, max-age=0, must-revalidate"
                : "public, max-age=86400, stale-while-revalidate=604800",
        );
      }
    }

    const response = await handler.fetch(request, env, ctx);
    const contentType = response.headers.get("content-type") ?? "";
    if (request.method === "GET" && (contentType.includes("text/html") || contentType.includes("text/x-component"))) {
      return withCacheHeaders(response, "no-cache, max-age=0, must-revalidate");
    }
    return withSecurityHeaders(response);
  },
  async scheduled(controller: ScheduledController, env: Env) {
    await runScheduled(controller, env);
  },
};

async function runScheduled(_controller: ScheduledController, env: Env) {
  const cutoff = Date.now();
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS rum_events (id TEXT PRIMARY KEY, route TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL, device TEXT NOT NULL, created_at INTEGER NOT NULL)"),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(cutoff - 86_400_000),
    env.DB.prepare("DELETE FROM rum_events WHERE created_at < ?").bind(cutoff - 7_776_000_000),
    env.DB.prepare("DELETE FROM match_snapshots WHERE created_at < ?").bind(cutoff - 2_592_000_000),
    env.DB.prepare("DELETE FROM match_presence WHERE code IN (SELECT code FROM matches WHERE updated_at < ?)").bind(cutoff - 2_592_000_000),
    env.DB.prepare("DELETE FROM matches WHERE updated_at < ?").bind(cutoff - 2_592_000_000),
  ]);
}

export default worker;
