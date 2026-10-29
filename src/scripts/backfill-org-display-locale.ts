/**
 * PropertyPro - Put an existing office on the Saudi display defaults
 *
 * Dry run (reads only):
 *   NODE_OPTIONS=--conditions=react-server node_modules/.bin/tsx \
 *     --env-file=.env.local --tsconfig tsconfig.json \
 *     src/scripts/backfill-org-display-locale.ts --org=<slug or id>
 * Write: the same command with `--apply`.
 *
 * A new organization opens in Arabic, right to left, in riyals and Riyadh
 * time (the market's defaults, src/lib/regional/region.ts). Organizations
 * created before those defaults kept the display row they were given then —
 * English, left to right, US dollars — so the client's own office still opens
 * in English for anyone who has not switched it by hand, and its emails,
 * notifications and SMS are written in English (they follow the office's
 * display language).
 *
 * This sets ONE organization's display row — the organization-wide row, which
 * is its branding owner's (the oldest active admin; see
 * utils/global-display-owner.ts) — to:
 *
 *   language "ar", rtl true, currency "SAR", timezone "Asia/Riyadh"
 *
 * Nothing else on the row changes (theme, branding, date format and the other
 * preferences stay as the office set them). Fields already on the target are
 * left alone, so running it again changes nothing. One row, so there is
 * nothing to batch; it is resumable by being idempotent.
 *
 * Money already recorded keeps its own currency (each payment and invoice
 * stores the code it was charged in); the setting only decides what new
 * figures default to and how totals are labelled.
 *
 * After applying: each user's browser draws the next page in its remembered
 * language until the office's settings load, then switches and remembers
 * Arabic (the `pp-locale` cookie) for every page after that.
 *
 * A platform audit entry ("organization.display_locale_backfilled") records
 * what was changed and from what.
 */

import { db } from "@/lib/db/prisma";
import { bypassOrgScope, runWithOrgContext } from "@/lib/tenancy/context";
import { resolveGlobalDisplayOwnerId } from "@/lib/utils/global-display-owner";
import { ACTIVE_REGION } from "@/lib/regional/region";

const APPLY = process.argv.includes("--apply");
const ORG = process.argv
  .find((value) => value.startsWith("--org="))
  ?.slice("--org=".length)
  .trim();

const TARGET = {
  language: ACTIVE_REGION.language,
  rtl: ACTIVE_REGION.rtl,
  currency: ACTIVE_REGION.currency,
  timezone: ACTIVE_REGION.timezone,
} as const;

type DisplayFields = {
  language: string;
  rtl: boolean;
  currency: string;
  timezone: string;
};

async function main(): Promise<void> {
  if (!ORG) {
    console.error(
      "Name the organization: --org=<slug or id>. Nothing was read or written.",
    );
    process.exit(1);
  }

  const organization = await bypassOrgScope(() =>
    db.organization.findFirst({
      where: { OR: [{ id: ORG }, { slug: ORG }] },
      select: { id: true, name: true, slug: true },
    }),
  );
  if (!organization) {
    console.error(`No organization with id or slug "${ORG}".`);
    process.exit(1);
  }

  const context = { organizationId: organization.id, isPlatformAdmin: false };
  const found = await runWithOrgContext(context, async () => {
    const ownerId = await resolveGlobalDisplayOwnerId();
    if (!ownerId) return { ownerId: null, row: null };
    // The owner is found through row-level security. A database role that
    // bypasses it (a superuser) would see every organization's users and
    // could pick another office's administrator — refuse rather than edit
    // the wrong row.
    const owner = await db.user.findFirst({
      where: { id: ownerId },
      select: { organizationId: true },
    });
    if (owner?.organizationId !== organization.id) {
      throw new Error(
        "The display owner resolved outside this organization. Run the script with the application's database role (row-level security on), not a superuser.",
      );
    }
    const row = await db.displaySettings.findFirst({
      where: { userId: ownerId },
      select: {
        id: true,
        language: true,
        rtl: true,
        currency: true,
        timezone: true,
        isActive: true,
      },
    });
    return { ownerId, row };
  });

  console.log(
    `Organization: ${organization.name} (${organization.slug}, ${organization.id})`,
  );
  if (!found.ownerId) {
    console.error(
      "It has no active administrator, so it has no organization-wide display row. Nothing to do.",
    );
    process.exit(1);
  }
  if (!found.row) {
    console.log(
      "It has no display row yet. The first read creates one with the market's defaults (Arabic, RTL, SAR, Riyadh), so there is nothing to change.",
    );
    return;
  }

  const before: DisplayFields = {
    language: found.row.language,
    rtl: found.row.rtl,
    currency: found.row.currency,
    timezone: found.row.timezone,
  };
  const changes: Partial<DisplayFields> = {};
  for (const field of Object.keys(TARGET) as Array<keyof DisplayFields>) {
    if (before[field] !== TARGET[field]) {
      (changes as Record<string, unknown>)[field] = TARGET[field];
    }
  }

  console.log("Display row (organization-wide):");
  for (const field of Object.keys(TARGET) as Array<keyof DisplayFields>) {
    const marker = field in changes ? "→" : "=";
    console.log(
      `  ${field.padEnd(9)} ${String(before[field]).padEnd(16)} ${marker} ${TARGET[field]}`,
    );
  }
  if (!found.row.isActive) {
    console.log("  (the row is marked inactive; it is updated all the same)");
  }

  if (Object.keys(changes).length === 0) {
    console.log("Already on the target. Nothing to change.");
    return;
  }

  if (!APPLY) {
    console.log(
      `Dry run: ${Object.keys(changes).length} field(s) would change. Run again with --apply to write.`,
    );
    return;
  }

  await runWithOrgContext(context, () =>
    db.displaySettings.update({
      where: { userId: found.ownerId! },
      data: { ...changes, version: { increment: 1 } },
    }),
  );

  // The typed audit helper lists its actions; a one-off script writes its
  // entry directly, against the same "system" sentinel automated jobs use.
  try {
    await bypassOrgScope(() =>
      db.platformAuditLog.create({
        data: {
          actorId: "system",
          actorEmail: "system@propertypro",
          action: "organization.display_locale_backfilled",
          targetType: "organization",
          targetId: organization.id,
          targetName: organization.name,
          organizationId: organization.id,
          summary: `Display set to ${TARGET.language}, ${TARGET.rtl ? "right to left" : "left to right"}, ${TARGET.currency}, ${TARGET.timezone}`,
          metadata: {
            displayOwnerId: found.ownerId,
            before,
            after: { ...before, ...changes },
          },
        },
      }),
    );
  } catch (error) {
    console.error("The row was updated, but the audit entry failed:", error);
  }

  console.log(`Applied: ${Object.keys(changes).join(", ")}.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
