import { expect, test, type Page } from "@playwright/test";

async function waitForCompendium(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.locator("main").waitFor({ state: "visible" });
  await expect(page.getByRole("heading", { name: "Compendium" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
});

test("selected cards preserve result state and use the responsive inspector", async ({ page }) => {
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
  if (viewport.width <= 900) {
    expect(geometry.position).toBe("fixed");
    expect(Math.abs(geometry.width - viewport.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.height - viewport.height)).toBeLessThanOrEqual(1);
  } else {
    expect(geometry.position).toBe("sticky");
    expect(geometry.width).toBeGreaterThanOrEqual(399);
    expect(geometry.width).toBeLessThanOrEqual(441);
  }
});

test("mobile filtering opens an accessible full-width sheet", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) > 900, "Mobile and tablet contract");
  await page.goto("/compendium");
  await waitForCompendium(page);
  await page.getByRole("button", { name: /^Filters/ }).click();
  const sheet = page.getByRole("dialog", { name: "Card filters" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Faction").selectOption("Aquos");
  await expect.poll(() => new URL(page.url()).searchParams.get("faction")).toBe("Aquos");
  await expect(sheet.getByRole("button", { name: /Show \d+ cards/ })).toBeVisible();
});
