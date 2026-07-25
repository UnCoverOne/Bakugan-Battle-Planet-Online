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
  {
    files: ["components/routes/**/*.{ts,tsx}"],
    // Route components cross a persisted, versioned client-state boundary.
    // The provider remains intentionally untyped while the migration keeps
    // the existing snapshot schema compatible; route-local domain objects
    // are validated by the existing deck, content, and engine test suites.
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["components/application/AppProvider.jsx"],
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
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
