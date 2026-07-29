import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  deriveSyncIndicator,
  hasClientVersionMismatch,
} from "../lib/client-status";

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
  const profile = source("components/routes/ProfileScreen.tsx");
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
  assert.match(profile, /validateDeck\(deck\)/);
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
  assert.match(settings, /SyncConflictPanel/);
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
  assert.match(states, /data-ui="sync-conflict"/);
  assert.match(states, /This device/);
  assert.match(states, /Cloud copy/);
  assert.match(states, /Merge safely/);
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

test("cloud conflicts pause automatic overwrite until a user resolves them", () => {
  if (!existsSync("components/application/AppProvider.jsx")) return;
  const provider = source("components/application/AppProvider.jsx");
  assert.match(provider, /syncConflict/);
  assert.match(provider, /setSyncStatus\("conflict"\)/);
  assert.match(provider, /resolveSyncConflict/);
  assert.match(
    provider,
    /selectSnapshot\(pending\.local, pending\.cloud, preference\)/,
  );
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

test("sync indicator distinguishes healthy, working, warning, and error states", () => {
  assert.deepEqual(
    deriveSyncIndicator({
      authenticated: false,
      syncStatus: "local",
      storageStatus: "ready",
      storageMessage: "Local storage is ready.",
    }),
    { tone: "synced", title: "Device data ready" },
  );
  assert.equal(
    deriveSyncIndicator({
      authenticated: false,
      syncStatus: "local",
      storageStatus: "saved",
      storageMessage: "Saved.",
    }).tone,
    "synced",
  );
  assert.equal(
    deriveSyncIndicator({
      authenticated: true,
      syncStatus: "loading",
      storageStatus: "ready",
      storageMessage: "Ready.",
    }).tone,
    "working",
  );
  assert.equal(
    deriveSyncIndicator({
      authenticated: true,
      syncStatus: "offline",
      storageStatus: "ready",
      storageMessage: "Ready.",
    }).tone,
    "warning",
  );
  assert.equal(
    deriveSyncIndicator({
      authenticated: true,
      syncStatus: "conflict",
      storageStatus: "ready",
      storageMessage: "Ready.",
    }).tone,
    "error",
  );

  const shell = source("components/application/AppShell.jsx");
  const css = source("app/website-overhaul.css");
  assert.match(shell, /deriveSyncIndicator/);
  assert.match(shell, /syncIndicator\.tone/);
  assert.match(shell, /syncIndicator\.title/);
  assert.match(css, /\.sync-dot\.working/);
  assert.match(css, /\.sync-dot\.warning/);
});
