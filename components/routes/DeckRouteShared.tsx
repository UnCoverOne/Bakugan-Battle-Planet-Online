"use client";

import { useEffect, useState, type ReactNode } from "react";
import { STARTER_DECKS, type DeckFormat, type DeckRecord } from "../../lib/data";
import type { DeckRestriction } from "../../lib/deck-validation";
import { uniqueDeckName } from "../../lib/deck-transfer";
import { cachedResponse } from "../../lib/response-cache";
import { Surface } from "../design-system/primitives";
import styles from "./DeckRoutes.module.css";

export const deckFormatLabel = (format: DeckFormat) => (
  format === "singleton" ? "Singleton" : format === "competitive" ? "Competitive" : "Standard"
);

export function useCompetitiveRules() {
  const [rules, setRules] = useState<{ deckSize: number; restrictions: DeckRestriction[] }>({
    deckSize: 50,
    restrictions: [],
  });
  useEffect(() => {
    let active = true;
    cachedResponse<{ ruleset?: { deckSize?: number; restrictions?: DeckRestriction[] } }>("competitive-rules", "/api/ranked?action=rules")
      .then((result) => {
        const deckSize = Number(result.ruleset?.deckSize);
        if (active) {
          setRules({
            deckSize: Number.isInteger(deckSize) && deckSize > 0 ? deckSize : 50,
            restrictions: Array.isArray(result.ruleset?.restrictions) ? result.ruleset.restrictions : [],
          });
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return rules;
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
