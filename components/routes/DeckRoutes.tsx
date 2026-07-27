"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CARD_SET_INFO, cardSetCode } from "../../lib/content/catalogue";
import { cardArtSource } from "../../lib/content/card-art";
import {
  BAKUGAN,
  CARD_BY_ID,
  CARDS,
  CORES,
  PUBLIC_DECKS,
  STARTER_DECKS,
  validateDeck,
  type DeckRecord,
} from "../../lib/data";
import type { DeckValidationResult } from "../../lib/deck-validation";
import { DECK_LIMIT, decodeDeckCode, deckTextList, encodeDeckCode, uniqueDeckName } from "../../lib/deck-transfer";
import { deckSetName } from "../../lib/deck-set";
import { useApp } from "../application/AppProvider";
import { copyText, downloadTextFile, formatTimestamp } from "../application/ui";
import {
  ActionButton,
  CardGrid,
  Field,
  RouteHero,
  StatusChip,
  Surface,
  Tabs,
} from "../design-system/primitives";
import styles from "./DeckRoutes.module.css";

const FACTIONS = ["Aquos", "Aurelus", "Darkus", "Haos", "Pyrus", "Ventus"];

type LibraryView = "grid" | "list";
type CatalogueTab = "cards" | "characters" | "cores";
type BuilderView = "team" | "deck" | "catalogue" | "inspector";
type Inspection =
  | { kind: "card"; id: string }
  | { kind: "character"; id: string }
  | { kind: "core"; id: string };

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
  visibility: "Private",
  revision: 1,
});

const publicDecksFor = (decks: DeckRecord[], playerName = "You") => [
  ...decks
    .filter((deck) => deck.visibility === "Public")
    .map((deck) => ({
      ...deck,
      creator: deck.creator ?? playerName,
      publishedAt: deck.publishedAt ?? deck.updatedAt,
    })),
  ...PUBLIC_DECKS,
].filter((deck, index, all) => all.findIndex((candidate) => candidate.id === deck.id) === index);

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
          <option>Updated</option><option>Name</option><option>Set</option>
        </select>
      </Field>
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
          copy="Choose three Character cards, their six BakuCores, and a legal 40-card Main Deck."
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
              view={view}
              onOpen={() => router.push(`/decks/${encodeURIComponent(deck.id)}`)}
              onSelect={() => {
                setSelectedDeckId(deck.id);
                notify(`${deck.name} selected for Play.`);
              }}
              onEdit={() => router.push(`/builder/${encodeURIComponent(deck.id)}`)}
              onDuplicate={() => duplicate(deck)}
              onDelete={() => remove(deck)}
            />
          ))}
        </CardGrid>
      )}
    </div>
  );
}

