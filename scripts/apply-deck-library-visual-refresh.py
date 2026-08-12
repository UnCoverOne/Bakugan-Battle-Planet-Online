from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, content: str) -> None:
    Path(path).write_text(content)


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))


route = "components/routes/DeckRoutes.tsx"
css = "components/routes/DeckRoutes.module.css"

# Deck previews use the same 3 Characters + Featured-card language as the Home featured deck.
replace_once(
    route,
    '''  STARTER_DECKS,\n  validateDeck,''',
    '''  STARTER_DECKS,\n  deckLeadCard,\n  validateDeck,''',
)

replace_once(
    route,
    '''function CharacterFan({ deck, compact = false }: { deck: DeckRecord; compact?: boolean }) {\n  const characters = deck.bakuganIds\n    .map((id) => BAKUGAN.find((candidate) => candidate.id === id))\n    .filter(Boolean);\n  return (\n    <div className={`${styles.characterFan} ${compact ? styles.characterFanCompact : ""}`}>\n      {Array.from({ length: 3 }, (_, index) => {\n        const character = characters[index];\n        return character ? (\n          <img\n            key={character.id}\n            src={cardArtSource(character.character, "full")}\n            loading="lazy"\n            decoding="async"\n            alt={character.name}\n          />\n        ) : (\n          <div className={styles.characterPlaceholder} key={`empty-${index}`} aria-label="Empty Character slot">?</div>\n        );\n      })}\n    </div>\n  );\n}\n''',
    '''function CharacterFan({\n  deck,\n  compact = false,\n  featured = false,\n}: {\n  deck: DeckRecord;\n  compact?: boolean;\n  featured?: boolean;\n}) {\n  const characters = deck.bakuganIds\n    .map((id) => BAKUGAN.find((candidate) => candidate.id === id))\n    .filter(Boolean);\n  const featuredCard = featured ? deckLeadCard(deck) : undefined;\n  const featuredPreviewCard = featuredCard && !characters.some(\n    (character) => character?.character.catalogId === featuredCard.catalogId,\n  ) ? featuredCard : undefined;\n  return (\n    <div\n      className={`${styles.characterFan} ${featuredPreviewCard ? styles.characterFanFeatured : ""} ${compact ? styles.characterFanCompact : ""}`}\n      data-featured-preview={featuredPreviewCard ? "true" : undefined}\n    >\n      {Array.from({ length: 3 }, (_, index) => {\n        const character = characters[index];\n        return character ? (\n          <img\n            key={character.id}\n            src={cardArtSource(character.character, "full")}\n            loading="lazy"\n            decoding="async"\n            alt={character.name}\n          />\n        ) : (\n          <div className={styles.characterPlaceholder} key={`empty-${index}`} aria-label="Empty Character slot">?</div>\n        );\n      })}\n      {featuredPreviewCard && (\n        <img\n          className={styles.featuredPreviewCard}\n          src={cardArtSource(featuredPreviewCard, "full")}\n          loading="lazy"\n          decoding="async"\n          alt={`Featured card: ${featuredPreviewCard.displayName}`}\n        />\n      )}\n    </div>\n  );\n}\n\nfunction DeckFactionSymbols({ factions }: { factions: string[] }) {\n  const visibleFactions = factions.filter((faction) => Boolean(FACTION_SYMBOLS[faction]));\n  if (!visibleFactions.length) return <span className={styles.factionSymbols}>No factions selected</span>;\n  return (\n    <span className={styles.factionSymbols} aria-label={`Factions: ${visibleFactions.join(", ")}`}>\n      {visibleFactions.map((faction) => (\n        <img\n          key={faction}\n          src={FACTION_SYMBOLS[faction]}\n          alt=""\n          aria-hidden="true"\n          title={faction}\n        />\n      ))}\n    </span>\n  );\n}\n''',
)

text = read(route)
fan_call = '<CharacterFan deck={deck} compact={view === "list"} />'
if text.count(fan_call) != 2:
    raise SystemExit(f"{route}: expected two library CharacterFan calls, found {text.count(fan_call)}")
text = text.replace(fan_call, '<CharacterFan deck={deck} compact={view === "list"} featured />')
write(route, text)

