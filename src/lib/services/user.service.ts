/**
 * PropertyPro - User Service
 * API service for user-related operations
 */

import { UserRole } from "@/types";

// ============================================================================
// TYPES
// ============================================================================

export interface UserResponse {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  phone?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  role?: UserRole;
  isActive?: boolean;
}

export interface PaginatedUsersResponse {
  data: UserResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// ============================================================================
// API SERVICE
// ============================================================================

class UserService {
  private baseUrl = "/api/users";

  /**
   * Get all users with pagination and filtering
   */
  async getUsers(params?: UserQueryParams): Promise<PaginatedUsersResponse> {
    const searchParams = new URLSearchParams();

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          searchParams.append(key, value.toString());
        }
      });
    }

    const url = `${this.baseUrl}${
      searchParams.toString() ? `?${searchParams.toString()}` : ""
    }`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });


    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: "Unknown error" }));
      console.error("Users API error:", error);
      throw new Error(error.error || error.message || "Failed to fetch users");
    }

    const result = await response.json();

    return result;
  }

  /**
   * Get users by role (useful for dropdowns)
   */
  async getUsersByRole(role: UserRole): Promise<UserResponse[]> {
    try {
      const response = await this.getUsers({ role, limit: 100 });
      // Filter out users with invalid IDs
      return response.data.filter((user) => user._id && user._id.trim() !== "");
    } catch (error) {
      console.error(`Error fetching users with role ${role}:`, error);
      return [];
    }
  }

  /**
   * Get property owners (users with owner role)
   */
  async getPropertyOwners(): Promise<UserResponse[]> {
    return this.getUsersByRole(UserRole.MANAGER);
  }

  /**
   * Get property managers (users with property_manager role)
   */
  async getPropertyManagers(): Promise<UserResponse[]> {
    return this.getUsersByRole(UserRole.MANAGER);
  }

  /**
   * Get a single user by ID
   */
  async getUser(id: string): Promise<UserResponse> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || error.message || "Failed to fetch user");
    }

    const result = await response.json();
    return result.data;
  }
}

// Export singleton instance
export const userService = new UserService();
export default userService;
