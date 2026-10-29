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
import DocumentManagement from "@/components/tenant/DocumentManagement";
import { GlobalSearch } from "@/components/ui/global-search";
import {
  ArrowLeft,
  RefreshCw,
  Upload,
  FileText,
} from "lucide-react";
import Link from "next/link";
import { useAuthorization } from "@/hooks/useAuthorization";

interface Document {
  _id: string;
  name: string;
  type: string;
  category: string;
  size: number;
  uploadDate: string;
  propertyId?: string;
  propertyName?: string;
  leaseId: string;
  url: string;
}

export default function LeaseManagementDocumentsPage() {
  const { data: session, status } = useSession();
  const { isTenant } = useAuthorization();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");

  // Handler for debounced search from GlobalSearch component (client-side filtering)
  const handleSearch = useCallback((value: string) => {
    setSearchTerm(value);
  }, []);

  // Before the early returns below, not after them. While the session is
  // loading this component returns early; registering the effect only on the
  // later renders changes the hook order between them, which is what React
  // reports as "rendered more hooks than during the previous render".
  useEffect(() => {
    if (session?.user) {
      fetchDocuments();
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

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/tenant/documents");
      const data = await response.json();

      if (data.success) {
        setDocuments(data.data?.documents || []);
      } else {
        showSimpleError("Load Error", "Failed to load documents");
      }
    } catch (error) {
      showSimpleError("Load Error", "Failed to load documents");
    } finally {
      setLoading(false);
    }
  };

  const handleDocumentAction = (action: string, document: Document) => {
    switch (action) {
      case "download":
        showSimpleInfo("Downloading", "Downloading document...");
        // Implement document download functionality
        break;
      case "preview":
        showSimpleInfo("Preview", "Opening document preview...");
        // Implement document preview functionality
        break;
      default:
      // Unknown document action
    }
  };

  const filteredDocuments = documents.filter((document) => {
    const name = document.name?.toLowerCase() || "";
    const propertyName = document.propertyName?.toLowerCase() || "";
    const search = searchTerm.toLowerCase();

    const matchesSearch =
      name.includes(search) || propertyName.includes(search);

    const matchesCategory =
      categoryFilter === "all" || document.category === categoryFilter;

    return matchesSearch && matchesCategory;
  });

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const getCategoryStats = () => {
    const stats = {
      lease_agreement: 0,
      amendment: 0,
      addendum: 0,
      notice: 0,
      other: 0,
    };

    filteredDocuments.forEach((doc) => {
      if (stats.hasOwnProperty(doc.category)) {
        stats[doc.category as keyof typeof stats]++;
      }
    });

    return stats;
  };

  const categoryStats = getCategoryStats();

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
            <h1 className="text-2xl font-semibold tracking-tight">
              Document Management
            </h1>
            <p className="text-sm text-muted-foreground">
              Access and manage all your lease-related documents
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchDocuments}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button size="sm" className="gap-2">
            <Upload className="h-4 w-4" />
            Upload Document
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Documents
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{filteredDocuments.length}</div>
            <p className="text-xs text-muted-foreground">
              {formatFileSize(
                filteredDocuments.reduce((sum, doc) => sum + doc.size, 0)
              )}{" "}
              total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Lease Agreements
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {categoryStats.lease_agreement}
            </div>
            <p className="text-xs text-muted-foreground">Active agreements</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Amendments</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{categoryStats.amendment}</div>
            <p className="text-xs text-muted-foreground">Contract changes</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Notices</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{categoryStats.notice}</div>
            <p className="text-xs text-muted-foreground">Official notices</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Other Documents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {categoryStats.addendum + categoryStats.other}
            </div>
            <p className="text-xs text-muted-foreground">Addendums & misc</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="flex flex-1 items-center space-x-2">
          {/* Global Search Component with 300ms debounce (client-side filtering) */}
          <GlobalSearch
            placeholder="Search documents..."
            initialValue={searchTerm}
            debounceDelay={300}
            onSearch={handleSearch}
            className="flex-1 max-w-sm"
            ariaLabel="Search documents"
          />
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              <SelectItem value="lease_agreement">Lease Agreements</SelectItem>
              <SelectItem value="amendment">Amendments</SelectItem>
              <SelectItem value="addendum">Addendums</SelectItem>
              <SelectItem value="notice">Notices</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Documents Management Component */}
      {loading ? (
        <Card>
          <CardHeader>
            <CardTitle>Loading Documents...</CardTitle>
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
        <DocumentManagement documents={filteredDocuments} />
      )}
    </div>
  );
}
