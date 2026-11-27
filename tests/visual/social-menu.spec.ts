import {expect,test} from "@playwright/test";

test("guest social drawer follows the responsive shell and closes via Escape",async({page})=>{
  await page.emulateMedia({colorScheme:"dark",reducedMotion:"reduce"});
  await page.goto("/");
  const trigger=page.getByRole("button",{name:"Social menu",exact:true});
  await expect(trigger).toBeVisible({timeout:15000});
  await trigger.click();
  const dialog=page.getByRole("dialog",{name:"Social",exact:true});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading",{name:"Connect with Brawlers"})).toBeVisible();
  await expect(dialog.getByRole("button",{name:"Log in",exact:true})).toBeVisible();
  await expect(dialog.getByRole("button",{name:"Register",exact:true})).toBeVisible();
  const bounds=await dialog.boundingBox(),viewport=page.viewportSize();
  expect(bounds).not.toBeNull();expect(viewport).not.toBeNull();
  expect(bounds!.width).toBeCloseTo(viewport!.width<=850?viewport!.width:420,0);
  expect(bounds!.x+bounds!.width).toBeCloseTo(viewport!.width,0);
  expect(bounds!.height).toBeCloseTo(viewport!.height,0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole("button",{name:"Close social menu"}).click();
  await expect(dialog).toHaveCount(0);
});
