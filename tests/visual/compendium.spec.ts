import { expect, test, type Page } from "@playwright/test";

const nav = (page: Page) => page.getByRole("navigation", { name: "Compendium sections" });

async function openCompendium(page: Page, path="/compendium") {
  await page.goto(path);
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator("#compendium-search")).toBeVisible();
  await expect(nav(page).getByRole("button")).toHaveCount(5);
}

test.beforeEach(async ({page}) => {
  await page.emulateMedia({colorScheme:"dark",reducedMotion:"reduce"});
});

test("five minimal icon tabs and a full-width scoped search replace the splash heading", async ({page}) => {
  await openCompendium(page);
  const tabs=nav(page).getByRole("button");
  await expect(tabs.nth(0)).toHaveAttribute("aria-current","page");
  await expect(page.locator("#compendium-search")).toHaveAttribute("placeholder",/cards/i);
  await nav(page).getByRole("button",{name:"Glossary"}).click();
  await expect(page.locator("#compendium-search")).toHaveAttribute("placeholder",/glossary/i);
  await nav(page).getByRole("button",{name:"Rules"}).click();
  await expect(page.locator("#compendium-search")).toHaveAttribute("placeholder",/rules/i);
});

test("each section remembers its own search query", async ({page}) => {
  await openCompendium(page);
  await page.locator("#compendium-search").fill("Dragonoid");
  await expect.poll(()=>new URL(page.url()).searchParams.get("q")).toBe("Dragonoid");
  await nav(page).getByRole("button",{name:"Glossary"}).click();
  await page.locator("#compendium-search").fill("energy");
  await expect.poll(()=>new URL(page.url()).searchParams.get("q")).toBe("energy");
  await nav(page).getByRole("button",{name:"Cards"}).click();
  await expect(page.locator("#compendium-search")).toHaveValue("Dragonoid");
  await nav(page).getByRole("button",{name:"Glossary"}).click();
  await expect(page.locator("#compendium-search")).toHaveValue("energy");
});

test("48 entries per page and matching numbered navigation above and below galleries", async ({page}) => {
  await openCompendium(page);
  const gallery=page.locator('[data-ui="card-grid"]').first();
  await expect(gallery.locator(":scope > button")).toHaveCount(48);
  const pagination=page.getByRole("navigation",{name:"Card result pages"});
  await expect(pagination).toHaveCount(2);
  await pagination.first().getByRole("button",{name:"2",exact:true}).click();
  await expect.poll(()=>new URL(page.url()).searchParams.get("page")).toBe("2");
  await expect(gallery.locator(":scope > button")).toHaveCount(48);
});

test("detailed cards show minimal labels while compact displays artwork only",async ({page}) => {
  await openCompendium(page);
  const tile=page.locator('[data-ui="card-grid"] > button').first();
  await expect(tile.locator("strong")).toBeVisible();
  await page.getByRole("button",{name:"Compact",exact:true}).first().click();
  await expect(tile.locator("strong")).toHaveCount(0);
  const border=await tile.evaluate(element=>getComputedStyle(element).borderTopWidth);
  expect(border).toBe("0px");
  await page.getByRole("button",{name:"Detailed",exact:true}).first().click();
  await expect(tile.locator("strong")).toBeVisible();
});

test("inspectors present three tabs, anchored artwork and preserve the result state",async ({page}) => {
  await openCompendium(page,"/compendium?faction=Pyrus&density=compact");
  const tile=page.locator('[data-ui="card-grid"] > button').first();
  await tile.click();
  const inspector=page.locator('[data-ui="card-inspector"]');
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole("tab")).toHaveCount(3);
  await inspector.getByRole("tab",{name:"References"}).click();
  await expect.poll(()=>new URL(page.url()).searchParams.get("tab")).toBe("references");
  await inspector.getByRole("button",{name:/Close .*inspector/i}).click();
  await expect(inspector).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("faction")).toBe("Pyrus");
  expect(new URL(page.url()).searchParams.get("density")).toBe("compact");
});

