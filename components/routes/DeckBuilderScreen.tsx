"use client";

import { OriginalImage } from "@/components/media/OriginalImage";
import { BakuCoreArt } from "@/components/bakucore/BakuCoreArt";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent } from "react";
import { activeCardFilterCount, CARD_FILTER_LABELS, CORE_SET_OPTIONS, cardMatchesFilters, clearCardFilterFacets, coreMatchesFilters, createCardFilterOptionCatalogue, createEmptyCardFilters, restrictCardFilters, type CardFilterFacet, type CardFilterOptionCatalogue, type CardFilterState } from "../../lib/card-filters";
import { createBuilderCardControls } from "../../lib/builder-card-selection";
import { createCoreAdditionGuard } from "../../lib/builder-core-selection";
import { coreForSet } from "../../lib/core-preview";
import { paginateBuilderGallery } from "../../lib/builder-gallery-pagination";
import { builderSortOptions, normalizeBuilderSort, sortBuilderItems, type BuilderCategory, type BuilderSort, type BuilderGalleryItem } from "../../lib/builder-sorting";
import { BAKUGAN, CARD_BY_ID, CARDS, CORES, validateDeck, type DeckRecord } from "../../lib/data";
import { cardPrintingKey, corePrintingKey, countConstructionCopies, preferredCardPrinting, preferredCorePrinting } from "../../lib/deck-printings";
import { deckConstructionIdentity } from "../../lib/deck-validation";
import type { Core, GameCard } from "../../lib/game";
import type { CardInspectorTab } from "../../lib/compendium";
import { DECK_LIMIT } from "../../lib/deck-transfer";
import { invalidateResponse } from "../../lib/response-cache";
import { cardSearchText, frequencyMap } from "../../lib/catalogue-index";
import { notifyOfflinePublicDecksUpdated } from "../../lib/public-deck-cache";
import { useAppFields } from "../application/AppProvider";
import { copyText } from "../application/ui";
import { CardInspector } from "../cards/CardInspector";
import { ResponsiveCardImage } from "../cards/ResponsiveCardImage";
import { BakuganRollingStat } from "../cards/BakuganRollingStats";
import { bakuganRollingValues } from "../../lib/bakugan-rolling";
import { ActionButton } from "../design-system/primitives";
import { CardFilterPanel } from "../filters/CardFilterPanel";
import styles from "./DeckBuilder.module.css";
import { DeckSaveDialog } from "./DeckSaveDialog";
import { CardsGallery } from "./CardsGallery";
import { CardFactionTag } from "./CardFactionTag";
import cardTileStyles from "./CardsGallery.module.css";
import { CoresGallery } from "./CoresGallery";
import coreTileStyles from "./CoresGallery.module.css";
import { MotionValue } from "../design-system/MotionValue";
import { LucideIcon } from "../design-system/LucideIcon";
import { builderScope, builderBase, readBuilderDraft, writeBuilderDraft, setActiveBuilder, clearBuilderDraft, shouldConfirmBuilderExit, type BuilderDraft } from "../../lib/builder-session";
import { useCompetitiveRules, clone, blankDraft, DeckState } from "./DeckRouteShared";

type BuilderView = "gallery" | "deck";

type BuilderMenu =
  | { surface: "gallery" | "deck"; panel: "filter" | "sort" }
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

