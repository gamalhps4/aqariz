/**
 * PropertyPro - Demo Data Service
 * Service for generating and installing demo data for new users
 *
 * Prisma/Postgres implementation: every create stamps the caller's
 * organizationId (RLS also verifies it), units are real rows, and clearing
 * removes children before parents, in one transaction, to satisfy foreign
 * keys.
 */

import { db, runWithOrgTransaction } from "@/lib/db/prisma";
import { requireOrgId } from "@/lib/tenancy/context";
import { postAfterCommit } from "@/lib/accounting/hooks";
import {
  DEMO_DATA_PURGE_REFUSED_MESSAGE,
  isForeignKeyRefusal,
  purgeOrganizationData,
  type DemoDataPurgeCounts,
} from "@/lib/demo-data-purge";
import {
  UserRole,
  PropertyType,
  LeaseStatus,
  PaymentStatus,
  MaintenanceStatus,
  EventType,
  EventStatus,
} from "@/types";

export interface DemoDataOptions {
  includeUsers?: boolean;
  includeProperties?: boolean;
  includeTenants?: boolean;
  includeLeases?: boolean;
  includePayments?: boolean;
  includeMaintenance?: boolean;
  includeMessages?: boolean;
  includeEvents?: boolean;
  includeAnnouncements?: boolean;
  propertyCount?: number;
  tenantCount?: number;
  organizationName?: string;
  adminEmail?: string;
  adminPassword?: string;
}

export interface DemoDataResult {
  success: boolean;
  message: string;
  data: {
    users: number;
    properties: number;
    tenants: number;
    leases: number;
    payments: number;
    maintenanceRequests: number;
    messages: number;
    events: number;
    announcements: number;
  };
  errors: string[];
  adminCredentials?: {
    email: string;
    password: string;
  };
}

export class DemoDataService {
  private static instance: DemoDataService;

  private constructor() {}

  public static getInstance(): DemoDataService {
    if (!DemoDataService.instance) {
      DemoDataService.instance = new DemoDataService();
    }
    return DemoDataService.instance;
  }

  async installDemoData(
    options: DemoDataOptions = {}
  ): Promise<DemoDataResult> {
    const {
      includeUsers = true,
      includeProperties = true,
      includeTenants = true,
      includeLeases = true,
      includePayments = true,
      includeMaintenance = true,
      includeMessages = true,
      includeEvents = true,
      includeAnnouncements = true,
      propertyCount = 5,
      tenantCount = 15,
      adminEmail = "admin@demo.com",
      adminPassword = "Demo123!",
    } = options;

    const result: DemoDataResult = {
      success: false,
      message: "",
      data: {
        users: 0,
        properties: 0,
        tenants: 0,
        leases: 0,
        payments: 0,
        maintenanceRequests: 0,
        messages: 0,
        events: 0,
        announcements: 0,
      },
      errors: [],
    };

    try {
      const organizationId = requireOrgId();

      // Check if demo data already exists
      const existingUsers = await db.user.count();
      if (existingUsers > 0) {
        result.errors.push(
          "Demo data already exists. Please clear existing data first."
        );
        return result;
      }

      let createdUsers: any[] = [];
      let createdProperties: any[] = [];
      let createdTenants: any[] = [];
      let createdLeases: any[] = [];

      // 1. Create Users
      if (includeUsers) {
        createdUsers = await this.createDemoUsers(
          organizationId,
          adminEmail,
          adminPassword
        );
        result.data.users = createdUsers.length;
      }

      // 2. Create Properties (with units — units are real rows now)
      if (includeProperties) {
        const adminUser = createdUsers.find(
          (u) => u.role === UserRole.ADMIN
        );
        createdProperties = await this.createDemoProperties(
          organizationId,
          propertyCount,
          adminUser?.id
        );
        result.data.properties = createdProperties.length;
      }

      // 3. Create Tenants
      if (includeTenants) {
        createdTenants = await this.createDemoTenants(
          organizationId,
          tenantCount
        );
        result.data.tenants = createdTenants.length;
      }

      // 4. Create Leases
      if (
        includeLeases &&
        createdProperties.length > 0 &&
        createdTenants.length > 0
      ) {
        createdLeases = await this.createDemoLeases(
          organizationId,
          createdProperties,
          createdTenants
        );
        result.data.leases = createdLeases.length;
      }

      // 5. Create Payments (per lease — payments need a property/lease)
      if (includePayments && createdLeases.length > 0) {
        const payments = await this.createDemoPayments(
          organizationId,
          createdLeases
        );
        result.data.payments = payments.length;
      }

      // 6. Create Maintenance Requests
      if (
        includeMaintenance &&
        createdProperties.length > 0 &&
        createdTenants.length > 0
      ) {
        const maintenance = await this.createDemoMaintenance(
          organizationId,
          createdProperties,
          createdTenants
        );
        result.data.maintenanceRequests = maintenance.length;
      }

      // 7. Create Messages
      if (includeMessages && createdUsers.length > 0) {
        const messages = await this.createDemoMessages(
          organizationId,
          createdUsers,
          createdProperties
        );
        result.data.messages = messages.length;
      }

      // 8. Create Events
      if (includeEvents && createdUsers.length > 0) {
        const events = await this.createDemoEvents(
          organizationId,
          createdUsers,
          createdProperties
        );
        result.data.events = events.length;
      }

      // 9. Create Announcements
      if (includeAnnouncements && createdUsers.length > 0) {
        const announcements = await this.createDemoAnnouncements(
          organizationId,
          createdUsers[0]
        );
        result.data.announcements = announcements.length;
      }

      result.success = true;
      result.message = "Demo data installed successfully";
      result.adminCredentials = {
        email: adminEmail,
        password: adminPassword,
      };
    } catch (error) {
      console.error("Error installing demo data:", error);
      result.errors.push(
        error instanceof Error ? error.message : "Unknown error"
      );
      result.message = "Failed to install demo data";
    }

    return result;
  }

