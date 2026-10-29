/**
 * PropertyPro - Core Type Definitions
 * Comprehensive TypeScript interfaces for the Property Management System
 */

// ---------------------------------------------------------------------------
// Mongo-era structural aliases. Rows are plain objects with string ids on
// PostgreSQL; these keep the legacy interface declarations compiling while
// consumers migrate to the Prisma-generated types in @/generated/prisma.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface Document {}
// Declaration-merging shim, like the `Document` interface above it: the
// legacy interfaces below still say `Types.ObjectId`, and a module export
// would mean editing every one of them. Goes when they do.
// eslint-disable-next-line @typescript-eslint/no-namespace
namespace Types {
  export type ObjectId = string;
}

// ============================================================================
// USER TYPES - MULTI-TENANT SAAS ARCHITECTURE
// ============================================================================
// Each Organization (the SaaS account) has its own users, isolated by
// `organizationId`. ADMIN and MANAGER are office staff; OWNER and TENANT are
// the office's clients, each scoped to their own rows by lib/db/scopes.ts.
// SUPER_ADMIN is the platform owner tier that operates above all
// organizations (organizationId is null).

export enum UserRole {
  SUPER_ADMIN = "super_admin", // Platform owner - manages all organizations
  ADMIN = "admin", // Organization Admin - full access within their org
  MANAGER = "manager", // Organization Manager - management access within their org
  OWNER = "owner", // Property owner - read access to their own buildings only
  TENANT = "tenant", // Tenant - Limited access to own data
}

// ============================================================================
// ROLE MANAGEMENT TYPES
// ============================================================================

export interface IRoleConfig {
  _id?: string;
  name: string;
  label: string;
  /** The name an Arabic screen shows, when the group has one. */
  labelAr?: string | null;
  description: string;
  permissions: string[];
  isSystem: boolean;
  isActive: boolean;
  color: "default" | "destructive" | "outline" | "secondary";
  userCount: number;
  canEdit: boolean;
  canDelete: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// User instance methods interface
// (Password checks live in verifyUserPassword() from @/lib/auth-credentials —
// the hash is on the Better Auth account record, not the user document.)
export interface IUserMethods {
  updateLastLogin(): Promise<Document>;
  incrementLoginAttempts(): Promise<Document>;
  resetLoginAttempts(): Promise<Document>;
  changeStatus(
    newStatus: string,
    changedBy: string,
    reason?: string,
    notes?: string,
    moveDate?: Date
  ): Promise<Document>;
  approveApplication(
    changedBy: string,
    reason?: string,
    notes?: string
  ): Promise<Document>;
  rejectApplication(
    changedBy: string,
    reason?: string,
    notes?: string
  ): Promise<Document>;
  moveIn(date?: Date, changedBy?: string, leaseId?: string): Promise<Document>;
  moveOut(date?: Date, changedBy?: string, reason?: string): Promise<Document>;
  softDelete(): Promise<Document>;
  restore(): Promise<Document>;
}

export interface IUser extends Document, IUserMethods {
  _id: Types.ObjectId;
  /** Owning organization (SaaS account). Null only for platform super-admins. */
  organizationId?: Types.ObjectId | string | null;
  email: string;
  password?: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: string;
  /**
   * What a permission group is called, sent beside `role` by the routes that
   * list people: the stored role name is a key ("group_2"), not a name.
   * Absent for the built-in roles, which are named in the reader's language.
   */
  roleLabel?: string | null;
  roleLabelAr?: string | null;
  /** True when this employee sees only the buildings assigned to them. */
  scopeRestricted?: boolean;
  avatar?: string;
  bio?: string;
  location?: string;
  city?: string;
  website?: string;
  address?: string;
  isActive: boolean;
  emailVerified?: Date;
  /** Better Auth's boolean view of emailVerified; derived by User model hooks. */
  emailVerifiedFlag?: boolean;
  /** Better Auth's combined display name; derived from firstName/lastName. */
  name?: string;
  lastLogin?: Date;
  passwordChangedAt?: Date;
  failedLoginAttempts?: number;
  isLocked?: boolean;
  lockedUntil?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  // Tenant-specific fields (only applicable when role is 'tenant')
  dateOfBirth?: Date;
  ssn?: string; // Encrypted
  employmentInfo?: {
    employer: string;
    position: string;
    income: number;
    startDate: Date;
  };
  emergencyContacts: IEmergencyContact[];
  documents: string[]; // File paths
  creditScore?: number;
  backgroundCheckStatus?: "pending" | "approved" | "rejected";
  // Enhanced tenant status management
  tenantStatus?:
    | "application_submitted"
    | "under_review"
    | "approved"
    | "active"
    | "inactive"
    | "moved_out"
    | "terminated";
  applicationDate: Date;
  moveInDate?: Date;
  moveOutDate?: Date;
  // Additional tenant fields
  screeningScore?: number;
  applicationNotes?: string;
  currentLeaseId?: Types.ObjectId;
  leaseHistory?: Array<{
    leaseId: Types.ObjectId;
    startDate: Date;
    endDate?: Date;
    status: "active" | "completed" | "terminated" | "cancelled";
  }>;
  statusHistory?: Array<{
    status: string;
    changedBy: Types.ObjectId;
    changedAt: Date;
    reason?: string;
    notes?: string;
  }>;
  preferredContactMethod?: "email" | "phone" | "text" | "app";
  emergencyContactVerified?: boolean;
  backgroundCheckCompletedAt?: Date;
  lastStatusUpdate?: Date;
  // Third-party integrations
  integrations?: {
    googleCalendar?: {
      connected?: boolean;
      accessToken?: string;
      refreshToken?: string;
      expiryDate?: Date;
      connectedAt?: Date;
      lastSync?: Date;
      autoSync?: boolean;
      selectedCalendarId?: string;
      syncDirection?: "import" | "export" | "bidirectional";
      syncInterval?: number;
    };
  };
  // Notification preferences
  notificationPreferences?: {
    calendar?: {
      email?: {
        enabled?: boolean;
        invitations?: boolean;
        reminders?: boolean;
        updates?: boolean;
        cancellations?: boolean;
        dailyDigest?: boolean;
        weeklyDigest?: boolean;
      };
      sms?: {
        enabled?: boolean;
        reminders?: boolean;
        urgentUpdates?: boolean;
      };
      push?: {
        enabled?: boolean;
        reminders?: boolean;
        updates?: boolean;
        invitations?: boolean;
      };
      reminderTiming?: {
        default?: number[];
        highPriority?: number[];
        lowPriority?: number[];
      };
      digestTiming?: {
        dailyTime?: string;
        weeklyDay?: number;
        weeklyTime?: string;
      };
      quietHours?: {
        enabled?: boolean;
        startTime?: string;
        endTime?: string;
        timezone?: string;
      };
    };
  };
}

// ============================================================================
// PROPERTY TYPES
// ============================================================================

export enum PropertyType {
  APARTMENT = "apartment",
  HOUSE = "house",
  CONDO = "condo",
  TOWNHOUSE = "townhouse",
  COMMERCIAL = "commercial",
  OFFICE = "office",
  RETAIL = "retail",
}

export enum PropertyStatus {
  AVAILABLE = "available",
  OCCUPIED = "occupied",
  MAINTENANCE = "maintenance",
  UNAVAILABLE = "unavailable",
}

export interface IAddress {
  street: string;
  city: string;
  /**
   * Neighbourhood (حي). Optional because not every market has the tier and
   * no address recorded before it existed carries one.
   */
  district?: string;
  state: string;
  zipCode: string;
  country: string;
}

export interface IAmenity {
  name: string;
  description?: string;
  category: string;
}

export interface IPropertyAttachment {
  fileName: string;
  fileUrl: string;
  fileSize: number;
  fileType: string;
  uploadedAt: Date;
  uploadedBy?: Types.ObjectId;
}

// Embedded Unit Interface for unified property-unit model
export interface IEmbeddedUnit {
  _id?: Types.ObjectId;
  unitNumber: string;
  unitType: string;
  floor?: number;
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  rentAmount: number;
  securityDeposit: number;
  status: PropertyStatus;

