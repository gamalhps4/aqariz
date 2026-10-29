/**
 * PropertyPro - System Configuration API
 * API endpoint for system configuration management and optimization
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { UserRole } from "@/types";
import { systemConfigurationService } from "@/lib/services/system-configuration.service";
import {
  AuthenticatedAccessUser,
  createSuccessResponse as createApiSuccessResponse,
  createErrorResponse as createApiErrorResponse,
  withAccessAndDB,
  withRoleAndDB,
} from "@/lib/api-utils";

// Helper functions
function createSuccessResponse(data: any, message: string) {
  return createApiSuccessResponse(data, message);
}

function createErrorResponse(message: string, status: number = 400) {
  return createApiErrorResponse(message, status, message);
}

// Reading the system configuration is the System settings right, as
// changing it is the Administrator's. It asked only for a staff tier, which
// every permission group is on.
export const GET = withAccessAndDB({
  roles: [UserRole.ADMIN, UserRole.MANAGER],
  permissions: ["system_settings"],
})(
  async (_user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      // Parse query parameters
      const { searchParams } = new URL(request.url);
      const action = searchParams.get("action") || "current";
      const limit = parseInt(searchParams.get("limit") || "12");

      if (action === "current") {
        // Get current configuration
        const config = systemConfigurationService.getCurrentConfiguration();

        return createSuccessResponse(
          {
            configuration: config,
            timestamp: new Date().toISOString(),
          },
          "Current configuration retrieved successfully"
        );
      }

      if (action === "analyze") {
        // Analyze configuration and generate recommendations
        const analysis = await systemConfigurationService.analyzeConfiguration();

        return createSuccessResponse(
          analysis,
          "Configuration analysis completed successfully"
        );
      }

      if (action === "history") {
        // Get configuration history
        const history = systemConfigurationService.getConfigurationHistory(limit);

        return createSuccessResponse(
          {
            history,
            total: history.length,
          },
          "Configuration history retrieved successfully"
        );
      }

      if (action === "export") {
        // Export configuration for backup
        const exportData = systemConfigurationService.exportConfiguration();

        return createSuccessResponse(
          exportData,
          "Configuration exported successfully"
        );
      }

      return createErrorResponse("Invalid action specified", 400);
    } catch (error) {
      console.error("Error in configuration GET API:", error);
      return createErrorResponse(
        error instanceof Error ? error.message : "Internal server error",
        500
      );
    }
  }
);

export const POST = withRoleAndDB(UserRole.ADMIN)(
  async (_user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      // Parse request body
      const body = await request.json();
      const {
        action,
        configuration,
        reason,
        recommendations,
        selectedIds,
        configData,
        steps,
      } = body;

      if (action === "update") {
        // Update configuration
        if (!configuration) {
          return createErrorResponse("Configuration data is required", 400);
        }

        const updatedConfig = await systemConfigurationService.updateConfiguration(
          configuration,
          reason || "Manual configuration update"
        );

        return createSuccessResponse(
          {
            configuration: updatedConfig,
            updatedAt: new Date().toISOString(),
          },
          "Configuration updated successfully"
        );
      }

      if (action === "apply-recommendations") {
        // Apply optimization recommendations
        if (!recommendations || !Array.isArray(recommendations)) {
          return createErrorResponse("Recommendations array is required", 400);
        }

        const updatedConfig = await systemConfigurationService.applyRecommendations(
          recommendations,
          selectedIds
        );

        return createSuccessResponse(
          {
            configuration: updatedConfig,
            appliedRecommendations:
              selectedIds || recommendations.map((_, i) => i.toString()),
            updatedAt: new Date().toISOString(),
          },
          "Optimization recommendations applied successfully"
        );
      }

      if (action === "rollback") {
        // Rollback configuration
        const rollbackSteps = steps || 1;

        if (rollbackSteps < 1 || rollbackSteps > 10) {
          return createErrorResponse(
            "Rollback steps must be between 1 and 10",
            400
          );
        }

        const rolledBackConfig =
          await systemConfigurationService.rollbackConfiguration(rollbackSteps);

        return createSuccessResponse(
          {
            configuration: rolledBackConfig,
            rolledBackSteps: rollbackSteps,
            timestamp: new Date().toISOString(),
          },
          `Configuration rolled back ${rollbackSteps} step(s) successfully`
        );
      }

      if (action === "import") {
        // Import configuration from backup
        if (!configData) {
          return createErrorResponse(
            "Configuration data is required for import",
            400
          );
        }

        const importedConfig = await systemConfigurationService.importConfiguration(
          configData,
          reason || "Configuration import"
        );

        return createSuccessResponse(
          {
            configuration: importedConfig,
            importedAt: new Date().toISOString(),
          },
          "Configuration imported successfully"
        );
      }

      if (action === "validate") {
        // Validate configuration without applying
        if (!configuration) {
          return createErrorResponse(
            "Configuration data is required for validation",
            400
          );
        }

        try {
          // Create a temporary service instance to test validation
          const tempService = new (systemConfigurationService.constructor as any)();
          await tempService.updateConfiguration(configuration, "Validation test");

          return createSuccessResponse(
            {
              valid: true,
              configuration,
            },
            "Configuration is valid"
          );
        } catch (error) {
          return createSuccessResponse(
            {
              valid: false,
              errors: [
                error instanceof Error ? error.message : "Validation failed",
              ],
              configuration,
            },
            "Configuration validation completed"
          );
        }
      }

      if (action === "reset-to-defaults") {
        // Reset configuration to defaults
        const defaultConfig = new (
          systemConfigurationService.constructor as any
        )().getCurrentConfiguration();

        const resetConfig = await systemConfigurationService.updateConfiguration(
          defaultConfig,
          reason || "Reset to default configuration"
        );

        return createSuccessResponse(
          {
            configuration: resetConfig,
            resetAt: new Date().toISOString(),
          },
          "Configuration reset to defaults successfully"
        );
      }

      return createErrorResponse("Invalid action specified", 400);
    } catch (error) {
      console.error("Error in configuration POST API:", error);
      return createErrorResponse(
        error instanceof Error ? error.message : "Internal server error",
        500
      );
    }
  }
);
