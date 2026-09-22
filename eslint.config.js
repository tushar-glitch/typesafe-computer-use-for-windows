// @ts-check
/**
 * Lint rules, chosen to catch what the compiler cannot.
 *
 * The strict tsconfig already handles most correctness, so this focuses on the
 * classes of mistake types cannot see: promises nobody waits for, conditions
 * that are always true, and the architectural boundary that keeps the domain
 * free of platform and vendor code.
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "sidecar/**", "*.config.js", "*.config.ts"] },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // An unawaited promise in this codebase means an action that silently
      // does not happen, which is the hardest kind of bug to see here.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",

      // Off, having been tried at "method" and found wrong. Method shorthand
      // is checked bivariantly even under strictFunctionTypes, while a
      // property holding a function type gets proper contravariance. For the
      // callbacks and factories in the option bags here, that makes the rule
      // an argument for the LESS safe spelling, so neither is enforced.
      "@typescript-eslint/method-signature-style": "off",

      // The wire is untyped, so casts at adapter boundaries are deliberate and
      // commented. Flagging every one would train us to ignore the rule.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",

      // Numbers in template strings are idiomatic and safe; demanding an
      // explicit String() around every count is noise, not rigour.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],

      // A concise arrow that happens to return void reads better than a block.
      "@typescript-eslint/no-confusing-void-expression": "off",

      // Explicit type arguments often document intent even when inferable.
      "@typescript-eslint/no-unnecessary-type-arguments": "off",

      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  {
    // The domain must not learn about Windows, HTTP, or any vendor. Only the
    // composition root is allowed to know which concrete adapter exists, and
    // enforcing that here keeps the hexagon honest as the project grows.
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/adapters/**", "**/application/**", "**/composition/**"],
              message:
                "core is the domain: it defines ports and types, and must not depend on any adapter or application code.",
            },
            {
              group: ["node:*", "@deepgram/*", "@typesafe-ai/*"],
              message: "core must stay free of platform and vendor packages; put that behind a port.",
            },
          ],
        },
      ],
    },
  },

  {
    // Application logic composes ports. It may know the shape of a decision or
    // an observation, but not who provides one.
    files: ["src/application/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/adapters/**"],
              message: "application code depends on ports, not adapters; the composition root wires the two.",
            },
          ],
        },
      ],
    },
  },

  {
    files: ["tests/**/*.ts"],
    rules: {
      // Fakes implement async interfaces without awaiting anything, which is
      // the whole point of a fake.
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",

      // Spies are assigned to interface methods by design; the rule is aimed
      // at accidentally detaching a real method from its receiver.
      "@typescript-eslint/unbound-method": "off",

      // Assertions on optional lookups are how a test says it knows better.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
