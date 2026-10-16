"use client";

import { OriginalImage } from "@/components/media/OriginalImage";
import { BakuCoreArt } from "@/components/bakucore/BakuCoreArt";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent } from "react";
import { activeCardFilterCount, CARD_FILTER_LABELS, CORE_SET_OPTIONS, cardMatchesFilters, clearCardFilterFacets, coreMatchesFilters, createCardFilterOptionCatalogue, createEmptyCardFilters, FACTION_SYMBOLS, restrictCardFilters, type CardFilterFacet, type CardFilterOptionCatalogue, type CardFilterState } from "../../lib/card-filters";
import { cardArtSource } from "../../lib/content/card-art";
import { createBuilderCardControls } from "../../lib/builder-card-selection";
import { createCoreAdditionGuard } from "../../lib/builder-core-selection";
import { builderSortOptions, normalizeBuilderSort, sortBuilderItems, type BuilderCategory, type BuilderSort, type BuilderGalleryItem } from "../../lib/builder-sorting";
import { BAKUGAN, CARD_BY_ID, CARDS, CORES, validateDeck, type DeckRecord } from "../../lib/data";
import type { DeckValidationResult } from "../../lib/deck-validation";
import type { Core, GameCard } from "../../lib/game";
import type { CardInspectorTab } from "../../lib/compendium";
import { PUBLISHED_RULINGS } from "../../lib/reference";
import { DECK_LIMIT } from "../../lib/deck-transfer";
import { invalidateResponse } from "../../lib/response-cache";
import { cardSearchText, frequencyMap } from "../../lib/catalogue-index";
import { deckSetName } from "../../lib/deck-set";
import { notifyOfflinePublicDecksUpdated } from "../../lib/public-deck-cache";
import { useAppFields } from "../application/AppProvider";
import { CardArt } from "../cards/CardArt";
import { copyText } from "../application/ui";
import { CardInspector } from "../cards/CardInspector";
import { ResponsiveCardImage } from "../cards/ResponsiveCardImage";
import { ActionButton, Field, StatusChip, Tabs } from "../design-system/primitives";
import { CardFilterPanel } from "../filters/CardFilterPanel";
import styles from "./DeckRoutes.module.css";
import { MotionValue } from "../design-system/MotionValue";
import { builderScope, builderBase, readBuilderDraft, writeBuilderDraft, setActiveBuilder, clearBuilderDraft, shouldConfirmBuilderExit, type BuilderDraft } from "../../lib/builder-session";
import { useCompetitiveRules, clone, blankDraft, DeckState } from "./DeckRouteShared";
import { BUILDER_RULE_REFERENCES } from "./DeckInspectorReferences";

type BuilderView = "gallery" | "deck";

type BuilderMenu =
  | { surface: "gallery" | "deck"; panel: "filter" | "sort" }
  | { surface: "team" | "cores" | "mainDeck"; panel: "issues" }
  | { surface: "deck"; panel: "save" | "leave" };

type BuilderInspection =
  | { kind: "card"; card: GameCard }
  | { kind: "core"; coreId: string };

const BUILDER_MAIN_DECK_FILTER_FACETS: readonly CardFilterFacet[] = [
  "type",
  "set",
  "faction",
  "cost",
  "rarity",
  "keyword",
];

const BUILDER_GALLERY_FILTER_FACETS: Record<BuilderCategory, readonly CardFilterFacet[]> = {
  cards: BUILDER_MAIN_DECK_FILTER_FACETS,
  characters: ["set", "faction", "coreType", "keyword"],
  cores: ["set", "coreType"],
};

const CORE_BACK_IMAGES: Record<string, string> = {
  Fist: "/assets/bakucores/backs/fist.png",
  "Flaming Fist": "/assets/bakucores/backs/flaming-fist.png",
  Shield: "/assets/bakucores/backs/shield.png",
  "Magic Shield": "/assets/bakucores/backs/magic-shield.png",
  Helix: "/assets/bakucores/backs/helix.png",
};


export function DeckBuilderScreen({ id, returnTo }: { id: string; returnTo?: string }) {
  const { authUser } = useAppFields(["authUser"]);
  const scope = builderScope(authUser?.id);
  return <BuilderSessionLoader key={`${scope}:${id}`} id={id} returnTo={returnTo} scope={scope} />;
}

