import {expect,test} from "@playwright/test";

test("public profile shows the continuous layout and only public information",async({page})=>{
  await page.route(url=>url.pathname==="/api/auth",route=>route.fulfill({json:{user:null}}));
  await page.route(url=>url.pathname==="/api/profile",route=>route.fulfill({json:{profile:{
    userId:"profile-fixture",displayName:"ProfileTester",faction:"Aquos",avatar:"preset:shun-kazami",titleId:"battle-planet-brawler",coverId:"battle-planet",
    stats:{gamesPlayed:12,gamesWon:7,winRate:58},ranked:{rank:"Gold",bp:1280,wins:4,losses:2,winRate:67},
    showcaseAchievements:[{id:"sample",name:"Sample achievement",description:"Win seven battles.",category:"Arena"}],showcaseDecks:[]
  }}}));
  await page.goto("/brawlers/profile-fixture");
  await expect(page.getByRole("heading",{name:"ProfileTester",exact:true})).toBeVisible({timeout:15000});
  await expect(page.getByText("Win seven battles.",{exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Battle Statistics"})).toBeVisible();
  await expect(page.getByRole("link",{name:"Leaderboards"})).toHaveAttribute("href","/leaderboard");
  await expect(page.getByRole("button",{name:"Edit Profile"})).toHaveCount(0);
  await expect(page.getByRole("link",{name:"Match Records",exact:true})).toHaveCount(0);
  const metrics=await page.locator("dl dt").evaluateAll(nodes=>nodes.map(node=>({text:node.textContent,y:node.getBoundingClientRect().y})));
  expect(metrics.map(metric=>metric.text)).toEqual(["Rank","Win Rate","Victories"]);
  expect(new Set(metrics.map(metric=>Math.round(metric.y))).size).toBe(1);
});

test("own profile edit menu uses responsive navigation and restores focus",async({page})=>{
  const user={id:"profile-owner-fixture",email:"fixture@example.invalid",displayName:"ProfileTester",faction:"Aquos",createdAt:1700000000000,roles:[]};
  const data={schemaVersion:1,profile:{name:user.displayName,faction:user.faction,avatar:"",titleId:"battle-planet-brawler",signedIn:true}};
  await page.route(url=>url.pathname==="/api/auth",route=>route.fulfill({json:{user}}));
  await page.route(url=>url.pathname==="/api/user-data",route=>route.fulfill({json:{data,updatedAt:1700000000000,revisions:{},resetVersion:0}}));
  await page.route(url=>url.pathname==="/api/lobby/session",route=>route.fulfill({json:{status:"none",accountId:user.id}}));
  await page.route(url=>url.pathname==="/api/social",route=>route.fulfill({json:{snapshot:{selfPresence:{kind:"lobby",mode:"ranked",away:false},friends:[],incomingRequests:[],outgoingRequests:[],onlineBrawlers:[],offlineBrawlers:[],invitations:[],activeLobby:null,unreadCount:0}}}));
  await page.route(url=>url.pathname==="/api/social/messages",route=>route.fulfill({json:{inbox:{conversations:[],blockedIds:[],unreadCount:0}}}));
  await page.routeWebSocket("**/api/social/socket",ws=>ws.send(JSON.stringify({type:"presence.snapshot"})));
  await page.route(url=>url.pathname==="/api/profile",route=>route.fulfill({json:{profile:{userId:user.id,displayName:user.displayName,faction:user.faction,stats:{gamesPlayed:0,gamesWon:0,winRate:0},ranked:null}}}));
  await page.goto("/profile");
  const trigger=page.getByRole("button",{name:"Edit Profile",exact:true});
  await expect(trigger).toBeVisible({timeout:15000});
  await expect(page.getByRole("link",{name:"Match Records",exact:true})).toHaveAttribute("href","/profile/records");
  await trigger.click();
  const dialog=page.getByRole("dialog",{name:"Edit Profile"});
  await expect(dialog).toBeVisible();
  const viewport=page.viewportSize()!;
  const bounds=await dialog.boundingBox();
  if(viewport.width<=850){
    expect(bounds!.width).toBeCloseTo(viewport.width,0);
    expect(bounds!.height).toBeCloseTo(viewport.height,0);
    await dialog.getByRole("button",{name:"Faction",exact:true}).click();
    await expect(dialog.getByRole("button",{name:"Pyrus",exact:true})).toBeVisible();
    await dialog.getByRole("button",{name:"Back",exact:true}).click();
    await expect(dialog.getByRole("button",{name:"Banner",exact:true})).toBeVisible();
  }else{
    expect(bounds!.width).toBeLessThan(viewport.width);
    await dialog.getByRole("tab",{name:"Faction",exact:true}).click();
    await expect(dialog.getByRole("button",{name:"Pyrus",exact:true})).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.getByRole("button",{name:"Select Deck",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Select Deck"})).toBeVisible();
});
