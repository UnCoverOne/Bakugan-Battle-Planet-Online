export type HudPosition = {
  left: number;
  dockedLeft: number;
  top: number;
  maxWidth: number;
};

export type BrawlHudAnchorRect = Pick<DOMRect, "left" | "top" | "width">;
export type BrawlHudViewport = { left: number; top: number; width: number };

export const BRAWL_PREVIEW_MAX_REM = 32;
const BRAWL_EDGE_GAP = 12;
const BRAWL_DOCK_HANDLE_WIDTH = 32;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * The Brawl Preview used to have two independent width systems: JavaScript
 * positioned an assumed width while CSS could silently cap the rendered box.
 * Dock offsets then used a different half-width than the browser, allowing the
 * entire preview and its restore handle to move beyond the viewport after a
 * resize. This calculation is now the single width source used for positioning
 * and the inline rendered width.
 */
export function calculateBrawlHudPosition(
  anchor: BrawlHudAnchorRect,
  viewport: BrawlHudViewport,
  rootFontSize = 16,
): HudPosition {
  const availableWidth = Math.max(
    1,
    viewport.width - BRAWL_EDGE_GAP * 2 - BRAWL_DOCK_HANDLE_WIDTH,
  );
  const desiredWidth = Math.max(430, anchor.width * 2.65);
  const cssWidthCap = Math.max(1, BRAWL_PREVIEW_MAX_REM * rootFontSize);
  const maxWidth = Math.min(availableWidth, desiredWidth, cssWidthCap);
  const halfWidth = maxWidth / 2;
  const minimumCenter = viewport.left
    + BRAWL_EDGE_GAP
    + BRAWL_DOCK_HANDLE_WIDTH
    + halfWidth;
  const maximumCenter = viewport.left
    + viewport.width
    - BRAWL_EDGE_GAP
    - halfWidth;

  return {
    left: clamp(
      anchor.left + anchor.width / 2,
      minimumCenter,
      maximumCenter,
    ),
    // With the same maxWidth applied inline, the preview's left edge lands
    // exactly on the viewport edge and the absolute handle remains visible.
    dockedLeft: viewport.left + viewport.width + halfWidth,
    top: Math.max(viewport.top + 10, anchor.top - 10),
    maxWidth,
  };
}