function BuilderSessionLoader({ id, returnTo, scope }: { id: string; returnTo?: string; scope: string }) {
  const [session, setSession] = useState<{ draft: BuilderDraft | null } | null>(null);
  useLayoutEffect(() => { setSession({ draft: id.startsWith("admin-") ? null : readBuilderDraft(scope, id) }); }, [scope, id]);
  if (!session) return <div role="status">Restoring deck…</div>;
  return <DeckBuilderEditor id={id} returnTo={returnTo} scope={scope} recovered={session.draft} />;
}

function DeckBuilderEditor({ id, returnTo: requestedReturn, scope, recovered }: { id: string; returnTo?: string; scope: string; recovered: BuilderDraft | null }) {
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
    catalogueRevision,
  } = useAppFields(["decks", "setDecks", "builderDeck", "setBuilderDeck", "setSelectedDeckId", "storageHealth", "notify", "promptAccount", "catalogueRevision"]);
  const competitiveRules = useCompetitiveRules();
  const { deckSize: competitiveDeckSize, restrictions: competitiveRestrictions } = competitiveRules;
  const competitiveRulesReady = !competitiveRules.loading && !competitiveRules.error;
  const adminPublicId = id.startsWith("admin-public:") ? id.slice("admin-public:".length) : null;
  const adminAiId = id.startsWith("admin-ai:") ? id.slice("admin-ai:".length) : null;
  const adminOfflineId = id.startsWith("admin-offline:") ? id.slice("admin-offline:".length) : null;
  const adminResourceId = adminPublicId ?? adminAiId ?? adminOfflineId;
  const administratorEdit = Boolean(adminResourceId);
  const source = administratorEdit ? builderDeck : id === "new" ? builderDeck : decks.find((item: DeckRecord) => item.id === id);
  const [deck, setDeck] = useState<DeckRecord>(() => clone(recovered?.deck ?? source ?? blankDraft(decks)));
  const baseline = useRef(recovered?.base ?? builderBase(id === "new" ? undefined : source));
  const recoveredConflict = useRef(Boolean(recovered && id !== "new" && recovered.base !== builderBase(source))).current;
  const ui = recovered?.ui ?? {};
  const restoredText = (key: string, fallback: string) => typeof ui[key] === "string" ? ui[key] as string : fallback;
  const restoredChoice = <T extends string,>(key: string, values: readonly T[], fallback: T): T => values.includes(ui[key] as T) ? ui[key] as T : fallback;
  const restoredFilters = (key: string, fallback: CardFilterState) => {
    const value = ui[key];
    if (!value || typeof value !== "object") return fallback;
    const filters = createEmptyCardFilters();
    for (const facet of Object.keys(filters) as Array<keyof CardFilterState>) {
      const saved = (value as CardFilterState)[facet];
      if (Array.isArray(saved) && saved.every(item => typeof item === "string")) filters[facet] = saved;
    }
    return filters;
  };
  const [remoteLoading, setRemoteLoading] = useState(administratorEdit && !source);
  const [builderView, setBuilderView] = useState<BuilderView>(() => restoredChoice("builderView", ["gallery", "deck"], "gallery"));
  const [galleryQuery, setGalleryQuery] = useState(() => restoredText("galleryQuery", ""));
  const deferredGalleryQuery = useDeferredValue(galleryQuery);
  const [deckQuery, setDeckQuery] = useState(() => restoredText("deckQuery", ""));
  const [galleryCategory, setGalleryCategory] = useState<BuilderCategory>(() => restoredChoice("galleryCategory", ["cards", "characters", "cores"], "characters"));
  const [gallerySort, setGallerySort] = useState<BuilderSort>(() => normalizeBuilderSort(galleryCategory, restoredText("gallerySort", "collector")));
  const [deckSort, setDeckSort] = useState<BuilderSort>(() => normalizeBuilderSort("cards", restoredText("deckSort", "name-asc")));
  const [galleryFilters, setGalleryFilters] = useState<CardFilterState>(() => restoredFilters("galleryFilters", createEmptyCardFilters({
    faction: [...new Set(deck.factions ?? [])],
  })));
  const [factionFilterAuto, setFactionFilterAuto] = useState(typeof ui.factionFilterAuto === "boolean" ? ui.factionFilterAuto : Boolean(deck.bakuganIds.length));
  const [deckFilters, setDeckFilters] = useState<CardFilterState>(() => restoredFilters("deckFilters", createEmptyCardFilters()));
  const [exitAfterSave, setExitAfterSave] = useState(false);
  const [activeMenu, setActiveMenu] = useState<BuilderMenu | null>(null);
  const [inspection, setInspection] = useState<BuilderInspection | null>(null);
  const [inspectorTab, setInspectorTab] = useState<CardInspectorTab>("overview");
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "error">("saved");
  const [saveName, setSaveName] = useState(() => restoredText("saveName", deck.name));
  const [saveDescription, setSaveDescription] = useState(() => restoredText("saveDescription", deck.description ?? ""));
  const [saveVisibility, setSaveVisibility] = useState<DeckRecord["visibility"]>(() => restoredChoice("saveVisibility", ["Draft", "Private", "Public"], deck.visibility));
  const [saveLeadCardId, setSaveLeadCardId] = useState(
    () => restoredText("saveLeadCardId", deck.leadCardId && deck.cardIds.includes(deck.leadCardId) ? deck.leadCardId : deck.cardIds[0] ?? ""),
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

  const latestDraft = useRef<BuilderDraft | null>(null);
  const sessionEnded = useRef(false);
  useEffect(() => {
    if (administratorEdit || sessionEnded.current) return;
    setActiveBuilder(scope, id);
    if (recoveredConflict) notify("A newer saved version exists. Your draft is restored; saving it will create a separate copy.");
  }, [administratorEdit, scope, id, notify, recoveredConflict]);

  useEffect(() => {
    setBuilderDeck(deck);
    if (administratorEdit) {
      setSaveState(storageHealth.status === "error" ? "error" : "saved");
      return;
    }
    latestDraft.current = {
      version: 1, routeId: id, deck, base: baseline.current,
      ui: { builderView, galleryQuery, deckQuery, galleryCategory, gallerySort, deckSort,
        galleryFilters, deckFilters, factionFilterAuto, saveName, saveDescription, saveVisibility, saveLeadCardId },
    };
    setSaveState("dirty");
    const timer = window.setTimeout(() => {
      if (!sessionEnded.current && latestDraft.current) setSaveState(writeBuilderDraft(scope, latestDraft.current) ? "saved" : "error");
    }, 300);
    return () => window.clearTimeout(timer);
  }, [administratorEdit, scope, id, deck, builderView, galleryQuery, deckQuery, galleryCategory, gallerySort, deckSort, galleryFilters, deckFilters, factionFilterAuto, saveName, saveDescription, saveVisibility, saveLeadCardId, setBuilderDeck, storageHealth.status]);

  useEffect(() => {
    if (administratorEdit) return;
    const flush = () => { if (!sessionEnded.current && latestDraft.current) writeBuilderDraft(scope, latestDraft.current); };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [administratorEdit, scope]);

  const exitBuilder = (event: MouseEvent<HTMLAnchorElement>) => {
    if (administratorEdit) return;
    const saved = id === "new" ? undefined : decks.find((item: DeckRecord) => item.id === id);
    const workingDeck = {
      ...deck, name: saveName.trim(), description: saveDescription.trim() || undefined,
      visibility: saveVisibility,
      leadCardId: saveLeadCardId && deck.cardIds.includes(saveLeadCardId) ? saveLeadCardId : deck.cardIds[0],
    };
    if ((!returnTo || returnTo === "/decks") && shouldConfirmBuilderExit(workingDeck, saved)) {
      event.preventDefault();
      setActiveMenu({ surface: "deck", panel: "leave" });
      return;
    }
    if (latestDraft.current) writeBuilderDraft(scope, latestDraft.current);
    setActiveBuilder(scope, null);
  };

  useEffect(() => {
    if (!activeMenu && !inspection) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveMenu(null);
        setExitAfterSave(false);
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
  const report = useMemo(() => validateDeck(deck, competitiveRestrictions, competitiveDeckSize), [competitiveDeckSize, competitiveRestrictions, deck]);
  const mainDeckMaximum = deck.format === "competitive" ? competitiveDeckSize : 40;
  const cardControls = useMemo(() => createBuilderCardControls(
    deck.cardIds, CARD_BY_ID, deck.format, competitiveRestrictions, mainDeckMaximum, competitiveRulesReady,
  ), [deck.cardIds, deck.format, competitiveRestrictions, mainDeckMaximum, competitiveRulesReady]);
  const cardCounts = useMemo(() => frequencyMap(deck.cardIds), [deck.cardIds]);
  const coreCounts = useMemo(() => frequencyMap(deck.coreIds), [deck.coreIds]);
  const grouped = useMemo(() => [...cardCounts].map(([key, count]) => ({
    card: CARD_BY_ID.get(key),
    count,
  })).filter((entry): entry is { card: NonNullable<ReturnType<typeof CARD_BY_ID.get>>; count: number } => Boolean(entry.card)), [cardCounts]);

  const cardFilterOptions = useMemo<CardFilterOptionCatalogue>(() => {
    void catalogueRevision;
    const shared = createCardFilterOptionCatalogue(CARDS);
    return {
      ...shared,
      type: shared.type.filter((option) => option.value !== "Character"),
    };
  }, [catalogueRevision]);
  const galleryFilterOptions = useMemo<CardFilterOptionCatalogue>(() => galleryCategory === "cores"
    ? { ...cardFilterOptions, set: CORE_SET_OPTIONS }
    : cardFilterOptions, [cardFilterOptions, galleryCategory]);
  const changeGalleryCategory = (next: BuilderCategory) => {
    const nextSets = next === "cores" ? CORE_SET_OPTIONS : cardFilterOptions.set;
    setGalleryFilters(current => ({ ...current, set: [...new Set(current.set.flatMap(value => {
      const label = galleryFilterOptions.set.find(option => option.value === value)?.label;
      const matching = nextSets.find(option => option.value === value || option.label === label);
      return matching ? [matching.value] : [];
    }))] }));
    setGalleryCategory(next);
  };
  const effectiveGallerySort = normalizeBuilderSort(galleryCategory, gallerySort);
  const galleryFilterFacets = BUILDER_GALLERY_FILTER_FACETS[galleryCategory];

  const searchIndex = useMemo(() => {
    void catalogueRevision;
    return new Map([
    ...CARDS.map(card => [card.catalogId, cardSearchText(card.displayName, card)] as const),
    ...BAKUGAN.map(item => [item.id, cardSearchText(item.name, item.character)] as const),
  ]); }, [catalogueRevision]);
  const galleryItems = useMemo(() => {
    const query = deferredGalleryQuery.trim().toLowerCase();
    const effectiveFilters = restrictCardFilters(
      galleryFilters,
      BUILDER_GALLERY_FILTER_FACETS[galleryCategory],
    );
    const items: BuilderGalleryItem[] = galleryCategory === "cards" ? CARDS.filter((card) => card.type !== "Character").map((card) => ({
        kind: "card" as const,
        id: card.catalogId,
        name: card.displayName,
        card,
        count: cardCounts.get(card.catalogId) ?? 0,
      })) : galleryCategory === "characters" ? BAKUGAN.map((item) => ({
        kind: "character" as const,
        id: item.id,
        name: item.name,
        card: item.character,
        count: deck.bakuganIds.includes(item.id) ? 1 : 0,
      })) : CORES.map((core) => ({
        kind: "core" as const,
        id: core.id,
        name: core.name,
        core,
        count: coreCounts.get(core.id) ?? 0,
      }));
    return items.filter((item) => {
      if (galleryCategory === "cards" && item.kind !== "card") return false;
      if (galleryCategory === "characters" && item.kind !== "character") return false;
      if (galleryCategory === "cores" && item.kind !== "core") return false;
      const core = item.kind === "core" ? item.core : null;
      const card = item.kind === "core" ? null : item.card;
      const searchable = item.kind === "core"
        ? `${item.name} ${core?.type ?? ""}`
        : searchIndex.get(item.id) ?? "";
      if (query && !searchable.toLowerCase().includes(query)) return false;
      if (core && !coreMatchesFilters(core, effectiveFilters)) return false;
      if (card) {
        const cardFilters = item.kind === "character" && factionFilterAuto
          ? { ...effectiveFilters, faction: [] }
          : effectiveFilters;
        if (!cardMatchesFilters(card, cardFilters)) return false;
      }
      return true;
    }).sort((left, right) => sortBuilderItems(left, right, effectiveGallerySort, galleryFilters.set.length === 1 ? galleryFilters.set[0] : "All")).slice(0, 240);
  }, [
    deck.bakuganIds,
    cardCounts,
    coreCounts,
    searchIndex,
    factionFilterAuto,
    galleryCategory,
    galleryFilters,
    deferredGalleryQuery,
    effectiveGallerySort,
  ]);

  const mainDeckCards = useMemo(() => grouped.filter(({ card }) => {
    const query = deckQuery.trim().toLowerCase();
    if (query && !`${card.displayName} ${card.effect}`.toLowerCase().includes(query)) return false;
    return cardMatchesFilters(card, deckFilters);
  }).sort((left, right) => sortBuilderItems(
    { kind: "card", id: left.card.catalogId, name: left.card.displayName, card: left.card, count: left.count },
    { kind: "card", id: right.card.catalogId, name: right.card.displayName, card: right.card, count: right.count },
    deckSort,
  )), [deckFilters, deckQuery, deckSort, grouped]);

  const requiredCoreTypes = report.requiredCoreTypes;
  const canAddCore = useMemo(() => createCoreAdditionGuard(
    deck.coreIds, requiredCoreTypes, deck.bakuganIds.length > 0, deck.format === "singleton", CORES,
  ), [deck.coreIds, requiredCoreTypes, deck.bakuganIds.length, deck.format]);
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
    if (amount > 0 && cardControls.canAdd(key)) next.push(key);
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
    if (adding || factionFilterAuto) {
      setGalleryFilters((current) => ({ ...current, faction: nextFactions }));
    }
    if (adding) setFactionFilterAuto(true);
    commit({ ...deck, bakuganIds: nextIds });
  };
  const adjustCore = (key: string, amount: number) => {
    const next = [...deck.coreIds];
    if (amount > 0 && canAddCore(key)) next.push(key);
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
    if (item.kind === "core") return canAddCore(item.id);
    return cardControls.canAdd(item.id);
  };
  const activeGalleryFilterCount = activeCardFilterCount(galleryFilters, galleryFilterFacets);
  const activeDeckFilterCount = activeCardFilterCount(deckFilters, BUILDER_MAIN_DECK_FILTER_FACETS);

  const openSaveDialog = () => {
    if (administratorEdit) setSaveVisibility(adminPublicId || adminOfflineId ? "Public" : "Private");
    else if (!report.isLegal && saveVisibility === "Public") setSaveVisibility("Draft");
    setActiveMenu({ surface: "deck", panel: "save" });
  };

  const save = async () => {
    if (deck.format === "competitive" && !competitiveRulesReady) {
      notify(competitiveRules.error ?? "Wait for competitive rules to finish loading before saving.");
      return;
    }
    const latest = validateDeck(deck, competitiveRestrictions, competitiveDeckSize);
    const name = saveName.trim();
    if (!name) {
      notify("Enter a deck name before saving.");
      return;
    }
    if ((saveVisibility === "Public" || adminAiId || adminOfflineId) && !latest.isLegal) {
      notify(`${adminAiId ? "AI" : adminOfflineId ? "Offline fallback" : "Public"} decks must be valid: ${latest.issues[0].message}`);
      return;
    }
    const savedSource = decks.find((item: DeckRecord) => item.id === id);
    const saveAsCopy = !administratorEdit && id !== "new" && baseline.current !== builderBase(savedSource);
    if (decks.length >= DECK_LIMIT && (id === "new" || saveAsCopy) && !administratorEdit) {
      notify(`Deck limit reached (${DECK_LIMIT}).`);
      return;
    }
    const next = {
      ...deck,
      id: adminOfflineId ? `offline-${adminOfflineId}` : administratorEdit ? adminResourceId! : saveAsCopy ? crypto.randomUUID() : id === "new" ? deck.id : id,
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
        if (adminPublicId || adminOfflineId) invalidateResponse("public-decks:");
        if (adminOfflineId) notifyOfflinePublicDecksUpdated();
        notify(`${adminPublicId ? "Public" : adminOfflineId ? "Offline fallback" : "AI"} deck updated.`);
        router.push(returnTo ?? (adminOfflineId ? "/admin?tab=offline" : "/admin?tab=ai"));
      } catch (error) {
        setSaveState("error");
        notify(error instanceof Error ? error.message : "Administrator deck could not be saved.");
      }
      return;
    }
    sessionEnded.current = true;
    clearBuilderDraft(scope, id);
    setDecks((items: DeckRecord[]) => [next, ...items.filter((item) => item.id !== next.id)]);
    setSelectedDeckId(next.id);
    setBuilderDeck(null);
    setSaveState("saved");
    setActiveMenu(null);
    notify(saveAsCopy ? "Draft saved as a separate copy; the newer saved deck is preserved." : latest.isLegal ? `${saveVisibility} deck saved.` : `Deck saved with ${latest.issues.length} legality issues.`);
    promptAccount("deck-saved");
    router.push(exitAfterSave ? "/decks" : returnTo ?? `/decks/${encodeURIComponent(next.id)}`);
  };

  if (remoteLoading) {
    return <div className={styles.route}><DeckState tone="loading" role="status" title="Loading administrator deck" copy="Retrieving the server-owned deck record…" /></div>;
  }
  if (deck.format === "competitive" && !competitiveRulesReady) {
    return <div className={styles.route}><DeckState
      tone={competitiveRules.error ? "error" : "loading"}
      role={competitiveRules.error ? "alert" : "status"}
      title={competitiveRules.error ? "Competitive rules unavailable" : "Loading published Competitive rules"}
      copy={competitiveRules.error ?? "Fetching the administrator's active deck size and restrictions before validating this deck."}
      action={competitiveRules.error ? <button type="button" onClick={competitiveRules.retry}>Retry</button> : undefined}
    /></div>;
  }

  return (
    <section className={styles.builder}>
      <header className={styles.builderHeader}>
        <Link href={returnTo ?? "/decks"} onClick={exitBuilder}>{administratorEdit ? "← Administrator" : returnTo ? "← Match setup" : "← Back to decks"}</Link>
        <div className={styles.builderDeckIdentity}><span>{administratorEdit ? "Administrator Edit" : "Edit Deck"}</span><strong>{deck.name}</strong></div>
        <label className={styles.builderFormat}><span>Format</span><select aria-label="Deck format" value={deck.format ?? "standard"} onChange={(event) => commit({ ...deck, format: event.target.value as DeckRecord["format"] })}><option value="standard">Standard</option><option value="singleton">Singleton</option><option value="competitive">Competitive</option></select></label>
        <StatusChip tone="info">{deckSetName(deck).toUpperCase()}</StatusChip>
        <StatusChip tone={deck.format === "competitive" && !competitiveRulesReady ? "info" : report.isLegal ? "success" : "danger"}>
          {deck.format === "competitive" && !competitiveRulesReady ? competitiveRules.error ? "Competitive rules unavailable" : "Checking competitive rules…" : report.isLegal ? "Legal" : `${report.issues.length} issues`}
        </StatusChip>
        {deck.format === "competitive" && competitiveRules.error && <ActionButton tone="quiet" onClick={competitiveRules.retry}>Retry rules</ActionButton>}
        <span className={`${styles.saveState} ${styles[`saveState_${saveState}`]}`}>
          <MotionValue value={saveState} kind="status">{saveState === "error" ? "Draft not saved" : saveState === "dirty" ? "Saving draft…" : "Draft saved locally"}</MotionValue>
        </span>
        <ActionButton onClick={openSaveDialog}>Save Deck</ActionButton>
      </header>
      <Tabs className={styles.builderMobileTabs} label="Deck Builder sections">
        {(["gallery", "deck"] as BuilderView[]).map((value) => (
          <button key={value} className={builderView === value ? "active" : ""} onClick={() => setBuilderView(value)}>
            {value === "gallery" ? "Card Gallery" : `Current Deck ${deck.cardIds.length}/${mainDeckMaximum}`}
          </button>
        ))}
      </Tabs>
      <div className={styles.builderLayout}>
        <section data-ui="builder-panel" data-active={builderView === "gallery"} className={`${styles.builderGallery} ${builderView !== "gallery" ? styles.mobileHidden : ""}`}>
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
                onClick={() => changeGalleryCategory(value)}
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
          <BuilderActiveFilterChips
            ariaLabel="Active Card Gallery filters"
            filters={galleryFilters}
            facets={galleryFilterFacets}
            options={galleryFilterOptions}
            factionLabel={factionFilterAuto ? "Team faction" : undefined}
            onChange={(next, facet) => {
              if (facet === "faction") setFactionFilterAuto(false);
              setGalleryFilters(next);
            }}
          />
          {galleryItems.length ? (
            <div className={styles.builderGalleryGrid}>
              {galleryItems.map((item) => (
                <BuilderGalleryCard
                  key={`${item.kind}-${item.id}`}
                  item={item}
                  catalogueRevision={catalogueRevision}
                  canAdd={canAddGalleryItem(item)}
                  restriction={item.kind === "card" ? cardControls.restrictionLabel(item.id) : undefined}
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
                setGalleryFilters(createEmptyCardFilters());
                setFactionFilterAuto(false);
              }}>Clear filters</ActionButton>}
            />
          )}
        </section>

        <aside data-ui="builder-panel" data-active={builderView === "deck"} className={`${styles.builderCurrentDeck} ${builderView !== "deck" ? styles.mobileHidden : ""}`}>
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
                    <button onClick={() => inspectCore(core.id)}><BakuCoreArt core={core} alt={core.name} /></button>
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
            <BuilderActiveFilterChips
              ariaLabel="Active Main Deck filters"
              filters={deckFilters}
              facets={BUILDER_MAIN_DECK_FILTER_FACETS}
              options={cardFilterOptions}
              onChange={(next) => setDeckFilters(next)}
            />
            {mainDeckCards.length ? (
              <div className={styles.builderMainDeckGrid}>
                {mainDeckCards.map(({ card, count }) => (
                  <BuilderGalleryCard
                    key={card.catalogId}
                    item={{ kind: "card", id: card.catalogId, name: card.displayName, card, count }}
                    canAdd={cardControls.canAdd(card.catalogId)}
                    restriction={cardControls.restrictionLabel(card.catalogId)}
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
            {builderSortOptions(activeMenu.surface === "gallery" ? galleryCategory : "cards").map(([value, label]) => {
              const selected = activeMenu.surface === "gallery" ? effectiveGallerySort === value : deckSort === value;
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
                  setGalleryFilters((current) => clearCardFilterFacets(current, galleryFilterFacets));
                  if (galleryFilterFacets.includes("faction")) setFactionFilterAuto(false);
                } else {
                  setDeckFilters(createEmptyCardFilters());
                }
              }}>Reset</ActionButton>
              <ActionButton onClick={() => setActiveMenu(null)}>Show cards</ActionButton>
            </>
          )}
        >
          <CardFilterPanel
            filters={activeMenu.surface === "gallery" ? galleryFilters : deckFilters}
            facets={activeMenu.surface === "gallery" ? galleryFilterFacets : BUILDER_MAIN_DECK_FILTER_FACETS}
            options={activeMenu.surface === "gallery" ? galleryFilterOptions : cardFilterOptions}
            onChange={(next, facet) => {
              if (activeMenu.surface === "gallery") {
                if (facet === "faction") setFactionFilterAuto(false);
                setGalleryFilters(next);
              } else {
                setDeckFilters(next);
              }
            }}
          />
        </BuilderMenuDialog>
      )}

      {activeMenu?.panel === "leave" && (
        <BuilderMenuDialog
          title="Save this deck before leaving?"
          eyebrow="Unsaved changes"
          onClose={() => setActiveMenu(null)}
          footer={(
            <>
              <ActionButton tone="quiet" onClick={() => {
                sessionEnded.current = true;
                clearBuilderDraft(scope, id);
                setBuilderDeck(null);
                setActiveMenu(null);
                router.push("/decks");
              }}>Don’t Save</ActionButton>
              <ActionButton onClick={() => {
                setExitAfterSave(true);
                openSaveDialog();
                setSaveVisibility("Draft");
              }}>Save Draft</ActionButton>
            </>
          )}
        >
          <p>Your deck has unsaved changes. Save a draft before returning to your deck library.</p>
        </BuilderMenuDialog>
      )}

      {activeMenu?.panel === "save" && (
        <BuilderMenuDialog
          title="Save Deck"
          eyebrow={report.isLegal ? "Ready to save" : `Saving with ${report.issues.length} legality issues`}
          onClose={() => { setActiveMenu(null); setExitAfterSave(false); }}
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
                      <CardArt src={cardArtSource(card, "thumbnail")} cardType={card.type} presentation="readable" alt="" />
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
        <div className={styles.builderInspectorOverlay} role="presentation">
          {(() => {
            const core = CORES.find((candidate) => candidate.id === inspection.coreId);
            if (!core) return null;
            return (
              <CardInspector
                core={core}
                allCores={CORES}
                rules={BUILDER_RULE_REFERENCES}
                rulings={PUBLISHED_RULINGS}
                tab={inspectorTab}
                mode="embedded"
                onTabChange={setInspectorTab}
                onClose={() => setInspection(null)}
                onShare={() => {
                  const origin = globalThis.location?.origin ?? "";
                  void copyText(`${origin}/compendium/cores?core=${encodeURIComponent(core.catalogId ?? core.id)}`).then(() => notify("BakuCore link copied."));
                }}
              />
            );
          })()}
        </div>
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

function BuilderActiveFilterChips({
  ariaLabel,
  filters,
  facets,
  options,
  factionLabel,
  onChange,
}: {
  ariaLabel: string;
  filters: CardFilterState;
  facets: readonly CardFilterFacet[];
  options: CardFilterOptionCatalogue;
  factionLabel?: string;
  onChange: (next: CardFilterState, facet: CardFilterFacet) => void;
}) {
  const visible = restrictCardFilters(filters, facets);
  return (
    <div className={styles.activeFilters} aria-label={ariaLabel}>
      {facets.flatMap((facet) => visible[facet].map((value) => {
        const option = options[facet].find((candidate) => candidate.value === value);
        const facetLabel = facet === "faction" && factionLabel ? factionLabel : CARD_FILTER_LABELS[facet];
        return (
          <button
            type="button"
            key={`${facet}-${value}`}
            onClick={() => onChange({
              ...filters,
              [facet]: filters[facet].filter((candidate) => candidate !== value),
            }, facet)}
          >
            {facetLabel}: {option?.label ?? value} ×
          </button>
        );
      }))}
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

/*
 * Keep full-resolution card and BakuCore art mounted while deck quantity
 * controls update. Admin overrides mutate shared catalogue objects, so
 * catalogueRevision is included in the memo's shallow-comparison props.
 */
const MemoizedBuilderGalleryArtwork = memo(function BuilderGalleryArtwork({
  kind,
  card,
  core,
  name,
}: {
  kind: BuilderGalleryItem["kind"];
  card?: GameCard;
  core?: Core;
  name: string;
  catalogueRevision: number;
}) {
  if (kind === "core" && core) return <BakuCoreArt core={core} alt={name} loading="lazy" decoding="async" />;
  if (card) return <ResponsiveCardImage card={card} presentation="tile" />;
  return null;
});

function BuilderGalleryCard({
  item,
  catalogueRevision,
  canAdd,
  restriction,
  onInspect,
  onAdjust,
}: {
  item: BuilderGalleryItem;
  catalogueRevision: number;
  canAdd: boolean;
  restriction?: string;
  onInspect: () => void;
  onAdjust: (amount: number) => void;
}) {
  const core = item.kind === "core" ? item.core : null;
  const metadata = item.kind === "core"
    ? `${core?.set === "Armored Alliance" ? "AA" : "BB"} #${core?.number ?? ""} · ${core?.type ?? ""}`
    : item.kind === "character"
      ? `${item.card.faction} · Character`
      : `${item.card.faction} · ${item.card.type} · ${item.card.cost} Energy`;
  return (
    <article className={`${styles.builderGalleryCard} ${item.kind === "core" ? styles.builderGalleryCore : ""}`}>
      <button className={styles.builderCardArtButton} type="button" onClick={onInspect} aria-label={`Inspect ${item.name}`}>
        <MemoizedBuilderGalleryArtwork
          kind={item.kind}
          card={item.kind === "core" ? undefined : item.card}
          core={item.kind === "core" ? item.core : undefined}
          name={item.name}
          catalogueRevision={catalogueRevision}
        />
      </button>
      <div className={styles.builderGalleryIdentity}>
        <strong>{item.name}</strong>
        <span>{metadata}</span>
        {restriction && <StatusChip className={styles.builderRestriction} tone={restriction.startsWith("Banned") ? "danger" : "info"} title={restriction}>{restriction}</StatusChip>}
      </div>
      <div data-ui="quantity-control" className={styles.builderQuantity}>
        <button type="button" disabled={item.count === 0} onClick={() => onAdjust(-1)} aria-label={`Remove ${item.name}`}>−</button>
        <strong aria-label={`${item.count} copies in deck`}><MotionValue value={item.count} /></strong>
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
