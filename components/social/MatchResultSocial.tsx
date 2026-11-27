"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SocialAccountSummary } from "../../lib/social";
import { readJsonResponse } from "../../lib/json-response";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { SocialAccountActions } from "./SocialProvider";
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

  useEffect(() => {
    setAccount(null);
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
      .then((value) => { if (value && !controller.signal.aborted) setAccount(value); })
      .catch((error) => { if (error instanceof DOMException && error.name === "AbortError") return; });
    return () => controller.abort();
  }, [matchCode, opponentUserId]);

  if (!account) return <span className={styles.fallback}>{opponentName}</span>;
  return (
    <div className={`${styles.root} ${compact ? styles.compact : ""}`}>
      <Link className={styles.account} href={"/brawlers/"+encodeURIComponent(account.userId)} aria-label={"View "+account.displayName+" profile"}>
        <ProfileAvatar profile={{ name: account.displayName, avatar: account.avatar }} className={styles.avatar} />
        <span><strong>{account.displayName}</strong><small>{account.rank} · {account.bp} BP</small></span>
      </Link>
      <SocialAccountActions account={account} compact={compact} />

    </div>
  );
}
