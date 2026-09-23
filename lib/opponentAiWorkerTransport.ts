/**
 * Schedule Worker construction through a Promise boundary so synchronous
 * constructor failures are observable as rejections instead of escaping a
 * React effect before its .catch() handler is attached.
 *
 * Keep this helper isolated from the tactical AI module so importing it from
 * GameplayClient does not pull opponentAi into the browser's gameplay bundle.
 */
export function createOpponentAiWorkerAsync<T>(factory: () => T): Promise<T> {
  return Promise.resolve().then(factory);
}
