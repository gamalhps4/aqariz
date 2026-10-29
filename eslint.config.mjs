// eslint-config-next v16 exports flat configs natively; routing them through
// FlatCompat (a legacy-format translator) crashes with a circular-structure
// error, which is why `next lint`/`eslint` was broken. Import them directly.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Disable strict TypeScript rules for Vercel deployment
      "@typescript-eslint/no-explicit-any": "warn",
      // `_user`, `_request`: the leading underscore is how this codebase says
      // "this parameter exists because the signature requires it". Without
      // the ignore patterns the convention reported itself as a problem 62
      // times, which trains people to skim past the rule.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-unsafe-function-type": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "prefer-const": "warn",
      "react/no-unescaped-entities": "warn",
      "jsx-a11y/alt-text": "warn",
      "@next/next/no-img-element": "warn",
      "react-hooks/exhaustive-deps": "warn",

      // The React Compiler rule set, demoted to warnings on purpose.
      //
      // eslint-config-next v16 turned these on as errors, and the codebase
      // predates them: 253 existing violations across ~150 files, almost all
      // of them `setState` inside an effect that the compiler would rather
      // see derived during render. Left as errors, `pnpm lint` is red on
      // every commit and stops meaning anything — the same reasoning the CI
      // workflow already records for `tsc --noEmit`.
      //
      // Demoted rather than switched off: they still print, so the count can
      // be driven down file by file, and the gate meanwhile catches
      // everything else. Promote each back to "error" as it reaches zero.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/incompatible-library": "warn",
    },
  },
  {
    // Framework boundary: the domain layer must stay portable to a standalone
    // backend (Fastify) and importable from scripts. Anything Next-specific
    // (headers(), NextResponse, revalidatePath) belongs in route handlers or
    // the api-utils adapter — never in services, models, or tenancy.
    files: [
      "src/lib/services/**/*.ts",
      "src/lib/tenancy/**/*.ts",
      "src/lib/billing/**/*.ts",
      "src/models/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*", "next-auth", "next-auth/*"],
              message:
                "The domain layer is framework-free. Keep Next.js imports in route handlers or src/lib/api-utils.ts.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
