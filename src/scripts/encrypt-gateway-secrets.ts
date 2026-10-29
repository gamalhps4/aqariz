/**
 * PropertyPro SaaS - Backfill: encrypt stored payment gateway secrets
 *
 * Gateway credentials used to be written to `system_settings.paymentGateways`
 * in the clear. They are live money-moving credentials for each organization's
 * own Stripe and PayPal accounts, so a database dump handed all of them over.
 * Writes are encrypted now (src/app/api/settings/payment/route.ts); this walks
 * the rows written before that and brings them up to the same standard.
 *
 * Safe to run repeatedly. `encryptSensitiveValue` returns an existing
 * `enc:v1:` envelope untouched, so an already-migrated row is left alone and
 * nothing is ever double-encrypted.
 *
 *   pnpm encrypt:gateway-secrets -- --dry-run
 *   pnpm encrypt:gateway-secrets
 */

import "../lib/env/load-dotenv";
import { authDb } from "../lib/db/prisma";
import { bypassOrgScope } from "../lib/tenancy/context";
import { PAYMENT_GATEWAYS } from "../lib/payments/gateway-registry";
import {
  encryptSensitiveValue,
  isEncryptedSensitiveValue,
} from "../lib/security/field-encryption";

const DRY_RUN = process.argv.includes("--dry-run");

/** Registry field keys that hold a secret, per gateway id. */
const SECRET_KEYS = new Map<string, string[]>(
  PAYMENT_GATEWAYS.map((gateway) => [
    gateway.id,
    gateway.fields.filter((f) => f.type === "secret").map((f) => f.key),
  ]),
);

async function main() {
  if (!process.env.DATA_ENCRYPTION_KEY?.trim()) {
    console.error(
      "DATA_ENCRYPTION_KEY is not set. Generate one with:\n" +
        "  node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
    process.exit(1);
  }

  // system_settings is org-scoped; a backfill legitimately spans every tenant.
  const rows = await bypassOrgScope(() =>
    authDb.systemSettings.findMany({
      select: { id: true, organizationId: true, paymentGateways: true },
    }),
  );

  let organizationsChanged = 0;
  let secretsEncrypted = 0;
  let alreadyEncrypted = 0;

  for (const row of rows) {
    const gateways = (row.paymentGateways ?? {}) as Record<string, any>;
    const next: Record<string, any> = { ...gateways };
    let rowChanged = false;

    for (const [gatewayId, secretKeys] of SECRET_KEYS) {
      const gateway = gateways[gatewayId];
      if (!gateway || typeof gateway !== "object") continue;

      const updatedGateway = { ...gateway };
      for (const key of secretKeys) {
        const value = updatedGateway[key];
        if (typeof value !== "string" || value.length === 0) continue;
        if (isEncryptedSensitiveValue(value)) {
          alreadyEncrypted++;
          continue;
        }
        updatedGateway[key] = encryptSensitiveValue(value);
        secretsEncrypted++;
        rowChanged = true;
        console.log(
          `  ${row.organizationId}  ${gatewayId}.${key}  ->  encrypted`,
        );
      }
      if (rowChanged) next[gatewayId] = updatedGateway;
    }

    if (!rowChanged) continue;
    organizationsChanged++;
    if (DRY_RUN) continue;

    await bypassOrgScope(() =>
      authDb.systemSettings.update({
        where: { id: row.id },
        data: { paymentGateways: next },
      }),
    );
  }

  console.log(
    `\n${DRY_RUN ? "[dry run] would encrypt" : "Encrypted"} ` +
      `${secretsEncrypted} secret(s) across ${organizationsChanged} organization(s). ` +
      `${alreadyEncrypted} already encrypted. ${rows.length} settings row(s) scanned.`,
  );

  if (!DRY_RUN && secretsEncrypted > 0) {
    console.log(
      "\nRotating DATA_ENCRYPTION_KEY from here on requires re-running this " +
        "script with the old key readable — plan a rotation before you need one.",
    );
  }
}

main()
  .catch((error) => {
    console.error("Gateway secret backfill failed:", error);
    process.exit(1);
  })
  .finally(() => authDb.$disconnect());
