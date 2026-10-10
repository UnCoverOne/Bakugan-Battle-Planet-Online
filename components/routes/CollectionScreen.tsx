"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BakuCoreArt } from "@/components/bakucore/BakuCoreArt";
import { ResponsiveCardImage } from "../cards/ResponsiveCardImage";
import { CardInspector } from "../cards/CardInspector";
import { CardGrid, Field, RouteHero, StatusChip, Surface, Tabs, ActionButton } from "../design-system/primitives";
import { CardFilterPanel } from "../filters/CardFilterPanel";
import { FilterPicker } from "../filters/FilterPicker";
import { CARDS, CORE_COMPENDIUM, RULE_ENTRIES } from "../../lib/data";
import { cardSetCode } from "../../lib/content/catalogue";
import { createCardFilterOptionCatalogue, type CardFilterFacet } from "../../lib/card-filters";
import { COMPENDIUM_SORTS, CORE_COMPENDIUM_SORTS, filterAndSortCompendiumCards, filterAndSortCompendiumCores, parseCompendiumState, parseCoreCompendiumState, selectedCompendiumCard, selectedCompendiumCore, type CardInspectorTab } from "../../lib/compendium";
import { collectionEntryForIds, coreCollectionIds, COLLECTION_QUANTITY_OPTIONS, COLLECTION_SORT_OPTIONS, type CollectionField } from "../../lib/collection";
import { PUBLISHED_RULINGS, GLOSSARY_ENTRIES, REFERENCE_REVIEWED_AT, type ReferenceEntry } from "../../lib/reference";
import { updateCollection } from "../../lib/collection";
import { useAppFields } from "../application/AppProvider";
import compendiumStyles from "./CompendiumScreen.module.css";
import styles from "./CollectionScreen.module.css";

import { collectionIdentityIndex } from "../../lib/catalogue-index";

const quantityKey = (field: CollectionField) => `collection${field[0].toUpperCase()}${field.slice(1)}`;
const quantityLabel = (field: CollectionField) => field[0].toUpperCase() + field.slice(1);
const allCollectionFilters = ["standard", "foil", "wishlist"] as const;
const ruleReferences: ReferenceEntry[] = RULE_ENTRIES.map((entry) => ({ ...entry, slug: entry.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), source: "Digital adaptation reference", sourceSection: entry.category, reviewedAt: REFERENCE_REVIEWED_AT }));
const cardArchiveSortOptions = COMPENDIUM_SORTS.map((value) => ({ value, label: value.replaceAll("-", " ") }));
const coreArchiveSortOptions = CORE_COMPENDIUM_SORTS.map((value) => ({ value, label: value.replaceAll("-", " ") }));

function countMatches(count: number, values: readonly string[]) {
  if (!values.length) return true;
  return values.some((value) => value === "1" ? count === 1 : value === "2" ? count === 2 : count >= 3);
}

