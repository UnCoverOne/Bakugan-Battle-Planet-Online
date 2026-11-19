"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./ContentsNavigation.module.css";

export type ContentsEntry = {
  id: string;
  label: string;
  children?: readonly ContentsEntry[];
};

export function ContentsNavigation({ items, onNavigate }: { items: readonly ContentsEntry[]; onNavigate?: () => void }) {
  const [active, setActive] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);
  const flat = useMemo(() => items.flatMap(item => [item, ...(item.children ?? [])]), [items]);

  useEffect(() => {
    const update = () => {
      const destinations = flat.map(item => ({ id: item.id, node: document.getElementById(item.id) }))
        .filter((entry): entry is { id: string; node: HTMLElement } => Boolean(entry.node));
      if (!destinations.length) { setActive(""); return; }
      const top = 220;
      const current = destinations.reduce((selected, entry) =>
        entry.node.getBoundingClientRect().top <= top ? entry.id : selected, destinations[0].id);
      setActive(current);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, [flat]);

  const navigate = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    if (!target) { event.preventDefault(); return; }
    event.preventDefault();
    history.pushState(null, "", `#${id}`);
    setActive(id);
    // Close the mobile Contents overlay before moving the underlying page.
    // An extra frame lets React remove the overlay and restore body scrolling.
    onNavigate?.();
    const scroll = () => target.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
    requestAnimationFrame(() => {
      if (onNavigate) requestAnimationFrame(scroll);
      else scroll();
    });
  };
  const link = (item: ContentsEntry, nested = false) =>
    <a key={item.id} href={`#${item.id}`} data-contents-link="" className={`${styles.link} ${nested ? styles.nested : ""}`}
      aria-current={active === item.id || (Boolean(item.children?.some(child => child.id === active)) && !expanded.includes(item.id)) ? "location" : undefined}
      onClick={event => navigate(event, item.id)}>{item.label}</a>;

  return <div className={styles.contents}>
    {items.map(item => !item.children?.length ? link(item) : <div className={styles.chapter} key={item.id}>
      <div className={styles.chapterRow}>
        {link(item)}
        <button type="button" className={styles.expand} aria-expanded={expanded.includes(item.id)}
          aria-label={`${expanded.includes(item.id) ? "Collapse" : "Expand"} ${item.label}`}
          onClick={() => setExpanded(current => current.includes(item.id)
            ? current.filter(id => id !== item.id) : [...current, item.id])}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={expanded.includes(item.id) ? "m6 9 6 6 6-6" : "m9 18 6-6-6-6"}/>
          </svg>
        </button>
      </div>
      {expanded.includes(item.id) && <div className={styles.children}>{item.children.map(child => link(child, true))}</div>}
    </div>)}
  </div>;
}
