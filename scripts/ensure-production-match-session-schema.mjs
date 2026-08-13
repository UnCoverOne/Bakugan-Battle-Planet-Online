import { spawnSync } from "node:child_process";

const database = "bakugan-battle-planet-online";
const config = "wrangler.jsonc";
const requiredColumns = [
  ["capability_version", "ALTER TABLE match_seats ADD COLUMN capability_version INTEGER NOT NULL DEFAULT 1"],
  ["controller_id", "ALTER TABLE match_seats ADD COLUMN controller_id TEXT"],
  ["claimed_at", "ALTER TABLE match_seats ADD COLUMN claimed_at INTEGER"],
];

const command = process.env.WRANGLER_BIN
  ? { executable: process.env.WRANGLER_BIN, prefix: [] }
  : process.platform === "win32"
    ? { executable: "npx.cmd", prefix: ["--no-install", "wrangler"] }
    : { executable: "npx", prefix: ["--no-install", "wrangler"] };

function execute(sql) {
  const result = spawnSync(command.executable, [
    ...command.prefix,
    "d1", "execute", database,
    "--remote",
    "--config", config,
    "--yes",
    "--json",
    "--command", sql,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, WRANGLER_WRITE_LOGS: "false" },
  });
  if (result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`Production D1 schema command failed with exit code ${result.status ?? "unknown"}.`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("Wrangler returned an invalid JSON response while preparing production D1.");
  }
}

function rows(response) {
  const first = Array.isArray(response) ? response[0] : response;
  return Array.isArray(first?.results) ? first.results : [];
}

execute(`CREATE TABLE IF NOT EXISTS match_seats (
  code TEXT NOT NULL,
  player_id TEXT NOT NULL,
  capability_hash TEXT NOT NULL,
  capability_version INTEGER NOT NULL DEFAULT 1,
  controller_id TEXT,
  claimed_at INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (code, player_id),
  FOREIGN KEY (code) REFERENCES matches(code) ON DELETE CASCADE
)`);

const existingColumns = new Set(rows(execute("PRAGMA table_info('match_seats')")).map((row) => row.name));
const installed = [];
for (const [name, sql] of requiredColumns) {
  if (existingColumns.has(name)) continue;
  execute(sql);
  installed.push(name);
}

execute(`CREATE INDEX IF NOT EXISTS match_seats_controller_idx
  ON match_seats(code, player_id, capability_version, controller_id)`);

console.log(installed.length
  ? `Production match-session schema installed: ${installed.join(", ")}.`
  : "Production match-session schema is current.");
