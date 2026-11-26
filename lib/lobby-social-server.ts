import type {AccountDatabase} from "./account-server";
import {createLobbySessionService} from "./lobby-session-server";
import {ConflictError} from "./server-errors";
import type {ActiveSocialLobby} from "./social";
import type {LobbyConfiguration} from "./lobby-session";

type ManagedInviteLobby=ActiveSocialLobby&{id:string;hostMemberId:string};
export async function managedInvitableLobby(db:AccountDatabase,userId:string):Promise<ManagedInviteLobby|null>{
  const service=createLobbySessionService(db);
  const identity={kind:"account" as const,id:userId};
  const room=await service.read(identity);
  const member=room?.members[0];
  if(!room||room.mode==="training"||room.currentSeriesId||room.members.length!==1||!member||member.expiresAt<=Date.now())return null;
  return {id:room.id,hostMemberId:member.id,code:room.code,format:room.configuration.structure,rulesFormat:room.configuration.format,openSlots:1};
}
export async function managedInvitationLobby(db:AccountDatabase,inviterId:string,lobbyId:string,memberId:string){
  const room=await managedInvitableLobby(db,inviterId);
  return room&&room.id===lobbyId&&room.hostMemberId===memberId?room:null;
}
/** Admission and invitation acceptance are one transaction. The usual
 * membership uniqueness and capacity triggers still govern the insert. */
export async function acceptManagedInvitation(db:AccountDatabase,userId:string,inviteId:string,guestId?:string){
  await createLobbySessionService(db).expire();
  const now=Date.now(),membershipId=crypto.randomUUID();
  const prior=()=>db.prepare(`SELECT i.accepted_membership_id AS membership_id,l.code,l.configuration_json
    FROM lobby_invitations i JOIN lobby_sessions l ON l.id=i.managed_lobby_id
    JOIN lobby_memberships m ON m.id=i.accepted_membership_id AND m.lobby_id=l.id
    WHERE i.id=? AND i.recipient_user_id=? AND i.status='accepted' AND m.identity_key=? AND m.left_at IS NULL
      AND m.expires_at>? AND l.closed_at IS NULL`).bind(inviteId,userId,"account:"+userId,now).first<{membership_id:string;code:string;configuration_json:string}>();
  let row=await prior();
  if(!row){
    try{
      await db.batch([
        db.prepare(`INSERT INTO lobby_memberships(id,lobby_id,identity_key,joined_at,last_seen_at,expires_at)
          SELECT ?,l.id,?,?,?,? FROM lobby_invitations i JOIN lobby_sessions l ON l.id=i.managed_lobby_id
          JOIN lobby_memberships h ON h.id=i.inviter_membership_id AND h.lobby_id=l.id
          WHERE i.id=? AND i.recipient_user_id=? AND i.status='pending' AND i.expires_at>?
          AND l.closed_at IS NULL AND l.current_series_id IS NULL AND l.mode<>'training'
          AND h.identity_key='account:'||i.inviter_user_id AND h.left_at IS NULL AND h.expires_at>?
          AND h.sequence=(SELECT MIN(sequence) FROM lobby_memberships WHERE lobby_id=l.id AND left_at IS NULL)
          AND (SELECT COUNT(*) FROM lobby_memberships WHERE lobby_id=l.id AND left_at IS NULL)=1
          AND NOT EXISTS(SELECT 1 FROM lobby_memberships WHERE identity_key IN (?,?) AND left_at IS NULL)
          AND NOT EXISTS(SELECT 1 FROM social_hidden_accounts WHERE user_id IN (i.inviter_user_id,i.recipient_user_id))`)
          .bind(membershipId,"account:"+userId,now,now,now+3600000,inviteId,userId,now,now,"account:"+userId,guestId?"guest:"+guestId:""),
        db.prepare(`UPDATE lobby_invitations SET status='accepted',responded_at=?,accepted_membership_id=?
          WHERE id=? AND recipient_user_id=? AND status='pending' AND EXISTS(
          SELECT 1 FROM lobby_memberships WHERE id=? AND lobby_id=lobby_invitations.managed_lobby_id AND identity_key=?)`)
          .bind(now,membershipId,inviteId,userId,membershipId,"account:"+userId),
      ]);
    }catch(error){
      const existing=await prior();
      if(!existing){
        if(error instanceof Error&&/LOBBY_|UNIQUE constraint failed: lobby_memberships/.test(error.message))throw new ConflictError("Lobby unavailable or you already belong to a lobby.");
        throw error;
      }
    }
    row=await prior();
  }
  if(!row)throw new ConflictError("Invitation unavailable or you already belong to a lobby.");
  const config=JSON.parse(row.configuration_json) as LobbyConfiguration;
  return {code:row.code,format:config.structure,rulesFormat:config.format,openSlots:0,joined:true};
}
