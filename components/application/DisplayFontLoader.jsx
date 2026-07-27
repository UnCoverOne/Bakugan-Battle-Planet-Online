"use client";

import { useEffect } from "react";

const DISPLAY_FONT_PARTS = [
  "/assets/home/rbno31-bold-italic/part-01.txt",
  "/assets/home/rbno31-bold-italic/part-02a.txt",
  "/assets/home/rbno31-bold-italic/part-02b.txt",
  "/assets/home/rbno31-bold-italic/part-02c.txt",
  "/assets/home/rbno31-bold-italic/part-02d.txt",
  "/assets/home/rbno31-bold-italic/part-02e.txt",
  "/assets/home/rbno31-bold-italic/part-02f.txt",
  "/assets/home/rbno31-bold-italic/part-02g.txt",
  "/assets/home/rbno31-bold-italic/part-03.txt",
  "/assets/home/rbno31-bold-italic/part-04.txt",
];

let displayFontPromise;

function loadTextParts(paths, label) {
  return Promise.all(paths.map(async (path) => {
    const response = await fetch(path, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Unable to load ${label} segment: ${path}`);
    return (await response.text()).trim();
  }));
}

function decodeBase64(value) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function loadDisplayFont() {
  if (typeof window === "undefined" || typeof FontFace === "undefined") return Promise.resolve();
  if (document.fonts?.check('italic 700 1em "RBNo31Display"')) return Promise.resolve();

  displayFontPromise ??= loadTextParts(DISPLAY_FONT_PARTS, "RBNo3.1 Bold Italic font")
    .then((parts) => new FontFace(
      "RBNo31Display",
      decodeBase64(parts.join("")),
      { style: "italic", weight: "700" },
    ).load())
    .then((font) => {
      document.fonts.add(font);
    })
    .catch((error) => {
      displayFontPromise = undefined;
      throw error;
    });

  return displayFontPromise;
}

export function DisplayFontLoader() {
  useEffect(() => {
    void loadDisplayFont().catch(() => undefined);
  }, []);

  return null;
}
