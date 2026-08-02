import { expect, test, type Page, type TestInfo } from "@playwright/test";

const routes = [
  { name: "decks", path: "/decks" },
  { name: "deck-detail", path: "/decks/deck-pyrus" },
  { name: "public-decks", path: "/decks/public" },
  { name: "public-deck-detail", path: "/decks/public/public-aquos-control" },
  { name: "deck-builder", path: "/builder/deck-pyrus" },
  { name: "play-setup", path: "/play" },
  { name: "compendium", path: "/compendium" },
  { name: "rules", path: "/compendium/rules" },
  { name: "rulings", path: "/compendium/rulings" },
  { name: "profile", path: "/profile" },
  { name: "achievements", path: "/profile/achievements" },
  { name: "records", path: "/profile/records" },
  { name: "settings", path: "/settings" },
] as const;

const primitiveCoverage: Partial<Record<(typeof routes)[number]["name"], string[]>> = {
  decks: ["route-hero", "action-button", "tabs"],
  "play-setup": ["route-hero", "surface", "action-button", "status-chip", "card-grid"],
  compendium: ["route-hero", "surface", "field", "card-grid"],
};

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
});

async function waitForWorkspace(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.locator("main").waitFor({ state: "visible" });
  await expect
    .poll(
      () =>
        page
          .locator("main")
          .evaluate((main) => !main.textContent?.includes("RESTORING LOCAL BRAWLER DATA")),
      { timeout: 15_000 },
    )
    .toBe(true);
}


test("mobile shell shares the desktop account menu and primary tabs", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile shell contract");

  await page.goto("/dashboard");
  await waitForWorkspace(page);

  const bottomNavigation = page.locator(".mobile-bottom-nav");
  await expect(bottomNavigation).toBeVisible();
  await expect(bottomNavigation.locator("a")).toHaveCount(4);
  await expect(bottomNavigation.locator("a span")).toHaveText([
    "Home",
    "Play",
    "Decks",
    "Compendium",
  ]);
  await expect(bottomNavigation.getByText("Profile", { exact: true })).toHaveCount(0);

  const accountTrigger = page.getByRole("button", {
    name: "Open profile menu",
  });
  await expect(accountTrigger).toBeVisible();
  await accountTrigger.click();

  const accountMenu = page.locator("#profile-menu");
  await expect(accountMenu).toBeVisible();
  const [menuBounds, viewport] = await Promise.all([
    accountMenu.boundingBox(),
    Promise.resolve(page.viewportSize()),
  ]);
  expect(menuBounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
  expect(menuBounds!.y).toBeGreaterThanOrEqual(64);
  expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(viewport!.width);
  expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(viewport!.height);
  await expect(accountMenu.getByRole("link", { name: "View Profile" })).toBeVisible();
  await expect(accountMenu.getByRole("link", { name: "Achievements" })).toBeVisible();
  await expect(accountMenu.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(accountMenu.locator(".profile-popover-title img")).toBeVisible();
  await expect(accountMenu.locator(".profile-popover-stat-value")).toHaveCount(2);
  await expect(accountMenu.getByRole("button", { name: "Log out" })).toBeVisible();
});

async function attachViewport(page: Page, testInfo: TestInfo, routeName: string) {
  await testInfo.attach(`${routeName}-${testInfo.project.name}`, {
    body: await page.screenshot({ animations: "disabled", fullPage: false }),
    contentType: "image/png",
  });
}

for (const route of routes) {
  test(`${route.name} satisfies the responsive visual contracts`, async ({ page }, testInfo) => {
    await page.goto(route.path);
    await waitForWorkspace(page);

    const overflow = await page.evaluate(() => ({
      body: document.body.scrollWidth - document.body.clientWidth,
      html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(overflow.body, "body must not overflow horizontally").toBeLessThanOrEqual(1);
    expect(overflow.html, "document must not overflow horizontally").toBeLessThanOrEqual(1);

    const undersizedMetadata = await page.evaluate(() => {
      const selector = [
        "small",
        ".badge",
        "[data-ui='status-chip']",
        ".metric span",
        "dt",
        ".record-table-head",
        ".public-deck-actions a",
        ".public-deck-actions button",
        ".catalog-piece span",
        ".selected-card-list span",
        ".selected-core-grid span",
        ".selected-bakugan-grid span",
        ".deck-type-summary span",
        ".deck-validation-summary p",
      ].join(",");
      return Array.from(document.querySelectorAll<HTMLElement>(selector))
        .filter((element) => {
          const style = getComputedStyle(element);
          return style.display !== "none"
            && style.visibility !== "hidden"
            && element.getClientRects().length > 0
            && Boolean(element.textContent?.trim());
        })
        .map((element) => ({
          selector: element.className || element.tagName.toLowerCase(),
          text: element.textContent?.trim().slice(0, 60),
          size: Number(getComputedStyle(element).fontSize.replace("px", "")),
        }))
        .filter(({ size }) => size < 12);
    });
    expect(undersizedMetadata, "metadata must remain at least 12px").toEqual([]);

    const enlargedFullScans = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLImageElement>("img[src*='/assets/cards/full/']"))
        .filter((image) => image.complete && image.naturalWidth > 0)
        .map((image) => ({
          alt: image.alt,
          source: image.currentSrc,
          naturalWidth: image.naturalWidth,
          renderedWidth: image.getBoundingClientRect().width,
        }))
        .filter(({ naturalWidth, renderedWidth }) => renderedWidth > naturalWidth + 1),
    );
    expect(enlargedFullScans, "full scans must not be enlarged beyond source width").toEqual([]);

    const unchamferedPanels = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".panel,[data-ui='surface']"))
        .filter((panel) => {
          const style = getComputedStyle(panel);
          return style.display !== "none"
            && panel.getClientRects().length > 0
            && style.clipPath === "none";
        })
        .map((panel) => panel.className),
    );
    expect(unchamferedPanels, "visible route panels must retain the shared chamfer").toEqual([]);

    await page.keyboard.press("Tab");
    const focusIndicator = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return null;
      const style = getComputedStyle(element);
      const before = getComputedStyle(element, "::before");
      return {
        tag: element.tagName,
        outline: style.outlineStyle,
        shadow: style.boxShadow,
        filter: style.filter,
        beforeBackground: before.backgroundColor,
      };
    });
    expect(focusIndicator, "keyboard focus must move to a visible control").not.toBeNull();
    expect(
      focusIndicator?.outline !== "none"
        || focusIndicator?.shadow !== "none"
        || focusIndicator?.filter !== "none"
        || focusIndicator?.beforeBackground !== "rgba(0, 0, 0, 0)",
      "the focused control must expose a visible indicator",
    ).toBe(true);

    for (const primitive of primitiveCoverage[route.name] ?? []) {
      const primitiveCount = await page.locator(`[data-ui="${primitive}"]`).count();
      expect(
        primitiveCount,
        `${primitive} should render on ${route.path}`,
      ).toBeGreaterThan(0);
    }

    if (route.name === "decks") {
      const deckNames = page.locator("[data-deck-name]");
      if (await deckNames.count()) {
        const deckNameContract = await deckNames.nth(0).evaluate((heading) => {
          const style = getComputedStyle(heading);
          return {
            clamp: style.getPropertyValue("-webkit-line-clamp"),
            overflow: style.overflow,
            wrap: style.overflowWrap,
          };
        });
        expect(deckNameContract).toEqual({
          clamp: "2",
          overflow: "hidden",
          wrap: "anywhere",
        });
      } else {
        await expect(page.getByText("Build your first battle deck")).toBeVisible();
      }
    }

    await attachViewport(page, testInfo, route.name);
  });
}
