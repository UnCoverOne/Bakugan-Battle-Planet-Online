/** Read-only D1 inventory. No migration, deletion or deployment. */
import {spawnSync} from "node:child_process";
const remote=process.argv.includes("--remote");
if(!remote&&!process.argv.includes("--local"))throw new Error("Specify --local or --remote explicitly.");
const query="SELECT status, COUNT(*) AS count FROM lobby_legacy_room_inventory GROUP BY status";
const result=spawnSync("npx",["--no-install","wrangler","d1","execute","DB",remote?"--remote":"--local","--config","wrangler.jsonc","--command",query,"--json"],{encoding:"utf8",stdio:["ignore","pipe","inherit"]});
if(result.status!==0)process.exit(result.status??1);
const payload=JSON.parse(result.stdout);
const counts={completed:0,unfinished:0,unknown:0};
for(const entry of payload){
  if(entry.success!==true||!Array.isArray(entry.results))throw new Error("Invalid cutover inventory.");
  for(const row of entry.results){
    if(!Object.hasOwn(counts,row.status)||!Number.isSafeInteger(Number(row.count))||Number(row.count)<0)throw new Error("Unexpected inventory status.");
    counts[row.status]+=Number(row.count);
  }
}
console.log(JSON.stringify({...counts,ready:counts.unfinished===0&&counts.unknown===0},null,2));
if(counts.unfinished||counts.unknown)process.exitCode=2;
