import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("completed-match replay construction falls back to retained snapshots before final-only recovery", async () => {
  const archiveServer = await source("lib/replay-archive-server.ts");

  assert.match(
    archiveServer,
    /import \{ buildReplayArchiveFromSnapshotHistory \} from "\.\/replay-snapshot-recovery";/,
  );
  assert.match(
    archiveServer,
    /const recovered = await buildReplayArchiveFromSnapshotHistory\(database, state, completedAt\);/,
  );
  assert.match(
    archiveServer,
    /if \(!isFinalBattlefieldFallbackReplay\(archive\)\) return archive;\s+return recoverReplayFromSnapshotsOrFinalState\(/,
  );
  assert.match(
    archiveServer,
    /return recoverReplayFromSnapshotsOrFinalState\(database, state, completedAt, error\.message\);/,
  );
});

test("snapshot recovery failure remains non-fatal and preserves an emergency final battlefield", async () => {
  const archiveServer = await source("lib/replay-archive-server.ts");

  assert.match(
    archiveServer,
    /catch \(error\) \{[\s\S]*?Replay snapshot recovery failed; preserving the final battlefield fallback\./,
  );
  assert.match(
    archiveServer,
    /return buildDisplayableReplayArchive\(null, state, completedAt\);/,
  );
});
