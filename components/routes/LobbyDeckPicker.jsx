"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import Link from "next/link";
import {DeckPreview} from "./DeckGalleryCard";
import {OriginalImage} from "../media/OriginalImage";
import {LucideIcon} from "../design-system/LucideIcon";
import {FACTIONS,FACTION_SYMBOLS} from "../../lib/card-filters";
import {deckSetCode,deckSetName} from "../../lib/deck-set";
import {CARD_SET_CODES} from "../../lib/content/catalogue";
import {proposedDeckSelection,sameDeckSelection} from "../../lib/lobby-picker-state";
import {deckProblem,rosterProblem} from "../../lib/lobby-preparation";
import styles from "./ManagedLobby.module.css";

export function LobbyDeckArtwork({deck}){
  // Projected opponent previews intentionally omit cardIds. Supply only the
  // already-public featured card to the shared gallery artwork renderer.
  const artwork={...deck,cardIds:deck.cardIds?.length ? deck.cardIds : (deck.leadCardId ? [deck.leadCardId] : [])};
  return <div className={styles.artwork}><DeckPreview deck={artwork}/></div>;
}
export function LobbyDeckDetails({deck,problem}){
  const factions=[...new Set(deck.factions??[])];
  return <div className={styles.deckDetails}>
    <strong className={styles.deckName} title={deck.name}>{deck.name}</strong>
    <div className={styles.factions} aria-label={`Factions: ${factions.join(", ")}`}>
      {factions.map(faction=>FACTION_SYMBOLS[faction]?<OriginalImage key={faction} src={FACTION_SYMBOLS[faction]} alt={faction} title={faction} loading="lazy"/>:null)}
    </div>
    <span className={styles.deckSet}>{deck.setName??deckSetName(deck)}</span>
    {problem&&<span className={styles.problem}>{problem}</span>}
  </div>;
}

/** Native modal provides focus containment, Escape handling, and inert
 * background. On close the caller's deck slot regains keyboard focus. */
export function LobbyModal({children,className,onCancel,labelledBy}){
  const ref=useRef(null),cancelRef=useRef(onCancel);
  cancelRef.current=onCancel;
  useEffect(()=>{
    const dialog=ref.current,previous=document.activeElement,oldOverflow=document.body.style.overflow;
    if(!dialog)return;
    dialog.showModal();
    document.body.style.overflow="hidden";
    return ()=>{
      if(dialog.open)dialog.close();
      document.body.style.overflow=oldOverflow;
      if(previous instanceof HTMLElement&&previous.isConnected)previous.focus({preventScroll:true});
    };
  },[]);
  return <dialog ref={ref} className={className} aria-labelledby={labelledBy}
    onCancel={event=>{event.preventDefault();cancelRef.current();}}
    onClick={event=>{if(event.target===event.currentTarget)cancelRef.current();}}>
    {children}
  </dialog>;
}
const deckSignature=deck=>JSON.stringify([deck.id,deck.name,deck.format,deck.bakuganIds,deck.coreIds,deck.cardIds,deck.leadCardId,deck.printingPreferences]);
const setIndex=deck=>CARD_SET_CODES.indexOf(deckSetCode(deck));
const sortDecks=(a,b,sort)=>sort==="name"?a.name.localeCompare(b.name):
  sort==="set"?setIndex(b)-setIndex(a)||a.name.localeCompare(b.name):
  (Date.parse(b.updatedAt)||0)-(Date.parse(a.updatedAt)||0)||a.name.localeCompare(b.name);

