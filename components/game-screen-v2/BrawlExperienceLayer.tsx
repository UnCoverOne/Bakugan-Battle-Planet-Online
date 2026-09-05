"use client";

import { OriginalImage } from "@/components/media/OriginalImage";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { MatchState, PendingEffect } from "../../lib/game";
import { CardArt } from "../cards/CardArt";
import {
  batchHudShouldRender,
  brawlCombatants,
  brawlVictorStat,
  effectAnimationKind,
  orderedBatchEffects,
  powerStepStatus,
  type BrawlCombatantView,
  type BrawlVictorStat,
} from "./brawlState";
import { useBakuCorePresentation } from "./BakuCorePresentation";
import styles from "./BrawlExperienceLayer.module.css";
import previewStyles from "./BrawlPreviewEnhancements.module.css";
import { calculateBrawlHudPosition, type HudPosition } from "./brawlHudPosition";
import { useMatchSelector } from "./matchStore";

type ExperienceState = {
  active: boolean;
  online: boolean;
  match: MatchState | null;
  playerId?: string;
};

type BrawlExperienceLayerProps = {
  match?: MatchState | null;
  playerId?: string;
  presentationMode?: "live" | "replay";
  playbackRate?: number;
};

function sameHudPosition(previous: HudPosition | null, next: HudPosition) {
  return Boolean(
    previous
    && Math.abs(previous.left - next.left) < 0.5
    && Math.abs(previous.dockedLeft - next.dockedLeft) < 0.5
    && Math.abs(previous.top - next.top) < 0.5
    && Math.abs(previous.maxWidth - next.maxWidth) < 0.5
  );
}

function effectLabel(effect: PendingEffect) {
  if (effect.alternateWin) return "ULTIMATE WIN";
  if (effect.kind === "trigger") return "TRIGGER";
  if (effect.kind === "copy") return "COPY";
  return effect.card.type.toUpperCase();
}

function phaseName(phase: MatchState["phase"]) {
  if (phase === "power") return "POWER STEP";
  if (phase === "victor") return "VICTOR STEP";
  return "BRAWL";
}

function BrawlCombatant({
  view,
  owner,
  pulsing,
  decidingStat,
}: {
  view: BrawlCombatantView;
  owner: "player" | "opponent";
  pulsing: boolean;
  decidingStat: BrawlVictorStat;
}) {
  const effectivePower = view.participating ? view.power : "—";
  const effectiveDamage = view.participating ? view.damage : "—";
  return (
    <article
      className={`${styles.combatant} ${
        view.participating ? previewStyles.openCombatant : previewStyles.missedCombatant
      }`}
      data-owner={owner}
      data-pulse={pulsing ? "true" : "false"}
      data-participating={view.participating ? "true" : "false"}
      data-roll-result={view.rollResult ?? "pending"}
      aria-label={`${view.playerName}: ${view.bakuganName}. ${view.rollLabel}.`}
    >
      <div className={styles.combatantHeading}>
        <div className={styles.combatantArtFrame}>
          <span aria-hidden="true">{view.bakuganName.slice(0, 1)}</span>
          <OriginalImage src={view.art} alt="" aria-hidden="true" draggable={false} />
          {!view.participating ? <i className={previewStyles.missMark} aria-hidden="true">×</i> : null}
        </div>
        <div className={styles.combatantName}>
          <small>{owner === "player" ? "PLAYER" : "OPPONENT"} • {view.faction}</small>
          <strong>{view.bakuganName}</strong>
          <span>{view.cardName}</span>
          <em
            className={previewStyles.rollStatus}
            data-participating={view.participating ? "true" : "false"}
            title={view.rollNote}
          >
            {view.rollLabel}
          </em>
        </div>
      </div>

      <div className={styles.statRow}>
        <div
          className={styles.stat}
          data-stat="power"
          data-deciding={decidingStat === "power" ? "true" : "false"}
        >
          <span>B-POWER</span>
          <strong>{effectivePower}</strong>
          <small>BASE {view.basePower}{view.participating ? "" : " • CLOSED"}</small>
        </div>
        <div
          className={styles.stat}
          data-stat="damage"
          data-deciding={decidingStat === "damage" ? "true" : "false"}
        >
          <span>DAMAGE</span>
          <strong>{effectiveDamage}</strong>
          <small>BASE {view.baseDamage}{view.participating ? "" : " • NOT ATTACKING"}</small>
        </div>
      </div>

      <div className={styles.detailColumns}>
        <section>
          <h3>EFFECTS</h3>
          <ul>
            {view.effects.map((effect, index) => (
              <li title={effect} key={`${view.bakuganId}-effect-${index}`}>{effect}</li>
            ))}
          </ul>
        </section>
        <section>
          <h3>MODIFIERS</h3>
          <ul>
            {view.modifiers.map((modifier, index) => (
              <li title={modifier} key={`${view.bakuganId}-modifier-${index}`}>{modifier}</li>
            ))}
          </ul>
        </section>
      </div>
    </article>
  );
}

