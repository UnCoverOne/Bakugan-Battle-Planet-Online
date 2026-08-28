"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type CardChoices, type MatchState } from "../../lib/game";
import { dispatchLocalGameAction } from "../../lib/engine/local-command-dispatcher";
import type { ChoiceField, ChoiceKind } from "../../lib/rules/choices";
import { writeCoordinatedMatch } from "./MatchStateCoordinator";
import { matchCommandHeaders, readMatchStore, useMatchSelector } from "./matchStore";
import styles from "./ChoiceQueueLayer.module.css";
import { isTopDeckField, renderableDeckInspectionField } from "./deckInspectionPresentation";
import { boardChoicePrompt, clearBoardChoiceHud, publishBoardChoiceHud } from "./boardChoiceHud";
import { reconcileChoiceAnswers, reconcileOrderedIds } from "./choiceSelectionContinuity";

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
  if (field.maximum > 1 || ["discardCardIds", "handCardIds", "targetEnergyIds", "orderedCardIds"].includes(field.id)) {
    Object.assign(next, { [field.id]: values });
  } else if (field.id === "xValue") next.xValue = Number(values[0] ?? 0);
  else if (field.id === "confirmed") next.confirmed = values[0] === "yes";
  else Object.assign(next, { [field.id]: values[0] });
  return next;
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
  action: "choice" | "cancel-choice" | "order-triggers",
  payload: Record<string, unknown>,
) {
  const current = readMatchStore();
  const match = current.match;
  const playerId = current.playerId ?? match?.players[0]?.id;
  if (!match || !playerId) throw new Error("No active match is available.");
  if (!current.online) {
    writeCoordinatedMatch(dispatchLocalGameAction(match, playerId, action, payload));
    return;
  }
  const response = await fetch("/api/game", {
    method: "POST",
    cache: "no-store",
    headers: matchCommandHeaders(current),
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
  const deckInspectionActive = Boolean(
    renderableDeckInspectionField(pending?.schema.fields, playerId),
  );
  const fields = useMemo(() => pending?.schema.fields.filter((field) => (
    field.chooserId === playerId
    // Controller-owned discards retain the in-hand interaction. A discard
    // delegated to the other player needs a modal fallback on that player's
    // client; otherwise the private chooser transition can be visually silent.
    && (field.id !== "discardCardIds" || pending?.controllerId !== playerId)
    && !isTopDeckField(field)
  )) ?? [], [pending, playerId]);
  const boardFields = useMemo(() => fields.filter((field) => BOARD_TARGET_KINDS.has(field.kind)), [fields]);
  const modalFields = useMemo(() => fields.filter((field) => !BOARD_TARGET_KINDS.has(field.kind)), [fields]);
  const triggerOrder = match?.triggerOrders.find((request) => request.controllerId === playerId && !request.orderedIds);
  const [answers, setAnswers] = useState<CardChoices>({});
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pendingChoiceId = pending?.id ?? "";
  const triggerOrderId = triggerOrder?.id ?? "";
  const previousPendingChoiceId = useRef("");
  const previousTriggerOrderId = useRef("");

  useEffect(() => {
    const isNewChoice = previousPendingChoiceId.current !== pendingChoiceId;
    previousPendingChoiceId.current = pendingChoiceId;
    setAnswers((current) => isNewChoice ? {} : reconcileChoiceAnswers(current, fields));
    if (isNewChoice) setError("");
  }, [fields, pendingChoiceId]);

  useEffect(() => {
    const isNewOrder = previousTriggerOrderId.current !== triggerOrderId;
    previousTriggerOrderId.current = triggerOrderId;
    const legalIds = triggerOrder?.triggerIds ?? [];
    setOrderedIds((current) => isNewOrder ? [...legalIds] : reconcileOrderedIds(current, legalIds));
    if (isNewOrder) setError("");
  }, [triggerOrder, triggerOrderId]);

  const incompleteBoardField = boardFields.find((field) => !fieldComplete(answers, field));
  const boardFieldsComplete = boardFields.every((field) => fieldComplete(answers, field));
  const activeBoardField = incompleteBoardField
    ?? (boardFields.length && !modalFields.length ? boardFields.at(-1) : undefined);

  const toggle = useCallback((field: ChoiceField, id: string) => {
    if (field.options.find((option) => option.id === id)?.disabled) return;
    setAnswers((current) => {
      const selected = valuesFor(current, field);
      const next = selected.includes(id)
        ? selected.filter((candidate) => candidate !== id)
        : field.maximum === 1 ? [id] : [...selected, id].slice(0, field.maximum);
      return assign(current, field, next);
    });
  }, []);

  const submitChoices = useCallback(async () => {
    if (!pending || busy) return;
    setBusy(true); setError("");
    try {
      await command("choice", { choices: answers });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The choice could not be completed."); }
    finally { setBusy(false); }
  }, [answers, busy, pending]);

  const cancel = useCallback(async () => {
    if (!pending || busy) return;
    setBusy(true); setError("");
    try { await command("cancel-choice", {}); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The choice could not be cancelled."); }
    finally { setBusy(false); }
  }, [busy, pending]);

  const clearError = useCallback(() => setError(""), []);
  const selectedBoardIds = useMemo(
    () => activeBoardField ? valuesFor(answers, activeBoardField) : [],
    [activeBoardField, answers],
  );
  const selectedBoardSignature = selectedBoardIds.join("|");
  const activeBoardOptionSignature = activeBoardField?.options.map((option) => option.id).join("|") ?? "";
  const selectedBoardNames = activeBoardField?.options
    .filter((option) => selectedBoardIds.includes(option.id))
    .map((option) => option.label) ?? [];
  const allFieldsComplete = fields.every((field) => fieldComplete(answers, field));
  const canCancelBoardChoice = Boolean(
    pending?.kind === "card-play"
    && pending.cancellable !== false
    && pending.controllerId === playerId
    && !Object.keys(pending.answers).length,
  );
  const boardHudActive = Boolean(
    state.route === "match"
    && match
    && playerId
    && activeBoardField
    && (!boardFieldsComplete || !modalFields.length),
  );
  const boardHudId = boardHudActive
    ? `${match?.id}:${pending?.id}:${activeBoardField?.id}`
    : "";
  const boardHudPrompt = activeBoardField && pending
    ? boardChoicePrompt({
      sourceName: pending.schema.sourceName,
      fieldLabel: activeBoardField.label,
      targetKind: activeBoardField.kind,
      selectedNames: selectedBoardNames,
      minimum: activeBoardField.minimum,
      maximum: activeBoardField.maximum,
      complete: allFieldsComplete,
      canCancel: canCancelBoardChoice,
    })
    : "";

  useEffect(() => {
    if (!boardHudActive || !match || !playerId || !boardHudId) return;
    publishBoardChoiceHud({
      id: boardHudId,
      matchId: match.id,
      playerId,
      prompt: boardHudPrompt,
      canCancel: canCancelBoardChoice,
      canConfirm: allFieldsComplete,
      busy,
      error,
      confirm: () => void submitChoices(),
      cancel: () => void cancel(),
      clearError,
    });
    return () => clearBoardChoiceHud(boardHudId);
  }, [
    allFieldsComplete,
    boardHudActive,
    boardHudId,
    boardHudPrompt,
    busy,
    canCancelBoardChoice,
    cancel,
    clearError,
    error,
    match,
    playerId,
    submitChoices,
  ]);

  useEffect(() => {
    if (!activeBoardField || busy || state.route !== "match") return;
    const selector = boardSelector(activeBoardField);
    if (!selector) return;
    const legalIds = new Set(activeBoardField.options.map((option) => option.id));
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const root = document.documentElement;
    root.dataset.choiceTargeting = "true";
    root.dataset.choiceTargetKind = activeBoardField.kind;

    const priorAttributes = new Map<HTMLElement, Record<string, string | null>>();
    for (const element of elements) {
      priorAttributes.set(element, Object.fromEntries(
        ["role", "tabindex", "aria-pressed", "aria-label"].map((name) => [name, element.getAttribute(name)]),
      ));
      const id = boardOptionId(activeBoardField, element);
      const legal = Boolean(id && legalIds.has(id));
      element.dataset.choiceTargetCandidate = "true";
      element.dataset.choiceTargetValid = legal ? "true" : "false";
      if (id && legal) {
        const option = activeBoardField.options.find((candidate) => candidate.id === id);
        const selected = selectedBoardIds.includes(id);
        element.dataset.choiceTargetId = id;
        element.tabIndex = 0;
        element.setAttribute("role", "button");
        element.setAttribute("aria-pressed", selected ? "true" : "false");
        element.setAttribute("aria-label", `${option?.label ?? "Legal target"}${selected ? ", selected" : ""}`);
      }
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
        const previous = priorAttributes.get(element);
        for (const name of ["role", "tabindex", "aria-pressed", "aria-label"]) {
          const value = previous?.[name];
          if (value == null) element.removeAttribute(name);
          else element.setAttribute(name, value);
        }
      }
    };
  }, [activeBoardField, activeBoardOptionSignature, busy, selectedBoardIds, selectedBoardSignature, state.route, toggle]);

  if (state.route !== "match" || !match || !playerId) return null;
  if (deckInspectionActive && !triggerOrder) return null;
  if (!fields.length && !triggerOrder) return null;

  const submitOrder = async () => {
    if (!triggerOrder || busy) return;
    setBusy(true); setError("");
    try {
      await command("order-triggers", { requestId: triggerOrder.id, orderedIds });
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
    return null;
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
                  <button key={item.id} type="button" aria-pressed={selected.has(item.id)} data-selected={selected.has(item.id)} disabled={busy || item.disabled} onClick={() => toggle(field, item.id)}>
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
