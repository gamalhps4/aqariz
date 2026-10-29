/**
 * PropertyPro - Digital Signature Service
 * Handle digital signatures for documents
 *
 * Document.digitalSignatures and Document.accessLogs are Json columns:
 * signature append/verify are immutable Json updates on db.document.
 */

import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import crypto from "crypto";

// One entry inside the Document.digitalSignatures Json column
export interface IDigitalSignature {
  signerId: string;
  signerName: string;
  signerEmail: string;
  signedAt: string | Date;
  signatureData: string;
  ipAddress?: string;
  userAgent?: string;
  verified: boolean;
}

// One entry inside the Document.accessLogs Json column
interface IAccessLogEntry {
  userId: string;
  action: string;
  timestamp: string | Date;
  ipAddress?: string;
  userAgent?: string;
  details?: string;
}

// Signature request interface
export interface ISignatureRequest {
  documentId: string;
  signerId: string;
  signerName: string;
  signerEmail: string;
  signatureData: string; // Base64 encoded signature image/data
  ipAddress?: string;
  userAgent?: string;
  certificateData?: string;
}

// Signature verification result
export interface ISignatureVerification {
  isValid: boolean;
  signatureId?: string;
  timestamp?: Date;
  errors?: string[];
  warnings?: string[];
}

// Signature certificate interface
export interface ISignatureCertificate {
  id: string;
  userId: string;
  publicKey: string;
  privateKey: string; // Encrypted
  algorithm: string;
  createdAt: Date;
  expiresAt: Date;
  status: "active" | "revoked" | "expired";
}

function readSignatures(document: {
  digitalSignatures: unknown;
}): IDigitalSignature[] {
  return Array.isArray(document.digitalSignatures)
    ? (document.digitalSignatures as IDigitalSignature[])
    : [];
}

function readAccessLogs(document: { accessLogs: unknown }): IAccessLogEntry[] {
  return Array.isArray(document.accessLogs)
    ? (document.accessLogs as IAccessLogEntry[])
    : [];
}

