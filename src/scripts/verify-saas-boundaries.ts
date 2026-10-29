import fs from "fs";
import path from "path";

let failures = 0;

function check(condition: unknown, label: string): void {
  console.log(`  ${condition ? "PASS" : "FAIL"} ${label}`);
  if (!condition) failures++;
}

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

function routeFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(absolute);
    return entry.name === "route.ts" ? [absolute] : [];
  });
}

const apiRoot = path.resolve(process.cwd(), "src/app/api");
const publicRoutes = new Map<string, (source: string) => boolean>([
  // Better Auth owns every /api/auth/[...all] endpoint; its own sign-in gate
  // and rate limiting stand guard (src/lib/better-auth.ts).
  [
    "auth/[...all]/route.ts",
    (source) => source.includes("toNextJsHandler(auth)"),
  ],
  [
    "auth/forgot-password/route.ts",
    (source) =>
      source.includes("bypassOrgScope") &&
      source.includes("createPasswordResetToken"),
  ],
  ["auth/register/route.ts", (source) => source.includes("410")],
  [
    "auth/reset-password/route.ts",
    (source) =>
      source.includes("validateInvitationToken") &&
      source.includes("runWithOrgContext"),
  ],
  [
    "auth/setup-password/route.ts",
    (source) =>
      source.includes("validateInvitationToken") &&
      source.includes("runWithOrgContext"),
  ],
  [
    "auth/signup-organization/route.ts",
    (source) =>
      source.includes("provisionOrganization") &&
      source.includes("bypassOrgScope"),
  ],
  ["setup/create-admin/route.ts", (source) => source.includes("410")],
  ["payments/[id]/process/route.ts", (source) => source.includes("410")],
  ["payments/stream/route.ts", (source) => source.includes("410")],
  // Public branding endpoints: expose only the whitelisted branding fields
  // resolved through src/lib/utils/public-branding.ts.
  [
    "branding/public/route.ts",
    (source) => source.includes("bypassOrgScope"),
  ],
  [
    "branding/logo/route.ts",
    (source) => source.includes("getPublicBranding"),
  ],
  [
    "branding/pwa-icon/[size]/route.ts",
    (source) => source.includes("getPublicBranding"),
  ],
  // Gateway webhooks authenticate by cryptographic signature, not session.
  // The organization comes from the URL and only selects which stored secret
  // to verify against; everything after that runs org-scoped, not bypassed.
  [
    "payments/webhook/[gateway]/[orgSlug]/route.ts",
    (source) =>
      source.includes("runWithOrgContext") &&
      source.includes("releaseEvent") &&
      /verifyPayPalSignature|constructWebhookEvent/.test(source),
  ],
  // SMS/WhatsApp delivery reports: signed by the provider and verified in
  // lib/messaging/webhook-handler.ts against the stored secret of the scope —
  // the platform's gateway, or (slug in the path) the office's own account,
  // run inside that office's organization context.
  [
    "messaging/webhook/[provider]/route.ts",
    (source) => source.includes("handleDeliveryWebhook"),
  ],
  [
    "messaging/webhook/[provider]/[orgSlug]/route.ts",
    (source) =>
      source.includes("runWithOrgContext") &&
      source.includes("handleDeliveryWebhook"),
  ],
  // The shared endpoints these replaced, now 410.
  ["payments/webhook/route.ts", (source) => source.includes("410")],
  ["payments/webhook/paypal/route.ts", (source) => source.includes("410")],
  // Deliberately public platform state (maintenance flag, platform name).
  [
    "platform/status/route.ts",
    (source) => source.includes("getPublicPlatformSettings"),
  ],
  // Email confirmation links: the high-entropy token IS the credential.
  [
    "user/confirm-email-change/route.ts",
    (source) => source.includes("validateInvitationToken"),
  ],
  [
    "user/confirm-email-verification/route.ts",
    (source) => source.includes("validateInvitationToken"),
  ],
  ["health/route.ts", () => true],
  ["push/vapid/route.ts", () => true],
  [
    "calendar/google/callback/route.ts",
    (source) => source.includes("integration_disabled"),
  ],
]);

