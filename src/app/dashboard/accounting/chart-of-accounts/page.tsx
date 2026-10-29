"use client";

/**
 * PropertyPro - Chart of accounts
 *
 * The office's accounts as a tree, with codes and balances: add, rename,
 * renumber, move under another heading, switch on and off, delete what was
 * never used. The accounts the automatic postings use are marked, and the
 * server refuses what would break them (lib/accounting/coa-rules.ts).
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FolderTree, MoreHorizontal, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import GlobalSearch from "@/components/ui/global-search";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ACCOUNT_TYPES, type AccountType, type NormalSide } from "@/lib/accounting/types";
import { LedgerHeader, LedgerNotSetUp, Money, NoLedgerAccess } from "../setup/_shared/ledger-parts";
import {
  ACCOUNT_TYPE_TEXT,
  NORMAL_SIDE_TEXT,
  accountName,
  ledgerRequest,
  useLedgerAccess,
  useLedgerError,
  useLedgerText,
} from "../setup/_shared/ledger-ui";
import { useLedgerAccounts, type LedgerAccount } from "../setup/_shared/use-ledger-data";

interface AccountForm {
  id: string | null;
  code: string;
  nameAr: string;
  nameEn: string;
  type: AccountType;
  normalSide: NormalSide;
  parentId: string;
  postable: boolean;
}

const EMPTY_FORM: AccountForm = {
  id: null,
  code: "",
  nameAr: "",
  nameEn: "",
  type: "asset",
  normalSide: "debit",
  parentId: "",
  postable: true,
};

const NO_PARENT = "__none__";

export default function ChartOfAccountsPage() {
  const access = useLedgerAccess();
  const { tx, text, language } = useLedgerText();
  const describeError = useLedgerError();
  const { accounts, loading, error, reload } = useLedgerAccounts(access.canView);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState<AccountForm | null>(null);
  const [saving, setSaving] = useState(false);

  const byId = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return accounts.filter((account) => showInactive || account.active);
    // A match keeps its headings in view, so it still reads in place.
    const keep = new Set<string>();
    for (const account of accounts) {
      const hit =
        account.code.toLowerCase().includes(needle) ||
        account.nameAr.toLowerCase().includes(needle) ||
        account.nameEn.toLowerCase().includes(needle);
      if (!hit) continue;
      let cursor: string | null = account.id;
      while (cursor && !keep.has(cursor)) {
        keep.add(cursor);
        cursor = byId.get(cursor)?.parentId ?? null;
      }
    }
    return accounts.filter((account) => keep.has(account.id) && (showInactive || account.active));
  }, [accounts, byId, search, showInactive]);

  if (access.loading) return null;
  if (!access.canView) return <NoLedgerAccess />;
  if (error?.code === "LEDGER_NOT_SET_UP") return <LedgerNotSetUp canManage={access.canManage} />;

  const headings = accounts.filter((account) => !account.postable);

  function openNew(parent?: LedgerAccount) {
    setForm({
      ...EMPTY_FORM,
      parentId: parent?.id ?? "",
      type: parent?.type ?? "asset",
      normalSide: parent?.normalSide ?? "debit",
    });
  }

  function openEdit(account: LedgerAccount) {
    setForm({
      id: account.id,
      code: account.code,
      nameAr: account.nameAr,
      nameEn: account.nameEn,
      type: account.type,
      normalSide: account.normalSide,
      parentId: account.parentId ?? "",
      postable: account.postable,
    });
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    const body = {
      code: form.code,
      nameAr: form.nameAr,
      nameEn: form.nameEn,
      type: form.type,
      normalSide: form.normalSide,
      parentId: form.parentId || null,
      postable: form.postable,
    };
    const response = form.id
      ? await ledgerRequest(`/accounts/${form.id}`, { method: "PATCH", body })
      : await ledgerRequest("/accounts", { method: "POST", body });
    setSaving(false);
    if (!response.ok) {
      toast.error(describeError(response));
      return;
    }
    toast.success(form.id ? tx("ledger.coa.saved", "Account saved") : tx("ledger.coa.added", "Account added"));
    setForm(null);
    reload();
  }

  async function toggleActive(account: LedgerAccount) {
    const response = await ledgerRequest(`/accounts/${account.id}`, {
      method: "PATCH",
      body: { active: !account.active },
    });
    if (!response.ok) {
      toast.error(describeError(response));
      return;
    }
    toast.success(
      account.active
        ? tx("ledger.coa.deactivated", "Account deactivated")
        : tx("ledger.coa.activated", "Account activated"),
    );
    reload();
  }

  async function remove(account: LedgerAccount) {
    if (
      !window.confirm(
        tx("ledger.coa.confirmDelete", "Delete account {code}? This cannot be undone.", { code: account.code }),
      )
    ) {
      return;
    }
    const response = await ledgerRequest(`/accounts/${account.id}`, { method: "DELETE" });
    if (!response.ok) {
      toast.error(describeError(response));
      return;
    }
    toast.success(tx("ledger.coa.deleted", "Account deleted"));
    reload();
  }

  const columns: DataTableColumn<LedgerAccount>[] = [
    {
      id: "code",
      header: tx("ledger.coa.code", "Code"),
      cell: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {row.code}
        </span>
      ),
      width: "min-w-[90px]",
    },
    {
      id: "name",
      header: tx("ledger.coa.name", "Account"),
      cell: (row) => (
        <div className="flex items-center gap-2" style={{ paddingInlineStart: `${(row.level - 1) * 1.25}rem` }}>
          {!row.postable && <FolderTree className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <div className="min-w-0">
            <div className={row.postable ? "text-sm" : "text-sm font-semibold"}>{accountName(row, language)}</div>
            <div className="truncate text-xs text-muted-foreground">
              {language === "ar" ? row.nameEn : row.nameAr}
            </div>
          </div>
          {row.systemKey && (
            <Badge variant="secondary" className="text-[10px]">
              {tx("ledger.coa.system", "Used by postings")}
            </Badge>
          )}
          {!row.active && (
            <Badge variant="outline" className="text-[10px]">
              {tx("ledger.account.inactive", "Inactive")}
            </Badge>
          )}
        </div>
      ),
      width: "min-w-[280px]",
    },
    {
      id: "type",
      header: tx("ledger.coa.type", "Type"),
      cell: (row) => <span className="text-sm">{text(ACCOUNT_TYPE_TEXT[row.type])}</span>,
      visibility: "md",
    },
    {
      id: "side",
      header: tx("ledger.coa.normalSide", "Normal side"),
      cell: (row) => <span className="text-sm">{text(NORMAL_SIDE_TEXT[row.normalSide])}</span>,
      visibility: "lg",
    },
    {
      id: "balance",
      header: tx("ledger.coa.balance", "Balance"),
      cell: (row) => <Money value={row.balance} className={row.postable ? "text-sm" : "text-sm font-semibold"} />,
      align: "right",
      width: "min-w-[120px]",
    },
    {
      id: "actions",
      header: "",
      cell: (row) =>
        access.canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={tx("ledger.common.actions", "Actions")}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openEdit(row)}>
                <Pencil className="h-4 w-4" />
                {tx("ledger.common.edit", "Edit")}
              </DropdownMenuItem>
              {!row.postable && (
                <DropdownMenuItem onClick={() => openNew(row)}>
                  <Plus className="h-4 w-4" />
                  {tx("ledger.coa.addSub", "Add sub-account")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => toggleActive(row)}>
                <Power className="h-4 w-4" />
                {row.active ? tx("ledger.coa.deactivate", "Deactivate") : tx("ledger.coa.activate", "Activate")}
              </DropdownMenuItem>
              {row.canDelete && (
                <DropdownMenuItem onClick={() => remove(row)} className="text-destructive">
                  <Trash2 className="h-4 w-4" />
                  {tx("ledger.common.delete", "Delete")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null,
      width: "w-10",
      align: "center",
    },
  ];

  const parentOptions = headings.filter(
    (heading) => heading.id !== form?.id && (!form || heading.type === form.type),
  );

  return (
    <div className="space-y-4">
      <LedgerHeader
        title={tx("ledger.nav.chartOfAccounts", "Chart of accounts")}
        subtitle={tx(
          "ledger.coa.subtitle",
          "The office's accounts in four levels: class, group, account and sub-account. Only sub-accounts take postings.",
        )}
        actions={
          access.canManage ? (
            <Button size="sm" onClick={() => openNew()}>
              <Plus className="h-4 w-4" />
              {tx("ledger.coa.add", "Add account")}
            </Button>
          ) : null
        }
      />

      <Card className="gap-2">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <GlobalSearch
              placeholder={tx("ledger.coa.searchPlaceholder", "Search by code or name…")}
              initialValue={search}
              debounceDelay={200}
              onSearch={setSearch}
              isLoading={loading}
              className="min-w-0 flex-1"
              ariaLabel={tx("ledger.coa.searchPlaceholder", "Search by code or name…")}
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={showInactive} onCheckedChange={(value) => setShowInactive(value === true)} />
              {tx("ledger.coa.showInactive", "Show inactive accounts")}
            </label>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={visible}
            loading={loading}
            getRowKey={(row) => row.id}
            striped={false}
            emptyState={{
              title: tx("ledger.coa.empty", "No accounts match"),
              icon: <FolderTree className="h-8 w-8 text-muted-foreground" />,
            }}
          />
        </CardContent>
      </Card>

      <Dialog open={form !== null} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {form?.id ? tx("ledger.coa.editTitle", "Edit account") : tx("ledger.coa.addTitle", "Add account")}
            </DialogTitle>
            <DialogDescription>
              {tx(
                "ledger.coa.formHint",
                "An account sits under a heading of its own type. Headings group accounts; only accounts that take postings appear in journals.",
              )}
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="acc-code">{tx("ledger.coa.code", "Code")}</Label>
                <Input
                  id="acc-code"
                  dir="ltr"
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{tx("ledger.coa.parent", "Under heading")}</Label>
                <Select
                  value={form.parentId || NO_PARENT}
                  onValueChange={(value) => {
                    const parentId = value === NO_PARENT ? "" : value;
                    const parent = parentId ? byId.get(parentId) : undefined;
                    setForm({
                      ...form,
                      parentId,
                      type: parent?.type ?? form.type,
                      normalSide: parent?.normalSide ?? form.normalSide,
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PARENT}>{tx("ledger.coa.topLevel", "Top level (a class)")}</SelectItem>
                    {parentOptions.map((heading) => (
                      <SelectItem key={heading.id} value={heading.id}>
                        {heading.code} — {accountName(heading, language)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="acc-ar">{tx("ledger.coa.nameAr", "Arabic name")}</Label>
                <Input
                  id="acc-ar"
                  dir="rtl"
                  value={form.nameAr}
                  onChange={(event) => setForm({ ...form, nameAr: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="acc-en">{tx("ledger.coa.nameEn", "English name")}</Label>
                <Input
                  id="acc-en"
                  dir="ltr"
                  value={form.nameEn}
                  onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{tx("ledger.coa.type", "Type")}</Label>
                <Select
                  value={form.type}
                  onValueChange={(value) => setForm({ ...form, type: value as AccountType, parentId: "" })}
                  disabled={Boolean(form.parentId)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {text(ACCOUNT_TYPE_TEXT[type])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{tx("ledger.coa.normalSide", "Normal side")}</Label>
                <Select
                  value={form.normalSide}
                  onValueChange={(value) => setForm({ ...form, normalSide: value as NormalSide })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="debit">{text(NORMAL_SIDE_TEXT.debit)}</SelectItem>
                    <SelectItem value="credit">{text(NORMAL_SIDE_TEXT.credit)}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Checkbox
                  checked={form.postable}
                  onCheckedChange={(value) => setForm({ ...form, postable: value === true })}
                />
                {tx("ledger.coa.postable", "Takes postings (a sub-account, not a heading)")}
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              {tx("ledger.common.cancel", "Cancel")}
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? tx("ledger.common.working", "Working…") : tx("ledger.common.save", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