export function LobbyDeckPicker({decks,committed,configuration,ruleset,mode,limit,slot,onCancel,onConfirm,busy,error}){
  const [draft,setDraft]=useState(()=>[...committed]),[query,setQuery]=useState(""),[faction,setFaction]=useState("all"),
    [sort,setSort]=useState("updated"),[favourites,setFavourites]=useState(false),[showIncompatible,setShowIncompatible]=useState(false);
  const original=useRef([...committed]),[replacement,setReplacement]=useState(committed[slot]?.id??null);
  const changed=!sameDeckSelection(draft,original.current,deckSignature);
  const stale=!sameDeckSelection(committed,original.current,deckSignature);
  const ruleUnavailable=mode==="ranked"&&!ruleset;
  const problem=ruleUnavailable?"Rules unavailable":rosterProblem(draft,mode,configuration,ruleset,false);
  const choices=useMemo(()=>{
    const saved=new Map(decks.map(deck=>[deck.id,deck]));
    // Selected immutable snapshots take precedence over a later edit to the
    // same saved deck. Deselect to choose its new saved version.
    for(const deck of draft)saved.set(deck.id,deck);
    return [...saved.values()].map(deck=>{
      const selected=draft.some(d=>d.id===deck.id);
      const candidate=proposedDeckSelection(draft,deck,limit,replacement);
      const invalid=ruleUnavailable?"Rules unavailable":deckProblem(deck,configuration,ruleset);
      const duplicate=!selected&&!invalid&&candidate!==null&&rosterProblem(candidate,mode,configuration,ruleset,false)==="Already selected";
      return {deck,selected,problem:invalid||(duplicate?"Already selected":null),full:!selected&&candidate===null};
    }).sort((a,b)=>sortDecks(a.deck,b.deck,sort));
  },[decks,draft,replacement,configuration,ruleset,mode,limit,sort,ruleUnavailable]);
  const visible=choices.filter(({deck,selected,problem})=>
    (selected||showIncompatible||!problem)&&(!query.trim()||deck.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))&&
    (faction==="all"||deck.factions?.includes(faction))&&(!favourites||deck.favourite||decks.some(saved=>saved.id===deck.id&&saved.favourite)));
  const choose=({deck,selected,problem,full})=>{
    if(busy||stale)return;
    if(!selected&&(problem||full))return;
    setDraft(old=>proposedDeckSelection(old,deck,limit,replacement)??old);
    if(replacement&&(!selected||replacement===deck.id))setReplacement(null);
  };
  return <LobbyModal className={styles.picker} onCancel={()=>{if(!busy)onCancel();}} labelledBy="lobby-picker-title">
    <div className={styles.modalContent}>
      <header className={styles.modalHeader}>
        <div><h2 id="lobby-picker-title">{limit===1?"SELECT DECK":"SELECT DECKS"}</h2><p>{draft.length}/{limit} selected{replacement&&limit>1?" · Choose a replacement":""}</p></div>
        <button type="button" className={styles.iconButton} aria-label="Close deck selection" disabled={busy} onClick={onCancel}><LucideIcon name="x"/></button>
      </header>
      <div className={styles.pickerTools}>
        <label className={styles.search}><LucideIcon name="search" size={18}/><input autoFocus aria-label="Search decks" placeholder="Search decks…" value={query} onChange={event=>setQuery(event.target.value)}/></label>
        <select aria-label="Filter by faction" value={faction} onChange={event=>setFaction(event.target.value)}><option value="all">All factions</option>{FACTIONS.map(value=><option key={value} value={value}>{value}</option>)}</select>
        <select aria-label="Sort decks" value={sort} onChange={event=>setSort(event.target.value)}><option value="updated">Recently updated</option><option value="name">Name</option><option value="set">Latest set</option></select>
        <div className={styles.filters}>
          <label><input type="checkbox" checked={favourites} onChange={event=>setFavourites(event.target.checked)}/>Favourites</label>
          <label><input type="checkbox" checked={showIncompatible} onChange={event=>setShowIncompatible(event.target.checked)}/>Show incompatible</label>
        </div>
      </div>
      <div className={styles.galleryScroll}>
        {visible.length?<div className={styles.gallery}>
          {visible.map(choice=><button type="button" key={choice.deck.id} className={styles.choice} aria-pressed={choice.selected}
            disabled={busy||stale||(!choice.selected&&Boolean(choice.problem||choice.full))}
            onClick={()=>choose(choice)} aria-label={`${choice.deck.name}${choice.problem?`, ${choice.problem}`:""}`}>
            <LobbyDeckArtwork deck={choice.deck}/><LobbyDeckDetails deck={choice.deck} problem={choice.problem}/>
            <span className={styles.choiceCheck}>{choice.selected&&<LucideIcon name="check" size={20}/>}</span>
          </button>)}
        </div>:<div className={styles.emptyGallery}><strong>{choices.some(c=>!c.problem)?"No matching decks":"No compatible decks"}</strong>
          <p>{choices.some(c=>!c.problem)?"Try changing your search or filters.":"Create or update a deck for this lobby’s format and meta."}</p>
          <Link href="/decks">My Decks</Link>
        </div>}
      </div>
      <footer className={styles.modalFooter}>
        <div className={styles.pickerStatus} role="status">{stale?"Your selection changed elsewhere. Reopen the picker.":error||problem|| (limit>1&&draft.length<limit?"Choose three decks before readying.":"")}</div>
        <div className={styles.footerButtons}><button type="button" className={styles.secondary} disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="button" className={styles.confirm} disabled={busy||stale||!changed||Boolean(problem)} onClick={()=>void onConfirm(draft)}>{busy?"Saving…":"Confirm"}</button></div>
      </footer>
    </div>
  </LobbyModal>;
}
