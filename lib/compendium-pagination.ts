export type PageItem = number | "ellipsis";

export function compactPages(current: number, total: number): PageItem[] {
  if (total <= 1) return total === 1 ? [1] : [];
  const selected = [...new Set([1, Math.max(1, Math.min(total, current)), total])].sort((a, b) => a - b);
  return selected.flatMap((n, i) => i && n - selected[i - 1] > 1 ? ["ellipsis" as const, n] : [n]);
}
