from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one occurrence, found {count}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


# 1) Persistent account-backed favorite relationship. One user contributes at most one favorite per deck.
replace_once(
    "lib/account-server.ts",
    '''    db.prepare("CREATE INDEX IF NOT EXISTS admin_resources_type_enabled_idx ON admin_resources(resource_type, enabled)"),\n''',
    '''    db.prepare("CREATE INDEX IF NOT EXISTS admin_resources_type_enabled_idx ON admin_resources(resource_type, enabled)"),
    db.prepare("CREATE TABLE IF NOT EXISTS public_deck_favorites (user_id TEXT NOT NULL, deck_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, deck_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)"),
    db.prepare("CREATE INDEX IF NOT EXISTS public_deck_favorites_deck_idx ON public_deck_favorites(deck_id)"),
''',
)

# 2) Server model keeps social metadata separate from DeckRecord.
write(
    "lib/public-deck-favorites-server.ts",
    '''import { ensureAdministrationSchema, type AccountDatabase } from "./account-server";
import { listManagedPublicDecks } from "./administration-server";

export type PublicDeckFavoriteMetadata = {
  favoriteCount: number;
  viewerHasFavorited: boolean;
};

export type PublicDeckFavoriteMap = Record<string, PublicDeckFavoriteMetadata>;

export async function listPublicDeckFavoriteMetadata(
  db: AccountDatabase,
  deckIds: readonly string[],
  viewerUserId?: string,
): Promise<PublicDeckFavoriteMap> {
  await ensureAdministrationSchema(db);
  const uniqueIds = [...new Set(deckIds.filter(Boolean))];
  if (!uniqueIds.length) return {};
  const allowed = new Set(uniqueIds);
  const counts = await db.prepare(
    "SELECT deck_id, COUNT(*) AS favorite_count FROM public_deck_favorites GROUP BY deck_id",
  ).all() as { results?: Array<{ deck_id: string; favorite_count: number }> };
  const countByDeck = new Map(
    (counts.results ?? [])
      .filter((row) => allowed.has(row.deck_id))
      .map((row) => [row.deck_id, Math.max(0, Number(row.favorite_count) || 0)]),
  );
  const viewerFavorites = new Set<string>();
  if (viewerUserId) {
    const result = await db.prepare(
      "SELECT deck_id FROM public_deck_favorites WHERE user_id = ?",
    ).bind(viewerUserId).all() as { results?: Array<{ deck_id: string }> };
    for (const row of result.results ?? []) {
      if (allowed.has(row.deck_id)) viewerFavorites.add(row.deck_id);
    }
  }
  return Object.fromEntries(uniqueIds.map((deckId) => [deckId, {
    favoriteCount: countByDeck.get(deckId) ?? 0,
    viewerHasFavorited: viewerFavorites.has(deckId),
  }]));
}

export async function setPublicDeckFavorite(
  db: AccountDatabase,
  userId: string,
  deckId: string,
  favorite: boolean,
) {
  const normalizedId = deckId.trim();
  if (!normalizedId) throw new Error("Public deck ID is required.");
  const exists = (await listManagedPublicDecks(db)).some((item) => item.deck.id === normalizedId);
  if (!exists) throw new Error("The public deck no longer exists.");
  await ensureAdministrationSchema(db);
  if (favorite) {
    await db.prepare(
      "INSERT OR IGNORE INTO public_deck_favorites (user_id, deck_id, created_at) VALUES (?, ?, ?)",
    ).bind(userId, normalizedId, Date.now()).run();
  } else {
    await db.prepare(
      "DELETE FROM public_deck_favorites WHERE user_id = ? AND deck_id = ?",
    ).bind(userId, normalizedId).run();
  }
  const count = await db.prepare(
    "SELECT COUNT(*) AS favorite_count FROM public_deck_favorites WHERE deck_id = ?",
  ).bind(normalizedId).first<{ favorite_count: number }>();
  const viewer = await db.prepare(
    "SELECT 1 AS present FROM public_deck_favorites WHERE user_id = ? AND deck_id = ?",
  ).bind(userId, normalizedId).first<{ present: number }>();
  return {
    deckId: normalizedId,
    favoriteCount: Math.max(0, Number(count?.favorite_count) || 0),
    viewerHasFavorited: Boolean(viewer?.present),
  };
}
''',
)

