import { spawnSync } from "node:child_process";

const executable = process.env.WRANGLER_BIN
  ? process.env.WRANGLER_BIN
  : process.platform === "win32" ? "npx.cmd" : "npx";
const prefix = process.env.WRANGLER_BIN ? [] : ["--no-install", "wrangler"];
const args = [
  ...prefix,
  "d1", "execute", "DB", "--remote", "--config", "wrangler.jsonc",
  "--yes", "--json",
  "--command", "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'user_data_entities'",
];

const command = spawnSync(executable, args, {
  cwd: process.cwd(),
  encoding: "utf8",
  env: { ...process.env, WRANGLER_WRITE_LOGS: "false" },
});
if (command.status !== 0) {
  process.stderr.write(command.stderr || command.stdout || "Could not query production D1 schema.\n");
  process.exit(1);
}

let response;
try {
  response = JSON.parse(command.stdout);
} catch {
  throw new Error("Wrangler returned an invalid JSON response while checking collection persistence.");
}
const payload = Array.isArray(response) ? response[0] : response;
const sql = payload?.results?.[0]?.sql;
if (typeof sql !== "string" || !sql.includes("'collection'")) {
  throw new Error(
    "Production D1 user_data_entities does not allow collection:main. " +
    "Apply migrations/0008_collection_entity.sql to the correct remote DB before deploying.",
  );
}
console.log("Production D1 collection entity schema verified.");
