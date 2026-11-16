export type PageItem = number | "ellipsis" | null;

/**
 * Five fixed pagination slots: first, leading gap, centre, trailing gap, last.
 * The centre slot shows an adjacent page at the ends so no page is duplicated.
 * Null slots remain mounted to prevent controls from shifting horizontally.
 */
export function compactPages(current: number, total: number): PageItem[] {
  if (total <= 1) return total === 1 ? [1] : [];
  if (total === 2) return [1, null, null, null, 2];
  const page = Math.max(1, Math.min(current, total));
  const middle = page === 1 ? 2 : page === total ? total - 1 : page;
  return [
    1,
    middle > 2 ? "ellipsis" : null,
    middle,
    total - middle > 1 ? "ellipsis" : null,
    total,
  ];
}
