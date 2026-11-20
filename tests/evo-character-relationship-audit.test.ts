import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CARDS } from "../lib/data";

type Relationship = {
  evoId: string;
  targetCharacterIds: string[];
  epicCharacterTargetIds: string[];
  candidateCharacterIds: string[];
  requiresFusedFace: boolean;
  status: "mapped_candidate" | "needs_review" | "cancelled_no_target";
  reviewState: "source_checked" | "catalogue_inferred" | "manual_review_required" | "user_confirmed";
};
type EpicPair = {
  epicCharacterId: string;
  regularCharacterId: string | null;
  candidateRegularCharacterIds: string[];
  status: "catalogue_pair_candidate" | "needs_review";
};

const audit = JSON.parse(readFileSync(
  new URL("../content/evo-character-relationships.audit.json", import.meta.url),
  "utf8",
)) as { summary: { recordCount: number; mappedCandidates: number; needingReview: number; evosWithMultipleCharacterTargets: number }; relationships: Relationship[] };
const epicAudit = JSON.parse(readFileSync(
  new URL("../content/epic-character-equivalences.audit.json", import.meta.url),
  "utf8",
)) as { epicCharacterCount: number; pairedCandidates: number; unpairedRecords: number; pairs: EpicPair[] };
const indexed = new Map(audit.relationships.map(entry => [entry.evoId, entry]));
const cards = new Map(CARDS.map(card => [card.catalogId, card]));
const epicIds = new Set(epicAudit.pairs.map(pair => pair.epicCharacterId));

test("Evo audit covers all 336 Evos exactly once", () => {
  const evos = CARDS.filter(card => card.type === "Evo");
  assert.equal(CARDS.length, 1734);
  assert.equal(evos.length, 336);
  assert.equal(audit.relationships.length, evos.length);
  assert.equal(indexed.size, evos.length);
  assert.equal(audit.summary.recordCount, 336);
  for (const evo of evos) assert.ok(indexed.has(evo.catalogId), evo.catalogId);
});

test("Every mapped Evo supports one or more Character variants, while disputed Evos grant none", () => {
  for (const entry of audit.relationships) {
    assert.equal(cards.get(entry.evoId)?.type, "Evo");
    assert.equal(new Set(entry.targetCharacterIds).size, entry.targetCharacterIds.length, entry.evoId);
    if (entry.status === "mapped_candidate") {
      assert.ok(entry.targetCharacterIds.length >= 1, entry.evoId);
    } else {
      assert.deepEqual(entry.targetCharacterIds, [], entry.evoId);
      assert.ok(entry.status === "cancelled_no_target" || entry.reviewState === "manual_review_required", entry.evoId);
    }
    for (const id of [...entry.targetCharacterIds, ...entry.candidateCharacterIds]) {
      const character = cards.get(id);
      assert.ok(character, entry.evoId + " references missing " + id);
      assert.equal(character.type, "Character", id);
    }
    for (const id of entry.targetCharacterIds) {
      const character = cards.get(id)!;
      if (entry.requiresFusedFace) assert.equal(character.fusionFace, "b", entry.evoId);
      else assert.notEqual(character.fusionFace, "b", entry.evoId);
    }
    assert.deepEqual(entry.epicCharacterTargetIds, entry.targetCharacterIds.filter(id => epicIds.has(id)));
  }
  assert.equal(audit.relationships.filter(entry => entry.status === "mapped_candidate").length, 335);
  assert.equal(audit.relationships.filter(entry => entry.status === "needs_review").length, 0);
  assert.equal(audit.relationships.filter(entry => entry.status === "cancelled_no_target").length, 1);
  assert.equal(audit.relationships.filter(entry => entry.targetCharacterIds.length > 1).length, 24);
  assert.equal(audit.summary.evosWithMultipleCharacterTargets, 24);
});

test("Epic pair audit covers all Epic Character cards and excludes unrelated same-name Characters", () => {
  const epics = CARDS.filter(card => card.rarity === "Epic Character");
  assert.equal(epicAudit.epicCharacterCount, 89);
  assert.equal(epicAudit.pairs.length, 89);
  assert.equal(new Set(epicAudit.pairs.map(pair => pair.epicCharacterId)).size, 89);
  assert.deepEqual(new Set(epicAudit.pairs.map(pair => pair.epicCharacterId)), new Set(epics.map(card => card.catalogId)));
  for (const pair of epicAudit.pairs) {
    const epic = cards.get(pair.epicCharacterId);
    assert.ok(epic);
    assert.equal(epic.rarity, "Epic Character");
    if (pair.regularCharacterId) {
      const regular = cards.get(pair.regularCharacterId);
      assert.ok(regular);
      assert.equal(regular.type, "Character");
      assert.notEqual(regular.rarity, "Epic Character");
      assert.equal(pair.status, "catalogue_pair_candidate");
    } else {
      assert.equal(pair.status, "needs_review");
    }
  }
  assert.equal(epicAudit.pairedCandidates, 54);
  assert.equal(epicAudit.unpairedRecords, 35);
});

