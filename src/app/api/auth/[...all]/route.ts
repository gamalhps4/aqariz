/**
 * PropertyPro - Better Auth API Route
 * Catch-all handler for every Better Auth endpoint (sign-in, sign-out, OAuth
 * callbacks, session reads). Sibling static routes in this directory —
 * signup-organization, forgot-password, reset-password, setup-password,
 * onboarding — take precedence over this catch-all by App Router routing rules.
 */

import { auth } from "@/lib/better-auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
