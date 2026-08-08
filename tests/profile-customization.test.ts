import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  PROFILE_AVATARS,
  PROFILE_AVATAR_SPRITE,
  PROFILE_COVERS,
  PROFILE_SHOWCASE_LIMIT,
  normalizeProfileAvatar,
  normalizeProfileCover,
  normalizeProfileTitle,
  normalizeShowcaseIds,
  profileRewardUnlocked,
  toggleShowcaseId,
} from "../lib/profile-customization";

test("profile customization catalogs expose the shipped Brawler profile artwork", () => {
  assert.equal(PROFILE_COVERS.length, 10);
  assert.equal(PROFILE_AVATARS.length, 23);
  assert.equal(PROFILE_AVATAR_SPRITE, "/assets/profile/brawler-profile-icons.svg");
  assert.equal(existsSync(`public${PROFILE_AVATAR_SPRITE}`), true);
  assert.equal(existsSync("lib/generated/profile-cover-sprite/index.ts"), true);
  assert.equal(new Set(PROFILE_COVERS.map((item) => item.position)).size, 10);
});

test("showcase ids are unique and capped at three", () => {
  assert.deepEqual(
    normalizeShowcaseIds(["first-win", "first-win", "collector", "veteran", "online"]),
    ["first-win", "collector", "veteran"],
  );
  assert.equal(PROFILE_SHOWCASE_LIMIT, 3);
});

test("showcase toggling enforces the maximum and supports removing items", () => {
  assert.deepEqual(toggleShowcaseId(["a", "b"], "c"), {
    ids: ["a", "b", "c"],
    reachedLimit: false,
  });
  assert.deepEqual(toggleShowcaseId(["a", "b", "c"], "d"), {
    ids: ["a", "b", "c"],
    reachedLimit: true,
  });
  assert.deepEqual(toggleShowcaseId(["a", "b", "c"], "b"), {
    ids: ["a", "c"],
    reachedLimit: false,
  });
});

test("profile customization normalization rejects removed image sources", () => {
  assert.equal(normalizeProfileAvatar("preset:shun-kazami"), "preset:shun-kazami");
  assert.equal(normalizeProfileAvatar("preset:pyrus"), "");
  assert.equal(normalizeProfileAvatar("data:image/png;base64,abc"), "");
  assert.equal(normalizeProfileAvatar("https://example.com/avatar.png"), "");
  assert.equal(normalizeProfileAvatar("not-an-image"), "");
  assert.equal(normalizeProfileTitle("missing"), "battle-planet-brawler");
  assert.equal(normalizeProfileCover("missing"), "battle-planet");
});

test("profile rewards honor achievement-based unlocks", () => {
  const reward = { id: "win", label: "First Victor", achievementId: "first-win" };
  assert.equal(profileRewardUnlocked(reward, new Set()), false);
  assert.equal(profileRewardUnlocked(reward, new Set(["first-win"])), true);
  assert.equal(
    profileRewardUnlocked({ ...reward, achievementId: null }, new Set()),
    true,
  );
});

test("profile customization updates locally without any custom image upload path", () => {
  const implementation = readFileSync("components/routes/ProfileScreen.tsx", "utf8");
  for (const token of [
    "updateProfile({ avatar:",
    "updateProfile({ titleId:",
    "updateProfile({ coverId:",
    "showcaseAchievementIds",
    "toggleShowcaseId",
    "PROFILE_AVATARS",
    "BRAWLER_PROFILE_COVER_SPRITE",
  ]) {
    assert.match(implementation, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(implementation, /FileReader/);
  assert.doesNotMatch(implementation, /type="file"/);
  assert.doesNotMatch(implementation, /Upload your own/);
  assert.doesNotMatch(implementation, /Crop profile picture/);
  assert.doesNotMatch(implementation, /Reset to initials/);
  assert.match(implementation, /Custom image uploads are disabled/);
  assert.ok((implementation.match(/aspectRatio: "4 \/ 1"/g) ?? []).length >= 2);
  assert.match(implementation, /selectedCover\.position/);
  assert.match(implementation, /cover\.position/);
  assert.match(implementation, /profileAvatarStyle/);
  assert.match(implementation, /sharedProfileAvatar/);
});

test("shared shell and secondary profile routes consume the same avatar component", () => {
  const shell = readFileSync("components/application/AppShell.jsx", "utf8");
  const decks = readFileSync("components/routes/DeckRoutes.tsx", "utf8");
  const play = readFileSync("components/routes/PlayRoutes.tsx", "utf8");
  const profile = readFileSync("components/routes/ProfileScreen.tsx", "utf8");
  const consistency = readFileSync("app/site-consistency.css", "utf8");
  const overhaul = readFileSync("app/website-overhaul.css", "utf8");
  for (const source of [shell, decks, play, profile]) {
    assert.match(source, /ProfileAvatar/);
  }
  assert.doesNotMatch(overhaul, /\.profile-avatar::after/);
  assert.doesNotMatch(consistency, /\.play-user-avatar::after/);
});
