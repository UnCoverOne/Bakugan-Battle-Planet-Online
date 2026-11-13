"use client";

import { OfficialRulebook } from "./OfficialRulebook";
import { GlossaryScreen } from "./GlossaryScreen";
import { RulingsReference } from "./RulingsReference";
import { FusionSymbol } from "@/components/media/FusionSymbol";
import { BakuCoreArt } from "@/components/bakucore/BakuCoreArt";
import { OriginalImage } from "@/components/media/OriginalImage";

import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { compendiumLocation, compendiumSectionHref, type CompendiumSection } from "../../lib/compendium-navigation";
import { CardInspector } from "../cards/CardInspector";
import { ResponsiveCardImage } from "../cards/ResponsiveCardImage";
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
import { updateCollection, type Collection, type CollectionField } from "../../lib/collection";
import { cardSetCode } from "../../lib/content/catalogue";
import { PUBLISHED_RULINGS, REFERENCE_REVIEWED_AT } from "../../lib/reference";
import { useAppFields } from "../application/AppProvider";
import { copyText } from "../application/ui";
import { ActionButton, CardGrid, StatusChip, Surface, Tabs } from "../design-system/primitives";
import { CardFilterPanel } from "../filters/CardFilterPanel";
import { FilterPicker, type FilterOption } from "../filters/FilterPicker";
import {
  activeCardFilterCount,
  CORE_SET_OPTIONS,
  CORE_TYPE_OPTIONS,
  createCardFilterOptionCatalogue,
  FACTION_SYMBOLS,
  CARD_FILTER_FACETS,
  CARD_FILTER_LABELS,
  type CardFilterState,
  type CardFilterFacet,
  type CardFilterOptionCatalogue,
} from "../../lib/card-filters";
import { SORT_LABELS, CHARACTER_SORTS, NON_CHARACTER_SORTS, CORE_SORT_LABELS } from "../../lib/catalogue-sorting";
import { coreForSet } from "../../lib/core-preview";
import styles from "./CompendiumScreen.module.css";

const SEARCH_URL_DEBOUNCE_MS = 250;
const NAV_ITEMS: { section: CompendiumSection; label: string; icon: "cards"|"cores"|"glossary"|"rules"|"rulings" }[] = [
  {section:"cards",label:"Cards",icon:"cards"},
  {section:"cores",label:"BakuCores",icon:"cores"},
  {section:"glossary",label:"Glossary",icon:"glossary"},
  {section:"rules",label:"Rules",icon:"rules"},
  {section:"rulings",label:"Rulings",icon:"rulings"},
];
function SectionIcon({name}:{name:typeof NAV_ITEMS[number]["icon"]}) {
  const paths: Record<typeof name, React.ReactNode> = {
    cards: <><rect x="6" y="3" width="12" height="17" rx="1"/><path d="M3 7v14h12M9 8h6M9 12h6"/></>,
    cores: <path d="M12 2 21 7v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/>,
    glossary: <><path d="M4 5c3-1 6-1 8 1 2-2 5-2 8-1v14c-3-1-6-1-8 1-2-2-5-2-8-1zM12 6v14"/><path d="M6 9h3m-3 3h3"/></>,
    rules: <><path d="M4 4h7l2 3h7v13H4zM7 11h10M7 15h8"/></>,
    rulings: <><path d="M12 3v17M5 7h14M6 7l-3 7h6zM18 7l-3 7h6zM8 21h8"/></>,
  };
  return <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const CORE_BONUS_OPTIONS: FilterOption[] = ["B-Power", "Damage", "FrostStrike", "ShadowStrike", "Baku-Gear reduction", "Fusion"].map((value) => ({value,label:value}));
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
];

