"use client";

import {useEffect,useState,type FormEvent,type ReactNode} from "react";
import {useAppFields} from "./AppProvider";
import {LucideIcon,type LucideIconName} from "../design-system/LucideIcon";
import {generateRecoveryCode} from "../../lib/recovery-code";
import {readJsonResponse} from "../../lib/json-response";
import {scheduleGuestReset} from "../../lib/guest-reset";
import styles from "./SettingsMenu.module.css";

export const ACCOUNT_VIEW_TITLES={
  overview:"Account",
  name:"Change Brawler Name",
  password:"Change Password",
  recovery:"Replace Recovery Code",
  local:"Delete Local Data",
  delete:"Delete Account",
} as const;
export type AccountView=keyof typeof ACCOUNT_VIEW_TITLES;
function AccountRow({label,icon,onClick,danger=false,disabled=false,description}:{label:string;icon:LucideIconName;onClick:()=>void;danger?:boolean;disabled?:boolean;description?:string}){
  return <button type="button" className={styles.accountRow} data-danger={danger||undefined} disabled={disabled} onClick={onClick}>
    <LucideIcon name={icon}/><span className={styles.description}><strong>{label}</strong>{description&&<small>{description}</small>}</span><LucideIcon name="chevron-right" size={17}/>
  </button>;
}
function Group({title,children}:{title:string;children:ReactNode}){
  return <section className={styles.accountGroup}><h3>{title}</h3>{children}</section>;
}
export function SettingsAccount({view,setView,locked,onBusyChange,closeSettings}:{
  view:AccountView;setView:(view:AccountView)=>void;locked:boolean;onBusyChange:(busy:boolean)=>void;closeSettings:()=>void;
}){
  const {profile,authUser,settings,decks,history,collection,saveAccountProfile,requestAccountAccess,changePassword,deleteAccount}=useAppFields(["profile","authUser","settings","decks","history","collection","saveAccountProfile","requestAccountAccess","changePassword","deleteAccount"]);
  const [name,setName]=useState(profile.name);
  const [currentPassword,setCurrentPassword]=useState(""),[newPassword,setNewPassword]=useState("");
  const [recoveryPassword,setRecoveryPassword]=useState(""),[replacementCode,setReplacementCode]=useState("");
  const [confirmation,setConfirmation]=useState(""),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false);
  useEffect(()=>()=>onBusyChange(false),[onBusyChange]);
  const run=async(operation:()=>Promise<void>|void)=>{
    if(locked||busy)return;
    setBusy(true);onBusyChange(true);setError("");setNotice("");
    try{await operation();}
    catch(cause){setError(cause instanceof Error?cause.message:"The account action could not be completed.");}
    finally{setBusy(false);onBusyChange(false);}
  };
  const submit=(operation:()=>Promise<void>|void)=>(event:FormEvent)=>{event.preventDefault();void run(operation);};
  const access=(mode:"login"|"signup")=>{if(locked)return;closeSettings();requestAccountAccess(mode);};
  const exportData=()=>{
    try{
      const data={schemaVersion:1,exportedAt:new Date().toISOString(),scope:authUser?"account":"guest",profile,decks,history,settings,collection};
      const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
      const anchor=document.createElement("a");anchor.href=url;anchor.download="bakugan-brawler-data-"+new Date().toISOString().slice(0,10)+".json";
      document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setNotice("Data export prepared.");
    }catch(cause){setError(cause instanceof Error?cause.message:"Could not export data.");}
  };
  if(view==="overview")return <>
    <Group title="Account Details">
      {authUser?<div className={styles.accountIdentity}><strong>{profile.name}</strong><small>{authUser.email}</small></div>:<div className={styles.accountIdentity}>
        <strong>Guest</strong><small>Preferences and progress are stored on this device.</small>
        <div className={styles.actions}><button type="button" className="bb-button bb-button--primary" disabled={locked} onClick={()=>access("signup")}>Create Account</button><button type="button" className="bb-button" disabled={locked} onClick={()=>access("login")}>Log In</button></div>
      </div>}
      {authUser&&<AccountRow label="Change Brawler Name" icon="user-round" disabled={locked} onClick={()=>setView("name")}/> }
    </Group>
    {authUser&&<Group title="Security">
      <AccountRow label="Change Password" icon="lock" disabled={locked} onClick={()=>setView("password")}/>
      <AccountRow label="Replace Recovery Code" icon="key-round" disabled={locked} onClick={()=>setView("recovery")}/>
    </Group>}
    <Group title="Data Management">
      <AccountRow label="Export Data" icon="download" description={authUser?"Export current account data":"Export current guest data"} onClick={exportData}/>
      <AccountRow label="Delete Local Data" icon="trash-2" danger disabled={locked||Boolean(authUser)} description={authUser?"Sign out first to clear guest data safely.":"Remove guest data from this browser."} onClick={()=>setView("local")}/>
      {authUser&&<AccountRow label="Delete Account" icon="trash-2" danger disabled={locked} onClick={()=>setView("delete")}/>}
    </Group>
    {locked&&<p className={styles.notice} role="status">Account changes are unavailable while a lobby or match is active, or while session status is being checked. Gameplay, display and audio preferences remain available.</p>}
    {error&&<p className={styles.error} role="alert">{error}</p>}{notice&&<p className={styles.notice} role="status">{notice}</p>}
  </>;
  return <div className={styles.formArea}>
    {locked&&<p className={styles.notice} role="status">This action is unavailable until your lobby or match session has ended.</p>}
    {view==="name"&&authUser&&<form className={styles.form} onSubmit={submit(async()=>{
      const next=name.trim().replace(/\s+/g," ");
      if(!next||next.length>20)throw new Error("Brawler Name must be between 1 and 20 characters.");
      await saveAccountProfile({displayName:next});setName(next);setNotice("Brawler Name updated.");
    })}>
      <p>Shown on your profile, published identity and matches.</p>
      <label>Brawler Name<input className="bb-field" autoComplete="nickname" value={name} onChange={event=>setName(event.target.value)} minLength={1} maxLength={20} required disabled={busy||locked}/></label>
      <button className="bb-button bb-button--primary" type="submit" disabled={busy||locked||!name.trim()||name.trim().replace(/\s+/g," ")===profile.name}>Update Name</button>
    </form>}
    {view==="password"&&authUser&&<form className={styles.form} onSubmit={submit(async()=>{
      await changePassword(currentPassword,newPassword);setCurrentPassword("");setNewPassword("");setNotice("Password updated. Other sessions were signed out.");
    })}>
      <p>Changing your password signs out other sessions.</p>
      <label>Current password<input className="bb-field" type="password" autoComplete="current-password" value={currentPassword} onChange={event=>setCurrentPassword(event.target.value)} required disabled={busy||locked}/></label>
      <label>New password <small>10–128 characters</small><input className="bb-field" type="password" autoComplete="new-password" minLength={10} maxLength={128} value={newPassword} onChange={event=>setNewPassword(event.target.value)} required disabled={busy||locked}/></label>
      <button className="bb-button bb-button--primary" type="submit" disabled={busy||locked}>Update Password</button>
    </form>}
    {view==="recovery"&&authUser&&<form className={styles.form} onSubmit={submit(async()=>{
      const nextRecoveryCode=generateRecoveryCode();
      const response=await fetch("/api/auth",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action: "replace-recovery-code",currentPassword: recoveryPassword,nextRecoveryCode})});
      const result=await readJsonResponse(response,"Invalid recovery code response.") as {error?:string};
      if(!response.ok)throw new Error(result.error??"Could not replace recovery code.");
      setReplacementCode(nextRecoveryCode);setRecoveryPassword("");setNotice("Code replaced. Your previous code no longer works.");
    })}>
      <p>Replace your existing recovery code by confirming your current password. The previous code will stop working.</p>
      {!replacementCode&&<>
        <label>Current password<input className="bb-field" type="password" autoComplete="current-password" value={recoveryPassword} onChange={event=>setRecoveryPassword(event.target.value)} required disabled={busy||locked}/></label>
        <button className="bb-button bb-button--primary" type="submit" disabled={busy||locked||!recoveryPassword}>Replace Recovery Code</button>
      </>}
      {replacementCode&&<div className={styles.recovery} role="status">
        <strong>Save your new recovery code</strong><code>{replacementCode}</code><p>Keep this private. It will not be displayed again after you leave this view.</p>
        <button type="button" className="bb-button" onClick={async()=>{try{await navigator.clipboard.writeText(replacementCode);setNotice("Recovery code copied.");}catch{setNotice("Copy the code manually and store it privately.");}}}>Copy Code</button>
      </div>}
    </form>}
    {view==="local"&&!authUser&&<div className={styles.form}>
      <p>Remove your guest decks, records, settings, drafts and local active state from this browser. Account recovery copies and cloud data will be preserved.</p>
      <p>This cannot be undone. Export your current data first if you need a copy.</p>
      <button type="button" className="bb-button" onClick={exportData}>Export Data</button>
      <label>Type DELETE to confirm<input className="bb-field" autoComplete="off" value={confirmation} onChange={event=>setConfirmation(event.target.value)} disabled={busy||locked}/></label>
      <button type="button" className="bb-button bb-button--danger" disabled={busy||locked||confirmation!=="DELETE"} onClick={()=>void run(scheduleGuestReset)}>Delete Local Data</button>
    </div>}
    {view==="delete"&&authUser&&<form className={styles.form} onSubmit={submit(async()=>{
      if(confirmation!=="DELETE")return;
      await deleteAccount(confirmation);closeSettings();
    })}>
      <p>Delete your cloud account and its account data permanently. Separate guest data remains on this device.</p>
      <button type="button" className="bb-button" onClick={exportData}>Export Data</button>
      <label>Type DELETE to confirm<input className="bb-field" autoComplete="off" value={confirmation} onChange={event=>setConfirmation(event.target.value)} disabled={busy||locked} required/></label>
      <button className="bb-button bb-button--danger" type="submit" disabled={busy||locked||confirmation!=="DELETE"}>Delete Account</button>
    </form>}
    {busy&&<p className={styles.notice} role="status">Working…</p>}
    {error&&<p className={styles.error} role="alert">{error}</p>}
    {notice&&<p className={styles.notice} role="status">{notice}</p>}
  </div>;
}
