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
