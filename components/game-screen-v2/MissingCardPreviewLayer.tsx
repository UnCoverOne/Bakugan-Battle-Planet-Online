"use client";

import { useEffect, useMemo, useState } from "react";
import type { GameCard, MatchState } from "../../lib/game";
import { cardArtworkUnavailable } from "./missingCardPreviewState";
import styles from "./MissingCardPreviewLayer.module.css";

const ROUTE_KEY = "bbp-route-v1";
const SETTINGS_KEY = "bbp-settings";
const MATCH_KEY = "bbp-active-match-v1";
const EXCLUDED_ZONE_KINDS = new Set(["deck", "discard-pile", "energy"]);

type PreviewSide = "left" | "right";
type MissingPreview = {
  card: GameCard | null;
  label: string;
  side: PreviewSide;
};

type PreviewSnapshot = {
  active: boolean;
  match: MatchState | null;
};

function parseStoredValue<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

function readSnapshot(): PreviewSnapshot {
  const settings = parseStoredValue<{ useNewGameScreen?: boolean }>(
    localStorage.getItem(SETTINGS_KEY),
    {},
  );
  return {
    active: Boolean(settings.useNewGameScreen)
      && parseStoredValue(localStorage.getItem(ROUTE_KEY), "entry") === "match",
    match: parseStoredValue<MatchState | null>(localStorage.getItem(MATCH_KEY), null),
  };
}

function imageSource(image: HTMLImageElement) {
  return image.currentSrc || image.getAttribute("src") || "";
}

function previewImageFromTarget(target: EventTarget | null): {
  image: HTMLImageElement;
  origin: "hand" | "board";
} | null {
  if (!(target instanceof Element)) return null;
  const zoneKind = target.closest<HTMLElement>("[data-zone-kind]")
    ?.getAttribute("data-zone-kind");
  if (zoneKind && EXCLUDED_ZONE_KINDS.has(zoneKind)) return null;

  const handCard = target.closest("li");
  if (handCard?.closest('[data-zone-kind="hand"]')) {
    const image = handCard.querySelector<HTMLImageElement>("img");
    if (image) return { image, origin: "hand" };
  }

  const direct = target instanceof HTMLImageElement
    ? target
    : target.closest<HTMLImageElement>("img");
  if (direct) return { image: direct, origin: "board" };

  const characterZone = target.closest<HTMLElement>('[data-zone-kind="character-card"]');
  const characterImage = characterZone?.querySelector<HTMLImageElement>("img");
  return characterImage ? { image: characterImage, origin: "board" } : null;
}

function knownCards(match: MatchState | null) {
  if (!match) return [];
  return match.players.flatMap((player) => [
    ...player.hand,
    ...player.heroes,
    ...player.discard,
    ...player.energyZone,
    ...player.deckCards,
    ...player.bakugan.flatMap((bakugan) => [bakugan.character, ...bakugan.evoStack]),
  ]);
}

function cardForImage(
  image: HTMLImageElement,
  byId: ReadonlyMap<string, GameCard>,
  byName: ReadonlyMap<string, GameCard>,
) {
  const cardId = image.closest<HTMLElement>("[data-card-id]")?.dataset.cardId;
  if (cardId && byId.has(cardId)) return byId.get(cardId) ?? null;
  const label = image.alt.trim();
  return byName.get(label.toLowerCase()) ?? null;
}

function displayCost(card: GameCard) {
  return card.cost === "X" ? "X Energy" : `${card.cost} Energy`;
}

export function MissingCardPreviewLayer() {
  const [snapshot, setSnapshot] = useState<PreviewSnapshot>({ active: false, match: null });
  const [preview, setPreview] = useState<MissingPreview | null>(null);

  useEffect(() => {
    const update = () => setSnapshot(readSnapshot());
    update();
    const interval = window.setInterval(update, 250);
    window.addEventListener("storage", update);
    window.addEventListener("bbp-match-state-updated", update);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", update);
      window.removeEventListener("bbp-match-state-updated", update);
    };
  }, []);

  const lookups = useMemo(() => {
    const byId = new Map<string, GameCard>();
    const byName = new Map<string, GameCard>();
    for (const card of knownCards(snapshot.match)) {
      byId.set(card.id, card);
      byName.set(card.name.toLowerCase(), card);
      byName.set(card.displayName.toLowerCase(), card);
    }
    return { byId, byName };
  }, [snapshot.match]);

  useEffect(() => {
    if (!snapshot.active) {
      setPreview(null);
      return;
    }
    const clear = () => setPreview((current) => current ? null : current);
    const update = (event: PointerEvent) => {
      if (event.pointerType === "touch") return clear();
      const target = previewImageFromTarget(event.target);
      if (!target) return clear();
      const source = imageSource(target.image);
      if (!cardArtworkUnavailable(source, target.image.complete, target.image.naturalWidth)) {
        return clear();
      }
      const card = cardForImage(target.image, lookups.byId, lookups.byName);
      const label = card?.displayName || card?.name || target.image.alt.trim() || "Card";
      const rect = target.image.getBoundingClientRect();
      const side: PreviewSide = target.origin === "hand"
        ? "left"
        : rect.left + rect.width / 2 <= window.innerWidth / 2
          ? "right"
          : "left";
      setPreview((current) => (
        current?.card?.id === card?.id && current.label === label && current.side === side
          ? current
          : { card, label, side }
      ));
    };
    const leaveWindow = (event: PointerEvent) => {
      if (event.relatedTarget == null) clear();
    };
    document.addEventListener("pointermove", update, { passive: true });
    document.addEventListener("pointerout", leaveWindow, { passive: true });
    window.addEventListener("blur", clear);
    return () => {
      document.removeEventListener("pointermove", update);
      document.removeEventListener("pointerout", leaveWindow);
      window.removeEventListener("blur", clear);
    };
  }, [lookups, snapshot.active]);

  if (!preview) return null;
  const card = preview.card;
  const factions = card?.factions.length ? card.factions.join(" / ") : card?.faction;
  const stats = card && (card.bPower != null || card.damage != null);

  return (
    <aside
      className={`${styles.preview} ${preview.side === "left" ? styles.previewLeft : styles.previewRight}`}
      aria-label={`${preview.label} details preview; artwork unavailable`}
    >
      <article className={styles.placeholder}>
        <span className={styles.artMissing}>Artwork unavailable</span>
        <h2>{preview.label}</h2>
        {card ? (
          <>
            <div className={styles.metadata}>
              <span>{card.type}</span>
              {factions ? <span>{factions}</span> : null}
              <span>{displayCost(card)}</span>
              {card.rarity ? <span>{card.rarity}</span> : null}
            </div>
            {stats ? (
              <div className={styles.stats}>
                {card.bPower != null ? <span><small>B-Power</small><strong>{card.bPower}</strong></span> : null}
                {card.damage != null ? <span><small>Damage</small><strong>{card.damage}</strong></span> : null}
              </div>
            ) : null}
            {card.effect ? <p className={styles.effect}>{card.effect}</p> : null}
            {card.mechanics.length ? (
              <div className={styles.mechanics}>
                {card.mechanics.map((mechanic) => <span key={mechanic}>{mechanic}</span>)}
              </div>
            ) : null}
          </>
        ) : (
          <p className={styles.effect}>No additional card details are available.</p>
        )}
      </article>
    </aside>
  );
}
