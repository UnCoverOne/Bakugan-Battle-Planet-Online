import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { settleRankedSeries } from "../lib/ranked-server";

class D1StatementStub {
  constructor(private database: DatabaseSync, private sql: string, private values: unknown[] = []) {}
  bind(...values: unknown[]) { return new D1StatementStub(this.database, this.sql, values); }
  run() {
    const result = this.database.prepare(this.sql).run(...this.values as []);
    return Promise.resolve({ success: true, meta: { changes: Number(result.changes) } });
  }
  first<T>() { return Promise.resolve((this.database.prepare(this.sql).get(...this.values as []) as T | undefined) ?? null); }
  all<T>() { return Promise.resolve({ success: true, results: this.database.prepare(this.sql).all(...this.values as []) as T[] }); }
}

class D1DatabaseStub {
  readonly sqlite = new DatabaseSync(":memory:");
  prepare(sql: string) { return new D1StatementStub(this.sqlite, sql); }
  async batch(statements: D1StatementStub[]) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

test("Ranked settlement is idempotent and preserves total BP", async () => {
  const database = new D1DatabaseStub();
  database.sqlite.exec("CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL); INSERT INTO users (id) VALUES ('account-one'), ('account-two');");
  const input = {
    seriesId: "series-1",
    rulesetVersion: 3,
    playerOneUserId: "account-one",
    playerTwoUserId: "account-two",
    winnerUserId: "account-one",
    loserUserId: "account-two",
    score: "2–1",
  };
  const first = await settleRankedSeries(database as never, input);
  const duplicate = await settleRankedSeries(database as never, input);
  assert.deepEqual(duplicate, first);
  assert.equal(first.transfer, 12);

  const ratings = database.sqlite.prepare("SELECT user_id, bp, wins, losses FROM ranked_ratings ORDER BY user_id").all() as Array<{ user_id: string; bp: number; wins: number; losses: number }>;
  assert.equal(ratings.reduce((sum, rating) => sum + rating.bp, 0), 2_000);
  assert.deepEqual(ratings.map((rating) => ({ ...rating })), [
    { user_id: "account-one", bp: 1_012, wins: 1, losses: 0 },
    { user_id: "account-two", bp: 988, wins: 0, losses: 1 },
  ]);
  assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM ranked_rating_events").get()?.count, 1);
});
