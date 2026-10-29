"use client";

/**
 * PropertyPro SaaS - Client-side entitlements
 *
 * The server has always gated features correctly (402 via `requirePlanFeature`),
 * but the UI had no idea — so a Free-plan user saw every gated button, clicked
 * it, and got a raw error toast. This hook lets the UI know what the plan
 * includes so it can offer an upgrade instead of a failure.
 *
 * It is presentation only. The server check is the real boundary; nothing here
 * grants access, it only decides what to show.
 */

import { useEffect, useState } from "react";
import type { PlanLimitKey } from "@/lib/billing/plan-constants";

export interface Entitlements {
  plan: string;
  planName: string;
  features: string[];
  limits: Record<PlanLimitKey, number | null>;
  usage: Record<PlanLimitKey, number>;
  canManageBilling: boolean;
}

interface EntitlementsState {
  entitlements: Entitlements | null;
  loading: boolean;
}

// One fetch shared by every component on the page: a dashboard can easily
// mount a dozen gates, and each mounting its own request would be wasteful.
let cache: Promise<Entitlements | null> | null = null;

function fetchEntitlements<T>(url: string): Promise<T | null> {
  return fetch(url)
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => (payload?.data as T) ?? null)
    .catch(() => null);
}

function loadEntitlements(): Promise<Entitlements | null> {
  cache ??= fetchEntitlements<Entitlements>("/api/billing/entitlements");
  return cache;
}

/** Drop the shared cache — call after a plan change so gates re-evaluate. */
export function refreshEntitlements(): void {
  cache = null;
}

/** A shared request's answer, with whether it is still on its way. */
function useLoaded<T>(load: () => Promise<T | null>): {
  value: T | null;
  loading: boolean;
} {
  const [state, setState] = useState<{ value: T | null; loading: boolean }>({
    value: null,
    loading: true,
  });

  useEffect(() => {
    let active = true;
    load().then((value) => {
      if (active) setState({ value, loading: false });
    });
    return () => {
      active = false;
    };
  }, [load]);

  return state;
}

export function useEntitlements(): EntitlementsState {
  const { value, loading } = useLoaded(loadEntitlements);
  return { entitlements: value, loading };
}

/**
 * Whether the current plan includes `feature`.
 *
 * Returns `true` while loading and when the lookup fails: a gate that hides
 * the UI on a network blip would look like the feature had been taken away.
 * The server refuses the action either way.
 */
export function useHasFeature(feature: string): {
  hasFeature: boolean;
  loading: boolean;
  entitlements: Entitlements | null;
} {
  const { entitlements, loading } = useEntitlements();
  return {
    hasFeature: !entitlements || entitlements.features.includes(feature),
    loading,
    entitlements,
  };
}

/** How close the organization is to a limit, for nudges before the wall. */
export function useLimitUsage(key: PlanLimitKey): {
  usage: number;
  limit: number | null;
  atLimit: boolean;
  nearLimit: boolean;
} {
  const { entitlements } = useEntitlements();
  const usage = entitlements?.usage?.[key] ?? 0;
  const limit = entitlements?.limits?.[key] ?? null;
  return {
    usage,
    limit,
    atLimit: limit !== null && usage >= limit,
    nearLimit: limit !== null && usage >= limit * 0.8,
  };
}
