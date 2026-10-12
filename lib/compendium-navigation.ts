export type CompendiumSection = "cards" | "cores" | "rules" | "rulings";
const sectionPaths: Record<CompendiumSection, string> = {
  cards: "/compendium", cores: "/compendium/cores", rules: "/compendium/rules", rulings: "/compendium/rulings",
};

/** Pathname remains authoritative after native history writes and back/forward. */
export function compendiumLocation(pathname: string | null, initialSegments: readonly string[] = []) {
  const segments = pathname && /^\/compendium(?:\/|$)/.test(pathname)
    ? pathname.slice("/compendium".length).split("/").filter(Boolean)
    : initialSegments;
  const first = segments[0];
  const section: CompendiumSection = first === "cores" || first === "rules" || first === "rulings" ? first : "cards";
  let legacyDetail = section === "cards" && first === "cards" ? segments[1] ?? "" : "";
  try { legacyDetail = decodeURIComponent(legacyDetail); } catch { /* Malformed legacy links keep their literal identifier. */ }
  return { section, legacyDetail };
}

/** Transfer only the shared search; filters, paging and inspectors belong to their section. */
export function compendiumSectionHref(section: CompendiumSection, query: string) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  return sectionPaths[section] + (params.size ? `?${params}` : "");
}

export function isCompendiumSectionChange(previous: string | null, current: string) {
  return previous !== current && Boolean(previous && /^\/compendium(?:\/|$)/.test(previous)) && /^\/compendium(?:\/|$)/.test(current);
}
