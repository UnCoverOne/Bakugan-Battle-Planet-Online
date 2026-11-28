"use client";

import Link from "next/link";
import { OriginalImage } from "../media/OriginalImage";
import { LucideIcon } from "../design-system/LucideIcon";
import { PresenceIndicator } from "../social/PresenceIndicator";
import { useSocial } from "../social/SocialProvider";
import { useAppFields } from "../application/AppProvider";
import { AchievementCategoryIcon } from "../routes/AchievementCategoryIcon";
import { DeckPreview } from "../routes/DeckGalleryCard";
import { ACHIEVEMENT_CATEGORY_DETAILS } from "../../lib/achievements";
import { FACTION_SYMBOLS } from "../../lib/card-filters";
import { PROFILE_COVERS, PROFILE_TITLES } from "../../lib/profile-customization";
import type { PublicBrawlerProfile } from "../../lib/public-profile";
import { ProfileAvatar } from "./ProfileAvatar";
import styles from "../routes/ProfileScreen.module.css";

export type BrawlerProfileOwnerActions = {
  onEdit: () => void;
  onAchievements: () => void;
  onSelectDeck: () => void;
};

export function BrawlerProfileView({profile,ownerActions,rankLoading=false,rankUnavailable=false}:{
  profile: PublicBrawlerProfile;
  ownerActions?: BrawlerProfileOwnerActions;
  rankLoading?: boolean;
  rankUnavailable?: boolean;
}) {
  const {snapshot,socialError}=useSocial();
  const {authUser}=useAppFields(["authUser"]);
  const selectedTitle=PROFILE_TITLES.find(item=>item.id===profile.titleId)??PROFILE_TITLES[0];
  const selectedCover=PROFILE_COVERS.find(item=>item.id===profile.coverId)??PROFILE_COVERS[0];
  const peer=[...snapshot.friends,...snapshot.onlineBrawlers,...snapshot.offlineBrawlers,...snapshot.incomingRequests,...snapshot.outgoingRequests].find(item=>item.userId===profile.userId);
  const ownPresence=ownerActions?snapshot.selfPresence:undefined;
  const presence=ownPresence?{online:ownPresence.kind!=="offline",presence:ownPresence}:peer;
  const deck=profile.showcaseDecks[0];
  return <div className={styles.profileOverview}>
    <header className={styles.identity}>
      <div className={styles.identityCard}>
        <OriginalImage className={styles.identityCoverArt} src={selectedCover.src} alt="" width="1920" height="480" fetchPriority="high"/>
        {ownerActions&&<button type="button" className={styles.editButton} onClick={ownerActions.onEdit}><LucideIcon name="pencil" size={18}/> Edit Profile</button>}
      </div>
      <div className={styles.identityContent}>
        <div className={styles.portraitWrap} data-faction={profile.faction}>
          <ProfileAvatar profile={{name:profile.displayName,avatar:profile.avatar}} className={styles.profilePortrait}/>
          <span className={styles.presenceCutout}><PresenceIndicator iconOnly account={socialError?undefined:presence} unavailable={Boolean(socialError)||!authUser||(!ownerActions&&!peer)}/></span>
        </div>
        <h1>{profile.displayName}</h1>
        <div className={styles.titleLine}><OriginalImage src={FACTION_SYMBOLS[profile.faction]} alt={profile.faction} width="24" height="24"/><span>{selectedTitle.label}</span></div>
      </div>
    </header>
    <div className={styles.profileContent}>
      {ownerActions&&<Link className={styles.recordsLink} href="/profile/records"><LucideIcon name="history" size={20}/> Match Records <LucideIcon name="chevron-right" size={18}/></Link>}
      <section className={styles.profileSection} aria-labelledby="profile-statistics">
        <div className={styles.sectionHeading}><h2 id="profile-statistics">Battle Statistics</h2><Link className={styles.sectionAction} href="/leaderboard">Leaderboards <LucideIcon name="chevron-right" size={16}/></Link></div>
        <dl className={styles.stats}>
          <div><dt>Rank</dt><dd data-rank={profile.ranked?.rank}>{rankLoading?"…":rankUnavailable?"Unavailable":profile.ranked?.rank??"Unranked"}</dd></div>
          <div><dt>Win Rate</dt><dd>{profile.stats.gamesPlayed?profile.stats.winRate+"%":"—"}</dd></div>
          <div><dt>Victories</dt><dd>{profile.stats.gamesWon.toLocaleString()}</dd></div>
        </dl>
      </section>
      {(ownerActions||profile.showcaseAchievements.length>0)&&<section className={styles.profileSection} aria-labelledby="profile-achievements">
        <div className={styles.sectionHeading}><h2 id="profile-achievements">Showcased Achievements</h2>{ownerActions&&<button type="button" className={styles.sectionAction} onClick={ownerActions.onAchievements}>Achievements <LucideIcon name="chevron-right" size={16}/></button>}</div>
        {profile.showcaseAchievements.length?<ul className={styles.achievements}>{profile.showcaseAchievements.map(achievement=><li key={achievement.id}><span className={styles.achievementIcon} style={{color:ACHIEVEMENT_CATEGORY_DETAILS[achievement.category].color}}><AchievementCategoryIcon category={achievement.category} width={32} height={32}/></span><div><strong>{achievement.name}</strong><p>{achievement.description}</p></div></li>)}</ul>:<p className={styles.empty}>Choose completed achievements to showcase.</p>}
      </section>}
      {(ownerActions||deck)&&<section className={styles.profileSection} aria-labelledby="profile-deck">
        <div className={styles.sectionHeading}><h2 id="profile-deck">Showcased Deck</h2>{ownerActions&&<button type="button" className={styles.sectionAction} onClick={ownerActions.onSelectDeck}>Select Deck <LucideIcon name="chevron-right" size={16}/></button>}</div>
        {deck?<Link className={styles.deck} href={"/decks/public/"+encodeURIComponent(deck.id)}><div className={styles.deckArtwork}><DeckPreview deck={{name:deck.name,bakuganIds:deck.bakuganIds,cardIds:deck.leadCardId?[deck.leadCardId]:[],leadCardId:deck.leadCardId,printingPreferences:deck.printingPreferences}}/></div><div><strong>{deck.name}</strong><div className={styles.deckFactions}>{deck.factions.map(faction=>FACTION_SYMBOLS[faction]&&<OriginalImage key={faction} src={FACTION_SYMBOLS[faction]} alt={faction} width="20" height="20"/>)}</div><span className={styles.sectionAction}>View Deck <LucideIcon name="chevron-right" size={16}/></span></div></Link>:<p className={styles.empty}>Choose a Public deck to showcase.</p>}
      </section>}
    </div>
  </div>;
}