export class DigitalSignatureService {
  // Add digital signature to document
  async addSignature(
    request: ISignatureRequest
  ): Promise<ISignatureVerification> {
    try {
      // Fetch document
      const document = await db.document.findFirst({
        where: { id: request.documentId },
      });
      if (!document) {
        return {
          isValid: false,
          errors: ["Document not found"],
        };
      }

      // Check if document requires signature
      if (!document.requiresSignature) {
        return {
          isValid: false,
          errors: ["Document does not require signature"],
        };
      }

      const signatures = readSignatures(document);

      // Check if user already signed
      const existingSignature = signatures.find(
        (sig) => String(sig.signerId) === request.signerId
      );

      if (existingSignature) {
        return {
          isValid: false,
          errors: ["User has already signed this document"],
        };
      }

      // Check signature deadline
      if (
        document.signatureDeadline &&
        new Date() > document.signatureDeadline
      ) {
        return {
          isValid: false,
          errors: ["Signature deadline has passed"],
        };
      }

      // Validate signature data
      const validationResult = this.validateSignatureData(
        request.signatureData
      );
      if (!validationResult.isValid) {
        return validationResult;
      }

      // Generate signature hash for verification
      const signatureHash = this.generateSignatureHash(
        request.documentId,
        request.signerId,
        request.signatureData
      );

      // Add signature + access log to the document (immutable Json updates).
      // Old model rule: once a required signature lands, status → "signed".
      const nextSignatures: IDigitalSignature[] = [
        ...signatures,
        {
          signerId: request.signerId,
          signerName: request.signerName,
          signerEmail: request.signerEmail,
          signedAt: new Date().toISOString(),
          signatureData: request.signatureData,
          ipAddress: request.ipAddress,
          userAgent: request.userAgent,
          verified: false,
        },
      ];

      const nextAccessLogs: IAccessLogEntry[] = [
        ...readAccessLogs(document),
        {
          userId: request.signerId,
          action: "sign",
          timestamp: new Date().toISOString(),
          ipAddress: request.ipAddress,
          userAgent: request.userAgent,
          details: `Document signed with hash: ${signatureHash}`,
        },
      ];

      await db.document.update({
        where: { id: document.id },
        data: {
          digitalSignatures: nextSignatures as unknown as Prisma.InputJsonValue,
          accessLogs: nextAccessLogs as unknown as Prisma.InputJsonValue,
          ...(document.requiresSignature && nextSignatures.length > 0
            ? { status: "signed" }
            : {}),
        },
      });

      const signatureIndex = nextSignatures.length - 1;

      return {
        isValid: true,
        signatureId: signatureIndex.toString(),
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("Failed to add signature:", error);
      return {
        isValid: false,
        errors: ["Failed to add signature: " + (error as Error).message],
      };
    }
  }

  // Verify signature authenticity
  async verifySignature(
    documentId: string,
    signatureIndex: number
  ): Promise<ISignatureVerification> {
    try {
      const document = await db.document.findFirst({
        where: { id: documentId },
      });
      if (!document) {
        return {
          isValid: false,
          errors: ["Document not found"],
        };
      }

      const signatures = readSignatures(document);
      const signature = signatures[signatureIndex];
      if (!signature) {
        return {
          isValid: false,
          errors: ["Signature not found"],
        };
      }

      // Verify signature hash
      this.generateSignatureHash(
        documentId,
        String(signature.signerId),
        signature.signatureData
      );

      // In a real implementation, you would verify against stored hash
      // For now, we'll mark as verified (immutable Json update at the index)
      const nextSignatures = [...signatures];
      nextSignatures[signatureIndex] = {
        ...nextSignatures[signatureIndex],
        verified: true,
      };
      await db.document.update({
        where: { id: documentId },
        data: {
          digitalSignatures: nextSignatures as unknown as Prisma.InputJsonValue,
        },
      });

      return {
        isValid: true,
        signatureId: signatureIndex.toString(),
        timestamp: signature.signedAt ? new Date(signature.signedAt) : undefined,
      };
    } catch (error) {
      console.error("Failed to verify signature:", error);
      return {
        isValid: false,
        errors: ["Failed to verify signature: " + (error as Error).message],
      };
    }
  }

  // Get signature status for document
  async getSignatureStatus(documentId: string): Promise<{
    requiresSignature: boolean;
    signatureDeadline?: Date;
    signatures: Array<{
      signerName: string;
      signerEmail: string;
      signedAt: Date;
      verified: boolean;
    }>;
    isFullySigned: boolean;
    pendingSigners?: string[];
  }> {
    const document = await db.document.findFirst({ where: { id: documentId } });
    if (!document) {
      throw new Error("Document not found");
    }

    const storedSignatures = readSignatures(document);
    const signatures = storedSignatures.map((sig) => ({
      signerName: sig.signerName,
      signerEmail: sig.signerEmail,
      signedAt: new Date(sig.signedAt),
      verified: sig.verified,
    }));

    return {
      requiresSignature: document.requiresSignature,
      signatureDeadline: document.signatureDeadline ?? undefined,
      signatures,
      isFullySigned:
        document.requiresSignature && storedSignatures.length > 0,
      pendingSigners: [], // Would be populated based on required signers list
    };
  }

  // Create signature request for multiple signers
  async createSignatureRequest(
    documentId: string,
    signers: Array<{
      userId: string;
      name: string;
      email: string;
    }>,
    deadline?: Date,
    message?: string
  ): Promise<{ success: boolean; requestId?: string; errors?: string[] }> {
    try {
      const document = await db.document.findFirst({
        where: { id: documentId },
      });
      if (!document) {
        return {
          success: false,
          errors: ["Document not found"],
        };
      }

      // Update document to require signatures
      await db.document.update({
        where: { id: documentId },
        data: {
          requiresSignature: true,
          signatureDeadline: deadline ?? null,
        },
      });

      // In a real implementation, you would:
      // 1. Create signature request records
      // 2. Send notification emails to signers
      // 3. Generate unique signing links

      const requestId = `sig_req_${Date.now()}`;

      // Mock sending notifications
      for (const signer of signers) {

      }

      return {
        success: true,
        requestId,
      };
    } catch (error) {
      console.error("Failed to create signature request:", error);
      return {
        success: false,
        errors: [
          "Failed to create signature request: " + (error as Error).message,
        ],
      };
    }
  }

  // Generate signature certificate for user
  async generateCertificate(userId: string): Promise<ISignatureCertificate> {
    const keyPair = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: "spki",
        format: "pem",
      },
      privateKeyEncoding: {
        type: "pkcs8",
        format: "pem",
      },
    });

    const certificate: ISignatureCertificate = {
      id: `cert_${Date.now()}_${userId}`,
      userId,
      publicKey: keyPair.publicKey,
      privateKey: this.encryptPrivateKey(keyPair.privateKey, userId),
      algorithm: "RSA-SHA256",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      status: "active",
    };

    // In a real implementation, store this in database

    return certificate;
  }

  // Validate signature data format
  private validateSignatureData(signatureData: string): ISignatureVerification {
    try {
      // Check if it's valid base64
      const buffer = Buffer.from(signatureData, "base64");

      // Basic validation - should be reasonable size for signature
      if (buffer.length < 100 || buffer.length > 1024 * 1024) {
        // 100 bytes to 1MB
        return {
          isValid: false,
          errors: ["Invalid signature data size"],
        };
      }

      // Additional validation could include:
      // - Image format validation
      // - Signature complexity analysis
      // - Biometric verification

      return {
        isValid: true,
      };
    } catch (error) {
      return {
        isValid: false,
        errors: ["Invalid signature data format"],
      };
    }
  }

  // Generate signature hash for verification
  private generateSignatureHash(
    documentId: string,
    signerId: string,
    signatureData: string
  ): string {
    const data = `${documentId}:${signerId}:${signatureData}:${Date.now()}`;
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  // Encrypt private key (simplified)
  private encryptPrivateKey(privateKey: string, userId: string): string {
    const cipher = crypto.createCipher("aes-256-cbc", userId);
    let encrypted = cipher.update(privateKey, "utf8", "hex");
    encrypted += cipher.final("hex");
    return encrypted;
  }

  // Decrypt private key (simplified)
  private decryptPrivateKey(encryptedKey: string, userId: string): string {
    const decipher = crypto.createDecipher("aes-256-cbc", userId);
    let decrypted = decipher.update(encryptedKey, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }

  // Create signature audit trail
  async getSignatureAuditTrail(documentId: string): Promise<
    Array<{
      action: string;
      user: string;
      timestamp: Date;
      details: string;
      ipAddress?: string;
    }>
  > {
    const document = await db.document.findFirst({ where: { id: documentId } });
    if (!document) {
      throw new Error("Document not found");
    }

    const logs = readAccessLogs(document).filter(
      (log) => log.action === "sign" || log.action === "view"
    );

    // Resolve the users referenced by the log entries (old populate)
    const userIds = [
      ...new Set(
        logs
          .map((log) => log.userId)
          .filter((id): id is string => typeof id === "string")
      ),
    ];
    const users =
      userIds.length > 0
        ? await db.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, email: true },
          })
        : [];
    const emailById = new Map(users.map((row) => [row.id, row.email]));

    return logs.map((log) => ({
      action: log.action,
      user: emailById.get(String(log.userId)) || "Unknown",
      timestamp: new Date(log.timestamp),
      details: log.details || "",
      ipAddress: log.ipAddress,
    }));
  }
}

// Create singleton instance
export const digitalSignatureService = new DigitalSignatureService();
