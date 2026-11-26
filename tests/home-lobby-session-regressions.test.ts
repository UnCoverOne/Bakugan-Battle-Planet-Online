import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Home returns to the lobby resolved by the shared session", async () => {
  const home = await readFile("components/routes/BlankDashboardScreen.tsx", "utf8");
  assert.match(home, /useLobbySession\(\)/);
  assert.match(home, /activeLobby \? "\/play\/lobby" : "\/play"/);
  assert.match(home, /RETURN TO LOBBY/);
});
