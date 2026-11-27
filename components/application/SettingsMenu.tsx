"use client";

import {useEffect,useLayoutEffect,useRef,useState,useId,type KeyboardEvent} from "react";
import {usePathname} from "next/navigation";
import {LucideIcon,type LucideIconName} from "../design-system/LucideIcon";
import {useAppFields} from "./AppProvider";
import {useLobbySession} from "./LobbySessionProvider";
import {isCompletedSeriesResult} from "../../lib/match-result-navigation";
import type {AppSettings} from "../../lib/persistence";
import {LOG_DETAIL_OPTIONS,normalizeAppSettings,patchPreferences,restorePreferenceCategory,type PreferenceCategory} from "../../lib/settings-preferences";
import {SettingsAccount,type AccountView,ACCOUNT_VIEW_TITLES} from "./SettingsAccount";
import styles from "./SettingsMenu.module.css";

const categories=[
  {name:"Gameplay",icon:"gamepad-2",description:"Automatic actions and event log"},
  {name:"Display",icon:"monitor",description:"Scaling, motion and accessibility"},
  {name:"Audio",icon:"volume-2",description:"Music, sound effects and volume"},
  {name:"Account",icon:"user-round",description:"Account details, security and data"},
] as const satisfies readonly {name:string;icon:LucideIconName;description:string}[];
type Category=typeof categories[number]["name"];
type Patch=(patch:Partial<AppSettings>)=>void;

function Toggle({label,description,checked,onChange}:{label:string;description:string;checked:boolean;onChange:(value:boolean)=>void}){
  const descriptionId=useId();
  return <div className={styles.setting}>
    <span className={styles.description}><strong>{label}</strong><small id={descriptionId}>{description}</small></span>
    <button type="button" className={styles.switch} role="switch" aria-describedby={descriptionId} aria-label={label} aria-checked={checked} onClick={()=>onChange(!checked)}><i aria-hidden="true"/></button>
  </div>;
}
function Range({label,description,value,onChange,min=0,max=100,disabled=false}:{label:string;description?:string;value:number;onChange:(value:number)=>void;min?:number;max?:number;disabled?:boolean}){
  return <label className={styles.range}>
    <span className={styles.rangeHeader}><span className={styles.description}><strong>{label}</strong>{description&&<small>{description}</small>}</span><output>{value}%</output></span>
    <input type="range" min={min} max={max} step={1} value={value} aria-label={label} disabled={disabled} onChange={event=>onChange(Number(event.target.value))}/>
  </label>;
}
function AudioChannel({label,description,enabled,volume,onEnabled,onVolume}:{label:string;description:string;enabled:boolean;volume:number;onEnabled:(value:boolean)=>void;onVolume:(value:number)=>void}){
  return <div className={styles.channel}>
    <Toggle label={label} description={description} checked={enabled} onChange={onEnabled}/>
    <Range label={label+" volume"} value={volume} onChange={onVolume} disabled={!enabled}/>
  </div>;
}
function Preferences({category,settings,patch}:{category:PreferenceCategory;settings:AppSettings;patch:Patch}){
  if(category==="Gameplay")return <>
    <Toggle label="Automatic Draw" description="Draw immediately when the Draw Step begins, preserving the normal draw animation." checked={Boolean(settings.automaticDraw)} onChange={automaticDraw=>patch({automaticDraw})}/>
    <Toggle label="Automatic Pass" description="Pass priority only when no other legal action is available." checked={Boolean(settings.automaticPass)} onChange={automaticPass=>patch({automaticPass})}/>
    <label className={styles.selectSetting}>
      <span className={styles.description}><strong>Default Event Log Filter</strong><small>Choose the initial event filter shown during games. You can still change it in the Event Log.</small></span>
      <select className="bb-field" value={settings.logDetail} onChange={event=>patch({logDetail:event.target.value})}>
        {LOG_DETAIL_OPTIONS.map(option=><option key={option.filter}>{option.label}</option>)}
      </select>
    </label>
  </>;
  if(category==="Display")return <>
    <Range label="Preview Scale" description="Adjust supported card and BakuCore previews." value={settings.cardScale} min={80} max={140} onChange={cardScale=>patch({cardScale})}/>
    <Range label="Text Scale" description="Adjust supported interface text." value={settings.textScale??100} min={80} max={140} onChange={textScale=>patch({textScale})}/>
    <Toggle label="Reduced Motion" description="Reduce non-essential interface animations and transitions." checked={settings.reducedMotion} onChange={reducedMotion=>patch({reducedMotion})}/>
    <Toggle label="High Contrast" description="Increase shared interface, border and focus contrast." checked={settings.highContrast} onChange={highContrast=>patch({highContrast})}/>
  </>;
  return <>
    <Range label="Master Volume" description="Overall output for music and sound effects." value={settings.masterVolume??100} onChange={masterVolume=>patch({masterVolume})}/>
    <AudioChannel label="Music" description="Menu, Training, battle and match-result soundtrack." enabled={settings.musicEnabled!==false} volume={settings.musicVolume??55} onEnabled={musicEnabled=>patch({musicEnabled})} onVolume={musicVolume=>patch({musicVolume})}/>
    <AudioChannel label="UI Sounds" description="Navigation and interface control feedback." enabled={settings.uiSoundsEnabled!==false} volume={settings.uiSoundVolume??70} onEnabled={uiSoundsEnabled=>patch({uiSoundsEnabled})} onVolume={uiSoundVolume=>patch({uiSoundVolume})}/>
    <AudioChannel label="Game Sounds" description="Cards, rolls, damage, priority and match-result cues." enabled={settings.gameSoundsEnabled!==false} volume={settings.gameSoundVolume??55} onEnabled={gameSoundsEnabled=>patch({gameSoundsEnabled})} onVolume={gameSoundVolume=>patch({gameSoundVolume})}/>
  </>;
}

