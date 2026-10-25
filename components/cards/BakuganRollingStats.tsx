"use client";

import { BAKUGAN } from "../../lib/data";
import type { Bakugan, GameCard } from "../../lib/game";
import styles from "./BakuganRollingStats.module.css";

export type BakuganRollingValues = Pick<Bakugan, "rollAccuracy" | "doubleCoreChance">;

const bakuganByCardId = new Map(BAKUGAN.map((bakugan) => [bakugan.character.catalogId, bakugan]));

export function bakuganRollingValues(card: GameCard): BakuganRollingValues | null {
  return card.type === "Character" ? bakuganByCardId.get(card.catalogId) ?? null : null;
}

export function BakuganRollingStat({ kind, value }: {
  kind: "rollAccuracy" | "doubleCoreChance";
  value: number;
}) {
  const isRollAccuracy = kind === "rollAccuracy";
  const label = isRollAccuracy ? "Roll Accuracy" : "Double Core Chance";
  return (
    <span className={styles.stat} role="img" aria-label={`${label}: ${value}%`} title={`${label}: ${value}%`}>
      <span className={`${styles.icon} ${isRollAccuracy ? styles.rollIcon : styles.doubleCoreIcon}`} aria-hidden="true" />
      <span aria-hidden="true">{value}%</span>
    </span>
  );
}

export function BakuganRollingOverlay({ card, values }: {
  card: GameCard;
  values?: BakuganRollingValues;
}) {
  const rolling = card.type === "Character" ? values ?? bakuganRollingValues(card) : null;
  if (!rolling) return null;
  return (
    <span className={styles.overlay} data-ui="bakugan-rolling-overlay">
      <BakuganRollingStat kind="rollAccuracy" value={rolling.rollAccuracy} />
      <BakuganRollingStat kind="doubleCoreChance" value={rolling.doubleCoreChance} />
    </span>
  );
}
