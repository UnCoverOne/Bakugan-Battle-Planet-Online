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
  assert.match(api, /UPDATE ruling_requests SET status = \?, administrator_id = \?/);
  assert.match(api, /UPDATE feedback_reports SET status = \?/);
  assert.match(view, /Search messages \/ cards/);
  assert.match(view, /From date/);
  assert.match(view, /To date/);
  assert.match(view, /Player/);
  assert.match(view, /Review status/);
  assert.doesNotMatch(view, /Administrator response|<textarea|reply to the player|submission history/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS submission_reviews/);
  assert.match(moderation, /in_review/);
});

test("Feedback is submit-only for players, with no history or administrator replies", async () => {
  const [dialog, admin, api, feedbackApi, rulingsApi] = await Promise.all([
    read("components/application/FeedbackReportsDialog.tsx"),
    read("components/routes/AdminFeedbackManagement.tsx"),
    read("app/api/admin/submissions/route.ts"),
    read("app/api/feedback/route.ts"),
    read("app/api/rulings/route.ts"),
  ]);
  assert.doesNotMatch(dialog, /MySubmissionHistory|My submissions|submission history/i);
  assert.doesNotMatch(admin, /Administrator response|<textarea|reply to the player|editor\.response/i);
  assert.doesNotMatch(api, /AS response|answer = \?|v\.response|r\.answer|body\.response|response: now/i);
  assert.match(api, /Object\.prototype\.hasOwnProperty\.call\(body, "response"\)/);
  assert.match(api, /UPDATE ruling_requests SET status = \?, administrator_id = \?/);
  assert.doesNotMatch(feedbackApi, /export async function GET\(/);
  assert.doesNotMatch(rulingsApi, /export async function GET\(/);
  assert.match(feedbackApi, /export async function POST\(/);
  assert.match(rulingsApi, /export async function POST\(/);
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
