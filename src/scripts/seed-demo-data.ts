/**
 * PropertyPro - exact demo data seed (PostgreSQL / Prisma).
 *
 * Provisions the demo organization ("PropertyPro Demo Management",
 * slug "propertypro-demo") through the real signup path, then fills it with
 * the demo portfolio: users, properties with unit ROWS, leases, invoices,
 * payments, deposits, maintenance, tickets, documents, conversations,
 * calendar events, announcements, notifications and audit logs. All dates are
 * relative to "now" so the demo stays evergreen.
 *
 * Usage:
 *   pnpm db:seed          (tsx src/scripts/seed-demo-data.ts)
 *
 * Reset first when needed:
 *   DEMO_RESET_CONFIRM=RESET_PROPERTYPRO_DEMO_DATABASE pnpm db:reset
 */

import "../lib/env/load-dotenv";

import {
  authDb,
  basePrisma,
  db,
  type MoneyAsNumber,
} from "../lib/db/prisma";
import type {
  Lease,
  Payment as PaymentModel,
  Prisma,
  Property,
  Tenant,
  Unit as UnitModel,
  User,
} from "../generated/prisma/client";

// Money fields arrive as numbers via the money result extension.
type Payment = MoneyAsNumber<PaymentModel>;
type Unit = MoneyAsNumber<UnitModel>;
import { provisionOrganization } from "../lib/tenancy/provision-organization";
import {
  DEFAULT_COUNTRY,
  DEFAULT_CURRENCY,
  DEFAULT_LANGUAGE,
  DEFAULT_TIMEZONE,
} from "../lib/regional/region";
import { setUserPassword } from "../lib/auth-credentials";
import { DEMO_PLATFORM_ADMIN } from "../lib/demo-credentials";
import { runWithOrgContext } from "../lib/tenancy/context";
import {
  AuditAction,
  AuditCategory,
  AuditSeverity,
} from "../lib/audit-service";
import {
  activeParticipantIds,
  buildLastMessagePayload,
  makeParticipant,
  participantsAsJson,
} from "../lib/messaging/conversations";
import { buildUnitFeatures } from "../lib/property-units";
import { syncPropertyDerivedState } from "../lib/services/property-status-sync.service";
import {
  ApplicationFeeStatus,
  ApplicationStatus,
  EventPriority,
  EventStatus,
  EventType,
  ExpenseCategory,
  ExpenseStatus,
  InspectionType,
  InvoiceType,
  LeaseStatus,
  LocationType,
  MaintenancePriority,
  MaintenanceStatus,
  PaymentFrequency,
  PaymentMethod,
  PaymentStatus,
  PaymentType,
  PropertyStatus,
  PropertyType,
  SecurityDepositStatus,
  TicketCategory,
  TicketPriority,
  TicketStatus,
  UserRole,
  WorkOrderStatus,
} from "../types";

// ============================================================================
// Shared context & helpers
// ============================================================================

/** Set once after provisioning; every create stamps it explicitly. */
let organizationId = "";

type UsersByEmail = Record<string, User>;
type TenantsByUserId = Record<string, Tenant>;

interface PropertyContext {
  property: Property;
  units: Unit[];
}
type PropertiesByName = Record<string, PropertyContext>;

interface LeaseContext {
  lease: MoneyAsNumber<Lease>;
  property: Property;
  tenantUser: User;
  unit: Unit;
}

const companyInfo = {
  name: "شركة بروبرتي برو لإدارة الأملاك",
  address: "طريق الملك فهد، حي العليا، الرياض 12212",
  phone: "+966501230100",
  email: "billing@propertypro.com",
};

let invoiceSequence = 1000;
let receiptSequence = 2000;
let transactionSequence = 3000;
let ticketSequence: number | null = null;

/** Json column input helper (dates inside payloads are pre-serialized). */
function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function iso(value: string | number | Date): string {
  return new Date(value).toISOString();
}