function CharacterFan({ deck, compact = false }: { deck: DeckRecord; compact?: boolean }) {
  const characters = deck.bakuganIds
    .map((id) => BAKUGAN.find((candidate) => candidate.id === id))
    .filter(Boolean);
  return (
    <div className={`${styles.characterFan} ${compact ? styles.characterFanCompact : ""}`}>
      {Array.from({ length: 3 }, (_, index) => {
        const character = characters[index];
        return character ? (
          <img
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
    </div>
  );
}

function DeckTile({
  deck,
  report,
  selected,
  view,
  onOpen,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  deck: DeckRecord;
  report: DeckValidationResult;
  selected: boolean;
  view: LibraryView;
  onOpen: () => void;
  onSelect: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <Surface
      as="article"
      className={`${styles.deckCard} ${styles[`deckCard_${view}`]} ${selected ? styles.deckCardSelected : ""}`}
      data-selected-for-play={selected || undefined}
      elevation={selected ? "overlay" : "raised"}
    >
      {selected && <div className={styles.selectedBanner}><span /> Selected for Play</div>}
      <button className={styles.deckCardMain} onClick={onOpen} aria-label={`View ${deck.name}`}>
        <CharacterFan deck={deck} compact={view === "list"} />
        <div className={styles.deckCardCopy}>
          <div className={styles.deckTitleRow}>
            <h2 data-deck-name>{deck.name}</h2>
            <StatusChip>{deck.visibility}</StatusChip>
          </div>
          <p>{deck.factions.length ? deck.factions.join(" • ") : "No team factions selected"}</p>
          <div className={styles.chipRow}>
            <StatusChip tone="info">{deckSetName(deck).toUpperCase()}</StatusChip>
            <StatusChip tone={report.isLegal ? "success" : "danger"}>
              {report.isLegal ? "Legal" : `${report.issues.length} issues`}
            </StatusChip>
          </div>
          <small>{deck.cardIds.length}/40 cards · {deck.bakuganIds.length}/3 Character · {deck.coreIds.length}/6 BakuCores</small>
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
  const { ready, decks, profile, setDecks, notify } = useApp();
  const router = useRouter();
  const online = useOnlineStatus();
  const [query, setQuery] = useState("");
  const [faction, setFaction] = useState("All");
  const [legality, setLegality] = useState("All");
  const [sort, setSort] = useState("Updated");
  const [view, setView] = useState<LibraryView>("grid");
  if (!ready) return <DeckLibrarySkeleton />;

  const allPublic = publicDecksFor(decks, profile.name);
  const reports = new Map<string, DeckValidationResult>(
    allPublic.map((deck): [string, DeckValidationResult] => [deck.id, validateDeck(deck)]),
  );
  const visible = allPublic.filter((deck) => {
    const report = reports.get(deck.id)!;
    const matchesQuery = !query || `${deck.name} ${deck.creator} ${deck.description} ${deck.factions.join(" ")} ${deckSetName(deck)}`.toLowerCase().includes(query.toLowerCase());
    const matchesFaction = faction === "All" || deck.factions.includes(faction);
    return matchesQuery && matchesFaction && (legality === "All" || (legality === "Legal" ? report.isLegal : !report.isLegal));
  }).sort((a, b) => {
    if (sort === "Name") return a.name.localeCompare(b.name);
    if (sort === "Set") return deckSetName(a).localeCompare(deckSetName(b));
    return Date.parse(b.publishedAt ?? b.updatedAt) - Date.parse(a.publishedAt ?? a.updatedAt);
  });
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
      {!online && (
        <DeckState
          tone="offline"
          role="status"
          title="Showing cached public decks"
          copy="Copying and newly published decks may be unavailable until the connection returns."
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
      />
      {visible.length ? (
        <CardGrid className={`${styles.deckGrid} ${styles[`deckGrid_${view}`]}`} minCardWidth="20rem">
          {visible.map((deck) => (
            <PublicDeckTile
              key={deck.id}
              deck={deck}
              report={reports.get(deck.id)!}
              view={view}
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
  onOpen,
  onCopy,
}: {
  deck: DeckRecord;
  report: DeckValidationResult;
  view: LibraryView;
  onOpen: () => void;
  onCopy: () => void;
}) {
  return (
    <Surface as="article" className={`${styles.deckCard} ${styles[`deckCard_${view}`]}`}>
      <button className={styles.deckCardMain} onClick={onOpen} aria-label={`View ${deck.name}`}>
        <CharacterFan deck={deck} compact={view === "list"} />
        <div className={styles.deckCardCopy}>
          <div className={styles.deckTitleRow}><h2 data-deck-name>{deck.name}</h2></div>
          <p>by {deck.creator ?? "Community Brawler"}</p>
          <div className={styles.chipRow}>
            <StatusChip tone="info">{deckSetName(deck).toUpperCase()}</StatusChip>
            <StatusChip tone={report.isLegal ? "success" : "danger"}>{report.isLegal ? "Legal" : "Invalid"}</StatusChip>
          </div>
          <small>{deck.factions.join(" • ")}</small>
          <small>Published {formatTimestamp(deck.publishedAt ?? deck.updatedAt)}</small>
        </div>
      </button>
      <div className={styles.deckCardActions}>
        <button onClick={onOpen}>View Deck</button>
        <button onClick={onCopy} disabled={!report.isLegal}>Copy to My Decks</button>
      </div>
    </Surface>
  );
}

export function PublicDeckDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const { decks, profile, setDecks, notify } = useApp();
  const deck = publicDecksFor(decks, profile.name).find((item) => item.id === id);
  if (!deck) return <MissingDeck id={id} publicDeck />;
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
  return (
    <DeckDetailPresentation
      deck={deck}
      publicView
      actions={(
        <>
          <ActionButton onClick={copy} disabled={!validateDeck(deck).isLegal}>Copy to My Decks</ActionButton>
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
}: {
  deck: DeckRecord;
  publicView?: boolean;
  actions: ReactNode;
}) {
  const report = validateDeck(deck);
  const bakugan = deck.bakuganIds.map((key) => BAKUGAN.find((item) => item.id === key)).filter(Boolean);
  const cards = [...new Set(deck.cardIds)].map((key) => ({
    card: CARD_BY_ID.get(key),
    count: deck.cardIds.filter((id) => id === key).length,
  })).filter((entry) => entry.card);
  const cores = deck.coreIds.map((key) => CORES.find((item) => item.id === key)).filter(Boolean);
  const typeCounts = cards.reduce<Record<string, number>>((counts, entry) => {
    counts[entry.card!.type] = (counts[entry.card!.type] ?? 0) + entry.count;
    return counts;
  }, {});
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
        <StatusChip>{deck.factions.join(" • ") || "No factions"}</StatusChip>
        {publicView && <span>Created by {deck.creator ?? "Community Brawler"}</span>}
        {!publicView && deck.sourceDeckId && <span>Copied from {deck.sourceCreator ?? "a public deck"}</span>}
      </div>
      <section className={styles.detailLayout}>
        <main>
          <Surface className={styles.detailPanel}>
            <div className={styles.panelHeading}><div><span>Team configuration</span><h2>Character Cards</h2></div><StatusChip>{bakugan.length}/3</StatusChip></div>
            <div className={styles.detailTeam}>
              {bakugan.map((item) => (
                <article key={item!.id}>
                  <img src={cardArtSource(item!.character, "full")} alt={item!.name} />
                  <strong>{item!.name}</strong>
                  <span>{item!.faction} · {item!.bPower}B · {item!.damage}D</span>
                </article>
              ))}
            </div>
            <div className={styles.coreStrip}>
              {cores.map((core, index) => (
                <div key={`${core!.id}-${index}`}><img src={core!.art} alt="" /><span>{core!.type}</span></div>
              ))}
            </div>
          </Surface>
          <Surface className={styles.detailPanel}>
            <div className={styles.panelHeading}><div><span>Construction</span><h2>Main Deck</h2></div><StatusChip>{deck.cardIds.length}/40</StatusChip></div>
            <div className={styles.detailCardList}>
              {cards.map(({ card, count }) => (
                <article key={card!.catalogId}>
                  <img src={cardArtSource(card!, "thumbnail")} alt="" />
                  <strong>{count}× {card!.displayName}</strong>
                  <span>{card!.type} · {card!.faction} · {card!.cost} Energy</span>
                </article>
              ))}
            </div>
          </Surface>
        </main>
        <aside className={styles.detailAside}>
          <ValidationPanel report={report} />
          <Surface className={styles.detailPanel}>
            <div className={styles.panelHeading}><h2>Breakdown</h2></div>
            <dl className={styles.breakdown}>
              {Object.entries(typeCounts).map(([cardType, count]) => <div key={cardType}><dt>{cardType}</dt><dd>{count}</dd></div>)}
              <div><dt>BakuCores</dt><dd>{deck.coreIds.length}</dd></div>
            </dl>
          </Surface>
        </aside>
      </section>
    </div>
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
  } = useApp();
  const source = id === "new" ? builderDeck : decks.find((item: DeckRecord) => item.id === id);
  const [deck, setDeck] = useState<DeckRecord>(() => clone(source ?? blankDraft(decks)));
  const [catalogueTab, setCatalogueTab] = useState<CatalogueTab>("cards");
  const [builderView, setBuilderView] = useState<BuilderView>("catalogue");
  const [query, setQuery] = useState("");
  const [faction, setFaction] = useState("All");
  const [type, setType] = useState("All");
  const [setCode, setSetCode] = useState("All");
  const [cost, setCost] = useState("All");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "error">("saved");

  useEffect(() => {
    setBuilderDeck(deck);
    setSaveState(storageHealth.status === "error" ? "error" : "saved");
  }, [deck, setBuilderDeck, storageHealth.status]);

  const commit = (next: DeckRecord) => {
    setSaveState("dirty");
    setDeck({
      ...next,
      leadCardId: next.leadCardId && next.cardIds.includes(next.leadCardId) ? next.leadCardId : next.cardIds[0],
      factions: [...new Set(next.bakuganIds.map((key) => BAKUGAN.find((item) => item.id === key)?.faction).filter(Boolean))] as string[],
    });
  };
  const report = useMemo(() => validateDeck(deck), [deck]);
  const grouped = useMemo(() => [...new Set(deck.cardIds)].map((key) => ({
    card: CARD_BY_ID.get(key),
    count: deck.cardIds.filter((candidate) => candidate === key).length,
  })).filter((entry): entry is { card: NonNullable<ReturnType<typeof CARD_BY_ID.get>>; count: number } => Boolean(entry.card)), [deck.cardIds]);
  const cards = CARDS.filter((card) => (
    card.type !== "Character"
    && (!query || `${card.displayName} ${card.effect}`.toLowerCase().includes(query.toLowerCase()))
    && (faction === "All" || card.factions.includes(faction as never))
    && (type === "All" || card.type === type)
    && (setCode === "All" || cardSetCode(card) === setCode)
    && (cost === "All" || card.cost === Number(cost))
  )).slice(0, 240);
  const characters = BAKUGAN.filter((item) => (
    (!query || item.name.toLowerCase().includes(query.toLowerCase()))
    && (faction === "All" || item.faction === faction)
  ));
  const cores = CORES.filter((item) => (
    (!query || item.name.toLowerCase().includes(query.toLowerCase()))
    && (type === "All" || item.type === type)
  ));
  const adjustCard = (key: string, amount: number) => {
    const next = [...deck.cardIds];
    const limit = deck.format === "singleton" ? 1 : 3;
    if (amount > 0 && next.length < 40 && next.filter((candidate) => candidate === key).length < limit) next.push(key);
    if (amount < 0) {
      const index = next.lastIndexOf(key);
      if (index >= 0) next.splice(index, 1);
    }
    commit({ ...deck, cardIds: next });
  };
  const toggleCharacter = (key: string) => commit({
    ...deck,
    bakuganIds: deck.bakuganIds.includes(key)
      ? deck.bakuganIds.filter((candidate) => candidate !== key)
      : deck.bakuganIds.length < 3 ? [...deck.bakuganIds, key] : deck.bakuganIds,
  });
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
  const save = () => {
    const latest = validateDeck(deck);
    if (!latest.isLegal) {
      notify(`Deck cannot be saved: ${latest.issues[0].message}`);
      return;
    }
    if (decks.length >= DECK_LIMIT && id === "new") {
      notify(`Deck limit reached (${DECK_LIMIT}).`);
      return;
    }
    const next = {
      ...deck,
      id: id === "new" ? deck.id : id,
      leadCardId: deck.leadCardId ?? deck.cardIds[0],
      updatedAt: new Date().toISOString(),
      revision: (deck.revision ?? 0) + 1,
    };
    setDecks((items: DeckRecord[]) => [next, ...items.filter((item) => item.id !== next.id)]);
    setSelectedDeckId(next.id);
    setBuilderDeck(null);
    setSaveState("saved");
    notify("Legal deck saved.");
    router.push(returnTo ?? `/decks/${encodeURIComponent(next.id)}`);
  };

  return (
    <section className={styles.builder}>
      <header className={styles.builderHeader}>
        <Link href={returnTo ?? "/decks"}>{returnTo ? "← Match setup" : "← My Decks"}</Link>
        <input aria-label="Deck name" value={deck.name} onChange={(event) => commit({ ...deck, name: event.target.value })} />
        <label>Format<select value={deck.format ?? "standard"} onChange={(event) => commit({ ...deck, format: event.target.value as DeckRecord["format"] })}><option value="standard">Standard</option><option value="singleton">Singleton</option></select></label>
        <label>Visibility<select value={deck.visibility} onChange={(event) => commit({ ...deck, visibility: event.target.value as DeckRecord["visibility"] })}><option>Private</option><option>Public</option></select></label>
        <StatusChip tone="info">{deckSetName(deck).toUpperCase()}</StatusChip>
        <StatusChip tone={report.isLegal ? "success" : "danger"}>{report.isLegal ? "Legal" : `${report.issues.length} issues`}</StatusChip>
        <span className={`${styles.saveState} ${styles[`saveState_${saveState}`]}`}>
          {saveState === "error" ? "Draft not saved" : saveState === "dirty" ? "Saving draft…" : "Draft saved locally"}
        </span>
        <ActionButton disabled={!report.isLegal || saveState === "error"} onClick={save}>Save Deck</ActionButton>
      </header>
      <Tabs className={styles.builderMobileTabs} label="Deck Builder sections">
        {(["team", "deck", "catalogue", "inspector"] as BuilderView[]).map((value) => (
          <button key={value} className={builderView === value ? "active" : ""} onClick={() => setBuilderView(value)}>
            {value === "team" ? "Team" : value === "deck" ? `Deck ${deck.cardIds.length}/40` : value === "catalogue" ? "Add Cards" : "Inspector"}
          </button>
        ))}
      </Tabs>
      <div className={styles.builderLayout}>
        <BuilderTeam
          deck={deck}
          report={report}
          hidden={builderView !== "team"}
          onInspect={setInspection}
          onRemoveCharacter={toggleCharacter}
          onRemoveCore={(key) => adjustCore(key, -1)}
        />
        <BuilderDeckList
          deck={deck}
          grouped={grouped}
          hidden={builderView !== "deck"}
          onAdjust={adjustCard}
          onInspect={setInspection}
        />
        <BuilderCatalogue
          tab={catalogueTab}
          setTab={(value) => { setCatalogueTab(value); setType("All"); }}
          query={query}
          setQuery={setQuery}
          faction={faction}
          setFaction={setFaction}
          type={type}
          setType={setType}
          setCode={setCode}
          setSetCode={setSetCode}
          cost={cost}
          setCost={setCost}
          cards={cards}
          characters={characters}
          cores={cores}
          deck={deck}
          hidden={builderView !== "catalogue"}
          onAdjustCard={adjustCard}
          onToggleCharacter={toggleCharacter}
          onAdjustCore={adjustCore}
          onInspect={setInspection}
        />
        <BuilderInspector inspection={inspection} hidden={builderView !== "inspector"} />
      </div>
      <footer className={styles.builderStatus}>
        <div><span>Team</span><strong>{deck.bakuganIds.length}/3</strong></div>
        <div><span>BakuCores</span><strong>{deck.coreIds.length}/6</strong></div>
        <div><span>Main Deck</span><strong>{deck.cardIds.length}/40</strong></div>
        <div><span>Legality</span><strong>{report.isLegal ? "Legal" : `${report.issues.length} issues`}</strong></div>
        <span>{saveState === "error" ? storageHealth.message : "Draft persists on this device while you build."}</span>
      </footer>
    </section>
  );
}

function BuilderTeam({
  deck,
  report,
  hidden,
  onInspect,
  onRemoveCharacter,
  onRemoveCore,
}: {
  deck: DeckRecord;
  report: DeckValidationResult;
  hidden: boolean;
  onInspect: (value: Inspection) => void;
  onRemoveCharacter: (id: string) => void;
  onRemoveCore: (id: string) => void;
}) {
  return (
    <aside className={`${styles.builderTeam} ${hidden ? styles.mobileHidden : ""}`}>
      <div className={styles.columnHeading}><span>Loadout</span><h2>Team & BakuCores</h2></div>
      <Surface className={styles.builderSection}>
        <div className={styles.panelHeading}><h3>Character Cards</h3><StatusChip>{deck.bakuganIds.length}/3</StatusChip></div>
        <div className={styles.teamSlots}>
          {Array.from({ length: 3 }, (_, index) => {
            const item = BAKUGAN.find((candidate) => candidate.id === deck.bakuganIds[index]);
            return item ? (
              <article key={item.id}>
                <button onClick={() => onInspect({ kind: "character", id: item.id })}><img src={cardArtSource(item.character, "full")} alt={item.name} /></button>
                <strong>{item.name}</strong><span>{item.faction}</span>
                <button onClick={() => onRemoveCharacter(item.id)}>Remove</button>
              </article>
            ) : <div className={styles.emptySlot} key={index}><span>{index + 1}</span><strong>Choose a Character</strong></div>;
          })}
        </div>
      </Surface>
      <Surface className={styles.builderSection}>
        <div className={styles.panelHeading}><h3>BakuCores</h3><StatusChip>{deck.coreIds.length}/6</StatusChip></div>
        <p className={styles.requirementText}>Required: {report.requiredCoreTypes.join(" · ") || "Select Character cards first"}</p>
        <div className={styles.builderCoreGrid}>
          {deck.coreIds.map((key, index) => {
            const item = CORES.find((candidate) => candidate.id === key)!;
            return (
              <article key={`${key}-${index}`}>
                <button onClick={() => onInspect({ kind: "core", id: item.id })}><img src={item.art} alt="" /></button>
                <strong>{item.type}</strong><button onClick={() => onRemoveCore(key)}>Remove</button>
              </article>
            );
          })}
          {Array.from({ length: 6 - deck.coreIds.length }, (_, index) => <div className={styles.emptyCore} key={index}>+</div>)}
        </div>
      </Surface>
      <ValidationPanel report={report} compact />
    </aside>
  );
}

function BuilderDeckList({
  deck,
  grouped,
  hidden,
  onAdjust,
  onInspect,
}: {
  deck: DeckRecord;
  grouped: Array<{ card: NonNullable<ReturnType<typeof CARD_BY_ID.get>>; count: number }>;
  hidden: boolean;
  onAdjust: (id: string, amount: number) => void;
  onInspect: (value: Inspection) => void;
}) {
  const energyCounts = Array.from({ length: 11 }, (_, cost) => ({
    cost,
    count: deck.cardIds.filter((id) => CARD_BY_ID.get(id)?.cost === cost).length,
  }));
  const maximum = Math.max(1, ...energyCounts.map((entry) => entry.count));
  return (
    <main className={`${styles.builderDeck} ${hidden ? styles.mobileHidden : ""}`}>
      <div className={styles.columnHeading}><span>Construction</span><h2>Main Deck</h2><StatusChip>{deck.cardIds.length}/40</StatusChip></div>
      <Surface className={styles.energyCurve}>
        <div className={styles.panelHeading}><h3>Energy curve</h3><span>{grouped.length} unique cards</span></div>
        <div>{energyCounts.map((entry) => <span key={entry.cost} title={`${entry.count} cards at ${entry.cost} Energy`}><i style={{ height: `${Math.max(5, (entry.count / maximum) * 100)}%` }} /><b>{entry.cost}</b></span>)}</div>
      </Surface>
      <div className={styles.builderCardList}>
        {grouped.length ? grouped.map(({ card, count }) => (
          <Surface as="article" className={styles.builderCardRow} key={card.catalogId} elevation="flat">
            <button className={styles.cardThumb} onClick={() => onInspect({ kind: "card", id: card.catalogId })}>
              <img src={cardArtSource(card, "thumbnail")} alt="" />
            </button>
            <button className={styles.cardIdentity} onClick={() => onInspect({ kind: "card", id: card.catalogId })}>
              <strong>{card.displayName}</strong><span>{cardSetCode(card)} · {card.type} · {card.faction} · {card.cost} Energy</span>
            </button>
            <div className={styles.quantity}>
              <button aria-label={`Remove ${card.displayName}`} onClick={() => onAdjust(card.catalogId, -1)}>−</button>
              <strong>{count}</strong>
              <button aria-label={`Add ${card.displayName}`} onClick={() => onAdjust(card.catalogId, 1)}>+</button>
            </div>
          </Surface>
        )) : (
          <DeckState title="Main Deck is empty" copy="Use the searchable catalogue to add 40 cards that share factions with your team." />
        )}
      </div>
    </main>
  );
}

function BuilderCatalogue({
  tab,
  setTab,
  query,
  setQuery,
  faction,
  setFaction,
  type,
  setType,
  setCode,
  setSetCode,
  cost,
  setCost,
  cards,
  characters,
  cores,
  deck,
  hidden,
  onAdjustCard,
  onToggleCharacter,
  onAdjustCore,
  onInspect,
}: {
  tab: CatalogueTab;
  setTab: (value: CatalogueTab) => void;
  query: string;
  setQuery: (value: string) => void;
  faction: string;
  setFaction: (value: string) => void;
  type: string;
  setType: (value: string) => void;
  setCode: string;
  setSetCode: (value: string) => void;
  cost: string;
  setCost: (value: string) => void;
  cards: typeof CARDS;
  characters: typeof BAKUGAN;
  cores: typeof CORES;
  deck: DeckRecord;
  hidden: boolean;
  onAdjustCard: (id: string, amount: number) => void;
  onToggleCharacter: (id: string) => void;
  onAdjustCore: (id: string, amount: number) => void;
  onInspect: (value: Inspection) => void;
}) {
  return (
    <section className={`${styles.builderCatalogue} ${hidden ? styles.mobileHidden : ""}`}>
      <div className={styles.columnHeading}><span>Card database</span><h2>Catalogue</h2></div>
      <Tabs className={styles.catalogueTabs} label="Catalogue sections">
        <button className={tab === "cards" ? "active" : ""} onClick={() => setTab("cards")}>Cards</button>
        <button className={tab === "characters" ? "active" : ""} onClick={() => setTab("characters")}>Character</button>
        <button className={tab === "cores" ? "active" : ""} onClick={() => setTab("cores")}>BakuCores</button>
      </Tabs>
      <Surface className={styles.catalogueFilters}>
        <Field className={styles.catalogueSearch} label="Search catalogue"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${tab}…`} /></Field>
        {tab !== "cores" && <Field label="Faction"><select value={faction} onChange={(event) => setFaction(event.target.value)}><option>All</option>{FACTIONS.map((value) => <option key={value}>{value}</option>)}</select></Field>}
        {tab === "cards" && <><Field label="Set"><select value={setCode} onChange={(event) => setSetCode(event.target.value)}><option>All</option>{(Object.values(CARD_SET_INFO) as Array<{ code: string; name: string }>).map((set) => <option value={set.code} key={set.code}>{set.name}</option>)}</select></Field><Field label="Type"><select value={type} onChange={(event) => setType(event.target.value)}><option>All</option>{["Action", "Flip", "Hero", "Evo"].map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="Cost"><select value={cost} onChange={(event) => setCost(event.target.value)}><option>All</option>{Array.from({ length: 11 }, (_, value) => <option key={value}>{value}</option>)}</select></Field></>}
        {tab === "cores" && <Field label="Type"><select value={type} onChange={(event) => setType(event.target.value)}><option>All</option>{["Fist", "Flaming Fist", "Shield", "Magic Shield", "Helix"].map((value) => <option key={value}>{value}</option>)}</select></Field>}
      </Surface>
      <div className={styles.catalogueResults}>
        {tab === "cards" && cards.map((card) => {
          const count = deck.cardIds.filter((id) => id === card.catalogId).length;
          const limit = deck.format === "singleton" ? 1 : 3;
          return (
            <Surface as="article" className={styles.cataloguePiece} key={card.catalogId} elevation="flat">
              <button onClick={() => onInspect({ kind: "card", id: card.catalogId })}><img src={cardArtSource(card, "thumbnail")} alt="" /></button>
              <button className={styles.catalogueIdentity} onClick={() => onInspect({ kind: "card", id: card.catalogId })}><strong>{card.displayName}</strong><span>{cardSetCode(card)} · {card.type} · {card.cost} Energy</span></button>
              <button disabled={count >= limit || deck.cardIds.length >= 40} onClick={() => onAdjustCard(card.catalogId, 1)}>{count ? `${count}/${limit}` : "+ Add"}</button>
            </Surface>
          );
        })}
        {tab === "characters" && characters.map((item) => (
          <Surface as="article" className={styles.cataloguePiece} key={item.id} elevation="flat">
            <button onClick={() => onInspect({ kind: "character", id: item.id })}><img src={cardArtSource(item.character, "thumbnail")} alt="" /></button>
            <button className={styles.catalogueIdentity} onClick={() => onInspect({ kind: "character", id: item.id })}><strong>{item.name}</strong><span>{item.faction} · {item.bPower}B · {item.damage}D</span></button>
            <button disabled={!deck.bakuganIds.includes(item.id) && deck.bakuganIds.length >= 3} onClick={() => onToggleCharacter(item.id)}>{deck.bakuganIds.includes(item.id) ? "Remove" : "+ Add"}</button>
          </Surface>
        ))}
        {tab === "cores" && cores.map((item) => (
          <Surface as="article" className={styles.cataloguePiece} key={item.id} elevation="flat">
            <button onClick={() => onInspect({ kind: "core", id: item.id })}><img src={item.art} alt="" /></button>
            <button className={styles.catalogueIdentity} onClick={() => onInspect({ kind: "core", id: item.id })}><strong>{item.name}</strong><span>{item.type}</span></button>
            <button disabled={deck.coreIds.length >= 6} onClick={() => onAdjustCore(item.id, 1)}>+ Add</button>
          </Surface>
        ))}
      </div>
    </section>
  );
}

function BuilderInspector({ inspection, hidden }: { inspection: Inspection | null; hidden: boolean }) {
  const card = inspection?.kind === "card" ? CARD_BY_ID.get(inspection.id) : undefined;
  const character = inspection?.kind === "character" ? BAKUGAN.find((item) => item.id === inspection.id) : undefined;
  const core = inspection?.kind === "core" ? CORES.find((item) => item.id === inspection.id) : undefined;
  const inspectedCard = card ?? character?.character;
  return (
    <aside className={`${styles.builderInspector} ${hidden ? styles.mobileHidden : ""}`}>
      <div className={styles.columnHeading}><span>Docked reference</span><h2>Inspector</h2></div>
      <Surface className={styles.inspectorPanel} elevation="overlay">
        {!inspection ? (
          <div className={styles.inspectorEmpty}><span>◇</span><h3>Select an item</h3><p>Choose a Character, BakuCore, or Main Deck card to inspect its full details.</p></div>
        ) : inspectedCard ? (
          <>
            <img className={styles.inspectorCardArt} src={cardArtSource(inspectedCard, "full")} alt={inspectedCard.displayName} />
            <div className={styles.inspectorCopy}>
              <span>{inspection.kind === "character" ? "Character Card" : `${inspectedCard.type} Card`}</span>
              <h3>{inspectedCard.displayName}</h3>
              <div className={styles.chipRow}><StatusChip tone="info">{inspectedCard.faction}</StatusChip><StatusChip>{cardSetCode(inspectedCard)}</StatusChip>{inspection.kind === "card" && <StatusChip>{inspectedCard.cost} Energy</StatusChip>}</div>
              {character && <p>{character.bPower}B · {character.damage}D · {character.character.coreTypes.join(" + ")}</p>}
              {inspectedCard.effect && <p>{inspectedCard.effect}</p>}
            </div>
          </>
        ) : core ? (
          <>
            <img className={styles.inspectorCoreArt} src={core.art} alt="" />
            <div className={styles.inspectorCopy}><span>BakuCore</span><h3>{core.name}</h3><StatusChip tone="info">{core.type}</StatusChip><p>Use this Core only when its type matches a Character-card indicator in the team.</p></div>
          </>
        ) : null}
      </Surface>
    </aside>
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
