"use client";

import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Users,
  UserPlus,
  Mail,
  Phone,
  Calendar,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  Clock,
  Plus,
  Search,
  Filter,
  Edit,
  Eye,
  FileText,
  CreditCard,
  Home,
  MessageSquare,
  Bell,
} from "lucide-react";

interface Tenant {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  emergencyContact: {
    name: string;
    phone: string;
    relationship: string;
  };
  unit: {
    id: string;
    number: string;
    propertyName: string;
    address: string;
  };
  lease: {
    id: string;
    startDate: Date;
    endDate: Date;
    monthlyRent: number;
    deposit: number;
    status: "active" | "expiring" | "expired" | "terminated";
  };
  paymentHistory: {
    totalPaid: number;
    onTimePayments: number;
    latePayments: number;
    lastPaymentDate: Date;
    outstandingBalance: number;
  };
  status: "active" | "notice_given" | "moving_out" | "inactive";
  moveInDate: Date;
  documents: Array<{
    id: string;
    name: string;
    type: "lease" | "application" | "id" | "income" | "other";
    uploadDate: Date;
  }>;
  notes: string;
}
import { formatCurrency } from "@/lib/utils/formatting";

interface TenantMetrics {
  totalTenants: number;
  activeTenants: number;
  leasesExpiring: number;
  averageRent: number;
  occupancyRate: number;
  onTimePaymentRate: number;
  averageTenancy: number;
  renewalRate: number;
}

