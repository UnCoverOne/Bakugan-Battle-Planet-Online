"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { DeckRecord } from "../../lib/data";
import {
  clearAccountIntent,
  readAccountIntent,
  rememberAccountIntent,
} from "../../lib/account-intent";
import { useApp } from "./AppProvider";

export const GUEST_BRAWLER_NAME = "Guest Brawler";

export function GuestExperienceController() {
  const pathname = usePathname();
  const router = useRouter();
  const {
    ready,
    authChecking,
    authUser,
    accountDataReady,
    profile,
    setProfile,
    decks,
    setDecks,
    promptAccount,
    notify,
  } = useApp();
  const publicStateBootstrapped = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.accountScope = authUser ? "account" : "guest";
    return () => {
      delete document.documentElement.dataset.accountScope;
    };
  }, [authUser]);

  useEffect(() => {
    if (!ready || authChecking || authUser) return;
    if (profile.name === GUEST_BRAWLER_NAME && !profile.signedIn) return;
    setProfile({ ...profile, name: GUEST_BRAWLER_NAME, signedIn: false });
  }, [authChecking, authUser, profile, ready, setProfile]);

  useEffect(() => {
    if (!ready || authChecking || authUser || !pathname.startsWith("/profile")) return;
    const reason = pathname.includes("achievements") ? "achievements" : "profile";
    rememberAccountIntent(reason, { returnTo: pathname });
    router.replace(`/account?feature=${reason}`);
  }, [authChecking, authUser, pathname, ready, router]);

  useEffect(() => {
    if (!ready || authChecking || authUser) return;
    const publicDecks = decks.filter((deck: DeckRecord) => deck.visibility === "Public");

    if (!publicStateBootstrapped.current) {
      publicStateBootstrapped.current = true;
      if (!publicDecks.length) return;
      setDecks((items: DeckRecord[]) => items.map((deck) =>
        deck.visibility === "Public"
          ? {
              ...deck,
              visibility: "Private" as const,
              creator: undefined,
              publishedAt: undefined,
            }
          : deck,
      ));
      notify("Guest decks are device-only. Previously Public decks were returned to Private visibility.");
      return;
    }

    if (!publicDecks.length) return;
    const target = [...publicDecks].sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    )[0];
    rememberAccountIntent("publish-deck", {
      deckId: target.id,
      returnTo: pathname,
    });
    setDecks((items: DeckRecord[]) => items.map((deck) =>
      deck.id === target.id
        ? {
            ...deck,
            visibility: "Private" as const,
            creator: undefined,
            publishedAt: undefined,
          }
        : deck,
    ));
    promptAccount("publish-deck");
    window.setTimeout(() => {
      notify("Deck saved privately on this device. Create an account to publish it.");
    }, 0);
  }, [authChecking, authUser, decks, notify, pathname, promptAccount, ready, setDecks]);

  useEffect(() => {
    if (!authUser || !accountDataReady) return;
    const intent = readAccountIntent();
    if (!intent) return;
    if (intent.reason !== "publish-deck" || !intent.deckId) {
      clearAccountIntent();
      return;
    }
    const deck = decks.find((item: DeckRecord) => item.id === intent.deckId);
    if (!deck) {
      clearAccountIntent();
      return;
    }
    if (deck.visibility !== "Public") {
      const publishedAt = new Date().toISOString();
      setDecks((items: DeckRecord[]) => items.map((item) =>
        item.id === intent.deckId
          ? {
              ...item,
              visibility: "Public" as const,
              creator: authUser.displayName,
              publishedAt,
              updatedAt: publishedAt,
              revision: (item.revision ?? 0) + 1,
            }
          : item,
      ));
      notify(`${deck.name} published under ${authUser.displayName}.`);
    }
    clearAccountIntent();
  }, [accountDataReady, authUser, decks, notify, setDecks]);

  return null;
}
