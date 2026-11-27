"use client";

import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from "react";
import {usePathname} from "next/navigation";
import {useSocial} from "../social/SocialProvider";
import {useAppFields} from "./AppProvider";
import {SettingsMenu} from "./SettingsMenu";

type SettingsMenuContext={open:boolean;openSettings:(returnFocus?:HTMLElement|null)=>void;closeSettings:()=>void};
const Context=createContext<SettingsMenuContext|null>(null);
export function useSettingsMenu(){
  const value=useContext(Context);
  if(!value)throw new Error("SettingsMenuProvider is required.");
  return value;
}
export function SettingsMenuProvider({children}:{children:ReactNode}){
  const [open,setOpen]=useState(false);
  const returnFocus=useRef<HTMLElement|null>(null);
  const pathname=usePathname();
  const {open:socialOpen,setOpen:setSocialOpen}=useSocial();
  const {accountAccessMode}=useAppFields(["accountAccessMode"]);
  const openSettings=useCallback((target?:HTMLElement|null)=>{
    returnFocus.current=target??(document.activeElement instanceof HTMLElement?document.activeElement:null);
    setSocialOpen(false);setOpen(true);
  },[setSocialOpen]);
  const closeSettings=useCallback(()=>{
    setOpen(false);
    const target=returnFocus.current;returnFocus.current=null;
    requestAnimationFrame(()=>{if(target?.isConnected&&!document.querySelector("dialog[open]:modal"))target.focus();});
  },[]);
  useEffect(()=>{
    setOpen(false);
    const url=new URL(window.location.href);
    if(url.searchParams.get("settings")==="1"){
      url.searchParams.delete("settings");
      window.history.replaceState(window.history.state,"",url.pathname+url.search+url.hash);
      openSettings();
    }
  },[pathname,openSettings]);
  useEffect(()=>{if(socialOpen||accountAccessMode)setOpen(false);},[socialOpen,accountAccessMode]);
  const value=useMemo(()=>({open,openSettings,closeSettings}),[open,openSettings,closeSettings]);
  return <Context.Provider value={value}>{children}{open&&<SettingsMenu onClose={closeSettings}/>}</Context.Provider>;
}
