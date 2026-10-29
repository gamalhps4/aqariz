/**
 * PropertyPro SaaS - Every login the sign-in page advertises actually works
 *
 * Usage: pnpm verify:demo-logins       (exits non-zero on any failure)
 *
 * The sign-in screen prints four demo credentials and offers to fill the form
 * with them. Three were created by the demo seed; the fourth, the platform
 * super-admin, was bootstrapped once by hand — and `db:reset` truncates every
 * table, so the first reset after that left the page promising a login that
 * no longer existed. Nothing failed loudly: the account was simply absent,
 * and the screen said "Invalid email or password" as though the visitor had
 * mistyped the password it had just printed for them.
 *
 * The seed now creates it and both sides read the same list, but the list is
 * only half the guarantee. This is the other half: it asks the database
 * whether each advertised credential can actually sign in — the account
 * exists, is active, and the password verifies against the stored hash.
 *
 * Run it after seeding or resetting. It is the cheapest way to find out that
 * the first thing anyone sees is broken.
 */

import "../lib/env/load-dotenv";

import { authDb, basePrisma } from "@/lib/db/prisma";
import { bypassOrgScope } from "@/lib/tenancy/context";
import { verifyUserPassword } from "../lib/auth-credentials";
import { DEMO_LOGINS } from "@/lib/demo-credentials";

async function main() {
  console.log("\nAdvertised demo logins\n");
  let broken = 0;

  await bypassOrgScope(async () => {
    for (const login of DEMO_LOGINS) {
      // Bypassing org scope on purpose: the platform super-admin belongs to
      // no organization, and a scoped read would not find it.
      const user = await authDb.user.findFirst({
        where: { email: login.email },
        select: {
          id: true,
          role: true,
          isActive: true,
          organizationId: true,
          deletedAt: true,
        },
      });

      if (!user || user.deletedAt) {
        console.error(
          `  ✗ ${login.label.padEnd(12)} ${login.email} — no such account. Run pnpm db:seed.`,
        );
        broken += 1;
        continue;
      }

      // The real check. A user row proves nothing: Better Auth keeps the hash
      // on a separate account record, and a user created without one cannot
      // sign in at all.
      const passwordOk = await verifyUserPassword(user.id, login.password);
      const ok = passwordOk && user.isActive;

      console.log(
        `  ${ok ? "✓" : "✗"} ${login.label.padEnd(12)} ${login.email.padEnd(26)}` +
          ` role=${user.role}` +
          ` ${user.organizationId ? "in an organization" : "platform-wide"}` +
          ` active=${user.isActive}` +
          ` password=${passwordOk ? "ok" : "REJECTED"}`,
      );
      if (!ok) broken += 1;
    }
  });

  await basePrisma.$disconnect();

  console.log(
    broken === 0
      ? `\n✅ All ${DEMO_LOGINS.length} advertised logins work.\n`
      : `\n❌ ${broken} of ${DEMO_LOGINS.length} advertised logins are broken.\n`,
  );
  if (broken > 0) process.exit(1);
}

main().catch((error) => {
  console.error("verify-demo-logins crashed:", error);
  process.exit(1);
});
