"use client";

import styles from "./CompendiumPagination.module.css";

export function CompendiumPagination({ page, totalPages, totalResults, pageSize, noun, onPageChange }: {
  page: number;
  totalPages: number;
  totalResults: number;
  pageSize: number;
  noun: string;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalResults);

  return <nav className={styles.pagination} aria-label={`${noun} result pages`}>
    <div className={styles.bar}>
      <span className={styles.range}>{start.toLocaleString()}–{end.toLocaleString()} of {totalResults.toLocaleString()} {noun}</span>
      <div className={styles.controls}>
        <button type="button" className={styles.arrow} aria-label="First page" title="First page"
          disabled={page === 1} onClick={() => onPageChange(1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m11 17-5-5 5-5M18 17l-5-5 5-5" /></svg>
        </button>
        <button type="button" className={styles.arrow} aria-label="Previous page" title="Previous page"
          disabled={page === 1} onClick={() => onPageChange(page - 1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <span className={styles.pageIndicator} aria-live="polite" aria-atomic="true">
          <strong>{page}</strong><span> / {totalPages}</span>
        </span>
        <button type="button" className={styles.arrow} aria-label="Next page" title="Next page"
          disabled={page === totalPages} onClick={() => onPageChange(page + 1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
        </button>
        <button type="button" className={styles.arrow} aria-label="Last page" title="Last page"
          disabled={page === totalPages} onClick={() => onPageChange(totalPages)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 17 5-5-5-5M13 17l5-5-5-5" /></svg>
        </button>
      </div>
    </div>
  </nav>;
}
