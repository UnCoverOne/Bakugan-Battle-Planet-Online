/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { runWithExecutionContext } from "vinext/shims/request-context";
import { normalizeMatchState, type MatchState } from "../lib/game";
import { normalizeEngineState, persistTransition, projectMatchForPlayer, reduceMatch, type CommandEnvelope, type EngineBackedMatchState, type GameCommand } from "../lib/engine";
import { nextMatchAlarmAt } from "../lib/deadlines";
import { markInternalMatchRequest, stripInternalMatchHeaders } from "../lib/internal-request";
import { isCompletedSeriesResult } from "../lib/match-result-navigation";
import {
  MATCH_CAPABILITY_HEADER,
  MATCH_CONTROLLER_HEADER,
  SESSION_REPLACED_CLOSE_CODE,
  SESSION_REPLACED_REASON,
  authenticateMatchSeat,
  digestMatchCapability,
  loadMatchSeatCredential,
  newMatchControllerId,
  secureMatchCapability,
  validMatchControllerId,
} from "../lib/match-seat-auth";
import { MATCH_RECONNECT_GRACE_MS } from "../lib/match-constants";
import { archiveCompletedMatch } from "../lib/replay-archive-server";
import { getSessionUserFromDatabase } from "../lib/account-server";
import { ensureSocialSchema, loadSocialAccount } from "../lib/social-server";
import { socialPresenceShard, type SocialAccountSummary } from "../lib/social";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MATCHES: DurableObjectNamespace;
  SOCIAL_PRESENCE: DurableObjectNamespace;
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
  waitUntil(promise: Promise<unknown>): void;
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
    deleteAll(): Promise<void>;
    setAlarm(timestamp: number): Promise<void>;
  };
};

type SocialSocketAttachment = {
  userId: string;
  account: SocialAccountSummary;
};

function socialSocketSend(socket: WebSocket, payload: unknown) {
  try {
    socket.send(JSON.stringify(payload));
  } catch (error) {
    console.error(JSON.stringify({
      event: "social_socket_send_failed",
      message: error instanceof Error ? error.message : String(error),
    }));
    try { socket.close(1011, "Transport failure"); } catch {}
  }
}

/** Hibernating, sharded online-presence coordinator. Durable relationships remain in D1. */
export class SocialPresence {
  constructor(private state: HibernatingState, private env: Env) {}

  private accounts() {
    const accounts = new Map<string, SocialAccountSummary>();
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment?.() as SocialSocketAttachment | undefined;
      if (attachment?.userId && attachment.account) {
        accounts.set(attachment.userId, { ...attachment.account, online: true, relationship: "none" });
      }
    }
    return [...accounts.values()];
  }

  private broadcast(payload: unknown, except?: WebSocket) {
    for (const socket of this.state.getWebSockets()) {
      if (socket !== except) socialSocketSend(socket, payload);
    }
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/snapshot") {
      return Response.json({ accounts: this.accounts() }, { headers: { "cache-control": "no-store" } });
    }
    if (request.method === "POST" && url.pathname === "/notify") {
      const userId = String(url.searchParams.get("userId") ?? "");
      const event = await request.json().catch(() => null);
      for (const socket of this.state.getWebSockets(userId)) socialSocketSend(socket, event);
      return new Response(null, { status: 204 });
    }
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket required", { status: 426 });
    }
    const userId = String(url.searchParams.get("userId") ?? "");
    const encodedAccount = request.headers.get("x-bbp-social-account") ?? "";
    let account: SocialAccountSummary | null = null;
    try {
      account = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encodedAccount), (character) => character.charCodeAt(0)))) as SocialAccountSummary;
    } catch {}
    if (!userId || account?.userId !== userId) return new Response("Forbidden", { status: 403 });
    const protocols = (request.headers.get("sec-websocket-protocol") ?? "").split(",").map((value) => value.trim());
    if (!protocols.includes("bbp-social-v1")) return new Response("Social protocol required", { status: 400 });
    const wasOnline = this.state.getWebSockets(userId).length > 0;
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment?.({ userId, account } satisfies SocialSocketAttachment);
    this.state.acceptWebSocket(server, [userId]);
    socialSocketSend(server, { type: "presence.snapshot", accounts: this.accounts() });
    if (!wasOnline) this.broadcast({ type: "presence.changed", account: { ...account, online: true, relationship: "none" } }, server);
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "sec-websocket-protocol": "bbp-social-v1" },
    } as ResponseInit & { webSocket: WebSocket });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message === "string" && message === "ping") socialSocketSend(socket, { type: "pong" });
  }

  webSocketClose(socket: WebSocket) {
    const attachment = socket.deserializeAttachment?.() as SocialSocketAttachment | undefined;
    if (!attachment?.userId) return;
    const stillOnline = this.state.getWebSockets(attachment.userId).some((candidate) => candidate !== socket);
    if (!stillOnline) this.broadcast({
      type: "presence.changed",
      account: { ...attachment.account, online: false, relationship: "none" },
    }, socket);
  }

  webSocketError(socket: WebSocket) { this.webSocketClose(socket); }
}

