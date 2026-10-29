/**
 * PropertyPro - Push subscription registration
 *
 * Accepts both subscription shapes:
 *  - Web Push:  { endpoint, keys: { p256dh, auth } }
 *  - Native:    { platform: "ios" | "android", token }   (FCM device token)
 *
 * Native tokens are stored in the `endpoint` column (globally unique), with
 * no VAPID keys. `sendPushToUsers` routes by `platform`.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/prisma";
import { withAccessAndDB, AuthenticatedAccessUser } from "@/lib/api-utils";

export const dynamic = "force-dynamic";

export const POST = withAccessAndDB({})(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const userAgent = request.headers.get("user-agent") || undefined;

    // ---- Native device token (mobile app) ------------------------------------
    const platform: string | undefined = body?.platform;
    if (platform === "ios" || platform === "android") {
      const token: string | undefined = body?.token;
      if (!token || typeof token !== "string" || token.length < 8) {
        return NextResponse.json(
          { error: "Missing device token" },
          { status: 400 }
        );
      }

      await db.pushSubscription.upsert({
        where: { endpoint: token },
        update: { userId: user.id, platform, userAgent },
        create: {
          organizationId: user.organizationId!,
          userId: user.id,
          endpoint: token,
          platform,
          userAgent,
        },
      });

      return NextResponse.json({ ok: true });
    }

    // ---- Web Push subscription -------------------------------------------------
    const endpoint: string | undefined = body?.endpoint;
    const p256dh: string | undefined = body?.keys?.p256dh;
    const authKey: string | undefined = body?.keys?.auth;

    if (!endpoint || !p256dh || !authKey) {
      return NextResponse.json(
        { error: "Missing subscription fields" },
        { status: 400 }
      );
    }

    await db.pushSubscription.upsert({
      where: { endpoint },
      update: {
        userId: user.id,
        platform: "web",
        p256dh,
        auth: authKey,
        userAgent,
      },
      create: {
        organizationId: user.organizationId!,
        userId: user.id,
        endpoint,
        platform: "web",
        p256dh,
        auth: authKey,
        userAgent,
      },
    });

    return NextResponse.json({ ok: true });
  }
);
