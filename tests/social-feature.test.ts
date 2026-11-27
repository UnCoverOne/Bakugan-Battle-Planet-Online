import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {DatabaseSync,type SQLInputValue} from "node:sqlite";
import type {AccountDatabase} from "../lib/account-server";
import {markMessagesRead,messageInbox,messageThread,reportMessagePeer,sendDirectMessage,setMessageBlock} from "../lib/social-messages-server";
import {enrichSocialPresence} from "../lib/social-presence-state";
import type {SocialAccountSummary} from "../lib/social";
import {mergeMessages,normalizeMessage} from "../lib/social-messages";
import { canonicalSocialPair, socialPresenceShard, sortSocialAccounts, socialIsAway, resolveSocialPresence, socialPresenceDisplay, SOCIAL_AWAY_MS } from "../lib/social";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("social components parse as valid TSX", async () => {
  for (const name of ["SocialMenu", "SocialProvider", "Conversation", "MatchResultSocial"]) {
    const path = `components/social/${name}.tsx`;
    const result = ts.transpileModule(await source(path), {
      fileName: path,
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
    });
    const errors = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
    assert.deepEqual(errors.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), [], path);
  }
});

test("friendship pairs are canonical and self-friending is rejected", () => {
  assert.deepEqual(canonicalSocialPair("user-z", "user-a"), ["user-a", "user-z"]);
  assert.throws(() => canonicalSocialPair("same", "same"), /another Brawler/i);
});

test("presence assignment is stable, bounded, and distributed across shards", () => {
  assert.equal(socialPresenceShard("brawler-42"), socialPresenceShard("brawler-42"));
  const shards = new Set(Array.from({ length: 200 }, (_, index) => socialPresenceShard(`user-${index}`)));
  assert.ok(shards.size > 4);
  for (const shard of shards) assert.match(shard, /^social-[0-7]$/);
});

test("social accounts sort online first and then by display name", () => {
  const sorted = sortSocialAccounts([
    { displayName: "Zane", online: false },
    { displayName: "Wynton", online: true },
    { displayName: "Dan", online: true },
  ]);
  assert.deepEqual(sorted.map((account) => account.displayName), ["Dan", "Wynton", "Zane"]);
});

test("automatic presence respects connection, inactivity, lobby and game priority", () => {
  assert.equal(socialIsAway(1000, 1000 + SOCIAL_AWAY_MS - 1), false);
  assert.equal(socialIsAway(1000, 1000 + SOCIAL_AWAY_MS), true);
  assert.deepEqual(socialPresenceDisplay({online:true}), {label:"Online",tone:"active",away:false});
  assert.equal(socialPresenceDisplay({online:true,presence:resolveSocialPresence(true,true)}).label,"Away");
  for (const mode of ["casual","ranked","training"] as const) {
    const label=mode[0].toUpperCase()+mode.slice(1);
    for(const away of [false,true]) {
      assert.deepEqual(socialPresenceDisplay({online:true,presence:resolveSocialPresence(true,away,{mode,inGame:false})}),
        {label:"In Lobby – "+label,tone:away?"away":"active",away});
      assert.deepEqual(socialPresenceDisplay({online:true,presence:resolveSocialPresence(true,away,{mode,inGame:true})}),
        {label:"In Game – "+label,tone:"game",away:false});
      assert.deepEqual(resolveSocialPresence(false,away,{mode,inGame:true}),{kind:"offline"});
    }
  }
  assert.equal(socialPresenceDisplay({online:false,presence:{kind:"game",mode:"ranked"}}).label,"Offline");
});

test("social persistence enforces relationship and invitation invariants", async () => {
  const migration = await source("migrations/0006_social.sql");
  assert.match(migration, /PRIMARY KEY \(user_low, user_high\)/);
  assert.match(migration, /CHECK \(user_low < user_high\)/);
  assert.match(migration, /status IN \('pending', 'accepted'\)/);
  assert.match(migration, /lobby_invitations_pending_pair_idx/);
  assert.match(migration, /expires_at/);
});

