"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";
import { submitCardChoice, type CardChoices, type MatchState } from "../../lib/game";
import type { ChoiceField, ChoiceOption } from "../../lib/rules/choices";
import { writeCoordinatedMatch } from "./MatchStateCoordinator";
import { readMatchStore, useMatchSelector } from "./matchStore";
import { ResponsiveCardImage } from "./ResponsiveCardImage";
import styles from "./DeckInspectionLayer.module.css";

async function submitChoiceCommand(answers: CardChoices) {
  const current = readMatchStore();
  const match = current.match;
  const playerId = current.playerId ?? match?.players[0]?.id;
  if (!match || !playerId) throw new Error("No active match is available.");
  if (!current.online) {
    writeCoordinatedMatch(submitCardChoice(match, playerId, answers));
    return;
  }
  const response = await fetch("/api/game", {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(current.capability ? { "x-match-capability": current.capability } : {}),
    },
    body: JSON.stringify({
      action: "choice",
      code: match.code,
      playerId,
      expectedVersion: match.version,
      payload: { choices: answers },
    }),
  });
  const data = await response.json() as { state?: MatchState; error?: string };
  if (data.state) writeCoordinatedMatch(data.state);
  if (!response.ok) throw new Error(data.error ?? "The deck choice could not be recorded.");
}

function isTopDeckField(field: ChoiceField) {
  return field.kind === "deck-order" && /\btop\s+\d+\s+cards?\b/i.test(field.label);
}

function cardOptionById(options: readonly ChoiceOption[], id: string) {
  return options.find((option) => option.id === id);
}

function moveValue(values: readonly string[], sourceId: string, targetId: string) {
  const source = values.indexOf(sourceId);
  const target = values.indexOf(targetId);
  if (source < 0 || target < 0 || source === target) return [...values];
  const next = [...values];
  const [moved] = next.splice(source, 1);
  next.splice(target, 0, moved);
  return next;
}

