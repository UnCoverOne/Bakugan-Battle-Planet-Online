"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Tabs } from "../design-system/primitives";
import { AchievementRewardManagement } from "./AchievementRewardManagement";
import { AdminScreen } from "./AdminScreen";
import styles from "./AdminRewardRouter.module.css";

export function AdminRewardRouter() {
  const searchParams = useSearchParams();
  const rewards = searchParams.get("tab") === "rewards";
  return (
    <>
      <Tabs className={styles.tabs} label="Administrator menu">
        <Link
          className={!rewards ? "active" : ""}
          aria-current={!rewards ? "page" : undefined}
          href="/admin"
        >
          Control Centre
        </Link>
        <Link
          className={rewards ? "active" : ""}
          aria-current={rewards ? "page" : undefined}
          href="/admin?tab=rewards"
        >
          Achievement Rewards
        </Link>
      </Tabs>
      {rewards ? <AchievementRewardManagement /> : <AdminScreen />}
    </>
  );
}