# My Decks gets the same compact visual language without changing its controls.
replace_once(
    route,
    '''          <p>{deck.factions.length ? deck.factions.join(" • ") : "No team factions selected"}</p>\n          <div className={styles.chipRow}>\n            <StatusChip tone="info">{deckSetName(deck).toUpperCase()}</StatusChip>\n            <StatusChip tone={report.isLegal ? "success" : "danger"}>\n              {report.isLegal ? "Legal" : `${report.issues.length} issues`}\n            </StatusChip>\n          </div>''',
    '''          <div className={styles.chipRow}>\n            <StatusChip tone="info">{deckSetName(deck).toUpperCase()}</StatusChip>\n            <StatusChip tone={report.isLegal ? "success" : "danger"}>\n              {report.isLegal ? "Legal" : `${report.issues.length} issues`}\n            </StatusChip>\n          </div>\n          <DeckFactionSymbols factions={deck.factions} />''',
)

# Public Deck cards become shorter, denser browse cards with icon-based faction metadata.
replace_once(
    route,
    '''    <Surface as="article" className={`${styles.deckCard} ${styles[`deckCard_${view}`]}`}>''',
    '''    <Surface as="article" className={`${styles.deckCard} ${styles.publicDeckCard} ${styles[`deckCard_${view}`]}`}>''',
)
replace_once(
    route,
    '''          <small>{deck.factions.join(" • ")}</small>\n          <small>Published {formatTimestamp(deck.publishedAt ?? deck.updatedAt)}</small>''',
    '''          <DeckFactionSymbols factions={deck.factions} />\n          <small>Published {formatTimestamp(deck.publishedAt ?? deck.updatedAt)}</small>''',
)
replace_once(
    route,
    '''      <div className={styles.deckCardActions}>\n        <button onClick={onOpen}>View Deck</button>\n        <button onClick={onCopy} disabled={!report.isLegal}>Copy to My Decks</button>\n        {favoriteAvailable && (\n          <button\n            aria-pressed={favorite.viewerHasFavorited}\n            disabled={favoritePending}\n            onClick={onFavorite}\n          >\n            {favorite.viewerHasFavorited ? "★ Favorited" : "☆ Favorite"} · {favorite.favoriteCount} {favorite.favoriteCount === 1 ? "Favorite" : "Favorites"}\n          </button>\n        )}\n      </div>''',
    '''      <div className={`${styles.deckCardActions} ${styles.publicDeckActions}`}>\n        <button onClick={onOpen}>View Deck</button>\n        <button onClick={onCopy} disabled={!report.isLegal} title="Copy to My Decks">Copy</button>\n        {favoriteAvailable && (\n          <button\n            className={styles.favoriteButton}\n            aria-label={`${favorite.viewerHasFavorited ? "Remove" : "Add"} ${deck.name} ${favorite.viewerHasFavorited ? "from" : "to"} Favorites. ${favorite.favoriteCount} ${favorite.favoriteCount === 1 ? "favorite" : "favorites"}.`}\n            aria-pressed={favorite.viewerHasFavorited}\n            disabled={favoritePending}\n            title={`${favorite.viewerHasFavorited ? "Favorited" : "Favorite"} · ${favorite.favoriteCount}`}\n            onClick={onFavorite}\n          >\n            <span aria-hidden="true">{favorite.viewerHasFavorited ? "★" : "☆"}</span>\n            <span>{favorite.favoriteCount}</span>\n          </button>\n        )}\n      </div>''',
)

