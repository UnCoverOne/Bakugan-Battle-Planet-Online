import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read=(path:string)=>readFile(new URL("../"+path,import.meta.url),"utf8");

test("profile and shared presence components parse as valid JSX/TSX",async()=>{
  for(const path of ["components/application/ProfileMenu.tsx","components/application/SiteNavigation.jsx","components/social/PresenceIndicator.tsx","components/social/SocialMenu.tsx","components/design-system/LucideIcon.tsx","tests/visual/profile-menu.spec.ts"]){
    const result=ts.transpileModule(await read(path),{fileName:path,reportDiagnostics:true,compilerOptions:{allowJs:true,jsx:ts.JsxEmit.Preserve,target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}});
    assert.deepEqual((result.diagnostics??[]).filter(d=>d.category===ts.DiagnosticCategory.Error).map(d=>ts.flattenDiagnosticMessageText(d.messageText,"\n")),[],path);
  }
});

test("profile menu uses the shared palette and one responsive section structure",async()=>{
  const [menu,css,nav,navCss,presence,socialCss]=await Promise.all([
    read("components/application/ProfileMenu.tsx"),read("components/application/ProfileMenu.module.css"),read("components/application/SiteNavigation.jsx"),
    read("components/application/SiteNavigation.module.css"),read("components/social/PresenceIndicator.module.css"),read("components/social/SocialProvider.module.css"),
  ]);
  assert.match(css,/\.menu\{[^}]*background:var\(--bb-nav\)/);
  assert.match(socialCss,/\.drawer\{[^}]*background:var\(--bb-nav\)/);
  assert.match(css,/\.group,\.session\{[^}]*border-top:1px solid var\(--bb-border\)/);
  assert.match(css,/\.avatarFrame\{[^}]*width:58px;height:58px/);
  assert.match(css,/@media\(max-width:850px\)/);
  assert.match(css,/\.row\{min-height:52px/);
  assert.match(menu,/personalDestinations\.map\(item=><MenuLink/);
  assert.match(menu,/dialog\.showModal\(\)/);
  assert.match(menu,/dialog\.show\(\)/);
  assert.match(nav,/<ProfileMenu open=/);
  assert.doesNotMatch(nav,/profileLayer|profileBackdrop|profileLinks/);
  assert.doesNotMatch(navCss,/\.profileMenu|\.profileLayer|\.profileLinks|\.menuAvatar/);
  assert.match(presence,/data-tone=game[^}]*--bb-nav-indicator/);
  assert.doesNotMatch(socialCss,/\.presence\[/);
});

test("personal menu links to real routes, preserves access and uses server presence",async()=>{
  const [menu,server,admin,social,app]=await Promise.all([
    read("components/application/ProfileMenu.tsx"),read("lib/social-server.ts"),read("app/(workspace)/admin/page.tsx"),
    read("components/social/SocialMenu.tsx"),read("components/application/AppShell.jsx"),
  ]);
  for(const [href,label] of [["/profile","View Profile"],["/profile/achievements","Achievements"],["/profile/records","Match Records"],["/collection","Collection"]]){
    assert.ok(menu.includes('href:"'+href+'",label:"'+label+'"'));
  }
  assert.match(menu,/roles\?\.includes\("administrator"\)/);
  assert.match(admin,/roles\.includes\("administrator"\)/);
  assert.match(menu,/import\("\.\/FeedbackReportsDialog"\)/);
  assert.match(menu,/signedIn=\{Boolean\(authUser\)\}/);
  assert.match(menu,/void onLogout\(\)/);
  assert.match(app,/signOutAccount\(\{ retainUnsynced: true \}\)/);
  assert.match(menu,/snapshot\.selfPresence/);
  assert.match(server,/selfPresence: onlineAccounts\.find\(account => account\.userId === viewerId\)/);
  assert.match(menu,/<PresenceIndicator/);
  assert.match(social,/<PresenceIndicator/);
});
