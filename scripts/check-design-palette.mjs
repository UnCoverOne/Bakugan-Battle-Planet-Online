/**
 * Guard the blank-slate theme against hard-coded hex colours reappearing in
 * shared homepage components. Artwork, faction illustrations and special
 * gameplay effects are intentionally outside this UI palette check.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = path => readFileSync(join(root, path), "utf8");
const source = read("app/design-system.css");
const definitions = new Set(
  [...source.matchAll(/(--bb-[a-z0-9-]+)\s*:/gi)].map(match => match[1]),
);
const targets = [
  "components/routes/BlankDashboardScreen.module.css",
  "components/application/SiteNavigation.module.css",
  "components/routes/DeckGalleryCard.module.css",
  "components/routes/BattleActivityPanel.module.css",
];
const errors = [];
for (const target of targets) {
  const css = read(target);
  const literals = [...css.matchAll(/#[0-9a-f]{3,8}\b/gi)];
  if (literals.length) errors.push(`${target}: ${literals.length} hard-coded hex colours`);
  for (const [, token] of css.matchAll(/var\((--bb-[a-z0-9-]+)/gi)) {
    if (!definitions.has(token)) errors.push(`${target}: undefined ${token}`);
  }
}
if (!read("app/layout.tsx").includes('import "./design-system.css"')) {
  errors.push("app/layout.tsx does not import the shared design system");
}
if (errors.length) {
  console.error("Palette regression check failed:\n" + errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Palette check passed: ${targets.length} UI stylesheets use defined shared tokens.`);
}
