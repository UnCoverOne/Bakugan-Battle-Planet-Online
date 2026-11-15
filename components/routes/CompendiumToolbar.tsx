"use client";
import type { CompendiumSection } from "../../lib/compendium-navigation";
import { CompendiumNavigation } from "./CompendiumNavigation";
import styles from "./CompendiumToolbar.module.css";

export function CompendiumToolbar({ section, onSectionChange, query, onSearch, onSidebar, sidebarTrigger,
  activeCount, density, onDensityChange }: {
  section: CompendiumSection;
  onSectionChange: (next: CompendiumSection) => void;
  query: string;
  onSearch: (value: string) => void;
  onSidebar: () => void;
  sidebarTrigger: React.RefObject<HTMLButtonElement | null>;
  activeCount: number;
  density: "gallery" | "compact";
  onDensityChange: () => void;
}) {
  const catalogue = section === "cards" || section === "cores";
  const placeholder = { cards: "Search cards…", cores: "Search BakuCores…", glossary: "Search terms…", rules: "Search rules…", rulings: "Search rulings…" }[section];
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
        aria-label={catalogue ? "Toggle filters and sorting" : "Toggle contents"}>
        {catalogue
          ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" /></svg>
          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>}
        <span>{catalogue ? "Filters" : "Contents"}{catalogue && activeCount > 0 ? ` (${activeCount})` : ""}</span>
      </button>
      {catalogue && <button type="button" className={styles.density} aria-label={density === "gallery" ? "Switch to compact view" : "Switch to gallery view"} onClick={onDensityChange}>
        {density === "gallery"
          ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 3h5v5H3zM10 3h5v5h-5zM17 3h4v5h-4zM3 10h5v5H3zM10 10h5v5h-5zM17 10h4v5h-4zM3 17h5v4H3zM10 17h5v4h-5zM17 17h4v4h-4z" /></svg>
          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="3" width="8" height="8" /><rect x="13" y="3" width="8" height="8" /><rect x="3" y="13" width="8" height="8" /><rect x="13" y="13" width="8" height="8" /></svg>}
      </button>}
    </div>
  </div>;
}
