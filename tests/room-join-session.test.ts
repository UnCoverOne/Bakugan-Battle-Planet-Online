import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { selectJoinSeatPlayerId } from "../lib/room-join-session";

const owned = {
  roomCode: "ABC234",
  currentMatchCode: "ABC234",
  currentMatchPlayerIds: ["owner-seat", "opponent-seat"],
  playerId: "owner-seat",
  matchCapability: "valid-supplied-capability",
  matchControllerId: "valid-controller",
};

test("fresh joins get a unique seat ID even when browser identity belongs to the room host", () => {
  assert.equal(selectJoinSeatPlayerId({
    ...owned, matchCapability: "",
  }, () => "new-invitee-seat"), "new-invitee-seat");
  assert.equal(selectJoinSeatPlayerId({
    ...owned, currentMatchCode: "OTHER2",
  }, () => "new-seat"), "new-seat");
  assert.equal(selectJoinSeatPlayerId({
    ...owned, currentMatchPlayerIds: ["someone-else"],
  }, () => "new-seat"), "new-seat");
});

test("valid same-room reconnects retain the original seat ID for capability verification", () => {
  assert.equal(selectJoinSeatPlayerId(owned, () => {
    throw new Error("must not generate a new identity for a genuine reconnect");
  }), "owner-seat");
  assert.equal(selectJoinSeatPlayerId({
    ...owned, matchControllerId: "",
  }, () => "new-seat"), "new-seat");
});

test("joining a new room never inherits the previous match version or credentials", () => {
  const provider = readFileSync("components/application/AppProvider.jsx", "utf8");
  assert.match(provider, /selectJoinSeatPlayerId\(/);
  assert.match(provider, /expectedVersion: freshSeatAction \? undefined : match\?\.version/);
  assert.match(provider, /playerId: seatPlayerId/);
  assert.match(provider, /if \(action === "join" && result\.capability && seatPlayerId !== playerId\) setPlayerId\(seatPlayerId\)/);
  assert.match(provider, /joinOnline\(\{ code: setup\.joinCode, format: setup\.format \}\)/, "play setup passes its own room code and format");
});

test("invite setup takes priority over stale saved room setup", () => {
  const play = readFileSync("components/routes/PlayRoutes.tsx", "utf8");
  const social = readFileSync("components/social/SocialProvider.tsx", "utf8");
  assert.match(social, /\/play\?invite=\$\{encodeURIComponent\(result\.lobby\.code\)\}/);
  assert.match(play, /if \(invitedRoom\) return/);
  assert.match(play, /mode: invitedRoom \? "join" : matchMode/);
  assert.match(play, /step: invitedRoom \? "loadout" : undefined/);
});
