"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeConversation, normalizeMessage } from "./normalize";
import type { Conversation, Message } from "./types";
import { useRealtimeMessages } from "./useRealtime";

const CONVERSATIONS_POLL_MS = 30_000;
const MESSAGES_POLL_MS = 20_000;

export function useConversations(userId: string | null) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations", { cache: "no-store" });
      if (!res.ok) return;
      const payload = await res.json();
      const list = Array.isArray(payload)
        ? payload
        : payload?.data?.conversations ??
          payload?.conversations ??
          payload?.data ??
          [];
      if (!Array.isArray(list)) return;
      const normalized = list
        .map(normalizeConversation)
        .filter((c): c is Conversation => Boolean(c));
      setConversations(normalized);
    } catch {
      // silent fail; polling will retry
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    void load();
    const interval = setInterval(() => {
      void load();
    }, CONVERSATIONS_POLL_MS);
    return () => clearInterval(interval);
  }, [userId, load]);

  useRealtimeMessages(Boolean(userId), () => {
    void load();
  });

  return { conversations, loading, refresh: load };
}

export function useMessages(conversationId: string | null, userId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const markedIdsRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!conversationId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/conversations/${conversationId}/messages`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data?.messages)
        ? data.messages
        : Array.isArray(data)
        ? data
        : [];
      const normalized = list
        .map(normalizeMessage)
        .filter((m: Message | null): m is Message => Boolean(m));
      setMessages(normalized);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  const markAsRead = useCallback(async () => {
    if (!conversationId || !userId) return;
    const toMark = messages
      .filter(
        (m) =>
          m.senderId !== userId &&
          m.status !== "read" &&
          !markedIdsRef.current.has(m.id)
      )
      .map((m) => m.id);
    if (toMark.length === 0) return;
    toMark.forEach((id) => markedIdsRef.current.add(id));
    try {
      await fetch(`/api/conversations/${conversationId}/messages`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_as_read", messageIds: toMark }),
      });
    } catch {
      // allow retry on next poll
      toMark.forEach((id) => markedIdsRef.current.delete(id));
    }
  }, [conversationId, userId, messages]);

  useEffect(() => {
    markedIdsRef.current = new Set();
    setLoading(true);
    void load();
  }, [conversationId, load]);

  useEffect(() => {
    if (!conversationId) return;
    const interval = setInterval(() => {
      void load();
    }, MESSAGES_POLL_MS);
    return () => clearInterval(interval);
  }, [conversationId, load]);

  useEffect(() => {
    void markAsRead();
  }, [markAsRead]);

  const appendMessage = useCallback((message: Message) => {
    setMessages((prev) =>
      prev.some((m) => m.id === message.id) ? prev : [...prev, message]
    );
  }, []);

  useRealtimeMessages(Boolean(conversationId), (event) => {
    if (event.conversationId !== conversationId) return;
    const normalized = normalizeMessage(event.message);
    if (!normalized) return;
    appendMessage(normalized);
  });

  return { messages, loading, refresh: load, appendMessage };
}
