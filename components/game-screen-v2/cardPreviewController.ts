import type { CardType, Core, GameCard, MatchState } from "../../lib/game";
import {
  cardPreviewOrientation,
  cardPreviewSideForZone,
  cardPreviewZoneAllowed,
  type CardPreviewOrientation,
  type CardPreviewSide,
  type CardPreviewZoneKind,
} from "./cardPreviewState";

export type CardPreviewDetails = {
  name: string;
  type: string;
  faction: string;
  cost: string;
  effect: string;
  mechanics: string;
  stats: string;
  cores: string;
};

export type CardPreviewDescriptor = {
  targetId: string;
  src: string;
  label: string;
  side: CardPreviewSide;
  orientation: CardPreviewOrientation;
  previewKind: "card" | "core";
  cardType?: CardType;
  details: CardPreviewDetails;
};

export type PreviewElement = HTMLElement | SVGElement;

type ZoneMetadata = {
  zone: PreviewElement;
  zoneKind: CardPreviewZoneKind;
  zoneOwner: string;
};

const MISSING_ART_PATTERN = /card-missing\.svg(?:$|[?#])/i;
const FACE_DOWN_CORE_PATTERN = /^Face-down\b/i;

function isPreviewElement(element: Element): element is PreviewElement {
  return element instanceof HTMLElement || element instanceof SVGElement;
}

function elementData(element: Element, key: string) {
  return isPreviewElement(element) ? element.dataset[key] ?? "" : "";
}

function imageSource(image: HTMLImageElement | null): string {
  return image?.currentSrc || image?.getAttribute("src") || "";
}

function normalizedPath(source: string) {
  try {
    return new URL(source, "https://bakugan-preview.invalid").pathname;
  } catch {
    return source.split(/[?#]/, 1)[0] ?? "";
  }
}

function cardsInMatch(match: MatchState | null): GameCard[] {
  if (!match) return [];
  const cards = match.players.flatMap((player) => [
    ...player.hand,
    ...player.deckCards,
    ...player.discard,
    ...player.energyZone,
    ...player.heroes,
    ...player.bakugan.flatMap((bakugan) => [bakugan.character, ...bakugan.evoStack]),
  ]);
  cards.push(...match.batch.map((pending) => pending.card));
  if (match.revealedFlip) cards.push(match.revealedFlip);
  return cards;
}

function detailsForCard(card: GameCard): CardPreviewDetails {
  const stats = [
    card.bPower != null ? `${card.bPower} B-Power` : "",
    card.damage != null ? `${card.damage} Damage` : "",
  ].filter(Boolean).join(" • ");
  return {
    name: card.displayName || card.name || "Unknown Card",
    type: card.type || "Card",
    faction: card.factions?.length ? card.factions.join(" / ") : card.faction,
    cost: card.type === "Character" ? "" : `Cost ${card.cost}`,
    effect: card.effect?.trim() || "No effect text is available for this card.",
    mechanics: card.mechanics?.filter(Boolean).join(" • ") ?? "",
    stats,
    cores: card.coreTypes?.length ? card.coreTypes.join(" • ") : "",
  };
}

function signed(value: number, suffix: string) {
  if (!value) return "";
  return `${value > 0 ? "+" : ""}${value} ${suffix}`;
}

function detailsForCore(core: Core): CardPreviewDetails {
  const baseStats = [
    signed(core.bonus, "B-Power"),
    signed(core.damageBonus, "Damage"),
    core.frostStrike ? `+${core.frostStrike} FrostStrike` : "",
    core.shadowStrike ? "ShadowStrike" : "",
  ].filter(Boolean);
  const conditionalStats = [
    signed(core.conditionalBonus ?? 0, "B-Power"),
    signed(core.conditionalDamage ?? 0, "Damage"),
  ].filter(Boolean);
  const condition = core.conditionalFactions?.length
    ? `When attached to ${core.conditionalFactions.join(" or ")}: ${conditionalStats.join(" • ") || "conditional bonus"}.`
    : "";
  return {
    name: core.name,
    type: `${core.type} BakuCore`,
    faction: core.conditionalFactions?.join(" / ") ?? "",
    cost: "",
    effect: condition || baseStats.join(" • ") || "This BakuCore has a conditional printed modifier.",
    mechanics: core.shadowStrike ? "ShadowStrike" : core.frostStrike ? "FrostStrike" : "",
    stats: baseStats.join(" • "),
    cores: core.type,
  };
}

function zoneMetadata(element: Element): ZoneMetadata | null {
  const zone = element.closest("[data-zone-kind]");
  const zoneKind = zone ? elementData(zone, "zoneKind") : "";
  if (!zone || !isPreviewElement(zone) || !cardPreviewZoneAllowed(zoneKind)) return null;
  if (zoneKind === "hand" && elementData(zone, "zoneOwner") === "opponent" && elementData(zone, "hidden") === "true") {
    return null;
  }
  return { zone, zoneKind, zoneOwner: elementData(zone, "zoneOwner") };
}

export function previewElementFromTarget(target: EventTarget | null): PreviewElement | null {
  if (!(target instanceof Element)) return null;
  const core = target.closest("[data-core-cell]");
  if (core && isPreviewElement(core)) return core;

  const metadata = zoneMetadata(target);
  if (!metadata) return null;
  switch (metadata.zoneKind) {
    case "character-card":
    case "discard-pile":
      return elementData(metadata.zone, "cardId") || elementData(metadata.zone, "topCardId")
        ? metadata.zone
        : null;
    case "hand": {
      const card = target.closest("li[data-card-id]");
      return card && isPreviewElement(card) ? card : null;
    }
    case "discard-browser":
    case "batch": {
      const card = target.closest("figure[data-card-id]");
      return card && isPreviewElement(card) ? card : null;
    }
    case "hero": {
      const image = target instanceof HTMLImageElement ? target : target.closest("img");
      return image instanceof HTMLImageElement && metadata.zone.contains(image) ? image : null;
    }
    default:
      return null;
  }
}

function cardImage(element: PreviewElement, metadata: ZoneMetadata) {
  return metadata.zoneKind === "hero" && element instanceof HTMLImageElement
    ? element
    : element.querySelector<HTMLImageElement>("img");
}

function resolveCard(match: MatchState | null, element: PreviewElement, metadata: ZoneMetadata) {
  const cards = cardsInMatch(match);
  const cardId = metadata.zoneKind === "discard-pile"
    ? elementData(metadata.zone, "topCardId") || elementData(metadata.zone, "cardId")
    : elementData(element, "cardId") || elementData(metadata.zone, "cardId");
  if (cardId) {
    const byId = cards.find((card) => card.id === cardId);
    if (byId) return byId;
  }

  const catalogId = elementData(element, "cardCatalogId") || elementData(metadata.zone, "cardCatalogId");
  if (catalogId) {
    const byCatalog = cards.find((card) => card.catalogId === catalogId);
    if (byCatalog) return byCatalog;
  }

  if (metadata.zoneKind !== "hero" && metadata.zoneKind !== "batch") return null;
  const image = cardImage(element, metadata);
  const sourcePath = normalizedPath(imageSource(image));
  const label = image?.alt.trim().toLowerCase() ?? "";
  return cards.find((card) => (
    sourcePath
    && normalizedPath(card.art) === sourcePath
    && (!label || card.displayName.toLowerCase() === label || card.name.toLowerCase() === label)
  )) ?? null;
}

function describeCorePreview(
  match: MatchState | null,
  element: PreviewElement,
  elementToken: string,
): CardPreviewDescriptor | null {
  const cell = elementData(element, "coreCell");
  const placement = match?.placements.find((candidate) => candidate.cell === cell);
  if (!placement) return null;
  const ariaLabel = element.getAttribute("aria-label") ?? "";
  const revealed = Boolean(placement.attachedTo) || Boolean(ariaLabel && !FACE_DOWN_CORE_PATTERN.test(ariaLabel));
  if (!revealed) return null;
  const core = placement.core;
  const identity = [cell, core.id, core.art, core.name, "left", "core"].join("\u0000");
  return {
    targetId: `${elementToken}:${identity}`,
    src: core.art,
    label: core.name,
    side: "left",
    orientation: "core",
    previewKind: "core",
    details: detailsForCore(core),
  };
}

export function describePreviewElement(
  match: MatchState | null,
  element: PreviewElement,
  elementToken: string,
): CardPreviewDescriptor | null {
  if (!element.isConnected) return null;
  if (elementData(element, "coreCell")) {
    return describeCorePreview(match, element, elementToken);
  }

  const metadata = zoneMetadata(element);
  if (!metadata || metadata.zoneKind === "bakucore") return null;
  const card = resolveCard(match, element, metadata);
  if (!card) return null;
  const side = cardPreviewSideForZone(metadata.zoneKind, metadata.zoneOwner);
  const orientation = cardPreviewOrientation(card.type);
  const identity = [card.id, card.art, card.type, card.effect, side, orientation].join("\u0000");
  return {
    targetId: `${elementToken}:${identity}`,
    src: card.art,
    label: card.displayName || card.name || "Card",
    side,
    orientation,
    previewKind: "card",
    cardType: card.type,
    details: detailsForCard(card),
  };
}

/**
 * Discard presentation is based on card data, while the existing discard DOM is
 * intentionally generic. Keep its type metadata synchronized without making
 * card-preview ownership depend on image load events or pointer geometry.
 */
export function synchronizeDiscardCardTypes(
  match: MatchState | null,
  root: ParentNode,
) {
  const cards = cardsInMatch(match);
  const byId = new Map(cards.map((card) => [card.id, card]));
  const elements = root.querySelectorAll<HTMLElement>(
    '[data-zone-kind="discard-pile"], [data-zone-kind="discard-browser"] figure[data-card-id]',
  );
  for (const element of elements) {
    const cardId = element.dataset.topCardId || element.dataset.cardId || "";
    const card = byId.get(cardId);
    if (!card) {
      delete element.dataset.cardType;
      delete element.dataset.cardCatalogId;
      continue;
    }
    element.dataset.cardType = card.type;
    element.dataset.cardCatalogId = card.catalogId;
  }
}

export function decodePreviewArtwork(source: string): Promise<boolean> {
  if (!source || MISSING_ART_PATTERN.test(source)) return Promise.resolve(false);
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (loaded: boolean) => {
      if (settled) return;
      settled = true;
      image.onload = null;
      image.onerror = null;
      resolve(loaded);
    };
    image.decoding = "async";
    image.onload = () => finish(image.naturalWidth > 0);
    image.onerror = () => finish(false);
    image.src = source;
    if (image.complete) queueMicrotask(() => finish(image.naturalWidth > 0));
  });
}

