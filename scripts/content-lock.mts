import { readFile, writeFile } from "node:fs/promises";
import { CONTROLLED_CATALOGUE, CONTENT_MANIFEST, textFingerprint, validateControlledCatalogue } from "../lib/content/catalogue";
import { CURRENT_GAME_VERSION_PROFILE } from "../lib/content/versions";
import { allRuleDefinitions, validateCardAgainstRules } from "../lib/rules/catalogue";
import { validateDefinitionProvenance } from "../lib/rules/provenance";

const path = new URL("../content/card-content.lock.json", import.meta.url);
const definitions = allRuleDefinitions();
const catalogueErrors = validateControlledCatalogue();
const definitionErrors: string[] = [];
for (const card of CONTROLLED_CATALOGUE) {
  try { validateCardAgainstRules({ ...card, id: card.id, catalogId: card.id }); }
  catch (error) { definitionErrors.push(error instanceof Error ? error.message : String(error)); }
}
for (const definition of definitions) definitionErrors.push(...validateDefinitionProvenance(definition));
if (catalogueErrors.length || definitionErrors.length) {
  throw new Error([...catalogueErrors, ...definitionErrors].join("\n"));
}

const lock = {
  generatedBy: "scripts/content-lock.mts",
  versions: CURRENT_GAME_VERSION_PROFILE,
  manifest: CONTENT_MANIFEST,
  cards: definitions.map((definition) => ({
    cardId: definition.cardId,
    textFingerprint: definition.sourceTextFingerprint,
    implementationFingerprint: textFingerprint(JSON.stringify({ play: definition.play, abilities: definition.abilities })),
    provenanceSources: definition.provenance.citations.map((citation) => citation.sourceId),
    goldenTestId: `card-golden:${definition.cardId}`,
  })),
};
const serialized = `${JSON.stringify(lock, null, 2)}\n`;
if (process.argv.includes("--write")) {
  await writeFile(path, serialized);
  console.log(`Wrote ${lock.cards.length} card content locks.`);
} else {
  const current = await readFile(path, "utf8").catch(() => "");
  if (current !== serialized) throw new Error("Card content lock is stale. Run npm run content:lock and commit the result.");
  console.log(`Validated ${lock.cards.length} schema-controlled card records and typed implementations.`);
}
