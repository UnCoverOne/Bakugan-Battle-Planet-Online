from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise AssertionError(f"Patch anchor not found in {path}: {old[:140]!r}")
    file.write_text(text.replace(old, new, 1))


def insert_before(path: str, anchor: str, addition: str) -> None:
    replace_once(path, anchor, addition + anchor)


# Server-owned, per-Administrator preference using the existing admin resource table.
insert_before(
    "lib/administration-server.ts",
    "export async function loadCardOverrides(db: Database): Promise<CardOverrideRecord[]> {",
    '''export type AdministratorAiVisibility = { revealAiCards: boolean };
const ADMINISTRATOR_AI_VISIBILITY_RESOURCE = "administrator-ai-visibility";

export async function getAdministratorAiVisibility(
  db: Database,
  administratorId: string,
): Promise<AdministratorAiVisibility> {
  const rows = await resourceRows(db, ADMINISTRATOR_AI_VISIBILITY_RESOURCE);
  const row = rows.find((candidate) => candidate.resource_id === administratorId);
  const value = row
    ? parseJson<{ revealAiCards?: boolean }>(row.data_json, {})
    : {};
  return { revealAiCards: Boolean(row?.enabled && value.revealAiCards) };
}

export async function setAdministratorAiVisibility(
  db: Database,
  administratorId: string,
  revealAiCards: boolean,
): Promise<AdministratorAiVisibility> {
  const value = { revealAiCards: Boolean(revealAiCards) };
  await upsertResource(
    db,
    ADMINISTRATOR_AI_VISIBILITY_RESOURCE,
    administratorId,
    value,
    value.revealAiCards,
    administratorId,
  );
  return value;
}

''',
)

# Protected Administrator API read and mutation.
replace_once(
    "app/api/admin/route.ts",
    '''  deleteAiDeck,
  deletePublicDeck,
  listAiDecks,''',
    '''  deleteAiDeck,
  deletePublicDeck,
  getAdministratorAiVisibility,
  listAiDecks,''',
)
replace_once(
    "app/api/admin/route.ts",
    '''  saveCardOverride,
  setAiDeckEnabled,''',
    '''  saveCardOverride,
  setAdministratorAiVisibility,
  setAiDeckEnabled,''',
)
replace_once(
    "app/api/admin/route.ts",
    '''    await requireAdministrator(request);
    const db = await getDatabase();''',
    '''    const administrator = await requireAdministrator(request);
    const db = await getDatabase();''',
)
insert_before(
    "app/api/admin/route.ts",
    '''    if (section === "ai-decks") {''',
    '''    if (section === "ai-visibility") {
      return json(await getAdministratorAiVisibility(db, administrator.id));
    }
''',
)
insert_before(
    "app/api/admin/route.ts",
    '''    if (action === "ai-add") return json({ deck: await addAiDeck(db, body.deck, administrator.id) }, 201);''',
    '''    if (action === "ai-visibility") {
      return json(await setAdministratorAiVisibility(
        db,
        administrator.id,
        Boolean(body.enabled),
      ));
    }
''',
)

