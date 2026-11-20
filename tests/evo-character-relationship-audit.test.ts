import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CARDS } from "../lib/data";

type Relationship = {
  evoId: string;
  targetCharacterIds: string[];
  candidateCharacterIds: string[];
  requiresFusedFace: boolean;
  status: "mapped_candidate" | "needs_review";
  reviewState: "source_checked" | "catalogue_inferred" | "manual_review_required";
};

const audit = JSON.parse(readFileSync(
  new URL("../content/evo-character-relationships.audit.json", import.meta.url),
  "utf8",
)) as { summary: { recordCount: number; mappedCandidates: number; needingReview: number }; relationships: Relationship[] };
const indexed = new Map(audit.relationships.map(entry => [entry.evoId, entry]));
const catalogue = new Map(CARDS.map(card => [card.catalogId, card]));

test("Evo mapping audit covers every controlled Evo once", () => {
  const evos = CARDS.filter(card => card.type === "Evo");
  assert.equal(CARDS.length, 1734);
  assert.equal(evos.length, 336);
  assert.equal(audit.relationships.length, evos.length);
  assert.equal(indexed.size, evos.length);
  assert.equal(audit.summary.recordCount, 336);
  for (const evo of evos) assert.ok(indexed.has(evo.catalogId), evo.catalogId);
});

test("All approved candidates refer to one real, correct-face Character", () => {
  for (const entry of audit.relationships) {
    assert.equal(catalogue.get(entry.evoId)?.type, "Evo");
    if (entry.status === "mapped_candidate") {
      assert.equal(entry.targetCharacterIds.length, 1, entry.evoId);
    } else {
      assert.deepEqual(entry.targetCharacterIds, [], entry.evoId);
      assert.equal(entry.reviewState, "manual_review_required");
    }
    for (const id of [...entry.targetCharacterIds, ...entry.candidateCharacterIds]) {
      const character = catalogue.get(id);
      assert.ok(character, entry.evoId + " references missing " + id);
      assert.equal(character.type, "Character", id);
    }
    for (const id of entry.targetCharacterIds) {
      const character = catalogue.get(id)!;
      if (entry.requiresFusedFace) assert.equal(character.fusionFace, "b", entry.evoId);
      else assert.notEqual(character.fusionFace, "b", entry.evoId);
    }
  }
  assert.equal(audit.relationships.filter(entry => entry.status === "mapped_candidate").length, 329);
  assert.equal(audit.relationships.filter(entry => entry.status === "needs_review").length, 7);
});

test("Version-specific Evo identities never use an unrelated same-name Character", () => {
  const expected = {
    "bb-219": "bb-292",
    "bb-270": "bb-343",
    "aa-78": "br-179",
    "av-117": "av-160",
    "br-114": "bb-323",
    "av-144": "av-246",
    "sv-143": "av-264",
    "ex-2": "ex-1",
  };
  for (const [evoId, characterId] of Object.entries(expected)) {
    assert.deepEqual(indexed.get(evoId)?.targetCharacterIds, [characterId], evoId);
    assert.equal(indexed.get(evoId)?.reviewState, "source_checked");
  }
  assert.ok(!indexed.get("bb-219")?.targetCharacterIds.includes("av-172"));
  assert.ok(!indexed.get("bb-270")?.targetCharacterIds.includes("av-233"));
});

test("No unresolved candidate is automatically granted legality", () => {
  const pending = audit.relationships.filter(entry => entry.status === "needs_review");
  assert.deepEqual(pending.map(entry => entry.evoId).sort(), [
    "ff-129", "sv-137", "sv-139", "sv-141", "sv-146", "sv-149", "sv-261",
  ]);
  assert.ok(pending.every(entry => entry.targetCharacterIds.length === 0));
});
