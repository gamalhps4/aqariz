/**
 * PropertyPro SaaS - Platform-wide module switches
 *
 * The Super Admin can switch a module off for every package at once (on top of
 * choosing per package what each includes). Stored as
 * `platform_settings.modules = { "disabled": ["<module key>", ...] }`.
 *
 * Read and written with raw SQL on purpose. The column arrives with migration
 * 20261003150000_platform_module_switches, and the Prisma field is marked
 * `@ignore` until that migration has been applied everywhere: had the client
 * known the field, every ordinary read of the settings row would have
 * selected a column the database does not have yet and failed — taking the
 * maintenance banner, the mailer and signup settings down with it. Here a
 * missing column reads as "nothing switched off".
 */

import { db } from "@/lib/db/prisma";
import { bypassOrgScope } from "@/lib/tenancy/context";
import { ensurePlatformSettingsSeeded } from "@/lib/platform/settings";
import { isAlwaysOnModule, isModuleKey } from "./modules";

export interface PlatformModuleSwitches {
  /** Module keys switched off for every package (with what is under them). */
  disabled: string[];
  /** False while the migration that adds the column has not been applied. */
  available: boolean;
}

const CACHE_TTL_MS = 60_000;
let cache: { value: PlatformModuleSwitches; at: number } | null = null;

export function invalidatePlatformModuleCache(): void {
  cache = null;
}

/** Only keys the tree knows, and never an always-on module. */
export function cleanDisabledModules(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? (raw as { disabled?: unknown }).disabled
      : null;
  if (!Array.isArray(list)) return [];
  return Array.from(
    new Set(
      list.filter(
        (key): key is string =>
          typeof key === "string" && isModuleKey(key) && !isAlwaysOnModule(key),
      ),
    ),
  );
}

/** Postgres undefined_column (42703), however the driver wraps it. */
function isMissingColumn(error: unknown): boolean {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      parts.push(String(record.message ?? ""), String(record.code ?? ""));
      const meta = record.meta as Record<string, unknown> | undefined;
      if (meta) parts.push(JSON.stringify(meta));
      current = record.cause;
    } else {
      parts.push(String(current));
      current = null;
    }
  }
  const text = parts.join(" ");
  return /42703/.test(text) || /column\s+"?modules"?\s+does not exist/i.test(text);
}

/** What the platform has switched off. Every module is on until told otherwise. */
export async function getPlatformModuleSwitches(): Promise<PlatformModuleSwitches> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  try {
    const rows = await bypassOrgScope(() =>
      db.$queryRaw<Array<{ modules: unknown }>>`
        SELECT "modules" FROM "platform_settings"
        WHERE "singleton" = 'primary'
        LIMIT 1
      `,
    );
    const value: PlatformModuleSwitches = {
      disabled: cleanDisabledModules(rows[0]?.modules ?? null),
      available: true,
    };
    cache = { value, at: Date.now() };
    return value;
  } catch (error) {
    if (isMissingColumn(error)) {
      const value: PlatformModuleSwitches = { disabled: [], available: false };
      cache = { value, at: Date.now() };
      return value;
    }
    // A failed read must not switch modules off across the platform.
    console.error("Failed to read platform module switches; all on", error);
    return cache?.value ?? { disabled: [], available: true };
  }
}

export class PlatformModulesUnavailableError extends Error {
  statusCode = 409;
  code = "MIGRATION_REQUIRED";
  constructor() {
    super(
      "Platform module switches need migration 20261003150000_platform_module_switches to be applied first.",
    );
    this.name = "PlatformModulesUnavailableError";
  }
}

/** Replace the platform's switched-off list. */
export async function setPlatformModuleSwitches(
  disabled: unknown,
): Promise<PlatformModuleSwitches> {
  const clean = cleanDisabledModules(disabled);
  const payload = JSON.stringify({ disabled: clean });
  await ensurePlatformSettingsSeeded();
  try {
    await bypassOrgScope(() =>
      db.$executeRaw`
        UPDATE "platform_settings"
        SET "modules" = ${payload}::jsonb, "updatedAt" = NOW()
        WHERE "singleton" = 'primary'
      `,
    );
  } catch (error) {
    if (isMissingColumn(error)) throw new PlatformModulesUnavailableError();
    throw error;
  }
  const value: PlatformModuleSwitches = { disabled: clean, available: true };
  cache = { value, at: Date.now() };
  return value;
}
