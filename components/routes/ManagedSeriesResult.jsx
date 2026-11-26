"use client";
import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {useLobbySession} from "../application/LobbySessionProvider";
import styles from "./PersistentPlayRoutes.module.css";

export function ManagedSeriesResult(){
  const session=useLobbySession(),router=useRouter(),r=session.recovery;
  const seriesId=r.status==="member"?r.lobby.previousSeriesId:null;
  const [result,setResult]=useState(null),[error,setError]=useState("");
  useEffect(()=>{
    let cancelled=false;setResult(null);setError("");
    if(seriesId)void session.recoverResult().then(value=>{if(!cancelled)setResult(value);}).catch(cause=>{if(!cancelled)setError(cause.message);});
    return()=>{cancelled=true;};
  },[seriesId,session.recoverResult]);
  const state=result?.seriesId===seriesId?result.state:null;
  return <section className={styles.screen}><h1>Series result</h1>
    {state?<><h2>{state.winner===result.playerId?"Victory":"Defeat"}</h2><p>{state.players.map(player=>`${player.name}: ${state.series[player.id]??0}`).join(" · ")}</p><p>{state.resultReason}</p></>:
      <p role="status">{error||(!seriesId?"No completed series available.":"Recovering result…")}</p>}
    <button className="bb-button" type="button" onClick={()=>router.push("/play")}>Return to Lobby</button>
  </section>;
}
export function PersistentResultRoute({legacy}){
  const session=useLobbySession();
  return session.enabled?<ManagedSeriesResult/>:legacy;
}
