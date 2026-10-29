/**
 * PropertyPro - Activity log vocabulary
 *
 * The words an activity entry is made of: its module (category), its action
 * and the type of record it touched. They lived as enums in the audit
 * service, which reaches the database — so neither screen could import them,
 * and both filter menus were rebuilt from whatever the table happened to
 * hold on each request. Here they are plain constants: the server writes with
 * them, both activity screens filter and translate with them, and the tests
 * read them without a database.
 *
 * No React, no Prisma, no `server-only` — keep it that way.
 */

export enum AuditCategory {
  AUTHENTICATION = "authentication",
  USER_MANAGEMENT = "user_management",
  PROPERTY_MANAGEMENT = "property_management",
  TENANT_MANAGEMENT = "tenant_management",
  LEASE_MANAGEMENT = "lease_management",
  PAYMENT_MANAGEMENT = "payment_management",
  MAINTENANCE_MANAGEMENT = "maintenance_management",
  DOCUMENT_MANAGEMENT = "document_management",
  SYSTEM_CONFIGURATION = "system_configuration",
  DATA_EXPORT = "data_export",
  DATA_IMPORT = "data_import",
  COMPLIANCE = "compliance",
  SECURITY = "security",
  COMMUNICATION = "communication",
}

export enum AuditAction {
  LOGIN = "login",
  LOGOUT = "logout",
  LOGIN_FAILED = "login_failed",
  PASSWORD_CHANGED = "password_changed",
  PASSWORD_RESET = "password_reset",
  PASSWORD_RESET_REQUESTED = "password_reset_requested",
  PASSWORD_SETUP = "password_setup",
  SIGNUP = "signup",
  CREATE = "create",
  READ = "read",
  UPDATE = "update",
  DELETE = "delete",
  RESTORE = "restore",
  ARCHIVE = "archive",
  /** Destroyed for good — the archive's permanent delete. */
  PURGE = "purge",
  /** A posting in the books undone by a new one that turns it around. */
  REVERSE = "reverse",
  STATUS_CHANGED = "status_changed",
  SIGN = "sign",
  TERMINATE = "terminate",
  RENEW = "renew",
  /** A contract's installment schedule generated. */
  GENERATE = "generate",
  BULK_CREATE = "bulk_create",
  BULK_UPDATE = "bulk_update",
  BULK_DELETE = "bulk_delete",
  BULK_EXPORT = "bulk_export",
  BULK_IMPORT = "bulk_import",
  DOCUMENT_UPLOAD = "document_upload",
  DOCUMENT_DOWNLOAD = "document_download",
  DOCUMENT_VIEW = "document_view",
  DOCUMENT_SHARE = "document_share",
  DOCUMENT_SIGN = "document_sign",
  PAYMENT_PROCESSED = "payment_processed",
  PAYMENT_REFUNDED = "payment_refunded",
  PAYMENT_FAILED = "payment_failed",
  SETTINGS_CHANGED = "settings_changed",
  ROLE_ASSIGNED = "role_assigned",
  PERMISSION_GRANTED = "permission_granted",
  PERMISSION_REVOKED = "permission_revoked",
  IMPERSONATION_STARTED = "impersonation_started",
  IMPERSONATION_ENDED = "impersonation_ended",
  UNAUTHORIZED_ACCESS = "unauthorized_access",
  SUSPICIOUS_ACTIVITY = "suspicious_activity",
  DATA_BREACH_ATTEMPT = "data_breach_attempt",
  EMAIL_SENT = "email_sent",
  SMS_SENT = "sms_sent",
  NOTIFICATION_SENT = "notification_sent",
}

export enum AuditSeverity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

/** Every module, in the order a filter menu lists them. */
export const AUDIT_MODULES: readonly AuditCategory[] = [
  AuditCategory.AUTHENTICATION,
  AuditCategory.USER_MANAGEMENT,
  AuditCategory.PROPERTY_MANAGEMENT,
  AuditCategory.TENANT_MANAGEMENT,
  AuditCategory.LEASE_MANAGEMENT,
  AuditCategory.PAYMENT_MANAGEMENT,
  AuditCategory.MAINTENANCE_MANAGEMENT,
  AuditCategory.DOCUMENT_MANAGEMENT,
  AuditCategory.COMMUNICATION,
  AuditCategory.SYSTEM_CONFIGURATION,
  AuditCategory.DATA_EXPORT,
  AuditCategory.DATA_IMPORT,
  AuditCategory.SECURITY,
  AuditCategory.COMPLIANCE,
];

