from pathlib import Path

favorites_path = Path("tests/public-deck-favorites.test.ts")
favorites = favorites_path.read_text(encoding="utf-8")
start = favorites.find("  assert.doesNotMatch(route, /BUNDLED_OFFLINE_PUBLIC_DECKS")
if start < 0:
    raise SystemExit("generated offline favorite assertion not found")
end_marker = "+favoriteCount/);"
end = favorites.find(end_marker, start)
if end < 0:
    raise SystemExit("generated offline favorite assertion end not found")
end += len(end_marker)
favorites = (
    favorites[:start]
    + '  assert.ok(route.includes(\'setState({ status: "offline", decks, favorites: {} })\'));'
    + favorites[end:]
)
favorites_path.write_text(favorites, encoding="utf-8")

admin_path = Path("tests/administration.test.ts")
admin = admin_path.read_text(encoding="utf-8")
old = '  assert.match(decks, /status: "online", decks: result\\.decks/);'
new = '  assert.match(decks, /status: "online"/);\n  assert.match(decks, /decks: result\\.decks/);'
if old not in admin:
    raise SystemExit("administration online catalogue assertion not found")
admin_path.write_text(admin.replace(old, new, 1), encoding="utf-8")

print("Favorite regression tests repaired for the enriched catalogue state.")
