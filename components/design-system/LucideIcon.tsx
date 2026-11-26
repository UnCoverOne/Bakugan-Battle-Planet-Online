import type { ReactNode, SVGProps } from "react";

/**
 * Lucide icons (ISC licence). Uses the same Compendium glyph paths for
 * density modes, search and filters across both routes.
 * Icons are decorative; put accessible names on their parent controls.
 */
export type LucideIconName =
  | "arrow-left" | "arrow-down-up" | "check" | "circle-alert"
  | "layout-list" | "layout-grid" | "sliders-horizontal" | "list"
  | "search" | "hexagon" | "rectangle-vertical" | "circle-minus"
  | "plus" | "minus" | "x" | "chevron-left" | "chevron-right"
  | "file-pen-line" | "link" | "globe" | "image" | "bot" | "swords" | "trophy" | "lock" | "message-square" | "copy";

const glyphs: Record<LucideIconName, ReactNode> = {
  "arrow-left": <><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></>,
  "arrow-down-up": <><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/></>,
  "check": <path d="M20 6 9 17l-5-5"/>,
  "circle-alert": <><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></>,
  "layout-list": <><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/><path d="M14 4h7"/><path d="M14 9h7"/><path d="M14 15h7"/><path d="M14 20h7"/></>,
  "layout-grid": <><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></>,
  "sliders-horizontal": <><path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/></>,
  "list": <><path d="M8 6h13M8 12h8M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></>,
  "search": <><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></>,
  "hexagon": <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>,
  "rectangle-vertical": <rect width="12" height="20" x="6" y="2" rx="2"/>,
  "circle-minus": <><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></>,
  "plus": <><path d="M5 12h14"/><path d="M12 5v14"/></>,
  "minus": <path d="M5 12h14"/>,
  "x": <><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>,
  "chevron-left": <path d="m15 18-6-6 6-6"/>,
  "chevron-right": <path d="m9 18 6-6-6-6"/>,
  "file-pen-line": <><path d="M12 20h9"/><path d="M5 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/><path d="m17 5 2 2"/><path d="m14 16 4.8-4.8a2.1 2.1 0 0 0-3-3L11 13l-1 4z"/></>,
  "link": <><path d="M10 13a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.1 0l-3 3a5 5 0 1 0 7.1 7.1l1.7-1.7"/></>,
  "globe": <><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></>,
  "bot": <><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/></>,
  "swords": <><path d="m14.5 17.5 3 3M13 19l6-6M2 2l9.5 9.5M2 2v5l5 5M22 2l-9.5 9.5M22 2v5l-5 5M2 22l5-5M5 14l5 5M17 17l5 5"/></>,
  "trophy": <><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.7V17c0 .6-.5 1-1 1-1.7 0-3 1.3-3 3v1M14 14.7V17c0 .6.5 1 1 1 1.7 0 3 1.3 3 3v1"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></>,
  "lock": <><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
  "message-square": <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>,
  "copy": <><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/></>,
  "image": <><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></>,

};

export function LucideIcon({ name, size = 20, ...props }: Omit<SVGProps<SVGSVGElement>, "children"> & {
  name: LucideIconName;
  size?: number;
}) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
    width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
    {...props}>{glyphs[name]}</svg>;
}
