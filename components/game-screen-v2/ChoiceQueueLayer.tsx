"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cancelCardChoice, orderTriggers, submitCardChoice, type CardChoices, type MatchState } from "../../lib/game";
import type { ChoiceField, ChoiceKind } from "../../lib/rules/choices";
import { writeCoordinatedMatch } from "./MatchStateCoordinator";
import { readMatchStore, useMatchSelector } from "./matchStore";
import styles from "./ChoiceQueueLayer.module.css";

const BOARD_TARGET_KINDS = new Set<ChoiceKind>(["batch-object", "hero", "evo", "energy", "bakugan", "core", "card"]);

function valuesFor(answers: CardChoices, field: ChoiceField) {
  const value = answers[field.id];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "boolean") return [value ? "yes" : "no"];
  if (value == null) return [];
  return [String(value)];
}

function assign(answers: CardChoices, field: ChoiceField, values: string[]) {
  const next = { ...answers };
  if (["discardCardIds", "handCardIds", "targetEnergyIds", "orderedCardIds"].includes(field.id)) Object.assign(next, { [field.id]: values });
  else if (field.id === "xValue") next.xValue = Number(values[0] ?? 0);
  else if (field.id === "confirmed") next.confirmed = values[0] === "yes";
  else Object.assign(next, { [field.id]: values[0] });
  return next;
}

function isTopDeckField(field: ChoiceField) {
  return field.kind === "deck-order"
    && /\btop\s+\d+\s+cards?\b/i.test(field.label)
    && field.options.some((option) => Boolean(option.card));
}

function boardSelector(field: ChoiceField) {
  if (field.kind === "batch-object") return '[data-zone-kind="batch"] [data-rule-object-id]';
  if (field.kind === "hero") return '[data-zone-kind="hero"] [data-card-id]';
  if (field.kind === "evo") return '[data-zone-kind="character-card"][data-evo-card-id]';
  if (field.kind === "card") return '[data-zone-kind="hero"] [data-card-id], [data-zone-kind="character-card"][data-evo-card-id]';
  if (field.kind === "energy") return '[data-zone-kind="energy"] [data-card-id]';
  if (field.kind === "bakugan") return '[data-zone-kind="character-card"][data-bakugan-id]';
  if (field.kind === "core") return '[data-core-cell]';
  return "";
}

function boardOptionId(field: ChoiceField, element: HTMLElement) {
  if (field.kind === "batch-object") return element.dataset.ruleObjectId;
  if (field.kind === "evo") return element.dataset.evoCardId;
  if (field.kind === "card") return element.dataset.evoCardId ?? element.dataset.cardId;
  if (field.kind === "bakugan") return element.dataset.bakuganId;
  if (field.kind === "core") return element.dataset.coreCell;
  return element.dataset.cardId;
}

function fieldComplete(answers: CardChoices, field: ChoiceField) {
  const count = valuesFor(answers, field).length;
  return count >= field.minimum && count <= field.maximum;
}

async function command(
  action: string,
  payload: Record<string, unknown>,
  local: (match: MatchState, playerId: string) => MatchState,
) {
  const current = readMatchStore();
  const match = current.match;
  const playerId = current.playerId ?? match?.players[0]?.id;
  if (!match || !playerId) throw new Error("No active match is available.");
  if (!current.online) {
    writeCoordinatedMatch(local(match, playerId));
    return;
  }
  const response = await fetch("/api/game", {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json", ...(current.capability ? { "x-match-capability": current.capability } : {}) },
    body: JSON.stringify({ action, code: match.code, playerId, expectedVersion: match.version, payload }),
  });
  const data = await response.json() as { state?: MatchState; error?: string };
  if (data.state) writeCoordinatedMatch(data.state);
  if (!response.ok) throw new Error(data.error ?? "The choice could not be recorded.");
}

