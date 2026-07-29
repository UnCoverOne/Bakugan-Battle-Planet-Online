import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PROFILE_COVERS,
  PROFILE_SHOWCASE_LIMIT,
  PROFILE_TITLES,
  normalizeProfileAvatar,
  normalizeShowcaseIds,
  toggleShowcaseId,
} from "../lib/profile-customization";

const source = (path: string) => readFileSync(path, "utf8");

test("profile rewards are preset, achievement-gated customizations", () => {
  assert.equal(PROFILE_TITLES[0].achievementId, null);
  assert.equal(PROFILE_COVERS[0].achievementId, null);
  assert.ok(PROFILE_TITLES.slice(1).every((item) => item.achievementId));
  assert.ok(PROFILE_COVERS.slice(1).every((item) => item.achievementId));
  assert.equal(new Set(PROFILE_TITLES.map((item) => item.id)).size, PROFILE_TITLES.length);
  assert.equal(new Set(PROFILE_COVERS.map((item) => item.id)).size, PROFILE_COVERS.length);
});

test("showcase selections are unique and capped at three", () => {
  assert.equal(PROFILE_SHOWCASE_LIMIT, 3);
  assert.deepEqual(normalizeShowcaseIds(["a", "a", "b", "c", "d"]), [
    "a",
    "b",
    "c",
  ]);
  assert.deepEqual(toggleShowcaseId(["a", "b"], "c"), {
    ids: ["a", "b", "c"],
    reachedLimit: false,
  });
  assert.equal(toggleShowcaseId(["a", "b", "c"], "d").reachedLimit, true);
  assert.deepEqual(toggleShowcaseId(["a", "b", "c"], "b").ids, ["a", "c"]);
});

test("avatar persistence accepts presets and bounded cropped images only", () => {
  assert.equal(normalizeProfileAvatar("preset:bb-343"), "preset:bb-343");
  assert.equal(
    normalizeProfileAvatar("data:image/jpeg;base64,YWJj"),
    "data:image/jpeg;base64,YWJj",
  );
  assert.equal(normalizeProfileAvatar("https://untrusted.example/avatar.jpg"), "");
  assert.equal(normalizeProfileAvatar("data:image/svg+xml;base64,YWJj"), "");
});

test("profile route implements four-section customization and cropping", () => {
  const implementation = source("components/routes/ProfileScreen.tsx");
  const styles = source("components/routes/ProfileScreen.module.css");
  for (const contract of [
    "Edit picture",
    "Upload your own",
    "Reset to initials",
    "Crop profile picture",
    "Edit title",
    "Edit cover",
    "Win Rate",
    "Games Won",
    "Games Played",
    "Showcased Achievements",
    "Public Decks",
    "canvas.toDataURL",
  ]) {
    assert.match(implementation, new RegExp(contract));
  }
  assert.doesNotMatch(implementation, />Edit identity</);
  assert.doesNotMatch(implementation, />\s*Achievements\s*<\/Link>/);
  assert.equal((implementation.match(/<PencilIcon \/>/g) ?? []).length, 3);
  assert.match(styles, /aspect-ratio:\s*16\s*\/\s*9/);
  assert.doesNotMatch(styles, /aspect-ratio:\s*auto/);
  assert.match(
    styles,
    /\.profilePortrait\s*\{[\s\S]*?border-radius:\s*50%[\s\S]*?clip-path:\s*circle/,
  );
  assert.match(
    styles,
    /\.editButton\s*\{[\s\S]*?border-radius:\s*50%/,
  );
  assert.match(styles, /\.achievementShowcaseGrid/);
  assert.match(styles, /\.deckShowcaseGrid/);
});

test("achievement and deck screens expose eligible three-item showcase toggles", () => {
  const achievements = source("components/routes/AchievementsScreen.tsx");
  const decks = source("components/routes/DeckRoutes.tsx");
  const provider = source("components/application/AppProvider.jsx");
  assert.match(achievements, /className=\{styles\.showcaseToggle\}/);
  assert.match(achievements, /disabled=\{!achievement\.unlocked\}/);
  assert.match(achievements, /aria-pressed=\{showcased\}/);
  assert.match(decks, /className=\{styles\.showcaseDeckToggle\}/);
  assert.match(decks, /deck\.visibility !== "Public"/);
  assert.match(decks, /toggleShowcaseId\(profile\.showcaseDeckIds/);
  assert.match(provider, /showcaseDeckIds/);
  assert.match(provider, /deck\.visibility === "Public"/);
});

test("profile picture is shared by the page and account menu", () => {
  const shell = source("components/application/AppShell.jsx");
  const avatar = source("components/profile/ProfileAvatar.tsx");
  assert.match(shell, /<ProfileAvatar/);
  assert.match(avatar, /PROFILE_AVATAR_PRESETS/);
  assert.match(avatar, /profileAvatarSource/);
});