export function CollectionScreen() {
  const searchParams = useSearchParams();
  const { authUser, requestAccountAccess, collection, setCollection, catalogueRevision } = useAppFields(["authUser", "requestAccountAccess", "collection", "setCollection", "catalogueRevision"]);
  const inspectorTrigger = useRef<HTMLElement | null>(null);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const activeTab = searchParams.get("collectionTab") === "cores" ? "cores" : "cards";
  const requestedInspectorTab = searchParams.get("tab");
  const inspectorTab: CardInspectorTab = requestedInspectorTab === "overview"
    || requestedInspectorTab === "rules"
    || requestedInspectorTab === "rulings"
    || requestedInspectorTab === "related"
    || requestedInspectorTab === "collection"
    ? requestedInspectorTab
    : "collection";
  const urlQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const deferredQuery = useDeferredValue(query);
  useEffect(() => { setQuery(urlQuery); }, [urlQuery]);
  const localParams = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (deferredQuery) params.set("q", deferredQuery); else params.delete("q");
    if (deferredQuery !== urlQuery) { params.delete("page"); params.delete("corePage"); }
    return params;
  }, [deferredQuery, searchParams, urlQuery]);
  const cardState = useMemo(() => parseCompendiumState(localParams.toString()), [localParams]);
  const coreState = useMemo(() => parseCoreCompendiumState(localParams.toString()), [localParams]);
  const identityIndex = useMemo(() => { void catalogueRevision; return collectionIdentityIndex(CARDS); }, [catalogueRevision]);
  const cardEntries = useMemo(() => new Map(identityIndex.representatives.map(card => [card.catalogId, collectionEntryForIds(collection, identityIndex.idsFor(card))])), [collection, identityIndex]);
  const filterOptions = useMemo(() => { void catalogueRevision; return createCardFilterOptionCatalogue(CARDS); }, [catalogueRevision]);
  const valuesFor = useCallback((field: CollectionField) => searchParams.getAll(quantityKey(field)), [searchParams]);
  const collectionSort = searchParams.get("collectionSort") ?? "collector";

  const navigate = useCallback((changes: Record<string, string | string[] | null>, path = "/collection") => {
    if ("q" in changes) setQuery(typeof changes.q === "string" ? changes.q : "");
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(changes)) {
      next.delete(key);
      if (Array.isArray(value)) value.forEach((item) => next.append(key, item));
      else if (value) next.set(key, value);
    }
    const query = next.toString();
    window.history.pushState(null, "", `${path}${query ? `?${query}` : ""}`);
  }, []);
  useEffect(() => {
    if (query === urlQuery) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(window.location.search);
      if (query) next.set("q", query); else next.delete("q");
      next.delete("page"); next.delete("corePage");
      window.history.replaceState(null, "", `/collection${next.size ? `?${next}` : ""}`);
    }, 180);
    return () => clearTimeout(timer);
  }, [query, urlQuery]);

  const cardResults = useMemo(() => {
    const representatives = identityIndex.representatives;
    const filtered = filterAndSortCompendiumCards(representatives, cardState);
    const selected = Object.fromEntries(allCollectionFilters.map((field) => [field, valuesFor(field)])) as Record<CollectionField, string[]>;
    const visible = filtered.filter((card) => {
      const entry = cardEntries.get(card.catalogId)!;
      return allCollectionFilters.every((field) => countMatches(entry[field], selected[field]));
    });
    if (collectionSort === "collector") return visible;
    const [field, direction] = collectionSort.split("-") as [CollectionField, "asc" | "desc"];
    return visible.toSorted((left, right) => {
      const a = cardEntries.get(left.catalogId)![field];
      const b = cardEntries.get(right.catalogId)![field];
      return (direction === "asc" ? a - b : b - a) || left.displayName.localeCompare(right.displayName);
    });
  }, [cardState, cardEntries, identityIndex, collectionSort, valuesFor]);

  const coreResults = useMemo(() => {
    const filtered = filterAndSortCompendiumCores(CORE_COMPENDIUM, coreState);
    const selected = Object.fromEntries(allCollectionFilters.map((field) => [field, valuesFor(field)])) as Record<CollectionField, string[]>;
    const visible = filtered.filter((core) => {
      const entry = collectionEntryForIds(collection, coreCollectionIds(core));
      return allCollectionFilters.every((field) => countMatches(entry[field], selected[field]));
    });
    if (collectionSort === "collector") return visible;
    const [field, direction] = collectionSort.split("-") as [CollectionField, "asc" | "desc"];
    return visible.toSorted((left, right) => {
      const a = collectionEntryForIds(collection, coreCollectionIds(left))[field];
      const b = collectionEntryForIds(collection, coreCollectionIds(right))[field];
      return (direction === "asc" ? a - b : b - a) || left.name.localeCompare(right.name);
    });
  }, [collection, collectionSort, coreState, valuesFor]);

  const pageSize = 24;
  const results = activeTab === "cards" ? cardResults : coreResults;
  const requestedPage = Number(searchParams.get(activeTab === "cards" ? "page" : "corePage") ?? "1");
  const pages = Math.max(1, Math.ceil(results.length / pageSize));
  const page = Math.min(Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1, pages);
  const visible = results.slice((page - 1) * pageSize, page * pageSize);
  const selected = activeTab === "cards" ? selectedCompendiumCard(CARDS, cardState.card) : null;
  const selectedCore = activeTab === "cores" ? selectedCompendiumCore(CORE_COMPENDIUM, coreState.core) : null;

  const changeCollection = useCallback((catalogId: string, field: CollectionField, delta: number) => {
    if (!authUser) return;
    setCollection((current: import("../../lib/collection").Collection) => updateCollection(current, catalogId, field, delta));
  }, [authUser, setCollection]);

  if (!authUser) {
    return <div className={compendiumStyles.route}><RouteHero eyebrow="PLAYER COLLECTION" title="Your collection" description="Track the physical cards and BakuCores you own, including foil copies and wishlist targets." /><Surface className={styles.guestCta}><span className={styles.guestGlyph}>◇</span><h2>Sign in to track your collection</h2><p>Your collection is private account data and is available across devices after you create an account or log in.</p><div className="hero-actions"><ActionButton onClick={() => requestAccountAccess("signup")}>Create account</ActionButton><ActionButton tone="secondary" onClick={() => requestAccountAccess("login")}>Log in</ActionButton></div></Surface></div>;
  }

  const selectedCard = selected ?? undefined;
  const closeInspector = () => navigate({ card: null, core: null, tab: null });
  const selectCard = (card: typeof CARDS[number]) => { inspectorTrigger.current = document.activeElement as HTMLElement; navigate({ collectionTab: "cards", card: card.slug ?? card.catalogId, core: null, tab: "collection" }); };
  const selectCore = (core: typeof CORE_COMPENDIUM[number]) => { inspectorTrigger.current = document.activeElement as HTMLElement; navigate({ collectionTab: "cores", core: core.catalogId ?? core.id, card: null, tab: "collection" }); };
  const pageParam = activeTab === "cards" ? "page" : "corePage";
  const setPage = (next: number) => navigate({ [pageParam]: next > 1 ? String(next) : null });
  const clearFilters = () => navigate({ q: null, set: null, type: null, coreType: null, faction: null, cost: null, rarity: null, keyword: null, coreSet: null, collectionSort: null, collectionStandard: null, collectionFoil: null, collectionWishlist: null, page: null, corePage: null });
  const setQuantityFilter = (field: CollectionField, values: string[]) => navigate({ [quantityKey(field)]: values, page: null, corePage: null });
  const renderCollectionFilterControls = () => (
    <>
      {activeTab === "cards" ? (
        <>
          <CardFilterPanel
            filters={cardState}
            facets={["type", "set", "faction", "cost", "rarity", "coreType", "keyword"] as CardFilterFacet[]}
            options={filterOptions}
            onChange={(next, facet) => navigate({ [facet]: next[facet], page: null })}
          />
          <div className={compendiumStyles.filterDivider} role="separator" />
          <FilterPicker
            label="Archive sort"
            values={[cardState.sort]}
            options={cardArchiveSortOptions}
            onChange={(values) => navigate({ sort: values[0] ?? "collector", page: null })}
            mode="single"
            clearable={false}
          />
        </>
      ) : (
        <>
          <FilterPicker
            label="Core type"
            values={coreState.type === "All" ? [] : [coreState.type]}
            options={["Fist", "Flaming Fist", "Shield", "Magic Shield", "Helix"].map((value) => ({ value, label: value }))}
            onChange={(values) => navigate({ coreType: values[0] ?? null, corePage: null })}
            mode="single"
          />
          <FilterPicker
            label="Set"
            values={coreState.set === "All" ? [] : [coreState.set]}
            options={["Battle Brawlers", "Armored Alliance"].map((value) => ({ value, label: value }))}
            onChange={(values) => navigate({ coreSet: values[0] ?? null, corePage: null })}
            mode="single"
          />
          <div className={compendiumStyles.filterDivider} role="separator" />
          <FilterPicker
            label="Archive sort"
            values={[coreState.sort]}
            options={coreArchiveSortOptions}
            onChange={(values) => navigate({ coreSort: values[0] ?? "collector", corePage: null })}
            mode="single"
            clearable={false}
          />
        </>
      )}
      <div className={compendiumStyles.filterDivider} role="separator" />
      <FilterPicker
        label="Collection sort"
        values={[collectionSort]}
        options={COLLECTION_SORT_OPTIONS.map((option) => ({ ...option }))}
        onChange={(values) => navigate({ collectionSort: values[0] === "collector" ? null : values[0], page: null, corePage: null })}
        mode="single"
        clearable={false}
      />
      <div className={compendiumStyles.filterDivider} role="separator" />
      {allCollectionFilters.map((field) => (
        <FilterPicker
          key={field}
          label={quantityLabel(field)}
          values={valuesFor(field)}
          options={COLLECTION_QUANTITY_OPTIONS.map((option) => ({ ...option }))}
          onChange={(values) => setQuantityFilter(field, values)}
        />
      ))}
    </>
  );

  return (
    <div className={compendiumStyles.route}>
      <RouteHero eyebrow="PLAYER COLLECTION" title="Your collection" description="Track every supported card and BakuCore outside the simulator. Alternate printings share a tile but retain separate catalogue counts." aside={<div className={compendiumStyles.sourceSummary}><strong>{cardResults.length.toLocaleString()} cards · {coreResults.length.toLocaleString()} BakuCores</strong><span>Synced to your account</span></div>} />
      <section className={`compendium-toolbar ${compendiumStyles.toolbar}`}>
        <Field className={compendiumStyles.search} label="Search your archive"><input value={query} placeholder="Cards, effects, IDs, mechanics…" onChange={(event) => setQuery(event.target.value)} /></Field>
        <Tabs label="Collection sections"><button type="button" className={activeTab === "cards" ? "active" : ""} onClick={() => navigate({ collectionTab: "cards", core: null, tab: null })}>CARDS</button><button type="button" className={activeTab === "cores" ? "active" : ""} onClick={() => navigate({ collectionTab: "cores", card: null, tab: null })}>BAKUCORES</button></Tabs>
      </section>
      <section className={compendiumStyles.resultsToolbar}><div><strong>{results.length.toLocaleString()} {activeTab === "cards" ? "cards" : "BakuCores"}</strong><span>Page {page} of {pages}</span></div><ActionButton className={compendiumStyles.mobileFilterButton} tone="secondary" onClick={() => setFilterSheetOpen(true)}>Filters</ActionButton><Tabs className={compendiumStyles.densityTabs} label="Gallery density"><button className={(activeTab === "cards" ? cardState.density : coreState.density) === "gallery" ? "active" : ""} onClick={() => navigate({ [activeTab === "cards" ? "density" : "coreDensity"]: "gallery" })}>Gallery</button><button className={(activeTab === "cards" ? cardState.density : coreState.density) === "compact" ? "active" : ""} onClick={() => navigate({ [activeTab === "cards" ? "density" : "coreDensity"]: "compact" })}>Compact</button></Tabs></section>
      <div className={compendiumStyles.workspace}>
        <Surface as="aside" className={compendiumStyles.filterRail} aria-label="Collection filters">
          <div className={compendiumStyles.filterHeading}><div><h2>Filters &amp; sort</h2></div><button type="button" onClick={clearFilters}>Clear</button></div>
          {renderCollectionFilterControls()}
        </Surface>
        <main className={compendiumStyles.gallery}>
          {activeTab === "cards" ? <CardGrid className={`${compendiumStyles.cardGrid} ${cardState.density === "compact" ? compendiumStyles.cardGridCompact : ""}`} minCardWidth={cardState.density === "compact" ? "9.25rem" : "11.5rem"}>{(visible as typeof CARDS).map((card) => { const entry = cardEntries.get(card.catalogId)!; return <CollectionCard key={card.catalogId} card={card} entry={entry} selected={selected?.catalogId === card.catalogId} onSelect={selectCard} onQuickChange={(field, delta) => changeCollection(card.catalogId, field, delta)} />; })}</CardGrid> : <CardGrid className={`${compendiumStyles.cardGrid} ${compendiumStyles.coreGrid} ${coreState.density === "compact" ? compendiumStyles.cardGridCompact : ""}`} minCardWidth={coreState.density === "compact" ? "9.25rem" : "11.5rem"}>{(visible as typeof CORE_COMPENDIUM).map((core) => { const entry = collectionEntryForIds(collection, coreCollectionIds(core)); return <CollectionCore key={core.id} core={core} entry={entry} selected={selectedCore?.id === core.id} onSelect={selectCore} onQuickChange={(field, delta) => changeCollection(core.catalogId ?? core.id, field, delta)} />; })}</CardGrid>}
          {!visible.length && <Surface className={compendiumStyles.emptyResults} role="status"><span>◇</span><h2>No collection items match</h2><p>Adjust the search or clear the active filters to return to the full archive.</p><ActionButton tone="secondary" onClick={clearFilters}>Clear filters</ActionButton></Surface>}
          <nav className={compendiumStyles.pagination} aria-label="Collection pages"><button disabled={page === 1} onClick={() => setPage(page - 1)}>← Previous</button><span>Page {page} of {pages}</span><button disabled={page === pages} onClick={() => setPage(page + 1)}>Next →</button></nav>
        </main>
        {selectedCard && <CardInspector card={selectedCard} allCards={CARDS} rules={[...ruleReferences, ...GLOSSARY_ENTRIES]} rulings={PUBLISHED_RULINGS} tab={inspectorTab} collectionEnabled collection={collection} onCollectionChange={changeCollection} onTabChange={(tab) => navigate({ tab })} onClose={closeInspector} returnFocusRef={inspectorTrigger} />}
        {selectedCore && <CardInspector core={selectedCore} allCores={CORE_COMPENDIUM} rules={[...ruleReferences, ...GLOSSARY_ENTRIES]} rulings={PUBLISHED_RULINGS} tab={inspectorTab} collectionEnabled collection={collection} onCollectionChange={changeCollection} onTabChange={(tab) => navigate({ tab })} onClose={closeInspector} returnFocusRef={inspectorTrigger} />}
      </div>
      {filterSheetOpen && <div className={compendiumStyles.filterBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFilterSheetOpen(false); }}><Surface as="aside" className={compendiumStyles.filterSheet} role="dialog" aria-modal="true" aria-label="Collection filters"><div className={compendiumStyles.filterHeading}><h2>Filters &amp; sort</h2><button type="button" onClick={() => setFilterSheetOpen(false)}>Close</button></div>{renderCollectionFilterControls()}<ActionButton onClick={() => setFilterSheetOpen(false)}>Show {results.length} items</ActionButton></Surface></div>}
    </div>
  );
}

