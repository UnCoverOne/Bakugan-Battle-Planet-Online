import type { SVGProps } from "react";
import type { AchievementCategory } from "../../lib/achievements";

/** Shared category artwork for dashboard rows and achievement cards. */
export function AchievementCategoryIcon({
  category,
  ...props
}: { category: AchievementCategory } & SVGProps<SVGSVGElement>) {
  const common = {
    ...props,
    width: props.width ?? 24,
    height: props.height ?? 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (category) {
    case "Arsenal":
      // Stacked cards
      return <svg {...common}>
        <rect x="3" y="3" width="13" height="13" rx="1.5" />
        <path d="M7 16v2a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2" />
        <path d="M5.5 7h8M5.5 10h6" />
      </svg>;
    case "Arena":
      // Duel / crossed swords
      return <svg {...common}>
        <path d="m14.5 17.5 3-3L6 3 3 6l11.5 11.5Z" />
        <path d="m13 19 2-2 3 3-2 2-3-3ZM11 5l3-2 7 7-2 3" />
        <path d="m8 15-5 5 1 2 2-1 5-5" />
      </svg>;
    case "Brawler Network":
      // Network nodes
      return <svg {...common}>
        <circle cx="5" cy="6" r="2" />
        <circle cx="19" cy="5" r="2" />
        <circle cx="12" cy="13" r="2.5" />
        <circle cx="5" cy="20" r="2" />
        <circle cx="20" cy="19" r="2" />
        <path d="m6.6 7.2 3.5 3.8m4-0.2 3.3-4.1M10.2 15l-3.7 3.5m7.9-3.8 3.8 3" />
      </svg>;
    case "Compendium":
      // Open book
      return <svg {...common}>
        <path d="M12 7a8.5 8.5 0 0 0-9-1v13a8.5 8.5 0 0 1 9 1 8.5 8.5 0 0 1 9-1V6a8.5 8.5 0 0 0-9 1Z" />
        <path d="M12 7v13M5.5 9c1.5-.2 3 .1 4.1.7M14.5 9.7c1.1-.6 2.6-.9 4.1-.7" />
      </svg>;
  }
}
