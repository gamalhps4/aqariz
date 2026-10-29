/**
 * PropertyPro - Push delivery (single choke point)
 *
 * Fans one payload out to every registered subscription of the target users,
 * across platforms: `web` rows hold Web Push (VAPID) subscriptions, `ios` /
 * `android` rows hold FCM device tokens in the `endpoint` column. Dead
 * subscriptions are pruned on delivery failure so the table self-heals.
 */

import webpush from "web-push";
import { db } from "@/lib/db/prisma";
import { sendFcmToTokens } from "./fcm";

let configured = false;

function configureWebPush() {
  if (configured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@propertypro.app";
  if (!publicKey || !privateKey) {
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
};

export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload
): Promise<void> {
  if (userIds.length === 0) return;

  try {
    const subs = await db.pushSubscription.findMany({
      where: { userId: { in: userIds } },
    });
    if (subs.length === 0) return;

    const webSubs = subs.filter(
      (sub) => sub.platform === "web" && sub.p256dh && sub.auth
    );
    const nativeSubs = subs.filter(
      (sub) => sub.platform === "ios" || sub.platform === "android"
    );

    const staleIds: string[] = [];

    // ---- Web Push (VAPID) ----------------------------------------------------
    if (webSubs.length > 0 && configureWebPush()) {
      const body = JSON.stringify({
        icon: "/icons/icon-192x192.png",
        badge: "/icons/icon-192x192.png",
        ...payload,
      });

      await Promise.allSettled(
        webSubs.map(async (sub) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh!, auth: sub.auth! },
              },
              body
            );
          } catch (err: any) {
            const status = err?.statusCode;
            if (status === 404 || status === 410) {
              staleIds.push(sub.id);
            }
          }
        })
      );
    }

    // ---- Native (FCM: Android directly, iOS via APNs) -------------------------
    if (nativeSubs.length > 0) {
      const { staleTokens } = await sendFcmToTokens(
        nativeSubs.map((sub) => sub.endpoint),
        payload
      );
      if (staleTokens.length > 0) {
        const dead = new Set(staleTokens);
        for (const sub of nativeSubs) {
          if (dead.has(sub.endpoint)) staleIds.push(sub.id);
        }
      }
    }

    if (staleIds.length > 0) {
      await db.pushSubscription.deleteMany({ where: { id: { in: staleIds } } });
    }
  } catch (err) {
    console.error("sendPushToUsers failed:", err);
  }
}
