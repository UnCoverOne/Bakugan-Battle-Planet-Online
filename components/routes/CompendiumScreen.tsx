"use client";

import { OfficialRulebook } from "./OfficialRulebook";
import { GlossaryScreen } from "./GlossaryScreen";
import { RulingsReference } from "./RulingsReference";
import { CompendiumPagination } from "./CompendiumPagination";
import { FusionSymbol } from "@/components/media/FusionSymbol";
import { BakuCoreArt } from "@/components/bakucore/BakuCoreArt";

import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { compendiumLocation, compendiumSectionHref, type CompendiumSection } from "../../lib/compendium-navigation";
import { CardInspector } from "../cards/CardInspector";
import { ResponsiveCardImage } from "../cards/ResponsiveCardImage";
import { BakuganRollingOverlay } from "../cards/BakuganRollingStats";
import {
  COMPENDIUM_PAGE_SIZE,
  CORE_COMPENDIUM_PAGE_SIZE,
  coreCompendiumSearchParams,
  compendiumSearchParams,
  filterAndSortCompendiumCores,
  filterAndSortCompendiumCards,
  parseCoreCompendiumState,
  parseCompendiumState,
  selectedCompendiumCore,
  selectedCompendiumCard,
  type CardInspectorTab,
  type CoreCompendiumState,
  type CompendiumState,
} from "../../lib/compendium";
import { CARDS, CORE_COMPENDIUM, RULE_ENTRIES } from "../../lib/data";
import { updateCollection, type CollectionField } from "../../lib/collection";
import { cardSetCode } from "../../lib/content/catalogue";
import { GLOSSARY_ENTRIES, PUBLISHED_RULINGS, REFERENCE_REVIEWED_AT } from "../../lib/reference";
import { useAppFields } from "../application/AppProvider";
import { copyText } from "../application/ui";
import { ActionButton, CardGrid, StatusChip, Surface } from "../design-system/primitives";
import { CompendiumFieldPicker } from "./CompendiumFieldPicker";
import type { CardFilterOption as FilterOption } from "../../lib/card-filters";
import {
  activeCardFilterCount,
  CARD_FILTER_LABELS,
  CORE_SET_OPTIONS,
  CORE_TYPE_OPTIONS,
  createCardFilterOptionCatalogue,
  type CardFilterFacet,
  type CardFilterOptionCatalogue,
} from "../../lib/card-filters";
import { SORT_LABELS, CHARACTER_SORTS, NON_CHARACTER_SORTS, CORE_SORT_LABELS } from "../../lib/catalogue-sorting";
import { coreForSet, corePreviewStats } from "../../lib/core-preview";
import styles from "./CompendiumScreen.module.css";
import { CompendiumToolbar } from "./CompendiumToolbar";
import { CompendiumSidebar } from "./CompendiumSidebar";

const SEARCH_URL_DEBOUNCE_MS = 450;

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const CORE_SORT_OPTIONS: FilterOption[] = Object.entries(CORE_SORT_LABELS)
  .map(([value, label]) => ({ value, label }));

type FilterKey = CardFilterFacet;
type StatePatch = Partial<CompendiumState>;

const ruleReferences = [
  ...RULE_ENTRIES.map((entry) => ({
    ...entry,
    slug: slug(entry.title),
    source: "Digital adaptation reference",
    sourceSection: entry.category,
    reviewedAt: REFERENCE_REVIEWED_AT,
  })),
  ...GLOSSARY_ENTRIES,
];