# 3) Public catalogue exposes counts + viewer state, and accepts authenticated idempotent favorite mutations.
write(
    "app/api/public-decks/route.ts",
    '''import { getDatabase, getSessionUser } from "../../../lib/account-server";
import { listOfflinePublicDeckSlots, listPublicDecks } from "../../../lib/administration-server";
import {
  listPublicDeckFavoriteMetadata,
  setPublicDeckFavorite,
} from "../../../lib/public-deck-favorites-server";
import { assertSameOrigin, enforceD1RateLimit, requestClientKey } from "../../../lib/request-security";
import { AuthenticationError, ValidationError, serverErrorResponse } from "../../../lib/server-errors";

export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
});

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const db = await getDatabase();
    const [decks, offlineSlots, viewer] = await Promise.all([
      listPublicDecks(db),
      listOfflinePublicDeckSlots(db),
      getSessionUser(request),
    ]);
    const [favorites] = await Promise.all([
      listPublicDeckFavoriteMetadata(db, decks.map((deck) => deck.id), viewer?.id),
    ]);
    const offlineFallbackDecks = offlineSlots.flatMap((slot) => slot.deck ? [slot.deck] : []);
    const offlineFallbackRevision = offlineSlots.reduce((latest, slot) => Math.max(latest, slot.updatedAt), 0);
    return json({
      decks,
      favorites,
      offlineFallbackDecks,
      offlineFallbackRevision,
      correlationId,
    });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Public decks are unavailable.", {
      route: "/api/public-decks",
      method: "GET",
    });
  }
}

export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const viewer = await getSessionUser(request);
    if (!viewer) throw new AuthenticationError("Sign in to favorite Public decks.");
    const db = await getDatabase();
    await enforceD1RateLimit(
      db,
      `public-deck-favorite:${viewer.id}:${requestClientKey(request)}`,
      60,
      60_000,
    );
    const body = await request.json() as { action?: unknown; deckId?: unknown };
    const action = String(body.action ?? "");
    if (action !== "favorite" && action !== "unfavorite") {
      throw new ValidationError("Favorite action is invalid.");
    }
    const favorite = await setPublicDeckFavorite(
      db,
      viewer.id,
      String(body.deckId ?? ""),
      action === "favorite",
    );
    return json({ favorite, correlationId });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "The Public deck favorite could not be changed.", {
      route: "/api/public-decks",
      method: "POST",
    });
  }
}
''',
)

# 4) Permanent administrator deletion removes the deck's social rows.
replace_once(
    "lib/administration-server.ts",
    '''  await upsertResource(db, "public-deck", deckId, { deleted: true, source: current.source }, false, administratorId);\n}\n\nconst DEFAULT_AI_RESOURCE''',
    '''  await upsertResource(db, "public-deck", deckId, { deleted: true, source: current.source }, false, administratorId);
  await ensureAdministrationSchema(db);
  await db.prepare("DELETE FROM public_deck_favorites WHERE deck_id = ?").bind(deckId).run();
}

const DEFAULT_AI_RESOURCE''',
)

# Normal user deletion also removes social rows, while Public -> Private retains them for republishing.
replace_once(
    "lib/account-data-server.ts",
    '''import type { AccountDatabase } from "./account-server";''',
    '''import { ensureAdministrationSchema, type AccountDatabase } from "./account-server";''',
)
replace_once(
    "lib/account-data-server.ts",
    '''  const mutations: D1PreparedStatement[] = [];\n  const expectedFinal = new Map<''',
    '''  const mutations: D1PreparedStatement[] = [];
  const deletedDeckIds = new Set<string>();
  const expectedFinal = new Map<''',
)
replace_once(
    "lib/account-data-server.ts",
    '''    expectedFinal.set(candidate.key, {\n      dataJson: candidate.dataJson,\n      deletedAt: candidate.deletedAt,\n    });''',
    '''    if (candidate.type === "deck" && candidate.deletedAt) deletedDeckIds.add(candidate.id);
    expectedFinal.set(candidate.key, {
      dataJson: candidate.dataJson,
      deletedAt: candidate.deletedAt,
    });''',
)
replace_once(
    "lib/account-data-server.ts",
    '''  await runBatches(db, mutations);\n  await db.prepare(\n    "DELETE FROM user_match_history''',
    '''  await runBatches(db, mutations);
  if (deletedDeckIds.size) {
    await ensureAdministrationSchema(db);
    await runBatches(db, [...deletedDeckIds].map((deckId) => db.prepare(
      "DELETE FROM public_deck_favorites WHERE deck_id = ?",
    ).bind(deckId)));
  }
  await db.prepare(
    "DELETE FROM user_match_history''',
)

