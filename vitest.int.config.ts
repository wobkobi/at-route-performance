// Integration tests: `src/**/*.int.test.ts` run against the database in
// DATABASE_URL (`npm run test:int` loads .env.local). They prove that MongoDB
// agrees with the pure helpers the unit tests cover, using collectionless
// `$documents` pipelines or scratch collections prefixed `_audit_`, and never
// touch the app's own collections.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.int.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
