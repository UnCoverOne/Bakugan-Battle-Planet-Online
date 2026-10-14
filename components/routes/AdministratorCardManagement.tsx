"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GameCard } from "../../lib/game";
import { cardSetCode } from "../../lib/content/catalogue";
import { createCardFilterOptionCatalogue, createEmptyCardFilters, activeCardFilterCount, type CardFilterState } from "../../lib/card-filters";
import { COMPENDIUM_PAGE_SIZE, DEFAULT_COMPENDIUM_STATE, filterAndSortCompendiumCards, type CompendiumSort } from "../../lib/compendium";
import { CardFilterPanel } from "../filters/CardFilterPanel";
import { FilterPicker } from "../filters/FilterPicker";
import { InspectorModal } from "../cards/InspectorModal";
import { ResponsiveCardImage } from "../cards/ResponsiveCardImage";
import { ActionButton, CardGrid, Field, StatusChip, Surface } from "../design-system/primitives";
import { useAppFields } from "../application/AppProvider";
import styles from "./AdministratorCardManagement.module.css";

type Restriction = { catalogId?: string; constructionIdentity: string; limit: 0 | 1 | 2; reason?: string };
type RankedData = { active: { version: number; restrictions: Restriction[] }; draft: { deckSize: number; restrictions: Restriction[] } };
type RollingSettings = {
  catalogId: string;
  rollAccuracy: number;
  doubleCoreChance: number;
  defaultRollAccuracy: number;
  defaultDoubleCoreChance: number;
};
const SORTS: { value: CompendiumSort; label: string }[] = [
  { value: "collector", label: "Collector number" }, { value: "name-asc", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" }, { value: "cost-asc", label: "Energy low–high" },
  { value: "cost-desc", label: "Energy high–low" }, { value: "bpower-desc", label: "B-Power high–low" },
  { value: "damage-desc", label: "Damage high–low" },
];

async function request(section: string) {
  const response = await fetch(`/api/admin?section=${section}`, { cache: "no-store" });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error ?? "Administrator data could not be loaded.");
  return json;
}
async function mutate(body: Record<string, unknown>) {
  const response = await fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error ?? "Administrator change failed.");
  return json;
}