# 5) Account intent and prompt explain why sign-in is needed for favoriting.
replace_once(
    "lib/account-intent.ts",
    '''  | "publish-deck"\n  | "protect-progress"''',
    '''  | "publish-deck"
  | "favorite-deck"
  | "protect-progress"''',
)
replace_once(
    "lib/account-intent.ts",
    '''    case "match-complete":\n      return {''',
    '''    case "favorite-deck":
      return {
        eyebrow: "Save a public strategy",
        title: "Create an account to favorite decks",
        copy: "Favorites follow your Brawler account across devices and contribute once to each deck's community total.",
      };
    case "match-complete":
      return {''',
)
replace_once(
    "components/application/AccountAccessModal.tsx",
    '''  reason: "deck-saved" | "match-complete" | "publish-deck";''',
    '''  reason: "deck-saved" | "match-complete" | "publish-deck" | "favorite-deck";''',
)
replace_once(
    "components/application/AccountAccessModal.tsx",
    '''  const prompt = reason === "publish-deck"\n    ? {\n        title: "Account required to publish",\n        copy: "The deck is saved privately on this device. Create an account to publish it under your Brawler name.",\n        intent: "publish-deck" as const,\n      }\n    : reason === "deck-saved"''',
    '''  const prompt = reason === "publish-deck"
    ? {
        title: "Account required to publish",
        copy: "The deck is saved privately on this device. Create an account to publish it under your Brawler name.",
        intent: "publish-deck" as const,
      }
    : reason === "favorite-deck"
      ? {
          title: "Account required to favorite",
          copy: "Create an account or log in to save this Public deck to My Favorites and add one community Favorite.",
          intent: "favorite-deck" as const,
        }
      : reason === "deck-saved"''',
)

# Resume the original click after authentication so the user does not need to favorite twice.
replace_once(
    "components/application/GuestExperienceController.tsx",
    '''    const intent = readAccountIntent();\n    if (!intent) return;\n    if (intent.reason !== "publish-deck" || !intent.deckId) {\n      clearAccountIntent();\n      return;\n    }\n    const deck = decks.find((item: DeckRecord) => item.id === intent.deckId);''',
    '''    const intent = readAccountIntent();
    if (!intent) return;
    if (intent.reason === "favorite-deck" && intent.deckId) {
      let active = true;
      void fetch("/api/public-decks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "favorite", deckId: intent.deckId }),
      }).then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Public deck could not be favorited.");
        if (active) {
          notify("Public deck added to My Favorites.");
          window.dispatchEvent(new Event("bbp-public-deck-favorites-updated"));
        }
      }).catch((error) => {
        if (active) notify(error instanceof Error ? error.message : "Public deck could not be favorited.");
      }).finally(() => clearAccountIntent());
      return () => { active = false; };
    }
    if (intent.reason !== "publish-deck" || !intent.deckId) {
      clearAccountIntent();
      return;
    }
    const deck = decks.find((item: DeckRecord) => item.id === intent.deckId);''',
)