# Administrator Control Centre switch.
replace_once(
    "components/routes/AdminScreen.tsx",
    '''import { useApp } from "../application/AppProvider";''',
    '''import { useApp } from "../application/AppProvider";
import { notifyAdministratorAiVisibilityChanged } from "../application/useAdministratorAiVisibility";''',
)
replace_once(
    "components/routes/AdminScreen.tsx",
    '''  const state = useAdminData<{ decks: AiDeckItem[] }>("ai-decks", refresh);''',
    '''  const state = useAdminData<{ decks: AiDeckItem[] }>("ai-decks", refresh);
  const visibilityState = useAdminData<{ revealAiCards: boolean }>("ai-visibility", refresh);''',
)
insert_before(
    "components/routes/AdminScreen.tsx",
    '''  const add = async () => {''',
    '''  const updateAiVisibility = async (enabled: boolean) => {
    try {
      const result = await adminRequest({ action: "ai-visibility", enabled }) as {
        revealAiCards: boolean;
      };
      notifyAdministratorAiVisibilityChanged(result.revealAiCards);
      notify(result.revealAiCards
        ? "Training AI hand and Energy cards will be shown face up."
        : "Training AI hidden cards will use their card backs.");
      setRefresh((value) => value + 1);
    } catch (error) {
      notify(error instanceof Error ? error.message : "AI visibility could not be updated.");
    }
  };
''',
)
insert_before(
    "components/routes/AdminScreen.tsx",
    '''      <AdminState loading={state.loading} error={state.error} label="AI decks" />''',
    '''      <Surface className={styles.aiVisibilityControl}>
        <div className={styles.aiVisibilityCopy}>
          <span>ADMINISTRATOR MATCH TOOLS</span>
          <h3>Reveal Training AI hidden cards</h3>
          <p>Show the faces of the Training AI opponent’s Hand and Energy cards during local AI matches. Online opponents remain hidden.</p>
        </div>
        <label className={`${styles.switch} ${styles.featureSwitch}`}>
          <input
            type="checkbox"
            role="switch"
            aria-label="Reveal Training AI Hand and Energy cards"
            checked={Boolean(visibilityState.data?.revealAiCards)}
            disabled={visibilityState.loading || Boolean(visibilityState.error)}
            onChange={(event) => void updateAiVisibility(event.target.checked)}
          />
          <span>{visibilityState.data?.revealAiCards ? "On" : "Off"}</span>
        </label>
      </Surface>
      <AdminState loading={visibilityState.loading} error={visibilityState.error} label="AI visibility preference" />
''',
)
css_path = Path("components/routes/AdminScreen.module.css")
css_path.write_text(css_path.read_text() + '''
.aiVisibilityControl{display:flex;align-items:center;justify-content:space-between;gap:1.5rem;padding:1rem 1.2rem;border-color:rgba(255,78,66,.58);background:linear-gradient(120deg,rgba(89,13,18,.34),rgba(4,25,34,.94) 55%)}
.aiVisibilityCopy{min-width:0}.aiVisibilityCopy>span{color:#ff7770;font-size:var(--type-meta);font-weight:900;letter-spacing:var(--tracking-label)}
.aiVisibilityCopy h3{margin:.2rem 0 0;font-size:1.05rem}.aiVisibilityCopy p{max-width:54rem;margin:.35rem 0 0;color:var(--text-secondary);line-height:1.5}
.featureSwitch{flex:0 0 auto;padding:.65rem .8rem;background:rgba(0,0,0,.28);border:1px solid var(--border-strong)}
.featureSwitch input{width:2.5rem;height:1.35rem}
@media(max-width:700px){.aiVisibilityControl{align-items:stretch;flex-direction:column}.featureSwitch{justify-content:space-between}}
''')

# Opponent Hand rendering.
replace_once(
    "components/game-screen-v2/CardHandLayer.tsx",
    '''import { LikelyCardImagePreloader, ResponsiveCardImage } from "./ResponsiveCardImage";''',
    '''import { LikelyCardImagePreloader, ResponsiveCardImage } from "./ResponsiveCardImage";
import { useAdministratorAiVisibility } from "../application/useAdministratorAiVisibility";''',
)
hand_path = Path("components/game-screen-v2/CardHandLayer.tsx")
hand = hand_path.read_text()
start = hand.index("function OpponentHand({")
end = hand.index("export function CardHandLayer", start)
opponent_hand = '''function OpponentHand({
  cards,
  cardCount,
  bounds,
  revealFaces,
}: {
  cards: readonly GameCard[];
  cardCount: number;
  bounds: HandViewportBounds | null;
  revealFaces: boolean;
}) {
  if (!cardCount) return null;
  const layout = handCardLayout(cardCount, bounds?.geometry.spanDegrees);

  return (
    <section
      className={`${styles.handLayer} ${styles.opponentHandLayer}`}
      style={handLayerStyle(bounds)}
      aria-label={revealFaces
        ? `Training AI hand, ${cardCount} revealed card${cardCount === 1 ? "" : "s"}`
        : `Opponent hand, ${cardCount} hidden card${cardCount === 1 ? "" : "s"}`}
      data-zone-kind="hand"
      data-zone-owner="opponent"
      data-card-count={cardCount}
      data-hidden={revealFaces ? "false" : "true"}
      data-safe-width={bounds ? Math.round(bounds.safeWidth) : undefined}
      data-rendered-width={bounds ? Math.round(bounds.geometry.renderedWidth) : undefined}
    >
      <ol className={styles.handCards}>
        {layout.map((position, index) => {
          const card = cards[index];
          const faceUp = revealFaces && Boolean(card);
          return (
            <li
              className={styles.handCard}
              style={cardStyle(position.rotationDegrees, position.zIndex, "opponent")}
              data-card-id={faceUp ? card?.id : undefined}
              title={faceUp ? card?.displayName || card?.name : undefined}
              key={faceUp ? card!.id : `opponent-hidden-card-${index}`}
            >
              <div className={styles.handCardSurface}>
                <ResponsiveCardImage
                  className={`${styles.handCardImage} ${faceUp ? "" : styles.opponentCardBack}`}
                  src={faceUp ? card!.art : CARD_BACK_ART}
                  alt={faceUp ? card!.displayName || card!.name : ""}
                  ariaHidden={!faceUp}
                  draggable={false}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

'''
hand_path.write_text(hand[:start] + opponent_hand + hand[end:])
replace_once(
    "components/game-screen-v2/CardHandLayer.tsx",
    '''  const opponentCardCount = opponentHandCardCount(match, playerId);
  const playerBounds = useHandViewportBounds("player", cards.length);''',
    '''  const opponentCardCount = opponentHandCardCount(match, playerId);
  const revealOpponentAiCards = useAdministratorAiVisibility(match, playerId);
  const opponentCards = revealOpponentAiCards
    ? match?.players.find((candidate) => candidate.id !== playerId)?.hand ?? []
    : [];
  const playerBounds = useHandViewportBounds("player", cards.length);''',
)
replace_once(
    "components/game-screen-v2/CardHandLayer.tsx",
    '''      <OpponentHand cardCount={opponentCardCount} bounds={opponentBounds} />''',
    '''      <OpponentHand
        cards={opponentCards}
        cardCount={opponentCardCount}
        bounds={opponentBounds}
        revealFaces={revealOpponentAiCards}
      />''',
)

