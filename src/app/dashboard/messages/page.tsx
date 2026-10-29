"use client";

import { useSession } from "@/lib/auth-client";
import { MessagesClient } from "@/components/messaging/solvio/MessagesClient";

export default function MessagesPage() {
  const { data: session, status } = useSession();

  if (status === "loading" || !session?.user?.id) {
    return (
      <div className="flex h-[calc(100vh-8rem)] items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return <MessagesClient userId={session.user.id} />;
}
