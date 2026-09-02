"use client";

import { OriginalImage } from "@/components/media/OriginalImage";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CARD_SET_INFO, cardSetCode } from "../../lib/content/catalogue";
import { cardArtSource } from "../../lib/content/card-art";
import {
  BAKUGAN,
  CARD_BY_ID,
  CARDS,
  BUNDLED_OFFLINE_PUBLIC_DECKS,
  CORES,
  RULE_ENTRIES,
  STARTER_DECKS,
  deckLeadCard,
  validateDeck,
  type DeckRecord,
} from "../../lib/data";
import type { DeckValidationResult } from "../../lib/deck-validation";
import type { GameCard } from "../../lib/game";
import type { CardInspectorTab } from "../../lib/compendium";
import {
  GLOSSARY_ENTRIES,
  PUBLISHED_RULINGS,
  REFERENCE_REVIEWED_AT,
} from "../../lib/reference";
import { rememberAccountIntent } from "../../lib/account-intent";
import { DECK_LIMIT, decodeDeckCode, deckTextList, encodeDeckCode, uniqueDeckName } from "../../lib/deck-transfer";
import { exportDeckImage } from "../../lib/deck-image-export";
import { deckEnergyCurve, deckExportFilename, groupedDeckCards } from "../../lib/deck-presentation";
import { deckSetName } from "../../lib/deck-set";
import {
  notifyOfflinePublicDecksUpdated,
  readOfflinePublicDeckCache,
  writeOfflinePublicDeckCache,
} from "../../lib/public-deck-cache";
import {
  PROFILE_SHOWCASE_LIMIT,
  toggleShowcaseId,
} from "../../lib/profile-customization";
import { useApp } from "../application/AppProvider";
import { copyText, downloadTextFile, formatTimestamp } from "../application/ui";
import { CardInspector } from "../cards/CardInspector";
import { ResponsiveCardImage } from "../cards/ResponsiveCardImage";
import {
  ActionButton,
  CardGrid,
  Field,
  RouteHero,
  StatusChip,
  Surface,
  Tabs,
} from "../design-system/primitives";
import { DeckCreatorIdentity } from "../profile/DeckCreatorIdentity";
import styles from "./DeckRoutes.module.css";

const FACTIONS = ["Aquos", "Aurelus", "Darkus", "Haos", "Pyrus", "Ventus"];

type LibraryView = "grid" | "list";
type BuilderView = "gallery" | "deck";
type BuilderCategory = "cards" | "characters" | "cores";
type BuilderSort = "name-asc" | "name-desc" | "id-asc" | "cost-asc" | "cost-desc" | "count-desc";
type BuilderMenu =
  | { surface: "gallery" | "deck"; panel: "filter" | "sort" }
  | { surface: "team" | "cores" | "mainDeck"; panel: "issues" }
  | { surface: "deck"; panel: "save" };
type BuilderInspection =
  | { kind: "card"; card: GameCard }
  | { kind: "core"; coreId: string };

type BuilderGalleryItem =
  | { kind: "card"; id: string; name: string; card: GameCard; count: number }
  | { kind: "character"; id: string; name: string; card: GameCard; count: number }
  | { kind: "core"; id: string; name: string; count: number };

const FACTION_SYMBOLS: Record<string, string> = {
  Aquos: "/assets/symbols/factions/aquos.png",
  Aurelus: "/assets/symbols/factions/aurelus.png",
  Darkus: "/assets/symbols/factions/darkus.png",
  Haos: "/assets/symbols/factions/haos.png",
  Pyrus: "/assets/symbols/factions/pyrus.png",
  Ventus: "/assets/symbols/factions/ventus.png",
};

const CORE_BACK_IMAGES: Record<string, string> = {
  Fist: "/assets/bakucores/backs/fist.png",
  "Flaming Fist": "/assets/bakucores/backs/flaming-fist.png",
  Shield: "/assets/bakucores/backs/shield.png",
  "Magic Shield": "/assets/bakucores/backs/magic-shield.png",
  Helix: "/assets/bakucores/backs/helix.png",
};

const referenceSlug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const BUILDER_RULE_REFERENCES = [
  ...RULE_ENTRIES.map((entry) => ({
    ...entry,
    slug: referenceSlug(entry.title),
    source: "Digital adaptation reference",
    sourceSection: entry.category,
    reviewedAt: REFERENCE_REVIEWED_AT,
  })),
  ...GLOSSARY_ENTRIES,
];

const builderItemCost = (item: BuilderGalleryItem) => {
  if (item.kind === "core" || typeof item.card.cost !== "number") return Number.MAX_SAFE_INTEGER;
  return item.card.cost;
};

const sortBuilderItems = (left: BuilderGalleryItem, right: BuilderGalleryItem, sort: BuilderSort) => {
  if (sort === "name-desc") return right.name.localeCompare(left.name);
  if (sort === "id-asc") return left.id.localeCompare(right.id, undefined, { numeric: true }) || left.name.localeCompare(right.name);
  if (sort === "cost-asc" || sort === "cost-desc") {
    const difference = builderItemCost(left) - builderItemCost(right);
    return (sort === "cost-desc" ? -difference : difference) || left.name.localeCompare(right.name);
  }
  if (sort === "count-desc") return right.count - left.count || left.name.localeCompare(right.name);
  return left.name.localeCompare(right.name);
};

const clone = (deck: DeckRecord): DeckRecord => ({
  ...deck,
  factions: [...deck.factions],
  bakuganIds: [...deck.bakuganIds],
  coreIds: [...deck.coreIds],
  cardIds: [...deck.cardIds],
  tags: [...(deck.tags ?? [])],
});

const blankDraft = (decks: DeckRecord[]): DeckRecord => ({
  ...clone(STARTER_DECKS[0]),
  id: globalThis.crypto?.randomUUID?.() ?? `deck-${Date.now().toString(36)}`,
  name: uniqueDeckName("Untitled Battle Deck", decks),
  factions: [],
  bakuganIds: [],
  coreIds: [],
  cardIds: [],
  leadCardId: undefined,
  updatedAt: new Date().toISOString(),
  visibility: "Draft",
  revision: 1,
});

type PublicDeckFavoriteMetadata = {
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
}

function useOnlineStatus() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    addEventListener("online", update);
    addEventListener("offline", update);
    return () => {
      removeEventListener("online", update);
      removeEventListener("offline", update);
    };
  }, []);
  return online;
}

function DeckAreaHeader({
  section,
  count,
  legalCount,
  action,
}: {
  section: "mine" | "public";
  count: number;
  legalCount: number;
  action?: ReactNode;
}) {
  return (
    <RouteHero
      className={styles.routeHero}
      eyebrow="DECK ARSENAL"
      title={section === "mine" ? "My Decks" : "Public Decks"}
      description={
        section === "mine"
          ? `${count} saved · ${legalCount} legal · ${count - legalCount} requiring attention`
          : `${count} community loadouts ready to inspect and copy.`
      }
      aside={(
        <div className={styles.heroUtilities}>
          {action}
          <Tabs label="Deck library sections">
            <Link aria-current={section === "mine" ? "page" : undefined} href="/decks">My Decks</Link>
            <Link aria-current={section === "public" ? "page" : undefined} href="/decks/public">Public Decks</Link>
          </Tabs>
        </div>
      )}
    />
  );
}

function DeckState({
  tone = "neutral",
  title,
  copy,
  action,
  role,
}: {
  tone?: "neutral" | "loading" | "error" | "offline";
  title: string;
  copy: string;
  action?: ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <Surface className={`${styles.state} ${styles[`state_${tone}`]}`} role={role}>
      <span className={styles.stateIcon} aria-hidden="true">
        {tone === "error" ? "!" : tone === "offline" ? "↯" : tone === "loading" ? "◌" : "◇"}
      </span>
      <div><strong>{title}</strong><p>{copy}</p></div>
      {action && <div className={styles.stateAction}>{action}</div>}
    </Surface>
  );
}

function DeckLibrarySkeleton() {
  return (
    <div className={styles.route} aria-busy="true" aria-label="Loading deck library">
      <div className={styles.heroSkeleton} />
      <div className={styles.toolbarSkeleton} />
      <CardGrid className={styles.deckGrid} minCardWidth="20rem">
        {Array.from({ length: 6 }, (_, index) => (
          <div className={styles.deckSkeleton} key={index}>
            <div /><span /><span /><span />
          </div>
        ))}
      </CardGrid>
    </div>
  );
}

function DeckToolbar({
  query,
  setQuery,
  faction,
  setFaction,
  legality,
  setLegality,
  sort,
  setSort,
  view,
  setView,
  count,
  sortOptions = ["Updated", "Name", "Set"],
  favoritesOnly,
  setFavoritesOnly,
  favoritesEnabled = true,
}: {
  query: string;
  setQuery: (value: string) => void;
  faction: string;
  setFaction: (value: string) => void;
  legality: string;
  setLegality: (value: string) => void;
  sort: string;
  setSort: (value: string) => void;
  view: LibraryView;
  setView: (value: LibraryView) => void;
  count: number;
  sortOptions?: string[];
  favoritesOnly?: boolean;
  setFavoritesOnly?: (value: boolean) => void;
  favoritesEnabled?: boolean;
}) {
  return (
    <Surface className={styles.toolbar} elevation="overlay">
      <Field className={styles.search} label="Search decks">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, faction, tag, or set…"
        />
      </Field>
      <Field label="Faction">
        <select value={faction} onChange={(event) => setFaction(event.target.value)}>
          <option>All</option>
          {FACTIONS.map((value) => <option key={value}>{value}</option>)}
        </select>
      </Field>
      <Field label="Legality">
        <select value={legality} onChange={(event) => setLegality(event.target.value)}>
          <option>All</option><option>Legal</option><option>Issues</option>
        </select>
      </Field>
      <Field label="Sort">
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
      <div className={styles.viewControls}>
        <span>{count} shown</span>
        <Tabs label="Deck layout">
          <button aria-pressed={view === "grid"} className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}>Grid</button>
          <button aria-pressed={view === "list"} className={view === "list" ? "active" : ""} onClick={() => setView("list")}>List</button>
        </Tabs>
      </div>
    </Surface>
  );
}

