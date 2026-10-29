/**
 * PropertyPro - Demo Accounts Seed Script (PostgreSQL)
 * Creates demo accounts for testing and demonstration purposes
 *
 * Usage: pnpm seed:demo
 */

import "../lib/env/load-dotenv";

import { authDb, basePrisma, db } from "../lib/db/prisma";
import { provisionOrganization } from "../lib/tenancy/provision-organization";
import { setUserPassword } from "../lib/auth-credentials";
import { runWithOrgContext } from "../lib/tenancy/context";

const DEMO_ACCOUNTS = [
  {
    email: "admin@propertypro.com",
    password: "Admin123$",
    firstName: "Super",
    lastName: "Admin",
    role: "admin",
    phone: "+1234567890",
  },
  {
    email: "manager@propertypro.com",
    password: "Manager123$",
    firstName: "Property",
    lastName: "Manager",
    role: "manager",
    phone: "+1234567891",
  },
  {
    email: "tenant@propertypro.com",
    password: "Tenant123$",
    firstName: "Demo",
    lastName: "Tenant",
    role: "tenant",
    phone: "+1234567892",
    dateOfBirth: new Date("1990-01-01"),
    tenantStatus: "active",
    backgroundCheckStatus: "approved",
    creditScore: 720,
    employmentInfo: {
      employer: "Tech Corp",
      position: "Software Engineer",
      income: 75000,
      startDate: "2020-01-01",
    },
    emergencyContacts: [
      {
        name: "Emergency Contact",
        relationship: "Family",
        phone: "+1234567893",
        email: "emergency@example.com",
      },
    ],
  },
] as const;

async function seedDemoAccounts() {
  let exitCode = 0;
  try {
    const demoEmails = DEMO_ACCOUNTS.map((account) => account.email);
    const existing = await authDb.user.findFirst({
      where: { email: { in: [...demoEmails] } },
      select: { email: true },
    });
    if (existing) {
      throw new Error(
        `Demo account ${existing.email} already exists. Use the guarded reset script first.`,
      );
    }

    const [admin, ...members] = DEMO_ACCOUNTS;
    const provisioned = await provisionOrganization({
      organizationName: "PropertyPro Demo Management",
      slug: "propertypro-demo",
      status: "active",
      owner: {
        firstName: admin.firstName,
        lastName: admin.lastName,
        email: admin.email,
        password: admin.password,
        phone: admin.phone,
      },
    });

    await runWithOrgContext(
      { organizationId: provisioned.organizationId, isPlatformAdmin: false },
      async () => {
        for (const accountData of members) {
          const { password, employmentInfo, emergencyContacts, ...userData } =
            accountData as (typeof DEMO_ACCOUNTS)[number] & {
              employmentInfo?: unknown;
              emergencyContacts?: unknown;
            };

          const account = await db.user.create({
            data: {
              ...userData,
              name: `${userData.firstName} ${userData.lastName}`,
              organizationId: provisioned.organizationId,
              isActive: true,
              emailVerified: new Date(),
              emailVerifiedFlag: true,
              ...(employmentInfo ? { employmentInfo: employmentInfo as object } : {}),
              ...(emergencyContacts
                ? { emergencyContacts: emergencyContacts as object[] }
                : {}),
            },
          });
          // Better Auth keeps the hash on its account record.
          await setUserPassword(account.id, password, {
            revokeSessions: false,
          });
        }
      },
    );

    console.log("✅ Demo accounts seeded (org: propertypro-demo).");
  } catch (error: any) {
    console.error("❌ Error seeding demo accounts:", error.message);
    console.error(error);
    exitCode = 1;
  } finally {
    await basePrisma.$disconnect().catch(() => {});
    process.exit(exitCode);
  }
}

seedDemoAccounts();
