"use client";

import type { ReactNode } from "react";
import { ActionButton, StatusChip, Surface } from "../design-system/primitives";
import styles from "./SystemState.module.css";

export type SystemStateTone =
  | "loading"
  | "offline"
  | "error"
  | "empty"
  | "version"
  | "conflict"
  | "notFound";

const ICONS: Record<SystemStateTone, string> = {
  loading: "◌",
  offline: "↯",
  error: "!",
  empty: "◇",
  version: "↻",
  conflict: "⇄",
  notFound: "404",
};

export function SystemState({
  tone,
  eyebrow,
  title,
  message,
  actions,
  compact = false,
  role,
}: {
  tone: SystemStateTone;
  eyebrow?: string;
  title: string;
  message: string;
  actions?: ReactNode;
  compact?: boolean;
  role?: "alert" | "status";
}) {
  return (
    <Surface
      data-ui="system-state"
      className={`${styles.state} ${styles[tone]} ${compact ? styles.compact : ""}`}
      role={
        role ?? (tone === "error" || tone === "version" ? "alert" : "status")
      }
      aria-busy={tone === "loading" || undefined}
    >
      <span className={styles.icon} aria-hidden="true">
        {ICONS[tone]}
      </span>
      <div className={styles.copy}>
        <span>{eyebrow ?? tone}</span>
        <h1>{title}</h1>
        <p>{message}</p>
        {tone === "loading" && (
          <div className={styles.skeleton} aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        )}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </Surface>
  );
}

export function ConfirmationDialog({
  title,
  objectName,
  consequence,
  confirmLabel,
  onCancel,
  onConfirm,
  busy = false,
}: {
  title: string;
  objectName: string;
  consequence: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <Surface
        className={styles.dialog}
        elevation="overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
      >
        <StatusChip tone="danger">Confirmation required</StatusChip>
        <h2 id="confirmation-title">{title}</h2>
        <strong>{objectName}</strong>
        <p>{consequence}</p>
        <div className={styles.dialogActions}>
          <ActionButton tone="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </ActionButton>
          <ActionButton tone="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </ActionButton>
        </div>
      </Surface>
    </div>
  );
}

type SnapshotSummary = {
  updatedAt: number;
  decks: unknown[];
  history: unknown[];
};

export function SyncConflictPanel({
  conflict,
  onResolve,
  busy = false,
}: {
  conflict: { local: SnapshotSummary; cloud: SnapshotSummary };
  onResolve: (preference: "merge" | "local" | "cloud") => void;
  busy?: boolean;
}) {
  const summary = (snapshot: SnapshotSummary) => ({
    updated: new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(snapshot.updatedAt),
    decks: snapshot.decks.length,
    matches: snapshot.history.length,
  });
  const local = summary(conflict.local);
  const cloud = summary(conflict.cloud);
  return (
    <Surface
      data-ui="sync-conflict"
      className={styles.conflictPanel}
      role="alert"
    >
      <header>
        <StatusChip tone="warning">Sync conflict</StatusChip>
        <h3>Choose which account data to keep</h3>
        <p>
          This signed-in session and another cloud revision changed independently. Nothing will be
          overwritten until you choose.
        </p>
      </header>
      <div className={styles.comparison}>
        <article>
          <span>Pending account changes</span>
          <strong>{local.updated}</strong>
          <small>
            {local.decks} decks · {local.matches} matches
          </small>
        </article>
        <article>
          <span>Cloud copy</span>
          <strong>{cloud.updated}</strong>
          <small>
            {cloud.decks} decks · {cloud.matches} matches
          </small>
        </article>
      </div>
      <div className={styles.conflictActions}>
        <ActionButton onClick={() => onResolve("merge")} disabled={busy}>
          Merge safely
        </ActionButton>
        <ActionButton
          tone="secondary"
          onClick={() => onResolve("local")}
          disabled={busy}
        >
          Use pending changes
        </ActionButton>
        <ActionButton
          tone="secondary"
          onClick={() => onResolve("cloud")}
          disabled={busy}
        >
          Use cloud copy
        </ActionButton>
      </div>
      <small>
        Merge keeps each deck’s most recently edited version and carries
        deletions across devices.
      </small>
    </Surface>
  );
}

export function VersionMismatchScreen({
  onRefresh,
}: {
  onRefresh: () => void;
}) {
  return (
    <div className={styles.blockingLayer}>
      <SystemState
        tone="version"
        eyebrow="Update required"
        title="A newer client is available"
        message="This tab is running an older application version. Refresh before continuing so interface code, card data, and online requests use the same release."
        actions={
          <ActionButton onClick={onRefresh}>Refresh and update</ActionButton>
        }
      />
    </div>
  );
}
