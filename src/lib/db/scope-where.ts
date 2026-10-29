/**
 * PropertyPro - Putting a scope on a query
 *
 * A scope (./scopes.ts) is a `where` fragment, and a fragment is only safe to
 * spread into a query while it names different columns from the ones the
 * request supplied. That held until a rule was keyed on the row's own id. For
 * an owner, and for an employee narrowed to a few buildings, `propertyScope`
 * is `{ id: { in: [...] } }`, so
 *
 *     where: { id, ...propertyScope(user) }
 *
 * asks for *any* building the caller holds: the later key wins, the requested
 * id is gone, the lookup succeeds, and the route goes on to read or write the
 * id it was given. Spread the other way round —
 *
 *     where: { ...leaseScope(actor), propertyId }
 *
 * — it is the scope that goes, and the query string decides what is returned.
 * Over forty call sites were written one of those two ways, several of them
 * under a comment saying "intersected".
 *
 * The two functions here AND the scope on instead. Neither side can replace
 * the other, whatever each is keyed on: an id outside the scope matches
 * nothing, which is a 404 or an empty list rather than someone else's row.
 *
 * They live apart from ./scopes.ts, which is server-only and reaches the
 * database, so the rule can be pinned by tests that need neither.
 */

/** The clauses already AND-ed onto a `where`, as a list. */
function andClauses(where: object): unknown[] {
  const existing = (where as { AND?: unknown }).AND;
  return Array.isArray(existing) ? existing : existing ? [existing] : [];
}

/**
 * AND a scope onto a `where` clause, in place.
 *
 * Intersecting rather than assigning is the point. The old pattern set
 * `where.tenantId = user.id` as a plain field, so any later
 * `where.tenantId = filters.tenantId` silently replaced it. /api/leases/active
 * is written that way and did not leak, but only because its Zod schema
 * happens to strip the parameter before it reaches the assignment — an
 * accident of an unrelated file. An AND clause needs no such luck: the
 * parameter narrows to nothing instead of widening to someone else's rows.
 *
 * A no-op for an unrestricted scope, so staff queries stay untouched.
 *
 * The scope is typed against the `where` it goes onto, so a payment scope
 * cannot be put on a lease query by mistake.
 */
export function applyScope<TWhere extends object>(
  where: TWhere,
  scope: NoInfer<TWhere>,
): void {
  if (Object.keys(scope).length === 0) return;
  (where as { AND?: unknown }).AND = [...andClauses(where), scope];
}

/**
 * The same intersection as an expression, for a `where` written inline:
 *
 *     where: withScope({ id }, propertyScope(user))
 *
 * The caller's own keys stay where they were written, at the top level. That
 * is not cosmetic: the soft-delete filter in ./prisma.ts looks for `deletedAt`
 * there, so wrapping the whole clause in an AND would quietly turn a query
 * that asked for archived rows into one that excludes them.
 *
 * An unrestricted scope adds nothing, so staff queries stay as they were
 * written. A scope with an empty id list is *not* unrestricted — it is AND-ed
 * on like any other and matches nothing.
 *
 * Always a new object, never `where` itself: what comes back can be added to
 * without the change reaching the caller's own literal for some callers and
 * not for others.
 */
export function withScope<TWhere extends object>(
  where: NoInfer<TWhere>,
  scope: TWhere,
): TWhere {
  if (Object.keys(scope).length === 0) return { ...where };
  return { ...where, AND: [...andClauses(where), scope] };
}
