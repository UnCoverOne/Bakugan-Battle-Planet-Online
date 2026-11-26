"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {usePathname,useRouter} from "next/navigation";
import {useLobbySession} from "../application/LobbySessionProvider";
import {useAppFields} from "../application/AppProvider";
import {lobbyRouteDecision} from "../../lib/lobby-client-routing";
import {isCompletedSeriesResult} from "../../lib/match-result-navigation";
import {deckProblem} from "../../lib/lobby-preparation";
import {LOBBY_METAS} from "../../lib/meta-formats";
import {eligibleRankedDecks,rankedSeries} from "../../lib/ranked-lobby";
import {lobbyCanStart} from "../../lib/lobby";
import {dispatchLocalGameAction} from "../../lib/engine/local-command-dispatcher";
import {matchCommandHeaders,readMatchStore,publishMatch,useMatchSelector,useMatchTransport} from "../game-screen-v2/matchStore";
import styles from "./PersistentPlayRoutes.module.css";

function Status({title,children}){return <section className={styles.screen}><h1>{title}</h1>{children}</section>;}
const Button=({children,...props})=><button type="button" className="bb-button" {...props}>{children}</button>;
function IdentityConflict(){
  const session=useLobbySession(),r=session.recovery;
  const resolve=async(action,member,scope)=>{
    if(!member)return;
    if(action==="leave"&&!window.confirm("Leave this lobby? An ongoing online series will be forfeited."))return;
    try{await session.command({action,membershipId:member.id,scope});}catch{}
  };
  return <Status title="Resolve lobby membership"><p>Your account and guest browser have overlapping session credentials. Neither membership will be discarded automatically.</p>
    {r.account&&<p>Account lobby: {r.accountLobby?.code} <Button disabled={session.busy} onClick={()=>void resolve("leave",r.account,"account")}>Leave account lobby</Button></p>}
    {r.guest&&<p>Guest lobby: {r.guestLobby?.code} <Button disabled={session.busy} onClick={()=>void resolve("leave",r.guest,"guest")}>Leave guest lobby</Button></p>}
    {!r.account&&r.guest&&<Button disabled={session.busy} onClick={()=>void resolve("adopt-guest",r.guest,"guest")}>Transfer guest lobby to account</Button>}
    {session.error&&<p role="alert">{session.error}</p>}<Button onClick={()=>void session.refresh()}>Refresh</Button>
  </Status>;
}
export function PersistentPlayGuard({children}){
  const session=useLobbySession(),router=useRouter(),pathname=usePathname();
  const {match}=useAppFields(["match"]);
  const r=session.recovery;
  const completedHere=r.status==="member"&&pathname==="/play/match"&&match?.id===r.lobby.previousSeriesId&&isCompletedSeriesResult(match);
  const decision=session.enabled?lobbyRouteDecision(pathname,session.unavailable?"unavailable":r.status,r.status==="member",r.status==="member"&&Boolean(r.lobby.currentSeriesId||completedHere)):"allow";
  useEffect(()=>{if(decision.startsWith("/"))router.replace(decision);},[decision,router]);
  if(!session.enabled)return children;
  if(r.status==="identity-conflict")return <IdentityConflict/>;
  if(decision==="block"){
    // An already authenticated active runtime may survive a temporary poll
    // outage; do not unlock admission or start a fresh claim from stale data.
    if(pathname==="/play/match"&&r.status==="member"&&match?.id===r.lobby.currentSeriesId&&session.claimedSeries===match.id)return <>{children}</>;
    return <Status title={session.unavailable?"Lobby unavailable":"Checking lobby membership"}><p>{session.error||"Recovering your current lobby."}</p>{session.unavailable&&<Button onClick={()=>void session.refresh()}>Retry</Button>}</Status>;
  }
  if(decision!=="allow")return <Status title="Opening your lobby"/>;
  return children;
}
export function PersistentLobbyRoute({legacy}){
  const session=useLobbySession();
  return <PersistentPlayGuard>{session.enabled?<ManagedLobby/>:legacy}</PersistentPlayGuard>;
}
function ManagedLobby(){
  const session=useLobbySession(),{decks}=useAppFields(["decks"]);
  const r=session.recovery,room=r.lobby,p=r.preparation;
  const [editing,setEditing]=useState(false),[draft,setDraft]=useState([]),[localError,setLocalError]=useState("");
  const syncKey=useRef("");
  const version=p?.version;
  const own=p?.seats.find(s=>s.own),active=Boolean(room?.currentSeriesId),host=room?.hostMemberId===r.membership?.id;
  useEffect(()=>{
    if(!room||!p||active||syncKey.current===room.id)return;
    syncKey.current=room.id;
    void session.command({action:"sync-preparation",membershipId:r.membership.id}).catch(()=>{});
  },[room?.id,Boolean(p),active]);
  if(!room||!p||!own)return <Status title="Restoring lobby"><Button onClick={()=>void session.refresh()}>Refresh</Button></Status>;
  const send=async(action,extra={})=>{
    setLocalError("");
    try{return await session.command({action,membershipId:r.membership.id,expectedVersion:version,...extra});}
    catch(cause){setLocalError(cause.message);return null;}
  };
  const updateSettings=patch=>void send("update-settings",{...p.configuration,...patch});
  const toggleDeck=deck=>{
    setDraft(previous=>{
      if(previous.some(d=>d.id===deck.id))return previous.filter(d=>d.id!==deck.id);
      if(p.requiredDeckCount===1)return [deck];
      return previous.length<p.requiredDeckCount?[...previous,deck]:previous;
    });
  };
  const copy=async(invitation=false)=>{try{await navigator.clipboard.writeText(invitation?new URL("/play?join="+encodeURIComponent(room.code),window.location.origin).href:room.code);}catch{setLocalError("Could not copy invitation.");}};
  const leave=()=>{if(window.confirm(active?"Leave lobby and forfeit or abandon the active series?":"Leave this lobby?"))void send("leave");};
  const canEdit=host&&!active&&room.mode!=="ranked"&&!session.busy;
  const configuration=p.configuration;
  return <section className={styles.screen}>
    <header className={styles.heading}><h1>{room.mode.toUpperCase()} LOBBY</h1>{room.mode!=="training"&&<><Button onClick={()=>void copy()}>{room.code} · Copy</Button><Button onClick={()=>void copy(true)}>Copy invite link</Button></>}<Button disabled={session.busy} onClick={leave}>Leave Lobby</Button></header>
    <div className={styles.settings}>
      <label>Structure<select className="bb-field" disabled={!canEdit} value={configuration.structure} onChange={e=>updateSettings({structure:e.target.value})}><option value="bo1">Best of One</option><option value="bo3">Best of Three</option></select></label>
      <label>Format<select className="bb-field" disabled={!canEdit} value={configuration.format} onChange={e=>updateSettings({format:e.target.value})}><option value="standard">Standard</option><option value="singleton">Singleton</option><option value="competitive">Competitive</option></select></label>
      <label>Meta<select className="bb-field" disabled={!canEdit} value={configuration.meta} onChange={e=>updateSettings({meta:e.target.value})}>{LOBBY_METAS.map(meta=><option key={meta.id} value={meta.id}>{meta.name}</option>)}</select></label>
    </div>
    <div className={styles.seats}>
      {[own,...p.seats.filter(s=>!s.own)].map(seat=><section className={styles.seat} key={seat.membershipId}><h2>{seat.name}</h2><p>{seat.connected?(active?"Series in progress":seat.ready?"Ready":"Not ready"):"Disconnected"}</p>
        {Array.from({length:p.requiredDeckCount},(_,i)=><div className={styles.deck} key={i}>{seat.own?seat.decks[i]?.name??"Empty deck slot":room.mode==="ranked"?(i<seat.deckCount?"Hidden Deck":"Empty deck slot"):seat.decks[i]?.name??"Empty deck slot"}{seat.own&&seat.deckProblems?.[i]&&<small>{seat.deckProblems[i]}</small>}</div>)}
        {seat.own&&<><Button disabled={session.busy||active} onClick={()=>{setDraft(seat.decks);setEditing(true);}}>Select Decks</Button><Button disabled={session.busy||active||(!seat.ready&&(Boolean(seat.problem)||!seat.connected||(room.mode==="training"&&!p.ai?.ready)))} onClick={()=>void send("set-ready",{ready:!seat.ready})}>{seat.ready?"Unready":"Ready"}</Button></>}
      </section>)}
      {room.mode==="training"&&<section className={styles.seat}><h2>Mira Nova</h2><p>{p.ai?.ready?"Ready":"No compatible AI deck"}</p><div className={styles.deck}>{p.ai?.deck?.name??"Waiting for automatic assignment"}</div>{!p.ai?.ready&&!active&&<Button disabled={session.busy} onClick={()=>void send("sync-preparation")}>Retry assignment</Button>}</section>}
      {room.mode!=="training"&&p.seats.length<2&&<section className={styles.seat}><h2>Waiting for opponent</h2><p>Share the lobby code.</p></section>}
    </div>
    {editing&&!active&&<section className={styles.picker}><h2>Choose {p.requiredDeckCount===1?"a deck":"three decks"}</h2><p>{draft.length}/{p.requiredDeckCount} selected. <Link href="/decks">My Decks</Link></p>
      <div className={styles.deckList}>{decks.map(deck=>{
        const selected=draft.some(d=>d.id===deck.id),problem=deckProblem(deck,configuration,p.ruleset);
        return <label key={deck.id}><input type="checkbox" checked={selected} disabled={!selected&&(Boolean(problem)||(p.requiredDeckCount===3&&draft.length>=3))} onChange={()=>toggleDeck(deck)}/>{deck.name}{problem&&<small>{problem}</small>}</label>;
      })}</div>
      {draft.filter(d=>!decks.some(saved=>saved.id===d.id)).map(deck=><label key={deck.id}><input type="checkbox" checked onChange={()=>toggleDeck(deck)}/>{deck.name} (committed snapshot)</label>)}
      <Button onClick={()=>setEditing(false)}>Cancel</Button><Button disabled={session.busy} onClick={async()=>{if(await send("select-decks",{decks:draft}))setEditing(false);}}>Confirm selection</Button>
    </section>}
    {(localError||session.error)&&<p role="alert">{localError||session.error}</p>}
    <div className={styles.actions}>{active?<Button onClick={session.returnToGame}>Return to Game</Button>:host?<Button disabled={session.busy||!p.canStart} onClick={()=>void send("start-series",{commandId:crypto.randomUUID()})}>Start Game</Button>:<span>Waiting for host</span>}</div>
  </section>;
}
export function PersistentMatchRoute({legacy}){
  const session=useLobbySession();
  return <PersistentPlayGuard>{session.enabled?<ManagedGame legacy={legacy}/>:legacy}</PersistentPlayGuard>;
}
function ManagedGame({legacy}){
  const session=useLobbySession(),{match}=useAppFields(["match"]);
  const r=session.recovery;
  const seriesId=r.status==="member"?r.lobby.currentSeriesId:null;
  const [claimError,setClaimError]=useState(""),[claiming,setClaiming]=useState(false);
  const attempted=useRef(null);
  const completed=r.status==="member"&&match?.id===r.lobby.previousSeriesId&&isCompletedSeriesResult(match);
  const claimed=seriesId&&session.claimedSeries===seriesId&&match?.id===seriesId;
  const claim=async(takeover=false)=>{
    setClaiming(true);setClaimError("");
    try{await session.claimGame(takeover);}catch(cause){setClaimError(cause.message);}
    finally{setClaiming(false);}
  };
  useEffect(()=>{
    if(!seriesId||claimed||session.unavailable||attempted.current===seriesId)return;
    attempted.current=seriesId;
    void claim();
  },[seriesId,claimed,session.unavailable]);
  if(completed&&!seriesId)return <>{legacy}<div className={styles.gameReturn}><Button onClick={()=>void session.returnToLobby()}>Return to Lobby</Button></div></>;
  if(!claimed)return <Status title="Recovering gameplay"><p>{claimError||"Connecting your game controller."}</p><Button disabled={claiming} onClick={async()=>{await session.refresh();void claim();}}>Retry</Button>{claimError&&r.lobby?.mode!=="training"&&<Button disabled={claiming} onClick={()=>{if(window.confirm("Take over this game from the other device?"))void claim(true);}}>Take over controller</Button>}<Button onClick={()=>void session.returnToLobby()}>Return to Lobby</Button></Status>;
  if(session.checkpointError?.startsWith("Training checkpoint changed"))return <Status title="Training recovery required"><p role="alert">{session.checkpointError}</p><Button disabled={claiming} onClick={()=>void claim()}>Recover checkpoint</Button><Button onClick={()=>void session.returnToLobby()}>Return to Lobby</Button></Status>;
  return <>
    {match.phase==="lobby"?<ManagedGamePreparation/>:legacy}
    <div className={styles.gameReturn}><Button onClick={()=>void session.returnToLobby()}>Return to Lobby</Button>
      {session.checkpointError&&<><span role="alert">{session.checkpointError}</span><Button disabled={claiming} onClick={()=>void claim()}>Recover checkpoint</Button></>}</div>
  </>;
}
/** Transitional game-owned controls for the existing engine's internal lobby
 * phase. Final Ranked presentation is intentionally a separate design phase. */
