import type { ChoiceField } from "../../lib/rules/choices";

export function isTopDeckField(field: ChoiceField) {
  return field.kind === "deck-order" && Boolean(field.requestedWindowSize);
}

export function isFullDeckSearchField(field: ChoiceField) {
  return field.kind === "deck-order"
    && field.id === "orderedCardIds"
    && field.minimum === 0
    && field.maximum === 0
    && /\bsearch all cards in your deck\b/i.test(field.label);
}

export function isDeckInspectionField(field: ChoiceField) {
  return isTopDeckField(field) || isFullDeckSearchField(field);
}

/** The specialized layer and its generic fallback share this ownership rule. */
export function renderableDeckInspectionField(
  fields: readonly ChoiceField[] | undefined,
  viewerId: string | undefined,
) {
  return fields?.find((field) => (
    isDeckInspectionField(field)
    && field.options.some((option) => Boolean(option.card))
    && (field.visibility === "public" || field.chooserId === viewerId)
  ));
}
