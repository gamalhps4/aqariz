"use client";

import { useEffect, useRef } from "react";

type RealtimeMessageEvent = {
  type: "message.created";
  conversationId: string;
  participantIds: string[];
  message: any;
};

type RealtimeEvent = RealtimeMessageEvent | { type: "ready" } | { type: string; [key: string]: any };

export function useRealtimeMessages(
  enabled: boolean,
  onMessage: (event: RealtimeMessageEvent) => void
) {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      es = new EventSource("/api/messages/stream");

      es.onmessage = (evt) => {
        if (!evt.data) return;
        try {
          const parsed: RealtimeEvent = JSON.parse(evt.data);
          if (parsed.type === "message.created") {
            handlerRef.current(parsed as RealtimeMessageEvent);
          }
        } catch {
          // ignore malformed
        }
      };

      es.onerror = () => {
        es?.close();
        es = null;
        if (!closed) {
          retryTimer = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [enabled]);
}
