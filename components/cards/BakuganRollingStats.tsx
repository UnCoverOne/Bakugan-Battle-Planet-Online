"use client";

import { bakuganRollingValues, type BakuganRollingValues } from "../../lib/bakugan-rolling";
import type { GameCard } from "../../lib/game";
import styles from "./BakuganRollingStats.module.css";

export { bakuganRollingValues } from "../../lib/bakugan-rolling";

export function BakuganRollingStat({ kind, value, plain = false }: {
  kind: "rollAccuracy" | "doubleCoreChance";
  value: number;
  plain?: boolean;
}) {
  const isRollAccuracy = kind === "rollAccuracy";
  const label = isRollAccuracy ? "Roll Accuracy" : "Double Core Chance";
  return (
    <span className={`${styles.stat} ${plain ? styles.plain : ""}`} role="img" aria-label={`${label}: ${value}%`} title={`${label}: ${value}%`}>
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
