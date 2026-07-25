"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BAKUGAN, CARD_BY_ID, CARDS, CORES, STARTER_DECKS, deckErrors, deckIsLegal, type DeckRecord } from "../../lib/data";
import { cardArtSource } from "../../lib/content/card-art";
import { DECK_LIMIT, decodeDeckCode, deckTextList, encodeDeckCode, uniqueDeckName } from "../../lib/deck-transfer";
import { useApp } from "../application/AppProvider";
import { AppButton, Badge, PageHeader, copyText, downloadTextFile, factionClass, formatTimestamp } from "../application/ui";

const clone = (deck: DeckRecord): DeckRecord => ({ ...deck, factions: [...deck.factions], bakuganIds: [...deck.bakuganIds], coreIds: [...deck.coreIds], cardIds: [...deck.cardIds], tags: [...(deck.tags ?? [])] });
const blankDraft = (decks: DeckRecord[]): DeckRecord => ({ ...clone(STARTER_DECKS[0]), id: crypto.randomUUID?.() ?? `deck-${Date.now().toString(36)}`, name: uniqueDeckName("Untitled Battle Deck", decks), cardIds: [], updatedAt: new Date().toISOString(), visibility: "Private", revision: 1 });

export function DeckLibraryScreen() {
  const router = useRouter();
  const { decks, setDecks, deckQuery, setDeckQuery, selectedDeckId, setSelectedDeckId, setBuilderDeck, notify } = useApp();
  const [faction, setFaction] = useState("All");
  const [legality, setLegality] = useState("All");
  const [importCode, setImportCode] = useState("");
  const [importError, setImportError] = useState("");
  useEffect(() => {
    if (decks.length) return;
    const starters = STARTER_DECKS.map(clone);
    setDecks(starters);
    setSelectedDeckId(starters[0].id);
  }, [decks.length, setDecks, setSelectedDeckId]);
  const visible = useMemo(() => decks.filter((deck: DeckRecord) => {
    const text = `${deck.name} ${deck.factions.join(" ")} ${deck.tags?.join(" ") ?? ""}`.toLowerCase();
    const queryMatch = !deckQuery.trim() || text.includes(deckQuery.trim().toLowerCase());
    const factionMatch = faction === "All" || deck.factions.includes(faction);
    const legal = deckIsLegal(deck);
    return queryMatch && factionMatch && (legality === "All" || (legality === "Legal" ? legal : !legal));
  }).sort((a: DeckRecord, b: DeckRecord) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), [deckQuery, decks, faction, legality]);
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
      setDecks((items: DeckRecord[]) => [imported, ...items]);
      setSelectedDeckId(imported.id);
      setImportCode(""); setImportError(""); notify(`Imported ${imported.name}.`);
    } catch (error) { setImportError(error instanceof Error ? error.message : "Invalid deck code."); }
  };
  return <>
    <PageHeader eyebrow="DECK MANAGEMENT" title="DECK LIBRARY" copy="Each deck now has a real, shareable route. Catalogue code is downloaded only when deck-oriented routes are opened." art="/assets/pyrus.png" actions={<AppButton tone="red" onClick={create}>+ CREATE DECK</AppButton>} />
    <section className="toolbar deck-toolbar"><label className="search-box">⌕<input value={deckQuery} onChange={(event) => setDeckQuery(event.target.value)} placeholder="Search decks…" /></label><Badge>{decks.length} / {DECK_LIMIT}</Badge><label>FACTION<select value={faction} onChange={(event) => setFaction(event.target.value)}><option>All</option>{["Aquos","Aurelus","Darkus","Haos","Pyrus","Ventus"].map((value) => <option key={value}>{value}</option>)}</select></label><label>LEGALITY<select value={legality} onChange={(event) => setLegality(event.target.value)}><option>All</option><option>Legal</option><option>Issues</option></select></label></section>
    <section className="panel import-panel"><div className="panel-heading"><div><span className="eyebrow">VERSIONED SHARE CODE</span><h2>IMPORT A DECK</h2></div></div><textarea value={importCode} onChange={(event) => setImportCode(event.target.value)} placeholder="BBP1.…" />{importError && <p className="error-message">{importError}</p>}<AppButton tone="ghost" disabled={!importCode.trim()} onClick={importDeck}>VALIDATE & IMPORT</AppButton></section>
    <section className="deck-grid">{visible.map((deck: DeckRecord) => { const legal = deckIsLegal(deck); const lead = BAKUGAN.find((item) => item.id === deck.bakuganIds[0]); return <article className={`deck-tile ${selectedDeckId === deck.id ? "selected" : ""}`} key={deck.id}><button className="deck-select-target" onClick={() => setSelectedDeckId(deck.id)}><div className={`deck-cover ${factionClass(deck.factions[0] ?? "Pyrus")}`}><img src={lead?.art ?? "/assets/brawlers-group.png"} alt="" /><span>{deck.visibility}</span><strong>{deck.name}</strong></div></button><div className="deck-meta"><Badge tone={legal ? "gold" : "red"}>{legal ? "LEGAL" : `${deckErrors(deck).length} ISSUES`}</Badge><p>{deck.cardIds.length} cards • {deck.bakuganIds.length} Bakugan • {deck.coreIds.length} Cores</p><small>Updated {formatTimestamp(deck.updatedAt)}</small></div><div className="tile-actions"><Link href={`/decks/${encodeURIComponent(deck.id)}`}>DETAILS</Link><Link href={`/builder/${encodeURIComponent(deck.id)}`}>EDIT</Link><button onClick={() => { const copy = { ...clone(deck), id: crypto.randomUUID(), name: uniqueDeckName(`${deck.name} Copy`, decks), visibility: "Private" as const, updatedAt: new Date().toISOString() }; setDecks((items: DeckRecord[]) => [copy, ...items]); }}>DUPLICATE</button><button onClick={() => setDecks((items: DeckRecord[]) => items.filter((item) => item.id !== deck.id))}>DELETE</button></div></article>; })}</section>
  </>;
}

