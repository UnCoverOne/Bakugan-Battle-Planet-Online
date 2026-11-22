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
  const coreSlot = deck.locator('[class*="coreSlot"]').first();
  const remove = coreSlot.getByRole("button", { name: /^Remove / });
  await expect(remove).toBeAttached({ timeout: 20_000 });
  await coreSlot.hover();
  await expect.poll(() => remove.evaluate(el => getComputedStyle(el).opacity)).toBe("1");
  await remove.click();
  const empty = deck.locator('button[aria-label^="Choose"][aria-label$="BakuCore"]').first();
  await expect(empty).toBeVisible();
  await empty.click();
  await expect(builder.locator('section[aria-label="Browse cards"] [data-cores-gallery]')).toBeVisible();
  await expect(builder.getByRole("navigation", { name: "Card types" }).getByRole("button", { name: "BakuCores" }))
    .toHaveAttribute("aria-current", "page");
});

test("Team cards display rolling tags below the art and use Compendium hover treatment", async ({ page }) => {
  await page.goto("/builder/deck-pyrus");
  const builder = page.locator('[data-ui="deck-builder"]');
  const tabs = builder.getByRole("navigation", { name: "Builder views" });
  if (await tabs.isVisible()) await tabs.getByRole("button", { name: "Deck", exact: true }).click();
  const team = builder.locator('aside[aria-label="Current deck"]');
  const character = team.locator('[class*="teamCharacter"]').first();
  const inspectCharacter = character.getByRole("button", { name: /^Inspect / });
  const rollingTags = character.locator('[class*="teamRollingStats"]');
  await expect(inspectCharacter).toBeVisible({ timeout: 20_000 });
  await expect(rollingTags.getByRole("img", { name: /^Roll Accuracy:/ })).toBeVisible();
  await expect(rollingTags.getByRole("img", { name: /^Double Core Chance:/ })).toBeVisible();
  const artwork = inspectCharacter.locator('[class*="artwork"]');
  const artworkBounds = await artwork.boundingBox();
  const statsBounds = await rollingTags.boundingBox();
  expect(artworkBounds).not.toBeNull();
  expect(statsBounds).not.toBeNull();
  expect(statsBounds!.y).toBeGreaterThanOrEqual(artworkBounds!.y + artworkBounds!.height - 1);
  await expect(inspectCharacter).toHaveCSS("cursor", "pointer");
  await inspectCharacter.hover();
  await expect.poll(async () => artwork.evaluate(element =>
    getComputedStyle(element, "::after").opacity)).toBe("1");
  const coreInspect = team.locator('[class*="coreSlot"] button[aria-label^="Inspect"]').first();
  await expect(coreInspect).toHaveCSS("cursor", "pointer");
  await coreInspect.hover();
  await expect.poll(async () => coreInspect.locator('[class*="artwork"]').evaluate(element =>
    getComputedStyle(element, "::after").opacity)).toBe("1");
});

test("Team removal controls use dark circular backings and appear on hover or focus", async ({ page }) => {
  await page.goto("/builder/deck-pyrus");
  const builder = page.locator('[data-ui="deck-builder"]');
  const tabs = builder.getByRole("navigation", { name: "Builder views" });
  if (await tabs.isVisible()) await tabs.getByRole("button", { name: "Deck", exact: true }).click();
  const team = builder.locator('aside[aria-label="Current deck"]');
  const heading = team.locator('[class*="sectionHeading"]').first();
  await expect(heading.locator("svg")).toHaveCount(2);
  const character = team.locator('[class*="teamCharacter"]').first();
  const removeCharacter = character.getByRole("button", { name: /^Remove / });
  await expect(removeCharacter.locator("svg")).toBeVisible();
  await expect(removeCharacter).toHaveCSS("background-color", "rgba(2, 12, 17, 0.85)");
  await expect(removeCharacter).toHaveCSS("border-top-width", "0px");
  await expect(removeCharacter).toHaveCSS("top", "4px");
  await expect(removeCharacter).toHaveCSS("right", "4px");
  await expect(removeCharacter).toHaveCSS("border-radius", "50%");
  await expect(removeCharacter.locator("svg")).toHaveCSS("filter", "none");
  await character.hover();
  await expect.poll(() => removeCharacter.evaluate(el => getComputedStyle(el).opacity)).toBe("1");
  const coreSlot = team.locator('[class*="coreSlot"]').first();
  const removeCore = coreSlot.getByRole("button", { name: /^Remove / });
  await coreSlot.hover();
  await expect.poll(() => removeCore.evaluate(el => getComputedStyle(el).opacity)).toBe("1");
  await expect(removeCore).toHaveCSS("background-color", "rgba(2, 12, 17, 0.85)");
  await expect(removeCore).toHaveCSS("border-top-width", "0px");
  await expect(removeCore).toHaveCSS("top", "3px");
  await expect(removeCore).toHaveCSS("right", "3px");
  await expect(removeCore).toHaveCSS("border-radius", "50%");
  await expect(removeCore.locator("svg")).toHaveCSS("filter", "none");
});
