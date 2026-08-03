"use client";

import { useEffect, useMemo, useState } from "react";
import { cancelCardChoice, orderTriggers, submitCardChoice, type CardChoices, type MatchState } from "../../lib/game";
import type { ChoiceField } from "../../lib/rules/choices";
import { writeCoordinatedMatch } from "./MatchStateCoordinator";
import { readMatchStore, useMatchSelector } from "./matchStore";
import styles from "./ChoiceQueueLayer.module.css";

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

  const toggle = (field: ChoiceField, id: string) => {
    const selected = valuesFor(answers, field);
    const exists = selected.includes(id);
    let next: string[];
    if (exists) next = selected.filter((value) => value !== id);
    else if (field.maximum === 1) next = [id];
    else if (selected.length < field.maximum) next = [...selected, id];
    else next = selected;
    setAnswers((current) => assign(current, field, next));
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

  return (
    <div className={styles.backdrop} role="presentation">
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="choice-queue-title">
        <header>
          <small>{triggerOrder ? "SIMULTANEOUS TRIGGERS" : pending?.schema.simultaneous ? "PRIVATE SIMULTANEOUS CHOICE" : "PLAYER CHOICE"}</small>
          <h2 id="choice-queue-title">{triggerOrder ? `Order ${triggerOrder.event} triggers` : pending?.schema.sourceName}</h2>
          <p>{triggerOrder ? "The first trigger listed enters the batch first and resolves last." : "Each required choice is requested and validated only when its clause resolves."}</p>
        </header>

        {fields.map((field) => {
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
                {!field.options.length ? <p className={styles.empty}>No legal targets are available. This card cannot be played.</p> : null}
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
          <button type="button" disabled={busy || Boolean(fields.some((field) => valuesFor(answers, field).length < field.minimum))} onClick={() => void (triggerOrder ? submitOrder() : submitChoices())}>
            {busy ? "Locking…" : triggerOrder ? "Confirm order" : "Lock choices"}
          </button>
        </footer>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </section>
    </div>
  );
}
