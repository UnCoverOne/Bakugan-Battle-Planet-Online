"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CARD_SET_INFO, cardSetCode } from "../../lib/content/catalogue";
import { cardArtSource } from "../../lib/content/card-art";
import { BAKUGAN, CARD_BY_ID, CARDS, CORES, PUBLIC_DECKS, STARTER_DECKS, deckErrors, deckIsLegal, deckLeadCard, type DeckRecord } from "../../lib/data";
import { DECK_LIMIT, decodeDeckCode, deckTextList, encodeDeckCode, uniqueDeckName } from "../../lib/deck-transfer";
import { deckSetName } from "../../lib/deck-set";
import { useApp } from "../application/AppProvider";
import { AppButton, Badge, copyText, downloadTextFile, factionClass, formatTimestamp } from "../application/ui";
import { ActionButton, CardGrid, RouteHero, StatusChip, Tabs } from "../design-system/primitives";
import styles from "./DeckRoutes.module.css";

const clone = (deck: DeckRecord): DeckRecord => ({ ...deck, factions: [...deck.factions], bakuganIds: [...deck.bakuganIds], coreIds: [...deck.coreIds], cardIds: [...deck.cardIds], tags: [...(deck.tags ?? [])] });
const blankDraft = (decks: DeckRecord[]): DeckRecord => ({ ...clone(STARTER_DECKS[0]), id: crypto.randomUUID?.() ?? `deck-${Date.now().toString(36)}`, name: uniqueDeckName("Untitled Battle Deck", decks), cardIds: [], leadCardId: undefined, updatedAt: new Date().toISOString(), visibility: "Private", revision: 1 });
const publicDecksFor = (decks: DeckRecord[], playerName = "You") => [
  ...decks.filter((deck) => deck.visibility === "Public").map((deck) => ({ ...deck, creator: deck.creator ?? playerName, publishedAt: deck.publishedAt ?? deck.updatedAt })),
  ...PUBLIC_DECKS,
].filter((deck, index, all) => all.findIndex((candidate) => candidate.id === deck.id) === index);

function DeckAreaHeader({ section, count, action }: { section: "mine" | "public"; count: number; action?: React.ReactNode }) {
  return <RouteHero
    className="deck-area-heading"
    eyebrow="DECK MANAGEMENT"
    title={section === "mine" ? "My Decks" : "Public Decks"}
    description={section === "mine" ? `${count} saved decks on this account or device.` : "Browse featured and player-published Battle Planet deck lists."}
    aside={<div className={styles.heroUtilities}>{action}<Tabs label="Deck library sections"><Link aria-current={section === "mine" ? "page" : undefined} href="/decks">My Decks</Link><Link aria-current={section === "public" ? "page" : undefined} href="/decks/public">Public Decks</Link></Tabs></div>}
  />;
}