function AdministratorInspector({ card, restriction, activeRestriction, rolling, onClose, onSaved, onRankedSaved }: {
  card: GameCard; restriction?: Restriction; activeRestriction?: Restriction; rolling?: RollingSettings;
  onClose: () => void; onSaved: () => Promise<void>;
  onRankedSaved: (card: GameCard, limit: number | null, reason: string) => Promise<void>;
}) {
  const { notify } = useAppFields(["notify"]);
  const [editor, setEditor] = useState(() => JSON.stringify(card, null, 2));
  const [limit, setLimit] = useState(String(restriction?.limit ?? "none"));
  const [reason, setReason] = useState(restriction?.reason ?? "");
  const [rollAccuracy, setRollAccuracy] = useState(String(rolling?.rollAccuracy ?? ""));
  const [doubleCoreChance, setDoubleCoreChance] = useState(String(rolling?.doubleCoreChance ?? ""));
  const [rollingSaving, setRollingSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rankedSaving, setRankedSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"properties" | "rolling" | "ranked">("properties");
  useEffect(() => { setEditor(JSON.stringify(card, null, 2)); }, [card]);
  useEffect(() => { setLimit(String(restriction?.limit ?? "none")); setReason(restriction?.reason ?? ""); }, [card.catalogId, restriction?.limit, restriction?.reason]);
  useEffect(() => {
    setRollAccuracy(String(rolling?.rollAccuracy ?? ""));
    setDoubleCoreChance(String(rolling?.doubleCoreChance ?? ""));
  }, [card.catalogId, rolling?.rollAccuracy, rolling?.doubleCoreChance]);
  const changed = editor !== JSON.stringify(card, null, 2);
  const rankedChanged = limit !== String(restriction?.limit ?? "none") || reason !== (restriction?.reason ?? "");
  const rollingChanged = Boolean(rolling) && (rollAccuracy !== String(rolling?.rollAccuracy) || doubleCoreChance !== String(rolling?.doubleCoreChance));
  const validPercentage = (value: string) => /^(?:100|[1-9]?\d)$/.test(value);
  const rollingValid = validPercentage(rollAccuracy) && validPercentage(doubleCoreChance);
  const close = () => {
    if ((changed || rankedChanged || rollingChanged) && !window.confirm("Discard unsaved administrator changes?")) return;
    onClose();
  };
  const saveCard = async () => {
    setSaving(true);
    try {
      const parsed = JSON.parse(editor);
      if (parsed.catalogId !== card.catalogId || parsed.id !== card.id) throw new Error("Card IDs cannot be changed.");
      await mutate({ action: "card-save", card: parsed });
      window.dispatchEvent(new Event("bbp-card-overrides-updated"));
      notify(`${card.displayName} updated.`);
      await onSaved();
    } catch (error) { notify(error instanceof Error ? error.message : "Card save failed."); }
    finally { setSaving(false); }
  };
  const restore = async () => {
    if (!window.confirm(`Restore ${card.displayName} to repository values?`)) return;
    setSaving(true);
    try {
      await mutate({ action: "card-reset", catalogId: card.catalogId });
      window.dispatchEvent(new Event("bbp-card-overrides-updated"));
      notify(`${card.displayName} restored.`);
      await onSaved();
    } catch (error) { notify(error instanceof Error ? error.message : "Restore failed."); }
    finally { setSaving(false); }
  };
  const saveRolling = async () => {
    if (!rolling || !rollingValid) return;
    setRollingSaving(true);
    try {
      await mutate({ action: "bakugan-roll-save", rolling: {
        catalogId: card.catalogId,
        rollAccuracy: Number(rollAccuracy),
        doubleCoreChance: Number(doubleCoreChance),
      } });
      window.dispatchEvent(new Event("bbp-card-overrides-updated"));
      notify(`${card.displayName} rolling properties updated.`);
      await onSaved();
    } catch (error) { notify(error instanceof Error ? error.message : "Rolling properties could not be saved."); }
    finally { setRollingSaving(false); }
  };
  const restoreRolling = async () => {
    if (!rolling || !window.confirm(`Restore ${card.displayName}'s original rolling probabilities?`)) return;
    setRollingSaving(true);
    try {
      await mutate({ action: "bakugan-roll-reset", catalogId: card.catalogId });
      window.dispatchEvent(new Event("bbp-card-overrides-updated"));
      notify(`${card.displayName} rolling properties restored to defaults.`);
      await onSaved();
    } catch (error) { notify(error instanceof Error ? error.message : "Rolling properties could not be reset."); }
    finally { setRollingSaving(false); }
  };
  return <InspectorModal dataUi="administrator-card-inspector" titleId="administrator-card-inspector-title" onClose={close}>
    <div className={styles.inspector}>
      <header className={styles.inspectorHeader}>
        <div><small>ADMINISTRATOR INSPECTOR · {card.catalogId}</small><h2 id="administrator-card-inspector-title">{card.displayName}</h2></div>
        <button type="button" onClick={close} aria-label="Close administrator inspector">✕</button>
      </header>
      <div className={styles.inspectorBody}>
        <div className={styles.preview}>
          <ResponsiveCardImage card={card} presentation="inspector" />
          <div className={styles.badges}><StatusChip tone="info">{card.faction}</StatusChip><StatusChip>{cardSetCode(card)}</StatusChip><StatusChip>{card.type}</StatusChip></div>
          <p>{card.effect || "No printed effect."}</p>
        </div>
        <div className={styles.controls}>
          <div className={styles.inspectorTabs} role="tablist" aria-label="Administrator inspector sections">
            <button type="button" role="tab" id="administrator-tab-properties" aria-controls="administrator-panel-properties" aria-selected={activeTab === "properties"} onClick={() => setActiveTab("properties")}>Card Properties{changed ? " •" : ""}</button>
            {card.type === "Character" && rolling && <button type="button" role="tab" id="administrator-tab-rolling" aria-controls="administrator-panel-rolling" aria-selected={activeTab === "rolling"} onClick={() => setActiveTab("rolling")}>Rolling Properties{rollingChanged ? " •" : ""}</button>}
            <button type="button" role="tab" id="administrator-tab-ranked" aria-controls="administrator-panel-ranked" aria-selected={activeTab === "ranked"} onClick={() => setActiveTab("ranked")}>Ranked Restrictions{rankedChanged ? " •" : ""}</button>
          </div>
          {activeTab === "properties" && <section role="tabpanel" id="administrator-panel-properties" aria-labelledby="administrator-tab-properties" className={styles.editorSection}>
            <h3>Card properties</h3>
            <p>Edit the complete card record. Card IDs are immutable and validated before saving.</p>
            <Field label="Card record (JSON)">
              <textarea spellCheck={false} value={editor} onChange={(event) => setEditor(event.target.value)} />
            </Field>
            <div className={styles.actions}>
              <ActionButton disabled={saving || !changed} onClick={() => void saveCard()}>{saving ? "Saving…" : "Save card"}</ActionButton>
              <button type="button" disabled={saving || !changed} onClick={() => setEditor(JSON.stringify(card, null, 2))}>Discard edits</button>
              <button type="button" disabled={saving} className={styles.danger} onClick={() => void restore()}>Restore original</button>
            </div>
          </section>}
          {activeTab === "rolling" && card.type === "Character" && rolling && <section role="tabpanel" id="administrator-panel-rolling" aria-labelledby="administrator-tab-rolling" className={styles.editorSection}>
            <h3>Rolling properties</h3>
            <p>Adjust this Bakugan's probability checks for newly created matches. Existing match snapshots and replays are unchanged.</p>
            <Field label="Roll accuracy (%)">
              <input type="number" min={0} max={100} step={1} value={rollAccuracy} onChange={(event) => setRollAccuracy(event.target.value)} />
            </Field>
            <p>Default: {rolling.defaultRollAccuracy}%. The chance of passing the initial accuracy check; the simulation may still affect which BakuCore is collected.</p>
            <Field label="Double Core chance (%)">
              <input type="number" min={0} max={100} step={1} value={doubleCoreChance} onChange={(event) => setDoubleCoreChance(event.target.value)} />
            </Field>
            <p>Default: {rolling.defaultDoubleCoreChance}%. Chance of attempting a second Core pickup when an eligible second Core is present.</p>
            {!rollingValid && <p role="alert">Enter whole-number percentages between 0 and 100 for both properties.</p>}
            <div className={styles.actions}>
              <ActionButton disabled={rollingSaving || !rollingChanged || !rollingValid} onClick={() => void saveRolling()}>{rollingSaving ? "Saving…" : "Save rolling properties"}</ActionButton>
              <button type="button" disabled={rollingSaving || !rollingChanged} onClick={() => { setRollAccuracy(String(rolling.rollAccuracy)); setDoubleCoreChance(String(rolling.doubleCoreChance)); }}>Discard edits</button>
              <button type="button" disabled={rollingSaving || (rolling.rollAccuracy === rolling.defaultRollAccuracy && rolling.doubleCoreChance === rolling.defaultDoubleCoreChance)} className={styles.danger} onClick={() => void restoreRolling()}>Restore defaults</button>
            </div>
          </section>}
          {activeTab === "ranked" && <section role="tabpanel" id="administrator-panel-ranked" aria-labelledby="administrator-tab-ranked" className={styles.editorSection}>
            <h3>Ranked restrictions</h3>
            <p>Restrictions apply to all printings with this card's construction identity. Save to the Ranked draft; publishing the draft activates the changes.</p>
            <p>Active: <strong>{activeRestriction ? activeRestriction.limit === 0 ? "Banned" : `Limited to ${activeRestriction.limit}` : "Normal · 3 copies"}</strong></p>
            <Field label="Draft copy limit">
              <select value={limit} onChange={(event) => setLimit(event.target.value)}>
                <option value="none">Normal · 3 copies</option>
                <option value="2">Limited · 2 copies</option>
                <option value="1">Limited · 1 copy</option>
                <option value="0">Banned · 0 copies</option>
              </select>
            </Field>
            <Field label="Public reason (optional)">
              <input value={reason} disabled={limit === "none"} onChange={(event) => setReason(event.target.value)} placeholder="Explain this Ranked restriction…" />
            </Field>
            <div className={styles.actions}>
              <ActionButton disabled={rankedSaving || !rankedChanged} onClick={async () => {
                setRankedSaving(true);
                try { await onRankedSaved(card, limit === "none" ? null : Number(limit), limit === "none" ? "" : reason); }
                finally { setRankedSaving(false); }
              }}>{rankedSaving ? "Saving…" : "Save Ranked draft"}</ActionButton>
            </div>
          </section>}
        </div>
      </div>
    </div>
  </InspectorModal>;
}

export function AdministratorCardManagement() {
  const { notify } = useAppFields(["notify"]);
  const [cards, setCards] = useState<GameCard[]>([]);
  const [rollingSettings, setRollingSettings] = useState<RollingSettings[]>([]);
  const [ranked, setRanked] = useState<RankedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<CardFilterState>(() => createEmptyCardFilters());
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CompendiumSort>("collector");
  const [density, setDensity] = useState<"gallery" | "compact">("gallery");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState("");
  const triggerRef = useRef<HTMLElement | null>(null);
  const reload = async () => {
    const [cardData, rankedData] = await Promise.all([request("cards"), request("ranked")]);
    setCards(cardData.cards);
    setRollingSettings(cardData.rollingSettings ?? []);
    setRanked(rankedData);
  };
  useEffect(() => {
    let active = true;
    Promise.all([request("cards"), request("ranked")]).then(([cardData, rankedData]) => {
      if (active) { setCards(cardData.cards); setRollingSettings(cardData.rollingSettings ?? []); setRanked(rankedData); setLoading(false); }
    }).catch((e) => { if (active) { setError(e instanceof Error ? e.message : "Could not load cards."); setLoading(false); } });
    return () => { active = false; };
  }, []);
  const options = useMemo(() => createCardFilterOptionCatalogue(cards), [cards]);
  const filtered = useMemo(() => filterAndSortCompendiumCards(cards, { ...DEFAULT_COMPENDIUM_STATE, ...filters, q: query, sort, density }, { includeFusionBack: true }), [cards, filters, query, sort, density]);
  const pages = Math.max(1, Math.ceil(filtered.length / COMPENDIUM_PAGE_SIZE));
  const visible = filtered.slice((Math.min(page, pages) - 1) * COMPENDIUM_PAGE_SIZE, Math.min(page, pages) * COMPENDIUM_PAGE_SIZE);
  const selected = cards.find((card) => card.catalogId === selectedId);
  const restriction = selected && ranked?.draft.restrictions.find((entry) => entry.constructionIdentity === selected.constructionIdentity);
  const activeRestriction = selected && ranked?.active.restrictions.find((entry) => entry.constructionIdentity === selected.constructionIdentity);
  const saveRanked = async (card: GameCard, limit: number | null, reason: string) => {
    if (!ranked) return;
    const restrictions = ranked.draft.restrictions.filter((entry) => entry.constructionIdentity !== card.constructionIdentity);
    if (limit !== null) restrictions.push({ catalogId: card.catalogId, constructionIdentity: card.constructionIdentity, limit: limit as 0 | 1 | 2, reason });
    try {
      await mutate({ action: "ranked-save-draft", restrictions, deckSize: ranked.draft.deckSize });
      setRanked((current) => current && ({ ...current, draft: { ...current.draft, restrictions } }));
      notify("Ranked restriction saved to draft. Publish it from Ranked Play to activate.");
    } catch (error) { notify(error instanceof Error ? error.message : "Ranked draft save failed."); }
  };
  const updateFilters = (next: CardFilterState) => { setFilters(next); setPage(1); };
  return <section className={styles.management}>
    <div className={styles.heading}><div><small>CATALOGUE</small><h2>Card Management</h2><p>Browse the shared card catalogue, edit a card in the Administrator Inspector, and manage Ranked restrictions.</p></div><StatusChip tone="info">{cards.length} CARDS</StatusChip></div>
    {loading ? <Surface className={styles.message} role="status">Loading card browser…</Surface> : error ? <Surface className={styles.message} role="alert">{error}</Surface> : <>
      <Surface className={styles.toolbar}>
        <Field label="Search cards"><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Name, ID, effect, mechanics…" /></Field>
        <div className={styles.density}><button type="button" aria-pressed={density === "gallery"} onClick={() => setDensity("gallery")}>Gallery</button><button type="button" aria-pressed={density === "compact"} onClick={() => setDensity("compact")}>Compact</button></div>
      </Surface>
      <div className={styles.workspace}>
        <Surface className={styles.filterRail}>
          <div className={styles.filterHeading}><strong>Filters &amp; sort</strong><button type="button" onClick={() => { updateFilters(createEmptyCardFilters()); setSort("collector"); }}>Clear</button></div>
          <CardFilterPanel filters={filters} facets={["type"]} options={options} onChange={updateFilters} />
          <FilterPicker label="Sort" values={[sort]} options={SORTS} mode="single" clearable={false} onChange={(values) => { if (values[0]) { setSort(values[0] as CompendiumSort); setPage(1); } }} />
          <CardFilterPanel filters={filters} facets={["set", "faction", "cost", "rarity", "coreType", "keyword"]} options={options} onChange={updateFilters} />
        </Surface>
        <div className={styles.results}>
          <div className={styles.count}><strong>{filtered.length} cards</strong><span>Page {Math.min(page, pages)} of {pages} · {activeCardFilterCount(filters)} active filters</span></div>
          <CardGrid className={density === "compact" ? styles.compact : styles.grid} minCardWidth={density === "compact" ? "9.25rem" : "11.5rem"}>
            {visible.map((card) => <button type="button" className={styles.tile} key={card.catalogId} onClick={(event) => { triggerRef.current = event.currentTarget; setSelectedId(card.catalogId); }}>
              <span className={styles.art}><ResponsiveCardImage card={card} presentation="tile" /></span>
              <span className={styles.cardDetails}><span><StatusChip tone="info">{card.faction}</StatusChip><StatusChip>{cardSetCode(card)}</StatusChip></span><strong>{card.displayName}</strong><small>{card.type} · {card.cost} Energy · {card.rarity}</small></span>
            </button>)}
          </CardGrid>
          {!filtered.length && <Surface className={styles.message}>No matching cards. Clear filters or change your search.</Surface>}
          <nav className={styles.pagination} aria-label="Card browser pages"><button type="button" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>← Previous</button><span>{Math.min(page, pages)} / {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage((n) => n + 1)}>Next →</button></nav>
        </div>
      </div>
      {selected && <AdministratorInspector key={selected.catalogId} card={selected} restriction={restriction} activeRestriction={activeRestriction} rolling={rollingSettings.find((item) => item.catalogId === selected.catalogId)} onClose={() => setSelectedId("")} onSaved={reload} onRankedSaved={saveRanked} />}
    </>}
  </section>;
}
