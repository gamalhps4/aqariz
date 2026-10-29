"use client";

import React from "react";
import { useSession } from "@/lib/auth-client";
import { redirect } from "next/navigation";
import LeaseManagement from "@/components/tenant/LeaseManagement";
import { useAuthorization } from "@/hooks/useAuthorization";

export default function LeaseManagementPage() {
  const { status } = useSession();
  const { isTenant } = useAuthorization();

  // Show loading state while session is being fetched
  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Redirect if not authenticated
  if (status === "unauthenticated") {
    redirect("/auth/signin");
  }

  // Only allow tenants to access this page
  if (status === "authenticated" && !isTenant) {
    redirect("/dashboard");
  }

  return (
    <div className="container mx-auto py-6">
      <LeaseManagement />
    </div>
  );
}