# 6) Public library UI: metadata, optimistic Favorite button, My Favorites filter and Most Favorited sorting.
replace_once(
    "components/routes/DeckRoutes.tsx",
    '''import { DECK_LIMIT, decodeDeckCode, deckTextList, encodeDeckCode, uniqueDeckName } from "../../lib/deck-transfer";''',
    '''import { rememberAccountIntent } from "../../lib/account-intent";
import { DECK_LIMIT, decodeDeckCode, deckTextList, encodeDeckCode, uniqueDeckName } from "../../lib/deck-transfer";''',
)
replace_once(
    "components/routes/DeckRoutes.tsx",
    '''type PublicDeckCatalogueState = {\n  status: "loading" | "online" | "offline" | "error";\n  decks: DeckRecord[];\n  error?: string;\n};\n\nfunction usePublicDeckCatalogue(online: boolean): PublicDeckCatalogueState {\n  const [state, setState] = useState<PublicDeckCatalogueState>({ status: "loading", decks: [] });\n  useEffect(() => {\n    let active = true;\n    if (!online) {\n      const cached = readOfflinePublicDeckCache(localStorage);\n      const decks = (cached ?? BUNDLED_OFFLINE_PUBLIC_DECKS).map(clone);\n      setState({ status: "offline", decks });\n      return () => { active = false; };\n    }\n    setState({ status: "loading", decks: [] });\n    fetch("/api/public-decks", { cache: "no-store" })\n      .then(async (response) => {\n        const result = await response.json();\n        if (!response.ok || !Array.isArray(result.decks)) throw new Error(result.error ?? "Public decks are unavailable.");\n        if (Array.isArray(result.offlineFallbackDecks)) {\n          writeOfflinePublicDeckCache(\n            localStorage,\n            result.offlineFallbackDecks,\n            Number(result.offlineFallbackRevision ?? Date.now()),\n          );\n        }\n        if (active) setState({ status: "online", decks: result.decks });\n      })\n      .catch((error) => {\n        if (active) setState({\n          status: "error",\n          decks: [],\n          error: error instanceof Error ? error.message : "Public decks are unavailable.",\n        });\n      });\n    return () => { active = false; };\n  }, [online]);\n  return state;\n}''',
    '''type PublicDeckFavoriteMetadata = {
  favoriteCount: number;
  viewerHasFavorited: boolean;
};

type PublicDeckCatalogueState = {
  status: "loading" | "online" | "offline" | "error";
  decks: DeckRecord[];
  favorites: Record<string, PublicDeckFavoriteMetadata>;
  error?: string;
};

const publicFavoriteMetadata = (
  decks: DeckRecord[],
  value: unknown,
): Record<string, PublicDeckFavoriteMetadata> => {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, { favoriteCount?: unknown; viewerHasFavorited?: unknown }>
    : {};
  return Object.fromEntries(decks.map((deck) => {
    const metadata = source[deck.id];
    return [deck.id, {
      favoriteCount: Math.max(0, Number(metadata?.favoriteCount) || 0),
      viewerHasFavorited: Boolean(metadata?.viewerHasFavorited),
    }];
  }));
};

function usePublicDeckCatalogue(online: boolean, viewerUserId?: string) {
  const [state, setState] = useState<PublicDeckCatalogueState>({ status: "loading", decks: [], favorites: {} });
  const [refreshRevision, setRefreshRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRefreshRevision((value) => value + 1);
    addEventListener("bbp-public-deck-favorites-updated", refresh);
    return () => removeEventListener("bbp-public-deck-favorites-updated", refresh);
  }, []);
  useEffect(() => {
    let active = true;
    if (!online) {
      const cached = readOfflinePublicDeckCache(localStorage);
      const decks = (cached ?? BUNDLED_OFFLINE_PUBLIC_DECKS).map(clone);
      setState({ status: "offline", decks, favorites: {} });
      return () => { active = false; };
    }
    setState({ status: "loading", decks: [], favorites: {} });
    fetch("/api/public-decks", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !Array.isArray(result.decks)) throw new Error(result.error ?? "Public decks are unavailable.");
        if (Array.isArray(result.offlineFallbackDecks)) {
          writeOfflinePublicDeckCache(
            localStorage,
            result.offlineFallbackDecks,
            Number(result.offlineFallbackRevision ?? Date.now()),
          );
        }
        if (active) setState({
          status: "online",
          decks: result.decks,
          favorites: publicFavoriteMetadata(result.decks, result.favorites),
        });
      })
      .catch((error) => {
        if (active) setState({
          status: "error",
          decks: [],
          favorites: {},
          error: error instanceof Error ? error.message : "Public decks are unavailable.",
        });
      });
    return () => { active = false; };
  }, [online, refreshRevision, viewerUserId]);
  const updateFavorite = (deckId: string, metadata: PublicDeckFavoriteMetadata) => {
    setState((current) => ({
      ...current,
      favorites: { ...current.favorites, [deckId]: metadata },
    }));
  };
  return { ...state, updateFavorite };
}''',
)

