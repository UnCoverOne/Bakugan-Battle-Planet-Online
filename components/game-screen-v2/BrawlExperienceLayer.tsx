"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { MatchState, PendingEffect } from "../../lib/game";
import {
  brawlCombatants,
  effectAnimationKind,
  orderedBatchEffects,
  powerStepStatus,
  type BrawlCombatantView,
} from "./brawlState";
import { useBakuCorePresentation } from "./BakuCorePresentation";
import styles from "./BrawlExperienceLayer.module.css";
import previewStyles from "./BrawlPreviewEnhancements.module.css";
import { useMatchSelector } from "./matchStore";

type ExperienceState = {
  active: boolean;
  online: boolean;
  match: MatchState | null;
  playerId?: string;
};

type HudPosition = {
  left: number;
  dockedLeft: number;
  top: number;
  maxWidth: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

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
}: {
  view: BrawlCombatantView;
  owner: "player" | "opponent";
  pulsing: boolean;
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
          <img src={view.art} alt="" aria-hidden="true" draggable={false} />
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
        <div className={styles.stat} data-stat="power">
          <span>B-POWER</span>
          <strong>{effectivePower}</strong>
          <small>BASE {view.basePower}{view.participating ? "" : " • CLOSED"}</small>
        </div>
        <div className={styles.stat} data-stat="damage">
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

export function BrawlExperienceLayer() {
  const { rollPresentationPending } = useBakuCorePresentation();
  const experience = useMatchSelector((state): ExperienceState => ({
    active: state.route === "match",
    online: state.online,
    match: state.match,
    playerId: state.playerId,
  }));
  const [hudPosition, setHudPosition] = useState<HudPosition | null>(null);
  const [brawlDocked, setBrawlDocked] = useState(false);
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
        const viewportLeft = viewport?.offsetLeft ?? 0;
        const viewportWidth = viewport?.width ?? window.innerWidth;
        const edgeGap = 12;
        const dockHandleWidth = 32;
        const maxWidth = Math.min(
          Math.max(1, viewportWidth - edgeGap * 2 - dockHandleWidth),
          Math.max(430, rect.width * 2.65),
        );
        const halfWidth = maxWidth / 2;
        const next = {
          left: clamp(
            rect.left + rect.width / 2,
            viewportLeft + edgeGap + dockHandleWidth + halfWidth,
            viewportLeft + viewportWidth - edgeGap - halfWidth,
          ),
          dockedLeft: viewportLeft + viewportWidth + halfWidth,
          top: Math.max(10, rect.top - 10),
          maxWidth,
        };
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
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [experience.active, rollPresentationPending, combatants.length]);

  useEffect(() => {
    const current = experience.match?.batch ?? [];
    const previous = previousBatch.current;
    const removed = [...previous].reverse().find((effect) => (
      !current.some((candidate) => candidate.id === effect.id)
    ));
    previousBatch.current = current;
    if (!removed) return;

    setResolvingEffect(removed);
    setEffectBurst(removed);
    if (resolutionTimer.current != null) window.clearTimeout(resolutionTimer.current);
    if (burstTimer.current != null) window.clearTimeout(burstTimer.current);
    resolutionTimer.current = window.setTimeout(() => setResolvingEffect(null), 760);
    burstTimer.current = window.setTimeout(() => setEffectBurst(null), 1050);
  }, [experience.match?.version, experience.match?.batch]);

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
    pulseTimer.current = window.setTimeout(() => setPulsingBakugan(new Set()), 760);
  }, [combatants]);

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
  const batchKey = combinedBatch.map((effect) => effect.id).join("|");
  const hudStyle = hudPosition ? {
    left: brawlDocked ? hudPosition.dockedLeft : hudPosition.left,
    top: hudPosition.top,
    width: `${hudPosition.maxWidth}px`,
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
            />
            <span className={`${styles.versus} ${missedCombatant ? previewStyles.resolvedVersus : ""}`} aria-hidden="true">
              {missedCombatant ? "→" : "VS"}
            </span>
            <BrawlCombatant
              view={combatants[1]}
              owner="opponent"
              pulsing={pulsingBakugan.has(combatants[1].bakuganId)}
            />
          </div>
        </aside>
      ) : null}

      {combinedBatch.length ? (
        <aside
          className={styles.batchHud}
          aria-label={`${combinedBatch.length} effects in the batch`}
          data-zone-kind="batch"
        >
          <div className={styles.batchTitle}>
            <strong>BATCH</strong>
            <span>RESOLVES LEFT TO RIGHT</span>
          </div>
          <div className={styles.batchRow} key={batchKey}>
            {combinedBatch.map((effect, index) => {
              const local = effect.controllerId === localPlayer?.id;
              const resolving = effect.id === resolvingEffect?.id
                && !batch.some((candidate) => candidate.id === effect.id);
              return (
                <figure
                  className={styles.batchEffect}
                  data-owner={local ? "player" : "opponent"}
                  data-card-id={effect.card.id}
                  data-resolving={resolving ? "true" : "false"}
                  style={{ "--batch-order": index } as CSSProperties}
                  title={`${effect.card.displayName || effect.card.name}: ${effect.card.effect}`}
                  key={effect.id}
                >
                  <div className={styles.batchHex}>
                    <span aria-hidden="true">{(effect.card.displayName || effect.card.name).slice(0, 1)}</span>
                    <img src={effect.card.art} alt={effect.card.displayName || effect.card.name} draggable={false} />
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