  // Unit-specific features
  balcony?: boolean;
  patio?: boolean;
  garden?: boolean;
  dishwasher?: boolean;
  inUnitLaundry?: boolean;
  hardwoodFloors?: boolean;
  fireplace?: boolean;
  walkInClosets?: boolean;
  centralAir?: boolean;
  ceilingFans?: boolean;

  // Appliances
  appliances?: {
    refrigerator?: boolean;
    stove?: boolean;
    oven?: boolean;
    microwave?: boolean;
    dishwasher?: boolean;
    washer?: boolean;
    dryer?: boolean;
    washerDryerHookups?: boolean;
  };

  // Parking
  parking?: {
    included: boolean;
    spaces?: number;
    type?: "garage" | "covered" | "open" | "street";
    gated?: boolean;
    assigned?: boolean;
  };

  // Utilities
  utilities?: {
    electricity?: "included" | "tenant" | "shared";
    water?: "included" | "tenant" | "shared";
    gas?: "included" | "tenant" | "shared";
    internet?: "included" | "tenant" | "shared";
    cable?: "included" | "tenant" | "shared";
    heating?: "included" | "tenant" | "shared";
    cooling?: "included" | "tenant" | "shared";
    trash?: "included" | "tenant" | "shared";
    sewer?: "included" | "tenant" | "shared";
  };

  // Additional details
  notes?: string;
  images?: string[];
  availableFrom?: Date;
  lastRenovated?: Date;

  attachments?: IPropertyAttachment[];

  // Current tenant information
  currentTenantId?: Types.ObjectId;
  currentLeaseId?: Types.ObjectId;
}

export interface IProperty extends Document {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  type: PropertyType;
  status: PropertyStatus;
  address: IAddress;
  // Note: bedrooms, bathrooms, squareFootage, rentAmount, securityDeposit
  // are now stored only at the unit level in the units array
  yearBuilt?: number;
  amenities: IAmenity[];

  // Enhanced fields
  isMultiUnit: boolean;
  totalUnits: number;
  // Unified approach: units are embedded in the property document
  units: IEmbeddedUnit[];
  attachments: IPropertyAttachment[];

  images: string[];
  ownerId: Types.ObjectId;
  managerId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;

  // Instance methods for property status management
  calculatePropertyStatus(): PropertyStatus;
  updatePropertyStatusFromUnits(): Promise<PropertyStatus>;
  updateStatus(status: PropertyStatus): Promise<IProperty>;
  softDelete(): Promise<IProperty>;
  restore(): Promise<IProperty>;
}

// ============================================================================
// UNIT TYPES
// ============================================================================

export interface IUnitParking {
  included: boolean;
  spaces?: number;
  type?: "garage" | "covered" | "open" | "street";
}

export interface IUnitUtilities {
  electricity?: "included" | "tenant" | "shared";
  water?: "included" | "tenant" | "shared";
  gas?: "included" | "tenant" | "shared";
  internet?: "included" | "tenant" | "shared";
  cable?: "included" | "tenant" | "shared";
  heating?: "included" | "tenant" | "shared";
  cooling?: "included" | "tenant" | "shared";
}

// ============================================================================
// TENANT TYPES
// ============================================================================

export interface IEmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  email?: string;
}

export interface ITenant extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  dateOfBirth?: Date;
  ssn?: string; // Encrypted
  employmentInfo?: {
    employer: string;
    position: string;
    income: number;
    startDate: Date;
  };
  emergencyContacts: IEmergencyContact[];
  documents: string[]; // File paths
  creditScore?: number;
  backgroundCheckStatus?: "pending" | "approved" | "rejected";
  applicationDate: Date;
  moveInDate?: Date;
  moveOutDate?: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

// ============================================================================
// APPLICATION TYPES
// ============================================================================

export enum ApplicationStatus {
  DRAFT = "draft",
  SUBMITTED = "submitted",
  UNDER_REVIEW = "under_review",
  APPROVED = "approved",
  REJECTED = "rejected",
  WITHDRAWN = "withdrawn",
}

