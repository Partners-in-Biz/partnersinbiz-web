import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Existing any debt is controlled by scripts/check-quality-ratchet.mjs.
      "@typescript-eslint/no-explicit-any": "off",
      // The app has existing fetch-on-effect screens; this audit only gates regressions.
      "react-hooks/set-state-in-effect": "off",
      // React Compiler rules are too noisy for the current legacy surface.
      "react-hooks/static-components": "off",
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".vercel/**",
    "out/**",
    "build/**",
    "coverage/**",
    "__tests__/**",
    "**/dist/**",
    "functions/lib/**",
    "jest.setup.js",
    "scripts/**",
    "marketing/scripts/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
