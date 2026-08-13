"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { SocialAccountSummary } from "../../lib/social";
import { readJsonResponse } from "../../lib/json-response";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { SocialAccountActions, SocialAccountPreview } from "./SocialProvider";
import styles from "./MatchResultSocial.module.css";

export function MatchResultSocial({
  matchCode,
  opponentUserId,
  opponentName,
  compact = false,
}: {
  matchCode?: string;
  opponentUserId?: string;
  opponentName: string;
  compact?: boolean;
}) {
  const [account, setAccount] = useState<SocialAccountSummary | null>(null);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (!matchCode && !opponentUserId) return;
    const controller = new AbortController();
    const query = matchCode
      ? `action=match-opponent&code=${encodeURIComponent(matchCode)}`
      : `action=profile&userId=${encodeURIComponent(opponentUserId ?? "")}`;
    fetch(`/api/social?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) return null;
        const result = await readJsonResponse(response, "Opponent profile returned an invalid response.") as { account?: SocialAccountSummary };
        return response.ok ? result.account ?? null : null;
      })
      .then((value) => { if (value) setAccount(value); })
      .catch((error) => { if (error instanceof DOMException && error.name === "AbortError") return; });
    return () => controller.abort();
  }, [matchCode, opponentUserId]);

  if (!account) return <span className={styles.fallback}>{opponentName}</span>;
  return (
    <span className={`${styles.root} ${compact ? styles.compact : ""}`}>
      <button className={styles.account} type="button" onClick={() => setPreview(true)} aria-label={`Preview ${account.displayName}'s profile`}>
        <ProfileAvatar profile={{ name: account.displayName, avatar: account.avatar }} className={styles.avatar} />
        <span><strong>{account.displayName}</strong><small>{account.rank} · {account.bp} BP</small></span>
      </button>
      <SocialAccountActions account={account} compact={compact} />
      {preview && typeof document !== "undefined" && createPortal(<SocialAccountPreview account={account} onClose={() => setPreview(false)} />, document.body)}
    </span>
  );
}
