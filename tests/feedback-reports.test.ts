import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CARDS } from "../lib/data";
import { isSubmissionKind, isSubmissionStatus, normalizedSubmissionStatus, sourceSubmissionStatus } from "../lib/submission-moderation";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Feedback & Reports offers a two-option dropdown, fixed Details label, and searchable cards", async () => {
  const [dialog, styles, questionApi, feedbackApi] = await Promise.all([
    read("components/application/FeedbackReportsDialog.tsx"),
    read("components/application/FeedbackReportsDialog.module.css"),
    read("app/api/rulings/route.ts"),
    read("app/api/feedback/route.ts"),
  ]);
  assert.match(dialog, /type FeedbackKind = "issue" \| "suggestion"/);
  assert.match(dialog, /<select value=\{kind\}/);
  assert.match(dialog, /<option key=\{option.kind\} value=\{option.kind\}>\{option.title\}<\/option>/);
  assert.match(dialog, /Report an issue/);
  assert.match(dialog, /Request a feature/);
  for (const oldTitle of ["Ask a Question", "Suggest an Improvement", "Report a Bug", "Report an Issue"]) {
    assert.ok(!dialog.includes(oldTitle), `Old action still shown: ${oldTitle}`);
  }
  assert.match(dialog, /<span className=\{styles.fieldLabel\}>Details <small>/);
  assert.doesNotMatch(dialog, /active\.prompt/);
  assert.match(dialog, /type="search"/);
  assert.match(dialog, /SEARCHABLE_CARDS\.filter/);
  assert.match(dialog, /role="listbox"/);
  assert.match(dialog, /cardSetCode\(card\)/);
  assert.match(dialog, /fetch\("\/api\/feedback"/);
  assert.doesNotMatch(dialog, /fetch\("\/api\/rulings"/);
  assert.match(dialog, /minLength=\{20\} maxLength=\{2000\}/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(styles, /\.cardResults\{max-height:/);
  assert.match(styles, /\.feedbackType select\{/);
  assert.doesNotMatch(styles, /\.options\{|\.option\{/);
  assert.match(questionApi, /CARD_BY_ID\.has\(cardId\)/);
  assert.match(feedbackApi, /CARD_BY_ID\.has\(cardId\)/);
  assert.match(feedbackApi, /assertSameOrigin\(request\)/);
  assert.match(feedbackApi, /enforceD1RateLimit\(/);
  assert.match(feedbackApi, /user\.roles\.includes\("administrator"\)/);
  assert.ok(CARDS.some((card) => card.catalogId.startsWith("aa-")));
  assert.ok(CARDS.some((card) => card.catalogId.startsWith("ff-")));
});

test("Administrator control centre offers a permissioned unified inbox", async () => {
  const [admin, view, api, moderation, migration] = await Promise.all([
    read("components/routes/AdminScreen.tsx"),
    read("components/routes/AdminFeedbackManagement.tsx"),
    read("app/api/admin/submissions/route.ts"),
    read("lib/submission-moderation.ts"),
    read("migrations/0014_submission_reviews.sql"),
  ]);
  assert.match(admin, /tab === "feedback"/);
  assert.match(admin, /href="\/admin\?tab=feedback"/);
  assert.match(admin, /<AdminFeedbackManagement \/>/);
  assert.match(api, /await requireAdministrator\(request\)/);
  assert.match(api, /assertSameOrigin\(request\)/);
  assert.match(api, /enforceD1RateLimit\(/);
  assert.match(api, /UNION ALL/);
  assert.match(api, /ON CONFLICT\(kind, submission_id\) DO UPDATE/);
  assert.match(api, /UPDATE ruling_requests SET status = \?, answer = \?/);
  assert.match(api, /UPDATE feedback_reports SET status = \?/);
  assert.match(view, /Search messages \/ cards/);
  assert.match(view, /From date/);
  assert.match(view, /To date/);
  assert.match(view, /Player/);
  assert.match(view, /Review status/);
  assert.match(view, /Administrator response/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS submission_reviews/);
  assert.match(moderation, /in_review/);
});

test("Players can read resolved administrator replies in their feedback history", async () => {
  const [dialog, history, feedbackApi, rulingsApi] = await Promise.all([
    read("components/application/FeedbackReportsDialog.tsx"),
    read("components/application/MySubmissionHistory.tsx"),
    read("app/api/feedback/route.ts"),
    read("app/api/rulings/route.ts"),
  ]);
  assert.match(dialog, /<MySubmissionHistory \/>/);
  assert.match(history, /fetch\(path, \{ cache: "no-store" \}\)/);
  assert.match(history, /Administrator response/);
  assert.match(history, /review_status/);
  assert.match(history, /api\/rulings/);
  assert.match(history, /api\/feedback/);
  assert.match(feedbackApi, /v\.response/);
  assert.match(rulingsApi, /v\.response/);
  assert.match(feedbackApi, /CASE WHEN COALESCE\(v\.status, f\.status\) IN \('resolved', 'closed'\)/);
  assert.match(rulingsApi, /CASE WHEN COALESCE\(v\.status, r\.status\) IN \('resolved', 'closed'/);
});

test("Moderation statuses preserve legacy ruling and feedback semantics", () => {
  assert.equal(isSubmissionKind("question"), true);
  assert.equal(isSubmissionKind("bug"), true);
  assert.equal(isSubmissionKind("other"), false);
  assert.equal(isSubmissionStatus("in_review"), true);
  assert.equal(isSubmissionStatus("published"), false);
  assert.equal(sourceSubmissionStatus("question", "in_review"), "pending");
  assert.equal(sourceSubmissionStatus("question", "resolved"), "answered");
  assert.equal(sourceSubmissionStatus("question", "closed"), "withdrawn");
  assert.equal(sourceSubmissionStatus("bug", "in_review"), "reviewed");
  assert.equal(sourceSubmissionStatus("issue", "resolved"), "resolved");
  for (const [legacy, status] of [
    ["answered", "resolved"], ["published", "resolved"],
    ["withdrawn", "closed"], ["reviewed", "in_review"],
    ["pending", "pending"],
  ]) assert.equal(normalizedSubmissionStatus(legacy), status);
});