export function SettingsMenu({onClose}:{onClose:()=>void}){
  const {settings,setSettings,authUser,match}=useAppFields(["settings","setSettings","authUser","match"]);
  const lobby=useLobbySession(),pathname=usePathname();
  const [mobile,setMobile]=useState(false);
  const [category,setCategory]=useState<Category|null>(null);
  const [accountView,setAccountView]=useState<AccountView>("overview");
  const [accountBusy,setAccountBusy]=useState(false);
  const dialogRef=useRef<HTMLDialogElement>(null),headingRef=useRef<HTMLHeadingElement>(null),contentRef=useRef<HTMLDivElement>(null);
  const tabsRef=useRef<HTMLDivElement>(null);
  const selected=mobile?category:category??"Gameplay";
  const subview=selected==="Account"&&accountView!=="overview";
  const locked=pathname==="/play/match"||Boolean(match&&!isCompletedSeriesResult(match))||lobby.recovery?.status==="member"||lobby.recovery?.status==="identity-conflict"||lobby.recovery?.status==="checking"||Boolean(lobby.unavailable);
  const normalized=normalizeAppSettings(settings);
  const patch:Patch=values=>setSettings((current:AppSettings)=>patchPreferences(current,values));
  useLayoutEffect(()=>{
    const query=window.matchMedia("(max-width: 850px)");
    const update=()=>setMobile(query.matches);
    update();query.addEventListener("change",update);
    return()=>query.removeEventListener("change",update);
  },[]);
  useEffect(()=>{
    const dialog=dialogRef.current;if(!dialog)return;
    const previous=document.body.style.overflow;
    document.body.style.overflow="hidden";
    dialog.showModal();
    headingRef.current?.focus();
    return()=>{if(dialog.open)dialog.close();document.body.style.overflow=previous;};
  },[]);
  useEffect(()=>{
    if(contentRef.current)contentRef.current.scrollTop=0;
    if(mobile||subview)headingRef.current?.focus();
  },[selected,mobile,subview,accountView]);

  const choose=(next:Category)=>{if(accountBusy)return;setCategory(next);setAccountView("overview");};
  const goBack=()=>{if(accountBusy)return;if(subview)setAccountView("overview");else if(mobile)setCategory(null);};
  const close=()=>{if(!accountBusy)onClose();};
  const tabKeys=(event:KeyboardEvent<HTMLDivElement>)=>{
    const current=categories.findIndex(item=>item.name===selected);
    let next=current;
    if(event.key==="ArrowRight")next=(current+1)%categories.length;
    else if(event.key==="ArrowLeft")next=(current+categories.length-1)%categories.length;
    else if(event.key==="Home")next=0;
    else if(event.key==="End")next=categories.length-1;
    else return;
    if(accountBusy)return;
    event.preventDefault();choose(categories[next].name);
    tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  return <dialog data-settings-menu="true" ref={dialogRef} className={styles.dialog} aria-label="Settings"
    onCancel={event=>{event.preventDefault();close();}}
    onClick={event=>{if(event.target!==event.currentTarget||mobile)return;const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();}}>
    <header className={styles.header}>
      {(subview||mobile&&selected)&&<button type="button" className={styles.iconButton} aria-label={subview?"Back to Account":"Back to Settings categories"} disabled={accountBusy} onClick={goBack}><LucideIcon name="arrow-left" size={24}/></button>}
      <h2 tabIndex={-1} ref={headingRef}>{subview?ACCOUNT_VIEW_TITLES[accountView]:mobile&&selected?selected:"Settings"}</h2>
      <button type="button" className={styles.iconButton} aria-label="Close settings" disabled={accountBusy} onClick={close}><LucideIcon name="x" size={24}/></button>
    </header>
    {!mobile&&!subview&&<div ref={tabsRef} className={styles.tabs} role="tablist" aria-label="Settings categories" onKeyDown={tabKeys}>
      {categories.map(item=><button type="button" role="tab" id={"settings-tab-"+item.name} aria-controls={"settings-panel-"+item.name} aria-selected={selected===item.name} tabIndex={selected===item.name?0:-1} key={item.name} disabled={accountBusy} onClick={()=>choose(item.name)}>
        <LucideIcon name={item.icon} size={19}/><span>{item.name}</span>
      </button>)}
    </div>}
    <div ref={contentRef} className={styles.content} id={selected?"settings-panel-"+selected:undefined} role={!mobile&&!subview?"tabpanel":undefined} aria-labelledby={!mobile&&!subview&&selected?"settings-tab-"+selected:undefined}>
      {!selected?<nav aria-label="Settings categories" className={styles.categories}>
        {categories.map(item=><button type="button" key={item.name} className={styles.categoryRow} onClick={()=>choose(item.name)}>
          <LucideIcon name={item.icon} size={24}/><span className={styles.description}><strong>{item.name}</strong><small>{item.description}</small></span><LucideIcon name="chevron-right" size={18}/>
        </button>)}
      </nav>:selected==="Account"?<SettingsAccount key={accountView+":"+(authUser?.id??"guest")} view={accountView} setView={setAccountView} locked={locked} onBusyChange={setAccountBusy} closeSettings={onClose}/>:<Preferences category={selected} settings={normalized} patch={patch}/>}
    </div>
    {selected&&selected!=="Account"&&<footer className={styles.footer}>
      <button type="button" className="bb-button" onClick={()=>setSettings((current:AppSettings)=>restorePreferenceCategory(current,selected))}>Restore Defaults</button>
    </footer>}
  </dialog>;
}
