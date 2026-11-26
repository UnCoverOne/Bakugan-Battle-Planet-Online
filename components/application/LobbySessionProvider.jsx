"use client";
import {createContext,useCallback,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState} from "react";
import {usePathname,useRouter} from "next/navigation";
import {shouldEnterStartedSeries} from "../../lib/lobby-client-routing";
import {isCompletedSeriesResult} from "../../lib/match-result-navigation";
import {useAppFields} from "./AppProvider";

/** @type {import("react").Context<any>} */
const Context=createContext(null);
const initial={status:"checking"};
const memberOf=value=>value?.status==="member"?value:null;
const seriesOf=value=>value?.status==="member"?{lobbyId:value.lobby.id,seriesId:value.lobby.currentSeriesId}:null;
const HEARTBEAT_MS=12000;
async function requestSession(body,headers={},signal){
  const timeout=AbortSignal.timeout(10000);
  const requestSignal=signal?AbortSignal.any([signal,timeout]):timeout;
  const response=await fetch("/api/lobby/session",{
    method:body?"POST":"GET",cache:"no-store",credentials:"same-origin",signal:requestSignal,
    headers:{"content-type":"application/json",...headers},...(body?{body:JSON.stringify(body)}:{}),
  });
  const result=await response.json().catch(()=>null);
  if(!response.ok||!result){
    const error=new Error(result?.error||"Lobby session unavailable.");
    error.status=response.status;throw error;
  }
  if(!["member","none","identity-required","identity-conflict"].includes(result.status))throw new Error("Invalid lobby recovery response.");
  if(result.status==="member"&&(!result.lobby?.id||!result.membership?.id||result.membership.lobbyId!==result.lobby.id))throw new Error("Incomplete lobby recovery response.");
  return result;
}
/** @returns {any} Session contract is supplied by the enabled provider. */
export function useLobbySession(){return useContext(Context);}
export function LobbySessionProvider({children}){
  const app=useAppFields(["ready","authChecking","authUser","accountDataReady","match","matchCapability","matchControllerId","playerId","installManagedMatch","clearManagedMatch","notify"]);
  const router=useRouter(),pathname=usePathname();
  const appRef=useRef(app),pathRef=useRef(pathname);
  appRef.current=app;pathRef.current=pathname;
  const [recovery,setRecovery]=useState(initial),[error,setError]=useState(""),[unavailable,setUnavailable]=useState(false),[busy,setBusy]=useState(false);
  const [claimedSeries,setClaimedSeries]=useState(null),[checkpointError,setCheckpointError]=useState("");
  const recoveryRef=useRef(initial),epoch=useRef(0),queue=useRef(Promise.resolve()),abort=useRef(null),refreshing=useRef(null),availability=useRef(false);
  const checkpoint=useRef(null);
  const identity=app.authChecking?"checking":app.authUser?.id??"guest";
  const authenticatedReady=app.ready&&!app.authChecking&&(!app.authUser||app.accountDataReady);
  const accept=useCallback((result,generation)=>{
    if(generation!==epoch.current)throw new Error("Account changed during lobby recovery.");
    const expectedAccount=appRef.current.authUser?.id??null;
    if((result.accountId??null)!==expectedAccount)throw new Error("Browser account and server lobby identity differ. Sign in again or complete sign-out.");
    const old=recoveryRef.current,prior=memberOf(old),next=memberOf(result);
    // Keep controller secrets in the existing session credential store, never in the lobby response cache.
    const {claim,training,result:completedResult,...publicResult}=result;
    recoveryRef.current=publicResult;setRecovery(publicResult);availability.current=false;setUnavailable(false);setError("");
    if(prior&&(!next||prior.membership.id!==next.membership.id)){
      const oldSeries=prior.lobby.currentSeriesId??prior.lobby.previousSeriesId;
      if(oldSeries)appRef.current.clearManagedMatch(oldSeries);
      checkpoint.current=null;setClaimedSeries(null);
      if(!next&&result.status==="none")appRef.current.notify("Lobby membership ended.");
    }
    // Do not announce every heartbeat. Compare two verified observations of
    // the same membership while the user is browsing elsewhere.
    if(prior&&next&&prior.membership.id===next.membership.id&&!["/play/lobby","/play/match"].includes(pathRef.current)){
      const before=prior.preparation?.seats?.find(s=>!s.own),after=next.preparation?.seats?.find(s=>!s.own);
      const oldSeries=prior.lobby.currentSeriesId,newSeries=next.lobby.currentSeriesId;
      const message=!oldSeries&&newSeries?"Game started. Return to your lobby to play."
        :oldSeries&&!newSeries?"Series completed."
        :after&&before?.membershipId!==after.membershipId?"Opponent joined your lobby."
        :before&&!after?"Opponent left your lobby."
        :before?.connected&&!after?.connected?"Opponent disconnected."
        :!before?.ready&&after?.ready?"Opponent is ready.":"";
      if(message)appRef.current.notify(message);
    }
    if(shouldEnterStartedSeries(pathRef.current,seriesOf(old),seriesOf(result)))router.push("/play/match");
    return result;
  },[router]);
  const enqueue=useCallback((operation)=>{
    const generation=epoch.current,signal=abort.current?.signal;
    const run=async()=>{
      if(generation!==epoch.current||signal?.aborted)throw new Error("Lobby identity changed.");
      const result=await operation(generation,signal);
      if(generation!==epoch.current)throw new Error("Lobby identity changed.");
      return result;
    };
    const next=queue.current.catch(()=>{}).then(run);
    queue.current=next.catch(()=>{});
    return next;
  },[]);
  const refresh=useCallback(()=>{
    if(refreshing.current)return refreshing.current;
    const generation=epoch.current;
    const pending=enqueue(async(g,signal)=>{
      let current=memberOf(recoveryRef.current),result;
      if(current){
        try{result=await requestSession({action:"heartbeat",membershipId:current.membership.id},{},signal);}
        catch(cause){if(cause.status!==409&&cause.status!==403&&cause.status!==401)throw cause;result=await requestSession(null,{},signal);}
      }else if(recoveryRef.current.status==="identity-conflict"){
        // Retain both verified memberships while the user decides; never adopt or leave automatically.
        for(const [scope,member] of [["account",recoveryRef.current.account],["guest",recoveryRef.current.guest]]){
          if(member)try{await requestSession({action:"heartbeat",scope,membershipId:member.id},{},signal);}catch(cause){if(cause.status!==409&&cause.status!==403&&cause.status!==401)throw cause;}
        }
        result=await requestSession(null,{},signal);
      }else {
        result=await requestSession(null,{},signal);
        if(result.status==="member")result=await requestSession({action:"heartbeat",membershipId:result.membership.id},{},signal);
      }
      return accept(result,g);
    }).catch(cause=>{
      if(generation===epoch.current){availability.current=true;setUnavailable(true);setError(cause.message||"Lobby recovery failed.");}
      return null;
    }).finally(()=>{if(generation===epoch.current)refreshing.current=null;});
    refreshing.current=pending;return pending;
  },[accept,enqueue]);
  useLayoutEffect(()=>{
    epoch.current+=1;abort.current?.abort();abort.current=new AbortController();queue.current=Promise.resolve();refreshing.current=null;availability.current=false;
    const old=memberOf(recoveryRef.current);
    if(old){const id=old.lobby.currentSeriesId??old.lobby.previousSeriesId;if(id)appRef.current.clearManagedMatch(id);}
    recoveryRef.current=initial;setRecovery(initial);setError("");setUnavailable(false);setBusy(false);checkpoint.current=null;setClaimedSeries(null);setCheckpointError("");
    if(!authenticatedReady)return ()=>abort.current?.abort();
    void refresh();
    const timer=window.setInterval(()=>void refresh(),HEARTBEAT_MS);
    const wake=()=>void refresh();
    window.addEventListener("online",wake);window.addEventListener("focus",wake);document.addEventListener("visibilitychange",wake);
    return ()=>{epoch.current+=1;abort.current?.abort();clearInterval(timer);window.removeEventListener("online",wake);window.removeEventListener("focus",wake);document.removeEventListener("visibilitychange",wake);};
  },[identity,authenticatedReady,refresh]);
  const command=useCallback((body,headers={})=>{
    const generation=epoch.current;setBusy(true);
    return enqueue(async(g,signal)=>{
      let current=recoveryRef.current;
      if(["create","join"].includes(body.action)){
        if(availability.current)throw new Error("Verify membership before creating or joining a lobby.");
        if(current.status==="identity-required"){
          await requestSession({action:"bootstrap"},{},signal);
          current=accept(await requestSession(null,{},signal),g);
        }
        if(current.status!=="none")throw new Error("Resolve your current lobby membership first.");
      }
      const result=await requestSession(body,headers,signal);
      return accept(result,g);
    }).catch(cause=>{if(generation===epoch.current){
      if(!cause.status||cause.status>=500){availability.current=true;setUnavailable(true);}
      setError(cause.message||"Lobby command failed.");
    }throw cause;})
      .finally(()=>{if(generation===epoch.current)setBusy(false);});
  },[accept,enqueue]);
  const claimGame=useCallback(async(takeover=false)=>{
    const generation=epoch.current;
    const current=memberOf(recoveryRef.current),seriesId=current?.lobby.currentSeriesId;
    if(!seriesId)throw new Error("No active series.");
    const isTraining=current.lobby.mode==="training";
    const appNow=appRef.current;
    let result;
    if(isTraining){
      result=await command({action:"recover-training",membershipId:current.membership.id,seriesId});
      const saved=result.training;
      if(!saved?.state||saved.state.id!==seriesId)throw new Error("Invalid Training checkpoint.");
      checkpoint.current={seriesId,membershipId:current.membership.id,revision:saved.revision,version:saved.state.version,blocked:false};
      setCheckpointError("");
      result={state:saved.state,playerId:current.membership.id,capability:"",controllerId:"",checkpointRevision:saved.revision};
    }else{
      const offer=current.controller;
      if(!offer||offer.seriesId!==seriesId)throw new Error("Controller recovery unavailable. Refresh the lobby.");
      const headers=appNow.match?.id===seriesId&&appNow.matchCapability&&appNow.matchControllerId?{"x-match-capability":appNow.matchCapability,"x-match-controller":appNow.matchControllerId}:{};
      const response=await command({action:"claim-controller",membershipId:current.membership.id,seriesId,expectedCapabilityVersion:offer.capabilityVersion,takeover},headers);
      result=response.claim;
      if(!result?.capability||!result?.controllerId||result.state?.id!==seriesId)throw new Error("Incomplete controller recovery.");
    }
    if(generation!==epoch.current||memberOf(recoveryRef.current)?.lobby.currentSeriesId!==seriesId)throw new Error("Series changed during recovery.");
    const isCurrent=()=>generation===epoch.current&&memberOf(recoveryRef.current)?.lobby.currentSeriesId===seriesId;
    if(!await appRef.current.installManagedMatch({...result,online:!isTraining,isCurrent})||!isCurrent())throw new Error("Series changed during recovery.");
    setClaimedSeries(seriesId);
    return result.state;
  },[command]);
  const flushTraining=useCallback(()=>{
    const saved=checkpoint.current,current=memberOf(recoveryRef.current),state=appRef.current.match;
    if(!saved||saved.blocked||saved.pending||current?.lobby.currentSeriesId!==saved.seriesId||state?.id!==saved.seriesId||state.version<=saved.version)return Promise.resolve();
    saved.pending=true;
    const action=isCompletedSeriesResult(state)?"complete-training":"checkpoint-training";
    return command({action,membershipId:saved.membershipId,seriesId:saved.seriesId,expectedRevision:saved.revision,state})
      .then(result=>{if(checkpoint.current!==saved)return;saved.version=state.version;saved.revision=result.training.revision;if(action==="complete-training")checkpoint.current=null;setCheckpointError("");})
      .catch(cause=>{if(checkpoint.current!==saved)return;if(cause.status===409||cause.status===403){saved.blocked=true;setCheckpointError("Training checkpoint changed on another device. Return to the game and recover the saved state before continuing.");}else setCheckpointError("Training checkpoint not saved. Retrying while connected.");})
      .finally(()=>{saved.pending=false;});
  },[command]);
  useEffect(()=>{
    if(!authenticatedReady)return;
    const timer=window.setInterval(()=>void flushTraining(),3000);
    return ()=>clearInterval(timer);
  },[authenticatedReady,flushTraining]);
  useEffect(()=>{
    if(!authenticatedReady||!claimedSeries)return;
    const timer=window.setTimeout(()=>void flushTraining(),500);
    return ()=>clearTimeout(timer);
  },[app.match?.version,claimedSeries,authenticatedReady,flushTraining]);
  useEffect(()=>{
    const replaced=()=>{setClaimedSeries(null);void refresh();};
    window.addEventListener("bbp-match-session-replaced",replaced);
    return ()=>window.removeEventListener("bbp-match-session-replaced",replaced);
  },[refresh]);
  const returnToLobby=useCallback(async()=>{await flushTraining();router.push("/play/lobby");},[flushTraining,router]);
  const returnToGame=useCallback(()=>router.push("/play/match"),[router]);
  const recoverResult=useCallback(async()=>{
    const current=memberOf(recoveryRef.current),seriesId=current?.lobby.previousSeriesId;
    if(!seriesId)throw new Error("No previous series.");
    const response=await command({action:"recover-result",membershipId:current.membership.id,seriesId});
    return response.result;
  },[command]);
  const value=useMemo(()=>({recovery,error,unavailable,busy,refresh,command,claimGame,claimedSeries,checkpointError,flushTraining,returnToLobby,returnToGame,recoverResult}),
    [recovery,error,unavailable,busy,refresh,command,claimGame,claimedSeries,checkpointError,flushTraining,returnToLobby,returnToGame,recoverResult]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
