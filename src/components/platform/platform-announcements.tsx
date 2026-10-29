"use client";

/**
 * PropertyPro SaaS - Platform announcement banners
 *
 * Notices the operator has broadcast to every tenant. Dismissals are kept in
 * localStorage rather than the database: a "we're doing maintenance on Sunday"
 * banner does not warrant a write per user per notice, and the worst case of
 * losing the record is that someone sees the notice again on a new device.
 *
 * A non-dismissible notice ignores that entirely — critical ones stay put.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Info, Megaphone, X } from "lucide-react";

interface Announcement {
  id: string;
  title: string;
  body: string;
  level: "info" | "warning" | "critical";
  dismissible: boolean;
  linkLabel: string | null;
  linkUrl: string | null;
}

const STORAGE_KEY = "propertypro.dismissed-announcements";

const STYLES: Record<Announcement["level"], string> = {
  info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-100",
  warning:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100",
  critical:
    "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100",
};

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function PlatformAnnouncements() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  // Lazy initialiser: localStorage is only readable on the client, and this
  // component renders client-side only.
  const [dismissed, setDismissed] = useState<string[]>(() =>
    typeof window === "undefined" ? [] : readDismissed(),
  );

  useEffect(() => {
    let active = true;
    fetch("/api/platform/announcements")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (active && Array.isArray(payload?.data)) {
          setAnnouncements(payload.data);
        }
      })
      .catch(() => {
        // A missing notice is never worth breaking the dashboard over.
      });
    return () => {
      active = false;
    };
  }, []);

  function dismiss(id: string) {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(-50)));
    } catch {
      // Private-mode storage failure just means it reappears next visit.
    }
  }

  const visible = announcements.filter(
    (announcement) =>
      !announcement.dismissible || !dismissed.includes(announcement.id),
  );

  if (visible.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {visible.map((announcement) => {
        const Icon =
          announcement.level === "critical"
            ? AlertTriangle
            : announcement.level === "warning"
              ? Megaphone
              : Info;
        return (
          <div
            key={announcement.id}
            role="status"
            className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${STYLES[announcement.level]}`}
          >
            <Icon className="mt-0.5 size-5 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold">{announcement.title}</p>
              <p className="mt-0.5 leading-relaxed">{announcement.body}</p>
              {announcement.linkUrl && (
                <a
                  href={announcement.linkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-block font-medium underline underline-offset-4"
                >
                  {announcement.linkLabel || "Learn more"}
                </a>
              )}
            </div>
            {announcement.dismissible && (
              <button
                type="button"
                onClick={() => dismiss(announcement.id)}
                aria-label={`Dismiss ${announcement.title}`}
                className="shrink-0 rounded p-1 opacity-70 transition hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
