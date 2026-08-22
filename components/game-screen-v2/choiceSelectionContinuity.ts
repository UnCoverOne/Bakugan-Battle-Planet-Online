import type { CardChoices } from "../../lib/game";
import type { ChoiceField } from "../../lib/rules/choices";

function valuesFor(answers: CardChoices, field: ChoiceField) {
  const value = answers[field.id];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "boolean") return [value ? "yes" : "no"];
  if (value == null) return [];
  return [String(value)];
}

function assign(answers: CardChoices, field: ChoiceField, values: string[]) {
  const next = { ...answers };
  if (["discardCardIds", "handCardIds", "targetEnergyIds", "orderedCardIds"].includes(field.id)) {
    Object.assign(next, { [field.id]: values });
  } else if (field.id === "xValue") {
    next.xValue = Number(values[0] ?? 0);
  } else if (field.id === "confirmed") {
    next.confirmed = values[0] === "yes";
  } else {
    Object.assign(next, { [field.id]: values[0] });
  }
  return next;
}

export function reconcileOrderedIds(current: readonly string[], legal: readonly string[]) {
  const legalSet = new Set(legal);
  const kept = current.filter((id, index) => legalSet.has(id) && current.indexOf(id) === index);
  const keptSet = new Set(kept);
  return [...kept, ...legal.filter((id) => !keptSet.has(id))];
}

export function reconcileChoiceAnswers(current: CardChoices, fields: readonly ChoiceField[]) {
  let next: CardChoices = {};
  for (const field of fields) {
    const legal = new Set(
      field.options.filter((option) => !option.disabled).map((option) => option.id),
    );
    const retained = valuesFor(current, field)
      .filter((id, index, values) => legal.has(id) && values.indexOf(id) === index)
      .slice(0, field.maximum);
    if (retained.length) next = assign(next, field, retained);
  }
  return next;
}

export function retainLegalSelection(selectedId: string, legal: readonly string[]) {
  return legal.includes(selectedId) ? selectedId : "";
}
