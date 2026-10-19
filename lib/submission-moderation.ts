/** Stable moderation states shared by the administrator queue and submission history. */
export const SUBMISSION_KINDS = ["question", "suggestion", "bug", "issue"] as const;
export const SUBMISSION_STATUSES = ["pending", "in_review", "resolved", "closed"] as const;
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number];
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
export const SUBMISSION_KIND_LABELS: Record<SubmissionKind, string> = {
  question: "Question",
  suggestion: "Feature request",
  bug: "Bug report",
  issue: "Issue report",
};
export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  pending: "Pending",
  in_review: "Under review",
  resolved: "Resolved",
  closed: "Closed",
};
export function isSubmissionKind(value: unknown): value is SubmissionKind {
  return typeof value === "string" && SUBMISSION_KINDS.some((item) => item === value);
}
export function isSubmissionStatus(value: unknown): value is SubmissionStatus {
  return typeof value === "string" && SUBMISSION_STATUSES.some((item) => item === value);
}
export function normalizedSubmissionStatus(source: string): SubmissionStatus {
  if (source === "in_review" || source === "reviewed") return "in_review";
  if (source === "resolved" || source === "answered" || source === "published") return "resolved";
  if (source === "closed" || source === "withdrawn") return "closed";
  return "pending";
}
export function sourceSubmissionStatus(kind: SubmissionKind, status: SubmissionStatus): string {
  if (kind === "question") {
    return status === "resolved" ? "answered" : status === "closed" ? "withdrawn" : "pending";
  }
  return status === "in_review" ? "reviewed" : status;
}
