"use client";

import { OriginalImage } from "@/components/media/OriginalImage";
import { OfficialRulebook } from "./OfficialRulebook";
import { FusionSymbol } from "@/components/media/FusionSymbol";
import { BakuCoreArt } from "@/components/bakucore/BakuCoreArt";

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
import type { Core } from "../../lib/game";
import { updateCollection, type CollectionField } from "../../lib/collection";
import { CARD_SET_INFO, cardSetCode } from "../../lib/content/catalogue";
import { GLOSSARY_ENTRIES, PUBLISHED_RULINGS, REFERENCE_REVIEWED_AT, SYMBOL_ENTRIES } from "../../lib/reference";
import { useAppFields } from "../application/AppProvider";
import { AppButton, Badge, copyText } from "../application/ui";
import { ActionButton, CardGrid, Field, RouteHero, StatusChip, Surface, Tabs } from "../design-system/primitives";
import { CardFilterPanel } from "../filters/CardFilterPanel";
import { FilterPicker, type FilterOption } from "../filters/FilterPicker";
import {
  activeCardFilterCount,
  CORE_SET_OPTIONS,
  CORE_TYPE_OPTIONS,
  createCardFilterOptionCatalogue,
  type CardFilterFacet,
  type CardFilterOptionCatalogue,
} from "../../lib/card-filters";
import { SORT_LABELS, CHARACTER_SORTS, NON_CHARACTER_SORTS, CORE_SORT_LABELS } from "../../lib/catalogue-sorting";
import styles from "./CompendiumScreen.module.css";

const SEARCH_URL_DEBOUNCE_MS = 450;

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const CORE_SORT_OPTIONS: FilterOption[] = Object.entries(CORE_SORT_LABELS)
  .map(([value, label]) => ({ value, label }));

const signedCoreValue = (value: number) => `${value > 0 ? "+" : ""}${value}`;

const coreBaseStats = (core: Core) => [
  core.bonus !== 0 ? `${signedCoreValue(core.bonus)} B` : "",
  core.damageBonus !== 0 ? `${signedCoreValue(core.damageBonus)} D` : "",
].filter(Boolean);

const coreSpecialEffects = (core: Core) => [
  core.bakuGearCostReduction ? `Baku-Gear −${core.bakuGearCostReduction} Energy` : "",
  core.frostStrike ? `+${core.frostStrike} FrostStrike` : "",
  core.shadowStrike ? "ShadowStrike" : "",
  core.fusionBonus ? `Fusion ${signedCoreValue(core.fusionBonus)} B` : "",
  core.fusionDamageBonus ? `Fusion ${signedCoreValue(core.fusionDamageBonus)} D` : "",
  core.fusionFrostStrike ? `Fusion +${core.fusionFrostStrike} FrostStrike` : "",
  core.conditionalFactions?.length && (core.conditionalBonus || core.conditionalDamage)
    ? `${core.conditionalFactions.join(" / ")}: ${signedCoreValue(core.conditionalBonus || core.conditionalDamage || 0)} ${core.conditionalBonus ? "B" : "D"}`
    : "",
].filter(Boolean);

