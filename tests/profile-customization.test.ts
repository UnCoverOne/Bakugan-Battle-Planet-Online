import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  PROFILE_AVATARS,
  PROFILE_COVERS,
  PROFILE_SHOWCASE_LIMIT,
  normalizeProfileAvatar,
  normalizeProfileCover,
  normalizeProfileTitle,
  normalizeShowcaseIds,
  profileRewardUnlocked,
  toggleShowcaseId,
} from "../lib/profile-customization";
import { normalizePublicBrawlerProfile } from "../lib/public-profile";

function pngDimensions(path: string) {
  const bytes = readFileSync(path);
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function expectedHashes() {
  return new Map(
    readFileSync("tests/profile-artwork-sha256.txt", "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const [hash, path] = line.split(/\s{2,}/);
        return [path, hash] as const;
      }),
  );
}

test("profile catalogs expose exact original PNG artwork", () => {
  const hashes = expectedHashes();
  assert.equal(PROFILE_AVATARS.length, 23);
  assert.equal(PROFILE_COVERS.length, 10);
  for (const avatar of PROFILE_AVATARS) {
    const path = `public${avatar.src}`;
    assert.equal(existsSync(path), true, path);
    assert.deepEqual(pngDimensions(path), { width: 380, height: 380 });
    assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), hashes.get(path), path);
  }
  for (const cover of PROFILE_COVERS) {
    const path = `public${cover.src}`;
    assert.equal(existsSync(path), true, path);
    assert.deepEqual(pngDimensions(path), { width: 1920, height: 480 });
    assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), hashes.get(path), path);
  }
});

test("showcase ids are unique and capped at three", () => {
  assert.deepEqual(normalizeShowcaseIds(["first-win", "first-win", "collector", "veteran", "online"]), ["first-win", "collector", "veteran"]);
  assert.equal(PROFILE_SHOWCASE_LIMIT, 3);
});

test("showcase toggling enforces the maximum and supports removing items", () => {
  assert.deepEqual(toggleShowcaseId(["a", "b"], "c"), { ids: ["a", "b", "c"], reachedLimit: false });
  assert.deepEqual(toggleShowcaseId(["a", "b", "c"], "d"), { ids: ["a", "b", "c"], reachedLimit: true });
  assert.deepEqual(toggleShowcaseId(["a", "b", "c"], "b"), { ids: ["a", "c"], reachedLimit: false });
});

test("profile normalization rejects removed image sources", () => {
  assert.equal(normalizeProfileAvatar("preset:shun-kazami"), "preset:shun-kazami");
  assert.equal(normalizeProfileAvatar("preset:pyrus"), "");
  assert.equal(normalizeProfileAvatar("data:image/png;base64,abc"), "");
  assert.equal(normalizeProfileAvatar("https://example.com/avatar.png"), "");
  assert.equal(normalizeProfileTitle("missing"), "battle-planet-brawler");
  assert.equal(normalizeProfileCover("missing"), "battle-planet");
});

test("profile rewards honor achievement-based unlocks", () => {
  const reward = { id: "win", label: "First Victor", achievementId: "first-win" };
  assert.equal(profileRewardUnlocked(reward, new Set()), false);
  assert.equal(profileRewardUnlocked(reward, new Set(["first-win"])), true);
  assert.equal(profileRewardUnlocked({ ...reward, achievementId: null }, new Set()), true);
});

test("public profile contract normalizes canonical customization and ranked data", () => {
  const profile = normalizePublicBrawlerProfile({
    userId: "brawler-1",
    displayName: "Shun",
    faction: "Aquos",
    joinedAt: 123456,
    avatar: "preset:shun-kazami",
    titleId: "battle-ready",
    coverId: "aquos-hyper-trox-ultra",
    stats: { gamesPlayed: 12, gamesWon: 7, winRate: 58 },
    ranked: { rank: "Gold", bp: 1280, wins: 4, losses: 2, winRate: 67 },
    showcaseAchievements: [
      { id: "first-win", name: "First Victory", description: "Win your first game.", category: "Battle" },
    ],
    showcaseDecks: [
      { id: "deck-1", name: "Aquos Control", factions: ["Aquos"], bakuganIds: ["a", "b", "c"], setName: "Battle Brawlers", isLegal: true },
    ],
  });
  assert.ok(profile);
  assert.equal(profile.avatar, "preset:shun-kazami");
  assert.equal(profile.titleId, "battle-ready");
  assert.equal(profile.coverId, "aquos-hyper-trox-ultra");
  assert.deepEqual(profile.stats, { gamesPlayed: 12, gamesWon: 7, winRate: 58 });
  assert.equal(profile.ranked?.bp, 1280);
});

