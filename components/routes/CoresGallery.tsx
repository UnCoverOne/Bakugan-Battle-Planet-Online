"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Core } from "../../lib/game";
import type { CoreCompendiumDensity } from "../../lib/compendium";
import { coreEffects, coreForSet, type CoreEffect } from "../../lib/core-preview";
import { BakuCoreArt } from "../bakucore/BakuCoreArt";
import { CoreEffectTag } from "./CoreEffectTag";
import styles from "./CoresGallery.module.css";

type CoresGalleryProps = {
  cores: readonly Core[];
  selectedSets: readonly string[];
  density: CoreCompendiumDensity;
  selectedId?: string;
  onSelect: (core: Core, trigger: HTMLButtonElement) => void;
};

/** Keep every effect on one line; replace whole hidden tags with a +N badge. */
function EffectStrip({ effects }: { effects: readonly CoreEffect[] }) {
  const availableRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const extraRef = useRef<HTMLSpanElement>(null);
  const [visibleCount, setVisibleCount] = useState(effects.length);

  useLayoutEffect(() => {
    const available = availableRef.current;
    const measure = measureRef.current;
    const extra = extraRef.current;
    if (!available || !measure || !extra) return;
    const update = () => {
      const widths = Array.from(measure.children).slice(0, effects.length)
        .map((child) => (child as HTMLElement).getBoundingClientRect().width);
      const gap = Number.parseFloat(getComputedStyle(available).columnGap) || 0;
      const width = available.clientWidth;
      const total = widths.reduce((sum, item) => sum + item, 0) + Math.max(0, widths.length - 1) * gap;
      let count = effects.length;
      if (total > width) {
        count = 0;
        for (let candidate = effects.length - 1; candidate >= 0; candidate--) {
          extra.textContent = `+${effects.length - candidate}`;
          const extraWidth = extra.getBoundingClientRect().width;
          const needed = widths.slice(0, candidate).reduce((sum, item) => sum + item, 0)
            + candidate * gap + extraWidth;
          if (needed <= width) { count = candidate; break; }
        }
      }
      setVisibleCount((previous) => previous === count ? previous : count);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(available);
    return () => observer.disconnect();
  }, [effects]);

  if (!effects.length) return null;
  const hidden = effects.slice(visibleCount);
  return <span className={styles.effectStrip} ref={availableRef} aria-label={effects.map((effect) => effect.label).join("; ")}>
    {effects.slice(0, visibleCount).map((effect) => <CoreEffectTag key={effect.kind} effect={effect} />)}
    {hidden.length > 0 && <span className={styles.more} title={hidden.map((effect) => effect.label).join("; ")}
      aria-label={`${hidden.length} additional effects: ${hidden.map((effect) => effect.label).join("; ")}`}>+{hidden.length}</span>}
    <span className={styles.measure} ref={measureRef} aria-hidden="true">
      {effects.map((effect) => <CoreEffectTag key={effect.kind} effect={effect} />)}
      <span className={styles.more} ref={extraRef} />
    </span>
  </span>;
}

function CoreTile({ core, selectedSets, compact, selected, onSelect }: {
  core: Core;
  selectedSets: readonly string[];
  compact: boolean;
  selected: boolean;
  onSelect: CoresGalleryProps["onSelect"];
}) {
  const displayedCore = coreForSet(core, selectedSets);
  const effects = useMemo(() => coreEffects(core), [core]);
  const setName = displayedCore.set ?? "Battle Brawlers";
  const setCode = setName === "Armored Alliance" ? "AA" : "BB";
  return <button type="button" className={styles.tile} aria-pressed={selected}
    aria-label={`Inspect ${core.type}, ${setName} #${displayedCore.number}${effects.length ? ", " + effects.map((effect) => effect.label).join("; ") : ""}`}
    onClick={(event) => onSelect(core, event.currentTarget)}>
    <span className={styles.artwork} data-core-preview>
      <BakuCoreArt core={displayedCore} alt="" />
    </span>
    {!compact && <span className={styles.details} data-core-details>
      <strong className={styles.name} title={core.type}>{core.type}</strong>
      <span className={styles.metadata} data-core-meta>
        <span className={styles.setTag} title={`${setName}, collector number ${displayedCore.number}`}>
          {setCode} #{displayedCore.number}
        </span>
        <EffectStrip effects={effects} />
      </span>
    </span>}
  </button>;
}

/** BakuCore-specific gallery with the same frameless density modes as Cards. */
export function CoresGallery({ cores, selectedSets, density, selectedId, onSelect }: CoresGalleryProps) {
  const compact = density === "compact";
  return <div className={`${styles.gallery} ${compact ? styles.compact : ""}`}
    data-ui="core-grid" data-cores-gallery data-cores-view={compact ? "compact" : "detailed"}
    aria-label={compact ? "Compact BakuCore previews" : "Detailed BakuCore previews"}>
    {cores.map((core) => <CoreTile key={core.id} core={core} selectedSets={selectedSets} compact={compact}
      selected={selectedId === core.id} onSelect={onSelect} />)}
  </div>;
}
