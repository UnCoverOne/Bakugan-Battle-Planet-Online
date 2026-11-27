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
  | "gamepad-2" | "monitor" | "volume-2" | "key-round" | "download" | "trash-2" | "menu"
  | "user-round" | "history" | "settings" | "log-out" | "shield" | "layers" | "layout-dashboard" | "play" | "library-big"
  | "users" | "inbox" | "ellipsis" | "send" | "chevron-down" | "file-pen-line" | "link" | "globe" | "image" | "bot" | "swords" | "trophy" | "lock" | "message-square" | "copy";

const glyphs: Record<LucideIconName, ReactNode> = {
  "gamepad-2": <><path d="M6 12h4M8 10v4M15 13h.01M18 11h.01"/><path d="M17.3 7H6.7a4 4 0 0 0-3.9 3.2l-1 5a2.5 2.5 0 0 0 4.2 2.3L9 15h6l3 2.5a2.5 2.5 0 0 0 4.2-2.3l-1-5A4 4 0 0 0 17.3 7Z"/></>,
  "monitor": <><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></>,
  "volume-2": <><path d="M11 5 6 9H3v6h3l5 4V5ZM15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/></>,
  "key-round": <><circle cx="7.5" cy="15.5" r="5.5"/><path d="m11.5 11.5 9-9 2 2-3 3 2 2-3 3-2-2-3 3"/></>,
  "download": <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/></>,
  "trash-2": <><path d="M3 6h18M8 6V3h8v3M5 6l1 14h12l1-14M10 10v6M14 10v6"/></>,
  "menu": <path d="M4 6h16M4 12h16M4 18h16"/>,
  "user-round": <><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></>,
  "history": <><path d="M3 12a9 9 0 1 1 9 9 9 9 0 0 1-6.7-3"/><path d="M3 3v9h9M12 7v5l4 2"/></>,
  "settings": <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.16-.09a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.16.09a2 2 0 0 1 1 1.73v.5a2 2 0 0 1-1 1.74l-.16.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.16-.09a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.16.09a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.16-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.73l.16-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.16.09a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></>,
  "log-out": <><path d="M10 17l5-5-5-5M15 12H3M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"/></>,
  "shield": <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z"/>,
  "layout-dashboard": <><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></>,
  "play": <polygon points="6 3 20 12 6 21 6 3"/>,
  "layers": <><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.64 0l8.6-3.9A1 1 0 0 0 22 12M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.64 0l8.6-3.9A1 1 0 0 0 22 17"/></>,
  "library-big": <><rect width="8" height="18" x="3" y="3" rx="1"/><path d="M7 3v18M20.4 18.9c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1a1 1 0 0 1 .6-1.3l1.9-.7a1 1 0 0 1 1.3.6Z"/></>,
  "users": <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3.87-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  "inbox": <><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/></>,
  "ellipsis": <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  "send": <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>,
  "chevron-down": <path d="m6 9 6 6 6-6"/>,
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
