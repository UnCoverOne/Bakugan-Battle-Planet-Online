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
  await expect(inspector.getByRole("tab")).toHaveCount(2);
  await inspector.getByRole("tab", { name: "References" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe("references");
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

test("BakuCore gallery filters by Set and opens the corresponding printing", async ({ page }) => {
  await page.goto("/compendium/cores");
  await waitForCompendium(page);
  await expect(page.locator('[data-ui="core-grid"]')).toBeVisible();
  await page.getByRole("button", { name: /^Set:/ }).click();
  const picker = page.getByRole("dialog", { name: "Set" });
  await picker.getByRole("checkbox", { name: /Armored Alliance/ }).click();
  await picker.getByRole("button", { name: /Apply/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.getAll("coreSet")).toEqual(["Armored Alliance"]);
  const tile = page.locator('[data-ui="core-grid"] > button').first();
  await expect(tile.locator('[data-core-meta]')).toContainText("AA #");
  await tile.click();
  await expect(page.locator('[data-ui="card-inspector"]')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("core")).toMatch(/^(aa-core-|core-)/);
});

test("BakuCore detailed previews have uniform single-line effects and artwork-only compact mode", async ({ page }) => {
  await page.goto("/compendium/cores");
  await waitForCompendium(page);
  const gallery = page.locator('[data-ui="core-grid"]');
  const tile = gallery.locator("> button").first();
  await expect(tile.locator('[data-core-details] strong')).toHaveText("Fist");
  await expect(tile.locator('[data-core-meta]')).toContainText("BB #1");
  await expect(tile.locator('[data-core-meta] > [class*="effectStrip"] > [class*="effectTag"]')).toHaveCount(1);
  const metrics = await tile.locator('[data-core-meta]').evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    nowrap: getComputedStyle(element).whiteSpace === "nowrap",
  }));
  expect(metrics.height).toBe(24);
  expect(metrics.nowrap).toBe(true);

  // The set boundary follows the complete 52-core BB collector run.
  await page.goto("/compendium/cores?corePage=3");
  await waitForCompendium(page);
  const labels = page.locator('[data-ui="core-grid"] [class*="setTag"]');
  await expect(labels.nth(0)).toHaveText("BB #49");
  await expect(labels.nth(3)).toHaveText("BB #52");
  await expect(labels.nth(4)).toHaveText("AA #1");

  await page.goto("/compendium/cores?coreDensity=compact");
  await waitForCompendium(page);
  await expect(page.locator('[data-ui="core-grid"]')).toHaveAttribute("data-cores-view", "compact");
  await expect(page.locator('[data-core-details]')).toHaveCount(0);
});

