"use client";

import {useEffect,useRef,useState} from "react";
import {useLobbySession} from "../application/LobbySessionProvider";
import {useLobbyChat} from "../application/LobbyChatProvider";
import {LobbyChatPanel} from "../application/LobbyChatPanel";
import {useAppFields} from "../application/AppProvider";
import {ProfileAvatar} from "../profile/ProfileAvatar";
import {LucideIcon} from "../design-system/LucideIcon";
import {LOBBY_METAS,metaName} from "../../lib/meta-formats";
import {LobbyDeckArtwork,LobbyDeckDetails,LobbyDeckPicker,LobbyModal} from "./LobbyDeckPicker";
import styles from "./ManagedLobby.module.css";

const formatNames={standard:"Standard",singleton:"Singleton",competitive:"Competitive"};
const modes={training:"Training",casual:"Casual",ranked:"Ranked"};
function useWideLobby(){
  const [wide,setWide]=useState(false);
  useEffect(()=>{
    const query=window.matchMedia("(min-width: 1200px)"),update=()=>setWide(query.matches);
    update();query.addEventListener("change",update);return ()=>query.removeEventListener("change",update);
  },[]);
  return wide;
}
function ChatIcon(){return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4V5ZM8 9h8M8 12h5"/></svg>;}
function CopyIcon(){return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12"/><path d="M16 8V4H4v12h4"/></svg>;}

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
    <div className={styles.slots} data-hidden={hidden?"true":"false"}>
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
function RuleField({label,value,editable,children,onChange}){
  return <label className={styles.ruleField}><span>{label}</span>{editable?
    <select value={value} aria-label={label} onChange={event=>onChange(event.target.value)}>{children}</select>:
    <span className={styles.ruleValue}>{value}</span>}</label>;
}
export function ManagedLobby(){
  const session=useLobbySession(),chat=useLobbyChat(),{decks,profile}=useAppFields(["decks","profile"]);
  const r=session.recovery,room=r.lobby,p=r.preparation;
  const own=p?.seats.find(s=>s.own),active=Boolean(room?.currentSeriesId),host=room?.hostMemberId===r.membership?.id;
  const [picker,setPicker]=useState(null),[chatOpen,setChatOpen]=useState(false),[localError,setLocalError]=useState(""),[copyState,setCopyState]=useState(""),[pending,setPending]=useState(null);
  const wide=useWideLobby(),syncKey=useRef(""),copyTimer=useRef(null),inFlight=useRef(false),startId=useRef(null);
  useEffect(()=>{
    if(!room||!p||active||syncKey.current===room.id)return;
    syncKey.current=room.id;
    void session.command({action:"sync-preparation",membershipId:r.membership.id}).catch(()=>{});
  },[room?.id,Boolean(p),active]);
  useEffect(()=>{setPicker(null);setChatOpen(false);setLocalError("");setCopyState("");startId.current=null;},[r.membership?.id]);
  useEffect(()=>{if(active)setPicker(null);},[active]);
  useEffect(()=>{if(wide)setChatOpen(false);},[wide]);
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
  const canEdit=host&&!active&&room.mode!=="ranked"&&!busy;
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
          <button type="button" className={styles.code} onClick={()=>void copy()} aria-label={`Copy room code ${room.code}`}><span>{room.code}</span><CopyIcon/></button>
          <button type="button" className={styles.iconButton} aria-label="Copy invitation link" title="Copy invitation link" onClick={()=>void copy(true)}><LucideIcon name="link" size={18}/></button>
          <span className={styles.copyStatus} role="status">{copyState}</span>
        </div>}
      </div>
      <button type="button" className={styles.leave} disabled={busy} onClick={leave}>Leave lobby</button>
    </header>
    <div className={styles.settings}>
      <RuleField label="Structure" value={configuration.structure==="bo3"?"Best of Three":"Best of One"}/>
      <RuleField label="Format" value={canEdit?configuration.format:formatNames[configuration.format]} editable={canEdit} onChange={format=>updateSettings({format})}>
        <option value="standard">Standard</option><option value="singleton">Singleton</option>
      </RuleField>
      <RuleField label="Meta" value={canEdit?configuration.meta:metaName(configuration.meta)} editable={canEdit} onChange={meta=>updateSettings({meta})}>
        {LOBBY_METAS.map(meta=><option key={meta.id} value={meta.id}>{meta.name}</option>)}
      </RuleField>
    </div>
    <div className={styles.workspace}>
      <div className={styles.preparation}>
        <div className={styles.seats}>
          <BrawlerSeat seat={own} own mode={room.mode} count={count} active={active} busy={busy} avatar={profile?.avatar}
            onEdit={index=>{setLocalError("");setPicker(index);}} onReady={()=>void send("set-ready",{ready:!own.ready})} readyDisabled={readyDisabled}/>
          <BrawlerSeat seat={opponent} mode={room.mode} count={count} active={active} busy={busy} ai={room.mode==="training"} onSync={()=>void send("sync-preparation")}/>
        </div>
        <div className={styles.feedback} role="status">{localError||session.error||""}</div>
        <div className={styles.actionBar}>
          {!wide&&<button type="button" className={styles.chatButton} aria-label={chat.unread?`Open chat, ${chat.unread} unread`:"Open chat"} onClick={()=>setChatOpen(true)}><ChatIcon/> Chat{chat.unread>0&&<span className={styles.unreadDot}/>}</button>}
          <span className={styles.actionStatus}>{active?"Series in progress":host?"": "Waiting for host"}</span>
          {active?<button className={styles.start} type="button" onClick={session.returnToGame}>Return to Game</button>:
            host?<button className={styles.start} type="button" disabled={busy||!p.canStart} onClick={()=>void start()}>{pending==="start-series"?"Starting…":"Start Game"}</button>:<span className={styles.guestAction} aria-hidden="true"/>}
        </div>
      </div>
      {wide&&<aside className={styles.chatColumn}><LobbyChatPanel systemOnly={room.mode==="training"}/></aside>}
    </div>
    {picker!==null&&!active&&<LobbyDeckPicker decks={decks??[]} committed={own.decks} configuration={configuration} ruleset={p.ruleset} mode={room.mode}
      limit={count} slot={picker} busy={busy} error={localError} onCancel={()=>{setPicker(null);setLocalError("");}}
      onConfirm={async selected=>{if(await send("select-decks",{decks:selected}))setPicker(null);}}/>}
    {!wide&&chatOpen&&<LobbyModal className={styles.chatModal} labelledBy="lobby-chat-title" onCancel={()=>setChatOpen(false)}>
      <div className={styles.modalContent}><header className={styles.modalHeader}><h2 id="lobby-chat-title">CHAT</h2><button type="button" className={styles.iconButton} aria-label="Close chat" onClick={()=>setChatOpen(false)}><LucideIcon name="x"/></button></header>
        <div className={styles.chatModalBody}><LobbyChatPanel showHeader={false} systemOnly={room.mode==="training"}/></div>
      </div>
    </LobbyModal>}
  </section>;
}
