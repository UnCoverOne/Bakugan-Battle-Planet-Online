/** Explicitly scoped guest-data reset. Never delete account recovery/cache keys
 * or arbitrary bbp-* namespaces. Run on next boot after old pagehide writes. */
export const GUEST_RESET_MARKER="bbp-guest-reset-pending-v1";
export const GUEST_DATA_KEYS=[
  "bbp-profile","bbp-decks-complete-set-v4","bbp-deleted-decks-v1","bbp-history",
  "bbp-lifetime-match-stats-v1","bbp-settings","bbp-builder-draft-v1",
  "bbp-match-format-v1","bbp-match-mode-v1","bbp-active-match-v1","bbp-active-match-online-v1",
  "bbp-previous-match-v2","bbp-player-id","bbp-local-modified-at-v1","bbp-route-v1",
  "bbp-deck-query-v1","bbp-compendium-query-v1","bbp-compendium-tab-v1",
  "bbp-open-replay-v1","bbp-replay-index-v1","bbp-selected-deck-v1",
  "bbp-match-capability-v2","bbp-match-controller-v1",
] as const;
type ResetStorage=Pick<Storage,"getItem"|"setItem"|"removeItem">;
export function clearGuestDataKeys(local:ResetStorage,session:ResetStorage){
  for(const key of GUEST_DATA_KEYS){local.removeItem(key);session.removeItem(key);}
}
export function scheduleGuestReset(){
  sessionStorage.setItem(GUEST_RESET_MARKER,"1");
  window.location.assign("/");
}
export function applyPendingGuestReset(){
  try{
    if(sessionStorage.getItem(GUEST_RESET_MARKER)!=="1")return false;
    clearGuestDataKeys(localStorage,sessionStorage);
    sessionStorage.removeItem(GUEST_RESET_MARKER);
    return true;
  }catch{return false;}
}
