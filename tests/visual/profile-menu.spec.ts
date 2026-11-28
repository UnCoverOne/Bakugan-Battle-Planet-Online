import {expect,test,type Page} from "@playwright/test";

const trigger=(page:Page)=>page.getByRole("button",{name:"Open profile menu"});
const menu=(page:Page)=>page.getByRole("dialog",{name:"Profile menu",exact:true});

async function mockAccount(page:Page,administrator:boolean){
  const user={id:"profile-menu-fixture",email:"fixture@example.invalid",displayName:"MenuTester",faction:"Aquos",createdAt:1700000000000,roles:administrator?["administrator"]:[]};
  const data={schemaVersion:1,profile:{name:user.displayName,faction:user.faction,avatar:"",titleId:"battle-ready",signedIn:true}};
  await page.route(url=>url.pathname==="/api/auth",route=>route.fulfill({json:{user}}));
  await page.route(url=>url.pathname==="/api/user-data",route=>route.fulfill({json:{data,updatedAt:1700000000000,revisions:{},resetVersion:0}}));
  await page.route(url=>url.pathname==="/api/lobby/session",route=>route.fulfill({json:{status:"none",accountId:user.id}}));
  await page.route(url=>url.pathname==="/api/social",route=>route.fulfill({json:{snapshot:{
    selfPresence:{kind:"lobby",mode:"ranked",away:false},friends:[],incomingRequests:[],outgoingRequests:[],onlineBrawlers:[],offlineBrawlers:[],invitations:[],activeLobby:null,unreadCount:0,
  }}}));
  await page.route(url=>url.pathname==="/api/social/messages",route=>route.fulfill({json:{inbox:{conversations:[],blockedIds:[],unreadCount:0}}}));
  await page.routeWebSocket("**/api/social/socket",ws=>ws.send(JSON.stringify({type:"presence.snapshot"})));
}

test("guest menu is responsive, shares the social background and restores focus",async({page})=>{
  await page.route(url=>url.pathname==="/api/auth",route=>route.fulfill({json:{user:null}}));
  await page.goto("/");
  await expect(trigger(page)).toBeVisible({timeout:15000});
  await trigger(page).click();
  const panel=menu(page);
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Guest",{exact:true})).toBeVisible();
  await expect(panel.getByRole("button",{name:"Create Account",exact:true})).toBeVisible();
  await expect(panel.getByRole("button",{name:"Log In",exact:true})).toBeVisible();
  await expect(panel.getByRole("button",{name:"Settings",exact:true})).toBeVisible();
  await expect(panel.getByRole("link",{name:"Administration"})).toHaveCount(0);
  await expect(panel.getByRole("button",{name:"Sign Out"})).toHaveCount(0);
  const bounds=await panel.boundingBox(),viewport=page.viewportSize();
  expect(bounds).not.toBeNull();expect(viewport).not.toBeNull();
  const mobile=viewport!.width<=850;
  expect(bounds!.width).toBeCloseTo(mobile?viewport!.width:310,0);
  if(mobile){expect(bounds!.height).toBeCloseTo(viewport!.height,0);expect(bounds!.y).toBe(0);}
  else expect(bounds!.y).toBeGreaterThanOrEqual(64);
  const background=await panel.evaluate(el=>getComputedStyle(el).backgroundColor);
  const divider=await panel.locator('[data-section="utilities"]').evaluate(el=>getComputedStyle(el).borderTopWidth);
  expect(divider).toBe("1px");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  await page.getByRole("button",{name:"Social menu",exact:true}).click();
  const social=page.getByRole("dialog",{name:"Social",exact:true});
  await expect(social).toBeVisible();
  expect(await social.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(background);
  await page.keyboard.press("Escape");
  await trigger(page).click();
  await panel.getByRole("button",{name:"Feedback & Reports",exact:true}).click();
  const feedback=page.getByRole("dialog",{name:"Feedback & Reports"});
  await expect(feedback).toBeVisible();
  await expect(panel).toHaveCount(0);
  await expect(feedback.getByLabel("Submission type")).toHaveValue("issue");
  await expect(feedback.getByRole("button",{name:"Submit report",exact:true})).toBeDisabled();
  await expect(feedback.getByRole("button",{name:"Sign in to submit"})).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(feedback).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
});

for(const administrator of [false,true]){
  test("signed-in menu uses identical personal rows and conditional administration ("+(administrator?"admin":"Brawler")+")",async({page})=>{
    await mockAccount(page,administrator);
    await page.goto("/");
    await expect(trigger(page)).toBeVisible({timeout:15000});
    await trigger(page).click();
    const panel=menu(page);
    await expect(panel.getByText("MenuTester",{exact:true})).toBeVisible();
    await expect(panel.getByText("Battle Ready",{exact:true})).toBeVisible();
    await expect(panel.getByText("In Lobby – Ranked",{exact:true})).toBeVisible();
    const personal=panel.getByRole("navigation",{name:"Personal features"});
    await expect(personal.getByRole("link")).toHaveText(["View Profile","Achievements","Match Records","Collection"]);
    for(const [label,href] of [["View Profile","/profile"],["Achievements","/profile/achievements"],["Match Records","/profile/records"],["Collection","/collection"]]){
      await expect(personal.getByRole("link",{name:label,exact:true})).toHaveAttribute("href",href);
    }
    await expect(panel.getByRole("link",{name:"Administration"})).toHaveCount(administrator?1:0);
    await expect(panel.getByRole("button",{name:"Sign Out"})).toBeVisible();
    const groups=await panel.locator('[data-section]').evaluateAll(nodes=>nodes.map(el=>getComputedStyle(el).borderTopWidth));
    expect(groups).toEqual(["1px","1px","1px"]);
    const avatar=await panel.locator('[data-faction="Aquos"]').boundingBox();
    expect(avatar?.width).toBe(58);
    const sizes=await personal.getByRole("link").evaluateAll(nodes=>nodes.map(el=>({height:el.getBoundingClientRect().height,style:getComputedStyle(el).backgroundColor})));
    expect(new Set(sizes.map(size=>size.height)).size).toBe(1);
    expect(new Set(sizes.map(size=>size.style)).size).toBe(1);
    if(page.viewportSize()!.width>850){
      await page.getByRole("button",{name:"Social menu",exact:true}).click();
      await expect(panel).toHaveCount(0);
      await expect(page.getByRole("dialog",{name:"Social",exact:true})).toBeVisible();
      await page.keyboard.press("Escape");
      await trigger(page).click();
    }
    await panel.getByRole("button",{name:"Close profile menu"}).click();
    await expect(panel).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
  });
}
