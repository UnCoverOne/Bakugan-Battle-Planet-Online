import assert from "node:assert/strict";
import test from "node:test";
import {proposedDeckSelection,sameDeckSelection} from "../lib/lobby-picker-state";

const a={id:"a",name:"A"},b={id:"b",name:"B"},c={id:"c",name:"C"},d={id:"d",name:"D"};
test("single selection replaces or clears without mutating committed snapshots",()=>{
  const committed=[a];
  assert.deepEqual(proposedDeckSelection(committed,b,1,null),[b]);
  assert.deepEqual(proposedDeckSelection(committed,a,1,null),[]);
  assert.deepEqual(committed,[a]);
});
test("Ranked slot replacement preserves order and enforces three distinct slots",()=>{
  const committed=[a,b,c];
  assert.deepEqual(proposedDeckSelection(committed,d,3,"b"),[a,d,c]);
  assert.equal(proposedDeckSelection(committed,d,3,null),null);
  assert.deepEqual(proposedDeckSelection(committed,b,3,null),[a,c]);
  assert.deepEqual(proposedDeckSelection([a,c],d,3,null),[a,c,d]);
  assert.deepEqual(committed,[a,b,c]);
});
test("selection conflict compares content and order rather than just saved IDs",()=>{
  const signature=JSON.stringify;
  assert.equal(sameDeckSelection([a,b],[{...a},{...b}],signature),true);
  assert.equal(sameDeckSelection([a,b],[b,a],signature),false);
  assert.equal(sameDeckSelection([a],[{...a,name:"Edited"}],signature),false);
  assert.equal(sameDeckSelection([a],[],signature),false);
});
