import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { cachedResponse, invalidateResponse, peekResponse, publicDeckResponseKey } from "../lib/response-cache";
import { collectionIdentityIndex, frequencyMap } from "../lib/catalogue-index";
import { CARDS } from "../lib/data";
import { cardCollectionIds, collectionCards } from "../lib/collection";
import { assetRevisions } from "../scripts/asset-revisions.mjs";

test("indexed collection groups exactly match alternate printing and fusion face behavior", () => {
  const index = collectionIdentityIndex(CARDS);
  assert.deepEqual(index.representatives, collectionCards(CARDS));
  for (const card of index.representatives) assert.deepEqual(index.idsFor(card), cardCollectionIds(card, CARDS));
  assert.deepEqual([...frequencyMap(["a", "b", "a", "c", "b", "a"])], [["a", 3], ["b", 2], ["c", 1]]);
});

test("concurrent response requests share work and isolate viewers", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; return Response.json({ decks: [requests] }); };
  invalidateResponse("public-decks:");
  try {
    const key = publicDeckResponseKey("one");
    const [first, duplicate] = await Promise.all([cachedResponse(key, "/api/public-decks"), cachedResponse(key, "/api/public-decks")]);
    assert.strictEqual(first, duplicate);
    assert.strictEqual(await cachedResponse(key, "/api/public-decks"), first);
    assert.equal(requests, 1);
    assert.notDeepEqual(await cachedResponse(publicDeckResponseKey("two"), "/api/public-decks"), first);
    assert.equal(requests, 2);
  } finally { globalThis.fetch = original; invalidateResponse("public-decks:"); }
});

test("invalidation during an old request cannot replace a newer response", async () => {
  const original = globalThis.fetch;
  const resolvers: ((value: Response) => void)[] = [];
  globalThis.fetch = () => new Promise(resolve => resolvers.push(resolve));
  try {
    const old = cachedResponse("test-race", "/api/example");
    invalidateResponse("test-race");
    const newer = cachedResponse("test-race", "/api/example");
    resolvers[1](Response.json({ version: 2 }));
    await newer;
    resolvers[0](Response.json({ version: 1 }));
    await old;
    assert.deepEqual(peekResponse("test-race"), { version: 2 });
  } finally { globalThis.fetch = original; invalidateResponse("test-race"); }
});

test("failed refresh retains stale data and allows retry", async () => {
  const original = globalThis.fetch;
  invalidateResponse("test-failure");
  try {
    globalThis.fetch = async () => Response.json({ version: 1 });
    await cachedResponse("test-failure", "/api/example", -1);
    globalThis.fetch = async () => { throw new Error("offline"); };
    await assert.rejects(cachedResponse("test-failure", "/api/example"));
    assert.deepEqual(peekResponse("test-failure"), { version: 1 });
    globalThis.fetch = async () => Response.json({ version: 2 });
    assert.deepEqual(await cachedResponse("test-failure", "/api/example"), { version: 2 });
  } finally { globalThis.fetch = original; invalidateResponse("test-failure"); }
});

test("art revisions survive deployment changes and invalidate only changed directories", () => {
  const root = mkdtempSync(join(tmpdir(), "bbp-art-"));
  try {
    mkdirSync(join(root, "cards")); mkdirSync(join(root, "cores"));
    writeFileSync(join(root, "cards", "card.png"), "one");
    writeFileSync(join(root, "cores", "core.png"), "two");
    const first = assetRevisions(root);
    assert.deepEqual(assetRevisions(root), first);
    writeFileSync(join(root, "cards", "card.png"), "changed");
    const updated = assetRevisions(root);
    assert.notEqual(updated["/assets/cards"], first["/assets/cards"]);
    assert.equal(updated["/assets/cores"], first["/assets/cores"]);
  } finally { rmSync(root, { recursive: true }); }
});

test("worker activation preserves art while replacing the old application shell", async () => {
  let activate: ((event: { waitUntil: (promise: Promise<unknown>) => void }) => void) | undefined;
  const removed: string[] = [];
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), {
    URL, Headers, Response, Date,
    self: { location: new URL("https://game.test/sw.js?build=next"), clients: { claim: async () => {} }, addEventListener: (name: string, callback: typeof activate) => { if (name === "activate") activate = callback; } },
    caches: { keys: async () => ["bbp-shell-old", "bbp-shell-next", "bbp-art-v1"], delete: async (key: string) => { removed.push(key); } },
  });
  let done: Promise<unknown> | undefined;
  activate!({ waitUntil: promise => { done = promise; } });
  await done;
  assert.deepEqual(removed, ["bbp-shell-old"]);
});

