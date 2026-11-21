"use client";

import { builderScope, clearBuilderDraft } from "../../lib/builder-session";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { legalDeckFormats, validateDeck, type DeckFormat, type DeckRecord } from "../../lib/data";
import { DECK_LIMIT, decodeDeckCode, deckTextList, encodeDeckCode, uniqueDeckName } from "../../lib/deck-transfer";
import { deckSetName } from "../../lib/deck-set";
import { PROFILE_SHOWCASE_LIMIT, toggleShowcaseId } from "../../lib/profile-customization";
import { useAppFields } from "../application/AppProvider";
import { copyText, downloadTextFile } from "../application/ui";
import { ActionButton } from "../design-system/primitives";
import library from "./DeckLibrary.module.css";
import { type LibraryView, type DeckFormatFilter, DeckLibraryHeader, DeckLibrarySkeleton, DeckToolbar, DeckLibraryEmpty } from "./DeckLibraryPresentation";
import { DeckGalleryBody } from "./DeckGalleryCard";
import { useCompetitiveRules, clone, blankDraft, useOnlineStatus, DeckState } from "./DeckRouteShared";

export function DeckLibraryScreen() {
  const router = useRouter();
  const online = useOnlineStatus();
  const {
    ready,
    decks,
    setDecks,
    deckQuery,
    setDeckQuery,
    setBuilderDeck,
    storageHealth,
    notify,
    profile,
    setProfile,
    authUser,
  } = useAppFields(["ready", "decks", "setDecks", "deckQuery", "setDeckQuery", "setBuilderDeck", "storageHealth", "notify", "profile", "setProfile", "authUser"]);
  const [faction, setFaction] = useState("All");
  const [legality, setLegality] = useState("All");
  const [formatFilter, setFormatFilter] = useState<DeckFormatFilter>("all");
  const [sort, setSort] = useState("Updated");
  const [view, setView] = useState<LibraryView>("grid");
  const [importCode, setImportCode] = useState("");
  const [importError, setImportError] = useState("");
  const competitiveRules = useCompetitiveRules();
  const competitiveDeckSize = competitiveRules.deckSize;

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
    clearBuilderDraft(builderScope(authUser?.id), "new");
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
    <div className={library.route}>
      <div className={library.shell}>
        <DeckLibraryHeader section="mine" action={<button type="button" className={library.newButton} onClick={create} disabled={decks.length >= DECK_LIMIT} title={decks.length >= DECK_LIMIT ? `Deck limit reached (${DECK_LIMIT})` : "Create a deck"}>+ New Deck</button>} />
        {!online && <DeckState tone="offline" role="status" title="Working offline"
          copy="Device-local decks remain available. Cloud sync resumes when reconnected." />}
        {storageHealth.status === "error" && <DeckState tone="error" role="alert" title="Deck storage needs attention"
          copy={storageHealth.message} action={<ActionButton tone="quiet" onClick={() => location.reload()}>Retry storage</ActionButton>} />}
        <DeckToolbar query={deckQuery} setQuery={setDeckQuery} faction={faction} setFaction={setFaction}
          legality={legality} setLegality={setLegality} formatFilter={formatFilter} setFormatFilter={setFormatFilter}
          sort={sort} setSort={setSort} view={view} setView={setView} />
        <div className={library.libraryMeta}>
          <p className={library.count}>{decks.length} saved · {legalCount} legal · {decks.length - legalCount} need attention{visible.length !== decks.length ? ` · ${visible.length} shown` : ""}</p>
          <details className={library.importWrap}>
            <summary className={library.importToggle}>Import deck code</summary>
            <div className={library.importPanel}>
              <h3>Import a deck</h3>
              <p>Paste a compatible BBP1 deck code to add it to your library.</p>
              <textarea aria-label="Deck import code" value={importCode} onChange={(event) => setImportCode(event.target.value)} placeholder="BBP1.…"/>
              {importError && <p className={library.importError} role="alert">{importError}</p>}
              <div className={library.importActions}><button type="button" disabled={!importCode.trim() || decks.length >= DECK_LIMIT} onClick={importDeck}>Validate & Import</button></div>
            </div>
          </details>
        </div>
        {decks.length === 0 ? <DeckLibraryEmpty title="Build your first deck" message="Choose three Character cards, their BakuCores, and a Main Deck."
          action={<button type="button" onClick={create}>Create a deck</button>} />
        : visible.length === 0 ? <DeckLibraryEmpty title="No decks match" message="Try another search or remove some filters."
          action={<button type="button" onClick={() => {setDeckQuery("");setFaction("All");setFormatFilter("all");setLegality("All");}}>Clear all filters</button>} />
        : <div className={`${library.grid} ${view === "list" ? library.gridList : ""}`}>
          {visible.map((deck: DeckRecord) => <DeckTile
            key={deck.id} deck={deck} legalFormats={compatibility.get(deck.id) ?? []}
            showcased={deck.visibility === "Public" && (profile.showcaseDeckIds ?? []).includes(deck.id)}
            onEdit={() => router.push(`/builder/${encodeURIComponent(deck.id)}`)}
            onDuplicate={() => duplicate(deck)} onDelete={() => remove(deck)}
            onToggleShowcase={() => toggleDeckShowcase(deck)} />
          )}
        </div>}
      </div>
    </div>
  );
}

function DeckTile({
  deck, legalFormats, showcased, onEdit, onDuplicate, onDelete, onToggleShowcase,
}: {
  deck: DeckRecord; legalFormats: DeckFormat[]; showcased: boolean;
  onEdit: () => void; onDuplicate: () => void; onDelete: () => void;
  onToggleShowcase: () => void;
}) {
  const href = `/decks/${encodeURIComponent(deck.id)}`;
  return <article className={library.card}>
    <div className={library.cardMain}><DeckGalleryBody deck={deck} href={href} legalFormats={legalFormats}
      creatorName="" personal /></div>
    <footer className={library.cardFooter}>
      <span className={library.cardHint}>{deck.visibility}</span>
      <div className={library.cardActions}>
        <Link href={href}>View</Link>
        <button type="button" className={library.editAction} onClick={onEdit}>Edit</button>
        <details className={library.moreWrap}>
          <summary className={library.moreToggle} aria-label={`More actions for ${deck.name}`}>⋯</summary>
          <div className={library.moreMenu}>
            <button type="button" onClick={onDuplicate}>Duplicate</button>
            <button type="button" onClick={() => downloadTextFile(`${deck.name}.txt`, deckTextList(deck))}>Export text list</button>
            <button type="button" onClick={() => void copyText(encodeDeckCode(deck))}>Copy deck code</button>
            {deck.visibility === "Public" && <button type="button" onClick={onToggleShowcase}>{showcased ? "Remove from showcase" : "Showcase on Profile"}</button>}
            <button type="button" className={library.danger} onClick={onDelete}>Delete</button>
          </div>
        </details>
      </div>
    </footer>
  </article>;
}
