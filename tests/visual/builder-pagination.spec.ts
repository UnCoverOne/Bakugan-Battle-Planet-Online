import { expect, test } from "@playwright/test";

test("Builder gallery pages every category and keeps mobile navigation in the deck header", async ({ page }) => {
  await page.goto("/builder/deck-pyrus");
  const gallery = page.locator('[data-ui="builder-panel"][data-active="true"]');
  await expect(gallery.getByRole("navigation", { name: "Card Gallery sections" })).toBeVisible({ timeout: 20_000 });

  const viewport = page.viewportSize()!;
  const header = page.locator('header[class*="builderHeader"]');
  const switcher = page.getByRole("navigation", { name: "Deck Builder sections" });
  if (viewport.width <= 800) {
    await expect(header.locator('[aria-label="Deck Builder sections"]')).toBeVisible();
    await expect(switcher).toHaveCSS("position", "static");
  } else {
    await expect(switcher).toBeHidden();
  }

  const categoryTabs = gallery.getByRole("navigation", { name: "Card Gallery sections" });
  await expect(categoryTabs).toHaveCSS("clip-path", "none");
  const toolbar = gallery.getByRole("search", { name: "Card Gallery tools" });
  await expect(toolbar).toHaveCSS("position", "sticky");

  for (const category of ["Character Cards", "Cores", "Main Deck Cards"]) {
    await categoryTabs.getByRole("button", { name: category, exact: true }).click();
    const pagination = gallery.getByRole("navigation", { name: "Card Gallery pages" });
    await expect(pagination).toBeVisible();
    const first = gallery.locator('[class*="builderGalleryGrid"] > article');
    await expect(first.first()).toBeVisible();
    expect(await first.count()).toBeLessThanOrEqual(24);
    await expect(pagination).toContainText("Page 1 of");

    const next = pagination.getByRole("button", { name: "Next", exact: true });
    if (await next.isEnabled()) {
      const firstPageName = await first.first().textContent();
      await next.click();
      await expect(pagination).toContainText("Page 2 of");
      await expect(first.first()).not.toHaveText(firstPageName ?? "");
      expect(await first.count()).toBeLessThanOrEqual(24);
      // Sorting/filter changes must reset the page before displaying new results.
      await categoryTabs.getByRole("button", { name: category, exact: true }).click();
    }
  }
});

test("phone gallery pager stays on one row without extra padding below it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Phone-only pagination layout");
  await page.goto("/builder/deck-pyrus");
  const gallery = page.locator('[data-ui="builder-panel"][data-active="true"]');
  const pager = gallery.getByRole("navigation", { name: "Card Gallery pages" });
  await expect(pager).toBeVisible({ timeout: 20_000 });

  for (const width of [320, 375, 390, 540]) {
    await page.setViewportSize({ width, height: 844 });
    const layout = await pager.evaluate((nav) => {
      const controls = nav.querySelector('[class*="builderGalleryPageControls"]')!;
      const buttons = [...controls.querySelectorAll("button")];
      const indicator = controls.querySelector('[class*="builderGalleryPageIndicator"]')!;
      const elements = [...buttons, indicator];
      const rect = controls.getBoundingClientRect();
      return {
        width: rect.width,
        navHeight: nav.getBoundingClientRect().height,
        positions: elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, height: box.height };
        }),
      };
    });
    expect(layout.positions).toHaveLength(5);
    const rows = layout.positions.map(({ top }) => top);
    expect(Math.max(...rows) - Math.min(...rows), `pager row at ${width}px`).toBeLessThanOrEqual(1);
    expect(layout.navHeight, `pager height at ${width}px`).toBeLessThanOrEqual(100);
    for (const item of layout.positions) {
      expect(item.left).toBeGreaterThanOrEqual(-1);
      expect(item.right).toBeLessThanOrEqual(width + 1);
    }
    for (const item of layout.positions.filter((_, index) => index < 4)) {
      expect(item.height).toBeGreaterThanOrEqual(44);
    }

    const padding = await page.locator('section[class*="builder"]').first().evaluate(
      (builder) => parseFloat(getComputedStyle(builder).paddingBottom),
    );
    // Only the status bar (3.75rem) and mobile navigation (4.2rem) are reserved.
    expect(padding).toBeGreaterThanOrEqual(120);
    expect(padding).toBeLessThanOrEqual(130);
  }
});

test("phone deck header shares a compact control height, full-width tabs and themed format menu", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Responsive phone header contract");
  await page.goto("/builder/deck-pyrus");
  const header = page.locator('header[class*="builderHeader"]');
  const picker = header.locator('[data-ui="filter-picker"] > button');
  const save = header.getByRole("button", { name: "Save Deck" });
  const tabs = header.getByRole("navigation", { name: "Deck Builder sections" });
  await expect(picker).toBeVisible({ timeout: 20_000 });

  for (const width of [320, 375, 390, 540, 768]) {
    await page.setViewportSize({ width, height: 844 });
    const positions = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>('header[class*="builderHeader"]')!;
      const box = (selector: string) => {
        const element = header.querySelector<HTMLElement>(selector)!;
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height };
      };
      const format = box('[data-ui="filter-picker"] > button');
      const save = box('[data-ui="action-button"]');
      const tabs = box('[aria-label="Deck Builder sections"]');
      const title = box('[class*="builderDeckIdentity"]');
      const titleText = header.querySelector<HTMLElement>('[class*="builderDeckIdentity"] strong')!;
      const titleStyle = getComputedStyle(titleText);
      return {
        format, save, tabs, title,
        titleLine: {
          height: titleText.getBoundingClientRect().height,
          lineHeight: parseFloat(titleStyle.lineHeight),
          whiteSpace: titleStyle.whiteSpace,
          textOverflow: titleStyle.textOverflow,
        },
      };
    });
    expect(Math.abs(positions.format.height - positions.save.height)).toBeLessThanOrEqual(1);
    expect(positions.format.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(positions.format.top - positions.save.top)).toBeLessThanOrEqual(1);
    expect(positions.title.right).toBeLessThanOrEqual(positions.format.left + 1);
    expect(positions.titleLine.whiteSpace).toBe("nowrap");
    expect(positions.titleLine.textOverflow).toBe("ellipsis");
    expect(positions.titleLine.height).toBeLessThanOrEqual(positions.titleLine.lineHeight + 1);
    expect(positions.tabs.left).toBeGreaterThanOrEqual(-1);
    expect(positions.tabs.right).toBeLessThanOrEqual(width + 1);
    expect(positions.tabs.left).toBeLessThanOrEqual(1);
    expect(width - positions.tabs.right).toBeLessThanOrEqual(1);
    expect(positions.tabs.height).toBe(44);
    await expect(tabs.locator("button")).toHaveCount(2);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(picker).toHaveAttribute("aria-label", /^Deck format: Standard$/);
  await picker.click();
  const choices = page.getByRole("dialog", { name: "Deck format options" });
  await expect(choices).toBeVisible();
  await choices.getByRole("option", { name: /Singleton/ }).click();
  await expect(picker).toHaveAttribute("aria-label", /^Deck format: Singleton$/);
  await picker.click();
  await choices.getByRole("option", { name: /Standard/ }).click();
  await expect(picker).toHaveAttribute("aria-label", /^Deck format: Standard$/);
  await expect(save).toBeVisible();
});
