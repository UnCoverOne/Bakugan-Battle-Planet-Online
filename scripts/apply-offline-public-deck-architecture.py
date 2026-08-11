from pathlib import Path

ROOT = Path('.')


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, content):
    (ROOT / path).write_text(content, encoding='utf-8')


def replace_exact(path, old, new, count=1):
    text = read(path)
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f'{path}: expected {count} occurrence(s), found {actual}: {old[:120]!r}')
    write(path, text.replace(old, new, count))


def ensure_absent(path, needle):
    if needle in read(path):
        raise SystemExit(f'{path}: unexpected remaining text: {needle}')


def create(path, content):
    target = ROOT / path
    if target.exists():
        raise SystemExit(f'{path}: already exists')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')

# 1) Separate bundled offline bootstrap decks from the online public catalogue.
replace_exact(
    'lib/data.ts',
    '''export const PUBLIC_DECKS: DeckRecord[] = [
  { ...STARTER_DECKS[1], id: "public-aquos-control", name: "Aurelus Tide Control", visibility: "Public", creator: "Mira Nova", description: "A patient Aquos control list that converts efficient Heroes and late-game Aurelus threats into a decisive Brawl.", publishedAt: "2026-07-25T18:00:00.000Z", updatedAt: "2026-07-25T18:00:00.000Z" },
  { ...STARTER_DECKS[0], id: "public-pyrus-fury", name: "Pyrus Fury", visibility: "Public", creator: "DanBrawler", description: "Fast pressure, flexible combat tricks, and a Pyrus-led plan built to finish Brawls before the opponent stabilizes.", publishedAt: "2026-07-23T15:30:00.000Z", updatedAt: "2026-07-23T15:30:00.000Z" },
  { ...STARTER_DECKS[2], id: "public-darkus-strike", name: "Darkus Strike", visibility: "Public", creator: "Magnus", description: "Darkus disruption backed by Ventus tempo and Haos protection for a resilient midrange strategy.", publishedAt: "2026-07-21T20:00:00.000Z", updatedAt: "2026-07-21T20:00:00.000Z" },
];''',
    '''export const OFFLINE_PUBLIC_DECK_SLOT_IDS = ["slot-1", "slot-2", "slot-3"] as const;
export type OfflinePublicDeckSlotId = typeof OFFLINE_PUBLIC_DECK_SLOT_IDS[number];

export const BUNDLED_OFFLINE_PUBLIC_DECKS: DeckRecord[] = [
  { ...STARTER_DECKS[1], id: "offline-slot-1", name: "Aurelus Tide Control", visibility: "Public", creator: "Mira Nova", description: "A patient Aquos control list that converts efficient Heroes and late-game Aurelus threats into a decisive Brawl.", publishedAt: "2026-07-25T18:00:00.000Z", updatedAt: "2026-07-25T18:00:00.000Z" },
  { ...STARTER_DECKS[0], id: "offline-slot-2", name: "Pyrus Fury", visibility: "Public", creator: "DanBrawler", description: "Fast pressure, flexible combat tricks, and a Pyrus-led plan built to finish Brawls before the opponent stabilizes.", publishedAt: "2026-07-23T15:30:00.000Z", updatedAt: "2026-07-23T15:30:00.000Z" },
  { ...STARTER_DECKS[2], id: "offline-slot-3", name: "Darkus Strike", visibility: "Public", creator: "Magnus", description: "Darkus disruption backed by Ventus tempo and Haos protection for a resilient midrange strategy.", publishedAt: "2026-07-21T20:00:00.000Z", updatedAt: "2026-07-21T20:00:00.000Z" },
];

/** @deprecated Bundled offline bootstrap data only. Do not merge this into the online public catalogue. */
export const PUBLIC_DECKS = BUNDLED_OFFLINE_PUBLIC_DECKS;'''
)

# 2) Add a durable browser cache for the administrator-managed offline slots.
create('lib/public-deck-cache.ts', '''import type { DeckRecord } from "./data";

export const OFFLINE_PUBLIC_DECK_CACHE_KEY = "bbp-offline-public-decks-v1";
export const OFFLINE_PUBLIC_DECKS_UPDATED_EVENT = "bbp-offline-public-decks-updated";

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type OfflinePublicDeckSnapshot = {
  version: 1;
  revision: number;
  decks: DeckRecord[];
};

const cloneDeck = (deck: DeckRecord): DeckRecord => ({
  ...deck,
  factions: [...deck.factions],
  bakuganIds: [...deck.bakuganIds],
  coreIds: [...deck.coreIds],
  cardIds: [...deck.cardIds],
  tags: [...(deck.tags ?? [])],
});

const isDeckRecord = (value: unknown): value is DeckRecord => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<DeckRecord>;
  return typeof candidate.id === "string"
    && typeof candidate.name === "string"
    && typeof candidate.updatedAt === "string"
    && candidate.visibility === "Public"
    && Array.isArray(candidate.factions)
    && candidate.factions.every((item) => typeof item === "string")
    && Array.isArray(candidate.bakuganIds)
    && candidate.bakuganIds.every((item) => typeof item === "string")
    && Array.isArray(candidate.coreIds)
    && candidate.coreIds.every((item) => typeof item === "string")
    && Array.isArray(candidate.cardIds)
    && candidate.cardIds.every((item) => typeof item === "string");
};

export function readOfflinePublicDeckCache(storage: StorageLike): DeckRecord[] | null {
  try {
    const raw = storage.getItem(OFFLINE_PUBLIC_DECK_CACHE_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as Partial<OfflinePublicDeckSnapshot>;
    if (snapshot.version !== 1 || !Array.isArray(snapshot.decks) || !snapshot.decks.every(isDeckRecord)) return null;
    return snapshot.decks.map(cloneDeck);
  } catch {
    return null;
  }
}

export function writeOfflinePublicDeckCache(
  storage: StorageLike,
  decks: DeckRecord[],
  revision = Date.now(),
) {
  const safeDecks = decks.filter(isDeckRecord).map(cloneDeck);
  const snapshot: OfflinePublicDeckSnapshot = {
    version: 1,
    revision: Number.isFinite(revision) ? revision : Date.now(),
    decks: safeDecks,
  };
  storage.setItem(OFFLINE_PUBLIC_DECK_CACHE_KEY, JSON.stringify(snapshot));
}

export function notifyOfflinePublicDecksUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(OFFLINE_PUBLIC_DECKS_UPDATED_EVENT));
  }
}
''')