export function DeckLibraryScreen() {
  const router = useRouter();
  const { decks, setDecks, deckQuery, setDeckQuery, selectedDeckId, setSelectedDeckId, setBuilderDeck, notify } = useApp();
  const [faction, setFaction] = useState("All");
  const [legality, setLegality] = useState("All");
  const [sort, setSort] = useState("Updated");
  const [importCode, setImportCode] = useState("");
  const [importError, setImportError] = useState("");

  useEffect(() => {
    if (decks.length) return;
    const starters = STARTER_DECKS.map(clone);
    setDecks(starters);
    setSelectedDeckId(starters[0].id);
  }, [decks.length, setDecks, setSelectedDeckId]);

  const visible = useMemo(() => decks.filter((deck: DeckRecord) => {
    const text = `${deck.name} ${deck.factions.join(" ")} ${deck.tags?.join(" ") ?? ""} ${deckSetName(deck)}`.toLowerCase();
    const queryMatch = !deckQuery.trim() || text.includes(deckQuery.trim().toLowerCase());
    const factionMatch = faction === "All" || deck.factions.includes(faction);
    const legal = deckIsLegal(deck);
    return queryMatch && factionMatch && (legality === "All" || (legality === "Legal" ? legal : !legal));
  }).sort((a: DeckRecord, b: DeckRecord) => sort === "Name" ? a.name.localeCompare(b.name) : Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), [deckQuery, decks, faction, legality, sort]);

  const create = () => {
    if (decks.length >= DECK_LIMIT) return notify(`Deck limit reached (${DECK_LIMIT}).`);
    const draft = blankDraft(decks);
    setBuilderDeck(draft);
    router.push("/builder/new");
  };
  const importDeck = () => {
    try {
      const imported = decodeDeckCode(importCode, () => crypto.randomUUID?.() ?? `deck-${Date.now().toString(36)}`);
      imported.name = uniqueDeckName(imported.name, decks);
      imported.visibility = "Private";
      imported.leadCardId = imported.leadCardId && imported.cardIds.includes(imported.leadCardId) ? imported.leadCardId : imported.cardIds[0];
      setDecks((items: DeckRecord[]) => [imported, ...items]);
      setSelectedDeckId(imported.id);
      setImportCode(""); setImportError(""); notify(`Imported ${imported.name}.`);
    } catch (error) { setImportError(error instanceof Error ? error.message : "Invalid deck code."); }
  };

  return <div className={styles.route}>
    <DeckAreaHeader section="mine" count={decks.length} action={<ActionButton onClick={create}>+ CREATE DECK</ActionButton>}/>
    <section className="toolbar deck-toolbar overhaul-toolbar"><label className="search-box">⌕<input value={deckQuery} onChange={(event) => setDeckQuery(event.target.value)} placeholder="Search My Decks…" /></label><Badge>{decks.length} / {DECK_LIMIT}</Badge><label>Faction<select value={faction} onChange={(event) => setFaction(event.target.value)}><option>All</option>{["Aquos","Aurelus","Darkus","Haos","Pyrus","Ventus"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Status<select value={legality} onChange={(event) => setLegality(event.target.value)}><option>All</option><option>Legal</option><option>Issues</option></select></label><label>Sort<select value={sort} onChange={(event) => setSort(event.target.value)}><option>Updated</option><option>Name</option></select></label></section>
    <details className="panel import-drawer"><summary>Import a deck code</summary><div><textarea value={importCode} onChange={(event) => setImportCode(event.target.value)} placeholder="BBP1.…" />{importError && <p className="error-message">{importError}</p>}<AppButton tone="ghost" disabled={!importCode.trim()} onClick={importDeck}>VALIDATE & IMPORT</AppButton></div></details>
    <CardGrid className={`deck-grid overhaul-deck-grid ${styles.deckGrid}`} minCardWidth="22rem">{visible.map((deck: DeckRecord) => <MyDeckCard key={deck.id} deck={deck} selected={selectedDeckId === deck.id} onSelect={() => { setSelectedDeckId(deck.id); router.push(`/decks/${encodeURIComponent(deck.id)}`); }} onEdit={() => router.push(`/builder/${encodeURIComponent(deck.id)}`)} onDuplicate={() => { const copy = { ...clone(deck), id: crypto.randomUUID(), name: uniqueDeckName(`${deck.name} Copy`, decks), visibility: "Private" as const, creator: undefined, publishedAt: undefined, updatedAt: new Date().toISOString() }; setDecks((items: DeckRecord[]) => [copy, ...items]); notify(`${copy.name} created.`); }} onDelete={() => setDecks((items: DeckRecord[]) => items.filter((item) => item.id !== deck.id))}/>)}</CardGrid>
    {!visible.length && <section className="empty-state panel deck-empty"><strong>NO MATCHING DECKS</strong><p>Clear the filters or create a new deck.</p></section>}
  </div>;
}

function MyDeckCard({ deck, selected, onSelect, onEdit, onDuplicate, onDelete }: { deck: DeckRecord; selected: boolean; onSelect: () => void; onEdit: () => void; onDuplicate: () => void; onDelete: () => void }) {
  const lead = deckLeadCard(deck);
  const legal = deckIsLegal(deck);
  return <article className={`deck-tile overhaul-deck-card ${styles.deckCard} ${selected ? "selected" : ""}`}>
    <button className="deck-card-main" onClick={onSelect}>
      <div className={`deck-cover ${factionClass(deck.factions[0] ?? "Pyrus")}`}>{lead ? <img src={cardArtSource(lead, "full")} loading="lazy" decoding="async" alt={`${lead.displayName}, Lead card for ${deck.name}`}/> : <img src="/assets/cards/card-missing.svg" alt="No Lead card selected"/>}<StatusChip>{deck.visibility}</StatusChip></div>
      <div className="deck-card-copy"><h2>{deck.name}</h2><p>{deck.factions.join(" • ")}</p><div><StatusChip tone="info">{deckSetName(deck).toUpperCase()}</StatusChip><StatusChip tone={legal ? "success" : "danger"}>{legal ? "LEGAL" : `${deckErrors(deck).length} ISSUES`}</StatusChip><small>{deck.cardIds.length} cards · {deck.bakuganIds.length} Bakugan · {deck.coreIds.length} Cores</small></div><small>Updated {formatTimestamp(deck.updatedAt)}</small></div>
    </button>
    <details className="deck-card-menu"><summary aria-label={`Actions for ${deck.name}`}>•••</summary><div><button onClick={onEdit}>Edit</button><button onClick={onDuplicate}>Duplicate</button><button onClick={() => downloadTextFile(`${deck.name}.txt`, deckTextList(deck))}>Export text list</button><button className="danger-text" onClick={onDelete}>Delete</button></div></details>
  </article>;
}

export function PublicDeckLibraryScreen() {
  const { decks, profile, setDecks, notify } = useApp();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [faction, setFaction] = useState("All");
  const allPublic = publicDecksFor(decks, profile.name).sort((a, b) => Date.parse(b.publishedAt ?? b.updatedAt) - Date.parse(a.publishedAt ?? a.updatedAt));
  const visible = allPublic.filter((deck) => (!query || `${deck.name} ${deck.creator} ${deck.description} ${deck.factions.join(" ")} ${deckSetName(deck)}`.toLowerCase().includes(query.toLowerCase())) && (faction === "All" || deck.factions.includes(faction)));
  const copyDeck = (deck: DeckRecord) => {
    const copy = { ...clone(deck), id: crypto.randomUUID(), name: uniqueDeckName(deck.name, decks), visibility: "Private" as const, creator: undefined, description: deck.description, publishedAt: undefined, updatedAt: new Date().toISOString(), revision: 1 };
    setDecks((items: DeckRecord[]) => [copy, ...items]); notify(`${copy.name} copied to My Decks.`); router.push(`/decks/${encodeURIComponent(copy.id)}`);
  };
  return <div className={styles.route}>
    <DeckAreaHeader section="public" count={allPublic.length}/>
    <section className="toolbar deck-toolbar overhaul-toolbar"><label className="search-box">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search public decks, creators, or themes…" /></label><Badge>{visible.length} DECKS</Badge><label>Faction<select value={faction} onChange={(event) => setFaction(event.target.value)}><option>All</option>{["Aquos","Aurelus","Darkus","Haos","Pyrus","Ventus"].map((value) => <option key={value}>{value}</option>)}</select></label></section>
    <section className="public-deck-grid">{visible.map((deck) => { const lead = deckLeadCard(deck); return <article className="panel public-deck-card" key={deck.id}><Link className={`public-deck-lead ${factionClass(deck.factions[0] ?? "Pyrus")}`} href={`/decks/public/${encodeURIComponent(deck.id)}`}>{lead ? <img src={cardArtSource(lead, "full")} loading="lazy" decoding="async" alt={`${lead.displayName}, Lead card for ${deck.name}`}/> : <img src="/assets/cards/card-missing.svg" alt="No Lead card"/>}</Link><div><div className="hero-actions"><Badge tone="blue">{deckSetName(deck).toUpperCase()}</Badge><Badge tone={deckIsLegal(deck) ? "gold" : "red"}>{deckIsLegal(deck) ? "LEGAL" : "DRAFT"}</Badge><Badge>{deck.factions.join(" • ")}</Badge></div><h2>{deck.name}</h2><p className="deck-creator">by {deck.creator ?? "Community Brawler"}</p><p>{deck.description ?? "A public Battle Planet deck."}</p><small>Published {formatTimestamp(deck.publishedAt ?? deck.updatedAt)}</small><div className="public-deck-actions"><Link href={`/decks/public/${encodeURIComponent(deck.id)}`}>VIEW DECK</Link><button onClick={() => copyDeck(deck)}>COPY TO MY DECKS</button></div></div></article>; })}</section>
  </div>;
}

export function PublicDeckDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const { decks, profile, setDecks, notify } = useApp();
  const deck = publicDecksFor(decks, profile.name).find((item) => item.id === id);
  if (!deck) return <MissingDeck id={id} publicDeck/>;
  const copy = () => { const next = { ...clone(deck), id: crypto.randomUUID(), name: uniqueDeckName(deck.name, decks), visibility: "Private" as const, creator: undefined, publishedAt: undefined, updatedAt: new Date().toISOString() }; setDecks((items: DeckRecord[]) => [next, ...items]); notify(`${next.name} copied to My Decks.`); router.push(`/decks/${encodeURIComponent(next.id)}`); };
  return <DeckDetailPresentation deck={deck} publicView actions={<><AppButton tone="red" onClick={copy}>COPY TO MY DECKS</AppButton><Link className="hex-button ghost" href="/decks/public">BACK TO PUBLIC DECKS</Link></>}/>;
}

export function DeckDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const { decks, setBuilderDeck, setSelectedDeckId, notify } = useApp();
  const deck = decks.find((item: DeckRecord) => item.id === id);
  if (!deck) return <MissingDeck id={id}/>;
  return <DeckDetailPresentation deck={deck} actions={<><AppButton tone="red" onClick={() => { setBuilderDeck(clone(deck)); router.push(`/builder/${encodeURIComponent(deck.id)}`); }}>EDIT DECK</AppButton><AppButton tone="ghost" onClick={() => { setSelectedDeckId(deck.id); router.push("/play"); }}>USE FOR PLAY</AppButton><AppButton tone="ghost" onClick={() => void copyText(encodeDeckCode(deck)).then(() => notify("Deck code copied."))}>COPY CODE</AppButton></>}/>;
}