# Opponent Energy rendering.
replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''import { useBakuCorePresentation } from "./BakuCorePresentation";''',
    '''import { useBakuCorePresentation } from "./BakuCorePresentation";
import { useAdministratorAiVisibility } from "../application/useAdministratorAiVisibility";''',
)
replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''  onTap,
  canTap,
}: {
  owner: ZoneOwner;
  energy: EnergyZoneView;
  pendingCardId?: string;
  onTap?: EnergyTapHandler;
  canTap?: (cardId: string) => boolean;
}) {''',
    '''  onTap,
  canTap,
  revealFaces = false,
}: {
  owner: ZoneOwner;
  energy: EnergyZoneView;
  pendingCardId?: string;
  onTap?: EnergyTapHandler;
  canTap?: (cardId: string) => boolean;
  revealFaces?: boolean;
}) {''',
)
replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''            <img
              src={CARD_BACK_ART}
              alt=""
              aria-hidden="true"
              draggable={false}
            />''',
    '''            <img
              src={revealFaces ? card.art : CARD_BACK_ART}
              alt={revealFaces ? card.displayName || card.name : ""}
              aria-hidden={!revealFaces}
              data-hidden={revealFaces ? "false" : "true"}
              draggable={false}
            />''',
)
# The second identical signature belongs to EnergyZone.
replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''  onTap,
  canTap,
}: {
  owner: ZoneOwner;
  energy: EnergyZoneView;
  pendingCardId?: string;
  onTap?: EnergyTapHandler;
  canTap?: (cardId: string) => boolean;
}) {''',
    '''  onTap,
  canTap,
  revealFaces = false,
}: {
  owner: ZoneOwner;
  energy: EnergyZoneView;
  pendingCardId?: string;
  onTap?: EnergyTapHandler;
  canTap?: (cardId: string) => boolean;
  revealFaces?: boolean;
}) {''',
)
replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''        onTap={onTap}
        canTap={canTap}
      />''',
    '''        onTap={onTap}
        canTap={canTap}
        revealFaces={revealFaces}
      />''',
)
replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''  onTapEnergyCard,
  canTapEnergyCard,
  openDiscardOwner,''',
    '''  onTapEnergyCard,
  canTapEnergyCard,
  revealEnergyFaces = false,
  openDiscardOwner,''',
)
replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''  onTapEnergyCard?: EnergyTapHandler;
  canTapEnergyCard?: (cardId: string) => boolean;
  openDiscardOwner: ZoneOwner | null;''',
    '''  onTapEnergyCard?: EnergyTapHandler;
  canTapEnergyCard?: (cardId: string) => boolean;
  revealEnergyFaces?: boolean;
  openDiscardOwner: ZoneOwner | null;''',
)
replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''          onTap={onTapEnergyCard}
          canTap={canTapEnergyCard}
        />''',
    '''          onTap={onTapEnergyCard}
          canTap={canTapEnergyCard}
          revealFaces={revealEnergyFaces}
        />''',
)
replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''  const energyState = energyZoneViews(match, playerId);
  const resolvedCounts:''',
    '''  const energyState = energyZoneViews(match, playerId);
  const revealOpponentAiCards = useAdministratorAiVisibility(match, playerId);
  const resolvedCounts:''',
)
replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''            energy={energyState.opponent}
            openDiscardOwner={openDiscardOwner}''',
    '''            energy={energyState.opponent}
            revealEnergyFaces={revealOpponentAiCards}
            openDiscardOwner={openDiscardOwner}''',
)

# Source-contract test and standard suite registration.
test_path = Path("tests/admin-ai-visibility.test.ts")
test_source = test_path.read_text().replace(
    r'/revealFaces \? card\?\.art : CARD_BACK_ART/',
    r'/src=\{faceUp \? card!\.art : CARD_BACK_ART\}/',
)
test_path.write_text(test_source)
replace_once(
    "package.json",
    '''tests/administration.test.ts tests/achievements.test.ts''',
    '''tests/administration.test.ts tests/admin-ai-visibility.test.ts tests/achievements.test.ts''',
)
