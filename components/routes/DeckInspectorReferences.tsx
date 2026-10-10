"use client";

import { RULE_ENTRIES } from "../../lib/data";
import { GLOSSARY_ENTRIES, REFERENCE_REVIEWED_AT } from "../../lib/reference";

export const referenceSlug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export const BUILDER_RULE_REFERENCES = [
  ...RULE_ENTRIES.map((entry) => ({
    ...entry,
    slug: referenceSlug(entry.title),
    source: "Digital adaptation reference",
    sourceSection: entry.category,
    reviewedAt: REFERENCE_REVIEWED_AT,
  })),
  ...GLOSSARY_ENTRIES,
];
