/**
 * PropertyPro - Maintenance Staff Hook
 * Hook for fetching available maintenance staff for assignment
 */

"use client";

import { useState, useEffect } from "react";
import { useSession } from "@/lib/auth-client";
import { useAuthorization } from "./useAuthorization";

interface MaintenanceStaff {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  isActive: boolean;
}

interface UseMaintenanceStaffReturn {
  staff: MaintenanceStaff[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useMaintenanceStaff(): UseMaintenanceStaffReturn {
  const { data: session } = useSession();
  const { isCompanyStaff } = useAuthorization();
  const [staff, setStaff] = useState<MaintenanceStaff[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const canFetchStaff = isCompanyStaff;

  const fetchStaff = async () => {
    // Don't fetch if user doesn't have permission
    if (!canFetchStaff) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(
        "/api/users?excludeTenant=true&companyStaffOnly=true&isActive=true&limit=100"
      );

      if (!response.ok) {
        throw new Error("Failed to fetch maintenance staff");
      }

      const data = await response.json();
      const staffList = data.users || data.data?.users || [];

      const filteredStaff = staffList.filter(
        (user: MaintenanceStaff) => user.isActive
      );

      setStaff(filteredStaff);
    } catch (err) {
      console.error("Error fetching maintenance staff:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch staff");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (session && canFetchStaff) {
      fetchStaff();
    } else if (session && !canFetchStaff) {
      // For users without permission, set loading to false immediately
      setIsLoading(false);
    }
  }, [session, canFetchStaff]);

  return {
    staff,
    isLoading,
    error,
    refetch: fetchStaff,
  };
}
