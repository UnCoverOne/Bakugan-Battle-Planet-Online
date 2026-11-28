"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LucideIcon } from "../design-system/LucideIcon";
import { OriginalImage } from "../media/OriginalImage";
import { achievementsForProfile } from "../../lib/achievements";
import { lifetimeMatchStatsFromHistory, playerMatchSummary } from "../../lib/match-statistics";
import { buildPublicBrawlerProfile, normalizePublicBrawlerProfile, type PublicRankedProfile } from "../../lib/public-profile";
import { PROFILE_AVATARS, PROFILE_COVERS, PROFILE_TITLES, PROFILE_SHOWCASE_LIMIT, profileRewardUnlocked, toggleShowcaseId } from "../../lib/profile-customization";
import { profileRewardRequirement, PROFILE_REWARD_UNAVAILABLE } from "../../lib/profile-reward-runtime";
import { FACTION_SYMBOLS } from "../../lib/card-filters";
import { useAppFields } from "../application/AppProvider";
import { BrawlerProfileView } from "../profile/BrawlerProfileView";
import { AchievementCategoryIcon } from "./AchievementCategoryIcon";
import { AchievementsScreen } from "./AchievementsScreen";
import { MatchRecordsScreen } from "./MatchRecordsScreen";
import { DeckPreview } from "./DeckGalleryCard";
import styles from "./ProfileScreen.module.css";

const categories=["Profile Picture","Banner","Title","Faction"] as const;
type Category=typeof categories[number];
type Menu="edit"|"achievements"|"deck";
const factions=["Pyrus","Aquos","Darkus","Haos","Ventus","Aurelus"] as const;

export function ProfileScreen({segments=[]}:{segments?:string[]}){
  return segments[0]==="records"?<MatchRecordsScreen recordId={decodeURIComponent(segments[1]??"")}/>:<ProfileOwner achievementPage={segments[0]==="achievements"} achievementView={segments[1]}/>;
}

