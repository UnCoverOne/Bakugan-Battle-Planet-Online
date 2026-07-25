"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CARDS, RULE_ENTRIES } from "../../lib/data";
import { CARD_SET_INFO, cardCollectorLabel, cardSetCode } from "../../lib/content/catalogue";
import { GLOSSARY_ENTRIES, PUBLISHED_RULINGS, REFERENCE_REVIEWED_AT, SYMBOL_ENTRIES } from "../../lib/reference";
import { useApp } from "../application/AppProvider";
import { AppButton, Badge, PageHeader, copyText, factionClass } from "../application/ui";

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
function CardImage({ card, detail = false }: { card: typeof CARDS[number]; detail?: boolean }) {
  const src = detail || !card.art.startsWith("/assets/cards/full/")
    ? card.art
    : card.hasProvidedScan
      ? card.art.replace("/full/", "/thumb/")
      : card.art;
  return <img src={src} alt={detail ? card.displayName : ""} width={detail ? 600 : 260} height={detail ? 840 : 364} loading={detail ? "eager" : "lazy"} onError={(event) => { if (!event.currentTarget.src.endsWith("/assets/cards/card-missing.svg")) event.currentTarget.src = "/assets/cards/card-missing.svg"; }} />;
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
    return <section className="card-detail-page"><header className="card-detail-nav"><button onClick={() => router.push("/compendium")}>← CARD RESULTS</button></header><div className="card-detail-layout"><CardImage card={selected} detail /><article className="panel"><div className="hero-actions"><Badge tone={factionClass(selected.faction)}>{selected.factions.join(" • ")}</Badge><Badge tone="gold">{selectedSet.name}</Badge></div><h1>{selected.displayName}</h1><p className="card-effect-large"><Effect text={selected.effect} /></p><dl className="metadata-grid"><div><dt>Catalogue ID</dt><dd>{selected.catalogId}</dd></div><div><dt>Collector number</dt><dd>{cardCollectorLabel(selected)}</dd></div><div><dt>Type</dt><dd>{selected.type}</dd></div><div><dt>Rarity</dt><dd>{selected.rarity}</dd></div><div><dt>Energy cost</dt><dd>{selected.cost}</dd></div><div><dt>Source</dt><dd>{selected.source ?? "Provided catalogue"}</dd></div></dl><div className="hero-actions"><AppButton tone="red" onClick={() => router.push(`/compendium/rulings?card=${encodeURIComponent(selected.catalogId)}`)}>OPEN RULINGS</AppButton><AppButton tone="ghost" onClick={() => void copyLink(`/compendium/cards/${selected.slug ?? selected.catalogId}`, selected.displayName)}>COPY LINK</AppButton></div></article></div></section>;
  }
  return <>
    <PageHeader eyebrow="AUTHORITATIVE REFERENCE" title="CARD & RULES COMPENDIUM" copy="Battle Brawlers, Bakugan Resurgence, Age of Aurelus, the official glossary, and published developer responses live in this route-owned bundle." art="/assets/aquos.png" />
    <section className="compendium-provenance panel"><div><span className="eyebrow">SOURCE STATUS</span><h2>REVIEWED {REFERENCE_REVIEWED_AT}</h2></div><p>Cards: supplied workbooks and scans. Rules: Official Complete Rulebook and Glossary. Published answers: developer ruling document.</p><Badge tone="gold">3 SETS • {CARDS.length} CARDS</Badge></section>
    <section className="compendium-toolbar"><label className="search-box large">⌕<input value={compendiumQuery} onChange={(event) => setCompendiumQuery(event.target.value)} placeholder="Search a card, set, keyword, symbol, ID, or ruling…" /></label><div className="tabs"><button className={compendiumTab === "cards" ? "active" : ""} onClick={() => router.push("/compendium")}>CARDS</button><button className={compendiumTab === "rules" ? "active" : ""} onClick={() => router.push("/compendium/rules")}>RULES & GLOSSARY</button><button className={compendiumTab === "rulings" ? "active" : ""} onClick={() => router.push("/compendium/rulings")}>RULINGS</button></div></section>
    {section === "cards" && <><section className="compendium-filters panel"><label>SET<select value={setCode} onChange={(event) => setSetCode(event.target.value)}><option>All</option>{Object.values(CARD_SET_INFO).map((set) => <option value={set.code} key={set.code}>{set.name}</option>)}</select></label><label>TYPE<select value={type} onChange={(event) => setType(event.target.value)}><option>All</option>{["Action","Flip","Hero","Evo","Character"].map((value) => <option key={value}>{value}</option>)}</select></label><label>FACTION<select value={faction} onChange={(event) => setFaction(event.target.value)}><option>All</option>{["Aquos","Aurelus","Darkus","Haos","Pyrus","Ventus"].map((value) => <option key={value}>{value}</option>)}</select></label><Badge>{cards.length} RESULTS</Badge></section><section className="compendium-cards">{visible.map((card) => <article className="reference-card" key={card.catalogId}><button className="reference-art" onClick={() => router.push(`/compendium/cards/${card.slug ?? card.catalogId}`)}><CardImage card={card} /></button><div><div className="hero-actions"><Badge tone={factionClass(card.faction)}>{card.faction}</Badge><Badge>{cardSetCode(card)}</Badge></div><h2>{card.displayName}</h2><p><Effect text={card.effect} /></p><button onClick={() => router.push(`/compendium/rulings?card=${encodeURIComponent(card.catalogId)}`)}>OPEN OFFICIAL RULINGS →</button></div></article>)}</section><nav className="catalog-pagination"><button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>← PREVIOUS</button><span>Page {page} of {pages}</span><button disabled={page === pages} onClick={() => setPage((value) => value + 1)}>NEXT →</button></nav></>}
    {section === "rules" && <><section className="symbol-reference panel"><div className="panel-heading"><h2>PRINTED ICONS</h2><Badge>{SYMBOL_ENTRIES.length}</Badge></div><div>{SYMBOL_ENTRIES.map((symbol) => <article key={symbol.token}><img src={symbol.asset} alt="" /><strong>{symbol.name}</strong><code>{symbol.token}</code><p>{symbol.description}</p></article>)}</div></section><section className="rule-grid">{rules.map((rule) => <article className="panel" id={`rule-${rule.slug}`} key={`${rule.source}-${rule.slug}`}><Badge>{rule.category}</Badge><h2>{rule.title}</h2><p>{rule.body}</p><small>{rule.source} • {rule.sourceSection} • Reviewed {rule.reviewedAt}</small><button onClick={() => void copyLink(`/compendium/rules/${rule.slug}`, rule.title)}>COPY RULE LINK</button></article>)}</section></>}
    {section === "rulings" && <section className="ruling-list">{PUBLISHED_RULINGS.filter((ruling) => !normalized || `${ruling.title} ${ruling.body}`.toLowerCase().includes(normalized)).map((ruling) => <article className="panel" key={ruling.slug}><Badge tone="gold">PUBLISHED</Badge><h2>{ruling.title}</h2><p>{ruling.body}</p><small>{ruling.sourceSection} • Reviewed {ruling.reviewedAt}</small><button onClick={() => void copyLink(`/compendium/rulings/${ruling.slug}`, ruling.title)}>COPY RULING LINK</button></article>)}<article className="panel unresolved"><Badge tone="red">ADMINISTRATOR REVIEW QUEUE</Badge><h2>Submit an unanswered interaction</h2><label>CARD<select value={rulingCardId} onChange={(event) => setRulingCardId(event.target.value)}><option value="">General rules question</option>{CARDS.map((card) => <option value={card.catalogId} key={card.catalogId}>{cardSetCode(card)} • {card.displayName}</option>)}</select></label><label>QUESTION<textarea value={question} onChange={(event) => setQuestion(event.target.value)} minLength={20} maxLength={2000} /></label>{submission === "sent" && <p className="success-message">Request submitted.</p>}<AppButton tone="red" disabled={submission === "submitting" || question.trim().length < 20} onClick={() => void submitRuling()}>{submission === "submitting" ? "SUBMITTING…" : "SUBMIT RULING REQUEST"}</AppButton></article></section>}
  </>;
}
