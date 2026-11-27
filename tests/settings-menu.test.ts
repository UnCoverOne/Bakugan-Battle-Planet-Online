import assert from "node:assert/strict";
import test from "node:test";
import {readFile,access} from "node:fs/promises";
import ts from "typescript";
import {DEFAULT_APP_SETTINGS,normalizeAppSettings,patchPreferences,restorePreferenceCategory,eventLogFilter,hasCustomPreferences} from "../lib/settings-preferences";
import {clearGuestDataKeys,GUEST_DATA_KEYS} from "../lib/guest-reset";

const read=(path:string)=>readFile(new URL("../"+path,import.meta.url),"utf8");

test("canonical defaults and older snapshots normalize consistently",()=>{
  assert.equal(hasCustomPreferences(DEFAULT_APP_SETTINGS),false);
  assert.equal(hasCustomPreferences({}),false);
  assert.equal(normalizeAppSettings({}).gameSoundVolume,55);
  const old=normalizeAppSettings({soundEnabled:false,soundVolume:.42,automaticDraw:true,logDetail:"Random results",cardScale:500,masterVolume:-50});
  assert.equal(old.gameSoundsEnabled,false);
  assert.equal(old.gameSoundVolume,42);
  assert.equal(old.soundVolume,.42);
  assert.equal(old.automaticDraw,true);
  assert.equal(old.cardScale,140);
  assert.equal(old.masterVolume,0);
  assert.equal(eventLogFilter(old.logDetail),"random");
  assert.equal(eventLogFilter(undefined),"cards");
  assert.equal(eventLogFilter("invalid"),"cards");
  assert.equal(hasCustomPreferences({uiSoundVolume:12}),true);
});
test("category defaults affect only that category and preserve legacy audio compatibility",()=>{
  const edited=patchPreferences(DEFAULT_APP_SETTINGS,{automaticDraw:true,logDetail:"All events",cardScale:130,gameSoundsEnabled:false,gameSoundVolume:20,masterVolume:45});
  assert.equal(edited.sound,false);assert.equal(edited.soundEnabled,false);assert.equal(edited.soundVolume,.2);
  const audio=restorePreferenceCategory(edited,"Audio");
  assert.equal(audio.gameSoundsEnabled,true);assert.equal(audio.gameSoundVolume,55);assert.equal(audio.masterVolume,100);
  assert.equal(audio.automaticDraw,true);assert.equal(audio.cardScale,130);assert.equal(audio.logDetail,"All events");
  const gameplay=restorePreferenceCategory(audio,"Gameplay");
  assert.equal(gameplay.automaticDraw,false);assert.equal(gameplay.logDetail,"Cards");assert.equal(gameplay.cardScale,130);
});
test("guest reset deletes only named keys and preserves account recovery",()=>{
  const storage=(keys:string[])=>{
    const values=new Map(keys.map(key=>[key,"saved"]));
    return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>void values.set(key,value),removeItem:(key:string)=>void values.delete(key)};
  };
  const preserved=["bbp-account-cache-v2:account-a","bbp-account-reset-reload-v1:account-a","bbp-pending-recovery-code-display-v1","bbp-skipped-account-session-v1","unrelated"];
  const local=storage([...GUEST_DATA_KEYS,...preserved]),session=storage([...GUEST_DATA_KEYS,...preserved]);
  clearGuestDataKeys(local,session);
  for(const key of GUEST_DATA_KEYS){assert.equal(local.getItem(key),null);assert.equal(session.getItem(key),null);}
  for(const key of preserved){assert.equal(local.getItem(key),"saved");assert.equal(session.getItem(key),"saved");}
});
test("global settings supersede page and match-only interfaces",async()=>{
  const [shell,menu,profile,game,client,store,runtime,route,log,provider]=await Promise.all([
    read("components/application/AppShell.jsx"),read("components/application/SettingsMenu.tsx"),read("components/application/ProfileMenu.tsx"),
    read("components/game-screen-v2/GameMenuHud.tsx"),read("components/game-screen-v2/GameplayClient.tsx"),
    read("components/game-screen-v2/matchStore.ts"),read("components/routes/MatchRuntime.tsx"),
    read("app/(workspace)/settings/page.tsx"),read("components/game-screen-v2/MatchCommunicationLayer.tsx"),read("components/application/AppProvider.jsx"),
  ]);
  assert.match(shell,/<SettingsMenuProvider>/);
  assert.match(menu,/dialog\.showModal\(\)/);
  assert.match(menu,/role="tablist"/);
  assert.match(menu,/<nav aria-label="Settings categories"/);
  assert.match(profile,/openSettings\(triggerRef\.current\)/);
  assert.match(game,/openSettings\(trigger\.current\)/);
  assert.doesNotMatch(game,/settingsOpen \?|Automatic Draw|Game Sounds|settingsTab/);
  assert.doesNotMatch(client,/updatePreference|writeGameSettings|readSettings\(\)/);
  assert.doesNotMatch(store,/export function publishSettings/);
  assert.match(store,/if \(preferencesPrimed\) persisted\.settings = snapshot\.settings/);
  assert.match(runtime,/primeMatchStore\(\{[\s\S]*settings,/);
  assert.match(log,/eventLogFilter\(state\.settings\.logDetail\)/);
  assert.match(route,/redirect\("\/\?settings=1"\)/);
  assert.match(provider,/applyPendingGuestReset\(\)/);
  for(const file of ["components/routes/SettingsScreen.tsx","components/routes/SettingsScreen.module.css"])await assert.rejects(access(new URL("../"+file,import.meta.url)));
});
test("changed settings entry points parse as valid JSX or TSX",async()=>{
  for(const path of ["components/application/SettingsMenu.tsx","components/application/SettingsAccount.tsx","components/application/SettingsMenuProvider.tsx","components/application/UISoundLayer.tsx","components/application/AppShell.jsx","components/application/ProfileMenu.tsx","components/application/SiteNavigation.jsx","components/game-screen-v2/GameMenuHud.tsx","components/game-screen-v2/GameplayClient.tsx","components/game-screen-v2/MatchStateCoordinator.tsx","components/game-screen-v2/MatchCommunicationLayer.tsx","components/game-screen-v2/BakuCoreLayer.tsx","components/game-screen-v2/AlternateWinPresentationLayer.tsx","components/application/AppProvider.jsx"]){
    const result=ts.transpileModule(await read(path),{fileName:path,reportDiagnostics:true,compilerOptions:{allowJs:true,jsx:ts.JsxEmit.Preserve,target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}});
    assert.deepEqual((result.diagnostics??[]).filter(d=>d.category===ts.DiagnosticCategory.Error).map(d=>ts.flattenDiagnosticMessageText(d.messageText,"\n")),[],path);
  }
});
