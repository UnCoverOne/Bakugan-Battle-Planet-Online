"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { MatchState, PlayerState } from "../../lib/game";
import { drawStepIsPending } from "../../lib/turnStart";
import {
  playerActionTooltip,
  selectableCharacterBakugan,
  selectionPlayer,
} from "./selectionState";
import styles from "./SelectionInteractionLayer.module.css";

const CHARACTER_ZONE_SELECTOR = '[data-zone-kind="character-card"]';
const PLAYER_CHARACTER_ZONE_SELECTOR = `${CHARACTER_ZONE_SELECTOR}[data-zone-owner="player"]`;
const PLAYER_CHARACTER_AREA_SELECTOR = '[data-zone-owner="player"][data-zone-group="character-cards"]';
const PLAY_AREA_SELECTOR = '[aria-label="Experimental game play area"]';

type SelectionInteractionLayerProps = {
  match: MatchState | null;
  playerId?: string;
  selectedCharacterId: string;
  selectedHandCardId?: string;
  onCharacterSelectionChange: (bakuganId: string) => void;
  onClearSelections: () => void;
};

type TooltipPosition = {
  left: number;
  top: number;
  maxWidth: number;
};

function playerForZone(
  match: MatchState | null,
  localPlayer: PlayerState | null,
  owner: string | undefined,
) {
  if (!match || !localPlayer) return null;
  return owner === "player"
    ? localPlayer
    : match.players.find((player) => player.id !== localPlayer.id) ?? null;
}

export function SelectionInteractionLayer({
  match,
  playerId,
  selectedCharacterId,
  selectedHandCardId = "",
  onCharacterSelectionChange,
  onClearSelections,
}: SelectionInteractionLayerProps) {
  const [now, setNow] = useState(() => Date.now());
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null);
  const prompt = playerActionTooltip({
    match,
    playerId,
    selectedCharacterId,
    selectedHandCardId,
    now,
  });

  useEffect(() => {
    if (!drawStepIsPending(match)) return;
    const update = () => setNow(Date.now());
    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [match?.phase, match?.version]);

  useEffect(() => {
    const player = selectionPlayer(match, playerId);
    const selectableIds = new Set(
      selectableCharacterBakugan(match, playerId).map((bakugan) => bakugan.id),
    );
    const zones = Array.from(document.querySelectorAll<HTMLElement>(CHARACTER_ZONE_SELECTOR));

    for (const zone of zones) {
      const ownerPlayer = playerForZone(match, player, zone.dataset.zoneOwner);
      const slot = Math.max(0, Number(zone.dataset.slot ?? 1) - 1);
      const bakugan = ownerPlayer?.bakugan[slot];
      const localZone = zone.dataset.zoneOwner === "player";
      const selectable = Boolean(localZone && bakugan && selectableIds.has(bakugan.id));
      const selected = Boolean(localZone && bakugan && bakugan.id === selectedCharacterId && selectable);
      const active = Boolean(bakugan && ownerPlayer && match?.selected[ownerPlayer.id] === bakugan.id);
      const open = Boolean(bakugan?.open);

      if (bakugan) zone.dataset.bakuganId = bakugan.id;
      else delete zone.dataset.bakuganId;
      zone.dataset.characterSelectable = selectable ? "true" : "false";
      zone.dataset.characterSelected = selected ? "true" : "false";
      zone.dataset.characterActive = active ? "true" : "false";
      zone.dataset.characterOpen = open ? "true" : "false";
      zone.setAttribute("aria-pressed", selected ? "true" : "false");
      if (active) zone.setAttribute("aria-current", "true");
      else zone.removeAttribute("aria-current");

      if (selectable) {
        zone.tabIndex = 0;
        zone.setAttribute("role", "button");
      } else {
        zone.removeAttribute("tabindex");
        zone.removeAttribute("role");
      }
    }

    const toggleCharacter = (zone: HTMLElement) => {
      if (zone.dataset.characterSelectable !== "true") return;
      const bakuganId = zone.dataset.bakuganId ?? "";
      if (!bakuganId) return;
      onCharacterSelectionChange(
        bakuganId === selectedCharacterId ? "" : bakuganId,
      );
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const characterZone = event.target.closest<HTMLElement>(PLAYER_CHARACTER_ZONE_SELECTOR);
      if (characterZone?.dataset.characterSelectable === "true") {
        toggleCharacter(characterZone);
        return;
      }

      const playArea = event.target.closest<HTMLElement>(PLAY_AREA_SELECTOR);
      if (!playArea) return;
      if (event.target.closest("button, [role=button], input, select, textarea, a")) return;
      onClearSelections();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (!(event.target instanceof Element)) return;
      const characterZone = event.target.closest<HTMLElement>(PLAYER_CHARACTER_ZONE_SELECTOR);
      if (characterZone?.dataset.characterSelectable !== "true") return;
      event.preventDefault();
      toggleCharacter(characterZone);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      for (const zone of zones) {
        delete zone.dataset.bakuganId;
        delete zone.dataset.characterSelectable;
        delete zone.dataset.characterSelected;
        delete zone.dataset.characterActive;
        delete zone.dataset.characterOpen;
        zone.removeAttribute("aria-pressed");
        zone.removeAttribute("aria-current");
        zone.removeAttribute("tabindex");
        zone.removeAttribute("role");
      }
    };
  }, [
    match,
    playerId,
    selectedCharacterId,
    onCharacterSelectionChange,
    onClearSelections,
  ]);

  useLayoutEffect(() => {
    if (!prompt) {
      setTooltipPosition(null);
      return;
    }

    const area = document.querySelector<HTMLElement>(PLAYER_CHARACTER_AREA_SELECTOR);
    if (!area) return;
    let frame = 0;
    let observer: ResizeObserver | null = null;

    const measure = () => {
      const rect = area.getBoundingClientRect();
      setTooltipPosition({
        left: rect.left + rect.width / 2,
        top: Math.max(8, rect.top - 10),
        maxWidth: Math.max(180, rect.width * 1.55),
      });
    };

    frame = window.requestAnimationFrame(measure);
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(area);
    }
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [prompt]);

  const tooltipStyle = tooltipPosition ? {
    left: tooltipPosition.left,
    top: tooltipPosition.top,
    "--action-tooltip-max-width": `${tooltipPosition.maxWidth}px`,
  } as CSSProperties : undefined;

  return (
    <>
      <span className={styles.selectionStyleAnchor} aria-hidden="true" />
      {prompt && tooltipPosition ? (
        <aside
          className={styles.actionTooltip}
          style={tooltipStyle}
          role="status"
          aria-live="polite"
        >
          <span className={styles.actionTooltipMarker}>◆</span>
          <span>{prompt}</span>
        </aside>
      ) : null}
    </>
  );
}
