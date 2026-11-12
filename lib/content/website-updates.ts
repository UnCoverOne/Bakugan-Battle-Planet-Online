import { APPLICATION_VERSION } from "./versions";

/**
 * Display metadata for the homepage update strip and its linked notes.
 * Do not infer a release date from Git commits or the package version.
 * Replace developmentStatus with a published date when official patch notes ship.
 */
export const WEBSITE_UPDATE = {
  version: APPLICATION_VERSION,
  title: "Homepage improvements",
  status: "Development update",
  publishedAt: null as string | null,
  notes: [
    "Redesigned the homepage hero and improved its responsive layout.",
    "Added the Achievements and Featured Deck homepage panels.",
    "Introduced Battle Activity with lifetime statistics and the latest match.",
    "Refreshed achievement category icons and completion progress colours.",
  ],
} as const;
