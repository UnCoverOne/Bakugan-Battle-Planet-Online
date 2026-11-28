"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CardInspector } from "../cards/CardInspector";
import { ActionButton, Surface } from "../design-system/primitives";
import { useAppFields } from "../application/AppProvider";
import { CARDS, CORE_COMPENDIUM } from "../../lib/data";
import { activeCardFilterCount, createCardFilterOptionCatalogue, type CardFilterFacet } from "../../lib/card-filters";
import { SORT_LABELS, CHARACTER_SORTS, NON_CHARACTER_SORTS, CORE_SORT_LABELS } from "../../lib/catalogue-sorting";
import { COMPENDIUM_PAGE_SIZE, CORE_COMPENDIUM_PAGE_SIZE, filterAndSortCompendiumCores, parseCompendiumState, parseCoreCompendiumState, parseInspectorTab, selectedCompendiumCard, selectedCompendiumCore } from "../../lib/compendium";
import { COLLECTION_FIELDS, COLLECTION_QUANTITY_OPTIONS, COLLECTION_SORT_OPTIONS, updateCollection, type Collection, type CollectionField, type CollectionSort } from "../../lib/collection";
import { cardCollectionCatalogue, coreCollectionPrintings, printingTotals, matchesCollection, sortCollection, COLLECTION_STATUS_OPTIONS } from "../../lib/collection-catalogue";
import { CardsGallery } from "./CardsGallery";
import { CoresGallery } from "./CoresGallery";
import { CompendiumToolbar } from "./CompendiumToolbar";
import { CompendiumSidebar } from "./CompendiumSidebar";
import { CompendiumPagination } from "./CompendiumPagination";
import { CompendiumFieldPicker } from "./CompendiumFieldPicker";
import { FilterControls, CoreFilterControls } from "./CatalogueFilters";
import { CollectionCounters, quantityLabel } from "./CollectionCounters";
import layout from "./CompendiumScreen.module.css";
import styles from "./CollectionScreen.module.css";

const quantityKey = (field: CollectionField) => "collection" + quantityLabel(field);
const cardFilterKeys = ["type","set","faction","coreType","cost","rarity","keyword","bPower","damage","fusions"];
const coreFilterKeys = ["coreType","coreSet","corePower","coreDamage","coreEffect","coreFaction"];
const collectionKeys = ["collectionStatus", ...COLLECTION_FIELDS.map(quantityKey)];
type Patch = Record<string, string | string[] | null>;

