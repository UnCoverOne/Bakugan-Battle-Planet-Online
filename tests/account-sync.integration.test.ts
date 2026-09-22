import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChangedAccountSyncRequests,
  buildAccountSyncRequests,
  changedAccountEntityKeys,
  isAccountCacheDirty,
  readAccountCache,
  reconcileRemoteAccountState,
  resolveEntityConflicts,
  retryDelayMs,
  writeAccountCache,
} from "../lib/account-sync";
import {
  assembleEntitySnapshot,
  entityKey,
  revisionMap,
  snapshotToSyncRequest,
  type EntityRevisionMap,
  type UserDataEntityRow,
  type UserDataSyncRequest,
} from "../lib/user-data-entities";
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_BRAWLER_PROFILE,
  type UserSnapshot,
} from "../lib/persistence";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const snapshot = (name = "Brawler"): UserSnapshot => ({
  schemaVersion: 1,
  updatedAt: 1,
  profile: { ...DEFAULT_BRAWLER_PROFILE, name, signedIn: true },
  decks: [],
  deletedDecks: [],
  history: [],
  settings: { ...DEFAULT_APP_SETTINGS },
  route: "dashboard",
  selectedDeckId: "",
  builderDeck: null,
  deckQuery: "",
  compendiumQuery: "",
  compendiumTab: "cards",
  format: "bo1",
  matchMode: "solo",
  joinCode: "",
  match: null,
  online: false,
  selectedCore: "",
  logFilter: "all",
  replay: null,
  replayIndex: 0,
  playerId: "browser",
});

class EntityServer {
  rows = new Map<string, UserDataEntityRow>();
  conflictsRemaining = 0;
  delay: Promise<void> | null = null;

  payload() {
    const rows = [...this.rows.values()];
    return {
      revisions: revisionMap(rows),
      data: assembleEntitySnapshot(rows, []),
    };
  }

  async put(request: UserDataSyncRequest) {
    if (this.delay) await this.delay;
    if (this.conflictsRemaining > 0) {
      this.conflictsRemaining -= 1;
      return { status: 409, ...this.payload() };
    }
    const conflicts: string[] = [];
    for (const update of request.entities) {
      const key = entityKey(update.type, update.id);
      const current = this.rows.get(key);
      const dataJson = update.data == null ? null : JSON.stringify(update.data);
      const deletedAt = update.deletedAt ?? null;
      if (current && current.revision !== update.expectedRevision) {
        if (current.data_json !== dataJson || current.deleted_at !== deletedAt) {
          conflicts.push(key);
        }
        continue;
      }
      this.rows.set(key, {
        entity_type: update.type,
        entity_id: update.id,
        revision: (current?.revision ?? 0) + 1,
        data_json: dataJson,
        deleted_at: deletedAt,
        updated_at: Date.now(),
      });
    }
    return {
      status: conflicts.length ? 409 : 200,
      conflicts,
      ...this.payload(),
    };
  }
}

async function drainLatest(
  server: EntityServer,
  getSnapshot: () => UserSnapshot,
  getVersion: () => number,
  revisions: EntityRevisionMap,
) {
  let acknowledged = 0;
  let baseline: UserSnapshot | null = null;
  let attempts = 0;
  while (acknowledged < getVersion()) {
    if (++attempts > 12) throw new Error("sync did not converge");
    const target = getVersion();
    const current = getSnapshot();
    const request = JSON.parse(JSON.stringify(
      buildChangedAccountSyncRequests(current, baseline, revisions)[0],
    )) as UserDataSyncRequest;
    const result = await server.put(request);
    Object.assign(revisions, result.revisions);
    if (result.status === 409 && result.data) {
      const merged = resolveEntityConflicts(
        current,
        result.data,
        result.conflicts ?? request.entities.map((entity) => entityKey(entity.type, entity.id)),
      );
      Object.assign(current, merged);
      baseline = result.data;
      continue;
    }
    baseline = result.data;
    acknowledged = target;
  }
  return acknowledged;
}

test("offline account edits survive a browser close in a user-namespaced outbox", () => {
  const storage = new MemoryStorage();
  const local = snapshot();
  local.settings.highContrast = true;
  writeAccountCache(storage, {
    userId: "user-a",
    snapshot: local,
    pendingEntityKeys: ["settings:main"],
    acknowledgedHistoryIds: [],
    revisions: {},
    version: 3,
    acknowledgedVersion: 2,
  });

  const reopened = readAccountCache(storage, "user-a", snapshot());
  assert.equal(isAccountCacheDirty(reopened), true);
  assert.equal(reopened?.snapshot.settings.highContrast, true);
  assert.deepEqual(reopened?.pendingEntityKeys, ["settings:main"]);
  assert.equal(readAccountCache(storage, "user-b", snapshot()), null);
});