export function DeckLibraryScreen() {
  const router = useRouter();
  const online = useOnlineStatus();
  const {
    ready,
    decks,
    setDecks,
    deckQuery,
    setDeckQuery,
    selectedDeckId,
    setSelectedDeckId,
    setBuilderDeck,
    storageHealth,
    notify,
    profile,
    setProfile,
  } = useApp();
  const [faction, setFaction] = useState("All");
  const [legality, setLegality] = useState("All");
  const [sort, setSort] = useState("Updated");
  const [view, setView] = useState<LibraryView>("grid");
  const [importCode, setImportCode] = useState("");
  const [importError, setImportError] = useState("");

  const reports = useMemo(
    () => new Map<string, DeckValidationResult>(
      decks.map((deck: DeckRecord): [string, DeckValidationResult] => [deck.id, validateDeck(deck)]),
    ),
    [decks],
  );
  const legalCount = [...reports.values()].filter((report) => report.isLegal).length;
  const visible = useMemo(() => decks.filter((deck: DeckRecord) => {
    const text = `${deck.name} ${deck.factions.join(" ")} ${deck.tags?.join(" ") ?? ""} ${deckSetName(deck)}`.toLowerCase();
    const queryMatch = !deckQuery.trim() || text.includes(deckQuery.trim().toLowerCase());
    const factionMatch = faction === "All" || deck.factions.includes(faction);
    const legal = reports.get(deck.id)?.isLegal ?? false;
    return queryMatch && factionMatch && (legality === "All" || (legality === "Legal" ? legal : !legal));
  }).sort((a: DeckRecord, b: DeckRecord) => {
    if (sort === "Name") return a.name.localeCompare(b.name);
    if (sort === "Set") return deckSetName(a).localeCompare(deckSetName(b));
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  }), [deckQuery, decks, faction, legality, reports, sort]);

  if (!ready) return <DeckLibrarySkeleton />;

  const create = () => {
    if (decks.length >= DECK_LIMIT) return notify(`Deck limit reached (${DECK_LIMIT}).`);
    const draft = blankDraft(decks);
    setBuilderDeck(draft);
    router.push("/builder/new");
  };
  const importDeck = () => {
    try {
      if (decks.length >= DECK_LIMIT) throw new Error(`Deck limit reached (${DECK_LIMIT}).`);
      const imported = decodeDeckCode(
        importCode,
        () => globalThis.crypto?.randomUUID?.() ?? `deck-${Date.now().toString(36)}`,
      );
      imported.name = uniqueDeckName(imported.name, decks);
      imported.visibility = "Private";
      imported.leadCardId = imported.leadCardId && imported.cardIds.includes(imported.leadCardId)
        ? imported.leadCardId
        : imported.cardIds[0];
      const report = validateDeck(imported);
      if (!report.isLegal) throw new Error(report.issues[0].message);
      setDecks((items: DeckRecord[]) => [imported, ...items]);
      setSelectedDeckId(imported.id);
      setImportCode("");
      setImportError("");
      notify(`Imported ${imported.name}.`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Invalid deck code.");
    }
  };
  const duplicate = (deck: DeckRecord) => {
    if (decks.length >= DECK_LIMIT) return notify(`Deck limit reached (${DECK_LIMIT}).`);
    const copy = {
      ...clone(deck),
      id: globalThis.crypto.randomUUID(),
      name: uniqueDeckName(`${deck.name} Copy`, decks),
      visibility: "Private" as const,
      creator: undefined,
      publishedAt: undefined,
      updatedAt: new Date().toISOString(),
    };
    setDecks((items: DeckRecord[]) => [copy, ...items]);
    notify(`${copy.name} created.`);
  };
  const remove = (deck: DeckRecord) => {
    if (!globalThis.confirm(`Delete “${deck.name}”? This cannot be undone.`)) return;
    setDecks((items: DeckRecord[]) => items.filter((item) => item.id !== deck.id));
    if (selectedDeckId === deck.id) setSelectedDeckId("");
    notify(`${deck.name} deleted.`);
  };
  const toggleDeckShowcase = (deck: DeckRecord) => {
    if (deck.visibility !== "Public") {
      notify("Only Public decks can be showcased on your Profile.");
      return;
    }
    const result = toggleShowcaseId(profile.showcaseDeckIds, deck.id);
    if (result.reachedLimit) {
      notify(
        `Your Profile can showcase up to ${PROFILE_SHOWCASE_LIMIT} Public decks.`,
      );
      return;
    }
    setProfile({ ...profile, showcaseDeckIds: result.ids });
    notify(
      result.ids.includes(deck.id)
        ? `${deck.name} added to your Profile showcase.`
        : `${deck.name} removed from your Profile showcase.`,
    );
  };

  return (
    <div className={styles.route}>
      <DeckAreaHeader
        section="mine"
        count={decks.length}
        legalCount={legalCount}
        action={<ActionButton onClick={create}>+ Create Deck</ActionButton>}
      />
      {!online && (
        <DeckState
          tone="offline"
          role="status"
          title="Working offline"
          copy="You can inspect and edit device-local decks. Cloud sync and public deck updates will resume when reconnected."
        />
      )}
      {storageHealth.status === "error" && (
        <DeckState
          tone="error"
          role="alert"
          title="Deck storage needs attention"
          copy={storageHealth.message}
          action={<ActionButton tone="quiet" onClick={() => location.reload()}>Retry storage</ActionButton>}
        />
      )}
      <DeckToolbar
        query={deckQuery}
        setQuery={setDeckQuery}
        faction={faction}
        setFaction={setFaction}
        legality={legality}
        setLegality={setLegality}
        sort={sort}
        setSort={setSort}
        view={view}
        setView={setView}
        count={visible.length}
      />
      <details className={styles.importDrawer}>
        <summary>Import a deck code</summary>
        <div>
          <textarea
            aria-label="Deck import code"
            value={importCode}
            onChange={(event) => setImportCode(event.target.value)}
            placeholder="BBP1.…"
          />
          {importError && <p className={styles.errorMessage} role="alert">{importError}</p>}
          <ActionButton tone="secondary" disabled={!importCode.trim()} onClick={importDeck}>Validate & Import</ActionButton>
        </div>
      </details>
      {decks.length === 0 ? (
        <DeckState
          title="Build your first battle deck"
          copy="Choose three Character cards, their six BakuCores, and a legal 40-card Standard or 50-card Competitive Main Deck."
          action={<ActionButton onClick={create}>Create Deck</ActionButton>}
        />
      ) : visible.length === 0 ? (
        <DeckState
          title="No decks match these filters"
          copy="Change the search, faction, legality, or sort controls to return to your arsenal."
          action={<ActionButton tone="quiet" onClick={() => { setDeckQuery(""); setFaction("All"); setLegality("All"); }}>Clear filters</ActionButton>}
        />
      ) : (
        <CardGrid className={`${styles.deckGrid} ${styles[`deckGrid_${view}`]}`} minCardWidth="20rem">
          {visible.map((deck: DeckRecord) => (
            <DeckTile
              key={deck.id}
              deck={deck}
              report={reports.get(deck.id)!}
              selected={selectedDeckId === deck.id}
              showcased={
                deck.visibility === "Public" &&
                (profile.showcaseDeckIds ?? []).includes(deck.id)
              }
              view={view}
              onOpen={() => router.push(`/decks/${encodeURIComponent(deck.id)}`)}
              onSelect={() => {
                setSelectedDeckId(deck.id);
                notify(`${deck.name} selected for Play.`);
              }}
              onEdit={() => router.push(`/builder/${encodeURIComponent(deck.id)}`)}
              onDuplicate={() => duplicate(deck)}
              onDelete={() => remove(deck)}
              onToggleShowcase={() => toggleDeckShowcase(deck)}
            />
          ))}
        </CardGrid>
      )}
    </div>
  );
}

function CharacterFan({
  deck,
  compact = false,
  featured = false,
}: {
  deck: DeckRecord;
  compact?: boolean;
  featured?: boolean;
}) {
  const characters = deck.bakuganIds
    .map((id) => BAKUGAN.find((candidate) => candidate.id === id))
    .filter(Boolean);
  const featuredCard = featured ? deckLeadCard(deck) : undefined;
  const featuredPreviewCard = featuredCard && !characters.some(
    (character) => character?.character.catalogId === featuredCard.catalogId,
  ) ? featuredCard : undefined;
  return (
    <div
      className={`${styles.characterFan} ${featuredPreviewCard ? styles.characterFanFeatured : ""} ${compact ? styles.characterFanCompact : ""}`}
      data-featured-preview={featuredPreviewCard ? "true" : undefined}
    >
      {Array.from({ length: 3 }, (_, index) => {
        const character = characters[index];
        return character ? (
          <OriginalImage
            key={character.id}
            src={cardArtSource(character.character, "full")}
            loading="lazy"
            decoding="async"
            alt={character.name}
          />
        ) : (
          <div className={styles.characterPlaceholder} key={`empty-${index}`} aria-label="Empty Character slot">?</div>
        );
      })}
      {featuredPreviewCard && (
        <OriginalImage
          className={styles.featuredPreviewCard}
          src={cardArtSource(featuredPreviewCard, "full")}
          loading="lazy"
          decoding="async"
          alt={`Featured card: ${featuredPreviewCard.displayName}`}
        />
      )}
    </div>
  );
}

function DeckFactionSymbols({ factions }: { factions: string[] }) {
  const visibleFactions = factions.filter((faction) => Boolean(FACTION_SYMBOLS[faction]));
  if (!visibleFactions.length) return <span className={styles.factionSymbols}>No factions selected</span>;
  return (
    <span className={styles.factionSymbols} aria-label={`Factions: ${visibleFactions.join(", ")}`}>
      {visibleFactions.map((faction) => (
        <OriginalImage
          key={faction}
          src={FACTION_SYMBOLS[faction]}
          alt=""
          aria-hidden="true"
          title={faction}
        />
      ))}
    </span>
  );
}

function DeckFactionTags({ factions }: { factions: string[] }) {
  const visibleFactions = factions.filter((faction) => Boolean(FACTION_SYMBOLS[faction]));
  if (!visibleFactions.length) return <span className={styles.emptyFactionTag}>No factions</span>;
  return (
    <div className={styles.factionTags} aria-label={`Factions: ${visibleFactions.join(", ")}`}>
      {visibleFactions.map((faction) => (
        <span className={styles.factionTag} key={faction}>
          <OriginalImage src={FACTION_SYMBOLS[faction]} alt="" aria-hidden="true" />
          {faction}
        </span>
      ))}
    </div>
  );
}

function DeckTile({
  deck,
  report,
  selected,
  showcased,
  view,
  onOpen,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete,
  onToggleShowcase,
}: {
  deck: DeckRecord;
  report: DeckValidationResult;
  selected: boolean;
  showcased: boolean;
  view: LibraryView;
  onOpen: () => void;
  onSelect: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleShowcase: () => void;
}) {
  return (
    <Surface
      as="article"
      className={`${styles.deckCard} ${styles[`deckCard_${view}`]} ${selected ? styles.deckCardSelected : ""}`}
      data-selected-for-play={selected || undefined}
      elevation={selected ? "overlay" : "raised"}
    >
      <button
        className={styles.showcaseDeckToggle}
        type="button"
        aria-pressed={showcased}
        disabled={deck.visibility !== "Public"}
        title={
          deck.visibility === "Public"
            ? showcased
              ? "Remove from Profile showcase"
              : "Showcase on Profile"
            : "Only Public decks can be showcased"
        }
        onClick={onToggleShowcase}
      >
        <span aria-hidden="true">{showcased ? "★" : "☆"}</span>
        {showcased ? "Showcased" : "Showcase"}
      </button>
      {selected && <div className={styles.selectedBanner}><span /> Selected for Play</div>}
      <button className={styles.deckCardMain} onClick={onOpen} aria-label={`View ${deck.name}`}>
        <CharacterFan deck={deck} compact={view === "list"} featured />
        <div className={styles.deckCardCopy}>
          <div className={styles.deckTitleRow}>
            <h2 data-deck-name>{deck.name}</h2>
            <StatusChip>{deck.visibility}</StatusChip>
          </div>
          <div className={styles.chipRow}>
            <StatusChip tone="info">{deckSetName(deck).toUpperCase()}</StatusChip>
            <StatusChip tone={report.isLegal ? "success" : "danger"}>
              {report.isLegal ? "Legal" : `${report.issues.length} issues`}
            </StatusChip>
          </div>
          <DeckFactionSymbols factions={deck.factions} />
          <small>{deck.cardIds.length}/{deck.format === "competitive" ? 50 : 40} cards · {deck.bakuganIds.length}/3 Character · {deck.coreIds.length}/6 BakuCores</small>
          <small>Updated {formatTimestamp(deck.updatedAt)}</small>
        </div>
      </button>
      <div className={styles.deckCardActions}>
        <button onClick={onSelect} disabled={!report.isLegal || selected}>
          {selected ? "Selected" : report.isLegal ? "Select for Play" : "Fix to select"}
        </button>
        <button onClick={onEdit}>Edit</button>
        <details>
          <summary aria-label={`More actions for ${deck.name}`}>•••</summary>
          <div>
            <button onClick={onDuplicate}>Duplicate</button>
            <button onClick={() => downloadTextFile(`${deck.name}.txt`, deckTextList(deck))}>Export text list</button>
            <button onClick={() => void copyText(encodeDeckCode(deck))}>Copy deck code</button>
            <button className={styles.dangerText} onClick={onDelete}>Delete</button>
          </div>
        </details>
      </div>
    </Surface>
  );
}

export function PublicDeckLibraryScreen() {
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
  }, [authUser, catalogue.status]);
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
  );
  const visible = allPublic.filter((deck) => {
    const report = reports.get(deck.id)!;
    const matchesQuery = !query || `${deck.name} ${deck.creator} ${deck.description} ${deck.factions.join(" ")} ${deckSetName(deck)}`.toLowerCase().includes(query.toLowerCase());
    const matchesFaction = faction === "All" || deck.factions.includes(faction);
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
  });
  const toggleFavorite = async (deck: DeckRecord) => {
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
  const copyDeck = (deck: DeckRecord) => {
    if (decks.length >= DECK_LIMIT) return notify(`Deck limit reached (${DECK_LIMIT}).`);
    const validation = validateDeck(deck);
    if (!validation.isLegal) return notify(`This public deck cannot be copied: ${validation.issues[0].message}`);
    const copy = {
      ...clone(deck),
      id: globalThis.crypto.randomUUID(),
      name: uniqueDeckName(deck.name, decks),
      visibility: "Private" as const,
      creator: undefined,
      publishedAt: undefined,
      sourceDeckId: deck.id,
      sourceCreator: deck.creator ?? "Community Brawler",
      updatedAt: new Date().toISOString(),
      revision: 1,
    };
    setDecks((items: DeckRecord[]) => [copy, ...items]);
    notify(`${copy.name} copied to My Decks.`);
    router.push(`/decks/${encodeURIComponent(copy.id)}`);
  };

  return (
    <div className={styles.route}>
      <DeckAreaHeader
        section="public"
        count={allPublic.length}
        legalCount={[...reports.values()].filter((report) => report.isLegal).length}
      />
      {catalogue.status === "offline" && (
        <DeckState
          tone="offline"
          role="status"
          title="Showing offline fallback decks"
          copy="These are the latest administrator-managed fallback decks cached on this device. They are not part of the online Public Deck library."
        />
      )}
      <DeckToolbar
        query={query}
        setQuery={setQuery}
        faction={faction}
        setFaction={setFaction}
        legality={legality}
        setLegality={setLegality}
        sort={sort}
        setSort={setSort}
        view={view}
        setView={setView}
        count={visible.length}
        sortOptions={["Updated", "Name", "Set", "Most Favorited"]}
        favoritesOnly={favoritesOnly}
        setFavoritesOnly={setFavoritesOnly}
        favoritesEnabled={catalogue.status === "online" && Boolean(authUser)}
      />
      {visible.length ? (
        <CardGrid className={`${styles.deckGrid} ${styles[`deckGrid_${view}`]}`} minCardWidth="20rem">
          {visible.map((deck) => (
            <PublicDeckTile
              key={deck.id}
              deck={deck}
              report={reports.get(deck.id)!}
              view={view}
              favorite={catalogue.favorites[deck.id] ?? { favoriteCount: 0, viewerHasFavorited: false }}
              favoriteAvailable={catalogue.status === "online"}
              favoritePending={pendingFavoriteIds.has(deck.id)}
              onFavorite={() => void toggleFavorite(deck)}
              onOpen={() => router.push(`/decks/public/${encodeURIComponent(deck.id)}`)}
              onCopy={() => copyDeck(deck)}
            />
          ))}
        </CardGrid>
      ) : (
        <DeckState title="No public decks found" copy="Try a broader search or clear the current filters." />
      )}
    </div>
  );
}

