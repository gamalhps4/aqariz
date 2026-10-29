/**
 * PropertyPro SaaS - Organization provisioning
 *
 * Creates a brand-new SaaS account: an Organization, its owner Admin user, and
 * the per-organization system roles. Used by the public org signup flow and by
 * the data-migration script (to wrap pre-existing single-tenant data).
 *
 * The organization, the owner binding, and the role seeding run in ONE
 * database transaction (with RLS bypassed — provisioning runs before any org
 * context exists), so a failure rolls everything back atomically. The only
 * compensating cleanup left is for what lives outside that transaction: a
 * freshly-created owner user row and its Better Auth credential.
 */

import { db, runWithOrgTransaction } from "@/lib/db/prisma";
import { UserRole } from "@/types";
import { bypassOrgScope } from "./context";
import {
  deleteUserCredentials,
  setUserPassword,
} from "@/lib/auth-credentials";
import {
  SYSTEM_ROLE_PERMISSIONS,
  type SystemPermission,
} from "@/lib/permission-catalog";

const SYSTEM_ROLE_META: Record<
  UserRole.ADMIN | UserRole.MANAGER | UserRole.OWNER | UserRole.TENANT,
  { label: string; description: string; color: string }
> = {
  [UserRole.ADMIN]: {
    label: "Administrator",
    description: "Full access to all features within the organization",
    color: "destructive",
  },
  [UserRole.MANAGER]: {
    label: "Property Manager",
    description: "Manage properties, tenants, leases and day-to-day operations",
    color: "default",
  },
  [UserRole.OWNER]: {
    label: "Property Owner",
    description:
      "Read-only access to their own buildings, statements and commissions",
    color: "outline",
  },
  [UserRole.TENANT]: {
    label: "Tenant",
    description: "Limited access to their own leases, payments and requests",
    color: "secondary",
  },
};

export interface ProvisionOrganizationInput {
  organizationName: string;
  owner: {
    firstName: string;
    lastName: string;
    email: string;
    password?: string; // omitted when wrapping a pre-existing owner
    existingUserId?: string; // migration: promote an existing admin to owner
    phone?: string;
  };
  /** Override the auto-generated slug. */
  slug?: string;
  status?: "active" | "trial";
  /** Trial length in days (platform default). 0 disables the trial window. */
  trialDays?: number;
  /** Platform-wide defaults for a brand-new workspace. Applied to the owner's
   * display settings so a new organization opens in the currency, timezone
   * and language the operator configured, rather than always USD/New York/en. */
  defaults?: {
    currency?: string;
    timezone?: string;
    language?: string;
  };
}

export interface ProvisionResult {
  organizationId: string;
  ownerId: string;
  slug: string;
}

/** Turn an arbitrary name into a URL-safe slug fragment. */
export function slugifyName(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "org"
  );
}

/** Find a slug not already used by another organization (soft-deleted
 * organizations keep their slug — the unique index covers them too). */