  private async createDemoUsers(
    organizationId: string,
    adminEmail: string,
    _adminPassword: string
  ): Promise<any[]> {
    // NOTE: passwords are managed by Better Auth (accounts table) now, so
    // demo users are created without credentials.
    const users = [
      {
        firstName: "Admin",
        lastName: "User",
        email: adminEmail,
        role: UserRole.ADMIN,
        phone: "+1-555-0100",
      },
      {
        firstName: "John",
        lastName: "Manager",
        email: "manager@demo.com",
        role: UserRole.MANAGER,
        phone: "+1-555-0200",
      },
      {
        firstName: "Sarah",
        lastName: "Owner",
        email: "owner@demo.com",
        role: UserRole.MANAGER,
        phone: "+1-555-0300",
      },
      {
        firstName: "Mike",
        lastName: "Agent",
        email: "agent@demo.com",
        role: UserRole.MANAGER,
        phone: "+1-555-0400",
      },
      {
        firstName: "Lisa",
        lastName: "Maintenance",
        email: "maintenance@demo.com",
        role: UserRole.MANAGER,
        phone: "+1-555-0500",
      },
    ];

    const createdUsers = [];
    for (const userData of users) {
      const user = await db.user.create({
        data: {
          ...userData,
          organizationId,
          isActive: true,
          emailVerified: new Date(),
          emailVerifiedFlag: true,
        },
      });
      createdUsers.push(user);
    }

    return createdUsers;
  }

