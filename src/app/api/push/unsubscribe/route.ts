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

    // Web sends the push endpoint; the mobile app may send its device token.
    const endpoint: string | undefined = body?.endpoint ?? body?.token;
    if (!endpoint) {
      return NextResponse.json(
        { error: "Missing endpoint" },
        { status: 400 }
      );
    }

    await db.pushSubscription.deleteMany({
      where: {
        endpoint,
        userId: user.id,
      },
    });

    return NextResponse.json({ ok: true });
  }
);
