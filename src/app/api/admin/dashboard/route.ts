/**
 * PropertyPro - Admin Dashboard API Route
 * Provides aggregated metrics and system insights for admin dashboard
 */

import {
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { getAdminDashboardData } from "@/lib/services/admin-dashboard.service";

export const GET = withPermissionAndDB("system_settings")(async () => {
  try {
    const data = await getAdminDashboardData();
    return createSuccessResponse(data);
  } catch (error) {
    return handleApiError(error, "Failed to load admin dashboard");
  }
});
