import type { CardType, GameCard, MatchState } from "../../lib/game";
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
  cardType?: CardType;
  details: CardPreviewDetails;
};

type ZoneMetadata = {
  zone: HTMLElement;
  zoneKind: CardPreviewZoneKind;
  zoneOwner: string;
};

const MISSING_ART_PATTERN = /card-missing\.svg(?:$|[?#])/i;

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

function zoneMetadata(element: Element): ZoneMetadata | null {
  const zone = element.closest<HTMLElement>("[data-zone-kind]");
  const zoneKind = zone?.dataset.zoneKind;
  if (!zone || !cardPreviewZoneAllowed(zoneKind)) return null;
  if (zoneKind === "hand" && zone.dataset.zoneOwner === "opponent" && zone.dataset.hidden === "true") {
    return null;
  }
  return { zone, zoneKind, zoneOwner: zone.dataset.zoneOwner ?? "" };
}

export function previewElementFromTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const metadata = zoneMetadata(target);
  if (!metadata) return null;
  switch (metadata.zoneKind) {
    case "character-card":
    case "discard-pile":
      return metadata.zone.dataset.cardId || metadata.zone.dataset.topCardId ? metadata.zone : null;
    case "hand":
      return target.closest<HTMLElement>("li[data-card-id]");
    case "discard-browser":
      return target.closest<HTMLElement>("figure[data-card-id]");
    case "hero": {
      const image = target instanceof HTMLImageElement ? target : target.closest<HTMLImageElement>("img");
      return image && metadata.zone.contains(image) ? image : null;
    }
    case "batch":
      return target.closest<HTMLElement>("figure[data-card-id]");
    default:
      return null;
  }
}

function cardImage(element: HTMLElement, metadata: ZoneMetadata) {
  return metadata.zoneKind === "hero" && element instanceof HTMLImageElement
    ? element
    : element.querySelector<HTMLImageElement>("img");
}

function resolveCard(match: MatchState | null, element: HTMLElement, metadata: ZoneMetadata) {
  const cards = cardsInMatch(match);
  const cardId = metadata.zoneKind === "discard-pile"
    ? metadata.zone.dataset.topCardId ?? metadata.zone.dataset.cardId ?? ""
    : element.dataset.cardId ?? metadata.zone.dataset.cardId ?? "";
  if (cardId) {
    const byId = cards.find((card) => card.id === cardId);
    if (byId) return byId;
  }
  if (metadata.zoneKind !== "hero") return null;
  const image = cardImage(element, metadata);
  const sourcePath = normalizedPath(imageSource(image));
  const label = image?.alt.trim().toLowerCase() ?? "";
  return cards.find((card) => (
    sourcePath
    && normalizedPath(card.art) === sourcePath
    && (!label || card.displayName.toLowerCase() === label || card.name.toLowerCase() === label)
  )) ?? null;
}

export function describePreviewElement(
  match: MatchState | null,
  element: HTMLElement,
  elementToken: string,
): CardPreviewDescriptor | null {
  if (!element.isConnected) return null;
  const metadata = zoneMetadata(element);
  if (!metadata) return null;
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
    cardType: card.type,
    details: detailsForCard(card),
  };
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
