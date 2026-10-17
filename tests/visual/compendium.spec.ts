import { expect, test, type Page } from "@playwright/test";

async function waitForCompendium(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.locator("main").waitFor({ state: "visible" });
  await expect(page.getByRole("heading", { name: "Compendium" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
});


test("search accepts spaces immediately and debounces its shareable URL", async ({ page }) => {
  await page.goto("/compendium");
  await waitForCompendium(page);
  const search = page.getByLabel("Search the archive");
  await search.fill("Light's");
  await search.press("Space");
  await search.type("Courage");
  await expect(search).toHaveValue("Light's Courage");
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("Light's Courage");
});

test("selected cards preserve result state and use the modal inspector", async ({ page }) => {
  await page.goto("/compendium?faction=Pyrus&sort=name-asc&density=compact&card=bb-1&tab=overview");
  await waitForCompendium(page);
  const inspector = page.locator('[data-ui="card-inspector"]');
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole("tab")).toHaveCount(4);
  await inspector.getByRole("tab", { name: "Rules" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe("rules");
  const url = new URL(page.url());
  expect(url.searchParams.get("faction")).toBe("Pyrus");
  expect(url.searchParams.get("sort")).toBe("name-asc");
  expect(url.searchParams.get("density")).toBe("compact");
  expect(url.searchParams.get("card")).toBe("bb-1");

  const viewport = page.viewportSize()!;
  const geometry = await inspector.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { position: getComputedStyle(element).position, width: rect.width, height: rect.height };
  });
  const backdrop = page.locator('[data-ui="card-inspector-backdrop"]');
  await expect(backdrop).toBeVisible();
  const backdropGeometry = await backdrop.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { position: getComputedStyle(element).position, width: rect.width, height: rect.height };
  });
  expect(backdropGeometry.position).toBe("fixed");
  expect(Math.abs(backdropGeometry.width - viewport.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(backdropGeometry.height - viewport.height)).toBeLessThanOrEqual(1);
  if (viewport.width <= 900) {
    expect(geometry.position).toBe("relative");
    expect(Math.abs(geometry.width - viewport.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.height - viewport.height)).toBeLessThanOrEqual(1);
  } else {
    expect(geometry.position).toBe("relative");
    expect(geometry.width).toBeGreaterThan(900);
    expect(geometry.width).toBeLessThanOrEqual(1056);
  }
});

test("opening an inspector preserves the current result scroll position", async ({ page }) => {
  await page.goto("/compendium?page=2");
  await waitForCompendium(page);
  await page.evaluate(() => window.scrollTo(0, 1200));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  expect(scrollBefore).toBeGreaterThan(0);
  await page.locator('[data-ui="card-grid"] > button').first().click();
  await expect(page.locator('[data-ui="card-inspector"]')).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test("Compendium filter rail and sheet stay compact and usable", async ({ page }) => {
  await page.goto("/compendium");
  await waitForCompendium(page);
  const viewport = page.viewportSize()!;

  if (viewport.width > 1180) {
    const rail = page.getByRole("complementary", { name: "Card filters" });
    await expect(rail).toBeVisible();
    const width = await rail.evaluate((element) => element.getBoundingClientRect().width);
    expect(width).toBeLessThanOrEqual(210);
    const triggerHeight = await rail.getByRole("button", { name: /^Faction:/ })
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(triggerHeight).toBeGreaterThanOrEqual(40);
    return;
  }

  await page.getByRole("button", { name: /^Filters/ }).click();
  const sheet = page.getByRole("dialog", { name: "Card filters" });
  await expect(sheet).toBeVisible();
  const dimensions = await sheet.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
    };
  });
  expect(dimensions.width).toBeLessThanOrEqual(Math.min(viewport.width, 608) + 1);
  expect(dimensions.height).toBeLessThanOrEqual(Math.min(viewport.height * .8, 672) + 2);
  expect(dimensions.columns).toBe(2);
  const triggerHeight = await sheet.getByRole("button", { name: /^Faction:/ })
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(triggerHeight).toBeGreaterThanOrEqual(44);
});