async function uniqueSlug(base: string): Promise<string> {
  let candidate = slugifyName(base);
  for (let i = 0; i < 50; i++) {
    const exists = await db.organization.findFirst({
      where: { slug: candidate, deletedAt: undefined },
      select: { id: true },
    });
    if (!exists) return candidate;
    candidate = `${slugifyName(base)}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return `${slugifyName(base)}-${Date.now().toString(36)}`;
}

/**
 * Provision a new organization with an owner Admin and default system roles.
 * The org + owner binding + role seeding are atomic; a freshly-created owner
 * (and its credential row, written outside the transaction) is cleaned up on
 * failure so the email address is not held hostage for a retry.
 */
export async function provisionOrganization(
  input: ProvisionOrganizationInput,
): Promise<ProvisionResult> {
  return bypassOrgScope(() => provisionOrganizationGlobally(input));
}

async function provisionOrganizationGlobally(
  input: ProvisionOrganizationInput,
): Promise<ProvisionResult> {
  const slug = await uniqueSlug(input.slug || input.organizationName);
  const trialDays = input.trialDays ?? 14;

  // 1) Resolve / create the owner user (no org yet). This happens outside the
  // provisioning transaction because the credential write (Better Auth
  // account row) goes through its own client and must see a committed user.
  let ownerId: string;
  let createdOwner = false;
  if (input.owner.existingUserId) {
    ownerId = input.owner.existingUserId;
    const existingOwner = await db.user.findFirst({
      where: { id: ownerId },
      select: { role: true, organizationId: true },
    });
    if (!existingOwner) throw new Error("Organization owner does not exist");
    if (existingOwner.organizationId) {
      throw new Error("Organization owner is already assigned");
    }
  } else {
    const owner = await db.user.create({
      data: {
        firstName: input.owner.firstName.trim(),
        lastName: input.owner.lastName.trim(),
        email: input.owner.email.toLowerCase().trim(),
        phone: input.owner.phone,
        role: UserRole.ADMIN,
        isActive: true,
        organizationId: null,
      },
    });
    ownerId = owner.id;
    createdOwner = true;
    if (input.owner.password) {
      try {
        // Better Auth keeps the hash on its account record; a brand-new user
        // has no sessions to revoke.
        await setUserPassword(ownerId, input.owner.password, {
          revokeSessions: false,
        });
      } catch (error) {
        await deleteUserCredentials(ownerId).catch(() => {});
        await db.user.deleteMany({ where: { id: ownerId } }).catch(() => {});
        throw error;
      }
    }
  }

  try {
    // 2-4) Organization, owner binding, and system roles — one transaction,
    // genuinely atomic (replaces the old best-effort rollback).
    return await runWithOrgTransaction(
      async (tx) => {
        const org = await tx.organization.create({
          data: {
            name: input.organizationName.trim(),
            slug,
            ownerId,
            status: input.status || "trial",
            plan: "free",
            trialEndsAt:
              (input.status || "trial") === "trial" && trialDays > 0
                ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000)
                : null,
            branding: { companyName: input.organizationName.trim() },
          },
        });

        // Bind the owner to the organization — guarded against a concurrent
        // signup assigning the same user to another organization.
        const ownerBinding = await tx.user.updateMany({
          where: { id: ownerId, organizationId: null },
          data: { organizationId: org.id, role: UserRole.ADMIN },
        });
        if (ownerBinding.count !== 1) {
          throw new Error("Organization owner was assigned concurrently");
        }

        // Seed the owner's display settings from the platform defaults. This
        // row is what the dashboard reads for currency, timezone and locale,
        // so without it the operator's configured defaults were inert.
        if (input.defaults) {
          const { currency, timezone, language } = input.defaults;
          if (currency || timezone || language) {
            await tx.displaySettings.create({
              data: {
                organizationId: org.id,
                userId: ownerId,
                ...(currency ? { currency } : {}),
                ...(timezone ? { timezone } : {}),
                ...(language ? { language } : {}),
                // Arabic is the only RTL locale shipped today.
                ...(language === "ar" ? { rtl: true } : {}),
                branding: { companyName: input.organizationName.trim() },
              },
            });
          }
        }

        // Seed the four per-organization system roles. OWNER is one of them:
        // property owners are clients of the office, not staff, but the role
        // still needs a row here or it never reaches the role-management
        // screen, the create-user form, or the assignment dialog — all three
        // read the Role table, not the UserRole enum.
        await tx.role.createMany({
          data: (
            [
              UserRole.ADMIN,
              UserRole.MANAGER,
              UserRole.OWNER,
              UserRole.TENANT,
            ] as const
          ).map((role) => {
            const meta = SYSTEM_ROLE_META[role];
            return {
              organizationId: org.id,
              name: role,
              label: meta.label,
              description: meta.description,
              permissions: [
                ...(SYSTEM_ROLE_PERMISSIONS[role] as readonly SystemPermission[]),
              ],
              isSystem: true,
              isActive: true,
              color: meta.color,
              createdById: ownerId,
            };
          }),
        });

        return { organizationId: org.id, ownerId, slug };
      },
      { bypass: true },
    );
  } catch (error) {
    if (createdOwner) {
      // The transaction rolled back; only the owner user (and its credential
      // row, which lives outside the transaction) can be left behind. Leaving
      // them would hold the email hostage for the applicant's retry.
      await deleteUserCredentials(ownerId).catch(() => {});
      await db.user.deleteMany({ where: { id: ownerId } }).catch(() => {});
    }
    throw error;
  }
}
