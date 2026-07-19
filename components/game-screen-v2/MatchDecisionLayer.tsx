"use client";

import { useEffect, useMemo, useState } from "react";
import {
  discardToHandLimit,
  resolveDamage,
  type MatchState,
} from "../../lib/game";
import {
  MATCH_UPDATE_EVENT,
  writeCoordinatedMatch,
} from "./MatchStateCoordinator";
import styles from "./MatchDecisionLayer.module.css";

const ROUTE_KEY = "bbp-route-v1";
const SETTINGS_KEY = "bbp-settings";
const MATCH_KEY = "bbp-active-match-v1";
const ONLINE_KEY = "bbp-active-match-online-v1";
const PLAYER_KEY = "bbp-player-id";

type DecisionState = {
  active: boolean;
  match: MatchState | null;
  online: boolean;
  playerId?: string;
};

type DecisionHandler = () => void | Promise<void>;
type LocalDecision = (match: MatchState, playerId: string) => MatchState;

function parseValue<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

function readDecisionState(): DecisionState {
  const settings = parseValue<Record<string, unknown>>(localStorage.getItem(SETTINGS_KEY), {});
  const route = parseValue(localStorage.getItem(ROUTE_KEY), "entry");
  return {
    active: Boolean(settings.useNewGameScreen) && route === "match",
    match: parseValue<MatchState | null>(localStorage.getItem(MATCH_KEY), null),
    online: parseValue(localStorage.getItem(ONLINE_KEY), false),
    playerId: parseValue<string | undefined>(localStorage.getItem(PLAYER_KEY), undefined),
  };
}