test("the outbox sends only entities changed since the cloud acknowledgement", () => {
  const baseline = snapshot("Remote profile");
  const local = structuredClone(baseline);
  local.settings.sound = false;
  local.updatedAt = 2;

  assert.deepEqual(changedAccountEntityKeys(local, baseline), ["settings:main"]);
  const request = buildChangedAccountSyncRequests(local, baseline, {})[0];
  assert.deepEqual(
    request.entities.map((entity) => entityKey(entity.type, entity.id)),
    ["settings:main"],
  );
  assert.equal(request.entities.some((entity) => entity.type === "profile"), false);
  assert.deepEqual(request.history, []);
});

test("an unchanged account snapshot does not send an empty sync request", () => {
  const current = snapshot("Already saved");
  assert.deepEqual(buildChangedAccountSyncRequests(current, structuredClone(current), {}), []);
});

test("conflict resolution preserves only the locally conflicting entities", () => {
  const local = snapshot("Old profile");
  local.settings.sound = false;
  local.updatedAt = 4;
  const remote = snapshot("Updated on another device");
  remote.settings.sound = true;
  remote.updatedAt = 3;

  const resolved = resolveEntityConflicts(local, remote, ["settings:main"]);
  assert.equal(resolved.profile.name, "Updated on another device");
  assert.equal(resolved.settings.sound, false);
});

test("successful unrelated sync adopts a newer remote collection instead of re-uploading stale state", () => {
  const requestState = snapshot();
  requestState.collection = {
    "bb-1": { standard: 1, foil: 0, wishlist: 0 },
  };
  requestState.settings.sound = false;

  const remote = structuredClone(requestState);
  remote.collection = {
    "bb-1": { standard: 4, foil: 0, wishlist: 0 },
  };
  remote.updatedAt = 10;

  const reconciled = reconcileRemoteAccountState(requestState, remote, []);
  assert.equal(reconciled.collection?.["bb-1"].standard, 4);

  reconciled.profile.name = "Edited after sync";
  const changed = changedAccountEntityKeys(reconciled, remote);
  assert.deepEqual(changed, ["profile:main"]);
  assert.equal(changed.includes("collection:main"), false);
});

test("remote reconciliation keeps local history created while a save is in flight", () => {
  const local = snapshot();
  local.history = [{
    id: "local-result",
    result: "Victor",
    opponent: "Mira",
    score: "1–0",
    reason: "Cards",
    at: "2026-09-18T08:05:00.000Z",
    log: [],
  }];
  const remote = snapshot();

  const reconciled = reconcileRemoteAccountState(local, remote, []);
  assert.deepEqual(reconciled.history.map((record) => record.id), ["local-result"]);
});

test("collection conflicts merge local counter deltas onto the remote collection", () => {
  const baseline = snapshot();
  baseline.collection = {
    "bb-1": { standard: 1, foil: 0, wishlist: 0 },
    "bb-2": { standard: 1, foil: 0, wishlist: 0 },
  };

  const local = structuredClone(baseline);
  local.collection!["bb-1"].standard = 2;
  local.updatedAt = 3;

  const remote = structuredClone(baseline);
  remote.collection!["bb-2"].standard = 2;
  remote.updatedAt = 4;

  const resolved = resolveEntityConflicts(
    local,
    remote,
    ["collection:main"],
    baseline,
  );

  assert.equal(resolved.collection?.["bb-1"].standard, 2);
  assert.equal(resolved.collection?.["bb-2"].standard, 2);
});

test("a delayed write drains an edit made while the first request is in flight", async () => {
  const server = new EntityServer();
  let release!: () => void;
  server.delay = new Promise<void>((resolve) => { release = resolve; });
  const local = snapshot("First");
  let version = 1;
  const revisions: EntityRevisionMap = {};
  const draining = drainLatest(server, () => local, () => version, revisions);

  local.profile.name = "Second";
  local.updatedAt = 2;
  version = 2;
  release();
  server.delay = null;

  assert.equal(await draining, 2);
  assert.equal(server.payload().data?.profile.name, "Second");
});

