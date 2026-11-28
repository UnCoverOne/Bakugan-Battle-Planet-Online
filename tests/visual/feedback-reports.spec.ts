import { expect, test, type Page } from "@playwright/test";

const report = (page: Page) => page.getByRole("dialog",{name:"Feedback & Reports",exact:true});
async function open(page: Page, signedIn: boolean) {
  const user = signedIn ? {id:"feedback-fixture",email:"fixture@example.invalid",displayName:"FeedbackTester",faction:"Aquos",createdAt:1700000000000,roles:[]} : null;
  await page.route(url=>url.pathname==="/api/auth",route=>route.fulfill({json:{user}}));
  await page.route(url=>url.pathname==="/api/user-data",route=>route.fulfill({json:{data:{schemaVersion:1,profile:{name:"FeedbackTester",faction:"Aquos",avatar:"",titleId:"battle-ready",signedIn:true}},updatedAt:1700000000000,revisions:{},resetVersion:0}}));
  await page.route(url=>url.pathname==="/api/lobby/session",route=>route.fulfill({json:{status:"none",accountId:user?.id??null}}));
  await page.route(url=>url.pathname==="/api/social",route=>route.fulfill({json:{snapshot:{selfPresence:{kind:"lobby",mode:"ranked",away:false},friends:[],incomingRequests:[],outgoingRequests:[],onlineBrawlers:[],offlineBrawlers:[],invitations:[],activeLobby:null,unreadCount:0}}}));
  await page.route(url=>url.pathname==="/api/social/messages",route=>route.fulfill({json:{inbox:{conversations:[],blockedIds:[],unreadCount:0}}}));
  await page.routeWebSocket("**/api/social/socket",ws=>ws.send(JSON.stringify({type:"presence.snapshot"})));
  await page.goto("/compendium");
  const trigger=page.getByRole("button",{name:"Open profile menu"});
  await expect(trigger).toBeVisible({timeout:15000});
  await trigger.click();
  const profile=page.getByRole("dialog",{name:"Profile menu",exact:true});
  if (signedIn) await expect(profile.getByRole("link",{name:"Open your profile"})).toBeVisible();
  else await expect(profile.getByText("Guest",{exact:true})).toBeVisible();
  await profile.getByRole("button",{name:"Feedback & Reports",exact:true}).click();
  await expect(report(page)).toBeVisible();
  return trigger;
}
for (const signedIn of [false,true]) {
  test((signedIn?"Signed-in":"Guest")+" feedback uses identical form and sends only the approved fields",async({page})=>{
    const requests: unknown[]=[];
    await page.route(url=>url.pathname==="/api/feedback",async route=>{
      requests.push(route.request().postDataJSON());
      await route.fulfill({status:201,json:{id:"fixture",status:"pending",submittedAt:1}});
    });
    const trigger=await open(page,signedIn);
    const dialog=report(page),viewport=page.viewportSize()!,bounds=await dialog.boundingBox();
    expect(bounds!.width).toBeCloseTo(viewport.width<=850?viewport.width:680,0);
    if(viewport.width<=850) expect(bounds!.height).toBeCloseTo(viewport.height,0);
    await expect(dialog.getByRole("tab")).toHaveCount(0);
    await expect(dialog.getByRole("button",{name:"Sign in to submit"})).toHaveCount(0);
    await expect(dialog.getByRole("button",{name:"Submit report"})).toBeDisabled();
    const message="Please review this card effect against the printed wording.";
    await dialog.getByLabel("Details").fill(message);
    await dialog.getByLabel("Submission type").selectOption("suggestion");
    await dialog.getByRole("button",{name:"Select a related card"}).click();
    const selector=page.getByRole("dialog",{name:"Select Card",exact:true});
    await selector.getByRole("searchbox",{name:"Search cards"}).fill("bb-1");
    const exactCard = selector.getByRole("button").filter({hasText:/BB-1 ·/}).first();
    await expect(exactCard).toBeVisible();
    await expect(selector.locator("ul button").first()).toHaveText(/BB-1 ·/);
    await exactCard.click();
    await expect(dialog.getByLabel("Details")).toHaveValue(message);
    await expect(dialog.getByLabel("Submission type")).toHaveValue("suggestion");
    await dialog.getByRole("button",{name:"Submit request"}).click();
    await expect(dialog.getByRole("heading",{name:"Feature request submitted"})).toBeVisible();
    expect(requests).toEqual([{kind:"suggestion",cardId:"bb-1",message}]);
    await dialog.getByRole("button",{name:"Done",exact:true}).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(new URL(page.url()).pathname).toBe("/compendium");
  });
}
test("dirty draft survives Escape, selector navigation and failed submission",async({page})=>{
  await page.route(url=>url.pathname==="/api/feedback",route=>route.fulfill({status:429,headers:{"retry-after":"5"},json:{error:"Rate limited",retryAfter:5}}));
  await open(page,false);
  const dialog=report(page);
  const message="An example report that should remain after failure.";
  await dialog.getByLabel("Details").fill(message);
  await dialog.getByRole("button",{name:"Select a related card"}).click();
  await page.keyboard.press("Escape");
  await expect(dialog.getByLabel("Details")).toHaveValue(message);
  await page.keyboard.press("Escape");
  const confirm=page.getByRole("dialog",{name:"Discard draft?"});
  await expect(confirm.getByRole("button",{name:"Keep editing"})).toBeFocused();
  await confirm.getByRole("button",{name:"Keep editing"}).click();
  await expect(dialog.getByLabel("Details")).toHaveValue(message);
  await dialog.getByRole("button",{name:"Submit report"}).click();
  await expect(dialog.getByRole("alert")).toContainText("Too many submissions");
  await expect(dialog.getByLabel("Details")).toHaveValue(message);
  await expect(dialog.getByRole("button",{name:"Submit report"})).toBeDisabled();
  await expect(dialog.getByRole("button",{name:"Submit report"})).toBeEnabled({timeout:8000});
  await dialog.getByRole("button",{name:"Cancel"}).click();
  await confirm.getByRole("button",{name:"Discard",exact:true}).click();
  await expect(page.locator("[data-feedback-menu]")).toHaveCount(0);
});
