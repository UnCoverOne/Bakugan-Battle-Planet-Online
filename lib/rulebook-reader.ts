import { OFFICIAL_RULEBOOK, type OfficialRuleNode } from "./official-rulebook";

// The complete source hierarchy and text remain in official-rulebook.ts.
// These are the original six corrections, always visible during normal reading.
export const RULEBOOK_ERRATA = [
  "All Flow text is changed from “Flow: If you played another card this turn,” to “Flow: If this is not the first card you played this turn,”",
  "Diamond Fangzor, despite the toy paint, is intended to be played with the Pyrus Fangzor Character card.",
  "Hyper Gortion Ultra’s name is intended to be “Hyper Gorthion Ultra” and played with the Darkus Gorthion Ultra Character card.",
  "Titan Nillious text is changed from “Titan Haos Fangzor.” to “this.”",
  "Titan Nillious Ultra in some cases is missing a “3” before the Energy icon in its text. In all cases, the text should read “this costs 3 (Energy icon) less to play.”",
  "Maximus Dragonoid – “If you control Dan Kouzo, Wynton Styles, and Lia Venegas, you win the game.”"
] as const;

export type VisibleRule = {
  id: string;
  text: string;
  children: VisibleRule[];
};
export type VisibleSection = {
  id: string;
  text: string;
  rules: VisibleRule[];
};
export type VisibleChapter = {
  id: string;
  text: string;
  sections: VisibleSection[];
};
export type RulebookSelection = {
  chapters: VisibleChapter[];
  errata: readonly string[];
  hasResults: boolean;
};

// Stable, original source IDs (never calculate numbering after filtering).
export const RULEBOOK_IDS = new Set<string>();
function indexRuleIds(nodes: readonly OfficialRuleNode[], prefix = "") {
  nodes.forEach((node, index) => {
    const id = prefix ? prefix + "." + (index + 1) : String(index + 1);
    RULEBOOK_IDS.add(id);
    indexRuleIds(node.children, id);
  });
}
indexRuleIds(OFFICIAL_RULEBOOK);

export function ruleAnchor(id: string): string {
  const depth = id.split(".").length;
  return "#" + (depth === 1 ? "chapter" : depth === 2 ? "section" : "rule") + "-" + id;
}

// Preserve the actual deployed route, but never copy search parameters that
// could filter the linked rule out of view. Construct the URL without navigating.
export function ruleLinkUrl(currentPageUrl: string, id: string): string {
  const url = new URL(currentPageUrl);
  url.search = "";
  url.hash = ruleAnchor(id);
  return url.href;
}

export function selectRulebook(query: string, anchor = ""): RulebookSelection {
  const search = query.trim().toLowerCase();
  const hash = /^(chapter|section|rule)-(\d+(?:\.\d+)*)$/.exec(anchor);
  const anchorId = hash?.[2] ?? "";
  const forcedChapter = hash?.[1] === "chapter" ? anchorId : "";
  const forcedSection = hash?.[1] === "section"
    ? anchorId : hash?.[1] === "rule" ? anchorId.split(".").slice(0, 2).join(".") : "";

  const selectNode = (node: OfficialRuleNode, id: string, all: boolean): VisibleRule | null => {
    const includeAll = all || node.text.toLowerCase().includes(search) || id === search;
    const children = node.children.flatMap((child, i) => {
      const selected = selectNode(child, id + "." + (i + 1), includeAll);
      return selected ? [selected] : [];
    });
    return includeAll || children.length ? { id, text: node.text, children } : null;
  };

  const chapters = OFFICIAL_RULEBOOK.flatMap((chapter, chapterIndex): VisibleChapter[] => {
    const id = String(chapterIndex + 1);
    const wholeChapter = !search || (chapter.text.toLowerCase().includes(search) || id === search) || forcedChapter === id;
    const sections = chapter.children.flatMap((section, sectionIndex): VisibleSection[] => {
      const sectionId = id + "." + (sectionIndex + 1);
      const wholeSection = wholeChapter || (section.text.toLowerCase().includes(search) || sectionId === search)
        || forcedSection === sectionId;
      const rules = section.children.flatMap((rule, ruleIndex) => {
        const selected = selectNode(rule, sectionId + "." + (ruleIndex + 1), wholeSection);
        return selected ? [selected] : [];
      });
      if (!wholeSection && !rules.length) return [];
      return [{ id: sectionId, text: section.text, rules }];
    });
    return wholeChapter || sections.length ? [{ id, text: chapter.text, sections }] : [];
  });

  const showAllErrata = !search || "errata".includes(search) || anchor === "rulebook-errata";
  const errata = showAllErrata
    ? RULEBOOK_ERRATA
    : RULEBOOK_ERRATA.filter(correction => correction.toLowerCase().includes(search));

  return { chapters, errata, hasResults: chapters.length > 0 || errata.length > 0 };
}
