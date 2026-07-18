"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { selectBakugan, type MatchState } from "../../lib/game";
import {
  bakuganForCharacterSlot,
  characterSelectionIsAvailable,
  characterSelectionPlayer,
} from "./characterSelectionState";
import styles from "./CharacterSelectionWorkflow.module.css";

const ROUTE_KEY = "bbp-route-v1";
const SETTINGS_KEY = "bbp-settings";
const MATCH_KEY = "bbp-active-match-v1";
const ONLINE_KEY = "bbp-active-match-online-v1";
const PLAYER_KEY = "bbp-player-id";
const MATCH_UPDATE_EVENT = "bbp-match-state-updated";

type SelectionSnapshot = {
  enabled: boolean;
  route: string;
  match: MatchState | null;
  online: boolean;
  playerId?: string;
};

function parseStoredValue<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

function readSnapshot(): SelectionSnapshot {
  const settings = parseStoredValue<{ useNewGameScreen?: boolean }>(
    localStorage.getItem(SETTINGS_KEY),
    {},
  );
  return {
    enabled: Boolean(settings.useNewGameScreen),
    route: parseStoredValue(localStorage.getItem(ROUTE_KEY), "entry"),
    match: parseStoredValue<MatchState | null>(localStorage.getItem(MATCH_KEY), null),
    online: parseStoredValue(localStorage.getItem(ONLINE_KEY), false),
    playerId: parseStoredValue<string | undefined>(localStorage.getItem(PLAYER_KEY), undefined),
  };
}

function publishMatch(match: MatchState) {
  localStorage.setItem(MATCH_KEY, JSON.stringify(match));
  window.dispatchEvent(new CustomEvent<MatchState>(MATCH_UPDATE_EVENT, { detail: match }));
}

export function CharacterSelectionWorkflow() {
  const [snapshot, setSnapshot] = useState<SelectionSnapshot>({
    enabled: false,
    route: "entry",
    match: null,
    online: false,
    playerId: undefined,
  });
  const [selectedBakuganId, setSelectedBakuganId] = useState("");
  const [primarySlot, setPrimarySlot] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const update = () => setSnapshot(readSnapshot());
    update();
    const interval = window.setInterval(update, 200);
    window.addEventListener("storage", update);
    window.addEventListener(MATCH_UPDATE_EVENT, update);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", update);
      window.removeEventListener(MATCH_UPDATE_EVENT, update);
    };
  }, []);

  useEffect(() => {
    const findSlot = () => setPrimarySlot(
      document.querySelector<HTMLElement>('[data-slot="primary"]'),
    );
    findSlot();
    const observer = new MutationObserver(findSlot);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const player = characterSelectionPlayer(snapshot.match, snapshot.playerId);
  const active = snapshot.enabled
    && snapshot.route === "match"
    && characterSelectionIsAvailable(snapshot.match, player?.id);

  useEffect(() => {
    if (active) return;
    setSelectedBakuganId("");
    setError("");
  }, [active]);

  useEffect(() => {
    if (!active || !snapshot.match || !player) return;
    const zones = Array.from(document.querySelectorAll<HTMLElement>(
      '[data-zone-kind="character-card"][data-zone-owner="player"]',
    ));
    const cleanups: Array<() => void> = [];

    for (const zone of zones) {
      const slot = Number(zone.dataset.slot ?? "0");
      const bakugan = bakuganForCharacterSlot(snapshot.match, player.id, slot);
      if (!bakugan) continue;
      const selected = selectedBakuganId === bakugan.id;
      zone.dataset.characterSelectable = "true";
      zone.dataset.characterSelected = selected ? "true" : "false";
      zone.dataset.characterBakuganId = bakugan.id;
      zone.tabIndex = 0;
      zone.setAttribute("role", "button");
      zone.setAttribute("aria-pressed", selected ? "true" : "false");
      zone.setAttribute(
        "aria-label",
        `${bakugan.character.displayName || bakugan.character.name}, ${selected ? "selected" : "available"} for the Selection Step`,
      );

      const toggle = () => {
        setError("");
        setSelectedBakuganId((current) => current === bakugan.id ? "" : bakugan.id);
      };
      const click = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        toggle();
      };
      const keydown = (event: KeyboardEvent) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        toggle();
      };
      zone.addEventListener("click", click);
      zone.addEventListener("keydown", keydown);
      cleanups.push(() => {
        zone.removeEventListener("click", click);
        zone.removeEventListener("keydown", keydown);
        zone.removeAttribute("data-character-selectable");
        zone.removeAttribute("data-character-selected");
        zone.removeAttribute("data-character-bakugan-id");
        zone.removeAttribute("role");
        zone.removeAttribute("aria-pressed");
        zone.tabIndex = -1;
      });
    }

    return () => cleanups.forEach((cleanup) => cleanup());
  }, [active, player?.id, selectedBakuganId, snapshot.match?.version]);

  useEffect(() => {
    if (!active) return;
    const playArea = document.querySelector<HTMLElement>(
      '[aria-label="Experimental game play area"]',
    );
    if (!playArea) return;
    const clearOnBlankSpace = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-zone-kind], [data-zone-group], button, [role="button"]')) return;
      setSelectedBakuganId("");
      setError("");
    };
    playArea.addEventListener("click", clearOnBlankSpace);
    return () => playArea.removeEventListener("click", clearOnBlankSpace);
  }, [active]);

  useEffect(() => {
    if (!primarySlot || !selectedBakuganId || !active) return;
    const previous = primarySlot.getAttribute("data-filled");
    primarySlot.setAttribute("data-filled", "true");
    return () => {
      if (previous == null) primarySlot.removeAttribute("data-filled");
      else primarySlot.setAttribute("data-filled", previous);
    };
  }, [active, primarySlot, selectedBakuganId]);

  const confirmSelection = async () => {
    if (busy || !selectedBakuganId) return;
    setBusy(true);
    setError("");
    try {
      const current = readSnapshot();
      const match = current.match;
      const actor = characterSelectionPlayer(match, current.playerId);
      if (!match || !actor || !characterSelectionIsAvailable(match, actor.id)) {
        throw new Error("Character selection is no longer available.");
      }
      if (!actor.bakugan.some((bakugan) => bakugan.id === selectedBakuganId)) {
        throw new Error("Choose one of your Character Cards.");
      }

      if (!current.online) {
        publishMatch(selectBakugan(match, actor.id, selectedBakuganId));
      } else {
        const response = await fetch("/api/game", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "select",
            code: match.code,
            playerId: actor.id,
            expectedVersion: match.version,
            payload: { bakuganId: selectedBakuganId },
          }),
        });
        const data = await response.json() as { state?: MatchState; error?: string };
        if (data.state) publishMatch(data.state);
        if (!response.ok) throw new Error(data.error ?? "The Character Card could not be selected.");
      }
      setSelectedBakuganId("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The Character Card could not be selected.");
    } finally {
      setBusy(false);
    }
  };

  const button = active && selectedBakuganId && primarySlot
    ? createPortal(
      <button
        type="button"
        className={styles.confirmButton}
        data-action="select-character"
        data-active="true"
        disabled={busy}
        onClick={() => void confirmSelection()}
      >
        {busy ? "Selecting…" : "Select Character"}
      </button>,
      primarySlot,
    )
    : null;

  return (
    <>
      {button}
      {error ? <p className={styles.visuallyHidden} role="alert">{error}</p> : null}
    </>
  );
}
