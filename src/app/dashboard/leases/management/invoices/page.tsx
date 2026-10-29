"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useSession } from "@/lib/auth-client";
import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { showSimpleError, showSimpleInfo } from "@/lib/toast-notifications";
import InvoiceTable from "@/components/tenant/InvoiceTable";
import { GlobalSearch } from "@/components/ui/global-search";
import { ArrowLeft, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useAuthorization } from "@/hooks/useAuthorization";

interface Invoice {
  _id: string;
  invoiceNumber: string;
  propertyId?: {
    _id: string;
    name: string;
  } | null;
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

import { formatCurrency } from "@/lib/utils/formatting";

export default function LeaseManagementInvoicesPage() {
  const { data: session, status } = useSession();
  const { isTenant } = useAuthorization();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Handler for debounced search from GlobalSearch component (client-side filtering)
  const handleSearch = useCallback((value: string) => {
    setSearchTerm(value);
  }, []);

  const fetchInvoices = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/tenant/invoices");
      const data = await response.json();

      if (data.success) {
        setInvoices(data.data?.invoices || []);
      } else {
        showSimpleError("Load Error", "Failed to load invoices");
      }
    } catch (error) {
      showSimpleError("Load Error", "Failed to load invoices");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (session?.user) {
      fetchInvoices();
    }
  }, [session]);

  // Show loading state while session is being fetched
  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Redirect if not authenticated
  if (status === "unauthenticated") {
    redirect("/auth/signin");
  }

  // Only allow tenants to access this page
  if (status === "authenticated" && !isTenant) {
    redirect("/dashboard");
  }

  const handleInvoiceAction = (action: string, invoice: Invoice) => {
    switch (action) {
      case "download-pdf":
        showSimpleInfo("Downloading", "Downloading invoice PDF...");
        // Implement PDF download functionality
        break;
      case "make-payment":
        showSimpleInfo("Redirecting", "Redirecting to payment portal...");
        // Integrate with existing payment system
        break;
      default:
      // Unknown invoice action
    }
  };

  const filteredInvoices = invoices.filter((invoice) => {
    const invoiceNumber = invoice.invoiceNumber?.toLowerCase() || "";
    const propertyName = invoice.propertyId?.name?.toLowerCase() || "";
    const search = searchTerm.toLowerCase();

    const matchesSearch =
      invoiceNumber.includes(search) || propertyName.includes(search);

    const matchesStatus =
      statusFilter === "all" || invoice.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // const formatCurrency = (amount: number) => {
  //   return new Intl.NumberFormat("en-US", {
  //     style: "currency",
  //     currency: "USD",
  //   }).format(amount);
  // };

  const totalOutstanding = filteredInvoices
    .filter((inv) => inv.status !== "paid")
    .reduce((sum, inv) => sum + inv.balanceRemaining, 0);

  const overdueCount = filteredInvoices.filter(
    (inv) => inv.daysOverdue > 0
  ).length;

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/leases/management">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
              Back to Lease Management
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              Invoice Management
            </h1>
            <p className="text-muted-foreground">
              View and manage all your invoices across all properties
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={fetchInvoices}
          className="gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Invoices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{filteredInvoices.length}</div>
            <p className="text-xs text-muted-foreground">
              {invoices.filter((inv) => inv.status === "paid").length} paid
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Outstanding Amount
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(totalOutstanding)}
            </div>
            <p className="text-xs text-muted-foreground">
              {filteredInvoices.filter((inv) => inv.status !== "paid").length}{" "}
              unpaid invoices
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Overdue Invoices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {overdueCount}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(
                filteredInvoices
                  .filter((inv) => inv.daysOverdue > 0)
                  .reduce((sum, inv) => sum + inv.balanceRemaining, 0)
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">This Month</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {
                filteredInvoices.filter((inv) => {
                  const issueDate = new Date(inv.issueDate);
                  const now = new Date();
                  return (
                    issueDate.getMonth() === now.getMonth() &&
                    issueDate.getFullYear() === now.getFullYear()
                  );
                }).length
              }
            </div>
            <p className="text-xs text-muted-foreground">Invoices issued</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="flex flex-1 items-center space-x-2">
          {/* Global Search Component with 300ms debounce (client-side filtering) */}
          <GlobalSearch
            placeholder="Search invoices..."
            initialValue={searchTerm}
            debounceDelay={300}
            onSearch={handleSearch}
            className="flex-1 max-w-sm"
            ariaLabel="Search invoices"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="issued">Issued</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Invoices Table */}
      {loading ? (
        <Card>
          <CardHeader>
            <CardTitle>Loading Invoices...</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 bg-muted rounded animate-pulse" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <InvoiceTable
          invoices={filteredInvoices}
          onInvoiceAction={handleInvoiceAction}
        />
      )}
    </div>
  );
}
