import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
const source=(p:string)=>readFileSync(p,"utf8");
const lobby=source("components/routes/ManagedLobby.jsx"),picker=source("components/routes/LobbyDeckPicker.jsx"),css=source("components/routes/ManagedLobby.module.css");
test("lobby uses separate fixed readiness and series action controls",()=>{
  assert.match(lobby,/className=\{styles.readyButton\}/);
  assert.match(lobby,/className=\{styles.start\}[^>]*>Return to Game/);
  assert.match(css,/\.readyButton\{width:108px;height:44px/);
  assert.match(css,/\.start,\.guestAction\{width:152px;height:48px/);
  assert.match(lobby,/Waiting for host/);
  assert.doesNotMatch(lobby,/ranked-ban|ranked-select|\/api\/game/);
});
test("opponent slots are read-only and Ranked choices are never rendered",()=>{
  assert.match(lobby,/const missing=!seat,hidden=mode==="ranked"&&!own/);
  assert.match(lobby,/deck=\{hidden\?null:seat\?\.decks\?\.\[index\]\}/);
  assert.match(lobby,/editable=\{own&&!active\}/);
  assert.match(lobby,/Automatically assigned/);
  assert.match(lobby,/styles.chatColumn/);
  assert.match(lobby,/styles.chatModal/);
});
test("picker uses the shared artwork renderer and explicit confirmation",()=>{
  assert.match(picker,/<DeckPreview deck=\{artwork\}/);
  assert.match(picker,/dialog.showModal\(\)/);
  assert.match(picker,/showIncompatible/);
  assert.match(picker,/onConfirm\(draft\)/);
  assert.match(picker,/sameDeckSelection\(committed,original.current,deckSignature\)/);
  assert.match(css,/\.choice\[aria-pressed="true"\]/);
  assert.match(css,/max-width:760px/);
});
