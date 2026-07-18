"use client";

import { useEffect, useState } from "react";
import type { CardChoices, MatchState, PlayerState } from "../../lib/game";
import {
  cardRequiresSelection,
  compactMatchHudSlots,
  defaultCardChoices,
  handCardIsActionable,
  matchRoundTarget,
  playableHandCards,
  resolveHudPlayers,
  visibleMatchHudActions,
  type HandActionMode,
  type MatchHudActionKey,
} from "./matchHudState";
import styles from "./MatchHudLayer.module.css";

type MatchActionHandler = () => void | Promise<void>;
type PlayCardHandler = (cardId: string, choices: CardChoices) => void | Promise<void>;
type EnergizeCardHandler = (cardId: string) => void | Promise<void>;

function PlayerStatusHud({
  match,
  player,
  position,
}: {
  match: MatchState;
  player: PlayerState;
  position: "player" | "opponent";
}) {
  const hasPriority = match.priority === player.id;
  const target = matchRoundTarget(match);
  const wins = match.series[player.id] ?? 0;
  const multipleRounds = match.format === "bo3";

  return (
    <section
      className={`${styles.playerHud} ${position === "player" ? styles.localPlayerHud : styles.opponentPlayerHud}`}
      data-priority={hasPriority ? "true" : "false"}
      data-multiple-rounds={multipleRounds ? "true" : "false"}
      aria-label={`${position === "player" ? "Your" : "Opponent"} player details: ${player.name}${hasPriority ? ", has priority" : ""}`}
    >
      <div className={styles.playerCopy}>
        <small>{position === "player" ? "PLAYER" : "OPPONENT"}</small>
        <strong>{player.name}</strong>
        <span>{player.connected ? "CONNECTED" : "RECONNECTING"}</span>
      </div>
      <div
        className={styles.roundWins}
        data-visible={multipleRounds ? "true" : "false"}
        aria-hidden={!multipleRounds}
      >
        <span>ROUNDS WON</span>
        <strong>{wins}/{target}</strong>
      </div>
      <span
        className={styles.priorityIcon}
        data-active={hasPriority ? "true" : "false"}
        aria-label={hasPriority ? "Priority active" : "Priority inactive"}
        title={hasPriority ? "This player has priority" : "This player does not have priority"}
      >
        ◆
      </span>
    </section>
  );
}

function ActionButton({
  action,
  label,
  active = false,
  busy,
  onClick,
}: {
  action: MatchHudActionKey;
  label: string;
  active?: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.actionButton}
      data-action={action}
      data-active={active ? "true" : "false"}
      disabled={busy}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function MatchHudLayer({
  match,
  playerId,
  handMode,
  selectedHandCardId,
  onHandModeChange,
  onSelectedHandCardChange,
  onPlayCard,
  onEnergizeCard,
  onPassTurn,
}: {
  match: MatchState | null;
  playerId?: string;
  handMode: HandActionMode;
  selectedHandCardId: string;
  onHandModeChange: (mode: HandActionMode) => void;
  onSelectedHandCardChange: (cardId: string) => void;
  onPlayCard: PlayCardHandler;
  onEnergizeCard: EnergizeCardHandler;
  onPassTurn: MatchActionHandler;
}) {
  const [selectionPending, setSelectionPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { player, opponent } = resolveHudPlayers(match, playerId);

  useEffect(() => {
    setSelectionPending(false);
    setError("");
  }, [match?.phase, match?.version, selectedHandCardId]);

  if (!match || !player || !opponent) return null;

  const playable = playableHandCards(match, player.id);
  const selectedCard = player.hand.find((card) => card.id === selectedHandCardId);
  const actions = visibleMatchHudActions({
    match,
    playerId: player.id,
    mode: handMode,
    selectedCardId: selectedHandCardId,
    selectionPending,
  });
  const actionSlots = compactMatchHudSlots(actions);

  const run = async (handler: MatchActionHandler) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await handler();
      onHandModeChange(null);
      onSelectedHandCardChange("");
      setSelectionPending(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The action could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const chooseMode = (mode: Exclude<HandActionMode, null>) => {
    if (handMode === mode) return false;
    onHandModeChange(mode);
    onSelectedHandCardChange("");
    setSelectionPending(false);
    setError("");
    return true;
  };

  const playSelectedCard = () => {
    if (chooseMode("play")) return;
    const card = selectedCard && playable.some((candidate) => candidate.id === selectedCard.id)
      ? selectedCard
      : null;
    if (!card) {
      setError("Choose a highlighted card from your hand, then press Play Card again.");
      return;
    }
    if (cardRequiresSelection(match, player.id, card.id)) {
      setSelectionPending(true);
      setError("");
      return;
    }
    void run(() => onPlayCard(card.id, {}));
  };

  const energizeSelectedCard = () => {
    if (chooseMode("energize")) return;
    if (!selectedCard || !handCardIsActionable(match, player.id, selectedCard, "energize")) {
      setError("Choose a highlighted card from your hand, then press Energize Card again.");
      return;
    }
    void run(() => onEnergizeCard(selectedCard.id));
  };

  const confirmSelection = () => {
    if (!selectedCard || !selectionPending) return;
    const choices = defaultCardChoices(match, player.id, selectedCard);
    void run(() => onPlayCard(selectedCard.id, choices));
  };

  const actionConfig: Record<MatchHudActionKey, {
    label: string;
    active: boolean;
    onClick: () => void;
  }> = {
    "play-card": {
      label: "Play Card",
      active: handMode === "play" && !selectionPending,
      onClick: playSelectedCard,
    },
    "energize-card": {
      label: "Energize Card",
      active: handMode === "energize",
      onClick: energizeSelectedCard,
    },
    "pass-turn": {
      label: "Pass Turn",
      active: false,
      onClick: () => void run(onPassTurn),
    },
    select: {
      label: "Select",
      active: selectionPending,
      onClick: confirmSelection,
    },
  };

  return (
    <>
      <PlayerStatusHud match={match} player={opponent} position="opponent" />
      <PlayerStatusHud match={match} player={player} position="player" />

      <section className={styles.actionHud} aria-label="Available player actions">
        <header>
          <span>ACTIONS</span>
        </header>
        <div className={styles.actionGrid}>
          {actionSlots.map((action, slotIndex) => (
            <div
              className={styles.actionSlot}
              data-filled={action ? "true" : "false"}
              data-slot={slotIndex === 0 ? "primary" : "pass"}
              key={slotIndex}
            >
              {action ? (
                <ActionButton
                  action={action}
                  label={actionConfig[action].label}
                  active={actionConfig[action].active}
                  busy={busy}
                  onClick={actionConfig[action].onClick}
                />
              ) : null}
            </div>
          ))}
        </div>
        {error ? <p className={styles.visuallyHidden} role="alert">{error}</p> : null}
      </section>
    </>
  );
}
