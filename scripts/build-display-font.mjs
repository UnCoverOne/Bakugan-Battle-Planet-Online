import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = resolve(projectRoot, "public/assets/home/rbno31-bold-italic");
const outputPath = resolve(projectRoot, "public/assets/fonts/rbno31-bold-italic.woff2");
const parts = [
  "part-01.txt",
  "part-02a.txt",
  "part-02b.txt",
  "part-02c.txt",
  "part-02d.txt",
  "part-02e.txt",
  "part-02f.txt",
  "part-02g.txt",
  "part-03.txt",
  "part-04.txt",
];

const encoded = (
  await Promise.all(parts.map((part) => readFile(resolve(sourceDir, part), "utf8")))
)
  .map((part) => part.trim())
  .join("")
  .replace(/\s+/g, "");

const font = Buffer.from(encoded, "base64");
if (font.length < 4 || font.subarray(0, 4).toString("ascii") !== "wOF2") {
  throw new Error("RBNo3.1 display font fragments did not produce a valid WOFF2 file.");
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, font);
