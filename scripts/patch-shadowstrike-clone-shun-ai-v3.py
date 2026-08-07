from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise SystemExit(f"Missing patch anchor: {label}")
    return source.replace(old, new, 1)


path = Path("tests/rules-shadowstrike-clone-shun.test.ts")
tests = path.read_text()
tests = replace_once(
    tests,
    '  playCard,\n  totalDamage,',
    '  playCard,\n  resumePendingEffectAfterDraw,\n  totalDamage,',
    "draw continuation import",
)
helper_anchor = '''function resolveSimpleCard(state: MatchState, controllerId: string, opponentId: string, cardId: string) {
  let next = playCard(state, controllerId, cardId);
  next = passPriority(next, controllerId);
  next = passPriority(next, opponentId);
  return next;
}
'''
helper = helper_anchor + '''
function completeQueuedEffectDraw(state: MatchState) {
  const queued = state as MatchState & {
    pendingDrawQueue?: Array<{ playerId: string; remaining: number; sourceEffectId?: string }>;
  };
  const active = queued.pendingDrawQueue?.[0];
  assert.ok(active, "expected a queued effect draw");
  const owner = state.players.find((candidate) => candidate.id === active.playerId)!;
  for (let index = 0; index < active.remaining; index += 1) {
    const drawn = owner.deckCards.shift();
    if (drawn) owner.hand.push(drawn);
  }
  owner.deck = owner.deckCards.length;
  const sourceEffectId = active.sourceEffectId;
  queued.pendingDrawQueue = [];
  resumePendingEffectAfterDraw(state, sourceEffectId);
}
'''
tests = replace_once(tests, helper_anchor, helper, "queued draw helper")
tests = replace_once(
    tests,
    '''    state = resolveSimpleCard(state, ai.id, human.id, cloneArmy.id);
    const currentAi = state.players.find((candidate) => candidate.id === ai.id)!;
''',
    '''    state = resolveSimpleCard(state, ai.id, human.id, cloneArmy.id);
    completeQueuedEffectDraw(state);
    const currentAi = state.players.find((candidate) => candidate.id === ai.id)!;
''',
    "Clone Army draw continuation",
)
path.write_text(tests)
