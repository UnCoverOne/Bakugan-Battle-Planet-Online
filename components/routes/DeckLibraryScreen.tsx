"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { legalDeckFormats, validateDeck, type DeckFormat, type DeckRecord } from "../../lib/data";
import type { DeckValidationResult } from "../../lib/deck-validation";
import { DECK_LIMIT, decodeDeckCode, deckTextList, encodeDeckCode, uniqueDeckName } from "../../lib/deck-transfer";
import { deckSetName } from "../../lib/deck-set";
import { PROFILE_SHOWCASE_LIMIT, toggleShowcaseId } from "../../lib/profile-customization";
import { useAppFields } from "../application/AppProvider";
import { copyText, downloadTextFile, formatTimestamp } from "../application/ui";
import { ActionButton, CardGrid, StatusChip, Surface } from "../design-system/primitives";
import { DeckCreatorIdentity } from "../profile/DeckCreatorIdentity";
import styles from "./DeckRoutes.module.css";
import { type LibraryView, type DeckFormatFilter, DeckAreaHeader, DeckLibrarySkeleton, DeckToolbar, CharacterFan, DeckFactionSymbols } from "./DeckLibraryPresentation";
import { deckFormatLabel, useCompetitiveRules, clone, blankDraft, useOnlineStatus, DeckState } from "./DeckRouteShared";

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
    authUser,
  } = useAppFields(["ready", "decks", "setDecks", "deckQuery", "setDeckQuery", "selectedDeckId", "setSelectedDeckId", "setBuilderDeck", "storageHealth", "notify", "profile", "setProfile", "authUser"]);
  const [faction, setFaction] = useState("All");
  const [legality, setLegality] = useState("All");
  const [formatFilter, setFormatFilter] = useState<DeckFormatFilter>("all");
  const [sort, setSort] = useState("Updated");
  const [view, setView] = useState<LibraryView>("grid");
  const [importCode, setImportCode] = useState("");
  const [importError, setImportError] = useState("");
  const competitiveRules = useCompetitiveRules();
  const competitiveDeckSize = competitiveRules.deckSize;

  const reports = useMemo(
    () => new Map<string, DeckValidationResult>(
      decks.map((deck: DeckRecord): [string, DeckValidationResult] => [
        deck.id,
        validateDeck(deck, competitiveRules.restrictions, competitiveRules.deckSize),
      ]),
    ),
    [competitiveRules.deckSize, competitiveRules.restrictions, decks],
  );
  const compatibility = useMemo(
    () => new Map<string, DeckFormat[]>(
      decks.map((deck: DeckRecord): [string, DeckFormat[]] => [
        deck.id,
        legalDeckFormats(deck, competitiveRules.restrictions, competitiveRules.deckSize),
      ]),
    ),
    [competitiveRules.deckSize, competitiveRules.restrictions, decks],
  );
  const legalCount = [...compatibility.values()].filter((formats) => formats.length > 0).length;
  const visible = useMemo(() => decks.filter((deck: DeckRecord) => {
    const text = `${deck.name} ${deck.factions.join(" ")} ${deck.tags?.join(" ") ?? ""} ${deckSetName(deck)}`.toLowerCase();
    const queryMatch = !deckQuery.trim() || text.includes(deckQuery.trim().toLowerCase());
    const factionMatch = faction === "All" || deck.factions.includes(faction);
    const legalFormats = compatibility.get(deck.id) ?? [];
    const legal = legalFormats.length > 0;
    const formatMatch = formatFilter === "all" || legalFormats.includes(formatFilter);
    return queryMatch && factionMatch && formatMatch && (legality === "All" || (legality === "Legal" ? legal : !legal));
  }).sort((a: DeckRecord, b: DeckRecord) => {
    if (sort === "Name") return a.name.localeCompare(b.name);
    if (sort === "Set") return deckSetName(a).localeCompare(deckSetName(b));
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  }), [compatibility, deckQuery, decks, faction, formatFilter, legality, sort]);

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
      const report = validateDeck(imported, [], competitiveDeckSize);
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
        formatFilter={formatFilter}
        setFormatFilter={setFormatFilter}
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
          copy={`Choose three Character cards, their six BakuCores, and a legal 40-card Standard or ${competitiveDeckSize}-card Competitive Main Deck.`}
          action={<ActionButton onClick={create}>Create Deck</ActionButton>}
        />
      ) : visible.length === 0 ? (
        <DeckState
          title="No decks match these filters"
          copy="Change the search, faction, format, legality, or sort controls to return to your arsenal."
          action={<ActionButton tone="quiet" onClick={() => { setDeckQuery(""); setFaction("All"); setFormatFilter("all"); setLegality("All"); }}>Clear filters</ActionButton>}
        />
      ) : (
        <CardGrid className={`${styles.deckGrid} ${styles[`deckGrid_${view}`]}`} minCardWidth="20rem">
          {visible.map((deck: DeckRecord) => (
            <DeckTile
              key={deck.id}
              deck={deck}
              report={reports.get(deck.id)!}
              legalFormats={compatibility.get(deck.id) ?? []}
              competitiveDeckSize={competitiveDeckSize}
              selected={selectedDeckId === deck.id}
              showcased={
                deck.visibility === "Public" &&
                (profile.showcaseDeckIds ?? []).includes(deck.id)
              }
              creatorUserId={deck.sourceDeckId ? deck.sourceCreatorUserId : authUser?.id}
              creatorDisplayName={deck.sourceDeckId ? deck.sourceCreator ?? "Community Brawler" : profile.name}
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

function DeckTile({
  deck,
  report,
  legalFormats,
  competitiveDeckSize = 50,
  selected,
  showcased,
  creatorUserId,
  creatorDisplayName,
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
  legalFormats: DeckFormat[];
  competitiveDeckSize?: number;
  selected: boolean;
  showcased: boolean;
  creatorUserId?: string;
  creatorDisplayName: string;
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
          <p>
            Created by{" "}
            <DeckCreatorIdentity userId={creatorUserId} displayName={creatorDisplayName} />
          </p>
          <div className={styles.chipRow}>
            <StatusChip tone="info">{deckSetName(deck).toUpperCase()}</StatusChip>
            <StatusChip tone={legalFormats.length ? "success" : "danger"}>
              {legalFormats.length ? "Legal" : `${report.issues.length} issues`}
            </StatusChip>
          </div>
          <DeckFactionSymbols factions={deck.factions} />
          <small>{legalFormats.length ? `Legal formats: ${legalFormats.map(deckFormatLabel).join(" · ")}` : `Preferred format: ${deckFormatLabel(deck.format ?? "standard")}`}</small>
          <small>{deck.cardIds.length}/{deck.format === "competitive" ? competitiveDeckSize : 40} cards · {deck.bakuganIds.length}/3 Character · {deck.coreIds.length}/6 BakuCores</small>
          <small>Updated {formatTimestamp(deck.updatedAt)}</small>
        </div>
      </button>
      <div className={styles.deckCardActions}>
        <button onClick={onSelect} disabled={!legalFormats.length || selected}>
          {selected ? "Selected" : legalFormats.length ? "Select for Play" : "Fix to select"}
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
