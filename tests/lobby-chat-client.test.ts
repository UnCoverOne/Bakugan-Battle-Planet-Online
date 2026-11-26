import assert from "node:assert/strict";
import test from "node:test";
import {mergeLobbyChatPage,type LobbyChatPage} from "../lib/lobby-chat-client";

const page=(ids:number[],hasOlder=false,overrides:Partial<LobbyChatPage>={}):LobbyChatPage=>({
  membershipId:"a",lobbyId:"room",systemOnly:false,latest:ids.at(-1)??0,unread:ids.length,readThrough:0,hasOlder,
  messages:ids.map(id=>({id,kind:"system",playerId:null,author:"System",message:"Event",at:id})),...overrides,
});
const ids=(value:LobbyChatPage)=>value.messages.map(message=>message.id);
test("overlapping refreshes preserve earlier pages and do not duplicate messages",()=>{
  const latest=page([3,5,8],true);
  const expanded=mergeLobbyChatPage(latest,page([1,2],false,{latest:8}),true);
  assert.deepEqual(ids(expanded),[1,2,3,5,8]);assert.equal(expanded.hasOlder,false);
  const refreshed=mergeLobbyChatPage(expanded,page([5,8,11],true,{readThrough:8,unread:1}));
  assert.deepEqual(ids(refreshed),[1,2,3,5,8,11]);assert.equal(refreshed.hasOlder,false);assert.equal(refreshed.unread,1);
});
test("a gap in polling exposes earlier history rather than presenting a false continuous log",()=>{
  const merged=mergeLobbyChatPage(page([1,2,3]),page([90,91,92],true));
  assert.deepEqual(ids(merged),[90,91,92]);assert.equal(merged.hasOlder,true);
});
test("membership changes never merge former lobby history",()=>{
  const merged=mergeLobbyChatPage(page([1,2,3]),page([4],false,{membershipId:"b"}));
  assert.deepEqual(ids(merged),[4]);assert.equal(merged.membershipId,"b");
});