test("card and BakuCore filter surfaces stay fixed-size and never scroll internally", async ({ page }) => {
  const viewport = page.viewportSize()!;
  for (const [url, accessibleName, height, lastFacet] of [
    ["/compendium", "Card filters", 576, "Keyword"],
    ["/compendium/cores", "BakuCore filters", viewport.width > 1180 ? 288 : 368, "Set"],
  ] as const) {
    await page.goto(url);
    await waitForCompendium(page);
    if (viewport.width <= 1180) {
      await page.getByRole("button", { name: /^Filters/ }).click();
    }
    const surface = viewport.width > 1180
      ? page.getByRole("complementary", { name: accessibleName })
      : page.getByRole("dialog", { name: accessibleName });
    await expect(surface).toBeVisible();

    const check = async () => {
      const layout = await surface.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const css = getComputedStyle(element);
        return {
          width: box.width,
          height: box.height,
          overflowY: css.overflowY,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        };
      });
      expect(layout.height).toBe(viewport.width > 1180 ? height : (url === "/compendium" ? 512 : 368));
      expect(layout.width).toBeLessThanOrEqual(viewport.width);
      if (viewport.width > 1180) expect(layout.width).toBe(200);
      expect(layout.overflowY).not.toMatch(/auto|scroll/);
      expect(layout.scrollHeight).toBeLessThanOrEqual(layout.clientHeight + 1);
      const finalField = surface.getByRole("button", { name: new RegExp(`^${lastFacet}:`) });
      const bounds = await Promise.all([
        surface.boundingBox(),
        finalField.boundingBox(),
      ]);
      expect(bounds[0]).not.toBeNull();
      expect(bounds[1]).not.toBeNull();
      expect(bounds[1]!.y + bounds[1]!.height).toBeLessThanOrEqual(bounds[0]!.y + bounds[0]!.height);
    };
    await check();

    if (url === "/compendium") {
      await surface.getByRole("button", { name: /^Card type:/ }).click();
      const picker = page.getByRole("dialog", { name: "Card type options" });
      await picker.getByRole("option", { name: /^◇?\s*Character$/ }).click();
      await picker.getByRole("button", { name: "Done" }).click();
      await check();
    }
  }
});

test("long selected filter values truncate inside the trigger at every breakpoint", async ({ page }) => {
  await page.goto("/compendium?set=BB&set=BR&faction=Pyrus&faction=Haos");
  await waitForCompendium(page);

  const viewport = page.viewportSize()!;
  let surface;
  if (viewport.width > 1180) {
    surface = page.getByRole("complementary", { name: "Card filters" });
  } else {
    await page.getByRole("button", { name: /^Filters/ }).click();
    surface = page.getByRole("dialog", { name: "Card filters" });
  }

  const trigger = surface.getByRole("button", { name: /^Set: Battle Brawlers, Bakugan Resurgence$/ });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute("title", "Battle Brawlers, Bakugan Resurgence");

  const bounds = await trigger.evaluate((button) => {
    const summary = button.querySelector('[class*="triggerSummary"]')!;
    const chevron = button.querySelector('[class*="chevron"]')!;
    const labels = [...button.querySelectorAll('[class*="summaryLabel"]')];
    const buttonBounds = button.getBoundingClientRect();
    const summaryBounds = summary.getBoundingClientRect();
    const chevronBounds = chevron.getBoundingClientRect();
    return {
      buttonWidth: buttonBounds.width,
      scrollWidth: button.scrollWidth,
      clippedLabels: labels.filter((label) => label.scrollWidth > label.clientWidth + 1).length,
      ellipsis: labels.every((label) => getComputedStyle(label).textOverflow === "ellipsis"),
      summaryRight: summaryBounds.right,
      chevronLeft: chevronBounds.left,
      chevronRight: chevronBounds.right,
      buttonRight: buttonBounds.right,
    };
  });
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.buttonWidth + 1);
  expect(bounds.ellipsis).toBe(true);
  expect(bounds.clippedLabels).toBeGreaterThan(0);
  expect(bounds.summaryRight).toBeLessThanOrEqual(bounds.chevronLeft + 1);
  expect(bounds.chevronRight).toBeLessThanOrEqual(bounds.buttonRight + 1);

  // The whole dropdown box must stay within its picker and its containing
  // rail/sheet, not merely clip the selected text or hide the right border.
  const fieldBoxes = await surface.locator('[data-ui="filter-picker"]').evaluateAll((pickers) =>
    pickers.map((picker) => {
      const button = picker.querySelector('button[aria-haspopup="dialog"]')!;
      const pickerRect = picker.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const containerRect = picker.parentElement!.getBoundingClientRect();
      return {
        pickerWidth: pickerRect.width,
        buttonWidth: buttonRect.width,
        pickerLeft: pickerRect.left,
        pickerRight: pickerRect.right,
        buttonLeft: buttonRect.left,
        buttonRight: buttonRect.right,
        containerRight: containerRect.right,
      };
    }),
  );
  expect(fieldBoxes.length).toBeGreaterThan(0);
  for (const field of fieldBoxes) {
    expect(field.pickerWidth).toBeGreaterThan(0);
    expect(field.buttonWidth).toBeLessThanOrEqual(field.pickerWidth + 1);
    expect(field.buttonLeft).toBeGreaterThanOrEqual(field.pickerLeft - 1);
    expect(field.buttonRight).toBeLessThanOrEqual(field.pickerRight + 1);
    expect(field.buttonRight).toBeLessThanOrEqual(field.containerRight + 1);
  }
});

