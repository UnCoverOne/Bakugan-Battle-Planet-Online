"use client";

import {useEffect,useRef} from "react";
import {useAppFields} from "./AppProvider";

/** A quiet interface click cue. Gameplay events and music keep their own channels. */
export function UISoundLayer(){
  const {settings}=useAppFields(["settings"]);
  const current=useRef(settings);current.current=settings;
  useEffect(()=>{
    let context:AudioContext|null=null;
    let last=0;
    const play=(event:MouseEvent)=>{
      if(!event.isTrusted||!(event.target instanceof Element))return;
      const control=event.target.closest("button:not(:disabled),a[href],input[type=checkbox],select,[role=switch]");
      if(!control||control.closest("[aria-disabled=true]"))return;
      if(window.location.pathname==="/play/match"&&!control.closest("dialog[data-settings-menu],dialog[data-match-menu]")&&control.getAttribute("aria-label")!=="Open match menu")return;
      const s=current.current;
      if(s.uiSoundsEnabled===false)return;
      const volume=Math.max(0,Math.min(1,(s.uiSoundVolume??70)*(s.masterVolume??100)/10000));
      if(!volume||performance.now()-last<65)return;
      last=performance.now();
      try{
        context??=new AudioContext();
        const audio=context;
        if(audio.state==="suspended")void audio.resume().catch(()=>{});
        const oscillator=audio.createOscillator(),gain=audio.createGain(),now=audio.currentTime;
        oscillator.type="sine";oscillator.frequency.setValueAtTime(620,now);oscillator.frequency.exponentialRampToValueAtTime(410,now+.045);
        gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(Math.max(.0001,.035*volume),now+.008);gain.gain.exponentialRampToValueAtTime(.0001,now+.055);
        oscillator.connect(gain);gain.connect(audio.destination);oscillator.start(now);oscillator.stop(now+.06);
        oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
      }catch{/* Web Audio may be unavailable; preferences remain saved. */}
    };
    document.addEventListener("click",play);
    return()=>{document.removeEventListener("click",play);if(context)void context.close().catch(()=>{});};
  },[]);
  return null;
}
