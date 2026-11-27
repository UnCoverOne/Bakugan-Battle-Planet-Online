"use client";
import Link from "next/link";
import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from "react";
import {ProfileAvatar} from "../profile/ProfileAvatar";
import {LucideIcon,type LucideIconName} from "../design-system/LucideIcon";
import {useAppFields} from "../application/AppProvider";
import {socialPresenceDisplay,sortSocialAccounts,type SocialAccountSummary,type LobbyInviteSummary} from "../../lib/social";
import {useSocial,type SocialTab} from "./SocialProvider";
import {Conversation} from "./Conversation";
import {messageRequest} from "./message-client";
import styles from "./SocialProvider.module.css";

const tabs:{name:SocialTab;icon:LucideIconName}[]=[{name:"Brawlers",icon:"users"},{name:"Messages",icon:"message-square"},{name:"Requests",icon:"inbox"}];
function Badge({count}:{count:number}){return count>0?<span className={styles.badge} aria-label={count+" unread"}>{count>99?"99+":count}</span>:null;}
const profileHref=(account:SocialAccountSummary)=>"/brawlers/"+encodeURIComponent(account.userId);
export function SocialAvatar({account}:{account:SocialAccountSummary}){
 const {setOpen}=useSocial();
 return <Link href={profileHref(account)} className={styles.avatarLink} data-faction={account.faction} aria-label={"View "+account.displayName+" profile"} onClick={()=>setOpen(false)}>
  <ProfileAvatar profile={{name:account.displayName,avatar:account.avatar}} className={styles.avatar}/>
 </Link>;
}
export function Presence({account,showRelationship=false}:{account:SocialAccountSummary;showRelationship?:boolean}){
 const pending=showRelationship?(account.relationship==="incoming"?" · Friend request":account.relationship==="outgoing"?" · Request sent":""):"";
 const {label,tone,away}=socialPresenceDisplay(account);
 return <small className={styles.presence} data-tone={tone} title={away&&label!=="Away"?label+" (Away)":label} aria-label={label+(away&&label!=="Away"?", away":"")+pending}><i aria-hidden="true"/>{label}{pending}</small>;
}
function allAccounts(snapshot:ReturnType<typeof useSocial>["snapshot"]){
 const result=new Map<string,SocialAccountSummary>();
 for(const account of [...snapshot.offlineBrawlers,...snapshot.onlineBrawlers,...snapshot.outgoingRequests,...snapshot.incomingRequests,...snapshot.friends])result.set(account.userId,account);
 return result;
}
export function SocialMenuButton(){
 const {snapshot,inbox,open,setOpen}=useSocial(),count=snapshot.unreadCount+inbox.unreadCount;
 return <button type="button" className={styles.socialButton} aria-label={"Social menu"+(count?", "+count+" outstanding notifications":"")} aria-haspopup="dialog" aria-expanded={open} aria-controls="social-drawer" onClick={()=>setOpen(!open)}>
  <LucideIcon name="users" size={23}/><Badge count={count}/>
 </button>;
}
function ActionButton({children,onClick,disabled=false}:{children:ReactNode;onClick():void;disabled?:boolean}){
 return <button type="button" className="bb-button" disabled={disabled} onClick={onClick}>{children}</button>;
}
export function SocialOptions({account,includeMessage=false}:{account:SocialAccountSummary;includeMessage?:boolean}){
 const {snapshot,inbox,perform,refreshInbox,openConversation}=useSocial();
 const {notify}=useAppFields(["notify"]);
 const current=allAccounts(snapshot).get(account.userId)??account;
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[report,setReport]=useState(false),[reason,setReason]=useState(""),[error,setError]=useState("");
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
 const [position,setPosition]=useState({top:0,right:0});
 const blocked=inbox.blockedIds.includes(account.userId);
 const close=()=>{setOpen(false);setReport(false);setError("");};
 useEffect(()=>{
  if(!open)return;
  panel.current?.querySelector<HTMLElement>("button:not(:disabled), textarea")?.focus();
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node)){setOpen(false);setReport(false);}};
  const escape=(e:KeyboardEvent)=>{if(e.key==="Escape"){e.preventDefault();e.stopPropagation();setOpen(false);setReport(false);trigger.current?.focus();}};
  const scroll=(e:Event)=>{if(!(e.target instanceof Node)||!root.current?.contains(e.target)){setOpen(false);setReport(false);}};
  document.addEventListener("pointerdown",outside);document.addEventListener("keydown",escape,true);window.addEventListener("resize",scroll);document.addEventListener("scroll",scroll,true);
  return()=>{document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",escape,true);window.removeEventListener("resize",scroll);document.removeEventListener("scroll",scroll,true);};
 },[open]);
 useLayoutEffect(()=>{
  if(!open)return;
  const rect=trigger.current?.getBoundingClientRect(),height=panel.current?.getBoundingClientRect().height??0;
  if(rect)setPosition({top:Math.max(8,Math.min(rect.bottom+4,window.innerHeight-height-8)),right:Math.max(8,window.innerWidth-rect.right)});
 },[open,report,error]);
 const run=async(action:string)=>{
  if(busy)return;setBusy(true);setError("");
  try{
   if(action==="block"||action==="unblock"||action==="report"){
    await messageRequest("",{action,peer:current.userId,...(action==="report"?{reason}:{})});
    await refreshInbox();notify(action==="report"?"Report submitted.":action==="block"?"Messages blocked.":"Messages unblocked.");setReason("");
   }else await perform(action,current);
   close();trigger.current?.focus();
  }catch(cause){setError(cause instanceof Error?cause.message:"Social action failed.");}
  finally{setBusy(false);}
 };
 return <div className={styles.optionsRoot} ref={root}>
  <button ref={trigger} type="button" className={styles.iconButton} aria-label={"Options for "+current.displayName} aria-expanded={open} aria-haspopup="dialog" onClick={()=>{
   if(open){close();return;}
   const rect=trigger.current?.getBoundingClientRect();
   if(rect)setPosition({top:Math.max(8,Math.min(rect.bottom+4,window.innerHeight-310)),right:Math.max(8,window.innerWidth-rect.right)});
   setOpen(true);
  }}><LucideIcon name="ellipsis"/></button>
  {open&&<div ref={panel} className={styles.optionsMenu} role="dialog" aria-label={"Actions for "+current.displayName} style={position}>
   {report?<form onSubmit={e=>{e.preventDefault();void run("report");}} className={styles.reportForm}>
    <label>Report {current.displayName}<textarea className="bb-field" autoFocus maxLength={1800} minLength={20} required value={reason} onChange={e=>setReason(e.target.value)} placeholder="Describe the issue…"/></label>
    <small>Your description and this Brawler’s account are sent to administrators. Private messages are not attached.</small>
    <button className="bb-button bb-button--primary" disabled={busy||reason.trim().length<20} type="submit">Submit report</button>
    <button className="bb-button" type="button" onClick={()=>setReport(false)}>Back</button>
   </form>:<>
    {includeMessage&&<button type="button" onClick={()=>{close();openConversation(current);}}>Message</button>}
    {current.relationship==="none"&&<button type="button" disabled={busy} onClick={()=>void run("request-friend")}>Add friend</button>}
    {current.relationship==="incoming"&&<><button type="button" disabled={busy} onClick={()=>void run("accept-friend")}>Accept friend request</button><button type="button" disabled={busy} onClick={()=>void run("decline-friend")}>Decline friend request</button></>}
    {current.relationship==="outgoing"&&<button type="button" disabled={busy} onClick={()=>void run("cancel-friend")}>Cancel friend request</button>}
    {current.relationship==="friend"&&<button type="button" disabled={busy} onClick={()=>void run("remove-friend")}>Remove friend</button>}
    <button type="button" disabled={busy||!snapshot.activeLobby} title={snapshot.activeLobby?"Invite to your lobby":"Host a lobby with an open slot first."} onClick={()=>void run("invite")}>Invite to lobby</button>
    <button type="button" disabled={busy} onClick={()=>void run(blocked?"unblock":"block")}>{blocked?"Unblock messages":"Block messages"}</button>
    <button type="button" disabled={busy} onClick={()=>setReport(true)}>Report Brawler</button>
   </>}
   {error&&<p role="alert" className={styles.error}>{error}</p>}
  </div>}
 </div>;
}
export function SocialAccountActions({account,compact=false}:{account:SocialAccountSummary;compact?:boolean}){return <div data-compact={compact} className={styles.optionsRoot}><SocialOptions account={account} includeMessage/></div>;}
function BrawlerRow({account,subtitle}:{account:SocialAccountSummary;subtitle?:string}){
 const {inbox,openConversation}=useSocial();
 const count=inbox.conversations.find(item=>item.peerId===account.userId)?.unread??0;
 return <div className={styles.row}>
  <SocialAvatar account={account}/>
  <button type="button" className={styles.identity} onClick={()=>openConversation(account)}>
   <strong>{account.displayName}</strong>{subtitle?<small>{subtitle}</small>:<Presence account={account} showRelationship/>}
  </button>
  <div className={styles.badgeSlot}>{count>0&&<button type="button" aria-label={count+" unread messages from "+account.displayName} onClick={()=>openConversation(account)}><Badge count={count}/></button>}</div>
  <SocialOptions account={account}/>
 </div>;
}
function Brawlers({query,setQuery,collapsed,setCollapsed}:{query:string;setQuery(value:string):void;collapsed:string[];setCollapsed(value:string[]):void}){
 const {snapshot,loading}=useSocial();
 const friends=sortSocialAccounts(snapshot.friends),friendIds=new Set(friends.map(a=>a.userId));
 const pending=new Map([...snapshot.incomingRequests,...snapshot.outgoingRequests].map(a=>[a.userId,a]));
 const decorate=(account:SocialAccountSummary)=>({...account,relationship:pending.get(account.userId)?.relationship??account.relationship});
 const online=sortSocialAccounts(snapshot.onlineBrawlers.filter(a=>!friendIds.has(a.userId)).map(decorate));
 const onlineIds=new Set(online.map(a=>a.userId));
 const offline=sortSocialAccounts(snapshot.offlineBrawlers.filter(a=>!friendIds.has(a.userId)&&!onlineIds.has(a.userId)).map(decorate));
 const groups=[{name:"Friends",accounts:friends,count:friends.filter(a=>a.online).length+"/"+friends.length},{name:"Online",accounts:online,count:String(online.length)},{name:"Offline",accounts:offline,count:String(offline.length)}];
 const needle=query.trim().toLocaleLowerCase();
 return <>
  <div className={styles.search}><LucideIcon name="search" size={18}/><input aria-label="Search Brawlers" type="search" placeholder="Search Brawlers…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
  <div className={styles.list}>
   {groups.map(group=>{
    const matches=group.accounts.filter(a=>a.displayName.toLocaleLowerCase().includes(needle));
    if(needle&&!matches.length)return null;
    const expanded=Boolean(needle)||!collapsed.includes(group.name);
    return <section key={group.name}>
     <button type="button" aria-expanded={expanded} className={styles.group} disabled={Boolean(needle)} onClick={()=>setCollapsed(collapsed.includes(group.name)?collapsed.filter(name=>name!==group.name):[...collapsed,group.name])}>
      <LucideIcon name={expanded?"chevron-down":"chevron-right"} size={15}/><span>{group.name}</span><small>{needle?matches.length:group.count}</small>
     </button>
     {expanded&&matches.map(account=><BrawlerRow key={account.userId} account={account}/>)}
     {expanded&&!matches.length&&!loading&&<p className={styles.empty}>No {group.name.toLowerCase()} Brawlers.</p>}
    </section>;
   })}
   {needle&&!groups.some(g=>g.accounts.some(a=>a.displayName.toLocaleLowerCase().includes(needle)))&&<p className={styles.empty}>No matching Brawlers.</p>}
   {loading&&!friends.length&&!online.length&&!offline.length&&<p role="status" className={styles.empty}>Loading Brawlers…</p>}
  </div>
 </>;
}
function Inbox(){
 const {inbox,snapshot,messageError,inboxRevision,loading}=useSocial(),{authUser}=useAppFields(["authUser"]);
 const accounts=allAccounts(snapshot);
 const items=inbox.conversations.flatMap(item=>{const account=accounts.get(item.peerId);return account?[{item,account}]:[];});
 return <div className={styles.list}>
  {items.map(({item,account})=><BrawlerRow key={account.userId} account={account} subtitle={(item.latest.senderId===authUser?.id?"You: ":"")+item.latest.body}/>)}
  {!items.length&&!messageError&&(inboxRevision===0||loading&&inbox.conversations.length>0?<p className={styles.empty} role="status">Loading conversations…</p>:<p className={styles.empty}>No conversations yet. Select a Brawler to start messaging.</p>)}
 </div>;
}
function Requests(){
 const {snapshot,perform,openConversation}=useSocial();
 const [busy,setBusy]=useState(""),[error,setError]=useState("");
 const act=async(action:string,account?:SocialAccountSummary,invite?:LobbyInviteSummary)=>{
  if(busy)return;setBusy(account?.userId??invite?.id??action);setError("");
  try{await perform(action,account,invite?.id);}catch(cause){setError(cause instanceof Error?cause.message:"Request failed.");}
  finally{setBusy("");}
 };
 return <div className={styles.list}>
  {error&&<p className={styles.error} role="alert">{error}</p>}
  <section><h3 className={styles.groupLabel}>Lobby invitations <small>{snapshot.invitations.length}</small></h3>
   {snapshot.invitations.map(invite=><article key={invite.id} className={styles.request}>
    <div className={styles.requestIdentity}><SocialAvatar account={invite.inviter}/><button type="button" className={styles.identity} onClick={()=>openConversation(invite.inviter)}><strong>{invite.inviter.displayName}</strong><small>{invite.rulesFormat} · {invite.format==="bo3"?"Best of 3":"Best of 1"}</small></button></div>
    <div className={styles.requestActions}><button type="button" disabled={Boolean(busy)} className="bb-button bb-button--primary" onClick={()=>void act("accept-invite",undefined,invite)}>Join lobby</button><ActionButton disabled={Boolean(busy)} onClick={()=>void act("decline-invite",undefined,invite)}>Decline</ActionButton></div>
   </article>)}
   {!snapshot.invitations.length&&<p className={styles.empty}>No lobby invitations.</p>}
  </section>
  <section><h3 className={styles.groupLabel}>Incoming friend requests <small>{snapshot.incomingRequests.length}</small></h3>
   {snapshot.incomingRequests.map(account=><article key={account.userId} className={styles.request}><div className={styles.requestIdentity}><SocialAvatar account={account}/><button type="button" className={styles.identity} onClick={()=>openConversation(account)}><strong>{account.displayName}</strong><Presence account={account}/></button></div><div className={styles.requestActions}><ActionButton disabled={Boolean(busy)} onClick={()=>void act("accept-friend",account)}>Accept</ActionButton><ActionButton disabled={Boolean(busy)} onClick={()=>void act("decline-friend",account)}>Decline</ActionButton></div></article>)}
   {!snapshot.incomingRequests.length&&<p className={styles.empty}>No incoming requests.</p>}
  </section>
  <section><h3 className={styles.groupLabel}>Outgoing friend requests <small>{snapshot.outgoingRequests.length}</small></h3>
   {snapshot.outgoingRequests.map(account=>(
    <article key={account.userId} className={styles.request}>
     <div className={styles.requestIdentity}>
      <SocialAvatar account={account}/>
      <button type="button" className={styles.identity} onClick={()=>openConversation(account)}>
       <strong>{account.displayName}</strong><small>Awaiting response</small>
      </button>
     </div>
     <div className={styles.requestActions}>
      <ActionButton disabled={Boolean(busy)} onClick={()=>void act("cancel-friend",account)}>Cancel</ActionButton>
     </div>
    </article>
   ))}
   {!snapshot.outgoingRequests.length&&<p className={styles.empty}>No outgoing requests.</p>}
  </section>
 </div>;
}
export function SocialDrawer(){
 const {authUser,requestAccountAccess}=useAppFields(["authUser","requestAccountAccess"]);
 const {snapshot,inbox,open,setOpen,tab,setTab,peer,setPeer,socialError,messageError,refresh,refreshInbox}=useSocial();
 const dialog=useRef<HTMLDialogElement>(null);
 const [query,setQuery]=useState(""),[collapsed,setCollapsed]=useState<string[]>([]);
 useEffect(()=>{
  const node=dialog.current;if(!open||!node)return;
  const overflow=document.body.style.overflow;
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  document.body.style.overflow="hidden";node.showModal();
  return()=>{
    if(node.open)node.close();
    document.body.style.overflow=overflow;
    if(previous?.isConnected&&(document.activeElement===document.body||node.contains(document.activeElement)))previous.focus();
  };
 },[open]);
 if(!open)return null;
 const current=peer?(allAccounts(snapshot).get(peer.userId)??peer):null;
 return <dialog ref={dialog} id="social-drawer" className={styles.drawer} aria-labelledby="social-title" onCancel={e=>{e.preventDefault();setOpen(false);}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)setOpen(false);}}}>
  <header className={styles.header}><h2 id="social-title">Social</h2><button className={styles.iconButton} type="button" aria-label="Close social menu" onClick={()=>setOpen(false)}><LucideIcon name="x" size={24}/></button></header>
  {!authUser?<div className={styles.guest}><LucideIcon name="users" size={40}/><h3>Connect with Brawlers</h3><p>Log in to find Brawlers, send messages, add friends and join lobby invitations.</p><button className="bb-button bb-button--primary" type="button" onClick={()=>{setOpen(false);requestAccountAccess("login");}}>Log in</button><button className="bb-button" type="button" onClick={()=>{setOpen(false);requestAccountAccess("signup");}}>Register</button></div>:<>
   <nav className={styles.tabs} aria-label="Social views">{tabs.map(item=><button type="button" key={item.name} aria-pressed={tab===item.name} onClick={()=>{setTab(item.name);if(item.name==="Messages")setPeer(null);}}><LucideIcon name={item.icon} size={17}/><span>{item.name}</span><Badge count={item.name==="Messages"?inbox.unreadCount:item.name==="Requests"?snapshot.unreadCount:0}/></button>)}</nav>
   {(socialError||messageError)&&<div className={styles.warning} role="status"><span>{socialError||messageError}</span><button type="button" className="bb-button" onClick={()=>{void refresh();void refreshInbox();}}>Retry</button></div>}
   {tab==="Brawlers"?<Brawlers query={query} setQuery={setQuery} collapsed={collapsed} setCollapsed={setCollapsed}/>:tab==="Requests"?<Requests/>:current?<Conversation key={current.userId} account={current}/>:<Inbox/>}
  </>}
 </dialog>;
}