# 3) Server ownership: online public decks exclude bundled fallbacks; three dedicated fallback slots live in admin_resources.
replace_exact(
    'lib/administration-server.ts',
    '''import {
  CARDS,
  PUBLIC_DECKS,
  STARTER_DECKS,
  applyCardOverrides,
  validateDeck,
  type CardOverrideRecord,
  type DeckRecord,
} from "./data";''',
    '''import {
  BUNDLED_OFFLINE_PUBLIC_DECKS,
  CARDS,
  OFFLINE_PUBLIC_DECK_SLOT_IDS,
  STARTER_DECKS,
  applyCardOverrides,
  validateDeck,
  type CardOverrideRecord,
  type DeckRecord,
  type OfflinePublicDeckSlotId,
} from "./data";'''
)
replace_exact(
    'lib/administration-server.ts',
    '''type ManagedDeck = {
  deck: DeckRecord;
  source: { kind: "builtin" | "user" | "resource"; userId?: string };
};''',
    '''type ManagedDeck = {
  deck: DeckRecord;
  source: { kind: "builtin" | "user" | "resource"; userId?: string };
};

const LEGACY_BUILTIN_PUBLIC_DECK_IDS = new Set([
  "public-aquos-control",
  "public-pyrus-fury",
  "public-darkus-strike",
]);
const OFFLINE_PUBLIC_DECK_RESOURCE_TYPE = "offline-public-deck";'''
)
replace_exact(
    'lib/administration-server.ts',
    '''export async function resetCardOverride(db: Database, catalogId: string) {
  await ensureAdministrationSchema(db);
  await db.prepare("DELETE FROM admin_resources WHERE resource_type = 'card' AND resource_id = ?")
    .bind(catalogId).run();
}

export async function listManagedPublicDecks(db: Database): Promise<ManagedDeck[]> {''',
    '''export async function resetCardOverride(db: Database, catalogId: string) {
  await ensureAdministrationSchema(db);
  await db.prepare("DELETE FROM admin_resources WHERE resource_type = 'card' AND resource_id = ?")
    .bind(catalogId).run();
}

export type OfflinePublicDeckSlot = {
  id: OfflinePublicDeckSlotId;
  deck: DeckRecord | null;
  source: "bundled" | "managed";
  updatedAt: number;
};

const isOfflinePublicDeckSlotId = (value: string): value is OfflinePublicDeckSlotId => (
  OFFLINE_PUBLIC_DECK_SLOT_IDS.includes(value as OfflinePublicDeckSlotId)
);

const normalizeOfflinePublicDeck = (slotId: OfflinePublicDeckSlotId, source: DeckRecord): DeckRecord => ({
  ...cloneDeck(source),
  id: `offline-${slotId}`,
  visibility: "Public",
  creator: source.creator ?? "Offline Fallback",
  publishedAt: source.publishedAt ?? source.updatedAt,
});

export async function listOfflinePublicDeckSlots(db: Database): Promise<OfflinePublicDeckSlot[]> {
  const rows = await resourceRows(db, OFFLINE_PUBLIC_DECK_RESOURCE_TYPE);
  const rowsById = new Map(rows.map((row) => [row.resource_id, row]));
  return OFFLINE_PUBLIC_DECK_SLOT_IDS.map((id, index) => {
    const row = rowsById.get(id);
    if (!row) {
      return {
        id,
        deck: normalizeOfflinePublicDeck(id, BUNDLED_OFFLINE_PUBLIC_DECKS[index]),
        source: "bundled" as const,
        updatedAt: 0,
      };
    }
    const value = parseJson<{ deck?: DeckRecord; cleared?: boolean }>(row.data_json, {});
    if (!row.enabled || value.cleared || !value.deck) {
      return { id, deck: null, source: "managed" as const, updatedAt: row.updated_at };
    }
    return {
      id,
      deck: normalizeOfflinePublicDeck(id, value.deck),
      source: "managed" as const,
      updatedAt: row.updated_at,
    };
  });
}

export async function updateOfflinePublicDeckSlot(
  db: Database,
  slotId: string,
  value: unknown,
  administratorId: string,
) {
  if (!isOfflinePublicDeckSlotId(slotId)) throw new Error("Offline public deck slot is invalid.");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Deck data must be an object.");
  const now = new Date().toISOString();
  const source = cloneDeck(value as DeckRecord);
  const deck = normalizeOfflinePublicDeck(slotId, {
    ...source,
    updatedAt: now,
    publishedAt: source.publishedAt ?? now,
  });
  const validation = validateDeck(deck);
  if (!validation.isLegal) throw new Error(`Offline fallback deck [${validation.issues[0].code}]: ${validation.issues[0].message}`);
  const updatedAt = Date.now();
  await upsertResource(db, OFFLINE_PUBLIC_DECK_RESOURCE_TYPE, slotId, { deck }, true, administratorId);
  return { id: slotId, deck, source: "managed" as const, updatedAt };
}

export async function clearOfflinePublicDeckSlot(db: Database, slotId: string, administratorId: string) {
  if (!isOfflinePublicDeckSlotId(slotId)) throw new Error("Offline public deck slot is invalid.");
  const updatedAt = Date.now();
  await upsertResource(db, OFFLINE_PUBLIC_DECK_RESOURCE_TYPE, slotId, { cleared: true }, false, administratorId);
  return { id: slotId, deck: null, source: "managed" as const, updatedAt };
}

export async function resetOfflinePublicDeckSlot(db: Database, slotId: string) {
  if (!isOfflinePublicDeckSlotId(slotId)) throw new Error("Offline public deck slot is invalid.");
  await ensureAdministrationSchema(db);
  await db.prepare("DELETE FROM admin_resources WHERE resource_type = ? AND resource_id = ?")
    .bind(OFFLINE_PUBLIC_DECK_RESOURCE_TYPE, slotId).run();
  return (await listOfflinePublicDeckSlots(db)).find((slot) => slot.id === slotId)!;
}

export async function listManagedPublicDecks(db: Database): Promise<ManagedDeck[]> {'''
)
replace_exact(
    'lib/administration-server.ts',
    '''  const managed: ManagedDeck[] = PUBLIC_DECKS.map((deck) => ({
    deck: cloneDeck(deck),
    source: { kind: "builtin" as const },
  }));''',
    '''  const managed: ManagedDeck[] = [];'''
)
replace_exact(
    'lib/administration-server.ts',
    '''  const overrides = await resourceRows(db, "public-deck");
  for (const row of overrides) {
    const value = parseJson<{ deck?: DeckRecord; deleted?: boolean; source?: ManagedDeck["source"] }>(row.data_json, {});''',
    '''  const overrides = await resourceRows(db, "public-deck");
  for (const row of overrides) {
    // These IDs belonged to repository-seeded showcase decks. They are now offline-only slots.
    if (LEGACY_BUILTIN_PUBLIC_DECK_IDS.has(row.resource_id)) continue;
    const value = parseJson<{ deck?: DeckRecord; deleted?: boolean; source?: ManagedDeck["source"] }>(row.data_json, {});'''
)
ensure_absent('lib/administration-server.ts', 'PUBLIC_DECKS.map')

