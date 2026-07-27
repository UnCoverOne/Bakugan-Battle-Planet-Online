"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CARDS, RULE_ENTRIES } from "../../lib/data";
import { CARD_SET_INFO, cardCollectorLabel, cardSetCode } from "../../lib/content/catalogue";
import { cardArtSource } from "../../lib/content/card-art";
import { GLOSSARY_ENTRIES, PUBLISHED_RULINGS, REFERENCE_REVIEWED_AT, SYMBOL_ENTRIES } from "../../lib/reference";
import { useApp } from "../application/AppProvider";
import { AppButton, Badge, copyText, factionClass } from "../application/ui";
import { CardGrid, Field, RouteHero, StatusChip, Surface, Tabs } from "../design-system/primitives";
import styles from "./CompendiumScreen.module.css";

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
function CardImage({ card, detail = false }: { card: typeof CARDS[number]; detail?: boolean }) {
  const src = cardArtSource(card, "full");
  return <img src={src} alt={detail ? card.displayName : ""} width={detail ? 600 : 360} height={detail ? 840 : 504} loading={detail ? "eager" : "lazy"} decoding="async" onError={(event) => { if (!event.currentTarget.src.endsWith("/assets/cards/card-missing.svg")) event.currentTarget.src = "/assets/cards/card-missing.svg"; }} />;
}
function Effect({ text }: { text: string }) {
  const pattern = /(\[B\]|\[Damage Rating\]|\[Energy\]|\[DoubleStrike\]|\[FrostStrike\]|\[ShadowStrike\]|\[Victor\])/g;
  return <>{text.split(pattern).map((part, index) => { const symbol = SYMBOL_ENTRIES.find((item) => item.token === part); return symbol ? <img className="inline-symbol" src={symbol.asset} alt={symbol.name} width="18" height="18" key={`${part}-${index}`} /> : <span key={`${part}-${index}`}>{part}</span>; })}</>;
}

