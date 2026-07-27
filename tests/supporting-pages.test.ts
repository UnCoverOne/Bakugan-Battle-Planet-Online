import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(path, "utf8");

test("Profile and Settings own their presentation through shared primitives", () => {
  for (const route of ["ProfileScreen", "SettingsScreen"]) {
    assert.equal(existsSync(`components/routes/${route}.module.css`), true);
    const implementation = source(`components/routes/${route}.tsx`);
    assert.match(
      implementation,
      new RegExp(`import styles from ["']\\.\\/${route}\\.module\\.css["']`),
    );
    assert.match(implementation, /RouteHero/);
    assert.match(implementation, /Surface/);
    assert.match(implementation, /StatusChip/);
    assert.doesNotMatch(implementation, /className=["']panel/);
  }
});

test("Profile presents reliable records, recent matches, public decks, and owner-only data", () => {
  const profile = source("components/routes/ProfileScreen.tsx");
  for (const contract of [
    "Reliable record",
    "Recent matches",
    "Deck not recorded",
    "Public showcase",
    "Owner-only",
    "Data status",
    "Statistics use completed match records",
  ])
    assert.match(profile, new RegExp(contract));
  assert.match(profile, /validateDeck\(deck\)/);
  assert.match(profile, /publicDecks\.slice\(0, 3\)/);
  assert.match(profile, /do not infer rank, streaks, or achievements/);
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
