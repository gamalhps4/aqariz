/**
 * PropertyPro SaaS - Prisma client with Postgres row-level security.
 *
 * Tenant isolation moved from a Mongoose query plugin into the database
 * itself: every org-scoped table carries RLS policies keyed on two
 * transaction-local settings, `app.current_org_id` and `app.bypass_rls`
 * (see prisma/migrations/...rls). The client below reads the SAME
 * AsyncLocalStorage request context the app has always used
 * (src/lib/tenancy/context.ts) and stamps those settings around every query,
 * so `runWithOrgContext` / `bypassOrgScope` keep working unchanged.
 *
 * Three clients, one database connection pool:
 *
 *   db      — what application code uses. Reads the org context, fails loudly
 *             when tenant data is touched with no context bound, auto-filters
 *             soft-deleted rows on list reads, and lets Postgres RLS enforce
 *             isolation even if a query forgets a where-clause.
 *
 *   authDb  — what Better Auth and the credential helpers use. Always runs
 *             with `app.bypass_rls = on`: sign-in resolves users by bare
 *             email across every organization by design, and the sign-in gate
 *             in better-auth.ts is what stands guard on that path.
 *
 *   basePrisma / runWithOrgTransaction — for multi-statement atomicity.
 *             The per-query extension cannot nest transactions, so flows that
 *             need one (provisioning, payment settlement) open it here; the
 *             helper stamps the RLS settings once at the start.
 *
 * FAIL-CLOSED, twice over: with no context the client throws before the query
 * leaves the process; if a path sidesteps the client, the policies see an
 * empty `app.current_org_id` and match zero rows.
 */

import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  getOrgContext,
  MissingOrganizationContextError,
} from "@/lib/tenancy/context";

const connectionString = process.env.DATABASE_URL;

declare global {
  // eslint-disable-next-line no-var
  var _prismaBase: PrismaClient | undefined;
}

/** Read a tuning knob, falling back on anything that is not a real number —
 * an unset var and a `DATABASE_POOL_MAX=` line in an env file both mean
 * "leave it alone", and `Number("")` would otherwise silently size the pool
 * at zero. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Pool and transaction budgets.
 *
 * The RLS extension below gives every individual query its own transaction, so
 * a handler that fans out with `Promise.all` needs one pooled connection PER
 * QUERY, all at the same moment — not one for the request. The platform
 * console routes fan out six wide and the console loads several of them at
 * once, so peak demand is comfortably past `pg`'s default of 10 connections.
 * When the pool cannot supply one in time Prisma gives up and throws P2028,
 * "Unable to start a transaction in the given time".
 *
 * Round-trip latency is what turns that from a queue into a failure. Each
 * stamped query costs four round trips (BEGIN, the set_config, the query,
 * COMMIT) and opening a fresh connection costs roughly five more, so against a
 * database ~200ms away a cold six-query handler spends seconds on connection
 * setup alone — past the 2s default `maxWait` before it reads a single row.
 * Keeping `min` connections out of the idle reaper means only the first
 * request pays that, and the budgets below let a genuine burst queue rather
 * than fail.
 *
 * Every value is env-tunable: a database on localhost needs none of this
 * headroom, and `DATABASE_POOL_MAX` × app instances has to stay under the
 * server's `max_connections`.
 */
const POOL_MAX = envInt("DATABASE_POOL_MAX", 20);
const POOL_MIN = envInt("DATABASE_POOL_MIN", 4);
const POOL_IDLE_MS = envInt("DATABASE_POOL_IDLE_MS", 60_000);
const TX_MAX_WAIT_MS = envInt("DATABASE_TX_MAX_WAIT_MS", 15_000);
const TX_TIMEOUT_MS = envInt("DATABASE_TX_TIMEOUT_MS", 20_000);

