"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AchievementRewardManagement } from "./AchievementRewardManagement";
import { AdminScreen } from "./AdminScreen";
import styles from "./AdminControlCentre.module.css";

function AchievementTab({ active }: { active: boolean }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const tabs = document.querySelector<HTMLElement>(
      'nav[aria-label="Administrator sections"]',
    );
    setTarget(tabs);
    if (!tabs || !active) return;
    for (const link of tabs.querySelectorAll<HTMLAnchorElement>("a")) {
      link.classList.remove("active");
      link.removeAttribute("aria-current");
    }
  }, [active]);

  if (!target) return null;
  return createPortal(
    <Link
      className={active ? "active" : ""}
      aria-current={active ? "page" : undefined}
      href="/admin?tab=rewards"
    >
      Achievements
    </Link>,
    target,
  );
}

export function AdminControlCentre() {
  const searchParams = useSearchParams();
  const rewards = searchParams.get("tab") === "rewards";

  return (
    <>
      <div className={rewards ? styles.rewardsMode : undefined}>
        <AdminScreen />
        <AchievementTab active={rewards} />
      </div>
      {rewards ? (
        <div className={styles.embeddedRewards}>
          <AchievementRewardManagement />
        </div>
      ) : null}
    </>
  );
}