const authMarkers = [
  "withAccessAndDB",
  "withPermissionAndDB",
  "withRoleAndDB",
  "withPlatformAdminAndDB",
  "await auth(",
  "runWithCalendarInvitationContext",
  "CRON_SECRET",
  // The cron secret check was centralised into @/lib/cron/request, so the
  // routes that use it no longer mention CRON_SECRET literally. Recognising
  // the helper keeps the check honest instead of flagging authenticated
  // routes; it still only matches a real boundary.
  "rejectUnauthorizedCron",
  // The ledger's routes (src/lib/accounting/api.ts): withAccessAndDB with the
  // ledger rights, plus the staff-only and whole-office checks.
  "ledgerRoute(",
  "stripe-signature",
];

console.log("== A. API route boundary coverage ==");
// A stale allowlist is how this script rots: entries for deleted routes keep
// "passing" while the real route drifts. Every allowlisted path must exist.
for (const relative of publicRoutes.keys()) {
  check(
    fs.existsSync(path.join(apiRoot, relative)),
    `allowlist entry ${relative} points at an existing route`,
  );
}
for (const file of routeFiles(apiRoot)) {
  const relative = path.relative(apiRoot, file);
  const source = fs.readFileSync(file, "utf8");
  const publicValidator = publicRoutes.get(relative);
  const protectedRoute = authMarkers.some((marker) => source.includes(marker));
  check(
    protectedRoute || Boolean(publicValidator?.(source)),
    `${relative} has an authentication or explicit public trust boundary`,
  );
}

console.log("\n== A2. Row scoping goes through the DAL ==");
// Organization isolation is enforced by RLS. Scoping *within* an organization
// — which of its own rows a caller may see — is enforced by lib/db/scopes.ts.
// It used to be hand-written in 43 route files, 89 times — which is how
// /api/leases/active came to assign `where.tenantId = user.id` and then
// overwrite it with the `?tenantId=` parameter two lines later. That one never
// leaked, because its Zod schema strips the parameter first, but nothing in
// the route said so.
//
// This check bans the pattern that made that possible: pinning a field on a
// read-path query object to the caller's own id. Deliberately NOT flagged, as
// none of them are row scoping and the DAL has nothing to offer them:
//   - write defaults on a create payload (`data.tenantId = user.id`), which
//     stamp ownership on a new row rather than filter existing ones;
//   - capability checks ("tenants cannot refund");
//   - field stripping on update;
//   - 403s raised on someone else's id.
const SELF_PIN =
  /\b(where|baseWhere|baseQuery|filter|filters|params)\w*\.\w*(?:tenantId|applicantId|userId|attendeeId)\s*=\s*user\.id\b/;

// Sites that genuinely scope rows but cannot take a Prisma `where`: their
// service accepts a plain id filter instead. Each carries a comment pointing
// at scopes.ts so a new role is not missed. Listed here rather than silently
// skipped, so removing the comment does not quietly remove the obligation.
const serviceFilterScopes = new Set([
  "accounting/transactions/route.ts",
  "calendar/events/route.ts",
]);
for (const relative of serviceFilterScopes) {
  check(
    fs.existsSync(path.join(apiRoot, relative)),
    `service-filter scope ${relative} points at an existing route`,
  );
  const source = fs.readFileSync(path.join(apiRoot, relative), "utf8");
  check(
    source.includes("lib/db/scopes.ts"),
    `${relative} points at the scopes module for future roles`,
  );
}

const handRolledScopes = routeFiles(apiRoot).filter((file) => {
  const relative = path.relative(apiRoot, file);
  if (serviceFilterScopes.has(relative)) return false;
  return SELF_PIN.test(fs.readFileSync(file, "utf8"));
});
check(
  handRolledScopes.length === 0,
  `no route pins a scope field to user.id by hand${
    handRolledScopes.length
      ? ` (found: ${handRolledScopes
          .map((file) => path.relative(apiRoot, file))
          .join(", ")})`
      : ""
  } — use lib/db/scopes.ts`,
);

// The DAL is only worth having if the two shapes of each rule stay together.
const scopesSource = read("src/lib/db/scopes.ts");
for (const model of [
  "lease",
  "invoice",
  "payment",
  "maintenance",
  "application",
  "securityDeposit",
  "inspection",
  "ticket",
  "tenantRecord",
  "feedback",
]) {
  const Model = model[0].toUpperCase() + model.slice(1);
  check(
    scopesSource.includes(`export function ${model}Scope(`) &&
      scopesSource.includes(`export function ${model}Allows(`),
    `${Model} scope exposes both a where fragment and a row predicate`,
  );
}

