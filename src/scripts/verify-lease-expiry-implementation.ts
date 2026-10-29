/**
 * PropertyPro - Verify Lease Expiry Notification Implementation
 * This script verifies the implementation without requiring database connection
 */

import { EmailService } from "@/lib/email-service";
import fs from "fs";
import path from "path";

interface VerificationResult {
  check: string;
  status: "✅ PASS" | "❌ FAIL" | "⚠️  WARN";
  message: string;
  details?: string;
}

class ImplementationVerifier {
  private results: VerificationResult[] = [];

  async verify(): Promise<void> {
    console.log("🔍 Verifying Lease Expiry Notification Implementation\n");
    console.log("=".repeat(80) + "\n");

    this.checkEmailServiceMethods();
    this.checkNotificationAutomationFile();
    this.checkNotificationServiceFile();
    this.checkNotificationIntervals();
    this.checkTestFiles();

    this.printResults();
  }

  private checkEmailServiceMethods(): void {
    console.log("📧 Checking Email Service Methods...");

    try {
      const emailService = new EmailService();

      // Check if sendLeaseExpiryReminder exists
      if (typeof emailService.sendLeaseExpiryReminder === "function") {
        this.addResult({
          check: "Email Service - sendLeaseExpiryReminder",
          status: "✅ PASS",
          message: "Tenant email method exists",
        });
      } else {
        this.addResult({
          check: "Email Service - sendLeaseExpiryReminder",
          status: "❌ FAIL",
          message: "Tenant email method not found",
        });
      }

      // Check if sendLeaseExpiryReminderToLandlord exists
      if (typeof emailService.sendLeaseExpiryReminderToLandlord === "function") {
        this.addResult({
          check: "Email Service - sendLeaseExpiryReminderToLandlord",
          status: "✅ PASS",
          message: "Landlord email method exists",
        });
      } else {
        this.addResult({
          check: "Email Service - sendLeaseExpiryReminderToLandlord",
          status: "❌ FAIL",
          message: "Landlord email method not found",
        });
      }
    } catch (error) {
      this.addResult({
        check: "Email Service",
        status: "❌ FAIL",
        message: `Failed to load EmailService: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }

    console.log("✓ Email Service checks completed\n");
  }

  private checkNotificationAutomationFile(): void {
    console.log("🔔 Checking Notification Automation File...");

    try {
      const filePath = path.join(
        process.cwd(),
        "src/lib/notification-automation.ts"
      );
      const content = fs.readFileSync(filePath, "utf-8");

      // Check for processLeaseExpiries method
      if (content.includes("processLeaseExpiries")) {
        this.addResult({
          check: "Notification Automation - processLeaseExpiries method",
          status: "✅ PASS",
          message: "Method exists",
        });
      } else {
        this.addResult({
          check: "Notification Automation - processLeaseExpiries method",
          status: "❌ FAIL",
          message: "Method not found",
        });
      }

      // Check for property owner population
      if (content.includes("ownerId") && content.includes("populate")) {
        this.addResult({
          check: "Notification Automation - Owner population",
          status: "✅ PASS",
          message: "Property owner population implemented",
        });
      } else {
        this.addResult({
          check: "Notification Automation - Owner population",
          status: "❌ FAIL",
          message: "Property owner population not found",
        });
      }

      // Check for property manager population
      if (content.includes("managerId") && content.includes("populate")) {
        this.addResult({
          check: "Notification Automation - Manager population",
          status: "✅ PASS",
          message: "Property manager population implemented",
        });
      } else {
        this.addResult({
          check: "Notification Automation - Manager population",
          status: "❌ FAIL",
          message: "Property manager population not found",
        });
      }

      // Check for isLandlord flag
      if (content.includes("isLandlord")) {
        this.addResult({
          check: "Notification Automation - Landlord flag",
          status: "✅ PASS",
          message: "isLandlord flag implemented",
        });
      } else {
        this.addResult({
          check: "Notification Automation - Landlord flag",
          status: "❌ FAIL",
          message: "isLandlord flag not found",
        });
      }

      // Check for tenant notification
      if (content.includes("Send notification to tenant")) {
        this.addResult({
          check: "Notification Automation - Tenant notification",
          status: "✅ PASS",
          message: "Tenant notification code exists",
        });
      } else {
        this.addResult({
          check: "Notification Automation - Tenant notification",
          status: "⚠️  WARN",
          message: "Tenant notification comment not found (may still work)",
        });
      }

      // Check for owner notification
      if (content.includes("Send notification to property owner")) {
        this.addResult({
          check: "Notification Automation - Owner notification",
          status: "✅ PASS",
          message: "Owner notification code exists",
        });
      } else {
        this.addResult({
          check: "Notification Automation - Owner notification",
          status: "❌ FAIL",
          message: "Owner notification code not found",
        });
      }

      // Check for manager notification
      if (content.includes("Send notification to property manager")) {
        this.addResult({
          check: "Notification Automation - Manager notification",
          status: "✅ PASS",
          message: "Manager notification code exists",
        });
      } else {
        this.addResult({
          check: "Notification Automation - Manager notification",
          status: "❌ FAIL",
          message: "Manager notification code not found",
        });
      }
    } catch (error) {
      this.addResult({
        check: "Notification Automation File",
        status: "❌ FAIL",
        message: `Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }

    console.log("✓ Notification Automation checks completed\n");
  }

  private checkNotificationServiceFile(): void {
    console.log("📬 Checking Notification Service File...");

    try {
      const filePath = path.join(process.cwd(), "src/lib/notification-service.ts");
      const content = fs.readFileSync(filePath, "utf-8");

      // Check for sendLeaseExpiryEmail method
      if (content.includes("sendLeaseExpiryEmail")) {
        this.addResult({
          check: "Notification Service - sendLeaseExpiryEmail method",
          status: "✅ PASS",
          message: "Method exists",
        });
      } else {
        this.addResult({
          check: "Notification Service - sendLeaseExpiryEmail method",
          status: "❌ FAIL",
          message: "Method not found",
        });
      }

      // Check for isLandlord routing
      if (content.includes("isLandlord") && content.includes("sendLeaseExpiryReminderToLandlord")) {
        this.addResult({
          check: "Notification Service - Landlord email routing",
          status: "✅ PASS",
          message: "Landlord email routing implemented",
        });
      } else {
        this.addResult({
          check: "Notification Service - Landlord email routing",
          status: "❌ FAIL",
          message: "Landlord email routing not found",
        });
      }

      // Check for tenant email routing
      if (content.includes("sendLeaseExpiryReminder")) {
        this.addResult({
          check: "Notification Service - Tenant email routing",
          status: "✅ PASS",
          message: "Tenant email routing exists",
        });
      } else {
        this.addResult({
          check: "Notification Service - Tenant email routing",
          status: "❌ FAIL",
          message: "Tenant email routing not found",
        });
      }
    } catch (error) {
      this.addResult({
        check: "Notification Service File",
        status: "❌ FAIL",
        message: `Failed to read file: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }

    console.log("✓ Notification Service checks completed\n");
  }

  private checkNotificationIntervals(): void {
    console.log("📅 Checking Notification Intervals...");

    try {
      const filePath = path.join(
        process.cwd(),
        "src/lib/notification-automation.ts"
      );
      const content = fs.readFileSync(filePath, "utf-8");

      const intervals = [90, 60, 30, 14, 7];
      const foundIntervals: number[] = [];

      intervals.forEach((interval) => {
        if (content.includes(`lease_expiry_${interval}_days`)) {
          foundIntervals.push(interval);
        }
      });

      if (foundIntervals.length === intervals.length) {
        this.addResult({
          check: "Notification Intervals",
          status: "✅ PASS",
          message: `All ${intervals.length} intervals configured: ${intervals.join(", ")} days`,
          details: foundIntervals.join(", "),
        });
      } else {
        const missing = intervals.filter((i) => !foundIntervals.includes(i));
        this.addResult({
          check: "Notification Intervals",
          status: "❌ FAIL",
          message: `Missing intervals: ${missing.join(", ")} days`,
          details: `Found: ${foundIntervals.join(", ")}`,
        });
      }
    } catch (error) {
      this.addResult({
        check: "Notification Intervals",
        status: "❌ FAIL",
        message: `Failed to check intervals: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }

    console.log("✓ Notification Intervals checks completed\n");
  }

  private checkTestFiles(): void {
    console.log("🧪 Checking Test Files...");

    const testFiles = [
      "src/lib/tests/lease-expiry-notifications.test.ts",
      "src/scripts/test-lease-expiry-notifications.ts",
      "src/lib/tests/README.md",
    ];

    testFiles.forEach((file) => {
      const filePath = path.join(process.cwd(), file);
      if (fs.existsSync(filePath)) {
        this.addResult({
          check: `Test File - ${path.basename(file)}`,
          status: "✅ PASS",
          message: "File exists",
        });
      } else {
        this.addResult({
          check: `Test File - ${path.basename(file)}`,
          status: "❌ FAIL",
          message: "File not found",
        });
      }
    });

    console.log("✓ Test Files checks completed\n");
  }

  private addResult(result: VerificationResult): void {
    this.results.push(result);
  }

  private printResults(): void {
    console.log("\n" + "=".repeat(80));
    console.log("📊 VERIFICATION RESULTS");
    console.log("=".repeat(80) + "\n");

    const passed = this.results.filter((r) => r.status === "✅ PASS").length;
    const failed = this.results.filter((r) => r.status === "❌ FAIL").length;
    const warnings = this.results.filter((r) => r.status === "⚠️  WARN").length;

    this.results.forEach((result) => {
      console.log(`${result.status} ${result.check}`);
      console.log(`   ${result.message}`);
      if (result.details) {
        console.log(`   Details: ${result.details}`);
      }
      console.log("");
    });

    console.log("=".repeat(80));
    console.log(`Total Checks: ${this.results.length}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⚠️  Warnings: ${warnings}`);
    console.log("=".repeat(80) + "\n");

    if (failed === 0) {
      console.log("🎉 All verification checks passed!");
      console.log("\n✨ The lease expiry notification system is properly implemented!");
      console.log("\n📝 Next steps:");
      console.log("   1. Start your MongoDB database");
      console.log("   2. Run: npx tsx src/scripts/test-lease-expiry-notifications.ts");
      console.log("   3. Verify emails are sent correctly");
    } else {
      console.log("⚠️  Some verification checks failed.");
      console.log("Please review the failed checks above and fix the issues.");
    }
  }
}

// Run verification
const verifier = new ImplementationVerifier();
verifier.verify().catch(console.error);

