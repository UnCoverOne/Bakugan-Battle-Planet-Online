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
  assert.match(
    archiveServer,
    /playback\.initialFrame\.label === "Recovered final battlefield"/,
  );
});

test("replay reconstruction preserves a best-effort prefix before using the emergency final battlefield", async () => {
  const archiveServer = await source("lib/replay-archive-server.ts");
  const bestEffort = await source("lib/engine/replay-best-effort.ts");

  assert.match(
    archiveServer,
    /buildBestEffortRecoveryArchive\(/,
  );
  assert.match(
    archiveServer,
    /"Replay gap — recovered final battlefield"/,
  );
  assert.match(
    archiveServer,
    /return fallback \?\? buildDisplayableReplayArchive\(null, state, completedAt\);/,
  );
  assert.match(
    bestEffort,
    /single damaged command to discard earlier valid frames/,
  );
});
