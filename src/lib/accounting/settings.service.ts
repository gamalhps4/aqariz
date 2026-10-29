/**
 * PropertyPro - Setting an office's books up, and how they are kept
 *
 * "Set up accounting" is safe to run any number of times: it seeds the chart
 * of accounts from the Saudi template the first time (and, later, only adds
 * an account a posting rule needs and the office lacks — see seed-plan.ts),
 * creates the settings row, and opens the office's cash, bank, POS and
 * gateway accounts on the Banks screen. Two people pressing it at once are
 * serialised by an advisory lock, so the chart is never seeded twice.
 *
 * The settings then say how the books are kept: from which day (cut-over),
 * closed through which day (the period lock), whether the office is
 * VAT-registered, who holds tenants' deposits on owners' buildings, and which
 * account does each posting job.
 */

import { db, runWithOrgTransaction, type OrgTransactionClient } from "@/lib/db/prisma";
import { requireOrgId } from "@/lib/tenancy/context";
import { Prisma } from "@/generated/prisma/client";
import { COA_TEMPLATE_VERSION } from "./coa-template";
import { computeSeedPlan } from "./seed-plan";
import {
  parseStoredAccountMap,
  resolveAccountMap,
  validateMappingTarget,
  type StoredAccountMap,
} from "./account-map";
import { isSystemKey, SYSTEM_KEYS, type SystemKey } from "./system-keys";
import { ledgerDay, today } from "./dates";
import { assertRule, ledgerError, NOT_SET_UP } from "./errors";
import { newLedgerId } from "./ids";
import type { AccountType, BankAccountKind, DepositHolder } from "./types";
import { businessDay } from "@/lib/dates/business-day";
import { AuditAction, auditSettingsChange, recordActivity } from "@/lib/audit-domain";
import { noteAuditEntry } from "@/lib/audit/scope";
import {
  ACCOUNTING_SETTINGS_KEYS,
  accountMapLines,
  accountingSettingsSnapshot,
  dayText as auditDay,
  periodChange,
  setupSnapshot,
} from "./audit-snapshots";

export interface ChartAccount {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  type: AccountType;
  normalSide: string;
  parentId: string | null;
  postable: boolean;
  systemKey: string | null;
  active: boolean;
}

const CHART_SELECT = {
  id: true,
  code: true,
  nameAr: true,
  nameEn: true,
  type: true,
  normalSide: true,
  parentId: true,
  postable: true,
  systemKey: true,
  active: true,
} as const;

type Reader = Pick<OrgTransactionClient, "ledgerAccount"> | typeof db;

export async function loadChart(client: Reader = db): Promise<ChartAccount[]> {
  const rows = await (client as typeof db).ledgerAccount.findMany({
    select: CHART_SELECT,
    orderBy: { code: "asc" },
  });
  return rows as ChartAccount[];
}

export async function getAccountingSettings() {
  return db.accountingSettings.findFirst();
}

export async function requireAccountingSettings() {
  const settings = await getAccountingSettings();
  if (!settings) throw NOT_SET_UP();
  return settings;
}

/** The account each posting job resolves to, for these settings. */
export function resolvedMap(
  settings: { accountMap: unknown } | null,
  chart: readonly ChartAccount[],
): Map<SystemKey, string> {
  return resolveAccountMap(chart, parseStoredAccountMap(settings?.accountMap));
}

