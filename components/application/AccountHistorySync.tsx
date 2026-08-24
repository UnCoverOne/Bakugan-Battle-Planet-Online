"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { matchHistoriesEqual, mergeMatchHistories } from "../../lib/match-history-sync";
import type { MatchResultRecord } from "../../lib/persistence";
import { readJsonResponse } from "../../lib/json-response";
import { useApp } from "./AppProvider";

const HISTORY_REFRESH_INTERVAL_MS = 15_000;
const HISTORY_PUSH_RETRY_MS = 500;
const HISTORY_PUSH_RETRY_LIMIT = 6;

export function AccountHistorySync() {
  const pathname = usePathname();
  const { authUser, accountDataReady, history, setHistory, syncNow } = useApp();
  const historyRef = useRef<MatchResultRecord[]>(history);
  const observedHistoryIds = useRef<Set<string> | null>(null);
  const pendingHistoryPush = useRef(false);
  const pushAttempts = useRef(0);
  const pushTimer = useRef<number | null>(null);
  const requestSequence = useRef(0);
  const recordsRoute = pathname === "/profile/records" || pathname.startsWith("/profile/records/");

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  const pushPendingHistory = useCallback(async () => {
    if (!authUser || !accountDataReady || !pendingHistoryPush.current || !navigator.onLine) return;
    let saved = false;
    try {
      saved = await syncNow();
    } catch {
      saved = false;
    }
    if (saved) {
      pendingHistoryPush.current = false;
      pushAttempts.current = 0;
      return;
    }
    if (!pendingHistoryPush.current || !navigator.onLine) return;
    pushAttempts.current += 1;
    if (pushAttempts.current >= HISTORY_PUSH_RETRY_LIMIT) return;
    if (pushTimer.current !== null) window.clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(() => {
      pushTimer.current = null;
      void pushPendingHistory();
    }, HISTORY_PUSH_RETRY_MS);
  }, [accountDataReady, authUser, syncNow]);

  useEffect(() => {
    if (!authUser || !accountDataReady) {
      observedHistoryIds.current = null;
      pendingHistoryPush.current = false;
      pushAttempts.current = 0;
      if (pushTimer.current !== null) {
        window.clearTimeout(pushTimer.current);
        pushTimer.current = null;
      }
      return;
    }
    const nextIds = new Set(history.map((record) => record.id));
    const previousIds = observedHistoryIds.current;
    observedHistoryIds.current = nextIds;
    if (!previousIds) return;
    if (!history.some((record) => !previousIds.has(record.id))) return;

    // Match completion can coincide with AppProvider applying a cloud response.
    // Force a sync for newly-created records so the record and its lifetime-stat
    // update reach D1 even if the normal durable-change detector was suppressed.
    pendingHistoryPush.current = true;
    pushAttempts.current = 0;
    if (pushTimer.current !== null) window.clearTimeout(pushTimer.current);
    pushTimer.current = window.setTimeout(() => {
      pushTimer.current = null;
      void pushPendingHistory();
    }, 0);
  }, [accountDataReady, authUser, history, pushPendingHistory]);

  useEffect(() => {
    if (!authUser || !accountDataReady) return;
    const retryPendingHistory = () => {
      if (pendingHistoryPush.current && navigator.onLine) void pushPendingHistory();
    };
    addEventListener("online", retryPendingHistory);
    addEventListener("focus", retryPendingHistory);
    document.addEventListener("visibilitychange", retryPendingHistory);
    return () => {
      removeEventListener("online", retryPendingHistory);
      removeEventListener("focus", retryPendingHistory);
      document.removeEventListener("visibilitychange", retryPendingHistory);
    };
  }, [accountDataReady, authUser, pushPendingHistory]);

  useEffect(() => () => {
    if (pushTimer.current !== null) window.clearTimeout(pushTimer.current);
  }, []);

  const refreshHistory = useCallback(async () => {
    if (!authUser || !accountDataReady || !recordsRoute || !navigator.onLine) return;
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
      if (!response.ok || !Array.isArray(result.history)) return;
      if (requestId !== requestSequence.current) return;
      const remoteHistory = result.history as MatchResultRecord[];
      const merged = mergeMatchHistories(historyRef.current, remoteHistory);
      if (matchHistoriesEqual(historyRef.current, merged)) return;
      historyRef.current = merged;
      observedHistoryIds.current = new Set(merged.map((record) => record.id));
      setHistory(merged);
    } catch {
      // Account sync already owns user-facing connectivity state. A history
      // refresh failure should not replace or clear the records on this device.
    }
  }, [accountDataReady, authUser, recordsRoute, setHistory]);

  useEffect(() => {
    if (!authUser || !accountDataReady || !recordsRoute) return;
    const refreshWhenUsable = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        void refreshHistory();
      }
    };
    refreshWhenUsable();
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
  }, [accountDataReady, authUser, recordsRoute, refreshHistory]);

  return null;
}