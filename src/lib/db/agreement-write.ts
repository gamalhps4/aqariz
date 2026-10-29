import "server-only";

import { db } from "@/lib/db/prisma";
import {
  agreementWriteCheck,
  type AgreementReach,
  type ScopeActor,
} from "@/lib/db/scopes";

/**
 * PropertyPro - May this caller write this agreement?
 *
 * The rule is `agreementWriteCheck` in ./scopes.ts; this runs it. It sits
 * apart from that module because it has to ask the database, and everything
 * there is a fragment built without one.
 *
 * Office staff who are not narrowed pass without a query. Anyone else — an
 * employee assigned some buildings, an owner — needs the agreement to name at
 * least one building they hold and none they do not.
 */
export async function mayWriteAgreement(
  actor: ScopeActor,
  agreement: AgreementReach,
): Promise<boolean> {
  const check = agreementWriteCheck(actor, agreement);
  if (!check) return true;

  const [held, beyond] = await Promise.all([
    db.property.count({ where: check.held }),
    db.property.count({ where: check.beyond }),
  ]);
  return held > 0 && beyond === 0;
}

/** What a refused write is told. */
export const AGREEMENT_WRITE_DENIED =
  "This agreement covers buildings that are not assigned to you";
