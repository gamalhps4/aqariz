/**
 * PropertyPro - Emergency Mobile Dashboard
 * Mobile-optimized dashboard for emergency management on-the-go
 */

"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CheckCircle,
  Phone,
  MapPin,
  Zap,
  User,
  RefreshCw,
  Plus,
  Navigation,
  Bell,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface EmergencyRequest {
  _id: string;
  title: string;
  description: string;
  status: string;
  urgencyLevel: "normal" | "overdue" | "critical";
  property: {
    name: string;
    address: string;
  };
  tenant: {
    firstName: string;
    lastName: string;
    phone: string;
  };
  assignedUser?: {
    firstName: string;
    lastName: string;
  };
  hoursSinceCreation: number;
  isOverdue: boolean;
  createdAt: string;
}

interface EmergencyStats {
  activeEmergencies: number;
  overdueEmergencies: number;
  criticalCount: number;
  unassignedEmergencies: number;
}

interface EmergencyMobileDashboardProps {
  userRole: string;
  userId: string;
}

export function EmergencyMobileDashboard({
  userRole,
  userId,
}: EmergencyMobileDashboardProps) {
  const [requests, setRequests] = useState<EmergencyRequest[]>([]);
  const [stats, setStats] = useState<EmergencyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      const [requestsRes, statsRes] = await Promise.all([
        fetch("/api/maintenance/emergency?limit=10&status=active"),
        fetch("/api/maintenance/emergency/stats?timeframe=1"),
      ]);

      if (requestsRes.ok) {
        const requestsData = await requestsRes.json();
        setRequests(requestsData.data.requests || []);
      }

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData.data.overview);
      }
    } catch (error) {
      toast.error("Failed to load emergency data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const handleQuickAction = async (requestId: string, action: string) => {
    try {
      let endpoint = "";
      let method = "PATCH";
      let body = {};

      switch (action) {
        case "accept":
          endpoint = `/api/maintenance/${requestId}`;
          body = { status: "assigned", assignedTo: userId };
          break;
        case "start":
          endpoint = `/api/maintenance/${requestId}`;
          body = { status: "in_progress" };
          break;
        case "complete":
          endpoint = `/api/maintenance/${requestId}`;
          body = { status: "completed" };
          break;
        case "escalate":
          endpoint = `/api/maintenance/emergency/escalate`;
          method = "POST";
          body = { requestId, escalationReason: "Mobile escalation" };
          break;
      }

      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        toast.success(`Emergency ${action}ed successfully`);
        fetchData();
      } else {
        throw new Error("Failed to update request");
      }
    } catch (error) {
      toast.error(`Failed to ${action} emergency`);
    }
  };

  const getUrgencyColor = (urgencyLevel: string) => {
    switch (urgencyLevel) {
      case "critical":
        return "bg-red-500 text-white";
      case "overdue":
        return "bg-orange-500 text-white";
      default:
        return "bg-yellow-500 text-white";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "submitted":
        return "bg-blue-100 text-blue-800";
      case "assigned":
        return "bg-purple-100 text-purple-800";
      case "in_progress":
        return "bg-orange-100 text-orange-800";
      case "completed":
        return "bg-green-100 text-green-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  useEffect(() => {
    fetchData();

    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-red-50 p-4">
        <div className="space-y-4">
          <div className="h-8 bg-gray-200 rounded animate-pulse" />
          <div className="grid grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 bg-gray-200 rounded animate-pulse" />
            ))}
          </div>
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-32 bg-gray-200 rounded animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-red-50 p-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-red-700 flex items-center gap-2">
            <Zap className="h-6 w-6" />
            Emergencies
          </h1>
          <p className="text-sm text-red-600">Active emergency requests</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
          </Button>
          <Button size="sm" className="bg-red-600 hover:bg-red-700" asChild>
            <Link href="/dashboard/maintenance/emergency/new">
              <Plus className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 mb-6">
          <Card className="border-red-200">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-red-600">
                {stats.activeEmergencies}
              </div>
              <div className="text-xs text-red-700">Active</div>
            </CardContent>
          </Card>
          <Card className="border-orange-200">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-orange-600">
                {stats.overdueEmergencies}
              </div>
              <div className="text-xs text-orange-700">Overdue</div>
            </CardContent>
          </Card>
          <Card className="border-red-300">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-red-700">
                {stats.criticalCount}
              </div>
              <div className="text-xs text-red-800">Critical</div>
            </CardContent>
          </Card>
          <Card className="border-yellow-200">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-yellow-600">
                {stats.unassignedEmergencies}
              </div>
              <div className="text-xs text-yellow-700">Unassigned</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Emergency Requests */}
      <div className="space-y-3">
        {requests.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-green-700">
                All Clear!
              </h3>
              <p className="text-sm text-muted-foreground">
                No active emergencies
              </p>
            </CardContent>
          </Card>
        ) : (
          requests.map((request) => (
            <Card key={request._id} className="border-red-200">
              <CardContent className="p-4">
                <div className="space-y-3">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold text-red-700 text-sm leading-tight">
                        {request.title}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge
                          className={getUrgencyColor(request.urgencyLevel)}
                        >
                          {request.urgencyLevel.toUpperCase()}
                        </Badge>
                        <Badge className={getStatusColor(request.status)}>
                          {request.status.replace("_", " ").toUpperCase()}
                        </Badge>
                      </div>
                    </div>
                    <div className="text-end text-xs text-muted-foreground">
                      <div className="font-medium">
                        {Math.round(request.hoursSinceCreation)}h ago
                      </div>
                    </div>
                  </div>

                  {/* Property & Contact */}
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3 w-3 text-muted-foreground" />
                      <span className="font-medium">
                        {request.property.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <User className="h-3 w-3 text-muted-foreground" />
                      <span>
                        {request.tenant.firstName} {request.tenant.lastName}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="p-1 h-auto"
                        asChild
                      >
                        <a href={`tel:${request.tenant.phone}`}>
                          <Phone className="h-3 w-3 text-blue-600" />
                        </a>
                      </Button>
                    </div>
                  </div>

                  {/* Assignment */}
                  {request.assignedUser && (
                    <div className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" />
                      Assigned to {request.assignedUser.firstName}{" "}
                      {request.assignedUser.lastName}
                    </div>
                  )}

                  {/* Quick Actions */}
                  <div className="flex gap-2 pt-2 border-t">
                    {request.status === "submitted" &&
                      !request.assignedUser && (
                        <Button
                          size="sm"
                          className="flex-1 bg-red-600 hover:bg-red-700"
                          onClick={() =>
                            handleQuickAction(request._id, "accept")
                          }
                        >
                          Accept
                        </Button>
                      )}

                    {request.status === "assigned" && request.assignedUser && (
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => handleQuickAction(request._id, "start")}
                      >
                        Start Work
                      </Button>
                    )}

                    {request.status === "in_progress" && (
                      <Button
                        size="sm"
                        className="flex-1 bg-green-600 hover:bg-green-700"
                        onClick={() =>
                          handleQuickAction(request._id, "complete")
                        }
                      >
                        Complete
                      </Button>
                    )}

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleQuickAction(request._id, "escalate")}
                    >
                      <AlertTriangle className="h-3 w-3" />
                    </Button>

                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/dashboard/maintenance/${request._id}`}>
                        View
                      </Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Floating Action Button */}
      <div className="fixed bottom-6 end-6">
        <Button
          size="lg"
          className="rounded-full w-14 h-14 bg-red-600 hover:bg-red-700 shadow-lg"
          asChild
        >
          <Link href="/dashboard/maintenance/emergency/new">
            <Plus className="h-6 w-6" />
          </Link>
        </Button>
      </div>

      {/* Emergency Hotline */}
      <div className="fixed bottom-6 start-6">
        <Button
          variant="outline"
          size="lg"
          className="rounded-full w-14 h-14 border-red-300 bg-white shadow-lg"
          asChild
        >
          <a href="tel:911">
            <Phone className="h-6 w-6 text-red-600" />
          </a>
        </Button>
      </div>
    </div>
  );
}
