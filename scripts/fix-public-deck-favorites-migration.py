from pathlib import Path

path = Path("scripts/apply-public-deck-favorites.py")
text = path.read_text(encoding="utf-8")
comment = "# The preceding replacement must target the Public toolbar, not My Decks."
comment_index = text.find(comment)
if comment_index < 0:
    raise SystemExit("ambiguous toolbar patch comment not found")
start = text.rfind("replace_once(\n", 0, comment_index)
if start < 0:
    raise SystemExit("ambiguous toolbar patch start not found")
end_marker = "# Validate later by checking the Public section contains Most Favorited and My Favorites.\n"
end = text.find(end_marker, comment_index)
if end < 0:
    raise SystemExit("ambiguous toolbar patch end not found")
end += len(end_marker)
text = text[:start] + text[end:]
path.write_text(text, encoding="utf-8")
print("Favorite migration toolbar patch repaired.")
