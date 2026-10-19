"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  SUBMISSION_KIND_LABELS, SUBMISSION_STATUS_LABELS, SUBMISSION_KINDS, SUBMISSION_STATUSES,
  type SubmissionKind, type SubmissionStatus,
} from "../../lib/submission-moderation";
import { Surface } from "../design-system/primitives";
import styles from "./AdminFeedbackManagement.module.css";

type Submission = {
  kind: SubmissionKind;
  id: string;
  user_id: string;
  player_name: string;
  player_email: string;
  card_id: string | null;
  message: string;
  source_url: string;
  status: SubmissionStatus;
  response: string;
  submitted_at: number;
  updated_at: number;
  reviewed_by: string | null;
  reviewed_at: number | null;
};
type SubmissionList = { submissions: Submission[]; total: number; error?: string };
type Editor = { key: string; status: SubmissionStatus; response: string };
const dateLabel = (stamp: number) => new Date(stamp).toLocaleString();

export function AdminFeedbackManagement() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selectedKey, setSelectedKey] = useState("");
  const [type, setType] = useState<SubmissionKind | "all">("all");
  const [statusFilter, setStatusFilter] = useState<SubmissionStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [player, setPlayer] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [editor, setEditor] = useState<Editor>({ key: "", status: "pending", response: "" });
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadingError("");
    fetch("/api/admin/submissions", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const result = await res.json() as SubmissionList;
        if (!res.ok) throw new Error(result.error || "Could not load submissions.");
        setSubmissions(result.submissions);
        setTotal(result.total);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadingError(error instanceof Error ? error.message : "Could not load submissions.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);

  const filtered = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();
    const playerTerm = player.trim().toLowerCase();
    const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : -Infinity;
    const to = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : Infinity;
    return submissions.filter((entry) => (
      (type === "all" || entry.kind === type)
      && (statusFilter === "all" || entry.status === statusFilter)
      && entry.submitted_at >= from && entry.submitted_at <= to
      && (!playerTerm || [entry.player_name, entry.player_email, entry.user_id].some((s) => s.toLowerCase().includes(playerTerm)))
      && (!searchTerm || [entry.message, entry.card_id ?? "", entry.id, entry.response].some((s) => s.toLowerCase().includes(searchTerm)))
    ));
  }, [submissions, type, statusFilter, fromDate, toDate, search, player]);

  const selected = filtered.find((entry) => `${entry.kind}:${entry.id}` === selectedKey)
    ?? filtered[0] ?? null;
  const selectedId = selected ? `${selected.kind}:${selected.id}` : "";
  useEffect(() => {
    setEditor({
      key: selectedId,
      status: selected?.status ?? "pending",
      response: selected?.response ?? "",
    });
    setSaveError("");
    setSaveMessage("");
  }, [selectedId, selected?.status, selected?.response]);

  const counts = useMemo(() => ({
    total: submissions.length,
    pending: submissions.filter((entry) => entry.status === "pending").length,
    inReview: submissions.filter((entry) => entry.status === "in_review").length,
    resolved: submissions.filter((entry) => entry.status === "resolved").length,
  }), [submissions]);
  const unsaved = selected !== null && editor.key === selectedId
    && (editor.status !== selected.status || editor.response !== (selected.response ?? ""));
  const save = async () => {
    if (!selected || saving || !unsaved) return;
    setSaving(true);
    setSaveMessage("");
    setSaveError("");
    try {
      const response = await fetch("/api/admin/submissions", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: selected.kind, id: selected.id, status: editor.status, response: editor.response,
        }),
      });
      const result = await response.json() as { error?: string; status?: SubmissionStatus; response?: string; reviewedAt?: number };
      if (!response.ok) throw new Error(result.error || "Could not save changes.");
      const updated = {
        ...selected, status: result.status ?? editor.status, response: result.response ?? editor.response,
        reviewed_at: result.reviewedAt ?? Date.now(),
      };
      setSubmissions((items) => items.map((item) => item.id === selected.id && item.kind === selected.kind ? updated : item));
      setSaveMessage("Review saved. Replies become visible to the player when the submission is resolved or closed.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save changes.");
    } finally {
      setSaving(false);
    }
  };

  return <section className={styles.section} aria-label="Feedback and Reports administration">
    <header className={styles.heading}>
      <div>
        <span>PLAYER SUBMISSIONS</span>
        <h2>Feedback &amp; Reports</h2>
        <p>Review rules questions, suggestions, bug reports and issues in one place.</p>
      </div>
      <button type="button" className={styles.refresh} onClick={() => setRefresh((n) => n + 1)}
        disabled={loading || saving}>Refresh inbox</button>
    </header>

    <div className={styles.metrics} aria-label="Submission summary">
      <div><strong>{counts.total}</strong><span>Loaded</span></div>
      <div><strong>{counts.pending}</strong><span>Pending</span></div>
      <div><strong>{counts.inReview}</strong><span>Under review</span></div>
      <div><strong>{counts.resolved}</strong><span>Resolved</span></div>
    </div>
    {total > submissions.length && <p className={styles.note}>Showing the {submissions.length} most recent of {total} submissions. Older entries are not included in these filters or counts.</p>}
    {loading && <Surface className={styles.notice} role="status">Loading player submissions…</Surface>}
    {loadingError && <Surface className={styles.notice} role="alert">{loadingError} <button type="button" onClick={() => setRefresh((n) => n + 1)}>Retry</button></Surface>}

    <Surface className={styles.filters}>
      <label>Submission type
        <select value={type} onChange={(e) => setType(e.target.value as SubmissionKind | "all")}>
          <option value="all">All types</option>
          {SUBMISSION_KINDS.map((kind) => <option key={kind} value={kind}>{SUBMISSION_KIND_LABELS[kind]}</option>)}
        </select>
      </label>
      <label>Status
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as SubmissionStatus | "all")}>
          <option value="all">All statuses</option>
          {SUBMISSION_STATUSES.map((status) => <option key={status} value={status}>{SUBMISSION_STATUS_LABELS[status]}</option>)}
        </select>
      </label>
      <label>Search messages / cards
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Text or card ID…" />
      </label>
      <label>Player
        <input type="search" value={player} onChange={(e) => setPlayer(e.target.value)} placeholder="Name, email or user ID…" />
      </label>
      <label>From date
        <input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} />
      </label>
      <label>To date
        <input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} />
      </label>
      <button type="button" className={styles.clear} onClick={() => {
        setType("all"); setStatusFilter("all"); setSearch(""); setPlayer(""); setFromDate(""); setToDate("");
      }}>Clear filters</button>
    </Surface>

    <div className={styles.workspace}>
      <Surface className={styles.inbox}>
        <header><h3>Inbox</h3><span>{filtered.length} of {submissions.length}</span></header>
        <div className={styles.entries} aria-label="Submissions list">
          {filtered.map((entry) => {
            const key = `${entry.kind}:${entry.id}`;
            return <button key={key} type="button" aria-pressed={selectedId === key}
              className={styles.entry} onClick={() => { setSelectedKey(key); setSaveError(""); setSaveMessage(""); }}>
              <span className={styles.entryTop}><strong>{SUBMISSION_KIND_LABELS[entry.kind]}</strong><small>{dateLabel(entry.submitted_at)}</small></span>
              <span className={styles.entryBody}>{entry.message}</span>
              <span className={styles.entryMeta}>{entry.player_name} · {SUBMISSION_STATUS_LABELS[entry.status]}{entry.card_id ? ` · ${entry.card_id}` : ""}</span>
            </button>;
          })}
          {!loading && !loadingError && filtered.length === 0 && <p className={styles.empty}>No submissions match these filters.</p>}
        </div>
      </Surface>
      <Surface className={styles.detail}>
        {selected ? <>
          <div className={styles.detailHeading}>
            <div><span className={styles.typeLabel}>{SUBMISSION_KIND_LABELS[selected.kind]}</span>
              <h3>Submission details</h3></div>
            <span className={styles.currentStatus}>{SUBMISSION_STATUS_LABELS[selected.status]}</span>
          </div>
          <dl className={styles.metadata}>
            <div><dt>Player</dt><dd><Link href={`/brawlers/${encodeURIComponent(selected.user_id)}`}>{selected.player_name}</Link> <small>{selected.player_email}</small></dd></div>
            <div><dt>Submitted</dt><dd>{dateLabel(selected.submitted_at)}</dd></div>
            <div><dt>Related card</dt><dd>{selected.card_id
              ? <Link href={`/compendium?card=${encodeURIComponent(selected.card_id)}`}>{selected.card_id} ↗</Link>
              : "None"}</dd></div>
            <div><dt>Request ID</dt><dd className={styles.mono}>{selected.id}</dd></div>
            {selected.reviewed_at && <div><dt>Last reviewed</dt><dd>{dateLabel(selected.reviewed_at)}</dd></div>}
            {selected.source_url && <div><dt>Page</dt><dd className={styles.source}>{selected.source_url}</dd></div>}
          </dl>
          <h4>Player message</h4>
          <p className={styles.message}>{selected.message}</p>
          <label className={styles.editorField}>Review status
            <select value={editor.key === selectedId ? editor.status : selected.status}
              disabled={saving} onChange={(e) => setEditor((v) => ({ ...v, status: e.target.value as SubmissionStatus }))}>
              {SUBMISSION_STATUSES.map((status) => <option key={status} value={status}>{SUBMISSION_STATUS_LABELS[status]}</option>)}
            </select>
          </label>
          <label className={styles.editorField}>Administrator response
            <textarea rows={6} maxLength={2000} disabled={saving}
              value={editor.key === selectedId ? editor.response : selected.response}
              onChange={(e) => setEditor((v) => ({ ...v, response: e.target.value }))}
              placeholder={selected.kind === "question" ? "Write an answer to this question…" : "Optional reply to the player…"} />
            <small>{editor.response.length}/2,000 characters. {selected.kind === "question" ? "An answer is required before resolving a question." : "Replies appear in the player's submission history."}</small>
          </label>
          {saveError && <p className={styles.error} role="alert">{saveError}</p>}
          {saveMessage && <p className={styles.saved} role="status">{saveMessage}</p>}
          <div className={styles.actions}>
            <button type="button" disabled={!unsaved || saving || (selected.kind === "question" && editor.status === "resolved" && editor.response.trim().length < 5)}
              onClick={() => void save()}>{saving ? "Saving…" : "Save review"}</button>
            <button type="button" disabled={!unsaved || saving} onClick={() => setEditor({ key: selectedId, status: selected.status, response: selected.response || "" })}>Discard edits</button>
          </div>
        </> : <div className={styles.emptyDetail}>Select a submission to review its details and reply.</div>}
      </Surface>
    </div>
  </section>;
}
