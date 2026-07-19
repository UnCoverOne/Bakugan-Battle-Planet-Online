"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  cloneMatch,
  passPriority,
  type MatchState,
  type PendingEffect,
} from "../../lib/game";
import {
  brawlCombatants,
  effectAnimationKind,
  orderedBatchEffects,
  powerStepStatus,
  type BrawlCombatantView,
} from "./brawlState";
import styles from "./BrawlExperienceLayer.module.css";

const ROUTE_KEY = "bbp-route-v1";
const SETTINGS_KEY = "bbp-settings";
const MATCH_KEY = "bbp-active-match-v1";
const ONLINE_KEY = "bbp-active-match-online-v1";
const PLAYER_KEY = "bbp-player-id";
const MATCH_UPDATE_EVENT = "bbp-match-state-updated";

type ExperienceState = {
  active: boolean;
  online: boolean;
  match: MatchState | null;
  playerId?: string;
};

type HudPosition = {
  left: number;
  top: number;
  maxWidth: number;
};

function parseValue<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

function readExperienceState(): ExperienceState {
  const settings = parseValue<Record<string, unknown>>(localStorage.getItem(SETTINGS_KEY), {});
  const route = parseValue(localStorage.getItem(ROUTE_KEY), "entry");
  return {
    active: Boolean(settings.useNewGameScreen) && route === "match",
    online: parseValue(localStorage.getItem(ONLINE_KEY), false),
    match: parseValue<MatchState | null>(localStorage.getItem(MATCH_KEY), null),
    playerId: parseValue<string | undefined>(localStorage.getItem(PLAYER_KEY), undefined),
  };
}

function publishMatch(match: MatchState) {
  localStorage.setItem(MATCH_KEY, JSON.stringify(match));
  window.dispatchEvent(new CustomEvent<MatchState>(MATCH_UPDATE_EVENT, { detail: match }));
}

function effectLabel(effect: PendingEffect) {
  if (effect.kind === "trigger") return "TRIGGER";
  if (effect.kind === "copy") return "COPY";
  return effect.card.type.toUpperCase();
}

