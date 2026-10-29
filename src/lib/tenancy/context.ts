/**
 * PropertyPro SaaS - Multi-tenancy request context
 *
 * Carries the current organization (the SaaS account) through an async call
 * stack using Node's AsyncLocalStorage. The org context is established once per
 * authenticated request in `withAccessAndDB` (see src/lib/api-utils.ts) and is
 * read by the RLS-stamping Prisma client (src/lib/db/prisma.ts) to isolate
 * every query.
 *
 * Background jobs / webhooks / migrations run with NO context and therefore
 * fail closed. Legitimate global work must wrap its operations in the explicit
 * `bypassOrgScope` boundary.
 */

import { AsyncLocalStorage } from "async_hooks";

/**
 * Thrown when tenant-scoped data is touched with no organization bound to the
 * request. Failing loudly here is the isolation contract: silence would mean
 * a query quietly ran against nothing (or, worse, everything).
 */
export class MissingOrganizationContextError extends Error {
  constructor(detail?: string) {
    super(
      detail
        ? `Organization context is required for this data operation (${detail})`
        : "Organization context is required for this data operation",
    );
    this.name = "MissingOrganizationContextError";
  }
}

export interface OrgContext {
  /** The active organization id, or null for platform-level operation. */
  organizationId: string | null;
  /** True when a platform super-admin is acting outside any single org. */
  isPlatformAdmin: boolean;
  /** When true, org scoping is fully disabled (migrations / global ops). */
  bypass?: boolean;
}

// The Prisma client is cached on `globalThis` across Next.js development hot
// reloads, so its query extension keeps whatever context module instance
// existed when it was first created. Keep the storage on `globalThis`
// as well, otherwise a reloaded route can write to a new AsyncLocalStorage
// instance while an older model hook reads from the abandoned one.
const globalForOrgContext = globalThis as typeof globalThis & {
  __propertyProOrgContextStorage?: AsyncLocalStorage<OrgContext>;
};

const storage =
  globalForOrgContext.__propertyProOrgContextStorage ??
  new AsyncLocalStorage<OrgContext>();

globalForOrgContext.__propertyProOrgContextStorage = storage;

/**
 * Run `fn` with the given organization context bound to the async stack.
 *
 * `fn` is invoked from inside our own `async` callback rather than handed to
 * `storage.run` directly. This matters when a caller passes a *synchronous*
 * arrow that returns a lazy thenable — e.g. a `PrismaPromise` from
 * `() => db.user.findFirst(...)`. Such a query is created but not executed;
 * it runs (and the RLS extension reads the context) only when it is awaited.
 * Returning it straight from `storage.run` lets that deferred execution happen
 * after the context has unwound — surfacing as
 * `MissingOrganizationContextError`. Wrapping the call in an `async` callback
 * keeps the query bound to this context.
 *
 * NOTE: this still relies on AsyncLocalStorage surviving across the awaited
 * query, which holds in route handlers but NOT during React Server Component
 * rendering. Code that runs a scoped query inside an RSC (e.g. `auth()`
 * resolving the Better Auth session server-side) must use a
 * context-independent path — see the bypass-client fetch in `auth.ts`.
 * Always returns a Promise; every caller already awaits.
 */
export function runWithOrgContext<T>(
  ctx: OrgContext,
  fn: () => T,
): Promise<Awaited<T>> {
  return storage.run(ctx, async () => await fn()) as Promise<Awaited<T>>;
}

/**
 * Bind an organization to the remainder of the current async request chain.
 * This is used after resolving a Better Auth session in routes that call `auth()`
 * directly instead of using an API wrapper.
 */
export function enterOrgContext(ctx: OrgContext): void {
  storage.enterWith(ctx);
}

/** Get the current org context, or undefined if none is bound. */
export function getOrgContext(): OrgContext | undefined {
  return storage.getStore();
}

/** Get the active organization id, throwing if there is no org bound. */
export function requireOrgId(): string {
  const ctx = storage.getStore();
  if (!ctx?.organizationId) {
    throw new Error("No organization context is available for this operation");
  }
  return ctx.organizationId;
}

/**
 * Run `fn` with org scoping disabled. Use for platform-admin queries that span
 * organizations, one-off scripts, and data migrations. Use sparingly.
 *
 * `fn` runs inside our own `async` callback so a caller passing a lazy thenable
 * (e.g. `() => Model.findOne(...)`) stays bound to the bypass while it executes;
 * see `runWithOrgContext` for why this matters (and for the React Server
 * Component caveat — RSC code must avoid scoped queries entirely). Always
 * returns a Promise; every caller already awaits.
 */
export function bypassOrgScope<T>(fn: () => T): Promise<Awaited<T>> {
  const current = storage.getStore();
  return storage.run(
    {
      organizationId: current?.organizationId ?? null,
      isPlatformAdmin: true,
      bypass: true,
    },
    async () => await fn(),
  ) as Promise<Awaited<T>>;
}

/** Whether org scoping should be skipped for the current context. */
export function shouldBypassScope(): boolean {
  const ctx = storage.getStore();
  return Boolean(ctx?.bypass || ctx?.isPlatformAdmin);
}
