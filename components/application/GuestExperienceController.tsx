"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { validateDeck, type DeckRecord } from "../../lib/data";
import {
  clearAccountIntent,
  readAccountIntent,
  rememberAccountIntent,
} from "../../lib/account-intent";
import { useApp } from "./AppProvider";

export const GUEST_BRAWLER_NAME = "Guest Brawler";
const RECOVERY_DISPLAY_KEY = "bbp-pending-recovery-code-display-v1";

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
    requestAccountAccess,
    notify,
  } = useApp();
  const publicStateBootstrapped = useRef(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryNotice, setRecoveryNotice] = useState("");

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
    const guardGuestIdentity = (event: Event) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form?.closest(".main-stage")) return;
      if (!form.querySelector('input[autocomplete="nickname"]')) return;
      event.preventDefault();
      rememberAccountIntent("profile", { returnTo: pathname });
      requestAccountAccess("signup");
      notify("Create an account to choose a permanent Brawler name.");
    };
    document.addEventListener("submit", guardGuestIdentity, true);
    return () => document.removeEventListener("submit", guardGuestIdentity, true);
  }, [authChecking, authUser, notify, pathname, ready, requestAccountAccess]);

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
    try {
      const code = sessionStorage.getItem(RECOVERY_DISPLAY_KEY) ?? "";
      if (code) setRecoveryCode(code);
    } catch {
      // Recovery-code display is best effort when storage is unavailable.
    }
  }, [accountDataReady, authUser]);

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
    const report = validateDeck(deck);
    if (!report.isLegal) {
      notify(`This deck could not be published: ${report.issues[0]?.message ?? "the deck is not legal."}`);
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

  const copyRecoveryCode = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setRecoveryNotice("Recovery code copied.");
    } catch {
      setRecoveryNotice("Copy the code manually before continuing.");
    }
  };

  const dismissRecoveryCode = () => {
    try {
      sessionStorage.removeItem(RECOVERY_DISPLAY_KEY);
    } catch {
      // Nothing else is required.
    }
    setRecoveryCode("");
    setRecoveryNotice("");
  };

  if (!recoveryCode) return null;

  return (
    <div className="recovery-code-backdrop" role="presentation">
      <section className="recovery-code-dialog" role="dialog" aria-modal="true" aria-labelledby="recovery-code-title">
        <span>Account recovery</span>
        <h2 id="recovery-code-title">Save your recovery code</h2>
        <p>
          This code can reset your password if you lose access. It is stored only as a secure hash and will not be shown again after you continue.
        </p>
        <code>{recoveryCode}</code>
        <p className="recovery-code-warning">Store it in a password manager or another private place. A new login replaces the previous recovery code.</p>
        {recoveryNotice && <p className="recovery-code-status" role="status">{recoveryNotice}</p>}
        <div>
          <button type="button" onClick={() => void copyRecoveryCode()}>Copy Code</button>
          <button type="button" onClick={dismissRecoveryCode}>I Have Saved It</button>
        </div>
      </section>
    </div>
  );
}