function storedStateHarness(initialSaved: string | null = null) {
  const source = readFileSync("components/application/AppProvider.jsx", "utf8");
  const functionSource = source.slice(source.indexOf("function useStoredState("), source.indexOf('let appliedOverrideSignature'));
  type Effect = { deps: unknown[]; callback: () => (() => void) | void; cleanup?: () => void };
  const slots: unknown[] = [];
  const effects = new Map<number, Effect>();
  const queued = new Set<number>();
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const listeners = new Map<string, Set<() => void>>();
  let cursor = 0;
  let timerId = 0;
  let serialized = 0;
  let saved = initialSaved;
  let writes = 0;
  const useRef = (initial: unknown) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  };
  const sameDeps = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const useEffect = (callback: Effect["callback"], deps: unknown[]) => {
    const index = cursor++;
    const previous = effects.get(index);
    if (!previous || !sameDeps(previous.deps, deps)) { previous?.cleanup?.(); effects.set(index, { callback, deps }); queued.add(index); }
  };
  const addListener = (name: string, callback: () => void) => {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name)!.add(callback);
  };
  const removeListener = (name: string, callback: () => void) => listeners.get(name)?.delete(callback);
  const store = { getItem: () => saved, setItem: (_key: string, value: string) => { writes++; saved = value; }, removeItem: () => { saved = null; } };
  const context = vm.createContext({
    useRef, useEffect,
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (update: unknown) => { slots[index] = typeof update === "function" ? update(slots[index]) : update; }];
    },
    useCallback: (callback: unknown, deps: unknown[]) => {
      const index = cursor++;
      const previous = slots[index] as { callback: unknown; deps: unknown[] } | undefined;
      if (!previous || !sameDeps(previous.deps, deps)) slots[index] = { callback, deps };
      return (slots[index] as { callback: unknown }).callback;
    },
    setTimeout: (callback: () => void, delay: number) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id: number) => timers.delete(id),
    localStorage: store, sessionStorage: store,
    JSON: { parse: JSON.parse, stringify: (value: unknown) => { serialized++; return JSON.stringify(value); } },
    identityStoredValue: (value: unknown) => value,
    reportStorage: () => {}, Date,
    addEventListener: addListener, removeEventListener: removeListener,
    document: { visibilityState: "hidden", addEventListener: addListener, removeEventListener: removeListener },
  });
  vm.runInContext(functionSource, context);
  const hook = vm.runInContext("useStoredState", context) as (key: string, initial: number, options: { restoreEnabled?: boolean; writeEnabled?: boolean }) => [number, (value: number) => void, boolean];
  return {
    render: (options: { restoreEnabled?: boolean; writeEnabled?: boolean } = {}) => {
      cursor = 0;
      const result = hook("test", 0, options);
      for (const index of queued) { effects.get(index)!.cleanup = effects.get(index)!.callback() ?? undefined; }
      queued.clear();
      return result;
    },
    runTimers: (delay: number) => {
      for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); }
    },
    emit: (name: string) => listeners.get(name)?.forEach(callback => callback()),
    unmount: () => { for (const effect of effects.values()) effect.cleanup?.(); },
    get writes() { return writes; }, get serialized() { return serialized; }, get saved() { return saved; },
  };
}

test("storage coalesces serialization and immediately flushes the latest settled render on pagehide", () => {
  const harness = storedStateHarness();
  harness.render(); harness.runTimers(0);
  let state = harness.render();
  const baseline = harness.serialized;
  state[1](1); state = harness.render();
  state[1](2); state = harness.render();
  state[1](3); harness.render();
  assert.equal(harness.serialized, baseline);
  harness.emit("pagehide");
  assert.equal(harness.saved, "3");
  assert.equal(harness.writes, 1);
  harness.runTimers(500);
  assert.equal(harness.writes, 1);
});

