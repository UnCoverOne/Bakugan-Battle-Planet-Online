"use client";

import { useEffect, useState } from "react";
import { cardChoiceSpec, type CardChoices, type MatchState, type PlayerState } from "../../lib/game";
import { cardEnergyPaymentState } from "../../lib/cardPayment";
import { legalEvoTargets, selectedEvoTargetId } from "../../lib/evo";
import { drawStepIsPending } from "../../lib/turnStart";
import {
  compactMatchHudSlots,
  handDiscardRequirement,
  handCardIsActionable,
  matchRoundTarget,
  playableHandCards,
  resolvedHandActionMode,
  resolveHudPlayers,
  visibleMatchHudActions,
  type HandActionMode,
  type MatchHudActionKey,
} from "./matchHudState";
import { characterSelectionCanConfirm } from "./selectionState";
import { useBoardChoiceHud } from "./boardChoiceHud";
import { CardChoiceEditor } from "./CardChoiceEditor";
import styles from "./MatchHudLayer.module.css";
import shapeStyles from "./PlayerHudShape.module.css";

type MatchActionHandler = () => void | Promise<void>;
type PlayCardHandler = (cardId: string, choices: CardChoices) => void | Promise<void>;
type EnergizeCardHandler = (cardId: string) => void | Promise<void>;
type SelectCharacterHandler = (bakuganId: string) => void | Promise<void>;
type DiscardCardsHandler = (cardIds: string[]) => void | Promise<void>;

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
      className={`${styles.playerHud} ${position === "player" ? styles.localPlayerHud : styles.opponentPlayerHud} ${position === "opponent" ? shapeStyles.opponentShape : ""}`}
      data-priority={hasPriority ? "true" : "false"}
      data-multiple-rounds={multipleRounds ? "true" : "false"}
      aria-label={`${position === "player" ? "Your" : "Opponent"} player details: ${player.name}${hasPriority ? ", has priority" : ""}`}
    >
      <div className={styles.playerCopy}>
        <small>{position === "player" ? "PLAYER" : "OPPONENT"}</small>
        <strong title={player.name}>{player.name}</strong>
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
  disabled = false,
  onClick,
}: {
  action: string;
  label: string;
  active?: boolean;
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.actionButton}
      data-action={action}
      data-active={active ? "true" : "false"}
      disabled={busy || disabled}
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
  selectedDiscardCardIds,
  selectedCharacterId,
  onHandModeChange,
  onSelectedHandCardChange,
  onSelectedDiscardCardsChange,
  onSelectedCharacterChange,
  onDrawCard,
  onFlipTieBreakCard,
  onActivateReroll,
  onPlayCard,
  onEnergizeCard,
  onDiscardCards,
  onSkipEnergize,
  onPassTurn,
  onPlayFlip,
  onSkipFlip,
  onSelectCharacter,
  onExit,
}: {
  match: MatchState | null;
  playerId?: string;
  handMode: HandActionMode;
  selectedHandCardId: string;
  selectedDiscardCardIds: string[];
  selectedCharacterId: string;
  onHandModeChange: (mode: HandActionMode) => void;
  onSelectedHandCardChange: (cardId: string) => void;
  onSelectedDiscardCardsChange: (cardIds: string[]) => void;
  onSelectedCharacterChange: (bakuganId: string) => void;
  onDrawCard: MatchActionHandler;
  onFlipTieBreakCard: MatchActionHandler;
  onActivateReroll: MatchActionHandler;
  onPlayCard: PlayCardHandler;
  onEnergizeCard: EnergizeCardHandler;
  onDiscardCards: DiscardCardsHandler;
  onSkipEnergize: MatchActionHandler;
  onPassTurn: MatchActionHandler;
  onPlayFlip: PlayCardHandler;
  onSkipFlip: MatchActionHandler;
  onSelectCharacter: SelectCharacterHandler;
  onExit: MatchActionHandler;
}) {
  const [selectionPending, setSelectionPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flipChoiceOpen, setFlipChoiceOpen] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const boardChoice = useBoardChoiceHud();
  const { player, opponent } = resolveHudPlayers(match, playerId);

  useEffect(() => {
    setSelectionPending(false);
    setFlipChoiceOpen(false);
    setError("");
  }, [match?.phase, match?.version, selectedHandCardId]);

  useEffect(() => {
    if (!drawStepIsPending(match)) return;
    const update = () => setNow(Date.now());
    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [match?.phase, match?.version]);

  if (!match || !player || !opponent) return null;

  const effectiveHandMode = resolvedHandActionMode(match, player.id, handMode);
  const playable = playableHandCards(match, player.id);
  const selectedCard = player.hand.find((card) => card.id === selectedHandCardId);
  const discardRequirement = handDiscardRequirement(match, player.id);
  const baseActions = visibleMatchHudActions({
    match,
    playerId: player.id,
    mode: effectiveHandMode,
    selectedCardId: selectedHandCardId,
    selectionPending,
    now,
  });
  const characterSelectionReady = characterSelectionCanConfirm(
    match,
    player.id,
    selectedCharacterId,
  );
  const actions = {
    ...baseActions,
    select: baseActions.select || characterSelectionReady,
  };
  const activeBoardChoice = boardChoice
    && boardChoice.matchId === match.id
    && boardChoice.playerId === player.id
    ? boardChoice
    : null;
  const actionSlots = activeBoardChoice
    ? [activeBoardChoice.canCancel ? "cancel-choice" as const : null, "confirm-choice" as const]
    : compactMatchHudSlots(actions);
  const displayedError = activeBoardChoice?.error || error;

  const run = async (handler: MatchActionHandler) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await handler();
      onHandModeChange(null);
      onSelectedHandCardChange("");
      onSelectedDiscardCardsChange([]);
      onSelectedCharacterChange("");
      setSelectionPending(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The action could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const playSelectedCard = () => {
    const card = selectedCard && playable.some((candidate) => candidate.id === selectedCard.id)
      ? selectedCard
      : null;
    if (!card) {
      setError("Select a highlighted card from your hand, then press Play Card.");
      return;
    }

    if (card.type === "Evo") {
      const targetId = selectedEvoTargetId();
      const target = legalEvoTargets(match, player.id, card)
        .find((candidate) => candidate.id === targetId);
      if (!target) {
        setError(`Select your matching ${card.evolvesFrom ?? "Bakugan"} Character Card, then press Play Card.`);
        return;
      }
      void run(() => onPlayCard(card.id, { targetBakuganId: target.id }));
      return;
    }

    // The authoritative choice queue owns every required selection. Preparing
    // the play does not spend Energy or move the card until all choosers lock
    // valid answers.
    void run(() => onPlayCard(card.id, {}));
  };

  const energizeSelectedCard = () => {
    if (handMode !== "energize") onHandModeChange("energize");
    setSelectionPending(false);
    if (!selectedCard || !handCardIsActionable(match, player.id, selectedCard, "energize")) {
      setError("Choose a highlighted card from your hand, then press Energize Card.");
      return;
    }
    void run(() => onEnergizeCard(selectedCard.id));
  };

  const discardSelectedCards = () => {
    if (!discardRequirement) return;
    const legalIds = selectedDiscardCardIds.filter((id) => discardRequirement.optionIds.includes(id));
    if (legalIds.length < discardRequirement.minimum || legalIds.length > discardRequirement.maximum) {
      const expected = discardRequirement.minimum === discardRequirement.maximum
        ? `exactly ${discardRequirement.minimum}`
        : `${discardRequirement.minimum}–${discardRequirement.maximum}`;
      setError(`Select ${expected} card${discardRequirement.maximum === 1 ? "" : "s"} from your hand, then press Discard.`);
      return;
    }
    void run(() => onDiscardCards(legalIds));
  };

  const confirmSelection = () => {
    if (characterSelectionReady) {
      void run(() => onSelectCharacter(selectedCharacterId));
      return;
    }
    if (!selectedCard || !selectionPending) return;
  };

  const playRevealedFlip = () => {
    const flip = match.revealedFlip;
    if (!flip) return;
    if (flip.catalogId === "bb-152") {
      void run(() => onPlayFlip(flip.id, {}));
      return;
    }
    if (cardChoiceSpec(match, player.id, flip).length) {
      setFlipChoiceOpen(true);
      return;
    }
    const choices: CardChoices = {};
    const payment = cardEnergyPaymentState(match, player.id, flip, choices);
    if (payment?.kind === "insufficient") {
      setError(`Not enough Energy. ${payment.cost} required, ${payment.totalEnergy} available.`);
      return;
    }
    void run(() => onPlayFlip(flip.id, choices));
  };

  const confirmFlipChoices = (choices: CardChoices) => {
    const flip = match.revealedFlip;
    if (!flip) return;
    const payment = cardEnergyPaymentState(match, player.id, flip, choices);
    if (payment?.kind === "insufficient") {
      setError(`Not enough Energy. ${payment.cost} required, ${payment.totalEnergy} available.`);
      return;
    }
    setFlipChoiceOpen(false);
    void run(() => onPlayFlip(flip.id, choices));
  };

  const actionConfig: Record<MatchHudActionKey, {
    label: string;
    active: boolean;
    onClick: () => void;
  }> = {
    exit: {
      label: "Exit",
      active: true,
      onClick: () => void run(onExit),
    },
    "draw-card": {
      label: "Draw",
      active: false,
      onClick: () => void run(onDrawCard),
    },
    "flip-tie-break": {
      label: "Flip Top Card",
      active: true,
      onClick: () => void run(onFlipTieBreakCard),
    },
    "activate-reroll": {
      label: "Reroll",
      active: true,
      onClick: () => void run(onActivateReroll),
    },
    discard: {
      label: discardRequirement
        ? `Discard ${selectedDiscardCardIds.length}/${discardRequirement.maximum}`
        : "Discard",
      active: Boolean(discardRequirement
        && selectedDiscardCardIds.length >= discardRequirement.minimum
        && selectedDiscardCardIds.length <= discardRequirement.maximum),
      onClick: discardSelectedCards,
    },
    "play-card": {
      label: "Play Card",
      active: effectiveHandMode === "play" && !selectionPending,
      onClick: playSelectedCard,
    },
    "energize-card": {
      label: "Energize Card",
      active: effectiveHandMode === "energize",
      onClick: energizeSelectedCard,
    },
    "skip-energize": {
      label: "Skip Energizing",
      active: false,
      onClick: () => void run(onSkipEnergize),
    },
    "pass-turn": {
      label: "Pass Turn",
      active: false,
      onClick: () => void run(onPassTurn),
    },
    "play-flip": {
      label: "Play",
      active: true,
      onClick: playRevealedFlip,
    },
    "skip-flip": {
      label: "Skip",
      active: false,
      onClick: () => void run(onSkipFlip),
    },
    select: {
      label: "Select",
      active: selectionPending || characterSelectionReady,
      onClick: confirmSelection,
    },
  };

  return (
    <>
      <PlayerStatusHud match={match} player={opponent} position="opponent" />
      <PlayerStatusHud match={match} player={player} position="player" />

      <section className={styles.actionHud} data-slots={actionSlots.length} aria-label="Available player actions">
        <header>
          <span>ACTIONS</span>
        </header>
        <div className={styles.actionGrid} data-slots={actionSlots.length}>
          {actionSlots.map((action, slotIndex) => (
            <div
              className={styles.actionSlot}
              data-filled={action ? "true" : "false"}
              data-slot={slotIndex === 0 ? "primary" : slotIndex === 1 ? "secondary" : "pass"}
              key={slotIndex}
            >
              {action === "cancel-choice" ? (
                <ActionButton
                  action={action}
                  label="Cancel Card"
                  active={false}
                  busy={activeBoardChoice?.busy ?? false}
                  onClick={() => activeBoardChoice?.cancel()}
                />
              ) : action === "confirm-choice" ? (
                <ActionButton
                  action={action}
                  label={activeBoardChoice?.busy ? "Locking…" : "Confirm Target"}
                  active={Boolean(activeBoardChoice?.canConfirm)}
                  busy={activeBoardChoice?.busy ?? false}
                  disabled={!activeBoardChoice?.canConfirm}
                  onClick={() => activeBoardChoice?.confirm()}
                />
              ) : action ? (
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
      </section>

      {displayedError ? (
        <div className={styles.errorPopup} role="alertdialog" aria-modal="true" aria-label="Action unavailable">
          <div>
            <strong>Action unavailable</strong>
            <p>{displayedError}</p>
          </div>
          <button
            type="button"
            onClick={() => activeBoardChoice?.error ? activeBoardChoice.clearError() : setError("")}
            aria-label="Close message"
          >×</button>
        </div>
      ) : null}
      {flipChoiceOpen && match.revealedFlip ? (
        <CardChoiceEditor
          match={match}
          playerId={player.id}
          card={match.revealedFlip}
          title={`Play ${match.revealedFlip.displayName || match.revealedFlip.name}`}
          onCancel={() => setFlipChoiceOpen(false)}
          onSubmit={confirmFlipChoices}
        />
      ) : null}
    </>
  );
}
