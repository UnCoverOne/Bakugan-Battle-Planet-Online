import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read=(path:string)=>readFile(new URL("../"+path,import.meta.url),"utf8");
const root="components/design-system/lucide/";
const groups=["basic","menu","features","utilities","extra"];

test("shared icon catalogue uses individually sourced Lucide glyphs and an ISC notice",async()=>{
  const names=new Set<string>();
  for(const group of groups){
    const source=await read(root+group+".tsx");
    const icons=[...source.matchAll(/\/\/ upstream blob ([a-f0-9]{40})\s+"([^"]+)": <>/g)];
    assert.ok(icons.length>0,group);
    for(const [,sha,name] of icons){assert.equal(sha.length,40);assert.ok(!names.has(name),name);names.add(name);}
    const parsed=ts.transpileModule(source,{fileName:group+".tsx",compilerOptions:{jsx:ts.JsxEmit.Preserve},reportDiagnostics:true});
    assert.deepEqual((parsed.diagnostics??[]).filter(d=>d.category===ts.DiagnosticCategory.Error),[],group);
  }
  for(const name of ["settings","gamepad-2","monitor","volume-2","user-round","x","list","message-square","layers","swords","trophy","search","eye","heart","play","pause","skip-back","step-back","step-forward"]){assert.ok(names.has(name),name);}
  const adapter=await read("components/design-system/LucideIcon.tsx");
  assert.match(adapter,/strokeWidth=\{2\}/);
  assert.match(adapter,/strokeLinecap="round"/);
  assert.match(adapter,/strokeLinejoin="round"/);
  assert.match(await read("THIRD-PARTY-NOTICES.md"),/ISC License/);
});
test("general-purpose interface icon consumers use the shared adapter",async()=>{
  const files=[
    "components/application/SettingsMenu.tsx","components/application/SettingsAccount.tsx","components/application/ProfileMenu.tsx",
    "components/social/SocialMenu.tsx","components/application/SiteNavigation.jsx","components/game-screen-v2/GameMenuHud.tsx",
    "components/game-screen-v2/MatchCommunicationLayer.tsx","components/routes/CompendiumNavigation.tsx",
    "components/routes/CompendiumPagination.tsx","components/routes/DeckLibraryPresentation.tsx","components/routes/DeckGalleryCard.tsx",
    "components/routes/AchievementCategoryIcon.tsx","components/routes/BattleActivityPanel.tsx","components/routes/BlankDashboardScreen.tsx",
  ];
  for(const path of files){
    const source=await read(path);
    assert.match(source,/<LucideIcon\b/,path);
    assert.doesNotMatch(source,/<svg\b/,path);
    const parsed=ts.transpileModule(source,{fileName:path,compilerOptions:{allowJs:true,jsx:ts.JsxEmit.Preserve},reportDiagnostics:true});
    assert.deepEqual((parsed.diagnostics??[]).filter(d=>d.category===ts.DiagnosticCategory.Error).map(d=>ts.flattenDiagnosticMessageText(d.messageText,"\n")),[],path);
  }
  // Bakugan-specific game board artwork is deliberately independent of the UI icon catalogue.
  assert.match(await read("components/game-screen-v2/GameScreen.tsx"),/<svg\s+className=\{styles\.hexGrid\}/);
});