function DeckDetailPresentation({ deck, publicView = false, actions }: { deck: DeckRecord; publicView?: boolean; actions: React.ReactNode }) {
  const lead = deckLeadCard(deck);
  const bakugan = deck.bakuganIds.map((key) => BAKUGAN.find((item) => item.id === key)).filter(Boolean);
  const cards = [...new Set(deck.cardIds)].map((key) => ({ card: CARD_BY_ID.get(key), count: deck.cardIds.filter((id) => id === key).length })).filter((entry) => entry.card);
  const errors = deckErrors(deck);
  const typeCounts = cards.reduce<Record<string, number>>((counts, entry) => { counts[entry.card!.type] = (counts[entry.card!.type] ?? 0) + entry.count; return counts; }, {});
  return <div className={styles.route}>
    <section className="deck-detail-hero"><div className={`deck-detail-lead ${factionClass(deck.factions[0] ?? "Pyrus")}`}>{lead ? <img src={cardArtSource(lead, "full")} decoding="async" alt={`${lead.displayName}, Lead card for ${deck.name}`}/> : <img src="/assets/cards/card-missing.svg" alt="No Lead card"/>}</div><div><span className="eyebrow">{publicView ? "PUBLIC DECK" : "MY DECK"}</span><h1>{deck.name}</h1><p>{deck.description ?? `${deck.format ?? "standard"} format · ${deck.visibility} · updated ${formatTimestamp(deck.updatedAt)}`}</p><div className="hero-actions"><Badge tone="blue">{deckSetName(deck).toUpperCase()}</Badge><Badge tone={errors.length ? "red" : "gold"}>{errors.length ? `${errors.length} ISSUES` : "LEGAL"}</Badge><Badge>{deck.factions.join(" • ")}</Badge></div>{publicView && <p className="deck-creator">Created by {deck.creator ?? "Community Brawler"}</p>}<div className="hero-actions">{actions}</div></div></section>
    <section className="deck-detail-v2"><main><article className="panel deck-team-panel"><div className="panel-heading"><h2>Bakugan Team</h2><Badge>{bakugan.length} / 3</Badge></div><div className="deck-team-strip">{bakugan.map((item) => <div key={item!.id}><img src={item!.art} alt=""/><strong>{item!.name}</strong><span>{item!.bPower}B · {item!.damage}D</span></div>)}</div></article><article className="panel"><div className="panel-heading"><h2>Main Deck</h2><Badge>{deck.cardIds.length} / 40</Badge></div><div className="deck-card-list">{cards.map(({ card, count }) => <div key={card!.catalogId}><img src={cardArtSource(card!, "thumbnail")} alt=""/><strong>{count}× {card!.displayName}</strong><span>{card!.type} · {card!.faction} · {card!.cost} Energy</span></div>)}</div></article></main><aside><article className={`panel deck-legality-panel ${errors.length ? "has-errors" : ""}`}><h2>Validation</h2>{errors.length ? <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul> : <p>This deck satisfies the selected construction rules.</p>}</article><article className="panel deck-breakdown"><h2>Deck breakdown</h2>{Object.entries(typeCounts).map(([type, count]) => <div key={type}><span>{type}</span><strong>{count}</strong></div>)}<div><span>BakuCores</span><strong>{deck.coreIds.length}</strong></div></article><article className="panel"><h2>Lead card</h2>{lead ? <div className="lead-summary"><img src={cardArtSource(lead, "thumbnail")} alt=""/><div><strong>{lead.displayName}</strong><span>{lead.type} · {lead.cost} Energy</span></div></div> : <p>No Lead card selected.</p>}</article></aside></section>
  </div>;
}

