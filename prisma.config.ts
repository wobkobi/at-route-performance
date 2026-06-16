// prisma.config.ts
import { config } from "dotenv";
import type { PrismaConfig } from "prisma";

// Load env for Prisma CLI commands. Mirror Next.js precedence: .env.local wins,
// then .env fills any gaps (dotenv keeps the first value set, so load .local first).
config({ path: ".env.local" });
config({ path: ".env" });

export default {
  schema: "prisma/schema.prisma",
} satisfies PrismaConfig;