  private async createDemoProperties(
    organizationId: string,
    count: number,
    ownerId: string
  ): Promise<any[]> {
    const propertyTemplates = [
      {
        name: "Sunset Apartments",
        type: PropertyType.APARTMENT,
        address: {
          street: "123 Sunset Boulevard",
          city: "Los Angeles",
          state: "CA",
          zipCode: "90028",
          country: "USA",
        },
        unitCount: 24,
        description: "Modern apartment complex with amenities",
        features: ["Pool", "Gym", "Parking", "Laundry"],
      },
      {
        name: "Oak Street Townhomes",
        type: PropertyType.TOWNHOUSE,
        address: {
          street: "456 Oak Street",
          city: "San Francisco",
          state: "CA",
          zipCode: "94102",
          country: "USA",
        },
        unitCount: 12,
        description: "Luxury townhomes in prime location",
        features: ["Garage", "Garden", "Fireplace"],
      },
      {
        name: "Pine Valley Condos",
        type: PropertyType.CONDO,
        address: {
          street: "789 Pine Valley Drive",
          city: "San Diego",
          state: "CA",
          zipCode: "92101",
          country: "USA",
        },
        unitCount: 36,
        description: "Waterfront condominiums with ocean views",
        features: ["Ocean View", "Balcony", "Pool", "Concierge"],
      },
      {
        name: "Maple Grove Houses",
        type: PropertyType.HOUSE,
        address: {
          street: "321 Maple Grove Lane",
          city: "Sacramento",
          state: "CA",
          zipCode: "95814",
          country: "USA",
        },
        unitCount: 1,
        description: "Single family homes in quiet neighborhood",
        features: ["Garden", "Garage", "Fireplace"],
      },
      {
        name: "Downtown Lofts",
        type: PropertyType.APARTMENT,
        address: {
          street: "654 Downtown Plaza",
          city: "Oakland",
          state: "CA",
          zipCode: "94612",
          country: "USA",
        },
        unitCount: 18,
        description: "Modern lofts in the heart of downtown",
        features: ["High Ceilings", "Exposed Brick", "Parking"],
      },
    ];

    const createdProperties = [];
    for (let i = 0; i < Math.min(count, propertyTemplates.length); i++) {
      const template = propertyTemplates[i];

      // Keep demo data small: cap units per property.
      const unitsToCreate = Math.min(template.unitCount, 5);
      const yearBuilt = 2000 + Math.floor(Math.random() * 23);

      const property = await db.property.create({
        data: {
          organizationId,
          name: template.name,
          type: template.type,
          description: template.description,
          addressStreet: template.address.street,
          addressCity: template.address.city,
          addressState: template.address.state,
          addressZipCode: template.address.zipCode,
          addressCountry: template.address.country,
          ownerId,
          yearBuilt,
          amenities: template.features ?? ["Parking", "Laundry"],
          isMultiUnit: unitsToCreate > 1,
          totalUnits: unitsToCreate,
        },
      });

      // Generate realistic unit details based on the property type
      const units = [];
      for (let u = 0; u < unitsToCreate; u++) {
        const bedroomsRange =
          template.type === PropertyType.HOUSE ? [3, 5] : [1, 3];
        const bedrooms =
          bedroomsRange[0] +
          Math.floor(
            Math.random() * (bedroomsRange[1] - bedroomsRange[0] + 1)
          );
        const bathrooms = Math.max(
          1,
          Math.floor(bedrooms * 0.75) + Math.floor(Math.random() * 2)
        );
        const squareFootage =
          template.type === PropertyType.HOUSE
            ? 1500 + Math.floor(Math.random() * 2000)
            : 800 + Math.floor(Math.random() * 1200);
        const rentAmount =
          Math.floor((squareFootage * (1.5 + Math.random() * 1.5)) / 10) * 10;

        const unit = await db.unit.create({
          data: {
            organizationId,
            propertyId: property.id,
            unitNumber: `${101 + u}`,
            unitType:
              template.type === PropertyType.HOUSE ? "house" : "apartment",
            bedrooms,
            bathrooms,
            squareFootage,
            rentAmount,
            securityDeposit: rentAmount,
            status: "available",
          },
        });
        units.push(unit);
      }

      createdProperties.push({ ...property, units });
    }

    return createdProperties;
  }

  private async createDemoTenants(
    organizationId: string,
    count: number
  ): Promise<any[]> {
    const tenantTemplates = [
      {
        firstName: "Alice",
        lastName: "Johnson",
        email: "alice.johnson@email.com",
      },
      { firstName: "Bob", lastName: "Smith", email: "bob.smith@email.com" },
      { firstName: "Carol", lastName: "Davis", email: "carol.davis@email.com" },
      {
        firstName: "David",
        lastName: "Wilson",
        email: "david.wilson@email.com",
      },
      { firstName: "Emma", lastName: "Brown", email: "emma.brown@email.com" },
      {
        firstName: "Frank",
        lastName: "Miller",
        email: "frank.miller@email.com",
      },
      {
        firstName: "Grace",
        lastName: "Taylor",
        email: "grace.taylor@email.com",
      },
      {
        firstName: "Henry",
        lastName: "Anderson",
        email: "henry.anderson@email.com",
      },
      { firstName: "Ivy", lastName: "Thomas", email: "ivy.thomas@email.com" },
      {
        firstName: "Jack",
        lastName: "Jackson",
        email: "jack.jackson@email.com",
      },
      { firstName: "Kate", lastName: "White", email: "kate.white@email.com" },
      { firstName: "Leo", lastName: "Harris", email: "leo.harris@email.com" },
      { firstName: "Mia", lastName: "Martin", email: "mia.martin@email.com" },
      {
        firstName: "Noah",
        lastName: "Thompson",
        email: "noah.thompson@email.com",
      },
      {
        firstName: "Olivia",
        lastName: "Garcia",
        email: "olivia.garcia@email.com",
      },
    ];

    const createdTenants = [];
    for (let i = 0; i < Math.min(count, tenantTemplates.length); i++) {
      const template = tenantTemplates[i];

      // Create user account for tenant (credentials live in Better Auth)
      const user = await db.user.create({
        data: {
          organizationId,
          firstName: template.firstName,
          lastName: template.lastName,
          email: template.email,
          role: UserRole.TENANT,
          phone: `+1-555-${String(1000 + i).padStart(4, "0")}`,
          isActive: true,
          emailVerified: new Date(),
          emailVerifiedFlag: true,
        },
      });

      // Create tenant profile
      const tenant = await db.tenant.create({
        data: {
          organizationId,
          userId: user.id,
          dateOfBirth: new Date(
            1980 + Math.floor(Math.random() * 30),
            Math.floor(Math.random() * 12),
            Math.floor(Math.random() * 28) + 1
          ),
          emergencyContacts: [
            {
              name: `Emergency Contact ${i + 1}`,
              phone: `+1-555-${String(2000 + i).padStart(4, "0")}`,
              relationship: "Family",
            },
          ],
          employmentInfo: {
            employer: `Company ${i + 1}`,
            position: "Employee",
            monthlyIncome: 3000 + Math.floor(Math.random() * 5000),
            startDate: new Date(
              2020,
              Math.floor(Math.random() * 12),
              1
            ).toISOString(),
          },
        },
      });

      createdTenants.push(tenant);
    }

    return createdTenants;
  }