function CollectionCard({ card, entry, selected, onSelect, onQuickChange }: { card: typeof CARDS[number]; entry: { standard: number; foil: number; wishlist: number }; selected: boolean; onSelect: (card: typeof CARDS[number]) => void; onQuickChange: (field: CollectionField, delta: number) => void }) {
  const owned = entry.standard + entry.foil;
  return <div className={`${styles.collectionTile} ${owned ? "" : styles.unowned} ${selected ? styles.collectionTileSelected : ""}`}><button className={`${compendiumStyles.cardTile} ${selected ? compendiumStyles.cardTileSelected : ""}`} type="button" aria-pressed={selected} onClick={() => onSelect(card)}><span className={compendiumStyles.cardArt}><span className={compendiumStyles.cardArtFrame}><ResponsiveCardImage card={card} presentation="tile" /></span></span><span className={compendiumStyles.cardCopy}><span className={compendiumStyles.cardBadges}><StatusChip tone="info">{card.faction}</StatusChip><StatusChip>{cardSetCode(card)}</StatusChip></span><strong>{card.displayName}</strong><small>{card.type} · {card.cost} Energy · {card.rarity}</small></span></button><CollectionFooter label={card.displayName} owned={owned} wishlist={entry.wishlist} standard={entry.standard} onQuickChange={onQuickChange} /></div>;
}

