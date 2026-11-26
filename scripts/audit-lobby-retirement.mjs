/** Read-only checkout-wide audit. Never delete cards, generated art or
 * dynamic asset names on the strength of a missing literal reference. */
import {execFileSync} from "node:child_process";
import {existsSync,readFileSync} from "node:fs";
const paths=execFileSync("git",["ls-files","-z"],{encoding:"utf8"}).split("\0").filter(Boolean);
const textPaths=paths.filter(p=>/\.(?:[cm]?[jt]sx?|css|scss|jsonc?|html|sql|ya?ml|md|py|sh|svg|txt)$/i.test(p)&&!p.startsWith("public/assets/cards/")&&existsSync(p));
const texts=textPaths.filter(p=>p!=="scripts/audit-lobby-retirement.mjs").map(p=>[p,readFileSync(p,"utf8")]);
const retired = [
  "components/routes/LobbyRoomScreen.tsx",
  "components/routes/LobbyRoomScreen.module.css",
  "components/routes/StreamlinedLobbyRoomScreen.tsx",
  "components/routes/StreamlinedLobbyRoomScreen.module.css",
  "app/(workspace)/play/presentation-fix.module.css",
  "components/routes/ResultScreen.tsx",
  "components/routes/DashboardScreen.tsx",
  "app/api/game/active/route.ts",
  "app/api/game/resume/route.ts",
  "app/api/ai-decks/route.ts",
  "lib/account-match-session.ts",
  "lib/active-session.ts",
  "lib/lobby-cutover.ts",
  "lib/lobby-cutover-server.ts",
  "public/assets/winner.png",
  "public/assets/brawlers-group.png",
];
const problems=[];
for(const path of retired){
  if(existsSync(path))problems.push("Retired duplicate remains: "+path);
  const name=path.split("/").at(-1),stem=name.replace(/\.tsx$/,"");
  for(const [file,source] of texts){
    if(!/^(app|components|lib|worker)\//.test(file))continue;
    if(source.includes("/"+stem+'"')||source.includes("/"+stem+"'")||source.includes("/"+name+'"')||source.includes("/"+name+"'"))
      problems.push("Reference to retired duplicate: "+file);
  }
}
const assets=paths.filter(p=>/^public\/assets\/[^/]+\.(?:png|webp|jpe?g|avif|svg)$/i.test(p));
const assetInventory=assets.map(path=>{
  const basename=path.split("/").at(-1),refs=texts.filter(([file,source])=>!file.startsWith("docs/")&&(source.includes(basename)||source.includes(encodeURIComponent(basename)))).map(([file])=>file);
  return {path,references:refs};
});
console.log(JSON.stringify({scannedTextFiles:texts.length,retired,assetInventory,unreferencedCandidates:assetInventory.filter(a=>!a.references.length).map(a=>a.path)},null,2));
for (const [file, source] of texts) {
  if (!/^(app|components|lib|worker)\//.test(file)) continue;
  if (/PERSISTENT_LOBBY_ENABLED|LEGACY_LOBBY_CREATION_CLOSED|\/api\/game\/(active|resume)|\/api\/ai-decks/.test(source)) {
    problems.push("Reference to retired lobby integration: " + file);
  }
}
if(problems.length){console.error(problems.join("\n"));process.exitCode=1;}