function ProfileOwner({achievementPage,achievementView}:{achievementPage:boolean;achievementView?:string}){
  const {profile,setProfile,history,lifetimeStats,decks,notify,authUser}=useAppFields(["profile","setProfile","history","lifetimeStats","decks","notify","authUser"]);
  const [menu,setMenu]=useState<Menu|null>(null);
  const [rankedProfile,setRankedProfile]=useState<PublicRankedProfile|null>(null);
  const [rankState,setRankState]=useState<"loading"|"ready"|"error">("loading");
  const effectiveLifetimeStats=useMemo(()=>authUser?lifetimeMatchStatsFromHistory(history):lifetimeStats,[authUser,history,lifetimeStats]);
  const achievements=useMemo(()=>achievementsForProfile(decks,history,effectiveLifetimeStats,profile),[decks,history,effectiveLifetimeStats,profile]);
  const completedAchievementIds=new Set(achievements.filter(achievement=>achievement.unlocked).map(achievement=>achievement.id));
  const stats=playerMatchSummary(history,lifetimeStats,Boolean(authUser));
  const unifiedProfile=buildPublicBrawlerProfile({userId:authUser?.id??"local-profile",joinedAt:authUser?.createdAt??null,profile,decks,achievements,stats,ranked:rankedProfile});
  useEffect(()=>{
    setRankedProfile(null);
    if(!authUser?.id){setRankState("ready");return;}
    if(achievementPage)return;
    const controller=new AbortController();
    setRankState("loading");
    fetch("/api/profile?userId="+encodeURIComponent(authUser.id),{cache:"no-store",signal:controller.signal}).then(async response=>{
      if(!response.ok)throw Error("Profile unavailable");
      const data=normalizePublicBrawlerProfile((await response.json()).profile);
      if(!data)throw Error("Invalid profile");
      if(!controller.signal.aborted){setRankedProfile(data.ranked);setRankState("ready");}
    }).catch(()=>{if(!controller.signal.aborted)setRankState("error");});
    return ()=>controller.abort();
  },[authUser?.id,achievementPage]);
  const update=(patch:Partial<typeof profile>,message:string)=>{setProfile((current:typeof profile)=>({...current,...patch}));notify(message);};
  const toggleAchievement=(achievement:(typeof achievements)[number])=>{
    if(!achievement.unlocked)return;
    const result=toggleShowcaseId(profile.showcaseAchievementIds,achievement.id);
    if(result.reachedLimit){notify("Choose up to "+PROFILE_SHOWCASE_LIMIT+" achievements.");return;}
    update({showcaseAchievementIds:result.ids},"Achievement showcase updated");
  };
  if(achievementPage)return <AchievementsScreen achievements={achievements} view={achievementView} showcaseIds={profile.showcaseAchievementIds} onToggleShowcase={toggleAchievement}/>;
  const requirement=(id:string|null)=>id?achievements.find(achievement=>achievement.id===id)?.name??"Achievement required":"Available by default";
  const picture=<div className={styles.avatarPresetGrid}>
    <button type="button" aria-label="Reset profile picture to default account initials" aria-pressed={!profile.avatar} onClick={()=>update({ avatar: "" },"Profile picture reset")}><span className={styles.avatarInitialsPreview}>{profile.name.slice(0,2).toUpperCase()}</span><span>Default</span></button>
    {PROFILE_AVATARS.map(item=>{
      const required=profileRewardRequirement("avatars",item.id,null);
      if(required===PROFILE_REWARD_UNAVAILABLE)return null;
      const unlocked=!required||completedAchievementIds.has(required);
      return <button type="button" key={item.id} disabled={!unlocked} aria-pressed={profile.avatar==="preset:"+item.id} onClick={()=>update({avatar:"preset:"+item.id},"Profile picture updated")}><OriginalImage className={styles.avatarPresetIcon} src={item.src} alt="" width="380" height="380" loading="lazy"/><span>{item.label}</span>{!unlocked&&<small>Locked · {requirement(required)}</small>}</button>;
    })}
  </div>;
  const banners=<div className={styles.coverGrid}>{PROFILE_COVERS.map(cover=>{
    const unlocked=profileRewardUnlocked(cover,completedAchievementIds);
    return <button key={cover.id} type="button" disabled={!unlocked} aria-pressed={profile.coverId===cover.id} onClick={()=>update({coverId:cover.id},"Banner updated")}><OriginalImage className={styles.coverArt} src={cover.src} alt="" width="1920" height="480" loading="lazy"/><strong>{cover.label}</strong>{!unlocked&&<small>Locked · {requirement(cover.achievementId)}</small>}</button>;
  })}</div>;
  const titles=<div className={styles.rewardList}>{PROFILE_TITLES.map(title=>{
    const unlocked=profileRewardUnlocked(title,completedAchievementIds);
    return <button type="button" key={title.id} disabled={!unlocked} aria-pressed={profile.titleId===title.id} onClick={()=>update({titleId:title.id},"Title updated")}><span><strong>{title.label}</strong>{!unlocked&&<small>Locked · {requirement(title.achievementId)}</small>}</span>{!unlocked?<LucideIcon name="lock"/>:profile.titleId===title.id?<LucideIcon name="check"/>:null}</button>;
  })}</div>;
  const factionPicker=<div className={styles.factionGrid}>{factions.map(faction=><button key={faction} type="button" aria-pressed={profile.faction===faction} onClick={()=>update({faction},"Preferred faction updated")}><OriginalImage src={FACTION_SYMBOLS[faction]} alt="" width="48" height="48"/><strong>{faction}</strong></button>)}</div>;
  const selectedDeck=unifiedProfile.showcaseDecks[0]?.id;
  return <>
    <BrawlerProfileView profile={unifiedProfile} rankLoading={rankState==="loading"&&Boolean(authUser)} rankUnavailable={rankState==="error"} ownerActions={{onEdit:()=>setMenu("edit"),onAchievements:()=>setMenu("achievements"),onSelectDeck:()=>setMenu("deck")}}/>
    {menu==="edit"&&<EditProfileMenu onClose={()=>setMenu(null)} panels={{"Profile Picture":picture,Banner:banners,Title:titles,Faction:factionPicker}}/>}
    {menu==="achievements"&&<ProfileDialog title="Achievements" onClose={()=>setMenu(null)}>
      <p className={styles.empty}>{unifiedProfile.showcaseAchievements.length}/{PROFILE_SHOWCASE_LIMIT} showcased</p>
      <div className={styles.rewardList}>{achievements.map(achievement=><button type="button" key={achievement.id} disabled={!achievement.unlocked||(!profile.showcaseAchievementIds?.includes(achievement.id)&&unifiedProfile.showcaseAchievements.length>=PROFILE_SHOWCASE_LIMIT)} aria-pressed={Boolean(profile.showcaseAchievementIds?.includes(achievement.id))} onClick={()=>toggleAchievement(achievement)}><AchievementCategoryIcon category={achievement.category}/><span><strong>{achievement.name}</strong><small>{achievement.description}</small></span>{profile.showcaseAchievementIds?.includes(achievement.id)?<LucideIcon name="check"/>:!achievement.unlocked?<LucideIcon name="lock"/>:null}</button>)}</div>
      <Link className={styles.sectionAction} href="/profile/achievements" onClick={()=>setMenu(null)}>View all achievements <LucideIcon name="chevron-right" size={16}/></Link>
    </ProfileDialog>}
    {menu==="deck"&&<ProfileDialog title="Select Deck" onClose={()=>setMenu(null)}>
      <div className={styles.rewardList}><button type="button" aria-pressed={!selectedDeck} onClick={()=>{update({showcaseDeckIds:[]},"Deck showcase cleared");setMenu(null);}}>No showcased deck {!selectedDeck&&<LucideIcon name="check"/>}</button>
      {decks.filter((deck:any)=>deck.visibility==="Public").map((deck:any)=><button type="button" key={deck.id} className={styles.deckChoice} aria-pressed={selectedDeck===deck.id} onClick={()=>{update({showcaseDeckIds:[deck.id]},"Showcased deck updated");setMenu(null);}}><div className={styles.deckArtwork}><DeckPreview deck={deck}/></div><strong>{deck.name}</strong>{selectedDeck===deck.id&&<LucideIcon name="check"/>}</button>)}</div>
      {!decks.some((deck:any)=>deck.visibility==="Public")&&<p className={styles.empty}>Publish a deck before showcasing it.</p>}
      <Link className={styles.sectionAction} href="/decks" onClick={()=>setMenu(null)}>My Decks <LucideIcon name="chevron-right" size={16}/></Link>
    </ProfileDialog>}
  </>;
}

