"use client";

import { useCallback, useEffect, useRef } from "react";
import { matchHistoriesEqual, mergeMatchHistories } from "../../lib/match-history-sync";
import { lifetimeMatchStatsFromHistory } from "../../lib/match-statistics";
import type { MatchResultRecord } from "../../lib/persistence";
import { readJsonResponse } from "../../lib/json-response";
import { useApp } from "./AppProvider";

const HISTORY_REFRESH_INTERVAL_MS = 60_000;
const HISTORY_PUSH_RETRY_MS = 1_000;
const HISTORY_PUSH_RETRY_LIMIT = 6;

function recordFingerprint(record: MatchResultRecord) {
  return JSON.stringify(record);
}

function historyFingerprints(history: MatchResultRecord[]) {
  return new Map(history.map((record) => [record.id, recordFingerprint(record)]));
}

export function AccountHistorySync() {
  const { authUser, accountDataReady, history, setHistory, setLifetimeStats } = useApp();
  const historyRef = useRef<MatchResultRecord[]>(history);
  const observedHistory = useRef<Map<string, string> | null>(null);
  const pendingHistory = useRef<Map<string, MatchResultRecord>>(new Map());
  const rejectedHistory = useRef<Map<string, string>>(new Map());
  const pushAttempts = useRef<Map<string, number>>(new Map());
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

      // The dedicated history endpoint is the source of truth for a signed-in
      // account. Only records explicitly observed as new while this account is
      // active may be overlaid while their direct POST is still pending. Never
      // infer pending work from historyRef here: during an account switch the
      // provider can briefly still contain the previous account's in-memory
      // snapshot, which must never be copied into the newly authenticated user.
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
      const repairedStats = lifetimeMatchStatsFromHistory(merged);
      setLifetimeStats((current) => (
        JSON.stringify(current) === JSON.stringify(repairedStats)
          ? current
          : repairedStats
      ));
      return true;
    } catch {
      // The account sync surface already owns user-facing connectivity state.
      // Keep the last in-memory archive until the server can be reached again.
      return false;
    }
  }, [accountDataReady, authUser, setHistory, setLifetimeStats]);

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
          const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
          if (permanent) {
            const fingerprint = recordFingerprint(record);
            if (recordFingerprint(pendingHistory.current.get(id) ?? record) === fingerprint) {
              pendingHistory.current.delete(id);
              rejectedHistory.current.set(id, fingerprint);
            }
            pushAttempts.current.delete(id);
            console.warn("Match history record was rejected and will not be retried.", {
              id,
              code: result.code,
              error: result.error,
            });
            continue;
          }
          const attempts = (pushAttempts.current.get(id) ?? 0) + 1;
          pushAttempts.current.set(id, attempts);
          if (attempts < HISTORY_PUSH_RETRY_LIMIT && navigator.onLine) {
            if (pushTimer.current !== null) window.clearTimeout(pushTimer.current);
            pushTimer.current = window.setTimeout(() => {
              pushTimer.current = null;
              void pushPendingHistory();
            }, HISTORY_PUSH_RETRY_MS * 2 ** Math.min(5, attempts - 1));
          }
          return;
        }
        if (activeUserId.current !== userId) return;
        const currentPending = pendingHistory.current.get(id);
        if (
          currentPending
          && recordFingerprint(currentPending) === recordFingerprint(record)
        ) {
          pendingHistory.current.delete(id);
        }
        pushAttempts.current.delete(id);
        rejectedHistory.current.delete(id);
      }
    } catch {
      const firstPendingId = pendingHistory.current.keys().next().value as string | undefined;
      const attempts = firstPendingId
        ? (pushAttempts.current.get(firstPendingId) ?? 0) + 1
        : HISTORY_PUSH_RETRY_LIMIT;
      if (firstPendingId) pushAttempts.current.set(firstPendingId, attempts);
      if (pendingHistory.current.size > 0 && attempts < HISTORY_PUSH_RETRY_LIMIT && navigator.onLine) {
        if (pushTimer.current !== null) window.clearTimeout(pushTimer.current);
        pushTimer.current = window.setTimeout(() => {
          pushTimer.current = null;
          void pushPendingHistory();
        }, HISTORY_PUSH_RETRY_MS * 2 ** Math.min(5, attempts - 1));
      }
      return;
    } finally {
      pushing.current = false;
    }

    if (activeUserId.current === userId && pendingHistory.current.size > 0 && pushTimer.current === null) {
      void pushPendingHistory();
    }
  }, [accountDataReady, authUser]);

  useEffect(() => {
    if (!authUser || !accountDataReady) {
      activeUserId.current = "";
      observedHistory.current = null;
      pendingHistory.current.clear();
      rejectedHistory.current.clear();
      pushAttempts.current.clear();
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
      rejectedHistory.current.clear();
      pushAttempts.current.clear();
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
      const fingerprint = recordFingerprint(record);
      if (previous.get(record.id) === fingerprint) continue;
      if (rejectedHistory.current.get(record.id) === fingerprint) continue;
      rejectedHistory.current.delete(record.id);
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
