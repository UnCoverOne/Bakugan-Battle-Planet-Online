import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, before, after) {
  const source = readFileSync(path, "utf8");
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${path}: expected source block was not found`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${path}: expected source block was not unique`);
  }
  writeFileSync(path, source.slice(0, first) + after + source.slice(first + before.length));
}

replaceOnce(
  "components/game-screen-v2/BakuCoreLayer.tsx",
  '  const [tracingSignature, setTracingSignature] = useState("");',
  '  const [completedTraceSignature, setCompletedTraceSignature] = useState("");',
);

replaceOnce(
  "components/game-screen-v2/BakuCoreLayer.tsx",
  `  useLayoutEffect(() => {
    if (!rollResultOpen || !resultSignature || !hasRollPaths) {
      setTracingSignature("");
      return;
    }
    setTracingSignature(resultSignature);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timeout = window.setTimeout(
      () => setTracingSignature((current) => current === resultSignature ? "" : current),
      reducedMotion ? 40 : ROLL_TRACE_DURATION_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [rollResultOpen, resultSignature, hasRollPaths]);

  const tracingRoll = rollResultOpen
    && hasRollPaths
    && tracingSignature === resultSignature;`,
  `  // Derive the trace synchronously from a new authoritative result signature.
  // The result dialog therefore never receives an open frame before the trace starts.
  const tracingRoll = Boolean(
    rollResultOpen
    && hasRollPaths
    && resultSignature
    && completedTraceSignature !== resultSignature
  );

  useEffect(() => {
    if (!tracingRoll || !resultSignature) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timeout = window.setTimeout(
      () => setCompletedTraceSignature(resultSignature),
      reducedMotion ? 40 : ROLL_TRACE_DURATION_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [tracingRoll, resultSignature]);`,
);

replaceOnce(
  "components/game-screen-v2/BakuCoreLayer.tsx",
  '      <rect className={styles.rollTraceVeil} width={GRID_WIDTH} height={GRID_HEIGHT} />',
  `      <rect
        className={styles.rollTraceVeil}
        x={-GRID_WIDTH}
        y={-GRID_HEIGHT * 2}
        width={GRID_WIDTH * 3}
        height={GRID_HEIGHT * 5}
      />`,
);

replaceOnce(
  "tests/presentation-stability.test.ts",
  `  assert.match(cores, /preparedTransferCells/);
  assert.match(cores, /data-active=\\{active/);`,
  `  assert.match(cores, /preparedTransferCells/);
  assert.match(cores, /data-active=\\{active/);
  assert.match(cores, /completedTraceSignature !== resultSignature/);
  assert.doesNotMatch(cores, /\\[tracingSignature,/);
  assert.match(cores, /y=\\{-GRID_HEIGHT \\* 2\\}/);
  assert.match(cores, /height=\\{GRID_HEIGHT \\* 5\\}/);`,
);

console.log("Applied synchronous roll trace gating and expanded the mobile trace veil.");