function ProfileDialog({title,onClose,children,back}:{title:string;onClose:()=>void;children:ReactNode;back?:()=>void}){
  const ref=useRef<HTMLDialogElement>(null);
  const closeRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    const dialog=ref.current;
    if(!dialog)return;
    const previous=document.activeElement as HTMLElement|null;
    const overflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    dialog.showModal();
    closeRef.current?.focus();
    return ()=>{dialog.close();document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus();};
  },[]);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby="profile-dialog-title" onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div className={styles.dialogInner}>
      <header className={styles.dialogHeading}>{back&&<button className={styles.mobileBack} type="button" onClick={back}><LucideIcon name="arrow-left" size={18}/> Back</button>}<h2 id="profile-dialog-title">{title}</h2><button ref={closeRef} type="button" aria-label="Close" onClick={onClose}><LucideIcon name="x" size={24}/></button></header>
      <div className={styles.dialogBody}>{children}</div>
    </div>
  </dialog>;
}

function EditProfileMenu({panels,onClose}:{panels:Record<Category,ReactNode>;onClose:()=>void}){
  const [category,setCategory]=useState<Category>("Profile Picture");
  const [mobileSection,setMobileSection]=useState(false);
  return <ProfileDialog title="Edit Profile" onClose={onClose} back={mobileSection?()=>setMobileSection(false):undefined}>
    <div className={styles.editTabs} role="tablist" aria-label="Profile elements">{categories.map((item,index)=><button key={item} type="button" role="tab" id={"profile-tab-"+index} aria-controls="profile-edit-panel" aria-selected={category===item} tabIndex={category===item?0:-1} onClick={()=>setCategory(item)} onKeyDown={event=>{const next=event.key==="ArrowRight"?(index+1)%categories.length:event.key==="ArrowLeft"?(index+categories.length-1)%categories.length:event.key==="Home"?0:event.key==="End"?categories.length-1:null;if(next!==null){event.preventDefault();setCategory(categories[next]);document.getElementById("profile-tab-"+next)?.focus();}}}>{item}</button>)}</div>
    {!mobileSection&&<nav className={styles.editNavigation} aria-label="Profile elements">{categories.map(item=><button key={item} type="button" onClick={()=>{setCategory(item);setMobileSection(true);}}>{item}<LucideIcon name="chevron-right" size={18}/></button>)}</nav>}
    <div id="profile-edit-panel" className={styles.editPanel} data-mobile-open={mobileSection||undefined}><h3 className={styles.mobileCategory}>{category}</h3>{panels[category]}</div>
  </ProfileDialog>;
}