/**
 * The actions a filter offers. A fixed list on purpose: rebuilding it from
 * the table cost a grouped scan of the whole log on every page load, and a
 * menu that changes with the data cannot be learned.
 */
export const AUDIT_FILTER_ACTIONS: readonly AuditAction[] = [
  AuditAction.LOGIN,
  AuditAction.LOGIN_FAILED,
  AuditAction.LOGOUT,
  AuditAction.SIGNUP,
  AuditAction.PASSWORD_CHANGED,
  AuditAction.PASSWORD_RESET_REQUESTED,
  AuditAction.PASSWORD_RESET,
  AuditAction.PASSWORD_SETUP,
  AuditAction.CREATE,
  AuditAction.UPDATE,
  AuditAction.DELETE,
  AuditAction.ARCHIVE,
  AuditAction.RESTORE,
  AuditAction.PURGE,
  AuditAction.REVERSE,
  AuditAction.STATUS_CHANGED,
  AuditAction.SIGN,
  AuditAction.TERMINATE,
  AuditAction.RENEW,
  AuditAction.GENERATE,
  AuditAction.PAYMENT_PROCESSED,
  AuditAction.PAYMENT_REFUNDED,
  AuditAction.PAYMENT_FAILED,
  AuditAction.ROLE_ASSIGNED,
  AuditAction.PERMISSION_GRANTED,
  AuditAction.BULK_CREATE,
  AuditAction.BULK_UPDATE,
  AuditAction.BULK_DELETE,
  AuditAction.BULK_IMPORT,
  AuditAction.BULK_EXPORT,
  AuditAction.DOCUMENT_UPLOAD,
  AuditAction.DOCUMENT_DOWNLOAD,
  AuditAction.EMAIL_SENT,
  AuditAction.SETTINGS_CHANGED,
  AuditAction.IMPERSONATION_STARTED,
  AuditAction.IMPERSONATION_ENDED,
  AuditAction.UNAUTHORIZED_ACCESS,
];

/** The record types a filter offers, most-asked-about first. */
export const AUDIT_RECORD_TYPES = [
  "lease",
  "invoice",
  "payment",
  "tenant",
  "owner",
  "property",
  "unit",
  "compound",
  "agreement",
  "deposit",
  "expense",
  "supplier",
  "purchase_bill",
  "payment_voucher",
  "bank_reconciliation",
  "ledger_account",
  "bank_account",
  "journal_entry",
  "opening_balance",
  "owner_payout",
  "owner_settlement",
  "bank_transfer",
  "accounting_period",
  "maintenance",
  "ticket",
  "inspection",
  "application",
  "document",
  "message",
  "announcement",
  "calendar_event",
  "listing",
  "listing_inquiry",
  "user",
  "role",
  "invitation",
  "session",
  "account",
  "organization",
  "settings",
  "report",
  "import",
] as const;
export type AuditRecordType = (typeof AUDIT_RECORD_TYPES)[number];