const DECK_FORMAT_OPTIONS = [
  { value: "standard", label: "Standard" },
  { value: "singleton", label: "Singleton" },
  { value: "competitive", label: "Competitive" },
] as const;

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
    storageHealth,
    notify,
    promptAccount,
    catalogueRevision,
  } = useAppFields(["decks", "setDecks", "builderDeck", "setBuilderDeck", "storageHealth", "notify", "promptAccount", "catalogueRevision"]);
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
  const [galleryDensity, setGalleryDensity] = useState<"compact" | "detailed">(() => restoredChoice("galleryDensity", ["compact", "detailed"], "detailed"));
  const [galleryQuery, setGalleryQuery] = useState(() => restoredText("galleryQuery", ""));
  const deferredGalleryQuery = useDeferredValue(galleryQuery);
  const [deckQuery, setDeckQuery] = useState(() => restoredText("deckQuery", ""));
  const [galleryCategory, setGalleryCategory] = useState<BuilderCategory>(() => restoredChoice("galleryCategory", ["cards", "characters", "cores"], "characters"));
  const [galleryPage, setGalleryPage] = useState(1);
  const galleryPanelRef = useRef<HTMLElement | null>(null);
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
  const [inspectorPrinting, setInspectorPrinting] = useState("");
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
      ui: { builderView, galleryDensity, galleryQuery, deckQuery, galleryCategory, gallerySort, deckSort,
        galleryFilters, deckFilters, factionFilterAuto, saveName, saveDescription, saveVisibility, saveLeadCardId },
    };
    setSaveState("dirty");
    const timer = window.setTimeout(() => {
      if (!sessionEnded.current && latestDraft.current) setSaveState(writeBuilderDraft(scope, latestDraft.current) ? "saved" : "error");
    }, 300);
    return () => window.clearTimeout(timer);
  }, [administratorEdit, scope, id, deck, builderView, galleryDensity, galleryQuery, deckQuery, galleryCategory, gallerySort, deckSort, galleryFilters, deckFilters, factionFilterAuto, saveName, saveDescription, saveVisibility, saveLeadCardId, setBuilderDeck, storageHealth.status]);

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
      leadCardId: (() => {
        const selected = CARD_BY_ID.get(saveLeadCardId);
        const matching = selected && deck.cardIds.find(id => {
          const card = CARD_BY_ID.get(id);
          return card && deckConstructionIdentity(card) === deckConstructionIdentity(selected);
        });
        return matching || deck.cardIds[0];
      })(),
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
  const report = useMemo(() => validateDeck({ ...deck, name: saveName }, competitiveRestrictions, competitiveDeckSize), [competitiveDeckSize, competitiveRestrictions, deck, saveName]);
  const mainDeckMaximum = deck.format === "competitive" ? competitiveDeckSize : 40;
  const cardControls = useMemo(() => createBuilderCardControls(
    deck.cardIds, CARD_BY_ID, deck.format, competitiveRestrictions, mainDeckMaximum, competitiveRulesReady,
  ), [deck.cardIds, deck.format, competitiveRestrictions, mainDeckMaximum, competitiveRulesReady]);
  const cardCounts = useMemo(() => countConstructionCopies(deck.cardIds), [deck.cardIds]);
  const characterCounts = useMemo(() => countConstructionCopies(deck.bakuganIds), [deck.bakuganIds]);
  const coreCounts = useMemo(() => frequencyMap(deck.coreIds), [deck.coreIds]);
  const grouped = useMemo(() => {
    const groups = new Map<string, { card: GameCard; count: number }>();
    for (const id of deck.cardIds) {
      const card = CARD_BY_ID.get(id);
      if (!card) continue;
      const key = cardPrintingKey(card);
      const group = groups.get(key);
      if (group) group.count += 1;
      else groups.set(key, { card, count: 1 });
    }
    return [...groups.values()].map(entry => ({
      ...entry, card: preferredCardPrinting(entry.card, deck.printingPreferences),
    }));
  }, [deck.cardIds, deck.printingPreferences]);

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
  // Page back to the beginning whenever the results or their ordering change.
  useEffect(() => {
    setGalleryPage(1);
  }, [galleryCategory, galleryQuery, galleryFilters, effectiveGallerySort, factionFilterAuto]);

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
        count: cardCounts.get(cardPrintingKey(card)) ?? 0,
      })) : galleryCategory === "characters" ? BAKUGAN.map((item) => ({
        kind: "character" as const,
        id: item.id,
        name: item.name,
        card: item.character,
        count: characterCounts.get(cardPrintingKey(item.character)) ?? 0,
      })) : CORES.map((core) => ({
        kind: "core" as const,
        id: core.id,
        name: core.name,
        core,
        count: coreCounts.get(core.id) ?? 0,
      }));
    const filtered = items.filter((item) => {
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
    }).sort((left, right) => sortBuilderItems(left, right, effectiveGallerySort, galleryFilters.set.length === 1 ? galleryFilters.set[0] : "All"));
    const seen = new Set<string>();
    return filtered.filter(item => {
      if (item.kind === "core") return true;
      const key = cardPrintingKey(item.card);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [
    deck.bakuganIds,
    cardCounts,
    characterCounts,
    coreCounts,
    searchIndex,
    factionFilterAuto,
    galleryCategory,
    galleryFilters,
    deferredGalleryQuery,
    effectiveGallerySort,
  ]);

  const galleryPagination = useMemo(() => paginateBuilderGallery(galleryItems, galleryPage), [galleryItems, galleryPage]);
  const changeGalleryPage = (nextPage: number) => {
    setGalleryPage(nextPage);
    const panel = galleryPanelRef.current;
    if (!panel) return;
    if (window.matchMedia("(max-width: 800px)").matches) {
      panel.querySelector<HTMLElement>('[role="search"]')?.scrollIntoView({ block: "start", behavior: "auto" });
    } else {
      panel.scrollTo({ top: 0, behavior: "auto" });
    }
  };

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

  const selectPreferredPrinting = (key: string, printingId: string) => {
    commit({ ...deck, printingPreferences: { ...deck.printingPreferences, [key]: printingId } });
  };
  const adjustCard = (key: string, amount: number) => {
    const next = [...deck.cardIds];
    const selected = CARD_BY_ID.get(key);
    if (!selected) return;
    if (amount > 0 && cardControls.canAdd(key)) next.push(key);
    if (amount < 0) {
      const index = next.lastIndexOf(key);
      const matching = index >= 0 ? index : next.findLastIndex(id => {
        const candidate = CARD_BY_ID.get(id);
        return candidate && deckConstructionIdentity(candidate) === deckConstructionIdentity(selected);
      });
      if (matching >= 0) next.splice(matching, 1);
    }
    commit({ ...deck, cardIds: next });
  };
  const toggleCharacter = (key: string) => {
    const selected = CARD_BY_ID.get(key);
    if (!selected) return;
    const identity = deckConstructionIdentity(selected);
    const existing = deck.bakuganIds.find(id => {
      const card = CARD_BY_ID.get(id);
      return card && deckConstructionIdentity(card) === identity;
    });
    const adding = !existing;
    const nextIds = existing
      ? deck.bakuganIds.filter(id => id !== existing)
      : deck.bakuganIds.length < 3 && BAKUGAN.some(item => item.id === key)
        ? [...deck.bakuganIds, key] : deck.bakuganIds;
    const nextFactions = [...new Set(nextIds.map(id => BAKUGAN.find(item => item.id === id)?.faction).filter(Boolean))] as string[];
    if (adding || factionFilterAuto) setGalleryFilters(current => ({ ...current, faction: nextFactions }));
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
    setInspectorPrinting(preferredCardPrinting(card, deck.printingPreferences).catalogId);
    setInspection({ kind: "card", card });
  };
  const galleryCorePrinting = (core: Core): Core => {
    const preferred = deck.printingPreferences?.[corePrintingKey(core)];
    return preferred ? preferredCorePrinting(core, deck.printingPreferences) : coreForSet(core, galleryFilters.set);
  };
  const addCoreFromGallery = (core: Core) => {
    if (!canAddCore(core.id)) return;
    const displayed = galleryCorePrinting(core);
    const physical = core.printings?.find(print => print.art === displayed.art);
    commit({
      ...deck, coreIds: [...deck.coreIds, core.id],
      printingPreferences: physical
        ? { ...deck.printingPreferences, [corePrintingKey(core)]: physical.id }
        : deck.printingPreferences,
    });
  };
  const inspectCore = (coreId: string) => {
    const core = CORES.find(candidate => candidate.id === coreId);
    setInspectorTab("overview");
    const displayed = core && galleryCorePrinting(core);
    const physical = core?.printings?.find(print => print.art === displayed?.art);
    setInspectorPrinting(core
      ? deck.printingPreferences?.[corePrintingKey(core)] ?? physical?.id ?? core.catalogId ?? core.id
      : "");
    setInspection({ kind: "core", coreId });
  };
  const onGalleryCardAdjust = (card: GameCard, amount: number) => {
    if (galleryCategory === "characters") {
      if ((amount > 0 && !characterCounts.get(cardPrintingKey(card))) ||
        (amount < 0 && characterCounts.get(cardPrintingKey(card)))) toggleCharacter(card.catalogId);
    } else adjustCard(card.catalogId, amount);
  };
  const canAddGalleryCard = (card: GameCard) => galleryCategory === "characters"
    ? !(characterCounts.get(cardPrintingKey(card))) && deck.bakuganIds.length < 3
    : cardControls.canAdd(card.catalogId);
  const chooseCoreSlot = (type: string) => {
    setGalleryQuery("");
    changeGalleryCategory("cores");
    setGalleryFilters(current => ({ ...current, coreType: [type] }));
    setBuilderView("gallery");
  };
  const issueForCard = (card: GameCard) => report.issues.find(issue => {
    const affected = issue.cardId && CARD_BY_ID.get(issue.cardId);
    return affected && cardPrintingKey(affected) === cardPrintingKey(card);
  })?.message;
  const activeGalleryFilterCount = activeCardFilterCount(galleryFilters, galleryFilterFacets);
  const activeDeckFilterCount = activeCardFilterCount(deckFilters, BUILDER_MAIN_DECK_FILTER_FACETS);

  const openSaveDialog = () => {
    if (administratorEdit) setSaveVisibility(adminPublicId || adminOfflineId ? "Public" : "Private");
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
      leadCardId: (() => {
        const selected = CARD_BY_ID.get(saveLeadCardId);
        const matching = selected && deck.cardIds.find(id => {
          const card = CARD_BY_ID.get(id);
          return card && deckConstructionIdentity(card) === deckConstructionIdentity(selected);
        });
        return matching || deck.cardIds[0];
      })(),
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
    <section className={styles.builder} data-ui="deck-builder">
      <header className={styles.header}>
        <Link href={returnTo ?? "/decks"} onClick={exitBuilder} className={styles.back} aria-label="Back to decks"><LucideIcon name="arrow-left" /></Link>
        <input className={styles.deckName} aria-label="Deck name" value={saveName} maxLength={60}
          onChange={event => setSaveName(event.target.value)} />
        <select className={styles.format} aria-label="Deck format" value={deck.format ?? "standard"}
          onChange={event => commit({ ...deck, format: event.target.value as DeckRecord["format"] })}>
          {DECK_FORMAT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        {saveState === "error" && <span className={styles.saveError} role="status" title={storageHealth.message}>Draft unavailable</span>}
        <button type="button" className={styles.saveButton} onClick={openSaveDialog}
          title={report.isLegal ? "Deck is legal" : report.issues.map(issue => issue.message).join("\n")}>
          Save
        </button>
      </header>

      <nav className={styles.mobileTabs} aria-label="Builder views">
        <button type="button" aria-current={builderView === "gallery" ? "page" : undefined}
          onClick={() => setBuilderView("gallery")}>Browse</button>
        <button type="button" aria-current={builderView === "deck" ? "page" : undefined}
          onClick={() => setBuilderView("deck")}>Deck</button>
      </nav>

      <div className={styles.workspace}>
        <section ref={galleryPanelRef} className={`${styles.browse} ${builderView !== "gallery" ? styles.mobileHidden : ""}`} aria-label="Browse cards">
          <nav className={styles.categories} aria-label="Card types">
            {([["characters", "Characters"], ["cores", "BakuCores"], ["cards", "Cards"]] as const).map(([category, label]) =>
              <button type="button" key={category} aria-current={galleryCategory === category ? "page" : undefined}
                onClick={() => changeGalleryCategory(category)}>{label}</button>)}
          </nav>
          <div className={styles.browseTools}>
            <BuilderToolbar label="Browse" query={galleryQuery} setQuery={setGalleryQuery}
              filterCount={activeGalleryFilterCount} onFilter={() => setActiveMenu({ surface: "gallery", panel: "filter" })}
              onSort={() => setActiveMenu({ surface: "gallery", panel: "sort" })} />
            <button type="button" className={styles.density} aria-label={galleryDensity === "detailed" ? "Compact cards" : "Detailed cards"}
              title={galleryDensity === "detailed" ? "Compact cards" : "Detailed cards"}
              onClick={() => setGalleryDensity(value => value === "detailed" ? "compact" : "detailed")}>
              <LucideIcon name={galleryDensity === "detailed" ? "layout-list" : "layout-grid"} />
            </button>
          </div>
          <BuilderActiveFilterChips ariaLabel="Active filters" filters={galleryFilters} facets={galleryFilterFacets}
            options={galleryFilterOptions} factionLabel={factionFilterAuto ? "Team faction" : undefined}
            onChange={(next, facet) => { if (facet === "faction") setFactionFilterAuto(false); setGalleryFilters(next); }} />
          {galleryPagination.items.length ? (
            galleryCategory === "cores" ?
              <CoresGallery cores={galleryPagination.items.flatMap(item => item.kind === "core" ? [item.core] : [])}
                selectedSets={galleryFilters.set} density={galleryDensity}
                resolveCore={galleryCorePrinting}
                onSelect={core => inspectCore(core.id)}
                renderControls={core => <BuilderQuantity name={core.name} count={coreCounts.get(core.id) ?? 0}
                  canAdd={canAddCore(core.id)} canRemove={(coreCounts.get(core.id) ?? 0) > 0}
                  onAdd={() => addCoreFromGallery(core)} onRemove={() => adjustCore(core.id, -1)} />} />
              :
              <CardsGallery cards={galleryPagination.items.flatMap(item => item.kind === "core" ? [] : [item.card])}
                density={galleryDensity} resolveCard={card => preferredCardPrinting(card, deck.printingPreferences)}
                onSelect={card => inspectCard(card)}
                renderControls={card => <BuilderQuantity name={card.displayName}
                  count={galleryCategory === "characters" ? characterCounts.get(cardPrintingKey(card)) ?? 0 : cardCounts.get(cardPrintingKey(card)) ?? 0}
                  canAdd={canAddGalleryCard(card)}
                  canRemove={galleryCategory === "characters" ? Boolean(characterCounts.get(cardPrintingKey(card))) : Boolean(cardCounts.get(cardPrintingKey(card)))}
                  restriction={galleryCategory === "cards" ? cardControls.restrictionLabel(card.catalogId) : undefined}
                  issue={galleryCategory === "cards" ? issueForCard(card) : undefined}
                  onAdd={() => onGalleryCardAdjust(card, 1)} onRemove={() => onGalleryCardAdjust(card, -1)} />} />
          ) : <div className={styles.empty}>No matches</div>}
          {galleryItems.length > 0 && <nav className={styles.pagination} aria-label="Browse pages">
            <span>{galleryPagination.start}–{galleryPagination.end} of {galleryItems.length}</span>
            <div>
              <button type="button" disabled={galleryPagination.page === 1} onClick={() => changeGalleryPage(galleryPagination.page - 1)}
                aria-label="Previous page"><LucideIcon name="chevron-left" /></button>
              <span>{galleryPagination.page} / {galleryPagination.pageCount}</span>
              <button type="button" disabled={galleryPagination.page === galleryPagination.pageCount}
                onClick={() => changeGalleryPage(galleryPagination.page + 1)} aria-label="Next page"><LucideIcon name="chevron-right" /></button>
            </div>
          </nav>}
        </section>

        <aside className={`${styles.deck} ${builderView !== "deck" ? styles.mobileHidden : ""}`} aria-label="Current deck">
          <div className={styles.sectionHeading}>
            <h2>Team</h2>
            <span className={styles.teamCounts} aria-label={`${deck.bakuganIds.length} of 3 Characters, ${deck.coreIds.length} of 6 BakuCores`}>
              <LucideIcon name="rectangle-vertical" size={16} />
              {deck.bakuganIds.length}/3
              <span className={styles.teamCountDivider} aria-hidden="true" />
              <LucideIcon name="hexagon" size={16} />
              {deck.coreIds.length}/6
            </span>
          </div>
          <div className={styles.teamGrid}>
            {Array.from({ length: 3 }, (_, index) => {
              const character = BAKUGAN.find(candidate => candidate.id === deck.bakuganIds[index]);
              const display = character && preferredCardPrinting(character.character, deck.printingPreferences);
              const rolling = character && bakuganRollingValues(character.character);
              const factions = display ? [...new Set(display.factions.length ? display.factions : [display.faction])] : [];
              return <div className={styles.teamGroup} key={character?.id ?? index}>
                {character && display ?
                  <div className={styles.teamCharacter}>
                    <button type="button" className={cardTileStyles.tile} onClick={() => inspectCard(character.character)}
                      aria-label={`Inspect ${character.name}`}>
                      <span className={cardTileStyles.artwork}>
                        <ResponsiveCardImage card={display} presentation="tile" alt={character.name} />
                      </span>
                    </button>
                    <button type="button" className={styles.removeCharacter} onClick={() => toggleCharacter(character.id)}
                      aria-label={`Remove ${character.name}`} title={`Remove ${character.name}`}><LucideIcon name="circle-minus" size={17} /></button>
                    <div className={styles.teamCharacterTags} data-ui="team-character-tags">
                      <span className={cardTileStyles.factions} aria-label={factions.join(" / ")}>
                        {factions.map(faction => <CardFactionTag key={faction} faction={faction} />)}
                      </span>
                      {rolling && <>
                        <span className={`${cardTileStyles.tag} ${cardTileStyles.rollingTag}`}>
                          <BakuganRollingStat kind="rollAccuracy" value={rolling.rollAccuracy} plain />
                        </span>
                        <span className={`${cardTileStyles.tag} ${cardTileStyles.rollingTag}`}>
                          <BakuganRollingStat kind="doubleCoreChance" value={rolling.doubleCoreChance} plain />
                        </span>
                      </>}
                    </div>
                  </div>
                  : <button type="button" className={styles.emptyCharacter}
                    aria-label="Add Character" onClick={() => { setGalleryQuery(""); changeGalleryCategory("characters"); setBuilderView("gallery"); }}><LucideIcon name="plus" size={28} /></button>}
                <div className={styles.pairedCores}>
                  {[0, 1].map(offset => {
                    const slot = index * 2 + offset;
                    const type = requiredCoreTypes[slot];
                    const id = selectedCoreSlots[slot];
                    const core = id ? CORES.find(candidate => candidate.id === id) : undefined;
                    const displayCore = core && preferredCorePrinting(core, deck.printingPreferences);
                    return core && displayCore ?
                      <div className={styles.coreSlot} key={slot} data-invalid={type && core.type !== type ? "true" : undefined}>
                        <button type="button" className={coreTileStyles.tile}
                          title={type && core.type !== type ? `Requires ${type}` : core.name}
                          aria-label={`Inspect ${core.name}`} onClick={() => inspectCore(core.id)}>
                          <span className={coreTileStyles.artwork}>
                            <BakuCoreArt core={displayCore} alt={core.name} />
                          </span>
                        </button>
                        <button type="button" className={styles.removeCore} onClick={() => adjustCore(core.id, -1)}
                          aria-label={`Remove ${core.name}`} title={`Remove ${core.name}`}><LucideIcon name="circle-minus" size={16} /></button>
                      </div>
                    : <button type="button" className={styles.emptyCore} key={slot} disabled={!type}
                        title={type ?? "Select a Character"} aria-label={type ? `Choose ${type} BakuCore` : "Select a Character first"}
                        onClick={() => { if (type) chooseCoreSlot(type); }}>
                        {type ? <BakuCoreBack type={type} /> : <LucideIcon name="plus" size={18} />}
                      </button>;
                  })}
                </div>
              </div>;
            })}
          </div>

          <div className={styles.sectionHeading}>
            <h2>Main Deck</h2><span>{deck.cardIds.length}/{mainDeckMaximum}</span>
          </div>
          {deck.cardIds.length > 0 && <div className={styles.deckTools}>
            <BuilderToolbar label="Main Deck" query={deckQuery} setQuery={setDeckQuery}
              filterCount={activeDeckFilterCount} onFilter={() => setActiveMenu({ surface: "deck", panel: "filter" })}
              onSort={() => setActiveMenu({ surface: "deck", panel: "sort" })} />
            <button type="button" className={styles.density} aria-label={galleryDensity === "detailed" ? "Compact cards" : "Detailed cards"}
              onClick={() => setGalleryDensity(value => value === "detailed" ? "compact" : "detailed")}>
              <LucideIcon name={galleryDensity === "detailed" ? "layout-list" : "layout-grid"} />
            </button>
          </div>}
          <BuilderActiveFilterChips ariaLabel="Main Deck filters" filters={deckFilters}
            facets={BUILDER_MAIN_DECK_FILTER_FACETS} options={cardFilterOptions} onChange={setDeckFilters} />
          {mainDeckCards.length ?
            <CardsGallery cards={mainDeckCards.map(entry => entry.card)} density={galleryDensity}
              resolveCard={card => preferredCardPrinting(card, deck.printingPreferences)}
              onSelect={card => inspectCard(card)}
              renderControls={card => <BuilderQuantity name={card.displayName}
                count={cardCounts.get(cardPrintingKey(card)) ?? 0}
                canAdd={cardControls.canAdd(card.catalogId)}
                canRemove={Boolean(cardCounts.get(cardPrintingKey(card)))}
                restriction={cardControls.restrictionLabel(card.catalogId)} issue={issueForCard(card)}
                onAdd={() => adjustCard(card.catalogId, 1)} onRemove={() => adjustCard(card.catalogId, -1)} />} />
            : <div className={styles.empty}>
              {deck.cardIds.length ? "No matches" : <button type="button" onClick={() => { setGalleryQuery(""); changeGalleryCategory("cards"); setBuilderView("gallery"); }}><LucideIcon name="plus" size={17} /> Add cards</button>}
            </div>}
        </aside>
      </div>

      {activeMenu?.panel === "sort" && <BuilderMenuDialog title="Sort" eyebrow=""
        onClose={() => setActiveMenu(null)}>
        <div className={styles.builderOptionList}>
          {builderSortOptions(activeMenu.surface === "gallery" ? galleryCategory : "cards").map(([value, label]) => (
            <button type="button" key={value} onClick={() => {
              if (activeMenu.surface === "gallery") setGallerySort(value); else setDeckSort(value);
              setActiveMenu(null);
            }}>{label}</button>
          ))}
        </div>
      </BuilderMenuDialog>}

      {activeMenu?.panel === "filter" && <BuilderMenuDialog title="Filters" eyebrow=""
        onClose={() => setActiveMenu(null)} footer={<>
          <ActionButton tone="quiet" onClick={() => {
            if (activeMenu.surface === "gallery") {
              setGalleryFilters(current => clearCardFilterFacets(current, galleryFilterFacets));
              setFactionFilterAuto(false);
            } else setDeckFilters(createEmptyCardFilters());
          }}>Reset</ActionButton>
          <ActionButton onClick={() => setActiveMenu(null)}>Done</ActionButton>
        </>}>
        <CardFilterPanel filters={activeMenu.surface === "gallery" ? galleryFilters : deckFilters}
          facets={activeMenu.surface === "gallery" ? galleryFilterFacets : BUILDER_MAIN_DECK_FILTER_FACETS}
          options={activeMenu.surface === "gallery" ? galleryFilterOptions : cardFilterOptions}
          onChange={(next, facet) => {
            if (activeMenu.surface === "gallery") {
              if (facet === "faction") setFactionFilterAuto(false);
              setGalleryFilters(next);
            } else setDeckFilters(next);
          }} />
      </BuilderMenuDialog>}

      {activeMenu?.panel === "leave" && <BuilderMenuDialog title="Unsaved changes" eyebrow=""
        onClose={() => setActiveMenu(null)} footer={<>
          <ActionButton tone="quiet" onClick={() => {
            sessionEnded.current = true; clearBuilderDraft(scope, id);
            setBuilderDeck(null); setActiveMenu(null); router.push("/decks");
          }}>Discard</ActionButton>
          <ActionButton onClick={() => { setExitAfterSave(true); setSaveVisibility("Draft"); openSaveDialog(); }}>Save draft</ActionButton>
        </>}>
        <p>Save before leaving?</p>
      </BuilderMenuDialog>}

      {activeMenu?.panel === "save" && <DeckSaveDialog
        deck={deck}
        report={report}
        requiredCardCount={mainDeckMaximum}
        cards={grouped}
        name={saveName}
        onNameChange={setSaveName}
        description={saveDescription}
        onDescriptionChange={setSaveDescription}
        visibility={saveVisibility}
        onVisibilityChange={setSaveVisibility}
        featuredCardId={saveLeadCardId}
        onFeaturedCardChange={setSaveLeadCardId}
        fixedVisibility={administratorEdit}
        saveDisabled={!saveName.trim() || ((saveVisibility === "Public" || Boolean(adminAiId) || Boolean(adminOfflineId)) && !report.isLegal)}
        onSave={() => void save()}
        onClose={() => { setActiveMenu(null); setExitAfterSave(false); }}
      />}

      {inspection?.kind === "card" && <div className={styles.inspectorOverlay}>
        <CardInspector card={inspection.card} allCards={CARDS} tab={inspectorTab} printingId={inspectorPrinting}
          mode="embedded"
          onPrintingChange={next => { setInspectorPrinting(next); selectPreferredPrinting(cardPrintingKey(inspection.card), next); }}
          onTabChange={setInspectorTab} onSelectCard={inspectCard} onClose={() => setInspection(null)}
          onShare={() => void copyText(`${globalThis.location?.origin ?? ""}/compendium?card=${encodeURIComponent(inspection.card.catalogId)}&printing=${encodeURIComponent(inspectorPrinting)}`).then(() => notify("Card link copied."))} />
      </div>}
      {inspection?.kind === "core" && <div className={styles.inspectorOverlay}>
        {(() => {
          const core = CORES.find(candidate => candidate.id === inspection.coreId);
          return core ? <CardInspector core={core} allCores={CORES} tab={inspectorTab} printingId={inspectorPrinting}
            mode="embedded"
            onPrintingChange={next => { setInspectorPrinting(next); selectPreferredPrinting(corePrintingKey(core), next); }}
            onTabChange={setInspectorTab} onClose={() => setInspection(null)} /> : null;
        })()}
      </div>}
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
        <LucideIcon name="search" size={18} className={styles.searchIcon} />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label.toLowerCase()}…`} />
      </label>
      <button type="button" onClick={onSort} aria-label={`Sort ${label}`}><LucideIcon name="arrow-down-up" size={19} /> <span>Sort</span></button>
      <button type="button" onClick={onFilter} aria-label={`Filter ${label}`}><LucideIcon name="sliders-horizontal" size={19} /> <span>Filter{filterCount ? ` (${filterCount})` : ""}</span></button>
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
            {facetLabel}: {option?.label ?? value} <LucideIcon name="x" size={13} />
          </button>
        );
      }))}
    </div>
  );
}

function BakuCoreBack({ type }: { type: string }) {
  return <OriginalImage src={CORE_BACK_IMAGES[type] ?? CORE_BACK_IMAGES.Shield} alt="" />;
}

function BuilderQuantity({ name, count, canAdd, canRemove, onAdd, onRemove, restriction, issue }: {
  name: string; count: number; canAdd: boolean; canRemove: boolean;
  onAdd: () => void; onRemove: () => void; restriction?: string; issue?: string;
}) {
  return <div className={styles.quantity} role="group" aria-label={`Copies of ${name}${issue ? `; ${issue}` : ""}`}
    data-invalid={issue ? "true" : undefined} title={issue}>
    <button type="button" onClick={onRemove} disabled={!canRemove} aria-label={`Remove ${name}`}><LucideIcon name="minus" /></button>
    <strong aria-label={`${count} copies`}><MotionValue value={count} /></strong>
    <button type="button" onClick={onAdd} disabled={!canAdd} aria-label={`Add ${name}`}
      title={!canAdd ? restriction ?? "Limit reached" : undefined}><LucideIcon name="plus" /></button>
  </div>;
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
        <header><div><span>{eyebrow}</span><h2>{title}</h2></div><button type="button" onClick={onClose} aria-label={`Close ${title}`}><LucideIcon name="x" /></button></header>
        <div className={styles.builderMenuBody}>{children}</div>
        {footer && <footer>{footer}</footer>}
      </section>
    </div>
  );
}
