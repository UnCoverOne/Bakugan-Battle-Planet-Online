import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  PROFILE_AVATARS,
  PROFILE_AVATAR_SPRITE,
  PROFILE_COVER_SPRITE,
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
  assert.equal(PROFILE_AVATAR_SPRITE, "/assets/profile/brawler-profile-icons.avif");
  assert.equal(PROFILE_COVER_SPRITE, "/assets/profile/brawler-profile-covers.avif");
  assert.equal(existsSync(`public${PROFILE_AVATAR_SPRITE}`), true);
  assert.equal(existsSync(`public${PROFILE_COVER_SPRITE}`), true);
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

test("profile artwork selector uses the supplied static icons and covers", () => {
  const implementation = readFileSync("components/routes/ProfileScreen.tsx", "utf8");
  const styles = readFileSync("components/routes/ProfileScreen.module.css", "utf8");
  const corrections = readFileSync(
    "components/profile/ProfileArtworkCorrections.module.css",
    "utf8",
  );
  assert.match(implementation, /PROFILE_AVATAR_PRESETS\.map/);
  assert.match(implementation, /profileAvatarStyle/);
  assert.match(implementation, /avatarPresetIcon/);
  assert.match(implementation, /PROFILE_COVER_SPRITE/);
  assert.match(implementation, /selectedCover\.position/);
  assert.match(implementation, /cover\.position/);
  assert.doesNotMatch(implementation, /FileReader/);
  assert.doesNotMatch(implementation, /type="file"/);
  assert.doesNotMatch(implementation, /Upload your own/);
  assert.doesNotMatch(implementation, /Crop profile picture/);
  assert.doesNotMatch(implementation, /item\.character/);
  assert.doesNotMatch(styles, /aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(styles, /\.identityCard\s*\{[\s\S]*?aspect-ratio:\s*4\s*\/\s*1/);
  assert.match(styles, /\.coverGrid button\s*\{[\s\S]*?aspect-ratio:\s*4\s*\/\s*1/);
  assert.match(corrections, /aspect-ratio:\s*1/);
  assert.match(corrections, /background-size:\s*0 0,\s*100% 1000%/);
  assert.match(corrections, /opacity:\s*1/);
  assert.match(corrections, /content:\s*none/);
});

test("profile avatar preserves the account-initials default", () => {
  const avatar = readFileSync("components/profile/ProfileAvatar.tsx", "utf8");
  assert.match(avatar, /if \(!profileAvatarSource\(profile\.avatar\)\)/);
  assert.match(avatar, /profile\.name\.slice\(0, 2\)\.toUpperCase\(\)/);
  assert.match(avatar, /if \(!avatar\?\.startsWith\("preset:"\)\) return null/);
  assert.match(avatar, /artworkStyles\.artworkScope/);
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