test("presence uses authenticated hibernating WebSockets and independent social shards", async () => {
  const [worker, config] = await Promise.all([source("worker/index.ts"), source("wrangler.jsonc")]);
  assert.match(worker, /class SocialPresence/);
  assert.match(worker, /acceptWebSocket\(server, \[userId\]\)/);
  assert.match(worker, /serializeAttachment/);
  assert.match(worker, /getSessionUserFromDatabase\(sanitizedRequest, env\.DB\)/);
  assert.match(config, /"SOCIAL_PRESENCE"/);
  assert.match(config, /"SocialPresence"/);
});

test("social drawer uses the shared navigation and preserves result actions",async()=>{
  const [menu,nav,coordinator,result]=await Promise.all([
    source("components/social/SocialMenu.tsx"),source("components/application/SiteNavigation.jsx"),
    source("components/game-screen-v2/MatchStateCoordinator.tsx"),source("components/social/MatchResultSocial.tsx")
  ]);
  assert.match(nav,/<SocialMenuButton \/>/);
  for(const label of ["Brawlers","Messages","Requests","Friends","Online","Offline","Add friend","Remove friend","Invite to lobby"]) assert.ok(menu.includes(label));
  assert.match(menu,/openConversation\(account\)/);
  assert.match(menu,/profileHref\(account\)/);
  assert.match(coordinator,/<MatchResultSocial/);
  assert.match(result,/<SocialAccountActions/);
  assert.doesNotMatch(result,/SocialAccountPreview/);
});

test("server match archives preserve the opponent account association", async () => {
  const [persistence, replay] = await Promise.all([
    source("lib/persistence.ts"),
    source("lib/replay-archive-server.ts"),
  ]);
  assert.match(persistence, /opponentUserId\?: string/);
  assert.match(replay, /opponentUserId/);
  assert.match(replay, /byPlayer\.get\(opponent\.id\)/);
});

test("offline directory and hidden-account controls are wired through the social API", async () => {
  const [drawer, social, admin, migration, schema] = await Promise.all([
    source("components/social/SocialMenu.tsx"),
    source("lib/social-server.ts"),
    source("app/api/admin/route.ts"),
    source("migrations/0015_social_hidden_accounts.sql"),
    source("db/schema.ts"),
  ]);
  assert.match(drawer, /name:"Offline"/);
  assert.match(drawer, /snapshot\.offlineBrawlers/);
  assert.match(social, /offlineBrawlers: sortSocialAccounts\(offlineBrawlers\)/);
  assert.match(social, /hiddenIds\.has/);
  assert.match(admin, /action === "set-social-hidden"/);
  assert.match(admin, /requireAdministrator\(request\)/);
  assert.match(migration, /social_hidden_accounts/);
  assert.match(schema, /socialHiddenAccounts/);
});

