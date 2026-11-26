"use client";

import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {useLobbySession} from "../application/LobbySessionProvider";
import {useAppFields} from "../application/AppProvider";
import {ProfileAvatar} from "../profile/ProfileAvatar";
import {LucideIcon} from "../design-system/LucideIcon";
import {LOBBY_METAS,metaName} from "../../lib/meta-formats";
import {LobbyDeckArtwork,LobbyDeckDetails,LobbyDeckPicker} from "./LobbyDeckPicker";
import { LobbyWorkspace } from "./LobbyWorkspace";
import styles from "./ManagedLobby.module.css";

const formatNames={standard:"Standard",singleton:"Singleton",competitive:"Competitive"};
const modes={training:"Training",casual:"Casual",ranked:"Ranked"};
function DeckSlot({deck,hidden=false,selected=false,editable=false,onEdit,problem,disabled,slot,compact=false}){
  const contents=deck?<><LobbyDeckArtwork deck={deck}/><LobbyDeckDetails deck={deck} problem={problem}/></>:
    <><div className={styles.placeholderArt}><LucideIcon name={hidden&&selected?"lock":editable?"plus":"rectangle-vertical"} size={26}/></div>
      <div className={styles.deckDetails}><strong className={styles.deckName}>{hidden&&selected?"Hidden deck":editable?"Select deck":"Empty deck slot"}</strong>
        <span className={styles.deckSet}>{hidden&&selected?"Selected":editable?"Choose from My Decks":"Not selected"}</span></div></>;
  const className=`${styles.slot} ${compact?styles.compactSlot:""}`;
  return editable?<button type="button" className={className} disabled={disabled} onClick={onEdit} aria-label={`${deck?"Change":"Select"} deck ${slot+1}${deck?`: ${deck.name}`:""}`}>
    {contents}<span className={styles.change}>{deck?"Change deck":<LucideIcon name="chevron-right" size={18}/>}</span>
  </button>:<div className={className}>{contents}</div>;
}

