"use client";
import { useEffect, useState, type RefObject } from "react";
import type { CompendiumSection } from "../../lib/compendium-navigation";
import { CompendiumNavigation } from "./CompendiumNavigation";
import { COMPENDIUM_SIDEBAR_ID } from "./CompendiumSidebar";
import styles from "./CompendiumToolbar.module.css";

export function CompendiumToolbar({ section, onSectionChange, query, onSearch, onSidebar, sidebarTrigger,
  activeCount, density, onDensityChange, sidebarOpen, desktopSidebarVisible }: {
  section: CompendiumSection;
  onSectionChange: (next: CompendiumSection) => void;
  query: string;
  onSearch: (value: string) => void;
  onSidebar: () => void;
  sidebarTrigger: RefObject<HTMLButtonElement | null>;
  sidebarOpen: boolean;
  desktopSidebarVisible: boolean;
  activeCount: number;
  density: "gallery" | "compact";
  onDensityChange: () => void;
}) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const update = () => setMobile(query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const catalogue = section === "cards" || section === "cores";
  const placeholder = { cards: "Search cards…", cores: "Search BakuCores…", glossary: "Search terms…", rules: "Search rules…", rulings: "Search rulings…" }[section];
  const expanded = mobile ? sidebarOpen : desktopSidebarVisible;
  return <div className={styles.sticky}>
    <CompendiumNavigation active={section} onSelect={onSectionChange} />
    <div className={styles.controls}>
      <label className={styles.search}>
        <span className={styles.visuallyHidden}>Search {section}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
        <input type="search" placeholder={placeholder} value={query} onChange={(event) => onSearch(event.target.value)} />
        {query && <button type="button" aria-label="Clear search" onClick={() => onSearch("")}>×</button>}
      </label>
      <button ref={sidebarTrigger} type="button" className={styles.action} onClick={onSidebar}
        aria-label={`${expanded ? "Hide" : "Show"} ${catalogue ? "filters and sorting" : "contents"}`}
        aria-controls={COMPENDIUM_SIDEBAR_ID} aria-expanded={expanded}
        aria-haspopup={mobile ? "dialog" : undefined}>
        {/* Icon paths sourced from Lucide (ISC): sliders-horizontal. */}
        {catalogue
          ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/></svg>
          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M8 6h13M8 12h8M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>}
        <span>{catalogue ? "Filters" : "Contents"}{catalogue && activeCount > 0 ? ` (${activeCount})` : ""}</span>
      </button>
      {catalogue && <button type="button" className={styles.density} aria-label={density === "gallery" ? "Switch to compact view" : section === "cards" ? "Switch to detailed view" : "Switch to gallery view"} title={density === "gallery" ? "Compact View" : section === "cards" ? "Detailed View" : "Gallery View"} onClick={onDensityChange}>
        {/* Lucide (ISC): layout-list is the compact target; layout-grid is the gallery target. */}
        {density === "gallery"
          ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/><path d="M14 4h7"/><path d="M14 9h7"/><path d="M14 15h7"/><path d="M14 20h7"/></svg>
          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>}
      </button>}
    </div>
  </div>;
}
