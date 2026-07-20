import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    // The tabletop presentation layer intentionally measures and annotates
    // DOM zones after layout. These React Compiler diagnostics do not model
    // that imperative animation boundary and otherwise reject valid effects.
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  globalIgnores([
    ".next/**",
    ".wrangler/**",
    "dist/**",
    "node_modules/**",
    "tsconfig.tsbuildinfo",
  ]),
]);