test("desktop rail and tablet overlay use floating options, mobile stages filter changes",async ({page}) => {
  await openCompendium(page);
  const viewport=page.viewportSize()!;
  if(viewport.width>1100) {
    const rail=page.getByRole("complementary",{name:"Card filters"});
    await expect(rail).toBeVisible();
    await rail.getByRole("button",{name:/^Faction:/}).click();
    await expect(page.getByRole("dialog",{name:"Faction options"})).toBeVisible();
  } else if(viewport.width>=700) {
    await page.getByRole("button",{name:"Filters",exact:true}).last().click();
    const rail=page.getByRole("complementary",{name:"Card filters"});
    await expect(rail).toBeVisible();
    await rail.getByRole("button",{name:/^Faction:/}).click();
    const popover=page.getByRole("dialog",{name:"Faction options"});
    await expect(popover).toBeVisible();
    expect(await popover.evaluate(el=>getComputedStyle(el).position)).toBe("fixed");
  } else {
    await page.getByRole("button",{name:/^Filters/}).first().click();
    const sheet=page.getByRole("dialog",{name:"Card filters"});
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button",{name:/^Faction:/}).click();
    const picker=page.getByRole("dialog",{name:"Faction options"});
    await picker.getByRole("option",{name:/Aquos/}).click();
    expect(new URL(page.url()).searchParams.getAll("faction")).toEqual([]);
    await picker.getByRole("button",{name:"Done"}).click();
    await sheet.getByRole("button",{name:"Show Results"}).click();
    await expect.poll(()=>new URL(page.url()).searchParams.getAll("faction")).toEqual(["Aquos"]);
  }
});

test("BakuCore shows only core type and set in Detailed mode with three filter facets",async ({page})=>{
  await openCompendium(page,"/compendium/cores");
  await expect(page.getByRole("navigation",{name:"BakuCore result pages"})).toHaveCount(2);
  const tile=page.locator('[data-ui="card-grid"] > button').first();
  await expect(tile.locator("strong")).toBeVisible();
  const width=page.viewportSize()!.width;
  if(width>1100) {
    const rail=page.getByRole("complementary",{name:"BakuCore filters"});
    await expect(rail.getByRole("button",{name:/^Bonus type:/})).toBeVisible();
  }
});

test("Glossary starts with printed icons and renders full definitions inline",async ({page})=>{
  await openCompendium(page,"/compendium/glossary");
  await expect(page.getByRole("heading",{name:"Printed Icons"})).toBeVisible();
  const width=page.viewportSize()!.width;
  if(width>900) {
    await page.getByRole("button",{name:"Energy",exact:true}).first().click();
    await expect(page.locator('[id^="glossary-"]').filter({has:page.locator("h3")}).first()).toBeVisible();
  }
});

test("continuous Rules search retains its chapters and jumps to clauses",async ({page})=>{
  await openCompendium(page,"/compendium/rules");
  const chapters=page.locator('[data-rulebook-reader] main [id^="chapter-"]');
  await expect(chapters.first()).toBeVisible();
  const count=await chapters.count();
  await page.locator("#compendium-search").fill("Energy");
  await expect(page.getByRole("heading",{name:/matching rules/i})).toBeVisible();
  expect(await chapters.count()).toBe(count);
});

test("Rulings allow several expanded entries and separate verbatim Q&A",async ({page})=>{
  await openCompendium(page,"/compendium/rulings");
  const entries=page.locator('[id^="ruling-"]');
  await expect(entries.first()).toBeVisible();
  const first=entries.nth(0).getByRole("button",{name:/.+/}).first();
  const second=entries.nth(1).getByRole("button",{name:/.+/}).first();
  await first.click();await second.click();
  await expect(first).toHaveAttribute("aria-expanded","true");
  await expect(second).toHaveAttribute("aria-expanded","true");
  await entries.first().getByRole("button",{name:"Original Q&A"}).click();
  const dialog=page.getByRole("dialog",{name:/./});
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button",{name:/Close original Q and A/i}).click();
  await expect(first).toHaveAttribute("aria-expanded","true");
});