const RECORD_TYPE_CATEGORY: Record<string, AuditCategory> = {
  lease: AuditCategory.LEASE_MANAGEMENT,
  agreement: AuditCategory.LEASE_MANAGEMENT,
  invoice: AuditCategory.PAYMENT_MANAGEMENT,
  payment: AuditCategory.PAYMENT_MANAGEMENT,
  payment_method: AuditCategory.PAYMENT_MANAGEMENT,
  deposit: AuditCategory.PAYMENT_MANAGEMENT,
  expense: AuditCategory.PAYMENT_MANAGEMENT,
  supplier: AuditCategory.PAYMENT_MANAGEMENT,
  purchase_bill: AuditCategory.PAYMENT_MANAGEMENT,
  payment_voucher: AuditCategory.PAYMENT_MANAGEMENT,
  bank_reconciliation: AuditCategory.PAYMENT_MANAGEMENT,
  ledger_account: AuditCategory.PAYMENT_MANAGEMENT,
  bank_account: AuditCategory.PAYMENT_MANAGEMENT,
  journal_entry: AuditCategory.PAYMENT_MANAGEMENT,
  opening_balance: AuditCategory.PAYMENT_MANAGEMENT,
  owner_payout: AuditCategory.PAYMENT_MANAGEMENT,
  owner_settlement: AuditCategory.PAYMENT_MANAGEMENT,
  bank_transfer: AuditCategory.PAYMENT_MANAGEMENT,
  accounting_period: AuditCategory.PAYMENT_MANAGEMENT,
  revenue: AuditCategory.PAYMENT_MANAGEMENT,
  transaction: AuditCategory.PAYMENT_MANAGEMENT,
  tenant: AuditCategory.TENANT_MANAGEMENT,
  application: AuditCategory.TENANT_MANAGEMENT,
  owner: AuditCategory.PROPERTY_MANAGEMENT,
  property: AuditCategory.PROPERTY_MANAGEMENT,
  unit: AuditCategory.PROPERTY_MANAGEMENT,
  compound: AuditCategory.PROPERTY_MANAGEMENT,
  category: AuditCategory.PROPERTY_MANAGEMENT,
  maintenance: AuditCategory.MAINTENANCE_MANAGEMENT,
  ticket: AuditCategory.MAINTENANCE_MANAGEMENT,
  comment: AuditCategory.MAINTENANCE_MANAGEMENT,
  inspection: AuditCategory.MAINTENANCE_MANAGEMENT,
  document: AuditCategory.DOCUMENT_MANAGEMENT,
  message: AuditCategory.COMMUNICATION,
  announcement: AuditCategory.COMMUNICATION,
  communication: AuditCategory.COMMUNICATION,
  calendar_event: AuditCategory.COMMUNICATION,
  listing: AuditCategory.PROPERTY_MANAGEMENT,
  listing_inquiry: AuditCategory.COMMUNICATION,
  user: AuditCategory.USER_MANAGEMENT,
  role: AuditCategory.USER_MANAGEMENT,
  invitation: AuditCategory.USER_MANAGEMENT,
  session: AuditCategory.SECURITY,
  account: AuditCategory.USER_MANAGEMENT,
  organization: AuditCategory.SYSTEM_CONFIGURATION,
  settings: AuditCategory.SYSTEM_CONFIGURATION,
  billing: AuditCategory.SYSTEM_CONFIGURATION,
  feedback: AuditCategory.COMMUNICATION,
  report: AuditCategory.DATA_EXPORT,
  import: AuditCategory.DATA_IMPORT,
};

/** Actions whose module is the same whatever record they touch. */
const ACTION_CATEGORY: Partial<Record<string, AuditCategory>> = {
  [AuditAction.LOGIN]: AuditCategory.AUTHENTICATION,
  [AuditAction.LOGOUT]: AuditCategory.AUTHENTICATION,
  [AuditAction.LOGIN_FAILED]: AuditCategory.AUTHENTICATION,
  [AuditAction.SIGNUP]: AuditCategory.AUTHENTICATION,
  [AuditAction.PASSWORD_CHANGED]: AuditCategory.AUTHENTICATION,
  [AuditAction.PASSWORD_RESET]: AuditCategory.AUTHENTICATION,
  [AuditAction.PASSWORD_RESET_REQUESTED]: AuditCategory.AUTHENTICATION,
  [AuditAction.PASSWORD_SETUP]: AuditCategory.AUTHENTICATION,
  [AuditAction.BULK_EXPORT]: AuditCategory.DATA_EXPORT,
  [AuditAction.BULK_IMPORT]: AuditCategory.DATA_IMPORT,
  [AuditAction.IMPERSONATION_STARTED]: AuditCategory.SECURITY,
  [AuditAction.IMPERSONATION_ENDED]: AuditCategory.SECURITY,
  [AuditAction.UNAUTHORIZED_ACCESS]: AuditCategory.SECURITY,
  [AuditAction.ROLE_ASSIGNED]: AuditCategory.USER_MANAGEMENT,
  [AuditAction.PERMISSION_GRANTED]: AuditCategory.USER_MANAGEMENT,
  [AuditAction.PERMISSION_REVOKED]: AuditCategory.USER_MANAGEMENT,
};

