"use client";
import {useEffect,useLayoutEffect,useRef,useState} from "react";
import {useLobbyChat} from "./LobbyChatProvider";
import styles from "./LobbyChatPanel.module.css";

export function LobbyChatPanel({systemOnly=false,showHeader=true}){
  const chat=useLobbyChat(),page=chat.page,scroll=useRef(null),pinned=useRef(true),anchor=useRef(null),visibleLatest=useRef(0);
  const [atEnd,setAtEnd]=useState(true);
  const onlySystem=systemOnly||page?.systemOnly;
  const messages=page?.messages??[];
  const [scope,setScope]=useState(page?.membershipId);
  const latest=messages.at(-1)?.id??0;
  useEffect(()=>chat.openView(),[chat.openView]);
  useLayoutEffect(()=>{if(scope!==page?.membershipId){setScope(page?.membershipId);pinned.current=true;anchor.current=null;setAtEnd(true);}},[scope,page?.membershipId]);
  const acknowledge=()=>{
    if(pinned.current&&visibleLatest.current===latest&&document.visibilityState==="visible"&&document.hasFocus()&&latest&&latest===page?.latest)void chat.markRead(latest);
  };
  useLayoutEffect(()=>{
    const el=scroll.current;if(!el)return;
    if(anchor.current){
      const old=anchor.current,first=el.querySelector(`[data-message-id="${old.id}"]`);
      if(first){el.scrollTop+=first.getBoundingClientRect().top-el.getBoundingClientRect().top-old.offset;}
      anchor.current=null;
    }else if(pinned.current)el.scrollTop=el.scrollHeight;
  },[messages]);
  useEffect(()=>{
    // A mounted lobby panel can be below the fold on a narrow screen. Only
    // acknowledge when the newest message intersects the actual viewport.
    visibleLatest.current=0;
    const node=latest?scroll.current?.querySelector(`[data-message-id="${latest}"]`):null;
    if(!node||typeof IntersectionObserver==="undefined")return;
    const observer=new IntersectionObserver(entries=>{
      visibleLatest.current=entries.some(entry=>entry.isIntersecting&&entry.intersectionRatio>0)?latest:0;
      acknowledge();
    },{threshold:[0,0.1]});
    observer.observe(node);
    return ()=>{observer.disconnect();visibleLatest.current=0;};
  },[latest,page?.membershipId]);
  useEffect(()=>{
    acknowledge();
    const wake=()=>acknowledge();
    window.addEventListener("focus",wake);document.addEventListener("visibilitychange",wake);
    return ()=>{window.removeEventListener("focus",wake);document.removeEventListener("visibilitychange",wake);};
  },[page,atEnd,chat.markRead]);
  const onScroll=()=>{
    const el=scroll.current;if(!el)return;
    const end=el.scrollHeight-el.scrollTop-el.clientHeight<=24;
    pinned.current=end;setAtEnd(end);if(end)acknowledge();
  };
  const older=async()=>{
    const el=scroll.current;if(!el||chat.loadingOlder)return;
    const top=el.getBoundingClientRect().top;
    const first=[...el.querySelectorAll("[data-message-id]")].find(node=>node.getBoundingClientRect().bottom>=top);
    if(first)anchor.current={id:first.dataset.messageId,offset:first.getBoundingClientRect().top-top};
    pinned.current=false;setAtEnd(false);
    if(!await chat.loadOlder())anchor.current=null;
  };
  const jump=()=>{pinned.current=true;setAtEnd(true);if(scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;acknowledge();};
  return <section className={styles.panel} aria-label="Lobby chat">
    {showHeader&&<header className={styles.header}><h2>CHAT</h2>{chat.unread>0&&<small>{chat.unread} unread</small>}</header>}
    <div className={styles.history} ref={scroll} onScroll={onScroll} role="log" aria-live="polite" aria-label="Chat history">
      {page?.hasOlder&&<button type="button" className={styles.historyButton} disabled={chat.loadingOlder} onClick={()=>void older()}>{chat.loadingOlder?"Loading…":"Load earlier messages"}</button>}
      {messages.map(message=><article data-message-id={message.id} key={message.id} className={message.kind==="system"?styles.system:styles.message}>
        <div>{message.kind==="chat"&&<strong>{message.author}</strong>}<time dateTime={new Date(message.at).toISOString()}>{new Date(message.at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</time></div>
        <p>{message.message}</p>
      </article>)}
      {!messages.length&&<p className={styles.muted}>{page?"No messages yet.":"Loading chat…"}</p>}
    </div>
    {!atEnd&&chat.unread>0&&<button type="button" className={styles.historyButton} onClick={jump}>Jump to latest ({chat.unread} unread)</button>}
    {chat.error&&<div className={styles.error} role="alert">{chat.error} <button type="button" onClick={()=>void chat.refresh()}>Retry</button></div>}
    {onlySystem?<p className={styles.footer}>System messages only</p>:<form className={styles.composer} onSubmit={event=>{event.preventDefault();void chat.send().then(ok=>{if(ok)jump();});}}>
      <input className="bb-field" aria-label="Chat message" placeholder="Type a message…" autoComplete="off" maxLength={240} value={chat.draft} onChange={event=>chat.setDraft(event.target.value)} disabled={!page||chat.sending}/>
      <button className="bb-button" type="submit" disabled={!page||chat.sending||!chat.draft.trim()}>{chat.sending?"Sending…":"Send"}</button>
    </form>}
  </section>;
}