test("repeated conflicts adopt each latest revision and converge", async () => {
  const server = new EntityServer();
  await drainLatest(server, () => snapshot("Remote"), () => 1, {});
  server.conflictsRemaining = 3;
  const local = snapshot("Local");
  local.updatedAt = 2;
  const revisions: EntityRevisionMap = {};

  assert.equal(
    await drainLatest(server, () => local, () => 1, revisions),
    1,
  );
  assert.equal(server.payload().data?.profile.name, "Local");
  assert.equal(revisions["profile:main"], 2);
});

test("deck tombstones remain independent from settings and prevent restoration", async () => {
  const server = new EntityServer();
  const local = snapshot();
  local.settings.sound = false;
  local.deletedDecks = [
    { id: "old-deck", deletedAt: "2026-07-31T09:00:00.000Z" },
  ];

  await drainLatest(server, () => local, () => 1, {});
  const payload = server.payload().data;
  assert.equal(payload?.settings.sound, false);
  assert.deepEqual(payload?.decks, []);
  assert.deepEqual(payload?.deletedDecks, local.deletedDecks);
});

test("an incomplete Training match round-trips through the account preferences entity", async () => {
  const server = new EntityServer();
  const local = snapshot();
  local.updatedAt = 2;
  local.playerId = "training-player";
  local.match = {
    id: "training-series",
    version: 11,
    phase: "draw",
    players: [{ id: "training-player" }, { id: "training-bot" }],
    trainingAiDeck: { resourceId: "training-default", configurationRevision: 4 },
  } as UserSnapshot["match"];

  await drainLatest(server, () => local, () => 1, {});

  const recovered = server.payload().data;
  assert.equal(recovered?.match?.id, "training-series");
  assert.equal(recovered?.match?.version, 11);
  assert.equal(recovered?.online, false);
  assert.equal(recovered?.playerId, "training-player");
});

test("a completed Training tombstone wins a preferences conflict and cannot be resurrected", () => {
  const activeTrainingMatch = {
    id: "training-series",
    version: 11,
    phase: "draw",
    players: [{ id: "training-player" }, { id: "training-bot" }],
    trainingAiDeck: { resourceId: "training-default", configurationRevision: 4 },
  } as UserSnapshot["match"];

  const staleDesktop = snapshot();
  staleDesktop.updatedAt = 20;
  staleDesktop.selectedDeckId = "desktop-choice";
  staleDesktop.playerId = "training-player";
  staleDesktop.match = activeTrainingMatch;

  const completedRemote = snapshot();
  completedRemote.updatedAt = 30;
  completedRemote.playerId = "";
  completedRemote.match = null;
  completedRemote.completedTrainingMatchIds = ["training-series"];

  const resolved = resolveEntityConflicts(
    staleDesktop,
    completedRemote,
    ["preferences:main"],
  );

  assert.equal(resolved.selectedDeckId, "desktop-choice");
  assert.equal(resolved.match, null);
  assert.equal(resolved.playerId, "");
  assert.deepEqual(resolved.completedTrainingMatchIds, ["training-series"]);

  const preferences = snapshotToSyncRequest(resolved, {}).entities.find(
    (entity) => entity.type === "preferences" && entity.id === "main",
  );
  assert.ok(preferences?.data && typeof preferences.data === "object");
  assert.equal((preferences.data as Record<string, unknown>).activeTrainingMatch, null);
  assert.deepEqual(
    (preferences.data as Record<string, unknown>).completedTrainingMatchIds,
    ["training-series"],
  );
});


test("rate-limit retry uses bounded backoff", () => {
  assert.equal(retryDelayMs(0), 1_000);
  assert.equal(retryDelayMs(10), 60_000);
  assert.equal(retryDelayMs(0, 7), 7_000);
});

test("oversized account snapshots are split into independently retryable batches", () => {
  const local = snapshot();
  local.profile.avatar = `data:image/png;base64,${"A".repeat(700_000)}`;
  local.history = Array.from({ length: 8 }, (_, index) => ({
    id: `match-${index}`,
    result: "Victor",
    opponent: "Mira",
    score: "1–0",
    reason: "Cards",
    at: new Date(1_700_000_000_000 + index).toISOString(),
    log: [{ message: "x".repeat(100_000) }] as never,
  }));
  const batches = buildAccountSyncRequests(local, {}, 750_000);

  assert.ok(batches.length > 1);
  assert.ok(
    batches.every(
      (batch) => new TextEncoder().encode(JSON.stringify(batch)).byteLength < 1_000_000,
    ),
  );
});
