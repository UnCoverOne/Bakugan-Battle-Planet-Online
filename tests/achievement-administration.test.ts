import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
            description: "Complete two legal Standard decks.",
            target: 2,
          }
        : item),
  );

  assert.equal(configured.some((item) => item.id === "first-win"), false);
  const edited = configured.find((item) => item.id === "first-deck");
  assert.ok(edited);
  assert.equal(edited.name, "First Complete Deck");
  assert.equal(edited.description, "Complete two legal Standard decks.");
  assert.equal(edited.target, 2);
  assert.equal(configured.length, ACHIEVEMENT_DEFINITIONS.length - 1);
});

test("current Administrator edits are preserved while obsolete ids and metrics are rejected", () => {
  const configured = normalizeAchievementDefinitions([
    {
      ...ACHIEVEMENT_DEFINITIONS.find((item) => item.id === "publisher")!,
      name: "Community Launch",
      description: "Publish two legal Standard decks.",
      target: 2,
    },
    {
      ...ACHIEVEMENT_DEFINITIONS.find((item) => item.id === "first-win")!,
      metric: "onlineWins",
      target: 4,
    },
    {
      id: "removed-achievement",
      name: "Removed",
      description: "Removed",
      category: "Battle",
      metric: "matches",
      target: 1,
    },
  ]);

  assert.equal(configured.length, 2);
  assert.equal(configured[0].name, "Community Launch");
  assert.equal(configured[0].target, 2);
  assert.equal(configured[1].metric, "wins");
  assert.equal(configured[1].target, 4);
});

test("achievement Admin storage uses only versioned current catalogues", () => {
  const definitionsServer = readFileSync("lib/achievement-configuration-server.ts", "utf8");
  const rewardsServer = readFileSync("lib/achievement-rewards-server.ts", "utf8");
  assert.match(definitionsServer, /ACHIEVEMENT_CATALOGUE_VERSION = 1/);
  assert.match(definitionsServer, /JSON\.stringify\(\{ version: ACHIEVEMENT_CATALOGUE_VERSION, definitions \}\)/);
  assert.match(rewardsServer, /ACHIEVEMENT_REWARD_CATALOGUE_VERSION = 1/);
  assert.match(rewardsServer, /JSON\.stringify\(\{ version: ACHIEVEMENT_REWARD_CATALOGUE_VERSION, assignments \}\)/);
  assert.doesNotMatch(definitionsServer, /legacy|migrate/i);
  assert.doesNotMatch(rewardsServer, /legacy|migrate/i);
});

test("one achievement cannot claim multiple rewards and explicit choices beat defaults", () => {
  const assignments = normalizeAchievementRewardAssignments({
    titles: { "winning-start": "first-win" },
    covers: {
      "aquos-hyper-trox-ultra": "first-win",
      "darkus-turtonium": "online",
    },
    avatars: { "shun-kazami": "online" },
  });

  assert.equal(assignments.titles["winning-start"], "first-win");
  assert.equal(assignments.covers["aquos-hyper-trox-ultra"], null);
  assert.equal(assignments.covers["darkus-turtonium"], "online");
  assert.equal(assignments.avatars["shun-kazami"], null);
});

test("current default title rewards match their achievement meaning", () => {
  const winningStart = PROFILE_TITLE_CATALOGUE.find((item) => item.id === "winning-start");
  const connectedBrawler = PROFILE_TITLE_CATALOGUE.find((item) => item.id === "connected-brawler");
  assert.equal(winningStart?.label, "Winning Start");
  assert.equal(winningStart?.achievementId, "first-win");
  assert.equal(connectedBrawler?.achievementId, "opponents-ten");
  assert.equal(PROFILE_TITLE_CATALOGUE.some((item) => item.id === "first-victor"), false);
});

test("rewards marked unavailable stay in the Administrator catalogue but disappear for players", () => {
  const assignments = normalizeAchievementRewardAssignments({
    titles: { "winning-start": PROFILE_REWARD_UNAVAILABLE },
    covers: { "aquos-hyper-trox-ultra": PROFILE_REWARD_UNAVAILABLE },
    avatars: {},
  });
  setProfileRewardRuntime(assignments, new Set());
  try {
    assert.equal(PROFILE_TITLE_CATALOGUE.some((item) => item.id === "winning-start"), true);
    assert.equal(PROFILE_COVER_CATALOGUE.some((item) => item.id === "aquos-hyper-trox-ultra"), true);
    assert.equal(PROFILE_TITLES.map((item) => item.id).includes("winning-start"), false);
    assert.equal(PROFILE_COVERS.map((item) => item.id).includes("aquos-hyper-trox-ultra"), false);
  } finally {
    resetProfileRewardRuntime();
  }
});
