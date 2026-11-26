import assert from "node:assert/strict";
import test from "node:test";
import { STARTER_DECKS } from "../lib/data";
import { canonicalLobbyDeck, rosterProblem, clearPreparationReadiness, emptyPreparation } from "../lib/lobby-preparation";
import { projectPreparation, type PreparationState } from "../lib/lobby-preparation-server";

const standard={structure:"bo1",format:"standard",meta:"unlimited"} as const;
test("canonical snapshots are independent of saved decks and duplicate Ranked lists are rejected",()=>{
  const saved=structuredClone(STARTER_DECKS[0]);
  const snapshot=canonicalLobbyDeck(saved,"a");
  saved.cardIds.length=0;
  assert.equal(snapshot.cardIds.length,40);
  const duplicate={...snapshot,id:"another-copy"};
  assert.equal(rosterProblem([snapshot,duplicate],"ranked",{...standard,structure:"bo3",format:"competitive"},null,false),"Already selected");
  const preparation={...emptyPreparation(),members:{a:{decks:[snapshot],ready:true}}};
  const reset=clearPreparationReadiness(preparation);
  assert.equal(reset.members.a.ready,false);
  assert.deepEqual(reset.members.a.decks,[snapshot]);
});
test("Ranked projection contains counts, never opposing deck identities or account keys",()=>{
  const deck=canonicalLobbyDeck(STARTER_DECKS[0],"b");
  deck.name="Secret opposing deck";
  const room:PreparationState={id:"room",code:"ABC234",mode:"ranked",version:3,configuration:{structure:"bo3",format:"competitive",meta:"unlimited"},
    preparation:{...emptyPreparation(),members:{b:{decks:[deck],ready:false}}},currentSeriesId:null,ownId:"a",
    members:[{id:"a",identity_key:"account:private-a",name:"A",last_seen_at:100000,expires_at:3700000},{id:"b",identity_key:"account:private-b",name:"B",last_seen_at:100000,expires_at:3700000}]};
  const ranked=projectPreparation(room,100001);
  assert.equal(ranked.seats[1].deckCount,1);
  assert.deepEqual(ranked.seats[1].decks,[]);
  assert.doesNotMatch(JSON.stringify(ranked),/Secret opposing deck|account:private/);
  const casual=projectPreparation({...room,mode:"casual",configuration:standard},100001);
  assert.match(JSON.stringify(casual.seats[1].decks),/Secret opposing deck/);
  assert.doesNotMatch(JSON.stringify(casual.seats[1].decks),/"cardIds"/);
});
