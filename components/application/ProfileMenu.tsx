"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {useEffect,useRef,useState,type RefObject} from "react";
import {PROFILE_TITLE_CATALOGUE} from "../../lib/profile-customization";
import {LucideIcon,type LucideIconName} from "../design-system/LucideIcon";
import {ProfileAvatar} from "../profile/ProfileAvatar";
import {PresenceIndicator} from "../social/PresenceIndicator";
import {useSocial} from "../social/SocialProvider";
import {useAppFields} from "./AppProvider";
import {useSettingsMenu} from "./SettingsMenuProvider";
import styles from "./ProfileMenu.module.css";

type FeedbackComponent=typeof import("./FeedbackReportsDialog").default;
const personalDestinations:readonly {href:string;label:string;icon:LucideIconName}[]=[
  {href:"/profile",label:"View Profile",icon:"user-round"},
  {href:"/profile/achievements",label:"Achievements",icon:"trophy"},
  {href:"/profile/records",label:"Match Records",icon:"history"},
  {href:"/collection",label:"Collection",icon:"layers"},
];

function MenuLink({href,label,icon,onClose}:{href:string;label:string;icon:LucideIconName;onClose:()=>void}){
  return <Link href={href} className={styles.row} onClick={onClose}>
    <LucideIcon name={icon}/><span>{label}</span>
  </Link>;
}
function MenuAction({label,icon,onClick,danger=false,disabled=false}:{label:string;icon:LucideIconName;onClick:()=>void;danger?:boolean;disabled?:boolean}){
  return <button type="button" className={styles.row} data-danger={danger||undefined} disabled={disabled} onClick={onClick}>
    <LucideIcon name={icon}/><span>{label}</span>
  </button>;
}

