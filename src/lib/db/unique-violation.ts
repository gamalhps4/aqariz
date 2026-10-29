/**
 * PropertyPro - Which unique constraint a failed write ran into
 *
 * Writers that allocate a number and let the database arbitrate (invoice
 * numbers, one invoice per billing period) have to tell their collisions
 * apart: a taken number means "try the next one", a taken period means
 * "already billed, skip".
 *
 * Prisma reports that in three shapes, and only the first was ever read:
 *
 *  1. The query engine named the constraint in `meta.target`.
 *  2. A driver adapter — what this app runs on — leaves `target` out and
 *     passes on the columns it parsed from the DETAIL line of the database's
 *     error, under `meta.driverAdapterError.cause.constraint`.
 *  3. Under row-level security Postgres withholds that DETAIL line (it would
 *     show key values the role may not be allowed to see), so the adapter has
 *     no columns to pass: `constraint` is undefined and Prisma's own message
 *     reads "Unique constraint failed on the (not available)". This is the
 *     shape the real database produces — every org-scoped table is under
 *     FORCE ROW LEVEL SECURITY. What survives is the database's original
 *     message, which names the constraint:
 *     `duplicate key value violates unique constraint
 *     "invoices_organizationId_invoiceNumber_key"`.
 *
 * Reading `target` alone saw nothing in shapes 2 and 3: every collision
 * looked unknown and was rethrown, so a taken invoice number was never
 * retried and a period billed by a concurrent run was an error, not a skip.
 *
 * Duck-typed on purpose, with no Prisma import: the rule is about the shape
 * of an error, and this way it is testable without a client.
 */

interface UniqueViolationMeta {
  target?: unknown;
  driverAdapterError?: {
    cause?: {
      originalMessage?: unknown;
      constraint?: { fields?: unknown; index?: unknown };
    };
  };
}

function text(value: unknown): string {
  if (Array.isArray(value)) return value.join(",");
  return typeof value === "string" ? value : "";
}

/**
 * Everything a P2002 says about what it collided with — column names, the
 * index name, the database's own message — as one string to search, or ""
 * when the error is not a unique violation at all.
 *
 * The sources are joined rather than the first one taken: whichever of them
 * the stack at hand fills in, the constraint's name or columns are in the
 * result. A violation concerns one constraint, so they never disagree.
 */
export function uniqueViolationTarget(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const { code, meta, message } = error as {
    code?: unknown;
    meta?: UniqueViolationMeta;
    message?: unknown;
  };
  if (code !== "P2002") return "";

  const cause = meta?.driverAdapterError?.cause;
  const named = [
    text(meta?.target),
    text(cause?.constraint?.fields),
    text(cause?.constraint?.index),
    text(cause?.originalMessage),
  ]
    .filter(Boolean)
    .join(" | ");
  if (named) return named;

  // Nothing structured at all: the error line of Prisma's own message. Only
  // its last line — above it, in development, sits a frame of the calling
  // code, whose identifiers must not be mistaken for a constraint.
  const lines = text(message)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

/**
 * The constraints a person can run into from a form, and what to tell them.
 * Each is recognised by its columns or by its index name, whichever the error
 * carries. Checked in order: the billing-period index belongs to `invoices`
 * too, so it has to be told apart from the invoice number before the number
 * is looked for.
 */
const DUPLICATE_MESSAGES: ReadonlyArray<{
  names: readonly string[];
  message: string;
}> = [
  {
    names: ["leases_one_active_per_unit"],
    message: "Another active contract already holds this unit",
  },
  {
    names: ["contractNumber", "contract_number"],
    message: "Another contract already uses this contract number",
  },
  {
    names: ["invoices_period_per_lease", "periodStart"],
    message: "This period of the contract is already billed",
  },
  {
    names: ["invoiceNumber"],
    message: "This invoice number is already in use",
  },
  {
    names: ["receiptNumber"],
    message: "This receipt number is already in use",
  },
  {
    names: ["expenseNumber"],
    message: "This expense number is already in use",
  },
  {
    names: ["ticketNumber"],
    message: "This ticket number is already in use",
  },
  {
    names: ["unitNumber", "unit_number"],
    message: "This building already has a unit with this number",
  },
  {
    names: ["agreements_org_number"],
    message: "Another agreement already uses this number",
  },
  {
    names: ["compounds_org_code"],
    message: "Another compound already uses this code",
  },
  {
    names: ["roles_org_name"],
    message: "A permission group with this name already exists",
  },
  {
    names: ["payments_deposit_per_lease"],
    message: "This contract already has a deposit charge",
  },
  {
    names: ["users_email", "email"],
    message: "This email address is already in use",
  },
];

/**
 * What to tell the person whose save ran into a unique constraint, or null
 * when the error is not a unique violation.
 *
 * The API's error handler used to build this from `meta.target` alone, which
 * this stack never fills in (see above): every duplicate came back as
 * "record already exists". A constraint that is not recognised still gets a
 * sentence, never the database's own wording — index names are internals.
 */
export function uniqueViolationMessage(error: unknown): string | null {
  const target = uniqueViolationTarget(error);
  if (!target) {
    return (error as { code?: unknown } | null)?.code === "P2002"
      ? "This record already exists"
      : null;
  }
  const known = DUPLICATE_MESSAGES.find(({ names }) =>
    names.some((name) => target.includes(name)),
  );
  return known?.message ?? "This record already exists";
}
