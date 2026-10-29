import { NextRequest } from "next/server";
import { withAccessAndDB, AuthenticatedAccessUser } from "@/lib/api-utils";
import { createSseStream } from "@/lib/realtime/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withAccessAndDB({})(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    const userId = String(user.id);

    return createSseStream(request.signal, (event) => {
      if (event.type !== "message.created") return false;
      return event.participantIds.includes(userId);
    });
  }
);