async function nextTicketNumber(): Promise<string> {
  if (ticketSequence === null) {
    const existingTickets = await db.ticket.findMany({
      where: { ticketNumber: { not: null }, deletedAt: undefined },
      select: { ticketNumber: true },
    });

    const maxTicketNumber = existingTickets.reduce((max, ticket) => {
      const raw = ticket.ticketNumber;
      if (typeof raw !== "string") return max;

      const match = /^TKT-(\d+)$/.exec(raw);
      if (!match) return max;

      const parsed = Number.parseInt(match[1], 10);
      return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
    }, 0);

    ticketSequence = maxTicketNumber + 1;
  }

  const ticketNumber = `TKT-${String(ticketSequence).padStart(5, "0")}`;
  ticketSequence += 1;
  return ticketNumber;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function fullAddress(property: Property): string {
  return `${property.addressStreet}, ${property.addressCity}, ${property.addressState} ${property.addressZipCode}`;
}

function findUnit(context: PropertyContext, unitNumber: string): Unit {
  const unit = context.units.find(
    (candidate) => candidate.unitNumber === unitNumber,
  );

  if (!unit) {
    throw new Error(
      `Unit ${unitNumber} not found on ${context.property.name}`,
    );
  }

  return unit;
}

function rentPaymentConfig() {
  return {
    rentDueDay: 1,
    acceptedPaymentMethods: [
      PaymentMethod.BANK_TRANSFER,
      PaymentMethod.CREDIT_CARD,
      PaymentMethod.CHECK,
    ],
    autoCreatePayments: true,
    prorationEnabled: true,
    advancePaymentMonths: 0,
    autoGenerateInvoices: true,
    autoEmailInvoices: false,
    enableCommunicationAutomation: true,
    prorationMethod: "daily",
    roundingMethod: "round",
    minimumProrationCharge: 0,
  };
}

/**
 * Derived invoice status, mirroring the old model hook: cancelled is terminal;
 * balance <= 0 && total > 0 -> paid; past due -> overdue; any payment ->
 * partial; issued once the issue date passes; scheduled before that.
 */
function computeInvoiceStatus(input: {
  issueDate: Date;
  dueDate: Date;
  totalAmount: number;
  amountPaid: number;
}): string {
  const now = new Date();
  const balanceRemaining = input.totalAmount - input.amountPaid;
  if (balanceRemaining <= 0 && input.totalAmount > 0) return "paid";
  if (now > input.dueDate) return "overdue";
  if (input.amountPaid > 0) return "partial";
  if (now >= input.issueDate) return "issued";
  return "scheduled";
}

// ============================================================================
// Preflight
// ============================================================================

async function assertDatabaseIsReadyForSeed() {
  // deletedAt: undefined opts out of the soft-delete filter — soft-deleted
  // leftovers must block the seed too.
  const counts = await Promise.all([
    (async () =>
      ["organizations", await authDb.organization.count({
        where: { deletedAt: undefined },
      })] as const)(),
    (async () =>
      ["users", await authDb.user.count({
        where: { deletedAt: undefined },
      })] as const)(),
    (async () =>
      ["properties", await authDb.property.count({
        where: { deletedAt: undefined },
      })] as const)(),
    (async () =>
      ["tenants", await authDb.tenant.count({
        where: { deletedAt: undefined },
      })] as const)(),
    (async () =>
      ["leases", await authDb.lease.count({
        where: { deletedAt: undefined },
      })] as const)(),
    (async () =>
      ["invoices", await authDb.invoice.count({
        where: { deletedAt: undefined },
      })] as const)(),
    (async () =>
      ["payments", await authDb.payment.count({
        where: { deletedAt: undefined },
      })] as const)(),
    (async () =>
      ["applications", await authDb.application.count({
        where: { deletedAt: undefined },
      })] as const)(),
  ]);

  const nonEmpty = counts.filter(([, count]) => count > 0);
  if (nonEmpty.length > 0) {
    const details = nonEmpty
      .map(([name, count]) => `${name}: ${count}`)
      .join(", ");
    throw new Error(
      `Database already contains core data (${details}). Reset first with DEMO_RESET_CONFIRM=RESET_PROPERTYPRO_DEMO_DATABASE pnpm db:reset.`,
    );
  }
}

// ============================================================================
// Users
// ============================================================================

/**
 * The platform operator: the account the sign-in page offers as "Super Admin".
 *
 * Belongs to no organization, so it is created outside the org context the
 * rest of the seed runs in, on the bypass client. It lives here rather than
 * only in `create:super-admin` because `db:reset` truncates every table: a
 * one-off bootstrap survives exactly until the first reset, and then the
 * credential printed on the login screen stops working with no clue as to
 * why. Seeding it means the page's promise is rebuilt every time.
 *
 * Idempotent, and it promotes an existing row rather than failing on the
 * unique email — the same thing `create:super-admin` does.
 */
async function createPlatformSuperAdmin(): Promise<void> {
  const { email, password, firstName, lastName } = DEMO_PLATFORM_ADMIN;

  const existing = await authDb.user.findFirst({ where: { email } });
  const user = existing
    ? await authDb.user.update({
        where: { id: existing.id },
        data: { role: "super_admin", organizationId: null, isActive: true },
      })
    : await authDb.user.create({
        data: {
          email,
          firstName: firstName ?? "Platform",
          lastName: lastName ?? "Admin",
          name: `${firstName ?? "Platform"} ${lastName ?? "Admin"}`,
          role: "super_admin",
          organizationId: null,
          isActive: true,
          emailVerified: new Date(),
          emailVerifiedFlag: true,
        },
      });

  await setUserPassword(user.id, password, { revokeSessions: false });
}

interface DemoUserDefinition {
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  phone: string;
  tenantStatus?: string;
  dateOfBirth?: Date;
  backgroundCheckStatus?: string;
  creditScore?: number;
  preferredContactMethod?: string;
  employmentInfo?: Record<string, unknown>;
  emergencyContacts?: Array<Record<string, unknown>>;
}

const DEMO_PASSWORDS: Record<string, string> = {
  "admin@propertypro.com": "Admin123$",
  "owner.talal@propertypro.com": "Owner123$",
  "owner.haya@propertypro.com": "Owner123$",
  "owner.nasser@propertypro.com": "Owner123$",
  "manager@propertypro.com": "Manager123$",
  "maintenance@propertypro.com": "Maintenance123$",
  "tenant@propertypro.com": "Tenant123$",
  "liam.carter@example.com": "Tenant123$",
  "sofia.martinez@example.com": "Tenant123$",
  "noah.kim@example.com": "Tenant123$",
  "maya.chen@example.com": "Applicant123$",
  "jordan.patel@example.com": "Applicant123$",
};

async function createUsers(ownerId: string): Promise<UsersByEmail> {
  const now = new Date();

  // The admin (org owner) was created by provisionOrganization with the demo
  // password already set — finish its demo profile fields here.
  const admin = await db.user.update({
    where: { id: ownerId },
    data: {
      name: "عبدالله السبيعي",
      emailVerified: now,
      emailVerifiedFlag: true,
    },
  });

  const memberDefinitions: DemoUserDefinition[] = [
    // The owners whose buildings this office manages. They exist because the
    // office is an agent, not a landlord: without them every building here
    // belonged to the admin, which made the owners page, the owner statements
    // and the owner portal demonstrate nothing.
    {
      firstName: "طلال",
      lastName: "القحطاني",
      email: "owner.talal@propertypro.com",
      role: UserRole.OWNER,
      phone: "+966501230201",
    },
    {
      firstName: "هيا",
      lastName: "العمودي",
      email: "owner.haya@propertypro.com",
      role: UserRole.OWNER,
      phone: "+966501230202",
    },
    {
      firstName: "ناصر",
      lastName: "الغامدي",
      email: "owner.nasser@propertypro.com",
      role: UserRole.OWNER,
      phone: "+966501230203",
    },
    {
      firstName: "منى",
      lastName: "القحطاني",
      email: "manager@propertypro.com",
      role: UserRole.MANAGER,
      phone: "+966501230101",
    },
    {
      firstName: "خالد",
      lastName: "العتيبي",
      email: "maintenance@propertypro.com",
      role: UserRole.MANAGER,
      phone: "+966501230102",
    },
    {
      firstName: "سارة",
      lastName: "الحربي",
      email: "tenant@propertypro.com",
      role: UserRole.TENANT,
      phone: "+966501230110",
      tenantStatus: "active",
      dateOfBirth: new Date("1992-05-12"),
      backgroundCheckStatus: "approved",
      creditScore: 742,
      preferredContactMethod: "email",
      employmentInfo: {
        employer: "شركة نجم الشمال للتصميم",
        position: "مصممة منتجات",
        income: 230000,
        startDate: iso("2021-03-15"),
      },
      emergencyContacts: [
        {
          name: "هند الحربي",
          relationship: "أخت",
          phone: "+966501230111",
          email: "nora.reed@example.com",
        },
      ],
    },
    {
      firstName: "فهد",
      lastName: "الدوسري",
      email: "liam.carter@example.com",
      role: UserRole.TENANT,
      phone: "+966501230112",
      tenantStatus: "active",
      dateOfBirth: new Date("1988-11-03"),
      backgroundCheckStatus: "approved",
      creditScore: 718,
      preferredContactMethod: "app",
      employmentInfo: {
        employer: "شركة الرعاية الصحية الأهلية",
        position: "مدير عمليات",
        income: 260000,
        startDate: iso("2019-08-01"),
      },
      emergencyContacts: [
        {
          name: "لطيفة الدوسري",
          relationship: "أم",
          phone: "+966501230113",
          email: "grace.carter@example.com",
        },
      ],
    },
    {
      firstName: "نورة",
      lastName: "الزهراني",
      email: "sofia.martinez@example.com",
      role: UserRole.TENANT,
      phone: "+966501230114",
      tenantStatus: "active",
      dateOfBirth: new Date("1995-02-21"),
      backgroundCheckStatus: "approved",
      creditScore: 781,
      preferredContactMethod: "phone",
      employmentInfo: {
        employer: "مجموعة أطلس للمحاماة",
        position: "مساعدة قانونية",
        income: 200000,
        startDate: iso("2020-10-12"),
      },
      emergencyContacts: [
        {
          name: "سعد الزهراني",
          relationship: "أب",
          phone: "+966501230115",
          email: "carlos.martinez@example.com",
        },
      ],
    },
    {
      firstName: "عمر",
      lastName: "الشمري",
      email: "noah.kim@example.com",
      role: UserRole.TENANT,
      phone: "+966501230116",
      tenantStatus: "active",
      dateOfBirth: new Date("1990-07-19"),
      backgroundCheckStatus: "approved",
      creditScore: 696,
      preferredContactMethod: "text",
      employmentInfo: {
        employer: "شركة الخط الأخضر للطاقة",
        position: "مهندس ميداني",
        income: 220000,
        startDate: iso("2018-04-09"),
      },
      emergencyContacts: [
        {
          name: "أمل الشمري",
          relationship: "زوج",
          phone: "+966501230117",
          email: "hana.kim@example.com",
        },
      ],
    },
    {
      firstName: "ريم",
      lastName: "المطيري",
      email: "maya.chen@example.com",
      role: UserRole.TENANT,
      phone: "+966501230120",
      tenantStatus: "under_review",
      dateOfBirth: new Date("1994-09-30"),
      backgroundCheckStatus: "pending",
      preferredContactMethod: "email",
    },
    {
      firstName: "بندر",
      lastName: "العنزي",
      email: "jordan.patel@example.com",
      role: UserRole.TENANT,
      phone: "+966501230121",
      tenantStatus: "application_submitted",
      dateOfBirth: new Date("1986-12-05"),
      backgroundCheckStatus: "pending",
      preferredContactMethod: "email",
    },
  ];

  // The map is keyed by email and every demo person is defined with one, so a
  // missing address here means the provisioning step changed underneath the
  // seed — louder as a failure than as a silently absent admin.
  if (!admin.email) {
    throw new Error("Demo admin was provisioned without an email address");
  }

  const users: UsersByEmail = { [admin.email]: admin };

  for (const definition of memberDefinitions) {
    const user = await db.user.create({
      data: {
        organizationId,
        firstName: definition.firstName,
        lastName: definition.lastName,
        name: `${definition.firstName} ${definition.lastName}`,
        email: definition.email,
        role: definition.role,
        phone: definition.phone,
        isActive: true,
        emailVerified: now,
        emailVerifiedFlag: true,
        ...(definition.tenantStatus
          ? { tenantStatus: definition.tenantStatus }
          : {}),
        ...(definition.dateOfBirth
          ? { dateOfBirth: definition.dateOfBirth }
          : {}),
        ...(definition.backgroundCheckStatus
          ? { backgroundCheckStatus: definition.backgroundCheckStatus }
          : {}),
        // creditScore/employmentInfo live on the Tenant profile (PII single
        // home) — written by the tenant-profile seed block, not here.
        ...(definition.preferredContactMethod
          ? { preferredContactMethod: definition.preferredContactMethod }
          : {}),
        ...(definition.emergencyContacts
          ? { emergencyContacts: toJson(definition.emergencyContacts) }
          : {}),
      },
    });

    // Better Auth keeps each credential's hash on its account record, so the
    // demo passwords are written there rather than on the user rows.
    // Keyed off the definition rather than the created row: the definition's
    // email is the literal this seed is written around, and it is a plain
    // string where the row's column is now optional.
    const demoPassword = DEMO_PASSWORDS[definition.email];
    if (demoPassword) {
      await setUserPassword(user.id, demoPassword, { revokeSessions: false });
    }

    users[definition.email] = user;
  }

  return users;
}

// ============================================================================
// Properties & units (units are real rows now)
// ============================================================================

interface DemoUnitDefinition extends Record<string, unknown> {
  unitNumber: string;
  unitType: string;
  floor: number;
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  rentAmount: number;
  securityDeposit: number;
  status: PropertyStatus;
  images: string[];
  notes?: string;
}

/**
 * A residential complex several buildings sit inside. Optional on a property
 * — the demo deliberately keeps three buildings standalone, because both
 * shapes exist in a real office and the compound filters have to cope with
 * either.
 */
interface DemoCompoundDefinition {
  name: string;
  code: string;
  description: string;
  address: {
    street: string;
    city: string;
    district: string;
    state: string;
    zipCode: string;
    country: string;
  };
  yearBuilt: number;
  totalArea: number;
  amenities: Array<{ name: string; category: string }>;
}

const DEMO_COMPOUNDS: DemoCompoundDefinition[] = [
  {
    name: "مجمع الرياض السكني",
    code: "RYD-1",
    description:
      "مجمع سكني في الرياض يضم عدة عمائر بمرافق مشتركة وحراسة على مدار الساعة.",
    address: {
      street: "طريق الملك فهد",
      city: "الرياض",
      district: "العليا",
      state: "منطقة الرياض",
      zipCode: "13521",
      country: "Saudi Arabia",
    },
    yearBuilt: 2019,
    totalArea: 18500,
    amenities: [
      { name: "حراسة أمنية", category: "Security" },
      { name: "مسبح مشترك", category: "Recreation" },
      { name: "مواقف مظللة", category: "Parking" },
    ],
  },
  {
    name: "مجمع جدة السكني",
    code: "JED-1",
    description: "مجمع سكني قريب من الكورنيش بمرافق عائلية وممرات مشاة.",
    address: {
      street: "شارع صاري",
      city: "جدة",
      district: "الروضة",
      state: "منطقة مكة المكرمة",
      zipCode: "23434",
      country: "Saudi Arabia",
    },
    yearBuilt: 2021,
    totalArea: 12400,
    amenities: [
      { name: "منطقة ألعاب أطفال", category: "Recreation" },
      { name: "دخول مؤمّن", category: "Security" },
    ],
  },
];

interface DemoPropertyDefinition {
  name: string;
  /** Name of the compound this building sits in; absent means standalone. */
  compound?: string;
  description: string;
  type: PropertyType;
  address: {
    street: string;
    city: string;
    /** حي — how a Saudi address is actually found. */
    district: string;
    state: string;
    zipCode: string;
    country: string;
  };
  yearBuilt: number;
  images: string[];
  amenities: Array<{ name: string; category: string }>;
  units: DemoUnitDefinition[];
}

/**
 * Who owns what.
 *
 * A table of its own rather than a field buried in each building, because the
 * split is the point: one owner holds a Riyadh compound, another a Jeddah
 * one, and a third the two standalone buildings — so the owner filter on
 * every report, an owner's statement and an owner signing in all have
 * something real to show.
 *
 * Every compound and every building must appear here. The seed throws on a
 * missing entry rather than falling back to the admin, which is precisely how
 * the product came to record an office as the owner of its clients' property.
 */
const DEMO_OWNERSHIP: Record<string, string> = {
  // مجمع الرياض السكني and its four buildings
  "مجمع الرياض السكني": "owner.talal@propertypro.com",
  "شقق الواحة": "owner.talal@propertypro.com",
  "شقق الياسمين": "owner.talal@propertypro.com",
  "شقق الملقا": "owner.talal@propertypro.com",
  "شقق قرطبة": "owner.talal@propertypro.com",
  // مجمع جدة السكني and its two
  "مجمع جدة السكني": "owner.haya@propertypro.com",
  "لوفتات الروضة": "owner.haya@propertypro.com",
  "فلل الشاطئ": "owner.haya@propertypro.com",
  // The standalone buildings
  "فلل ساحة النخيل": "owner.nasser@propertypro.com",
  "مساكن السدرة": "owner.nasser@propertypro.com",
};

/** The owner of a named compound or building; throws rather than guessing. */
function ownerFor(users: UsersByEmail, name: string): string {
  const email = DEMO_OWNERSHIP[name];
  const owner = email ? users[email] : undefined;
  if (!owner) {
    throw new Error(
      `No owner listed for "${name}". Add it to DEMO_OWNERSHIP — a building without an owner is the bug this table exists to prevent.`,
    );
  }
  return owner.id;
}

const DEMO_PROPERTIES: DemoPropertyDefinition[] = [
  {
    name: "شقق الواحة",
    compound: "مجمع الرياض السكني",
    description:
      "مجمع سكني على طريق الملك فهد بمطابخ مجددة ودخول مؤمّن وسطح مشترك.",
    type: PropertyType.APARTMENT,
    address: {
      street: "طريق الملك فهد",
      city: "الرياض",
      district: "العليا",
      state: "منطقة الرياض",
      zipCode: "12212",
      country: "Saudi Arabia",
    },
    yearBuilt: 2018,
    images: [
      "https://picsum.photos/seed/harbor-heights-property-1/1400/900",
      "https://picsum.photos/seed/harbor-heights-property-2/1400/900",
    ],
    amenities: [
      { name: "سطح مشترك", category: "Recreation" },
      { name: "غرفة استلام طرود", category: "Security" },
      { name: "موقف دراجات", category: "Parking" },
    ],
    units: [
      {
        unitNumber: "A101",
        unitType: "apartment",
        floor: 1,
        bedrooms: 1,
        bathrooms: 1,
        squareFootage: 720,
        rentAmount: 4750,
        securityDeposit: 4750,
        status: PropertyStatus.AVAILABLE,
        images: ["https://picsum.photos/seed/harbor-heights-a101/1200/800"],
        balcony: true,
        dishwasher: true,
        inUnitLaundry: true,
        centralAir: true,
        appliances: {
          refrigerator: true,
          stove: true,
          oven: true,
          microwave: true,
          dishwasher: true,
          washer: true,
          dryer: true,
        },
        parking: {
          included: true,
          spaces: 1,
          type: "covered",
          assigned: true,
        },
      },
      {
        unitNumber: "A102",
        unitType: "apartment",
        floor: 1,
        bedrooms: 2,
        bathrooms: 2,
        squareFootage: 1050,
        rentAmount: 6250,
        securityDeposit: 6250,
        status: PropertyStatus.AVAILABLE,
        images: ["https://picsum.photos/seed/harbor-heights-a102/1200/800"],
        balcony: true,
        dishwasher: true,
        inUnitLaundry: true,
        centralAir: true,
      },
      {
        unitNumber: "B201",
        unitType: "apartment",
        floor: 2,
        bedrooms: 1,
        bathrooms: 1,
        squareFootage: 760,
        rentAmount: 5000,
        securityDeposit: 5000,
        status: PropertyStatus.AVAILABLE,
        images: ["https://picsum.photos/seed/harbor-heights-b201/1200/800"],
        hardwoodFloors: true,
        dishwasher: true,
        centralAir: true,
      },
      {
        unitNumber: "B202",
        unitType: "apartment",
        floor: 2,
        bedrooms: 2,
        bathrooms: 2,
        squareFootage: 1115,
        rentAmount: 6500,
        securityDeposit: 6500,
        status: PropertyStatus.AVAILABLE,
        images: ["https://picsum.photos/seed/harbor-heights-b202/1200/800"],
        balcony: true,
        dishwasher: true,
        inUnitLaundry: true,
      },
      {
        unitNumber: "C301",
        unitType: "penthouse",
        floor: 3,
        bedrooms: 3,
        bathrooms: 2,
        squareFootage: 1460,
        rentAmount: 8000,
        securityDeposit: 8000,
        status: PropertyStatus.AVAILABLE,
        images: ["https://picsum.photos/seed/harbor-heights-c301/1200/800"],
        balcony: true,
        fireplace: true,
        walkInClosets: true,
        centralAir: true,
      },
      {
        unitNumber: "C302",
        unitType: "apartment",
        floor: 3,
        bedrooms: 1,
        bathrooms: 1,
        squareFootage: 700,
        rentAmount: 4500,
        securityDeposit: 4500,
        status: PropertyStatus.MAINTENANCE,
        images: ["https://picsum.photos/seed/harbor-heights-c302/1200/800"],
        notes: "جاري تجهيز الوحدة بين مستأجرين.",
      },
    ],
  },
  {
    name: "فلل ساحة النخيل",
    description:
      "ثلاث فلل حول فناء داخلي مع مواقف ملحقة وأفنية خاصة.",
    type: PropertyType.TOWNHOUSE,
    address: {
      street: "شارع الأمير سلطان",
      city: "الرياض",
      district: "النخيل",
      state: "منطقة الرياض",
      zipCode: "12382",
      country: "Saudi Arabia",
    },
    yearBuilt: 2016,
    images: [
      "https://picsum.photos/seed/maple-court-property-1/1400/900",
      "https://picsum.photos/seed/maple-court-property-2/1400/900",
    ],
    amenities: [
      { name: "موقف ملحق", category: "Parking" },
      { name: "فناء خاص", category: "Outdoor" },
      { name: "منظم حرارة ذكي", category: "Climate" },
    ],
    units: [
      {
        unitNumber: "T1",
        unitType: "room",
        floor: 1,
        bedrooms: 3,
        bathrooms: 2.5,
        squareFootage: 1680,
        rentAmount: 7000,
        securityDeposit: 7000,
        status: PropertyStatus.AVAILABLE,
        images: ["https://picsum.photos/seed/maple-court-t1/1200/800"],
        patio: true,
        garden: true,
        dishwasher: true,
        inUnitLaundry: true,
        parking: { included: true, spaces: 2, type: "garage" },
      },
      {
        unitNumber: "T2",
        unitType: "room",
        floor: 1,
        bedrooms: 3,
        bathrooms: 2.5,
        squareFootage: 1725,
        rentAmount: 7250,
        securityDeposit: 7250,
        status: PropertyStatus.AVAILABLE,
        images: ["https://picsum.photos/seed/maple-court-t2/1200/800"],
        patio: true,
        dishwasher: true,
        inUnitLaundry: true,
        parking: { included: true, spaces: 2, type: "garage" },
      },
      {
        unitNumber: "T3",
        unitType: "room",
        floor: 1,
        bedrooms: 2,
        bathrooms: 2,
        squareFootage: 1390,
        rentAmount: 6000,
        securityDeposit: 6000,
        status: PropertyStatus.AVAILABLE,
        images: ["https://picsum.photos/seed/maple-court-t3/1200/800"],
        patio: true,
        dishwasher: true,
        centralAir: true,
        parking: { included: true, spaces: 1, type: "garage" },
      },
    ],
  },
  {
    name: "لوفتات الروضة",
    compound: "مجمع جدة السكني",
    description:
      "لوفتات بمساحات مفتوحة قريبة من المحاور الرئيسية ومناسبة للعمل من المنزل.",
    type: PropertyType.CONDO,
    address: {
      street: "شارع صاري",
      city: "جدة",
      district: "الروضة",
      state: "منطقة مكة المكرمة",
      zipCode: "23434",
      country: "Saudi Arabia",
    },
    yearBuilt: 2020,
    images: [
      "https://picsum.photos/seed/cedar-ridge-property-1/1400/900",
      "https://picsum.photos/seed/cedar-ridge-property-2/1400/900",
    ],
    amenities: [
      { name: "صالة عمل مشتركة", category: "Living" },
      { name: "استوديو رياضي", category: "Recreation" },
      { name: "شحن سيارات كهربائية", category: "Parking" },
    ],
    units: [
      {
        unitNumber: "L1",
        unitType: "loft",
        floor: 1,
        bedrooms: 1,
        bathrooms: 1,
        squareFootage: 840,
        rentAmount: 5250,
        securityDeposit: 5250,
        status: PropertyStatus.AVAILABLE,
        images: ["https://picsum.photos/seed/cedar-ridge-l1/1200/800"],
        hardwoodFloors: true,
        centralAir: true,
        parking: { included: true, spaces: 1, type: "open" },
      },
      {
        unitNumber: "L2",
        unitType: "loft",
        floor: 2,
        bedrooms: 2,
        bathrooms: 2,
        squareFootage: 1180,
        rentAmount: 6750,
        securityDeposit: 6750,
        status: PropertyStatus.AVAILABLE,
        images: ["https://picsum.photos/seed/cedar-ridge-l2/1200/800"],
        balcony: true,
        dishwasher: true,
        inUnitLaundry: true,
      },
      {
        unitNumber: "L3",
        unitType: "studio",
        floor: 3,
        bedrooms: 0,
        bathrooms: 1,
        squareFootage: 560,
        rentAmount: 4000,
        securityDeposit: 4000,
        status: PropertyStatus.AVAILABLE,
        images: ["https://picsum.photos/seed/cedar-ridge-l3/1200/800"],
        centralAir: true,
        appliances: {
          refrigerator: true,
          stove: true,
          oven: true,
          microwave: true,
        },
      },
    ],
  },
  {
    name: "فلل الشاطئ",
    compound: "مجمع جدة السكني",
    description:
      "فلل بحدائق خاصة ومساحات واسعة وأسوار مستقلة وممرات مشاة هادئة.",
    type: PropertyType.HOUSE,
    address: {
      street: "طريق الكورنيش",
      city: "جدة",
      district: "الشاطئ",
      state: "منطقة مكة المكرمة",
      zipCode: "23612",
      country: "Saudi Arabia",
    },
    yearBuilt: 2014,
    images: [
      "https://picsum.photos/seed/sunset-villas-property-1/1400/900",
      "https://picsum.photos/seed/sunset-villas-property-2/1400/900",
    ],
    amenities: [
      { name: "ممشى المجمع", category: "Outdoor" },
      { name: "منطقة حيوانات أليفة", category: "Outdoor" },
      { name: "مواقف مظللة", category: "Parking" },
    ],
    units: [
      {
        unitNumber: "H1",
        unitType: "room",
        floor: 1,
        bedrooms: 3,
        bathrooms: 2,
        squareFootage: 1540,
        rentAmount: 6750,
        securityDeposit: 6750,
        status: PropertyStatus.AVAILABLE,
        images: ["https://picsum.photos/seed/sunset-villas-h1/1200/800"],
        patio: true,
        garden: true,
        inUnitLaundry: true,
        parking: { included: true, spaces: 2, type: "covered" },
      },
      {
        unitNumber: "H2",
        unitType: "room",
        floor: 1,
        bedrooms: 4,
        bathrooms: 2.5,
        squareFootage: 1780,
        rentAmount: 7750,
        securityDeposit: 7750,
        status: PropertyStatus.AVAILABLE,
        images: ["https://picsum.photos/seed/sunset-villas-h2/1200/800"],
        patio: true,
        dishwasher: true,
        centralAir: true,
        parking: { included: true, spaces: 2, type: "covered" },
      },
    ],
  },
  {
    name: "مساكن السدرة",
    description:
      "مجمع شقق متوسط الارتفاع يضم مساحات عمل مشتركة وصالة رياضية مجددة.",
    type: PropertyType.APARTMENT,
    address: {
      street: "شارع الأمير محمد بن فهد",
      city: "الدمام",
      district: "الفيصلية",
      state: "المنطقة الشرقية",
      zipCode: "32271",
      country: "Saudi Arabia",
    },
    yearBuilt: 2019,
    images: [
      "https://picsum.photos/seed/oakline-residences-property-1/1400/900",
      "https://picsum.photos/seed/oakline-residences-property-2/1400/900",
    ],
    amenities: [
      { name: "غرف عمل مشتركة", category: "Living" },
      { name: "صالة رياضية", category: "Recreation" },
      { name: "دخول مؤمّن", category: "Security" },
    ],
    units: [
      {
        unitNumber: "O101",
        unitType: "apartment",
        floor: 1,
        bedrooms: 1,
        bathrooms: 1,
        squareFootage: 690,
        rentAmount: 4250,
        securityDeposit: 4250,
        status: PropertyStatus.AVAILABLE,
        images: [
          "https://picsum.photos/seed/oakline-residences-o101/1200/800",
        ],
        dishwasher: true,
        inUnitLaundry: true,
        centralAir: true,
      },
      {
        unitNumber: "O204",
        unitType: "apartment",
        floor: 2,
        bedrooms: 2,
        bathrooms: 2,
        squareFootage: 980,
        rentAmount: 5750,
        securityDeposit: 5750,
        status: PropertyStatus.AVAILABLE,
        images: [
          "https://picsum.photos/seed/oakline-residences-o204/1200/800",
        ],
        balcony: true,
        dishwasher: true,
        inUnitLaundry: true,
      },
      {
        unitNumber: "O305",
        unitType: "studio",
        floor: 3,
        bedrooms: 0,
        bathrooms: 1,
        squareFootage: 520,
        rentAmount: 3750,
        securityDeposit: 3750,
        status: PropertyStatus.AVAILABLE,
        images: [
          "https://picsum.photos/seed/oakline-residences-o305/1200/800",
        ],
        centralAir: true,
      },
    ],
  },
  {
    name: "شقق الياسمين",
    compound: "مجمع الرياض السكني",
    description:
      "مجمع فلل عائلي قريب من المدارس بأفنية مشتركة ومستودعات خاصة.",
    type: PropertyType.TOWNHOUSE,
    address: {
      street: "شارع أنس بن مالك",
      city: "الرياض",
      district: "الياسمين",
      state: "منطقة الرياض",
      zipCode: "13325",
      country: "Saudi Arabia",
    },
    yearBuilt: 2015,
    images: [
      "https://picsum.photos/seed/pinecrest-commons-property-1/1400/900",
      "https://picsum.photos/seed/pinecrest-commons-property-2/1400/900",
    ],
    amenities: [
      { name: "فناء مشترك", category: "Outdoor" },
      { name: "مستودعات السكان", category: "Living" },
      { name: "مواقف زوار", category: "Parking" },
    ],
    units: [
      {
        unitNumber: "P1",
        unitType: "room",
        floor: 1,
        bedrooms: 3,
        bathrooms: 2.5,
        squareFootage: 1610,
        rentAmount: 6250,
        securityDeposit: 6250,
        status: PropertyStatus.AVAILABLE,
        images: ["https://picsum.photos/seed/pinecrest-commons-p1/1200/800"],
        patio: true,
        dishwasher: true,
        inUnitLaundry: true,
        parking: { included: true, spaces: 2, type: "open" },
      },
      {
        unitNumber: "P2",
        unitType: "room",
        floor: 1,
        bedrooms: 2,
        bathrooms: 2,
        squareFootage: 1375,
        rentAmount: 5500,
        securityDeposit: 5500,
        status: PropertyStatus.AVAILABLE,
        images: ["https://picsum.photos/seed/pinecrest-commons-p2/1200/800"],
        patio: true,
        centralAir: true,
        parking: { included: true, spaces: 1, type: "open" },
      },
    ],
  },
  {
    name: "شقق الملقا",
    compound: "مجمع الرياض السكني",
    description:
      "شقق تمليك عصرية بنوافذ واسعة وإطلالات مفتوحة وصالة للسكان.",
    type: PropertyType.CONDO,
    address: {
      street: "طريق الملك عبدالعزيز",
      city: "الرياض",
      district: "الملقا",
      state: "منطقة الرياض",
      zipCode: "13521",
      country: "Saudi Arabia",
    },
    yearBuilt: 2021,
    images: [
      "https://picsum.photos/seed/lakeview-condominiums-property-1/1400/900",
      "https://picsum.photos/seed/lakeview-condominiums-property-2/1400/900",
    ],
    amenities: [
      { name: "صالة السكان", category: "Living" },
      { name: "مواقف مؤمّنة", category: "Parking" },
      { name: "خزائن استلام", category: "Security" },
    ],
    units: [
      {
        unitNumber: "C12",
        unitType: "apartment",
        floor: 1,
        bedrooms: 1,
        bathrooms: 1,
        squareFootage: 745,
        rentAmount: 5250,
        securityDeposit: 5250,
        status: PropertyStatus.AVAILABLE,
        images: [
          "https://picsum.photos/seed/lakeview-condominiums-c12/1200/800",
        ],
        dishwasher: true,
        inUnitLaundry: true,
        centralAir: true,
      },
      {
        unitNumber: "C24",
        unitType: "apartment",
        floor: 2,
        bedrooms: 2,
        bathrooms: 2,
        squareFootage: 1090,
        rentAmount: 7000,
        securityDeposit: 7000,
        status: PropertyStatus.AVAILABLE,
        images: [
          "https://picsum.photos/seed/lakeview-condominiums-c24/1200/800",
        ],
        balcony: true,
        dishwasher: true,
        inUnitLaundry: true,
      },
    ],
  },
  {
    name: "شقق قرطبة",
    compound: "مجمع الرياض السكني",
    description:
      "عمارة سكنية بتشطيبات حديثة قريبة من المحاور الرئيسية وخيارات إيجار مرنة.",
    type: PropertyType.APARTMENT,
    address: {
      street: "شارع الشيخ جابر الأحمد الصباح",
      city: "الرياض",
      district: "قرطبة",
      state: "منطقة الرياض",
      zipCode: "13248",
      country: "Saudi Arabia",
    },
    yearBuilt: 2017,
    images: [
      "https://picsum.photos/seed/rivergate-flats-property-1/1400/900",
      "https://picsum.photos/seed/rivergate-flats-property-2/1400/900",
    ],
    amenities: [
      { name: "موقف نقل", category: "Other" },
      { name: "جلسة خارجية", category: "Recreation" },
      { name: "خزائن طرود", category: "Security" },
    ],
    units: [
      {
        unitNumber: "R110",
        unitType: "apartment",
        floor: 1,
        bedrooms: 1,
        bathrooms: 1,
        squareFootage: 710,
        rentAmount: 4250,
        securityDeposit: 4250,
        status: PropertyStatus.AVAILABLE,
        images: ["https://picsum.photos/seed/rivergate-flats-r110/1200/800"],
        dishwasher: true,
        centralAir: true,
      },
      {
        unitNumber: "R220",
        unitType: "apartment",
        floor: 2,
        bedrooms: 2,
        bathrooms: 2,
        squareFootage: 1015,
        rentAmount: 5250,
        securityDeposit: 5250,
        status: PropertyStatus.AVAILABLE,
        images: ["https://picsum.photos/seed/rivergate-flats-r220/1200/800"],
        balcony: true,
        inUnitLaundry: true,
        centralAir: true,
      },
      {
        unitNumber: "R330",
        unitType: "studio",
        floor: 3,
        bedrooms: 0,
        bathrooms: 1,
        squareFootage: 505,
        rentAmount: 3250,
        securityDeposit: 3250,
        status: PropertyStatus.AVAILABLE,
        images: ["https://picsum.photos/seed/rivergate-flats-r330/1200/800"],
        centralAir: true,
      },
    ],
  },
];

/**
 * The residential complexes, created before the buildings that sit in them.
 *
 * Returned as a name → id map because the property definitions name their
 * compound rather than carrying an id: the seed is written to be read, and
 * "مجمع شمال الرياض" says more at the call site than a cuid would.
 */
/**
 * The owners' client records: payout details, tax numbers, the company a
 * building is held through. The owners list works without these — it is
 * derived from who owns each building — but a statement or a payout has
 * nowhere to go without them.
 */
async function createOwnerProfiles(users: UsersByEmail): Promise<void> {
  const profiles = [
    {
      email: "owner.talal@propertypro.com",
      companyName: null,
      nationalId: "1054327891",
      bankName: "البنك الأهلي السعودي",
      bankAccountName: "طلال بن محمد القحطاني",
      bankIban: "SA4420000001234567891234",
      addressCity: "الرياض",
      addressDistrict: "حي الملقا",
    },
    {
      email: "owner.haya@propertypro.com",
      companyName: "شركة البحر الأحمر العقارية",
      nationalId: "1067451223",
      taxNumber: "300012345600003",
      bankName: "مصرف الراجحي",
      bankAccountName: "شركة البحر الأحمر العقارية",
      bankIban: "SA0380000000608010167519",
      addressCity: "جدة",
      addressDistrict: "حي الشاطئ",
    },
    {
      email: "owner.nasser@propertypro.com",
      companyName: null,
      nationalId: "1098773410",
      bankName: "بنك الرياض",
      bankAccountName: "ناصر بن سعيد الغامدي",
      bankIban: "SA9020000001999888777666",
      addressCity: "الرياض",
      addressDistrict: "حي النخيل",
    },
  ];

  for (const profile of profiles) {
    const { email, ...rest } = profile;
    await db.owner.create({
      data: {
        organizationId,
        userId: users[email].id,
        addressCountry: DEFAULT_COUNTRY,
        payoutMethod: "bank_transfer",
        isActive: true,
        ...rest,
      },
    });
  }
}

async function createCompounds(
  users: UsersByEmail,
): Promise<Record<string, string>> {
  const manager = users["manager@propertypro.com"];

  const byName: Record<string, string> = {};
  for (const definition of DEMO_COMPOUNDS) {
    const compound = await db.compound.create({
      data: {
        organizationId,
        name: definition.name,
        code: definition.code,
        description: definition.description,
        addressStreet: definition.address.street,
        addressCity: definition.address.city,
        addressDistrict: definition.address.district,
        addressState: definition.address.state,
        addressZipCode: definition.address.zipCode,
        addressCountry: definition.address.country,
        yearBuilt: definition.yearBuilt,
        totalArea: definition.totalArea,
        amenities: toJson(definition.amenities),
        ownerId: ownerFor(users, definition.name),
        managerId: manager.id,
      },
    });
    byName[definition.name] = compound.id;
  }
  return byName;
}

async function createProperties(
  users: UsersByEmail,
  compounds: Record<string, string>,
): Promise<PropertiesByName> {
  const manager = users["manager@propertypro.com"];

  const propertiesByName: PropertiesByName = {};

  for (const definition of DEMO_PROPERTIES) {
    const property = await db.property.create({
      data: {
        organizationId,
        name: definition.name,
        description: definition.description,
        type: definition.type,
        status: PropertyStatus.AVAILABLE,
        addressStreet: definition.address.street,
        addressCity: definition.address.city,
        addressDistrict: definition.address.district,
        addressState: definition.address.state,
        addressZipCode: definition.address.zipCode,
        addressCountry: definition.address.country,
        // Standalone buildings pass null, which is the shape the rest of the
        // product already handles — a property inside a compound stays fully
        // independent; the compound only rolls it up.
        compoundId: definition.compound
          ? (compounds[definition.compound] ?? null)
          : null,
        yearBuilt: definition.yearBuilt,
        images: definition.images,
        amenities: toJson(definition.amenities),
        isMultiUnit: definition.units.length > 1,
        totalUnits: definition.units.length,
        // The office manages these; it does not own them.
        ownerId: ownerFor(users, definition.name),
        managerId: manager.id,
      },
    });

    const units: Unit[] = [];
    for (const unitDefinition of definition.units) {
      const unit = await db.unit.create({
        data: {
          organizationId,
          propertyId: property.id,
          unitNumber: unitDefinition.unitNumber,
          unitType: unitDefinition.unitType,
          floor: unitDefinition.floor,
          bedrooms: unitDefinition.bedrooms,
          bathrooms: unitDefinition.bathrooms,
          squareFootage: unitDefinition.squareFootage,
          rentAmount: unitDefinition.rentAmount,
          securityDeposit: unitDefinition.securityDeposit,
          status: unitDefinition.status,
          images: unitDefinition.images,
          ...(unitDefinition.notes ? { notes: unitDefinition.notes } : {}),
          // Boolean flags + appliances/parking/utilities live in the
          // features Json column now — same builder the API routes use.
          features: toJson(buildUnitFeatures(unitDefinition)),
        },
      });
      units.push(unit);
    }

    propertiesByName[property.name] = { property, units };
  }

  return propertiesByName;
}

// ============================================================================
// Tenant profiles
// ============================================================================

/**
 * The management agreements the office works under.
 *
 * One per shape the product supports, because a demo with a single shape
 * proves only that one path runs: a compound-level deal covering four
 * buildings at once, a portfolio deal covering everything an owner holds, and
 * two building-level deals — one on a percentage, one on a flat monthly fee.
 * Both commission bases appear too, since "we charge on what we collect" and
 * "we charge on what we billed" are different conversations with an owner.
 *
 * Also one expired investment agreement, for the investment register and the
 * expiry filters to have something real to show. It ended before the
 * management agreement on the same owner's buildings began: an agreement
 * counts for the dates it was in force, whatever its status now, and a
 * building under investment earns no management commission — so the two must
 * not overlap.
 */
async function createAgreements(
  users: UsersByEmail,
  compounds: Record<string, string>,
  properties: PropertiesByName,
  monthStart: Date,
): Promise<void> {
  const talal = users["owner.talal@propertypro.com"];
  const haya = users["owner.haya@propertypro.com"];
  const nasser = users["owner.nasser@propertypro.com"];

  const definitions = [
    {
      agreementNumber: "AGR-2025-014",
      kind: "management",
      ownerId: talal.id,
      compoundId: compounds["مجمع الرياض السكني"],
      propertyId: null,
      feeType: "percentage",
      feePercentage: 5,
      feeAmount: 0,
      commissionBasis: "collected",
      startDate: addMonths(monthStart, -18),
      endDate: addMonths(monthStart, 18),
      status: "active",
      notes: "إدارة كاملة لمباني مجمع الرياض السكني مقابل ٥٪ من الإيجار المُحصَّل.",
    },
    {
      agreementNumber: "AGR-2025-021",
      kind: "management",
      ownerId: haya.id,
      compoundId: null,
      propertyId: null,
      feeType: "percentage",
      feePercentage: 7,
      feeAmount: 0,
      commissionBasis: "billed",
      startDate: addMonths(monthStart, -12),
      endDate: addMonths(monthStart, 24),
      status: "active",
      notes: "اتفاقية محفظة تشمل جميع عقارات شركة البحر الأحمر العقارية، واحتساب العمولة على المفوتر.",
    },
    {
      agreementNumber: "AGR-2026-003",
      kind: "management",
      ownerId: nasser.id,
      compoundId: null,
      propertyId: properties["فلل ساحة النخيل"].property.id,
      feeType: "fixed",
      feePercentage: 0,
      // ~10% of what this building bills a month. A flat fee only reads as a
      // flat fee if it is the size an office would actually charge.
      feeAmount: 550,
      commissionBasis: "collected",
      startDate: addMonths(monthStart, -9),
      endDate: addMonths(monthStart, 15),
      status: "active",
      notes: "أتعاب إدارة ثابتة ٥٥٠ ريال شهريًا لفلل ساحة النخيل.",
    },
    {
      agreementNumber: "AGR-2026-004",
      kind: "management",
      ownerId: nasser.id,
      compoundId: null,
      propertyId: properties["مساكن السدرة"].property.id,
      feeType: "percentage",
      feePercentage: 6,
      feeAmount: 0,
      commissionBasis: "collected",
      startDate: addMonths(monthStart, -9),
      endDate: addMonths(monthStart, 15),
      status: "active",
      notes: "إدارة مساكن السدرة مقابل ٦٪ من الإيجار المُحصَّل.",
    },
    {
      agreementNumber: "AGR-2023-002",
      kind: "investment",
      ownerId: talal.id,
      compoundId: null,
      propertyId: null,
      feeType: "percentage",
      feePercentage: 8,
      feeAmount: 0,
      commissionBasis: "collected",
      startDate: addMonths(monthStart, -36),
      endDate: addMonths(monthStart, -19),
      status: "expired",
      notes: "اتفاقية استثمار منتهية، محفوظة للسجل.",
    },
  ];

  for (const definition of definitions) {
    await db.agreement.create({
      data: {
        organizationId,
        feeFrequency: "monthly",
        currency: DEFAULT_CURRENCY,
        ...definition,
      },
    });
  }
}

async function createTenantProfiles(
  users: UsersByEmail,
  leaseStart: Date,
): Promise<TenantsByUserId> {
  const definitions = [
    {
      user: users["tenant@propertypro.com"],
      dateOfBirth: new Date("1992-05-12"),
      employmentInfo: {
        employer: "شركة نجم الشمال للتصميم",
        position: "مصممة منتجات",
        income: 230000,
        startDate: iso("2021-03-15"),
      },
      emergencyContacts: [
        {
          name: "هند الحربي",
          relationship: "أخت",
          phone: "+966501230111",
          email: "nora.reed@example.com",
        },
      ],
      creditScore: 742,
    },
    {
      user: users["liam.carter@example.com"],
      dateOfBirth: new Date("1988-11-03"),
      employmentInfo: {
        employer: "شركة الرعاية الصحية الأهلية",
        position: "مدير عمليات",
        income: 260000,
        startDate: iso("2019-08-01"),
      },
      emergencyContacts: [
        {
          name: "لطيفة الدوسري",
          relationship: "أم",
          phone: "+966501230113",
          email: "grace.carter@example.com",
        },
      ],
      creditScore: 718,
    },
    {
      user: users["sofia.martinez@example.com"],
      dateOfBirth: new Date("1995-02-21"),
      employmentInfo: {
        employer: "مجموعة أطلس للمحاماة",
        position: "مساعدة قانونية",
        income: 200000,
        startDate: iso("2020-10-12"),
      },
      emergencyContacts: [
        {
          name: "سعد الزهراني",
          relationship: "أب",
          phone: "+966501230115",
          email: "carlos.martinez@example.com",
        },
      ],
      creditScore: 781,
    },
    {
      user: users["noah.kim@example.com"],
      dateOfBirth: new Date("1990-07-19"),
      employmentInfo: {
        employer: "شركة الخط الأخضر للطاقة",
        position: "مهندس ميداني",
        income: 220000,
        startDate: iso("2018-04-09"),
      },
      emergencyContacts: [
        {
          name: "أمل الشمري",
          relationship: "زوج",
          phone: "+966501230117",
          email: "hana.kim@example.com",
        },
      ],
      creditScore: 696,
    },
  ];

  const tenantsByUserId: TenantsByUserId = {};

  for (const definition of definitions) {
    const tenant = await db.tenant.create({
      data: {
        organizationId,
        userId: definition.user.id,
        dateOfBirth: definition.dateOfBirth,
        employmentInfo: toJson(definition.employmentInfo),
        emergencyContacts: toJson(definition.emergencyContacts),
        creditScore: definition.creditScore,
        backgroundCheckStatus: "approved",
        applicationDate: addMonths(leaseStart, -1),
        moveInDate: leaseStart,
      },
    });
    tenantsByUserId[definition.user.id] = tenant;
  }

  return tenantsByUserId;
}

// ============================================================================
// Applications
// ============================================================================

async function createApplications(
  users: UsersByEmail,
  properties: PropertiesByName,
) {
  const admin = users["admin@propertypro.com"];
  const harbor = properties["شقق الواحة"].property;
  const maple = properties["فلل ساحة النخيل"].property;

  await db.application.create({
    data: {
      organizationId,
      propertyId: harbor.id,
      applicantId: users["maya.chen@example.com"].id,
      status: ApplicationStatus.UNDER_REVIEW,
      applicationFee: toJson({
        amount: 150,
        status: ApplicationFeeStatus.PAID,
        paymentMethod: "credit_card",
        transactionId: "APP-DEMO-1001",
        paidAt: iso(new Date()),
      }),
      personalInfo: toJson({
        firstName: "ريم",
        lastName: "المطيري",
        email: "maya.chen@example.com",
        phone: "+966501230120",
        dateOfBirth: iso("1994-09-30"),
        ssn: "123-45-6789",
      }),
      employmentInfo: toJson({
        employer: "شركة القمة لتقنية المعلومات",
        position: "مسؤولة نجاح العملاء",
        income: 240000,
        startDate: iso("2022-02-01"),
        employerContact: "hr@peakline.example.com",
      }),
      emergencyContacts: toJson([
        {
          name: "ماجد المطيري",
          relationship: "أخ",
          phone: "+966501230122",
          email: "victor.chen@example.com",
        },
      ]),
      previousAddresses: toJson([
        {
          address: "77 Pine St, Portland, OR 97204",
          landlordName: "شركة الصفوة العقارية",
          landlordContact: "leasing@willow.example.com",
          moveInDate: iso("2021-06-01"),
          moveOutDate: iso("2024-12-31"),
          reasonForLeaving: "Relocating for work",
        },
      ]),
      documents: toJson([
        {
          type: "id_verification",
          fileName: "maya-id.pdf",
          fileUrl: "/uploads/demo/maya-id.pdf",
          verified: true,
        },
      ]),
      additionalInfo: toJson({
        pets: "One indoor cat",
        vehicles: "One compact vehicle",
        reasonForMoving: "Closer to office",
      }),
      submittedAt: addDays(new Date(), -4),
      reviewedAt: addDays(new Date(), -1),
      reviewedById: admin.id,
      reviewNotes: "Employment verified. Awaiting final reference response.",
    },
  });

  await db.application.create({
    data: {
      organizationId,
      propertyId: maple.id,
      applicantId: users["jordan.patel@example.com"].id,
      status: ApplicationStatus.SUBMITTED,
      applicationFee: toJson({
        amount: 150,
        status: ApplicationFeeStatus.PENDING,
      }),
      personalInfo: toJson({
        firstName: "بندر",
        lastName: "العنزي",
        email: "jordan.patel@example.com",
        phone: "+966501230121",
        dateOfBirth: iso("1986-12-05"),
        ssn: "987-65-4321",
      }),
      employmentInfo: toJson({
        employer: "شركة البلوط الأزرق للخدمات اللوجستية",
        position: "محلل مالي",
        income: 210000,
        startDate: iso("2020-01-15"),
        employerContact: "people@blueoak.example.com",
      }),
      emergencyContacts: toJson([
        {
          name: "دلال العنزي",
          relationship: "أخت",
          phone: "+966501230123",
          email: "anika.patel@example.com",
        },
      ]),
      previousAddresses: toJson([
        {
          address: "410 Lake Dr, Austin, TX 78701",
          landlordName: "مؤسسة الندى للإيجار",
          landlordContact: "manager@lakeview.example.com",
          moveInDate: iso("2020-02-01"),
          moveOutDate: iso("2025-01-31"),
          reasonForLeaving: "Needs more space",
        },
      ]),
      documents: toJson([]),
      submittedAt: addDays(new Date(), -1),
    },
  });
}

// ============================================================================
// Leases
// ============================================================================

async function createLeases(
  users: UsersByEmail,
  properties: PropertiesByName,
  leaseStart: Date,
  leaseEnd: Date,
): Promise<LeaseContext[]> {
  const assignments = [
    {
      tenantUser: users["tenant@propertypro.com"],
      context: properties["شقق الواحة"],
      unitNumber: "A101",
    },
    {
      tenantUser: users["liam.carter@example.com"],
      context: properties["شقق الواحة"],
      unitNumber: "A102",
    },
    {
      tenantUser: users["sofia.martinez@example.com"],
      context: properties["فلل ساحة النخيل"],
      unitNumber: "T1",
    },
    {
      tenantUser: users["noah.kim@example.com"],
      context: properties["لوفتات الروضة"],
      unitNumber: "L1",
    },
  ];

  const leases: LeaseContext[] = [];

  for (const assignment of assignments) {
    const unit = findUnit(assignment.context, assignment.unitNumber);
    const property = assignment.context.property;

    const lease = await db.lease.create({
      data: {
        organizationId,
        propertyId: property.id,
        unitId: unit.id,
        tenantId: assignment.tenantUser.id,
        startDate: leaseStart,
        endDate: leaseEnd,
        status: LeaseStatus.ACTIVE,
        paymentStatus: "current",
        // The Decimal columns are authoritative (see lib/lease-money.ts); the
        // `terms` JSON below is the mirror kept for legacy readers. The seed
        // wrote only the mirror, so every demo contract read as rent 0 to any
        // code that trusted the schema and read the column.
        rentAmount: unit.rentAmount,
        securityDepositAmount: unit.securityDeposit,
        terms: toJson({
          rentAmount: unit.rentAmount,
          securityDeposit: unit.securityDeposit,
          utilities: ["water", "electricity"],
          restrictions: ["no_smoking"],
          paymentConfig: rentPaymentConfig(),
        }),
        renewalOptions: toJson({
          available: true,
          terms: "Eligible for twelve-month renewal after account review.",
        }),
        notes: `Demo lease for unit ${assignment.unitNumber}.`,
      },
    });

    await db.user.update({
      where: { id: assignment.tenantUser.id },
      data: {
        currentLeaseId: lease.id,
        moveInDate: leaseStart,
        tenantStatus: "active",
        lastStatusUpdate: new Date(),
        leaseHistory: toJson([
          { leaseId: lease.id, startDate: iso(leaseStart), status: "active" },
        ]),
      },
    });

    // The unit row carries the occupancy now.
    const occupiedUnit = await db.unit.update({
      where: { id: unit.id },
      data: {
        status: PropertyStatus.OCCUPIED,
        currentTenantId: assignment.tenantUser.id,
        currentLeaseId: lease.id,
      },
    });

    leases.push({
      lease,
      property,
      tenantUser: assignment.tenantUser,
      unit: occupiedUnit,
    });
  }

  const today = new Date();

  // A history behind the four live contracts.
  //
  // Without it the leasing registers the review asks for — approaching
  // expiry, renewed, expired, cancelled — are four empty screens, and a demo
  // that cannot show a feature cannot sell it. These are deliberately NOT
  // returned in `leases`: the finance, maintenance and messaging blocks build
  // on that array, and they should go on describing the live contracts only.
  const history = [
    {
      // A renewal chain on the same unit: last year's term, superseded by
      // the live contract above. Its end date is in the past, so it never
      // counts as occupying anything.
      tenantUser: users["tenant@propertypro.com"],
      context: properties["شقق الواحة"],
      unitNumber: "A101",
      startDate: addMonths(leaseStart, -12),
      endDate: addDays(leaseStart, -1),
      status: LeaseStatus.RENEWED,
      note: "Superseded by the current contract.",
    },
    {
      // Ran its course and was not renewed.
      tenantUser: users["noah.kim@example.com"],
      context: properties["شقق الملقا"],
      unitNumber: "C12",
      startDate: addMonths(leaseStart, -14),
      endDate: addMonths(leaseStart, -2),
      status: LeaseStatus.EXPIRED,
      note: "Term ended; tenant moved out.",
    },
    {
      // Ended early — what "cancelled contracts" is asked about.
      tenantUser: users["sofia.martinez@example.com"],
      context: properties["شقق قرطبة"],
      unitNumber: "R110",
      startDate: addMonths(leaseStart, -10),
      endDate: addMonths(leaseStart, 2),
      status: LeaseStatus.TERMINATED,
      terminatedDate: addMonths(leaseStart, -1),
      terminationReason: "انتقل المستأجر إلى مدينة أخرى.",
      note: "Terminated early by mutual agreement.",
    },
    {
      // Live, and close enough to its end to appear in the expiry register
      // at the windows an office actually watches.
      tenantUser: users["liam.carter@example.com"],
      context: properties["لوفتات الروضة"],
      unitNumber: "L2",
      startDate: addMonths(today, -11),
      endDate: addDays(today, 45),
      status: LeaseStatus.ACTIVE,
      note: "Due for renewal discussion.",
    },
  ];

  for (const entry of history) {
    // A demo portfolio is edited by hand between runs; skip rather than fail
    // when the unit this contract was written for is not there.
    let unit;
    try {
      unit = findUnit(entry.context, entry.unitNumber);
    } catch {
      continue;
    }

    await db.lease.create({
      data: {
        organizationId,
        propertyId: entry.context.property.id,
        unitId: unit.id,
        tenantId: entry.tenantUser.id,
        startDate: entry.startDate,
        endDate: entry.endDate,
        status: entry.status,
        paymentStatus: "current",
        rentAmount: unit.rentAmount,
        securityDepositAmount: unit.securityDeposit,
        terms: toJson({
          rentAmount: unit.rentAmount,
          securityDeposit: unit.securityDeposit,
          paymentConfig: rentPaymentConfig(),
        }),
        ...(entry.terminatedDate
          ? {
              terminatedDate: entry.terminatedDate,
              terminationReason: entry.terminationReason,
            }
          : {}),
        notes: entry.note,
      },
    });

    // The live one puts a tenant in the unit; the historical ones do not.
    if (entry.status === LeaseStatus.ACTIVE) {
      await db.unit.update({
        where: { id: unit.id },
        data: {
          status: PropertyStatus.OCCUPIED,
          currentTenantId: entry.tenantUser.id,
        },
      });
    }
  }

  // Recompute the derived property state (status/totalUnits/isMultiUnit)
  // from the unit rows, same as the app does after unit changes.
  for (const { property } of Object.values(properties)) {
    await syncPropertyDerivedState(property.id, {
      triggeredBy: "demo-seed",
      logChanges: false,
    });
  }

  return leases;
}

// ============================================================================
// Finance: invoices, payments, receipts, deposits, recurring
// ============================================================================

async function createInvoiceAndPayment({
  lease,
  property,
  tenantUser,
  unit,
  category,
  dueDate,
  amount,
  description,
  paymentStatus,
  paymentMethod,
  amountPaid = 0,
}: {
  lease: MoneyAsNumber<Lease>;
  property: Property;
  tenantUser: User;
  unit: Unit;
  category: InvoiceType;
  dueDate: Date;
  amount: number;
  description: string;
  paymentStatus: PaymentStatus;
  paymentMethod?: PaymentMethod;
  amountPaid?: number;
}) {
  const issueDate = addDays(dueDate, -10);
  const subtotal = amount;
  const totalAmount = Math.max(0, subtotal);
  const balanceRemaining = totalAmount - amountPaid;

  const isPaidLike =
    paymentStatus === PaymentStatus.PAID ||
    paymentStatus === PaymentStatus.PARTIAL;
  const paymentCreatedAt = addDays(dueDate, -15);
  const paidDate = isPaidLike
    ? addDays(dueDate, paymentStatus === PaymentStatus.PARTIAL ? 3 : 1)
    : undefined;

  const invoice = await db.invoice.create({
    data: {
      organizationId,
      invoiceNumber: `INV-DEMO-${invoiceSequence++}`,
      tenantId: tenantUser.id,
      propertyId: property.id,
      leaseId: lease.id,
      unitId: unit.id,
      category,
      issueDate,
      dueDate,
      subtotal,
      totalAmount,
      amountPaid,
      balanceRemaining,
      status: computeInvoiceStatus({
        issueDate,
        dueDate,
        totalAmount,
        amountPaid,
      }),
      lineItems: toJson([
        {
          description,
          amount,
          type: category,
          quantity: 1,
          unitPrice: amount,
          dueDate: iso(dueDate),
        },
      ]),
      notes: `Demo ${description.toLowerCase()} for ${property.name} ${unit.unitNumber}.`,
    },
  });

  const payment = await db.payment.create({
    data: {
      organizationId,
      tenantId: tenantUser.id,
      propertyId: property.id,
      leaseId: lease.id,
      invoiceId: invoice.id,
      amount,
      amountPaid,
      type:
        category === InvoiceType.SECURITY_DEPOSIT
          ? PaymentType.SECURITY_DEPOSIT
          : PaymentType.RENT,
      status: paymentStatus,
      ...(paymentMethod ? { paymentMethod } : {}),
      dueDate,
      ...(paidDate ? { paidDate } : {}),
      createdAt: paymentCreatedAt,
      description,
      paymentHistory: toJson(
        amountPaid > 0 && paymentMethod && paidDate
          ? [
              {
                amount: amountPaid,
                paymentMethod,
                paidDate: iso(paidDate),
                transactionId: `TXN-DEMO-${transactionSequence++}`,
                notes: "سجل دفعة تجريبية",
              },
            ]
          : [],
      ),
      statusHistory: toJson([
        {
          status: paymentStatus,
          changedAt: iso(new Date()),
          changedBy: "demo-seed",
          reason: "أُنشئ بواسطة البيانات التجريبية",
        },
      ]),
    },
  });

  await db.invoice.update({
    where: { id: invoice.id },
    data: {
      paymentIds: [payment.id],
      ...(paidDate ? { lastPaymentDate: paidDate } : {}),
    },
  });

  if (paymentStatus === PaymentStatus.PAID) {
    await db.paymentReceipt.create({
      data: {
        organizationId,
        paymentId: payment.id,
        tenantId: tenantUser.id,
        propertyId: property.id,
        receiptNumber: `RCP-DEMO-${receiptSequence++}`,
        amount,
        paymentMethod: paymentMethod || PaymentMethod.BANK_TRANSFER,
        transactionId: `TXN-DEMO-${transactionSequence++}`,
        paidDate: paidDate || new Date(),
        description,
        receiptData: toJson({
          tenantName: `${tenantUser.firstName} ${tenantUser.lastName}`,
          propertyAddress: fullAddress(property),
          paymentDetails: {
            amount,
            type:
              category === InvoiceType.SECURITY_DEPOSIT
                ? "Security Deposit"
                : "Rent",
            dueDate: iso(dueDate),
            paidDate: iso(paidDate || new Date()),
          },
          companyInfo,
        }),
        emailSent: true,
        emailSentDate: new Date(),
      },
    });
  }

  return { invoice, payment };
}

async function createFinancialData(
  leases: LeaseContext[],
  monthStart: Date,
) {
  const payments: Payment[] = [];
  const invoices: Array<{ id: string }> = [];
  const notablePayments: Array<{ payment: Payment; tenantUser: User }> = [];

  for (let index = 0; index < leases.length; index++) {
    const leaseContext = leases[index];

    const deposit = await createInvoiceAndPayment({
      ...leaseContext,
      category: InvoiceType.SECURITY_DEPOSIT,
      dueDate: leaseContext.lease.startDate,
      amount: leaseContext.unit.securityDeposit,
      description: "مبلغ التأمين",
      paymentStatus: PaymentStatus.PAID,
      paymentMethod: PaymentMethod.BANK_TRANSFER,
      amountPaid: leaseContext.unit.securityDeposit,
    });

    await db.securityDeposit.create({
      data: {
        organizationId,
        leaseId: leaseContext.lease.id,
        tenantId: leaseContext.tenantUser.id,
        propertyId: leaseContext.property.id,
        unitId: leaseContext.unit.id,
        amount: leaseContext.unit.securityDeposit,
        status: SecurityDepositStatus.COLLECTED,
        collectedDate: new Date(),
        collectedPaymentId: deposit.payment.id,
        notes: "حُصِّل عند توقيع العقد ضمن البيانات التجريبية.",
      },
    });

    invoices.push(deposit.invoice);
    payments.push(deposit.payment);

    for (const monthOffset of [-2, -1, 0, 1]) {
      const dueDate = addMonths(monthStart, monthOffset);
      const description = `Monthly rent - ${monthLabel(dueDate)}`;
      let paymentStatus = PaymentStatus.PAID;
      let amountPaid = leaseContext.unit.rentAmount;
      let paymentMethod: PaymentMethod | undefined =
        PaymentMethod.BANK_TRANSFER;

      if (monthOffset === 0 && index === 0) {
        paymentStatus = PaymentStatus.OVERDUE;
        amountPaid = 0;
        paymentMethod = undefined;
      } else if (monthOffset === 0 && index === 1) {
        paymentStatus = PaymentStatus.PARTIAL;
        amountPaid = Math.round(leaseContext.unit.rentAmount / 2);
        paymentMethod = PaymentMethod.CREDIT_CARD;
      } else if (monthOffset === 1) {
        paymentStatus = PaymentStatus.PENDING;
        amountPaid = 0;
        paymentMethod = undefined;
      }

      const result = await createInvoiceAndPayment({
        ...leaseContext,
        category: InvoiceType.RENT,
        dueDate,
        amount: leaseContext.unit.rentAmount,
        description,
        paymentStatus,
        paymentMethod,
        amountPaid,
      });

      invoices.push(result.invoice);
      payments.push(result.payment);

      if (
        result.payment.status === PaymentStatus.OVERDUE ||
        (result.payment.status === PaymentStatus.PENDING && monthOffset === 1)
      ) {
        notablePayments.push({
          payment: result.payment,
          tenantUser: leaseContext.tenantUser,
        });
      }
    }

    await db.recurringPayment.create({
      data: {
        organizationId,
        tenantId: leaseContext.tenantUser.id,
        propertyId: leaseContext.property.id,
        leaseId: leaseContext.lease.id,
        amount: leaseContext.unit.rentAmount,
        type: PaymentType.RENT,
        frequency: PaymentFrequency.MONTHLY,
        startDate: leaseContext.lease.startDate,
        endDate: leaseContext.lease.endDate,
        nextPaymentDate: addMonths(monthStart, 1),
        isActive: true,
        dayOfMonth: 1,
        description: `Recurring rent for ${leaseContext.property.name} ${leaseContext.unit.unitNumber}`,
        totalPaymentsMade: 3,
        failedPaymentCount: 0,
      },
    });
  }

  for (const { payment, tenantUser } of notablePayments.slice(0, 6)) {
    await db.paymentNotification.create({
      data: {
        organizationId,
        tenantId: payment.tenantId,
        paymentId: payment.id,
        type:
          payment.status === PaymentStatus.OVERDUE ? "overdue" : "reminder",
        status: "pending",
        scheduledDate: new Date(),
        emailAddress: tenantUser.email || "tenant@example.com",
        subject:
          payment.status === PaymentStatus.OVERDUE
            ? "Rent payment overdue"
            : "Upcoming rent reminder",
        message:
          payment.status === PaymentStatus.OVERDUE
            ? "Your rent payment is past due. Please submit payment from the tenant portal."
            : "Your next rent payment is coming due soon.",
      },
    });
  }

  return { payments, invoices };
}

// ============================================================================
// Operations: maintenance, work orders, tickets, expenses, inspections
// ============================================================================

async function createOperationsData(
  users: UsersByEmail,
  leases: LeaseContext[],
) {
  const manager = users["manager@propertypro.com"];
  const maintenance = users["maintenance@propertypro.com"];
  const now = new Date();

  const requestDefinitions = [
    {
      leaseContext: leases[0],
      title: "تسريب في مغسلة المطبخ",
      description: "يوجد تنقيط مياه من الماسورة أسفل مغسلة المطبخ.",
      priority: MaintenancePriority.HIGH,
      status: MaintenanceStatus.IN_PROGRESS,
      category: "Plumbing",
      estimatedCost: 550,
      assignedToId: maintenance.id,
      createdAt: addDays(now, -2),
      notes: "طلب الفني قطعة السيفون البديلة.",
    },
    {
      leaseContext: leases[1],
      title: "تغيير فلتر التكييف",
      description: "انخفض تدفق الهواء ومؤشر الفلتر باللون الأحمر.",
      priority: MaintenancePriority.MEDIUM,
      status: MaintenanceStatus.ASSIGNED,
      category: "HVAC",
      estimatedCost: 230,
      assignedToId: maintenance.id,
      createdAt: addDays(now, -1),
    },
    {
      leaseContext: leases[2],
      title: "بطارية لوحة باب المواقف",
      description: "لوحة المفاتيح الخارجية لا تستجيب بشكل منتظم.",
      priority: MaintenancePriority.LOW,
      status: MaintenanceStatus.COMPLETED,
      category: "Doors",
      estimatedCost: 120,
      actualCost: 95,
      assignedToId: maintenance.id,
      createdAt: addDays(now, -5),
      completedDate: addDays(now, -3),
      notes: "تم تغيير البطارية واختبار اللوحة.",
    },
    {
      leaseContext: leases[3],
      title: "انقطاع الماء الساخن",
      description: "الماء الساخن غير متوفر في دورة المياه والمطبخ.",
      priority: MaintenancePriority.EMERGENCY,
      status: MaintenanceStatus.SUBMITTED,
      category: "Emergency",
      estimatedCost: 875,
      createdAt: now,
    },
    {
      leaseContext: leases[0],
      title: "عزل نافذة غرفة النوم",
      description: "يتسرب الهواء من نافذة غرفة النوم السفلية.",
      priority: MaintenancePriority.MEDIUM,
      status: MaintenanceStatus.COMPLETED,
      category: "Windows",
      estimatedCost: 325,
      actualCost: 290,
      assignedToId: maintenance.id,
      createdAt: addDays(now, -6),
      completedDate: addDays(now, -4),
      notes: "تم تغيير العزل وتنظيف الإطار.",
    },
  ];

  const requests = [];
  for (const definition of requestDefinitions) {
    const request = await db.maintenanceRequest.create({
      data: {
        organizationId,
        propertyId: definition.leaseContext.property.id,
        unitId: definition.leaseContext.unit.id,
        tenantId: definition.leaseContext.tenantUser.id,
        ...(definition.assignedToId
          ? { assignedToId: definition.assignedToId }
          : {}),
        title: definition.title,
        description: definition.description,
        priority: definition.priority,
        status: definition.status,
        category: definition.category,
        ...(definition.leaseContext.tenantUser.phone
          ? { contactPhone: definition.leaseContext.tenantUser.phone }
          : {}),
        estimatedCost: definition.estimatedCost,
        ...(definition.actualCost !== undefined
          ? { actualCost: definition.actualCost }
          : {}),
        ...(definition.completedDate
          ? { completedDate: definition.completedDate }
          : {}),
        ...(definition.notes ? { notes: definition.notes } : {}),
        createdAt: definition.createdAt,
      },
    });
    requests.push(request);
  }

  const workOrderDefinitions = [
    {
      maintenanceRequestId: requests[0].id,
      title: "إصلاح سيفون المغسلة",
      description: "استبدال السيفون واختبار التسريب.",
      status: WorkOrderStatus.IN_PROGRESS,
      priority: MaintenancePriority.HIGH,
      estimatedCost: 550,
      scheduledDate: addDays(new Date(), 1),
      materials: ["Trap assembly", "Plumber putty"],
      laborHours: 1.5,
    },
    {
      maintenanceRequestId: requests[1].id,
      title: "استبدال فلتر التكييف",
      description: "تركيب فلتر جديد وفحص وحدة مناولة الهواء.",
      status: WorkOrderStatus.ASSIGNED,
      priority: MaintenancePriority.MEDIUM,
      estimatedCost: 230,
      scheduledDate: addDays(new Date(), 2),
      materials: ["20x25x1 filter"],
      laborHours: 0.75,
    },
    {
      maintenanceRequestId: requests[2].id,
      title: "استبدال بطارية اللوحة",
      description: "تغيير البطارية والتأكد من عمل لوحة باب المواقف.",
      status: WorkOrderStatus.COMPLETED,
      priority: MaintenancePriority.LOW,
      estimatedCost: 120,
      actualCost: 95,
      scheduledDate: new Date(),
      completedDate: new Date(Date.now() + 120000),
      materials: ["9V battery"],
      laborHours: 0.25,
    },
  ];

  for (const definition of workOrderDefinitions) {
    await db.workOrder.create({
      data: {
        organizationId,
        assignedToId: maintenance.id,
        ...definition,
      },
    });
  }

  await db.ticket.create({
    data: {
      organizationId,
      ticketNumber: await nextTicketNumber(),
      tenantId: leases[0].tenantUser.id,
      propertyId: leases[0].property.id,
      unitId: leases[0].unit.id,
      assignedToId: manager.id,
      createdByUserId: leases[0].tenantUser.id,
      createdByRole: UserRole.TENANT,
      title: "استفسار عن رفع وثيقة التأمين",
      description: "رفعت الوثيقة ولا زال التنبيه ظاهراً.",
      category: TicketCategory.GENERAL,
      priority: TicketPriority.MEDIUM,
      status: TicketStatus.OPEN,
      comments: toJson([
        {
          id: crypto.randomUUID(),
          userId: manager.id,
          message: "نقوم بمراجعة حالة المستند الآن.",
          attachments: [],
          isInternal: false,
          createdAt: iso(new Date()),
        },
      ]),
    },
  });

  await db.ticket.create({
    data: {
      organizationId,
      ticketNumber: await nextTicketNumber(),
      tenantId: leases[1].tenantUser.id,
      propertyId: leases[1].property.id,
      unitId: leases[1].unit.id,
      assignedToId: manager.id,
      createdByUserId: leases[1].tenantUser.id,
      createdByRole: UserRole.TENANT,
      title: "خطة سداد جزئي",
      description: "يرجى تأكيد تاريخ استحقاق المبلغ المتبقي.",
      category: TicketCategory.BILLING,
      priority: TicketPriority.HIGH,
      status: TicketStatus.IN_PROGRESS,
    },
  });

  await db.ticket.create({
    data: {
      organizationId,
      ticketNumber: await nextTicketNumber(),
      tenantId: leases[2].tenantUser.id,
      propertyId: leases[2].property.id,
      unitId: leases[2].unit.id,
      createdByUserId: leases[2].tenantUser.id,
      createdByRole: UserRole.TENANT,
      title: "استفسار عن موقف الجيران",
      description: "توجد مركبة زائر متوقفة أمام موقفي.",
      category: TicketCategory.GENERAL,
      priority: TicketPriority.LOW,
      status: TicketStatus.RESOLVED,
    },
  });

  const expenseDefinitions = [
    {
      propertyId: leases[0].property.id,
      unitId: leases[0].unit.id,
      category: ExpenseCategory.MAINTENANCE,
      description: "قطع سباكة لوحدة A101 - شقق الواحة",
      amount: 216.13,
      date: addDays(new Date(), -3),
      paymentMethod: PaymentMethod.CREDIT_CARD,
      referenceNumber: "EXP-DEMO-PLUMBING",
      status: ExpenseStatus.PAID,
    },
    {
      propertyId: leases[1].property.id,
      category: ExpenseCategory.UTILITIES,
      description: "فاتورة كهرباء المرافق المشتركة",
      amount: 1025.55,
      date: addDays(new Date(), -7),
      paymentMethod: PaymentMethod.ACH,
      referenceNumber: "EXP-DEMO-ELECTRIC",
      status: ExpenseStatus.PAID,
    },
    {
      propertyId: leases[2].property.id,
      category: ExpenseCategory.LANDSCAPING,
      description: "تنظيف الفناء الموسمي",
      amount: 1687.50,
      date: addDays(new Date(), -12),
      paymentMethod: PaymentMethod.CHECK,
      referenceNumber: "EXP-DEMO-LAWN",
      status: ExpenseStatus.APPROVED,
    },
  ];

  for (const definition of expenseDefinitions) {
    await db.expense.create({
      data: {
        organizationId,
        taxDeductible: true,
        createdById: manager.id,
        ...definition,
      },
    });
  }

  // Inspection.tenantId references the tenant USER id in the Prisma schema.
  await db.inspection.create({
    data: {
      organizationId,
      propertyId: leases[0].property.id,
      tenantId: leases[0].tenantUser.id,
      leaseId: leases[0].lease.id,
      type: InspectionType.MOVE_IN,
      status: "completed",
      scheduledDate: new Date(Date.now() + 120000),
      completedDate: new Date(Date.now() + 180000),
      inspectorId: manager.id,
      overallCondition: "good",
      items: toJson([
        {
          room: "Kitchen",
          item: "Appliances",
          condition: "good",
          notes: "جميع الأجهزة تعمل بشكل سليم.",
          requiresAttention: false,
        },
        {
          room: "Bedroom",
          item: "Window seal",
          condition: "fair",
          notes: "تم تغيير العزل لاحقاً عبر طلب صيانة.",
          requiresAttention: true,
        },
      ]),
      inspectorSignature: toJson({
        signature: "demo-inspector-signature",
      }),
    },
  });

  await db.inspection.create({
    data: {
      organizationId,
      propertyId: leases[2].property.id,
      tenantId: leases[2].tenantUser.id,
      leaseId: leases[2].lease.id,
      type: InspectionType.ROUTINE,
      status: "scheduled",
      scheduledDate: addDays(new Date(), 14),
      inspectorId: manager.id,
      items: toJson([]),
    },
  });

  return requests;
}

// ============================================================================
// Documents & templates
// ============================================================================

async function createDocumentsAndTemplates(
  users: UsersByEmail,
  tenants: TenantsByUserId,
  leases: LeaseContext[],
) {
  const admin = users["admin@propertypro.com"];

  await db.documentTemplate.create({
    data: {
      organizationId,
      name: "عقد إيجار سكني موحّد",
      description:
        "قالب عقد تجريبي يشمل متغيرات المستأجر والعقار والدفعات.",
      category: "lease",
      type: "residential_lease",
      version: "1.0.0",
      content:
        "هذا العقد مبرم بين {{company_name}} و{{tenant_name}} بشأن {{property_address}}.",
      variables: toJson([
        {
          name: "tenant_name",
          label: "اسم المستأجر",
          type: "text",
          required: true,
        },
        {
          name: "property_address",
          label: "عنوان العقار",
          type: "text",
          required: true,
        },
      ]),
      createdById: admin.id,
      isPublic: true,
      allowedRoles: [UserRole.ADMIN, UserRole.MANAGER],
      status: "active",
    },
  });

  await db.documentTemplate.create({
    data: {
      organizationId,
      name: "إشعار صيانة",
      description: "قالب إشعار قصير لأعمال الصيانة المجدولة.",
      category: "notice",
      type: "maintenance_notice",
      version: "1.0.0",
      content:
        "الصيانة مجدولة بتاريخ {{scheduled_date}} في {{property_name}}.",
      createdById: admin.id,
      isPublic: true,
      allowedRoles: [UserRole.ADMIN, UserRole.MANAGER],
      status: "active",
    },
  });

  const sharingDefaults = {
    isPublic: false,
    allowDownload: true,
    allowPrint: true,
    passwordProtected: false,
    currentDownloads: 0,
  };

  await db.document.create({
    data: {
      organizationId,
      name: "عقد إيجار سارة الحربي",
      description: "عقد إيجار تجريبي موقّع.",
      type: "lease",
      category: "lease",
      fileUrl: "/uploads/demo/emma-lease.pdf",
      fileSize: 245760,
      mimeType: "application/pdf",
      uploadedById: admin.id,
      // Document.tenantId keeps the Tenant PROFILE id (the tenant documents
      // route matches on tenantProfile.id); sharedWith carries USER ids.
      tenantId: tenants[leases[0].tenantUser.id].id,
      propertyId: leases[0].property.id,
      leaseId: leases[0].lease.id,
      sharedWith: [leases[0].tenantUser.id],
      tags: ["lease", "signed", "demo"],
      status: "signed",
      isRequired: true,
      requiresSignature: false,
      versions: toJson([
        {
          version: 1,
          fileUrl: "/uploads/demo/emma-lease.pdf",
          fileSize: 245760,
          uploadedBy: admin.id,
          changeLog: "Initial signed lease.",
        },
      ]),
      sharing: toJson(sharingDefaults),
      metadata: toJson({
        author: "بروبرتي برو - بيانات تجريبية",
        keywords: ["lease"],
        language: "ar",
      }),
      encryption: toJson({ isEncrypted: false }),
      compliance: toJson({ legalHold: false, retentionPeriod: 2555 }),
    },
  });

  await db.document.create({
    data: {
      organizationId,
      name: "شهادة تأمين شقق الواحة",
      description: "إثبات تأمين العقار للمحفظة التجريبية.",
      type: "insurance",
      category: "insurance",
      fileUrl: "/uploads/demo/harbor-insurance.pdf",
      fileSize: 180224,
      mimeType: "application/pdf",
      uploadedById: admin.id,
      propertyId: leases[0].property.id,
      tags: ["insurance", "property"],
      status: "active",
      isRequired: false,
      requiresSignature: false,
      sharing: toJson(sharingDefaults),
      metadata: toJson({
        author: "بروبرتي برو - بيانات تجريبية",
        keywords: ["insurance"],
        language: "ar",
      }),
      encryption: toJson({ isEncrypted: false }),
      compliance: toJson({ legalHold: false }),
    },
  });

  await db.document.create({
    data: {
      organizationId,
      name: "قائمة استلام فلل ساحة النخيل",
      description: "قائمة فحص حالة الوحدة عند الاستلام للعقد التجريبي.",
      type: "inspection",
      category: "lease",
      fileUrl: "/uploads/demo/maple-move-in.pdf",
      fileSize: 132096,
      mimeType: "application/pdf",
      uploadedById: admin.id,
      tenantId: tenants[leases[2].tenantUser.id].id,
      propertyId: leases[2].property.id,
      leaseId: leases[2].lease.id,
      sharedWith: [leases[2].tenantUser.id],
      tags: ["inspection", "move-in"],
      status: "active",
      isRequired: true,
      requiresSignature: false,
      sharing: toJson(sharingDefaults),
      metadata: toJson({
        author: "بروبرتي برو - بيانات تجريبية",
        keywords: ["inspection"],
        language: "ar",
      }),
      encryption: toJson({ isEncrypted: false }),
      compliance: toJson({ legalHold: false }),
    },
  });
}

// ============================================================================
// Messaging
// ============================================================================

async function createMessagingData(
  users: UsersByEmail,
  leases: LeaseContext[],
) {
  const manager = users["manager@propertypro.com"];
  const messageCount = { messages: 0 };

  for (const leaseContext of leases) {
    const tenantUser = leaseContext.tenantUser;

    // Individual conversation: participants Json + mirrored participantIds,
    // exactly like the old createIndividualConversation static.
    const participants = [
      makeParticipant(manager.id),
      makeParticipant(tenantUser.id),
    ];

    const conversation = await db.conversation.create({
      data: {
        organizationId,
        type: "individual",
        participants: participantsAsJson(participants),
        participantIds: activeParticipantIds(participants),
        createdById: manager.id,
        propertyId: leaseContext.property.id,
        metadata: toJson({
          totalMessages: 0,
          totalParticipants: 2,
          lastActivity: iso(new Date()),
        }),
      },
    });

    const first = await db.message.create({
      data: {
        organizationId,
        conversationId: conversation.id,
        senderId: manager.id,
        recipientId: tenantUser.id,
        propertyId: leaseContext.property.id,
        subject: "مرحباً بك في بوابة المستأجر",
        content:
          "مرحباً بك. يمكنك هنا الاطلاع على عقدك وسداد الإيجار ورفع المستندات وتقديم طلبات الصيانة.",
        messageType: "general",
        priority: "normal",
        status: "read",
        readBy: toJson([
          { userId: tenantUser.id, readAt: iso(new Date()) },
        ]),
      },
    });

    const second = await db.message.create({
      data: {
        organizationId,
        conversationId: conversation.id,
        senderId: tenantUser.id,
        recipientId: manager.id,
        propertyId: leaseContext.property.id,
        subject: "رد: مرحباً بك في بوابة المستأجر",
        content: "شكراً، وجدت صفحة سداد الإيجار ومستندات العقد.",
        messageType: "general",
        priority: "normal",
        status: "delivered",
      },
    });

    await db.messageStatus.create({
      data: {
        organizationId,
        messageId: first.id,
        conversationId: conversation.id,
        senderId: manager.id,
        recipientId: tenantUser.id,
        status: "read",
        deliveredAt: new Date(),
        readAt: new Date(),
      },
    });

    await db.messageStatus.create({
      data: {
        organizationId,
        messageId: second.id,
        conversationId: conversation.id,
        senderId: tenantUser.id,
        recipientId: manager.id,
        status: "delivered",
        deliveredAt: new Date(),
      },
    });

    // Maintain the conversation's lastMessage cache + message counters, the
    // way the messaging service does after each send.
    await db.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessage: toJson(
          buildLastMessagePayload(
            {
              id: second.id,
              content: second.content,
              senderId: second.senderId,
              createdAt: second.createdAt,
              messageType: second.messageType,
            },
            `${tenantUser.firstName} ${tenantUser.lastName}`,
          ),
        ),
        metadata: toJson({
          totalMessages: 2,
          totalParticipants: 2,
          lastActivity: iso(second.createdAt),
        }),
      },
    });

    messageCount.messages += 2;
  }

  return messageCount.messages;
}

