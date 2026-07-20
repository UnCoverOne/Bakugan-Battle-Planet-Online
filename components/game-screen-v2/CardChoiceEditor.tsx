"use client";

import { useMemo, useState } from "react";
import type { CardChoices, GameCard, MatchState } from "../../lib/game";
import { buildChoiceSchema, type ChoiceField } from "../../lib/rules/choices";
import styles from "./ChoiceQueueLayer.module.css";

function selected(choices: CardChoices, field: ChoiceField) {
  const value = choices[field.id];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "boolean") return [value ? "yes" : "no"];
  return value == null ? [] : [String(value)];
}

function changed(choices: CardChoices, field: ChoiceField, values: string[]) {
  const next = { ...choices };
  if (["discardCardIds", "handCardIds", "targetEnergyIds"].includes(field.id)) Object.assign(next, { [field.id]: values });
  else if (field.id === "xValue") next.xValue = Number(values[0] ?? 0);
  else if (field.id === "confirmed") next.confirmed = values[0] === "yes";
  else Object.assign(next, { [field.id]: values[0] });
  return next;
}

export function CardChoiceEditor({ match, playerId, card, title, onSubmit, onCancel }: {
  match: MatchState;
  playerId: string;
  card: GameCard;
  title?: string;
  onSubmit: (choices: CardChoices) => void;
  onCancel: () => void;
}) {
  const schema = useMemo(() => buildChoiceSchema(match, playerId, card), [match, playerId, card]);
  const fields = schema.fields.filter((field) => field.chooserId === playerId);
  const [choices, setChoices] = useState<CardChoices>({});
  const toggle = (field: ChoiceField, id: string) => {
    const current = selected(choices, field);
    const next = current.includes(id)
      ? current.filter((value) => value !== id)
      : field.maximum === 1
        ? [id]
        : current.length < field.maximum ? [...current, id] : current;
    setChoices((value) => changed(value, field, next));
  };
  const incomplete = fields.some((field) => selected(choices, field).length < field.minimum);
  return <div className={styles.backdrop} role="presentation"><section className={styles.dialog} role="dialog" aria-modal="true"><header><small>COMPLETE CARD CHOICES</small><h2>{title ?? card.displayName ?? card.name}</h2><p>Choose every required target, amount and mode before confirming.</p></header>{fields.map((field) => <fieldset className={styles.fieldset} key={field.id}><legend>{field.label} <span>{field.minimum === field.maximum ? `Select ${field.minimum}` : `Select ${field.minimum}–${field.maximum}`}</span></legend><div className={styles.options}>{field.options.map((item) => { const active = selected(choices, field).includes(item.id); return <button key={item.id} type="button" data-selected={active} aria-pressed={active} onClick={() => toggle(field, item.id)}><strong>{item.label}</strong></button>; })}</div></fieldset>)}<footer><button type="button" className={styles.secondary} onClick={onCancel}>Cancel</button><button type="button" disabled={incomplete} onClick={() => onSubmit(choices)}>Confirm</button></footer></section></div>;
}