function createBaseClient(): PrismaClient {
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Point it at the PropertyPro Postgres database.",
    );
  }
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: POOL_MAX,
      // `min` holds this many connections back from the idle reaper. Without
      // it the pool empties during any ordinary lull — a dev server between
      // page loads, a quiet minute in production — and the next request pays
      // a full handshake for every query it fans out.
      min: POOL_MIN,
      idleTimeoutMillis: POOL_IDLE_MS,
      connectionTimeoutMillis: 20_000,
      // Long-haul links drop idle sockets without telling either end. TCP
      // keepalives stop the pool handing out a connection that is already
      // dead, which otherwise surfaces as one arbitrary query failing.
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    }),
    // Governs the per-query batch transactions above as well as the
    // interactive ones in `runWithOrgTransaction`, where Prisma's 5s default
    // `timeout` is thin for a multi-statement flow at 200ms a statement.
    transactionOptions: {
      maxWait: TX_MAX_WAIT_MS,
      timeout: TX_TIMEOUT_MS,
    },
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
    // The payment number (receipt voucher number) is read only where it is
    // shown, by asking for it — `select: { number: true }` or `omit: {
    // number: false }`, see src/lib/payments/payment-number.ts. Left in every
    // read, it would make each payment query fail on a database the
    // 20261003100001_payment_numbers migration has not reached yet, and a
    // read row copied into a new one would carry a number that is not its
    // own.
    //
    // Accounting phase 0's invoice and expense columns stay out of reads the
    // same way until their screens ask for them (src/lib/invoice/
    // phase0-columns.ts): migration 20261004121500_accounting_phase0 adds them.
    omit: {
      // The gateway reference pair (migration
      // 20261004140000_payment_gateway_reference) the same way: see
      // src/lib/payments/gateway-columns.ts.
      payment: { number: true, gatewayProvider: true, gatewayPaymentId: true },
      invoice: {
        documentType: true,
        originalInvoiceId: true,
        creditedAmount: true,
        customerType: true,
        customerUserId: true,
        customerName: true,
        customerVatNumber: true,
        customerAddress: true,
      },
      expense: {
        vatAmount: true,
        vatCategory: true,
        supplierId: true,
        supplierInvoiceNumber: true,
      },
      // The supplier's contact, bank details and payment terms (migration
      // 20261004190000_purchases): the purchases screens ask for them, see
      // src/lib/accounting/purchases/availability.ts.
      supplier: {
        contactName: true,
        email: true,
        address: true,
        city: true,
        crNumber: true,
        bankName: true,
        iban: true,
        paymentTermsDays: true,
        notes: true,
      },
      // The office that claimed a webhook event (migration
      // 20261004220000_webhook_events_by_organization): written by
      // src/lib/payments/webhook-claims.ts once the column exists.
      webhookEvent: { organizationId: true },
      // The landing page's Arabic overlay and custom sections, and the plan
      // cards' Arabic (migration 20261017120000_landing_arabic_and_custom_
      // sections): read through src/lib/marketing/translation-columns.ts
      // once the columns exist. Plans are read by every entitlement check,
      // so a read naming a missing column would take far more than the
      // pricing page down.
      landingPage: { translations: true, customSections: true },
      plan: { translations: true },
    },
  });
}

/** The raw client. Prefer `db`/`authDb`; use this only via the tx helper. */
export const basePrisma: PrismaClient =
  global._prismaBase ?? (global._prismaBase = createBaseClient());

/**
 * Models that live inside an organization. Reads/writes on these require an
 * org context (or an explicit bypass) — the same set the Mongoose
 * org-scope plugin covered, minus the models retired in the settings
 * consolidation. Names are Prisma model names.
 */
