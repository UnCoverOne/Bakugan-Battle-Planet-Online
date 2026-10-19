import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CARDS } from "../lib/data";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Feedback & Reports exposes four choices and a searchable cross-set card picker", async () => {
  const [dialog, styles, questionApi, feedbackApi] = await Promise.all([
    read("components/application/FeedbackReportsDialog.tsx"),
    read("components/application/FeedbackReportsDialog.module.css"),
    read("app/api/rulings/route.ts"),
    read("app/api/feedback/route.ts"),
  ]);
  for (const title of ["Ask a Question", "Suggest an Improvement", "Report a Bug", "Report an Issue"]) {
    assert.ok(dialog.includes(title), `Missing ${title}`);
  }
  assert.match(dialog, /type="search"/);
  assert.match(dialog, /SEARCHABLE_CARDS\.filter/);
  assert.match(dialog, /role="listbox"/);
  assert.match(dialog, /aria-pressed=\{kind === option.kind\}/);
  assert.match(dialog, /cardSetCode\(card\)/);
  assert.match(dialog, /kind === "question" \? "\/api\/rulings" : "\/api\/feedback"/);
  assert.match(dialog, /minLength=\{20\} maxLength=\{2000\}/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(styles, /\.cardResults\{max-height:/);
  assert.match(questionApi, /CARD_BY_ID\.has\(cardId\)/);
  assert.match(feedbackApi, /CARD_BY_ID\.has\(cardId\)/);
  assert.match(feedbackApi, /assertSameOrigin\(request\)/);
  assert.match(feedbackApi, /enforceD1RateLimit\(/);
  assert.match(feedbackApi, /user\.roles\.includes\("administrator"\)/);
  assert.ok(CARDS.some((card) => card.catalogId.startsWith("aa-")));
  assert.ok(CARDS.some((card) => card.catalogId.startsWith("ff-")));
});
