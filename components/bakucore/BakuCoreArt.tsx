"use client";

import type { CSSProperties, ComponentProps } from "react";
import { OriginalImage } from "@/components/media/OriginalImage";
import type { Core } from "@/lib/game";
import styles from "./BakuCoreArt.module.css";

type OriginalImageProps = ComponentProps<typeof OriginalImage>;

const ICONS = {
  power: "/assets/symbols/b-power.png",
  damage: "/assets/symbols/damage.png",
  energy: "/assets/symbols/energy.png",
  bakuGear: "/assets/symbols/baku-gear.svg",
  frost: "/assets/symbols/frost-strike.png",
  shadow: "/assets/symbols/shadow-strike.png",
} as const;

type OverlayItem = {
  leadingIcon?: string;
  text: string;
  trailingIcon?: string;
};

const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;

function overlayItems(core: Core): OverlayItem[] {
  const items: OverlayItem[] = [];

  // The fallback artwork already supplies the core type, collector number,
  // B-Power, and Damage. Only add rules that are absent from that artwork.
  if (core.bakuGearCostReduction) {
    items.push({
      leadingIcon: ICONS.bakuGear,
      text: `: -${core.bakuGearCostReduction}`,
      trailingIcon: ICONS.energy,
    });
  }
  if (core.frostStrike) items.push({ leadingIcon: ICONS.frost, text: `: +${core.frostStrike}` });
  if (core.shadowStrike) items.push({ leadingIcon: ICONS.shadow, text: ": ShadowStrike" });
  if (core.fusionBonus) items.push({ leadingIcon: ICONS.power, text: `: ${signed(core.fusionBonus)}` });
  if (core.fusionDamageBonus) items.push({ leadingIcon: ICONS.damage, text: `: ${signed(core.fusionDamageBonus)}` });
  if (core.fusionFrostStrike) items.push({ leadingIcon: ICONS.frost, text: `: +${core.fusionFrostStrike}` });
  if (core.conditionalFactions?.length) {
    const conditional = core.conditionalBonus
      ? `${signed(core.conditionalBonus)} B`
      : core.conditionalDamage
        ? `${signed(core.conditionalDamage)} D`
        : "conditional";
    items.push({ text: `${core.conditionalFactions.join(" / ")}: ${conditional}` });
  }
  return items;
}

export function BakuCoreArt({
  core,
  alt,
  className,
  style,
  width,
  height,
  ...imageProps
}: Omit<OriginalImageProps, "src" | "alt"> & {
  core: Core;
  alt?: string;
}) {
  const suppliedScan = core.hasProvidedScan === true;
  const effectFallback = core.set === "Armored Alliance" && !suppliedScan;
  const wrapperStyle: CSSProperties = {
    ...(width !== undefined ? { width: typeof width === "number" ? `${width}px` : width } : {}),
    ...(height !== undefined ? { height: typeof height === "number" ? `${height}px` : height } : {}),
    ...style,
  };

  return (
    <span className={`${styles.art} ${className ?? ""}`} style={wrapperStyle} data-core-fallback={effectFallback ? "true" : "false"} data-core-scan={suppliedScan ? "true" : "false"}>
      <OriginalImage
        {...imageProps}
        className={styles.image}
        src={core.art}
        alt={alt ?? `${core.name} front`}
        {...(width !== undefined && height !== undefined ? { width, height } : {})}
      />
      {effectFallback && (
        <span className={styles.overlay} aria-hidden="true">
          <span className={styles.overlayItems}>
            {overlayItems(core).map((item, index) => (
              <span className={styles.overlayItem} key={`${item.text}-${index}`}>
                {item.leadingIcon && <OriginalImage className={styles.overlayIcon} src={item.leadingIcon} alt="" width={20} height={20} />}
                <span>{item.text}</span>
                {item.trailingIcon && <OriginalImage className={styles.overlayIcon} src={item.trailingIcon} alt="" width={20} height={20} />}
              </span>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}
