import { ensureMatchSessionSchema } from "./match-session-schema";

export const MATCH_CAPABILITY_HEADER = "x-match-capability";
export const MATCH_CONTROLLER_HEADER = "x-match-controller";
export const SESSION_REPLACED_CLOSE_CODE = 4001;
export const SESSION_REPLACED_REASON = "Session replaced";

const encoder = new TextEncoder();
const CONTROLLER_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export type MatchSeatCredential = {
  capability_hash: string;
  capability_version: number;
  controller_id: string | null;
};

export function secureMatchCapability(bytes = 24) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function newMatchControllerId() {
  return crypto.randomUUID();
}

export function validMatchControllerId(value: string) {
  return CONTROLLER_ID_PATTERN.test(value);
}

export async function digestMatchCapability(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(bytes), (item) => item.toString(16).padStart(2, "0")).join("");
}

function hexBytes(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) return null;
  const result = new Uint8Array(32);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return result;
}

export function capabilityHashesMatch(left: string, right: string) {
  const leftBytes = hexBytes(left);
  const rightBytes = hexBytes(right);
  if (!leftBytes || !rightBytes) return false;
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean;
  };
  if (subtle.timingSafeEqual) return subtle.timingSafeEqual(leftBytes, rightBytes);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

export async function loadMatchSeatCredential(database: D1Database, code: string, playerId: string) {
  await ensureMatchSessionSchema(database);
  return database.prepare(`SELECT capability_hash, capability_version, controller_id
    FROM match_seats WHERE code = ? AND player_id = ?`)
    .bind(code, playerId).first<MatchSeatCredential>();
}

/**
 * Authorize one browser session for a match seat. Seats created before the
 * controller migration are claimed once by the first updated client that can
 * still prove the original capability.
 */
export async function authenticateMatchSeat(
  database: D1Database,
  request: Request,
  code: string,
  playerId: string,
) {
  const capability = request.headers.get(MATCH_CAPABILITY_HEADER) ?? "";
  const controllerId = request.headers.get(MATCH_CONTROLLER_HEADER) ?? "";
  if (!capability || !validMatchControllerId(controllerId)) return null;

  const suppliedHash = await digestMatchCapability(capability);
  let seat = await loadMatchSeatCredential(database, code, playerId);
  if (!seat || !capabilityHashesMatch(seat.capability_hash, suppliedHash)) return null;

  if (!seat.controller_id) {
    await database.prepare(`UPDATE match_seats SET controller_id = ?, claimed_at = ?
      WHERE code = ? AND player_id = ? AND controller_id IS NULL AND capability_hash = ?`)
      .bind(controllerId, Date.now(), code, playerId, seat.capability_hash).run();
    seat = await loadMatchSeatCredential(database, code, playerId);
  }

  if (!seat || seat.controller_id !== controllerId || !capabilityHashesMatch(seat.capability_hash, suppliedHash)) {
    return null;
  }
  return seat;
}