const coreForSet = (core: Core, set: string) => {
  const printing = core.printings?.find((candidate) => candidate.set === set);
  return printing
    ? { ...core, set: printing.set, number: printing.number, art: printing.art, hasProvidedScan: true }
    : core;
};

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

  const updateFilters = (next: CompendiumState, facet: CardFilterFacet) => {
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
  const { setCompendiumTab, authUser, notify, collection, setCollection } = useAppFields(["setCompendiumTab", "authUser", "notify", "collection", "setCollection"]);
  const changeCollection = useCallback((catalogId: string, field: CollectionField, delta: number) => {
    if (!authUser) return;
    setCollection((current) => updateCollection(current, catalogId, field, delta));
  }, [authUser, setCollection]);
  const { section, legacyDetail } = compendiumLocation(pathname, segments);
  const state = useMemo(() => parseCompendiumState(searchParams.toString()), [searchParams]);
  const coreState = useMemo(() => parseCoreCompendiumState(searchParams.toString()), [searchParams]);
  const [searchQuery, setSearchQuery] = useState(state.q);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [rulingCardId, setRulingCardId] = useState(section === "rulings" ? searchParams.get("card") ?? "" : "");
  const requestedRulingCard = section === "rulings" ? searchParams.get("card") ?? "" : "";
  useEffect(() => { if (section === "rulings") setRulingCardId(requestedRulingCard); }, [requestedRulingCard, section]);
  const [question, setQuestion] = useState("");
  const [submission, setSubmission] = useState("idle");
  const [showSubmission, setShowSubmission] = useState(false);
  const inspectorTrigger = useRef<HTMLElement | null>(null);
  const localSearchEditRef = useRef(false);
  const searchTimerRef = useRef<number | null>(null);

  const handleSearchChange = useCallback((value: string) => {
    localSearchEditRef.current = true;
    setSearchQuery(value);
  }, []);

  const filterOptions = useMemo(() => createCardFilterOptionCatalogue(CARDS), []);
  const searchState = useMemo(
    () => ({ ...state, q: deferredSearchQuery }),
    [deferredSearchQuery, state],
  );
  const cards = useMemo(
    () => section === "cards" ? filterAndSortCompendiumCards(CARDS, searchState) : [],
    [searchState, section],
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
  const rules = useMemo(
    () => section === "rules"
      ? ruleReferences.filter((entry) => !normalized || `${entry.title} ${entry.body} ${entry.category}`.toLowerCase().includes(normalized))
      : [],
    [normalized, section],
  );

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

  const closeInspector = useCallback(() => {
    navigate({ card: "", tab: "overview" });
  }, [navigate]);

  useEffect(() => {
    setCompendiumTab(section);
    setFilterSheetOpen(false);
    setShowSubmission(false);
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
  const activeCoreFilterCount = (["set", "type"] as const)
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
  const clearCoreFilters = () => navigateCore({
    q: "",
    set: "All",
    type: "All",
    sort: "collector",
    density: "gallery",
    page: 1,
    core: "",
  });
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
  const copyLink = async (path: string, label: string) => {
    await copyText(`${location.origin}${path}`);
    notify(`${label} link copied.`);
  };
  const submitRuling = async () => {
    if (!authUser) return notify("Sign in before submitting a ruling request.");
    if (question.trim().length < 20) return notify("Describe the interaction in at least 20 characters.");
    setSubmission("submitting");
    try {
      const response = await fetch("/api/rulings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId: rulingCardId || null, question: question.trim(), sourceUrl: location.href }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Submission failed.");
      setQuestion("");
      setSubmission("sent");
      notify(`Ruling request ${result.id ?? ""} submitted.`);
    } catch (error) {
      setSubmission("idle");
      notify(error instanceof Error ? error.message : "Submission failed.");
    }
  };

  return (
    <div className={styles.route}>
      <RouteHero
        eyebrow="AUTHORITATIVE REFERENCE"
        title="Compendium"
        description="Browse every supported card and BakuCore, inspect complete records, and follow connected rules and published rulings."
        aside={<div className={styles.sourceSummary}><strong>{Object.keys(CARD_SET_INFO).length} sets · {CARDS.length} cards · {CORE_COMPENDIUM.length} BakuCores</strong><span>Sources reviewed {REFERENCE_REVIEWED_AT}</span></div>}
      />
      <section className={styles.toolbar}>
        <Field className={styles.search} label="Search the archive">
          <input
            value={searchQuery}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder="Cards, effects, IDs, mechanics…"
          />
        </Field>
        <Tabs label="Compendium sections">
          <button type="button" className={section === "cards" ? "active" : ""} onClick={() => switchSection("cards")}>CARDS</button>
          <button type="button" className={section === "cores" ? "active" : ""} onClick={() => switchSection("cores")}>BAKUCORES</button>
          <button type="button" className={section === "rules" ? "active" : ""} onClick={() => switchSection("rules")}>RULES & GLOSSARY</button>
          <button type="button" className={section === "rulings" ? "active" : ""} onClick={() => switchSection("rulings")}>RULINGS</button>
        </Tabs>
      </section>

      <div key={section} data-ui="compendium-section-content">
      {section === "cards" && (
        <>
          <section className={styles.resultsToolbar}>
            <div>
              <strong>{cards.length.toLocaleString()} cards</strong>
              <span>Page {page} of {pages}</span>
            </div>
            <ActionButton className={styles.mobileFilterButton} tone="secondary" onClick={() => setFilterSheetOpen(true)}>
              Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
            </ActionButton>
            <Tabs className={styles.densityTabs} label="Gallery density">
              <button className={state.density === "gallery" ? "active" : ""} onClick={() => navigate({ density: "gallery" })}>Gallery</button>
              <button className={state.density === "compact" ? "active" : ""} onClick={() => navigate({ density: "compact" })}>Compact</button>
            </Tabs>
            <button className={styles.shareResults} type="button" onClick={() => void copyCurrentLink("Filtered results")}>Share results</button>
          </section>
          <div className={styles.workspace}>
            <Surface as="aside" className={styles.filterRail} aria-label="Card filters">
              <FilterControls
                state={state}
                filterOptions={filterOptions}
                onChange={setFilter}
                onSortChange={(sort) => navigate({ sort }, { resetPage: true })}
                onClear={clearFilters}
              />
            </Surface>
            <main className={styles.gallery}>
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
              <nav className={styles.pagination} aria-label="Card result pages">
                <button disabled={page === 1} onClick={() => navigate({ page: page - 1 }, { push: true })}>← Previous</button>
                <span>Page {page} of {pages}</span>
                <button disabled={page === pages} onClick={() => navigate({ page: page + 1 }, { push: true })}>Next →</button>
              </nav>
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
          {filterSheetOpen && (
            <div data-ui="filter-backdrop" className={styles.filterBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFilterSheetOpen(false); }}>
              <Surface as="aside" data-motion-surface="filter-sheet" className={styles.filterSheet} role="dialog" aria-modal="true" aria-label="Card filters">
                <FilterControls
                  state={state}
                  filterOptions={filterOptions}
                  onChange={setFilter}
                  onSortChange={(sort) => navigate({ sort }, { resetPage: true })}
                  onClear={clearFilters}
                />
                <ActionButton onClick={() => setFilterSheetOpen(false)}>Show {cards.length} cards</ActionButton>
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
              <span>Page {corePage} of {corePages}</span>
            </div>
            <ActionButton className={styles.mobileFilterButton} tone="secondary" onClick={() => setFilterSheetOpen(true)}>
              Filters{activeCoreFilterCount ? ` (${activeCoreFilterCount})` : ""}
            </ActionButton>
            <Tabs className={styles.densityTabs} label="BakuCore gallery density">
              <button className={coreState.density === "gallery" ? "active" : ""} onClick={() => navigateCore({ density: "gallery" })}>Gallery</button>
              <button className={coreState.density === "compact" ? "active" : ""} onClick={() => navigateCore({ density: "compact" })}>Compact</button>
            </Tabs>
            <button className={styles.shareResults} type="button" onClick={() => void copyCurrentLink("BakuCore results")}>Share results</button>
          </section>
          <div className={styles.coreWorkspace}>
            <Surface as="aside" className={styles.filterRail} aria-label="BakuCore filters">
              <CoreFilterControls
                state={coreState}
                onChange={(patch) => navigateCore(patch, { resetPage: true })}
                onSortChange={(sort) => navigateCore({ sort }, { resetPage: true })}
                onClear={clearCoreFilters}
              />
            </Surface>
            <main className={styles.gallery}>
              {visibleCores.length ? (
                <CardGrid className={`${styles.cardGrid} ${styles.coreGrid} ${coreState.density === "compact" ? styles.cardGridCompact : ""}`} minCardWidth={coreState.density === "compact" ? "9.25rem" : "11.5rem"}>
                  {visibleCores.map((core) => {
                    const displayedCore = coreForSet(core, coreState.set);
                    const baseStats = coreBaseStats(core);
                    const specialEffects = coreSpecialEffects(core);
                    return (
                      <button
                        className={`${styles.cardTile} ${styles.coreTile} ${selectedCore?.id === core.id ? styles.cardTileSelected : ""}`}
                        type="button"
                        aria-pressed={selectedCore?.id === core.id}
                        key={core.id}
                        onClick={(event) => selectCore(core, event.currentTarget)}
                      >
                        <span className={styles.coreArt}><BakuCoreArt core={displayedCore} alt={`${core.name} front`} /></span>
                        <span className={styles.cardCopy}>
                          <span className={styles.cardBadges}><StatusChip tone="info">{core.type}</StatusChip><StatusChip>{displayedCore.set === "Armored Alliance" ? "AA" : "BB"}</StatusChip>{core.printings?.length ? <StatusChip tone="gold">Alternate</StatusChip> : null}</span>
                          <strong>{core.name}</strong>
                          <span className={styles.coreCollector}>{displayedCore.set === "Armored Alliance" ? "AA" : "BB"} #{displayedCore.number}</span>
                          {baseStats.length > 0 && <span className={styles.coreStats}>{baseStats.join(" · ")}</span>}
                          {core.printings?.length ? <span className={styles.coreAlternate}>AA alternate printing</span> : null}
                          {specialEffects.length > 0 && <span className={styles.coreEffects} aria-label="BakuCore effects">{specialEffects.join(" · ")}</span>}
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
              <nav className={styles.pagination} aria-label="BakuCore result pages">
                <button disabled={corePage === 1} onClick={() => navigateCore({ page: corePage - 1 }, { push: true })}>← Previous</button>
                <span>Page {corePage} of {corePages}</span>
                <button disabled={corePage === corePages} onClick={() => navigateCore({ page: corePage + 1 }, { push: true })}>Next →</button>
              </nav>
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
          {filterSheetOpen && (
            <div data-ui="filter-backdrop" className={styles.filterBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFilterSheetOpen(false); }}>
              <Surface as="aside" data-motion-surface="filter-sheet" className={styles.filterSheet} role="dialog" aria-modal="true" aria-label="BakuCore filters">
                <CoreFilterControls
                  state={coreState}
                  onChange={(patch) => navigateCore(patch, { resetPage: true })}
                  onSortChange={(sort) => navigateCore({ sort }, { resetPage: true })}
                  onClear={clearCoreFilters}
                />
                <ActionButton onClick={() => setFilterSheetOpen(false)}>Show {cores.length} BakuCores</ActionButton>
              </Surface>
            </div>
          )}
        </>
      )}

      {section === "rules" && <OfficialRulebook query={deferredSearchQuery} />}

      {section === "rulings" && (
        <>
          <section className="rulings-heading"><div><span className="eyebrow">PUBLISHED RESPONSES</span><h2>Rulings</h2></div><AppButton tone="red" onClick={() => setShowSubmission(true)}>SUBMIT A QUESTION</AppButton></section>
          <section className="ruling-list modern-rulings">{PUBLISHED_RULINGS.filter((ruling) => !normalized || `${ruling.title} ${ruling.body}`.toLowerCase().includes(normalized)).map((ruling) => <article className="panel" key={ruling.slug}><div className="hero-actions"><Badge tone="gold">PUBLISHED</Badge><Badge>DEVELOPER RESPONSE</Badge></div><h2>{ruling.title}</h2><p>{ruling.body}</p><footer><small>{ruling.sourceSection} · Reviewed {ruling.reviewedAt}</small><button onClick={() => void copyLink(`/compendium/rulings/${ruling.slug}`, ruling.title)}>COPY LINK</button></footer></article>)}</section>
        </>
      )}

      </div>

      {showSubmission && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowSubmission(false); }}>
          <section className="panel ruling-submission-modal" role="dialog" aria-modal="true" aria-labelledby="ruling-question-title">
            <h2 id="ruling-question-title">Submit an unanswered interaction</h2>
            <p>Questions enter the administrator review queue. Published responses remain clearly attributed in the Compendium.</p>
            <label>Card<select value={rulingCardId} onChange={(event) => setRulingCardId(event.target.value)}><option value="">General rules question</option>{CARDS.map((card) => <option value={card.catalogId} key={card.catalogId}>{cardSetCode(card)} · {card.displayName}</option>)}</select></label>
            <label>Question<textarea value={question} onChange={(event) => setQuestion(event.target.value)} minLength={20} maxLength={2000} /></label>
            {submission === "sent" && <p className="success-message">Request submitted.</p>}
            <div className="hero-actions"><AppButton tone="red" disabled={submission === "submitting" || question.trim().length < 20} onClick={() => void submitRuling()}>{submission === "submitting" ? "SUBMITTING…" : "SUBMIT RULING REQUEST"}</AppButton><AppButton tone="ghost" onClick={() => setShowSubmission(false)}>CLOSE</AppButton></div>
          </section>
        </div>
      )}
    </div>
  );
}
