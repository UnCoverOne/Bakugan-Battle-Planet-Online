"use client";

import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { MatchState, PlayerState } from "../../lib/game";
import { legalEvoTargets } from "../../lib/evo";
import { drawStepIsPending } from "../../lib/turnStart";
import {
  playerActionTooltip,
  selectableCharacterBakugan,
  selectionPlayer,
} from "./selectionState";
import { useBoardChoiceHud } from "./boardChoiceHud";
import styles from "./SelectionInteractionLayer.module.css";

const CHARACTER_ZONE_SELECTOR = '[data-zone-kind="character-card"]';
const PLAYER_CHARACTER_ZONE_SELECTOR = `${CHARACTER_ZONE_SELECTOR}[data-zone-owner="player"]`;
const PLAYER_CHARACTER_AREA_SELECTOR = '[data-zone-owner="player"][data-zone-group="character-cards"]';
const PLAYER_SELECTED_HAND_CARD_SELECTOR = '[data-zone-kind="hand"][data-zone-owner="player"] li[data-selected="true"][data-card-id]';
const PLAY_AREA_SELECTOR = '[data-gameplay-surface="true"]';

const PRIORITY_PHASES = new Set([
  "preRoll",
  "power",
  "victor",
  "postDamage",
  "endPlay",
]);

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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function sameTooltipPosition(previous: TooltipPosition | null, next: TooltipPosition) {
  return Boolean(
    previous
    && Math.abs(previous.left - next.left) < 0.5
    && Math.abs(previous.top - next.top) < 0.5
    && Math.abs(previous.maxWidth - next.maxWidth) < 0.5
  );
}

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

function selectedHandCardFromDocument() {
  return document.querySelector<HTMLElement>(PLAYER_SELECTED_HAND_CARD_SELECTOR)?.dataset.cardId ?? "";
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
  const [domSelectedHandCardId, setDomSelectedHandCardId] = useState("");
  const [selectedEvoTargetId, setSelectedEvoTargetId] = useState("");
  const boardChoice = useBoardChoiceHud();
  const effectiveSelectedHandCardId = selectedHandCardId || domSelectedHandCardId;
  const localPlayer = selectionPlayer(match, playerId);
  const selectedHandCard = localPlayer?.hand.find((card) => card.id === effectiveSelectedHandCardId);
  const evoTargetIds = useMemo(
    () => new Set(
      selectedHandCard?.type === "Evo"
        && match
        && localPlayer
        && PRIORITY_PHASES.has(match.phase)
        && match.priority === localPlayer.id
        ? legalEvoTargets(match, localPlayer.id, selectedHandCard).map((bakugan) => bakugan.id)
        : [],
    ),
    [localPlayer, match, selectedHandCard],
  );
  const evoSelectionActive = evoTargetIds.size > 0;
  const drawPending = drawStepIsPending(match);
  const activeBoardChoice = boardChoice
    && boardChoice.matchId === match?.id
    && boardChoice.playerId === localPlayer?.id
    ? boardChoice
    : null;
  const prompt = activeBoardChoice?.prompt
    ?? playerActionTooltip({
      match,
      playerId,
      selectedCharacterId,
      selectedHandCardId: effectiveSelectedHandCardId,
      selectedEvoTargetId,
      now,
    });

  useEffect(() => {
    const update = () => setDomSelectedHandCardId(selectedHandCardFromDocument());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-selected", "data-card-id"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setSelectedEvoTargetId("");
  }, [effectiveSelectedHandCardId, match?.phase, match?.priority]);

  useEffect(() => {
    if (!drawPending) return;
    const update = () => setNow(Date.now());
    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [drawPending]);

  useEffect(() => {
    const player = selectionPlayer(match, playerId);
    const normalSelectableIds = new Set(
      selectableCharacterBakugan(match, playerId).map((bakugan) => bakugan.id),
    );
    const zones = Array.from(document.querySelectorAll<HTMLElement>(CHARACTER_ZONE_SELECTOR));

    for (const zone of zones) {
      const ownerPlayer = playerForZone(match, player, zone.dataset.zoneOwner);
      const slot = Math.max(0, Number(zone.dataset.slot ?? 1) - 1);
      const bakugan = ownerPlayer?.bakugan[slot];
      const localZone = zone.dataset.zoneOwner === "player";
      const normalSelectable = Boolean(localZone && bakugan && normalSelectableIds.has(bakugan.id));
      const evoSelectable = Boolean(localZone && bakugan && evoTargetIds.has(bakugan.id));
      const selectable = normalSelectable || evoSelectable;
      const selected = Boolean(
        localZone
        && bakugan
        && (
          (normalSelectable && bakugan.id === selectedCharacterId)
          || (evoSelectable && bakugan.id === selectedEvoTargetId)
        ),
      );
      const active = Boolean(bakugan && ownerPlayer && match?.selected[ownerPlayer.id] === bakugan.id);
      const open = Boolean(bakugan?.open);

      if (bakugan) zone.dataset.bakuganId = bakugan.id;
      else delete zone.dataset.bakuganId;
      zone.dataset.characterSelectable = selectable ? "true" : "false";
      zone.dataset.characterSelected = selected ? "true" : "false";
      zone.dataset.characterActive = active ? "true" : "false";
      zone.dataset.characterOpen = open ? "true" : "false";
      zone.dataset.evoTarget = evoSelectable ? "true" : "false";
      zone.dataset.evoTargetSelected = evoSelectable && selected ? "true" : "false";
      zone.setAttribute("aria-pressed", selected ? "true" : "false");
      if (active) zone.setAttribute("aria-current", "true");
      else zone.removeAttribute("aria-current");

      if (selectable) {
        zone.tabIndex = 0;
        zone.setAttribute("role", "button");
        if (evoSelectable && bakugan) {
          zone.setAttribute("aria-label", `${bakugan.name}, legal Evo target${selected ? ", selected" : ""}`);
        }
      } else {
        zone.removeAttribute("tabindex");
        zone.removeAttribute("role");
      }
    }

    const toggleCharacter = (zone: HTMLElement) => {
      if (zone.dataset.characterSelectable !== "true") return;
      const bakuganId = zone.dataset.bakuganId ?? "";
      if (!bakuganId) return;
      if (zone.dataset.evoTarget === "true") {
        setSelectedEvoTargetId((current) => current === bakuganId ? "" : bakuganId);
        return;
      }
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
      setSelectedEvoTargetId("");
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
        delete zone.dataset.evoTarget;
        delete zone.dataset.evoTargetSelected;
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
    selectedEvoTargetId,
    effectiveSelectedHandCardId,
    evoTargetIds,
    evoSelectionActive,
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
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rect = area.getBoundingClientRect();
        const viewport = window.visualViewport;
        const viewportLeft = viewport?.offsetLeft ?? 0;
        const viewportWidth = viewport?.width ?? window.innerWidth;
        const edgeGap = 8;
        const maxWidth = Math.min(
          Math.max(180, rect.width * 1.55),
          Math.max(1, viewportWidth - edgeGap * 2),
        );
        const halfWidth = maxWidth / 2;
        const next = {
          left: clamp(
            rect.left + rect.width / 2,
            viewportLeft + edgeGap + halfWidth,
            viewportLeft + viewportWidth - edgeGap - halfWidth,
          ),
          top: Math.max(8, rect.top - 10),
          maxWidth,
        };
        setTooltipPosition((previous) => sameTooltipPosition(previous, next) ? previous : next);
      });
    };

    measure();
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
