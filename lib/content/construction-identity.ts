const PRINTED_NAME_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  "might of cyndeous": "might of cyndeus",
});

function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalConstructionName(value: string) {
  const normalized = normalizeText(value);
  return PRINTED_NAME_ALIASES[normalized] ?? normalized;
}

export function constructionIdentityForCard(card: {
  name?: string;
  displayName?: string;
  effect?: string;
}) {
  // Internal names retain canonical distinctions such as set-qualified or
  // Hero-ID variants. Printed-name aliases are applied when no richer internal
  // identity is available.
  const name = canonicalConstructionName(card.name || card.displayName || "");
  const functionText = normalizeText(card.effect || "");
  return `${name}\u001f${functionText}`;
}
