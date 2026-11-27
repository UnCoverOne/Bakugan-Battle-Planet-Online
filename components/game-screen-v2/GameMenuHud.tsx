"use client";

import {useEffect,useRef,useState} from "react";
import {LucideIcon} from "../design-system/LucideIcon";
import {useSettingsMenu} from "../application/SettingsMenuProvider";
import styles from "./GameMenuHud.module.css";

type AsyncAction=()=>void|Promise<void>;
export function GameMenuHud({completed=false,administrator=false,undoAvailable,onUndo,onConcede,onDownloadLog}:{
  completed?:boolean;administrator?:boolean;undoAvailable:boolean;onUndo:AsyncAction;onConcede:AsyncAction;onDownloadLog?:AsyncAction;
}){
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[downloadingLog,setDownloadingLog]=useState(false),[error,setError]=useState("");
  const trigger=useRef<HTMLButtonElement>(null),drawer=useRef<HTMLDialogElement>(null),closeButton=useRef<HTMLButtonElement>(null);
  const {open:settingsOpen,openSettings}=useSettingsMenu();
  useEffect(()=>{if(settingsOpen)setOpen(false);},[settingsOpen]);
  useEffect(()=>{
    const dialog=drawer.current;if(!open||!dialog)return;
    const previous=document.body.style.overflow;
    document.body.style.overflow="hidden";dialog.showModal();closeButton.current?.focus();
    return()=>{if(dialog.open)dialog.close();document.body.style.overflow=previous;};
  },[open]);
  const close=()=>{setOpen(false);requestAnimationFrame(()=>{if(trigger.current?.isConnected&&!document.querySelector("dialog[open]:modal"))trigger.current.focus();});};
  const action=async(operation:AsyncAction,confirm=false)=>{
    if(busy||confirm&&!window.confirm("Concede this game?"))return;
    setBusy(true);setError("");
    try{await operation();close();}
    catch(cause){setError(cause instanceof Error?cause.message:"The match action could not be completed.");}
    finally{setBusy(false);}
  };
  const download=async()=>{
    if(!onDownloadLog||downloadingLog)return;
    setDownloadingLog(true);setError("");
    try{await onDownloadLog();}
    catch(cause){setError(cause instanceof Error?cause.message:"The engine history could not be downloaded.");}
    finally{setDownloadingLog(false);}
  };
  return <>
    <button ref={trigger} type="button" className={styles.menuButton} aria-label="Open match menu" aria-expanded={open} aria-haspopup="dialog" aria-controls="game-menu-drawer" onClick={()=>{setError("");setOpen(true);}}>
      <LucideIcon name="menu" size={22}/><strong>MENU</strong>
    </button>
    {open&&<dialog id="game-menu-drawer" data-match-menu="true" ref={drawer} className={styles.drawer} aria-label="Match menu"
      onCancel={event=>{event.preventDefault();if(!busy)close();}}
      onClick={event=>{if(event.target!==event.currentTarget||busy)return;const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();}}>
      <header className={styles.header}><h2>Match Menu</h2><button ref={closeButton} type="button" aria-label="Close match menu" disabled={busy} onClick={close}><LucideIcon name="x" size={24}/></button></header>
      <div className={styles.actions}>
        <button type="button" className={styles.row} disabled={busy} onClick={()=>{setOpen(false);openSettings(trigger.current);}}><LucideIcon name="settings"/>Settings</button>
        {!completed&&<button type="button" className={styles.row} disabled={busy||!undoAvailable} onClick={()=>void action(onUndo)}><LucideIcon name="history"/>Undo Latest Card</button>}
        {administrator&&onDownloadLog&&<button type="button" className={styles.row} disabled={downloadingLog} onClick={()=>void download()}><LucideIcon name="download"/>{downloadingLog?"Downloading Log…":"Download Log"}</button>}
      </div>
      {!completed&&<div className={styles.danger}><button type="button" className={styles.row} data-danger="true" disabled={busy} onClick={()=>void action(onConcede,true)}><LucideIcon name="log-out"/>{busy?"Working…":"Concede"}</button></div>}
      {error&&<p role="alert" className={styles.error}>{error}</p>}
    </dialog>}
  </>;
}
