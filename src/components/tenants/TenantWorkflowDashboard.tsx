"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  Users,
  UserCheck,
  Clock,
  AlertTriangle,
  TrendingUp,
  CheckCircle,
  XCircle,
  Calendar,
  FileText,
} from "lucide-react";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useRolePermissions } from "@/hooks/useRolePermissions";

interface TenantWorkflowDashboardProps {
  userRole?: string;
}

interface TenantStatistics {
  overview: {
    totalTenants: number;
    activeTenants: number;
    movedOutTenants: number;
    pendingMoveIn: number;
  };
  statusBreakdown: Record<string, number>;
  backgroundCheckBreakdown: Record<string, number>;
  applicationTrends: Array<{
    _id: { year: number; month: number };
    applications: number;
    approved: number;
    rejected: number;
  }>;
  generatedAt: string;
  timeframe: string;
}

export default function TenantWorkflowDashboard({
}: TenantWorkflowDashboardProps) {
  const { isCompanyStaff, accessProfile } = useAuthorization();
  const { hasAnyPermission } = useRolePermissions();
  const hasTenantManagement = accessProfile.isSystemRole
    ? isCompanyStaff
    : hasAnyPermission(["tenant_management", "tenant_edit"]);
  const [statistics, setStatistics] = useState<TenantStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState("all");

  useEffect(() => {
    fetchStatistics();
  }, [timeframe]);

  const fetchStatistics = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/tenants/statistics?timeframe=${timeframe}&includeHistory=true`
      );
      if (response.ok) {
        const data = await response.json();
        setStatistics(data?.data || null);
      }
    } catch (error) {
      toast.error("Failed to load tenant statistics", {
        description:
          error instanceof Error ? error.message : "Please try again shortly",
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="h-4 w-20 bg-muted animate-pulse rounded" />
              <div className="h-4 w-4 bg-muted animate-pulse rounded" />
            </CardHeader>
            <CardContent>
              <div className="h-8 w-16 bg-muted animate-pulse rounded mb-2" />
              <div className="h-3 w-24 bg-muted animate-pulse rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!statistics) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-32">
          <p className="text-muted-foreground">
            Failed to load tenant statistics
          </p>
        </CardContent>
      </Card>
    );
  }

  const statusColors: Record<string, string> = {
    application_submitted: "#94a3b8",
    under_review: "#f59e0b",
    approved: "#10b981",
    active: "#3b82f6",
    inactive: "#6b7280",
    moved_out: "#8b5cf6",
    terminated: "#ef4444",
  };

  const statusLabels: Record<string, string> = {
    application_submitted: "Applications",
    under_review: "Under Review",
    approved: "Approved",
    active: "Active",
    inactive: "Inactive",
    moved_out: "Moved Out",
    terminated: "Terminated",
  };

  const pieData = Object.entries(statistics.statusBreakdown).map(
    ([status, count]) => ({
      name: statusLabels[status] || status,
      value: count,
      color: statusColors[status] || "#6b7280",
    })
  );

  const trendData = statistics.applicationTrends.map((item) => ({
    month: `${item._id.year}-${String(item._id.month).padStart(2, "0")}`,
    applications: item.applications,
    approved: item.approved,
    rejected: item.rejected,
    approvalRate:
      item.applications > 0 ? (item.approved / item.applications) * 100 : 0,
  }));

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tenants</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statistics.overview.totalTenants}
            </div>
            <p className="text-xs text-muted-foreground">All tenant records</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Active Tenants
            </CardTitle>
            <UserCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statistics.overview.activeTenants}
            </div>
            <p className="text-xs text-muted-foreground">
              Currently living in properties
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Pending Move-in
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statistics.overview.pendingMoveIn}
            </div>
            <p className="text-xs text-muted-foreground">
              Approved, awaiting move-in
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Moved Out</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statistics.overview.movedOutTenants}
            </div>
            <p className="text-xs text-muted-foreground">Former tenants</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Tenant Status Distribution</CardTitle>
            <CardDescription>
              Current status breakdown of all tenants
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-4">
              {pieData.map((entry, index) => (
                <div key={index} className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="text-sm">
                    {entry.name}: {entry.value}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Application Trends */}
        <Card>
          <CardHeader>
            <CardTitle>Application Trends</CardTitle>
            <CardDescription>
              Monthly application and approval trends
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Bar
                    dataKey="applications"
                    fill="#3b82f6"
                    name="Applications"
                  />
                  <Bar dataKey="approved" fill="#10b981" name="Approved" />
                  <Bar dataKey="rejected" fill="#ef4444" name="Rejected" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Background Check Status */}
      <Card>
        <CardHeader>
          <CardTitle>Background Check Status</CardTitle>
          <CardDescription>
            Current background check processing status
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            {Object.entries(statistics.backgroundCheckBreakdown).map(
              ([status, count]) => {
                const icons: Record<string, typeof Clock> = {
                  pending: Clock,
                  approved: CheckCircle,
                  rejected: XCircle,
                };
                const colors: Record<string, string> = {
                  pending: "secondary",
                  approved: "default",
                  rejected: "destructive",
                };
                const Icon = icons[status] || FileText;

                return (
                  <div
                    key={status}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="h-5 w-5" />
                      <div>
                        <p className="font-medium capitalize">{status}</p>
                        <p className="text-2xl font-bold">{count}</p>
                      </div>
                    </div>
                    <Badge variant={colors[status] as any}>{status}</Badge>
                  </div>
                );
              }
            )}
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      {hasTenantManagement && (
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common tenant management actions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm">
                <FileText className="h-4 w-4 me-2" />
                Export Report
              </Button>
              <Button variant="outline" size="sm">
                <TrendingUp className="h-4 w-4 me-2" />
                View Analytics
              </Button>
              <Button variant="outline" size="sm">
                <AlertTriangle className="h-4 w-4 me-2" />
                Review Pending
              </Button>
              <Button variant="outline" size="sm">
                <Users className="h-4 w-4 me-2" />
                Bulk Actions
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="text-xs text-muted-foreground">
        Last updated: {new Date(statistics.generatedAt).toLocaleString()}
      </div>
    </div>
  );
}
