"use client";

import { LucideIcon } from "../design-system/LucideIcon";
import styles from "./CompendiumPagination.module.css";

export function CompendiumPagination({ page, totalPages, totalResults, pageSize, noun, onPageChange, placement = "top" }: {
  page: number;
  totalPages: number;
  totalResults: number;
  pageSize: number;
  noun: string;
  onPageChange: (page: number) => void;
  placement?: "top" | "bottom";
}) {
  if (totalPages <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalResults);

  return <nav className={`${styles.pagination} ${placement === "bottom" ? styles.bottom : ""}`} aria-label={`${noun} result pages — ${placement}`}>
    <div className={styles.bar}>
      {placement === "top" && <span className={styles.range}>{start.toLocaleString()}–{end.toLocaleString()} of {totalResults.toLocaleString()} {noun}</span>}
      <div className={styles.controls}>
        <button type="button" className={styles.arrow} aria-label="First page" title="First page"
          disabled={page === 1} onClick={() => onPageChange(1)}>
          <LucideIcon name="chevrons-left"/>
        </button>
        <button type="button" className={styles.arrow} aria-label="Previous page" title="Previous page"
          disabled={page === 1} onClick={() => onPageChange(page - 1)}>
          <LucideIcon name="chevron-left"/>
        </button>
        <span className={styles.pageIndicator} aria-live="polite" aria-atomic="true">
          <strong>{page}</strong><span> / {totalPages}</span>
        </span>
        <button type="button" className={styles.arrow} aria-label="Next page" title="Next page"
          disabled={page === totalPages} onClick={() => onPageChange(page + 1)}>
          <LucideIcon name="chevron-right"/>
        </button>
        <button type="button" className={styles.arrow} aria-label="Last page" title="Last page"
          disabled={page === totalPages} onClick={() => onPageChange(totalPages)}>
          <LucideIcon name="chevrons-right"/>
        </button>
      </div>
    </div>
  </nav>;
}