# 4) Public endpoint sends authoritative online decks plus a separately cached fallback snapshot.
write('app/api/public-decks/route.ts', '''import { getDatabase } from "../../../lib/account-server";
import { listOfflinePublicDeckSlots, listPublicDecks } from "../../../lib/administration-server";
import { serverErrorResponse } from "../../../lib/server-errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const db = await getDatabase();
    const [decks, offlineSlots] = await Promise.all([
      listPublicDecks(db),
      listOfflinePublicDeckSlots(db),
    ]);
    const offlineFallbackDecks = offlineSlots.flatMap((slot) => slot.deck ? [slot.deck] : []);
    const offlineFallbackRevision = offlineSlots.reduce((latest, slot) => Math.max(latest, slot.updatedAt), 0);
    return Response.json({
      decks,
      offlineFallbackDecks,
      offlineFallbackRevision,
      correlationId,
    }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Public decks are unavailable.", {
      route: "/api/public-decks",
      method: "GET",
    });
  }
}
''')

# 5) Administrator API exposes and mutates the three offline slots.
replace_exact(
    'app/api/admin/route.ts',
    '''  addAiDeck,
  applyDatabaseCardOverrides,
  deleteAiDeck,
  deletePublicDeck,
  getAdministratorAiVisibility,
  listAiDecks,
  listManagedPublicDecks,
  resetCardOverride,
  saveCardOverride,
  setAdministratorAiVisibility,
  setAiDeckEnabled,
  updateAiDeck,
  updatePublicDeck,''',
    '''  addAiDeck,
  applyDatabaseCardOverrides,
  clearOfflinePublicDeckSlot,
  deleteAiDeck,
  deletePublicDeck,
  getAdministratorAiVisibility,
  listAiDecks,
  listManagedPublicDecks,
  listOfflinePublicDeckSlots,
  resetCardOverride,
  resetOfflinePublicDeckSlot,
  saveCardOverride,
  setAdministratorAiVisibility,
  setAiDeckEnabled,
  updateAiDeck,
  updateOfflinePublicDeckSlot,
  updatePublicDeck,'''
)
replace_exact(
    'app/api/admin/route.ts',
    '''    if (section === "public-decks") {
      const decks = await listManagedPublicDecks(db);
      return json({ decks: id ? decks.filter((item) => item.deck.id === id) : decks, correlationId });
    }
    if (section === "ranked")''',
    '''    if (section === "public-decks") {
      const decks = await listManagedPublicDecks(db);
      return json({ decks: id ? decks.filter((item) => item.deck.id === id) : decks, correlationId });
    }
    if (section === "offline-decks") {
      const slots = await listOfflinePublicDeckSlots(db);
      return json({ slots: id ? slots.filter((slot) => slot.id === id) : slots, correlationId });
    }
    if (section === "ranked")'''
)
replace_exact(
    'app/api/admin/route.ts',
    '''    if (action === "public-delete") {
      await deletePublicDeck(db, String(body.id ?? ""), administrator.id);
      return json({ ok: true, correlationId });
    }
    if (action === "ranked-save-draft")''',
    '''    if (action === "public-delete") {
      await deletePublicDeck(db, String(body.id ?? ""), administrator.id);
      return json({ ok: true, correlationId });
    }
    if (action === "offline-update") {
      return json({ slot: await updateOfflinePublicDeckSlot(db, String(body.id ?? ""), body.deck, administrator.id), correlationId });
    }
    if (action === "offline-clear") {
      return json({ slot: await clearOfflinePublicDeckSlot(db, String(body.id ?? ""), administrator.id), correlationId });
    }
    if (action === "offline-reset") {
      return json({ slot: await resetOfflinePublicDeckSlot(db, String(body.id ?? "")), correlationId });
    }
    if (action === "ranked-save-draft")'''
)