function FilterControls({
  state, filterOptions, onChange, onSortChange,
}: {
  state: CompendiumState;
  filterOptions: CardFilterOptionCatalogue;
  onChange: (key: FilterKey, values: string[]) => void;
  onSortChange: (sort: CompendiumState["sort"]) => void;
}) {
  const characterOnly = state.type.length === 1 && state.type[0] === "Character";
  const hasCharacter = state.type.includes("Character");
  const hasStats = hasCharacter || state.type.includes("Evo");
  const sorts = Object.entries(SORT_LABELS).filter(([value]) =>
    (characterOnly ? CHARACTER_SORTS : NON_CHARACTER_SORTS).has(value as CompendiumState["sort"]));
  const selectedSort = sorts.some(([value]) => value === state.sort) ? state.sort : "collector";
  const fields: CardFilterFacet[] = [
    ...(characterOnly ? ["coreType" as const] : []),
    ...(hasStats ? ["bPower" as const, "damage" as const] : []),
    "faction", "set",
    ...(!characterOnly ? ["rarity" as const, "cost" as const] : []),
    "keyword",
  ];
  const info: Partial<Record<CardFilterFacet, string>> = {
    type: "Card Type determines the available sorting options and conditional filters.",
    coreType: "Available only when Character is the sole selected card type.",
    bPower: "Available when Character and/or Evo cards are selected.",
    damage: "Available when Character and/or Evo cards are selected.",
    rarity: "Not available when only Character cards are selected.",
    cost: "Not available when only Character cards are selected.",
  };
  const label: Partial<Record<CardFilterFacet, string>> = {
    type: "Card Type", coreType: "BakuCores", bPower: "B Power", cost: "Cost",
  };
  const picker = (facet: CardFilterFacet) => (
    <CompendiumFieldPicker key={facet} label={label[facet] ?? CARD_FILTER_LABELS[facet]} values={state[facet]} options={filterOptions[facet]}
      searchable={["set", "bPower", "damage", "keyword"].includes(facet)}
      info={info[facet]} onChange={(values) => onChange(facet, values)} />
  );
  return <>
    {picker("type")}
    <CompendiumFieldPicker label="Sort By" values={[selectedSort]} mode="single" clearable={false}
      options={sorts.map(([value, label]) => ({ value, label }))}
      onChange={(values) => { if (values[0]) onSortChange(values[0] as CompendiumState["sort"]); }} />
    {fields.map(picker)}
  </>;
}

function CoreFilterControls({
  state, onChange, onSortChange,
}: {
  state: CoreCompendiumState;
  onChange: (patch: Partial<CoreCompendiumState>) => void;
  onSortChange: (sort: CoreCompendiumState["sort"]) => void;
}) {
  return <>
    <CompendiumFieldPicker label="Core Type" values={state.type === "All" ? [] : [state.type]}
      options={CORE_TYPE_OPTIONS} mode="single"
      onChange={(values) => onChange({ type: values[0] ?? "All" })} />
    <CompendiumFieldPicker label="Sort By" values={[state.sort]} options={CORE_SORT_OPTIONS}
      mode="single" clearable={false}
      onChange={(values) => { if (values[0]) onSortChange(values[0] as CoreCompendiumState["sort"]); }} />
    <CompendiumFieldPicker label="Set" values={state.set === "All" ? [] : [state.set]}
      options={CORE_SET_OPTIONS} mode="single"
      onChange={(values) => onChange({ set: values[0] ?? "All" })} />
  </>;
}



