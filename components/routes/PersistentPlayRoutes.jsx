"use client";
import {useEffect,useRef,useState} from "react";
import {usePathname,useRouter} from "next/navigation";
import {ManagedSeriesResult} from "./ManagedSeriesResult";
import {useLobbySession} from "../application/LobbySessionProvider";
import {useAppFields} from "../application/AppProvider";
import {lobbyRouteDecision} from "../../lib/lobby-client-routing";
import {isCompletedSeriesResult} from "../../lib/match-result-navigation";
import { SeriesPreparation } from "./SeriesPreparation";
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
  const decision=lobbyRouteDecision(pathname,session.unavailable?"unavailable":r.status,r.status==="member",r.status==="member"&&Boolean(r.lobby.currentSeriesId||completedHere));
  useEffect(()=>{if(decision.startsWith("/"))router.replace(decision);},[decision,router]);
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
export function PersistentMatchRoute({children}){
  return <PersistentPlayGuard><ManagedGame>{children}</ManagedGame></PersistentPlayGuard>;
}
function ManagedGame({children}){
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
  if(completed&&!seriesId)return <ManagedSeriesResult/>;
  if(!claimed)return <Status title="Recovering gameplay"><p>{claimError||"Connecting your game controller."}</p><Button disabled={claiming} onClick={async()=>{await session.refresh();void claim();}}>Retry</Button>{claimError&&r.lobby?.mode!=="training"&&<Button disabled={claiming} onClick={()=>{if(window.confirm("Take over this game from the other device?"))void claim(true);}}>Take over controller</Button>}<Button onClick={()=>void session.returnToLobby()}>Return to Lobby</Button></Status>;
  if(session.checkpointError?.startsWith("Training checkpoint changed"))return <Status title="Training recovery required"><p role="alert">{session.checkpointError}</p><Button disabled={claiming} onClick={()=>void claim()}>Recover checkpoint</Button><Button onClick={()=>void session.returnToLobby()}>Return to Lobby</Button></Status>;
  if (match.phase === "lobby") return <SeriesPreparation />;
  return <>
    {children}
    <div className={styles.gameReturn}><Button onClick={()=>void session.returnToLobby()}>Return to Lobby</Button>
      {session.checkpointError&&<><span role="alert">{session.checkpointError}</span><Button disabled={claiming} onClick={()=>void claim()}>Recover checkpoint</Button></>}</div>
  </>;
}