async function messageDatabase(){
  const sqlite=new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE account_bans(user_id TEXT PRIMARY KEY); CREATE TABLE social_hidden_accounts(user_id TEXT PRIMARY KEY); INSERT INTO users VALUES ('alice'),('bob'),('carol');");
  sqlite.exec(await source("migrations/0013_feedback_reports.sql"));
  sqlite.exec(await source("migrations/0022_social_messages.sql"));
  const prepare=(sql:string)=>{
    const statement=sqlite.prepare(sql);
    const bind=(...args:SQLInputValue[])=>({
      first:async()=>statement.get(...args)??null,
      all:async()=>({results:statement.all(...args)}),
      run:async()=>({meta:{changes:Number(statement.run(...args).changes)}}),
    });
    return {bind,...bind()};
  };
  const db={prepare,batch:async(statements:{run():Promise<unknown>}[])=>{
    sqlite.exec("BEGIN");try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec("COMMIT");return results;}
    catch(error){sqlite.exec("ROLLBACK");throw error;}
  }} as unknown as AccountDatabase;
  return {sqlite,db};
}
test("presence uses current unexpired lobby memberships, not client mode claims",async()=>{
  const {sqlite,db}=await messageDatabase();
  const now=100000;
  const account=(userId:string,online=true,away=false):SocialAccountSummary=>({
    userId,displayName:userId,faction:"Pyrus",avatar:"",titleId:"",rank:"",bp:0,wins:0,losses:0,winRate:0,
    online,relationship:"none",presence:resolveSocialPresence(online,away),
  });
  try {
    sqlite.exec(await source("migrations/0016_lobby_sessions.sql"));
    const add=sqlite.prepare("INSERT INTO lobby_sessions(id,code,mode,configuration_json,created_at) VALUES (?,?,?,'{}',0)");
    const join=sqlite.prepare("INSERT INTO lobby_memberships(id,lobby_id,identity_key,joined_at,last_seen_at,expires_at) VALUES (?,?,?,0,?,?)");
    for(const mode of ["casual","ranked","training"]){
      add.run(mode,mode,mode);
      join.run(mode,mode,"account:"+mode,0,3600000);
    }
    const accounts=[account("casual",true,true),account("ranked"),account("training"),account("other"),account("offline",false)];
    const get=async()=>Object.fromEntries((await enrichSocialPresence(db,accounts,now)).map(a=>[a.userId,socialPresenceDisplay(a)]));
    let statuses=await get();
    assert.deepEqual(statuses.casual,{label:"In Lobby – Casual",tone:"away",away:true});
    assert.equal(statuses.ranked.label,"In Lobby – Ranked");
    assert.equal(statuses.training.label,"In Lobby – Training");
    assert.equal(statuses.other.label,"Online");
    assert.equal(statuses.offline.label,"Offline");
    sqlite.exec("UPDATE lobby_sessions SET current_series_id='series-'||id");
    statuses=await get();
    for(const mode of ["casual","ranked","training"])assert.equal(statuses[mode].tone,"game");
    sqlite.exec("UPDATE lobby_sessions SET current_series_id=NULL WHERE id='ranked'; UPDATE lobby_memberships SET left_at=100,departure_reason='left' WHERE id='casual'; UPDATE lobby_memberships SET last_seen_at=-3600000,expires_at=0 WHERE id='training'");
    statuses=await get();
    assert.equal(statuses.casual.label,"Away");
    assert.equal(statuses.ranked.label,"In Lobby – Ranked");
    assert.equal(statuses.training.label,"Online");
  }finally{sqlite.close();}
});
const key=(n:number)=>"test-message-id-"+String(n).padStart(6,"0");
test("non-friends can message offline accounts; history, unread and retries are account-scoped",async()=>{
  const {sqlite,db}=await messageDatabase();
  try{
    const first=await sendDirectMessage(db,"alice","bob"," Hello Bob ",key(1));
    assert.equal(first.body,"Hello Bob");
    assert.equal((await sendDirectMessage(db,"alice","bob","Hello Bob",key(1))).id,first.id);
    await assert.rejects(sendDirectMessage(db,"alice","carol","different target",key(1)),/already been used/);
    const reply=await sendDirectMessage(db,"bob","alice","Hello Alice",key(2));
    assert.equal((await messageInbox(db,"bob")).unreadCount,1);
    assert.equal((await messageInbox(db,"alice")).unreadCount,1);
    assert.equal((await messageInbox(db,"carol")).unreadCount,0);
    assert.deepEqual((await messageThread(db,"carol","bob")).messages,[]);
    assert.deepEqual((await messageThread(db,"bob","alice")).messages.map(m=>m.id),[first.id,reply.id]);
    assert.equal(await markMessagesRead(db,"bob","alice",first.id),1);
    assert.equal((await messageInbox(db,"bob")).unreadCount,0);
    assert.equal((await messageInbox(db,"alice")).unreadCount,1);
    const later=await sendDirectMessage(db,"alice","bob","Another message",key(3));
    assert.equal(await markMessagesRead(db,"bob","alice",first.id),0);
    assert.equal((await messageInbox(db,"bob")).unreadCount,1);
    assert.equal((await messageInbox(db,"bob")).conversations[0].latest.id,later.id);
    await assert.rejects(sendDirectMessage(db,"alice","alice","self",key(4)),/another Brawler/);
    await assert.rejects(sendDirectMessage(db,"alice","bob"," ".repeat(3),key(5)),/characters/);
    await assert.rejects(sendDirectMessage(db,"alice","bob","x".repeat(2001),key(6)),/characters/);
  }finally{sqlite.close();}
});
test("blocks, visibility, reports and deletion are enforced by persistent message storage",async()=>{
  const {sqlite,db}=await messageDatabase();
  try{
    await sendDirectMessage(db,"alice","bob","original",key(10));
    await setMessageBlock(db,"bob","alice",true);
    assert.equal((await messageInbox(db,"bob")).unreadCount,0);
    assert.deepEqual((await messageInbox(db,"bob")).blockedIds,["alice"]);
    assert.equal((await messageThread(db,"alice","bob")).canSend,false);
    await assert.rejects(sendDirectMessage(db,"alice","bob","blocked",key(11)),/not accepting/);
    await assert.rejects(sendDirectMessage(db,"bob","alice","also blocked",key(12)),/not accepting/);
    await setMessageBlock(db,"bob","alice",false);
    assert.equal((await messageThread(db,"alice","bob")).canSend,true);
    await sendDirectMessage(db,"bob","alice","unblocked",key(13));
    sqlite.exec("INSERT INTO social_hidden_accounts VALUES ('bob')");
    assert.equal((await messageInbox(db,"alice")).conversations.length,0);
    await assert.rejects(messageThread(db,"alice","bob"),/unavailable/);
    await assert.rejects(sendDirectMessage(db,"bob","alice","hidden",key(14)),/unavailable/);
    sqlite.exec("DELETE FROM social_hidden_accounts; INSERT INTO account_bans VALUES ('bob')");
    await assert.rejects(sendDirectMessage(db,"alice","bob","banned",key(15)),/unavailable/);
    sqlite.exec("DELETE FROM account_bans");
    await reportMessagePeer(db,"alice","bob","This is a user-submitted description.");
    const report=sqlite.prepare("SELECT message,source_url FROM feedback_reports").get();
    assert.match(String(report?.message),/account bob/);
    assert.doesNotMatch(String(report?.message),/original/);
    assert.equal(report?.source_url,"/brawlers/bob");
    await setMessageBlock(db,"alice","bob",true);
    sqlite.exec("DELETE FROM users WHERE id='bob'");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM social_messages").get()?.n,0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM social_message_blocks").get()?.n,0);
  }finally{sqlite.close();}
});
test("history pagination and message merging keep stable ascending order without duplicates",async()=>{
  const {sqlite,db}=await messageDatabase();
  try{
    for(let i=0;i<53;i++)await sendDirectMessage(db,"alice","bob",String(i),key(100+i));
    const page=await messageThread(db,"bob","alice");
    assert.equal(page.messages.length,50);assert.equal(page.hasOlder,true);
    const older=await messageThread(db,"bob","alice",page.messages[0].id);
    assert.equal(older.messages.length,3);assert.equal(older.hasOlder,false);
    assert.equal(mergeMessages(older.messages,[...page.messages,page.messages[0]]).length,53);
    assert.equal(normalizeMessage("  hi\u0000  "),"hi");
  }finally{sqlite.close();}
});
test("social menu source no longer contains legacy preview or decorative branding",async()=>{
  const [provider,menu,css,route]=await Promise.all([source("components/social/SocialProvider.tsx"),source("components/social/SocialMenu.tsx"),source("components/social/SocialProvider.module.css"),source("app/api/social/messages/route.ts")]);
  assert.doesNotMatch(provider+menu+css,/SocialAccountPreview|COMM-LINK|linear-gradient|radial-gradient|previewLayer/);
  assert.match(menu,/badgeSlot/);assert.match(menu,/node.showModal\(\)/);
  assert.match(route,/getSessionUser\(request\)/);assert.match(route,/assertSameOrigin\(request\)/);
});
