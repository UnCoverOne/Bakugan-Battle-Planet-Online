import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { compendiumLocation, compendiumSectionHref, isCompendiumSectionChange } from "../lib/compendium-navigation";
import { createAppStateStore, selectAppFields } from "../lib/app-state-store";

const source = (path: string) => readFileSync(path, "utf8");

test("unrelated account and match updates retain the browser subscription snapshot", () => {
  const collection = { owned: 1 };
  const store = createAppStateStore({ collection, match: { version: 1 }, toast: "", account: "Emma" });
  const browser = selectAppFields(store.getSnapshot, ["collection", "account"]);
  const first = browser();
  let notifications = 0;
  const unsubscribe = store.subscribe(() => { notifications++; });
  store.publish({ ...store.getSnapshot(), match: { version: 2 }, toast: "Saved" });
  assert.strictEqual(browser(), first);
  store.publish({ ...store.getSnapshot(), collection: { owned: 2 } });
  assert.notStrictEqual(browser(), first);
  assert.equal(browser().collection.owned, 2);
  assert.equal(notifications, 2);
  unsubscribe();
  store.publish({ ...store.getSnapshot(), account: "Other account" });
  assert.equal(notifications, 2);
  assert.equal(browser().account, "Other account");
  const otherStore = createAppStateStore({ account: "Guest" });
  assert.equal(otherStore.getSnapshot().account, "Guest");
});

function serviceWorkerHarness() {
  type FetchEvent = {
    request: Request;
    respondWith: (response: Promise<Response>) => void;
    waitUntil: (pending: Promise<unknown>) => void;
  };
  const handlers = new Map<string, (event: FetchEvent) => void>();
  const entries = new Map<string, Response>();
  let fetches = 0;
  let fail = false;
  const cache = {
    match: async (request: Request) => entries.get(request.url)?.clone(),
    put: async (request: Request, response: Response) => { entries.set(request.url, response); },
    keys: async () => [...entries.keys()].map(url => new Request(url)),
    delete: async (request: Request) => entries.delete(request.url),
  };
  vm.runInNewContext(source("public/sw.js"), {
    URL, Headers, Response, Date,
    self: { location: new URL("https://game.test/sw.js?build=test"), addEventListener: (name: string, callback: (event: FetchEvent) => void) => handlers.set(name, callback) },
    caches: { open: async () => cache },
    fetch: async () => {
      fetches++;
      if (fail) throw new Error("Offline");
      return new Response("fresh artwork");
    },
  });
  return {
    entries,
    get fetches() { return fetches; },
    goOffline() { fail = true; },
    request: async (path: string) => {
      let response: Promise<Response> | undefined;
      const pending: Promise<unknown>[] = [];
      handlers.get("fetch")!({ request: new Request(`https://game.test${path}`), respondWith: (value: Promise<Response>) => { response = value; }, waitUntil: (value: Promise<unknown>) => pending.push(value) });
      const result = await response;
      await Promise.all(pending);
      return result;
    },
  };
}

test("cached fingerprinted scripts require no network request and remain usable offline", async () => {
  const sw = serviceWorkerHarness();
  await sw.request("/_next/static/chunks/page-HASH.js");
  sw.goOffline();
  assert.equal(await (await sw.request("/_next/static/chunks/page-HASH.js"))!.text(), "fresh artwork");
  assert.equal(sw.fetches, 1);
});

test("fresh artwork stays cached, while stale artwork revalidates without delaying its display", async () => {
  const sw = serviceWorkerHarness();
  const path = "/assets/cards/example.png";
  await sw.request(path);
  await sw.request(path);
  assert.equal(sw.fetches, 1);
  sw.entries.set(`https://game.test${path}`, new Response("old artwork", { headers: { "x-bbp-cached-at": String(Date.now() - 8 * 86400_000) } }));
  const cached = await sw.request(path);
  assert.equal(await cached!.text(), "old artwork");
  assert.equal(sw.fetches, 2);
  assert.equal(await sw.entries.get(`https://game.test${path}`)!.clone().text(), "fresh artwork");
  sw.goOffline();
  sw.entries.set(`https://game.test${path}`, new Response("offline artwork"));
  assert.equal(await (await sw.request(path))!.text(), "offline artwork");
});