# 6) App-level synchronization ensures every online client refreshes its offline snapshot.
create('components/application/PublicDeckFallbackSync.tsx', '''"use client";

import { useEffect } from "react";
import type { DeckRecord } from "../../lib/data";
import {
  OFFLINE_PUBLIC_DECKS_UPDATED_EVENT,
  writeOfflinePublicDeckCache,
} from "../../lib/public-deck-cache";

type PublicDeckResponse = {
  offlineFallbackDecks?: DeckRecord[];
  offlineFallbackRevision?: number;
};

export function PublicDeckFallbackSync() {
  useEffect(() => {
    let active = true;
    const sync = async () => {
      if (!navigator.onLine) return;
      try {
        const response = await fetch("/api/public-decks", { cache: "no-store" });
        const result = await response.json() as PublicDeckResponse;
        if (!response.ok || !Array.isArray(result.offlineFallbackDecks) || !active) return;
        writeOfflinePublicDeckCache(
          localStorage,
          result.offlineFallbackDecks,
          Number(result.offlineFallbackRevision ?? Date.now()),
        );
      } catch {
        // Offline fallback synchronization is best-effort and never blocks application startup.
      }
    };
    const onOnline = () => { void sync(); };
    const onUpdated = () => { void sync(); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void sync();
    };
    void sync();
    addEventListener("online", onOnline);
    addEventListener(OFFLINE_PUBLIC_DECKS_UPDATED_EVENT, onUpdated);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      removeEventListener("online", onOnline);
      removeEventListener(OFFLINE_PUBLIC_DECKS_UPDATED_EVENT, onUpdated);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return null;
}
''')
replace_exact(
    'app/layout.tsx',
    '''import { GuestExperienceController } from "../components/application/GuestExperienceController";
import { AssetFreshness } from "../components/AssetFreshness";''',
    '''import { GuestExperienceController } from "../components/application/GuestExperienceController";
import { PublicDeckFallbackSync } from "../components/application/PublicDeckFallbackSync";
import { AssetFreshness } from "../components/AssetFreshness";'''
)
replace_exact(
    'app/layout.tsx',
    '''        <WebVitalsReporter />
        <AppProvider>''',
    '''        <WebVitalsReporter />
        <PublicDeckFallbackSync />
        <AppProvider>'''
)