function ManagedGamePreparation(){
  useMatchTransport();
  const stored=useMatchSelector(s=>({match:s.match,playerId:s.playerId,online:s.online}));
  const {authUser}=useAppFields(["authUser"]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[choice,setChoice]=useState("");
  const state=stored.match,actor=stored.playerId;
  const ranked=state&&rankedSeries(state),mine=ranked?.players[actor],opponent=ranked&&Object.entries(ranked.players).find(([id])=>id!==actor)?.[1];
  useEffect(()=>setChoice(""),[state?.id,ranked?.stage,state?.gameNumber]);
  if(!state||!actor)return <Status title="Restoring series"/>;
  const send=async(action,payload={})=>{
    setBusy(true);setError("");
    try{
      const latest=readMatchStore(),current=latest.match;
      if(!current||current.id!==state.id)throw new Error("Series changed.");
      if(latest.online){
        const response=await fetch("/api/game",{method:"POST",headers:matchCommandHeaders(latest),body:JSON.stringify({action,code:current.code,playerId:actor,expectedVersion:current.version,payload})});
        const data=await response.json();if(data.state)publishMatch(data.state);if(!response.ok)throw new Error(data.error||"Game command failed.");
      }else{publishMatch(dispatchLocalGameAction(current,actor,action,payload));}
    }catch(cause){setError(cause.message);}
    finally{setBusy(false);}
  };
  const ban=ranked?.stage==="ban",select=ranked?.stage==="select",ready=state.players.find(p=>p.id===actor)?.ready;
  const options=ban?opponent?.decks??[]:select?eligibleRankedDecks(state,actor):[];
  return <Status title={ban?"Ranked · Ban a deck":select?"Ranked · Select round deck":"Prepare next game"}>
    <p>Series score: {Object.values(state.series).join(" – ")}</p>
    {(ban||select)?<><div className={styles.deckList}>{options.map(deck=><label key={deck.id}><input type="radio" name="round-deck" checked={choice===deck.id} disabled={busy||Boolean(ban?mine?.bannedDeckId:mine?.selectedDeckId)} onChange={()=>setChoice(deck.id)}/>{deck.name}</label>)}</div>
      <Button disabled={busy||!choice||Boolean(ban?mine?.bannedDeckId:mine?.selectedDeckId)} onClick={()=>void send(ban?"ranked-ban":"ranked-select",{deckId:choice})}>{ban?"Confirm Ban":"Lock Deck"}</Button>
      {Boolean(ban?mine?.bannedDeckId:mine?.selectedDeckId)&&<p>Waiting for opponent.</p>}</>:<>
      <Button disabled={busy} onClick={()=>void send("lobby-ready",{ready:!ready})}>{ready?"Unready":"Ready"}</Button>
      {state.players[0]?.id===actor&&<Button disabled={busy||!lobbyCanStart(state)} onClick={()=>void send("start-match")}>Start Game</Button>}
    </>}
    {error&&<p role="alert">{error}</p>}
  </Status>;
}
