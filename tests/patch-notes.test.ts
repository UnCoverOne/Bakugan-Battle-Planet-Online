import assert from "node:assert/strict";
import test from "node:test";
import { normalizePatch } from "../lib/patch-notes-server";
import { WEBSITE_UPDATE, websitePatchHref } from "../lib/content/website-updates";

test("bundled patch has a stable detail URL",()=>{
  assert.equal(websitePatchHref(WEBSITE_UPDATE),`/updates/${WEBSITE_UPDATE.version}`);
});

test("structured patch normalizes rich change entries",()=>{
  const patch=normalizePatch({
    version:"0.4.1",title:"Balance changes",summary:"Examples",status:"draft",
    sections:[{id:"balance",title:"Balance",changes:[{
      id:"a",type:"card",title:"Adjust card",elementId:"card-1",
      before:"600 B",after:"800 B",explanation:"Improved balance.",classification:"buff",
    }]}],
  });
  assert.equal(patch.sections[0].changes[0].type,"card");
  assert.equal(patch.sections[0].changes[0].before,"600 B");
  assert.equal(patch.sections[0].changes[0].classification,"buff");
});

test("publishing empty patch entries is rejected",()=>{
  assert.throws(()=>normalizePatch({
    version:"0.4.2",title:"No changes",status:"published",
    sections:[{title:"Changes",changes:[]}],
  }),/at least one described change/i);
});

test("invalid version identifiers are rejected",()=>{
  assert.throws(()=>normalizePatch({version:"../../admin",title:"Nope"}),/semantic version/);
});

test("unknown change types are safely normalized",()=>{
  const patch=normalizePatch({
    version:"0.4.1",title:"Unknown",status:"draft",
    sections:[{title:"General",changes:[{type:"something-else",title:"Example",classification:"bad"}]}],
  });
  assert.equal(patch.sections[0].changes[0].type,"general");
  assert.equal(patch.sections[0].changes[0].classification,"adjustment");
});
