/**
 * PropertyPro - Payment API Client
 * Centralized API client for all payment-related backend communications
 */

import { DashboardMetrics } from "@/lib/services/payment-dashboard.service";
import { IPayment } from "@/types";

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data: T;
}

export interface PaymentFilters {
  propertyId?: string;
  tenantId?: string;
  status?: string;
  dateRange?: {
    start: Date;
    end: Date;
  };
  type?: string;
}

export interface PaymentSummary {
  currentBalance: number;
  nextPaymentDate: Date | null;
  nextPaymentAmount: number;
  autoPayEnabled: boolean;
  totalPaid: number;
  totalOutstanding: number;
}

class PaymentApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  }

  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    try {
      const url = `${this.baseUrl}/api${endpoint}`;
      const response = await fetch(url, {
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
        ...options,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error(`API request failed for ${endpoint}:`, error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
        // Error responses carry no payload; callers must check `success`
        // before reading `data`.
        data: null as T,
      };
    }
  }

  // Dashboard API methods
  async getDashboardMetrics(filters?: {
    propertyId?: string;
    managerId?: string;
    timeRange?: string;
    dateRange?: { start: Date; end: Date };
  }): Promise<ApiResponse<DashboardMetrics>> {
    return this.makeRequest<DashboardMetrics>("/payments/dashboard", {
      method: "POST",
      body: JSON.stringify(filters || {}),
    });
  }

  async refreshDashboardMetrics(
    propertyId?: string
  ): Promise<ApiResponse<DashboardMetrics>> {
    return this.makeRequest<DashboardMetrics>("/payments/dashboard", {
      method: "PATCH",
      body: JSON.stringify({ propertyId, forceRefresh: true }),
    });
  }

  // Tenant Payment API methods
  async getTenantPaymentSummary(
    tenantId: string,
    leaseId?: string
  ): Promise<ApiResponse<PaymentSummary>> {
    const params = new URLSearchParams({ tenantId });
    if (leaseId) params.append("leaseId", leaseId);

    return this.makeRequest<PaymentSummary>(
      `/tenant/payment-summary?${params}`
    );
  }

  async getTenantPayments(
    tenantId: string,
    leaseId?: string,
    filters?: PaymentFilters
  ): Promise<ApiResponse<{ payments: IPayment[]; pagination?: any }>> {
    const params = new URLSearchParams({ tenantId });
    if (leaseId) params.append("leaseId", leaseId);

    if (filters?.status) {
      params.append("status", filters.status);
    }

    if (filters?.type) {
      params.append("type", filters.type);
    }

    if (filters?.dateRange?.start) {
      params.append("startDate", filters.dateRange.start.toISOString());
    }

    if (filters?.dateRange?.end) {
      params.append("endDate", filters.dateRange.end.toISOString());
    }

    return this.makeRequest<{ payments: IPayment[]; pagination?: any }>(
      `/tenant/payments?${params}`
    );
  }

  async getTenantPaymentMethods(tenantId: string): Promise<ApiResponse<any[]>> {
    return this.makeRequest<any[]>(
      `/tenant/payment-methods?tenantId=${tenantId}`
    );
  }

  // Payment Processing API methods
  async createPaymentIntent(
    amount: number,
    paymentMethodId?: string
  ): Promise<ApiResponse<{ clientSecret: string; paymentIntentId: string }>> {
    return this.makeRequest("/payments/create-intent", {
      method: "POST",
      body: JSON.stringify({ amount, paymentMethodId }),
    });
  }

  async confirmPayment(
    paymentIntentId: string,
    paymentId: string
  ): Promise<ApiResponse<IPayment>> {
    return this.makeRequest("/payments/confirm", {
      method: "POST",
      body: JSON.stringify({ paymentIntentId, paymentId }),
    });
  }

  // Auto-pay API methods
  async toggleAutoPay(
    tenantId: string,
    leaseId: string,
    enabled: boolean,
    paymentMethodId?: string
  ): Promise<ApiResponse<{ autoPayEnabled: boolean }>> {
    return this.makeRequest("/tenant/autopay", {
      method: "POST",
      body: JSON.stringify({ tenantId, leaseId, enabled, paymentMethodId }),
    });
  }

  async getAutoPayStatus(
    tenantId: string,
    leaseId: string
  ): Promise<ApiResponse<{ enabled: boolean; paymentMethodId?: string }>> {
    return this.makeRequest(
      `/tenant/autopay?tenantId=${tenantId}&leaseId=${leaseId}`
    );
  }

  // Payment Method Management
  async addPaymentMethod(
    tenantId: string,
    paymentMethodData: {
      type: "card" | "bank_account";
      token: string;
      isDefault?: boolean;
      nickname?: string;
    }
  ): Promise<ApiResponse<any>> {
    return this.makeRequest("/tenant/payment-methods", {
      method: "POST",
      body: JSON.stringify({ tenantId, ...paymentMethodData }),
    });
  }

  async removePaymentMethod(
    tenantId: string,
    paymentMethodId: string
  ): Promise<ApiResponse<{ success: boolean }>> {
    return this.makeRequest(`/tenant/payment-methods/${paymentMethodId}`, {
      method: "DELETE",
      body: JSON.stringify({ tenantId }),
    });
  }

  async setDefaultPaymentMethod(
    tenantId: string,
    paymentMethodId: string
  ): Promise<ApiResponse<{ success: boolean }>> {
    return this.makeRequest(
      `/tenant/payment-methods/${paymentMethodId}/default`,
      {
        method: "PATCH",
        body: JSON.stringify({ tenantId }),
      }
    );
  }

  // Analytics API methods
  async getPaymentAnalytics(
    startDate: Date,
    endDate: Date,
    filters?: {
      propertyId?: string;
      managerId?: string;
      tenantId?: string;
    }
  ): Promise<ApiResponse<any>> {
    return this.makeRequest("/payments/analytics", {
      method: "POST",
      body: JSON.stringify({ startDate, endDate, filters }),
    });
  }

  // Communication API methods
  async sendPaymentReminder(
    paymentId: string,
    reminderType: "reminder" | "overdue" | "final_notice"
  ): Promise<ApiResponse<{ success: boolean }>> {
    return this.makeRequest(`/payments/${paymentId}/remind`, {
      method: "POST",
      body: JSON.stringify({ reminderType }),
    });
  }

  async processAutomatedCommunications(): Promise<ApiResponse<any>> {
    return this.makeRequest("/payments/communications/process", {
      method: "POST",
    });
  }

  // System Management
  async runDailyProcessing(): Promise<ApiResponse<any>> {
    return this.makeRequest("/payments/system/daily-processing", {
      method: "POST",
    });
  }

  async getSystemHealth(): Promise<ApiResponse<any>> {
    return this.makeRequest("/payments/system/health");
  }

  // Lease Setup
  async setupLeasePaymentSystem(
    leaseId: string,
    options?: {
      enableProration?: boolean;
      enableAutoCommunication?: boolean;
    }
  ): Promise<ApiResponse<any>> {
    return this.makeRequest("/leases/setup-payments", {
      method: "POST",
      body: JSON.stringify({ leaseId, options }),
    });
  }
}

export const paymentApiClient = new PaymentApiClient();
