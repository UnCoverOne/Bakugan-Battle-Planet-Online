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

function replacePattern(path, pattern, replacement) {
  const source = readFileSync(path, "utf8");
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length !== 1) {
    throw new Error(`${path}: expected one pattern match, found ${matches.length}`);
  }
  writeFileSync(path, source.replace(pattern, replacement));
}

replaceOnce(
  "components/game-screen-v2/PhaseTransitionLayer.tsx",
  'import { useMatchSelector } from "./matchStore";\n',
  'import { useMatchSelector } from "./matchStore";\nimport { PhaseTransitionStepIcon } from "./PhaseTransitionStepIcon";\n',
);

replaceOnce(
  "components/game-screen-v2/PhaseTransitionLayer.tsx",
  `        <div className={\`${"${styles.callout} ${cueStyles.callout}"}\`}>
          <span className={styles.glyph}>{transition.stepGlyph}</span>
          <span className={styles.copy}>
            <small>
              {transition.scope === "round" ? \`Round ${"${transition.round}"} • \` : ""}
              {transition.phaseLabel} Phase
            </small>
            <strong>{transition.stepLabel} Step</strong>
            <em className={cueStyles.hint}>{plan.hint}</em>
          </span>
        </div>`,
  `        <div className={\`${"${styles.callout} ${cueStyles.callout}"}\`}>
          <span className={styles.glyph} aria-hidden="true">
            <PhaseTransitionStepIcon
              step={transition.stepKey}
              className={styles.glyphIcon}
            />
          </span>
          <span className={styles.copy}>
            <small>{transition.phaseLabel} Phase</small>
            <strong>{transition.stepLabel} Step</strong>
          </span>
        </div>`,
);

replacePattern(
  "components/game-screen-v2/PhaseTransitionLayer.module.css",
  /\.glyph \{[\s\S]*?\n\}/,
  `.glyph {
  display: grid;
  place-items: center;
  width: clamp(2.3rem, 4vw, 4rem);
  aspect-ratio: 1;
  clip-path: polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%);
  background: linear-gradient(145deg, rgba(255, 96, 78, 0.96), rgba(112, 16, 24, 0.98));
  color: #fff;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28);
}

.glyphIcon {
  display: block;
  width: 72%;
  height: 72%;
}`,
);

replaceOnce(
  "components/game-screen-v2/PhaseTransitionLayer.module.css",
  `.copy {
  display: grid;
  gap: 0.08rem;
  min-width: 0;
  text-transform: uppercase;
}`,
  `.copy {
  display: grid;
  gap: 0.14rem;
  min-width: 0;
  text-align: left;
  text-transform: uppercase;
}`,
);

replaceOnce(
  "components/game-screen-v2/PhaseTransitionLayer.module.css",
  "  font-style: italic;\n",
  "  font-style: normal;\n",
);

replacePattern(
  "components/game-screen-v2/PhaseTransitionCues.module.css",
  /\n\.hint \{[\s\S]*?\n\}\n/,
  "\n",
);

replaceOnce(
  "tests/roll-phase-presentation.test.ts",
  'import test from "node:test";\n',
  'import test from "node:test";\nimport { PHASE_TRANSITION_ICON_KEY_BY_STEP } from "../components/game-screen-v2/PhaseTransitionStepIcon";\n',
);

replaceOnce(
  "tests/roll-phase-presentation.test.ts",
  `test("Tips stay hidden while Roll Results or the Brawl Preview is visible", () => {
  assert.equal(phaseTransitionIsBlocked(true, false, false), true);
  assert.equal(phaseTransitionIsBlocked(false, true, false), true);
  assert.equal(phaseTransitionIsBlocked(false, false, true), true);
  assert.equal(phaseTransitionIsBlocked(false, false, false), false);
});
`,
  `test("Tips stay hidden while Roll Results or the Brawl Preview is visible", () => {
  assert.equal(phaseTransitionIsBlocked(true, false, false), true);
  assert.equal(phaseTransitionIsBlocked(false, true, false), true);
  assert.equal(phaseTransitionIsBlocked(false, false, true), true);
  assert.equal(phaseTransitionIsBlocked(false, false, false), false);
});

test("Phase Transition callouts use official game icons for every step", () => {
  assert.deepEqual(PHASE_TRANSITION_ICON_KEY_BY_STEP, {
    draw: "draw",
    energize: "energy",
    selection: "scan",
    rolling: "reroll",
    power: "power",
    victor: "victor",
    damage: "damage",
    retracting: "remove",
    play: "draw",
    charge: "energy",
    reset: "reroll",
  });
});
`,
);

console.log("Simplified the central Phase Transition callout and replaced glyphs with official game icons.");
