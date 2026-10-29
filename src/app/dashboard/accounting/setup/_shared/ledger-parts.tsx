"use client";

/**
 * PropertyPro - Pieces the ledger screens share: an account picker, the
 * "set up accounting first" and "no access" states, and the page header.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { BookOpen, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { GlobalPagination } from "@/components/ui/global-pagination";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { accountName, useLedgerText } from "./ledger-ui";
import type { AccountType } from "@/lib/accounting/types";

export function LedgerHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function NoLedgerAccess() {
  const { tx } = useLedgerText();
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <Lock className="h-8 w-8 text-muted-foreground" />
        <p className="font-medium">{tx("ledger.access.deniedTitle", "You do not have access to the books")}</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {tx(
            "ledger.access.deniedBody",
            "Ask an administrator for the View the books permission in your permission group.",
          )}
        </p>
      </CardContent>
    </Card>
  );
}

export function LedgerNotSetUp({ canManage }: { canManage: boolean }) {
  const { tx } = useLedgerText();
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <BookOpen className="h-8 w-8 text-muted-foreground" />
        <p className="font-medium">{tx("ledger.notSetUp.title", "Accounting is not set up yet")}</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {tx(
            "ledger.notSetUp.body",
            "Set up accounting to create the chart of accounts and start posting the office's documents to the books.",
          )}
        </p>
        {canManage && (
          <Button asChild size="sm">
            <Link href="/dashboard/accounting/setup">{tx("ledger.notSetUp.action", "Open accounting setup")}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** What the picker needs of an account: the chart's own rows and the purchases lookups both fit. */
export interface PickableAccount {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  type: AccountType;
  postable: boolean;
  active: boolean;
}

export function AccountPicker({
  accounts,
  value,
  onChange,
  types,
  placeholder,
  className,
  disabled,
  includeInactive = false,
}: {
  accounts: readonly PickableAccount[];
  value: string;
  onChange: (accountId: string) => void;
  types?: readonly AccountType[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  includeInactive?: boolean;
}) {
  const { tx, language } = useLedgerText();
  const options = accounts
    .filter(
      (account) =>
        account.postable &&
        (includeInactive || account.active || account.id === value) &&
        (!types || types.includes(account.type)),
    )
    .map((account) => ({
      value: account.id,
      label: `${account.code} — ${accountName(account, language)}`,
      subtitle: account.active ? undefined : tx("ledger.account.inactive", "Inactive"),
    }));
  return (
    <SearchableSelect
      value={value}
      onValueChange={onChange}
      options={options}
      placeholder={placeholder ?? tx("ledger.account.choose", "Choose an account")}
      searchPlaceholder={tx("ledger.account.search", "Search by code or name")}
      emptyMessage={tx("ledger.account.none", "No matching account")}
      triggerClassName={className}
      disabled={disabled}
    />
  );
}

/** An amount as the books show it: never negative zero, grouped digits. */
export function Money({ value, className }: { value: number; className?: string }) {
  const { formatCurrency, isRTL } = useLedgerText();
  const { currency } = useLocalizationContext();
  const amount = Math.abs(value) < 0.005 ? 0 : value;
  // Right to left, a sign written after the figure (the riyal's) sits on its
  // left as on every other screen; only the figure is held left to right, so
  // a minus stays on its left.
  if (isRTL && currency?.symbolPosition === "after") {
    return (
      <span className={className}>
        <bdi dir="ltr">{formatCurrency(amount, undefined, { showSymbol: false })}</bdi>&nbsp;{currency.symbol}
      </span>
    );
  }
  return <span className={className} dir="ltr">{formatCurrency(amount)}</span>;
}

/** The shared pagination, with the app's own words for it. */
export function LedgerPagination({
  page,
  limit,
  total,
  onPageChange,
  onLimitChange,
}: {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}) {
  const { t } = useLocalizationContext();
  return (
    <GlobalPagination
      currentPage={page}
      totalPages={Math.max(1, Math.ceil(total / limit))}
      totalItems={total}
      pageSize={limit}
      onPageChange={onPageChange}
      onPageSizeChange={(size) => {
        onLimitChange(size);
        onPageChange(1);
      }}
      pageSizeOptions={[20, 50, 100]}
      showingLabel={t("common.showing", { defaultValue: "Showing" })}
      previousLabel={t("common.previous", { defaultValue: "Previous" })}
      nextLabel={t("common.next", { defaultValue: "Next" })}
      pageLabel={t("common.page", { defaultValue: "Page" })}
      ofLabel={t("common.of", { defaultValue: "of" })}
      itemsPerPageLabel={t("common.perPage", { defaultValue: "per page" })}
    />
  );
}