export function ChoiceQueueLayer() {
  const state = useMatchSelector((snapshot) => snapshot);
  const match = state.match;
  const playerId = state.playerId ?? match?.players[0]?.id;
  const pending = match?.pendingChoice;
  const deckInspectionActive = Boolean(pending?.schema.fields.some(isTopDeckField));
  const fields = useMemo(() => pending?.schema.fields.filter((field) => (
    field.chooserId === playerId
    && field.id !== "discardCardIds"
    && !isTopDeckField(field)
  )) ?? [], [pending, playerId]);
  const boardFields = useMemo(() => fields.filter((field) => BOARD_TARGET_KINDS.has(field.kind)), [fields]);
  const modalFields = useMemo(() => fields.filter((field) => !BOARD_TARGET_KINDS.has(field.kind)), [fields]);
  const triggerOrder = match?.triggerOrders.find((request) => request.controllerId === playerId && !request.orderedIds);
  const [answers, setAnswers] = useState<CardChoices>({});
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setAnswers({});
    setOrderedIds(triggerOrder?.triggerIds ?? []);
    setError("");
  }, [pending?.id, triggerOrder?.id]);

  const incompleteBoardField = boardFields.find((field) => !fieldComplete(answers, field));
  const boardFieldsComplete = boardFields.every((field) => fieldComplete(answers, field));
  const activeBoardField = incompleteBoardField
    ?? (boardFields.length && !modalFields.length ? boardFields.at(-1) : undefined);

  const toggle = useCallback((field: ChoiceField, id: string) => {
    setAnswers((current) => {
      const selected = valuesFor(current, field);
      const next = selected.includes(id)
        ? selected.filter((candidate) => candidate !== id)
        : field.maximum === 1 ? [id] : [...selected, id].slice(0, field.maximum);
      return assign(current, field, next);
    });
  }, []);

  useEffect(() => {
    if (!activeBoardField || busy || state.route !== "match") return;
    const selector = boardSelector(activeBoardField);
    if (!selector) return;
    const legalIds = new Set(activeBoardField.options.map((option) => option.id));
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const root = document.documentElement;
    root.dataset.choiceTargeting = "true";
    root.dataset.choiceTargetKind = activeBoardField.kind;

    for (const element of elements) {
      const id = boardOptionId(activeBoardField, element);
      element.dataset.choiceTargetCandidate = "true";
      element.dataset.choiceTargetValid = id && legalIds.has(id) ? "true" : "false";
      if (id && legalIds.has(id)) element.dataset.choiceTargetId = id;
    }

    const activate = (target: EventTarget | null) => {
      const element = target instanceof Element
        ? target.closest<HTMLElement>('[data-choice-target-valid="true"][data-choice-target-id]')
        : null;
      if (!element?.dataset.choiceTargetId) return false;
      toggle(activeBoardField, element.dataset.choiceTargetId);
      return true;
    };
    const click = (event: MouseEvent) => {
      if (!activate(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (!activate(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", keydown, true);
      delete root.dataset.choiceTargeting;
      delete root.dataset.choiceTargetKind;
      for (const element of elements) {
        delete element.dataset.choiceTargetCandidate;
        delete element.dataset.choiceTargetValid;
        delete element.dataset.choiceTargetId;
      }
    };
  }, [activeBoardField, busy, state.route, toggle, activeBoardField?.options.map((option) => option.id).join("|")]);

  if (state.route !== "match" || !match || !playerId) return null;
  if (deckInspectionActive && !triggerOrder) return null;
  if (!fields.length && !triggerOrder) return null;

  const submitChoices = async () => {
    if (!pending || busy) return;
    setBusy(true); setError("");
    try {
      await command("choice", { choices: answers }, (current, actorId) => submitCardChoice(current, actorId, answers));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The choice could not be completed."); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!pending || busy) return;
    setBusy(true); setError("");
    try { await command("cancel-choice", {}, (current, actorId) => cancelCardChoice(current, actorId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The choice could not be cancelled."); }
    finally { setBusy(false); }
  };

  const submitOrder = async () => {
    if (!triggerOrder || busy) return;
    setBusy(true); setError("");
    try {
      await command("order-triggers", { requestId: triggerOrder.id, orderedIds }, (current, actorId) => orderTriggers(current, actorId, triggerOrder.id, orderedIds));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The trigger order could not be completed."); }
    finally { setBusy(false); }
  };

  const moveTrigger = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= orderedIds.length) return;
    setOrderedIds((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  if (activeBoardField && (!boardFieldsComplete || !modalFields.length)) {
    const selected = valuesFor(answers, activeBoardField);
    const selectedNames = activeBoardField.options
      .filter((option) => selected.includes(option.id))
      .map((option) => option.label);
    const complete = fields.every((field) => fieldComplete(answers, field));
    return (
      <section className={styles.targetPrompt} role="dialog" aria-label={`${pending?.schema.sourceName} target selection`}>
        <div>
          <small>SELECT TARGET BEFORE BATCH ENTRY</small>
          <strong>{pending?.schema.sourceName}</strong>
          <p>{activeBoardField.label}. Only highlighted legal targets can be selected.</p>
          <span>{selectedNames.length ? `Selected: ${selectedNames.join(", ")}` : `${activeBoardField.minimum === activeBoardField.maximum ? activeBoardField.minimum : `${activeBoardField.minimum}–${activeBoardField.maximum}`} required`}</span>
        </div>
        <div className={styles.targetActions}>
          {pending?.kind === "card-play" && pending.controllerId === playerId && !Object.keys(pending.answers).length ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => void cancel()}>Cancel card</button> : null}
          <button type="button" disabled={busy || !complete} onClick={() => void submitChoices()}>{busy ? "Locking…" : "Confirm target"}</button>
        </div>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </section>
    );
  }

  return (
    <div className={styles.backdrop} role="presentation">
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="choice-queue-title">
        <header>
          <small>{triggerOrder ? "SIMULTANEOUS TRIGGERS" : pending?.schema.simultaneous ? "PRIVATE SIMULTANEOUS CHOICE" : "PLAYER CHOICE"}</small>
          <h2 id="choice-queue-title">{triggerOrder ? `Order ${triggerOrder.event} triggers` : pending?.schema.sourceName}</h2>
          <p>{triggerOrder ? "The first trigger listed enters the batch first and resolves last." : boardFields.length ? "The target was chosen on the play area. Complete the remaining choice." : "Each required choice is requested and validated at its required timing."}</p>
        </header>

        {modalFields.map((field) => {
          const selected = new Set(valuesFor(answers, field));
          return (
            <fieldset key={field.id} className={styles.fieldset}>
              <legend>{field.label} <span>{field.minimum === field.maximum ? `Select ${field.minimum}` : `Select ${field.minimum}–${field.maximum}`}</span></legend>
              <div className={styles.options}>
                {field.options.map((item) => (
                  <button key={item.id} type="button" aria-pressed={selected.has(item.id)} data-selected={selected.has(item.id)} disabled={busy} onClick={() => toggle(field, item.id)}>
                    <strong>{item.label}</strong>{item.description ? <small>{item.description}</small> : null}
                  </button>
                ))}
                {!field.options.length ? <p className={styles.empty}>No legal choices are available. This card cannot be played.</p> : null}
              </div>
            </fieldset>
          );
        })}

        {triggerOrder ? (
          <ol className={styles.triggerList}>
            {orderedIds.map((id, index) => {
              const trigger = triggerOrder.triggers.find((candidate) => candidate.id === id)!;
              return <li key={id}><span><strong>{trigger.card.name}</strong><small>{trigger.effect ?? trigger.card.effect}</small></span><div><button type="button" disabled={index === 0 || busy} onClick={() => moveTrigger(index, -1)}>↑</button><button type="button" disabled={index === orderedIds.length - 1 || busy} onClick={() => moveTrigger(index, 1)}>↓</button></div></li>;
            })}
          </ol>
        ) : null}

        <footer>
          {pending?.kind === "card-play" && pending.controllerId === playerId && !Object.keys(pending.answers).length ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => void cancel()}>Cancel card</button> : null}
          <button type="button" disabled={busy || Boolean(fields.some((field) => !fieldComplete(answers, field)))} onClick={() => void (triggerOrder ? submitOrder() : submitChoices())}>
            {busy ? "Locking…" : triggerOrder ? "Confirm order" : "Lock choices"}
          </button>
        </footer>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </section>
    </div>
  );
}
