"use client";

/**
 * PropertyPro - The ledger data several screens read
 *
 * The chart of accounts (for every account picker) and the setup (to know
 * whether accounting is set up at all), each fetched once per screen.
 */

import { useCallback, useEffect, useState } from "react";
import { ledgerRequest } from "./ledger-ui";
import type { AccountType, DepositHolder, NormalSide } from "@/lib/accounting/types";
import type { SystemKey } from "@/lib/accounting/system-keys";

export interface LedgerAccount {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  type: AccountType;
  normalSide: NormalSide;
  parentId: string | null;
  postable: boolean;
  systemKey: string | null;
  active: boolean;
  level: number;
  hasChildren: boolean;
  hasPostings: boolean;
  mapped: boolean;
  bankLinked: boolean;
  canDelete: boolean;
  debit: number;
  credit: number;
  balance: number;
}

export function useLedgerAccounts(enabled = true) {
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<{ code: string | null; message: string | null } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      const response = await ledgerRequest<{ accounts: LedgerAccount[] }>("/accounts", {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.ok) {
        setAccounts(response.data?.accounts ?? []);
        setError(null);
      } else {
        setError({ code: response.code, message: response.message });
      }
      setLoading(false);
    })();
    return () => controller.abort();
  }, [enabled, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { accounts, loading, error, reload };
}

export interface LedgerSettingsView {
  isSetUp: boolean;
  settings: {
    cutOverDate: string | null;
    closedThrough: string | null;
    vatRegistered: boolean;
    vatNumber: string | null;
    basis: string;
    depositHolder: DepositHolder;
    setupAt: string | null;
    lastSweepAt: string | null;
    templateVersion: string | null;
  } | null;
  accountCount: number;
  entryCount: number;
  map: Array<{ key: SystemKey; accountId: string | null; chosen: boolean }>;
}

export function useLedgerSetup(enabled = true) {
  const [view, setView] = useState<LedgerSettingsView | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<{ code: string | null; message: string | null } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      const response = await ledgerRequest<LedgerSettingsView>("/setup", { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (response.ok) {
        setView(response.data);
        setError(null);
      } else {
        setError({ code: response.code, message: response.message });
      }
      setLoading(false);
    })();
    return () => controller.abort();
  }, [enabled, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { view, setView, loading, error, reload };
}
