"use client";

import { useEffect } from "react";
import type { MatchState } from "../../lib/game";
import {
  selectableCharacterBakugan,
  selectionPlayer,
} from "./selectionState";
import styles from "./SelectionInteractionLayer.module.css";

const CHARACTER_ZONE_SELECTOR = '[data-zone-kind="character-card"][data-zone-owner="player"]';
const PLAY_AREA_SELECTOR = '[aria-label="Experimental game play area"]';

type SelectionInteractionLayerProps = {
  match: MatchState | null;
  playerId?: string;
  selectedCharacterId: string;
  onCharacterSelectionChange: (bakuganId: string) => void;
  onClearSelections: () => void;
};

export function SelectionInteractionLayer({
  match,
  playerId,
  selectedCharacterId,
  onCharacterSelectionChange,
  onClearSelections,
}: SelectionInteractionLayerProps) {
  useEffect(() => {
    const player = selectionPlayer(match, playerId);
    const selectableIds = new Set(
      selectableCharacterBakugan(match, playerId).map((bakugan) => bakugan.id),
    );
    const zones = Array.from(document.querySelectorAll<HTMLElement>(CHARACTER_ZONE_SELECTOR));

    for (const zone of zones) {
      const slot = Math.max(0, Number(zone.dataset.slot ?? 1) - 1);
      const bakugan = player?.bakugan[slot];
      const selectable = Boolean(bakugan && selectableIds.has(bakugan.id));
      const selected = Boolean(bakugan && bakugan.id === selectedCharacterId && selectable);

      if (bakugan) zone.dataset.bakuganId = bakugan.id;
      else delete zone.dataset.bakuganId;
      zone.dataset.characterSelectable = selectable ? "true" : "false";
      zone.dataset.characterSelected = selected ? "true" : "false";
      zone.setAttribute("aria-pressed", selected ? "true" : "false");

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
      const characterZone = event.target.closest<HTMLElement>(CHARACTER_ZONE_SELECTOR);
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
      const characterZone = event.target.closest<HTMLElement>(CHARACTER_ZONE_SELECTOR);
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
        zone.removeAttribute("aria-pressed");
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

  return <span className={styles.selectionStyleAnchor} aria-hidden="true" />;
}