test("deferred restoration waits for its route and cannot overwrite a newer explicit update", () => {
  const harness = storedStateHarness("7");
  let state = harness.render({ restoreEnabled: false });
  harness.runTimers(0);
  assert.equal(state[2], false);
  assert.equal(harness.serialized, 0);
  state = harness.render({ restoreEnabled: true });
  state[1](9);
  harness.runTimers(0);
  state = harness.render({ restoreEnabled: true });
  assert.equal(state[0], 9);
  harness.runTimers(500);
  assert.equal(harness.saved, "9");
});

test("deferred state restores the previous session when no explicit update intervenes", () => {
  const harness = storedStateHarness("7");
  harness.render({ restoreEnabled: false });
  harness.render({ restoreEnabled: true }); harness.runTimers(0);
  assert.equal(harness.render({ restoreEnabled: true })[0], 7);
});

test("disabling local writes cancels pending guest writes when the account scope changes", () => {
  const harness = storedStateHarness();
  harness.render(); harness.runTimers(0);
  const state = harness.render(); state[1](5);
  harness.render();
  harness.render({ writeEnabled: false });
  harness.emit("pagehide"); harness.runTimers(500);
  assert.equal(harness.writes, 0);
});

test("unmount flushes pending state and corrupted stored data remains untouched", () => {
  const harness = storedStateHarness();
  harness.render(); harness.runTimers(0);
  const state = harness.render(); state[1](4); harness.render(); harness.unmount();
  assert.equal(harness.saved, "4");
  const corrupted = storedStateHarness("invalid json");
  corrupted.render(); corrupted.runTimers(0);
  const brokenState = corrupted.render(); brokenState[1](8); corrupted.render();
  corrupted.emit("pagehide"); corrupted.runTimers(500);
  assert.equal(corrupted.saved, "invalid json");
  assert.equal(corrupted.writes, 0);
});

test("content-revision art caches survive builds and evict oldest entries within the storage bound", async () => {
  type FetchEvent = { request: Request; respondWith: (value: Promise<Response>) => void; waitUntil: (promise: Promise<unknown>) => void };
  const cachesByName = new Map<string, Map<string, Response>>();
  let networkRequests = 0;
  const cacheAPI = {
    open: async (name: string) => {
      if (!cachesByName.has(name)) cachesByName.set(name, new Map());
      const entries = cachesByName.get(name)!;
      return {
        keys: async () => [...entries.keys()].map(url => new Request(url)),
        match: async (request: Request) => entries.get(request.url)?.clone(),
        put: async (request: Request, response: Response) => { entries.set(request.url, response); },
        delete: async (request: Request) => entries.delete(request.url),
      };
    },
  };
  const art = new Map<string, Response>();
  cachesByName.set("bbp-art-v1", art);
  for (let i = 0; i < 620; i++) art.set(`https://game.test/assets/old-${i}.png?v=0123456789abcdef`, new Response("art", { headers: { "x-bbp-size": "200000" } }));
  const runWorker = (build: string) => {
    let fetchHandler: ((event: FetchEvent) => void) | undefined;
    vm.runInNewContext(readFileSync("public/sw.js", "utf8"), {
      URL, Headers, Response, Date,
      self: { location: new URL(`https://game.test/sw.js?build=${build}`), addEventListener: (name: string, handler: typeof fetchHandler) => { if (name === "fetch") fetchHandler = handler; } },
      caches: cacheAPI, fetch: async () => { networkRequests++; return new Response("new art"); },
    });
    return async (path: string) => {
      let response: Promise<Response> | undefined;
      const pending: Promise<unknown>[] = [];
      fetchHandler!({ request: new Request(`https://game.test${path}`), respondWith: value => { response = value; }, waitUntil: promise => pending.push(promise) });
      const result = await response;
      await Promise.all(pending);
      return result!;
    };
  };
  const first = runWorker("one");
  const path = "/assets/cards/new.png?v=0123456789abcdef";
  await first(path);
  assert.ok(art.size <= 600);
  assert.ok([...art.values()].reduce((sum, response) => sum + Number(response.headers.get("x-bbp-size")), 0) <= 64 * 1024 * 1024);
  assert.equal(art.has("https://game.test/assets/old-0.png?v=0123456789abcdef"), false);
  const second = runWorker("two");
  assert.equal(await (await second(path)).text(), "new art");
  assert.equal(networkRequests, 1);
  await first("/assets/logo.png");
  await second("/assets/logo.png");
  assert.equal(networkRequests, 3, "unversioned artwork remains build-scoped and refreshes after deployment");
});
