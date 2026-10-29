// The default regression suite excludes only documented legacy failures.
// Add new tests under tests/*.test.ts; they are discovered automatically.
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const reasons = JSON.parse(readFileSync(new URL("../tests/quarantine.json", import.meta.url), "utf8"));
const files = readdirSync(new URL("../tests/", import.meta.url))
  .filter((name) => name.endsWith(".test.ts"))
  .sort();
const known = new Set(files);
for (const name of Object.keys(reasons)) {
  if (!known.has(name)) {
    console.error("Quarantined test file no longer exists:", name);
    process.exit(1);
  }
}
const all = process.argv.includes("--all");
const quarantinedOnly = process.argv.includes("--quarantined");
const selected = files.filter((name) => (
  all || (quarantinedOnly ? Object.hasOwn(reasons, name) : !Object.hasOwn(reasons, name))
));
if (selected.length === 0) {
  console.error("No test files selected.");
  process.exit(1);
}
console.log("Regression inventory: " + files.length + " Node files; " + selected.length
  + " selected; " + Object.keys(reasons).length + " quarantined.");
const child = spawnSync(process.execPath, [
  "--import", "tsx", "--test", "--test-concurrency=4",
  ...selected.map((name) => "tests/" + name),
], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});
if (child.error) console.error(child.error);
process.exit(child.status ?? 1);
