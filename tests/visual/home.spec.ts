import { expect, test } from "@playwright/test";

test("Home keeps its hero actions and Featured Deck content inside their panels at responsive sizes", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/dashboard");
  await expect(page.locator(".bakugan-home")).toBeVisible();
  await expect(page.locator(".home-featured-deck-copy .hex-button")).toBeVisible();

  // Covers the two reported layouts, short desktop windows, large displays,
  // and the widths where the featured panel becomes a stacked layout.
  const viewports = [
    { width: 1250, height: 1200 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1700, height: 864 },
    { width: 1920, height: 1080 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const bounds = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`Missing Home layout element: ${selector}`);
        const box = element.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, height: box.height };
      };
      return {
        hero: rect(".bakugan-home-hero"),
        heroCopy: rect(".bakugan-home-hero-copy"),
        heroActions: rect(".bakugan-home-hero-copy .hero-actions"),
        featured: rect(".home-featured-deck"),
        featuredCopy: rect(".home-featured-deck-copy"),
        featuredTitle: rect(".home-featured-deck-copy h3"),
        featuredLink: rect(".home-featured-deck-copy .hex-button"),
      };
    });

    for (const [name, parent, child] of [
      ["hero copy", bounds.hero, bounds.heroCopy],
      ["hero actions", bounds.hero, bounds.heroActions],
      ["featured copy", bounds.featured, bounds.featuredCopy],
      ["featured title", bounds.featured, bounds.featuredTitle],
      ["view deck action", bounds.featured, bounds.featuredLink],
    ] as const) {
      expect(child.top, `${name} top at ${viewport.width}×${viewport.height}`).toBeGreaterThanOrEqual(parent.top - 2);
      expect(child.bottom, `${name} bottom at ${viewport.width}×${viewport.height}`).toBeLessThanOrEqual(parent.bottom + 2);
      expect(child.left, `${name} left at ${viewport.width}×${viewport.height}`).toBeGreaterThanOrEqual(parent.left - 2);
      expect(child.right, `${name} right at ${viewport.width}×${viewport.height}`).toBeLessThanOrEqual(parent.right + 2);
    }
  }
});
