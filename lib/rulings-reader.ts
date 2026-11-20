import type { RulingRecord } from "./developer-rulings";

export type RulingMatchLocation = "visible" | "source" | "cards" | null;
export type TranscriptKind = "question" | "followup" | "response" | "correction";
export type TranscriptBlock = { text: string; kind: TranscriptKind };

// Search the summary first, but keep the entire original correspondence searchable.
// The location lets the UI explain why a result without a visible match was returned.
export function rulingMatchLocation(ruling: RulingRecord, query: string): RulingMatchLocation {
  const needle = query.trim().toLowerCase();
  if (!needle || needle === "q" + ruling.number ||
    [ruling.title, ruling.preview, ruling.category].some(value => value.toLowerCase().includes(needle))) {
    return "visible";
  }
  if (ruling.transcript.toLowerCase().includes(needle)) return "source";
  if (ruling.mentionedCards.some(name => name.toLowerCase().includes(needle))) return "cards";
  return null;
}

// A block inherits the preceding speaker when the source uses multiple paragraphs.
// This preserves the source verbatim while distinguishing responses and later corrections.
export function rulingTranscriptBlocks(ruling: RulingRecord): TranscriptBlock[] {
  let kind: TranscriptKind = "question";
  return ruling.transcript.split(/\n\s*\n/).filter(part => part.trim()).map(part => {
    const text = part.trim();
    if (/^Dev Response Update\b/i.test(text) ||
      (ruling.slug === "q1" && /^Dev Response:\s*Gary here - I checked with Justin/i.test(text))) {
      kind = "correction";
    } else if (/^Dev Response\b/i.test(text)) {
      kind = "response";
    } else if (/^\d+\s+Follow Up\b/i.test(text)) {
      kind = "followup";
    } else if (/^\d+[a-z]?[.)]/i.test(text)) {
      kind = "question";
    }
    return { text, kind };
  });
}