const ORG_SCOPED_MODELS = new Set<string>([
  "User",
  "Session",
  "Role",
  "Tenant",
  "Owner",
  "Agreement",
  "ClientCommunication",
  // SMS/WhatsApp log (migration 20261004113500_messaging).
  "MessageLog",
  "Feedback",
  "Compound",
  "PropertyCategory",
  "Property",
  "Unit",
  "Lease",
  "Application",
  "Listing",
  "ListingInquiry",
  "InvitationToken",
  "Invoice",
  // Accounting phase 0 (migration 20261004121500_accounting_phase0).
  "InvoiceLine",
  "Payment",
  "PaymentNumberCounter",
  "PaymentReceipt",
  "PaymentNotification",
  "RecurringPayment",
  "SecurityDeposit",
  "Expense",
  "Supplier",
  "MaintenanceRequest",
  "WorkOrder",
  "Ticket",
  "Inspection",
  "Document",
  "DocumentTemplate",
  "Conversation",
  "Message",
  "MessageStatus",
  "Event",
  "EventInvitation",
  "EventReminder",
  "CalendarSettings",
  "Announcement",
  "Notification",
  "PushSubscription",
  "AuditLog",
  "PropertyStatusAuditLog",
  "SystemSettings",
  "ProfileSettings",
  "DisplaySettings",
  "WebhookEvent",
  // The ledger (migration 20261003170001_ledger).
  "LedgerAccount",
  "JournalEntry",
  "JournalLine",
  "AccountingSettings",
  "BankAccount",
  "BankTransfer",
  "OwnerSettlement",
  "OwnerPayout",
  // Purchases and payments (migration 20261004190000_purchases).
  "PurchaseBill",
  "PurchaseBillLine",
  "PaymentVoucher",
  "PaymentVoucherAllocation",
  "BankReconciledLine",
]);

/**
 * Models with soft deletion (`deletedAt`). List reads through `db`
 * automatically exclude soft-deleted rows unless the call opts in by naming
 * `deletedAt` in its own where clause. NOTE: `findUnique`/`update`/`delete`
 * take unique inputs and cannot be filtered here — fetch by id with
 * `findFirst({ where: { id } })` when soft-delete visibility matters.
 */
const SOFT_DELETE_MODELS = new Set<string>([
  "User",
  "Tenant",
  "Owner",
  "Agreement",
  "ClientCommunication",
  "Feedback",
  "Compound",
  "PropertyCategory",
  "Property",
  "Unit",
  "Lease",
  "Application",
  "Invoice",
  "Payment",
  "RecurringPayment",
  "SecurityDeposit",
  "Expense",
  "Supplier",
  "MaintenanceRequest",
  "WorkOrder",
  "Ticket",
  "Inspection",
  "Document",
  "DocumentTemplate",
  "Organization",
]);

// The registries above are keyed by Prisma model NAME strings, which nothing
// checks at compile time — a renamed model silently turns its fail-loud guard
// into a no-op. Verify every entry against the generated client on boot
// (outside production, so a schema/registry mismatch fails the dev server and
// the test run, never a live request).
if (process.env.NODE_ENV !== "production") {
  const registered = [...ORG_SCOPED_MODELS, ...SOFT_DELETE_MODELS];
  for (const model of registered) {
    const property = model.charAt(0).toLowerCase() + model.slice(1);
    if (!(property in basePrisma)) {
      throw new Error(
        `Model registry drift in src/lib/db/prisma.ts: "${model}" is not a ` +
          `Prisma model. Update ORG_SCOPED_MODELS / SOFT_DELETE_MODELS to ` +
          `match prisma/schema.prisma.`,
      );
    }
  }
}

const SOFT_DELETE_LIST_OPS = new Set<string>([
  "findMany",
  "findFirst",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
]);

type QueryArgs = { where?: Record<string, unknown> } & Record<string, unknown>;

function withSoftDeleteFilter(model: string, operation: string, args: QueryArgs) {
  if (!SOFT_DELETE_MODELS.has(model)) return args;
  if (!SOFT_DELETE_LIST_OPS.has(operation)) return args;
  const where = (args.where ?? {}) as Record<string, unknown>;
  if ("deletedAt" in where) return args; // caller opted in explicitly
  return { ...args, where: { ...where, deletedAt: null } };
}

/**
 * Result extensions only run on model rows, so `aggregate`/`groupBy` outputs
 * still carry Prisma.Decimal — whose valueOf() is a STRING, so `+` on a
 * `_sum.amount` concatenates instead of adding. Convert them here, in the
 * query extension that already intercepts every operation.
 */
function decimalsToNumbers(value: unknown): unknown {
  if (value == null) return value;
  if (Prisma.Decimal.isDecimal(value)) return Number(value);
  if (Array.isArray(value)) return value.map(decimalsToNumbers);
  if (typeof value === "object") {
    if (value instanceof Date) return value;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = decimalsToNumbers(entry);
    }
    return out;
  }
  return value;
}

const AGGREGATE_OPS = new Set<string>(["aggregate", "groupBy"]);

