from pathlib import Path

path = Path("scripts/apply-public-deck-favorites.py")
text = path.read_text(encoding="utf-8")n
bad = '''replace_once(
    "components/routes/DeckRoutes.tsx",
    '''        view={view}\\n        setView={setView}\\n        count={visible.length}\\n      />''',
    '''        view={view}
        setView={setView}
        count={visible.length}
        sortOptions={["Updated", "Name", "Set", "Most Favorited"]}
        favoritesOnly={favoritesOnly}
        setFavoritesOnly={setFavoritesOnly}
        favoritesEnabled={catalogue.status === "online" && Boolean(authUser)}
      />''',
)
# The preceding replacement must target the Public toolbar, not My Decks. If the first match was My Decks, repair by requiring Public-specific nearby state.
# Validate later by checking the Public section contains Most Favorited and My Favorites.
'''
if bad not in text:
    raise SystemExit("ambiguous toolbar patch block not found")
text = text.replace(bad, "", 1)
path.write_text(text, encoding="utf-8")
print("Favorite migration toolbar patch repaired.")
