import { OFFICIAL_RULEBOOK, type OfficialRuleNode } from "./official-rulebook";

// Presentation-only filtering: official text and numbering are never changed.
export type VisibleRule = { id: string; text: string; children: VisibleRule[] };
export type VisibleSection = { id: string; text: string; rules: VisibleRule[] };
export type VisibleChapter = { id: string; text: string; sections: VisibleSection[] };

export const RULEBOOK_ERRATA = [
  "All Flow text is changed from “Flow: If you played another card this turn,” to “Flow: If this is not the first card you played this turn,”",
  "Diamond Fangzor, despite the toy paint, is intended to be played with the Pyrus Fangzor Character card.",
  "Hyper Gortion Ultra’s name is intended to be “Hyper Gorthion Ultra” and played with the Darkus Gorthion Ultra Character card.",
  "Titan Nillious text is changed from “Titan Haos Fangzor.” to “this.”",
  "Titan Nillious Ultra in some cases is missing a “3” before the Energy icon in its text. In all cases, the text should read “this costs 3 (Energy icon) less to play.”",
  "Maximus Dragonoid – “If you control Dan Kouzo, Wynton Styles, and Lia Venegas, you win the game.”",
] as const;

const ruleIds = new Set<string>();
function indexIds(nodes: readonly OfficialRuleNode[], prefix = ""): void {
  nodes.forEach((node, index) => {
    const id = prefix ? prefix + "." + (index + 1) : String(index + 1);
    ruleIds.add(id);
    indexIds(node.children, id);
  });
}
indexIds(OFFICIAL_RULEBOOK);

export function rulebookAnchor(id: string): string | null {
  if (!ruleIds.has(id)) return null;
  const depth = id.split(".").length;
  return (depth === 1 ? "chapter-" : depth === 2 ? "section-" : "rule-") + id;
}
function matches(text: string, id: string, query: string): boolean {
  return Boolean(query) && (text.toLowerCase().includes(query) || id === query);
}
function cloneRule(node: OfficialRuleNode, id: string): VisibleRule {
  return { id, text: node.text, children: node.children.map((child, i) => cloneRule(child, id + "." + (i + 1))) };
}
function selectRule(node: OfficialRuleNode, id: string, query: string, target: string): VisibleRule | null {
  // A matching parent includes its subordinate clauses, even when they do not
  // contain the query. A matching descendant retains every ancestor.
  if (!query || matches(node.text, id, query) || target === "rule-" + id) return cloneRule(node, id);
  const children = node.children.flatMap((child, i) => {
    const selected = selectRule(child, id + "." + (i + 1), query, target);
    return selected ? [selected] : [];
  });
  return children.length ? { id, text: node.text, children } : null;
}
export function selectRulebook(query: string, targetAnchor = ""): {
  chapters: VisibleChapter[]; errata: string[];
} {
  const filter = query.trim().toLowerCase();
  const chapters = OFFICIAL_RULEBOOK.flatMap((chapter, ci): VisibleChapter[] => {
    const chapterId = String(ci + 1);
    const fullChapter = !filter || matches(chapter.text, chapterId, filter) || targetAnchor === "chapter-" + chapterId;
    const sections = chapter.children.flatMap((section, si): VisibleSection[] => {
      const sectionId = chapterId + "." + (si + 1);
      const fullSection = fullChapter || matches(section.text, sectionId, filter)
        || targetAnchor === "section-" + sectionId;
      const rules = section.children.flatMap((node, ri): VisibleRule[] => {
        const id = sectionId + "." + (ri + 1);
        const result = fullSection ? cloneRule(node, id) : selectRule(node, id, filter, targetAnchor);
        return result ? [result] : [];
      });
      return fullSection || rules.length ? [{ id: sectionId, text: section.text, rules }] : [];
    });
    return sections.length ? [{ id: chapterId, text: chapter.text, sections }] : [];
  });
  const fullErrata = !filter || "errata".includes(filter) || targetAnchor === "rulebook-errata";
  const errata = RULEBOOK_ERRATA.filter(value => fullErrata || value.toLowerCase().includes(filter));
  return { chapters, errata };
}
