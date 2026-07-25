import { readFile } from "node:fs/promises";
import { CONTROLLED_CATALOGUE, cardSetCode, validateControlledCatalogue } from "../lib/content/catalogue";
import { allRuleDefinitions, validateCardAgainstRules } from "../lib/rules/catalogue";
import { validateDefinitionProvenance } from "../lib/rules/provenance";

const legacyPath = new URL("../content/card-content.lock.json", import.meta.url);
const catalogueErrors = validateControlledCatalogue();
const definitionErrors: string[] = [];
for (const card of CONTROLLED_CATALOGUE) {
  try { validateCardAgainstRules({ ...card, id: card.id, catalogId: card.id }); }
  catch (error) { definitionErrors.push(error instanceof Error ? error.message : String(error)); }
}
for (const definition of allRuleDefinitions()) definitionErrors.push(...validateDefinitionProvenance(definition));

const legacy = JSON.parse(await readFile(legacyPath, "utf8")) as {
  cards: Array<{ cardId: string; textFingerprint: string }>;
};
const legacyIds = new Set(legacy.cards.map((entry) => entry.cardId));
const battleBrawlers = CONTROLLED_CATALOGUE.filter((card) => cardSetCode(card) === "BB");
if (battleBrawlers.length !== 374 || legacyIds.size !== 374 || battleBrawlers.some((card) => !legacyIds.has(card.id))) {
  definitionErrors.push("The Battle Brawlers legacy lock no longer covers its original 374 canonical IDs.");
}

if (catalogueErrors.length || definitionErrors.length) {
  throw new Error([...catalogueErrors, ...definitionErrors].join("\n"));
}

const counts = Object.fromEntries(["BB", "BR", "AA"].map((set) => [
  set,
  CONTROLLED_CATALOGUE.filter((card) => cardSetCode(card) === set).length,
]));
console.log(`Validated ${CONTROLLED_CATALOGUE.length} cards (${JSON.stringify(counts)}) and ${allRuleDefinitions().length} typed rule definitions.`);
if (process.argv.includes("--write")) {
  console.log("The Battle Brawlers legacy lock is preserved; BR/AA definitions are generated from the checked set-row sources.");
}