/** The module an entry belongs to: by its action when that decides, else by its record. */
export function categoryFor(
  action: string,
  recordType?: string | null,
): AuditCategory {
  return (
    ACTION_CATEGORY[action] ??
    (recordType ? RECORD_TYPE_CATEGORY[recordType] : undefined) ??
    AuditCategory.SYSTEM_CONFIGURATION
  );
}

/** Deleting and permanently destroying are what an auditor asks about first. */
export function severityFor(action: string): AuditSeverity {
  switch (action) {
    case AuditAction.PURGE:
    case AuditAction.BULK_DELETE:
    case AuditAction.DATA_BREACH_ATTEMPT:
      return AuditSeverity.HIGH;
    case AuditAction.DELETE:
    case AuditAction.REVERSE:
    case AuditAction.TERMINATE:
    case AuditAction.PAYMENT_REFUNDED:
    case AuditAction.ROLE_ASSIGNED:
    case AuditAction.PERMISSION_GRANTED:
    case AuditAction.PERMISSION_REVOKED:
    case AuditAction.LOGIN_FAILED:
    case AuditAction.IMPERSONATION_STARTED:
    case AuditAction.UNAUTHORIZED_ACCESS:
    case AuditAction.SUSPICIOUS_ACTIVITY:
      return AuditSeverity.MEDIUM;
    default:
      return AuditSeverity.LOW;
  }
}

/** The catalogue key an action's sentence is filed under. */
export function auditMessageKey(action: string): string {
  return `admin.audit.msg.${action}`;
}

/**
 * The platform log's actions, as its filter lists them: the console's own
 * control actions, then what an operator's sign-in, export or other console
 * request records (see lib/audit/entry#platformActionName).
 */
export const PLATFORM_AUDIT_ACTIONS = [
  "organization.status_changed",
  "organization.plan_changed",
  "organization.trial_changed",
  "organization.trial_expired",
  "organization.closed",
  "organization.suspended_for_nonpayment",
  "user.status_changed",
  "user.impersonation_started",
  "user.impersonation_ended",
  "billing.portal_opened",
  "plan.created",
  "plan.updated",
  "plan.deleted",
  "landing.updated",
  "blog.created",
  "blog.updated",
  "blog.published",
  "blog.unpublished",
  "blog.deleted",
  "settings.updated",
  "announcement.created",
  "announcement.updated",
  "announcement.deleted",
  "contact.replied",
  "contact.updated",
  "contact.deleted",
  "auth.login",
  "auth.login_failed",
  "auth.logout",
  "auth.password_changed",
  "data.exported",
  // One-off data backfills run from src/scripts.
  "payment.recorders_backfilled",
  "lease.cancellation_dates_backfilled",
  "audit.actor_names_backfilled",
] as const;

/** The platform log's target types, as its filter lists them. */
export const PLATFORM_TARGET_TYPES = [
  "organization",
  "user",
  "billing",
  "plan",
  "landing",
  "blog_post",
  "settings",
  "announcement",
  "contact_message",
  "auth",
  "report",
  "console",
] as const;

// ============================================================================
// What a request names — for the entry written when a handler wrote none
// ============================================================================

/** Path segment → record type, for the collections the API exposes. */
const COLLECTIONS: Record<string, string> = {
  leases: "lease",
  installments: "invoice",
  invoices: "invoice",
  payments: "payment",
  "recurring-payments": "payment",
  methods: "payment_method",
  expenses: "expense",
  revenues: "revenue",
  transactions: "transaction",
  "security-deposits": "deposit",
  properties: "property",
  units: "unit",
  compounds: "compound",
  "property-categories": "category",
  owners: "owner",
  tenants: "tenant",
  applications: "application",
  agreements: "agreement",
  maintenance: "maintenance",
  tickets: "ticket",
  comments: "comment",
  inspections: "inspection",
  documents: "document",
  upload: "document",
  attachments: "document",
  images: "document",
  conversations: "message",
  messages: "message",
  participants: "message",
  announcements: "announcement",
  events: "calendar_event",
  calendar: "calendar_event",
  listings: "listing",
  inquiries: "listing_inquiry",
  users: "user",
  invitations: "invitation",
  roles: "role",
  sessions: "session",
  settings: "settings",
  branding: "settings",
  configuration: "settings",
  organization: "organization",
  organizations: "organization",
  "demo-data": "organization",
  billing: "billing",
  feedback: "feedback",
  communications: "communication",
  clients: "owner",
  import: "import",
  user: "account",
  profile: "account",
  plans: "plan",
  landing: "landing",
  inbox: "contact_message",
  replies: "contact_message",
};

