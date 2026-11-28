"use client";
import { useEffect, useState, type RefObject } from "react";
import type { CompendiumSection } from "../../lib/compendium-navigation";
import { CompendiumNavigation } from "./CompendiumNavigation";
import { COMPENDIUM_SIDEBAR_ID } from "./CompendiumSidebar";
import styles from "./CompendiumToolbar.module.css";
import { LucideIcon } from "../design-system/LucideIcon";

export function CompendiumToolbar({ section, onSectionChange, query, onSearch, onSidebar, sidebarTrigger,
  activeCount, density, onDensityChange, sidebarOpen, desktopSidebarVisible, collection = false }: {
  collection?: boolean;
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
    <CompendiumNavigation active={section} onSelect={onSectionChange} collection={collection} />
    <div className={styles.controls}>
      <label className={styles.search}>
        <span className={styles.visuallyHidden}>Search {section}</span>
        <LucideIcon name="search" />
        <input type="search" placeholder={placeholder} value={query} onChange={(event) => onSearch(event.target.value)} />
        {query && <button type="button" aria-label="Clear search" onClick={() => onSearch("")}><LucideIcon name="x" size={17} /></button>}
      </label>
      <button ref={sidebarTrigger} type="button" className={styles.action} onClick={onSidebar}
        aria-label={`${expanded ? "Hide" : "Show"} ${catalogue ? "filters and sorting" : "contents"}`}
        aria-controls={COMPENDIUM_SIDEBAR_ID} aria-expanded={expanded}
        aria-haspopup={mobile ? "dialog" : undefined}>
        <LucideIcon name={catalogue ? "sliders-horizontal" : "list"} />
        <span>{catalogue ? "Filters" : "Contents"}{catalogue && activeCount > 0 ? ` (${activeCount})` : ""}</span>
      </button>
      {catalogue && <button type="button" className={styles.density} aria-label={density === "gallery" ? "Switch to compact view" : section === "cards" ? "Switch to detailed view" : "Switch to gallery view"} title={density === "gallery" ? "Compact View" : section === "cards" ? "Detailed View" : "Gallery View"} onClick={onDensityChange}>
        <LucideIcon name={density === "gallery" ? "layout-list" : "layout-grid"} />
      </button>}
    </div>
  </div>;
}