# Tighten the browse-card proportions and add the four-card fan + faction-symbol treatment.
replace_once(css, '''.deckCard {\n  min-height: 23rem;''', '''.deckCard {\n  min-height: 20.5rem;''')
replace_once(
    css,
    '''.deckCardMain {\n  width: 100%;\n  min-height: 19rem;\n  display: grid;\n  grid-template-rows: minmax(12rem, 1fr) auto;''',
    '''.deckCardMain {\n  width: 100%;\n  min-height: 16.75rem;\n  display: grid;\n  grid-template-rows: 11.25rem auto;''',
)
replace_once(
    css,
    '''.characterFan {\n  min-height: 13rem;\n  display: flex;\n  align-items: end;\n  justify-content: center;\n  overflow: hidden;\n  padding: 2.1rem 1rem .75rem;''',
    '''.characterFan {\n  position: relative;\n  min-height: 11.25rem;\n  display: flex;\n  align-items: end;\n  justify-content: center;\n  overflow: hidden;\n  padding: 1.25rem .75rem .45rem;''',
)
replace_once(
    css,
    '''.characterFan img:nth-child(3) {\n  transform: translate(-15%, 8%) rotate(7deg);\n}\n''',
    '''.characterFan img:nth-child(3) {\n  transform: translate(-15%, 8%) rotate(7deg);\n}\n\n.characterFanFeatured > img,\n.characterFanFeatured > .characterPlaceholder {\n  position: absolute;\n  bottom: .45rem;\n  width: min(27%, 6.9rem);\n}\n\n.characterFanFeatured > :nth-child(1) {\n  left: 7%;\n  transform: translateY(7%) rotate(-10deg);\n}\n\n.characterFanFeatured > :nth-child(2) {\n  z-index: 2;\n  left: 29%;\n  transform: translateY(2%) rotate(-4deg);\n}\n\n.characterFanFeatured > :nth-child(3) {\n  z-index: 1;\n  right: 7%;\n  transform: translateY(7%) rotate(10deg);\n}\n\n.characterFanFeatured > .featuredPreviewCard {\n  z-index: 4;\n  left: 49%;\n  bottom: .7rem;\n  width: min(28%, 7.2rem);\n  transform: rotate(3deg);\n  filter: drop-shadow(0 .75rem .85rem rgba(0, 0, 0, .72));\n}\n''',
)
replace_once(
    css,
    '''.characterFanCompact {\n  min-height: 9rem;\n  padding-top: 1.25rem;\n}\n\n.characterFanCompact img {\n  max-height: 8.5rem;\n}\n''',
    '''.characterFanCompact {\n  min-height: 8.5rem;\n  padding-top: 1rem;\n}\n\n.characterFanCompact img {\n  max-height: 8rem;\n}\n''',
)
replace_once(
    css,
    '''.deckCardCopy {\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-2);\n  padding: var(--space-4) var(--space-5);\n}''',
    '''.deckCardCopy {\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n  gap: .4rem;\n  padding: var(--space-3) var(--space-4) var(--space-4);\n}''',
)
replace_once(
    css,
    '''.deckTitleRow h2 {\n  min-height: 2.2em;\n  margin: 0;''',
    '''.deckTitleRow h2 {\n  margin: 0;''',
)
replace_once(
    css,
    '''  font-size: clamp(1.2rem, 2vw, 1.6rem);\n  line-height: 1.1;''',
    '''  font-size: clamp(1.08rem, 1.7vw, 1.4rem);\n  line-height: 1.08;''',
)
replace_once(
    css,
    '''.chipRow {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: var(--space-2);\n}\n\n.deckCardActions {''',
    '''.chipRow {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: var(--space-2);\n}\n\n.factionSymbols {\n  min-height: 1.5rem;\n  display: flex;\n  align-items: center;\n  gap: .4rem;\n  color: var(--text-secondary);\n  font-size: var(--type-meta);\n}\n\n.factionSymbols img {\n  width: 1.45rem;\n  height: 1.45rem;\n  object-fit: contain;\n  filter: drop-shadow(0 .15rem .22rem rgba(0, 0, 0, .65));\n}\n\n.deckCardActions {''',
)
replace_once(
    css,
    '''.deckCardActions {\n  position: relative;\n  min-height: 3.25rem;\n  display: flex;\n  align-items: center;\n  gap: 1px;\n  padding: 0 var(--space-3) var(--space-3);\n}''',
    '''.deckCardActions {\n  position: relative;\n  min-height: 3.15rem;\n  display: flex;\n  align-items: center;\n  gap: .4rem;\n  padding: .7rem var(--space-4) var(--space-4);\n  border-top: 1px solid rgba(137, 203, 226, .12);\n}''',
)
replace_once(
    css,
    '''  min-height: 2.6rem;\n  padding: .55rem .8rem;''',
    '''  min-height: 2.75rem;\n  padding: .5rem .72rem;''',
)
replace_once(
    css,
    '''  letter-spacing: .04em;\n  text-transform: uppercase;\n}\n\n.deckCardActions > button:first-child {''',
    '''  letter-spacing: .04em;\n  text-transform: uppercase;\n  white-space: nowrap;\n}\n\n.deckCardActions > button:first-child {''',
)
replace_once(
    css,
    '''.deckCardActions > button:first-child {\n  flex: 1;\n  background: #07536c;\n}\n''',
    '''.deckCardActions > button:first-child {\n  flex: 1;\n  background: #07536c;\n}\n\n.publicDeckActions > button:nth-child(2) {\n  flex: 1;\n}\n\n.favoriteButton {\n  flex: 0 0 auto !important;\n  min-width: 4.25rem;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: .4rem;\n}\n\n.favoriteButton > span:first-child {\n  font-size: 1.15rem;\n  line-height: 1;\n}\n\n.favoriteButton[aria-pressed="true"] {\n  border-color: rgba(255, 211, 86, .68);\n  background: rgba(94, 65, 7, .72);\n  color: #ffe17d;\n}\n''',
)

