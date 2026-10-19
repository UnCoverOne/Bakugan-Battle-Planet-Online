"use client";

import { useEffect, useMemo, useState } from "react";
import {
  normalizedSubmissionStatus, SUBMISSION_KIND_LABELS, SUBMISSION_STATUS_LABELS,
  type SubmissionKind,
} from "../../lib/submission-moderation";
import styles from "./MySubmissionHistory.module.css";

type PlayerSubmission = {
  kind: SubmissionKind;
  id: string;
  message: string;
  status: string;
  response: string;
  submittedAt: number;
};
type Question = {
  id: string;
  question: string;
  status: string;
  review_status?: string;
  response?: string;
  answer?: string | null;
  submitted_at: number;
};
type Feedback = {
  id: string;
  kind: "suggestion" | "bug" | "issue";
  message: string;
  status: string;
  review_status?: string;
  response?: string;
  submitted_at: number;
};

export function MySubmissionHistory() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PlayerSubmission[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    const get = async (path: string) => {
      const result = await fetch(path, { cache: "no-store" });
      const body = await result.json();
      if (!result.ok) throw new Error(body.error ?? "Could not load your submissions.");
      return body;
    };
    Promise.all([get("/api/rulings"), get("/api/feedback")])
      .then(([questions, feedback]: [{ requests: Question[] }, { reports: Feedback[] }]) => {
        if (!active) return;
        const all: PlayerSubmission[] = [
          ...questions.requests.map((q) => ({
            kind: "question" as const, id: q.id, message: q.question, status: q.review_status ?? q.status,
            response: q.response ?? q.answer ?? "", submittedAt: q.submitted_at,
          })),
          ...feedback.reports.map((f) => ({
            kind: f.kind, id: f.id, message: f.message, status: f.review_status ?? f.status,
            response: f.response ?? "", submittedAt: f.submitted_at,
          })),
        ];
        setItems(all.sort((a, b) => b.submittedAt - a.submittedAt));
      })
      .catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : "Could not load your submissions.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, refresh]);
  const resolvedCount = useMemo(() => items.filter((item) => normalizedSubmissionStatus(item.status) === "resolved").length, [items]);
  return <section className={styles.history} aria-label="Your feedback history">
    <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      My submissions <span aria-hidden="true">{open ? "▴" : "▾"}</span>
    </button>
    {open && <div className={styles.content}>
      <div className={styles.summary}><span>{items.length} submissions · {resolvedCount} resolved</span>
        <button type="button" onClick={() => setRefresh((n) => n + 1)} disabled={loading}>Refresh</button></div>
      {loading && <p role="status">Loading submissions…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && items.length === 0 && <p>No submissions yet.</p>}
      {!loading && !error && <div className={styles.list}>
        {items.map((item) => <article key={`${item.kind}:${item.id}`} className={styles.item}>
          <div className={styles.meta}>
            <strong>{SUBMISSION_KIND_LABELS[item.kind]}</strong>
            <span>{SUBMISSION_STATUS_LABELS[normalizedSubmissionStatus(item.status)]}</span>
            <small>{new Date(item.submittedAt).toLocaleDateString()}</small>
          </div>
          <p>{item.message}</p>
          {item.response && <div className={styles.reply}><strong>Administrator response</strong><p>{item.response}</p></div>}
        </article>)}
      </div>}
    </div>}
  </section>;
}
