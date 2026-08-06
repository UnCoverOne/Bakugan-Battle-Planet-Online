import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(path, "utf8");

test("Settings Account exposes an editable Brawler Name", () => {
  const settings = source("components/routes/SettingsScreen.tsx");
  assert.match(settings, /saveAccountProfile,/);
  assert.match(settings, /onSubmit=\{submitBrawlerName\}/);
  assert.match(settings, /label="Brawler Name"/);
  assert.match(settings, /autoComplete="nickname"/);
  assert.match(settings, /maxLength=\{20\}/);
  assert.match(settings, /Update Brawler Name/);
  assert.match(settings, /saveAccountProfile\(\{ displayName: normalizedBrawlerName \}\)/);
});

test("saving a Brawler Name updates guest and account profile state", () => {
  const provider = source("components/application/AppProvider.jsx");
  assert.match(provider, /saveAccountProfile = useCallback\(async \(updates = \{\}\)/);
  assert.match(provider, /updates\.displayName \?\? profile\.name/);
  assert.match(provider, /Brawler Name updated on this device/);
  assert.match(provider, /action: "update-profile"/);
  assert.match(provider, /setAuthUser\(result\.user\)/);
  assert.match(provider, /name: result\.user\.displayName/);
});

test("the account API normalizes and persists Brawler Name changes", () => {
  const route = source("app/api/auth/route.ts");
  assert.match(route, /String\(body\.displayName \?\? ""\)\.trim\(\)\.replace/);
  assert.match(route, /UPDATE users SET display_name = \?, faction = \?, updated_at = \?/);
  assert.match(route, /Brawler Name must be between 1 and 20 characters/);
});
