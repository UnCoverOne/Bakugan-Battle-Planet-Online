"use client";

import { useEffect, useState } from "react";
import type { CardChoices, MatchState, PlayerState } from "../../lib/game";
import {
  cardRequiresSelection,
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

function profileArt(match: MatchState, player: PlayerState) {
  const selectedId = match.selected[player.id];
  return player.bakugan.find((bakugan) => bakugan.id === selectedId)?.art
    ?? player.bakugan[0]?.art
    ?? "/assets/card-back.png";
}

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
  const faction = player.bakugan[0]?.faction ?? "Pyrus";

  return (
    <section
      className={`${styles.playerHud} ${position === "player" ? styles.localPlayerHud : styles.opponentPlayerHud}`}
      data-priority={hasPriority ? "true" : "false"}
      aria-label={`${position === "player" ? "Your" : "Opponent"} player details: ${player.name}${hasPriority ? ", has priority" : ""}`}
    >
      <div className={styles.profileIcon}>
        <img src={profileArt(match, player)} alt="" draggable={false} />
        <span className={styles.factionMark} aria-label={`${faction} faction`}>{faction.slice(0, 1)}</span>
      </div>
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
  visible,
  active = false,
  busy,
  onClick,
}: {
  action: MatchHudActionKey;
  label: string;
  visible: boolean;
  active?: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.actionButton}
      data-action={action}
      data-visible={visible ? "true" : "false"}
      data-active={active ? "true" : "false"}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      disabled={!visible || busy}
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

  const instruction = error
    || (handMode === "play"
      ? selectedCard
        ? selectionPending
          ? `Confirm the selections for ${selectedCard.displayName || selectedCard.name}.`
          : `Press Play Card again to play ${selectedCard.displayName || selectedCard.name}.`
        : "Choose a highlighted card from your hand."
      : handMode === "energize"
        ? selectedCard
          ? `Press Energize Card again to Energize ${selectedCard.displayName || selectedCard.name}.`
          : "Choose a highlighted card from your hand."
        : "Available actions update with the current game state.");

  return (
    <>
      <PlayerStatusHud match={match} player={opponent} position="opponent" />
      <PlayerStatusHud match={match} player={player} position="player" />

      <section className={styles.actionHud} aria-label="Available player actions">
        <header>
          <span>ACTIONS</span>
          <small>{match.stepLabel}</small>
        </header>
        <div className={styles.actionGrid}>
          <ActionButton
            action="play-card"
            label="Play Card"
            visible={actions["play-card"]}
            active={handMode === "play"}
            busy={busy}
            onClick={playSelectedCard}
          />
          <ActionButton
            action="energize-card"
            label="Energize Card"
            visible={actions["energize-card"]}
            active={handMode === "energize"}
            busy={busy}
            onClick={energizeSelectedCard}
          />
          <ActionButton
            action="pass-turn"
            label="Pass Turn"
            visible={actions["pass-turn"]}
            busy={busy}
            onClick={() => void run(onPassTurn)}
          />
          <ActionButton
            action="select"
            label="Select"
            visible={actions.select}
            active={selectionPending}
            busy={busy}
            onClick={confirmSelection}
          />
        </div>
        <p data-error={error ? "true" : "false"}>{instruction}</p>
      </section>
    </>
  );
}
