import { readFile, writeFile } from "node:fs/promises";
import {
  createCardAuthoringBundle,
  emptyCardDraft,
  parseCardAuthoringBundle,
  serializeCardAuthoringBundle,
} from "../lib/content/card-authoring";
import { CONTROLLED_CATALOGUE } from "../lib/content/catalogue";

const [, , command, ...args] = process.argv;

function usage() {
  console.log(`Bakugan Battle Planet card authoring CLI

Usage:
  npm run card:author -- export <card-id> [output.json]
  npm run card:author -- scaffold <collector-number> [output.json]
  npm run card:author -- validate <input.json>
  npm run card:author -- patch <input.json>

The CLI generates review artifacts only. Production catalogue and typed-rule files still require a source-controlled change and the complete content lock gate.`);
}

async function emit(value: string, output?: string) {
  if (output) {
    await writeFile(output, value);
    console.log(`Wrote ${output}.`);
  } else process.stdout.write(value);
}

if (!command || command === "help" || command === "--help" || command === "-h") {
  usage();
} else if (command === "export") {
  const [cardId, output] = args;
  const card = CONTROLLED_CATALOGUE.find((candidate) => candidate.id === cardId);
  if (!card) throw new Error(`Unknown catalogue card ${cardId ?? "<missing>"}.`);
  await emit(serializeCardAuthoringBundle(createCardAuthoringBundle({ ...card }, card.id)), output);
} else if (command === "scaffold") {
  const [numberValue, output] = args;
  const number = Number(numberValue);
  if (!Number.isInteger(number) || number < 1) throw new Error("Collector number must be a positive integer.");
  await emit(serializeCardAuthoringBundle(createCardAuthoringBundle(emptyCardDraft(number))), output);
} else if (command === "validate" || command === "patch") {
  const [input] = args;
  if (!input) throw new Error(`${command} requires an input JSON file.`);
  const bundle = parseCardAuthoringBundle(await readFile(input, "utf8"));
  if (command === "patch") {
    await emit(`${JSON.stringify(bundle.patch, null, 2)}\n`);
  } else {
    for (const item of bundle.issues) console.log(`${item.severity.toUpperCase()} ${item.code} [${item.field}] ${item.message}`);
    const errors = bundle.issues.filter((item) => item.severity === "error");
    console.log(`${bundle.card.id}: ${errors.length} error(s), ${bundle.issues.filter((item) => item.severity === "warning").length} warning(s).`);
    if (errors.length) process.exitCode = 1;
  }
} else {
  usage();
  throw new Error(`Unknown card-authoring command ${command}.`);
}