test("mobile filtering opens an accessible sheet", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 900, "Mobile and tablet contract");
  await page.goto("/compendium");
  await waitForCompendium(page);
  await page.getByRole("button", { name: /^Filters/ }).click();
  const sheet = page.getByRole("dialog", { name: "Card filters" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: /^Faction:/ }).click();
  const factionPicker = page.getByRole("dialog", { name: "Faction options" });
  await expect(factionPicker).toBeVisible();
  const aquosOption = factionPicker.getByRole("option", { name: /Aquos/ });
  const darkusOption = factionPicker.getByRole("option", { name: /Darkus/ });
  await aquosOption.click();
  await darkusOption.click();
  await expect.poll(() => new URL(page.url()).searchParams.getAll("faction")).toEqual(["Aquos", "Darkus"]);

  await darkusOption.click();
  await aquosOption.click();
  await expect(aquosOption).toHaveAttribute("aria-selected", "false");
  await expect.poll(() => new URL(page.url()).searchParams.getAll("faction")).toEqual([]);
  expect(await aquosOption.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgba(0, 0, 0, 0)");

  await factionPicker.getByRole("button", { name: "Done" }).click();
  await expect(sheet.getByRole("button", { name: /Show \d+ cards/ })).toBeVisible();
});

test("BakuCore tab exposes set filters and a shareable inspector", async ({ page }) => {
  await page.goto("/compendium/cores");
  await waitForCompendium(page);
  await expect(page.getByText(/\d+ BakuCores/)).toBeVisible();
  await page.getByRole("button", { name: /^Set:/ }).click();
  const coreSetPicker = page.getByRole("dialog", { name: "Set options" });
  await coreSetPicker.getByRole("option", { name: /Armored Alliance/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("coreSet")).toBe("Armored Alliance");
  const tile = page.locator('[data-ui="card-grid"] > button').first();
  await tile.click();
  const inspector = page.locator('[data-ui="core-inspector"]');
  await expect(inspector).toBeVisible();
  const backdrop = page.locator('[data-ui="core-inspector-backdrop"]');
  await expect(backdrop).toBeVisible();
  await expect(inspector.getByText("Armored Alliance", { exact: true }).first()).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("core")).toMatch(/^aa-core-/);

  const viewport = page.viewportSize()!;
  const geometry = await inspector.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { position: getComputedStyle(element).position, width: rect.width, height: rect.height };
  });
  if (viewport.width <= 900) {
    expect(geometry.position).toBe("relative");
    expect(Math.abs(geometry.width - viewport.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.height - viewport.height)).toBeLessThanOrEqual(1);
  } else {
    expect(geometry.position).toBe("relative");
    expect(geometry.width).toBeGreaterThan(900);
    expect(geometry.width).toBeLessThanOrEqual(1056);
  }
});