# Extend the shared toolbar only when Public Deck-specific controls are supplied.
replace_once(
    "components/routes/DeckRoutes.tsx",
    '''  view,\n  setView,\n  count,\n}: {''',
    '''  view,
  setView,
  count,
  sortOptions = ["Updated", "Name", "Set"],
  favoritesOnly,
  setFavoritesOnly,
  favoritesEnabled = true,
}: {''',
)
replace_once(
    "components/routes/DeckRoutes.tsx",
    '''  count: number;\n}) {''',
    '''  count: number;
  sortOptions?: string[];
  favoritesOnly?: boolean;
  setFavoritesOnly?: (value: boolean) => void;
  favoritesEnabled?: boolean;
}) {''',
)
replace_once(
    "components/routes/DeckRoutes.tsx",
    '''      <Field label="Sort">\n        <select value={sort} onChange={(event) => setSort(event.target.value)}>\n          <option>Updated</option><option>Name</option><option>Set</option>\n        </select>\n      </Field>\n      <div className={styles.viewControls}>''',
    '''      <Field label="Sort">
        <select value={sort} onChange={(event) => setSort(event.target.value)}>
          {sortOptions.map((option) => <option key={option}>{option}</option>)}
        </select>
      </Field>
      {setFavoritesOnly && (
        <Field label="Favorites">
          <select
            value={favoritesOnly ? "Mine" : "All"}
            disabled={!favoritesEnabled}
            onChange={(event) => setFavoritesOnly(event.target.value === "Mine")}
          >
            <option value="All">All decks</option>
            <option value="Mine">My Favorites</option>
          </select>
        </Field>
      )}
      <div className={styles.viewControls}>''',
)

