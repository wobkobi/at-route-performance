// Integration tests: `src/**/*.int.test.ts` run against the database in
// DATABASE_URL (`npm run test:int` loads .env.local). They prove that MongoDB
// agrees with the pure helpers the unit tests cover, using collectionless
// `$documents` pipelines or scratch collections prefixed `_audit_`, and never
// write to the app's own collections. A read-only assertion against one is
// allowed where the drift it watches for only exists in real data, as in
// retention.int.test.ts.
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
