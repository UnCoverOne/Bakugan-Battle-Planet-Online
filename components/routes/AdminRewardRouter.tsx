"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { RouteHero, StatusChip, Tabs } from "../design-system/primitives";
import { AchievementRewardManagement } from "./AchievementRewardManagement";
import { AdminScreen } from "./AdminScreen";
import styles from "./AdminRewardRouter.module.css";

type AdminTab = "ai" | "offline" | "cards" | "ranked" | "users" | "achievements";

export function AdminRewardRouter() {
  const searchParams = useSearchParams();
  const requested = searchParams.get("tab");
  const tab: AdminTab = requested === "offline" ||
    requested === "cards" ||
    requested === "ranked" ||
    requested === "users" ||
    requested === "achievements" ||
    requested === "rewards"
    ? requested === "rewards" ? "achievements" : requested
    : "ai";

  return (
    <div className={styles.route}>
      <RouteHero
        eyebrow="ADMINISTRATOR"
        title="Control Centre"
        description="Manage AI loadouts, the live card catalogue, public content, achievements, and player accounts."
        aside={<StatusChip tone="danger">Restricted</StatusChip>}
      />
      <Tabs className={styles.tabs} label="Administrator sections">
        <Link className={tab === "ai" ? "active" : ""} aria-current={tab === "ai" ? "page" : undefined} href="/admin?tab=ai">AI Management</Link>
        <Link className={tab === "offline" ? "active" : ""} aria-current={tab === "offline" ? "page" : undefined} href="/admin?tab=offline">Offline Decks</Link>
        <Link className={tab === "cards" ? "active" : ""} aria-current={tab === "cards" ? "page" : undefined} href="/admin?tab=cards">Card Management</Link>
        <Link className={tab === "ranked" ? "active" : ""} aria-current={tab === "ranked" ? "page" : undefined} href="/admin?tab=ranked">Ranked Play</Link>
        <Link className={tab === "users" ? "active" : ""} aria-current={tab === "users" ? "page" : undefined} href="/admin?tab=users">User Management</Link>
        <Link className={tab === "achievements" ? "active" : ""} aria-current={tab === "achievements" ? "page" : undefined} href="/admin?tab=achievements">Achievements</Link>
      </Tabs>
      {tab === "achievements" ? (
        <AchievementRewardManagement />
      ) : (
        <div className={styles.adminContent}>
          <AdminScreen />
        </div>
      )}
    </div>
  );
}
