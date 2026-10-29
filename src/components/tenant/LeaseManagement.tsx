/**
 * PropertyPro - Lease Management Module
 * Comprehensive lease management interface for tenants with multiple leases
 */

"use client";

import React, { useState, useEffect } from "react";
import { useSession } from "@/lib/auth-client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import LeaseTable, { type Lease as LeaseTableLease } from "./LeaseTable";
import InvoiceTable, {
  type Invoice as InvoiceTableInvoice,
} from "./InvoiceTable";
import DocumentManagement from "./DocumentManagement";
import {
  Building2,
  Calendar,
  DollarSign,
  FileText,
  Search,
  RefreshCw,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils/formatting";

// Types
interface Lease {
  _id: string;
  propertyId: {
    _id: string;
    name: string;
    address: {
      street: string;
      city: string;
      state: string;
      zipCode: string;
      country: string;
    };
    type: string;
  };
  startDate: string;
  endDate: string;
  status: string;
  terms: {
    rentAmount: number;
    securityDeposit?: number;
  };
  daysUntilExpiration: number;
  daysUntilStart: number;
  isActive: boolean;
  isUpcoming: boolean;
  isExpired: boolean;
  documents?: string[];
  signedDate?: string;
  renewalOptions?: {
    available: boolean;
    terms?: string;
  };
}

interface Invoice {
  _id: string;
  invoiceNumber: string;
  propertyId: {
    _id: string;
    name: string;
  };
  leaseId: string;
  issueDate: string;
  dueDate: string;
  status: string;
  totalAmount: number;
  balanceRemaining: number;
  daysOverdue: number;
  lineItems: Array<{
    description: string;
    amount: number;
  }>;
}

interface LeaseManagementProps {
  className?: string;
}

export default function LeaseManagement({ className }: LeaseManagementProps) {
  const { data: session } = useSession();
  const [leases, setLeases] = useState<Lease[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("leases");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("endDate");
  const [sortOrder, setSortOrder] = useState("asc");

  useEffect(() => {
    if (session?.user) {
      fetchLeaseData();
    }
  }, [session]);

  // Typed with LeaseTable's own Lease shape (its `address` may be a string);
  // the handler only branches on `action`.
  const handleLeaseAction = (action: string, lease: LeaseTableLease) => {
    switch (action) {
      case "download-agreement":
        toast.info("Downloading lease agreement...");
        // Implement download functionality
        break;
      case "view-invoices":
        setActiveTab("invoices");
        // Filter invoices by lease
        break;
      case "contact-manager":
        toast.info("Redirecting to Messages...");
        // Redirect to the main Messages module
        window.location.href = "/dashboard/messages";
        break;
      case "request-renewal":
        toast.info("Renewal request functionality coming soon...");
        // Implement renewal request
        break;
      default:
    }
  };

  const handleInvoiceAction = (action: string, invoice: InvoiceTableInvoice) => {
    switch (action) {
      case "download-pdf":
        toast.info("Downloading invoice PDF...");
        // Implement PDF download functionality
        break;
      case "make-payment":
        toast.info("Redirecting to payment portal...");
        // Integrate with existing payment system
        break;
      default:
    }
  };

  const fetchLeaseData = async () => {
    try {
      setLoading(true);
      const [leasesResponse, invoicesResponse] = await Promise.all([
        fetch("/api/tenant/dashboard"),
        fetch("/api/tenant/invoices"),
      ]);

      const leasesData = await leasesResponse.json();
      const invoicesData = await invoicesResponse.json();

      if (leasesData.success) {
        setLeases(leasesData.data.allLeases || []);
      }

      if (invoicesData.success) {
        setInvoices(invoicesData.data.invoices || []);
      }
    } catch (error) {
      console.error("Error fetching lease data:", error);
      toast.error("Failed to load lease data");
    } finally {
      setLoading(false);
    }
  };

  // const formatCurrency = (amount: number) => {
  //   return new Intl.NumberFormat("en-US", {
  //     style: "currency",
  //     currency: "USD",
  //   }).format(amount);
  // };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getStatusBadge = (status: string, isLease: boolean = true) => {
    if (isLease) {
      const statusConfig = {
        active: {
          variant: "default" as const,
          color: "bg-green-500",
          label: "Active",
        },
        expired: {
          variant: "secondary" as const,
          color: "bg-gray-500",
          label: "Expired",
        },
        upcoming: {
          variant: "outline" as const,
          color: "bg-blue-500",
          label: "Upcoming",
        },
        terminated: {
          variant: "destructive" as const,
          color: "bg-red-500",
          label: "Terminated",
        },
      };
      const config =
        statusConfig[status as keyof typeof statusConfig] ||
        statusConfig.active;
      return (
        <Badge variant={config.variant} className="flex items-center gap-1">
          <div className={`w-2 h-2 rounded-full ${config.color}`} />
          {config.label}
        </Badge>
      );
    } else {
      // Invoice status badges
      const statusConfig = {
        paid: { variant: "default" as const, color: "text-green-600" },
        issued: { variant: "outline" as const, color: "text-blue-600" },
        overdue: { variant: "destructive" as const, color: "text-red-600" },
        partial: { variant: "secondary" as const, color: "text-yellow-600" },
      };
      const config =
        statusConfig[status as keyof typeof statusConfig] ||
        statusConfig.issued;
      return <Badge variant={config.variant}>{status.toUpperCase()}</Badge>;
    }
  };

  const filteredLeases = leases.filter((lease) => {
    const addressString = lease.propertyId.address
      ? `${lease.propertyId.address.street || ""} ${
          lease.propertyId.address.city || ""
        } ${lease.propertyId.address.state || ""} ${
          lease.propertyId.address.zipCode || ""
        }`.toLowerCase()
      : "";

    const matchesSearch =
      lease.propertyId.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      addressString.includes(searchTerm.toLowerCase());

    const matchesStatus =
      statusFilter === "all" || lease.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const sortedLeases = [...filteredLeases].sort((a, b) => {
    let aValue: any, bValue: any;

    switch (sortBy) {
      case "property":
        aValue = a.propertyId.name;
        bValue = b.propertyId.name;
        break;
      case "startDate":
        aValue = new Date(a.startDate);
        bValue = new Date(b.startDate);
        break;
      case "endDate":
        aValue = new Date(a.endDate);
        bValue = new Date(b.endDate);
        break;
      case "rent":
        aValue = a.terms.rentAmount;
        bValue = b.terms.rentAmount;
        break;
      default:
        aValue = a.status;
        bValue = b.status;
    }

    if (sortOrder === "asc") {
      return aValue > bValue ? 1 : -1;
    } else {
      return aValue < bValue ? 1 : -1;
    }
  });

  const filteredInvoices = invoices.filter((invoice) => {
    const matchesSearch =
      invoice.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      invoice.propertyId.name.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus =
      statusFilter === "all" || invoice.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  if (loading) {
    return <LeaseManagementSkeleton />;
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Lease Management
          </h1>
          <p className="text-muted-foreground">
            Manage your leases, invoices, and property documents
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchLeaseData}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Leases</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{leases.length}</div>
            <p className="text-xs text-muted-foreground">
              {leases.filter((l) => l.isActive).length} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monthly Rent</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(
                leases
                  .filter((l) => l.isActive)
                  .reduce((sum, l) => sum + l.terms.rentAmount, 0)
              )}
            </div>
            <p className="text-xs text-muted-foreground">Active leases total</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Outstanding Invoices
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {invoices.filter((inv) => inv.status !== "paid").length}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(
                invoices
                  .filter((inv) => inv.status !== "paid")
                  .reduce((sum, inv) => sum + inv.balanceRemaining, 0)
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Expiring Soon</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {
                leases.filter(
                  (l) =>
                    l.daysUntilExpiration > 0 && l.daysUntilExpiration <= 90
                ).length
              }
            </div>
            <p className="text-xs text-muted-foreground">Next 90 days</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-4"
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="leases">My Leases</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="flex flex-1 items-center space-x-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute start-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search properties..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="ps-8"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="upcoming">Upcoming</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="terminated">Terminated</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2">
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="property">Property</SelectItem>
                <SelectItem value="startDate">Start Date</SelectItem>
                <SelectItem value="endDate">End Date</SelectItem>
                <SelectItem value="rent">Rent Amount</SelectItem>
                <SelectItem value="status">Status</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
            >
              {sortOrder === "asc" ? "↑" : "↓"}
            </Button>
          </div>
        </div>

        <TabsContent value="leases" className="space-y-4">
          <LeaseTable leases={sortedLeases} onLeaseAction={handleLeaseAction} />
        </TabsContent>

        <TabsContent value="invoices" className="space-y-4">
          <InvoiceTable
            invoices={filteredInvoices}
            onInvoiceAction={handleInvoiceAction}
          />
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <DocumentManagement leases={leases} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Loading skeleton component
function LeaseManagementSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-9 w-24" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16 mb-1" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
