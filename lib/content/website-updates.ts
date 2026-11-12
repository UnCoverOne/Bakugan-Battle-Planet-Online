import { APPLICATION_VERSION } from "./versions";

/**
 * Patch history is maintained newest first. Add verified releases here as they
 * are published; do not manufacture earlier version entries or release dates.
 */
export type WebsitePatch = {
  version: string;
  title: string;
  summary: string;
  status: string;
  publishedAt: string | null;
  sections: readonly { title: string; items: readonly string[] }[];
};

export const WEBSITE_PATCHES: readonly WebsitePatch[] = [
  {
    version: APPLICATION_VERSION,
    title: "Homepage improvements",
    summary: "A redesigned homepage with player progression, community decks and battle activity.",
    status: "Development update",
    publishedAt: null,
    sections: [
      {
        title: "Improvements",
        items: [
          "Redesigned the homepage hero and improved its responsive layout.",
          "Added the Achievements and Featured Deck homepage panels.",
          "Refreshed achievement category icons and completion progress colours.",
        ],
      },
      {
        title: "New Features",
        items: [
          "Introduced Battle Activity with lifetime statistics and the latest match.",
          "Added a compact website version and updates section.",
        ],
      },
    ],
  },
];

export const WEBSITE_UPDATE = WEBSITE_PATCHES[0];

export function websitePatchHref(patch: Pick<WebsitePatch, "version">) {
  return `/updates/${encodeURIComponent(patch.version)}`;
}

export function findWebsitePatch(version: string): WebsitePatch | undefined {
  return WEBSITE_PATCHES.find((patch) => patch.version === version);
}
