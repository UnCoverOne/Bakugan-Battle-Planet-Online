import {expect,test,type Page} from "@playwright/test";
const dialog=(page:Page)=>page.getByRole("dialog",{name:"Settings",exact:true});
async function open(page:Page){
  const trigger=page.getByRole("button",{name:"Open profile menu"});
  await expect(trigger).toBeVisible({timeout:15000});
  await trigger.click();
  await page.getByRole("dialog",{name:"Profile menu",exact:true}).getByRole("button",{name:"Settings",exact:true}).click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.getByRole("dialog",{name:"Profile menu",exact:true})).toHaveCount(0);
}
async function category(page:Page,name:string){
  const panel=dialog(page);
  if(page.viewportSize()!.width<=850){
    const back=panel.getByRole("button",{name:"Back to Settings categories"});
    if(await back.count())await back.click();
    await panel.getByRole("button",{name:new RegExp("^"+name)}).click();
  }else await panel.getByRole("tab",{name,exact:true}).click();
}
test.beforeEach(async({page})=>{
  await page.route(url=>url.pathname==="/api/auth",route=>route.fulfill({json:{user:null}}));
  await page.route(url=>url.pathname==="/api/lobby/session",route=>route.fulfill({json:{status:"none",accountId:null}}));
});
test("settings open without changing route and share responsive controls and persistence",async({page})=>{
  await page.goto("/compendium");
  const before=page.url();
  await open(page);
  expect(page.url()).toBe(before);
  const panel=dialog(page),viewport=page.viewportSize()!,bounds=await panel.boundingBox();
  expect(bounds!.width).toBeCloseTo(viewport.width<=850?viewport.width:680,0);
  if(viewport.width<=850){
    expect(bounds!.height).toBeCloseTo(viewport.height,0);
    await expect(panel.getByRole("tablist")).toHaveCount(0);
    await expect(panel.getByRole("navigation",{name:"Settings categories"})).toBeVisible();
  }else await expect(panel.getByRole("tablist")).toBeVisible();
  await category(page,"Gameplay");
  const auto=panel.getByRole("switch",{name:"Automatic Draw"});
  await expect(auto).toHaveAttribute("aria-checked","false");
  await auto.click();
  await expect(auto).toHaveAttribute("aria-checked","true");
  await category(page,"Audio");
  const music=panel.getByRole("switch",{name:"Music",exact:true});
  await music.click();await expect(panel.getByRole("slider",{name:"Music volume"})).toBeDisabled();
  await panel.getByRole("button",{name:"Restore Defaults"}).click();
  await expect(music).toHaveAttribute("aria-checked","true");
  await category(page,"Gameplay");await expect(auto).toHaveAttribute("aria-checked","true");
  await panel.getByRole("button",{name:"Close settings"}).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Open profile menu"})).toBeFocused();
  await expect.poll(async()=>page.evaluate(()=>JSON.parse(localStorage.getItem("bbp-settings")??"{}").automaticDraw)).toBe(true);
  await page.reload();await open(page);await category(page,"Gameplay");
  await expect(dialog(page).getByRole("switch",{name:"Automatic Draw"})).toHaveAttribute("aria-checked","true");
  await dialog(page).getByRole("button",{name:"Restore Defaults"}).click();
});
test("legacy URL opens the global menu on Home rather than a standalone settings page",async({page})=>{
  await page.goto("/settings");await expect(dialog(page)).toBeVisible({timeout:15000});
  await expect.poll(()=>new URL(page.url()).pathname).toBe("/");
  await page.keyboard.press("Escape");await expect(dialog(page)).toHaveCount(0);
});
