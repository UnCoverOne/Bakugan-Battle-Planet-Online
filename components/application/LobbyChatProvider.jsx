"use client";
import {createContext,useCallback,useContext,useLayoutEffect,useMemo,useRef,useState} from "react";
import {mergeLobbyChatPage} from "../../lib/lobby-chat-client";
import {useLobbySession} from "./LobbySessionProvider";

const empty={enabled:false,page:null,unread:0,draft:"",error:"",sending:false,loadingOlder:false,openView:()=>()=>{},refresh:async()=>{},loadOlder:async()=>{},send:async()=>{},markRead:async()=>{},setDraft:()=>{}};
/** @type {import("react").Context<any>} */
const Context=createContext(empty);
/** @returns {any} */
export function useLobbyChat(){return useContext(Context);}
export function LobbyChatProvider({children}){
  const session=useLobbySession(),member=session.enabled&&session.recovery.status==="member"?session.recovery.membership:null;
  return <ActiveLobbyChat member={member}>{children}</ActiveLobbyChat>;
}
function ActiveLobbyChat({member,children}){
  const [page,setPage]=useState(null),[error,setError]=useState(""),[draft,setDraftState]=useState(""),[sending,setSending]=useState(false),[loadingOlder,setLoadingOlder]=useState(false);
  const pageRef=useRef(null),draftRef=useRef(""),retry=useRef(null),views=useRef(0),queue=useRef(Promise.resolve()),lifecycle=useRef(null);
  const refreshing=useRef(null),sendPending=useRef(false),olderPending=useRef(false),readPending=useRef(0);
  const execute=useCallback((body,older=false)=>{
    const controller=lifecycle.current;
    const run=async()=>{
      if(!member||!controller||controller.signal.aborted)throw new Error("Chat membership changed.");
      const response=await fetch("/api/lobby/chat",{method:"POST",cache:"no-store",credentials:"same-origin",
        headers:{"content-type":"application/json"},body:JSON.stringify({...body,membershipId:member.id}),
        signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});
      const data=await response.json().catch(()=>null);
      if(!response.ok||!data)throw new Error(data?.error||"Lobby chat unavailable.");
      if(controller.signal.aborted||lifecycle.current!==controller||data.membershipId!==member.id||data.lobbyId!==member.lobbyId)throw new Error("Chat membership changed.");
      const merged=mergeLobbyChatPage(pageRef.current,data,older);
      pageRef.current=merged;setPage(merged);setError("");
      return data;
    };
    const pending=queue.current.catch(()=>{}).then(run);
    queue.current=pending.catch(()=>{});
    return pending.catch(cause=>{if(controller&&!controller.signal.aborted&&lifecycle.current===controller)setError(cause.message||"Lobby chat unavailable.");throw cause;});
  },[member?.id,member?.lobbyId]);
  const refresh=useCallback(()=>{
    if(refreshing.current)return refreshing.current;
    const pending=execute({action:"history"}).catch(()=>null).finally(()=>{if(refreshing.current===pending)refreshing.current=null;});
    refreshing.current=pending;return pending;
  },[execute]);
  useLayoutEffect(()=>{
    // Reset the chat scope without remounting the website shell or its routes.
    const controller=new AbortController();lifecycle.current=controller;queue.current=Promise.resolve();refreshing.current=null;
    pageRef.current=null;draftRef.current="";retry.current=null;sendPending.current=false;olderPending.current=false;readPending.current=0;
    setPage(null);setDraftState("");setError("");setSending(false);setLoadingOlder(false);
    if(!member)return ()=>controller.abort();
    let lastPoll=0;
    const tick=(force=false)=>{
      if(document.visibilityState!=="visible"||!navigator.onLine)return;
      const interval=views.current>0?3000:12000;
      if(force||Date.now()-lastPoll>=interval){lastPoll=Date.now();void refresh();}
    };
    tick(true);
    const timer=window.setInterval(tick,1000);
    const wake=()=>tick(true);
    window.addEventListener("online",wake);window.addEventListener("focus",wake);document.addEventListener("visibilitychange",wake);
    return ()=>{controller.abort();clearInterval(timer);window.removeEventListener("online",wake);window.removeEventListener("focus",wake);document.removeEventListener("visibilitychange",wake);};
  },[refresh,member?.id,member?.lobbyId]);
  const openView=useCallback(()=>{
    views.current+=1;
    // Children may mount before the parent's first passive effect; the
    // initial provider poll will populate history in that case.
    if(lifecycle.current&&!lifecycle.current.signal.aborted)void refresh();
    return ()=>{views.current=Math.max(0,views.current-1);};
  },[refresh]);
  const setDraft=useCallback(value=>{
    const next=String(value).slice(0,240);
    if(next!==draftRef.current)retry.current=null;
    draftRef.current=next;setDraftState(next);
  },[]);
  const send=useCallback(async()=>{
    const controller=lifecycle.current;
    const message=draftRef.current.trim();
    if(!message||sendPending.current||pageRef.current?.systemOnly)return false;
    const attempt=retry.current?.message===message?retry.current:{message,commandId:crypto.randomUUID()};
    retry.current=attempt;sendPending.current=true;setSending(true);
    try{
      const data=await execute({action:"send",message,commandId:attempt.commandId});
      if(!data.sent)throw new Error("Message delivery was not confirmed.");
      if(lifecycle.current===controller&&!controller?.signal.aborted&&retry.current===attempt){retry.current=null;draftRef.current="";setDraftState("");}
      return true;
    }catch{return false;}
    finally{if(lifecycle.current===controller&&!controller?.signal.aborted){sendPending.current=false;setSending(false);}}
  },[execute]);
  const loadOlder=useCallback(async()=>{
    const controller=lifecycle.current;
    const current=pageRef.current,before=current?.messages[0]?.id;
    if(!before||!current.hasOlder||olderPending.current)return false;
    olderPending.current=true;setLoadingOlder(true);
    try{await execute({action:"history",before},true);return true;}
    catch{return false;}
    finally{if(lifecycle.current===controller&&!controller?.signal.aborted){olderPending.current=false;setLoadingOlder(false);}}
  },[execute]);
  const markRead=useCallback(async through=>{
    const controller=lifecycle.current,current=pageRef.current;
    if(!current||!current.unread||!through||through<=current.readThrough||through<=readPending.current)return;
    if(!current.messages.some(message=>message.id===through))return;
    readPending.current=through;
    try{await execute({action:"read",through});}catch{}finally{if(lifecycle.current===controller&&readPending.current===through)readPending.current=0;}
  },[execute]);
  const value=useMemo(()=>({enabled:true,page,unread:page?.unread??0,draft,error,sending,loadingOlder,openView,refresh,loadOlder,send,markRead,setDraft}),
    [page,draft,error,sending,loadingOlder,openView,refresh,loadOlder,send,markRead,setDraft]);
  return <Context.Provider value={member&&(!page||page.membershipId===member.id)?value:empty}>{children}</Context.Provider>;
}
