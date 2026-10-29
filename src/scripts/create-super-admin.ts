/**
 * PropertyPro SaaS - Create a platform super-admin
 *
 * The platform owner operates above every organization (organizationId = null)
 * and cannot be created through public signup. Run this once to bootstrap it.
 *
 * Usage:
 *   pnpm tsx src/scripts/create-super-admin.ts \
 *     --email you@example.com --password 'Secret123' --first Plat --last Admin
 *
 * If a user with that email already exists they are promoted to super-admin.
 */

import "../lib/env/load-dotenv";

import { authDb, basePrisma } from "../lib/db/prisma";
import { setUserPassword } from "../lib/auth-credentials";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const email = arg("email")?.toLowerCase().trim();
  const password = arg("password");
  const firstName = arg("first", "Platform")!;
  const lastName = arg("last", "Admin")!;

  if (!email) {
    console.error("Missing --email");
    process.exit(1);
  }

  const existing = await authDb.user.findUnique({ where: { email } });
  if (existing) {
    await authDb.user.update({
      where: { id: existing.id },
      data: { role: "super_admin", organizationId: null, isActive: true },
    });
    if (password) {
      await setUserPassword(existing.id, password);
    }
    console.log(`Promoted existing user ${email} to platform super-admin.`);
  } else {
    if (!password) {
      throw new Error("New super-admin requires --password");
    }
    const created = await authDb.user.create({
      data: {
        email,
        firstName,
        lastName,
        name: `${firstName} ${lastName}`,
        role: "super_admin",
        organizationId: null,
        isActive: true,
        emailVerified: new Date(),
        emailVerifiedFlag: true,
      },
    });
    await setUserPassword(created.id, password, { revokeSessions: false });
    console.log(`Created platform super-admin ${email}.`);
  }

  await basePrisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Failed:", err);
  process.exit(1);
});
