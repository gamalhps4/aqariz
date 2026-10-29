import crypto from "crypto";
import { requireOrgId, runWithOrgContext } from "@/lib/tenancy/context";

export interface CalendarInvitationPayload {
  eventId: string;
  attendeeId?: string;
  email?: string;
  external: boolean;
  organizationId: string;
  timestamp: number;
}

function signingSecret(): string {
  // Same secret Better Auth signs with; NEXTAUTH_SECRET accepted as a legacy
  // fallback so pre-migration deployments keep their outstanding RSVP links.
  const secret =
    process.env.BETTER_AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required for RSVP links");
  }
  return secret;
}

function signature(encodedPayload: string): Buffer {
  return crypto
    .createHmac("sha256", signingSecret())
    .update(encodedPayload)
    .digest();
}

export function createCalendarInvitationToken(
  input:
    | { eventId: string; attendeeId: string }
    | { eventId: string; email: string; external: true },
): string {
  const payload: CalendarInvitationPayload = {
    ...input,
    external: "external" in input && input.external === true,
    organizationId: requireOrgId(),
    timestamp: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded).toString("base64url")}`;
}

export function verifyCalendarInvitationToken(
  token: string,
): CalendarInvitationPayload {
  const [encoded, suppliedSignature, extra] = token.split(".");
  if (!encoded || !suppliedSignature || extra) {
    throw new Error("Invalid invitation token");
  }

  const expected = signature(encoded);
  const supplied = Buffer.from(suppliedSignature, "base64url");
  if (
    expected.length !== supplied.length ||
    !crypto.timingSafeEqual(expected, supplied)
  ) {
    throw new Error("Invalid invitation token");
  }

  const payload = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  ) as Partial<CalendarInvitationPayload>;

  // Record ids are cuids now (24-hex ObjectIds only appear in legacy links).
  const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

  if (
    typeof payload.eventId !== "string" ||
    !ID_PATTERN.test(payload.eventId) ||
    typeof payload.organizationId !== "string" ||
    !ID_PATTERN.test(payload.organizationId) ||
    typeof payload.timestamp !== "number" ||
    typeof payload.external !== "boolean" ||
    (payload.external
      ? typeof payload.email !== "string" || !payload.email.includes("@")
      : typeof payload.attendeeId !== "string" ||
        !ID_PATTERN.test(payload.attendeeId))
  ) {
    throw new Error("Invalid invitation token");
  }

  return payload as CalendarInvitationPayload;
}

export function runWithCalendarInvitationContext<T>(
  token: string,
  callback: (payload: CalendarInvitationPayload) => T,
): Promise<Awaited<T>> {
  const payload = verifyCalendarInvitationToken(token);
  return runWithOrgContext(
    { organizationId: payload.organizationId, isPlatformAdmin: false },
    () => callback(payload),
  );
}