# The public-card body gets a little more breathing room at the bottom without reverting to poster proportions.
replace_once(
    css,
    '''.deckCard_list {\n  min-height: 12rem;\n}\n''',
    '''.deckCard_list {\n  min-height: 11rem;\n}\n\n.publicDeckCard .deckCardCopy > p {\n  margin-top: -.1rem;\n}\n''',
)

# Regression coverage for the new presentation contract.
write(
    "tests/deck-library-visuals.test.ts",
    '''import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nimport test from "node:test";\n\nconst read = (path: string) => readFile(path, "utf8");\n\ntest("Deck Library previews use three Characters plus the deck Featured card", async () => {\n  const route = await read("components/routes/DeckRoutes.tsx");\n  assert.match(route, /deckLeadCard/);\n  assert.match(route, /featuredPreviewCard/);\n  assert.match(route, /data-featured-preview=\\{featuredPreviewCard \\? "true"/);\n  assert.equal((route.match(/<CharacterFan deck=\\{deck\\} compact=\\{view === "list"\\} featured \\/>/g) ?? []).length, 2);\n});\n\ntest("Deck Library faction metadata is symbol-first and remains accessible", async () => {\n  const route = await read("components/routes/DeckRoutes.tsx");\n  assert.match(route, /function DeckFactionSymbols/);\n  assert.match(route, /src=\\{FACTION_SYMBOLS\\[faction\\]\\}/);\n  assert.match(route, /aria-label=\\{`Factions: \\$/);\n  assert.match(route, /title=\\{faction\\}/);\n  assert.equal((route.match(/<DeckFactionSymbols factions=\\{deck\\.factions\\} \\/>/g) ?? []).length, 2);\n});\n\ntest("Public Deck actions keep Favorite compact while preserving count and accessibility", async () => {\n  const route = await read("components/routes/DeckRoutes.tsx");\n  const start = route.indexOf("function PublicDeckTile");\n  const end = route.indexOf("export function PublicDeckDetailScreen", start);\n  const tile = route.slice(start, end);\n  assert.match(tile, /publicDeckActions/);\n  assert.match(tile, /title="Copy to My Decks">Copy<\\/button>/);\n  assert.match(tile, /className=\\{styles\\.favoriteButton\\}/);\n  assert.match(tile, /<span aria-hidden="true">\\{favorite\\.viewerHasFavorited \\? "★" : "☆"\\}<\\/span>/);\n  assert.match(tile, /<span>\\{favorite\\.favoriteCount\\}<\\/span>/);\n  assert.doesNotMatch(tile, /Copy to My Decks<\\/button>/);\n});\n\ntest("Deck Library CSS keeps cards compact and gives the Featured card a front fan position", async () => {\n  const css = await read("components/routes/DeckRoutes.module.css");\n  assert.match(css, /\\.characterFanFeatured > \\.featuredPreviewCard/);\n  assert.match(css, /\\.factionSymbols img/);\n  assert.match(css, /\\.favoriteButton\\[aria-pressed="true"\\]/);\n  assert.match(css, /grid-template-rows: 11\\.25rem auto/);\n  assert.doesNotMatch(css, /min-height: 2\\.2em/);\n});\n''',
)

replace_once(
    "package.json",
    '''tests/public-deck-favorites.test.ts && node --test tests/rendered-html.test.mjs''',
    '''tests/public-deck-favorites.test.ts tests/deck-library-visuals.test.ts && node --test tests/rendered-html.test.mjs''',
)

# Contract checks before the build catches syntax/type errors.
for path, needle in [
    (route, "featuredPreviewCard"),
    (route, "DeckFactionSymbols"),
    (route, "publicDeckActions"),
    (route, "favoriteButton"),
    (css, ".characterFanFeatured"),
    (css, ".factionSymbols"),
]:
    if needle not in read(path):
        raise SystemExit(f"{path}: missing visual-refresh contract {needle}")

print("Deck Library visual refresh applied.")
