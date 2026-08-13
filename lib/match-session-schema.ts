type MatchSeatColumnRow = {
  name: string;
};

const MATCH_SESSION_COLUMNS = [
  {
    name: "capability_version",
    sql: "ALTER TABLE match_seats ADD COLUMN capability_version INTEGER NOT NULL DEFAULT 1",
  },
  {
    name: "controller_id",
    sql: "ALTER TABLE match_seats ADD COLUMN controller_id TEXT",
  },
  {
    name: "claimed_at",
    sql: "ALTER TABLE match_seats ADD COLUMN claimed_at INTEGER",
  },
] as const;

let matchSessionSchemaReady: Promise<void> | undefined;

async function matchSeatColumns(database: D1Database) {
  const response = await database.prepare("PRAGMA table_info('match_seats')").all<MatchSeatColumnRow>();
  return new Set((response.results ?? []).map((row) => row.name));
}

async function installMatchSessionSchema(database: D1Database) {
  await database.prepare(`CREATE TABLE IF NOT EXISTS match_seats (
    code TEXT NOT NULL,
    player_id TEXT NOT NULL,
    capability_hash TEXT NOT NULL,
    capability_version INTEGER NOT NULL DEFAULT 1,
    controller_id TEXT,
    claimed_at INTEGER,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (code, player_id),
    FOREIGN KEY (code) REFERENCES matches(code) ON DELETE CASCADE
  )`).run();
  const columns = await matchSeatColumns(database);

  for (const column of MATCH_SESSION_COLUMNS) {
    if (columns.has(column.name)) continue;
    try {
      await database.prepare(column.sql).run();
      columns.add(column.name);
    } catch (error) {
      // Another isolate may have installed the same column after our PRAGMA.
      // Re-read the schema before treating that race as a migration failure.
      if (!(await matchSeatColumns(database)).has(column.name)) throw error;
      columns.add(column.name);
    }
  }

  await database.prepare(`CREATE INDEX IF NOT EXISTS match_seats_controller_idx
    ON match_seats(code, player_id, capability_version, controller_id)`).run();
}

/**
 * Keep the Worker compatible with a database that is briefly one release
 * behind during deployment. The release pipeline still installs this schema
 * before promotion; this guard makes a missed migration self-healing.
 */
export async function ensureMatchSessionSchema(database: D1Database) {
  if (!matchSessionSchemaReady) {
    matchSessionSchemaReady = installMatchSessionSchema(database).catch((error) => {
      matchSessionSchemaReady = undefined;
      throw error;
    });
  }
  await matchSessionSchemaReady;
}