function FilterControls({
  state,
  filterOptions,
  onChange,
  onSortChange,
  onClear,
}: {
  state: CompendiumState;
  filterOptions: CardFilterOptionCatalogue;
  onChange: (key: FilterKey, values: string[]) => void;
  onSortChange: (sort: CompendiumState["sort"]) => void;
  onClear: () => void;
}) {
  const isCharacterOnly = state.type.length === 1 && state.type[0] === "Character";
  const includesCharacter = state.type.includes("Character");
  const sortOptions = Object.entries(SORT_LABELS).filter(([value]) => (
    (isCharacterOnly ? CHARACTER_SORTS : NON_CHARACTER_SORTS).has(value as CompendiumState["sort"])
  ));
  const selectedSort = sortOptions.some(([value]) => value === state.sort) ? state.sort : "collector";
  const secondaryFacets: CardFilterFacet[] = ["set", "faction"];
  if (!isCharacterOnly) secondaryFacets.push("cost", "rarity");
  if (includesCharacter) secondaryFacets.push("coreType");
  secondaryFacets.push("keyword");

  const updateFilters = (next: CardFilterState, facet: CardFilterFacet) => {
    onChange(facet, next[facet]);
  };

  return (
    <>
      <div className={styles.filterHeading}>
        <div><h2>Filters &amp; sort</h2></div>
        <button type="button" onClick={onClear}>Clear</button>
      </div>
      <CardFilterPanel
        filters={state}
        facets={["type"]}
        options={filterOptions}
        onChange={updateFilters}
      />
      <div className={styles.filterDivider} role="separator" />
      <FilterPicker
        label="Sort"
        values={[selectedSort]}
        options={sortOptions.map(([value, label]) => ({ value, label }))}
        onChange={(values) => {
          const next = values[0] as CompendiumState["sort"] | undefined;
          if (next) onSortChange(next);
        }}
        mode="single"
        clearable={false}
      />
      <div className={styles.filterDivider} role="separator" />
      <CardFilterPanel
        filters={state}
        facets={secondaryFacets}
        options={filterOptions}
        onChange={updateFilters}
      />
    </>
  );
}

function CoreFilterControls({
  state,
  onChange,
  onSortChange,
  onClear,
}: {
  state: CoreCompendiumState;
  onChange: (patch: Partial<CoreCompendiumState>) => void;
  onSortChange: (sort: CoreCompendiumState["sort"]) => void;
  onClear: () => void;
}) {
  return (
    <>
      <div className={styles.filterHeading}>
        <div><h2>Filters &amp; sort</h2></div>
        <button type="button" onClick={onClear}>Clear</button>
      </div>
      <FilterPicker
        label="Core type"
        values={state.type === "All" ? [] : [state.type]}
        options={CORE_TYPE_OPTIONS}
        onChange={(values) => onChange({ type: values[0] ?? "All" })}
        mode="single"
      />
      <FilterPicker label="Bonus type" values={state.bonusType === "All" ? [] : [state.bonusType]}
        options={CORE_BONUS_OPTIONS} onChange={(values) => onChange({bonusType: values[0] ?? "All"})} mode="single" />
      <div className={styles.filterDivider} role="separator" />
      <FilterPicker
        label="Sort"
        values={[state.sort]}
        options={CORE_SORT_OPTIONS}
        onChange={(values) => {
          const next = values[0] as CoreCompendiumState["sort"] | undefined;
          if (next) onSortChange(next);
        }}
        mode="single"
        clearable={false}
      />
      <div className={styles.filterDivider} role="separator" />
      <FilterPicker
        label="Set"
        values={state.set === "All" ? [] : [state.set]}
        options={CORE_SET_OPTIONS}
        onChange={(values) => onChange({ set: values[0] ?? "All" })}
        mode="single"
      />
    </>
  );
}