// ============================================================================
// Calendar, announcements, notifications
// ============================================================================

async function createCalendarAndCommunications(
  users: UsersByEmail,
  leases: LeaseContext[],
  maintenanceRequests: Array<{ id: string }>,
) {
  const admin = users["admin@propertypro.com"];
  const manager = users["manager@propertypro.com"];

  const inspectionAttendees = [
    {
      userId: leases[0].tenantUser.id,
      email: leases[0].tenantUser.email,
      name: `${leases[0].tenantUser.firstName} ${leases[0].tenantUser.lastName}`,
      role: UserRole.TENANT,
      status: "accepted",
    },
  ];

  await db.event.create({
    data: {
      organizationId,
      title: "جولة تفتيش دورية - شقق الواحة",
      description: "تفتيش ربع سنوي للمرافق المشتركة ووحدات مختارة.",
      type: EventType.PROPERTY_INSPECTION,
      status: EventStatus.SCHEDULED,
      priority: EventPriority.MEDIUM,
      startDate: addDays(new Date(), 7),
      endDate: addDays(new Date(), 7),
      allDay: false,
      timezone: "Asia/Riyadh",
      location: toJson({
        type: LocationType.PHYSICAL,
        address: fullAddress(leases[0].property),
      }),
      propertyId: leases[0].property.id,
      organizerId: manager.id,
      attendees: toJson(inspectionAttendees),
      attendeeIds: inspectionAttendees.map((attendee) => attendee.userId),
      reminders: toJson([{ type: "email", minutesBefore: 1440, sent: false }]),
      createdById: manager.id,
    },
  });

  const checkInAttendees = [
    {
      userId: leases[2].tenantUser.id,
      email: leases[2].tenantUser.email,
      name: `${leases[2].tenantUser.firstName} ${leases[2].tenantUser.lastName}`,
      role: UserRole.TENANT,
      status: "pending",
    },
  ];

  await db.event.create({
    data: {
      organizationId,
      title: "متابعة عقد - فلل ساحة النخيل",
      description: "متابعة رضا المستأجر في منتصف المدة.",
      type: EventType.TENANT_MEETING,
      status: EventStatus.CONFIRMED,
      priority: EventPriority.LOW,
      startDate: addDays(new Date(), 10),
      endDate: addDays(new Date(), 10),
      allDay: false,
      timezone: "Asia/Riyadh",
      location: toJson({
        type: LocationType.PHYSICAL,
        address: fullAddress(leases[2].property),
      }),
      propertyId: leases[2].property.id,
      leaseId: leases[2].lease.id,
      organizerId: manager.id,
      attendees: toJson(checkInAttendees),
      attendeeIds: checkInAttendees.map((attendee) => attendee.userId),
      reminders: toJson([{ type: "in_app", minutesBefore: 120, sent: false }]),
      createdById: manager.id,
    },
  });

  await db.event.create({
    data: {
      organizationId,
      title: "موعد إصلاح مغسلة المطبخ",
      description: "زيارة فني لإصلاح مغسلة الوحدة A101.",
      type: EventType.MAINTENANCE_APPOINTMENT,
      status: EventStatus.SCHEDULED,
      priority: EventPriority.HIGH,
      startDate: addDays(new Date(), 1),
      endDate: addDays(new Date(), 1),
      allDay: false,
      timezone: "Asia/Riyadh",
      propertyId: leases[0].property.id,
      leaseId: leases[0].lease.id,
      maintenanceRequestId: maintenanceRequests[0].id,
      organizerId: manager.id,
      attendees: toJson([]),
      attendeeIds: [],
      reminders: toJson([{ type: "email", minutesBefore: 60, sent: false }]),
      createdById: manager.id,
    },
  });

  await db.announcement.create({
    data: {
      organizationId,
      title: "مرحباً بك في النسخة التجريبية من بروبرتي برو",
      content:
        "تحتوي هذه النسخة على عقارات وعقود ودفعات وطلبات صيانة ومستندات ورسائل وتقارير واقعية.",
      priority: "normal",
      type: "general",
      targetAudience: toJson({ includeAll: true }),
      publishedAt: new Date(),
      status: "published",
      isSticky: true,
      allowComments: true,
      createdById: admin.id,
      views: toJson([
        { userId: manager.id, viewedAt: iso(new Date()) },
        { userId: leases[0].tenantUser.id, viewedAt: iso(new Date()) },
      ]),
      reactions: toJson([
        { userId: manager.id, type: "helpful", createdAt: iso(new Date()) },
      ]),
    },
  });

  await db.announcement.create({
    data: {
      organizationId,
      title: "انقطاع المياه - شقق الواحة",
      content:
        "ستنقطع خدمة المياه في شقق الواحة يوم السبت القادم من الساعة ٩ صباحاً حتى الظهر لأعمال صيانة مجدولة.",
      priority: "high",
      type: "maintenance",
      targetAudience: toJson({
        propertyIds: [leases[0].property.id],
        includeAll: false,
      }),
      publishedAt: new Date(),
      expiresAt: addDays(new Date(), 14),
      status: "published",
      isSticky: false,
      allowComments: true,
      createdById: admin.id,
    },
  });

  await db.announcement.create({
    data: {
      organizationId,
      title: "تحديث سياسة المواقف",
      content:
        "يجب طلب تصريح موقف الزوار عبر بوابة المستأجر قبل المبيت.",
      priority: "normal",
      type: "policy",
      targetAudience: toJson({
        roles: [UserRole.TENANT],
        includeAll: false,
      }),
      publishedAt: new Date(),
      status: "published",
      isSticky: false,
      allowComments: false,
      createdById: admin.id,
    },
  });

  for (const leaseContext of leases) {
    await db.notification.create({
      data: {
        organizationId,
        userId: leaseContext.tenantUser.id,
        title: "تذكير بالإيجار",
        message: "فاتورة الإيجار القادمة متاحة في بوابة المستأجر.",
        type: "payment",
        priority: "normal",
        read: false,
        actionUrl: "/dashboard/payments",
        metadata: toJson({ leaseId: leaseContext.lease.id }),
      },
    });

    const isFirstLease = leaseContext === leases[0];
    await db.notification.create({
      data: {
        organizationId,
        userId: leaseContext.tenantUser.id,
        title: "مستند العقد جاهز",
        message: "يوجد مستند عقد متاح للمراجعة.",
        type: "document",
        priority: "medium",
        read: !isFirstLease,
        ...(isFirstLease ? {} : { readAt: new Date() }),
        actionUrl: "/dashboard/leases/documents",
        metadata: toJson({ propertyId: leaseContext.property.id }),
      },
    });
  }

  await db.notification.create({
    data: {
      organizationId,
      userId: manager.id,
      title: "تحديث قائمة الصيانة",
      message: "توجد طلبات صيانة نشطة مسندة اليوم.",
      type: "maintenance",
      priority: "high",
      read: false,
      actionUrl: "/dashboard/maintenance",
    },
  });
}

