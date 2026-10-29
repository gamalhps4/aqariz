import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { getTenantIdentityIds, tenantOwnsRecord } from "@/lib/inbox-visibility";
import type { AuthenticatedAccessUser } from "@/lib/api-utils";
import { applyScope, withScope } from "./scope-where";

/**
 * PropertyPro - Row scoping
 *
 * Isolation in this product has two tiers:
 *
 *   1. Between organizations — Postgres row-level security, stamped by the
 *      Prisma extension in ./prisma.ts. Nothing in a route can widen it.
 *   2. Within one organization — which of *its own* rows a caller may see.
 *
 * Tier 2 had no home. Forty-three route files each wrote their own version of
 *
 *     if (user.isTenant) { where.tenantId = user.id }
 *
 * eighty-nine times over, and each single-record route re-derived the matching
 * ownership check by hand. That is fine until a rule changes or a role is
 * added: adding an owner role who may see only their own buildings would mean
 * finding and correctly editing all eighty-nine.
 *
 * This module is that home. Each model gets a pair built from one shared rule,
 * so the query filter and the loaded-row check can never drift apart:
 *
 *     xxxScope(actor)        -> a Prisma `where` fragment, `{}` for staff
 *     xxxAllows(actor, row)  -> the same rule against a row already in hand
 *
 * A new role is a branch inside the rule, once per model — not an edit in
 * eighty-nine places.
 *
 * A fragment goes onto a query with `applyScope` or `withScope`, which AND it
 * on. Spreading it beside an id or a filter the request supplied lets one of
 * the two overwrite the other as soon as both name the same column.
 */

/**
 * What a scope needs to know about the caller. `AuthenticatedAccessUser`
 * satisfies this structurally, so routes pass `user` unchanged.
 */
export interface ScopeActor {
  id: string;
  isTenant: boolean;
  isOwner?: boolean;
  /**
   * The buildings an owner holds. Resolved once per request in api-utils, so
   * these functions stay synchronous. Absent means "none": an owner whose
   * portfolio failed to resolve sees an empty one, never everyone's.
   */
  ownedPropertyIds?: readonly string[];
  /**
   * The buildings a *restricted* employee may see, resolved once per request
   * in api-utils from their compound/building assignments.
   *
   * `undefined` means this caller is not restricted at all — the ordinary
   * case, and the only thing that yields an unfiltered staff query. An empty
   * array is the opposite: restricted and assigned nothing, which must show
   * nothing. Never collapse the two.
   */
  scopedPropertyIds?: readonly string[];
}

/**
 * A row-visibility rule. `restricted: false` is "no filter"; a restricted rule
 * names one foreign-key column and the ids the caller is allowed to match on.
 */
export type RowScope =
  | { restricted: false }
  | { restricted: true; field: string; ids: readonly string[] };

const UNRESTRICTED: RowScope = { restricted: false };

/**
 * Restrict a tenant to rows pointing at them; anyone else is unrestricted.
 *
 * `ids` defaults to the user id, which is what every hand-written check
 * compared against. Tickets pass the wider identity set they already used.
 */
function tenantOwn(
  actor: ScopeActor,
  field: string,
  ids?: readonly string[],
): RowScope {
  if (!actor.isTenant) return UNRESTRICTED;
  return { restricted: true, field, ids: ids ?? [actor.id] };
}

/**
 * Restrict a property owner to rows attached to a building they hold.
 *
 * Every scoped model carries `propertyId`, so the owner rule is the same shape
 * as the tenant one — a column and a list of ids — rather than a relation
 * filter that only a query could evaluate. That is what lets `xxxAllows` judge
 * an owner's access to a row already in hand, exactly as it does a tenant's.
 *
 * Where `propertyId` is nullable (tickets, expenses) a row with no building
 * simply falls outside the portfolio, which is the right answer: it is office
 * business, not this owner's.
 */
