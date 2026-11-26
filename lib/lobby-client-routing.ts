export type RecoveryStatus = "checking" | "none" | "member" | "identity-required" | "identity-conflict" | "unavailable";
export function lobbyRouteDecision(pathname:string,status:RecoveryStatus,hasLobby:boolean,hasSeries:boolean) {
  if(!["/play","/play/lobby","/play/match"].includes(pathname))return "allow";
  if(status==="checking"||status==="unavailable"||status==="identity-conflict")return "block";
  if(status==="member"&&hasLobby){
    if(pathname==="/play"||(pathname==="/play/match"&&!hasSeries))return "/play/lobby";
    return "allow";
  }
  return pathname==="/play"?"allow":"/play";
}
export function shouldEnterStartedSeries(pathname:string,previous:{lobbyId:string;seriesId:string|null}|null,next:{lobbyId:string;seriesId:string|null}|null) {
  return pathname==="/play/lobby"&&Boolean(previous&&next&&previous.lobbyId===next.lobbyId&&!previous.seriesId&&next.seriesId);
}
