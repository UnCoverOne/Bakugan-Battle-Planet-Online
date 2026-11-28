import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CARDS } from "../lib/data";
import { isSubmissionKind, isSubmissionStatus, normalizedSubmissionStatus, sourceSubmissionStatus } from "../lib/submission-moderation";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Feedback & Reports is a single native modal form with a separate card selection view", async () => {
  const [dialog, selector, styles, questionApi, feedbackApi, profile] = await Promise.all([
    read("components/application/FeedbackReportsDialog.tsx"),
    read("components/application/FeedbackCardSelector.tsx"),
    read("components/application/FeedbackReportsDialog.module.css"),
    read("app/api/rulings/route.ts"),
    read("app/api/feedback/route.ts"),
    read("components/application/ProfileMenu.tsx"),
  ]);
  assert.match(dialog, /<select[^>]*value=\{kind\}/);
  assert.match(dialog, /Report an issue/);
  assert.match(dialog, /Request a feature/);
  assert.match(dialog, /<label htmlFor=\{detailsId\}>Details<\/label>/);
  assert.match(dialog, /minLength=\{FEEDBACK_MIN_LENGTH\} maxLength=\{FEEDBACK_MAX_LENGTH\}/);
  assert.match(dialog, /dialog\.showModal\(\)/);
  assert.match(dialog, /setView\("card"\)/);
  assert.match(dialog, /Discard draft\?/);
  assert.match(dialog, /fetch\("\/api\/feedback"/);
  assert.doesNotMatch(dialog, /sourceUrl|window\.location\.href|signedIn|onSignIn|cardPopover|role="tab"|fetch\("\/api\/rulings"/);
  assert.match(selector, /type="search"/);
  assert.match(selector, /catalogueRevision/);
  assert.match(selector, /presentation="thumbnail"/);
  assert.match(selector, /cardSetCode\(card\)/);
  assert.match(styles, /max-width:850px/);
  assert.match(styles, /var\(--bb-nav\)/);
  assert.doesNotMatch(styles, /linear-gradient|--brand-red|--text-secondary|--font-display\)|\.cardPopover/);
  assert.match(profile, /<FeedbackDialog onClose=\{closeFeedback\}\/>/);
  assert.match(questionApi, /CARD_BY_ID\.has\(cardId\)/);
  assert.match(feedbackApi, /CARD_BY_ID\.has\(id\)/);
  assert.match(feedbackApi, /assertSameOrigin\(request\)/);
  assert.match(feedbackApi, /enforceD1RateLimit\(/);
  assert.match(feedbackApi, /user\?\.id \?\? null/);
  assert.match(feedbackApi, /feedback:guest:minute:/);
  assert.match(feedbackApi, /feedback:guest:hour:/);
  assert.doesNotMatch(feedbackApi, /Sign in is required|sourceUrl|export async function GET\(/);
  assert.ok(CARDS.some(card => card.catalogId.startsWith("aa-")));
  assert.ok(CARDS.some(card => card.catalogId.startsWith("ff-")));
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
  assert.match(api, /FROM feedback_reports f LEFT JOIN users/);
  assert.match(view, /user_id: string \| null/);
  assert.match(view, /selected\.user_id \?/);
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