export function BrawlExperienceLayer({
  match: replayMatch,
  playerId: replayPlayerId,
  presentationMode = "live",
  playbackRate = 1,
}: BrawlExperienceLayerProps = {}) {
  const { rollPresentationPending } = useBakuCorePresentation();
  const liveExperience = useMatchSelector((state): ExperienceState => ({
    active: state.route === "match",
    online: state.online,
    match: state.match,
    playerId: state.playerId,
  }));
  const experience: ExperienceState = presentationMode === "replay"
    ? { active: true, online: false, match: replayMatch ?? null, playerId: replayPlayerId }
    : liveExperience;
  const rate = presentationMode === "replay"
    ? Math.max(0.25, Math.min(4, playbackRate || 1))
    : 1;
  const [hudPosition, setHudPosition] = useState<HudPosition | null>(null);
  const [brawlDocked, setBrawlDocked] = useState(false);
  const [resolutionQueue, setResolutionQueue] = useState<PendingEffect[]>([]);
  const [resolvingEffect, setResolvingEffect] = useState<PendingEffect | null>(null);
  const [effectBurst, setEffectBurst] = useState<PendingEffect | null>(null);
  const [pulsingBakugan, setPulsingBakugan] = useState<Set<string>>(new Set());
  const previousBatch = useRef<PendingEffect[]>([]);
  const previousStats = useRef<Record<string, string>>({});
  const resolutionTimer = useRef<number | null>(null);
  const burstTimer = useRef<number | null>(null);
  const pulseTimer = useRef<number | null>(null);

  const combatants = useMemo(
    () => brawlCombatants(experience.match, experience.playerId),
    [experience.match, experience.playerId],
  );
  const batch = useMemo(
    () => orderedBatchEffects(experience.match),
    [experience.match],
  );
  const status = powerStepStatus(experience.match);
  const decidingStat = brawlVictorStat(experience.match);

  useLayoutEffect(() => {
    if (!experience.active || rollPresentationPending || combatants.length !== 2) {
      setHudPosition(null);
      setBrawlDocked(false);
      return;
    }
    const heroZone = document.querySelector<HTMLElement>('[data-zone-id="player-hero"]');
    if (!heroZone) return;
    let observer: ResizeObserver | null = null;
    let frame = 0;

    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rect = heroZone.getBoundingClientRect();
        const viewport = window.visualViewport;
        const rootFontSize = Number.parseFloat(
          window.getComputedStyle(document.documentElement).fontSize,
        ) || 16;
        const next = calculateBrawlHudPosition(
          rect,
          {
            left: viewport?.offsetLeft ?? 0,
            top: viewport?.offsetTop ?? 0,
            width: viewport?.width ?? window.innerWidth,
          },
          rootFontSize,
        );
        setHudPosition((previous) => sameHudPosition(previous, next) ? previous : next);
      });
    };

    measure();
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(heroZone);
    }
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [experience.active, rollPresentationPending, combatants.length]);

  useEffect(() => {
    const current = experience.match?.batch ?? [];
    const previous = previousBatch.current;
    const removed = [...previous].reverse().filter((effect) => (
      !current.some((candidate) => candidate.id === effect.id)
    ));
    previousBatch.current = current;
    if (removed.length) {
      setResolutionQueue((queue) => [
        ...queue,
        ...removed.filter((effect) => !queue.some((queued) => queued.id === effect.id)),
      ]);
    }
  }, [experience.match?.version, experience.match?.batch]);

  useEffect(() => {
    if (resolvingEffect || effectBurst || !resolutionQueue.length) return;
    const [next, ...remaining] = resolutionQueue;
    setResolutionQueue(remaining);
    setResolvingEffect(next);
  }, [resolutionQueue, resolvingEffect, effectBurst]);

  useEffect(() => {
    if (!resolvingEffect) return;
    setEffectBurst(resolvingEffect);
    resolutionTimer.current = window.setTimeout(() => setResolvingEffect(null), 760 / rate);
    return () => {
      if (resolutionTimer.current != null) window.clearTimeout(resolutionTimer.current);
    };
  }, [rate, resolvingEffect]);

  useEffect(() => {
    if (!effectBurst) return;
    burstTimer.current = window.setTimeout(() => setEffectBurst(null), 1050 / rate);
    return () => {
      if (burstTimer.current != null) window.clearTimeout(burstTimer.current);
    };
  }, [effectBurst, rate]);

  useEffect(() => {
    const nextStats: Record<string, string> = {};
    const changed = new Set<string>();
    for (const view of combatants) {
      nextStats[view.bakuganId] = `${view.power}:${view.damage}:${view.participating}:${view.modifiers.join("|")}`;
      const previous = previousStats.current[view.bakuganId];
      if (previous && previous !== nextStats[view.bakuganId]) changed.add(view.bakuganId);
    }
    previousStats.current = nextStats;
    if (!changed.size) return;
    setPulsingBakugan(changed);
    if (pulseTimer.current != null) window.clearTimeout(pulseTimer.current);
    pulseTimer.current = window.setTimeout(() => setPulsingBakugan(new Set()), 760 / rate);
  }, [combatants, rate]);

  useEffect(() => () => {
    if (resolutionTimer.current != null) window.clearTimeout(resolutionTimer.current);
    if (burstTimer.current != null) window.clearTimeout(burstTimer.current);
    if (pulseTimer.current != null) window.clearTimeout(pulseTimer.current);
  }, []);

  if (!experience.active || !experience.match) return null;

  const localPlayer = experience.match.players.find((player) => player.id === experience.playerId)
    ?? experience.match.players[0];
  const priorityName = experience.match.players.find((player) => player.id === experience.match?.priority)?.name
    ?? "Waiting";
  const missedCombatant = combatants.find((view) => !view.participating);
  const advancingCombatant = missedCombatant
    ? combatants.find((view) => view.participating)
    : null;
  const previewState = missedCombatant ? "single-open" : "contested";
  const headerHeadline = missedCombatant && advancingCombatant
    ? `${missedCombatant.playerName} MISSED • ${advancingCombatant.playerName} ADVANCES`
    : status.active
      ? `PRIORITY • ${priorityName}`
      : experience.match.stepLabel;
  const headerDetail = missedCombatant
    ? "ONE BAKUGAN OPEN • AUTOMATIC VICTOR"
    : status.active
      ? `PASSES ${status.consecutivePasses}/2 • BATCH ${status.batchCount}`
      : "ACTIVE BAKUGAN";
  const combinedBatch = resolvingEffect
    && !batch.some((effect) => effect.id === resolvingEffect.id)
    ? [resolvingEffect, ...batch]
    : batch;
  const alternateWinActive = combinedBatch.some((effect) => effect.alternateWin);
  const showBatchHud = combinedBatch.length > 0
    && batchHudShouldRender(experience.match);
  const hudStyle = hudPosition ? {
    left: hudPosition.left,
    top: hudPosition.top,
    width: `${hudPosition.maxWidth}px`,
    "--brawl-dock-offset": `${hudPosition.dockedLeft - hudPosition.left}px`,
  } as CSSProperties : undefined;

  return (
    <>
      {!rollPresentationPending && combatants.length === 2 && hudPosition ? (
        <aside
          className={`${styles.brawlHud} ${previewStyles.brawlPreview}`}
          style={hudStyle}
          data-preview-state={previewState}
          data-docked={brawlDocked ? "true" : "false"}
          aria-label="Active Brawl statistics, effects, modifiers, and roll outcomes"
        >
          <button
            type="button"
            className={styles.brawlDockHandle}
            aria-label={brawlDocked ? "Restore Brawl Preview" : "Dock Brawl Preview to the right"}
            aria-pressed={brawlDocked}
            onClick={() => setBrawlDocked((docked) => !docked)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d={brawlDocked ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"} />
            </svg>
          </button>
          <header className={`${styles.brawlHeader} ${missedCombatant ? previewStyles.singleOpenHeader : ""}`}>
            <span>{phaseName(experience.match.phase)}</span>
            <strong>{headerHeadline}</strong>
            <small>{headerDetail}</small>
          </header>
          <div className={styles.combatants}>
            <BrawlCombatant
              view={combatants[0]}
              owner="player"
              pulsing={pulsingBakugan.has(combatants[0].bakuganId)}
              decidingStat={decidingStat}
            />
            <span className={`${styles.versus} ${missedCombatant ? previewStyles.resolvedVersus : ""}`} aria-hidden="true">
              {missedCombatant ? "→" : "VS"}
            </span>
            <BrawlCombatant
              view={combatants[1]}
              owner="opponent"
              pulsing={pulsingBakugan.has(combatants[1].bakuganId)}
              decidingStat={decidingStat}
            />
          </div>
        </aside>
      ) : null}

      {showBatchHud ? (
        <aside
          className={styles.batchHud}
          aria-label={`${combinedBatch.length} effects in the batch`}
          data-zone-kind="batch"
        >
          <div className={styles.batchTitle} data-alternate-win={alternateWinActive ? "true" : "false"}>
            <strong>{alternateWinActive ? "ULTIMATE EFFECT" : "BATCH"}</strong>
            <span>{alternateWinActive ? "NO CARDS MAY BE PLAYED" : "RESOLVES LEFT TO RIGHT"}</span>
          </div>
          <div className={styles.batchRow}>
            {combinedBatch.map((effect, index) => {
              const local = effect.controllerId === localPlayer?.id;
              const resolving = effect.id === resolvingEffect?.id
                && !batch.some((candidate) => candidate.id === effect.id);
              return (
                <figure
                  className={styles.batchEffect}
                  data-owner={local ? "player" : "opponent"}
                  data-card-id={effect.card.id}
                  data-rule-object-id={effect.id}
                  data-resolving={resolving ? "true" : "false"}
                  data-alternate-win={effect.alternateWin ? "true" : "false"}
                  style={{ "--batch-order": index } as CSSProperties}
                  title={`${effect.card.displayName || effect.card.name}: ${effect.card.effect}`}
                  key={effect.id}
                >
                  <div className={styles.batchHex}>
                    <span aria-hidden="true">{(effect.card.displayName || effect.card.name).slice(0, 1)}</span>
                    <CardArt src={effect.card.art} cardType={effect.card.type} alt={effect.card.displayName || effect.card.name} draggable={false} />
                  </div>
                  <figcaption>
                    <small>{effectLabel(effect)}</small>
                    <strong>{effect.card.displayName || effect.card.name}</strong>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </aside>
      ) : null}

      {effectBurst ? (
        <div
          className={styles.effectBurst}
          data-kind={effectAnimationKind(effectBurst)}
          data-owner={effectBurst.controllerId === localPlayer?.id ? "player" : "opponent"}
          role="status"
          aria-live="polite"
        >
          <span>{effectLabel(effectBurst)}</span>
          <strong>{effectBurst.card.displayName || effectBurst.card.name}</strong>
          <p>{effectBurst.card.effect || "Effect resolved."}</p>
        </div>
      ) : null}
    </>
  );
}
