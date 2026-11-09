import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "public/**"] },
  ...compat.extends("next/core-web-vitals"),
  {
    rules: {
      // These scoped workspaces intentionally reauthorize on a full navigation.
      // Converting every link to cached client navigation is a separate change.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
];

export default config;
