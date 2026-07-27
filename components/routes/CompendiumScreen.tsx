"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CardInspector } from "../cards/CardInspector";
import { ResponsiveCardImage } from "../cards/ResponsiveCardImage";
import {
  COMPENDIUM_PAGE_SIZE,
  compendiumSearchParams,
  filterAndSortCompendiumCards,
  parseCompendiumState,
  selectedCompendiumCard,
  type CardInspectorTab,
  type CompendiumState,
} from "../../lib/compendium";
import { CARDS, RULE_ENTRIES } from "../../lib/data";
import { CARD_SET_INFO, cardSetCode } from "../../lib/content/catalogue";
import { GLOSSARY_ENTRIES, PUBLISHED_RULINGS, REFERENCE_REVIEWED_AT, SYMBOL_ENTRIES } from "../../lib/reference";
import { useApp } from "../application/AppProvider";
import { AppButton, Badge, copyText } from "../application/ui";
import { ActionButton, CardGrid, Field, RouteHero, StatusChip, Surface, Tabs } from "../design-system/primitives";
import styles from "./CompendiumScreen.module.css";

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const FACTIONS = ["Aquos", "Aurelus", "Darkus", "Haos", "Pyrus", "Ventus"];
const CARD_TYPES = ["Action", "Flip", "Hero", "Evo", "Character"];
const SORT_LABELS: Record<CompendiumState["sort"], string> = {
  collector: "Collector number",
  "name-asc": "Name A–Z",
  "name-desc": "Name Z–A",
  "cost-asc": "Energy low–high",
  "cost-desc": "Energy high–low",
};

type FilterKey = "set" | "type" | "faction" | "cost" | "rarity" | "keyword";
type StatePatch = Partial<CompendiumState>;

const ruleReferences = [
  ...RULE_ENTRIES.map((entry) => ({
    ...entry,
    slug: slug(entry.title),
    source: "Digital adaptation reference",
    sourceSection: entry.category,
    reviewedAt: REFERENCE_REVIEWED_AT,
  })),
  ...GLOSSARY_ENTRIES,
];

function FilterControls({
  state,
  rarities,
  keywords,
  onChange,
  onClear,
}: {
  state: CompendiumState;
  rarities: readonly string[];
  keywords: readonly string[];
  onChange: (key: FilterKey, value: string) => void;
  onClear: () => void;
}) {
  return (
    <>
      <div className={styles.filterHeading}>
        <div><span>Refine archive</span><h2>Filters</h2></div>
        <button type="button" onClick={onClear}>Clear</button>
      </div>
      <Field label="Set">
        <select value={state.set} onChange={(event) => onChange("set", event.target.value)}>
          <option>All</option>
          {Object.values(CARD_SET_INFO).map((set) => <option value={set.code} key={set.code}>{set.name}</option>)}
        </select>
      </Field>
      <Field label="Card type">
        <select value={state.type} onChange={(event) => onChange("type", event.target.value)}>
          <option>All</option>
          {CARD_TYPES.map((value) => <option key={value}>{value}</option>)}
        </select>
      </Field>
      <Field label="Faction">
        <select value={state.faction} onChange={(event) => onChange("faction", event.target.value)}>
          <option>All</option>
          {FACTIONS.map((value) => <option key={value}>{value}</option>)}
        </select>
      </Field>
      <Field label="Energy cost">
        <select value={state.cost} onChange={(event) => onChange("cost", event.target.value)}>
          <option>All</option>
          {Array.from({ length: 11 }, (_, value) => <option value={String(value)} key={value}>{value}</option>)}
          <option value="X">X</option>
        </select>
      </Field>
      <Field label="Rarity">
        <select value={state.rarity} onChange={(event) => onChange("rarity", event.target.value)}>
          <option>All</option>
          {rarities.map((value) => <option key={value}>{value}</option>)}
        </select>
      </Field>
      <Field label="Keyword">
        <select value={state.keyword} onChange={(event) => onChange("keyword", event.target.value)}>
          <option>All</option>
          {keywords.map((value) => <option key={value}>{value}</option>)}
        </select>
      </Field>
    </>
  );
}

