"use client";

import type { CoreEffect } from "../../lib/core-preview";
import { OriginalImage } from "../media/OriginalImage";
import { CardFactionGlyph } from "./CardFactionTag";
import styles from "./CoresGallery.module.css";

const SYMBOLS = {
  power: "/assets/symbols/b-power.svg",
  damage: "/assets/symbols/damage.svg",
  energy: "/assets/symbols/energy.svg",
  gear: "/assets/symbols/baku-gear.svg",
  frost: "/assets/symbols/frost-strike.svg",
  shadow: "/assets/symbols/shadow-strike.svg",
  fusion: "/assets/symbols/fusion.png",
} as const;

function Symbol({ kind }: { kind: keyof typeof SYMBOLS }) {
  // Render each original asset directly so its black, white and coloured details survive.
  return <OriginalImage className={styles.effectSymbol}
    src={SYMBOLS[kind]} width={16} height={16} alt="" aria-hidden="true" />;
}

/** Every mechanic uses the same tag; only the sequence of symbols/values differs. */
export function CoreEffectTag({ effect }: { effect: CoreEffect }) {
  const fusion = effect.kind.startsWith("fusion-");
  const conditional = effect.kind.startsWith("conditional-");
  const power = effect.kind.endsWith("power");
  const damage = effect.kind.endsWith("damage");
  const frost = effect.kind === "frost" || effect.kind === "fusion-frost";

  return (
    <span className={styles.effectTag} title={effect.label} aria-label={effect.label}>
      {fusion && <Symbol kind="fusion" />}
      {conditional && <span className={styles.conditionalFactions} aria-hidden="true">
        {effect.factions?.map((faction, index) => (
          <span className={styles.conditionalFaction} key={faction}>
            {index > 0 && <span className={styles.orSeparator}>/</span>}
            <CardFactionGlyph faction={faction} className={styles.factionSymbol} useFactionColor />
          </span>
        ))}
      </span>}
      {effect.kind === "gear" && <Symbol kind="gear" />}
      {effect.value && <span className={styles.effectValue}>{effect.value}</span>}
      {power && <Symbol kind="power" />}
      {damage && <Symbol kind="damage" />}
      {frost && <Symbol kind="frost" />}
      {effect.kind === "gear" && <Symbol kind="energy" />}
      {effect.kind === "shadow" && <><Symbol kind="shadow" /><span>Shadow</span></>}
    </span>
  );
}