function firstOfThisMonth(): Date {
  const now = today();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** The cash, bank, POS and gateway accounts every office starts with. */
const DEFAULT_BANK_KINDS: ReadonlyArray<[SystemKey, BankAccountKind]> = [
  ["cash_on_hand", "cash"],
  ["bank", "bank"],
  ["pos_clearing", "pos"],
  ["gateway_clearing", "gateway_clearing"],
];

export interface SetupInput {
  userId: string | null;
  cutOverDate?: Date | null;
  vatRegistered?: boolean;
  vatNumber?: string | null;
}

export interface SetupResult {
  createdSettings: boolean;
  accountsCreated: number;
  bankAccountsCreated: number;
}

export async function setupLedger(input: SetupInput): Promise<SetupResult> {
  const organizationId = requireOrgId();
  if (input.vatNumber) validateVatNumber(input.vatNumber);

  const result = await runWithOrgTransaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ledger-setup:${organizationId}`}))`;

    const existing = await tx.ledgerAccount.findMany({
      select: { id: true, code: true, systemKey: true, parentId: true, type: true, postable: true },
    });
    const plan = computeSeedPlan(
      existing.map((account) => ({ ...account, type: account.type as AccountType })),
    );

    // Ids first, so a new account can name a parent created in the same
    // statement (Postgres checks the foreign key at the end of it).
    const idByTemplateCode = new Map<string, string>();
    for (const item of plan) idByTemplateCode.set(item.template.code, newLedgerId());
    const idByFinalCode = new Map<string, string>();
    for (const item of plan) {
      idByFinalCode.set(item.code, idByTemplateCode.get(item.template.code)!);
    }

    if (plan.length > 0) {
      const now = new Date();
      await tx.ledgerAccount.createMany({
        data: plan.map((item) => ({
          id: idByTemplateCode.get(item.template.code)!,
          organizationId,
          code: item.code,
          nameAr: item.template.nameAr,
          nameEn: item.template.nameEn,
          type: item.template.type,
          normalSide: item.template.normalSide,
          postable: item.template.postable,
          systemKey: item.template.systemKey ?? null,
          active: true,
          parentId:
            item.parent === null
              ? null
              : item.parent.kind === "existing"
                ? item.parent.id
                : (idByFinalCode.get(item.parent.code) ??
                  idByTemplateCode.get(item.parent.code) ??
                  null),
          updatedAt: now,
        })),
      });
    }

    const current = await tx.accountingSettings.findFirst();
    let createdSettings = false;
    if (!current) {
      await tx.accountingSettings.create({
        data: {
          organizationId,
          cutOverDate: input.cutOverDate ?? firstOfThisMonth(),
          vatRegistered: input.vatRegistered ?? false,
          vatNumber: input.vatNumber?.trim() || null,
          templateVersion: COA_TEMPLATE_VERSION,
          setupAt: new Date(),
          setupById: input.userId,
        },
      });
      createdSettings = true;
    } else if (plan.length > 0) {
      await tx.accountingSettings.update({
        where: { id: current.id },
        data: { templateVersion: COA_TEMPLATE_VERSION },
      });
    }

    // The office's money accounts on the Banks screen, once each.
    const chart = await loadChart(tx);
    const map = resolveAccountMap(chart, parseStoredAccountMap(current?.accountMap));
    const linked = new Set(
      (await tx.bankAccount.findMany({ select: { ledgerAccountId: true } })).map(
        (row) => row.ledgerAccountId,
      ),
    );
    const banks = DEFAULT_BANK_KINDS.map(([key, kind]) => ({ id: map.get(key), kind })).filter(
      (row): row is { id: string; kind: BankAccountKind } => Boolean(row.id) && !linked.has(row.id!),
    );
    if (banks.length > 0) {
      const now = new Date();
      await tx.bankAccount.createMany({
        data: banks.map((row) => ({
          id: newLedgerId(),
          organizationId,
          ledgerAccountId: row.id,
          kind: row.kind,
          // Empty: the screens show the ledger account's name in the
          // reader's language until the office names it.
          name: "",
          updatedAt: now,
        })),
      });
    }

    return {
      createdSettings,
      accountsCreated: plan.length,
      bankAccountsCreated: banks.length,
    };
  });

  // Safe to repeat, so a run that added nothing is not an event — and the
  // wrapper is told not to write a basic entry for it either.
  const snapshot = setupSnapshot({
    ...result,
    cutOverDate: input.cutOverDate ?? firstOfThisMonth(),
    vatRegistered: input.vatRegistered,
    vatNumber: input.vatNumber,
  });
  if (snapshot) {
    void recordActivity({
      action: AuditAction.SETTINGS_CHANGED,
      recordType: "settings",
      recordId: "accounting",
      recordName: "accounting",
      messageKey: "admin.audit.msg.accounting_setup",
      after: snapshot,
    });
  } else {
    noteAuditEntry();
  }
  return result;
}

/** A Saudi VAT number: 15 digits, beginning and ending with 3. */
export function validateVatNumber(value: string): void {
  if (!/^3\d{13}3$/.test(value.trim())) {
    throw ledgerError(
      "LEDGER_VAT_NUMBER_INVALID",
      "A VAT number is 15 digits and begins and ends with 3",
    );
  }
}

export interface SettingsPatch {
  cutOverDate?: Date | null;
  vatRegistered?: boolean;
  vatNumber?: string | null;
  depositHolder?: DepositHolder;
  /** Key → account id; null or "" puts a key back on its own account. */
  accountMap?: Partial<Record<string, string | null>>;
}