export function CollectionScreen() {
  const params = useSearchParams();
  const { authUser, accountDataReady, syncStatus, requestAccountAccess, collection, setCollection, catalogueRevision } = useAppFields(["authUser","accountDataReady","syncStatus","requestAccountAccess","collection","setCollection","catalogueRevision"]);
  const section = params.get("collectionTab") === "cores" ? "cores" : "cards";
  const isCards = section === "cards";
  const state = useMemo(() => parseCompendiumState(params.toString()), [params]);
  const coreState = useMemo(() => parseCoreCompendiumState(params.toString()), [params]);
  const urlQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const deferredQuery = useDeferredValue(query);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopVisible, setDesktopVisible] = useState(true);
  const sidebarTrigger = useRef<HTMLButtonElement>(null);
  const resultsStart = useRef<HTMLElement>(null);
  const inspectorTrigger = useRef<HTMLElement | null>(null);
  const localSearch = useRef(false);
  const timer = useRef<number | null>(null);
  const pageKey = isCards ? "page" : "corePage";
  const densityKey = isCards ? "density" : "coreDensity";
  const density = isCards ? state.density : coreState.density;
  const statuses = params.getAll("collectionStatus").filter(value => COLLECTION_STATUS_OPTIONS.some(option => option.value === value));
  const quantities = Object.fromEntries(COLLECTION_FIELDS.map(field => [field, params.getAll(quantityKey(field)).filter(value => COLLECTION_QUANTITY_OPTIONS.some(option => option.value === value))])) as Record<CollectionField, string[]>;
  const rawSort = params.get("collectionSort");
  const collectionSort: CollectionSort = COLLECTION_SORT_OPTIONS.find(option => option.value === rawSort)?.value ?? "collector";
  const characterOnly = state.type.length === 1 && state.type[0] === "Character";
  const allowedSorts = characterOnly ? CHARACTER_SORTS : NON_CHARACTER_SORTS;
  const selectedCardSort = allowedSorts.has(state.sort) ? state.sort : "collector";
  const filterOptions = useMemo(() => { void catalogueRevision; return createCardFilterOptionCatalogue(CARDS); }, [catalogueRevision]);
  const cardCatalogue = useMemo(() => {
    void catalogueRevision;
    return isCards ? cardCollectionCatalogue(CARDS, { ...state, q: deferredQuery, sort: selectedCardSort }) : null;
  }, [catalogueRevision, isCards, state, deferredQuery, selectedCardSort]);
  const coreCatalogue = useMemo(() => isCards ? [] : filterAndSortCompendiumCores(CORE_COMPENDIUM, { ...coreState, q: deferredQuery }), [isCards, coreState, deferredQuery]);
  const cardPrintings = cardCatalogue?.printings;
  const corePrintings = useMemo(() => new Map(coreCatalogue.map(core => [core.id, coreCollectionPrintings(core, coreState.set)])), [coreCatalogue, coreState.set]);
  const cardTotals = useMemo(() => new Map((cardCatalogue?.cards ?? []).map(card => [card.catalogId, printingTotals(collection, cardPrintings?.get(card.catalogId) ?? [])])), [cardCatalogue, cardPrintings, collection]);
  const coreTotals = useMemo(() => new Map(coreCatalogue.map(core => [core.id, printingTotals(collection, corePrintings.get(core.id) ?? [])])), [coreCatalogue, corePrintings, collection]);
  const cards = sortCollection((cardCatalogue?.cards ?? []).filter(card => matchesCollection(cardTotals.get(card.catalogId)!, statuses, quantities)), collectionSort, card => cardTotals.get(card.catalogId)!);
  const cores = sortCollection(coreCatalogue.filter(core => matchesCollection(coreTotals.get(core.id)!, statuses, quantities)), collectionSort, core => coreTotals.get(core.id)!);
  const total = isCards ? cards.length : cores.length;
  const pageSize = isCards ? COMPENDIUM_PAGE_SIZE : CORE_COMPENDIUM_PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const requestedPage = isCards ? state.page : coreState.page;
  const page = query !== urlQuery ? 1 : Math.min(requestedPage, pages);
  const activeCount = (isCards ? activeCardFilterCount(state) + Number(state.fusionOnly) : [coreState.type,coreState.set,coreState.bonus,coreState.damage,coreState.effects,coreState.faction].reduce((n, values) => n + values.length, 0)) + statuses.length + COLLECTION_FIELDS.reduce((n, field) => n + quantities[field].length, 0);
  const navigate = useCallback((patch: Patch, push = false) => {
    const next = new URLSearchParams(window.location.search);
    if (localSearch.current) { if (query) next.set("q", query); else next.delete("q"); next.delete("page"); next.delete("corePage"); }
    for (const [key,value] of Object.entries(patch)) {
      next.delete(key);
      if (Array.isArray(value)) value.forEach(item => next.append(key,item));
      else if (value) next.set(key,value);
    }
    window.history[push ? "pushState" : "replaceState"](null,"","/collection" + (next.size ? "?" + next : ""));
  }, [query]);
  useEffect(() => {
    const onPop = () => { localSearch.current = false; if (timer.current !== null) window.clearTimeout(timer.current); };
    window.addEventListener("popstate",onPop);
    return () => window.removeEventListener("popstate",onPop);
  }, []);
  useEffect(() => {
    if (query === urlQuery) { localSearch.current = false; return; }
    if (!localSearch.current) { setQuery(urlQuery); return; }
    timer.current = window.setTimeout(() => navigate({ q: query || null, page: null, corePage: null }),450);
    return () => { if (timer.current !== null) window.clearTimeout(timer.current); };
  }, [query,urlQuery,navigate]);
  useEffect(() => {
    if (requestedPage > pages && query === urlQuery) navigate({ [pageKey]: pages === 1 ? null : String(pages) });
  }, [requestedPage,pages,query,urlQuery,navigate,pageKey]);
  const changeCollection = useCallback((id: string, field: CollectionField, delta: number) => {
    if (authUser && accountDataReady) setCollection((current: Collection) => updateCollection(current,id,field,delta));
  }, [authUser,accountDataReady,setCollection]);
  const closeSidebar = useCallback(() => {
    if (window.matchMedia("(max-width: 900px)").matches) setSidebarOpen(false);
    else setDesktopVisible(false);
    sidebarTrigger.current?.focus();
  }, []);
  const filter = (patch: Patch) => navigate({ ...patch, [pageKey]: null });
  const clearFilters = () => filter(Object.fromEntries([...(isCards ? cardFilterKeys : coreFilterKeys), ...collectionKeys].map(key => [key,null])));
  const setCardFilter = (key: CardFilterFacet, values: string[]) => {
    if (key !== "type") { filter({ [key]: values }); return; }
    const onlyCharacter = values.length === 1 && values[0] === "Character";
    const nextSorts = onlyCharacter ? CHARACTER_SORTS : NON_CHARACTER_SORTS;
    filter({ type: values, ...(!onlyCharacter ? {coreType:null,fusions:null} : {cost:null,rarity:null}),
      ...(!values.includes("Character") && !values.includes("Evo") ? {bPower:null,damage:null} : {}),
      ...(!nextSorts.has(state.sort) ? {sort:null} : {}) });
  };
  const sortOptions = [
    ...(isCards ? Object.entries(SORT_LABELS).filter(([value]) => allowedSorts.has(value as typeof state.sort)) : Object.entries(CORE_SORT_LABELS)).map(([value,label]) => ({value,label})),
    ...COLLECTION_SORT_OPTIONS.filter(option => option.value !== "collector"),
  ];
  const sortControl = <CompendiumFieldPicker label="Sort By" mode="single" clearable={false} options={sortOptions}
    values={[collectionSort !== "collector" ? collectionSort : isCards ? selectedCardSort : coreState.sort]}
    onChange={values => {
      const value = values[0] ?? "collector";
      const quantitySort = value !== "collector" && COLLECTION_SORT_OPTIONS.some(option => option.value === value);
      filter({ collectionSort: quantitySort ? value : null, [isCards ? "sort" : "coreSort"]: quantitySort || value === "collector" ? null : value });
    }}/>;
  const selectedCard = isCards ? selectedCompendiumCard(CARDS,state.card,state.fusionOnly) : null;
  const selectedCore = !isCards ? selectedCompendiumCore(CORE_COMPENDIUM,coreState.core) : null;
  const inspectorTab = parseInspectorTab(params.get("tab"),"collection");
  const closeInspector = () => navigate({card:null,core:null,printing:null,tab:null});
  const selectCard = (card: typeof CARDS[number], trigger?: HTMLElement) => {
    if (trigger) inspectorTrigger.current = trigger;
    navigate({ card:card.slug ?? card.catalogId,core:null,printing:card.fusionFace === "b" ? CARDS.find(candidate => candidate.fusionPairId === card.fusionPairId && candidate.fusionFace === "a")?.catalogId ?? null : card.catalogId,tab:"collection" },true);
  };
  const selectCore = (core: typeof CORE_COMPENDIUM[number], trigger?: HTMLElement) => {
    if (trigger) inspectorTrigger.current = trigger;
    navigate({core:core.catalogId ?? core.id,card:null,printing:corePrintings.get(core.id)?.[0]?.id ?? null,tab:"collection"},true);
  };
  const changePage = (next: number) => {
    navigate({[pageKey]:next > 1 ? String(next) : null},true);
    window.requestAnimationFrame(() => resultsStart.current?.scrollIntoView({block:"start",behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"}));
  };
  if (!authUser || !accountDataReady) return <div className={layout.route}>
    <h1 className={layout.visuallyHidden}>Collection</h1>
    <Surface className={styles.account} role={authUser ? "status" : undefined}>
      <h2>{authUser ? "Loading your collection…" : "Sign in to track your collection"}</h2>
      <p>{authUser ? "Your inventory will be available when your account data has loaded." : "Track your cards, BakuCores and wishlist privately across devices."}</p>
      {!authUser && <div className={styles.accountActions}><ActionButton onClick={() => requestAccountAccess("signup")}>Create account</ActionButton><ActionButton tone="secondary" onClick={() => requestAccountAccess("login")}>Log in</ActionButton></div>}
    </Surface>
  </div>;
  const noun = isCards ? "cards" : "BakuCores";
  const syncLabel = syncStatus === "synced" ? "Collection synced" : syncStatus === "saving" ? "Saving collection…" : syncStatus === "offline" ? "Offline — awaiting sync" : syncStatus === "error" ? "Sync failed — changes remain on this device" : "Checking account sync…";
  return <div className={layout.route + " " + styles.scope}>
    <h1 className={layout.visuallyHidden}>Collection</h1>
    <CompendiumToolbar collection section={section} query={query} onSearch={value => {localSearch.current=true;setQuery(value);}}
      onSectionChange={next => {
        if (next === section || (next !== "cards" && next !== "cores")) return;
        setSidebarOpen(false);
        navigate({...Object.fromEntries([...cardFilterKeys,...coreFilterKeys,"sort","coreSort","page","corePage","card","core","printing","tab"].map(key => [key,null])),collectionTab:next === "cores" ? "cores" : null},true);
      }} sidebarTrigger={sidebarTrigger} activeCount={activeCount} density={density} sidebarOpen={sidebarOpen} desktopSidebarVisible={desktopVisible}
      onSidebar={() => window.matchMedia("(max-width: 900px)").matches ? setSidebarOpen(true) : setDesktopVisible(value => !value)}
      onDensityChange={() => navigate({[densityKey]:density === "gallery" ? "compact" : null})}/>
    <div className={`${isCards ? layout.workspace : layout.coreWorkspace} ${desktopVisible ? "" : layout.withoutSidebar}`}>
      <CompendiumSidebar label="Filters & Sort" open={sidebarOpen} desktopVisible={desktopVisible} onClose={closeSidebar} onClear={clearFilters} activeCount={activeCount}
        footer={<button type="button" onClick={closeSidebar}>Show {total.toLocaleString()} {noun}</button>}>
        <CompendiumFieldPicker label="Collection status" values={statuses} options={COLLECTION_STATUS_OPTIONS} onChange={values => filter({collectionStatus:values})}/>
        {sortControl}
        {COLLECTION_FIELDS.map(field => <CompendiumFieldPicker key={field} label={quantityLabel(field) + " quantity"} values={quantities[field]} options={COLLECTION_QUANTITY_OPTIONS} onChange={values => filter({[quantityKey(field)]:values})}/>)}
        {isCards ? <FilterControls state={state} filterOptions={filterOptions} onChange={setCardFilter} onFusionChange={enabled => filter({fusions:enabled ? "1" : null})} onSortChange={sort => filter({sort})} sortControl={false}/>
          : <CoreFilterControls state={coreState} onChange={patch => {
            const keys = {type:"coreType",set:"coreSet",bonus:"corePower",damage:"coreDamage",effects:"coreEffect",faction:"coreFaction"} as const;
            filter(Object.fromEntries(Object.entries(patch).map(([key,value]) => [keys[key as keyof typeof keys],value])) as Patch);
          }} onSortChange={sort => filter({coreSort:sort})} sortControl={false}/>}
      </CompendiumSidebar>
      <main className={layout.gallery} ref={resultsStart}>
        <div className={styles.results}>
          <div className={layout.galleryHeader}>
            <CompendiumPagination page={page} totalPages={pages} totalResults={total} pageSize={pageSize} noun={noun} onPageChange={changePage}/>
            {pages <= 1 && <span className={layout.singlePageCount}>{total.toLocaleString()} {noun}</span>}
          </div>
          <div className={styles.sync} role="status" data-error={syncStatus === "error" || syncStatus === "offline"}>{syncLabel}</div>
        </div>
        {total ? isCards ? <CardsGallery collection cards={cards.slice((page-1)*pageSize,page*pageSize)} density={density} selectedId={selectedCard?.catalogId} onSelect={selectCard}
          renderControls={card => <CollectionCounters label={card.displayName} totals={cardTotals.get(card.catalogId)!} printings={cardPrintings?.get(card.catalogId) ?? []} collection={collection} onChange={changeCollection}/>}/>
          : <CoresGallery collection cores={cores.slice((page-1)*pageSize,page*pageSize)} density={density} selectedSets={coreState.set} selectedId={selectedCore?.id} onSelect={selectCore}
          renderControls={core => <CollectionCounters label={core.name} totals={coreTotals.get(core.id)!} printings={corePrintings.get(core.id) ?? []} collection={collection} onChange={changeCollection}/>}/>
          : <Surface className={layout.emptyResults} role="status"><h2>No {noun} match</h2><p>Adjust your search or collection filters to find more items.</p><ActionButton tone="secondary" onClick={() => {localSearch.current=false;setQuery("");navigate({...Object.fromEntries([...(isCards ? cardFilterKeys : coreFilterKeys),...collectionKeys].map(key=>[key,null])),q:null,[pageKey]:null});}}>Clear search &amp; filters</ActionButton></Surface>}
        {pages > 1 && <div className={layout.galleryFooter}><CompendiumPagination placement="bottom" page={page} totalPages={pages} totalResults={total} pageSize={pageSize} noun={noun} onPageChange={changePage}/></div>}
      </main>
      {selectedCard && <CardInspector card={selectedCard} allCards={CARDS} tab={inspectorTab} printingId={params.get("printing") ?? ""} onPrintingChange={printing => navigate({printing},true)} onSelectCard={card => navigate({card:card.slug ?? card.catalogId,printing:null,tab:"overview"},true)} collectionEnabled collection={collection} onCollectionChange={changeCollection} onTabChange={tab => navigate({tab},true)} onClose={closeInspector} returnFocusRef={inspectorTrigger}/>}
      {selectedCore && <CardInspector core={selectedCore} allCores={CORE_COMPENDIUM} tab={inspectorTab} printingId={params.get("printing") ?? ""} onPrintingChange={printing => navigate({printing},true)} preferredCorePrintingId={coreCollectionPrintings(selectedCore,coreState.set)[0]?.id} collectionEnabled collection={collection} onCollectionChange={changeCollection} onTabChange={tab => navigate({tab},true)} onClose={closeInspector} returnFocusRef={inspectorTrigger}/>}
    </div>
  </div>;
}
