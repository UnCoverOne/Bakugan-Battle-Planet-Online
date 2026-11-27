"use client";
import {useEffect,useState} from "react";
import {useAppFields} from "./AppProvider";

/** Both the player's shared preference and the OS accessibility preference apply. */
export function useReducedMotion(){
  const {settings}=useAppFields(["settings"]);
  const [systemReduced,setSystemReduced]=useState(false);
  useEffect(()=>{
    const query=window.matchMedia("(prefers-reduced-motion: reduce)");
    const update=()=>setSystemReduced(query.matches);
    update();query.addEventListener("change",update);
    return()=>query.removeEventListener("change",update);
  },[]);
  return Boolean(settings.reducedMotion)||systemReduced;
}
