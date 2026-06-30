// src/lib/gtfs-settings.ts
/**
 * @description Read and write persisted key-value settings rows.
 */
import { prisma } from "@/lib/db";

/**
 * Read a persisted setting by key.
 * @param key - Setting identifier.
 * @returns The stored value, or null when absent.
 */
export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { id: key } });
  return row?.value ?? null;
}

/**
 * Write a persisted setting, creating it when absent.
 * @param key - Setting identifier.
 * @param value - Value to store.
 */
export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { id: key },
    update: { value },
    create: { id: key, value },
  });
}