  private async createDemoLeases(
    organizationId: string,
    properties: any[],
    tenants: any[]
  ): Promise<any[]> {
    const createdLeases = [];
    const usedTenants = new Set<string>();

    for (const property of properties) {
      const units: any[] = property.units ?? [];
      if (units.length === 0) continue;

      // ~80% occupancy (at least one unit when any exist)
      const unitsToFill = Math.max(1, Math.floor(units.length * 0.8));

      for (let i = 0; i < unitsToFill; i++) {
        const unit = units[i];
        if (!unit) break;

        // Find an unused tenant
        const availableTenants = tenants.filter(
          (t) => !usedTenants.has(t.userId)
        );
        if (availableTenants.length === 0) break;

        const tenant =
          availableTenants[Math.floor(Math.random() * availableTenants.length)];
        usedTenants.add(tenant.userId);

        const startDate = new Date();
        startDate.setMonth(
          startDate.getMonth() - Math.floor(Math.random() * 12)
        );

        const endDate = new Date(startDate);
        endDate.setFullYear(endDate.getFullYear() + 1);

        const lease = await db.lease.create({
          data: {
            organizationId,
            propertyId: property.id,
            tenantId: tenant.userId, // leases reference the tenant's user id
            unitId: unit.id,
            startDate,
            endDate,
            status: LeaseStatus.ACTIVE,
            terms: {
              rentAmount: unit.rentAmount || 1200,
              securityDeposit:
                unit.securityDeposit || unit.rentAmount || 1000,
              utilities: ["water", "sewer"],
              restrictions: ["no_pets", "no_smoking"],
            },
          },
        });

        // Mark the unit occupied by this lease
        await db.unit.update({
          where: { id: unit.id },
          data: {
            status: "occupied",
            currentTenantId: tenant.userId,
            currentLeaseId: lease.id,
          },
        });

        createdLeases.push(lease);
      }
    }

    return createdLeases;
  }

  private async createDemoPayments(
    organizationId: string,
    leases: any[]
  ): Promise<any[]> {
    const createdPayments = [];

    for (const lease of leases) {
      const rentAmount = (lease.terms as any)?.rentAmount || 1200;

      // Create 3-6 months of payment history
      const paymentCount = 3 + Math.floor(Math.random() * 4);

      for (let i = 0; i < paymentCount; i++) {
        const dueDate = new Date();
        dueDate.setMonth(dueDate.getMonth() - i);
        dueDate.setDate(1); // First of the month

        const isPaid = i !== 0;
        const payment = await db.payment.create({
          data: {
            organizationId,
            tenantId: lease.tenantId,
            propertyId: lease.propertyId,
            leaseId: lease.id,
            amount: rentAmount,
            amountPaid: isPaid ? rentAmount : 0,
            type: "rent",
            dueDate,
            paidDate: isPaid
              ? new Date(
                  dueDate.getTime() +
                    Math.floor(Math.random() * 10) * 24 * 60 * 60 * 1000
                )
              : undefined,
            status: isPaid ? PaymentStatus.PAID : PaymentStatus.PENDING,
            paymentMethod: ["credit_card", "bank_transfer", "check"][
              Math.floor(Math.random() * 3)
            ],
            description: `Rent payment for ${dueDate.toLocaleDateString(
              "en-US",
              {
                month: "long",
                year: "numeric",
              }
            )}`,
          },
        });

        createdPayments.push(payment);
      }
    }

    postAfterCommit(
      "payment",
      createdPayments.map((payment) => payment.id),
    );
    return createdPayments;
  }