export function CompendiumScreen({ segments = [] }: { segments?: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { compendiumQuery, setCompendiumQuery, compendiumTab, setCompendiumTab, authUser, notify } = useApp();
  const section = segments[0] === "rules" ? "rules" : segments[0] === "rulings" ? "rulings" : "cards";
  const detail = section === "cards" ? decodeURIComponent(segments[1] ?? "") : "";
  const [type, setType] = useState("All");
  const [faction, setFaction] = useState("All");
  const [setCode, setSetCode] = useState("All");
  const [page, setPage] = useState(1);
  const [rulingCardId, setRulingCardId] = useState(searchParams.get("card") ?? "");
  const [question, setQuestion] = useState("");
  const [submission, setSubmission] = useState("idle");
  const [showSubmission, setShowSubmission] = useState(false);
  const normalized = compendiumQuery.trim().toLowerCase();
  useEffect(() => { setCompendiumTab(section); }, [section, setCompendiumTab]);
  useEffect(() => { setPage(1); }, [compendiumQuery, faction, setCode, type]);
  const cards = useMemo(() => CARDS.filter((card) => {
    const cardSet = cardSetCode(card);
    const text = `${card.displayName} ${card.effect} ${card.faction} ${card.type} ${card.catalogId} ${CARD_SET_INFO[cardSet].name} ${cardSet}`.toLowerCase();
    return (!normalized || text.includes(normalized))
      && (type === "All" || card.type === type)
      && (faction === "All" || card.factions.includes(faction as never))
      && (setCode === "All" || cardSet === setCode);
  }), [faction, normalized, setCode, type]);
  const rules = useMemo(() => [...RULE_ENTRIES.map((entry) => ({ ...entry, slug: slug(entry.title), source: "Digital adaptation reference", sourceSection: entry.category, reviewedAt: REFERENCE_REVIEWED_AT })), ...GLOSSARY_ENTRIES].filter((entry) => !normalized || `${entry.title} ${entry.body} ${entry.category}`.toLowerCase().includes(normalized)), [normalized]);
  const selected = detail ? CARDS.find((card) => card.slug === detail || card.catalogId === detail) : null;
  const PAGE = 24;
  const visible = cards.slice((page - 1) * PAGE, page * PAGE);
  const pages = Math.max(1, Math.ceil(cards.length / PAGE));
  const copyLink = async (path: string, label: string) => { await copyText(`${location.origin}${path}`); notify(`${label} link copied.`); };
  const submitRuling = async () => {
    if (!authUser) return notify("Sign in before submitting a ruling request.");
    if (question.trim().length < 20) return notify("Describe the interaction in at least 20 characters.");
    setSubmission("submitting");
    try {
      const response = await fetch("/api/rulings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cardId: rulingCardId || null, question: question.trim(), sourceUrl: location.href }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Submission failed.");
      setQuestion(""); setSubmission("sent"); notify(`Ruling request ${result.id ?? ""} submitted.`);
    } catch (error) { setSubmission("idle"); notify(error instanceof Error ? error.message : "Submission failed."); }
  };
  if (selected) {
    const selectedSet = CARD_SET_INFO[cardSetCode(selected)];
    return <section className={`card-detail-page ${styles.detail}`}><header className="card-detail-nav"><button onClick={() => router.push("/compendium")}>← CARD RESULTS</button></header><div className="card-detail-layout"><CardImage card={selected} detail /><Surface as="article" className="panel" elevation="overlay"><div className="hero-actions"><Badge tone={factionClass(selected.faction)}>{selected.factions.join(" • ")}</Badge><Badge tone="gold">{selectedSet.name}</Badge></div><h1>{selected.displayName}</h1><p className="card-effect-large"><Effect text={selected.effect} /></p><dl className="metadata-grid"><div><dt>Catalogue ID</dt><dd>{selected.catalogId}</dd></div><div><dt>Collector number</dt><dd>{cardCollectorLabel(selected)}</dd></div><div><dt>Type</dt><dd>{selected.type}</dd></div><div><dt>Rarity</dt><dd>{selected.rarity}</dd></div><div><dt>Energy cost</dt><dd>{selected.cost}</dd></div><div><dt>Source</dt><dd>{selected.source ?? "Provided catalogue"}</dd></div></dl><div className="hero-actions"><AppButton tone="red" onClick={() => router.push(`/compendium/rulings?card=${encodeURIComponent(selected.catalogId)}`)}>OPEN RULINGS</AppButton><AppButton tone="ghost" onClick={() => void copyLink(`/compendium/cards/${selected.slug ?? selected.catalogId}`, selected.displayName)}>COPY LINK</AppButton></div></Surface></div></section>;
  }
  return <div className={styles.route}>
    <RouteHero eyebrow="AUTHORITATIVE REFERENCE" title="Compendium" description="Browse all supported cards, the official rules and glossary, and published developer rulings." aside={<div className={styles.sourceSummary}><strong>3 sets · {CARDS.length} cards</strong><span>Sources reviewed {REFERENCE_REVIEWED_AT}</span></div>} />
    <section className={`compendium-toolbar ${styles.toolbar}`}><Field className={styles.search} label="Search the archive"><input value={compendiumQuery} onChange={(event) => setCompendiumQuery(event.target.value)} placeholder="Cards, rules, symbols, IDs, or rulings…" /></Field><Tabs label="Compendium sections"><button className={compendiumTab === "cards" ? "active" : ""} onClick={() => router.push("/compendium")}>CARDS</button><button className={compendiumTab === "rules" ? "active" : ""} onClick={() => router.push("/compendium/rules")}>RULES & GLOSSARY</button><button className={compendiumTab === "rulings" ? "active" : ""} onClick={() => router.push("/compendium/rulings")}>RULINGS</button></Tabs></section>
    {section === "cards" && <><Surface className={`compendium-filters panel ${styles.filters}`}><Field label="Set"><select value={setCode} onChange={(event) => setSetCode(event.target.value)}><option>All</option>{Object.values(CARD_SET_INFO).map((set) => <option value={set.code} key={set.code}>{set.name}</option>)}</select></Field><Field label="Type"><select value={type} onChange={(event) => setType(event.target.value)}><option>All</option>{["Action","Flip","Hero","Evo","Character"].map((value) => <option key={value}>{value}</option>)}</select></Field><Field label="Faction"><select value={faction} onChange={(event) => setFaction(event.target.value)}><option>All</option>{["Aquos","Aurelus","Darkus","Haos","Pyrus","Ventus"].map((value) => <option key={value}>{value}</option>)}</select></Field><StatusChip tone="info">{cards.length} RESULTS</StatusChip></Surface><CardGrid className={`compendium-cards compact-card-grid ${styles.cardGrid}`} minCardWidth="11.5rem">{visible.map((card) => <button className="reference-card compact" key={card.catalogId} onClick={() => router.push(`/compendium/cards/${card.slug ?? card.catalogId}`)}><span className="reference-art"><CardImage card={card} /></span><span className="reference-card-copy"><span className="reference-card-badges"><StatusChip tone="info">{card.faction}</StatusChip><StatusChip>{cardSetCode(card)}</StatusChip></span><strong>{card.displayName}</strong><small>{card.type} · {card.cost} Energy · {card.rarity}</small></span></button>)}</CardGrid><nav className="catalog-pagination"><button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>← PREVIOUS</button><span>Page {page} of {pages}</span><button disabled={page === pages} onClick={() => setPage((value) => value + 1)}>NEXT →</button></nav></>}
    {section === "rules" && <section className="rules-reader-layout"><aside className="panel rules-contents"><h2>Contents</h2>{[...new Set(rules.map((rule) => rule.category))].map((category) => <a key={category} href={`#category-${slug(category)}`}>{category}</a>)}</aside><main><section className="symbol-reference panel"><div className="panel-heading"><h2>Printed icons</h2><Badge>{SYMBOL_ENTRIES.length}</Badge></div><div>{SYMBOL_ENTRIES.map((symbol) => <article key={symbol.token}><img src={symbol.asset} alt="" /><strong>{symbol.name}</strong><code>{symbol.token}</code><p>{symbol.description}</p></article>)}</div></section>{[...new Set(rules.map((rule) => rule.category))].map((category) => <section className="rule-category" id={`category-${slug(category)}`} key={category}><h2>{category}</h2>{rules.filter((rule) => rule.category === category).map((rule) => <article className="panel rule-article" id={`rule-${rule.slug}`} key={`${rule.source}-${rule.slug}`}><h3>{rule.title}</h3><p>{rule.body}</p><footer><small>{rule.source} · {rule.sourceSection} · Reviewed {rule.reviewedAt}</small><button onClick={() => void copyLink(`/compendium/rules/${rule.slug}`, rule.title)}>COPY LINK</button></footer></article>)}</section>)}</main></section>}
    {section === "rulings" && <><section className="rulings-heading"><div><span className="eyebrow">PUBLISHED RESPONSES</span><h2>Rulings</h2></div><AppButton tone="red" onClick={() => setShowSubmission(true)}>SUBMIT A QUESTION</AppButton></section><section className="ruling-list modern-rulings">{PUBLISHED_RULINGS.filter((ruling) => !normalized || `${ruling.title} ${ruling.body}`.toLowerCase().includes(normalized)).map((ruling) => <article className="panel" key={ruling.slug}><div className="hero-actions"><Badge tone="gold">PUBLISHED</Badge><Badge>DEVELOPER RESPONSE</Badge></div><h2>{ruling.title}</h2><p>{ruling.body}</p><footer><small>{ruling.sourceSection} · Reviewed {ruling.reviewedAt}</small><button onClick={() => void copyLink(`/compendium/rulings/${ruling.slug}`, ruling.title)}>COPY LINK</button></footer></article>)}</section></>}
    {showSubmission && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowSubmission(false); }}><section className="panel ruling-submission-modal" role="dialog" aria-modal="true" aria-labelledby="ruling-question-title"><h2 id="ruling-question-title">Submit an unanswered interaction</h2><p>Questions enter the administrator review queue. Published responses remain clearly attributed in the Compendium.</p><label>Card<select value={rulingCardId} onChange={(event) => setRulingCardId(event.target.value)}><option value="">General rules question</option>{CARDS.map((card) => <option value={card.catalogId} key={card.catalogId}>{cardSetCode(card)} · {card.displayName}</option>)}</select></label><label>Question<textarea value={question} onChange={(event) => setQuestion(event.target.value)} minLength={20} maxLength={2000} /></label>{submission === "sent" && <p className="success-message">Request submitted.</p>}<div className="hero-actions"><AppButton tone="red" disabled={submission === "submitting" || question.trim().length < 20} onClick={() => void submitRuling()}>{submission === "submitting" ? "SUBMITTING…" : "SUBMIT RULING REQUEST"}</AppButton><AppButton tone="ghost" onClick={() => setShowSubmission(false)}>CLOSE</AppButton></div></section></div>}
  </div>;
}