export function CompendiumScreen({ segments = [] }: { segments?: string[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setCompendiumTab, authUser, notify, collection, setCollection, catalogueRevision } = useAppFields(["setCompendiumTab", "authUser", "notify", "collection", "setCollection", "catalogueRevision"]);
  const changeCollection = useCallback((catalogId: string, field: CollectionField, delta: number) => {
    if (!authUser) return;
    setCollection((current: Collection) => updateCollection(current, catalogId, field, delta));
  }, [authUser, setCollection]);
  const { section, legacyDetail } = compendiumLocation(pathname, segments);
  const state = useMemo(() => parseCompendiumState(searchParams.toString()), [searchParams]);
  const coreState = useMemo(() => parseCoreCompendiumState(searchParams.toString()), [searchParams]);
  const [searchQuery, setSearchQuery] = useState(state.q);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [pendingCardFilters, setPendingCardFilters] = useState<CompendiumState | null>(null);
  const [pendingCoreFilters, setPendingCoreFilters] = useState<CoreCompendiumState | null>(null);
  const [tabletRailOpen, setTabletRailOpen] = useState(false);
  const [referenceReturn, setReferenceReturn] = useState<{url:string;label:string;section:string;scrollY:number}|null>(null);
  const sectionQueries = useRef<Partial<Record<CompendiumSection, string>>>({});
  const sectionUrls = useRef<Partial<Record<CompendiumSection, string>>>({});
  const sectionScrolls = useRef<Partial<Record<CompendiumSection, number>>>({});
  const resultsAnchor = useRef<HTMLElement | null>(null);
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
  const cards = useMemo(() => {
    if (section !== "cards") return [];
    const seen = new Set<string>();
    return filterAndSortCompendiumCards(CARDS, searchState).filter((card) => {
      const identity = card.constructionIdentity ?? card.catalogId;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  }, [searchState, section, catalogueRevision]);
  const printingCounts = useMemo(() => {
    const counts = new Map<string,number>();
    for (const card of CARDS) {
      if (card.fusionFace === "b") continue;
      const id = card.constructionIdentity ?? card.catalogId;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [catalogueRevision]);
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
    if (options.scroll) requestAnimationFrame(() => resultsAnchor.current?.scrollIntoView({ block: "start" }));
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
    if (options.scroll) requestAnimationFrame(() => resultsAnchor.current?.scrollIntoView({ block: "start" }));
  }, [coreState, coreUrlFor, searchQuery]);

  const closeInspector = useCallback(() => {
    navigate({ card: "", tab: "overview" });
  }, [navigate]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("compendium:reference-return");
      const origin = raw ? JSON.parse(raw) as {url:string;label:string;section:string;scrollY:number} : null;
      setReferenceReturn(origin?.section === section ? origin : null);
    } catch {setReferenceReturn(null);}
  }, [section]);
  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash) return;
    const saved=sectionScrolls.current[section];
    if (typeof saved === "number") requestAnimationFrame(() => window.scrollTo({top:saved,behavior:"instant"}));
  },[section]);
  const returnToReferenceSource = () => {
    if (!referenceReturn) return;
    const restoration = sessionStorage.getItem("compendium:reference-return");
    if (restoration) sessionStorage.setItem("compendium:restore-inspector",restoration);
    window.history.back();
    requestAnimationFrame(() => window.scrollTo({top:referenceReturn.scrollY}));
    sessionStorage.removeItem("compendium:reference-return");
    setReferenceReturn(null);
  };
  useEffect(() => {
    setCompendiumTab(section);
    setFilterSheetOpen(false);
    setTabletRailOpen(false);
    setSearchQuery(section === "cores" ? coreState.q : state.q);
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
      if (filterSheetOpen) setFilterSheetOpen(false);
      else if (selectedCore) navigateCore({ core: "" });
    };
    addEventListener("keydown", closeOverlays);
    return () => removeEventListener("keydown", closeOverlays);
  }, [closeInspector, filterSheetOpen, navigateCore, selected, selectedCore]);

  const activeFilterCount = activeCardFilterCount(state);
  const activeCoreFilterCount = (["set", "type", "bonusType"] as const)
    .filter((key) => coreState[key] !== "All").length;

  const setFilter = (key: FilterKey, values: string[]) => {
    if (key !== "type") return navigate({ [key]: values } as StatePatch, { resetPage: true });

    const includesCharacter = values.includes("Character");
    const nextIsCharacterOnly = values.length === 1 && includesCharacter;
    const nextSorts = nextIsCharacterOnly ? CHARACTER_SORTS : NON_CHARACTER_SORTS;
    const patch: StatePatch = {
      type: values,
      ...(!includesCharacter ? { coreType: [] } : {}),
      ...(nextIsCharacterOnly ? { cost: [], rarity: [] } : {}),
      ...(nextSorts.has(state.sort) ? {} : { sort: "collector" }),
    };
    navigate(patch, { resetPage: true });
  };
  const clearFilters = () => navigate({
    set: [],
    type: [],
    coreType: [],
    faction: [],
    cost: [],
    rarity: [],
    keyword: [],
  }, { resetPage: true });
  const clearCoreFilters = () => navigateCore({ set: "All", type: "All", bonusType: "All" }, {resetPage:true});
  const openFilterSheet = () => {setPendingCardFilters({...state});setPendingCoreFilters({...coreState});setFilterSheetOpen(true);};
  const applyMobileCardFilters = () => {if (pendingCardFilters) navigate({set:pendingCardFilters.set,type:pendingCardFilters.type,coreType:pendingCardFilters.coreType,faction:pendingCardFilters.faction,cost:pendingCardFilters.cost,rarity:pendingCardFilters.rarity,keyword:pendingCardFilters.keyword}, {resetPage:true});setFilterSheetOpen(false);};
  const applyMobileCoreFilters = () => {if (pendingCoreFilters) navigateCore({set:pendingCoreFilters.set,type:pendingCoreFilters.type,bonusType:pendingCoreFilters.bonusType}, {resetPage:true});setFilterSheetOpen(false);};
  const selectCard = (card: typeof CARDS[number], trigger?: HTMLElement | null, preserveTab = false) => {
    inspectorTrigger.current = trigger ?? inspectorTrigger.current;
    navigate({ card: card.slug ?? card.catalogId, tab: preserveTab ? state.tab : "overview" }, { push: true });
  };
  const selectCore = (core: typeof CORE_COMPENDIUM[number], trigger?: HTMLElement | null, preserveTab = false) => {
    inspectorTrigger.current = trigger ?? inspectorTrigger.current;
    navigateCore({ core: core.catalogId ?? core.id, tab: preserveTab ? coreState.tab : "overview" }, { push: true });
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
    sectionQueries.current[section] = searchQuery;
    sectionUrls.current[section] = window.location.pathname + window.location.search + window.location.hash;
    sectionScrolls.current[section] = window.scrollY;
    window.history.pushState(null, "", sectionUrls.current[next] ?? compendiumSectionHref(next, sectionQueries.current[next] ?? ""));
    setSearchQuery(sectionQueries.current[next] ?? "");
  };
  const copyLink = async (path: string, label: string) => {
    await copyText(`${location.origin}${path}`);
    notify(`${label} link copied.`);
  };
  return (
    <div className={styles.route}>
      <section className={styles.toolbar} aria-label="Compendium navigation and search">
        <nav className={styles.sectionNav} aria-label="Compendium sections">
          {NAV_ITEMS.map((entry) => <button type="button" key={entry.section}
            aria-current={section === entry.section ? "page" : undefined}
            className={section === entry.section ? styles.sectionActive : ""}
            onClick={() => switchSection(entry.section)}>
            <span className={styles.sectionIcon} aria-hidden="true"><SectionIcon name={entry.icon}/></span><span>{entry.label}</span>
          </button>)}
        </nav>
        <div className={styles.search}>
          <label className={styles.visuallyHidden} htmlFor="compendium-search">Search the current Compendium section</label>
          <span aria-hidden="true">⌕</span>
          <input id="compendium-search" type="search" value={searchQuery} onChange={(event) => handleSearchChange(event.target.value)}
            placeholder={section === "cards" ? "Search cards…" : section === "cores" ? "Search BakuCores…" : section === "glossary" ? "Search glossary terms…" : section === "rules" ? "Search rules…" : "Search rulings…"} />
          {searchQuery && <button type="button" aria-label="Clear search" onClick={() => handleSearchChange("")}>×</button>}
        </div>
      </section>

      <div key={section} data-ui="compendium-section-content">
      {referenceReturn && ["rules","glossary","rulings"].includes(section) && <div className={styles.referenceReturn}><button type="button" onClick={returnToReferenceSource}>← Back to {referenceReturn.label}</button><button type="button" aria-label="Dismiss return link" onClick={() => {sessionStorage.removeItem("compendium:reference-return");setReferenceReturn(null);}}>×</button></div>}
      {section === "cards" && (
        <>
          <section className={styles.resultsToolbar}>
            <div>
              <strong>{cards.length.toLocaleString()} cards</strong>
              <span>Showing {cards.length ? (page - 1) * COMPENDIUM_PAGE_SIZE + 1 : 0}–{Math.min(page * COMPENDIUM_PAGE_SIZE, cards.length)} of {cards.length}</span>
            </div>
            <ActionButton className={styles.mobileFilterButton} tone="secondary" onClick={openFilterSheet}>
              Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
            </ActionButton>
            <Tabs className={styles.densityTabs} label="Gallery density">
              <button className={state.density === "gallery" ? "active" : ""} onClick={() => navigate({ density: "gallery" })}>Detailed</button>
              <button className={state.density === "compact" ? "active" : ""} onClick={() => navigate({ density: "compact" })}>Compact</button>
            </Tabs>
            <label className={styles.sortControl}>Sort <select value={state.sort} onChange={(event) => navigate({ sort: event.target.value as CompendiumState["sort"] }, { resetPage: true })}>{Object.entries(SORT_LABELS).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <button type="button" className={styles.sortDirection} aria-label={state.direction === "asc" ? "Sort descending" : "Sort ascending"} title={state.direction === "asc" ? "Ascending" : "Descending"} onClick={() => navigate({direction:state.direction === "asc" ? "desc" : "asc"}, {resetPage:true})}>{state.direction === "asc" ? "↑" : "↓"}</button>
            <button className={styles.shareResults} type="button" onClick={() => void copyCurrentLink("Filtered results")}>Share results</button>
          </section>
          <div className={styles.workspace}>
            <button className={styles.tabletFilterButton} type="button" aria-expanded={tabletRailOpen} onClick={() => setTabletRailOpen((current) => !current)}>Filters</button>
            <Surface as="aside" className={`${styles.filterRail} ${tabletRailOpen ? styles.tabletRailOpen : ""}`} aria-label="Card filters">
              <FilterControls
                state={state}
                filterOptions={filterOptions}
                onChange={setFilter}
                onSortChange={(sort) => navigate({ sort }, { resetPage: true })}
                onClear={clearFilters}
              />
            </Surface>
            <main className={styles.gallery} ref={resultsAnchor}>
{cards.length > 0 && (<nav className={styles.pagination} aria-label="Card result pages"><button type="button" disabled={page === 1} onClick={() => navigate({page:page-1},{push:true,scroll:true})} aria-label="Previous page">‹</button>{Array.from({length:pages},(_,i)=>i+1).filter(v=>v===1||v===pages||Math.abs(v-page)<=2).map((v,i,arr)=><span className={styles.pageSlot} key={v}>{i>0&&v>arr[i-1]+1&&<span>…</span>}<button type="button" aria-current={v===page?"page":undefined} onClick={()=>navigate({page:v},{push:true,scroll:true})}>{v}</button></span>)}<button type="button" disabled={page===pages} onClick={()=>navigate({page:page+1},{push:true,scroll:true})} aria-label="Next page">›</button></nav>)}
              {activeFilterCount > 0 && <div className={styles.activeFilters} aria-label="Active card filters">
                {CARD_FILTER_FACETS.flatMap((facet) => state[facet].map((value) =>
                  <button type="button" key={facet+":"+value} onClick={() => setFilter(facet,state[facet].filter((entry) => entry !== value))}
                    aria-label={`Remove ${value} ${CARD_FILTER_LABELS[facet]} filter`}>{value}<span aria-hidden="true">×</span></button>))}
                <button type="button" className={styles.clearChips} onClick={clearFilters}>Clear all</button>
              </div>}
              {visible.length ? (
                <CardGrid
                  className={`${styles.cardGrid} ${state.density === "compact" ? styles.cardGridCompact : ""}`}
                  minCardWidth={state.density === "compact" ? "6.75rem" : "10rem"}
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
                          {(printingCounts.get(card.constructionIdentity ?? card.catalogId) ?? 0) > 1 &&
                            <span className={styles.printingsBadge} aria-label="Multiple printings">▣</span>}
                          {card.fusionPairId && (
                            <span className={styles.fusionBadge} aria-label="Fusion Character Card">
                              <FusionSymbol alt="" width={24} height={24} />
                            </span>
                          )}
                        </span>
                      </span>
                      {state.density !== "compact" && <span className={styles.cardCopy}><strong>{card.displayName}</strong><span className={styles.cardBadges}><StatusChip tone="info"><OriginalImage src={FACTION_SYMBOLS[card.faction] ?? FACTION_SYMBOLS.Aquos} alt="" width={15} height={15} className={styles.factionIcon} /> {card.faction}</StatusChip><StatusChip>{card.type}</StatusChip><StatusChip>{cardSetCode(card)}</StatusChip></span></span>}
                    </button>
                  ))}
                </CardGrid>
              ) : (
                <Surface className={styles.emptyResults} role="status">
                  <span>◇</span><h2>No cards match</h2><p>Adjust the search or clear the active filters to return to the full archive.</p>
                  <div className={styles.emptyActions}><ActionButton tone="secondary" onClick={clearFilters}>Clear filters</ActionButton><ActionButton tone="secondary" onClick={() => handleSearchChange("")}>Clear search</ActionButton></div>
                </Surface>
              )}
              {cards.length > 0 && (<nav className={styles.pagination} aria-label="Card result pages"><button type="button" disabled={page === 1} onClick={() => navigate({page:page-1},{push:true,scroll:true})} aria-label="Previous page">‹</button>{Array.from({length:pages},(_,i)=>i+1).filter(v=>v===1||v===pages||Math.abs(v-page)<=2).map((v,i,arr)=><span className={styles.pageSlot} key={v}>{i>0&&v>arr[i-1]+1&&<span>…</span>}<button type="button" aria-current={v===page?"page":undefined} onClick={()=>navigate({page:v},{push:true,scroll:true})}>{v}</button></span>)}<button type="button" disabled={page===pages} onClick={()=>navigate({page:page+1},{push:true,scroll:true})} aria-label="Next page">›</button></nav>)}
            </main>
            {selected && (
              <CardInspector
                card={selected}
                allCards={CARDS}
                rules={ruleReferences}
                rulings={PUBLISHED_RULINGS}
                tab={state.tab}
                onTabChange={(tab: CardInspectorTab) => navigate({ tab }, { push: true })}
                onSelectCard={(card) => selectCard(card, undefined, true)}
                onPrevious={cards.findIndex((entry) => entry.catalogId === selected.catalogId) > 0 ? () => selectCard(cards[cards.findIndex((entry) => entry.catalogId === selected.catalogId) - 1], undefined, true) : undefined}
                onNext={cards.findIndex((entry) => entry.catalogId === selected.catalogId) >= 0 && cards.findIndex((entry) => entry.catalogId === selected.catalogId) < cards.length - 1 ? () => selectCard(cards[cards.findIndex((entry) => entry.catalogId === selected.catalogId) + 1], undefined, true) : undefined}
                position={cards.findIndex((entry) => entry.catalogId === selected.catalogId) + 1}
                resultCount={cards.length}
                onClose={closeInspector}
                returnFocusRef={inspectorTrigger}
                onShare={() => void copyCurrentLink(selected.displayName)}
                collectionEnabled={Boolean(authUser)}
                collection={collection}
                onCollectionChange={changeCollection}
              />
            )}
          </div>
          {filterSheetOpen && (
            <div data-ui="filter-backdrop" className={styles.filterBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFilterSheetOpen(false); }}>
              <Surface as="aside" data-motion-surface="filter-sheet" className={styles.filterSheet} role="dialog" aria-modal="true" aria-label="Card filters">
                <button type="button" className={styles.sheetClose} onClick={() => setFilterSheetOpen(false)} aria-label="Dismiss filters">× Close</button>
                <FilterControls
                  state={pendingCardFilters ?? state}
                  filterOptions={filterOptions}
                  onChange={(key, values) => setPendingCardFilters((previous) => previous ? {...previous,[key]:values} : previous)}
                  onSortChange={(sort) => setPendingCardFilters((previous) => previous ? {...previous,sort} : previous)}
                  onClear={() => setPendingCardFilters((previous) => previous ? {...previous,set:[],type:[],coreType:[],faction:[],cost:[],rarity:[],keyword:[]} : previous)}
                />
                <ActionButton onClick={applyMobileCardFilters}>Show Results</ActionButton>
              </Surface>
            </div>
          )}
        </>
      )}

      {section === "cores" && (
        <>
          <section className={styles.resultsToolbar}>
            <div>
              <strong>{cores.length.toLocaleString()} BakuCores</strong>
              <span>Showing {cores.length ? (corePage - 1) * CORE_COMPENDIUM_PAGE_SIZE + 1 : 0}–{Math.min(corePage * CORE_COMPENDIUM_PAGE_SIZE, cores.length)} of {cores.length}</span>
            </div>
            <ActionButton className={styles.mobileFilterButton} tone="secondary" onClick={openFilterSheet}>
              Filters{activeCoreFilterCount ? ` (${activeCoreFilterCount})` : ""}
            </ActionButton>
            <Tabs className={styles.densityTabs} label="BakuCore gallery density">
              <button className={coreState.density === "gallery" ? "active" : ""} onClick={() => navigateCore({ density: "gallery" })}>Detailed</button>
              <button className={coreState.density === "compact" ? "active" : ""} onClick={() => navigateCore({ density: "compact" })}>Compact</button>
            </Tabs>
            <label className={styles.sortControl}>Sort <select value={coreState.sort} onChange={(event) => navigateCore({ sort: event.target.value as CoreCompendiumState["sort"] }, { resetPage: true })}>{CORE_SORT_OPTIONS.map(({value,label}) => <option value={value} key={value}>{label}</option>)}</select></label>
            <button type="button" className={styles.sortDirection} aria-label={coreState.direction === "asc" ? "Sort descending" : "Sort ascending"} title={coreState.direction === "asc" ? "Ascending" : "Descending"} onClick={() => navigateCore({direction:coreState.direction === "asc" ? "desc" : "asc"}, {resetPage:true})}>{coreState.direction === "asc" ? "↑" : "↓"}</button>
            <button className={styles.shareResults} type="button" onClick={() => void copyCurrentLink("BakuCore results")}>Share results</button>
          </section>
          <div className={styles.coreWorkspace}>
            <button className={styles.tabletFilterButton} type="button" aria-expanded={tabletRailOpen} onClick={() => setTabletRailOpen((current) => !current)}>Filters</button>
            <Surface as="aside" className={`${styles.filterRail} ${styles.coreFilterRail} ${tabletRailOpen ? styles.tabletRailOpen : ""}`} aria-label="BakuCore filters">
              <CoreFilterControls
                state={coreState}
                onChange={(patch) => navigateCore(patch, { resetPage: true })}
                onSortChange={(sort) => navigateCore({ sort }, { resetPage: true })}
                onClear={clearCoreFilters}
              />
            </Surface>
            <main className={styles.gallery} ref={resultsAnchor}>
{cores.length > 0 && (<nav className={styles.pagination} aria-label="BakuCore result pages"><button type="button" disabled={corePage === 1} onClick={() => navigateCore({page:corePage-1},{push:true,scroll:true})} aria-label="Previous page">‹</button>{Array.from({length:corePages},(_,i)=>i+1).filter(v=>v===1||v===corePages||Math.abs(v-corePage)<=2).map((v,i,arr)=><span className={styles.pageSlot} key={v}>{i>0&&v>arr[i-1]+1&&<span>…</span>}<button type="button" aria-current={v===corePage?"page":undefined} onClick={()=>navigateCore({page:v},{push:true,scroll:true})}>{v}</button></span>)}<button type="button" disabled={corePage===corePages} onClick={()=>navigateCore({page:corePage+1},{push:true,scroll:true})} aria-label="Next page">›</button></nav>)}
              {activeCoreFilterCount > 0 && <div className={styles.activeFilters} aria-label="Active BakuCore filters">
                {(["type","set","bonusType"] as const).filter((key) => coreState[key] !== "All").map((key) =>
                  <button type="button" key={key} onClick={() => navigateCore({[key]:"All"}, {resetPage:true})}
                    aria-label={`Remove ${coreState[key]} filter`}>{coreState[key]}<span aria-hidden="true">×</span></button>)}
                <button type="button" className={styles.clearChips} onClick={clearCoreFilters}>Clear all</button>
              </div>}
              {visibleCores.length ? (
                <CardGrid className={`${styles.cardGrid} ${styles.coreGrid} ${coreState.density === "compact" ? styles.cardGridCompact : ""}`} minCardWidth={coreState.density === "compact" ? "6.75rem" : "10rem"}>
                  {visibleCores.map((core) => {
                    const displayedCore = coreForSet(core, coreState.set);
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
                        {coreState.density !== "compact" && <span className={styles.cardCopy}><strong>{core.type}</strong><span className={styles.coreSetLabel} aria-label={`${printedSet}, collector number ${displayedCore.number}`}>{printedSet === "Armored Alliance" ? "AA" : "BB"}</span></span>}
                      </button>
                    );
                  })}
                </CardGrid>
              ) : (
                <Surface className={styles.emptyResults} role="status">
                  <span>◇</span><h2>No BakuCores match</h2><p>Adjust the search or clear the active BakuCore filters to return to the full archive.</p>
                  <div className={styles.emptyActions}><ActionButton tone="secondary" onClick={clearCoreFilters}>Clear filters</ActionButton><ActionButton tone="secondary" onClick={() => handleSearchChange("")}>Clear search</ActionButton></div>
                </Surface>
              )}
              {cores.length > 0 && (<nav className={styles.pagination} aria-label="BakuCore result pages"><button type="button" disabled={corePage === 1} onClick={() => navigateCore({page:corePage-1},{push:true,scroll:true})} aria-label="Previous page">‹</button>{Array.from({length:corePages},(_,i)=>i+1).filter(v=>v===1||v===corePages||Math.abs(v-corePage)<=2).map((v,i,arr)=><span className={styles.pageSlot} key={v}>{i>0&&v>arr[i-1]+1&&<span>…</span>}<button type="button" aria-current={v===corePage?"page":undefined} onClick={()=>navigateCore({page:v},{push:true,scroll:true})}>{v}</button></span>)}<button type="button" disabled={corePage===corePages} onClick={()=>navigateCore({page:corePage+1},{push:true,scroll:true})} aria-label="Next page">›</button></nav>)}
            </main>
            {selectedCore && (
              <CardInspector
                core={selectedCore}
                allCores={CORE_COMPENDIUM}
                onSelectCore={(nextCore) => selectCore(nextCore, undefined, true)}
                onPrevious={cores.findIndex((entry) => entry.id === selectedCore.id) > 0 ? () => selectCore(cores[cores.findIndex((entry) => entry.id === selectedCore.id) - 1], undefined, true) : undefined}
                onNext={cores.findIndex((entry) => entry.id === selectedCore.id) >= 0 && cores.findIndex((entry) => entry.id === selectedCore.id) < cores.length - 1 ? () => selectCore(cores[cores.findIndex((entry) => entry.id === selectedCore.id) + 1], undefined, true) : undefined}
                position={cores.findIndex((entry) => entry.id === selectedCore.id) + 1}
                resultCount={cores.length}
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
          {filterSheetOpen && (
            <div data-ui="filter-backdrop" className={styles.filterBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFilterSheetOpen(false); }}>
              <Surface as="aside" data-motion-surface="filter-sheet" className={`${styles.filterSheet} ${styles.coreFilterSheet}`} role="dialog" aria-modal="true" aria-label="BakuCore filters">
                <button type="button" className={styles.sheetClose} onClick={() => setFilterSheetOpen(false)} aria-label="Dismiss filters">× Close</button>
                <CoreFilterControls
                  state={pendingCoreFilters ?? coreState}
                  onChange={(patch) => setPendingCoreFilters((previous) => previous ? {...previous,...patch} : previous)}
                  onSortChange={(sort) => setPendingCoreFilters((previous) => previous ? {...previous,sort} : previous)}
                  onClear={() => setPendingCoreFilters((previous) => previous ? {...previous,set:"All",type:"All",bonusType:"All"} : previous)}
                />
                <ActionButton onClick={applyMobileCoreFilters}>Show Results</ActionButton>
              </Surface>
            </div>
          )}
        </>
      )}

      {section === "rules" && <div className={styles.rulebookFrame}><OfficialRulebook query={deferredSearchQuery} /></div>}
      {section === "glossary" && <div className={styles.rulebookFrame}><GlossaryScreen query={deferredSearchQuery} /></div>}

      {section === "rulings" && <div className={styles.rulebookFrame}><RulingsReference query={deferredSearchQuery} onCopy={copyLink} /></div>}

      </div>

    </div>
  );
}