# 7) Public Deck UI uses server state online and cached/bundled slots only when actually offline.
replace_exact(
    'components/routes/DeckRoutes.tsx',
    '''  CORES,
  PUBLIC_DECKS,
  RULE_ENTRIES,''',
    '''  BUNDLED_OFFLINE_PUBLIC_DECKS,
  CORES,
  RULE_ENTRIES,'''
)
replace_exact(
    'components/routes/DeckRoutes.tsx',
    '''import { deckSetName } from "../../lib/deck-set";
import {
  PROFILE_SHOWCASE_LIMIT,''',
    '''import { deckSetName } from "../../lib/deck-set";
import { readOfflinePublicDeckCache, writeOfflinePublicDeckCache } from "../../lib/public-deck-cache";
import {
  PROFILE_SHOWCASE_LIMIT,'''
)
replace_exact(
    'components/routes/DeckRoutes.tsx',
    '''const publicDecksFor = (decks: DeckRecord[], playerName = "You") => [
  ...decks
    .filter((deck) => deck.visibility === "Public" && validateDeck(deck).isLegal)
    .map((deck) => ({
      ...deck,
      creator: deck.creator ?? playerName,
      publishedAt: deck.publishedAt ?? deck.updatedAt,
    })),
  ...PUBLIC_DECKS,
].filter((deck, index, all) => all.findIndex((candidate) => candidate.id === deck.id) === index);

function usePublicDeckCatalogue(decks: DeckRecord[], playerName: string) {
  const fallback = useMemo(() => publicDecksFor(decks, playerName), [decks, playerName]);
  const [remote, setRemote] = useState<DeckRecord[] | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/public-decks", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok || !Array.isArray(result.decks)) throw new Error(result.error ?? "Public decks are unavailable.");
        if (active) setRemote(result.decks);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [fallback]);
  if (!remote) return fallback;
  return [...remote, ...fallback].filter(
    (deck, index, all) =>
      all.findIndex((candidate) => candidate.id === deck.id) === index,
  );
}''',
    '''type PublicDeckCatalogueState = {
  status: "loading" | "online" | "offline" | "error";
  decks: DeckRecord[];
  error?: string;
};

function usePublicDeckCatalogue(online: boolean): PublicDeckCatalogueState {
  const [state, setState] = useState<PublicDeckCatalogueState>({ status: "loading", decks: [] });
  useEffect(() => {
    let active = true;
    if (!online) {
      const cached = readOfflinePublicDeckCache(localStorage);
      const decks = (cached ?? BUNDLED_OFFLINE_PUBLIC_DECKS).map(clone);
      setState({ status: "offline", decks });
      return () => { active = false; };
    }
    setState({ status: "loading", decks: [] });
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
        if (active) setState({ status: "online", decks: result.decks });
      })
      .catch((error) => {
        if (active) setState({
          status: "error",
          decks: [],
          error: error instanceof Error ? error.message : "Public decks are unavailable.",
        });
      });
    return () => { active = false; };
  }, [online]);
  return state;
}'''
)
replace_exact(
    'components/routes/DeckRoutes.tsx',
    '''export function PublicDeckLibraryScreen() {
  const { ready, decks, profile, setDecks, notify } = useApp();
  const router = useRouter();
  const online = useOnlineStatus();
  const [query, setQuery] = useState("");
  const [faction, setFaction] = useState("All");
  const [legality, setLegality] = useState("All");
  const [sort, setSort] = useState("Updated");
  const [view, setView] = useState<LibraryView>("grid");
  const allPublic = usePublicDeckCatalogue(decks, profile.name);
  if (!ready) return <DeckLibrarySkeleton />;

  const reports = new Map<string, DeckValidationResult>(
    allPublic.map((deck): [string, DeckValidationResult] => [deck.id, validateDeck(deck)]),
  );''',
    '''export function PublicDeckLibraryScreen() {
  const { ready, decks, setDecks, notify } = useApp();
  const router = useRouter();
  const online = useOnlineStatus();
  const [query, setQuery] = useState("");
  const [faction, setFaction] = useState("All");
  const [legality, setLegality] = useState("All");
  const [sort, setSort] = useState("Updated");
  const [view, setView] = useState<LibraryView>("grid");
  const catalogue = usePublicDeckCatalogue(online);
  const allPublic = catalogue.decks;
  if (!ready || catalogue.status === "loading") return <DeckLibrarySkeleton />;
  if (catalogue.status === "error") {
    return (
      <div className={styles.route}>
        <DeckAreaHeader section="public" count={0} legalCount={0} />
        <DeckState tone="error" role="alert" title="Public decks are unavailable" copy={catalogue.error ?? "Reconnect and try again."} />
      </div>
    );
  }

  const reports = new Map<string, DeckValidationResult>(
    allPublic.map((deck): [string, DeckValidationResult] => [deck.id, validateDeck(deck)]),
  );'''
)
replace_exact(
    'components/routes/DeckRoutes.tsx',
    '''      {!online && (
        <DeckState
          tone="offline"
          role="status"
          title="Showing cached public decks"
          copy="Copying and newly published decks may be unavailable until the connection returns."
        />
      )}''',
    '''      {catalogue.status === "offline" && (
        <DeckState
          tone="offline"
          role="status"
          title="Showing offline fallback decks"
          copy="These are the latest administrator-managed fallback decks cached on this device. They are not part of the online Public Deck library."
        />
      )}''',
    count=1,
)
replace_exact(
    'components/routes/DeckRoutes.tsx',
    '''export function PublicDeckDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const { decks, profile, setDecks, setBuilderDeck, notify, authUser } = useApp();
  const publicDecks = usePublicDeckCatalogue(decks, profile.name);
  const deck = publicDecks.find((item) => item.id === id);
  if (!deck) return <MissingDeck id={id} publicDeck />;''',
    '''export function PublicDeckDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const online = useOnlineStatus();
  const { decks, setDecks, setBuilderDeck, notify, authUser } = useApp();
  const catalogue = usePublicDeckCatalogue(online);
  if (catalogue.status === "loading") {
    return <div className={styles.route}><DeckState tone="loading" role="status" title="Loading public deck" copy="Retrieving the current public catalogue…" /></div>;
  }
  if (catalogue.status === "error") {
    return <div className={styles.route}><DeckState tone="error" role="alert" title="Public deck unavailable" copy={catalogue.error ?? "Reconnect and try again."} /></div>;
  }
  const deck = catalogue.decks.find((item) => item.id === id);
  if (!deck) return <MissingDeck id={id} publicDeck />;'''
)
replace_exact(
    'components/routes/DeckRoutes.tsx',
    '''          {authUser?.roles?.includes("administrator") && (''',
    '''          {catalogue.status === "online" && authUser?.roles?.includes("administrator") && (''',
    count=1,
)