function BrawlerSeat({seat,mode,count,own=false,ai=false,active,busy,onEdit,onReady,readyDisabled,onSync,avatar}){
  const missing=!seat,hidden=mode==="ranked"&&!own;
  const connected=ai||Boolean(seat?.connected),ready=Boolean(seat?.ready);
  const status=missing?"Waiting for opponent":!connected?"Disconnected":active?"Series in progress":ready?"Ready":ai?"No compatible AI deck":"Not ready";
  const name=missing?"Opponent":seat.name;
  return <section className={styles.seat} data-seat={own?"local":"opponent"} data-mode={mode} aria-label={own?"Your seat":ai?"Training AI":"Opponent seat"}>
    <header className={styles.identity}>
      {ai?<span className={styles.avatar}><LucideIcon name="bot" size={25}/></span>:missing?<span className={styles.avatar}><LucideIcon name="plus" size={22}/></span>:<ProfileAvatar profile={{name,avatar:avatar??""}} className={styles.avatar}/>}
      <div className={styles.identityText}><h2 title={name}>{name}</h2><span>{ai?"Training AI":missing?"Open seat":own?"You":seat.host?"Host":"Brawler"}{own&&seat.host?" · Host":""}</span></div>
      <div className={styles.status} data-ready={!active&&ready&&connected?"true":"false"}><span className={styles.statusDot}/><span>{status}</span></div>
    </header>
    <div className={styles.deckHeader}><span>{count===1?"Deck":"Decks"}</span><span>{ai?"Automatically assigned":count>1?`${seat?.deckCount??0}/${count} selected`:""}</span></div>
    <div className={styles.slots}>
      {Array.from({length:count},(_,index)=><DeckSlot key={index} slot={index} compact={count>1}
        deck={hidden?null:seat?.decks?.[index]} hidden={hidden} selected={index<(seat?.deckCount??0)}
        editable={own&&!active} disabled={busy} onEdit={()=>onEdit(index)} problem={own?seat?.deckProblems?.[index]:null}/>)}
    </div>
    <footer className={styles.seatFooter}>
      {own?<><span className={styles.seatHint}>{active?"Decks locked for this series":seat?.problem&&seat.deckCount>0?seat.problem:""}</span>
        <button type="button" className={styles.readyButton} data-ready={ready?"true":"false"} disabled={busy||active||readyDisabled} onClick={onReady}>{ready?"Unready":"Ready"}</button></>:
        ai&&!seat?.ready&&!active?<><span className={styles.seatHint}>Automatic assignment unavailable</span><button type="button" className={styles.textButton} disabled={busy} onClick={onSync}>Retry assignment</button></>:
        <span className={styles.seatHint}>{missing?"Share the room code to invite a Brawler.":ai?"AI deck selected automatically":hidden?"Opponent deck choices are hidden.":""}</span>}
    </footer>
  </section>;
}
function RuleField({label,value,editable,children,onChange,disabled=false}){
  return <label className={styles.ruleField}><span>{label}</span>{editable?
    <select value={value} disabled={disabled} aria-label={label} onChange={event=>onChange(event.target.value)}>{children}</select>:
    <span className={styles.ruleValue}>{value}</span>}</label>;
}
export function ManagedLobby(){
  const session=useLobbySession(),{decks,profile}=useAppFields(["decks","profile"]);
  const r=session.recovery,room=r.lobby,p=r.preparation;
  const own=p?.seats.find(s=>s.own),active=Boolean(room?.currentSeriesId),host=room?.hostMemberId===r.membership?.id;
  const [picker,setPicker]=useState(null),[localError,setLocalError]=useState(""),[copyState,setCopyState]=useState(""),[pending,setPending]=useState(null);
  const syncKey=useRef(""),copyTimer=useRef(null),inFlight=useRef(false),startId=useRef(null);
  useEffect(()=>{
    if(!room||!p||active)return;
    const key=`${r.membership.id}:${room.previousSeriesId??"initial"}`;
    if(syncKey.current===key)return;
    syncKey.current=key;
    void session.command({action:"sync-preparation",membershipId:r.membership.id}).catch(()=>{});
  },[r.membership?.id,room?.previousSeriesId,Boolean(p),active]);
  useEffect(()=>{setPicker(null);setLocalError("");setCopyState("");startId.current=null;},[r.membership?.id]);
  useEffect(()=>{if(active)setPicker(null);},[active]);
  useEffect(()=>()=>clearTimeout(copyTimer.current),[]);
  if(!room||!p||!own)return <section className={styles.lobby}><h1>RESTORING LOBBY</h1><button className={styles.secondary} onClick={()=>void session.refresh()}>Refresh</button></section>;
  const busy=session.busy||Boolean(pending)||session.unavailable;
  const send=async(action,extra={})=>{
    if(inFlight.current)return null;
    inFlight.current=true;setPending(action);setLocalError("");
    try{return await session.command({action,membershipId:r.membership.id,expectedVersion:p.version,...extra});}
    catch(cause){setLocalError(cause instanceof Error?cause.message:"Lobby command failed.");return null;}
    finally{inFlight.current=false;setPending(null);}
  };
  const configuration=p.configuration,count=p.requiredDeckCount;
  const opponent=room.mode==="training"?{name:p.ai?.name??"Mira Nova",connected:true,ready:p.ai?.ready,deckCount:p.ai?.deck?1:0,decks:p.ai?.deck?[p.ai.deck]:[]}:p.seats.find(s=>!s.own);
  const canEdit=host&&!active&&room.mode!=="ranked";
  const updateSettings=patch=>void send("update-settings",{...configuration,...patch});
  const copy=async(invitation=false)=>{
    try{
      await navigator.clipboard.writeText(invitation?new URL("/play?join="+encodeURIComponent(room.code),window.location.origin).href:room.code);
      setCopyState(invitation?"Link copied":"Code copied");
      clearTimeout(copyTimer.current);copyTimer.current=setTimeout(()=>setCopyState(""),1800);
    }catch{setLocalError("Could not copy invitation.");}
  };
  const leave=()=>{if(window.confirm(active?"Leave the lobby and forfeit or abandon the active series?":"Leave this lobby?"))void send("leave");};
  const start=async()=>{
    // Reuse a start ID after an uncertain response, but not after a
    // confirmed launch or a different preparation version.
    if(!startId.current||startId.current.version!==p.version)startId.current={version:p.version,id:crypto.randomUUID()};
    if(await send("start-series",{commandId:startId.current.id}))startId.current=null;
  };
  const readyDisabled=!own.ready&&(!own.connected||Boolean(own.problem)||(room.mode==="training"&&!p.ai?.ready)||(room.mode==="ranked"&&!p.ruleset));
  return <section className={styles.lobby} data-mode={room.mode}>
    <header className={styles.heading}>
      <div className={styles.titleGroup}><h1>{modes[room.mode].toUpperCase()} LOBBY</h1>
        {room.mode!=="training"&&<div className={styles.invitation}>
          <button type="button" className={styles.code} onClick={()=>void copy()} aria-label={`Copy room code ${room.code}`}><span>{room.code}</span><LucideIcon name="copy" size={17}/></button>
          <button type="button" className={styles.iconButton} aria-label="Copy invitation link" title="Copy invitation link" onClick={()=>void copy(true)}><LucideIcon name="link" size={18}/></button>
          <span className={styles.copyStatus} role="status">{copyState}</span>
        </div>}
      </div>
      <button type="button" className={styles.leave} disabled={busy} onClick={leave}>Leave lobby</button>
    </header>
    <div className={styles.settings}>
      <RuleField label="Structure" value={configuration.structure==="bo3"?"Best of Three":"Best of One"}/>
      <RuleField label="Format" value={canEdit?configuration.format:formatNames[configuration.format]} editable={canEdit} disabled={busy} onChange={format=>updateSettings({format})}>
        <option value="standard">Standard</option><option value="singleton">Singleton</option>
      </RuleField>
      <RuleField label="Meta" value={canEdit?configuration.meta:metaName(configuration.meta)} editable={canEdit} disabled={busy} onChange={meta=>updateSettings({meta})}>
        {LOBBY_METAS.map(meta=><option key={meta.id} value={meta.id}>{meta.name}</option>)}
      </RuleField>
    </div>
    <LobbyWorkspace systemOnly={room.mode==="training"} actions={<>
      {!active&&room.previousSeriesId&&<Link className={styles.resultLink} href="/play/result">Last result</Link>}
      {active?<button className={styles.start} type="button" onClick={session.returnToGame}>Return to Game</button>:
        host?<button className={styles.start} type="button" disabled={busy||!p.canStart} onClick={()=>void start()}>{pending==="start-series"?"Starting…":"Start Game"}</button>:<span className={styles.guestAction}>Waiting for host</span>}
    </>}>
        <div className={styles.seats}>
          <BrawlerSeat seat={own} own mode={room.mode} count={count} active={active} busy={busy} avatar={profile?.avatar}
            onEdit={index=>{setLocalError("");setPicker(index);}} onReady={()=>void send("set-ready",{ready:!own.ready})} readyDisabled={readyDisabled}/>
          <BrawlerSeat seat={opponent} mode={room.mode} count={count} active={active} busy={busy} ai={room.mode==="training"} onSync={()=>void send("sync-preparation")}/>
        </div>
        <div className={styles.feedback} role="status">{localError||session.error||""}</div>
    </LobbyWorkspace>
    {picker!==null&&!active&&<LobbyDeckPicker decks={decks??[]} committed={own.decks} configuration={configuration} ruleset={p.ruleset} mode={room.mode}
      limit={count} slot={picker} busy={busy} error={localError} onCancel={()=>{setPicker(null);setLocalError("");}}
      onConfirm={async selected=>{if(await send("select-decks",{decks:selected}))setPicker(null);}}/>}
  </section>;
}
