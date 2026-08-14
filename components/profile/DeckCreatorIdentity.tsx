"use client";

import { useEffect, useState } from "react";
import {
  normalizePublicBrawlerProfile,
  type PublicBrawlerProfile,
} from "../../lib/public-profile";
import { PlayerPreview } from "./PlayerPreview";
import { ProfileAvatar } from "./ProfileAvatar";
import styles from "./DeckCreatorIdentity.module.css";

export function DeckCreatorIdentity({
  userId,
  displayName,
}: {
  userId?: string;
  displayName: string;
}) {
  const normalizedUserId = userId?.trim() ?? "";
  const fallbackDisplayName = displayName.trim() || "Community Brawler";
  const [profile, setProfile] = useState<PublicBrawlerProfile | null>(null);

  useEffect(() => {
    setProfile(null);
    if (!normalizedUserId) return;
    const controller = new AbortController();
    fetch(`/api/profile?userId=${encodeURIComponent(normalizedUserId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Profile unavailable.");
        return normalizePublicBrawlerProfile(result.profile);
      })
      .then((nextProfile) => {
        if (nextProfile) setProfile(nextProfile);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setProfile(null);
      });
    return () => controller.abort();
  }, [normalizedUserId]);

  const resolvedDisplayName = profile?.displayName ?? fallbackDisplayName;
  const avatar = profile?.avatar ?? "";

  return (
    <span className={styles.identity} data-deck-creator-identity="true">
      <ProfileAvatar
        profile={{ name: resolvedDisplayName, avatar }}
        className={styles.avatar}
      />
      {normalizedUserId ? (
        <PlayerPreview userId={normalizedUserId} displayName={resolvedDisplayName}>
          <strong className={styles.name}>{resolvedDisplayName}</strong>
        </PlayerPreview>
      ) : (
        <strong className={styles.name}>{resolvedDisplayName}</strong>
      )}
    </span>
  );
}