export default function TenantManagementDashboard() {
  const [tenants, setTenants] = useState<Tenant[]>([
    {
      id: "tenant_1",
      firstName: "John",
      lastName: "Smith",
      email: "john.smith@email.com",
      phone: "+1 (555) 123-4567",
      emergencyContact: {
        name: "Jane Smith",
        phone: "+1 (555) 987-6543",
        relationship: "Spouse",
      },
      unit: {
        id: "unit_1",
        number: "101",
        propertyName: "Sunset Apartments",
        address: "123 Main Street",
      },
      lease: {
        id: "lease_1",
        startDate: new Date("2023-06-01"),
        endDate: new Date("2024-05-31"),
        monthlyRent: 1500,
        deposit: 1500,
        status: "expiring",
      },
      paymentHistory: {
        totalPaid: 13500,
        onTimePayments: 8,
        latePayments: 1,
        lastPaymentDate: new Date("2024-01-01"),
        outstandingBalance: 0,
      },
      status: "active",
      moveInDate: new Date("2023-06-01"),
      documents: [
        {
          id: "doc_1",
          name: "Lease Agreement",
          type: "lease",
          uploadDate: new Date("2023-05-15"),
        },
        {
          id: "doc_2",
          name: "Driver License",
          type: "id",
          uploadDate: new Date("2023-05-15"),
        },
      ],
      notes: "Excellent tenant, always pays on time.",
    },
    {
      id: "tenant_2",
      firstName: "Sarah",
      lastName: "Johnson",
      email: "sarah.johnson@email.com",
      phone: "+1 (555) 234-5678",
      emergencyContact: {
        name: "Mike Johnson",
        phone: "+1 (555) 876-5432",
        relationship: "Brother",
      },
      unit: {
        id: "unit_2",
        number: "205",
        propertyName: "Oak Hill Residences",
        address: "456 Oak Avenue",
      },
      lease: {
        id: "lease_2",
        startDate: new Date("2023-09-01"),
        endDate: new Date("2024-08-31"),
        monthlyRent: 1800,
        deposit: 1800,
        status: "active",
      },
      paymentHistory: {
        totalPaid: 7200,
        onTimePayments: 3,
        latePayments: 1,
        lastPaymentDate: new Date("2024-01-05"),
        outstandingBalance: 50,
      },
      status: "active",
      moveInDate: new Date("2023-09-01"),
      documents: [
        {
          id: "doc_3",
          name: "Lease Agreement",
          type: "lease",
          uploadDate: new Date("2023-08-15"),
        },
        {
          id: "doc_4",
          name: "Pay Stub",
          type: "income",
          uploadDate: new Date("2023-08-15"),
        },
      ],
      notes: "Occasionally late with payments but communicates well.",
    },
  ]);

  const [metrics, setMetrics] = useState<TenantMetrics>({
    totalTenants: 45,
    activeTenants: 42,
    leasesExpiring: 8,
    averageRent: 1650,
    occupancyRate: 0.94,
    onTimePaymentRate: 0.89,
    averageTenancy: 18,
    renewalRate: 0.78,
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterProperty, setFilterProperty] = useState<string>("all");

  // const formatCurrency = (amount: number) => {
  //   return new Intl.NumberFormat("en-US", {
  //     style: "currency",
  //     currency: "USD",
  //   }).format(amount);
  // };

  const getStatusBadge = (status: Tenant["status"]) => {
    const statusConfig = {
      active: { label: "Active", variant: "default" },
      notice_given: { label: "Notice Given", variant: "secondary" },
      moving_out: { label: "Moving Out", variant: "secondary" },
      inactive: { label: "Inactive", variant: "outline" },
    };

    const config = statusConfig[status];
    return <Badge variant={config.variant as any}>{config.label}</Badge>;
  };

  const getLeaseStatusBadge = (status: Tenant["lease"]["status"]) => {
    const statusConfig = {
      active: { label: "Active", variant: "default" },
      expiring: { label: "Expiring Soon", variant: "secondary" },
      expired: { label: "Expired", variant: "destructive" },
      terminated: { label: "Terminated", variant: "outline" },
    };

    const config = statusConfig[status];
    return <Badge variant={config.variant as any}>{config.label}</Badge>;
  };

  const getPaymentScore = (tenant: Tenant) => {
    const total =
      tenant.paymentHistory.onTimePayments + tenant.paymentHistory.latePayments;
    if (total === 0) return 0;
    return (tenant.paymentHistory.onTimePayments / total) * 100;
  };

  const filteredTenants = tenants.filter((tenant) => {
    const matchesSearch =
      searchQuery === "" ||
      `${tenant?.firstName ?? ""} ${tenant?.lastName ?? ""}`
        .toLowerCase()
        .includes(searchQuery.toLowerCase()) ||
      tenant?.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tenant?.unit?.number?.includes(searchQuery);

    const matchesStatus =
      filterStatus === "all" || tenant?.status === filterStatus;
    const matchesProperty =
      filterProperty === "all" || tenant?.unit?.propertyName === filterProperty;

    return matchesSearch && matchesStatus && matchesProperty;
  });

  const handleSendMessage = (tenantId: string) => {};

  const handleRenewLease = (tenantId: string) => {};

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            Tenant Management
          </h2>
          <p className="text-muted-foreground">
            Manage tenant information, leases, and communications
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="h-4 w-4 me-2" />
                Add Tenant
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>Add New Tenant</DialogTitle>
                <DialogDescription>
                  Add a new tenant to your property portfolio
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="first-name">First Name</Label>
                    <Input id="first-name" placeholder="Enter first name" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="last-name">Last Name</Label>
                    <Input id="last-name" placeholder="Enter last name" />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="tenant@example.com"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input id="phone" placeholder="+1 (555) 123-4567" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="unit">Unit Assignment</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select unit" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unit_1">
                        Sunset Apartments - Unit 101
                      </SelectItem>
                      <SelectItem value="unit_2">
                        Oak Hill Residences - Unit 205
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="lease-start">Lease Start Date</Label>
                    <Input id="lease-start" type="date" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="lease-end">Lease End Date</Label>
                    <Input id="lease-end" type="date" />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="monthly-rent">Monthly Rent</Label>
                    <Input id="monthly-rent" type="number" placeholder="1500" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="deposit">Security Deposit</Label>
                    <Input id="deposit" type="number" placeholder="1500" />
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline">Cancel</Button>
                  <Button>Add Tenant</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Overview Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tenants</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.totalTenants}</div>
            <p className="text-xs text-muted-foreground">
              {metrics.activeTenants} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Rent</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(metrics.averageRent)}
            </div>
            <p className="text-xs text-muted-foreground">Per unit per month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              On-Time Payment Rate
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(metrics.onTimePaymentRate * 100).toFixed(1)}%
            </div>
            <Progress
              value={metrics.onTimePaymentRate * 100}
              className="mt-2"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Leases Expiring
            </CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.leasesExpiring}</div>
            <p className="text-xs text-muted-foreground">Next 90 days</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="tenants" className="space-y-4">
        <TabsList>
          <TabsTrigger value="tenants">All Tenants</TabsTrigger>
          <TabsTrigger value="leases">Lease Management</TabsTrigger>
          <TabsTrigger value="applications">Applications</TabsTrigger>
          <TabsTrigger value="communications">Communications</TabsTrigger>
        </TabsList>

        <TabsContent value="tenants" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex gap-4 items-center">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute start-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search tenants..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="ps-8"
                    />
                  </div>
                </div>

                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="notice_given">Notice Given</SelectItem>
                    <SelectItem value="moving_out">Moving Out</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={filterProperty}
                  onValueChange={setFilterProperty}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Property" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Properties</SelectItem>
                    <SelectItem value="Sunset Apartments">
                      Sunset Apartments
                    </SelectItem>
                    <SelectItem value="Oak Hill Residences">
                      Oak Hill Residences
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Tenants List */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredTenants.map((tenant) => (
              <Card
                key={tenant.id}
                className="hover:shadow-md transition-shadow"
              >
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-lg">
                        {tenant?.firstName ?? ""} {tenant?.lastName ?? ""}
                      </CardTitle>
                      <CardDescription className="flex items-center gap-1">
                        <Home className="h-3 w-3" />
                        {tenant?.unit?.propertyName ?? ""} - Unit{" "}
                        {tenant?.unit?.number ?? ""}
                      </CardDescription>
                    </div>
                    {getStatusBadge(tenant?.status)}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Contact Info */}
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Mail className="h-3 w-3 text-muted-foreground" />
                        <span>{tenant?.email ?? ""}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        <span>{tenant?.phone ?? ""}</span>
                      </div>
                    </div>

                    {/* Lease Info */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">
                          Lease Status
                        </span>
                        {getLeaseStatusBadge(tenant?.lease?.status)}
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Monthly Rent:</span>
                        <span className="font-medium">
                          {formatCurrency(tenant?.lease?.monthlyRent ?? 0)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Lease Ends:</span>
                        <span>
                          {tenant?.lease?.endDate?.toLocaleDateString() ?? ""}
                        </span>
                      </div>
                    </div>

                    {/* Payment Score */}
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Payment Score</span>
                        <span>{getPaymentScore(tenant).toFixed(0)}%</span>
                      </div>
                      <Progress value={getPaymentScore(tenant)} />
                    </div>

                    {/* Outstanding Balance Alert */}
                    {tenant.paymentHistory.outstandingBalance > 0 && (
                      <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          Outstanding balance:{" "}
                          {formatCurrency(
                            tenant.paymentHistory.outstandingBalance
                          )}
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1">
                        <Eye className="h-4 w-4 me-2" />
                        View
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSendMessage(tenant.id)}
                      >
                        <MessageSquare className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="outline">
                        <Edit className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="leases" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Lease Management</CardTitle>
              <CardDescription>
                Track lease renewals, expirations, and terms
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Expiring Leases Alert */}
                <Alert>
                  <Calendar className="h-4 w-4" />
                  <AlertDescription>
                    {metrics.leasesExpiring} leases are expiring in the next 90
                    days. Consider reaching out for renewals.
                  </AlertDescription>
                </Alert>

                {/* Lease Actions */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <Button variant="outline" className="h-20 flex-col space-y-2">
                    <FileText className="h-6 w-6" />
                    <span>Generate Lease</span>
                  </Button>
                  <Button variant="outline" className="h-20 flex-col space-y-2">
                    <Calendar className="h-6 w-6" />
                    <span>Renewal Notices</span>
                  </Button>
                  <Button variant="outline" className="h-20 flex-col space-y-2">
                    <Bell className="h-6 w-6" />
                    <span>Expiration Alerts</span>
                  </Button>
                  <Button variant="outline" className="h-20 flex-col space-y-2">
                    <CreditCard className="h-6 w-6" />
                    <span>Rent Increases</span>
                  </Button>
                </div>

                {/* Lease Summary */}
                <div className="grid gap-4 md:grid-cols-3">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Active Leases</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">42</div>
                      <p className="text-xs text-muted-foreground">
                        Currently active
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Renewal Rate</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {(metrics.renewalRate * 100).toFixed(0)}%
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Last 12 months
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Avg. Tenancy</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {metrics.averageTenancy}
                      </div>
                      <p className="text-xs text-muted-foreground">Months</p>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="applications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Tenant Applications</CardTitle>
              <CardDescription>
                Review and process new tenant applications
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8">
                <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">
                  No Pending Applications
                </h3>
                <p className="text-muted-foreground mb-4">
                  All applications have been processed. New applications will
                  appear here.
                </p>
                <Button>
                  <Plus className="h-4 w-4 me-2" />
                  Add Application
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="communications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Tenant Communications</CardTitle>
              <CardDescription>
                Manage communications with tenants
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Button variant="outline" className="h-20 flex-col space-y-2">
                  <Mail className="h-6 w-6" />
                  <span>Send Email</span>
                </Button>
                <Button variant="outline" className="h-20 flex-col space-y-2">
                  <MessageSquare className="h-6 w-6" />
                  <span>Send SMS</span>
                </Button>
                <Button variant="outline" className="h-20 flex-col space-y-2">
                  <Bell className="h-6 w-6" />
                  <span>Announcements</span>
                </Button>
                <Button variant="outline" className="h-20 flex-col space-y-2">
                  <FileText className="h-6 w-6" />
                  <span>Notices</span>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
