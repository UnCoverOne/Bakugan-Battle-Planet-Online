import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { hasClientVersionMismatch } from "../lib/client-status";

const source = (path: string) => readFileSync(path, "utf8");

test("Profile and Settings own their presentation through shared primitives", () => {
  for (const route of ["ProfileScreen", "SettingsScreen"]) {
    assert.equal(existsSync(`components/routes/${route}.module.css`), true);
    const implementation = source(`components/routes/${route}.tsx`);
    assert.match(
      implementation,
      new RegExp(`import styles from ["']\\.\\/${route}\\.module\\.css["']`),
    );
    if (route === "SettingsScreen") assert.match(implementation, /RouteHero/);
    assert.match(implementation, /Surface/);
    assert.match(implementation, /StatusChip/);
    assert.doesNotMatch(implementation, /className=["']panel/);
  }
});

test("Profile presents customizable identity, reliable statistics, and selected showcases", () => {
  const profile = [
    source("components/routes/ProfileScreen.tsx"),
    source("components/profile/BrawlerProfileView.tsx"),
    source("lib/public-profile.ts"),
  ].join("\n");
  for (const contract of [
    "Edit picture",
    "Edit title",
    "Edit cover",
    "Win Rate",
    "Games Won",
    "Games Played",
    "Showcased Achievements",
    "Public Decks",
  ])
    assert.match(profile, new RegExp(contract));
  assert.match(profile, /validateDeck\(deck\)\.isLegal/);
  assert.match(profile, /profile\.showcaseAchievementIds/);
  assert.match(profile, /profile\.showcaseDeckIds/);
  assert.doesNotMatch(profile, />Edit identity</);
});

test("Settings uses immediate feedback and isolates destructive actions", () => {
  const settings = source("components/routes/SettingsScreen.tsx");
  for (const category of [
    "Account",
    "Gameplay",
    "Audio & visual",
    "Accessibility",
    "Data & sync",
    "Privacy",
    "Danger zone",
  ]) {
    assert.match(settings, new RegExp(category.replace(/[&]/g, "\\&")));
  }
  assert.match(settings, /aria-live="polite"/);
  assert.match(settings, /Reduced motion/);
  assert.match(settings, /Export local data/);
  assert.match(settings, /ConfirmationDialog/);
  assert.doesNotMatch(settings, /SyncConflictPanel/);
  assert.doesNotMatch(settings, /window\.confirm/);
  assert.doesNotMatch(settings, /localStorage\.clear/);
});

test("system states cover route and distributed-data failures", () => {
  const states = source("components/application/SystemState.tsx");
  for (const tone of [
    "loading",
    "offline",
    "error",
    "empty",
    "version",
    "conflict",
    "notFound",
  ]) {
    assert.match(states, new RegExp(`${tone}:`));
  }
  assert.match(states, /data-ui="system-state"/);
  assert.doesNotMatch(states, /data-ui="sync-conflict"/);
  assert.doesNotMatch(states, /Choose which account data to keep/);
  assert.match(states, /Cancel/);
  assert.match(
    source("components/AssetFreshness.tsx"),
    /VERSION_MISMATCH_EVENT/,
  );
  assert.match(
    source("components/application/AppShell.jsx"),
    /VersionMismatchScreen/,
  );
});

test("workspace boundaries use the shared system-state composition", () => {
  for (const path of [
    "app/(workspace)/loading.tsx",
    "app/(workspace)/error.tsx",
    "app/(workspace)/not-found.tsx",
  ]) {
    assert.match(source(path), /SystemState/);
  }
  assert.match(source("app/(workspace)/error.tsx"), /Try again/);
  assert.match(source("app/(workspace)/not-found.tsx"), /Go back/);
  assert.match(source("app/(workspace)/not-found.tsx"), /Return home/);
});

test("cloud conflicts automatically reconcile to the newest saved version", () => {
  if (!existsSync("components/application/AppProvider.jsx")) return;
  const provider = source("components/application/AppProvider.jsx");
  const sync = source("lib/account-sync.ts");
  const settings = source("components/routes/SettingsScreen.tsx");
  assert.match(provider, /resolveEntityConflicts/);
  assert.doesNotMatch(provider, /syncConflict|resolveSyncConflict/);
  assert.match(sync, /selectSnapshot\(local, remote, "merge"\)/);
  assert.match(settings, /newest saved version is selected automatically/);
  assert.doesNotMatch(settings, /SyncConflictPanel/);
});


test("client freshness compares authoritative build identities without duplicate registration", () => {
  assert.equal(hasClientVersionMismatch("build-a", "build-a"), false);
  assert.equal(hasClientVersionMismatch("development", "build-b"), false);
  assert.equal(hasClientVersionMismatch("build-a", "build-b"), true);

  const freshness = source("components/AssetFreshness.tsx");
  const layout = source("app/layout.tsx");
  const versionApi = source("app/api/version/route.ts");

  assert.match(freshness, /fetch\(\s*`\/api\/version\?client=/);
  assert.match(freshness, /\.register\("\/sw\.js"/);
  assert.match(freshness, /hasClientVersionMismatch\(BUILD_ID, serverBuildId\)/);
  assert.doesNotMatch(freshness, /existingBrowserData|notifyAfterClaim/);
  assert.doesNotMatch(layout, /ServiceWorkerRegistration/);
  assert.equal(existsSync("components/ServiceWorkerRegistration.tsx"), false);
  assert.match(versionApi, /BUILD_ID/);
  assert.match(versionApi, /no-store, no-cache, must-revalidate/);
});

test("the site header intentionally omits synchronization status", () => {
  const shell = source("components/application/AppShell.jsx");
  const css = source("app/website-overhaul.css");
  const status = source("lib/client-status.ts");
  assert.doesNotMatch(shell, /sync-dot|syncIndicator|deriveSyncIndicator/);
  assert.doesNotMatch(css, /\.sync-dot/);
  assert.doesNotMatch(status, /deriveSyncIndicator/);
});