export function ProfileMenu({open,onClose,triggerRef,onLogout}:{
  open:boolean;
  onClose:()=>void;
  triggerRef:RefObject<HTMLButtonElement|null>;
  onLogout:()=>void|Promise<void>;
}){
  const {profile,authUser,requestAccountAccess}=useAppFields(["profile","authUser","requestAccountAccess"]);
  const {snapshot,socialError,refresh,open:socialOpen}=useSocial();
  const pathname=usePathname();
  const {openSettings}=useSettingsMenu();
  const dialogRef=useRef<HTMLDialogElement>(null);
  const closeRef=useRef<HTMLButtonElement>(null);
  const [feedbackOpen,setFeedbackOpen]=useState(false);
  const [FeedbackDialog,setFeedbackDialog]=useState<FeedbackComponent|null>(null);
  const [feedbackLoading,setFeedbackLoading]=useState(false);
  const [feedbackError,setFeedbackError]=useState("");
  const loadGeneration=useRef(0);
  const openRef=useRef(open);
  openRef.current=open;
  const administrator=authUser?.roles?.includes("administrator")===true;
  const title=PROFILE_TITLE_CATALOGUE.find(item=>item.id===profile?.titleId)?.label??PROFILE_TITLE_CATALOGUE[0].label;
  const faction=authUser&&["Pyrus","Aquos","Darkus","Haos","Ventus","Aurelus"].includes(profile?.faction)?profile.faction:authUser?"Pyrus":"Guest";
  const name=profile?.name||authUser?.displayName||"Player";
  const presence=snapshot.selfPresence;
  const identity=presence&&!socialError?{online:presence.kind!=="offline",presence}:undefined;

  useEffect(()=>{
    if(open&&authUser)void refresh();
  },[open,authUser,refresh]);
  useEffect(()=>{setFeedbackOpen(false);},[pathname,socialOpen]);
  useEffect(()=>{
    if(!open){setFeedbackLoading(false);setFeedbackError("");}
    return()=>{loadGeneration.current++;};
  },[open]);
  useEffect(()=>{
    const dialog=dialogRef.current;
    if(!open||!dialog)return;
    const mobile=window.matchMedia("(max-width: 850px)");
    let previousOverflow:string|undefined;
    const unlock=()=>{
      if(previousOverflow!==undefined){document.body.style.overflow=previousOverflow;previousOverflow=undefined;}
    };
    const show=()=>{
      if(dialog.open)dialog.close();
      unlock();
      if(mobile.matches){
        previousOverflow=document.body.style.overflow;
        document.body.style.overflow="hidden";
        dialog.showModal();
      }else dialog.show();
      closeRef.current?.focus();
    };
    const outside=(event:PointerEvent)=>{
      if(!mobile.matches&&event.target instanceof Node&&!dialog.contains(event.target)&&!triggerRef.current?.contains(event.target))onClose();
    };
    const focusOutside=(event:FocusEvent)=>{
      if(!mobile.matches&&event.target instanceof Node&&!dialog.contains(event.target)&&!triggerRef.current?.contains(event.target))onClose();
    };
    const escape=(event:KeyboardEvent)=>{
      if(!mobile.matches&&event.key==="Escape"){event.preventDefault();onClose();}
    };
    show();
    mobile.addEventListener("change",show);
    document.addEventListener("pointerdown",outside);
    document.addEventListener("focusin",focusOutside);
    document.addEventListener("keydown",escape);
    return()=>{
      mobile.removeEventListener("change",show);
      document.removeEventListener("pointerdown",outside);
      document.removeEventListener("focusin",focusOutside);
      document.removeEventListener("keydown",escape);
      const shouldRestore=dialog.contains(document.activeElement)||document.activeElement===document.body;
      if(dialog.open)dialog.close();
      unlock();
      if(shouldRestore&&triggerRef.current?.isConnected)triggerRef.current.focus();
    };
  },[open,onClose,triggerRef]);

  const access=(mode:"login"|"signup")=>{onClose();setFeedbackOpen(false);requestAccountAccess(mode);};
  const closeFeedback=()=>{setFeedbackOpen(false);requestAnimationFrame(()=>{if(triggerRef.current?.isConnected&&!document.querySelector("dialog[open]:modal"))triggerRef.current.focus();});};
  const showFeedback=async()=>{
    if(feedbackLoading)return;
    const generation=++loadGeneration.current;
    setFeedbackLoading(true);setFeedbackError("");
    try{
      const module=await import("./FeedbackReportsDialog");
      if(generation!==loadGeneration.current||!openRef.current)return;
      setFeedbackDialog(()=>module.default);
      onClose();setFeedbackOpen(true);
    }catch{
      if(generation===loadGeneration.current&&openRef.current)setFeedbackError("Feedback could not be loaded. Please try again.");
    }finally{
      if(generation===loadGeneration.current)setFeedbackLoading(false);
    }
  };
  return <>
    {open&&<dialog id="site-profile-menu" ref={dialogRef} aria-label="Profile menu" className={styles.menu}
      onCancel={event=>{event.preventDefault();onClose();}}>
      <div className={styles.heading}>
        {authUser?<Link href="/profile" onClick={onClose} className={styles.identity} aria-label="Open your profile">
          <span className={styles.avatarFrame} data-faction={faction}>
            <ProfileAvatar profile={{name,avatar:profile?.avatar??""}} className={styles.avatar}/>
          </span>
          <span className={styles.identityText}>
            <strong>{name}</strong><span className={styles.title}>{title}</span>
            <PresenceIndicator account={identity} unavailable={Boolean(socialError)}/>
          </span>
        </Link>:<div className={styles.identity}>
          <span className={styles.avatarFrame} data-faction="Guest"><LucideIcon name="user-round" size={30}/></span>
          <span className={styles.identityText}><strong>Guest</strong><span className={styles.title}>Not signed in</span></span>
        </div>}
        <button type="button" ref={closeRef} className={styles.close} aria-label="Close profile menu" onClick={onClose}><LucideIcon name="x" size={24}/></button>
      </div>
      {authUser?<nav aria-label="Personal features" className={styles.group} data-section="personal">
        {personalDestinations.map(item=><MenuLink key={item.href} {...item} onClose={onClose}/>)}
      </nav>:<div className={styles.guestActions} data-section="guest">
        <p>Create an account to save your progress, unlock rewards and connect with other Brawlers.</p>
        <button type="button" className="bb-button bb-button--primary" onClick={()=>access("signup")}>Create Account</button>
        <button type="button" className="bb-button" onClick={()=>access("login")}>Log In</button>
      </div>}
      <nav aria-label="Utilities" className={styles.group} data-section="utilities">
        <MenuAction label="Settings" icon="settings" onClick={()=>{onClose();openSettings(triggerRef.current);}}/>
        <MenuAction label={feedbackLoading?"Loading feedback…":"Feedback & Reports"} icon="message-square" disabled={feedbackLoading} onClick={()=>void showFeedback()}/>
        {feedbackError&&<p className={styles.error} role="alert">{feedbackError}</p>}
        {administrator&&<MenuLink href="/admin" label="Administration" icon="shield" onClose={onClose}/>}
      </nav>
      {authUser&&<div className={styles.session} data-section="session">
        <MenuAction label="Sign Out" icon="log-out" danger onClick={()=>{onClose();void onLogout();}}/>
      </div>}
    </dialog>}
    {feedbackOpen&&FeedbackDialog&&<FeedbackDialog onClose={closeFeedback}/>}
  </>;
}