/** Path segments that name what happened to the record rather than a record. */
const SUB_ACTIONS: Record<string, AuditAction> = {
  terminate: AuditAction.TERMINATE,
  renew: AuditAction.RENEW,
  sign: AuditAction.SIGN,
  "generate-invoices": AuditAction.GENERATE,
  approve: AuditAction.STATUS_CHANGED,
  reject: AuditAction.STATUS_CHANGED,
  submit: AuditAction.STATUS_CHANGED,
  status: AuditAction.STATUS_CHANGED,
  "bulk-status": AuditAction.BULK_UPDATE,
  "bulk-assign": AuditAction.BULK_UPDATE,
  bulk: AuditAction.BULK_UPDATE,
  process: AuditAction.PAYMENT_PROCESSED,
  pay: AuditAction.PAYMENT_PROCESSED,
  "capture-order": AuditAction.PAYMENT_PROCESSED,
  restore: AuditAction.RESTORE,
  archive: AuditAction.ARCHIVE,
  permissions: AuditAction.PERMISSION_GRANTED,
  "building-scope": AuditAction.PERMISSION_GRANTED,
  "assign-roles": AuditAction.ROLE_ASSIGNED,
  "change-password": AuditAction.PASSWORD_CHANGED,
  password: AuditAction.PASSWORD_CHANGED,
  email: AuditAction.EMAIL_SENT,
  "bulk-email": AuditAction.EMAIL_SENT,
  "send-verification-email": AuditAction.EMAIL_SENT,
  upload: AuditAction.DOCUMENT_UPLOAD,
  import: AuditAction.BULK_IMPORT,
  impersonate: AuditAction.IMPERSONATION_STARTED,
  test: AuditAction.EMAIL_SENT,
  "test-email": AuditAction.EMAIL_SENT,
  delete: AuditAction.DELETE,
  "transfer-ownership": AuditAction.UPDATE,
  escalate: AuditAction.UPDATE,
  "payment-sync": AuditAction.UPDATE,
};

/** Records there is one of per account: "created" one is changing it. */
const SINGLETON_TYPES = new Set([
  "account",
  "settings",
  "organization",
  "billing",
  "landing",
]);

/**
 * Requests that are not an action anyone would look for in an activity log:
 * the auth endpoints (they record their own events), machine traffic, a
 * browser reporting its own errors, notification read-state, and the
 * payment-intent handshakes whose outcome is recorded when money moves.
 */
const NOT_ACTIONS = [
  "/api/auth/",
  "/api/cron/",
  "/api/health",
  "/api/errors/",
  "/api/push/",
  "/api/notifications",
  "/api/tenant/notifications",
  "/api/payments/webhook",
  "/api/billing/webhook",
  "/api/payments/create-intent",
  "/api/payments/methods/setup-intent",
  "/api/upload/presign",
  "/api/calendar/rsvp",
  "/api/contact",
];

/** A record id as the API writes one: cuid, legacy ObjectId, or uuid. */
export function isRecordId(segment: string): boolean {
  return (
    /^c[a-z0-9]{20,31}$/.test(segment) ||
    /^[a-f0-9]{24}$/.test(segment) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      segment,
    )
  );
}

export interface RequestTarget {
  action: AuditAction;
  category: AuditCategory;
  recordType: string | null;
  recordId: string | null;
  /** The id of the record the path hangs off, e.g. the contract of an installment. */
  parentId: string | null;
  /** The path with ids replaced, e.g. "leases/:id/terminate" — stable for grouping. */
  route: string;
}

/** The verb a method stands for when no path segment says more. */
function methodAction(method: string): AuditAction {
  switch (method.toUpperCase()) {
    case "POST":
      return AuditAction.CREATE;
    case "DELETE":
      return AuditAction.DELETE;
    default:
      return AuditAction.UPDATE;
  }
}

