"use client";
import styles from "./CompendiumPagination.module.css";

export type PageItem = number | "ellipsis";
export function compactPages(current: number, total: number): PageItem[] {
  if (total <= 1) return total === 1 ? [1] : [];
  const selected = [...new Set([1, Math.max(1, Math.min(total, current)), total])].sort((a,b) => a-b);
  return selected.flatMap((n,i) => i && n - selected[i-1] > 1 ? ["ellipsis" as const,n] : [n]);
}

export function CompendiumPagination({page,totalPages,totalResults,pageSize,noun,onPageChange}:{
 page:number;totalPages:number;totalResults:number;pageSize:number;noun:string;
 onPageChange:(page:number)=>void;
}) {
 if(totalPages<=1)return null;
 const start=(page-1)*pageSize+1;
 const end=Math.min(page*pageSize,totalResults);
 return <nav className={styles.pagination} aria-label={`${noun} result pages`}>
  <div className={styles.bar}>
   <span className={styles.range}>{start.toLocaleString()}–{end.toLocaleString()} of {totalResults.toLocaleString()} {noun}</span>
   <div className={styles.controls}>
    <button type="button" className={styles.arrow} aria-label="Previous page" disabled={page===1} onClick={()=>onPageChange(page-1)}>
     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
    </button>
    <span className={styles.numbered}>
     {compactPages(page,totalPages).map((item,index)=>item==="ellipsis"
      ? <span key={`gap-${index}`} className={styles.ellipsis} aria-hidden="true">…</span>
      : <button key={item} type="button" className={styles.page} aria-label={`Go to page ${item}`}
          aria-current={item===page?"page":undefined} onClick={()=>onPageChange(item)}>{item}</button>)}
    </span>
    <span className={styles.mobilePage}>Page {page} / {totalPages}</span>
    <button type="button" className={styles.arrow} aria-label="Next page" disabled={page===totalPages} onClick={()=>onPageChange(page+1)}>
     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
    </button>
   </div>
  </div>
 </nav>;
}
