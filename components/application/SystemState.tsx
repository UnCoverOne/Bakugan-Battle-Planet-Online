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