  private async createDemoMaintenance(
    organizationId: string,
    properties: any[],
    tenants: any[]
  ): Promise<any[]> {
    const maintenanceTypes = [
      {
        title: "Leaky Faucet",
        description: "Kitchen faucet is dripping constantly",
        priority: "medium",
      },
      {
        title: "Broken Air Conditioning",
        description: "AC unit not cooling properly",
        priority: "high",
      },
      {
        title: "Clogged Drain",
        description: "Bathroom sink drain is blocked",
        priority: "medium",
      },
      {
        title: "Electrical Issue",
        description: "Light switch not working in bedroom",
        priority: "high",
      },
      {
        title: "Paint Touch-up",
        description: "Wall needs paint repair after moving furniture",
        priority: "low",
      },
      {
        title: "Window Won't Close",
        description: "Living room window is stuck open",
        priority: "medium",
      },
      {
        title: "Garbage Disposal",
        description: "Kitchen garbage disposal making strange noise",
        priority: "medium",
      },
      {
        title: "Heating Problem",
        description: "Heater not working properly",
        priority: "high",
      },
    ];

    const createdMaintenance = [];

    for (let i = 0; i < Math.min(15, properties.length * 3); i++) {
      const property =
        properties[Math.floor(Math.random() * properties.length)];
      const tenant = tenants[Math.floor(Math.random() * tenants.length)];
      const template =
        maintenanceTypes[Math.floor(Math.random() * maintenanceTypes.length)];

      const request = await db.maintenanceRequest.create({
        data: {
          organizationId,
          propertyId: property.id,
          tenantId: tenant.userId, // maintenance references the tenant's user id
          title: template.title,
          description: template.description,
          priority: template.priority,
          status: [
            MaintenanceStatus.SUBMITTED,
            MaintenanceStatus.IN_PROGRESS,
            MaintenanceStatus.COMPLETED,
          ][Math.floor(Math.random() * 3)],
          category: ["Plumbing", "Electrical", "HVAC", "General Repair"][
            Math.floor(Math.random() * 4)
          ],
          estimatedCost: 50 + Math.floor(Math.random() * 500),
        },
      });

      createdMaintenance.push(request);
    }

    return createdMaintenance;
  }

  private async createDemoMessages(
    organizationId: string,
    users: any[],
    properties: any[]
  ): Promise<any[]> {
    const createdMessages = [];
    const messageTemplates = [
      {
        subject: "Welcome to PropertyPro",
        content:
          "Welcome to our property management system! Please let us know if you have any questions.",
        messageType: "general",
      },
      {
        subject: "Rent Reminder",
        content:
          "This is a friendly reminder that your rent payment is due on the 1st of each month.",
        messageType: "payment",
      },
      {
        subject: "Maintenance Update",
        content:
          "Your maintenance request has been received and will be addressed within 24-48 hours.",
        messageType: "maintenance",
      },
    ];

    const manager = users.find((u) => u.role === UserRole.MANAGER);
    const tenantUsers = users.filter((u) => u.role === UserRole.TENANT);

    for (let i = 0; i < Math.min(10, tenantUsers.length); i++) {
      const tenant = tenantUsers[i];
      const template = messageTemplates[i % messageTemplates.length];

      // Messages belong to a conversation (real table with FK)
      const conversation = await db.conversation.create({
        data: {
          organizationId,
          type: "individual",
          participants: [
            { userId: manager.id, role: "member", isActive: true },
            { userId: tenant.id, role: "member", isActive: true },
          ],
          participantIds: [manager.id, tenant.id],
          createdById: manager.id,
        },
      });

      const message = await db.message.create({
        data: {
          organizationId,
          conversationId: conversation.id,
          senderId: manager.id,
          recipientId: tenant.id,
          propertyId:
            properties[Math.floor(Math.random() * properties.length)]?.id,
          subject: template.subject,
          content: template.content,
          messageType: template.messageType,
          priority: "normal",
          status: "sent",
          isSystemMessage: false,
        },
      });

      createdMessages.push(message);
    }

    return createdMessages;
  }

