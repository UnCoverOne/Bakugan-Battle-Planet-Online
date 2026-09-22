import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const clientDirectory = path.resolve("dist/client");
const entries = await readdir(clientDirectory, { recursive: true });
const files = entries.filter((name) => /\.(?:js|css)$/.test(name));
const sizes = await Promise.all(files.map(async (relativePath) => ({
  name: path.basename(relativePath),
  relativePath,
  size: (await stat(path.join(clientDirectory, relativePath))).size,
})));

const budgets = [
  { label: "shared page JavaScript", pattern: /^(?:page|index)-.*\.js$/, maximum: 360_000 },
  { label: "gameplay route JavaScript", pattern: /^GameplayRuntime-.*\.js$/, maximum: 170_000 },
  // Account identity, recovery, and administrator surfaces join the consolidated
  // production stylesheet. Preserve a strict ceiling with a small release buffer.
  { label: "global CSS", pattern: /^index[.-].*\.css$/, maximum: 260_000 },
];

let failed = false;
for (const budget of budgets) {
  const match = sizes.filter((entry) => budget.pattern.test(entry.name)).sort((left, right) => right.size - left.size)[0];
  if (!match) {
    console.error(`Bundle budget could not find ${budget.label}.`);
    failed = true;
    continue;
  }
  const okay = match.size <= budget.maximum;
  console.log(`${okay ? "PASS" : "FAIL"} ${budget.label}: ${match.size.toLocaleString()} / ${budget.maximum.toLocaleString()} bytes`);
  failed ||= !okay;
}

if (failed) process.exitCode = 1;