const FORWARDED_MATCH_URL_HEADER = "x-bbp-forwarded-match-url";

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (item) => item.toString(16).padStart(2, "0")).join("");
}

function alarmSeed() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

type MatchSocketAttachment = {
  playerId: string;
  capabilityVersion: number;
  controllerId: string;
  connectionId: string;
};

type ResumeSeatRequest = {
  userId?: unknown;
  expectedCapabilityVersion?: unknown;
  takeover?: unknown;
};

function matchRoomJson(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

export class MatchRoom {
  private sessionMutation: Promise<void> = Promise.resolve();

  constructor(private state: HibernatingState, private env: Env) {}

  private async withSessionMutation<T>(operation: () => Promise<T>) {
    const previous = this.sessionMutation;
    let release: () => void = () => undefined;
    this.sessionMutation = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async publish(match: MatchState) {
    await this.state.storage.put("snapshot", match);
    await this.state.storage.setAlarm(nextMatchAlarmAt(match));
    for (const socket of this.state.getWebSockets()) {
      try {
        const attachment = socket.deserializeAttachment?.() as { playerId?: string } | undefined;
        if (attachment?.playerId) {
          socket.send(JSON.stringify({
            type: "state",
            state: projectMatchForPlayer(match, attachment.playerId),
          }));
        }
      } catch (error) {
        console.error(JSON.stringify({
          event: "match_socket_publish_failed",
          code: match.code,
          message: error instanceof Error ? error.message : String(error),
        }));
        try { socket.close(1011, "Transport failure"); } catch {}
      }
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
      return this.withSessionMutation(async () => {
      const code = String(url.searchParams.get("code") ?? "").toUpperCase();
      const originalUrl = request.headers.get(FORWARDED_MATCH_URL_HEADER) ?? "https://match.invalid/api/game";
      const headers = new Headers(request.headers);
      headers.delete(FORWARDED_MATCH_URL_HEADER);
      stripInternalMatchHeaders(headers);
      markInternalMatchRequest(headers, originalUrl);
      const internalRequest = new Request(originalUrl, {
        method: "POST",
        headers,
        body: request.body,
        duplex: "half",
      } as RequestInit & { duplex: "half" });
      const context: ExecutionContext = {
        waitUntil: (promise) => this.state.waitUntil(promise),
        passThroughOnException: () => undefined,
      };
      const response = await runWithExecutionContext(
        context,
        () => handler.fetch(internalRequest, this.env, context),
      );
      const row = await this.env.DB.prepare("SELECT state_json FROM matches WHERE code = ?").bind(code).first<{ state_json: string }>();
      if (row?.state_json) await this.publish(JSON.parse(row.state_json) as MatchState);
      return response;
      });
    }

    if (request.method === "POST" && url.pathname === "/resume") {
      return this.withSessionMutation(async () => {
      const code = String(url.searchParams.get("code") ?? "").toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(code)) return matchRoomJson({ error: "Room code is invalid.", code: "VALIDATION_ERROR" }, 400);
      const body = await request.json().catch(() => null) as ResumeSeatRequest | null;
      const userId = typeof body?.userId === "string" ? body.userId : "";
      const expectedCapabilityVersion = Number(body?.expectedCapabilityVersion);
      const takeover = body?.takeover === true;
      if (!userId || !Number.isSafeInteger(expectedCapabilityVersion) || expectedCapabilityVersion < 1) {
        return matchRoomJson({ error: "Resume request is invalid.", code: "VALIDATION_ERROR" }, 400);
      }

      const seats = await this.env.DB.prepare(`SELECT
          match_seat_accounts.player_id,
          match_seats.capability_version,
          matches.state_json
        FROM match_seat_accounts
        JOIN match_seats
          ON match_seats.code = match_seat_accounts.code
          AND match_seats.player_id = match_seat_accounts.player_id
        JOIN matches ON matches.code = match_seat_accounts.code
        WHERE match_seat_accounts.code = ? AND match_seat_accounts.user_id = ?
        LIMIT 2`)
        .bind(code, userId)
        .all<{ player_id: string; capability_version: number; state_json: string }>();
      const rows = seats.results ?? [];
      if (!rows.length) return matchRoomJson({ error: "That match seat is not associated with your account.", code: "AUTHORIZATION_ERROR" }, 403);
      if (rows.length !== 1) return matchRoomJson({ error: "Your account has an ambiguous seat assignment in this room.", code: "CONFLICT_ERROR" }, 409);

      const row = rows[0];
      let snapshot: MatchState;
      try {
        snapshot = normalizeMatchState(JSON.parse(row.state_json) as MatchState);
      } catch {
        return matchRoomJson({ error: "The saved match could not be restored.", code: "SERVICE_UNAVAILABLE" }, 503);
      }
      if (!snapshot.players.some((player) => player.id === row.player_id)) {
        return matchRoomJson({ error: "That account seat no longer exists in the match.", code: "AUTHORIZATION_ERROR" }, 403);
      }
      if (isCompletedSeriesResult(snapshot)) {
        return matchRoomJson({ error: "This match series is already complete.", code: "CONFLICT_ERROR" }, 409);
      }
      if (Number(row.capability_version) !== expectedCapabilityVersion) {
        return matchRoomJson({
          error: "The match controller changed. Refresh the active-match list and try again.",
          code: "LEASE_CONFLICT",
          capabilityVersion: Number(row.capability_version),
        }, 409);
      }

      const activeSockets = this.state.getWebSockets(row.player_id).filter((socket) => {
        const attachment = socket.deserializeAttachment?.() as MatchSocketAttachment | undefined;
        return !attachment || attachment.capabilityVersion == null
          || attachment.capabilityVersion === Number(row.capability_version);
      });
      if (activeSockets.length && !takeover) {
        return matchRoomJson({
          error: "This match seat is active in another session.",
          code: "SESSION_ACTIVE",
          capabilityVersion: Number(row.capability_version),
        }, 409);
      }

      const capability = secureMatchCapability();
      const controllerId = newMatchControllerId();
      const claimedAt = Date.now();
      const nextCapabilityVersion = expectedCapabilityVersion + 1;
      const updated = await this.env.DB.prepare(`UPDATE match_seats
        SET capability_hash = ?, capability_version = ?, controller_id = ?, claimed_at = ?
        WHERE code = ? AND player_id = ? AND capability_version = ?`)
        .bind(
          await digestMatchCapability(capability),
          nextCapabilityVersion,
          controllerId,
          claimedAt,
          code,
          row.player_id,
          expectedCapabilityVersion,
        ).run();
      if (Number(updated.meta?.changes ?? 0) !== 1) {
        const latest = await loadMatchSeatCredential(this.env.DB, code, row.player_id);
        return matchRoomJson({
          error: "Another session claimed this match first. Refresh and try again.",
          code: "LEASE_CONFLICT",
          capabilityVersion: Number(latest?.capability_version ?? expectedCapabilityVersion),
        }, 409);
      }

      const latest = await loadMatchSeatCredential(this.env.DB, code, row.player_id);
      if (!latest || latest.capability_version !== nextCapabilityVersion || latest.controller_id !== controllerId) {
        return matchRoomJson({
          error: "Another session claimed this match first. Refresh and try again.",
          code: "LEASE_CONFLICT",
          capabilityVersion: Number(latest?.capability_version ?? nextCapabilityVersion),
        }, 409);
      }

      await this.env.DB.prepare(`INSERT INTO match_presence (code, player_id, last_seen, connected)
        VALUES (?, ?, ?, 0)
        ON CONFLICT(code, player_id) DO UPDATE SET last_seen = excluded.last_seen, connected = 0`)
        .bind(code, row.player_id, claimedAt).run();
      for (const socket of this.state.getWebSockets(row.player_id)) {
        const attachment = socket.deserializeAttachment?.() as MatchSocketAttachment | undefined;
        if (attachment && attachment.capabilityVersion >= nextCapabilityVersion) continue;
        try { socket.close(SESSION_REPLACED_CLOSE_CODE, SESSION_REPLACED_REASON); } catch {}
      }
      await this.state.storage.put("snapshot", snapshot);
      await this.state.storage.setAlarm(Math.min(nextMatchAlarmAt(snapshot), claimedAt + MATCH_RECONNECT_GRACE_MS));
      console.info(JSON.stringify({
        event: "match_session_claimed",
        code,
        playerId: row.player_id,
        capabilityVersion: nextCapabilityVersion,
        takeover: activeSockets.length > 0,
      }));
      return matchRoomJson({
        accepted: true,
        code,
        playerId: row.player_id,
        capability,
        capabilityVersion: nextCapabilityVersion,
        controllerId,
        state: projectMatchForPlayer(snapshot, row.player_id),
      });
      });
    }

    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket required", { status: 426 });
    return this.withSessionMutation(async () => {
    const code = String(url.searchParams.get("code") ?? "").toUpperCase();
    const playerId = String(url.searchParams.get("playerId") ?? "");
    const controllerId = String(url.searchParams.get("controllerId") ?? "");
    const protocols = (request.headers.get("sec-websocket-protocol") ?? "").split(",").map((value) => value.trim());
    const capability = protocols.find((value) => value.startsWith("cap."))?.slice(4) ?? "";
    if (!validMatchControllerId(controllerId)) return new Response("Forbidden", { status: 403 });
    const authenticationHeaders = new Headers(request.headers);
    authenticationHeaders.set(MATCH_CAPABILITY_HEADER, capability);
    authenticationHeaders.set(MATCH_CONTROLLER_HEADER, controllerId);
    const seat = await authenticateMatchSeat(
      this.env.DB,
      new Request(request.url, { headers: authenticationHeaders }),
      code,
      playerId,
    );
    if (!seat) return new Response("Forbidden", { status: 403 });

    for (const existing of this.state.getWebSockets(playerId)) {
      const attachment = existing.deserializeAttachment?.() as MatchSocketAttachment | undefined;
      if (attachment && attachment.capabilityVersion > seat.capability_version) continue;
      try { existing.close(SESSION_REPLACED_CLOSE_CODE, SESSION_REPLACED_REASON); } catch {}
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment?.({
      playerId,
      capabilityVersion: seat.capability_version,
      controllerId,
      connectionId: crypto.randomUUID(),
    } satisfies MatchSocketAttachment);
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
    if (snapshot) {
      try {
        server.send(JSON.stringify({ type: "state", state: projectMatchForPlayer(snapshot, playerId) }));
      } catch (error) {
        console.error(JSON.stringify({
          event: "match_socket_initial_publish_failed",
          code,
          playerId,
          message: error instanceof Error ? error.message : String(error),
        }));
        try { server.close(1011, "Transport failure"); } catch {}
      }
      await this.state.storage.setAlarm(nextMatchAlarmAt(snapshot));
    }
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "sec-websocket-protocol": "bbp-match-v1" },
    } as ResponseInit & { webSocket: WebSocket });
    });
  }

  async webSocketClose(socket: WebSocket) {
    await this.withSessionMutation(async () => {
    const attachment = socket.deserializeAttachment?.() as MatchSocketAttachment | undefined;
    const snapshot = await this.state.storage.get<MatchState>("snapshot");
    if (attachment?.playerId && snapshot?.code) {
      const replacement = this.state.getWebSockets(attachment.playerId).some((candidate) => {
        if (candidate === socket) return false;
        const candidateAttachment = candidate.deserializeAttachment?.() as MatchSocketAttachment | undefined;
        return candidateAttachment?.capabilityVersion === attachment.capabilityVersion
          && candidateAttachment.controllerId === attachment.controllerId;
      });
      if (replacement) return;
      const seat = await loadMatchSeatCredential(this.env.DB, snapshot.code, attachment.playerId);
      if (!seat
        || seat.capability_version !== attachment.capabilityVersion
        || seat.controller_id !== attachment.controllerId) return;
      await this.env.DB.prepare("UPDATE match_presence SET connected = 0, last_seen = ? WHERE code = ? AND player_id = ?")
        .bind(Date.now(), snapshot.code, attachment.playerId).run();
      await this.state.storage.setAlarm(Math.min(nextMatchAlarmAt(snapshot), Date.now() + MATCH_RECONNECT_GRACE_MS));
    }
    });
  }
  async webSocketError(socket: WebSocket) { await this.webSocketClose(socket); }

  async alarm() {
    const stored = await this.state.storage.get<MatchState>("snapshot");
    if (!stored) return;
    const now = Date.now();
    const snapshot = normalizeEngineState(normalizeMatchState(stored));
    if (["lobby", "result"].includes(snapshot.phase)) {
      if (!this.state.getWebSockets().length) await this.state.storage.deleteAll();
      else await this.state.storage.setAlarm(nextMatchAlarmAt(snapshot, now));
      return;
    }

    const runCommand = async (state: EngineBackedMatchState, actorId: string | "system", command: GameCommand, suffix: string) => {
      const commandId = `alarm:${state.id}:${state.version}:${suffix}`;
      const envelope: CommandEnvelope = {
        commandId,
        gameId: state.id,
        actorId,
        expectedVersion: state.version,
        issuedAt: now,
        randomSeed: alarmSeed(),
        requestHash: await sha256(`${commandId}:${JSON.stringify(command)}`),
        command,
      };
      return reduceMatch(state, envelope);
    };

    let transition = await runCommand(snapshot, "system", { type: "RESOLVE_DEADLINE" }, "deadline");
    if (!transition.changed) {
      const presence = await this.env.DB.prepare(
        "SELECT player_id, last_seen FROM match_presence WHERE code = ? AND connected = 0 ORDER BY last_seen ASC LIMIT 1",
      ).bind(snapshot.code).first<{ player_id: string; last_seen: number }>();
      if (presence && now - Number(presence.last_seen) >= MATCH_RECONNECT_GRACE_MS) {
        transition = await runCommand(snapshot, presence.player_id, { type: "CONCEDE", reason: "disconnect" }, `disconnect:${presence.player_id}`);
      }
    }

    if (transition.changed && transition.receipt) {
      const saved = await persistTransition(this.env.DB, {
        code: snapshot.code,
        next: transition.state,
        previous: snapshot,
        expectedVersion: snapshot.version,
        events: transition.events,
        receipt: transition.receipt,
      });
      if (saved) {
        this.state.waitUntil(archiveCompletedMatch(this.env.DB, transition.state).catch((error) => {
          console.error(JSON.stringify({
            event: "match_replay_archive_failed",
            code: transition.state.code,
            replayId: transition.state.id,
            message: error instanceof Error ? error.message : String(error),
          }));
          return false;
        }));
        await this.publish(transition.state);
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
    "font-src 'self' data: https://fonts.gstatic.com",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
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

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const sanitizedHeaders = new Headers(request.headers);
    stripInternalMatchHeaders(sanitizedHeaders);
    sanitizedHeaders.delete(FORWARDED_MATCH_URL_HEADER);
    const sanitizedRequest = new Request(request, { headers: sanitizedHeaders });
    const url = new URL(sanitizedRequest.url);

    if (url.pathname === "/api/game" && sanitizedRequest.method === "POST") {
      const body = await sanitizedRequest.clone().json().catch(() => null) as { action?: string; code?: string } | null;
      const code = String(body?.code ?? "").toUpperCase();
      if (body?.action !== "create" && /^[A-Z2-9]{6}$/.test(code)) {
        const headers = new Headers(sanitizedRequest.headers);
        headers.set(FORWARDED_MATCH_URL_HEADER, sanitizedRequest.url);
        return env.MATCHES.getByName(code).fetch(new Request(`https://match.internal/action?code=${code}`, {
          method: "POST",
          headers,
          body: sanitizedRequest.body,
          duplex: "half",
        } as RequestInit & { duplex: "half" }));
      }
    }

    if (url.pathname === "/api/game/socket") {
      const code = String(url.searchParams.get("code") ?? "").toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(code)) return new Response("Invalid room code", { status: 400 });
      return env.MATCHES.getByName(code).fetch(sanitizedRequest);
    }

    if (url.pathname === "/api/social/socket") {
      if (sanitizedRequest.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("WebSocket required", { status: 426 });
      }
      const user = await getSessionUserFromDatabase(sanitizedRequest, env.DB);
      if (!user) return new Response("Sign in required", { status: 401 });
      const account = await loadSocialAccount(env.DB, user.id);
      if (!account) return new Response("Account unavailable", { status: 404 });
      const shard = socialPresenceShard(user.id);
      const headers = new Headers(sanitizedRequest.headers);
      const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(account))));
      headers.set("x-bbp-social-account", encoded);
      const internalRequest = new Request(`https://social.internal/socket?userId=${encodeURIComponent(user.id)}`, {
        method: sanitizedRequest.method,
        headers,
      });
      return env.SOCIAL_PRESENCE.getByName(shard).fetch(internalRequest);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const optimized = await handleImageOptimization(sanitizedRequest, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, sanitizedRequest.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
      return withSecurityHeaders(optimized);
    }

    if (
      sanitizedRequest.method === "GET"
      && (url.pathname.startsWith("/assets/") || url.pathname === "/favicon.svg" || url.pathname === "/sw.js")
    ) {
      const asset = await env.ASSETS.fetch(sanitizedRequest);
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

    const response = await runWithExecutionContext(
      ctx,
      () => handler.fetch(sanitizedRequest, env, ctx),
    );
    const contentType = response.headers.get("content-type") ?? "";
    if (sanitizedRequest.method === "GET" && (contentType.includes("text/html") || contentType.includes("text/x-component"))) {
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
  await ensureSocialSchema(env.DB);
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS rum_events (id TEXT PRIMARY KEY, route TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL, device TEXT NOT NULL, created_at INTEGER NOT NULL)"),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(cutoff - 86_400_000),
    env.DB.prepare("DELETE FROM rum_events WHERE created_at < ?").bind(cutoff - 7_776_000_000),
    env.DB.prepare("DELETE FROM match_snapshots WHERE created_at < ?").bind(cutoff - 2_592_000_000),
    env.DB.prepare("DELETE FROM match_presence WHERE code IN (SELECT code FROM matches WHERE updated_at < ?)").bind(cutoff - 2_592_000_000),
    env.DB.prepare("DELETE FROM matches WHERE updated_at < ?").bind(cutoff - 2_592_000_000),
    env.DB.prepare("DELETE FROM match_replays WHERE NOT EXISTS (SELECT 1 FROM match_replay_participants WHERE match_replay_participants.replay_id = match_replays.replay_id)"),
    env.DB.prepare("UPDATE lobby_invitations SET status = 'expired', responded_at = ? WHERE status = 'pending' AND expires_at <= ?").bind(cutoff, cutoff),
    env.DB.prepare("DELETE FROM lobby_invitations WHERE status <> 'pending' AND COALESCE(responded_at, expires_at) < ?").bind(cutoff - 2_592_000_000),
  ]);
}

export default worker;
