"use client";

import { useEffect, useState } from "react";
import type { MatchState } from "../../lib/game";
import {
  accountIsAdministrator,
  canRevealOpponentAiCards,
} from "../../lib/admin-ai-visibility";
import { useApp } from "./AppProvider";

const VISIBILITY_EVENT = "bbp-administrator-ai-visibility-updated";
let cachedAdministratorId = "";
let cachedEnabled = false;
let cacheReady = false;
let pendingRequest: Promise<boolean> | null = null;

async function loadVisibility(administratorId: string) {
  if (cacheReady && cachedAdministratorId === administratorId) return cachedEnabled;
  if (pendingRequest && cachedAdministratorId === administratorId) return pendingRequest;
  cachedAdministratorId = administratorId;
  pendingRequest = fetch("/api/admin?section=ai-visibility", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return false;
      const result = await response.json() as { revealAiCards?: boolean };
      return Boolean(result.revealAiCards);
    })
    .catch(() => false)
    .then((enabled) => {
      cachedEnabled = enabled;
      cacheReady = true;
      pendingRequest = null;
      return enabled;
    });
  return pendingRequest;
}

export function notifyAdministratorAiVisibilityChanged(enabled: boolean) {
  cachedEnabled = Boolean(enabled);
  cacheReady = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(VISIBILITY_EVENT, {
      detail: { enabled: cachedEnabled },
    }));
  }
}

export function useAdministratorAiVisibility(
  match: MatchState | null | undefined,
  playerId: string | undefined,
) {
  const { authUser } = useApp();
  const administrator = accountIsAdministrator(authUser);
  const [enabled, setEnabled] = useState(() => (
    administrator
    && cachedAdministratorId === authUser?.id
    && cacheReady
    && cachedEnabled
  ));

  useEffect(() => {
    if (!administrator || !authUser?.id) {
      setEnabled(false);
      return;
    }
    let active = true;
    void loadVisibility(authUser.id).then((value) => {
      if (active) setEnabled(value);
    });
    const receiveUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled?: boolean }>).detail;
      if (typeof detail?.enabled === "boolean") setEnabled(detail.enabled);
      else void loadVisibility(authUser.id).then((value) => active && setEnabled(value));
    };
    window.addEventListener(VISIBILITY_EVENT, receiveUpdate);
    return () => {
      active = false;
      window.removeEventListener(VISIBILITY_EVENT, receiveUpdate);
    };
  }, [administrator, authUser?.id]);

  return canRevealOpponentAiCards(match, playerId, authUser, enabled);
}
