import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { guestCredential, LOBBY_GUEST_COOKIE } from "../lib/lobby-identity-server";

test("guest credential accepts only a single well-formed opaque cookie", () => {
  const token = "a".repeat(64);
  const request = (cookie: string) => new Request("https://example.test/api/lobby/session", { headers: { cookie } });
  assert.equal(guestCredential(request(`other=1; ${LOBBY_GUEST_COOKIE}=${token}`)), token);
  assert.equal(guestCredential(request(`${LOBBY_GUEST_COOKIE}=alice`)), null);
  assert.equal(guestCredential(request(`${LOBBY_GUEST_COOKIE}=${token}; ${LOBBY_GUEST_COOKIE}=${token}`)), null);
});
test("admission command payload never supplies account or guest identity", () => {
  const route = readFileSync("app/api/lobby/session/route.ts", "utf8");
  assert.match(route, /resolveLobbyIdentities\(database, request\)/);
  assert.match(route, /executeLobbyCommand\(database, identities, body\)/);
});