function PublicDeckTile({
  deck,
  report,
  view,
  favorite,
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
}) {
  return (
    <Surface as="article" className={`${styles.deckCard} ${styles.publicDeckCard} ${styles[`deckCard_${view}`]}`}>
      <button className={styles.deckCardMain} onClick={onOpen} aria-label={`View ${deck.name}`}>
        <CharacterFan deck={deck} compact={view === "list"} featured />
        <div className={styles.deckCardCopy}>
          <div className={styles.deckTitleRow}><h2 data-deck-name>{deck.name}</h2></div>
          <p>by {deck.creator ?? "Community Brawler"}</p>
          <div className={styles.chipRow}>
            <StatusChip tone="info">{deckSetName(deck).toUpperCase()}</StatusChip>
            <StatusChip tone={report.isLegal ? "success" : "danger"}>{report.isLegal ? "Legal" : "Invalid"}</StatusChip>
          </div>
          <DeckFactionSymbols factions={deck.factions} />
          <small>Published {formatTimestamp(deck.publishedAt ?? deck.updatedAt)}</small>
        </div>
      </button>
      <div className={`${styles.deckCardActions} ${styles.publicDeckActions}`}>
        <button onClick={onOpen}>View Deck</button>
        <button onClick={onCopy} disabled={!report.isLegal} title="Copy to My Decks">Copy</button>
        {favoriteAvailable && (
          <button
            className={styles.favoriteButton}
            aria-label={`${favorite.viewerHasFavorited ? "Remove" : "Add"} ${deck.name} ${favorite.viewerHasFavorited ? "from" : "to"} Favorites. ${favorite.favoriteCount} ${favorite.favoriteCount === 1 ? "favorite" : "favorites"}.`}
            aria-pressed={favorite.viewerHasFavorited}
            disabled={favoritePending}
            title={`${favorite.viewerHasFavorited ? "Favorited" : "Favorite"} · ${favorite.favoriteCount}`}
            onClick={onFavorite}
          >
            <span aria-hidden="true">{favorite.viewerHasFavorited ? "★" : "☆"}</span>
            <span>{favorite.favoriteCount}</span>
          </button>
        )}
      </div>
    </Surface>
  );
}

export function PublicDeckDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const online = useOnlineStatus();
  const { decks, setDecks, setBuilderDeck, notify, authUser, promptAccount } = useApp();
  const [favoritePending, setFavoritePending] = useState(false);
  const catalogue = usePublicDeckCatalogue(online, authUser?.id);
  if (catalogue.status === "loading") {
    return <div className={styles.route}><DeckState tone="loading" role="status" title="Loading public deck" copy="Retrieving the current public catalogue…" /></div>;
  }
  if (catalogue.status === "error") {
    return <div className={styles.route}><DeckState tone="error" role="alert" title="Public deck unavailable" copy={catalogue.error ?? "Reconnect and try again."} /></div>;
  }
  const deck = catalogue.decks.find((item) => item.id === id);
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
  const copy = () => {
    if (decks.length >= DECK_LIMIT) return notify(`Deck limit reached (${DECK_LIMIT}).`);
    const report = validateDeck(deck);
    if (!report.isLegal) return notify(`This public deck cannot be copied: ${report.issues[0].message}`);
    const next = {
      ...clone(deck),
      id: globalThis.crypto.randomUUID(),
      name: uniqueDeckName(deck.name, decks),
      visibility: "Private" as const,
      creator: undefined,
      publishedAt: undefined,
      sourceDeckId: deck.id,
      sourceCreator: deck.creator ?? "Community Brawler",
      updatedAt: new Date().toISOString(),
      revision: 1,
    };
    setDecks((items: DeckRecord[]) => [next, ...items]);
    notify(`${next.name} copied to My Decks.`);
    router.push(`/decks/${encodeURIComponent(next.id)}`);
  };
  const editAsAdministrator = () => {
    setBuilderDeck(clone(deck));
    router.push(`/builder/${encodeURIComponent(`admin-public:${deck.id}`)}?returnTo=${encodeURIComponent(`/decks/public/${deck.id}`)}`);
  };
  const deleteAsAdministrator = async () => {
    if (!globalThis.confirm(`Delete public deck “${deck.name}”? This cannot be undone.`)) return;
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "public-delete", id: deck.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Public deck could not be deleted.");
      notify(`${deck.name} deleted.`);
      router.push("/decks/public");
      router.refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Public deck could not be deleted.");
    }
  };
  return (
    <DeckDetailPresentation
      deck={deck}
      publicView
      sharePanel={(
        <DeckSharePanel
          deck={deck}
          copyAvailable={validateDeck(deck).isLegal}
          onCopy={copy}
          notify={notify}
        />
      )}
      actions={(
        <>
          {catalogue.status === "online" && (
            <ActionButton
              aria-pressed={favorite.viewerHasFavorited}
              disabled={favoritePending}
              onClick={() => void toggleFavorite()}
            >
              {favorite.viewerHasFavorited ? "★ Favorited" : "☆ Favorite"} · {favorite.favoriteCount} {favorite.favoriteCount === 1 ? "Favorite" : "Favorites"}
            </ActionButton>
          )}
          {catalogue.status === "online" && authUser?.roles?.includes("administrator") && (
            <>
              <ActionButton tone="secondary" onClick={editAsAdministrator}>Edit as Administrator</ActionButton>
              <ActionButton tone="quiet" onClick={() => void deleteAsAdministrator()}>Delete Deck</ActionButton>
            </>
          )}
          <Link className={styles.textAction} href="/decks/public">Back to Public Decks</Link>
        </>
      )}
    />
  );
}

