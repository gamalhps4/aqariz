export type TenantStatus =
  | "application_submitted"
  | "under_review"
  | "approved"
  | "active"
  | "inactive"
  | "moved_out"
  | "terminated";

export interface TenantRecord {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  avatar?: string;
  role: string;
  dateOfBirth?: string;
  employmentInfo?: {
    employer: string;
    position: string;
    income: number;
    startDate: string;
  };
  emergencyContacts: Array<{
    name: string;
    relationship: string;
    phone: string;
    email?: string;
  }>;
  creditScore?: number;
  backgroundCheckStatus?: "pending" | "approved" | "rejected";
  tenantStatus?: TenantStatus;
  displayStatus?: string;
  statusColor?: string;
  moveInDate?: string;
  moveOutDate?: string;
  applicationDate: string;
  screeningScore?: number;
  applicationNotes?: string;
  lastStatusUpdate?: string;
  hasActiveLease?: boolean;
  activeLeaseCount?: number;
  createdAt: string;
  updatedAt: string;
}
