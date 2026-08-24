"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { matchHistoriesEqual, mergeMatchHistories } from "../../lib/match-history-sync";
import type { MatchResultRecord } from "../../lib/persistence";
import { readJsonResponse } from "../../lib/json-response";
import { useApp } from "./AppProvider";

const HISTORY_REFRESH_INTERVAL_MS = 15_000;

export function AccountHistorySync() {
  const pathname = usePathname();
  const { authUser, accountDataReady, history, setHistory } = useApp();
  const historyRef = useRef<MatchResultRecord[]>(history);
  const requestSequence = useRef(0);
  const recordsRoute = pathname === "/profile/records" || pathname.startsWith("/profile/records/");

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

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