export function CompendiumScreen({ segments = [] }: { segments?: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setCompendiumTab, authUser, notify } = useApp();
  const section = segments[0] === "rules" ? "rules" : segments[0] === "rulings" ? "rulings" : "cards";
  const legacyDetail = section === "cards" && segments[0] === "cards" ? decodeURIComponent(segments[1] ?? "") : "";
  const state = useMemo(() => parseCompendiumState(searchParams.toString()), [searchParams]);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [rulingCardId, setRulingCardId] = useState(section === "rulings" ? searchParams.get("card") ?? "" : "");
  const [question, setQuestion] = useState("");
  const [submission, setSubmission] = useState("idle");
  const [showSubmission, setShowSubmission] = useState(false);
  const inspectorTrigger = useRef<HTMLElement | null>(null);

  const rarities = useMemo(() => [...new Set(CARDS.map((card) => card.rarity))].filter(Boolean).toSorted(), []);
  const keywords = useMemo(() => [...new Set(CARDS.flatMap((card) => card.mechanics))].filter(Boolean).toSorted(), []);
  const cards = useMemo(() => filterAndSortCompendiumCards(CARDS, state), [state]);
  const pages = Math.max(1, Math.ceil(cards.length / COMPENDIUM_PAGE_SIZE));
  const page = Math.min(state.page, pages);
  const visible = cards.slice((page - 1) * COMPENDIUM_PAGE_SIZE, page * COMPENDIUM_PAGE_SIZE);
  const selected = selectedCompendiumCard(CARDS, state.card || legacyDetail);
  const normalized = state.q.toLowerCase();
  const rules = useMemo(
    () => ruleReferences.filter((entry) => !normalized || `${entry.title} ${entry.body} ${entry.category}`.toLowerCase().includes(normalized)),
    [normalized],
  );

  const urlFor = useCallback((next: CompendiumState, path = "/compendium") => {
    const query = compendiumSearchParams(next).toString();
    return query ? `${path}?${query}` : path;
  }, []);

  const navigate = useCallback((patch: StatePatch, options: { push?: boolean; resetPage?: boolean } = {}) => {
    const next = {
      ...state,
      ...patch,
      page: options.resetPage ? 1 : patch.page ?? state.page,
    };
    const method = options.push ? "push" : "replace";
    router[method](urlFor(next));
  }, [router, state, urlFor]);

  const closeInspector = useCallback(() => {
    const trigger = inspectorTrigger.current;
    navigate({ card: "", tab: "overview" });
    setTimeout(() => trigger?.focus(), 0);
  }, [navigate]);

  useEffect(() => { setCompendiumTab(section); }, [section, setCompendiumTab]);
  useEffect(() => {
    if (legacyDetail && !state.card) {
      router.replace(urlFor({ ...state, card: legacyDetail, tab: "overview" }));
    }
  }, [legacyDetail, router, state, urlFor]);
  useEffect(() => {
    if (state.page > pages) navigate({ page: pages });
  }, [navigate, pages, state.page]);
  useEffect(() => {
    const closeOverlays = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (filterSheetOpen) setFilterSheetOpen(false);
      else if (selected) closeInspector();
    };
    addEventListener("keydown", closeOverlays);
    return () => removeEventListener("keydown", closeOverlays);
  }, [closeInspector, filterSheetOpen, selected]);

  const activeFilterCount = (["set", "type", "faction", "cost", "rarity", "keyword"] as FilterKey[])
    .filter((key) => state[key] !== "All").length;

  const setFilter = (key: FilterKey, value: string) => navigate({ [key]: value } as StatePatch, { resetPage: true });
  const clearFilters = () => navigate({
    set: "All",
    type: "All",
    faction: "All",
    cost: "All",
    rarity: "All",
    keyword: "All",
  }, { resetPage: true });
  const selectCard = (card: typeof CARDS[number], trigger?: HTMLElement | null) => {
    inspectorTrigger.current = trigger ?? inspectorTrigger.current;
    navigate({ card: card.slug ?? card.catalogId, tab: "overview" }, { push: true });
  };
  const copyCurrentLink = async (label: string) => {
    await copyText(location.href);
    notify(`${label} link copied.`);
  };
  const sectionUrl = (path: string) => state.q ? `${path}?q=${encodeURIComponent(state.q)}` : path;
  const copyLink = async (path: string, label: string) => {
    await copyText(`${location.origin}${path}`);
    notify(`${label} link copied.`);
  };
  const submitRuling = async () => {
    if (!authUser) return notify("Sign in before submitting a ruling request.");
    if (question.trim().length < 20) return notify("Describe the interaction in at least 20 characters.");
    setSubmission("submitting");
    try {
      const response = await fetch("/api/rulings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId: rulingCardId || null, question: question.trim(), sourceUrl: location.href }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Submission failed.");
      setQuestion("");
      setSubmission("sent");
      notify(`Ruling request ${result.id ?? ""} submitted.`);
    } catch (error) {
      setSubmission("idle");
      notify(error instanceof Error ? error.message : "Submission failed.");
    }
  };

  return (
    <div className={styles.route}>
      <RouteHero
        eyebrow="AUTHORITATIVE REFERENCE"
        title="Compendium"
        description="Browse every supported card, inspect its complete record, and follow connected rules and published rulings."
        aside={<div className={styles.sourceSummary}><strong>3 sets · {CARDS.length} cards</strong><span>Sources reviewed {REFERENCE_REVIEWED_AT}</span></div>}
      />
      <section className={`compendium-toolbar ${styles.toolbar}`}>
        <Field className={styles.search} label="Search the archive">
          <input
            value={state.q}
            onChange={(event) => navigate({ q: event.target.value }, { resetPage: true })}
            placeholder="Cards, effects, IDs, mechanics…"
          />
        </Field>
        <Tabs label="Compendium sections">
          <button className={section === "cards" ? "active" : ""} onClick={() => router.push(sectionUrl("/compendium"))}>CARDS</button>
          <button className={section === "rules" ? "active" : ""} onClick={() => router.push(sectionUrl("/compendium/rules"))}>RULES & GLOSSARY</button>
          <button className={section === "rulings" ? "active" : ""} onClick={() => router.push(sectionUrl("/compendium/rulings"))}>RULINGS</button>
        </Tabs>
      </section>

      {section === "cards" && (
        <>
          <section className={styles.resultsToolbar}>
            <div>
              <strong>{cards.length.toLocaleString()} cards</strong>
              <span>Page {page} of {pages}</span>
            </div>
            <ActionButton className={styles.mobileFilterButton} tone="secondary" onClick={() => setFilterSheetOpen(true)}>
              Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
            </ActionButton>
            <Field label="Sort">
              <select value={state.sort} onChange={(event) => navigate({ sort: event.target.value as CompendiumState["sort"] }, { resetPage: true })}>
                {Object.entries(SORT_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </Field>
            <Tabs className={styles.densityTabs} label="Gallery density">
              <button className={state.density === "gallery" ? "active" : ""} onClick={() => navigate({ density: "gallery" })}>Gallery</button>
              <button className={state.density === "compact" ? "active" : ""} onClick={() => navigate({ density: "compact" })}>Compact</button>
            </Tabs>
            <button className={styles.shareResults} type="button" onClick={() => void copyCurrentLink("Filtered results")}>Share results</button>
          </section>
          <div className={`${styles.workspace} ${selected ? styles.workspaceSelected : ""}`}>
            <Surface as="aside" className={styles.filterRail}>
              <FilterControls state={state} rarities={rarities} keywords={keywords} onChange={setFilter} onClear={clearFilters} />
            </Surface>
            <main className={styles.gallery}>
              {visible.length ? (
                <CardGrid
                  className={`${styles.cardGrid} ${state.density === "compact" ? styles.cardGridCompact : ""}`}
                  minCardWidth={state.density === "compact" ? "9.25rem" : "11.5rem"}
                >
                  {visible.map((card) => (
                    <button
                      className={`${styles.cardTile} ${selected?.catalogId === card.catalogId ? styles.cardTileSelected : ""}`}
                      type="button"
                      aria-pressed={selected?.catalogId === card.catalogId}
                      key={card.catalogId}
                      onClick={(event) => selectCard(card, event.currentTarget)}
                    >
                      <span className={styles.cardArt}><ResponsiveCardImage card={card} presentation="tile" /></span>
                      <span className={styles.cardCopy}>
                        <span className={styles.cardBadges}><StatusChip tone="info">{card.faction}</StatusChip><StatusChip>{cardSetCode(card)}</StatusChip></span>
                        <strong>{card.displayName}</strong>
                        <small>{card.type} · {card.cost} Energy · {card.rarity}</small>
                      </span>
                    </button>
                  ))}
                </CardGrid>
              ) : (
                <Surface className={styles.emptyResults} role="status">
                  <span>◇</span><h2>No cards match</h2><p>Adjust the search or clear the active filters to return to the full archive.</p>
                  <ActionButton tone="secondary" onClick={clearFilters}>Clear filters</ActionButton>
                </Surface>
              )}
              <nav className={styles.pagination} aria-label="Card result pages">
                <button disabled={page === 1} onClick={() => navigate({ page: page - 1 }, { push: true })}>← Previous</button>
                <span>Page {page} of {pages}</span>
                <button disabled={page === pages} onClick={() => navigate({ page: page + 1 }, { push: true })}>Next →</button>
              </nav>
            </main>
            {selected && (
              <CardInspector
                card={selected}
                allCards={CARDS}
                rules={ruleReferences}
                rulings={PUBLISHED_RULINGS}
                tab={state.tab}
                onTabChange={(tab: CardInspectorTab) => navigate({ tab }, { push: true })}
                onSelectCard={(card) => selectCard(card)}
                onClose={closeInspector}
                onShare={() => void copyCurrentLink(selected.displayName)}
              />
            )}
          </div>
          {filterSheetOpen && (
            <div className={styles.filterBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFilterSheetOpen(false); }}>
              <Surface as="aside" className={styles.filterSheet} role="dialog" aria-modal="true" aria-label="Card filters">
                <FilterControls state={state} rarities={rarities} keywords={keywords} onChange={setFilter} onClear={clearFilters} />
                <ActionButton onClick={() => setFilterSheetOpen(false)}>Show {cards.length} cards</ActionButton>
              </Surface>
            </div>
          )}
        </>
      )}

      {section === "rules" && (
        <section className="rules-reader-layout">
          <aside className="panel rules-contents"><h2>Contents</h2>{[...new Set(rules.map((rule) => rule.category))].map((category) => <a key={category} href={`#category-${slug(category)}`}>{category}</a>)}</aside>
          <main>
            <section className="symbol-reference panel"><div className="panel-heading"><h2>Printed icons</h2><Badge>{SYMBOL_ENTRIES.length}</Badge></div><div>{SYMBOL_ENTRIES.map((symbol) => <article key={symbol.token}><img src={symbol.asset} alt="" /><strong>{symbol.name}</strong><code>{symbol.token}</code><p>{symbol.description}</p></article>)}</div></section>
            {[...new Set(rules.map((rule) => rule.category))].map((category) => <section className="rule-category" id={`category-${slug(category)}`} key={category}><h2>{category}</h2>{rules.filter((rule) => rule.category === category).map((rule) => <article className="panel rule-article" id={`rule-${rule.slug}`} key={`${rule.source}-${rule.slug}`}><h3>{rule.title}</h3><p>{rule.body}</p><footer><small>{rule.source} · {rule.sourceSection} · Reviewed {rule.reviewedAt}</small><button onClick={() => void copyLink(`/compendium/rules/${rule.slug}`, rule.title)}>COPY LINK</button></footer></article>)}</section>)}
          </main>
        </section>
      )}

      {section === "rulings" && (
        <>
          <section className="rulings-heading"><div><span className="eyebrow">PUBLISHED RESPONSES</span><h2>Rulings</h2></div><AppButton tone="red" onClick={() => setShowSubmission(true)}>SUBMIT A QUESTION</AppButton></section>
          <section className="ruling-list modern-rulings">{PUBLISHED_RULINGS.filter((ruling) => !normalized || `${ruling.title} ${ruling.body}`.toLowerCase().includes(normalized)).map((ruling) => <article className="panel" key={ruling.slug}><div className="hero-actions"><Badge tone="gold">PUBLISHED</Badge><Badge>DEVELOPER RESPONSE</Badge></div><h2>{ruling.title}</h2><p>{ruling.body}</p><footer><small>{ruling.sourceSection} · Reviewed {ruling.reviewedAt}</small><button onClick={() => void copyLink(`/compendium/rulings/${ruling.slug}`, ruling.title)}>COPY LINK</button></footer></article>)}</section>
        </>
      )}

      {showSubmission && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowSubmission(false); }}>
          <section className="panel ruling-submission-modal" role="dialog" aria-modal="true" aria-labelledby="ruling-question-title">
            <h2 id="ruling-question-title">Submit an unanswered interaction</h2>
            <p>Questions enter the administrator review queue. Published responses remain clearly attributed in the Compendium.</p>
            <label>Card<select value={rulingCardId} onChange={(event) => setRulingCardId(event.target.value)}><option value="">General rules question</option>{CARDS.map((card) => <option value={card.catalogId} key={card.catalogId}>{cardSetCode(card)} · {card.displayName}</option>)}</select></label>
            <label>Question<textarea value={question} onChange={(event) => setQuestion(event.target.value)} minLength={20} maxLength={2000} /></label>
            {submission === "sent" && <p className="success-message">Request submitted.</p>}
            <div className="hero-actions"><AppButton tone="red" disabled={submission === "submitting" || question.trim().length < 20} onClick={() => void submitRuling()}>{submission === "submitting" ? "SUBMITTING…" : "SUBMIT RULING REQUEST"}</AppButton><AppButton tone="ghost" onClick={() => setShowSubmission(false)}>CLOSE</AppButton></div>
          </section>
        </div>
      )}
    </div>
  );
}
