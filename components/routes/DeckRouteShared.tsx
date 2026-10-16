"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { STARTER_DECKS, type DeckFormat, type DeckRecord } from "../../lib/data";
import type { DeckRestriction } from "../../lib/deck-validation";
import { uniqueDeckName } from "../../lib/deck-transfer";

import { Surface } from "../design-system/primitives";
import styles from "./DeckRoutes.module.css";

export const deckFormatLabel = (format: DeckFormat) => (
  format === "singleton" ? "Singleton" : format === "competitive" ? "Competitive" : "Standard"
);

export function useCompetitiveRules() {
  const [attempt, setAttempt] = useState(0);
  const [rules, setRules] = useState<{ deckSize: number; restrictions: DeckRestriction[]; loading: boolean; error: string | null }>({
    deckSize: 0,
    restrictions: [],
    loading: true,
    error: null,
  });
  useEffect(() => {
    let active = true;
    fetch("/api/ranked?action=rules", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { ruleset?: { deckSize?: number; restrictions?: DeckRestriction[] }; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Competitive rules could not be loaded.");
        const deckSize = Number(result.ruleset?.deckSize);
        if (!Number.isInteger(deckSize) || deckSize <= 0 || !Array.isArray(result.ruleset?.restrictions)) throw new Error("The published Competitive ruleset is invalid.");
        if (active) {
          setRules({
            deckSize,
            restrictions: result.ruleset!.restrictions!,
            loading: false,
            error: null,
          });
        }
      })
      .catch((error) => { if (active) setRules(current => ({ ...current, deckSize: 0, restrictions: [], loading: false, error: error instanceof Error ? error.message : "Competitive rules unavailable. Retry before adding cards or saving." })); });
    return () => { active = false; };
  }, [attempt]);
  const retry = useCallback(() => {
    setRules(current => ({ ...current, deckSize: 0, restrictions: [], loading: true, error: null }));
    setAttempt(current => current + 1);
  }, []);
  return { ...rules, retry };
}

export const clone = (deck: DeckRecord): DeckRecord => ({
  ...deck,
  factions: [...deck.factions],
  bakuganIds: [...deck.bakuganIds],
  coreIds: [...deck.coreIds],
  cardIds: [...deck.cardIds],
  tags: [...(deck.tags ?? [])],
});

export const blankDraft = (decks: DeckRecord[]): DeckRecord => ({
  ...clone(STARTER_DECKS[0]),
  id: globalThis.crypto?.randomUUID?.() ?? `deck-${Date.now().toString(36)}`,
  name: uniqueDeckName("Untitled Battle Deck", decks),
  factions: [],
  bakuganIds: [],
  coreIds: [],
  cardIds: [],
  leadCardId: undefined,
  updatedAt: new Date().toISOString(),
  visibility: "Draft",
  revision: 1,
});

export function useOnlineStatus() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    addEventListener("online", update);
    addEventListener("offline", update);
    return () => {
      removeEventListener("online", update);
      removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function DeckState({
  tone = "neutral",
  title,
  copy,
  action,
  role,
}: {
  tone?: "neutral" | "loading" | "error" | "offline";
  title: string;
  copy: string;
  action?: ReactNode;
  role?: "alert" | "status";
}) {
  return (
    <Surface className={`${styles.state} ${styles[`state_${tone}`]}`} role={role}>
      <span className={styles.stateIcon} aria-hidden="true">
        {tone === "error" ? "!" : tone === "offline" ? "↯" : tone === "loading" ? "◌" : "◇"}
      </span>
      <div><strong>{title}</strong><p>{copy}</p></div>
      {action && <div className={styles.stateAction}>{action}</div>}
    </Surface>
  );
}