/**
 * What a write request names: the record type, its id when the path carries
 * one, and the action. Null for a request that is not an action (see
 * NOT_ACTIONS) or not an API path at all.
 */
export function describeApiRequest(
  method: string,
  pathname: string,
): RequestTarget | null {
  if (!pathname.startsWith("/api/")) return null;
  if (NOT_ACTIONS.some((prefix) => pathname.startsWith(prefix))) return null;

  const segments = pathname.slice("/api/".length).split("/").filter(Boolean);
  // Prefixes that group routes without naming a record.
  const meaningful =
    segments[0] === "tenant" ||
    segments[0] === "accounting" ||
    segments[0] === "admin"
      ? segments.slice(1)
      : segments;

  let recordType: string | null = null;
  let recordId: string | null = null;
  let parentId: string | null = null;
  let subAction: AuditAction | null = null;

  for (let index = 0; index < meaningful.length; index += 1) {
    const segment = meaningful[index];
    if (isRecordId(segment)) {
      if (recordId) parentId = recordId;
      recordId = segment;
      continue;
    }
    // The archive names the record's collection after its own:
    // archive/<category>/<id>.
    if (segment === "archive") {
      subAction = AuditAction.ARCHIVE;
      continue;
    }
    const collection = COLLECTIONS[segment];
    const action = SUB_ACTIONS[segment];
    if (collection && !(action && recordType)) {
      if (recordId) {
        parentId = recordId;
        recordId = null;
      }
      recordType = collection;
    }
    if (action) subAction = action;
  }

  let action = subAction ?? methodAction(method);
  // Restoring from, or destroying in, the archive.
  if (subAction === AuditAction.ARCHIVE) {
    action =
      method.toUpperCase() === "DELETE"
        ? AuditAction.PURGE
        : AuditAction.RESTORE;
  }
  // A file taken down through the upload helper (DELETE /api/upload) is a
  // deletion, not an upload.
  if (
    action === AuditAction.DOCUMENT_UPLOAD &&
    method.toUpperCase() === "DELETE"
  ) {
    action = AuditAction.DELETE;
  }
  if (
    action === AuditAction.CREATE &&
    recordType &&
    SINGLETON_TYPES.has(recordType)
  ) {
    action = AuditAction.UPDATE;
  }
  if (action === AuditAction.UPDATE && recordType === "settings") {
    action = AuditAction.SETTINGS_CHANGED;
  }

  const route = segments
    .map((segment) => (isRecordId(segment) ? ":id" : segment))
    .join("/");

  return {
    action,
    category: categoryFor(action, recordType),
    recordType,
    recordId,
    parentId,
    route,
  };
}

/** The first of several candidate values that is a non-empty string. */
function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function identityOf(
  row: Record<string, unknown>,
): { id?: string; name?: string } {
  const id = firstText(row.id, row._id);
  const fullName = [row.firstName, row.lastName]
    .filter((part) => typeof part === "string" && part.trim())
    .join(" ");
  const name = firstText(
    row.contractNumber,
    row.invoiceNumber,
    row.receiptNumber,
    row.paymentNumber,
    row.agreementNumber,
    row.requestNumber,
    row.name,
    row.title,
    row.subject,
    row.unitNumber,
    fullName,
    row.email,
    row.label,
  );
  return { ...(id ? { id } : {}), ...(name ? { name } : {}) };
}

/**
 * The record a write answered with — `{ data: { id, name } }`, or one level
 * down (`{ data: { lease: {...} } }`) — so the entry can name it without the
 * route having to say.
 */
export function pickRecordIdentity(
  data: unknown,
  recordType?: string | null,
): { id?: string; name?: string } {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const row = data as Record<string, unknown>;
  const direct = identityOf(row);
  if (direct.id) return direct;

  const nested = Object.entries(row).filter(
    ([, value]) =>
      value !== null && typeof value === "object" && !Array.isArray(value),
  ) as Array<[string, Record<string, unknown>]>;
  const preferred =
    (recordType &&
      nested.find(([key]) => key === recordType || key === `${recordType}s`)) ||
    (nested.length === 1 ? nested[0] : undefined);
  if (preferred) {
    const inner = identityOf(preferred[1]);
    if (inner.id) return inner;
  }
  return direct;
}
