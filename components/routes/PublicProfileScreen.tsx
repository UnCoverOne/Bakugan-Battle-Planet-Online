"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  normalizePublicBrawlerProfile,
  type PublicBrawlerProfile,
} from "../../lib/public-profile";
import { useApp } from "../application/AppProvider";
import { BrawlerProfileView } from "../profile/BrawlerProfileView";
import styles from "./ProfileScreen.module.css";

export function PublicProfileScreen({ userId }: { userId: string }) {
  const router = useRouter();
  const { authUser } = useApp();
  const [profile, setProfile] = useState<PublicBrawlerProfile | null>(null);
  const [error, setError] = useState("");
  const ownProfile = Boolean(authUser?.id && authUser.id === userId);

  useEffect(() => {
    if (!ownProfile) return;
    router.replace("/profile");
  }, [ownProfile, router]);

  useEffect(() => {
    if (ownProfile) return;
    const controller = new AbortController();
    setError("");
    setProfile(null);
    fetch(`/api/profile?userId=${encodeURIComponent(userId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Profile unavailable.");
        const normalized = normalizePublicBrawlerProfile(result.profile);
        if (!normalized) throw new Error("Profile data is invalid.");
        setProfile(normalized);
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Profile unavailable.");
      });
    return () => controller.abort();
  }, [ownProfile, userId]);

  if (ownProfile) {
    return <div className={styles.saveAnnouncement}>Opening your Profile…</div>;
  }
  if (!profile) {
    return (
      <div className={styles.section} role={error ? "alert" : "status"}>
        {error || "Loading Brawler Profile…"}
      </div>
    );
  }

  return (
    <div className={styles.route}>
      <BrawlerProfileView profile={profile} />
      <div className={styles.section}>
        <Link className={styles.textAction} href="/leaderboard">
          ← Return to leaderboard
        </Link>
      </div>
    </div>
  );
}
