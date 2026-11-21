/** Normalise six-character room codes used during match creation and joining. */
export function normalizeRoomCode(value: string) {
  return value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6);
}