function moveBy(values: readonly string[], index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= values.length) return [...values];
  const next = [...values];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function DeckInspectionLayer() {
  const snapshot = useMatchSelector((state) => state);
  const match = snapshot.match;
  const playerId = snapshot.playerId ?? match?.players[0]?.id;
  const pending = match?.pendingChoice;
  const deckField = useMemo(() => pending?.schema.fields.find((field) => (
    isTopDeckField(field)
    && field.options.some((option) => Boolean(option.card))
    && (field.visibility === "public" || field.chooserId === playerId)
  )), [pending, playerId]);
  const selectionField = useMemo(() => pending?.schema.fields.find((field) => (
    field.id === "deckCardId"
    && field.chooserId === deckField?.chooserId
    && /\btop\s+\d+\s+cards?\b/i.test(field.label)
  )), [deckField, pending]);
  const confirmationField = useMemo(() => pending?.schema.fields.find((field) => (
    field.id === "confirmed" && field.chooserId === deckField?.chooserId
  )), [deckField, pending]);
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draggingId, setDraggingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setOrderedIds(deckField?.options.map((option) => option.id) ?? []);
    setSelectedId("");
    setDraggingId("");
    setBusy(false);
    setError("");
  }, [pending?.id, deckField?.id]);

  if (snapshot.route !== "match" || !match || !playerId || !pending || !deckField) return null;

  const mode = deckField.visibility === "public" ? "reveal" : "look";
  const allowReorder = /^Order\b/i.test(deckField.label);
  const isChooser = deckField.chooserId === playerId;
  const chooser = match.players.find((player) => player.id === deckField.chooserId);
  const orderedOptions = orderedIds
    .map((id) => cardOptionById(deckField.options, id))
    .filter((option): option is ChoiceOption => Boolean(option?.card));
  const selectionRequired = Boolean(selectionField && selectionField.minimum > 0);
  const orderComplete = orderedIds.length >= deckField.minimum
    && orderedIds.length <= deckField.maximum;
  const canConfirm = orderComplete && (!selectionRequired || Boolean(selectedId));

  const submit = async (confirmed: boolean) => {
    if (!isChooser || busy || (confirmed && !canConfirm)) return;
    // Selection-based effects consume the selected card first while preserving
    // the visible relative order of every remaining inspected card.
    const resolvedOrder = selectionField && selectedId
      ? [selectedId, ...orderedIds.filter((id) => id !== selectedId)]
      : orderedIds;
    const answers: CardChoices = confirmationField && !confirmed
      ? { confirmed: false }
      : {
        orderedCardIds: resolvedOrder,
        ...(selectionField && selectedId ? { deckCardId: selectedId } : {}),
        ...(confirmationField ? { confirmed: true } : {}),
      };
    setBusy(true);
    setError("");
    try {
      await submitChoiceCommand(answers);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The deck choice could not be completed.");
      setBusy(false);
    }
  };

  const dropCard = (event: DragEvent<HTMLElement>, targetId: string) => {
    if (!allowReorder || !isChooser || busy) return;
    event.preventDefault();
    const sourceId = event.dataTransfer.getData("text/plain") || draggingId;
    setOrderedIds((current) => moveValue(current, sourceId, targetId));
    setDraggingId("");
  };

  return (
    <div className={`${styles.backdrop} ${mode === "reveal" ? styles.revealBackdrop : ""}`}>
      <section
        className={`${styles.panel} ${mode === "reveal" ? styles.revealPanel : ""}`}
        role="dialog"
        aria-modal={mode === "look" ? "true" : undefined}
        aria-labelledby="deck-inspection-title"
        data-deck-inspection-mode={mode}
        data-deck-reorder={allowReorder ? "true" : "false"}
        data-deck-selection={selectionField ? "true" : "false"}
      >
        <header className={styles.header}>
          <div>
            <small>{mode === "reveal" ? "PUBLIC DECK REVEAL" : "PRIVATE DECK VIEW"}</small>
            <h2 id="deck-inspection-title">{deckField.label}</h2>
            <p>{mode === "reveal"
              ? `${chooser?.name ?? "A player"} revealed these cards to both players.`
              : allowReorder
                ? "Drag the cards, or use the arrow controls, to set the new top-to-bottom order."
                : "Only you can see these cards. Their order cannot be changed by this effect."}</p>
          </div>
          <strong className={styles.source}>{pending.schema.sourceName}</strong>
        </header>

        <ol className={styles.cards} aria-label="Top cards of the deck, first card is on top">
          {orderedOptions.map((option, index) => {
            const card = option.card!;
            const selected = selectedId === option.id;
            const selectable = Boolean(selectionField && isChooser && !busy);
            return (
              <li
                className={styles.card}
                data-card-id={option.id}
                data-selected={selected ? "true" : "false"}
                data-draggable={allowReorder && isChooser && !busy ? "true" : "false"}
                data-dragging={draggingId === option.id ? "true" : "false"}
                draggable={allowReorder && isChooser && !busy}
                onDragStart={(event) => {
                  if (!allowReorder || !isChooser || busy) return;
                  setDraggingId(option.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", option.id);
                }}
                onDragEnd={() => setDraggingId("")}
                onDragOver={(event) => {
                  if (allowReorder && isChooser && !busy) event.preventDefault();
                }}
                onDrop={(event) => dropCard(event, option.id)}
                key={option.id}
              >
                <span className={styles.position} aria-label={`Deck position ${index + 1}`}>{index + 1}</span>
                <button
                  type="button"
                  className={styles.cardButton}
                  data-selectable={selectable ? "true" : "false"}
                  aria-disabled={selectable ? undefined : "true"}
                  aria-pressed={selectionField ? selected : undefined}
                  aria-label={`${card.displayName || card.name}, deck position ${index + 1}${selectable ? ", select this card" : ""}`}
                  tabIndex={selectable ? 0 : -1}
                  onClick={() => {
                    if (selectable) setSelectedId((current) => current === option.id && !selectionRequired ? "" : option.id);
                  }}
                >
                  <ResponsiveCardImage
                    src={card.art}
                    alt={card.displayName || card.name}
                    draggable={false}
                  />
                  <span className={styles.cardCaption}>
                    <strong>{card.displayName || card.name}</strong>
                    <span>{card.faction} • {card.type} • {card.cost === "X" ? "X" : card.cost} Energy</span>
                  </span>
                </button>
                {allowReorder && isChooser ? (
                  <div className={styles.moveControls} aria-label={`Move ${card.displayName || card.name}`}>
                    <button type="button" disabled={busy || index === 0} onClick={() => setOrderedIds((current) => moveBy(current, index, -1))} aria-label="Move toward top">←</button>
                    <button type="button" disabled={busy || index === orderedOptions.length - 1} onClick={() => setOrderedIds((current) => moveBy(current, index, 1))} aria-label="Move toward bottom">→</button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>

        <footer className={styles.footer}>
          <span className={styles.status}>{isChooser
            ? selectionField
              ? selectionRequired ? "Select a card before confirming" : "Card selection is optional"
              : allowReorder ? "Leftmost card will be on top" : "Confirm to continue resolving"
            : `Waiting for ${chooser?.name ?? "the chooser"} to resolve this effect`}</span>
          {isChooser && confirmationField ? (
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => void submit(false)}>Do not use</button>
          ) : null}
          {isChooser ? (
            <button type="button" disabled={busy || !canConfirm} onClick={() => void submit(true)}>
              {busy ? "Resolving…" : allowReorder ? "Confirm order" : selectionField ? "Confirm selection" : "Continue"}
            </button>
          ) : null}
        </footer>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </section>
    </div>
  );
}
