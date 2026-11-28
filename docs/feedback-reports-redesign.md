# Feedback & Reports

The Profile menu lazily opens a native modal; desktop matches Settings, and at 850px and below it fills the viewport. The same three-field form is used for guests and authenticated players: submission type, optional related card, and details. A dedicated searchable card subview uses live catalogue revisions, exact printing IDs and existing thumbnail assets. Both Fusion faces can be reported individually. The same dialog protects drafts on close, preserves content after failure and only confirms receipt following a successful API response.

New feedback accepts only issue or suggestion, optional card ID and 20–2,000 characters of details. No current page information, guest contact details, account data, match logs or diagnostics are attached. A server-verified session, if present, associates the submission with its account; otherwise user_id is NULL. Existing historical page URLs, review IDs and statuses remain intact. Historical kinds and the separate Brawler-reporting and rulings systems are not changed.

## Deployment

Apply D1 migration 0023_guest_feedback.sql before deploying code that accepts guests. Back up the database and verify the migration in an isolated environment first. The migration rebuilds the feedback table with a nullable user_id, preserves the existing foreign-key account deletion cascade and recreates its indexes. The original source_url column is retained only for history; new inserts omit it. The admin inbox uses a left join and renders Guest without a profile link. Administrator authorization and submit-only player behavior are unchanged.

Same-origin validation, a bounded request body, server-side card/message validation and rate limits protect the write endpoint. Signed-in accounts retain five submissions per minute; guests have five per minute and twenty per hour per Cloudflare client IP, plus a shared twenty-per-minute client limit. The rate-limit store uses client keys, not the feedback records. No CAPTCHA is introduced.

## Verification

Run the feedback contract, moderation, and profile menu regression tests, palette check, lint, build and the responsive Playwright specs. The migration test runs against in-memory SQLite with foreign keys enabled and verifies legacy row preservation, guest insertion, moderation overlay, indexes and account deletion. On an isolated D1 preview, also submit once as a guest and once authenticated, check administrator review and verify the guest has no profile link. Do not apply migrations against production merely to test the redesign.

```sh
node --import tsx --test tests/feedback-contract.test.ts tests/feedback-reports.test.ts tests/profile-menu.test.ts
npm run check:palette
npm run lint
npm run build
npm run test:visual -- tests/visual/feedback-reports.spec.ts tests/visual/profile-menu.spec.ts
```