function CollectionCore({ core, entry, selected, onSelect, onQuickChange }: { core: typeof CORE_COMPENDIUM[number]; entry: { standard: number; foil: number; wishlist: number }; selected: boolean; onSelect: (core: typeof CORE_COMPENDIUM[number]) => void; onQuickChange: (field: CollectionField, delta: number) => void }) {
  const owned = entry.standard + entry.foil;
  return <div className={`${styles.collectionTile} ${owned ? "" : styles.unowned} ${selected ? styles.collectionTileSelected : ""}`}><button className={`${compendiumStyles.cardTile} ${compendiumStyles.coreTile} ${selected ? compendiumStyles.cardTileSelected : ""}`} type="button" aria-pressed={selected} onClick={() => onSelect(core)}><span className={compendiumStyles.coreArt}><BakuCoreArt core={core} alt={`${core.name} front`} /></span><span className={compendiumStyles.cardCopy}><span className={compendiumStyles.cardBadges}><StatusChip tone="info">{core.type}</StatusChip><StatusChip>{core.set === "Armored Alliance" ? "AA" : "BB"}</StatusChip></span><strong>{core.name}</strong><small>{core.set === "Armored Alliance" ? "AA" : "BB"} #{core.number}</small></span></button><CollectionFooter label={core.name} owned={owned} wishlist={entry.wishlist} standard={entry.standard} onQuickChange={onQuickChange} /></div>;
}

function CollectionFooter({ label, owned, wishlist, standard, onQuickChange }: { label: string; owned: number; wishlist: number; standard: number; onQuickChange: (field: CollectionField, delta: number) => void }) {
  return <div className={styles.collectionFooter}>
    <div className={styles.quickCounter} aria-label={`${label} owned copies`}>
      <button type="button" aria-label={`Decrease standard copies for ${label}`} disabled={!standard} onClick={() => onQuickChange("standard", -1)}>−</button>
      <span className={styles.collectionBadge}>{owned}</span>
      <button type="button" aria-label={`Increase standard copies for ${label}`} onClick={() => onQuickChange("standard", 1)}>+</button>
    </div>
    {wishlist > 0 && <span className={styles.collectionBadge} aria-label={`${label} wishlist copies`}>★ {wishlist}</span>}
  </div>;
}