console.log("\n== B. Central session and subdomain enforcement ==");
const authSource = read("src/lib/auth.ts");
check(
  authSource.includes("session.user.isActive === false"),
  "direct auth rejects inactive and suspended sessions",
);
check(
  authSource.includes("x-propertypro-org-slug"),
  "direct auth validates the requested organization subdomain",
);
const proxySource = read("src/proxy.ts");
check(
  proxySource.includes('headers.delete(ORG_SLUG_HEADER)'),
  "Proxy removes untrusted organization headers",
);
check(
  proxySource.includes('headers.set(ORG_SLUG_HEADER, slug)'),
  "Proxy derives organization slug from the host",
);

console.log("\n== C. Billing surface ==");
for (const route of [
  "checkout",
  "portal",
  "plans",
  "subscription",
  "webhook",
]) {
  check(
    fs.existsSync(path.join(apiRoot, "billing", route, "route.ts")),
    `billing/${route} route exists`,
  );
}
const envExample = read(".env.example");
for (const key of [
  "CRON_SECRET",
  "STRIPE_BILLING_WEBHOOK_SECRET",
  "SAAS_ROOT_DOMAIN",
  // Proxy depth decides which X-Forwarded-For entry is trusted; getting it
  // wrong silently disables the per-IP rate limits behind a reverse proxy.
  "TRUSTED_PROXY_COUNT",
]) {
  check(envExample.includes(`${key}=`), `${key} is documented`);
}

console.log("\n== D. Payment rail separation ==");

// The platform's Stripe account collects subscription revenue. Each
// organization collects rent with its OWN credentials, stored against its
// organization row. The two rails shared one env key once, which meant an
// organization that had configured nothing collected its tenants' rent into
// the platform's account. These checks keep them apart.

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "generated" ? [] : sourceFiles(absolute);
    }
    return /\.tsx?$/.test(entry.name) ? [absolute] : [];
  });
}

const srcRoot = path.resolve(process.cwd(), "src");
// Only the billing rail may read the platform's Stripe secret.
const PLATFORM_KEY_OWNERS = new Set(["src/lib/billing/stripe.ts"]);
const platformKeyReaders: string[] = [];
const publishableKeyReaders: string[] = [];

for (const absolute of sourceFiles(srcRoot)) {
  const relative = path.relative(process.cwd(), absolute);
  const source = fs.readFileSync(absolute, "utf8");
  // Match reads, not prose: `process.env.<KEY>`.
  if (
    /process\.env\.(PLATFORM_)?STRIPE_SECRET_KEY/.test(source) &&
    !PLATFORM_KEY_OWNERS.has(relative)
  ) {
    platformKeyReaders.push(relative);
  }
  if (/process\.env\.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY/.test(source)) {
    publishableKeyReaders.push(relative);
  }
}

check(
  platformKeyReaders.length === 0,
  `only the billing rail reads the platform Stripe secret${
    platformKeyReaders.length ? ` (found: ${platformKeyReaders.join(", ")})` : ""
  }`,
);
check(
  publishableKeyReaders.length === 0,
  `no build-time Stripe publishable key is used${
    publishableKeyReaders.length
      ? ` (found: ${publishableKeyReaders.join(", ")})`
      : ""
  }`,
);

// A registry `env:` mapping would reintroduce the fallback wholesale.
const registrySource = read("src/lib/payments/gateway-registry.ts");
check(
  !/^\s*env: "/m.test(registrySource),
  "gateway registry declares no environment fallback",
);

// The resolver must refuse to guess an organization.
const resolverSource = read("src/lib/services/payment-config.service.ts");
check(
  resolverSource.includes("MissingGatewayContextError") &&
    resolverSource.includes("getOrgContext()?.organizationId"),
  "gateway resolver requires an organization context",
);
check(
  resolverSource.includes("`${organizationId}:${providerId}`"),
  "gateway credential cache is keyed by organization",
);

// Retired gateways must not come back through a stray import.
const retired = sourceFiles(srcRoot).filter((absolute) =>
  /from "@\/lib\/services\/(razorpay|paystack)\.service"/.test(
    fs.readFileSync(absolute, "utf8"),
  ),
);
check(retired.length === 0, "no imports of retired gateway services");

console.log(
  failures === 0
    ? "\n✅ SaaS route boundaries passed."
    : `\n❌ ${failures} SaaS boundary check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
