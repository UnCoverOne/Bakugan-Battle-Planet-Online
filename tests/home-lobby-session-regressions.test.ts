import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { activeSessionPresentation } from "../lib/active-session";
import type { MatchState } from "../lib/game";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const matchAt = (phase: MatchState["phase"], overrides: Partial<MatchState> = {}) => ({
  phase,
  code: "ROOM42",
  stepLabel: phase === "lobby" ? "Ready check" : "Draw step",
  ...overrides,
} as unknown as MatchState);

test("active session presentation distinguishes lobby, gameplay, and completed matches", () => {
  const lobby = activeSessionPresentation(matchAt("lobby"));
  assert.equal(lobby?.kind, "lobby");
  assert.equal(lobby?.href, "/play/lobby");
  assert.equal(lobby?.eyebrow, "ACTIVE LOBBY");
  assert.equal(lobby?.actionLabel, "RETURN TO LOBBY");
  assert.equal(lobby?.navLabel, "Return to lobby");

  const gameplay = activeSessionPresentation(matchAt("draw"));
  assert.equal(gameplay?.kind, "match");
  assert.equal(gameplay?.href, "/play/match");
  assert.equal(gameplay?.eyebrow, "ACTIVE MATCH");
  assert.equal(gameplay?.actionLabel, "RESUME MATCH");
  assert.equal(gameplay?.navLabel, "Resume match");

  assert.equal(activeSessionPresentation(matchAt("result")), null);
  assert.equal(activeSessionPresentation(null), null);
});

test("Home featured deck comes from the shared public catalogue for guests and signed-in Brawlers", async () => {
  const source = await read("components/routes/DashboardScreen.tsx");
  assert.match(source, /fetch\("\/api\/public-decks", \{ cache: "no-store" \}\)/);
  assert.match(source, /const publicDecks = \[\.\.\.remotePublicDecks, \.\.\.PUBLIC_DECKS\]/);
  assert.doesNotMatch(source, /authUser\s*\?\s*decks\.filter\(\(deck: DeckRecord\) => deck\.visibility === "Public"\)/);
});

test("Home restores natural document height whenever a lobby or match callout is present", async () => {
  const source = await read("components/routes/DashboardScreen.tsx");
  assert.match(source, /className=\{`bakugan-home \$\{activeSession \? "has-active-match" : ""\}`\}/);
  assert.match(source, /style=\{activeSession \? \{[\s\S]*?height: "auto"/);
  assert.match(source, /gridTemplateRows: "auto auto auto auto"/);
  assert.match(source, /overflow: "visible"/);
});

test("Lobby deck picker always composes visible set, faction, and authored metadata tags", async () => {
  const source = await read("components/routes/StreamlinedLobbyRoomScreen.tsx");
  assert.match(source, /function deckTags\(deck: DeckRecord\)[\s\S]*?deckSetName\(deck\)\.toUpperCase\(\)/);
  assert.match(source, /deck\.factions\.join\(" • "\)/);
  assert.match(source, /\.\.\.\(deck\.tags \?\? \[\]\)/);
  assert.match(source, /tags\.map\(\(tag\) => <span key=\{tag\}>\{tag\}<\/span>\)/);
});

test("Navigation uses the same active session presentation as Home", async () => {
  const [shell, dashboard] = await Promise.all([
    read("components/application/AppShell.jsx"),
    read("components/routes/DashboardScreen.tsx"),
  ]);
  assert.match(shell, /const activeSession = activeSessionPresentation\(match\)/);
  assert.match(shell, /href=\{activeSession\.href\}/);
  assert.match(shell, /\{activeSession\.navLabel\}/);
  assert.match(dashboard, /const activeSession = activeSessionPresentation\(match\)/);
  assert.match(dashboard, /\{activeSession\.eyebrow\}/);
  assert.match(dashboard, /\{activeSession\.actionLabel\}/);
});
