export type TrainingAiDeckSelection<T> = {
  deck: T;
  resourceId: string;
  configurationRevision: number;
};

export function requireTrainingAiDeckSelection<T>(
  value: unknown,
  deckIsLegal: (deck: T) => boolean,
): TrainingAiDeckSelection<T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Training AI deck selection returned an invalid response.");
  }
  const candidate = value as Record<string, unknown>;
  if (
    !candidate.deck
    || typeof candidate.deck !== "object"
    || !deckIsLegal(candidate.deck as T)
    || typeof candidate.resourceId !== "string"
    || !candidate.resourceId
    || !Number.isFinite(candidate.configurationRevision)
  ) {
    throw new Error("Training AI deck selection returned an invalid deck.");
  }
  return {
    deck: candidate.deck as T,
    resourceId: candidate.resourceId,
    configurationRevision: Number(candidate.configurationRevision),
  };
}