# Administrator Deck Builder can edit an offline slot without changing slot identity.
replace_exact(
    'components/routes/DeckRoutes.tsx',
    '''  const adminPublicId = id.startsWith("admin-public:") ? id.slice("admin-public:".length) : null;
  const adminAiId = id.startsWith("admin-ai:") ? id.slice("admin-ai:".length) : null;
  const adminResourceId = adminPublicId ?? adminAiId;''',
    '''  const adminPublicId = id.startsWith("admin-public:") ? id.slice("admin-public:".length) : null;
  const adminAiId = id.startsWith("admin-ai:") ? id.slice("admin-ai:".length) : null;
  const adminOfflineId = id.startsWith("admin-offline:") ? id.slice("admin-offline:".length) : null;
  const adminResourceId = adminPublicId ?? adminAiId ?? adminOfflineId;'''
)
replace_exact(
    'components/routes/DeckRoutes.tsx',
    '''    const section = adminPublicId ? "public-decks" : "ai-decks";
    fetch(`/api/admin?section=${section}&id=${encodeURIComponent(adminResourceId)}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Administrator deck could not be loaded.");
        const loaded = result.decks?.[0]?.deck;''',
    '''    const section = adminPublicId ? "public-decks" : adminOfflineId ? "offline-decks" : "ai-decks";
    fetch(`/api/admin?section=${section}&id=${encodeURIComponent(adminResourceId)}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Administrator deck could not be loaded.");
        const loaded = adminOfflineId ? result.slots?.[0]?.deck : result.decks?.[0]?.deck;'''
)
replace_exact(
    'components/routes/DeckRoutes.tsx',
    '''          setSaveVisibility(adminPublicId ? "Public" : "Private");''',
    '''          setSaveVisibility(adminPublicId || adminOfflineId ? "Public" : "Private");'''
)
replace_exact(
    'components/routes/DeckRoutes.tsx',
    '''  }, [adminPublicId, adminResourceId, administratorEdit, notify, setBuilderDeck, source]);''',
    '''  }, [adminOfflineId, adminPublicId, adminResourceId, administratorEdit, notify, setBuilderDeck, source]);'''
)
replace_exact(
    'components/routes/DeckRoutes.tsx',
    '''    setSaveVisibility(adminPublicId ? "Public" : adminAiId ? "Private" : report.isLegal ? deck.visibility : deck.visibility === "Public" ? "Draft" : deck.visibility);''',
    '''    setSaveVisibility(adminPublicId || adminOfflineId ? "Public" : adminAiId ? "Private" : report.isLegal ? deck.visibility : deck.visibility === "Public" ? "Draft" : deck.visibility);'''
)
replace_exact(
    'components/routes/DeckRoutes.tsx',
    '''    if ((saveVisibility === "Public" || adminAiId) && !latest.isLegal) {
      notify(`${adminAiId ? "AI" : "Public"} decks must be valid: ${latest.issues[0].message}`);''',
    '''    if ((saveVisibility === "Public" || adminAiId || adminOfflineId) && !latest.isLegal) {
      notify(`${adminAiId ? "AI" : adminOfflineId ? "Offline fallback" : "Public"} decks must be valid: ${latest.issues[0].message}`);'''
)
replace_exact(
    'components/routes/DeckRoutes.tsx',
    '''      id: administratorEdit ? adminResourceId! : id === "new" ? deck.id : id,
      name,
      description: saveDescription.trim() || undefined,
      visibility: adminPublicId ? "Public" as const : adminAiId ? "Private" as const : saveVisibility,''',
    '''      id: adminOfflineId ? `offline-${adminOfflineId}` : administratorEdit ? adminResourceId! : id === "new" ? deck.id : id,
      name,
      description: saveDescription.trim() || undefined,
      visibility: adminPublicId || adminOfflineId ? "Public" as const : adminAiId ? "Private" as const : saveVisibility,'''
)
replace_exact(
    'components/routes/DeckRoutes.tsx',
    '''            action: adminPublicId ? "public-update" : "ai-update",
            id: adminResourceId,
            deck: next,''',
    '''            action: adminPublicId ? "public-update" : adminOfflineId ? "offline-update" : "ai-update",
            id: adminResourceId,
            deck: next,'''
)
replace_exact(
    'components/routes/DeckRoutes.tsx',
    '''        notify(`${adminPublicId ? "Public" : "AI"} deck updated.`);
        router.push(returnTo ?? "/admin?tab=ai");''',
    '''        if (adminOfflineId) notifyOfflinePublicDecksUpdated();
        notify(`${adminPublicId ? "Public" : adminOfflineId ? "Offline fallback" : "AI"} deck updated.`);
        router.push(returnTo ?? (adminOfflineId ? "/admin?tab=offline" : "/admin?tab=ai"));'''
)
replace_exact(
    'components/routes/DeckRoutes.tsx',
    '''import { readOfflinePublicDeckCache, writeOfflinePublicDeckCache } from "../../lib/public-deck-cache";''',
    '''import {
  notifyOfflinePublicDecksUpdated,
  readOfflinePublicDeckCache,
  writeOfflinePublicDeckCache,
} from "../../lib/public-deck-cache";'''
)