test("Regular and Epic pairs both appear as Evo targets, including cross-set and Fusion examples", () => {
  const expected: Record<string, string[]> = {
    "av-118": ["av-166", "ff-217"],
    "av-131": ["av-205", "ff-224"],
    "ff-133": ["av-210", "ff-226"],
    "ff-135": ["av-208", "ff-225"],
    "ps1-1": ["av-165", "ff-216"],
    "sv-135": ["ff-171b", "sv-226b"],
    "sv-139": ["sv-220b", "sv-260b"],
  };
  for (const [evo, targets] of Object.entries(expected)) {
    assert.deepEqual(indexed.get(evo)?.targetCharacterIds, targets, evo);
    assert.equal(indexed.get(evo)?.epicCharacterTargetIds.length, 1, evo);
  }
  assert.equal(indexed.get("sv-135")?.requiresFusedFace, true);
  assert.equal(indexed.get("sv-139")?.requiresFusedFace, true);
});

test("Identities from genuinely different releases remain distinct", () => {
  const expected: Record<string, string[]> = {
    "bb-219": ["bb-292"],
    "bb-270": ["bb-343"],
    "aa-78": ["br-179"],
    "av-117": ["av-160"],
    "br-114": ["bb-323"],
    "av-144": ["av-246"],
    "sv-143": ["av-264"],
    "ex-2": ["ex-1"],
  };
  for (const [evo, target] of Object.entries(expected)) {
    assert.deepEqual(indexed.get(evo)?.targetCharacterIds, target, evo);
    assert.equal(indexed.get(evo)?.reviewState, "source_checked", evo);
  }
  assert.ok(!indexed.get("bb-219")?.targetCharacterIds.includes("av-172"));
  assert.ok(!indexed.get("bb-270")?.targetCharacterIds.includes("av-233"));
});

test("All six corrected Evo identities preserve their exact user-confirmed targets", () => {
  const targets: Record<string, string[]> = {
    "ff-129": ["ff-164", "ff-222"],
    "sv-137": ["sv-253"],
    "sv-141": ["av-234"],
    "sv-146": ["sv-206b"],
    "sv-149": ["sv-220b"],
  };
  for (const [evoId, legalIds] of Object.entries(targets)) {
    const record = indexed.get(evoId);
    assert.ok(record, evoId);
    assert.deepEqual(record.targetCharacterIds, legalIds, evoId);
    assert.equal(record.reviewState, "user_confirmed", evoId);
    assert.equal(record.status, "mapped_candidate", evoId);
  }
  assert.deepEqual(indexed.get("ff-129")?.epicCharacterTargetIds, ["ff-222"]);
  assert.deepEqual(indexed.get("sv-137")?.epicCharacterTargetIds, ["sv-253"]);
  for (const evoId of ["sv-146", "sv-149"]) {
    assert.equal(indexed.get(evoId)?.requiresFusedFace, true, evoId);
    assert.ok(indexed.get(evoId)?.targetCharacterIds.every(id => cards.get(id)?.fusionFace === "b"), evoId);
  }
  assert.ok(!indexed.get("sv-146")?.targetCharacterIds.includes("sv-206a"));
  assert.ok(!indexed.get("sv-149")?.targetCharacterIds.includes("sv-220a"));
  assert.ok(!indexed.get("sv-149")?.targetCharacterIds.includes("sv-260b"));
  assert.deepEqual(indexed.get("sv-139")?.targetCharacterIds, ["sv-220b", "sv-260b"]);
});

test("Cancelled Evo is a documented terminal no-target state, never a fallback to arbitrary Characters", () => {
  const cancelled = indexed.get("sv-261");
  assert.ok(cancelled);
  assert.equal(cancelled.status, "cancelled_no_target");
  assert.equal(cancelled.reviewState, "user_confirmed");
  assert.deepEqual(cancelled.targetCharacterIds, []);
  assert.deepEqual(cancelled.epicCharacterTargetIds, []);
  assert.deepEqual(cancelled.candidateCharacterIds, []);
  assert.equal(audit.relationships.filter(entry => entry.status === "needs_review").length, 0);
});
