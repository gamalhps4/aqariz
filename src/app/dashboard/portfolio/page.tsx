"use client";

/**
 * PropertyPro - Owner portal route
 *
 * A wrapper. The portal itself is a component so /dashboard can render it in
 * place for an owner, exactly as it renders TenantDashboard for a tenant.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { OwnerPortfolio } from "@/components/owner/OwnerPortfolio";
import { useAuthorization } from "@/hooks/useAuthorization";

export default function OwnerPortfolioPage() {
  const router = useRouter();
  const { isOwner, isLoading } = useAuthorization();

  // The portal reads the signed-in user as the owner. Anyone else who opens
  // the address would get an empty portal and an error, so staff are sent to
  // the owners list, where every owner's portfolio can be opened.
  useEffect(() => {
    if (!isLoading && !isOwner) router.replace("/dashboard/clients/owners");
  }, [isLoading, isOwner, router]);

  if (isLoading || !isOwner) return null;
  return <OwnerPortfolio />;
}
