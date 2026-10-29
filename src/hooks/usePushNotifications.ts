"use client";

import { useCallback, useEffect, useState } from "react";

type PushStatus =
  | "unsupported"
  | "loading"
  | "denied"
  | "granted-subscribed"
  | "granted-unsubscribed"
  | "default";

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buffer;
}

function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function usePushNotifications() {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [busy, setBusy] = useState(false);

  const resolveStatus = useCallback(async () => {
    if (!isPushSupported()) {
      setStatus("unsupported");
      return;
    }
    const permission = Notification.permission;
    if (permission === "denied") {
      setStatus("denied");
      return;
    }
    if (permission === "default") {
      setStatus("default");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setStatus(sub ? "granted-subscribed" : "granted-unsubscribed");
    } catch {
      setStatus("granted-unsubscribed");
    }
  }, []);

  useEffect(() => {
    void resolveStatus();
  }, [resolveStatus]);

  const subscribe = useCallback(async () => {
    if (!isPushSupported()) return false;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "default");
        return false;
      }

      const vapidRes = await fetch("/api/push/vapid");
      if (!vapidRes.ok) {
        console.error("VAPID key unavailable");
        return false;
      }
      const { publicKey } = await vapidRes.json();
      if (!publicKey) return false;

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
        }),
      });
      if (!res.ok) return false;

      setStatus("granted-subscribed");
      return true;
    } catch (err) {
      console.error("Push subscribe failed", err);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    if (!isPushSupported()) return false;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setStatus("granted-unsubscribed");
        return true;
      }
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await fetch("/api/push/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
      setStatus("granted-unsubscribed");
      return true;
    } catch (err) {
      console.error("Push unsubscribe failed", err);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, subscribe, unsubscribe, refresh: resolveStatus };
}