function ownerOwn(actor: ScopeActor, field = "propertyId"): RowScope | null {
  if (!actor.isOwner) return null;
  return { restricted: true, field, ids: actor.ownedPropertyIds ?? [] };
}

/**
 * Restrict an employee to the buildings assigned to them.
 *
 * Shaped exactly like the owner rule — a column and a list of ids — so the
 * `xxxAllows` half judges a loaded row without another query, and so the nine
 * models below need no per-model knowledge of what staff scoping is.
 *
 * Returns null for anyone not restricted, which is how the caller tells this
 * tier apart from "assigned nothing": null falls through to the next rule,
 * while an empty `ids` matches no rows. That asymmetry is the whole safety
 * property — see `User.scopeRestricted` for why the flag exists.
 */
function staffOwn(actor: ScopeActor, field = "propertyId"): RowScope | null {
  if (actor.scopedPropertyIds === undefined) return null;
  return { restricted: true, field, ids: actor.scopedPropertyIds };
}

/**
 * The rule for a model keyed on `propertyId`: owner first, then tenant, then
 * unrestricted for staff. Order matters only in that the two client tiers are
 * mutually exclusive; expressing it once keeps the nine models below identical
 * where they should be identical.
 */
function clientScope(
  actor: ScopeActor,
  tenantField: string,
  tenantIds?: readonly string[],
): RowScope {
  if (actor.isTenant) return tenantOwn(actor, tenantField, tenantIds);
  return ownerOwn(actor) ?? staffOwn(actor) ?? UNRESTRICTED;
}

/**
 * The rule as a Prisma `where` fragment, to be AND-ed onto a query.
 *
 * A restricted rule with no ids yields `{ field: { in: [] } }`, which matches
 * nothing — the fail-closed direction. Returning `{}` there would hand the
 * caller the whole table.
 */
function toWhere<TWhere>(scope: RowScope): TWhere {
  if (!scope.restricted) return {} as TWhere;
  return { [scope.field]: { in: [...scope.ids] } } as TWhere;
}

/**
 * What a rule's columns are called in one raw query — for payments read as
 * `p`, `{ tenantId: Prisma.sql`p."tenantId"`, propertyId: … }`.
 */
export type ScopeSqlColumns = Readonly<Record<string, Prisma.Sql>>;

/**
 * The rule as a raw SQL condition, for the few reports that aggregate in SQL,
 * where a `where` fragment cannot go. `null` is "no filter".
 *
 * Fail-closed the same way: a restricted rule with no ids, or one keyed on a
 * column the query did not map, is `FALSE` rather than a missing condition.
 */
