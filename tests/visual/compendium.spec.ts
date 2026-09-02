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

test("BakuCore tab exposes set filters and a shareable inspector", async ({ page }) => {
  await page.goto("/compendium/cores");
  await waitForCompendium(page);
  await expect(page.getByText(/\d+ BakuCores/)).toBeVisible();
  await page.getByLabel("Set").selectOption("Armored Alliance");
  await expect.poll(() => new URL(page.url()).searchParams.get("coreSet")).toBe("Armored Alliance");
  const tile = page.locator('[data-ui="card-grid"] > button').first();
  await tile.click();
  const inspector = page.locator('[data-ui="core-inspector"]');
  await expect(inspector).toBeVisible();
  await expect(inspector.getByText("Armored Alliance", { exact: true }).first()).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("core")).toMatch(/^aa-core-/);
});