# 8) Administrator UI for replacing/editing/clearing/resetting the three slots.
replace_exact(
    'components/routes/AdminScreen.tsx',
    '''import { validateDeck, type DeckRecord } from "../../lib/data";
import type { GameCard } from "../../lib/game";''',
    '''import { validateDeck, type DeckRecord } from "../../lib/data";
import type { GameCard } from "../../lib/game";
import { notifyOfflinePublicDecksUpdated } from "../../lib/public-deck-cache";'''
)
replace_exact(
    'components/routes/AdminScreen.tsx',
    '''type AdminTab = "ai" | "cards" | "ranked" | "users";
type AiDeckItem = { id: string; deck: DeckRecord; enabled: boolean; updatedAt: number };''',
    '''type AdminTab = "ai" | "offline" | "cards" | "ranked" | "users";
type AiDeckItem = { id: string; deck: DeckRecord; enabled: boolean; updatedAt: number };
type OfflineDeckSlot = { id: string; deck: DeckRecord | null; source: "bundled" | "managed"; updatedAt: number };'''
)
replace_exact(
    'components/routes/AdminScreen.tsx',
    '''  const tab: AdminTab = requested === "cards" || requested === "ranked" || requested === "users" ? requested : "ai";''',
    '''  const tab: AdminTab = requested === "offline" || requested === "cards" || requested === "ranked" || requested === "users" ? requested : "ai";'''
)
replace_exact(
    'components/routes/AdminScreen.tsx',
    '''        <Link className={tab === "ai" ? "active" : ""} aria-current={tab === "ai" ? "page" : undefined} href="/admin?tab=ai">AI Management</Link>
        <Link className={tab === "cards" ? "active" : ""}''',
    '''        <Link className={tab === "ai" ? "active" : ""} aria-current={tab === "ai" ? "page" : undefined} href="/admin?tab=ai">AI Management</Link>
        <Link className={tab === "offline" ? "active" : ""} aria-current={tab === "offline" ? "page" : undefined} href="/admin?tab=offline">Offline Decks</Link>
        <Link className={tab === "cards" ? "active" : ""}'''
)
replace_exact(
    'components/routes/AdminScreen.tsx',
    '''      {tab === "ai" && <AiManagement />}
      {tab === "cards" && <CardManagement />}''',
    '''      {tab === "ai" && <AiManagement />}
      {tab === "offline" && <OfflineDeckManagement />}
      {tab === "cards" && <CardManagement />}'''
)
replace_exact(
    'components/routes/AdminScreen.tsx',
    '''function CardManagement() {''',
    '''function OfflineDeckManagement() {
  const router = useRouter();
  const { decks: localDecks, setBuilderDeck, notify } = useApp();
  const [refresh, setRefresh] = useState(0);
  const [selection, setSelection] = useState<Record<string, string>>({});
  const state = useAdminData<{ slots: OfflineDeckSlot[] }>("offline-decks", refresh);

  const mutate = async (body: Record<string, unknown>, message: string) => {
    try {
      await adminRequest(body);
      notify(message);
      notifyOfflinePublicDecksUpdated();
      setRefresh((value) => value + 1);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Offline fallback deck action failed.");
    }
  };

  const replaceSlot = (slot: OfflineDeckSlot) => {
    const deckId = selection[slot.id] ?? "";
    const deck = localDecks.find((candidate: DeckRecord) => candidate.id === deckId);
    if (!deck) return;
    void mutate({ action: "offline-update", id: slot.id, deck }, `${deck.name} assigned to ${slot.id}.`);
  };

  const editSlot = (slot: OfflineDeckSlot) => {
    if (!slot.deck) return;
    setBuilderDeck({
      ...slot.deck,
      cardIds: [...slot.deck.cardIds],
      coreIds: [...slot.deck.coreIds],
      bakuganIds: [...slot.deck.bakuganIds],
      factions: [...slot.deck.factions],
      tags: [...(slot.deck.tags ?? [])],
    });
    router.push(`/builder/${encodeURIComponent(`admin-offline:${slot.id}`)}?returnTo=${encodeURIComponent("/admin?tab=offline")}`);
  };

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}>
        <div>
          <span>OFFLINE PUBLIC DECKS</span>
          <h2>Fallback Deck Slots</h2>
          <p>These three decks are cached by online clients for offline use only. They never appear in the normal online Public Deck library.</p>
        </div>
        <StatusChip tone="info">3 SLOTS</StatusChip>
      </div>
      <AdminState loading={state.loading} error={state.error} label="offline fallback decks" />
      <div className={styles.deckRows}>
        {state.data?.slots.map((slot, index) => {
          const report = slot.deck ? validateDeck(slot.deck) : null;
          const selectedDeck = localDecks.find((deck: DeckRecord) => deck.id === (selection[slot.id] ?? ""));
          return (
            <Surface as="article" className={styles.deckRow} key={slot.id}>
              <StatusChip tone={slot.deck ? "success" : "warning"}>SLOT {index + 1}</StatusChip>
              <div>
                <h3>{slot.deck?.name ?? "Empty slot"}</h3>
                <p>{slot.source === "bundled" ? "Bundled first-run default" : slot.deck ? "Administrator-managed fallback" : "Administrator-cleared slot"}</p>
              </div>
              <StatusChip tone={report?.isLegal ? "success" : slot.deck ? "danger" : "neutral"}>
                {report ? (report.isLegal ? "Legal" : `${report.issues.length} issues`) : "Empty"}
              </StatusChip>
              <div className={styles.addDeck}>
                <Field label="Replace from My Decks">
                  <select value={selection[slot.id] ?? ""} onChange={(event) => setSelection((current) => ({ ...current, [slot.id]: event.target.value }))}>
                    <option value="">Choose a saved deck…</option>
                    {localDecks.map((deck: DeckRecord) => {
                      const legal = validateDeck(deck).isLegal;
                      return <option disabled={!legal} value={deck.id} key={deck.id}>{deck.name}{legal ? "" : " (invalid)"}</option>;
                    })}
                  </select>
                </Field>
                <button disabled={!selectedDeck || !validateDeck(selectedDeck).isLegal} onClick={() => replaceSlot(slot)}>Replace</button>
              </div>
              <div className={styles.rowActions}>
                <button disabled={!slot.deck} onClick={() => editSlot(slot)}>Open in Deck Editor</button>
                <button className={styles.danger} disabled={!slot.deck} onClick={() => {
                  if (confirm(`Clear offline fallback slot ${index + 1}?`)) {
                    void mutate({ action: "offline-clear", id: slot.id }, `Offline fallback slot ${index + 1} cleared.`);
                  }
                }}>Clear Slot</button>
                <button disabled={slot.source === "bundled"} onClick={() => {
                  if (confirm(`Restore bundled default for offline fallback slot ${index + 1}?`)) {
                    void mutate({ action: "offline-reset", id: slot.id }, `Offline fallback slot ${index + 1} restored to its bundled default.`);
                  }
                }}>Restore Default</button>
              </div>
            </Surface>
          );
        })}
      </div>
    </section>
  );
}

function CardManagement() {'''
)

