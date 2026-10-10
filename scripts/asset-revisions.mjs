import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
export function assetRevisions(root) {
  /** @type {Record<string, string>} */
  const revisions = {};
  const visit = (directory, relative) => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    const files = entries.filter(entry => entry.isFile());
    if (files.length) {
      const hash = createHash("sha256");
      for (const file of files) { hash.update(file.name); hash.update("\0"); hash.update(readFileSync(join(directory, file.name))); }
      revisions[`/assets/${relative}`.replace(/\/$/, "")] = hash.digest("hex").slice(0, 16);
    }
    for (const entry of entries) if (entry.isDirectory()) visit(join(directory, entry.name), posix.join(relative, entry.name));
  };
  visit(root, "");
  return revisions;
}