export async function updateAccountingSettings(patch: SettingsPatch): Promise<void> {
  const settings = await requireAccountingSettings();
  const data: Prisma.AccountingSettingsUpdateInput = {};
  // The posting accounts the office chose, before and after — read only when
  // the save touches the map, which is when the chart is loaded anyway.
  let mapBefore: string[] = [];
  let mapAfter: string[] = [];

  if (patch.cutOverDate !== undefined) {
    const next = patch.cutOverDate ? ledgerDay(patch.cutOverDate) : null;
    const changed =
      (next?.getTime() ?? null) !== (settings.cutOverDate?.getTime() ?? null);
    if (changed) {
      const anyEntry = await db.journalEntry.findFirst({ select: { id: true } });
      if (anyEntry) {
        throw ledgerError(
          "LEDGER_CUTOVER_LOCKED",
          "The cut-over date cannot change once the books have entries",
          409,
        );
      }
      if (!next) {
        throw ledgerError("LEDGER_CUTOVER_REQUIRED", "Choose a cut-over date");
      }
      data.cutOverDate = next;
    }
  }
  if (patch.vatRegistered !== undefined) data.vatRegistered = patch.vatRegistered;
  if (patch.vatNumber !== undefined) {
    const value = patch.vatNumber?.trim() || null;
    if (value) validateVatNumber(value);
    data.vatNumber = value;
  }
  if (patch.depositHolder !== undefined) {
    if (patch.depositHolder !== "owner" && patch.depositHolder !== "office") {
      throw ledgerError("LEDGER_DEPOSIT_HOLDER_INVALID", "Choose who holds deposits");
    }
    data.depositHolder = patch.depositHolder;
  }

  if (patch.accountMap) {
    const chart = await loadChart();
    const byId = new Map(chart.map((account) => [account.id, account]));
    const stored: StoredAccountMap = parseStoredAccountMap(settings.accountMap);
    mapBefore = accountMapLines(stored, chart);
    for (const [key, accountId] of Object.entries(patch.accountMap)) {
      if (!isSystemKey(key)) {
        throw ledgerError("LEDGER_MAP_KEY_INVALID", `Unknown posting job "${key}"`);
      }
      if (!accountId) {
        delete stored[key];
        continue;
      }
      assertRule(validateMappingTarget(key, byId.get(accountId)), 400);
      const own = chart.find((account) => account.systemKey === key);
      // Pointing a key back at its own account is the same as no choice.
      if (own?.id === accountId) delete stored[key];
      else stored[key] = accountId;
    }
    data.accountMap = stored as Prisma.InputJsonValue;
    mapAfter = accountMapLines(stored, chart);
  }

  if (Object.keys(data).length > 0) {
    await db.accountingSettings.update({ where: { id: settings.id }, data });
  }

  // What moved, and only that; a save that moves nothing records nothing.
  const written = data as Partial<typeof settings>;
  auditSettingsChange({
    area: "accounting",
    before: accountingSettingsSnapshot(settings, mapBefore),
    after: accountingSettingsSnapshot(
      {
        cutOverDate: written.cutOverDate !== undefined ? written.cutOverDate : settings.cutOverDate,
        vatRegistered: written.vatRegistered !== undefined ? written.vatRegistered : settings.vatRegistered,
        vatNumber: written.vatNumber !== undefined ? written.vatNumber : settings.vatNumber,
        depositHolder: written.depositHolder !== undefined ? written.depositHolder : settings.depositHolder,
      },
      mapAfter,
    ),
    keys: ACCOUNTING_SETTINGS_KEYS,
  });
}

/** Close the books through a day, or reopen them (null). */
export async function setClosedThrough(day: Date | null): Promise<void> {
  const settings = await requireAccountingSettings();
  if (day) {
    const closing = ledgerDay(day);
    if (closing.getTime() >= today().getTime()) {
      throw ledgerError(
        "LEDGER_CLOSE_FUTURE",
        "A period can only be closed through a day that has passed",
      );
    }
    await db.accountingSettings.update({
      where: { id: settings.id },
      data: { closedThrough: closing },
    });
    auditPeriodLock(settings, closing);
    return;
  }
  await db.accountingSettings.update({
    where: { id: settings.id },
    data: { closedThrough: null },
  });
  auditPeriodLock(settings, null);
}

/**
 * The entry for a move of the period lock: closing weighs a little, lifting it
 * (all of it, or back to an earlier day) a lot — that is what lets the books be
 * changed again. Closing through the day it is already closed through is not a
 * move.
 */
function auditPeriodLock(settings: { id: string; closedThrough: Date | null }, after: Date | null): void {
  const change = periodChange(settings.closedThrough, after);
  if (change.move === "unchanged" || !change.messageKey) {
    noteAuditEntry();
    return;
  }
  void recordActivity({
    action: AuditAction.UPDATE,
    recordType: "accounting_period",
    recordId: settings.id,
    severity: change.severity,
    messageKey: change.messageKey,
    messageParams: { date: change.date },
    before: { closedThrough: auditDay(settings.closedThrough) },
    after: { closedThrough: auditDay(after) },
  });
}

export interface SettingsView {
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
  map: Array<{
    key: SystemKey;
    accountId: string | null;
    chosen: boolean;
  }>;
}

const dayText = (value: Date | null | undefined) =>
  value ? businessDay(value) : null;

export async function settingsView(): Promise<SettingsView> {
  const [settings, chart, entryCount] = await Promise.all([
    getAccountingSettings(),
    loadChart(),
    db.journalEntry.count(),
  ]);
  const stored = parseStoredAccountMap(settings?.accountMap);
  const map = resolveAccountMap(chart, stored);
  return {
    isSetUp: Boolean(settings),
    settings: settings
      ? {
          cutOverDate: dayText(settings.cutOverDate),
          closedThrough: dayText(settings.closedThrough),
          vatRegistered: settings.vatRegistered,
          vatNumber: settings.vatNumber,
          basis: settings.basis,
          depositHolder: settings.depositHolder === "office" ? "office" : "owner",
          setupAt: settings.setupAt?.toISOString() ?? null,
          lastSweepAt: settings.lastSweepAt?.toISOString() ?? null,
          templateVersion: settings.templateVersion,
        }
      : null,
    accountCount: chart.length,
    entryCount,
    map: SYSTEM_KEYS.map((key) => ({
      key,
      accountId: map.get(key) ?? null,
      chosen: Boolean(stored[key] && map.get(key) === stored[key]),
    })),
  };
}