test("BakuCore effect and numeric filters can be combined and shared", async ({ page }) => {
  await page.goto("/compendium/cores");
  await waitForCompendium(page);
  await page.getByRole("button", { name: /^Effects:/ }).click();
  const effects = page.getByRole("dialog", { name: "Effects" });
  await effects.getByRole("checkbox", { name: /Fusion Damage/ }).click();
  await effects.getByRole("button", { name: /Apply/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.getAll("coreEffect")).toEqual(["fusion-damage"]);
  await expect(page.locator('[data-ui="core-grid"] > button').first()).toHaveAttribute("aria-label", /While fused/);
  await page.getByRole("button", { name: /^Core Type:/ }).click();
  const coreTypes = page.getByRole("dialog", { name: "Core Type" });
  await coreTypes.getByRole("checkbox", { name: /^Fist$/ }).click();
  await coreTypes.getByRole("button", { name: /Apply/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.getAll("coreType")).toEqual(["Fist"]);
  await page.getByRole("button", { name: /^B Power:/ }).click();
  const power = page.getByRole("dialog", { name: "B Power" });
  await power.getByRole("checkbox", { name: "0", exact: true }).click();
  await power.getByRole("button", { name: /Apply/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.getAll("corePower")).toEqual(["0"]);
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
  const coreRail = page.getByRole("complementary", { name: "Filters & Sort" });
  await expect(coreRail).toBeVisible();
  await expect(coreRail.getByRole("button", { name: /^Set:/ })).toBeVisible();
  await expect(coreRail.getByRole("button", { name: /^Core type:/ })).toBeVisible();
  await expect(coreRail.getByRole("button", { name: /^Sort By:/ })).toBeVisible();
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

test("Cards Detailed and Compact views differ in metadata and preview density", async ({ page }) => {
  await page.goto("/compendium");
  const gallery = page.locator("[data-cards-gallery]");
  await expect(gallery).toHaveAttribute("data-cards-view", "detailed");
  const first = gallery.locator(":scope > button").first();
  await expect(first.locator("[data-card-preview] img")).toBeVisible();
  await expect(first.locator("[data-card-name]")).toBeVisible();
  await expect(first.locator("[data-card-meta]")).toBeVisible();
  expect(await first.locator("[data-card-name]").evaluate(el => getComputedStyle(el).whiteSpace)).toBe("nowrap");
  expect(await first.locator("[data-card-meta]").evaluate(el => getComputedStyle(el).flexWrap)).toBe("nowrap");
  const detailedWidth = (await first.boundingBox())!.width;

  await page.getByRole("button", { name: "Switch to compact view" }).click();
  await expect(gallery).toHaveAttribute("data-cards-view", "compact");
  await expect(gallery.locator("[data-card-details]")).toHaveCount(0);
  const compactFirst = gallery.locator(":scope > button").first();
  await expect(compactFirst.locator("[data-card-preview] img")).toBeVisible();
  const compactWidth = (await compactFirst.boundingBox())!.width;
  expect(compactWidth).toBeLessThan(detailedWidth);
  await compactFirst.click();
  await expect(page.locator('[data-ui="card-inspector"]')).toBeVisible();
});

test("Cards mobile layout shows two Detailed and three Compact previews per row", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/compendium");
  const gallery = page.locator("[data-cards-gallery]");
  await expect(gallery).toBeVisible();
  const columns = () => gallery.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  expect(await columns()).toBe(2);
  await page.getByRole("button", { name: "Switch to compact view" }).click();
  await expect(gallery).toHaveAttribute("data-cards-view", "compact");
  expect(await columns()).toBe(3);
});

test("Cards previews illuminate on hover without moving or scaling", async ({ page }) => {
  await page.goto("/compendium");
  const first = page.locator("[data-cards-gallery] > button").first();
  const preview = first.locator("[data-card-preview]");
  const before = await preview.evaluate(el => getComputedStyle(el, "::after").opacity);
  expect(before).toBe("0");
  await first.hover();
  await expect.poll(() => preview.evaluate(el => getComputedStyle(el, "::after").opacity)).toBe("1");
  expect(await first.evaluate(el => getComputedStyle(el).transform)).toBe("none");
});

test("Card and BakuCore hover highlights respect artwork silhouettes", async ({ page }) => {
  await page.goto("/compendium");
  const card = page.locator("[data-cards-gallery] > button").first();
  const cardArt = card.locator("[data-card-preview]");
  await expect(cardArt).toBeVisible();
  const cardClip = await cardArt.evaluate(el => ({
    overlay: getComputedStyle(el, "::after").clipPath,
    image: getComputedStyle(el.querySelector("img")!).clipPath,
  }));
  expect(cardClip.overlay).toContain("inset(0.85% round 4.6% / 3.3%)");
  expect(cardClip.overlay).toBe(cardClip.image);
  await card.hover();
  await expect.poll(() => cardArt.evaluate(el => getComputedStyle(el, "::after").opacity)).toBe("1");

  await page.goto("/compendium/cores");
  const core = page.locator("[data-cores-gallery] > button").first();
  const coreArt = core.locator("[data-core-preview]");
  await expect(coreArt).toBeVisible();
  await expect.poll(() => coreArt.evaluate(el => getComputedStyle(el, "::after").clipPath))
    .toContain("polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)");
  await core.hover();
  await expect.poll(() => coreArt.evaluate(el => getComputedStyle(el, "::after").opacity)).toBe("1");
});
