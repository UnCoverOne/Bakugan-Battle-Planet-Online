from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    content = target.read_text()
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}")
    target.write_text(content.replace(old, new, 1))

replace_once(
    "components/game-screen-v2/matchStore.ts",
    '''function refresh() {
  if (typeof window === "undefined") return;
  const next = readPersistedMatchStore();
  if (snapshotsMatch(snapshot, next)) return;
  snapshot = next;
  notify();
}''',
    '''function refresh() {
  if (typeof window === "undefined") return;
  const persisted = readPersistedMatchStore();
  const inMemoryMatch = snapshot.match;
  const persistedMatch = persisted.match;
  const keepNewerInMemoryMatch = Boolean(
    inMemoryMatch
    && (
      !persistedMatch
      || inMemoryMatch.id !== persistedMatch.id
      || inMemoryMatch.version > persistedMatch.version
    )
  );
  const next = keepNewerInMemoryMatch
    ? { ...persisted, match: inMemoryMatch }
    : persisted;
  if (snapshotsMatch(snapshot, next)) return;
  snapshot = next;
  notify();
}''',
)

replace_once(
    "components/game-screen-v2/BrawlExperienceLayer.tsx",
    '''  useEffect(() => {
    if (resolvingEffect || !resolutionQueue.length) return;
    const [next, ...remaining] = resolutionQueue;
    setResolutionQueue(remaining);
    setResolvingEffect(next);
    setEffectBurst(next);
    resolutionTimer.current = window.setTimeout(() => setResolvingEffect(null), 760);
    burstTimer.current = window.setTimeout(() => setEffectBurst(null), 1050);
    return () => {
      if (resolutionTimer.current != null) window.clearTimeout(resolutionTimer.current);
      if (burstTimer.current != null) window.clearTimeout(burstTimer.current);
    };
  }, [resolutionQueue, resolvingEffect]);''',
    '''  useEffect(() => {
    if (resolvingEffect || !resolutionQueue.length) return;
    const [next, ...remaining] = resolutionQueue;
    setResolutionQueue(remaining);
    setResolvingEffect(next);
  }, [resolutionQueue, resolvingEffect]);

  useEffect(() => {
    if (!resolvingEffect) return;
    setEffectBurst(resolvingEffect);
    resolutionTimer.current = window.setTimeout(() => setResolvingEffect(null), 760);
    burstTimer.current = window.setTimeout(() => setEffectBurst(null), 1050);
    return () => {
      if (resolutionTimer.current != null) window.clearTimeout(resolutionTimer.current);
      if (burstTimer.current != null) window.clearTimeout(burstTimer.current);
    };
  }, [resolvingEffect]);''',
)

# Strengthen the static regression around the two corrected sequencing details.
test_path = ROOT / "tests/presentation-stability.test.ts"
test = test_path.read_text()
test = test.replace(
    '  assert.match(store, /scheduleMatchPersistence/);',
    '  assert.match(store, /scheduleMatchPersistence/);\n  assert.match(store, /keepNewerInMemoryMatch/);',
)
test = test.replace(
    '  assert.match(brawl, /resolutionQueue/);',
    '  assert.match(brawl, /resolutionQueue/);\n  assert.match(brawl, /useEffect\\(\\(\\) => \\{\\s*if \\(!resolvingEffect\\) return;/);',
)
test_path.write_text(test)

print("Presentation stability follow-up applied.")