  private async createDemoEvents(
    organizationId: string,
    users: any[],
    properties: any[]
  ): Promise<any[]> {
    const createdEvents = [];
    const eventTemplates = [
      {
        title: "Property Inspection - Unit 1A",
        description: "Quarterly property inspection",
        type: EventType.PROPERTY_INSPECTION,
      },
      {
        title: "Lease Renewal Meeting",
        description: "Discuss lease renewal terms",
        type: EventType.LEASE_RENEWAL,
      },
      {
        title: "Maintenance Appointment",
        description: "Fix kitchen faucet",
        type: EventType.MAINTENANCE_APPOINTMENT,
      },
    ];

    const organizer = users.find((u) => u.role === UserRole.MANAGER);

    for (let i = 0; i < 8; i++) {
      const template = eventTemplates[i % eventTemplates.length];
      const startDate = new Date();
      startDate.setDate(startDate.getDate() + Math.floor(Math.random() * 30));
      startDate.setHours(9 + Math.floor(Math.random() * 8), 0, 0, 0);

      const endDate = new Date(startDate);
      endDate.setHours(endDate.getHours() + 1);

      const event = await db.event.create({
        data: {
          organizationId,
          title: template.title,
          description: template.description,
          type: template.type,
          status: EventStatus.SCHEDULED,
          priority: "normal",
          startDate,
          endDate,
          allDay: false,
          timezone: "UTC",
          propertyId:
            properties[Math.floor(Math.random() * properties.length)]?.id,
          organizerId: organizer.id,
          attendees: [],
          attendeeIds: [],
          isRecurring: false,
          reminders: [{ type: "email", minutesBefore: 15, sent: false }],
          createdById: organizer.id,
        },
      });

      createdEvents.push(event);
    }

    return createdEvents;
  }

  private async createDemoAnnouncements(
    organizationId: string,
    adminUser: any
  ): Promise<any[]> {
    const announcementTemplates = [
      {
        title: "Welcome to PropertyPro Demo",
        content:
          "Welcome to the PropertyPro demo! This system includes sample data to help you explore all features. Feel free to test all functionality.",
        priority: "normal",
        type: "general",
      },
      {
        title: "Building Maintenance Schedule",
        content:
          "Please note that building maintenance will be performed this weekend. Water may be temporarily unavailable on Saturday from 9 AM to 12 PM.",
        priority: "high",
        type: "maintenance",
      },
      {
        title: "New Parking Regulations",
        content:
          "New parking regulations are now in effect. Please ensure your vehicle is properly registered and displays the required permit.",
        priority: "normal",
        type: "policy",
      },
    ];

    const createdAnnouncements = [];

    for (const template of announcementTemplates) {
      const announcement = await db.announcement.create({
        data: {
          organizationId,
          title: template.title,
          content: template.content,
          priority: template.priority,
          type: template.type,
          targetAudience: {
            includeAll: true,
          },
          status: "published",
          publishedAt: new Date(),
          isSticky: false,
          allowComments: true,
          createdById: adminUser.id,
          views: [],
          reactions: [],
        },
      });

      createdAnnouncements.push(announcement);
    }

    return createdAnnouncements;
  }

  async clearDemoData(): Promise<{
    success: boolean;
    message: string;
    /** Rows destroyed per table, when the clear went through. */
    deleted?: DemoDataPurgeCounts;
    /** True when the database refused it and nothing was deleted. */
    refused?: boolean;
  }> {
    try {
      const organizationId = requireOrgId();

      // All of it or none of it: see purgeOrganizationData for why one
      // transaction, and for the order the tables go in.
      const deleted = await runWithOrgTransaction((tx) =>
        purgeOrganizationData(tx, organizationId),
      );

      return {
        success: true,
        message: "Demo data cleared successfully",
        deleted,
      };
    } catch (error) {
      console.error("Error clearing demo data:", error);
      if (isForeignKeyRefusal(error)) {
        return {
          success: false,
          refused: true,
          message: DEMO_DATA_PURGE_REFUSED_MESSAGE,
        };
      }
      return {
        success: false,
        message: "Failed to clear demo data",
      };
    }
  }
}

export const demoDataService = DemoDataService.getInstance();
