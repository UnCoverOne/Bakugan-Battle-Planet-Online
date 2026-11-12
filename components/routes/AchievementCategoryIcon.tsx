import type { SVGProps } from "react";
import type { AchievementCategory } from "../../lib/achievements";

/**
 * Exact Lucide SVG paths for the achievement categories:
 * Arsenal: Layers (formerly Layers3), Arena: Swords,
 * Brawler Network: Waypoints, Compendium: BookOpenText.
 * Source: https://github.com/lucide-icons/lucide/tree/main/icons (ISC license).
 */
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
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (category) {
    case "Arsenal": // Lucide layers
      return (
        <svg {...common}>
        <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
        <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
        <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
        </svg>
      );
    case "Arena": // Lucide swords
      return (
        <svg {...common}>
        <path d="m13 19 6-6" />
        <path d="M14.5 17.5 3.586 6.586A2 2 0 013 5.172V3h2.172a2 2 0 011.414.586L17.5 14.5" />
        <path d="m14.828 6.172 2.586-2.586A2 2 0 0118.828 3H21v2.172a2 2 0 01-.586 1.414l-2.586 2.586" />
        <path d="m16 16 4 4" />
        <path d="m19 21 2-2" />
        <path d="m5 14 4 4" />
        <path d="m5 21-2-2" />
        <path d="M7.5 16.5 4 20" />
        </svg>
      );
    case "Brawler Network": // Lucide waypoints
      return (
        <svg {...common}>
        <path d="m10.586 5.414-5.172 5.172" />
        <path d="m18.586 13.414-5.172 5.172" />
        <path d="M6 12h12" />
        <circle cx="12" cy="20" r="2" />
        <circle cx="12" cy="4" r="2" />
        <circle cx="20" cy="12" r="2" />
        <circle cx="4" cy="12" r="2" />
        </svg>
      );
    case "Compendium": // Lucide book-open-text
      return (
        <svg {...common}>
        <path d="M12 5v16" />
        <path d="M16 13h2" />
        <path d="M16 9h2" />
        <path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z" />
        <path d="M6 13h2" />
        <path d="M6 9h2" />
        </svg>
      );
  }
}
