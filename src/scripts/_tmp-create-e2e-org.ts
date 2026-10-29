import "../lib/env/load-dotenv";
import { authDb, basePrisma } from "../lib/db/prisma";
import { provisionOrganization } from "../lib/tenancy/provision-organization";
import { deleteUserCredentials } from "../lib/auth-credentials";

const EMAIL = "billing-e2e@example.com";
const PASSWORD = "TestBilling123!";

async function main() {
  // Clean any prior run.
  const prior = await authDb.user.findUnique({
    where: { email: EMAIL },
    select: { id: true, organizationId: true },
  });
  if (prior) {
    if (prior.organizationId) {
      await authDb.role.deleteMany({
        where: { organizationId: prior.organizationId },
      });
      await deleteUserCredentials(prior.id);
      await authDb.user.deleteMany({
        where: { organizationId: prior.organizationId },
      });
      await authDb.organization.deleteMany({
        where: { id: prior.organizationId },
      });
    } else {
      await deleteUserCredentials(prior.id);
      await authDb.user.delete({ where: { id: prior.id } });
    }
  }

  const result = await provisionOrganization({
    organizationName: "E2E Billing Test",
    owner: {
      firstName: "Billing",
      lastName: "Tester",
      email: EMAIL,
      password: PASSWORD,
    },
    status: "trial",
  });

  console.log("PROVISIONED:", JSON.stringify(result));
  console.log("LOGIN EMAIL:", EMAIL);
  console.log("LOGIN PASSWORD:", PASSWORD);
  await basePrisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