export function DeckBuilderScreen({ id }: { id: string }) {
  const router = useRouter();
  const { decks, setDecks, builderDeck, setBuilderDeck, setSelectedDeckId, storageHealth, notify } = useApp();
  const source = id === "new" ? builderDeck : decks.find((item: DeckRecord) => item.id === id);
  const [deck, setDeck] = useState<DeckRecord>(() => clone(source ?? blankDraft(decks)));
  const [tab, setTab] = useState<"cards" | "bakugan" | "cores">("cards");
  const [mobileView, setMobileView] = useState<"catalogue" | "deck">("catalogue");
  const [query, setQuery] = useState("");
  const [faction, setFaction] = useState("All");
  const [type, setType] = useState("All");
  const [setCode, setSetCode] = useState("All");
  const [cost, setCost] = useState("All");
  useEffect(() => { setBuilderDeck(deck); }, [deck, setBuilderDeck]);
  const commit = (next: DeckRecord) => setDeck({ ...next, leadCardId: next.leadCardId && next.cardIds.includes(next.leadCardId) ? next.leadCardId : next.cardIds[0], factions: next.bakuganIds.map((key) => BAKUGAN.find((item) => item.id === key)?.faction).filter(Boolean) as string[] });
  const cards = CARDS.filter((card) => card.type !== "Character" && (!query || `${card.displayName} ${card.effect}`.toLowerCase().includes(query.toLowerCase())) && (faction === "All" || card.factions.includes(faction as never)) && (type === "All" || card.type === type) && (setCode === "All" || cardSetCode(card) === setCode) && (cost === "All" || card.cost === Number(cost))).slice(0, 240);
  const bakugan = BAKUGAN.filter((item) => (!query || item.name.toLowerCase().includes(query.toLowerCase())) && (faction === "All" || item.faction === faction));
  const cores = CORES.filter((item) => (!query || item.name.toLowerCase().includes(query.toLowerCase())) && (type === "All" || item.type === type));
  const adjustCard = (key: string, amount: number) => { const next = [...deck.cardIds]; if (amount > 0 && next.length < 40 && next.filter((id) => id === key).length < (deck.format === "singleton" ? 1 : 3)) next.push(key); if (amount < 0) { const index = next.lastIndexOf(key); if (index >= 0) next.splice(index, 1); } commit({ ...deck, cardIds: next }); };
  const toggleBakugan = (key: string) => commit({ ...deck, bakuganIds: deck.bakuganIds.includes(key) ? deck.bakuganIds.filter((candidate) => candidate !== key) : deck.bakuganIds.length < 3 ? [...deck.bakuganIds, key] : deck.bakuganIds });
  const adjustCore = (key: string, amount: number) => { const next = [...deck.coreIds]; if (amount > 0 && next.length < 6) next.push(key); if (amount < 0) { const index = next.lastIndexOf(key); if (index >= 0) next.splice(index, 1); } commit({ ...deck, coreIds: next }); };
  const save = () => { const next = { ...deck, id: id === "new" ? deck.id : id, leadCardId: deck.leadCardId ?? deck.cardIds[0], updatedAt: new Date().toISOString(), revision: (deck.revision ?? 0) + 1 }; setDecks((items: DeckRecord[]) => [next, ...items.filter((item) => item.id !== next.id)]); setSelectedDeckId(next.id); setBuilderDeck(null); notify("Deck saved."); router.push(`/decks/${encodeURIComponent(next.id)}`); };
  const grouped = [...new Set(deck.cardIds)].map((key) => ({ card: CARD_BY_ID.get(key), count: deck.cardIds.filter((candidate) => candidate === key).length })).filter((entry) => entry.card);
  const errors = deckErrors(deck);
  const lead = deckLeadCard(deck);

  return <section className={`builder-page builder-v2 overhaul-builder ${styles.builder}`}><header className="builder-header"><Link href="/decks">← My Decks</Link><input aria-label="Deck name" value={deck.name} onChange={(event) => commit({ ...deck, name: event.target.value })}/><label>Format<select value={deck.format ?? "standard"} onChange={(event) => commit({ ...deck, format: event.target.value as DeckRecord["format"] })}><option value="standard">Standard</option><option value="singleton">Singleton</option></select></label><label>Visibility<select value={deck.visibility} onChange={(event) => commit({ ...deck, visibility: event.target.value as DeckRecord["visibility"] })}><option>Private</option><option>Public</option></select></label><Badge tone="blue">{deckSetName(deck).toUpperCase()}</Badge><Badge tone={errors.length ? "red" : "gold"}>{errors.length ? `${errors.length} ISSUES` : "LEGAL"}</Badge><span>{storageHealth.status === "error" ? "Draft not saved" : "Draft saved locally"}</span><AppButton tone="red" onClick={save}>SAVE DECK</AppButton></header>
    <div className="builder-mobile-switch"><button className={mobileView === "catalogue" ? "active" : ""} onClick={() => setMobileView("catalogue")}>Catalogue</button><button className={mobileView === "deck" ? "active" : ""} onClick={() => setMobileView("deck")}>Current Deck</button></div>
    <div className="builder-layout builder-equal-columns">
      <aside className={`catalog panel builder-catalog-column ${mobileView !== "catalogue" ? "mobile-hidden" : ""}`}><div className="catalog-tabs"><button className={tab === "cards" ? "active" : ""} onClick={() => setTab("cards")}>CARDS</button><button className={tab === "bakugan" ? "active" : ""} onClick={() => setTab("bakugan")}>BAKUGAN</button><button className={tab === "cores" ? "active" : ""} onClick={() => setTab("cores")}>BAKUCORES</button></div><label className="catalog-search">Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${tab}…`}/></label><div className="catalog-filters">{tab !== "cores" && <label>Faction<select value={faction} onChange={(event) => setFaction(event.target.value)}><option>All</option>{["Aquos","Aurelus","Darkus","Haos","Pyrus","Ventus"].map((value) => <option key={value}>{value}</option>)}</select></label>}{tab === "cards" && <><label>Set<select value={setCode} onChange={(event) => setSetCode(event.target.value)}><option>All</option>{Object.values(CARD_SET_INFO).map((set) => <option value={set.code} key={set.code}>{set.name}</option>)}</select></label><label>Type<select value={type} onChange={(event) => setType(event.target.value)}><option>All</option>{["Action","Flip","Hero","Evo"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Cost<select value={cost} onChange={(event) => setCost(event.target.value)}><option>All</option>{Array.from({ length: 11 }, (_, value) => <option key={value}>{value}</option>)}</select></label></>}{tab === "cores" && <label>Type<select value={type} onChange={(event) => setType(event.target.value)}><option>All</option>{["Fist","Flaming Fist","Shield","Magic Shield","Helix"].map((value) => <option key={value}>{value}</option>)}</select></label>}</div><div className={`catalog-results ${tab}`}>{tab === "cards" && cards.map((card) => <article className="catalog-piece visual" key={card.catalogId}><img src={cardArtSource(card, "thumbnail")} alt=""/><div><strong>{card.displayName}</strong><span>{cardSetCode(card)} · {card.type} · {card.cost} Energy</span></div><button onClick={() => adjustCard(card.catalogId, 1)}>+ ADD</button></article>)}{tab === "bakugan" && bakugan.map((item) => <article className="catalog-piece visual" key={item.id}><img src={item.art} alt=""/><div><strong>{item.name}</strong><span>{item.faction} · {item.bPower}B</span></div><button onClick={() => toggleBakugan(item.id)}>{deck.bakuganIds.includes(item.id) ? "REMOVE" : "+ ADD"}</button></article>)}{tab === "cores" && cores.map((item) => <article className="catalog-piece visual" key={item.id}><img src={item.art} alt=""/><div><strong>{item.name}</strong><span>{item.type}</span></div><button onClick={() => adjustCore(item.id, 1)}>+ ADD</button></article>)}</div></aside>
      <main className={`deck-workspace builder-deck-column ${mobileView !== "deck" ? "mobile-hidden" : ""}`}><section className={`deck-validation-summary compact ${errors.length ? "illegal" : "legal"}`}><div><h2>{errors.length ? "Deck requires attention" : "Ready for battle"}</h2><p>{errors.length ? `${errors.length} construction issue${errors.length === 1 ? "" : "s"}.` : "All construction checks pass."}</p></div>{errors.length > 0 && <details><summary>View issues</summary><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></details>}</section><section className="panel selected-section lead-card-section"><div className="panel-heading"><div><span className="eyebrow">DECK IDENTITY</span><h2>Lead Card</h2></div><Badge>{lead ? "SELECTED" : "REQUIRED"}</Badge></div>{lead && <div className="lead-card-current"><img src={cardArtSource(lead, "thumbnail")} alt=""/><div><strong>{lead.displayName}</strong><span>{lead.type} · {lead.cost} Energy</span><p>This card represents the deck across My Decks, Play, Home, and Public Decks.</p></div></div>}<label>Choose from cards in this deck<select value={deck.leadCardId ?? deck.cardIds[0] ?? ""} onChange={(event) => commit({ ...deck, leadCardId: event.target.value })}><option value="">Select a Lead card</option>{grouped.map(({ card }) => <option value={card!.catalogId} key={card!.catalogId}>{card!.displayName}</option>)}</select></label></section><section className="panel selected-section"><h2>Bakugan Team ({deck.bakuganIds.length}/3)</h2>{deck.bakuganIds.map((key) => { const item = BAKUGAN.find((candidate) => candidate.id === key)!; return <button className="public-deck" key={key} onClick={() => toggleBakugan(key)}><img src={item.art} alt=""/><strong>{item.name}</strong><span>REMOVE</span></button>; })}</section><section className="panel selected-section"><h2>BakuCores ({deck.coreIds.length}/6)</h2>{deck.coreIds.map((key, index) => { const item = CORES.find((candidate) => candidate.id === key)!; return <button className="public-deck" key={`${key}-${index}`} onClick={() => adjustCore(key, -1)}><img src={item.art} alt=""/><strong>{item.name}</strong><span>REMOVE</span></button>; })}</section><section className="panel selected-section"><h2>Main Deck ({deck.cardIds.length}/40)</h2>{grouped.map(({ card, count }) => <article className={`public-deck ${deck.leadCardId === card!.catalogId ? "is-lead" : ""}`} key={card!.catalogId}><img src={cardArtSource(card!, "thumbnail")} alt=""/><strong>{count}× {card!.displayName}</strong><span>{card!.type} · {card!.cost} Energy</span><button aria-label={`Remove ${card!.displayName}`} onClick={() => adjustCard(card!.catalogId, -1)}>−</button><button aria-label={`Add ${card!.displayName}`} onClick={() => adjustCard(card!.catalogId, 1)}>+</button></article>)}</section></main>
    </div><footer className="builder-mobile-status">{deck.cardIds.length}/40 cards · {deck.bakuganIds.length}/3 Bakugan · {deck.coreIds.length}/6 Cores · {errors.length ? `${errors.length} issues` : "Legal"}</footer></section>;
}

function MissingDeck({ id, publicDeck = false }: { id: string; publicDeck?: boolean }) {
  return <section className="empty-page"><img src="/assets/logo.png" alt=""/><h1>DECK NOT FOUND</h1><p>No {publicDeck ? "public" : "device-local"} deck matches <code>{id}</code>.</p><Link className="hex-button ghost" href={publicDeck ? "/decks/public" : "/decks"}>RETURN TO {publicDeck ? "PUBLIC DECKS" : "MY DECKS"}</Link></section>;
}