export enum ApplicationFeeStatus {
  PENDING = "pending",
  PAID = "paid",
  REFUNDED = "refunded",
  WAIVED = "waived",
}

export interface IApplicationFee {
  amount: number;
  status: ApplicationFeeStatus;
  paymentMethod?: string;
  transactionId?: string;
  paidAt?: Date;
}

export interface IApplicationDocument {
  type: string;
  fileName: string;
  fileUrl: string;
  uploadedAt: Date;
  verified?: boolean;
}

export interface IApplication extends Document {
  _id: Types.ObjectId;
  propertyId: Types.ObjectId;
  applicantId: Types.ObjectId; // User ID of the applicant
  status: ApplicationStatus;
  applicationFee: IApplicationFee;
  personalInfo: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    dateOfBirth: Date;
    ssn?: string; // Encrypted
  };
  employmentInfo?: {
    employer: string;
    position: string;
    income: number;
    startDate: Date;
    employerContact?: string;
  };
  emergencyContacts: IEmergencyContact[];
  previousAddresses?: {
    address: string;
    landlordName?: string;
    landlordContact?: string;
    moveInDate: Date;
    moveOutDate: Date;
    reasonForLeaving?: string;
  }[];
  documents: IApplicationDocument[];
  additionalInfo?: {
    pets?: string;
    vehicles?: string;
    reasonForMoving?: string;
    additionalNotes?: string;
  };
  submittedAt?: Date;
  reviewedAt?: Date;
  reviewedBy?: Types.ObjectId;
  reviewNotes?: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

// ============================================================================
// INSPECTION TYPES
// ============================================================================

export enum InspectionType {
  MOVE_IN = "move_in",
  MOVE_OUT = "move_out",
  ROUTINE = "routine",
  MAINTENANCE = "maintenance",
}

export interface IInspectionItem {
  room: string;
  item: string;
  condition: "excellent" | "good" | "fair" | "poor" | "damaged";
  notes?: string;
  photos?: string[];
  requiresAttention: boolean;
}