export function CompendiumScreen({ segments = [] }: { segments?: string[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setCompendiumTab, authUser, notify, collection, setCollection, catalogueRevision } = useAppFields(["setCompendiumTab", "authUser", "notify", "collection", "setCollection", "catalogueRevision"]);
  const changeCollection = useCallback((catalogId: string, field: CollectionField, delta: number) => {
    if (!authUser) return;
    setCollection((current) => updateCollection(current, catalogId, field, delta));
  }, [authUser, setCollection]);
  const { section, legacyDetail } = compendiumLocation(pathname, segments);
  const state = useMemo(() => parseCompendiumState(searchParams.toString()), [searchParams]);
  const coreState = useMemo(() => parseCoreCompendiumState(searchParams.toString()), [searchParams]);
  const [searchQuery, setSearchQuery] = useState(state.q);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebarVisible, setDesktopSidebarVisible] = useState(true);
  const [viewMessage, setViewMessage] = useState("");
  const sidebarTrigger = useRef<HTMLButtonElement>(null);
  const resultsStartRef = useRef<HTMLElement>(null);
  const inspectorTrigger = useRef<HTMLElement | null>(null);
  const localSearchEditRef = useRef(false);
  const searchTimerRef = useRef<number | null>(null);

  const handleSearchChange = useCallback((value: string) => {
    localSearchEditRef.current = true;
    setSearchQuery(value);
  }, []);

  const filterOptions = useMemo(() => createCardFilterOptionCatalogue(CARDS), [catalogueRevision]);
  const searchState = useMemo(
    () => ({ ...state, q: deferredSearchQuery }),
    [deferredSearchQuery, state],
  );
  const cards = useMemo(
    () => section === "cards" ? filterAndSortCompendiumCards(CARDS, searchState) : [],
    [searchState, section, catalogueRevision],
  );
  const cores = useMemo(
    () => section === "cores" ? filterAndSortCompendiumCores(CORE_COMPENDIUM, { ...coreState, q: deferredSearchQuery }) : [],
    [coreState, deferredSearchQuery, section],
  );
  const pages = Math.max(1, Math.ceil(cards.length / COMPENDIUM_PAGE_SIZE));
  const page = Math.min(state.page, pages);
  const visible = cards.slice((page - 1) * COMPENDIUM_PAGE_SIZE, page * COMPENDIUM_PAGE_SIZE);
  const corePages = Math.max(1, Math.ceil(cores.length / CORE_COMPENDIUM_PAGE_SIZE));
  const corePage = Math.min(coreState.page, corePages);
  const visibleCores = cores.slice((corePage - 1) * CORE_COMPENDIUM_PAGE_SIZE, corePage * CORE_COMPENDIUM_PAGE_SIZE);
  const selected = section === "cards" ? selectedCompendiumCard(CARDS, state.card || legacyDetail) : null;
  const selectedCore = section === "cores" ? selectedCompendiumCore(CORE_COMPENDIUM, coreState.core) : null;
  const normalized = deferredSearchQuery.trim().toLowerCase();

  const urlFor = useCallback((next: CompendiumState, path = "/compendium") => {
    const query = compendiumSearchParams(next).toString();
    return query ? `${path}?${query}` : path;
  }, []);

  const coreUrlFor = useCallback((next: CoreCompendiumState, path = "/compendium/cores") => {
    const query = coreCompendiumSearchParams(next).toString();
    return query ? `${path}?${query}` : path;
  }, []);

  const navigate = useCallback((patch: StatePatch, options: { push?: boolean; resetPage?: boolean; scroll?: boolean } = {}) => {
    const next = {
      ...state,
      q: searchQuery,
      ...patch,
      page: options.resetPage ? 1 : patch.page ?? state.page,
    };
    const method = options.push ? "push" : "replace";
    window.history[method === "push" ? "pushState" : "replaceState"](null, "", urlFor(next));
    if (options.scroll) window.scrollTo({ top: 0 });
  }, [searchQuery, state, urlFor]);

  const navigateCore = useCallback((patch: Partial<CoreCompendiumState>, options: { push?: boolean; resetPage?: boolean; scroll?: boolean } = {}) => {
    const next = {
      ...coreState,
      q: searchQuery,
      ...patch,
      page: options.resetPage ? 1 : patch.page ?? coreState.page,
    };
    const method = options.push ? "push" : "replace";
    window.history[method === "push" ? "pushState" : "replaceState"](null, "", coreUrlFor(next));
    if (options.scroll) window.scrollTo({ top: 0 });
  }, [coreState, coreUrlFor, searchQuery]);

  const changeResultsPage = (nextPage: number, kind: "cards" | "cores") => {
    if (kind === "cards") navigate({ page: nextPage }, { push: true });
    else navigateCore({ page: nextPage }, { push: true });
    window.requestAnimationFrame(() => resultsStartRef.current?.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    }));
  };

  const closeInspector = useCallback(() => {
    navigate({ card: "", tab: "overview" });
  }, [navigate]);

  useEffect(() => {
    setCompendiumTab(section);
    setSidebarOpen(false);
  }, [section, setCompendiumTab]);
  useEffect(() => {
    const onPopState = () => {
      localSearchEditRef.current = false;
      if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    const currentQuery = section === "cores" ? coreState.q : state.q;
    if (searchQuery === currentQuery) {
      localSearchEditRef.current = false;
      return;
    }
    if (localSearchEditRef.current) return;
    setSearchQuery(currentQuery);
  }, [coreState.q, searchQuery, section, state.q]);
  useEffect(() => {
    const currentQuery = section === "cores" ? coreState.q : state.q;
    if (!localSearchEditRef.current || searchQuery === currentQuery) return;
    searchTimerRef.current = window.setTimeout(() => {
      if (!localSearchEditRef.current || compendiumLocation(window.location.pathname).section !== section) return;
      const params = new URLSearchParams(window.location.search);
      if (searchQuery) params.set("q", searchQuery); else params.delete("q");
      const path = section === "cores"
        ? coreUrlFor({ ...coreState, q: searchQuery, page: 1 })
        : section === "cards" ? urlFor({ ...state, q: searchQuery, page: 1 })
        : `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`;
      startTransition(() => window.history.replaceState(null, "", path));
    }, SEARCH_URL_DEBOUNCE_MS);
    return () => { if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current); };
  }, [coreState, coreUrlFor, searchQuery, section, state, urlFor]);
  useEffect(() => {
    if (legacyDetail && !state.card) {
      window.history.replaceState(null, "", urlFor({ ...state, card: legacyDetail, tab: "overview" }));
    }
  }, [legacyDetail, state, urlFor]);
  useEffect(() => {
    if (section !== "cards" || searchQuery !== state.q) return;
    if (state.page > pages) navigate({ page: pages });
  }, [navigate, pages, searchQuery, section, state.page, state.q]);
  useEffect(() => {
    if (section !== "cores" || searchQuery !== coreState.q) return;
    if (coreState.page > corePages) navigateCore({ page: corePages });
  }, [corePage, corePages, coreState.page, coreState.q, navigateCore, searchQuery, section]);
  useEffect(() => {
    const closeOverlays = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (sidebarOpen) setSidebarOpen(false);
      else if (selectedCore) navigateCore({ core: "" });
    };
    addEventListener("keydown", closeOverlays);
    return () => removeEventListener("keydown", closeOverlays);
  }, [closeInspector, sidebarOpen, navigateCore, selected, selectedCore]);

  const activeFilterCount = activeCardFilterCount(state);
  const activeCoreFilterCount = (["set", "type"] as const)
    .filter((key) => coreState[key] !== "All").length;
  const isCatalogue = section === "cards" || section === "cores";
  const activeCount = section === "cards" ? activeFilterCount : section === "cores" ? activeCoreFilterCount : 0;
  const density = section === "cores" ? coreState.density : state.density;

  const setFilter = (key: FilterKey, values: string[]) => {
    if (key !== "type") return navigate({ [key]: values } as StatePatch, { resetPage: true });

    const includesCharacter = values.includes("Character");
    const nextIsCharacterOnly = values.length === 1 && includesCharacter;
    const nextSorts = nextIsCharacterOnly ? CHARACTER_SORTS : NON_CHARACTER_SORTS;
    const patch: StatePatch = {
      type: values,
      ...(!nextIsCharacterOnly ? { coreType: [] } : {}),
      ...(!includesCharacter && !values.includes("Evo") ? { bPower: [], damage: [] } : {}),
      ...(nextIsCharacterOnly ? { cost: [], rarity: [] } : {}),
      ...(nextSorts.has(state.sort) ? {} : { sort: "collector" }),
    };
    navigate(patch, { resetPage: true });
  };
  const clearFilters = () => navigate({
    set: [],
    type: [],
    coreType: [],
    bPower: [],
    damage: [],
    faction: [],
    cost: [],
    rarity: [],
    keyword: [],
  }, { resetPage: true });
  const clearCoreFilters = () => navigateCore({
    set: "All",
    type: "All",
  }, { resetPage: true });
  const selectCard = (card: typeof CARDS[number], trigger?: HTMLElement | null) => {
    inspectorTrigger.current = trigger ?? inspectorTrigger.current;
    navigate({ card: card.slug ?? card.catalogId, tab: "overview" }, { push: true });
  };
  const selectCore = (core: typeof CORE_COMPENDIUM[number], trigger?: HTMLElement | null) => {
    inspectorTrigger.current = trigger ?? inspectorTrigger.current;
    navigateCore({ core: core.catalogId ?? core.id }, { push: true });
  };
  const copyCurrentLink = async (label: string) => {
    const path = section === "cores"
      ? coreUrlFor({ ...coreState, q: searchQuery })
      : urlFor({ ...state, q: searchQuery });
    await copyText(`${location.origin}${path}`);
    notify(`${label} link copied.`);
  };
  const switchSection = (next: CompendiumSection) => {
    if (next === section) return;
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    localSearchEditRef.current = false;
    window.history.pushState(null, "", compendiumSectionHref(next, searchQuery));
  };
  useEffect(() => {
    if (!viewMessage) return;
    const timeout = window.setTimeout(() => setViewMessage(""), 1500);
    return () => window.clearTimeout(timeout);
  }, [viewMessage]);
  const closeSidebar = useCallback(() => {
    if (window.matchMedia("(max-width: 900px)").matches) setSidebarOpen(false);
    else setDesktopSidebarVisible(false);
    sidebarTrigger.current?.focus();
  }, []);
  const copyLink = async (path: string, label: string) => {
    await copyText(`${location.origin}${path}`);
    notify(`${label} link copied.`);
  };
  return (
    <div className={styles.route}>
      <h1 className={styles.visuallyHidden}>Compendium</h1>
      <CompendiumToolbar section={section} onSectionChange={switchSection} query={searchQuery} onSearch={handleSearchChange}
        sidebarTrigger={sidebarTrigger} activeCount={activeCount} density={density} sidebarOpen={sidebarOpen} desktopSidebarVisible={desktopSidebarVisible}
        onSidebar={() => {
          if (window.matchMedia("(max-width: 900px)").matches) setSidebarOpen(true);
          else setDesktopSidebarVisible((visible) => !visible);
        }}
        onDensityChange={() => {
          const next = density === "gallery" ? "compact" : "gallery";
          if (section === "cards") navigate({ density: next });
          else navigateCore({ density: next });
          setViewMessage(next === "compact" ? "Compact view enabled" : "Gallery view enabled");
        }} />
      {viewMessage && <div className={styles.viewToast} role="status">{viewMessage}</div>}

      <div key={section} data-ui="compendium-section-content">
      {section === "cards" && (
        <>
          <div className={`${styles.workspace} ${desktopSidebarVisible ? "" : styles.withoutSidebar}`}>
            <CompendiumSidebar label="Filters & Sort" open={sidebarOpen} desktopVisible={desktopSidebarVisible} onClose={closeSidebar} onClear={clearFilters} activeCount={activeFilterCount} footer={<button type="button" onClick={closeSidebar}>Show {cards.length.toLocaleString()} cards</button>}>
              <FilterControls
                state={state}
                filterOptions={filterOptions}
                onChange={setFilter}
                onSortChange={(sort) => navigate({ sort }, { resetPage: true })}
              />
            </CompendiumSidebar>
            <main ref={resultsStartRef} className={styles.gallery}>
              <div className={styles.galleryHeader}>
                <CompendiumPagination page={page} totalPages={pages} totalResults={cards.length}
                  pageSize={COMPENDIUM_PAGE_SIZE} noun="cards" onPageChange={next => changeResultsPage(next, "cards")} />
                {pages <= 1 && <span className={styles.singlePageCount}>{cards.length.toLocaleString()} cards</span>}
              </div>
              {visible.length ? (
                <CardGrid
                  className={`${styles.cardGrid} ${state.density === "compact" ? styles.cardGridCompact : ""}`}
                  minCardWidth={state.density === "compact" ? "9.25rem" : "11.5rem"}
                >
                  {visible.map((card) => (
                    <button
                      className={`${styles.cardTile} ${selected?.catalogId === card.catalogId ? styles.cardTileSelected : ""}`}
                      type="button"
                      aria-pressed={selected?.catalogId === card.catalogId}
                      key={card.catalogId}
                      onClick={(event) => selectCard(card, event.currentTarget)}
                    >
                      <span className={styles.cardArt}>
                        <span className={styles.cardArtFrame}>
                          <ResponsiveCardImage card={card} presentation="tile" />
                          <BakuganRollingOverlay card={card} />
                          {card.fusionPairId && (
                            <span className={styles.fusionBadge} aria-label="Fusion Character Card">
                              <FusionSymbol alt="" width={24} height={24} />
                            </span>
                          )}
                        </span>
                      </span>
                      <span className={styles.cardCopy}>
                        <span className={styles.cardBadges}><StatusChip tone="info">{card.faction}</StatusChip><StatusChip>{cardSetCode(card)}</StatusChip></span>
                        <strong>{card.displayName}</strong>
                        <small>{card.type} · {card.cost} Energy · {card.rarity}</small>
                      </span>
                    </button>
                  ))}
                </CardGrid>
              ) : (
                <Surface className={styles.emptyResults} role="status">
                  <span>◇</span><h2>No cards match</h2><p>Adjust the search or clear the active filters to return to the full archive.</p>
                  <ActionButton tone="secondary" onClick={clearFilters}>Clear filters</ActionButton>
                </Surface>
              )}
              {pages > 1 && <div className={styles.galleryFooter}>
                <CompendiumPagination placement="bottom" page={page} totalPages={pages} totalResults={cards.length}
                  pageSize={COMPENDIUM_PAGE_SIZE} noun="cards" onPageChange={next => changeResultsPage(next, "cards")} />
              </div>}
            </main>
            {selected && (
              <CardInspector
                card={selected}
                allCards={CARDS}
                rules={ruleReferences}
                rulings={PUBLISHED_RULINGS}
                tab={state.tab}
                onTabChange={(tab: CardInspectorTab) => navigate({ tab }, { push: true })}
                onSelectCard={(card) => selectCard(card)}
                onClose={closeInspector}
                returnFocusRef={inspectorTrigger}
                onShare={() => void copyCurrentLink(selected.displayName)}
                collectionEnabled={Boolean(authUser)}
                collection={collection}
                onCollectionChange={changeCollection}
              />
            )}
          </div>

        </>
      )}

      {section === "cores" && (
        <>
          <div className={`${styles.coreWorkspace} ${desktopSidebarVisible ? "" : styles.withoutSidebar}`}>
            <CompendiumSidebar label="Filters & Sort" open={sidebarOpen} desktopVisible={desktopSidebarVisible} onClose={closeSidebar} onClear={clearCoreFilters} activeCount={activeCoreFilterCount} footer={<button type="button" onClick={closeSidebar}>Show {cores.length.toLocaleString()} BakuCores</button>}>
              <CoreFilterControls
                state={coreState}
                onChange={(patch) => navigateCore(patch, { resetPage: true })}
                onSortChange={(sort) => navigateCore({ sort }, { resetPage: true })}
              />
            </CompendiumSidebar>
            <main ref={resultsStartRef} className={styles.gallery}>
              <div className={styles.galleryHeader}>
                <CompendiumPagination page={corePage} totalPages={corePages} totalResults={cores.length}
                  pageSize={CORE_COMPENDIUM_PAGE_SIZE} noun="BakuCores" onPageChange={next => changeResultsPage(next, "cores")} />
                {corePages <= 1 && <span className={styles.singlePageCount}>{cores.length.toLocaleString()} BakuCores</span>}
              </div>
              {visibleCores.length ? (
                <CardGrid className={`${styles.cardGrid} ${styles.coreGrid} ${coreState.density === "compact" ? styles.cardGridCompact : ""}`} minCardWidth={coreState.density === "compact" ? "9.25rem" : "11.5rem"}>
                  {visibleCores.map((core) => {
                    const displayedCore = coreForSet(core, coreState.set);
                    const stats = corePreviewStats(core);
                    const printedSet = displayedCore.set ?? "Battle Brawlers";
                    return (
                      <button
                        className={`${styles.cardTile} ${styles.coreTile} ${selectedCore?.id === core.id ? styles.cardTileSelected : ""}`}
                        type="button"
                        aria-pressed={selectedCore?.id === core.id}
                        key={core.id}
                        onClick={(event) => selectCore(core, event.currentTarget)}
                      >
                        <span className={styles.coreArt}><BakuCoreArt core={displayedCore} alt="" /></span>
                        <span className={styles.cardCopy}>
                          <strong>{core.type}</strong>
                          <span className={styles.coreStatList} aria-label="BakuCore stats">
                            {stats.map((stat) => <span key={stat}>{stat}</span>)}
                          </span>
                          <span className={styles.coreSetLabel} aria-label={`${printedSet}, collector number ${displayedCore.number}`}>
                            {printedSet === "Armored Alliance" ? "AA" : "BB"} #{displayedCore.number}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </CardGrid>
              ) : (
                <Surface className={styles.emptyResults} role="status">
                  <span>◇</span><h2>No BakuCores match</h2><p>Adjust the search or clear the active BakuCore filters to return to the full archive.</p>
                  <ActionButton tone="secondary" onClick={clearCoreFilters}>Clear filters</ActionButton>
                </Surface>
              )}
              {corePages > 1 && <div className={styles.galleryFooter}>
                <CompendiumPagination placement="bottom" page={corePage} totalPages={corePages} totalResults={cores.length}
                  pageSize={CORE_COMPENDIUM_PAGE_SIZE} noun="BakuCores" onPageChange={next => changeResultsPage(next, "cores")} />
              </div>}
            </main>
            {selectedCore && (
              <CardInspector
                core={selectedCore}
                allCores={CORE_COMPENDIUM}
                rules={ruleReferences}
                rulings={PUBLISHED_RULINGS}
                tab={coreState.tab}
                onTabChange={(tab) => navigateCore({ tab }, { push: true })}
                onClose={() => navigateCore({ core: "", tab: "overview" })}
                returnFocusRef={inspectorTrigger}
                onShare={() => void copyCurrentLink(selectedCore.name)}
                collectionEnabled={Boolean(authUser)}
                collection={collection}
                onCollectionChange={changeCollection}
              />
            )}
          </div>

        </>
      )}

      {section === "rules" && <div className={styles.rulebookFrame} data-sidebar-hidden={!desktopSidebarVisible}><OfficialRulebook query={deferredSearchQuery} sidebarOpen={sidebarOpen} desktopSidebarVisible={desktopSidebarVisible} onSidebarClose={closeSidebar} /></div>}
      {section === "glossary" && <div className={styles.rulebookFrame} data-sidebar-hidden={!desktopSidebarVisible}><GlossaryScreen query={deferredSearchQuery} sidebarOpen={sidebarOpen} desktopSidebarVisible={desktopSidebarVisible} onSidebarClose={closeSidebar} /></div>}

      {section === "rulings" && <div className={styles.rulebookFrame} data-sidebar-hidden={!desktopSidebarVisible}><RulingsReference query={deferredSearchQuery} onCopy={copyLink} sidebarOpen={sidebarOpen} desktopSidebarVisible={desktopSidebarVisible} onSidebarClose={closeSidebar} /></div>}

      </div>

    </div>
  );
}
