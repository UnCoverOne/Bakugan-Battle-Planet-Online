import { expect, test, type Page } from "@playwright/test";

async function mockAccount(page: Page) {
  const user = {id:"collection-fixture",email:"fixture@example.invalid",displayName:"CollectionTester",faction:"Aquos",createdAt:1700000000000,roles:[]};
  const data = {schemaVersion:1,profile:{name:user.displayName,faction:user.faction,avatar:"",titleId:"battle-ready",signedIn:true},collection:{}};
  await page.route(url=>url.pathname==="/api/auth",route=>route.fulfill({json:{user}}));
  await page.route(url=>url.pathname==="/api/user-data",route=>route.fulfill({json:{data,updatedAt:1700000000000,revisions:{},resetVersion:0}}));
  await page.route(url=>url.pathname==="/api/lobby/session",route=>route.fulfill({json:{status:"none",accountId:user.id}}));
  await page.route(url=>url.pathname==="/api/social",route=>route.fulfill({json:{snapshot:{selfPresence:{kind:"lobby",mode:"ranked",away:false},friends:[],incomingRequests:[],outgoingRequests:[],onlineBrawlers:[],offlineBrawlers:[],invitations:[],activeLobby:null,unreadCount:0}}}));
  await page.route(url=>url.pathname==="/api/social/messages",route=>route.fulfill({json:{inbox:{conversations:[],blockedIds:[],unreadCount:0}}}));
  await page.routeWebSocket("**/api/social/socket",ws=>ws.send(JSON.stringify({type:"presence.snapshot"})));
}
test("guest collection remains private",async({page})=>{
  await page.route(url=>url.pathname==="/api/auth",route=>route.fulfill({json:{user:null}}));
  await page.goto("/collection");
  await expect(page.getByRole("heading",{name:"Sign in to track your collection"})).toBeVisible({timeout:15000});
  await expect(page.locator("[data-collection-counters]")).toHaveCount(0);
});
for (const section of ["cards","cores"]) {
  test(section+" counters float without shifting tiles, in both densities",async({page})=>{
    await mockAccount(page);
    await page.goto("/collection?collectionTab="+section);
    const gallery=page.locator(section==="cards"?"[data-cards-gallery]":"[data-cores-gallery]");
    const tile=gallery.locator("[data-collection-entry]").first();
    const counters=tile.locator("[data-collection-counters] button");
    await expect(counters).toHaveCount(3,{timeout:15000});
    for(const density of ["detailed","compact"]) {
      await expect(gallery).toHaveAttribute(section==="cards"?"data-cards-view":"data-cores-view",density);
      await expect(tile.locator("[data-card-meta],[data-core-meta]")).toHaveCount(0);
      const trigger=counters.first();
      await trigger.scrollIntoViewIfNeeded();
      const before=await tile.boundingBox();
      await trigger.click();
      const editor=page.getByRole("dialog",{name:/Standard copies/});
      await expect(editor).toBeVisible();
      expect(await editor.evaluate(el=>getComputedStyle(el).position)).toBe("fixed");
      expect(await tile.boundingBox()).toEqual(before);
      const bounds=await editor.boundingBox(), viewport=page.viewportSize()!;
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(viewport.width+1);
      const printing=editor.getByRole("combobox",{name:"Printing"});
      if(await printing.count()){
        await expect(editor.getByRole("button",{name:"Increase standard copies"})).toBeDisabled();
        await printing.selectOption({index:1});
      }
      const quantity=editor.getByRole("textbox",{name:"Standard quantity"});
      const original=Number(await quantity.inputValue());
      await editor.getByRole("button",{name:"Increase standard copies"}).click();
      await expect(quantity).toHaveValue(String(original+1));
      await editor.getByRole("button",{name:"Decrease standard copies"}).click();
      await expect(quantity).toHaveValue(String(original));
      await page.keyboard.press("Escape");
      await expect(editor).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(await tile.boundingBox()).toEqual(before);
      if(density==="detailed") await page.getByRole("button",{name:"Switch to compact view"}).click();
    }
  });
}