// ============================================================================
// Audit logs
// ============================================================================

async function createAuditLogs(users: UsersByEmail, leases: LeaseContext[]) {
  const admin = users["admin@propertypro.com"];
  const manager = users["manager@propertypro.com"];

  await db.auditLog.create({
    data: {
      organizationId,
      category: AuditCategory.AUTHENTICATION,
      action: AuditAction.LOGIN,
      severity: AuditSeverity.LOW,
      userId: admin.id,
      userEmail: admin.email,
      userRole: admin.role,
      description: "سجّل المدير التجريبي الدخول.",
      source: "web",
      tags: ["demo", "auth"],
    },
  });

  await db.auditLog.create({
    data: {
      organizationId,
      category: AuditCategory.PROPERTY_MANAGEMENT,
      action: AuditAction.CREATE,
      severity: AuditSeverity.MEDIUM,
      userId: manager.id,
      userEmail: manager.email,
      userRole: manager.role,
      resourceType: "property",
      resourceId: leases[0].property.id,
      resourceName: leases[0].property.name,
      description: "تم إنشاء المحفظة العقارية التجريبية.",
      source: "system",
      tags: ["demo", "property"],
    },
  });

  await db.auditLog.create({
    data: {
      organizationId,
      category: AuditCategory.PAYMENT_MANAGEMENT,
      action: AuditAction.PAYMENT_PROCESSED,
      severity: AuditSeverity.LOW,
      userId: leases[0].tenantUser.id,
      userEmail: leases[0].tenantUser.email,
      userRole: leases[0].tenantUser.role,
      resourceType: "payment",
      description: "تم تسجيل حركة سداد إيجار تجريبية.",
      source: "system",
      tags: ["demo", "payment"],
    },
  });
}

