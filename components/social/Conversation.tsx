"use client";
import {useEffect,useRef,useState,type FormEvent} from "react";
import {useAppFields} from "../application/AppProvider";
import {LucideIcon} from "../design-system/LucideIcon";
import type {SocialAccountSummary} from "../../lib/social";
import {MESSAGE_MAX_LENGTH,mergeMessages,normalizeMessage,type DirectMessage,type MessageThread} from "../../lib/social-messages";
import {useSocial} from "./SocialProvider";
import {Presence,SocialAvatar,SocialOptions} from "./SocialMenu";
import {messageRequest} from "./message-client";
import styles from "./SocialProvider.module.css";

export function Conversation({account}:{account:SocialAccountSummary}){
 const {authUser}=useAppFields(["authUser"]),{inbox,inboxRevision,refreshInbox,setPeer}=useSocial();
 const [messages,setMessages]=useState<DirectMessage[]>([]),[thread,setThread]=useState<MessageThread|null>(null);
 const [draft,setDraft]=useState(""),[sending,setSending]=useState(false),[loading,setLoading]=useState(true),[older,setOlder]=useState(false),[error,setError]=useState(""),[sendError,setSendError]=useState(""),[retry,setRetry]=useState(0);
 const list=useRef<HTMLDivElement>(null),atBottom=useRef(true),readThrough=useRef(0),sendId=useRef<{body:string;id:string}|null>(null),alive=useRef(true),olderLoaded=useRef(false);
 const encoded=encodeURIComponent(account.userId),blocked=inbox.blockedIds.includes(account.userId),viewer=authUser?.id;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const read=async(through:number)=>{
  if(!through||through<=readThrough.current||document.visibilityState!=="visible"||!atBottom.current)return;
  readThrough.current=through;
  try{await messageRequest("",{action:"read",peer:account.userId,through});await refreshInbox();}
  catch{if(readThrough.current===through)readThrough.current=0;}
 };
 useEffect(()=>{
  const controller=new AbortController();
  const load=async()=>{
   try{
    const result=await messageRequest<{thread:MessageThread}>("peer="+encoded,undefined,controller.signal);
    if(controller.signal.aborted)return;
    // If more than a page arrived while disconnected, start from the new
    // contiguous tail; older history remains reachable through pagination.
    const incoming=result.thread.messages;
    setMessages(current=>{
      if(current.length&&incoming.length&&incoming[0].id>current[current.length-1].id){
        olderLoaded.current=false;return incoming;
      }
      return mergeMessages(current,incoming);
    });
    setThread(current=>({...result.thread,hasOlder:olderLoaded.current?(current?.hasOlder??false):result.thread.hasOlder}));
    setError("");
   }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"Conversation unavailable.");}
   finally{if(!controller.signal.aborted)setLoading(false);}
  };
  void load();return()=>controller.abort();
 },[encoded,inboxRevision,blocked,retry]);
 useEffect(()=>{
  const node=list.current;if(!node)return;
  if(atBottom.current)node.scrollTop=node.scrollHeight;
  const last=messages.filter(m=>m.recipientId===viewer).at(-1)?.id??0;
  void read(last);
  const visible=()=>{if(document.visibilityState==="visible"){void read(last);setRetry(v=>v+1);}};
  document.addEventListener("visibilitychange",visible);return()=>document.removeEventListener("visibilitychange",visible);
 },[messages,viewer]);
 const loadOlder=async()=>{
  if(older||!messages.length)return;
  const node=list.current,previousHeight=node?.scrollHeight??0;
  setOlder(true);atBottom.current=false;
  try{
   const result=await messageRequest<{thread:MessageThread}>("peer="+encoded+"&before="+messages[0].id);
   if(!alive.current)return;
   olderLoaded.current=true;
   setMessages(current=>mergeMessages(current,result.thread.messages));
   setThread(current=>current?{...current,hasOlder:result.thread.hasOlder}:result.thread);
   requestAnimationFrame(()=>{if(node)node.scrollTop=node.scrollHeight-previousHeight;});
  }catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:"Could not load older messages.");}
  finally{if(alive.current)setOlder(false);}
 };
 const submit=async(e:FormEvent)=>{
  e.preventDefault();
  const body=normalizeMessage(draft);
  if(!body||body.length>MESSAGE_MAX_LENGTH||sending||!thread?.canSend||blocked||error)return;
  const id=sendId.current?.body===body?sendId.current.id:crypto.randomUUID();
  sendId.current={body,id};setSending(true);setSendError("");
  try{
   const result=await messageRequest<{message:DirectMessage}>("",{action:"send",peer:account.userId,body,clientId:id});
   if(alive.current){atBottom.current=true;setMessages(current=>mergeMessages(current,[result.message]));setDraft("");sendId.current=null;}
   await refreshInbox();
  }catch(cause){if(alive.current)setSendError(cause instanceof Error?cause.message:"Message not sent. Retry.");}
  finally{if(alive.current)setSending(false);}
 };
 return <div className={styles.conversation}>
  <header className={styles.conversationHeader}>
   <button type="button" className={styles.iconButton} aria-label="Back to conversations" onClick={()=>setPeer(null)}><LucideIcon name="arrow-left"/></button>
   <SocialAvatar account={account}/><div className={styles.identityText}><strong>{account.displayName}</strong><Presence account={account}/></div><SocialOptions account={account}/>
  </header>
  <div ref={list} className={styles.history} role="log" aria-label={"Messages with "+account.displayName} onScroll={()=>{
   const node=list.current;if(!node)return;
   atBottom.current=node.scrollHeight-node.scrollTop-node.clientHeight<48;
   if(atBottom.current)void read(messages.filter(m=>m.recipientId===viewer).at(-1)?.id??0);
  }}>
   {thread?.hasOlder&&<button type="button" className="bb-button" disabled={older} onClick={()=>void loadOlder()}>{older?"Loading…":"Load older messages"}</button>}
   {loading&&<p className={styles.empty} role="status">Loading conversation…</p>}
   {!loading&&!messages.length&&!error&&<p className={styles.empty}>Start a conversation with {account.displayName}.</p>}
   {messages.map((message,index)=>{
    const date=new Date(message.createdAt),previous=messages[index-1],newDay=!previous||new Date(previous.createdAt).toDateString()!==date.toDateString();
    return <div key={message.id} className={styles.messageGroup}>
     {newDay&&<time className={styles.dateLabel} dateTime={date.toISOString()}>{date.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}</time>}
     <div className={styles.message} data-own={message.senderId===viewer}><span>{message.body}</span><time dateTime={date.toISOString()}>{date.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"})}</time></div>
    </div>;
   })}
  </div>
  {error&&<div className={styles.warning} role="alert"><span>{error}</span><button type="button" className="bb-button" onClick={()=>setRetry(v=>v+1)}>Retry</button></div>}
  {sendError&&<p role="alert" className={styles.error}>{sendError} Your draft has been retained.</p>}
  {blocked||thread&&!thread.canSend?<p className={styles.empty}>{blocked?"You have blocked messages from this Brawler. Use Options to unblock.":"This conversation is not accepting messages."}</p>:<form className={styles.composer} onSubmit={submit}>
   <textarea className="bb-field" aria-label="Message" placeholder="Write a message…" rows={2} maxLength={MESSAGE_MAX_LENGTH} value={draft} disabled={sending||!thread||Boolean(error)} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();e.currentTarget.form?.requestSubmit();}}}/>
   <button type="submit" className="bb-button bb-button--primary" aria-label="Send message" disabled={sending||!thread||Boolean(error)||!normalizeMessage(draft)}><LucideIcon name="send"/></button>
  </form>}
 </div>;
}