interface RlsSettings {
  orgId: string;
  bypass: boolean;
}

function resolveRlsSettings(model: string, operation: string): RlsSettings {
  const ctx = getOrgContext();
  const bypass = Boolean(ctx?.bypass || ctx?.isPlatformAdmin);

  if (!bypass && !ctx?.organizationId && ORG_SCOPED_MODELS.has(model)) {
    // Fail loudly in-process; even if this throw were removed, the RLS
    // policies would still match zero rows for an empty org setting.
    throw new MissingOrganizationContextError(`${model}.${operation}`);
  }

  return { orgId: ctx?.organizationId ?? "", bypass };
}

function rlsExtension(forceBypass: boolean) {
  return Prisma.defineExtension((client) => {
    // Raw queries carry no model name, so there is nothing to fail loudly
    // about here — the settings are stamped and RLS itself stays the
    // fail-closed backstop (no context ⇒ policies match zero rows).
    const rawOperation = async ({
      args,
      query,
    }: {
      args: unknown;
      query: (a: unknown) => Prisma.PrismaPromise<unknown>;
    }) => {
      const ctx = getOrgContext();
      const bypass = forceBypass || Boolean(ctx?.bypass || ctx?.isPlatformAdmin);
      const orgId = ctx?.organizationId ?? "";
      const [, result] = await client.$transaction([
        client.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, TRUE), set_config('app.bypass_rls', ${bypass ? "on" : "off"}, TRUE)`,
        query(args),
      ]);
      return result;
    };

    return client.$extends({
      query: {
        $queryRaw: rawOperation,
        $queryRawUnsafe: rawOperation,
        $executeRaw: rawOperation,
        $executeRawUnsafe: rawOperation,
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const settings = forceBypass
              ? { orgId: "", bypass: true }
              : resolveRlsSettings(model, operation);

            const finalArgs = withSoftDeleteFilter(
              model,
              operation,
              (args ?? {}) as QueryArgs,
            );

            // Batch transaction: set_config(..., true) is transaction-local,
            // so the settings apply to exactly this query and evaporate with
            // the transaction — no connection-pool bleed between tenants.
            const [, result] = await client.$transaction([
              client.$executeRaw`SELECT set_config('app.current_org_id', ${settings.orgId}, TRUE), set_config('app.bypass_rls', ${settings.bypass ? "on" : "off"}, TRUE)`,
              (query as (a: unknown) => Prisma.PrismaPromise<unknown>)(
                finalArgs,
              ),
            ]);
            return AGGREGATE_OPS.has(operation)
              ? decimalsToNumbers(result)
              : result;
          },
        },
      },
    });
  });
}

/**
 * Maps Decimal fields to number — the shape model rows actually have after
 * the money extension below. Use for annotations that previously used the
 * generated model types (e.g. `MoneyAsNumber<Invoice>`).
 */
export type MoneyAsNumber<T> = {
  [K in keyof T]: T[K] extends Prisma.Decimal
    ? number
    : T[K] extends Prisma.Decimal | null
      ? number | null
      : T[K];
};

/** Decimal → number for money reads. */
function asMoney(value: Prisma.Decimal): number {
  return Number(value);
}

/** Decimal → number for nullable money reads. */
export function asMoneyNullable(
  value: Prisma.Decimal | number | null | undefined,
): number | null {
  return value == null ? null : Number(value);
}

/**
 * Money columns are stored as Postgres numeric(14,2) — exact, no float drift —
 * but the whole app (services, API JSON, UI) works in JS numbers. These
 * computed fields convert every money Decimal to number on read, so callers
 * of `db`/`authDb` never see a Decimal. Writes need no conversion: Prisma
 * accepts plain numbers into Decimal inputs and Postgres rounds to 2dp.
 *
 * `aggregate`/`groupBy` results through `db`/`authDb` are converted too (see
 * decimalsToNumbers in the query extension), though their generated TS types
 * still say Decimal. NOT covered (Decimal still surfaces): raw queries (cast
 * `::float` in SQL) and reads inside `runWithOrgTransaction` (plain tx
 * client) — convert with Number()/asMoneyNullable at those call sites.
 */
const moneyExtension = Prisma.defineExtension({
  result: {
    plan: {
      monthlyPrice: {
        needs: { monthlyPrice: true },
        compute: (row) => asMoney(row.monthlyPrice),
      },
      yearlyPrice: {
        needs: { yearlyPrice: true },
        compute: (row) => asMoneyNullable(row.yearlyPrice),
      },
      // A percentage rather than money, but still a Decimal: without this it
      // reached callers as a Prisma.Decimal while `MoneyAsNumber<Plan>` said
      // number, so annual-price arithmetic concatenated instead of adding.
      yearlyDiscountPercent: {
        needs: { yearlyDiscountPercent: true },
        compute: (row) => asMoney(row.yearlyDiscountPercent),
      },
    },
    organization: {
      subscriptionAmount: {
        needs: { subscriptionAmount: true },
        compute: (row) => asMoneyNullable(row.subscriptionAmount),
      },
    },
    unit: {
      rentAmount: {
        needs: { rentAmount: true },
        compute: (row) => asMoney(row.rentAmount),
      },
      securityDeposit: {
        needs: { securityDeposit: true },
        compute: (row) => asMoney(row.securityDeposit),
      },
    },
    listing: {
      price: {
        needs: { price: true },
        compute: (row) => asMoney(row.price),
      },
    },
    lease: {
      rentAmount: {
        needs: { rentAmount: true },
        compute: (row) => asMoney(row.rentAmount),
      },
      contractAmount: {
        needs: { contractAmount: true },
        compute: (row) => asMoneyNullable(row.contractAmount),
      },
      securityDepositAmount: {
        needs: { securityDepositAmount: true },
        compute: (row) => asMoney(row.securityDepositAmount),
      },
      electricityAmount: {
        needs: { electricityAmount: true },
        compute: (row) => asMoney(row.electricityAmount),
      },
      waterAmount: {
        needs: { waterAmount: true },
        compute: (row) => asMoney(row.waterAmount),
      },
      // Not money, but a Decimal all the same: without this the column
      // reaches callers as a Prisma.Decimal while `MoneyAsNumber<Lease>`
      // claims it is a number, and arithmetic on it silently concatenates.
      taxRate: {
        needs: { taxRate: true },
        compute: (row) => asMoney(row.taxRate),
      },
    },
    agreement: {
      // feeAmount is money; feePercentage is a rate — both are Decimals, and
      // both must reach callers as numbers or the commission engine's
      // arithmetic silently concatenates instead of adding.
      feeAmount: {
        needs: { feeAmount: true },
        compute: (row) => asMoney(row.feeAmount),
      },
      feePercentage: {
        needs: { feePercentage: true },
        compute: (row) => asMoney(row.feePercentage),
      },
    },
    invoice: {
      subtotal: {
        needs: { subtotal: true },
        compute: (row) => asMoney(row.subtotal),
      },
      taxAmount: {
        needs: { taxAmount: true },
        compute: (row) => asMoney(row.taxAmount),
      },
      discountAmount: {
        needs: { discountAmount: true },
        compute: (row) => asMoney(row.discountAmount),
      },
      totalAmount: {
        needs: { totalAmount: true },
        compute: (row) => asMoney(row.totalAmount),
      },
      amountPaid: {
        needs: { amountPaid: true },
        compute: (row) => asMoney(row.amountPaid),
      },
      balanceRemaining: {
        needs: { balanceRemaining: true },
        compute: (row) => asMoney(row.balanceRemaining),
      },
      lateFeeAmount: {
        needs: { lateFeeAmount: true },
        compute: (row) => asMoney(row.lateFeeAmount),
      },
    },
    payment: {
      amount: {
        needs: { amount: true },
        compute: (row) => asMoney(row.amount),
      },
      amountPaid: {
        needs: { amountPaid: true },
        compute: (row) => asMoney(row.amountPaid),
      },
      lateFeeApplied: {
        needs: { lateFeeApplied: true },
        compute: (row) => asMoney(row.lateFeeApplied),
      },
    },
    paymentReceipt: {
      amount: {
        needs: { amount: true },
        compute: (row) => asMoney(row.amount),
      },
    },
    recurringPayment: {
      amount: {
        needs: { amount: true },
        compute: (row) => asMoney(row.amount),
      },
    },
    securityDeposit: {
      amount: {
        needs: { amount: true },
        compute: (row) => asMoney(row.amount),
      },
      refundAmount: {
        needs: { refundAmount: true },
        compute: (row) => asMoneyNullable(row.refundAmount),
      },
    },
    expense: {
      amount: {
        needs: { amount: true },
        compute: (row) => asMoney(row.amount),
      },
    },
    maintenanceRequest: {
      estimatedCost: {
        needs: { estimatedCost: true },
        compute: (row) => asMoneyNullable(row.estimatedCost),
      },
      actualCost: {
        needs: { actualCost: true },
        compute: (row) => asMoneyNullable(row.actualCost),
      },
    },
    workOrder: {
      estimatedCost: {
        needs: { estimatedCost: true },
        compute: (row) => asMoneyNullable(row.estimatedCost),
      },
      actualCost: {
        needs: { actualCost: true },
        compute: (row) => asMoneyNullable(row.actualCost),
      },
    },
    // The ledger's money (migration 20261003170001_ledger), numbers like
    // every other money column. The posting service itself works in halalas
    // (lib/accounting/money.ts) and converts at the edge.
    journalEntry: {
      totalAmount: {
        needs: { totalAmount: true },
        compute: (row) => asMoney(row.totalAmount),
      },
    },
    journalLine: {
      debit: {
        needs: { debit: true },
        compute: (row) => asMoney(row.debit),
      },
      credit: {
        needs: { credit: true },
        compute: (row) => asMoney(row.credit),
      },
    },
    bankTransfer: {
      amount: {
        needs: { amount: true },
        compute: (row) => asMoney(row.amount),
      },
    },
    ownerSettlement: {
      collected: {
        needs: { collected: true },
        compute: (row) => asMoney(row.collected),
      },
      ownerReceivedDirect: {
        needs: { ownerReceivedDirect: true },
        compute: (row) => asMoney(row.ownerReceivedDirect),
      },
      commission: {
        needs: { commission: true },
        compute: (row) => asMoney(row.commission),
      },
      commissionVat: {
        needs: { commissionVat: true },
        compute: (row) => asMoney(row.commissionVat),
      },
      expenses: {
        needs: { expenses: true },
        compute: (row) => asMoney(row.expenses),
      },
      investmentRent: {
        needs: { investmentRent: true },
        compute: (row) => asMoney(row.investmentRent),
      },
      netDue: {
        needs: { netDue: true },
        compute: (row) => asMoney(row.netDue),
      },
    },
    ownerPayout: {
      amount: {
        needs: { amount: true },
        compute: (row) => asMoney(row.amount),
      },
    },
  },
});

/** Org-aware client for application code. */
export const db = basePrisma.$extends(rlsExtension(false)).$extends(moneyExtension);

/** Bypass client for Better Auth and credential plumbing. */
export const authDb = basePrisma.$extends(rlsExtension(true)).$extends(moneyExtension);

/**
 * Transactions run off this client so money fields come back as numbers
 * inside `runWithOrgTransaction` too. The RLS query extension deliberately
 * stays off (it would nest transactions); the result extension is safe.
 */
const moneyBase = basePrisma.$extends(moneyExtension);

export type OrgTransactionClient = Omit<
  typeof moneyBase,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Run several statements atomically under the current org context (or an
 * explicit bypass). The callback receives a plain transaction client —
 * without the per-query extension, so soft-delete filtering must be written
 * out by hand inside.
 */
export async function runWithOrgTransaction<T>(
  fn: (tx: OrgTransactionClient) => Promise<T>,
  options?: { bypass?: boolean },
): Promise<T> {
  const ctx = getOrgContext();
  const bypass = Boolean(options?.bypass || ctx?.bypass || ctx?.isPlatformAdmin);
  const orgId = ctx?.organizationId ?? "";

  if (!bypass && !orgId) {
    throw new MissingOrganizationContextError("transaction");
  }

  return moneyBase.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, TRUE), set_config('app.bypass_rls', ${bypass ? "on" : "off"}, TRUE)`;
    return fn(tx);
  });
}

export type Db = typeof db;