test("BakuCore previews have one type, individual stats, and one set identifier", async ({ page }) => {
  await page.goto("/compendium/cores");
  await waitForCompendium(page);
  const tile = page.locator('[data-ui="card-grid"] > button').first();
  await expect(tile.locator("strong")).toHaveText("Fist");
  await expect(tile.locator('[class*="coreStatList"] > span')).toHaveCount(1);
  await expect(tile.locator('[class*="coreSetLabel"]')).toHaveText("BB #1");
  await expect(tile).not.toContainText(/Alternate|Fist \+0/);

  // The set boundary must come after the complete Battle Brawlers run.
  await page.goto("/compendium/cores?corePage=3");
  await waitForCompendium(page);
  const setLabels = page.locator('[data-ui="card-grid"] > button [class*="coreSetLabel"]');
  await expect(setLabels.nth(0)).toHaveText("BB #49");
  await expect(setLabels.nth(3)).toHaveText("BB #52");
  await expect(setLabels.nth(4)).toHaveText("AA #1");

  // Alternate artwork remains discoverable by set without exposing a badge.
  await page.goto("/compendium/cores?coreSet=Armored+Alliance");
  await waitForCompendium(page);
  await expect(page.locator('[data-ui="card-grid"]')).not.toContainText(/Alternate printing/i);
});

test("desktop cards and BakuCore controls live in their filter rails", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) <= 1180, "Desktop filter rail contract");
  await page.goto("/compendium");
  await waitForCompendium(page);
  const cardRail = page.getByRole("complementary", { name: "Card filters" });
  await expect(cardRail).toBeVisible();
  await expect(cardRail.getByRole("button", { name: /^Sort:/ })).toBeVisible();
  await cardRail.getByRole("button", { name: /^Card type:/ }).click();
  const cardTypePicker = page.getByRole("dialog", { name: "Card type options" });
  await cardTypePicker.getByRole("option", { name: /Character/ }).click();
  await cardTypePicker.getByRole("button", { name: "Done" }).click();
  await expect(cardRail.getByRole("button", { name: /^Energy cost:/ })).toHaveCount(0);
  await expect(cardRail.getByRole("button", { name: /^Rarity:/ })).toHaveCount(0);
  await expect(cardRail.getByRole("button", { name: /^Core type:/ })).toBeVisible();
  await cardRail.getByRole("button", { name: /^Sort:/ }).click();
  const sortPicker = page.getByRole("dialog", { name: "Sort options" });
  const characterSorts = await sortPicker.getByRole("option").allTextContents();
  expect(characterSorts.some((label) => label.includes("B-Power high–low"))).toBe(true);
  expect(characterSorts.some((label) => label.includes("Damage high–low"))).toBe(true);
  expect(characterSorts.some((label) => label.includes("Energy low–high"))).toBe(false);
  expect(characterSorts.some((label) => label.includes("Energy high–low"))).toBe(false);
  await sortPicker.getByRole("button", { name: "Done" }).click();

  await page.goto("/compendium/cores");
  await waitForCompendium(page);
  const coreRail = page.getByRole("complementary", { name: "BakuCore filters" });
  await expect(coreRail).toBeVisible();
  await expect(coreRail.getByRole("button", { name: /^Set:/ })).toBeVisible();
  await expect(coreRail.getByRole("button", { name: /^Core type:/ })).toBeVisible();
  await expect(coreRail.getByRole("button", { name: /^Sort:/ })).toBeVisible();
});

test("mobile reference contents slide in from the left and collapse after navigation", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 900, "Mobile reference navigation");
  for (const section of ["rules", "glossary", "rulings"]) {
    await page.goto(`/compendium/${section}`);
    await waitForCompendium(page);
    const contents = page.locator("[data-reference-contents]");
    const toggle = page.getByRole("button", { name: "Open contents" });
    await expect(toggle).toBeVisible();
    await expect(contents).toBeHidden();
    await toggle.click();
    await expect(contents).toBeVisible();
    expect(await contents.evaluate((element) => getComputedStyle(element).position)).toBe("fixed");
    expect((await contents.boundingBox())?.x).toBeGreaterThanOrEqual(0);
    await page.keyboard.press("Escape");
    await expect(contents).toBeHidden();
    await toggle.click();
    await contents.getByRole("link").first().click();
    await expect(contents).toBeHidden();
  }
});

test("mobile glossary terms render in two columns", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 700, "Portrait mobile glossary layout");
  await page.goto("/compendium/glossary");
  await waitForCompendium(page);
  const grid = page.locator('[id^="glossary-letter-"] > div').first();
  await expect(grid).toBeVisible();
  const columns = await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(2);
});
