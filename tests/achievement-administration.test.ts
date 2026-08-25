import assert from "node:assert/strict";
import test from "node:test";
import {
  ACHIEVEMENT_DEFINITIONS,
  normalizeAchievementDefinitions,
} from "../lib/achievements";
import {
  PROFILE_REWARD_UNAVAILABLE,
  normalizeAchievementRewardAssignments,
} from "../lib/achievement-rewards";
import {
  PROFILE_COVER_CATALOGUE,
  PROFILE_COVERS,
  PROFILE_TITLE_CATALOGUE,
  PROFILE_TITLES,
} from "../lib/profile-customization";
import {
  resetProfileRewardRuntime,
  setProfileRewardRuntime,
} from "../lib/profile-reward-runtime";

test("achievement definitions can be edited and deleted without inventing catalogue ids", () => {
  const configured = normalizeAchievementDefinitions(
    ACHIEVEMENT_DEFINITIONS
      .filter((item) => item.id !== "first-win")
      .map((item) => item.id === "first-deck"
        ? {
            ...item,
            name: "First Complete Deck",
            description: "Complete two legal-sized decks.",
            target: 2,
          }
        : item),
  );

  assert.equal(configured.some((item) => item.id === "first-win"), false);
  const edited = configured.find((item) => item.id === "first-deck");
  assert.ok(edited);
  assert.equal(edited.name, "First Complete Deck");
  assert.equal(edited.description, "Complete two legal-sized decks.");
  assert.equal(edited.target, 2);
  assert.equal(configured.length, ACHIEVEMENT_DEFINITIONS.length - 1);
});

test("one achievement cannot claim multiple rewards and explicit choices beat defaults", () => {
  const assignments = normalizeAchievementRewardAssignments({
    titles: { "first-victor": "first-win" },
    covers: {
      "aquos-hyper-trox-ultra": "first-win",
      "darkus-turtonium": "online",
    },
    avatars: { "shun-kazami": "online" },
  });

  assert.equal(assignments.titles["first-victor"], "first-win");
  assert.equal(assignments.covers["aquos-hyper-trox-ultra"], null);
  assert.equal(assignments.covers["darkus-turtonium"], "online");
  assert.equal(assignments.avatars["shun-kazami"], null);
});

test("rewards marked unavailable stay in the administrator catalogue but disappear for players", () => {
  const assignments = normalizeAchievementRewardAssignments({
    titles: { "first-victor": PROFILE_REWARD_UNAVAILABLE },
    covers: { "aquos-hyper-trox-ultra": PROFILE_REWARD_UNAVAILABLE },
    avatars: {},
  });
  setProfileRewardRuntime(assignments, new Set());
  try {
    assert.equal(PROFILE_TITLE_CATALOGUE.some((item) => item.id === "first-victor"), true);
    assert.equal(PROFILE_COVER_CATALOGUE.some((item) => item.id === "aquos-hyper-trox-ultra"), true);
    assert.equal(PROFILE_TITLES.map((item) => item.id).includes("first-victor"), false);
    assert.equal(PROFILE_COVERS.map((item) => item.id).includes("aquos-hyper-trox-ultra"), false);
  } finally {
    resetProfileRewardRuntime();
  }
});