export function DeckDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const { decks, setBuilderDeck, setSelectedDeckId, notify } = useApp();
  const deck = decks.find((item: DeckRecord) => item.id === id);
  if (!deck) return <MissingDeck id={id} />;
  const bakugan = deck.bakuganIds.map((key) => BAKUGAN.find((item) => item.id === key)).filter(Boolean);
  const cards = [...new Set(deck.cardIds)].map((key) => ({ card: CARD_BY_ID.get(key), count: deck.cardIds.filter((id) => id === key).length })).filter((entry) => entry.card);
  const errors = deckErrors(deck);
  return <>
    <PageHeader eyebrow="DECK RECORD" title={deck.name} copy={`${deck.format ?? "standard"} • ${deck.visibility} • updated ${formatTimestamp(deck.updatedAt)}`} art={bakugan[0]?.art ?? "/assets/brawlers-group.png"} actions={<><AppButton tone="red" onClick={() => { setBuilderDeck(clone(deck)); router.push(`/builder/${encodeURIComponent(deck.id)}`); }}>EDIT DECK</AppButton><AppButton tone="ghost" onClick={() => { setSelectedDeckId(deck.id); router.push("/play"); }}>USE FOR PLAY</AppButton></>} />
    <section className="deck-detail-layout"><article className="panel"><div className="panel-heading"><h2>VALIDATION</h2><Badge tone={errors.length ? "red" : "gold"}>{errors.length ? `${errors.length} ISSUES` : "LEGAL"}</Badge></div>{errors.length ? <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul> : <p>This deck satisfies the selected format’s construction rules.</p>}<div className="hero-actions"><AppButton tone="ghost" onClick={() => void copyText(encodeDeckCode(deck)).then(() => notify("Deck code copied."))}>COPY CODE</AppButton><AppButton tone="ghost" onClick={() => downloadTextFile(`${deck.name}.txt`, deckTextList(deck))}>TEXT LIST</AppButton></div></article><article className="panel"><h2>BAKUGAN TEAM</h2>{bakugan.map((item) => <div className="public-deck" key={item!.id}><img src={item!.art} alt="" /><strong>{item!.name}</strong><span>{item!.bPower}B • {item!.damage}D</span></div>)}</article><article className="panel"><h2>MAIN DECK</h2>{cards.map(({ card, count }) => <div className="public-deck" key={card!.catalogId}><strong>{count}× {card!.displayName}</strong><span>{card!.type} • {card!.faction} • {card!.cost} Energy</span></div>)}</article></section>
  </>;
}

