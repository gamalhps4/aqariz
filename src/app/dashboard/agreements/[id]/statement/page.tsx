"use client";

/**
 * PropertyPro - Management agreement statement
 *
 * One agreement's statement — see AgreementStatementView.
 */

import { Suspense, use } from "react";
import { AgreementStatementView } from "@/components/agreements/AgreementStatementView";

export default function AgreementStatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  // The statement's period lives in the address, and useSearchParams needs a
  // boundary of its own under the dashboard layout.
  return (
    <Suspense fallback={null}>
      <AgreementStatementView id={id} />
    </Suspense>
  );
}