test("binary hero and font reproduce the exact original asset bytes", () => {
  const fontParts = ["01", "02a", "02b", "02c", "02d", "02e", "02f", "02g", "03", "04"];
  const heroParts = ["01", "02", "03", "04", "05", "06"];
  for (const [folder, filename, parts] of [["hero-pyrus-960", "hero-pyrus-960.avif", heroParts], ["rbno31-bold-italic", "rbno31-bold-italic.woff2", fontParts]] as const) {
    const original = Buffer.from(parts.map((part) => source(`public/assets/home/${folder}/part-${part}.txt`).trim()).join(""), "base64");
    assert.deepEqual(readFileSync(`public/assets/home/${filename}`), original);
  }
});

test("local compendium controls and section tabs avoid server navigation", () => {
  const browser = source("components/routes/CompendiumScreen.tsx");
  assert.match(browser, /window\.history\[method === "push" \? "pushState" : "replaceState"\]/);
  assert.match(browser, /startTransition\(\(\) => window\.history\.replaceState/);
  assert.doesNotMatch(browser, /router\[method\]/);
  assert.match(browser, /window\.history\.pushState\(null, "", compendiumSectionHref/);
  assert.doesNotMatch(browser, /router\.(push|replace)/);
  assert.match(browser, /compendiumLocation\(pathname, segments\)/);
});


test("Compendium pathname overrides stale server segments across direct links and history entries", () => {
  for (const section of ["cards", "cores", "rules", "rulings"] as const) {
    const href = compendiumSectionHref(section, "Fire & Ice / 水");
    const url = new URL(href, "https://game.test");
    assert.equal(compendiumLocation(url.pathname, ["cards", "old-inspector"]).section, section);
    assert.equal(new URLSearchParams(url.search).get("q"), "Fire & Ice / 水");
    assert.deepEqual([...url.searchParams.keys()], ["q"]);
  }
  assert.deepEqual(compendiumLocation(null, ["cores"]), { section: "cores", legacyDetail: "" });
  assert.equal(compendiumLocation("/compendium/cards/ice%20wall").legacyDetail, "ice wall");
  assert.doesNotThrow(() => compendiumLocation("/compendium/cards/bad%escape"));
  assert.equal(compendiumSectionHref("cards", ""), "/compendium");
});

test("local section transitions retain focus while genuine workspace navigation still receives focus", () => {
  assert.equal(isCompendiumSectionChange("/compendium", "/compendium/cores"), true);
  assert.equal(isCompendiumSectionChange("/compendium/rules", "/compendium/rulings"), true);
  assert.equal(isCompendiumSectionChange("/decks", "/compendium"), false);
  assert.equal(isCompendiumSectionChange("/compendium", "/decks"), false);
  assert.equal(isCompendiumSectionChange(null, "/compendium"), false);
  assert.equal(isCompendiumSectionChange("/compendium", "/compendium"), false);
  const browser = source("components/routes/CompendiumScreen.tsx");
  assert.match(browser, /if \(next === section\) return/);
  assert.match(browser, /window\.clearTimeout\(searchTimerRef\.current\)/);
  assert.match(browser, /if \(section !== "cards" \|\| searchQuery !== state\.q\) return/);
  assert.match(browser, /if \(!localSearchEditRef\.current \|\| searchQuery === currentQuery\) return/);
});

test("mobile scroll treatment avoids fixed background repaints and bottom-bar blurring", () => {
  const css = source("app/navigation-motion.css");
  assert.match(css, /background-attachment:\s*scroll/);
  assert.match(css, /\.mobile-bottom-nav[\s\S]*backdrop-filter:\s*none/);
});

test("builder artwork memo invalidates on catalogue updates and retains full scans", () => {
  const builder = source("components/routes/DeckBuilderScreen.tsx");
  const cardArt = source("components/cards/ResponsiveCardImage.tsx");
  assert.match(builder, /const MemoizedBuilderGalleryArtwork = memo/);
  assert.match(builder, /catalogueRevision=\{catalogueRevision\}/);
  assert.match(builder, /<ResponsiveCardImage card=\{card\} presentation="tile"/);
  assert.match(cardArt, /const full = cardArtSource\(card, "full"\)/);
  assert.match(cardArt, /: full;/);
});
