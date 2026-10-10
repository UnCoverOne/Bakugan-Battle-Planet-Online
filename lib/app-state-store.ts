/** Per-provider store: never share account or match state between SSR requests. */
export function createAppStateStore<T>(initial: T) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    publish: (next: T) => {
      if (Object.is(snapshot, next)) return;
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
  };
}

/** Stable snapshots let React skip updates when none of a consumer's fields changed. */
export function selectAppFields<T extends object, K extends keyof T>(getSnapshot: () => T, keys: readonly K[]) {
  let previous: Pick<T, K> | undefined;
  return () => {
    const state = getSnapshot();
    if (previous && keys.every((key) => Object.is(previous![key], state[key]))) return previous;
    previous = Object.fromEntries(keys.map((key) => [key, state[key]])) as Pick<T, K>;
    return previous;
  };
}
