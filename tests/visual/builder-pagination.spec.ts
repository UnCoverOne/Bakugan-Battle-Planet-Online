import { expect, test } from "@playwright/test";

test("Builder uses the Compendium galleries and paginates all three categories", async ({ page }) => {
  await page.goto("/builder/deck-pyrus");
  const builder = page.locator('[data-ui="deck-builder"]');
  const browse = builder.locator('section[aria-label="Browse cards"]');
  const categories = browse.getByRole("navigation", { name: "Card types" });
  await expect(categories).toBeVisible({ timeout: 20_000 });

  for (const [category, grid] of [
    ["Characters", "[data-cards-gallery]"],
    ["BakuCores", "[data-cores-gallery]"],
    ["Cards", "[data-cards-gallery]"],
  ] as const) {
    await categories.getByRole("button", { name: category, exact: true }).click();
    await expect(browse.locator(grid)).toBeVisible();
    const inspectButtons = browse.locator(grid + ' button[aria-label^="Inspect"]');
    await expect(inspectButtons.first()).toBeVisible();
    expect(await inspectButtons.count()).toBeLessThanOrEqual(24);
    await expect(browse.locator('[class*="quantity"]').first()).toBeVisible();
  }

  const pager = browse.getByRole("navigation", { name: "Browse pages" });
  await expect(pager).toBeVisible();
  const next = pager.getByRole("button", { name: "Next page" });
  if (await next.isEnabled()) {
    await next.click();
    await expect(pager).toContainText("2 /");
    await categories.getByRole("button", { name: "Characters" }).click();
    await expect(pager).toContainText("1 /");
  }
});

test("Mobile switches between Browse and a real Main Deck card grid", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile layout");
  await page.goto("/builder/deck-pyrus");
  const builder = page.locator('[data-ui="deck-builder"]');
  const views = builder.getByRole("navigation", { name: "Builder views" });
  for (const width of [320, 375, 390, 540, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(views).toBeVisible();
    await views.getByRole("button", { name: "Deck", exact: true }).click();
    const deck = builder.locator('aside[aria-label="Current deck"]');
    await expect(deck).toBeVisible();
    await expect(deck.locator('[class*="teamGroup"]')).toHaveCount(3);
    await expect(deck.locator('[class*="pairedCores"]')).toHaveCount(3);
    await expect(deck.locator('[data-cards-gallery]')).toBeVisible();
    await expect(deck.locator('[class*="quantity"]').first()).toBeVisible();
    await expect(builder.locator('footer[class*="builderStatus"]')).toHaveCount(0);
    await views.getByRole("button", { name: "Browse", exact: true }).click();
    await expect(builder.locator('section[aria-label="Browse cards"]')).toBeVisible();
    const bounds = await builder.evaluate(element => element.getBoundingClientRect());
    expect(bounds.width).toBeLessThanOrEqual(width + 1);
  }
});

test("A missing core slot opens a core-type-filtered gallery", async ({ page }) => {
  await page.goto("/builder/deck-pyrus");
  const builder = page.locator('[data-ui="deck-builder"]');
  const views = builder.getByRole("navigation", { name: "Builder views" });
  if (await views.isVisible()) await views.getByRole("button", { name: "Deck", exact: true }).click();
  const deck = builder.locator('aside[aria-label="Current deck"]');
  const remove = deck.locator('[class*="coreSlot"] button[aria-label^="Remove"]').first();
  await expect(remove).toBeVisible({ timeout: 20_000 });
  await remove.click();
  const empty = deck.locator('button[aria-label^="Choose"][aria-label$="BakuCore"]').first();
  await expect(empty).toBeVisible();
  await empty.click();
  await expect(builder.locator('section[aria-label="Browse cards"] [data-cores-gallery]')).toBeVisible();
  await expect(builder.getByRole("navigation", { name: "Card types" }).getByRole("button", { name: "BakuCores" }))
    .toHaveAttribute("aria-current", "page");
});