function phaseName(phase: MatchState["phase"]) {
  if (phase === "power") return "POWER STEP";
  if (phase === "victor") return "VICTOR STEP";
  if (phase === "damage" || phase === "postDamage") return "DAMAGE STEP";
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
  return (
    <article
      className={styles.combatant}
      data-owner={owner}
      data-pulse={pulsing ? "true" : "false"}
    >
      <div className={styles.combatantHeading}>
        <div className={styles.combatantArtFrame}>
          <span aria-hidden="true">{view.bakuganName.slice(0, 1)}</span>
          <img src={view.art} alt="" aria-hidden="true" draggable={false} />
        </div>
        <div className={styles.combatantName}>
          <small>{owner === "player" ? "PLAYER" : "OPPONENT"} • {view.faction}</small>
          <strong>{view.bakuganName}</strong>
          <span>{view.cardName}</span>
        </div>
      </div>

      <div className={styles.statRow}>
        <div className={styles.stat} data-stat="power">
          <span>B-POWER</span>
          <strong>{view.power}</strong>
          <small>BASE {view.basePower}</small>
        </div>
        <div className={styles.stat} data-stat="damage">
          <span>DAMAGE</span>
          <strong>{view.damage}</strong>
          <small>BASE {view.baseDamage}</small>
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
  const [experience, setExperience] = useState<ExperienceState>({
    active: false,
    online: false,
    match: null,
    playerId: undefined,
  });
  const [hudPosition, setHudPosition] = useState<HudPosition | null>(null);
  const [resolvingEffect, setResolvingEffect] = useState<PendingEffect | null>(null);
  const [effectBurst, setEffectBurst] = useState<PendingEffect | null>(null);
  const [pulsingBakugan, setPulsingBakugan] = useState<Set<string>>(new Set());
  const rawState = useRef("");
  const previousBatch = useRef<PendingEffect[]>([]);
  const previousBatchForPriority = useRef<string[]>([]);
  const previousStats = useRef<Record<string, string>>({});
  const localCorrectionKey = useRef("");
  const botActionKey = useRef("");
  const resolutionTimer = useRef<number | null>(null);
  const burstTimer = useRef<number | null>(null);
  const pulseTimer = useRef<number | null>(null);

  useEffect(() => {
    const update = () => {
      const raw = [
        localStorage.getItem(ROUTE_KEY),
        localStorage.getItem(SETTINGS_KEY),
        localStorage.getItem(MATCH_KEY),
        localStorage.getItem(ONLINE_KEY),
        localStorage.getItem(PLAYER_KEY),
      ].join("\u0000");
      if (raw === rawState.current) return;
      rawState.current = raw;
      setExperience(readExperienceState());
    };
    update();
    const interval = window.setInterval(update, 200);
    window.addEventListener("storage", update);
    window.addEventListener(MATCH_UPDATE_EVENT, update as EventListener);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", update);
      window.removeEventListener(MATCH_UPDATE_EVENT, update as EventListener);
    };
  }, []);

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
    if (!experience.active || combatants.length !== 2) {
      setHudPosition(null);
      return;
    }
    const heroZone = document.querySelector<HTMLElement>('[data-zone-id="player-hero"]');
    if (!heroZone) return;
    let observer: ResizeObserver | null = null;
    const measure = () => {
      const rect = heroZone.getBoundingClientRect();
      setHudPosition({
        left: rect.left + rect.width / 2,
        top: Math.max(10, rect.top - 10),
        maxWidth: Math.min(window.innerWidth - 24, Math.max(430, rect.width * 2.65)),
      });
    };
    const frame = window.requestAnimationFrame(measure);
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
  }, [experience.active, combatants.length]);

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
      nextStats[view.bakuganId] = `${view.power}:${view.damage}:${view.modifiers.join("|")}`;
      const previous = previousStats.current[view.bakuganId];
      if (previous && previous !== nextStats[view.bakuganId]) changed.add(view.bakuganId);
    }
    previousStats.current = nextStats;
    if (!changed.size) return;
    setPulsingBakugan(changed);
    if (pulseTimer.current != null) window.clearTimeout(pulseTimer.current);
    pulseTimer.current = window.setTimeout(() => setPulsingBakugan(new Set()), 760);
  }, [combatants]);

  useEffect(() => {
    const match = experience.match;
    if (!experience.active || experience.online || !match || match.phase !== "power") {
      previousBatchForPriority.current = match?.batch.map((effect) => effect.id) ?? [];
      return;
    }
    const previousIds = previousBatchForPriority.current;
    const currentIds = match.batch.map((effect) => effect.id);
    const added = match.batch.filter((effect) => !previousIds.includes(effect.id));
    previousBatchForPriority.current = currentIds;
    const playedCard = added.find((effect) => (
      effect.kind === "card" && effect.controllerId === match.priority
    ));
    if (!playedCard) return;

    const key = `${match.version}:${playedCard.id}`;
    if (localCorrectionKey.current === key) return;
    localCorrectionKey.current = key;
    const timeout = window.setTimeout(() => {
      const current = readExperienceState().match;
      if (!current || current.version !== match.version || current.phase !== "power") return;
      const opponent = current.players.find((player) => player.id !== playedCard.controllerId);
      if (!opponent || current.priority !== playedCard.controllerId) return;
      const next = cloneMatch(current);
      next.priority = opponent.id;
      next.passes = [];
      next.version += 1;
      next.deadline = Date.now() + 40_000;
      next.log.push({
        id: `${Date.now()}-priority-${next.version}`,
        at: Date.now(),
        kind: "game",
        message: `${opponent.name} received priority after the batch changed.`,
      });
      publishMatch(next);
    }, 60);
    return () => window.clearTimeout(timeout);
  }, [experience.active, experience.online, experience.match]);

  useEffect(() => {
    const match = experience.match;
    if (!experience.active || experience.online || !match || match.phase !== "power") return;
    const bot = match.players.find((player) => player.id === "training-bot");
    if (!bot || match.priority !== bot.id) return;
    const key = `${match.version}:${bot.id}`;
    if (botActionKey.current === key) return;
    botActionKey.current = key;

    const timeout = window.setTimeout(() => {
      const current = readExperienceState().match;
      if (!current || current.version !== match.version || current.phase !== "power" || current.priority !== bot.id) return;
      try { publishMatch(passPriority(current, bot.id)); }
      catch { botActionKey.current = ""; }
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [experience.active, experience.online, experience.match]);

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
  const combinedBatch = resolvingEffect
    && !batch.some((effect) => effect.id === resolvingEffect.id)
    ? [resolvingEffect, ...batch]
    : batch;
  const batchKey = combinedBatch.map((effect) => effect.id).join("|");
  const hudStyle = hudPosition ? {
    left: hudPosition.left,
    top: hudPosition.top,
    width: `${hudPosition.maxWidth}px`,
  } as CSSProperties : undefined;

  return (
    <>
      {combatants.length === 2 && hudPosition ? (
        <aside
          className={styles.brawlHud}
          style={hudStyle}
          aria-label="Active Brawl statistics, effects, and modifiers"
        >
          <header className={styles.brawlHeader}>
            <span>{phaseName(experience.match.phase)}</span>
            <strong>{status.active ? `PRIORITY • ${priorityName}` : experience.match.stepLabel}</strong>
            <small>{status.active ? `PASSES ${status.consecutivePasses}/2 • BATCH ${status.batchCount}` : "ACTIVE BAKUGAN"}</small>
          </header>
          <div className={styles.combatants}>
            <BrawlCombatant
              view={combatants[0]}
              owner="player"
              pulsing={pulsingBakugan.has(combatants[0].bakuganId)}
            />
            <span className={styles.versus} aria-hidden="true">VS</span>
            <BrawlCombatant
              view={combatants[1]}
              owner="opponent"
              pulsing={pulsingBakugan.has(combatants[1].bakuganId)}
            />
          </div>
        </aside>
      ) : null}

      {combinedBatch.length ? (
        <aside className={styles.batchHud} aria-label={`${combinedBatch.length} effects in the batch`}>
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
                  data-resolving={resolving ? "true" : "false"}
                  style={{ "--batch-order": index } as CSSProperties}
                  title={`${effect.card.displayName || effect.card.name}: ${effect.card.effect}`}
                  key={effect.id}
                >
                  <div className={styles.batchHex}>
                    <span aria-hidden="true">{(effect.card.displayName || effect.card.name).slice(0, 1)}</span>
                    <img src={effect.card.art} alt="" aria-hidden="true" draggable={false} />
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
