import { readFileSync, writeFileSync } from "node:fs";

const auditPath = new URL("../content/evo-character-relationships.audit.json", import.meta.url);
const targetPath = new URL("../content/evo-character-targets.json", import.meta.url);
const audit = JSON.parse(readFileSync(auditPath, "utf8"));
const entries = audit.relationships;
if (!Array.isArray(entries) || entries.length !== 336) {
  throw new Error("Expected all 336 audited Evo identities.");
}
const targets = {};
for (const relationship of entries) {
  if (Object.hasOwn(targets, relationship.evoId)) {
    throw new Error("Duplicate Evo ID " + relationship.evoId);
  }
  if (relationship.status !== "mapped_candidate" && relationship.status !== "cancelled_no_target") {
    throw new Error("Unreviewed Evo " + relationship.evoId + " cannot enter the runtime registry.");
  }
  if (relationship.status === "mapped_candidate" && !relationship.targetCharacterIds.length) {
    throw new Error("Mapped Evo has no target: " + relationship.evoId);
  }
  if (relationship.status === "cancelled_no_target" && relationship.targetCharacterIds.length) {
    throw new Error("Cancelled Evo has a target: " + relationship.evoId);
  }
  targets[relationship.evoId] = {
    targetCharacterIds: relationship.targetCharacterIds,
    requiresFusedFace: Boolean(relationship.requiresFusedFace),
    cancelled: relationship.status === "cancelled_no_target",
  };
}
const generated = JSON.stringify(targets, null, 2) + "\n";
if (process.argv.includes("--write")) {
  writeFileSync(targetPath, generated);
  console.log("Wrote " + entries.length + " Evo relationships to runtime registry.");
} else if (readFileSync(targetPath, "utf8") !== generated) {
  console.error("Runtime Evo target registry differs from the audit. Run: node scripts/generate-evo-targets.mjs --write");
  process.exitCode = 1;
} else {
  console.log("Runtime Evo target registry matches all " + entries.length + " audited Evos.");
}