replace_once(
    "components/routes/DeckRoutes.tsx",
    '''export function PublicDeckLibraryScreen() {\n  const { ready, decks, setDecks, notify } = useApp();\n  const router = useRouter();\n  const online = useOnlineStatus();\n  const [query, setQuery] = useState("");\n  const [faction, setFaction] = useState("All");\n  const [legality, setLegality] = useState("All");\n  const [sort, setSort] = useState("Updated");\n  const [view, setView] = useState<LibraryView>("grid");\n  const catalogue = usePublicDeckCatalogue(online);\n  const allPublic = catalogue.decks;''',
    '''export function PublicDeckLibraryScreen() {
  const { ready, decks, setDecks, notify, authUser, promptAccount } = useApp();
  const router = useRouter();
  const online = useOnlineStatus();
  const [query, setQuery] = useState("");
  const [faction, setFaction] = useState("All");
  const [legality, setLegality] = useState("All");
  const [sort, setSort] = useState("Updated");
  const [view, setView] = useState<LibraryView>("grid");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [pendingFavoriteIds, setPendingFavoriteIds] = useState<Set<string>>(() => new Set());
  const catalogue = usePublicDeckCatalogue(online, authUser?.id);
  const allPublic = catalogue.decks;
  useEffect(() => {
    if (!authUser || catalogue.status !== "online") setFavoritesOnly(false);
  }, [authUser, catalogue.status]);''',
)
replace_once(
    "components/routes/DeckRoutes.tsx",
    '''    const matchesFaction = faction === "All" || deck.factions.includes(faction);\n    return matchesQuery && matchesFaction && (legality === "All" || (legality === "Legal" ? report.isLegal : !report.isLegal));\n  }).sort((a, b) => {\n    if (sort === "Name") return a.name.localeCompare(b.name);\n    if (sort === "Set") return deckSetName(a).localeCompare(deckSetName(b));\n    return Date.parse(b.publishedAt ?? b.updatedAt) - Date.parse(a.publishedAt ?? a.updatedAt);\n  });''',
    '''    const matchesFaction = faction === "All" || deck.factions.includes(faction);
    const matchesFavorite = !favoritesOnly || Boolean(catalogue.favorites[deck.id]?.viewerHasFavorited);
    return matchesQuery && matchesFaction && matchesFavorite && (legality === "All" || (legality === "Legal" ? report.isLegal : !report.isLegal));
  }).sort((a, b) => {
    if (sort === "Name") return a.name.localeCompare(b.name);
    if (sort === "Set") return deckSetName(a).localeCompare(deckSetName(b));
    if (sort === "Most Favorited") {
      const favoriteDifference = (catalogue.favorites[b.id]?.favoriteCount ?? 0) - (catalogue.favorites[a.id]?.favoriteCount ?? 0);
      if (favoriteDifference) return favoriteDifference;
      const publishedDifference = Date.parse(b.publishedAt ?? b.updatedAt) - Date.parse(a.publishedAt ?? a.updatedAt);
      return publishedDifference || a.name.localeCompare(b.name);
    }
    return Date.parse(b.publishedAt ?? b.updatedAt) - Date.parse(a.publishedAt ?? a.updatedAt);
  });''',
)
replace_once(
    "components/routes/DeckRoutes.tsx",
    '''  const copyDeck = (deck: DeckRecord) => {''',
    '''  const toggleFavorite = async (deck: DeckRecord) => {
    if (catalogue.status !== "online") {
      notify("Community Favorites are available while online.");
      return;
    }
    if (!authUser) {
      rememberAccountIntent("favorite-deck", { deckId: deck.id, returnTo: window.location.pathname });
      promptAccount("favorite-deck");
      return;
    }
    if (pendingFavoriteIds.has(deck.id)) return;
    const current = catalogue.favorites[deck.id] ?? { favoriteCount: 0, viewerHasFavorited: false };
    const nextFavorited = !current.viewerHasFavorited;
    const optimistic = {
      favoriteCount: Math.max(0, current.favoriteCount + (nextFavorited ? 1 : -1)),
      viewerHasFavorited: nextFavorited,
    };
    catalogue.updateFavorite(deck.id, optimistic);
    setPendingFavoriteIds((ids) => new Set(ids).add(deck.id));
    try {
      const response = await fetch("/api/public-decks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: nextFavorited ? "favorite" : "unfavorite", deckId: deck.id }),
      });
      const result = await response.json();
      if (!response.ok || !result.favorite) throw new Error(result.error ?? "Favorite could not be changed.");
      catalogue.updateFavorite(deck.id, {
        favoriteCount: Number(result.favorite.favoriteCount) || 0,
        viewerHasFavorited: Boolean(result.favorite.viewerHasFavorited),
      });
    } catch (error) {
      catalogue.updateFavorite(deck.id, current);
      notify(error instanceof Error ? error.message : "Favorite could not be changed.");
    } finally {
      setPendingFavoriteIds((ids) => {
        const next = new Set(ids);
        next.delete(deck.id);
        return next;
      });
    }
  };
  const copyDeck = (deck: DeckRecord) => {''',
)
replace_once(
    "components/routes/DeckRoutes.tsx",
    '''        view={view}\n        setView={setView}\n        count={visible.length}\n      />''',
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
replace_once(
    "components/routes/DeckRoutes.tsx",
    '''              view={view}\n              onOpen={() => router.push(`/decks/public/${encodeURIComponent(deck.id)}`)}\n              onCopy={() => copyDeck(deck)}\n            />''',
    '''              view={view}
              favorite={catalogue.favorites[deck.id] ?? { favoriteCount: 0, viewerHasFavorited: false }}
              favoriteAvailable={catalogue.status === "online"}
              favoritePending={pendingFavoriteIds.has(deck.id)}
              onFavorite={() => void toggleFavorite(deck)}
              onOpen={() => router.push(`/decks/public/${encodeURIComponent(deck.id)}`)}
              onCopy={() => copyDeck(deck)}
            />''',
)
replace_once(
    "components/routes/DeckRoutes.tsx",
    '''  onOpen,\n  onCopy,\n}: {\n  deck: DeckRecord;\n  report: DeckValidationResult;\n  view: LibraryView;\n  onOpen: () => void;\n  onCopy: () => void;\n}) {''',
    '''  favorite,
  favoriteAvailable,
  favoritePending,
  onFavorite,
  onOpen,
  onCopy,
}: {
  deck: DeckRecord;
  report: DeckValidationResult;
  view: LibraryView;
  favorite: PublicDeckFavoriteMetadata;
  favoriteAvailable: boolean;
  favoritePending: boolean;
  onFavorite: () => void;
  onOpen: () => void;
  onCopy: () => void;
}) {''',
)
replace_once(
    "components/routes/DeckRoutes.tsx",
    '''      <div className={styles.deckCardActions}>\n        <button onClick={onOpen}>View Deck</button>\n        <button onClick={onCopy} disabled={!report.isLegal}>Copy to My Decks</button>\n      </div>''',
    '''      <div className={styles.deckCardActions}>
        <button onClick={onOpen}>View Deck</button>
        <button onClick={onCopy} disabled={!report.isLegal}>Copy to My Decks</button>
        {favoriteAvailable && (
          <button
            aria-pressed={favorite.viewerHasFavorited}
            disabled={favoritePending}
            onClick={onFavorite}
          >
            {favorite.viewerHasFavorited ? "★ Favorited" : "☆ Favorite"} · {favorite.favoriteCount} {favorite.favoriteCount === 1 ? "Favorite" : "Favorites"}
          </button>
        )}
      </div>''',
)

# Public detail gets the same live Favorite state and count.
replace_once(
    "components/routes/DeckRoutes.tsx",
    '''export function PublicDeckDetailScreen({ id }: { id: string }) {\n  const router = useRouter();\n  const online = useOnlineStatus();\n  const { decks, setDecks, setBuilderDeck, notify, authUser } = useApp();\n  const catalogue = usePublicDeckCatalogue(online);''',
    '''export function PublicDeckDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const online = useOnlineStatus();
  const { decks, setDecks, setBuilderDeck, notify, authUser, promptAccount } = useApp();
  const [favoritePending, setFavoritePending] = useState(false);
  const catalogue = usePublicDeckCatalogue(online, authUser?.id);''',
)
replace_once(
    "components/routes/DeckRoutes.tsx",
    '''  const deck = catalogue.decks.find((item) => item.id === id);\n  if (!deck) return <MissingDeck id={id} publicDeck />;\n  const copy = () => {''',
    '''  const deck = catalogue.decks.find((item) => item.id === id);
  if (!deck) return <MissingDeck id={id} publicDeck />;
  const favorite = catalogue.favorites[deck.id] ?? { favoriteCount: 0, viewerHasFavorited: false };
  const toggleFavorite = async () => {
    if (catalogue.status !== "online") return notify("Community Favorites are available while online.");
    if (!authUser) {
      rememberAccountIntent("favorite-deck", { deckId: deck.id, returnTo: window.location.pathname });
      promptAccount("favorite-deck");
      return;
    }
    if (favoritePending) return;
    const nextFavorited = !favorite.viewerHasFavorited;
    const optimistic = {
      favoriteCount: Math.max(0, favorite.favoriteCount + (nextFavorited ? 1 : -1)),
      viewerHasFavorited: nextFavorited,
    };
    catalogue.updateFavorite(deck.id, optimistic);
    setFavoritePending(true);
    try {
      const response = await fetch("/api/public-decks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: nextFavorited ? "favorite" : "unfavorite", deckId: deck.id }),
      });
      const result = await response.json();
      if (!response.ok || !result.favorite) throw new Error(result.error ?? "Favorite could not be changed.");
      catalogue.updateFavorite(deck.id, {
        favoriteCount: Number(result.favorite.favoriteCount) || 0,
        viewerHasFavorited: Boolean(result.favorite.viewerHasFavorited),
      });
    } catch (error) {
      catalogue.updateFavorite(deck.id, favorite);
      notify(error instanceof Error ? error.message : "Favorite could not be changed.");
    } finally {
      setFavoritePending(false);
    }
  };
  const copy = () => {''',
)
replace_once(
    "components/routes/DeckRoutes.tsx",
    '''        <>\n          <ActionButton onClick={copy} disabled={!validateDeck(deck).isLegal}>Copy to My Decks</ActionButton>''',
    '''        <>
          {catalogue.status === "online" && (
            <ActionButton
              aria-pressed={favorite.viewerHasFavorited}
              disabled={favoritePending}
              onClick={() => void toggleFavorite()}
            >
              {favorite.viewerHasFavorited ? "★ Favorited" : "☆ Favorite"} · {favorite.favoriteCount} {favorite.favoriteCount === 1 ? "Favorite" : "Favorites"}
            </ActionButton>
          )}
          <ActionButton onClick={copy} disabled={!validateDeck(deck).isLegal}>Copy to My Decks</ActionButton>''',
)

# If the generic toolbar replacement landed in My Decks, move it to the Public call.
text = read("components/routes/DeckRoutes.tsx")
public_start = text.index("export function PublicDeckLibraryScreen()")
public_end = text.index("function PublicDeckTile", public_start)
public_block = text[public_start:public_end]
if 'sortOptions={["Updated", "Name", "Set", "Most Favorited"]}' not in public_block:
    public_block = public_block.replace(
        '''        view={view}\n        setView={setView}\n        count={visible.length}\n      />''',
        '''        view={view}\n        setView={setView}\n        count={visible.length}\n        sortOptions={["Updated", "Name", "Set", "Most Favorited"]}\n        favoritesOnly={favoritesOnly}\n        setFavoritesOnly={setFavoritesOnly}\n        favoritesEnabled={catalogue.status === "online" && Boolean(authUser)}\n      />''',
        1,
    )
    text = text[:public_start] + public_block + text[public_end:]
# Remove accidental Public-only props from the My Decks toolbar if present.
my_start = text.index("export function DeckLibraryScreen()")
my_end = text.index("export function PublicDeckLibraryScreen()", my_start)
my_block = text[my_start:my_end]
accidental = '''        count={visible.length}\n        sortOptions={["Updated", "Name", "Set", "Most Favorited"]}\n        favoritesOnly={favoritesOnly}\n        setFavoritesOnly={setFavoritesOnly}\n        favoritesEnabled={catalogue.status === "online" && Boolean(authUser)}\n      />'''
if accidental in my_block:
    my_block = my_block.replace(accidental, '''        count={visible.length}\n      />''', 1)
    text = text[:my_start] + my_block + text[my_end:]
write("components/routes/DeckRoutes.tsx", text)

# 7) Regression coverage.
write(
    "tests/public-deck-favorites.test.ts",
    '''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(path, "utf8");

test("public deck favorites are account-backed one-per-user social metadata", async () => {
  const [account, favorites, publicApi] = await Promise.all([
    read("lib/account-server.ts"),
    read("lib/public-deck-favorites-server.ts"),
    read("app/api/public-decks/route.ts"),
  ]);
  assert.match(account, /CREATE TABLE IF NOT EXISTS public_deck_favorites/);
  assert.match(account, /PRIMARY KEY \(user_id, deck_id\)/);
  assert.match(account, /ON DELETE CASCADE/);
  assert.match(favorites, /INSERT OR IGNORE INTO public_deck_favorites/);
  assert.match(favorites, /DELETE FROM public_deck_favorites WHERE user_id = \? AND deck_id = \?/);
  assert.match(favorites, /COUNT\(\*\) AS favorite_count/);
  assert.match(favorites, /listManagedPublicDecks/);
  assert.match(publicApi, /favorites,/);
  assert.match(publicApi, /getSessionUser\(request\)/);
  assert.match(publicApi, /action !== "favorite" && action !== "unfavorite"/);
  assert.match(publicApi, /assertSameOrigin\(request\)/);
  assert.match(publicApi, /enforceD1RateLimit/);
});

test("public deck UI supports optimistic Favorite state, ranking and personal filtering only online", async () => {
  const route = await read("components/routes/DeckRoutes.tsx");
  assert.match(route, /Most Favorited/);
  assert.match(route, /My Favorites/);
  assert.match(route, /viewerHasFavorited/);
  assert.match(route, /favoriteCount/);
  assert.match(route, /aria-pressed=\{favorite\.viewerHasFavorited\}/);
  assert.match(route, /catalogue\.status === "online"/);
  assert.match(route, /rememberAccountIntent\("favorite-deck"/);
  assert.match(route, /action: nextFavorited \? "favorite" : "unfavorite"/);
  assert.doesNotMatch(route, /BUNDLED_OFFLINE_PUBLIC_DECKS[^\n]+favoriteCount/);
});

test("favorite intent resumes after sign-in and permanent deck deletion cleans social rows", async () => {
  const [intent, prompt, guest, administration, sync] = await Promise.all([
    read("lib/account-intent.ts"),
    read("components/application/AccountAccessModal.tsx"),
    read("components/application/GuestExperienceController.tsx"),
    read("lib/administration-server.ts"),
    read("lib/account-data-server.ts"),
  ]);
  assert.match(intent, /\| "favorite-deck"/);
  assert.match(prompt, /Account required to favorite/);
  assert.match(guest, /intent\.reason === "favorite-deck"/);
  assert.match(guest, /action: "favorite"/);
  assert.match(guest, /bbp-public-deck-favorites-updated/);
  assert.match(administration, /DELETE FROM public_deck_favorites WHERE deck_id = \?/);
  assert.match(sync, /deletedDeckIds/);
  assert.match(sync, /DELETE FROM public_deck_favorites WHERE deck_id = \?/);
});
''',
)

# Include the new regression in the explicit npm test list (it will execute once the pre-existing CSS budget gate is green).
replace_once(
    "package.json",
    '''tests/open-indicator-presentation.test.ts && node --test tests/rendered-html.test.mjs''',
    '''tests/open-indicator-presentation.test.ts tests/public-deck-favorites.test.ts && node --test tests/rendered-html.test.mjs''',
)

# Contract sanity checks for the migrated tree.
for path, needle in [
    ("components/routes/DeckRoutes.tsx", 'sortOptions={["Updated", "Name", "Set", "Most Favorited"]}'),
    ("components/routes/DeckRoutes.tsx", "My Favorites"),
    ("components/routes/DeckRoutes.tsx", 'rememberAccountIntent("favorite-deck"'),
    ("app/api/public-decks/route.ts", "setPublicDeckFavorite"),
    ("lib/account-server.ts", "public_deck_favorites"),
]:
    if needle not in read(path):
        raise SystemExit(f"{path}: missing required favorite contract: {needle}")

print("Public Deck Favorite feature patch applied successfully.")
