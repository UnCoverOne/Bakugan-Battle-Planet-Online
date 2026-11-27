"use client";

import { LucideIcon } from "../design-system/LucideIcon";
import Link from "next/link";
import { type ReactNode } from "react";
import { FACTIONS } from "../../lib/card-filters";
import { type DeckFormat } from "../../lib/data";
import library from "./DeckLibrary.module.css";

export type LibraryView = "grid" | "list";
export type DeckFormatFilter = "all" | DeckFormat;

export function DeckLibraryHeader({ section, action }: { section: "mine" | "public"; action?: ReactNode }) {
  return <header className={library.topbar}>
    <h1 className={library.srOnly}>{section === "mine" ? "My Decks" : "Public Decks"}</h1>
    <nav className={library.tabs} aria-label="Deck library sections">
      <Link className={library.tab} aria-current={section === "mine" ? "page" : undefined} href="/decks">My Decks</Link>
      <Link className={library.tab} aria-current={section === "public" ? "page" : undefined} href="/decks/public">Public Decks</Link>
    </nav>
    {action}
  </header>;
}

export function DeckLibrarySkeleton() {
  return <div className={library.route} aria-busy="true" aria-label="Loading deck library">
    <div className={library.shell}>
      <div className={library.placeholderHero} />
      <div className={library.placeholderToolbar} />
      <div className={library.grid}>{Array.from({ length: 4 }, (_, i) => <div className={library.placeholderCard} key={i}/>)}</div>
    </div>
  </div>;
}

export function DeckLibraryEmpty({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return <div className={library.empty}><h2>{title}</h2><p>{message}</p>{action}</div>;
}

export function DeckToolbar({
  query, setQuery, faction, setFaction, legality, setLegality, formatFilter, setFormatFilter,
  sort, setSort, view, setView, sortOptions = ["Updated", "Name", "Set"],
  favoritesOnly, setFavoritesOnly, favoritesEnabled = true,
}: {
  query: string; setQuery: (value: string) => void;
  faction: string; setFaction: (value: string) => void;
  legality: string; setLegality: (value: string) => void;
  formatFilter: DeckFormatFilter; setFormatFilter: (value: DeckFormatFilter) => void;
  sort: string; setSort: (value: string) => void;
  view: LibraryView; setView: (value: LibraryView) => void;
  sortOptions?: string[]; favoritesOnly?: boolean; setFavoritesOnly?: (value: boolean) => void;
  favoritesEnabled?: boolean;
}) {
  const activeFilters = Number(faction !== "All") + Number(legality !== "All") +
    Number(formatFilter !== "all") + Number(Boolean(favoritesOnly));
  return <div className={library.toolbar} role="search" aria-label="Search and filter decks">
    <label className={library.search}>
      <span className={library.srOnly}>Search decks</span>
      <LucideIcon name="search"/>
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search decks…" />
      {query && <button type="button" className={library.clearSearch} aria-label="Clear deck search" onClick={() => setQuery("")}><LucideIcon name="x" size={16}/></button>}
    </label>
    <details className={library.filterWrap}>
      <summary className={library.filterButton}>
        <LucideIcon name="filter"/>
        <span className={library.filterText}>Filters</span>
        {activeFilters > 0 && <span className={library.filterCount}>{activeFilters}</span>}
      </summary>
      <div className={library.filterPanel}>
        <h3>Filter decks</h3>
        <div className={library.filterGrid}>
          <label className={library.filterField}>Faction<select value={faction} onChange={(event) => setFaction(event.target.value)}>
            <option value="All">All factions</option>{FACTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <label className={library.filterField}>Legality<select value={legality} onChange={(event) => setLegality(event.target.value)}>
            <option value="All">All decks</option><option value="Legal">Legal</option><option value="Issues">Needs attention</option>
          </select></label>
          <label className={library.filterField}>Format<select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value as DeckFormatFilter)}>
            <option value="all">All formats</option><option value="standard">Standard</option><option value="singleton">Singleton</option><option value="competitive">Competitive</option>
          </select></label>
          {setFavoritesOnly && <label className={library.favoriteCheck}>
            <input type="checkbox" checked={Boolean(favoritesOnly)} disabled={!favoritesEnabled} onChange={(event) => setFavoritesOnly(event.target.checked)} />My Favorites
          </label>}
        </div>
        {activeFilters > 0 && <button type="button" className={library.filterReset} onClick={() => {
          setFaction("All");setLegality("All");setFormatFilter("all");setFavoritesOnly?.(false);
        }}>Clear filters</button>}
      </div>
    </details>
    <label className={library.sortLabel}><span>Sort decks</span>
      <select className={library.sortSelect} value={sort} onChange={(event) => setSort(event.target.value)}>
        {sortOptions.map((option) => <option key={option} value={option}>{option === "Updated" ? "Recently updated" : option}</option>)}
      </select>
    </label>
    <div className={library.viewToggle} role="group" aria-label="Deck layout">
      <button type="button" className={library.viewButton} title="Grid view" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")}><LucideIcon name="layout-grid"/></button>
      <button type="button" className={library.viewButton} title="List view" aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")}><LucideIcon name="list"/></button>
    </div>
  </div>;
}
