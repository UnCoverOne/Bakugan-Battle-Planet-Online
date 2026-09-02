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
  frost: "/assets/symbols/frost-strike.png",
  shadow: "/assets/symbols/shadow-strike.png",
} as const;

type OverlayItem = {
  icon?: string;
  text: string;
};

const signed = (value: number) => `${value > 0 ? "+" : ""}${value}`;

function overlayItems(core: Core): OverlayItem[] {
  const items: OverlayItem[] = [
    { icon: ICONS.power, text: `${signed(core.bonus)} B` },
    { icon: ICONS.damage, text: `${signed(core.damageBonus)} D` },
  ];

  if (core.bakuGearCostReduction) items.push({ icon: ICONS.energy, text: `Baku-Gear −${core.bakuGearCostReduction} Energy` });
  if (core.frostStrike) items.push({ icon: ICONS.frost, text: `+${core.frostStrike} FrostStrike` });
  if (core.shadowStrike) items.push({ icon: ICONS.shadow, text: "ShadowStrike" });
  if (core.fusionBonus) items.push({ text: `◇ Fusion ${signed(core.fusionBonus)} B` });
  if (core.fusionDamageBonus) items.push({ text: `◇ Fusion ${signed(core.fusionDamageBonus)} D` });
  if (core.fusionFrostStrike) items.push({ icon: ICONS.frost, text: `◇ Fusion +${core.fusionFrostStrike} FrostStrike` });
  if (core.conditionalFactions?.length) {
    const conditional = core.conditionalBonus
      ? `${signed(core.conditionalBonus)} B`
      : core.conditionalDamage
        ? `${signed(core.conditionalDamage)} D`
        : "conditional bonus";
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
  const placeholder = core.art.includes("-placeholder");
  const wrapperStyle: CSSProperties = {
    ...(width !== undefined ? { width: typeof width === "number" ? `${width}px` : width } : {}),
    ...(height !== undefined ? { height: typeof height === "number" ? `${height}px` : height } : {}),
    ...style,
  };

  return (
    <span className={`${styles.art} ${className ?? ""}`} style={wrapperStyle} data-core-placeholder={placeholder ? "true" : "false"}>
      <OriginalImage
        {...imageProps}
        className={styles.image}
        src={core.art}
        alt={alt ?? `${core.name} front`}
        {...(width !== undefined && height !== undefined ? { width, height } : {})}
      />
      {placeholder && (
        <span className={styles.overlay} aria-hidden="true">
          <span className={styles.overlayHeader}><b>{core.type}</b><span>#{core.number}</span></span>
          <span className={styles.overlayItems}>
            {overlayItems(core).map((item, index) => (
              <span className={styles.overlayItem} key={`${item.text}-${index}`}>
                {item.icon && <OriginalImage className={styles.overlayIcon} src={item.icon} alt="" width={24} height={24} />}
                <span>{item.text}</span>
              </span>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}
