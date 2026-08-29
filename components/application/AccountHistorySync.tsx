"use client";

import { useCallback, useEffect, useRef } from "react";
import { matchHistoriesEqual, mergeMatchHistories } from "../../lib/match-history-sync";
import type { MatchResultRecord } from "../../lib/persistence";
import { readJsonResponse } from "../../lib/json-response";
import { useApp } from "./AppProvider";

const HISTORY_REFRESH_INTERVAL_MS = 15_000;
const HISTORY_PUSH_RETRY_MS = 750;
const HISTORY_PUSH_RETRY_LIMIT = 6;

function recordFingerprint(record: MatchResultRecord) {
  return JSON.stringify(record);
}

function historyFingerprints(history: MatchResultRecord[]) {
  return new Map(history.map((record) => [record.id, recordFingerprint(record)]));
}

export function AccountHistorySync() {
  const { authUser, accountDataReady, history, setHistory } = useApp();
  const historyRef = useRef<MatchResultRecord[]>(history);
  const observedHistory = useRef<Map<string, string> | null>(null);
  const pendingHistory = useRef<Map<string, MatchResultRecord>>(new Map());
  const pushAttempts = useRef(0);
  const pushTimer = useRef<number | null>(null);
  const pushing = useRef(false);
  const requestSequence = useRef(0);
  const activeUserId = useRef("");

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  const refreshHistory = useCallback(async () => {
    if (!authUser || !accountDataReady || !navigator.onLine) return false;
    const userId = authUser.id;
    const requestId = ++requestSequence.current;
    try {
      const response = await fetch("/api/user-data/history", {
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.timeout(12_000),
      });
      const result = await readJsonResponse(
        response,
        "Match history returned an invalid response.",
      );
      if (!response.ok || !Array.isArray(result.history)) return false;
      if (
        requestId !== requestSequence.current
        || activeUserId.current !== userId
      ) {
        return false;
      }

      const remoteHistory = result.history as MatchResultRecord[];
      const remoteIds = new Set(remoteHistory.map((record) => record.id));

      // Account recovery data can contain a completed match that was created
      // while the device was offline. Preserve only records the server has not
      // seen yet, then push those records through the dedicated history API.
      for (const record of historyRef.current) {
        if (!remoteIds.has(record.id)) pendingHistory.current.set(record.id, record);
      }

      const pending = [...pendingHistory.current.values()];
      const merged = mergeMatchHistories(
        pending,
        remoteHistory,
        remoteHistory.length + pending.length,
      );
      observedHistory.current = historyFingerprints(merged);
      if (!matchHistoriesEqual(historyRef.current, merged)) {
        historyRef.current = merged;
        setHistory(merged);
      }
      return true;
    } catch {
      // The account sync surface already owns user-facing connectivity state.
      // Keep the last in-memory archive until the server can be reached again.
      return false;
    }
  }, [accountDataReady, authUser, setHistory]);

  const pushPendingHistory = useCallback(async () => {
    if (
      !authUser
      || !accountDataReady
      || !navigator.onLine
      || pushing.current
      || pendingHistory.current.size === 0
    ) {
      return;
    }
    const userId = authUser.id;
    pushing.current = true;
    let completed = false;
    try {
      for (const [id, record] of [...pendingHistory.current.entries()]) {
        if (activeUserId.current !== userId) return;
        const response = await fetch("/api/user-data/history", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ record }),
          signal: AbortSignal.timeout(12_000),
        });
        const result = await readJsonResponse(
          response,
          "Match record save returned an invalid response.",
        );
        if (!response.ok) {
          throw new Error(result.error ?? "Could not save match record.");
        }
        pendingHistory.current.delete(id);
      }
      pushAttempts.current = 0;
      completed = true;
    } catch {
      pushAttempts.current += 1;
      if (
        pendingHistory.current.size > 0
        && pushAttempts.current < HISTORY_PUSH_RETRY_LIMIT
        && navigator.onLine
      ) {
        if (pushTimer.current !== null) window.clearTimeout(pushTimer.current);
        pushTimer.current = window.setTimeout(() => {
          pushTimer.current = null;
          void pushPendingHistory();
        }, HISTORY_PUSH_RETRY_MS * pushAttempts.current);
      }
    } finally {
      pushing.current = false;
    }

    if (completed && activeUserId.current === userId) {
      // Re-read the complete server archive immediately. AppProvider keeps a
      // small recovery snapshot, while this component owns the full archive.
      await refreshHistory();
    }
  }, [accountDataReady, authUser, refreshHistory]);

  useEffect(() => {
    if (!authUser || !accountDataReady) {
      activeUserId.current = "";
      observedHistory.current = null;
      pendingHistory.current.clear();
      pushAttempts.current = 0;
      requestSequence.current += 1;
      if (pushTimer.current !== null) {
        window.clearTimeout(pushTimer.current);
        pushTimer.current = null;
      }
      return;
    }

    if (activeUserId.current !== authUser.id) {
      activeUserId.current = authUser.id;
      observedHistory.current = historyFingerprints(historyRef.current);
      pendingHistory.current.clear();
      pushAttempts.current = 0;
      requestSequence.current += 1;
    }

    void refreshHistory().then(() => {
      if (pendingHistory.current.size > 0) void pushPendingHistory();
    });
  }, [accountDataReady, authUser, pushPendingHistory, refreshHistory]);

  useEffect(() => {
    if (!authUser || !accountDataReady) return;
    const previous = observedHistory.current;
    const next = historyFingerprints(history);
    observedHistory.current = next;
    if (!previous) return;

    const archiveWasTruncated = [...previous.keys()].some(
      (id) => !next.has(id) && !pendingHistory.current.has(id),
    );
    let changed = false;
    for (const record of history) {
      if (previous.get(record.id) === recordFingerprint(record)) continue;
      pendingHistory.current.set(record.id, record);
      changed = true;
    }
    if (!changed) {
      // Generic account recovery responses intentionally contain only a small
      // recent-history window. If one temporarily replaces the runtime archive,
      // immediately restore the complete archive from the history endpoint.
      if (archiveWasTruncated && navigator.onLine) void refreshHistory();
      return;
    }

    pushAttempts.current = 0;
    if (pushTimer.current !== null) window.clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(() => {
      pushTimer.current = null;
      void pushPendingHistory();
    }, 0);
  }, [accountDataReady, authUser, history, pushPendingHistory, refreshHistory]);

  useEffect(() => {
    if (!authUser || !accountDataReady) return;
    const refreshWhenUsable = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        void refreshHistory().then(() => {
          if (pendingHistory.current.size > 0) void pushPendingHistory();
        });
      }
    };
    const interval = window.setInterval(
      refreshWhenUsable,
      HISTORY_REFRESH_INTERVAL_MS,
    );
    addEventListener("focus", refreshWhenUsable);
    addEventListener("online", refreshWhenUsable);
    document.addEventListener("visibilitychange", refreshWhenUsable);
    return () => {
      requestSequence.current += 1;
      window.clearInterval(interval);
      removeEventListener("focus", refreshWhenUsable);
      removeEventListener("online", refreshWhenUsable);
      document.removeEventListener("visibilitychange", refreshWhenUsable);
    };
  }, [accountDataReady, authUser, pushPendingHistory, refreshHistory]);

  useEffect(() => () => {
    if (pushTimer.current !== null) window.clearTimeout(pushTimer.current);
  }, []);

  return null;
}