export interface IInspection extends Document {
  _id: Types.ObjectId;
  propertyId: Types.ObjectId;
  tenantId?: Types.ObjectId;
  leaseId?: Types.ObjectId;
  type: InspectionType;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  scheduledDate: Date;
  completedDate?: Date;
  inspectorId: Types.ObjectId;
  items: IInspectionItem[];
  overallCondition: "excellent" | "good" | "fair" | "poor";
  tenantSignature?: {
    signedAt: Date;
    signature: string;
    ipAddress?: string;
  };
  inspectorSignature?: {
    signedAt: Date;
    signature: string;
  };
  photos: string[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

// ============================================================================
// LEASE TYPES
// ============================================================================

export enum LeaseStatus {
  DRAFT = "draft",
  PENDING = "pending",
  PENDING_SIGNATURE = "pending_signature",
  ACTIVE = "active",
  EXPIRED = "expired",
  TERMINATED = "terminated",
  RENEWED = "renewed",
}

export interface ILeasePaymentConfig {
  rentDueDay: number; // Day of month rent is due (1-31)
  // Late fees are no longer offered; only leases saved before that carry it.
  lateFeeConfig?: ILateFeeConfig;
  acceptedPaymentMethods: PaymentMethod[];
  autoCreatePayments: boolean; // Automatically create recurring rent payments
  prorationEnabled: boolean; // Enable prorated first/last month
  advancePaymentMonths?: number; // Number of months paid in advance
  // Extended fields used by models/services
  autoGenerateInvoices?: boolean;
  autoEmailInvoices?: boolean;
  prorationMethod?: "daily" | "calendar" | "banking";
  roundingMethod?: "round" | "floor" | "ceil";
  minimumProrationCharge?: number;
}

export interface ILeaseTerms {
  rentAmount: number;
  securityDeposit: number;
  lateFee?: number; // legacy: leases saved before late fees were removed
  petDeposit?: number;
  utilities: string[];
  restrictions: string[];
  paymentConfig?: ILeasePaymentConfig;
}

export interface ILease extends Document {
  _id: Types.ObjectId;
  propertyId: Types.ObjectId;
  unitId: Types.ObjectId; // References specific unit within the property
  tenantId: Types.ObjectId; // Now references User with role 'tenant'
  startDate: Date;
  endDate: Date;
  status: LeaseStatus;
  // Aggregate payment status derived from linked payments
  paymentStatus?: "current" | "pending" | "overdue";
  terms: ILeaseTerms;
  documents: string[];
  signedDate?: Date;
  renewalOptions?: {
    available: boolean;
    terms?: string;
  };
  renewedLeaseId?: Types.ObjectId;
  parentLeaseId?: Types.ObjectId;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  archivedAt?: Date | null;

  // Virtual property for populated unit information from unified model
  unit?: IEmbeddedUnit;
}

// ============================================================================
// INVOICE TYPES
// ============================================================================

export enum InvoiceStatus {
  SCHEDULED = "scheduled",
  ISSUED = "issued",
  PAID = "paid",
  PARTIAL = "partial",
  OVERDUE = "overdue",
  CANCELLED = "cancelled",
}

export enum InvoiceType {
  // Tenant Charges & Fees
  RENT = "rent",
  SECURITY_DEPOSIT = "security_deposit",
  LATE_FEE = "late_fee",
  APPLICATION_FEE = "application_fee",
  MOVE_IN_FEE = "move_in_fee",
  MOVE_OUT_FEE = "move_out_fee",
  PET_DEPOSIT = "pet_deposit",
  PET_RENT = "pet_rent",
  PARKING_FEE = "parking_fee",
  STORAGE_FEE = "storage_fee",
  LEASE_BREAK_FEE = "lease_break_fee",
  NSF_FEE = "nsf_fee",

  // Utilities
  ELECTRICITY = "electricity",
  WATER_SEWER = "water_sewer",
  GAS = "gas",
  TRASH = "trash",
  INTERNET = "internet",
  CABLE = "cable",
  UTILITY = "utility",

  // Maintenance & Repairs
  MAINTENANCE = "maintenance",
  REPAIR = "repair",
  CLEANING = "cleaning",
  LANDSCAPING = "landscaping",

  // Other
  MANAGEMENT_FEE = "management_fee",
  LEGAL_FEE = "legal_fee",
  INSURANCE = "insurance",
  OTHER = "other",
}

export interface IInvoiceLineItem {
  description: string;
  amount: number;
  type: InvoiceType;
  quantity?: number;
  unitPrice?: number;
  dueDate?: Date;
}

export interface IInvoice extends Document {
  _id: Types.ObjectId;
  invoiceNumber: string;
  tenantId: Types.ObjectId;
  propertyId: Types.ObjectId;
  leaseId?: Types.ObjectId;
  unitId?: Types.ObjectId;

  // Invoice Details
  category: InvoiceType;
  issueDate: Date;
  dueDate: Date;
  status: InvoiceStatus;

  // Financial Information
  subtotal: number;
  taxAmount?: number;
  discountAmount?: number;
  totalAmount: number;
  amountPaid: number;
  balanceRemaining: number;

  // Line Items
  lineItems: IInvoiceLineItem[];

  // Payment Tracking
  paymentIds: Types.ObjectId[];
  lastPaymentDate?: Date;

  // Late Fee Tracking
  lateFeeAmount: number;
  lateFeeAppliedDate?: Date;
  gracePeriodEnd?: Date;

  // Communication
  emailSent: boolean;
  emailSentDate?: Date;
  remindersSent: {
    type: "reminder" | "overdue" | "final_notice";
    sentDate: Date;
    method: "email" | "sms" | "both";
  }[];

  // Document Management
  pdfPath?: string;
  pdfGenerated: boolean;

  // Metadata
  notes?: string;
  metadata?: Record<string, any>;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

// ============================================================================
// PAYMENT TYPES
// ============================================================================

export enum PaymentType {
  RENT = "rent",
  SECURITY_DEPOSIT = "security_deposit",
  LATE_FEE = "late_fee",
  PET_DEPOSIT = "pet_deposit",
  UTILITY = "utility",
  MAINTENANCE = "maintenance",
  INVOICE = "invoice",
  OTHER = "other",
}

export enum PaymentStatus {
  PENDING = "pending",
  PAID = "paid",
  PARTIAL = "partial",
  OVERDUE = "overdue",
  CANCELLED = "cancelled",
  REFUNDED = "refunded",
  FAILED = "failed",
}

export enum PaymentMethod {
  CREDIT_CARD = "credit_card",
  DEBIT_CARD = "debit_card",
  BANK_TRANSFER = "bank_transfer",
  ACH = "ach",
  CHECK = "check",
  CASH = "cash",
  /**
   * Card payment taken on the office's own terminal (mada, Visa, Apple Pay).
   * Not a gateway payment: staff record it by hand, like cash.
   */
  POS = "pos",
  MONEY_ORDER = "money_order",
  PAYPAL = "paypal",
  RAZORPAY = "razorpay",
  PAYSTACK = "paystack",
  /**
   * Settled through the Ejar tenancy platform rather than collected by the
   * office. The stored value keeps its older "ejari" spelling. The money never
   * passes through the office account, so a payment recorded this way is still
   * a collection against the installment — it just carries no cash movement
   * for the office to reconcile.
   */
  EJARI = "ejari",
  /**
   * Transferred by the tenant straight into the owner's own account. Recorded
   * so the installment closes and the owner statement shows the rent as
   * received, with nothing owed onward by the office.
   */
  OWNER_ACCOUNT = "owner_account",
  /**
   * Cash the tenant handed to the owner rather than to the office. Received by
   * the owner, exactly like OWNER_ACCOUNT.
   */
  OWNER_CASH = "owner_cash",
  OTHER = "other",
}

export enum PaymentFrequency {
  ONE_TIME = "one_time",
  WEEKLY = "weekly",
  MONTHLY = "monthly",
  QUARTERLY = "quarterly",
  ANNUALLY = "annually",
  CUSTOM = "custom",
}

export interface IPaymentSchedule {
  frequency: PaymentFrequency;
  startDate: Date;
  endDate?: Date;
  dayOfMonth?: number; // For monthly payments (1-31)
  dayOfWeek?: number; // For weekly payments (0-6, Sunday = 0)
  customInterval?: number; // For custom frequency (e.g., every 2 months)
  isActive: boolean;
  nextDueDate?: Date;
  lastGeneratedDate?: Date;
}

export interface ILateFeeConfig {
  enabled: boolean;
  gracePeriodDays: number;
  feeType: "fixed" | "percentage" | "tiered" | "daily";
  feeAmount: number; // Fixed amount or percentage
  maxFeeAmount?: number; // Maximum fee for percentage-based
  minFeeAmount?: number; // Minimum fee amount
  compoundDaily?: boolean;
  dailyLateFee?: number; // Daily late fee amount
  percentageFee?: number; // Percentage-based fee
  flatFee?: number; // Flat fee amount
  maxLateFee?: number; // Maximum late fee cap
  notificationDays: number[]; // Days after due date to send notifications
  tiers?: Array<{
    daysOverdue: number;
    amount: number;
    percentage?: number;
  }>; // Tiered fee structure
}

export interface IPayment extends Document {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  propertyId: Types.ObjectId;
  leaseId?: Types.ObjectId;
  invoiceId?: Types.ObjectId;
  amount: number;
  amountPaid?: number; // For partial payments
  type: PaymentType;
  status: PaymentStatus;
  paymentMethod?: PaymentMethod;
  dueDate: Date;
  paidDate?: Date;
  stripePaymentIntentId?: string;
  stripeCheckoutSessionId?: string;
  stripePaymentMethodId?: string;
  stripeCustomerId?: string;
  paypalOrderId?: string;
  paypalCaptureId?: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  paystackReference?: string;
  description?: string;
  notes?: string;
  receiptUrl?: string;
  allocations: Array<{
    invoiceId: Types.ObjectId;
    amount: number;
  }>;

  // Enhanced payment scheduling
  schedule?: IPaymentSchedule;
  parentPaymentId?: Types.ObjectId; // For recurring payments
  isRecurring: boolean;

  // Late fee management
  lateFeeConfig?: ILateFeeConfig;
  lateFeeApplied?: number;
  lateFeeDate?: Date;

  // Proration tracking
  prorationData?: {
    isProrated: boolean;
    originalAmount: number;
    proratedAmount: number;
    startDate: Date;
    endDate: Date;
    daysInPeriod: number;
    dailyRate: number;
    method: "daily" | "calendar" | "banking";
  };

  // Payment tracking
  paymentHistory: Array<{
    amount: number;
    paymentMethod: PaymentMethod;
    paidDate: Date;
    transactionId?: string;
    notes?: string;
  }>;

  // Notifications
  remindersSent: Array<{
    type: "reminder" | "overdue" | "final_notice";
    sentDate: Date;
    method: "email" | "sms" | "both";
  }>;

  // Synchronization and versioning
  version?: number;
  lastSyncedAt?: Date;
  syncStatus?: "synced" | "pending" | "failed";

  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

// ============================================================================
// SECURITY DEPOSIT TYPES
// ============================================================================

export enum SecurityDepositStatus {
  PENDING = "pending", // Awaiting collection
  COLLECTED = "collected", // Deposit received and held
  PARTIALLY_REFUNDED = "partially_refunded",
  FULLY_REFUNDED = "fully_refunded",
  FORFEITED = "forfeited", // Entire deposit kept for damages/violations
}

export enum DeductionCategory {
  DAMAGE = "damage",
  UNPAID_RENT = "unpaid_rent",
  CLEANING = "cleaning",
  KEY_REPLACEMENT = "key_replacement",
  LEASE_BREAK = "lease_break",
  OTHER = "other",
}

export interface ISecurityDepositDeduction {
  category: DeductionCategory;
  description: string;
  amount: number;
  photos?: string[]; // S3 keys for damage photos
  createdAt: Date;
}

export interface ISecurityDeposit extends Document {
  _id: Types.ObjectId;
  leaseId: Types.ObjectId;
  tenantId: Types.ObjectId;
  propertyId: Types.ObjectId;
  unitId: Types.ObjectId;
  amount: number; // Original deposit amount
  status: SecurityDepositStatus;
  collectedDate?: Date;
  collectedPaymentId?: Types.ObjectId; // Link to Payment record
  deductions: ISecurityDepositDeduction[];
  totalDeductions: number; // Virtual or computed
  refundAmount?: number;
  refundDate?: Date;
  refundMethod?: string;
  refundPaymentId?: Types.ObjectId; // Link to refund Payment record
  refundNotes?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

// ============================================================================
// ACCOUNTING / TRANSACTION TYPES
// ============================================================================

export enum TransactionType {
  INCOME = "income",
  EXPENSE = "expense",
  CHARGE = "charge",
  CREDIT = "credit",
  ADJUSTMENT = "adjustment",
}

export enum BillStatus {
  DRAFT = "draft",
  PENDING = "pending",
  APPROVED = "approved",
  PARTIALLY_PAID = "partially_paid",
  PAID = "paid",
  OVERDUE = "overdue",
  CANCELLED = "cancelled",
}

export enum ExpenseCategory {
  MAINTENANCE = "maintenance",
  REPAIR = "repair",
  UTILITIES = "utilities",
  INSURANCE = "insurance",
  TAXES = "taxes",
  MANAGEMENT_FEE = "management_fee",
  ADVERTISING = "advertising",
  LEGAL = "legal",
  SUPPLIES = "supplies",
  LANDSCAPING = "landscaping",
  CLEANING = "cleaning",
  CAPITAL_IMPROVEMENT = "capital_improvement",
  OTHER = "other",
}

export enum ExpenseStatus {
  PENDING = "pending",
  APPROVED = "approved",
  PAID = "paid",
  CANCELLED = "cancelled",
}

export enum ChargeType {
  CHARGE = "charge",
  CREDIT = "credit",
}

export enum ChargeCategory {
  RENT_ADJUSTMENT = "rent_adjustment",
  UTILITY = "utility",
  MAINTENANCE = "maintenance",
  DAMAGE = "damage",
  CLEANING = "cleaning",
  LEASE_VIOLATION = "lease_violation",
  CONCESSION = "concession",
  REFUND = "refund",
  MOVE_IN_FEE = "move_in_fee",
  MOVE_OUT_FEE = "move_out_fee",
  OTHER = "other",
}

export enum ChargeStatus {
  PENDING = "pending",
  APPLIED = "applied",
  CANCELLED = "cancelled",
}

export enum OwnerStatementStatus {
  DRAFT = "draft",
  FINALIZED = "finalized",
  SENT = "sent",
  ACKNOWLEDGED = "acknowledged",
}

export enum DistributionStatus {
  PENDING = "pending",
  APPROVED = "approved",
  DISTRIBUTED = "distributed",
  CANCELLED = "cancelled",
}

export enum ReconciliationStatus {
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
}

export enum BankAccountType {
  CHECKING = "checking",
  SAVINGS = "savings",
  TRUST = "trust",
}


export enum VendorCategory {
  CONTRACTOR = "contractor",
  PLUMBER = "plumber",
  ELECTRICIAN = "electrician",
  LANDSCAPING = "landscaping",
  CLEANING = "cleaning",
  GENERAL_CONTRACTOR = "general_contractor",
  SUPPLIER = "supplier",
  UTILITY_PROVIDER = "utility_provider",
  INSURANCE = "insurance",
  LEGAL = "legal",
  OTHER = "other",
}

export interface IUnifiedTransaction {
  id: string;
  date: Date;
  type: TransactionType;
  category: string;
  description: string;
  reference: string;
  amount: number;
  status: string;
  sourceType: "payment" | "invoice" | "expense" | "bill" | "charge";
  sourceId: string;
  tenantId?: {
    _id: string;
    firstName: string;
    lastName: string;
    email?: string;
  };
  propertyId?: {
    _id: string;
    name: string;
  };
  vendorId?: {
    _id: string;
    name: string;
  };
  runningBalance?: number;
}

export interface ITransactionSummary {
  totalIncome: number;
  totalExpenses: number;
  netAmount: number;
  outstanding: number;
  transactionCount: number;
}

export interface IVendor extends Document {
  _id: Types.ObjectId;
  name: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    country?: string;
  };
  category: VendorCategory;
  taxId?: string;
  w9OnFile: boolean;
  notes?: string;
  isActive: boolean;
  totalPaid: number;
  yearToDatePaid: number;
  properties: Types.ObjectId[];
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

export interface IBillLineItem {
  description: string;
  amount: number;
  category: ExpenseCategory;
  quantity: number;
  unitPrice: number;
  propertyId?: Types.ObjectId;
}

export interface IBill extends Document {
  _id: Types.ObjectId;
  billNumber: string;
  vendorId: Types.ObjectId;
  propertyId?: Types.ObjectId;
  category: ExpenseCategory;
  description: string;
  lineItems: IBillLineItem[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  amountPaid: number;
  balanceRemaining: number;
  issueDate: Date;
  dueDate: Date;
  status: BillStatus;
  paymentIds: Types.ObjectId[];
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  notes?: string;
  attachments: string[];
  isRecurring: boolean;
  recurringConfig?: {
    frequency: PaymentFrequency;
    nextGenerateDate?: Date;
    endDate?: Date;
  };
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

export interface IExpense extends Document {
  _id: Types.ObjectId;
  expenseNumber: string;
  propertyId?: Types.ObjectId;
  unitId?: Types.ObjectId;
  vendorId?: Types.ObjectId;
  billId?: Types.ObjectId;
  category: ExpenseCategory;
  description: string;
  amount: number;
  date: Date;
  paymentMethod?: PaymentMethod;
  referenceNumber?: string;
  receiptUrl?: string;
  notes?: string;
  isRecurring: boolean;
  recurringConfig?: {
    frequency: PaymentFrequency;
    nextDate?: Date;
    endDate?: Date;
  };
  status: ExpenseStatus;
  taxDeductible: boolean;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

export interface ICharge extends Document {
  _id: Types.ObjectId;
  chargeNumber: string;
  tenantId: Types.ObjectId;
  propertyId: Types.ObjectId;
  leaseId?: Types.ObjectId;
  type: ChargeType;
  category: ChargeCategory;
  description: string;
  amount: number;
  date: Date;
  accountId?: Types.ObjectId;
  status: ChargeStatus;
  appliedToInvoiceId?: Types.ObjectId;
  notes?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

export interface IOwnerStatementIncome {
  rentCollected: number;
  lateFees: number;
  otherIncome: number;
  totalIncome: number;
}

export interface IOwnerStatementExpenses {
  maintenance: number;
  utilities: number;
  insurance: number;
  taxes: number;
  managementFee: number;
  otherExpenses: number;
  totalExpenses: number;
}

export interface IOwnerStatement extends Document {
  _id: Types.ObjectId;
  statementNumber: string;
  ownerId: Types.ObjectId;
  propertyId: Types.ObjectId;
  periodStart: Date;
  periodEnd: Date;
  income: IOwnerStatementIncome;
  expenses: IOwnerStatementExpenses;
  netIncome: number;
  managementFeeRate: number;
  managementFeeAmount: number;
  ownerDistribution: number;
  distributionStatus: DistributionStatus;
  distributedAt?: Date;
  distributionMethod?: string;
  distributionReference?: string;
  pdfPath?: string;
  pdfGenerated: boolean;
  emailSent: boolean;
  emailSentDate?: Date;
  notes?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IBankAccount extends Document {
  _id: Types.ObjectId;
  name: string;
  bankName: string;
  accountType: BankAccountType;
  accountNumberLast4: string;
  routingNumber?: string;
  currentBalance: number;
  lastReconciledDate?: Date;
  lastReconciledBalance: number;
  isDefault: boolean;
  isActive: boolean;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IBankReconciliation extends Document {
  _id: Types.ObjectId;
  bankAccountId: Types.ObjectId;
  statementDate: Date;
  statementBalance: number;
  bookBalance: number;
  difference: number;
  status: ReconciliationStatus;
  reconciledItems: Array<{
    transactionId: string;
    sourceType: "payment" | "expense" | "bill";
    amount: number;
    date: Date;
    cleared: boolean;
  }>;
  adjustments: Array<{
    description: string;
    amount: number;
    type: "bank_fee" | "interest" | "error_correction" | "other";
  }>;
  completedAt?: Date;
  completedBy?: Types.ObjectId;
  notes?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// MAINTENANCE TYPES
// ============================================================================

export enum MaintenancePriority {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  EMERGENCY = "emergency",
}

export enum MaintenanceStatus {
  SUBMITTED = "submitted",
  ASSIGNED = "assigned",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
}

export interface IMaintenanceRequest extends Document {
  _id: Types.ObjectId;
  propertyId: Types.ObjectId;
  unitId?: Types.ObjectId; // Optional - for multi-unit properties
  tenantId: Types.ObjectId;
  assignedTo?: Types.ObjectId;
  title: string;
  description: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  category: string;
  images: string[];
  contactPhone?: string;
  estimatedCost?: number;
  actualCost?: number;
  scheduledDate?: Date;
  completedDate?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

// ============================================================================
// SUPPORT TICKET TYPES
// ============================================================================

export enum TicketStatus {
  OPEN = "open",
  IN_PROGRESS = "in_progress",
  RESOLVED = "resolved",
  CLOSED = "closed",
}

export enum TicketPriority {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  URGENT = "urgent",
}

export enum TicketCategory {
  BILLING = "billing",
  LEASE = "lease",
  MAINTENANCE = "maintenance",
  NOISE_COMPLAINT = "noise_complaint",
  SAFETY = "safety",
  GENERAL = "general",
  SUGGESTION = "suggestion",
  OTHER = "other",
}

export interface ITicketComment {
  _id?: Types.ObjectId;
  userId: Types.ObjectId;
  message: string;
  attachments?: string[];
  isInternal?: boolean;
  createdAt?: Date;
}

export interface ITicket extends Document {
  _id: Types.ObjectId;
  ticketNumber: string;
  tenantId: Types.ObjectId;
  propertyId?: Types.ObjectId;
  unitId?: Types.ObjectId;
  assignedTo?: Types.ObjectId;
  createdBy: {
    userId: Types.ObjectId;
    role: string;
  };
  title: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  attachments: string[];
  comments: ITicketComment[];
  resolvedAt?: Date;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

// ============================================================================
// WORK ORDER TYPES
// ============================================================================

export enum WorkOrderStatus {
  PENDING = "pending",
  ASSIGNED = "assigned",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
}

export interface IWorkOrder extends Document {
  _id: Types.ObjectId;
  maintenanceRequestId: Types.ObjectId;
  assignedTo: Types.ObjectId;
  title: string;
  description: string;
  status: WorkOrderStatus;
  priority: MaintenancePriority;
  estimatedCost?: number;
  actualCost?: number;
  scheduledDate?: Date;
  completedDate?: Date;
  notes?: string;
  materials?: string[];
  laborHours?: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

// ============================================================================
// DOCUMENT TYPES
// ============================================================================

export enum DocumentType {
  LEASE = "lease",
  APPLICATION = "application",
  INSPECTION = "inspection",
  MAINTENANCE = "maintenance",
  FINANCIAL = "financial",
  PHOTO = "photo",
  OTHER = "other",
}

export enum DocumentStatus {
  ACTIVE = "active",
  PENDING_APPROVAL = "pending_approval",
  APPROVED = "approved",
  REJECTED = "rejected",
  ARCHIVED = "archived",
}

export interface IDocument extends Document {
  _id: Types.ObjectId;
  title: string;
  description?: string;
  type: DocumentType;
  status: DocumentStatus;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  propertyId?: Types.ObjectId;
  tenantId?: Types.ObjectId;
  leaseId?: Types.ObjectId;
  uploadedBy: Types.ObjectId;
  isShared: boolean;
  tags: string[];
  category: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  /** Machine-readable error code (stable across copy changes) so API clients
   * can branch on failures without parsing human strings. Present on every
   * error response; absent on success. */
  code?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  /**
   * Totals over the WHOLE filtered result set, not the page in `data`.
   *
   * A list screen that adds up the rows it was handed reports the current
   * page's money beside the full record count, and both numbers change when
   * you turn the page. Computing the totals in the same query that produced
   * the page is what keeps the headline and the table describing one thing.
   *
   * The shape is per endpoint — each one documents its own.
   */
  summary?: Record<string, unknown>;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
}

// ============================================================================
// FORM TYPES
// ============================================================================

export interface PropertyFormData {
  name: string;
  description?: string;
  type: PropertyType;
  address: IAddress;
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  rentAmount: number;
  securityDeposit: number;
  amenities: IAmenity[];
}

export interface TenantFormData {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  dateOfBirth?: Date;
  employmentInfo?: {
    employer: string;
    position: string;
    income: number;
    startDate: Date;
  };
  emergencyContacts: IEmergencyContact[];
}

export interface LeaseFormData {
  propertyId: string;
  tenantId: string;
  startDate: Date;
  endDate: Date;
  terms: ILeaseTerms;
}

// ============================================================================
// DASHBOARD TYPES
// ============================================================================

export interface DashboardStats {
  totalProperties: number;
  occupiedProperties: number;
  vacantProperties: number;
  totalTenants: number;
  monthlyRevenue: number;
  pendingMaintenance: number;
  overduePayments: number;
}

export interface RecentActivity {
  id: string;
  type: "payment" | "maintenance" | "lease" | "tenant";
  description: string;
  timestamp: Date;
  userId?: string;
  propertyId?: string;
}

// ============================================================================
// CALENDAR & SCHEDULING TYPES
// ============================================================================

export enum EventType {
  LEASE_RENEWAL = "lease_renewal",
  PROPERTY_INSPECTION = "property_inspection",
  MAINTENANCE_APPOINTMENT = "maintenance_appointment",
  PROPERTY_SHOWING = "property_showing",
  TENANT_MEETING = "tenant_meeting",
  RENT_COLLECTION = "rent_collection",
  MOVE_IN = "move_in",
  MOVE_OUT = "move_out",
  GENERAL = "general",
}

export enum EventStatus {
  SCHEDULED = "scheduled",
  CONFIRMED = "confirmed",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
  RESCHEDULED = "rescheduled",
}

export enum EventPriority {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  URGENT = "urgent",
}

export enum LocationType {
  PHYSICAL = "physical",
  ONLINE = "online",
}

export enum OnlinePlatform {
  ZOOM = "zoom",
  GOOGLE_MEET = "google_meet",
  MICROSOFT_TEAMS = "microsoft_teams",
  WEBEX = "webex",
  OTHER = "other",
}

export enum RecurrenceType {
  NONE = "none",
  DAILY = "daily",
  WEEKLY = "weekly",
  MONTHLY = "monthly",
  YEARLY = "yearly",
  CUSTOM = "custom",
}

export interface IEventRecurrence {
  type: RecurrenceType;
  interval: number; // Every X days/weeks/months/years
  endDate?: Date;
  occurrences?: number; // Number of occurrences
  daysOfWeek?: number[]; // For weekly recurrence (0 = Sunday, 6 = Saturday)
  dayOfMonth?: number; // For monthly recurrence
  exceptions?: Date[]; // Dates to skip
}

export interface IEventReminder {
  type: "email" | "sms" | "push" | "in_app";
  minutesBefore: number;
  sent: boolean;
  sentAt?: Date;
}

export interface IEventLocation {
  type: LocationType;
  // For physical locations
  address?: string;
  // For online locations
  platform?: OnlinePlatform;
  meetingLink?: string;
  meetingId?: string;
  passcode?: string;
}

export interface IEventAttendee {
  userId: Types.ObjectId;
  email: string;
  name: string;
  role: UserRole;
  status: "pending" | "accepted" | "declined" | "tentative";
  responseAt?: Date;
  notes?: string;
}

export interface IEvent extends Document {
  _id: Types.ObjectId;
  title: string;
  description?: string;
  type: EventType;
  status: EventStatus;
  priority: EventPriority;

  // Date and time
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  timezone: string;

  // Location
  location?: IEventLocation;
  propertyId?: Types.ObjectId;
  unitNumber?: string;

  // Participants
  organizer: Types.ObjectId;
  attendees: IEventAttendee[];

  // Related entities
  tenantId?: Types.ObjectId;
  leaseId?: Types.ObjectId;
  maintenanceRequestId?: Types.ObjectId;

  // Recurrence
  recurrence?: IEventRecurrence;
  parentEventId?: Types.ObjectId; // For recurring event instances
  isRecurring: boolean;

  // Reminders and notifications
  reminders: IEventReminder[];

  // Additional data
  metadata?: Record<string, any>;
  attachments?: string[];
  notes?: string;

  // Audit fields
  createdBy: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

// ============================================================================
// SETTINGS TYPES
// ============================================================================

export interface INotificationSettings {
  email: {
    enabled: boolean;
    paymentReminders: boolean;
    maintenanceUpdates: boolean;
    leaseReminders: boolean;
    propertyNews: boolean;
    systemAlerts: boolean;
    marketingEmails: boolean;
    weeklyReports: boolean;
    monthlyReports: boolean;
    tenantMessages: boolean;
    documentSharing: boolean;
    calendarReminders: boolean;
    frequency: "immediate" | "daily" | "weekly";
    quietHours: {
      enabled: boolean;
      startTime: string;
      endTime: string;
    };
  };
  sms: {
    enabled: boolean;
    emergencyOnly: boolean;
    paymentReminders: boolean;
    maintenanceUpdates: boolean;
    leaseReminders: boolean;
    systemAlerts: boolean;
    frequency: "immediate" | "daily";
    quietHours: {
      enabled: boolean;
      startTime: string;
      endTime: string;
    };
  };
  push: {
    enabled: boolean;
    paymentReminders: boolean;
    maintenanceUpdates: boolean;
    leaseReminders: boolean;
    systemAlerts: boolean;
    tenantMessages: boolean;
    documentSharing: boolean;
    calendarReminders: boolean;
    quietHours: {
      enabled: boolean;
      startTime: string;
      endTime: string;
    };
  };
  inApp: {
    enabled: boolean;
    showDesktopNotifications: boolean;
    soundEnabled: boolean;
    badgeCount: boolean;
    autoMarkAsRead: boolean;
    groupSimilar: boolean;
  };
}

export interface ISecuritySettings {
  twoFactorAuth: {
    enabled: boolean;
    method: "sms" | "email" | "authenticator";
    backupCodes?: string[];
  };
  loginAlerts: boolean;
  sessionTimeout: number; // in minutes
  passwordRequirements: {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSpecialChars: boolean;
  };
}

export interface IDisplaySettings {
  theme: "light" | "dark" | "system";
  language: string;
  timezone: string;
  dateFormat: "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD" | "DD-MM-YYYY";
  timeFormat: "12h" | "24h";
  currency: string;
  compactMode: boolean;
  sidebarCollapsed: boolean;
  showAvatars: boolean;
  animationsEnabled: boolean;
  highContrast: boolean;
  fontSize: "small" | "medium" | "large";
  density: "comfortable" | "compact" | "spacious";
  colorScheme: {
    primary: string;
    secondary: string;
    accent: string;
  };
  dashboardLayout: "grid" | "list" | "cards";
  itemsPerPage: number;
}

export interface IPrivacySettings {
  profileVisibility: "public" | "private" | "contacts";
  showOnlineStatus: boolean;
  allowDataCollection: boolean;
  allowMarketing: boolean;
  shareUsageData: boolean;
  showContactInfo: boolean;
  allowDirectMessages: boolean;
  showActivityStatus: boolean;
  allowSearchEngineIndexing: boolean;
  shareLocationData: boolean;
  allowThirdPartyIntegrations: boolean;
  dataRetentionPeriod: number;
  cookiePreferences: {
    essential: boolean;
    analytics: boolean;
    marketing: boolean;
    personalization: boolean;
  };
}

/**
 * @deprecated This interface is deprecated as of migration 003.
 * Use the unified ISettings interface instead.
 * Kept for backward compatibility and migration purposes.
 */
export interface IUserSettings extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  notifications: INotificationSettings;
  security: ISecuritySettings;
  display: IDisplaySettings;
  privacy: IPrivacySettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISystemSettings extends Document {
  _id: Types.ObjectId;
  category:
    | "general"
    | "email"
    | "payment"
    | "maintenance"
    | "security"
    | "branding"
    | "appearance"
    | "localization"
    | "notifications"
    | "integrations";
  key: string;
  value: any;
  dataType:
    | "string"
    | "number"
    | "boolean"
    | "object"
    | "array"
    | "file"
    | "url"
    | "color"
    | "json";
  description?: string;
  isPublic: boolean; // Whether setting can be viewed by non-admins
  isEditable: boolean; // Whether setting can be modified
  validationRules?: {
    required?: boolean;
    min?: number;
    max?: number;
    pattern?: string;
    enum?: string[];
    fileTypes?: string[]; // For file uploads
    maxFileSize?: number; // In bytes
    minLength?: number;
    maxLength?: number;
  };
  metadata?: {
    group?: string; // For grouping related settings
    order?: number; // For ordering within category
    helpText?: string; // Additional help text
    icon?: string; // Icon name for UI
    tags?: string[]; // For search and filtering
    dependencies?: string[]; // Settings that depend on this one
  };
  lastModifiedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
