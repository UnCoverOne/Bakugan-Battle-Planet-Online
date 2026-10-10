"use client";

// The browser loads the original font once through @font-face in globals.css.
// Keep this component as a compatibility entrypoint for existing layouts.
export function DisplayFontLoader() { return null; }
