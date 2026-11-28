/** Current player-facing feedback contract; historical kinds remain in moderation. */
export const FEEDBACK_KINDS = ["issue", "suggestion"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const FEEDBACK_MIN_LENGTH = 20;
export const FEEDBACK_MAX_LENGTH = 2000;
export const FEEDBACK_MAX_REQUEST_BYTES = 16_384;

export function normalizeFeedbackMessage(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim()
    : "";
}

export type FeedbackInput = { kind: FeedbackKind; cardId: string | null; message: string };
export function validateFeedback(value: unknown, hasCard: (id: string) => boolean):
  { valid: true; input: FeedbackInput } | { valid: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, error: "Invalid feedback." };
  const body = value as Record<string, unknown>;
  const kind = body.kind;
  if (kind !== "issue" && kind !== "suggestion") return { valid: false, error: "Choose Report an issue or Request a feature." };
  const message = normalizeFeedbackMessage(body.message);
  if (message.length < FEEDBACK_MIN_LENGTH || message.length > FEEDBACK_MAX_LENGTH) {
    return { valid: false, error: "Please write between 20 and 2,000 characters." };
  }
  if (body.cardId != null && typeof body.cardId !== "string") return { valid: false, error: "Invalid related card." };
  const cardId = typeof body.cardId === "string" ? body.cardId.trim() : "";
  if (cardId && !hasCard(cardId)) return { valid: false, error: "The selected card does not exist." };
  // Explicit allowlist: ignore old sourceUrl and any client-provided user or moderation metadata.
  return { valid: true, input: { kind, cardId: cardId || null, message } };
}