function toSql(scope: RowScope, columns: ScopeSqlColumns): Prisma.Sql | null {
  if (!scope.restricted) return null;
  const column = columns[scope.field];
  if (!column || scope.ids.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`${column} IN (${Prisma.join([...scope.ids])})`;
}

/** The same rule against a row already loaded. */
function toPredicate(scope: RowScope, row: unknown): boolean {
  if (!scope.restricted) return true;
  const value = (row as Record<string, unknown> | null | undefined)?.[
    scope.field
  ];
  return tenantOwnsRecord(value, [...scope.ids]);
}

/** A row carrying whichever foreign key the scope keys on. */
type ScopedRow = Record<string, unknown> | null | undefined;

// The two ways a fragment goes onto a query, both of which AND it on. They
// live in ./scope-where.ts, which has no database behind it and so can be
// tested; this module is where callers import them from.
export { applyScope, withScope };

// ---------------------------------------------------------------------------
// Leases
// ---------------------------------------------------------------------------

const leaseRule = (actor: ScopeActor): RowScope =>
  clientScope(actor, "tenantId");

export function leaseScope(actor: ScopeActor): Prisma.LeaseWhereInput {
  return toWhere(leaseRule(actor));
}

export function leaseAllows(actor: ScopeActor, lease: ScopedRow): boolean {
  return toPredicate(leaseRule(actor), lease);
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

const invoiceRule = (actor: ScopeActor): RowScope =>
  clientScope(actor, "tenantId");

export function invoiceScope(actor: ScopeActor): Prisma.InvoiceWhereInput {
  return toWhere(invoiceRule(actor));
}

export function invoiceAllows(actor: ScopeActor, invoice: ScopedRow): boolean {
  return toPredicate(invoiceRule(actor), invoice);
}

/** The invoice rule for a report that reads `invoices` in raw SQL. */
export function invoiceScopeSql(
  actor: ScopeActor,
  columns: ScopeSqlColumns,
): Prisma.Sql | null {
  return toSql(invoiceRule(actor), columns);
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

const paymentRule = (actor: ScopeActor): RowScope =>
  clientScope(actor, "tenantId");

export function paymentScope(actor: ScopeActor): Prisma.PaymentWhereInput {
  return toWhere(paymentRule(actor));
}

export function paymentAllows(actor: ScopeActor, payment: ScopedRow): boolean {
  return toPredicate(paymentRule(actor), payment);
}

/** The payment rule for a report that reads `payments` in raw SQL. */
export function paymentScopeSql(
  actor: ScopeActor,
  columns: ScopeSqlColumns,
): Prisma.Sql | null {
  return toSql(paymentRule(actor), columns);
}

// ---------------------------------------------------------------------------
// Expenses
//
// Keyed on the building alone. An expense with no building is the office's
// own overhead and falls outside any portfolio (see ownerOwn), and a tenant
// has no claim on what the office spends, on their building or on any other.
//
// The reports that total expenses read through this. The expense screens
// themselves do not narrow by building yet, which is why there is no
// `expenseAllows` beside it.
// ---------------------------------------------------------------------------

const expenseRule = (actor: ScopeActor): RowScope =>
  actor.isTenant
    ? { restricted: true, field: "propertyId", ids: [] }
    : (ownerOwn(actor) ?? staffOwn(actor) ?? UNRESTRICTED);

export function expenseScope(actor: ScopeActor): Prisma.ExpenseWhereInput {
  return toWhere(expenseRule(actor));
}

/** The expense rule for a report that reads `expenses` in raw SQL. */
export function expenseScopeSql(
  actor: ScopeActor,
  columns: ScopeSqlColumns,
): Prisma.Sql | null {
  return toSql(expenseRule(actor), columns);
}

// ---------------------------------------------------------------------------
// Maintenance requests
// ---------------------------------------------------------------------------

const maintenanceRule = (actor: ScopeActor): RowScope =>
  clientScope(actor, "tenantId");

export function maintenanceScope(
  actor: ScopeActor,
): Prisma.MaintenanceRequestWhereInput {
  return toWhere(maintenanceRule(actor));
}

export function maintenanceAllows(
  actor: ScopeActor,
  request: ScopedRow,
): boolean {
  return toPredicate(maintenanceRule(actor), request);
}

/** The maintenance rule for a report that reads the requests in raw SQL. */
export function maintenanceScopeSql(
  actor: ScopeActor,
  columns: ScopeSqlColumns,
): Prisma.Sql | null {
  return toSql(maintenanceRule(actor), columns);
}

// ---------------------------------------------------------------------------
// Applications — keyed by applicant, not tenant
// ---------------------------------------------------------------------------

const applicationRule = (actor: ScopeActor): RowScope =>
  clientScope(actor, "applicantId");

export function applicationScope(
  actor: ScopeActor,
): Prisma.ApplicationWhereInput {
  return toWhere(applicationRule(actor));
}

export function applicationAllows(
  actor: ScopeActor,
  application: ScopedRow,
): boolean {
  return toPredicate(applicationRule(actor), application);
}

// ---------------------------------------------------------------------------
// Security deposits
// ---------------------------------------------------------------------------

const securityDepositRule = (actor: ScopeActor): RowScope =>
  clientScope(actor, "tenantId");

export function securityDepositScope(
  actor: ScopeActor,
): Prisma.SecurityDepositWhereInput {
  return toWhere(securityDepositRule(actor));
}

export function securityDepositAllows(
  actor: ScopeActor,
  deposit: ScopedRow,
): boolean {
  return toPredicate(securityDepositRule(actor), deposit);
}

// ---------------------------------------------------------------------------
// Inspections
// ---------------------------------------------------------------------------

const inspectionRule = (actor: ScopeActor): RowScope =>
  clientScope(actor, "tenantId");

export function inspectionScope(
  actor: ScopeActor,
): Prisma.InspectionWhereInput {
  return toWhere(inspectionRule(actor));
}

export function inspectionAllows(
  actor: ScopeActor,
  inspection: ScopedRow,
): boolean {
  return toPredicate(inspectionRule(actor), inspection);
}

// ---------------------------------------------------------------------------
// Feedback
//
// The one model keyed on authorship rather than on a building or a lease: an
// owner sees what *they* wrote, not what was written about their buildings.
// So this rule does not go through clientScope — the owner branch there keys
// on propertyId, which feedback does not have and should not.
// ---------------------------------------------------------------------------

const feedbackRule = (actor: ScopeActor): RowScope =>
  actor.isTenant || actor.isOwner
    ? { restricted: true, field: "userId", ids: [actor.id] }
    : UNRESTRICTED;

export function feedbackScope(actor: ScopeActor): Prisma.FeedbackWhereInput {
  return toWhere(feedbackRule(actor));
}

export function feedbackAllows(actor: ScopeActor, entry: ScopedRow): boolean {
  return toPredicate(feedbackRule(actor), entry);
}

// ---------------------------------------------------------------------------
// Tenant records — a tenant reaching a tenant profile or ledger
//
// Keyed on the user row's own id rather than a foreign key: the question these
// routes ask is "is this me?". Staff are unrestricted, which is where an owner
// role will later narrow to the tenants holding a lease in their buildings.
// ---------------------------------------------------------------------------

const tenantRecordRule = (actor: ScopeActor): RowScope => {
  // An owner has no business browsing tenant profiles. They see who occupies
  // their buildings through the lease rows they are entitled to, which carry
  // the tenant's name; the profile itself — ID numbers, employment, credit —
  // stays with the office. Hence an empty list rather than a portfolio filter.
  if (actor.isOwner) return { restricted: true, field: "id", ids: [] };
  return tenantOwn(actor, "id");
};

export function tenantRecordScope(actor: ScopeActor): Prisma.UserWhereInput {
  // A restricted employee reaches tenants the way a tenant reaches buildings:
  // through a lease. A tenant record carries no building of its own, so this
  // is a relation filter rather than an id list — and for the same reason
  // `tenantRecordAllows` below cannot judge it from a loaded row.
  if (!actor.isTenant && !actor.isOwner && actor.scopedPropertyIds) {
    return {
      leasesAsTenant: {
        some: {
          propertyId: { in: [...actor.scopedPropertyIds] },
          deletedAt: null,
        },
      },
    };
  }
  return toWhere(tenantRecordRule(actor));
}

/**
 * Whether a loaded tenant record is this caller's to see.
 *
 * A restricted employee's entitlement runs through a lease, which the user row
 * does not carry, so this refuses to guess for them exactly as `propertyAllows`
 * refuses for a tenant: those callers must scope in the query instead.
 */
export function tenantRecordAllows(
  actor: ScopeActor,
  tenantRecord: ScopedRow,
): boolean {
  if (!actor.isTenant && !actor.isOwner && actor.scopedPropertyIds) {
    return false;
  }
  return toPredicate(tenantRecordRule(actor), tenantRecord);
}

// ---------------------------------------------------------------------------
// Owner records — the person a building belongs to
//
// The tenant rule's counterpart, reached through the building rather than the
// lease: an employee narrowed to some buildings sees the owners of those
// buildings and no one else — not the rest of the office's clients, their
// portfolios or their bank details. An owner reaches their own record, and a
// tenant none.
//
// An owner who holds no building yet is attached to nothing a restricted
// employee holds, so they fall outside the rule, as a tenant with no contract
// does. Only a query can judge a relation, so there is no `ownerRecordAllows`.
// ---------------------------------------------------------------------------

export function ownerRecordScope(actor: ScopeActor): Prisma.UserWhereInput {
  if (actor.isTenant) return { id: { in: [] } };
  if (actor.isOwner) return { id: actor.id };
  const held = propertyScope(actor);
  if (Object.keys(held).length === 0) return {};
  return {
    propertiesOwned: { some: withScope({ deletedAt: null }, held) },
  };
}

// ---------------------------------------------------------------------------
// Tickets
//
// A ticket's tenantId may hold either the User id or the Tenant profile id
// depending on which screen raised it, so this scope keys on the wider
// identity set the inbox already resolves. Both entry points need the tenant
// profile, so it is a required argument rather than an optional one that
// silently narrows the rule when a caller forgets it.
// ---------------------------------------------------------------------------

const ticketRule = (
  actor: ScopeActor,
  identityIds: readonly string[],
): RowScope => clientScope(actor, "tenantId", identityIds);

export function ticketIdentityIds(
  user: AuthenticatedAccessUser,
  tenantProfile: unknown,
): string[] {
  return getTenantIdentityIds(user, tenantProfile);
}

export function ticketScope(
  actor: ScopeActor,
  identityIds: readonly string[],
): Prisma.TicketWhereInput {
  return toWhere(ticketRule(actor, identityIds));
}

export function ticketAllows(
  actor: ScopeActor,
  identityIds: readonly string[],
  ticket: ScopedRow,
): boolean {
  return toPredicate(ticketRule(actor, identityIds), ticket);
}

// ---------------------------------------------------------------------------
// Compounds
//
// A compound has no owner column of its own to key on and carries no
// propertyId, so — like a tenant reaching a building through a lease — its
// rule is a relation filter: you may see a compound when you may see one of
// the buildings inside it.
//
// That answers both ways an employee can reach one. Assigned the compound,
// its buildings resolve into their scope and the filter matches; assigned a
// single building inside it, they still see the compound that building sits
// in, which is what makes the building's own breadcrumb readable.
//
// Deliberately NOT keyed on `scopedCompoundIds`: that list is what was
// assigned, not what is reachable, and the two differ the moment someone is
// given a building directly.
// ---------------------------------------------------------------------------

export function compoundScope(actor: ScopeActor): Prisma.CompoundWhereInput {
  const propertyWhere = propertyScope(actor);
  if (Object.keys(propertyWhere).length === 0) return {};
  return { properties: { some: propertyWhere } };
}

// ---------------------------------------------------------------------------
// Agreements
//
// An agreement is made with an owner and names one building, one compound, or
// neither — the owner's whole portfolio. So there is no single column to key
// on, and the rule follows the three shapes:
//
//   an owner       the agreements made with them, whatever those cover;
//   an employee    narrowed to some buildings: the agreement on a building
//                  they hold, on a compound they can reach, and the blanket
//                  agreement of an owner one of whose buildings they hold —
//                  the one governing that building when nothing narrower
//                  does;
//   a tenant       none. A tenant is no party to a management agreement.
//
// The first two employee branches are the rule the archive already applies to
// deleted agreements (archive.service); the third is what it leaves out.
// ---------------------------------------------------------------------------

export function agreementScope(actor: ScopeActor): Prisma.AgreementWhereInput {
  if (actor.isTenant) return { id: { in: [] } };
  if (actor.isOwner) return { ownerId: actor.id };

  const propertyWhere = propertyScope(actor);
  if (Object.keys(propertyWhere).length === 0) return {};
  return {
    OR: [
      { property: propertyWhere },
      {
        propertyId: null,
        compound: { properties: { some: propertyWhere } },
      },
      {
        propertyId: null,
        compoundId: null,
        owner: { propertiesOwned: { some: propertyWhere } },
      },
    ],
  };
}

/** The three columns that say what an agreement covers. */
export interface AgreementReach {
  ownerId: string;
  propertyId?: string | null;
  compoundId?: string | null;
}

/** The two counts that decide whether a caller may write an agreement. */
export interface AgreementWriteCheck {
  /** The buildings it names that the caller holds. There must be one. */
  held: Prisma.PropertyWhereInput;
  /** The buildings it names that the caller does not. There must be none. */
  beyond: Prisma.PropertyWhereInput;
}

/**
 * What has to be true of an agreement's buildings before a caller may write
 * it — or null for a caller who holds everything, of whom nothing is asked.
 *
 * Reading an agreement and changing it are different entitlements. A
 * compound's agreement, or an owner's blanket one, is readable by an employee
 * who holds one building under it: it is what governs that building. But it
 * governs the others too, and terminating it — or moving it, or writing a new
 * one — changes what is charged on buildings they were never given. So a
 * write needs every building the agreement names to be one the caller holds,
 * as it stands and as it would be after the edit.
 *
 * An agreement names the owner's buildings: the one in `propertyId`, the ones
 * in `compoundId`, or with neither, all of them (agreement.service reads it
 * the same way). An owner's own agreements therefore never reach beyond that
 * owner, and pass by construction.
 */
export function agreementWriteCheck(
  actor: ScopeActor,
  agreement: AgreementReach,
): AgreementWriteCheck | null {
  const holds = propertyScope(actor);
  if (Object.keys(holds).length === 0) return null;

  const named: Prisma.PropertyWhereInput = {
    ownerId: agreement.ownerId,
    ...(agreement.propertyId ? { id: agreement.propertyId } : {}),
    ...(agreement.compoundId ? { compoundId: agreement.compoundId } : {}),
  };
  return {
    held: withScope(named, holds),
    beyond: { ...named, NOT: holds },
  };
}

// ---------------------------------------------------------------------------
// Properties
//
// The only scope that is not a foreign key on the row itself: a tenant may see
// a building because they hold a live lease in it. Expressed as a relation
// filter so it stays one query rather than a lookup followed by a check.
// ---------------------------------------------------------------------------

/** Lease states that entitle a tenant to see the property. */
export const TENANT_PROPERTY_LEASE_STATUSES = [
  "active",
  "pending",
  "renewed",
] as const;

const propertyRule = (actor: ScopeActor): RowScope | null =>
  // Keyed on the property's own id, so propertyAllows can judge a loaded row.
  // A restricted employee is narrowed here too: the buildings list *is* the
  // scope, so this is the one model where the two tiers read identically.
  actor.isTenant ? null : (ownerOwn(actor, "id") ?? staffOwn(actor, "id"));

export function propertyScope(actor: ScopeActor): Prisma.PropertyWhereInput {
  const owner = propertyRule(actor);
  if (owner) return toWhere(owner);
  if (!actor.isTenant) return {};
  return {
    leases: {
      some: {
        tenantId: actor.id,
        status: { in: [...TENANT_PROPERTY_LEASE_STATUSES] },
        deletedAt: null,
      },
    },
  };
}

/**
 * Whether a loaded property row is this caller's to see.
 *
 * Answerable from the row for an owner and for staff, restricted or not. A
 * tenant's entitlement runs through a lease, which no property row carries,
 * so this refuses to guess: callers scoping for tenants must use
 * `propertyScope` in the query.
 */
export function propertyAllows(actor: ScopeActor, property: ScopedRow): boolean {
  const rule = propertyRule(actor);
  if (rule) return toPredicate(rule, property);
  return !actor.isTenant;
}
