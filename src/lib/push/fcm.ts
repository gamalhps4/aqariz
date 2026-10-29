/**
 * PropertyPro - Firebase Cloud Messaging sender (native mobile push)
 *
 * Delivers to iOS and Android device tokens through the FCM HTTP v1 API —
 * FCM fronts APNs for iOS, so one integration covers both platforms.
 *
 * Configuration: set FCM_SERVICE_ACCOUNT to the Firebase service-account JSON
 * (the whole object, as a string). When unset, native sends are skipped
 * silently so web push keeps working without any Firebase project.
 *
 * Auth uses google-auth JWT via the already-installed `googleapis` package —
 * no firebase-admin dependency.
 */

import { google } from "googleapis";
import type { PushPayload } from "./send";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let cached:
  | { account: ServiceAccount; client: InstanceType<typeof google.auth.JWT> }
  | null
  | undefined;

function getFcm() {
  if (cached !== undefined) return cached;

  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) {
    cached = null;
    return cached;
  }

  try {
    const account = JSON.parse(raw) as ServiceAccount;
    if (!account.project_id || !account.client_email || !account.private_key) {
      throw new Error("service account JSON missing required fields");
    }
    const client = new google.auth.JWT({
      email: account.client_email,
      key: account.private_key,
      scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
    });
    cached = { account, client };
  } catch (error) {
    console.error("FCM_SERVICE_ACCOUNT is not valid service-account JSON:", error);
    cached = null;
  }
  return cached;
}

export function isFcmConfigured(): boolean {
  return getFcm() !== null;
}

export interface FcmSendResult {
  /** Device tokens FCM reported as dead (unregistered/invalid) — prune them. */
  staleTokens: string[];
  sent: number;
  failed: number;
}

/**
 * Send one notification payload to a set of native device tokens.
 * Never throws — push delivery must not break the triggering operation.
 */
export async function sendFcmToTokens(
  tokens: string[],
  payload: PushPayload,
): Promise<FcmSendResult> {
  const result: FcmSendResult = { staleTokens: [], sent: 0, failed: 0 };
  const fcm = getFcm();
  if (!fcm || tokens.length === 0) return result;

  let accessToken: string | null | undefined;
  try {
    accessToken = (await fcm.client.getAccessToken()).token;
  } catch (error) {
    console.error("FCM auth failed:", error);
    result.failed = tokens.length;
    return result;
  }
  if (!accessToken) {
    result.failed = tokens.length;
    return result;
  }

  const endpoint = `https://fcm.googleapis.com/v1/projects/${fcm.account.project_id}/messages:send`;

  await Promise.allSettled(
    tokens.map(async (token) => {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: payload.title, body: payload.body },
              data: {
                ...(payload.url ? { url: payload.url } : {}),
                ...(payload.tag ? { tag: payload.tag } : {}),
              },
              android: { priority: "HIGH" },
              apns: {
                payload: { aps: { sound: "default", badge: 1 } },
              },
            },
          }),
        });

        if (response.ok) {
          result.sent += 1;
          return;
        }

        result.failed += 1;
        const body = await response.text();
        // UNREGISTERED / INVALID_ARGUMENT with a dead token ⇒ prune it.
        if (
          response.status === 404 ||
          body.includes("UNREGISTERED") ||
          body.includes("INVALID_ARGUMENT")
        ) {
          result.staleTokens.push(token);
        } else {
          console.error(`FCM send failed (${response.status}):`, body.slice(0, 300));
        }
      } catch (error) {
        result.failed += 1;
        console.error("FCM request error:", error);
      }
    }),
  );

  return result;
}
