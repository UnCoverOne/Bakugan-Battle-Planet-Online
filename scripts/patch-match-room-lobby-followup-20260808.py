from pathlib import Path

path = Path("components/routes/LobbyRoomScreen.tsx")
source = path.read_text()
old = '? isOwner ? "Ready to start" : "Waiting for owner"'
new = '? isOwner ? "Ready to start" : "Waiting for room owner"'
if old not in source:
    raise SystemExit("Missing follow-up patch anchor: owner wait status")
path.write_text(source.replace(old, new, 1))

path = Path("tests/lobby-flow.test.ts")
source = path.read_text()
old = '  assert.match(room, /match\\.phase !== "lobby"/);'
new = '  assert.match(room, /match\\.phase === "lobby"/);'
if old not in source:
    raise SystemExit("Missing follow-up patch anchor: lobby redirect assertion")
path.write_text(source.replace(old, new, 1))