export function DeckBuilderScreen({ id }: { id: string }) {
  const router = useRouter();
  const { decks, setDecks, builderDeck, setBuilderDeck, setSelectedDeckId, storageHealth, notify } = useApp();
  const source = id === "new" ? builderDeck : decks.find((item: DeckRecord) => item.id === id);
  const [deck, setDeck] = useState<DeckRecord>(() => clone(source ?? blankDraft(decks)));
  const [tab, setTab] = useState<"cards" | "bakugan" | "cores">("cards");
  const [query, setQuery] = useState("");
  const [faction, setFaction] = useState("All");
  const [type, setType] = useState("All");
  useEffect(() => { setBuilderDeck(deck); }, [deck, setBuilderDeck]);
  const commit = (next: DeckRecord) => setDeck({ ...next, factions: next.bakuganIds.map((key) => BAKUGAN.find((item) => item.id === key)?.faction).filter(Boolean) as string[] });
  const cards = CARDS.filter((card) => card.type !== "Character" && (!query || `${card.displayName} ${card.effect}`.toLowerCase().includes(query.toLowerCase())) && (faction === "All" || card.factions.includes(faction as never)) && (type === "All" || card.type === type)).slice(0, 160);
  const bakugan = BAKUGAN.filter((item) => (!query || item.name.toLowerCase().includes(query.toLowerCase())) && (faction === "All" || item.faction === faction));
  const cores = CORES.filter((item) => (!query || item.name.toLowerCase().includes(query.toLowerCase())) && (type === "All" || item.type === type));
  const adjustCard = (key: string, amount: number) => { const next = [...deck.cardIds]; if (amount > 0 && next.length < 40 && next.filter((id) => id === key).length < (deck.format === "singleton" ? 1 : 3)) next.push(key); if (amount < 0) { const index = next.lastIndexOf(key); if (index >= 0) next.splice(index, 1); } commit({ ...deck, cardIds: next }); };
  const toggleBakugan = (key: string) => commit({ ...deck, bakuganIds: deck.bakuganIds.includes(key) ? deck.bakuganIds.filter((id) => id !== key) : deck.bakuganIds.length < 3 ? [...deck.bakuganIds, key] : deck.bakuganIds });
  const adjustCore = (key: string, amount: number) => { const next = [...deck.coreIds]; if (amount > 0 && next.length < 6) next.push(key); if (amount < 0) { const index = next.lastIndexOf(key); if (index >= 0) next.splice(index, 1); } commit({ ...deck, coreIds: next }); };
  const save = () => { const next = { ...deck, id: id === "new" ? deck.id : id, updatedAt: new Date().toISOString(), revision: (deck.revision ?? 0) + 1 }; setDecks((items: DeckRecord[]) => [next, ...items.filter((item) => item.id !== next.id)]); setSelectedDeckId(next.id); setBuilderDeck(null); notify("Deck saved."); router.push(`/decks/${encodeURIComponent(next.id)}`); };
  const grouped = [...new Set(deck.cardIds)].map((key) => ({ card: CARD_BY_ID.get(key), count: deck.cardIds.filter((id) => id === key).length })).filter((entry) => entry.card);
  const errors = deckErrors(deck);
  return <section className="builder-page builder-v2"><header className="builder-header"><Link href="/decks">← DECK LIBRARY</Link><input value={deck.name} onChange={(event) => commit({ ...deck, name: event.target.value })} /><label>FORMAT<select value={deck.format ?? "standard"} onChange={(event) => commit({ ...deck, format: event.target.value as DeckRecord["format"] })}><option value="standard">Standard</option><option value="singleton">Singleton</option></select></label><Badge tone={errors.length ? "red" : "gold"}>{errors.length ? `${errors.length} ISSUES` : "LEGAL"}</Badge><span>{storageHealth.status === "error" ? "Draft not saved" : "Draft saved locally"}</span><AppButton tone="red" onClick={save}>SAVE DECK</AppButton></header><div className="builder-layout builder-equal-columns"><aside className="catalog panel builder-catalog-column"><div className="catalog-tabs"><button className={tab === "cards" ? "active" : ""} onClick={() => setTab("cards")}>CARDS</button><button className={tab === "bakugan" ? "active" : ""} onClick={() => setTab("bakugan")}>BAKUGAN</button><button className={tab === "cores" ? "active" : ""} onClick={() => setTab("cores")}>CORES</button></div><label className="catalog-search">SEARCH<input value={query} onChange={(event) => setQuery(event.target.value)} /></label><div className="catalog-filters">{tab !== "cores" && <label>FACTION<select value={faction} onChange={(event) => setFaction(event.target.value)}><option>All</option>{["Aquos","Aurelus","Darkus","Haos","Pyrus","Ventus"].map((value) => <option key={value}>{value}</option>)}</select></label>}{tab !== "bakugan" && <label>TYPE<select value={type} onChange={(event) => setType(event.target.value)}><option>All</option>{(tab === "cards" ? ["Action","Flip","Hero","Evo"] : ["Fist","Flaming Fist","Shield","Magic Shield","Helix"]).map((value) => <option key={value}>{value}</option>)}</select></label>}</div><div className={`catalog-results ${tab}`}>{tab === "cards" && cards.map((card) => <article className="catalog-piece" key={card.catalogId}><img src={cardArtSource(card, "thumbnail")} alt="" /><div><strong>{card.displayName}</strong><span>{card.type} • {card.faction} • {card.cost} Energy</span></div><button onClick={() => adjustCard(card.catalogId, 1)}>+ ADD</button></article>)}{tab === "bakugan" && bakugan.map((item) => <article className="catalog-piece" key={item.id}><img src={item.art} alt="" /><div><strong>{item.name}</strong><span>{item.faction} • {item.bPower}B</span></div><button onClick={() => toggleBakugan(item.id)}>{deck.bakuganIds.includes(item.id) ? "REMOVE" : "+ ADD"}</button></article>)}{tab === "cores" && cores.map((item) => <article className="catalog-piece" key={item.id}><img src={item.art} alt="" /><div><strong>{item.name}</strong><span>{item.type}</span></div><button onClick={() => adjustCore(item.id, 1)}>+ ADD</button></article>)}</div></aside><main className="deck-workspace builder-deck-column"><section className={`deck-validation-summary ${errors.length ? "illegal" : "legal"}`}><h2>{errors.length ? "DECK REQUIRES ATTENTION" : "READY FOR BATTLE"}</h2>{errors.length ? <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul> : <p>All construction checks pass.</p>}</section><section className="panel selected-section"><h2>BAKUGAN TEAM ({deck.bakuganIds.length}/3)</h2>{deck.bakuganIds.map((key) => { const item = BAKUGAN.find((candidate) => candidate.id === key)!; return <button className="public-deck" key={key} onClick={() => toggleBakugan(key)}><img src={item.art} alt="" /><strong>{item.name}</strong><span>REMOVE</span></button>; })}</section><section className="panel selected-section"><h2>BAKUCORES ({deck.coreIds.length}/6)</h2>{deck.coreIds.map((key, index) => { const item = CORES.find((candidate) => candidate.id === key)!; return <button className="public-deck" key={`${key}-${index}`} onClick={() => adjustCore(key, -1)}><img src={item.art} alt="" /><strong>{item.name}</strong><span>REMOVE</span></button>; })}</section><section className="panel selected-section"><h2>MAIN DECK ({deck.cardIds.length}/40)</h2>{grouped.map(({ card, count }) => <article className="public-deck" key={card!.catalogId}><strong>{count}× {card!.displayName}</strong><span>{card!.type} • {card!.cost} Energy</span><button onClick={() => adjustCard(card!.catalogId, -1)}>−</button><button onClick={() => adjustCard(card!.catalogId, 1)}>+</button></article>)}</section></main></div></section>;
}

function MissingDeck({ id }: { id: string }) {
  return <section className="empty-page"><img src="/assets/logo.png" alt="" /><h1>DECK NOT FOUND</h1><p>No device-local deck matches <code>{id}</code>.</p><Link className="hex-button ghost" href="/decks">RETURN TO DECK LIBRARY</Link></section>;
}