# 9) Regression coverage locks the separation and cache semantics in place.
replace_exact(
    'tests/administration.test.ts',
    '''import { requireTrainingAiDeckSelection } from "../lib/training-ai-deck-selection";''',
    '''import { requireTrainingAiDeckSelection } from "../lib/training-ai-deck-selection";
import { readOfflinePublicDeckCache, writeOfflinePublicDeckCache } from "../lib/public-deck-cache";'''
)
replace_exact(
    'tests/administration.test.ts',
    '''  assert.match(server, /UPDATE user_data_entities SET revision = revision \\+ 1/);
  assert.match(decks, /return \\[\\.\\.\\.remote, \\.\\.\\.fallback\\]/);
  assert.match(decks, /\\}, \\[fallback\\]\\);/);
  assert.match(builderPage, /decodedId\\.startsWith\\(\\"admin-\\"\\)/);
});''',
    '''  assert.match(server, /UPDATE user_data_entities SET revision = revision \\+ 1/);
  assert.doesNotMatch(decks, /return \\[\\.\\.\\.remote, \\.\\.\\.fallback\\]/);
  assert.match(decks, /status: "online", decks: result\\.decks/);
  assert.match(decks, /status: "offline"/);
  assert.match(decks, /BUNDLED_OFFLINE_PUBLIC_DECKS/);
  assert.match(builderPage, /decodedId\\.startsWith\\(\\"admin-\\"\\)/);
});

test("offline public deck slots are administrator managed and excluded from the online catalogue", async () => {
  const [server, endpoint, adminApi, screen, data, sync] = await Promise.all([
    read("lib/administration-server.ts"),
    read("app/api/public-decks/route.ts"),
    read("app/api/admin/route.ts"),
    read("components/routes/AdminScreen.tsx"),
    read("lib/data.ts"),
    read("components/application/PublicDeckFallbackSync.tsx"),
  ]);
  assert.match(data, /BUNDLED_OFFLINE_PUBLIC_DECKS/);
  assert.match(data, /OFFLINE_PUBLIC_DECK_SLOT_IDS/);
  assert.doesNotMatch(server, /const managed: ManagedDeck\\[\\] = PUBLIC_DECKS/);
  assert.match(server, /const managed: ManagedDeck\\[\\] = \\[\\]/);
  assert.match(server, /OFFLINE_PUBLIC_DECK_RESOURCE_TYPE = "offline-public-deck"/);
  assert.match(server, /listOfflinePublicDeckSlots/);
  assert.match(server, /updateOfflinePublicDeckSlot/);
  assert.match(server, /clearOfflinePublicDeckSlot/);
  assert.match(endpoint, /offlineFallbackDecks/);
  assert.match(endpoint, /offlineFallbackRevision/);
  assert.match(adminApi, /section === "offline-decks"/);
  assert.match(adminApi, /action === "offline-update"/);
  assert.match(adminApi, /action === "offline-clear"/);
  assert.match(adminApi, /action === "offline-reset"/);
  assert.match(screen, /Fallback Deck Slots/);
  assert.match(screen, /admin-offline:/);
  assert.match(sync, /OFFLINE_PUBLIC_DECKS_UPDATED_EVENT/);
});

test("offline public deck cache preserves an intentionally empty managed snapshot", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  assert.equal(readOfflinePublicDeckCache(storage), null);
  writeOfflinePublicDeckCache(storage, [], 17);
  assert.deepEqual(readOfflinePublicDeckCache(storage), []);
});'''
)
replace_exact(
    'tests/deck-experience.test.ts',
    '''  assert.match(route, /\\(saveVisibility === "Public" \\|\\| adminAiId\\) && !latest\\.isLegal/);''',
    '''  assert.match(route, /\\(saveVisibility === "Public" \\|\\| adminAiId \\|\\| adminOfflineId\\) && !latest\\.isLegal/);'''
)

for path, needle in [
    ('components/routes/DeckRoutes.tsx', 'return [...remote, ...fallback]'),
    ('components/routes/DeckRoutes.tsx', 'usePublicDeckCatalogue(decks, profile.name)'),
    ('lib/administration-server.ts', 'PUBLIC_DECKS.map'),
]:
    ensure_absent(path, needle)

print('Offline public deck architecture patch applied successfully.')
