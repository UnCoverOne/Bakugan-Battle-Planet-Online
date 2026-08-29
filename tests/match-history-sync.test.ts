import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  matchHistoriesEqual,
  mergeMatchHistories,
} from "../lib/match-history-sync";
import type { MatchResultRecord } from "../lib/persistence";

const source = (path: string) => readFileSync(path, "utf8");

function record(
  id: string,
  at: string,
  opponent = id,
): MatchResultRecord {
  return {
    id,
    result: "Victor",
    opponent,
    score: "1–0",
    reason: "Cards",
    at,
  };
}

test("cross-device history merges records from both devices by match ID", () => {
  const local = [record("device-a", "2026-08-24T10:00:00.000Z")];
  const remote = [record("device-b", "2026-08-24T11:00:00.000Z")];

  assert.deepEqual(
    mergeMatchHistories(local, remote).map((item) => item.id),
    ["device-b", "device-a"],
  );
});

test("local duplicate records retain device-local replay metadata", () => {
  const remote = [{
    ...record("shared", "2026-08-24T10:00:00.000Z", "Remote copy"),
    replayStorage: "server" as const,
  }];
  const local = [{
    ...record("shared", "2026-08-24T10:00:00.000Z", "Local copy"),
    replayStorage: "local" as const,
  }];

  const merged = mergeMatchHistories(local, remote);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.opponent, "Local copy");
  assert.equal(merged[0]?.replayStorage, "local");
});

test("merged history keeps only the newest configured number of records", () => {
  const remote = Array.from({ length: 6 }, (_, index) =>
    record(
      `remote-${index}`,
      new Date(Date.UTC(2026, 7, 24, 10, index)).toISOString(),
    ),
  );
  const local = Array.from({ length: 6 }, (_, index) =>
    record(
      `local-${index}`,
      new Date(Date.UTC(2026, 7, 24, 11, index)).toISOString(),
    ),
  );

  const merged = mergeMatchHistories(local, remote, 10);
  assert.equal(merged.length, 10);
  assert.equal(merged[0]?.id, "local-5");
  assert.equal(merged.some((item) => item.id === "remote-0"), false);
  assert.equal(merged.some((item) => item.id === "remote-1"), false);
});

test("the server match archive is complete and account-scoped", () => {
  const route = source("app/api/user-data/history/route.ts");
  const accountData = source("lib/account-data-server.ts");
  const fullHistoryLoader = accountData
    .split("export async function loadAccountMatchHistory")[1]
    ?.split("export async function saveAccountMatchRecord")[0] ?? "";

  assert.match(route, /loadAccountMatchHistory\(await getDatabase\(\), user\.id\)/);
  assert.match(route, /saveAccountMatchRecord\([\s\S]*user\.id/);
  assert.match(route, /assertSameOrigin\(request\)/);
  assert.match(accountData, /PRIMARY KEY \(user_id, event_id\)/);
  assert.match(fullHistoryLoader, /FROM user_match_history WHERE user_id = \? ORDER BY occurred_at DESC/);
  assert.doesNotMatch(fullHistoryLoader, /LIMIT/);
  assert.doesNotMatch(
    accountData,
    /DELETE FROM user_match_history WHERE user_id = \? AND event_id NOT IN/,
  );
});

test("signed-in sessions push match records directly and refresh the archive globally", () => {
  const sync = source("components/application/AccountHistorySync.tsx");

  assert.match(sync, /fetch\("\/api\/user-data\/history", \{/);
  assert.match(sync, /method: "POST"/);
  assert.match(sync, /body: JSON\.stringify\(\{ record \}\)/);
  assert.match(sync, /HISTORY_REFRESH_INTERVAL_MS/);
  assert.doesNotMatch(sync, /usePathname|recordsRoute/);
  assert.doesNotMatch(sync, /syncNow/);
});

test("history equality prevents repeated state writes after convergence", () => {
  const history = [record("match", "2026-08-24T10:00:00.000Z")];
  assert.equal(matchHistoriesEqual(history, structuredClone(history)), true);
  assert.equal(
    matchHistoriesEqual(
      history,
      [record("other", "2026-08-24T10:00:00.000Z")],
    ),
    false,
  );
});