export function DeckDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const { decks, setBuilderDeck, setSelectedDeckId, notify } = useApp();
  const deck = decks.find((item: DeckRecord) => item.id === id);
  if (!deck) return <MissingDeck id={id} />;
  const report = validateDeck(deck);
  return (
    <DeckDetailPresentation
      deck={deck}
      actions={(
        <>
          <ActionButton onClick={() => {
            setBuilderDeck(clone(deck));
            router.push(`/builder/${encodeURIComponent(deck.id)}`);
          }}>Edit Deck</ActionButton>
          <ActionButton
            tone="secondary"
            disabled={!report.isLegal}
            onClick={() => {
              setSelectedDeckId(deck.id);
              notify(`${deck.name} selected for Play.`);
            }}
          >Select for Play</ActionButton>
          <ActionButton tone="quiet" onClick={() => void copyText(encodeDeckCode(deck)).then(() => notify("Deck code copied."))}>Copy Code</ActionButton>
        </>
      )}
    />
  );
}

function DeckDetailPresentation({
  deck,
  publicView = false,
  actions,
  sharePanel,
}: {
  deck: DeckRecord;
  publicView?: boolean;
  actions: ReactNode;
  sharePanel?: ReactNode;
}) {
  const report = validateDeck(deck);
  const bakugan = deck.bakuganIds.map((key) => BAKUGAN.find((item) => item.id === key)).filter(Boolean);
  const cards = groupedDeckCards(deck);
  const cores = deck.coreIds.map((key) => CORES.find((item) => item.id === key)).filter(Boolean);
  const typeCounts = cards.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.card.type] = (counts[entry.card.type] ?? 0) + entry.count;
    return counts;
  }, {});
  const cardSections = ["Action", "Hero", "Evo", "Flip"]
    .map((type) => ({ type, cards: cards.filter((entry) => entry.card.type === type) }))
    .filter((section) => section.cards.length);
  return (
    <div className={styles.route}>
      <RouteHero
        className={styles.detailHero}
        eyebrow={publicView ? "PUBLIC DECK" : "MY DECK"}
        title={deck.name}
        description={deck.description ?? `${deck.format ?? "standard"} format · ${deck.visibility} · updated ${formatTimestamp(deck.updatedAt)}`}
        actions={actions}
        aside={<CharacterFan deck={deck} />}
      />
      <div className={styles.detailMeta}>
        <StatusChip tone="info">{deckSetName(deck).toUpperCase()}</StatusChip>
        <StatusChip tone={report.isLegal ? "success" : "danger"}>{report.isLegal ? "Legal" : `${report.issues.length} issues`}</StatusChip>
        <DeckFactionTags factions={deck.factions} />
        {publicView && (
          <span>
            Created by{" "}
            <DeckCreatorIdentity
              userId={(deck as DeckRecord & { creatorUserId?: string }).creatorUserId}
              displayName={deck.creator ?? "Community Brawler"}
            />
          </span>
        )}
        {!publicView && deck.sourceDeckId && <span>Copied from {deck.sourceCreator ?? "a public deck"}</span>}
      </div>
      <section className={styles.detailLayout}>
        <main>
          <Surface className={styles.detailPanel}>
            <div className={styles.panelHeading}><div><span>Team configuration</span><h2>Character Cards</h2></div><StatusChip>{bakugan.length}/3</StatusChip></div>
            <div className={styles.detailTeam}>
              {bakugan.map((item) => (
                <article key={item!.id}>
                  <OriginalImage src={cardArtSource(item!.character, "full")} alt={item!.name} />
                  <strong>{item!.name}</strong>
                  <span className={styles.characterStats}>
                    <span><OriginalImage src={FACTION_SYMBOLS[item!.faction]} alt="" aria-hidden="true" />{item!.faction}</span>
                    <span>{item!.bPower}B</span>
                    <span>{item!.damage}D</span>
                  </span>
                </article>
              ))}
            </div>
            <div className={styles.subsectionHeading}><span>BakuCore lineup</span><strong>{cores.length}/6</strong></div>
            <div className={styles.coreStrip}>
              {cores.map((core, index) => (
                <div key={`${core!.id}-${index}`}><OriginalImage src={core!.art} alt={core!.name} /><strong>{core!.type}</strong><span>{core!.name}</span></div>
              ))}
            </div>
          </Surface>
          <Surface className={styles.detailPanel}>
            <div className={styles.panelHeading}><div><span>Construction</span><h2>Main Deck</h2></div><StatusChip>{deck.cardIds.length}/{deck.format === "competitive" ? 50 : 40}</StatusChip></div>
            <div className={styles.detailCardGroups}>
              {cardSections.map((section) => (
                <section key={section.type} className={styles.detailCardGroup}>
                  <div className={styles.subsectionHeading}>
                    <span>{section.type} cards</span>
                    <strong>{section.cards.reduce((total, entry) => total + entry.count, 0)}</strong>
                  </div>
                  <div className={styles.detailCardList}>
                    {section.cards.map(({ card, count }) => (
                      <article key={card.catalogId}>
                        <div className={styles.detailCardArt}>
                          <OriginalImage src={cardArtSource(card, "thumbnail")} alt={card.displayName} />
                          <span className={styles.copyCount} aria-label={`${count} copies`}>×{count}</span>
                        </div>
                        <strong>{card.displayName}</strong>
                        <span>{card.faction} · {card.cost} Energy</span>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </Surface>
        </main>
        <aside className={styles.detailAside}>
          {sharePanel}
          <ValidationPanel report={report} />
          <Surface className={styles.detailPanel}>
            <div className={styles.panelHeading}><h2>Breakdown</h2></div>
            <dl className={styles.breakdown}>
              {Object.entries(typeCounts).map(([cardType, count]) => <div key={cardType}><dt>{cardType}</dt><dd>{count}</dd></div>)}
              <div><dt>BakuCores</dt><dd>{deck.coreIds.length}</dd></div>
            </dl>
            <EnergyCurve deck={deck} />
          </Surface>
        </aside>
      </section>
    </div>
  );
}

function DeckSharePanel({
  deck,
  copyAvailable,
  onCopy,
  notify,
}: {
  deck: DeckRecord;
  copyAvailable: boolean;
  onCopy: () => void;
  notify: (message: string) => void;
}) {
  const [imagePending, setImagePending] = useState(false);
  const copyValue = async (value: string, success: string) => {
    try {
      await copyText(value);
      notify(success);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The value could not be copied.");
    }
  };
  const exportImage = async () => {
    if (imagePending) return;
    setImagePending(true);
    try {
      await exportDeckImage(deck);
      notify("Deck image exported.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The deck image could not be exported.");
    } finally {
      setImagePending(false);
    }
  };
  return (
    <Surface className={`${styles.detailPanel} ${styles.sharePanel}`}>
      <div className={styles.panelHeading}>
        <div><span>Sharing</span><h2>Share this deck</h2></div>
      </div>
      <ActionButton className={styles.sharePrimary} onClick={onCopy} disabled={!copyAvailable}>Copy to My Decks</ActionButton>
      <div className={styles.shareActionGrid}>
        <button type="button" onClick={() => void copyValue(window.location.href, "Deck link copied.")}><span aria-hidden="true">↗</span>Copy Link</button>
        <button type="button" onClick={() => void copyValue(encodeDeckCode(deck), "Deck code copied.")}><span aria-hidden="true">⌘</span>Copy Code</button>
      </div>
      <div className={styles.exportHeading}><span>Export</span></div>
      <div className={styles.shareActionGrid}>
        <button type="button" onClick={() => {
          downloadTextFile(deckExportFilename(deck.name, "txt"), deckTextList(deck));
          notify("Text list exported.");
        }}><span aria-hidden="true">≡</span>As a Text List</button>
        <button type="button" disabled={imagePending} onClick={() => void exportImage()}><span aria-hidden="true">▧</span>{imagePending ? "Creating Image…" : "As an Image"}</button>
      </div>
    </Surface>
  );
}

function EnergyCurve({ deck }: { deck: DeckRecord }) {
  const buckets = deckEnergyCurve(deck);
  const maximum = Math.max(1, ...buckets.map((bucket) => bucket.count));
  return (
    <section className={styles.energyCurve} aria-labelledby="energy-curve-title">
      <div className={styles.subsectionHeading}>
        <span id="energy-curve-title">Energy curve</span>
        <strong>{deck.cardIds.length} cards</strong>
      </div>
      <div className={styles.energyChart} role="img" aria-label={buckets.map((bucket) => `${bucket.count} cards cost ${bucket.label} Energy`).join(", ")}>
        {buckets.map((bucket) => (
          <div className={styles.energyBarColumn} key={bucket.label}>
            <strong>{bucket.count}</strong>
            <span className={styles.energyBarTrack} aria-hidden="true">
              <span style={{ height: `${Math.max(bucket.count ? 8 : 2, bucket.count / maximum * 100)}%` }} />
            </span>
            <span>{bucket.label}</span>
          </div>
        ))}
      </div>
      <div className={styles.energyAxisLabel}>Energy cost</div>
    </section>
  );
}

function ValidationPanel({ report, compact = false }: { report: DeckValidationResult; compact?: boolean }) {
  return (
    <Surface className={`${styles.validationPanel} ${report.isLegal ? styles.validationLegal : styles.validationInvalid} ${compact ? styles.validationCompact : ""}`}>
      <div className={styles.validationHeading}>
        <div><span>Deck legality</span><h2>{report.isLegal ? "Ready for battle" : "Requires attention"}</h2></div>
        <StatusChip tone={report.isLegal ? "success" : "danger"}>{report.isLegal ? "Legal" : `${report.issues.length} issues`}</StatusChip>
      </div>
      {report.isLegal ? (
        <p>Team, BakuCores, factions, copy limits, and all 40 Main Deck cards pass.</p>
      ) : (
        <ul>{report.issues.map((candidate) => <li key={candidate.code}><code>{candidate.code}</code>{candidate.message}</li>)}</ul>
      )}
    </Surface>
  );
}

export function DeckBuilderScreen({ id, returnTo: requestedReturn }: { id: string; returnTo?: string }) {
  const router = useRouter();
  const returnTo = requestedReturn?.startsWith("/") && !requestedReturn.startsWith("//")
    ? requestedReturn
    : null;
  const {
    decks,
    setDecks,
    builderDeck,
    setBuilderDeck,
    setSelectedDeckId,
    storageHealth,
    notify,
    promptAccount,
  } = useApp();
  const adminPublicId = id.startsWith("admin-public:") ? id.slice("admin-public:".length) : null;
  const adminAiId = id.startsWith("admin-ai:") ? id.slice("admin-ai:".length) : null;
  const adminOfflineId = id.startsWith("admin-offline:") ? id.slice("admin-offline:".length) : null;
  const adminResourceId = adminPublicId ?? adminAiId ?? adminOfflineId;
  const administratorEdit = Boolean(adminResourceId);
  const source = administratorEdit ? builderDeck : id === "new" ? builderDeck : decks.find((item: DeckRecord) => item.id === id);
  const [deck, setDeck] = useState<DeckRecord>(() => clone(source ?? blankDraft(decks)));
  const [remoteLoading, setRemoteLoading] = useState(administratorEdit && !source);
  const [builderView, setBuilderView] = useState<BuilderView>("gallery");
  const [galleryQuery, setGalleryQuery] = useState("");
  const [deckQuery, setDeckQuery] = useState("");
  const [galleryCategory, setGalleryCategory] = useState<BuilderCategory>("characters");
  const [gallerySort, setGallerySort] = useState<BuilderSort>("name-asc");
  const [deckSort, setDeckSort] = useState<BuilderSort>("name-asc");
  const [factionFilters, setFactionFilters] = useState<string[]>([...new Set(source?.factions ?? [])]);
  const [factionFilterAuto, setFactionFilterAuto] = useState(Boolean(source?.bakuganIds.length));
  const [galleryTypes, setGalleryTypes] = useState<string[]>([]);
  const [gallerySet, setGallerySet] = useState("All");
  const [galleryCost, setGalleryCost] = useState("All");
  const [deckFactionFilters, setDeckFactionFilters] = useState<string[]>([]);
  const [deckTypes, setDeckTypes] = useState<string[]>([]);
  const [deckSet, setDeckSet] = useState("All");
  const [deckCost, setDeckCost] = useState("All");
  const [activeMenu, setActiveMenu] = useState<BuilderMenu | null>(null);
  const [inspection, setInspection] = useState<BuilderInspection | null>(null);
  const [inspectorTab, setInspectorTab] = useState<CardInspectorTab>("overview");
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "error">("saved");
  const [saveName, setSaveName] = useState(deck.name);
  const [saveDescription, setSaveDescription] = useState(deck.description ?? "");
  const [saveVisibility, setSaveVisibility] = useState<DeckRecord["visibility"]>(deck.visibility);
  const [saveLeadCardId, setSaveLeadCardId] = useState(
    deck.leadCardId && deck.cardIds.includes(deck.leadCardId) ? deck.leadCardId : deck.cardIds[0] ?? "",
  );

  useEffect(() => {
    if (!administratorEdit || source || !adminResourceId) {
      setRemoteLoading(false);
      return;
    }
    let active = true;
    const section = adminPublicId ? "public-decks" : adminOfflineId ? "offline-decks" : "ai-decks";
    fetch(`/api/admin?section=${section}&id=${encodeURIComponent(adminResourceId)}`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Administrator deck could not be loaded.");
        const loaded = adminOfflineId ? result.slots?.[0]?.deck : result.decks?.[0]?.deck;
        if (!loaded) throw new Error("Administrator deck not found.");
        if (active) {
          const next = clone(loaded);
          setDeck(next);
          setSaveName(next.name);
          setSaveDescription(next.description ?? "");
          setSaveVisibility(adminPublicId || adminOfflineId ? "Public" : "Private");
          setSaveLeadCardId(next.leadCardId && next.cardIds.includes(next.leadCardId) ? next.leadCardId : next.cardIds[0] ?? "");
          setBuilderDeck(next);
          setRemoteLoading(false);
        }
      })
      .catch((error) => {
        if (active) {
          notify(error instanceof Error ? error.message : "Administrator deck could not be loaded.");
          setRemoteLoading(false);
        }
      });
    return () => { active = false; };
  }, [adminOfflineId, adminPublicId, adminResourceId, administratorEdit, notify, setBuilderDeck, source]);

  useEffect(() => {
    setBuilderDeck(deck);
    setSaveState(storageHealth.status === "error" ? "error" : "saved");
  }, [deck, setBuilderDeck, storageHealth.status]);

  useEffect(() => {
    if (!activeMenu && !inspection) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveMenu(null);
        setInspection(null);
      }
    };
    addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previous;
      removeEventListener("keydown", close);
    };
  }, [activeMenu, inspection]);

  const commit = (next: DeckRecord) => {
    setSaveState("dirty");
    setDeck({
      ...next,
      leadCardId: next.leadCardId && next.cardIds.includes(next.leadCardId) ? next.leadCardId : next.cardIds[0],
      factions: [...new Set(next.bakuganIds.map((key) => BAKUGAN.find((item) => item.id === key)?.faction).filter(Boolean))] as string[],
    });
  };
  const report = useMemo(() => validateDeck(deck), [deck]);
  const mainDeckMaximum = deck.format === "competitive" ? 50 : 40;
  const grouped = useMemo(() => [...new Set(deck.cardIds)].map((key) => ({
    card: CARD_BY_ID.get(key),
    count: deck.cardIds.filter((candidate) => candidate === key).length,
  })).filter((entry): entry is { card: NonNullable<ReturnType<typeof CARD_BY_ID.get>>; count: number } => Boolean(entry.card)), [deck.cardIds]);

  const galleryItems = useMemo(() => {
    const query = galleryQuery.trim().toLowerCase();
    const items: BuilderGalleryItem[] = [
      ...CARDS.filter((card) => card.type !== "Character").map((card) => ({
        kind: "card" as const,
        id: card.catalogId,
        name: card.displayName,
        card,
        count: deck.cardIds.filter((candidate) => candidate === card.catalogId).length,
      })),
      ...BAKUGAN.map((item) => ({
        kind: "character" as const,
        id: item.id,
        name: item.name,
        card: item.character,
        count: deck.bakuganIds.includes(item.id) ? 1 : 0,
      })),
      ...CORES.map((core) => ({
        kind: "core" as const,
        id: core.id,
        name: core.name,
        count: deck.coreIds.filter((candidate) => candidate === core.id).length,
      })),
    ];
    return items.filter((item) => {
      if (galleryCategory === "cards" && item.kind !== "card") return false;
      if (galleryCategory === "characters" && item.kind !== "character") return false;
      if (galleryCategory === "cores" && item.kind !== "core") return false;
      const core = item.kind === "core" ? CORES.find((candidate) => candidate.id === item.id) : null;
      const card = item.kind === "core" ? null : item.card;
      const searchable = item.kind === "core"
        ? `${item.name} ${core?.type ?? ""}`
        : `${item.name} ${card?.effect ?? ""} ${card?.factions.join(" ") ?? ""}`;
      if (query && !searchable.toLowerCase().includes(query)) return false;
      if (
        factionFilters.length
        && card
        && (item.kind === "card" || !factionFilterAuto)
        && !card.factions.some((faction) => factionFilters.includes(faction))
      ) return false;
      if (galleryTypes.length) {
        const candidateType = item.kind === "core" ? core?.type : card?.type;
        if (!candidateType || !galleryTypes.includes(candidateType)) return false;
      }
      if (gallerySet !== "All" && card && cardSetCode(card) !== gallerySet) return false;
      if (galleryCost !== "All" && card && card.cost !== Number(galleryCost)) return false;
      return true;
    }).sort((left, right) => sortBuilderItems(left, right, gallerySort)).slice(0, 240);
  }, [
    deck.bakuganIds,
    deck.cardIds,
    deck.coreIds,
    factionFilters,
    galleryCategory,
    galleryCost,
    galleryQuery,
    gallerySet,
    gallerySort,
    galleryTypes,
    factionFilterAuto,
  ]);

  const mainDeckCards = useMemo(() => grouped.filter(({ card }) => {
    const query = deckQuery.trim().toLowerCase();
    if (query && !`${card.displayName} ${card.effect}`.toLowerCase().includes(query)) return false;
    if (deckFactionFilters.length && !card.factions.some((faction) => deckFactionFilters.includes(faction))) return false;
    if (deckTypes.length && !deckTypes.includes(card.type)) return false;
    if (deckSet !== "All" && cardSetCode(card) !== deckSet) return false;
    if (deckCost !== "All" && card.cost !== Number(deckCost)) return false;
    return true;
  }).sort((left, right) => sortBuilderItems(
    { kind: "card", id: left.card.catalogId, name: left.card.displayName, card: left.card, count: left.count },
    { kind: "card", id: right.card.catalogId, name: right.card.displayName, card: right.card, count: right.count },
    deckSort,
  )), [deckCost, deckFactionFilters, deckQuery, deckSet, deckSort, deckTypes, grouped]);

  const requiredCoreTypes = report.requiredCoreTypes;
  const selectedCoreSlots = useMemo(() => {
    const remaining = [...deck.coreIds];
    const slots = requiredCoreTypes.map((type) => {
      const index = remaining.findIndex((id) => CORES.find((core) => core.id === id)?.type === type);
      if (index < 0) return undefined;
      return remaining.splice(index, 1)[0];
    });
    for (const id of remaining) {
      const openIndex = slots.findIndex((value) => !value);
      if (openIndex >= 0) slots[openIndex] = id;
      else slots.push(id);
    }
    return Array.from({ length: 6 }, (_, index) => slots[index]);
  }, [deck.coreIds, requiredCoreTypes]);

  const adjustCard = (key: string, amount: number) => {
    const next = [...deck.cardIds];
    const limit = deck.format === "singleton" ? 1 : 3;
    if (amount > 0 && next.length < mainDeckMaximum && next.filter((candidate) => candidate === key).length < limit) next.push(key);
    if (amount < 0) {
      const index = next.lastIndexOf(key);
      if (index >= 0) next.splice(index, 1);
    }
    commit({ ...deck, cardIds: next });
  };
  const toggleCharacter = (key: string) => {
    const adding = !deck.bakuganIds.includes(key);
    const nextIds = deck.bakuganIds.includes(key)
      ? deck.bakuganIds.filter((candidate) => candidate !== key)
      : deck.bakuganIds.length < 3 ? [...deck.bakuganIds, key] : deck.bakuganIds;
    const nextFactions = [...new Set(nextIds.map((candidate) => BAKUGAN.find((item) => item.id === candidate)?.faction).filter(Boolean))] as string[];
    if (adding || factionFilterAuto) setFactionFilters(nextFactions);
    if (adding) setFactionFilterAuto(true);
    commit({ ...deck, bakuganIds: nextIds });
  };
  const adjustCore = (key: string, amount: number) => {
    const next = [...deck.coreIds];
    const limit = deck.format === "singleton" ? 1 : 6;
    if (amount > 0 && next.length < 6 && next.filter((candidate) => candidate === key).length < limit) next.push(key);
    if (amount < 0) {
      const index = next.lastIndexOf(key);
      if (index >= 0) next.splice(index, 1);
    }
    commit({ ...deck, coreIds: next });
  };
  const inspectCard = (card: GameCard) => {
    setInspectorTab("overview");
    setInspection({ kind: "card", card });
  };
  const inspectCore = (coreId: string) => setInspection({ kind: "core", coreId });
  const adjustGalleryItem = (item: BuilderGalleryItem, amount: number) => {
    if (item.kind === "card") adjustCard(item.id, amount);
    if (item.kind === "character" && ((amount > 0 && !item.count) || (amount < 0 && item.count))) toggleCharacter(item.id);
    if (item.kind === "core") adjustCore(item.id, amount);
  };
  const canAddGalleryItem = (item: BuilderGalleryItem) => {
    if (item.kind === "character") return item.count === 0 && deck.bakuganIds.length < 3;
    if (item.kind === "core") {
      const limit = deck.format === "singleton" ? 1 : 6;
      return deck.coreIds.length < 6 && item.count < limit;
    }
    const limit = deck.format === "singleton" ? 1 : 3;
    return deck.cardIds.length < mainDeckMaximum && item.count < limit;
  };
  const toggleFilterValue = (current: string[], setCurrent: (values: string[]) => void, value: string) => {
    setCurrent(current.includes(value) ? current.filter((candidate) => candidate !== value) : [...current, value]);
  };
  const activeGalleryFilterCount = factionFilters.length + galleryTypes.length
    + (gallerySet === "All" ? 0 : 1) + (galleryCost === "All" ? 0 : 1);
  const activeDeckFilterCount = deckFactionFilters.length + deckTypes.length
    + (deckSet === "All" ? 0 : 1) + (deckCost === "All" ? 0 : 1);

  const openSaveDialog = () => {
    setSaveName(deck.name);
    setSaveDescription(deck.description ?? "");
    setSaveVisibility(adminPublicId || adminOfflineId ? "Public" : adminAiId ? "Private" : report.isLegal ? deck.visibility : deck.visibility === "Public" ? "Draft" : deck.visibility);
    setSaveLeadCardId(deck.leadCardId && deck.cardIds.includes(deck.leadCardId) ? deck.leadCardId : deck.cardIds[0] ?? "");
    setActiveMenu({ surface: "deck", panel: "save" });
  };

  const save = async () => {
    const latest = validateDeck(deck);
    const name = saveName.trim();
    if (!name) {
      notify("Enter a deck name before saving.");
      return;
    }
    if ((saveVisibility === "Public" || adminAiId || adminOfflineId) && !latest.isLegal) {
      notify(`${adminAiId ? "AI" : adminOfflineId ? "Offline fallback" : "Public"} decks must be valid: ${latest.issues[0].message}`);
      return;
    }
    if (decks.length >= DECK_LIMIT && id === "new" && !administratorEdit) {
      notify(`Deck limit reached (${DECK_LIMIT}).`);
      return;
    }
    const next = {
      ...deck,
      id: adminOfflineId ? `offline-${adminOfflineId}` : administratorEdit ? adminResourceId! : id === "new" ? deck.id : id,
      name,
      description: saveDescription.trim() || undefined,
      visibility: adminPublicId || adminOfflineId ? "Public" as const : adminAiId ? "Private" as const : saveVisibility,
      leadCardId: saveLeadCardId && deck.cardIds.includes(saveLeadCardId) ? saveLeadCardId : deck.cardIds[0],
      updatedAt: new Date().toISOString(),
      revision: (deck.revision ?? 0) + 1,
    };
    if (administratorEdit) {
      try {
        const response = await fetch("/api/admin", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: adminPublicId ? "public-update" : adminOfflineId ? "offline-update" : "ai-update",
            id: adminResourceId,
            deck: next,
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Administrator deck could not be saved.");
        setBuilderDeck(null);
        setSaveState("saved");
        setActiveMenu(null);
        if (adminOfflineId) notifyOfflinePublicDecksUpdated();
        notify(`${adminPublicId ? "Public" : adminOfflineId ? "Offline fallback" : "AI"} deck updated.`);
        router.push(returnTo ?? (adminOfflineId ? "/admin?tab=offline" : "/admin?tab=ai"));
      } catch (error) {
        setSaveState("error");
        notify(error instanceof Error ? error.message : "Administrator deck could not be saved.");
      }
      return;
    }
    setDecks((items: DeckRecord[]) => [next, ...items.filter((item) => item.id !== next.id)]);
    setSelectedDeckId(next.id);
    setBuilderDeck(null);
    setSaveState("saved");
    setActiveMenu(null);
    notify(latest.isLegal ? `${saveVisibility} deck saved.` : `Deck saved with ${latest.issues.length} legality issues.`);
    promptAccount("deck-saved");
    router.push(returnTo ?? `/decks/${encodeURIComponent(next.id)}`);
  };

  if (remoteLoading) {
    return <div className={styles.route}><DeckState tone="loading" role="status" title="Loading administrator deck" copy="Retrieving the server-owned deck record…" /></div>;
  }

  return (
    <section className={styles.builder}>
      <header className={styles.builderHeader}>
        <Link href={returnTo ?? "/decks"}>{administratorEdit ? "← Administrator" : returnTo ? "← Match setup" : "← My Decks"}</Link>
        <div className={styles.builderDeckIdentity}><span>{administratorEdit ? "Administrator Edit" : "Edit Deck"}</span><strong>{deck.name}</strong></div>
        <label>Format<select value={deck.format ?? "standard"} onChange={(event) => commit({ ...deck, format: event.target.value as DeckRecord["format"] })}><option value="standard">Standard</option><option value="singleton">Singleton</option><option value="competitive">Competitive</option></select></label>
        <StatusChip tone="info">{deckSetName(deck).toUpperCase()}</StatusChip>
        <StatusChip tone={report.isLegal ? "success" : "danger"}>{report.isLegal ? "Legal" : `${report.issues.length} issues`}</StatusChip>
        <span className={`${styles.saveState} ${styles[`saveState_${saveState}`]}`}>
          {saveState === "error" ? "Draft not saved" : saveState === "dirty" ? "Saving draft…" : "Draft saved locally"}
        </span>
        <ActionButton disabled={saveState === "error"} onClick={openSaveDialog}>Save Deck</ActionButton>
      </header>
      <Tabs className={styles.builderMobileTabs} label="Deck Builder sections">
        {(["gallery", "deck"] as BuilderView[]).map((value) => (
          <button key={value} className={builderView === value ? "active" : ""} onClick={() => setBuilderView(value)}>
            {value === "gallery" ? "Card Gallery" : `Current Deck ${deck.cardIds.length}/${mainDeckMaximum}`}
          </button>
        ))}
      </Tabs>
      <div className={styles.builderLayout}>
        <section className={`${styles.builderGallery} ${builderView !== "gallery" ? styles.mobileHidden : ""}`}>
          <div className={styles.builderSideTitle}>
            <div><span>Collection</span><h2>Card Gallery</h2></div>
            <StatusChip>{galleryItems.length} shown</StatusChip>
          </div>
          <Tabs className={styles.builderGalleryTabs} label="Card Gallery sections">
            {([
              ["characters", "Character Cards"],
              ["cores", "Cores"],
              ["cards", "Main Deck Cards"],
            ] as Array<[BuilderCategory, string]>).map(([value, label]) => (
              <button
                type="button"
                className={galleryCategory === value ? "active" : ""}
                aria-pressed={galleryCategory === value}
                onClick={() => setGalleryCategory(value)}
                key={value}
              >
                {label}
              </button>
            ))}
          </Tabs>
          <BuilderToolbar
            label="Card Gallery"
            query={galleryQuery}
            setQuery={setGalleryQuery}
            filterCount={activeGalleryFilterCount}
            onFilter={() => setActiveMenu({ surface: "gallery", panel: "filter" })}
            onSort={() => setActiveMenu({ surface: "gallery", panel: "sort" })}
          />
          <div className={styles.activeFilters} aria-label="Active Card Gallery filters">
            {factionFilters.map((faction) => (
              <button key={faction} onClick={() => {
                setFactionFilterAuto(false);
                setFactionFilters(factionFilters.filter((candidate) => candidate !== faction));
              }}>{factionFilterAuto ? "Team faction" : "Faction"}: {faction} ×</button>
            ))}
            {galleryTypes.map((value) => <button key={value} onClick={() => setGalleryTypes(galleryTypes.filter((candidate) => candidate !== value))}>Type: {value} ×</button>)}
            {gallerySet !== "All" && <button onClick={() => setGallerySet("All")}>Set: {gallerySet} ×</button>}
            {galleryCost !== "All" && <button onClick={() => setGalleryCost("All")}>Cost: {galleryCost} ×</button>}
          </div>
          {galleryItems.length ? (
            <div className={styles.builderGalleryGrid}>
              {galleryItems.map((item) => (
                <BuilderGalleryCard
                  key={`${item.kind}-${item.id}`}
                  item={item}
                  canAdd={canAddGalleryItem(item)}
                  onInspect={() => item.kind === "core" ? inspectCore(item.id) : inspectCard(item.card)}
                  onAdjust={(amount) => adjustGalleryItem(item, amount)}
                />
              ))}
            </div>
          ) : (
            <DeckState
              title="No gallery items match"
              copy="Clear one or more filters to return cards, Character cards, and BakuCores to the gallery."
              action={<ActionButton tone="quiet" onClick={() => {
                setGalleryQuery("");
                setGalleryCategory("characters");
                setFactionFilters([]);
                setFactionFilterAuto(false);
                setGalleryTypes([]);
                setGallerySet("All");
                setGalleryCost("All");
              }}>Clear filters</ActionButton>}
            />
          )}
        </section>

        <aside className={`${styles.builderCurrentDeck} ${builderView !== "deck" ? styles.mobileHidden : ""}`}>
          <section className={styles.builderDeckSection}>
            <BuilderRequirementHeader
              title="Bakugan Character Cards"
              count={deck.bakuganIds.length}
              maximum={3}
              issues={report.bySection.team}
              onInfo={() => setActiveMenu({ surface: "team", panel: "issues" })}
            />
            <div className={styles.builderCharacterRow}>
              {Array.from({ length: 3 }, (_, index) => {
                const character = BAKUGAN.find((candidate) => candidate.id === deck.bakuganIds[index]);
                return character ? (
                  <article className={styles.builderCharacterSlot} key={character.id}>
                    <button className={styles.builderCardArtButton} onClick={() => inspectCard(character.character)}>
                      <ResponsiveCardImage card={character.character} presentation="tile" />
                    </button>
                    <div><strong>{character.name}</strong><span>{character.faction}</span></div>
                    <button aria-label={`Remove ${character.name}`} onClick={() => toggleCharacter(character.id)}>−</button>
                  </article>
                ) : (
                  <div className={styles.builderCharacterEmpty} key={index}>
                    <span>{index + 1}</span><strong>Character slot</strong><small>Add from the gallery</small>
                  </div>
                );
              })}
            </div>
          </section>

          <section className={styles.builderDeckSection}>
            <BuilderRequirementHeader
              title="BakuCores"
              count={deck.coreIds.length}
              maximum={6}
              issues={report.bySection.cores}
              onInfo={() => setActiveMenu({ surface: "cores", panel: "issues" })}
            />
            <p className={styles.coreRequirementCopy}>
              Each pair sits beneath the Character card that requires it.
            </p>
            <div className={styles.builderCoreRow}>
              {Array.from({ length: 6 }, (_, index) => {
                const requiredType = requiredCoreTypes[index];
                const selectedId = selectedCoreSlots[index];
                const core = selectedId ? CORES.find((candidate) => candidate.id === selectedId) : null;
                return core ? (
                  <article className={styles.builderCoreSlot} key={`${core.id}-${index}`}>
                    <button onClick={() => inspectCore(core.id)}><OriginalImage src={core.art} alt={core.name} /></button>
                    <span>{core.type}</span>
                    <button aria-label={`Remove ${core.name}`} onClick={() => adjustCore(core.id, -1)}>−</button>
                  </article>
                ) : (
                  <div className={styles.builderCorePreview} key={`empty-${index}`}>
                    {requiredType
                      ? <BakuCoreBack type={requiredType} />
                      : <><span>◇</span><strong>Choose Character</strong></>}
                  </div>
                );
              })}
            </div>
          </section>

          <section className={`${styles.builderDeckSection} ${styles.builderMainDeckSection}`}>
            <BuilderRequirementHeader
              title="Main Deck"
              count={deck.cardIds.length}
              maximum={mainDeckMaximum}
              issues={report.bySection.mainDeck}
              factions={report.teamFactions}
              onInfo={() => setActiveMenu({ surface: "mainDeck", panel: "issues" })}
            />
            <BuilderToolbar
              label="Main Deck"
              query={deckQuery}
              setQuery={setDeckQuery}
              filterCount={activeDeckFilterCount}
              onFilter={() => setActiveMenu({ surface: "deck", panel: "filter" })}
              onSort={() => setActiveMenu({ surface: "deck", panel: "sort" })}
            />
            <div className={styles.activeFilters} aria-label="Active Main Deck filters">
              {deckFactionFilters.map((faction) => <button key={faction} onClick={() => setDeckFactionFilters(deckFactionFilters.filter((candidate) => candidate !== faction))}>Faction: {faction} ×</button>)}
              {deckTypes.map((value) => <button key={value} onClick={() => setDeckTypes(deckTypes.filter((candidate) => candidate !== value))}>Type: {value} ×</button>)}
              {deckSet !== "All" && <button onClick={() => setDeckSet("All")}>Set: {deckSet} ×</button>}
              {deckCost !== "All" && <button onClick={() => setDeckCost("All")}>Cost: {deckCost} ×</button>}
            </div>
            {mainDeckCards.length ? (
              <div className={styles.builderMainDeckGrid}>
                {mainDeckCards.map(({ card, count }) => (
                  <BuilderGalleryCard
                    key={card.catalogId}
                    item={{ kind: "card", id: card.catalogId, name: card.displayName, card, count }}
                    canAdd={count < (deck.format === "singleton" ? 1 : 3) && deck.cardIds.length < mainDeckMaximum}
                    onInspect={() => inspectCard(card)}
                    onAdjust={(amount) => adjustCard(card.catalogId, amount)}
                  />
                ))}
              </div>
            ) : (
              <DeckState
                title={deck.cardIds.length ? "No deck cards match" : "Main Deck is empty"}
                copy={deck.cardIds.length ? "Clear the Main Deck filters to see every included card." : `Add ${mainDeckMaximum} faction-compatible cards from the Card Gallery.`}
              />
            )}
          </section>
        </aside>
      </div>
      <footer className={styles.builderStatus}>
        <div><span>Characters</span><strong>{deck.bakuganIds.length}/3</strong></div>
        <div><span>BakuCores</span><strong>{deck.coreIds.length}/6</strong></div>
        <div><span>Main Deck</span><strong>{deck.cardIds.length}/{mainDeckMaximum}</strong></div>
        <div><span>Legality</span><strong>{report.isLegal ? "Legal" : `${report.issues.length} issues`}</strong></div>
        <span>{saveState === "error" ? storageHealth.message : "Draft persists on this device while you build."}</span>
      </footer>

      {activeMenu?.panel === "issues" && (
        <BuilderMenuDialog
          title={activeMenu.surface === "team" ? "Character requirements" : activeMenu.surface === "cores" ? "BakuCore requirements" : "Main Deck requirements"}
          eyebrow="Deck validation"
          onClose={() => setActiveMenu(null)}
        >
          <BuilderIssues
            issues={activeMenu.surface === "team"
              ? report.bySection.team
              : activeMenu.surface === "cores"
                ? report.bySection.cores
                : report.bySection.mainDeck}
          />
        </BuilderMenuDialog>
      )}

      {activeMenu?.panel === "sort" && (
        <BuilderMenuDialog
          title={`Sort ${activeMenu.surface === "gallery" ? "Card Gallery" : "Main Deck"}`}
          eyebrow="Display order"
          onClose={() => setActiveMenu(null)}
        >
          <div className={styles.builderOptionList}>
            {([
              ["name-asc", "Name A–Z"],
              ["name-desc", "Name Z–A"],
              ["id-asc", "Card ID"],
              ["cost-asc", "Energy low–high"],
              ["cost-desc", "Energy high–low"],
              ["count-desc", "Copies high–low"],
            ] as Array<[BuilderSort, string]>).map(([value, label]) => {
              const selected = activeMenu.surface === "gallery" ? gallerySort === value : deckSort === value;
              return (
                <button
                  className={selected ? styles.builderOptionSelected : ""}
                  key={value}
                  onClick={() => {
                    if (activeMenu.surface === "gallery") setGallerySort(value);
                    else setDeckSort(value);
                    setActiveMenu(null);
                  }}
                >
                  <span>{selected ? "●" : "○"}</span>{label}
                </button>
              );
            })}
          </div>
        </BuilderMenuDialog>
      )}

      {activeMenu?.panel === "filter" && (
        <BuilderMenuDialog
          title={`Filter ${activeMenu.surface === "gallery" ? "Card Gallery" : "Main Deck"}`}
          eyebrow="Refine cards"
          onClose={() => setActiveMenu(null)}
          footer={(
            <>
              <ActionButton tone="quiet" onClick={() => {
                if (activeMenu.surface === "gallery") {
                  setFactionFilters([]);
                  setFactionFilterAuto(false);
                  setGalleryTypes([]);
                  setGallerySet("All");
                  setGalleryCost("All");
                } else {
                  setDeckFactionFilters([]);
                  setDeckTypes([]);
                  setDeckSet("All");
                  setDeckCost("All");
                }
              }}>Reset</ActionButton>
              <ActionButton onClick={() => setActiveMenu(null)}>Show cards</ActionButton>
            </>
          )}
        >
          <BuilderFilterGroup
            title="Factions"
            values={FACTIONS}
            selected={activeMenu.surface === "gallery" ? factionFilters : deckFactionFilters}
            onToggle={(value) => {
              if (activeMenu.surface === "gallery") {
                setFactionFilterAuto(false);
                toggleFilterValue(factionFilters, setFactionFilters, value);
              } else toggleFilterValue(deckFactionFilters, setDeckFactionFilters, value);
            }}
          />
          <BuilderFilterGroup
            title="Card types"
            values={activeMenu.surface === "gallery"
              ? ["Action", "Flip", "Flip Hero", "Hero", "Baku-Gear", "Evo", "Character", "Fist", "Flaming Fist", "Shield", "Magic Shield", "Helix"]
              : ["Action", "Flip", "Flip Hero", "Hero", "Baku-Gear", "Evo"]}
            selected={activeMenu.surface === "gallery" ? galleryTypes : deckTypes}
            onToggle={(value) => activeMenu.surface === "gallery"
              ? toggleFilterValue(galleryTypes, setGalleryTypes, value)
              : toggleFilterValue(deckTypes, setDeckTypes, value)}
          />
          <div className={styles.builderFilterSelects}>
            <Field label="Set">
              <select value={activeMenu.surface === "gallery" ? gallerySet : deckSet} onChange={(event) => activeMenu.surface === "gallery" ? setGallerySet(event.target.value) : setDeckSet(event.target.value)}>
                <option>All</option>
                {(Object.values(CARD_SET_INFO) as Array<{ code: string; name: string }>).map((set) => <option value={set.code} key={set.code}>{set.name}</option>)}
              </select>
            </Field>
            <Field label="Energy">
              <select value={activeMenu.surface === "gallery" ? galleryCost : deckCost} onChange={(event) => activeMenu.surface === "gallery" ? setGalleryCost(event.target.value) : setDeckCost(event.target.value)}>
                <option>All</option>
                {Array.from({ length: 11 }, (_, value) => <option key={value}>{value}</option>)}
              </select>
            </Field>
          </div>
        </BuilderMenuDialog>
      )}

      {activeMenu?.panel === "save" && (
        <BuilderMenuDialog
          title="Save Deck"
          eyebrow={report.isLegal ? "Ready to save" : `Saving with ${report.issues.length} legality issues`}
          onClose={() => setActiveMenu(null)}
          footer={(
            <>
              <ActionButton tone="quiet" onClick={() => setActiveMenu(null)}>Cancel</ActionButton>
              <ActionButton
                disabled={!saveName.trim() || ((saveVisibility === "Public" || Boolean(adminAiId)) && !report.isLegal)}
                onClick={() => void save()}
              >
                Save Deck
              </ActionButton>
            </>
          )}
        >
          <div className={styles.builderSaveFields}>
            <Field label="Deck name">
              <input
                value={saveName}
                maxLength={60}
                autoFocus
                onChange={(event) => setSaveName(event.target.value)}
              />
            </Field>
            <Field label="Deck description">
              <textarea
                value={saveDescription}
                maxLength={500}
                rows={5}
                placeholder="Describe how this deck plays…"
                onChange={(event) => setSaveDescription(event.target.value)}
              />
            </Field>
            {!saveDescription.trim() && (
              <p className={styles.builderDescriptionPrompt}>
                Add a deck description for this deck to be eligible for featuring on the Home Page.
              </p>
            )}
          </div>
          <fieldset className={styles.builderFeaturedCardPicker}>
            <legend>Featured Card</legend>
            <p>Choose the Main Deck card used as this deck’s featured artwork.</p>
            {grouped.length ? (
              <div>
                {grouped.map(({ card }) => {
                  const selected = saveLeadCardId === card.catalogId;
                  return (
                    <button
                      type="button"
                      className={selected ? styles.builderFeaturedCardSelected : ""}
                      aria-pressed={selected}
                      onClick={() => setSaveLeadCardId(card.catalogId)}
                      key={card.catalogId}
                    >
                      <OriginalImage src={cardArtSource(card, "thumbnail")} alt="" />
                      <span>
                        <strong>{card.displayName}</strong>
                        <small>{card.faction} · {card.type}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className={styles.builderFeaturedCardEmpty}>Add a Main Deck card before choosing featured artwork.</span>
            )}
          </fieldset>
          <fieldset className={styles.builderVisibilityOptions}>
            <legend>Visibility</legend>
            {administratorEdit ? (
              <label>
                <input type="radio" name="deck-visibility" checked readOnly />
                <span>
                  <strong>{adminPublicId ? "Public" : "AI Deck"}</strong>
                  <small>{adminPublicId ? "Visible in the Public Deck library." : "Available only to the Training AI deck pool."}</small>
                </span>
              </label>
            ) : ([
              ["Draft", "Only visible to you."],
              ["Private", "Only visible through its link."],
              ["Public", "Visible in the Public Deck library."],
            ] as Array<[DeckRecord["visibility"], string]>).map(([value, description]) => {
              const disabled = value === "Public" && !report.isLegal;
              return (
                <label className={disabled ? styles.builderVisibilityDisabled : ""} key={value}>
                  <input
                    type="radio"
                    name="deck-visibility"
                    value={value}
                    checked={saveVisibility === value}
                    disabled={disabled}
                    onChange={() => setSaveVisibility(value)}
                  />
                  <span><strong>{value}</strong><small>{description}</small></span>
                </label>
              );
            })}
          </fieldset>
          {!report.isLegal && !administratorEdit && (
            <p className={styles.builderPublicRequirement} role="status">
              Public visibility requires a valid {deck.format ?? "standard"} deck. Draft and Private decks can be saved with issues.
            </p>
          )}
        </BuilderMenuDialog>
      )}

      {inspection?.kind === "card" && (
        <div className={styles.builderInspectorOverlay} role="presentation">
          <CardInspector
            card={inspection.card}
            allCards={CARDS}
            rules={BUILDER_RULE_REFERENCES}
            rulings={PUBLISHED_RULINGS}
            tab={inspectorTab}
            mode="embedded"
            onTabChange={setInspectorTab}
            onSelectCard={inspectCard}
            onClose={() => setInspection(null)}
            onShare={() => {
              const origin = globalThis.location?.origin ?? "";
              void copyText(`${origin}/compendium?card=${encodeURIComponent(inspection.card.catalogId)}`).then(() => notify("Card link copied."));
            }}
          />
        </div>
      )}
      {inspection?.kind === "core" && (
        <BuilderCoreInspector coreId={inspection.coreId} onClose={() => setInspection(null)} />
      )}
    </section>
  );
}

function BuilderToolbar({
  label,
  query,
  setQuery,
  filterCount,
  onFilter,
  onSort,
}: {
  label: string;
  query: string;
  setQuery: (value: string) => void;
  filterCount: number;
  onFilter: () => void;
  onSort: () => void;
}) {
  return (
    <div className={styles.builderToolbar} role="search" aria-label={`${label} tools`}>
      <label>
        <span className={styles.srOnly}>Search {label}</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}…`} />
      </label>
      <button type="button" onClick={onSort} aria-label={`Sort ${label}`}>↕ <span>Sort</span></button>
      <button type="button" onClick={onFilter} aria-label={`Filter ${label}`}>◇ <span>Filter{filterCount ? ` (${filterCount})` : ""}</span></button>
    </div>
  );
}

function BakuCoreBack({ type }: { type: string }) {
  return (
    <div className={styles.bakuCoreBack}>
      <OriginalImage
        src={CORE_BACK_IMAGES[type] ?? CORE_BACK_IMAGES.Shield}
        alt={`${type} BakuCore reverse`}
        decoding="async"
      />
    </div>
  );
}

function BuilderGalleryCard({
  item,
  canAdd,
  onInspect,
  onAdjust,
}: {
  item: BuilderGalleryItem;
  canAdd: boolean;
  onInspect: () => void;
  onAdjust: (amount: number) => void;
}) {
  const core = item.kind === "core" ? CORES.find((candidate) => candidate.id === item.id) : null;
  const metadata = item.kind === "core"
    ? core?.type
    : item.kind === "character"
      ? `${item.card.faction} · Character`
      : `${item.card.faction} · ${item.card.type} · ${item.card.cost} Energy`;
  return (
    <article className={`${styles.builderGalleryCard} ${item.kind === "core" ? styles.builderGalleryCore : ""}`}>
      <button className={styles.builderCardArtButton} type="button" onClick={onInspect} aria-label={`Inspect ${item.name}`}>
        {item.kind === "core"
          ? <OriginalImage src={core?.art} alt={item.name} />
          : <ResponsiveCardImage card={item.card} presentation="tile" />}
      </button>
      <div className={styles.builderGalleryIdentity}>
        <strong>{item.name}</strong>
        <span>{metadata}</span>
      </div>
      <div className={styles.builderQuantity}>
        <button type="button" disabled={item.count === 0} onClick={() => onAdjust(-1)} aria-label={`Remove ${item.name}`}>−</button>
        <strong aria-label={`${item.count} copies in deck`}>{item.count}</strong>
        <button type="button" disabled={!canAdd} onClick={() => onAdjust(1)} aria-label={`Add ${item.name}`}>+</button>
      </div>
    </article>
  );
}

function BuilderRequirementHeader({
  title,
  count,
  maximum,
  issues,
  factions = [],
  onInfo,
}: {
  title: string;
  count: number;
  maximum: number;
  issues: DeckValidationResult["issues"];
  factions?: string[];
  onInfo: () => void;
}) {
  const valid = issues.length === 0;
  return (
    <header className={styles.builderRequirementHeader}>
      <div>
        <h2>{title}</h2>
        <strong>{count}/{maximum}</strong>
        {factions.length > 0 && (
          <span className={styles.builderFactionSymbols} aria-label={`Allowed factions: ${factions.join(", ")}`}>
            {factions.map((faction) => <OriginalImage src={FACTION_SYMBOLS[faction]} alt={faction} title={faction} key={faction} />)}
          </span>
        )}
      </div>
      <button
        type="button"
        className={valid ? styles.builderInfoValid : styles.builderInfoInvalid}
        aria-label={`${title}: ${valid ? "requirements satisfied" : `${issues.length} issues`}`}
        onClick={onInfo}
      >i</button>
    </header>
  );
}

function BuilderIssues({ issues }: { issues: DeckValidationResult["issues"] }) {
  if (!issues.length) {
    return <div className={styles.builderValidMessage}><span>✓</span><h3>Requirements satisfied</h3><p>This section is valid for the selected format.</p></div>;
  }
  return (
    <ol className={styles.builderIssueList}>
      {issues.map((issue) => <li key={issue.code}><span>!</span><div><strong>{issue.code}</strong><p>{issue.message}</p></div></li>)}
    </ol>
  );
}

function BuilderMenuDialog({
  eyebrow,
  title,
  children,
  footer,
  onClose,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog) return;
    const focusableSelector = [
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[href]",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>(focusableSelector)]
      .filter((element) => !element.hidden && element.getClientRects().length > 0);
    queueMicrotask(() => {
      const candidates = focusable();
      (dialog.querySelector<HTMLElement>("[autofocus]") ?? candidates[0])?.focus();
    });
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const candidates = focusable();
      if (!candidates.length) return;
      const first = candidates[0];
      const last = candidates[candidates.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", trapFocus);
    return () => {
      dialog.removeEventListener("keydown", trapFocus);
      returnFocus?.focus();
    };
  }, []);

  return (
    <div className={styles.builderMenuBackdrop} onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={dialogRef} className={styles.builderMenuDialog} role="dialog" aria-modal="true" aria-label={title}>
        <header><div><span>{eyebrow}</span><h2>{title}</h2></div><button type="button" onClick={onClose} aria-label={`Close ${title}`}>×</button></header>
        <div className={styles.builderMenuBody}>{children}</div>
        {footer && <footer>{footer}</footer>}
      </section>
    </div>
  );
}

function BuilderFilterGroup({
  title,
  values,
  selected,
  onToggle,
}: {
  title: string;
  values: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset className={styles.builderFilterGroup}>
      <legend>{title}</legend>
      <div>{values.map((value) => <button type="button" className={selected.includes(value) ? styles.builderFilterSelected : ""} onClick={() => onToggle(value)} key={value}>{value}</button>)}</div>
    </fieldset>
  );
}

function BuilderCoreInspector({ coreId, onClose }: { coreId: string; onClose: () => void }) {
  const core = CORES.find((candidate) => candidate.id === coreId);
  if (!core) return null;
  return (
    <div className={styles.builderInspectorOverlay}>
      <section className={styles.builderCoreInspector} role="dialog" aria-modal="true" aria-label={`${core.name} BakuCore`}>
        <header><span>BakuCore</span><h2>{core.name}</h2><button type="button" onClick={onClose}>Close</button></header>
        <div><OriginalImage src={core.art} alt={core.name} /><dl><div><dt>Set</dt><dd>{core.set ?? "Battle Brawlers"}</dd></div><div><dt>Type</dt><dd>{core.type}</dd></div><div><dt>B-Power</dt><dd>{core.bonus > 0 ? "+" : ""}{core.bonus}{core.fusionBonus ? ` / +${core.fusionBonus} fused` : ""}</dd></div><div><dt>Damage</dt><dd>{core.damageBonus > 0 ? "+" : ""}{core.damageBonus}{core.fusionDamageBonus ? ` / +${core.fusionDamageBonus} fused` : ""}</dd></div></dl><p>{core.bakuGearCostReduction ? `Baku-Gear costs ${core.bakuGearCostReduction} less Energy while this Core is held. ` : ""}{core.fusionFrostStrike ? `While fused, this Core grants +${core.fusionFrostStrike} FrostStrike. ` : ""}BakuCore types must match the six indicators printed across the three selected Character cards.</p></div>
      </section>
    </div>
  );
}

function MissingDeck({ id, publicDeck = false }: { id: string; publicDeck?: boolean }) {
  return (
    <div className={styles.route}>
      <DeckState
        tone="error"
        role="alert"
        title="Deck not found"
        copy={`No ${publicDeck ? "public" : "device-local"} deck matches “${id}”.`}
        action={<Link className={styles.textAction} href={publicDeck ? "/decks/public" : "/decks"}>Return to {publicDeck ? "Public Decks" : "My Decks"}</Link>}
      />
    </div>
  );
}
