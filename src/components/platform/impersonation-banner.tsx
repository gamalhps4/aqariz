"use client";

/**
 * PropertyPro SaaS - Impersonation banner
 *
 * Loud on purpose. An operator who forgets they are inside a customer's
 * account and starts reading it as their own is the failure mode this exists
 * to prevent, so the banner is fixed, full-width, and not dismissible.
 */

import { useEffect, useState } from "react";
import { Eye, LogOut } from "lucide-react";

interface ImpersonationState {
  email: string;
  organizationName: string | null;
  operatorEmail: string;
}

export function ImpersonationBanner() {
  const [state, setState] = useState<ImpersonationState | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/impersonation-status")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (active && payload?.data?.impersonating) setState(payload.data);
      })
      .catch(() => {
        // No banner is better than a broken dashboard.
      });
    return () => {
      active = false;
    };
  }, []);

  if (!state) return null;

  async function stop() {
    setLeaving(true);
    try {
      await fetch("/api/auth/stop-impersonating", { method: "POST" });
    } finally {
      // Full reload: every server component on the page was rendered as the
      // customer and must be re-rendered as the operator.
      window.location.assign("/admin/organizations");
    }
  }

  return (
    <div className="sticky top-0 z-[60] flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-500 bg-amber-400 px-4 py-2 text-sm text-amber-950">
      <Eye className="size-4 shrink-0" />
      <span className="font-semibold">Support view</span>
      <span>
        You are viewing{" "}
        <strong>{state.organizationName ?? "this account"}</strong> as{" "}
        <strong>{state.email}</strong>. This session is read-only — no changes
        can be saved.
      </span>
      <button
        type="button"
        onClick={stop}
        disabled={leaving}
        className="ms-auto inline-flex items-center gap-1.5 rounded-md bg-amber-950 px-3 py-1 font-medium text-amber-50 transition hover:bg-amber-900 disabled:opacity-60"
      >
        <LogOut className="size-3.5" />
        {leaving ? "Leaving…" : "Stop viewing"}
      </button>
    </div>
  );
}