test("profile UI uses direct originals, default reset, and undistorted covers", () => {
  const owner = readFileSync("components/routes/ProfileScreen.tsx", "utf8");
  const shared = readFileSync("components/profile/BrawlerProfileView.tsx", "utf8");
  const avatar = readFileSync("components/profile/ProfileAvatar.tsx", "utf8");
  const styles = readFileSync("components/routes/ProfileScreen.module.css", "utf8");
  assert.match(owner, /Reset profile picture to default account initials/);
  assert.match(owner, /\{ avatar: "" \}/);
  assert.match(owner, /src=\{item\.src\}/);
  assert.match(owner, /src=\{cover\.src\}/);
  assert.match(shared, /src=\{selectedCover\.src\}/);
  assert.doesNotMatch(owner, /PROFILE_COVER_SPRITE/);
  assert.doesNotMatch(shared, /PROFILE_COVER_SPRITE/);
  assert.doesNotMatch(owner, /profileAvatarStyle/);
  assert.match(avatar, /<OriginalImage/);
  assert.match(avatar, /profile\.name\.slice\(0, 2\)\.toUpperCase\(\)/);
  assert.match(styles, /\.identityCard\s*\{[\s\S]*?aspect-ratio:\s*4\s*\/\s*1/);
  assert.match(styles, /\.identityCoverArt\s*\{[\s\S]*?object-fit:\s*contain/);
  assert.match(styles, /\.coverArt\s*\{[\s\S]*?aspect-ratio:\s*4\s*\/\s*1[\s\S]*?object-fit:\s*contain[\s\S]*?opacity:\s*1/);
  assert.doesNotMatch(styles, /\.coverGrid button::after/);
  assert.doesNotMatch(styles, /inset 0 -8rem 12rem/);
});

test("owner and public routes render one shared Brawler Profile presentation", () => {
  const owner = readFileSync("components/routes/ProfileScreen.tsx", "utf8");
  const publicProfile = readFileSync("components/routes/PublicProfileScreen.tsx", "utf8");
  const shared = readFileSync("components/profile/BrawlerProfileView.tsx", "utf8");
  assert.match(owner, /<BrawlerProfileView/);
  assert.match(publicProfile, /<BrawlerProfileView/);
  assert.match(publicProfile, /\/api\/profile\?userId=/);
  assert.match(publicProfile, /router\.replace\("\/profile"\)/);
  assert.match(shared, /Showcased Achievements/);
  assert.match(shared, /Public Decks/);
  assert.match(shared, /Ranked Profile/);
  assert.match(shared, /ProfileAvatar/);
});

test("public profile server uses canonical profile fields and exposes only selected Public decks", () => {
  const server = readFileSync("lib/public-profile-server.ts", "utf8");
  const contract = readFileSync("lib/public-profile.ts", "utf8");
  const rankedRoute = readFileSync("app/api/ranked/route.ts", "utf8");
  assert.match(server, /profile\.avatar/);
  assert.doesNotMatch(server, /profile\.avatarId/);
  assert.match(server, /loadAccountDataPayload/);
  assert.match(server, /const snapshot = \(await loadAccountDataPayload\(db, userId\)\)\.data/);
  assert.doesNotMatch(server, /user_data\.data_json/);
  assert.doesNotMatch(server, /LEFT JOIN user_data/);
  assert.match(contract, /deck\.visibility === "Public"/);
  assert.match(contract, /normalizeShowcaseIds\(input\.profile\.showcaseDeckIds\)/);
  assert.match(rankedRoute, /publicBrawlerProfile/);
});

test("shared shell and all profile surfaces consume the same avatar component", () => {
  const shell = readFileSync("components/application/AppShell.jsx", "utf8");
  const shared = readFileSync("components/profile/BrawlerProfileView.tsx", "utf8");
  const preview = readFileSync("components/profile/PlayerPreview.tsx", "utf8");
  for (const source of [shell, shared, preview]) assert.match(source, /ProfileAvatar/);
});