// ============================================================================
// Runner
// ============================================================================

async function runSeed() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 9, 0, 0, 0);
  const leaseStart = addMonths(monthStart, -4);
  const leaseEnd = addMonths(leaseStart, 12);

  await assertDatabaseIsReadyForSeed();

  // Before any organization exists, because this account belongs to none.
  await createPlatformSuperAdmin();

  // Organization + owner admin + the 3 system roles come from the real
  // provisioning path (runs with RLS bypassed, before any org context).
  const provisioned = await provisionOrganization({
    organizationName: companyInfo.name,
    slug: "propertypro-demo",
    status: "active",
    owner: {
      firstName: "عبدالله",
      lastName: "السبيعي",
      email: "admin@propertypro.com",
      password: DEMO_PASSWORDS["admin@propertypro.com"],
      phone: "+966501230100",
    },
    // Stated rather than left to the column defaults, so the demo says which
    // market it is a demo of and does not quietly change meaning if those
    // defaults ever move. See lib/regional/region.ts.
    defaults: {
      currency: DEFAULT_CURRENCY,
      timezone: DEFAULT_TIMEZONE,
      language: DEFAULT_LANGUAGE,
    },
  });
  organizationId = provisioned.organizationId;

  return runWithOrgContext(
    { organizationId, isPlatformAdmin: false },
    async () => {
      const users = await createUsers(provisioned.ownerId);

      await createOwnerProfiles(users);
      const compounds = await createCompounds(users);
      const properties = await createProperties(users, compounds);
      await createAgreements(users, compounds, properties, monthStart);
      const tenants = await createTenantProfiles(users, leaseStart);
      await createApplications(users, properties);

      const leases = await createLeases(
        users,
        properties,
        leaseStart,
        leaseEnd,
      );

      await createFinancialData(leases, monthStart);
      const maintenanceRequests = await createOperationsData(users, leases);
      await createDocumentsAndTemplates(users, tenants, leases);
      await createMessagingData(users, leases);
      await createCalendarAndCommunications(users, leases, maintenanceRequests);
      await createAuditLogs(users, leases);

      return {
        organization: `${companyInfo.name} (${provisioned.slug})`,
        users: await db.user.count(),
        roles: await db.role.count(),
        compounds: await db.compound.count(),
        properties: await db.property.count(),
        units: await db.unit.count(),
        tenantProfiles: await db.tenant.count(),
        applications: await db.application.count(),
        platformSuperAdmin: DEMO_PLATFORM_ADMIN.email,
        agreements: await db.agreement.count(),
        leases: await db.lease.count(),
        invoices: await db.invoice.count(),
        payments: await db.payment.count(),
        paymentReceipts: await db.paymentReceipt.count(),
        paymentNotifications: await db.paymentNotification.count(),
        recurringPayments: await db.recurringPayment.count(),
        securityDeposits: await db.securityDeposit.count(),
        maintenanceRequests: await db.maintenanceRequest.count(),
        workOrders: await db.workOrder.count(),
        tickets: await db.ticket.count(),
        expenses: await db.expense.count(),
        inspections: await db.inspection.count(),
        documents: await db.document.count(),
        documentTemplates: await db.documentTemplate.count(),
        conversations: await db.conversation.count(),
        messages: await db.message.count(),
        messageStatuses: await db.messageStatus.count(),
        notifications: await db.notification.count(),
        events: await db.event.count(),
        announcements: await db.announcement.count(),
        auditLogs: await db.auditLog.count(),
        demoAccounts: {
          admin: "admin@propertypro.com / Admin123$",
          manager: "manager@propertypro.com / Manager123$",
          maintenance: "maintenance@propertypro.com / Maintenance123$",
          tenant: "tenant@propertypro.com / Tenant123$",
          applicant: "maya.chen@example.com / Applicant123$",
        },
      };
    },
  );
}

if (process.env.PROPERTYPRO_SCRIPT_IMPORT_ONLY !== "true") {
  runSeed()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((error) => {
      console.error("Demo seed failed:", error?.message || error);
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await basePrisma.$disconnect().catch(() => undefined);
    });
}
