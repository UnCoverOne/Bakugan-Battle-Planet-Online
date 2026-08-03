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
    '''  const keepNewerInMemoryMatch = Boolean(
    inMemoryMatch
    && (
      !persistedMatch
      || inMemoryMatch.id !== persistedMatch.id
      || inMemoryMatch.version > persistedMatch.version
    )
  );''',
    '''  const keepNewerInMemoryMatch = Boolean(
    pendingPersistedMatch
    && inMemoryMatch
    && pendingPersistedMatch.id === inMemoryMatch.id
    && pendingPersistedMatch.version === inMemoryMatch.version
    && (
      !persistedMatch
      || inMemoryMatch.id !== persistedMatch.id
      || inMemoryMatch.version > persistedMatch.version
    )
  );''',
)

replace_once(
    "components/game-screen-v2/BrawlExperienceLayer.tsx",
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
    '''  useEffect(() => {
    if (resolvingEffect || effectBurst || !resolutionQueue.length) return;
    const [next, ...remaining] = resolutionQueue;
    setResolutionQueue(remaining);
    setResolvingEffect(next);
  }, [resolutionQueue, resolvingEffect, effectBurst]);

  useEffect(() => {
    if (!resolvingEffect) return;
    setEffectBurst(resolvingEffect);
    resolutionTimer.current = window.setTimeout(() => setResolvingEffect(null), 760);
    return () => {
      if (resolutionTimer.current != null) window.clearTimeout(resolutionTimer.current);
    };
  }, [resolvingEffect]);

  useEffect(() => {
    if (!effectBurst) return;
    burstTimer.current = window.setTimeout(() => setEffectBurst(null), 1050);
    return () => {
      if (burstTimer.current != null) window.clearTimeout(burstTimer.current);
    };
  }, [effectBurst]);''',
)

replace_once(
    "components/game-screen-v2/BrawlExperienceLayer.module.css",
    '  animation: brawl-hud-enter 220ms ease-out both;',
    '  animation: brawl-hud-enter 220ms ease-out;',
)

test_path = ROOT / "tests/presentation-stability.test.ts"
test = test_path.read_text()
test = test.replace(
    '  assert.match(store, /keepNewerInMemoryMatch/);',
    '  assert.match(store, /keepNewerInMemoryMatch/);\n  assert.match(store, /pendingPersistedMatch\.id === inMemoryMatch\.id/);',
)
test = test.replace(
    '  assert.match(brawl, /useEffect\\(\\(\\) => \\{\\s*if \\(!resolvingEffect\\) return;/);',
    '  assert.match(brawl, /if \\(resolvingEffect \\|\\| effectBurst \\|\\| !resolutionQueue\.length\\) return/);\n  assert.match(brawl, /if \\(!effectBurst\\) return;/);',
)
test_path.write_text(test)

print("Final presentation sequencing corrections applied.")