export function MatchDecisionLayer() {
  const [decision, setDecision] = useState<DecisionState>({
    active: false,
    match: null,
    online: false,
    playerId: undefined,
  });
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let previousRaw = "";
    const update = () => {
      const raw = [
        localStorage.getItem(ROUTE_KEY),
        localStorage.getItem(SETTINGS_KEY),
        localStorage.getItem(MATCH_KEY),
        localStorage.getItem(ONLINE_KEY),
        localStorage.getItem(PLAYER_KEY),
      ].join("\u0000");
      if (raw === previousRaw) return;
      previousRaw = raw;
      setDecision(readDecisionState());
    };
    update();
    const interval = window.setInterval(update, 500);
    window.addEventListener("storage", update);
    window.addEventListener(MATCH_UPDATE_EVENT, update as EventListener);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", update);
      window.removeEventListener(MATCH_UPDATE_EVENT, update as EventListener);
    };
  }, []);

  const match = decision.match;
  const player = match?.players.find((candidate) => candidate.id === decision.playerId)
    ?? match?.players[0];
  const damageDecision = Boolean(
    decision.active
    && match
    && player
    && match.phase === "damage"
    && match.pendingLoser === player.id
    && match.revealedFlip,
  );
  const requiredDiscards = decision.active
    && match
    && player
    && match.phase === "handLimit"
    && match.priority === player.id
    ? Math.max(0, player.hand.length - 7)
    : 0;
  const handSignature = useMemo(
    () => player?.hand.map((card) => card.id).join("|") ?? "",
    [player?.hand],
  );

  useEffect(() => {
    setSelectedCardIds([]);
    setError("");
  }, [match?.phase, match?.version, handSignature]);

  if (!decision.active || !match || !player || (!damageDecision && requiredDiscards <= 0)) return null;

  const submit = async (
    action: "damage" | "hand-limit",
    payload: Record<string, unknown>,
    localDecision: LocalDecision,
  ) => {
    const current = readDecisionState();
    const currentMatch = current.match;
    const actorId = current.playerId ?? currentMatch?.players[0]?.id;
    if (!currentMatch || !actorId) throw new Error("No active match is available.");

    if (!current.online) {
      if (!writeCoordinatedMatch(localDecision(currentMatch, actorId))) {
        throw new Error("The match changed before the decision was applied.");
      }
      return;
    }

    const response = await fetch("/api/game", {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        code: currentMatch.code,
        playerId: actorId,
        expectedVersion: currentMatch.version,
        payload,
      }),
    });
    const data = await response.json() as { state?: MatchState; error?: string };
    if (data.state) writeCoordinatedMatch(data.state);
    if (!response.ok) throw new Error(data.error ?? "The match decision could not be completed.");
  };

  const run = async (handler: DecisionHandler) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await handler();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The decision could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  if (damageDecision && match.revealedFlip) {
    const flip = match.revealedFlip;
    const printedCost = typeof flip.cost === "number" ? flip.cost : 0;
    const frostStrike = match.damageOrigin
      ? match.frostStrike[match.damageOrigin] ?? 0
      : 0;
    const effectiveCost = printedCost + frostStrike;
    const affordable = effectiveCost <= player.energy;
    const resolveFlip = (cardId?: string) => submit(
      "damage",
      cardId ? { cardId } : {},
      (state, actorId) => resolveDamage(state, actorId, cardId),
    );
    return (
      <div className={styles.backdrop} role="presentation">
        <section
          className={styles.dialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="experimental-flip-title"
        >
          <header className={styles.header}>
            <small>DAMAGE STEP • REVEALED FLIP</small>
            <h2 id="experimental-flip-title">Choose whether to play the Flip</h2>
            <p>The Damage Step cannot continue until this revealed card is played or declined.</p>
          </header>
          <div className={styles.flipLayout}>
            <img className={styles.flipArt} src={flip.art} alt={flip.displayName || flip.name} draggable={false} />
            <div className={styles.flipCopy}>
              <strong>{flip.displayName || flip.name}</strong>
              <p>{flip.effect || "No printed effect."}</p>
              <div className={styles.metrics}>
                <span>{match.pendingDamage} damage remaining</span>
                <span>{effectiveCost} Energy to play</span>
                <span>{player.energy} Energy available</span>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.action}
                  disabled={busy || !affordable}
                  onClick={() => void run(() => resolveFlip(flip.id))}
                >
                  {affordable ? "Play Flip" : "Not Enough Energy"}
                </button>
                <button
                  type="button"
                  className={`${styles.action} ${styles.actionSecondary}`}
                  disabled={busy}
                  onClick={() => void run(() => resolveFlip())}
                >
                  Decline • Continue Damage
                </button>
              </div>
              {error ? <p className={styles.error} role="alert">{error}</p> : null}
            </div>
          </div>
        </section>
      </div>
    );
  }

  const selected = new Set(selectedCardIds);
  const toggleCard = (cardId: string) => {
    if (busy) return;
    setSelectedCardIds((current) => {
      if (current.includes(cardId)) return current.filter((candidate) => candidate !== cardId);
      return current.length < requiredDiscards ? [...current, cardId] : current;
    });
  };
  const confirmDiscard = () => submit(
    "hand-limit",
    { cardIds: selectedCardIds },
    (state, actorId) => discardToHandLimit(state, actorId, selectedCardIds),
  );

  return (
    <div className={styles.backdrop} role="presentation">
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="experimental-hand-limit-title"
      >
        <header className={styles.header}>
          <small>END PHASE • HAND LIMIT</small>
          <h2 id="experimental-hand-limit-title">Discard to seven cards</h2>
          <p>Select exactly {requiredDiscards} card{requiredDiscards === 1 ? "" : "s"}. The turn advances after the discard is confirmed.</p>
        </header>
        <ul className={styles.cards} aria-label="Cards available to discard">
          {player.hand.map((card) => {
            const isSelected = selected.has(card.id);
            return (
              <li key={card.id}>
                <button
                  type="button"
                  className={styles.cardButton}
                  data-selected={isSelected ? "true" : "false"}
                  aria-pressed={isSelected}
                  disabled={busy || (!isSelected && selectedCardIds.length >= requiredDiscards)}
                  onClick={() => toggleCard(card.id)}
                >
                  <img src={card.art} alt="" aria-hidden="true" draggable={false} />
                  <strong>{card.displayName || card.name}</strong>
                  <span>{isSelected ? "Selected" : "Keep"}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.action}
            disabled={busy || selectedCardIds.length !== requiredDiscards}
            onClick={() => void run(confirmDiscard)}
          >
            Discard {selectedCardIds.length}/{requiredDiscards}
          </button>
        </div>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </section>
    </div>
  );
}
