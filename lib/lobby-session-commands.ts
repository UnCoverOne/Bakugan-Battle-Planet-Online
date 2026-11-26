import { recoverLobbyResult } from "./lobby-result-server";
import { assertLobbyAdmissionCutover } from "./lobby-cutover-server";
import { controllerOffer } from "./lobby-controller-server";
import { executePreparationCommand, prepareRecovery } from "./lobby-preparation-server";
import { startPreparedSeries, trainingCheckpoint } from "./lobby-prepared-start";
import { createLobbySessionService } from "./lobby-session-server";
import type { LobbyIdentity, LobbyConfiguration, LobbyMode } from "./lobby-session";
import { ValidationError, ConflictError, AuthenticationError } from "./server-errors";

type Identities = { primary: LobbyIdentity | null; account: LobbyIdentity | null; guest: LobbyIdentity | null };
const CODE = /^[A-Z2-9]{6}$/;
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const MODES = ["training", "casual", "ranked"] as const;
const CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function roomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, value => CHARACTERS[value & 31]).join("");
}
function stringId(value: unknown) {
  if (typeof value !== "string" || !ID.test(value)) throw new ValidationError("Invalid command or membership ID.");
  return value;
}
export async function lobbyRecovery(database: D1Database, identities: Identities) {
  const service = createLobbySessionService(database);
  const account = identities.account ? await service.activeMembership(identities.account) : null;
  const guest = identities.guest ? await service.activeMembership(identities.guest) : null;
  if (identities.account && guest) {
    return { status: "identity-conflict" as const, account, guest,
      accountLobby: account ? await service.read(identities.account) : null,
      guestLobby: await service.read(identities.guest!) };
  }
  const identity = identities.primary;
  if (!identity) return { status: "identity-required" as const };
  const membership = account ?? guest;
  if(!membership)return {status:"none" as const};
  const lobby=await service.read(identity);
  if(!lobby)return {status:"none" as const};
  return {status:"member" as const,membership,lobby,preparation:await prepareRecovery(database,identity),
    controller:lobby.mode!=="training"&&lobby.currentSeriesId?await controllerOffer(database,identity,membership.id,lobby.currentSeriesId):null};
}
export async function executeLobbyCommand(database: D1Database, identities: Identities, body: Record<string, unknown>) {
  const service = createLobbySessionService(database);
  const identity = identities.primary;
  if (!identity) throw new AuthenticationError("Establish a lobby identity first.");
  const action = body.action;
  if (action === "adopt-guest" || action === "leave-guest") {
    if (!identities.account || !identities.guest) throw new AuthenticationError("Both account and guest credentials are required.");
    const id = stringId(body.membershipId);
    const ok = action === "adopt-guest"
      ? await service.adoptGuest(identities.guest, identities.account, id)
      : await service.leave(identities.guest, id);
    if (!ok) throw new ConflictError("Guest membership changed or is part of an active series.");
    return lobbyRecovery(database, identities);
  }
  const current = await lobbyRecovery(database, identities);
  if (current.status === "identity-conflict") {
    // Permit explicit departure of either verified identity. Never discard either implicitly.
    if (action !== "leave" && action !== "heartbeat") throw new ConflictError("Resolve your account and guest lobby memberships first.");
  }
  if (action === "heartbeat" || action === "leave") {
    const id = stringId(body.membershipId);
    const target = body.scope === "guest" && identities.guest ? identities.guest : identity;
    if (body.scope === "guest" && !identities.guest) throw new AuthenticationError("Guest credential required.");
    const ok = action === "heartbeat" ? await service.heartbeat(target, id) : await service.leave(target, id);
    if (!ok && action === "leave") {
      const active = await service.activeMembership(target);
      if (active?.id === id) throw new ConflictError("Departure requires active-series resolution.");
    } else if (!ok) throw new ConflictError("This membership is no longer reachable.");
    return lobbyRecovery(database, identities);
  }
  if (["sync-preparation","select-decks","set-ready","update-settings"].includes(String(action))) {
    await executePreparationCommand(database,identity,body);
    return lobbyRecovery(database,identities);
  }
  if(action==="recover-result"){
    const result=await recoverLobbyResult(database,identity,stringId(body.membershipId),stringId(body.seriesId));
    return {...await lobbyRecovery(database,identities),result};
  }
  if (action==="start-series") {
    const series=await startPreparedSeries(database,identity,body);
    return {...await lobbyRecovery(database,identities),series};
  }
  if (["recover-training","checkpoint-training","complete-training"].includes(String(action))) {
    const training=await trainingCheckpoint(database,identity,body);
    return {...await lobbyRecovery(database,identities),training};
  }
  if (action !== "create" && action !== "join") throw new ValidationError("Unknown lobby command.");
  const commandId = stringId(body.commandId);
  let requestKey: string;
  let mode: LobbyMode = "casual";
  let configuration: LobbyConfiguration = { structure: "bo1", format: "standard", meta: "battle-brawlers" };
  let code = "";
  if (action === "create") {
    if (!MODES.some(value => value === body.mode)) throw new ValidationError("Invalid lobby mode.");
    mode = body.mode as LobbyMode;
    if (body.structure !== "bo1" && body.structure !== "bo3") throw new ValidationError("Invalid match structure.");
    if (mode === "ranked" && (identity.kind !== "account" || body.structure !== "bo3")) throw new ValidationError("Ranked requires an account and Best of Three.");
    configuration = { structure: body.structure, format: mode === "ranked" ? "competitive" : "standard", meta: "battle-brawlers" };
    requestKey = `create:${mode}:${configuration.structure}`;
  } else {
    code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!CODE.test(code)) throw new ValidationError("Invalid room code.");
    requestKey = `join:${code}`;
  }
  try {
    const prior = await service.receipt(identity, { commandId, requestKey });
    if (prior) return { ...await lobbyRecovery(database, identities), admission: prior };
    if (current.status === "member") throw new ConflictError("You already belong to a lobby.");
    await assertLobbyAdmissionCutover(database);
    const admission = action === "join" ? await service.joinByCode(identity, code, commandId)
      : await (async () => {
        for (let attempt = 0; attempt < 12; attempt++) {
          try { return await service.create(identity, mode, roomCode(), configuration, { commandId, requestKey }); }
          catch (error) {
            if (!(error instanceof Error) || !/UNIQUE constraint failed: lobby_sessions\.code/.test(error.message)) throw error;
          }
        }
        throw new ConflictError("Could not allocate a room code. Retry.");
      })();
    // First-time preparation synchronization is recoverable and does not
    // change the atomic admission receipt. A failed AI lookup must not undo membership.
    if(action==="create" && mode==="training"){
      try{await executePreparationCommand(database,identity,{action:"sync-preparation",membershipId:admission.membershipId});}catch(error){console.warn("Training preparation will retry",String(error));}
    }else if(action==="create" && mode==="ranked"){
      try{await executePreparationCommand(database,identity,{action:"sync-preparation",membershipId:admission.membershipId});}catch(error){console.warn("Ranked preparation will retry",String(error));}
    }
    return { ...await lobbyRecovery(database, identities), admission };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/LOBBY_ACCOUNT_REQUIRED/.test(message)) throw new AuthenticationError("Sign in to join Ranked.");
    if (/LOBBY_NOT_JOINABLE|LOBBY_FULL|LOBBY_COMMAND_REUSED|UNIQUE constraint failed: lobby_memberships.identity_key/.test(message))
      throw new ConflictError("Lobby unavailable or membership changed. Refresh your lobby status.");
    throw error;
  }
}
