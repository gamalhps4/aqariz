"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  RefreshCw,
  Activity,
  Database,
  Wifi,
  Shield,
  Bug,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableTableHead, useTableSort } from "@/components/ui/sortable-table";

// Severity sorts by how bad it is, not by its name's alphabet.
const SEVERITY_ORDER = ["low", "medium", "high", "critical"];

interface ErrorStats {
  totalErrors: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
  recentErrors: Array<{
    id: string;
    message: string;
    category: string;
    severity: string;
    timestamp: string;
    userId?: string;
    path?: string;
  }>;
}

export function ErrorMonitoringDashboard() {
  const [stats, setStats] = useState<ErrorStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/errors/log");
      if (!response.ok) {
        throw new Error("Failed to fetch error statistics");
      }

      const data = await response.json();
      if (!data?.success) {
        throw new Error(data?.message || "Failed to fetch error statistics");
      }
      setStats(data?.data ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    // Refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const getSeverityColor = (severity: string) => {
    switch (severity.toLowerCase()) {
      case "critical":
        return "destructive";
      case "high":
        return "destructive";
      case "medium":
        return "default";
      case "low":
        return "secondary";
      default:
        return "outline";
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category.toLowerCase()) {
      case "network":
        return Wifi;
      case "database":
        return Database;
      case "authentication":
      case "authorization":
        return Shield;
      default:
        return Bug;
    }
  };
  const recentErrors = stats?.recentErrors ?? [];
  const sort = useTableSort(recentErrors, {
    time: (error) => new Date(error.timestamp),
    message: (error) => error.message,
    category: (error) => error.category,
    severity: (error) => {
      const rank = SEVERITY_ORDER.indexOf(error.severity.toLowerCase());
      return rank < 0 ? null : rank;
    },
    path: (error) => error.path ?? null,
    user: (error) => error.userId ?? null,
  });

  if (isLoading && !stats) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="size-4 animate-spin" />
            Loading error statistics...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center space-y-4">
            <AlertCircle className="size-12 text-destructive mx-auto" />
            <p className="text-destructive">{error}</p>
            <Button onClick={fetchStats} variant="outline">
              <RefreshCw className="size-4 me-2" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Error Monitoring</h2>
          <p className="text-muted-foreground">
            Real-time application error tracking and analysis
          </p>
        </div>
        <Button onClick={fetchStats} variant="outline" size="sm">
          <RefreshCw
            className={`size-4 me-2 ${isLoading ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Errors</CardTitle>
            <Activity className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalErrors ?? 0}</div>
            <p className="text-xs text-muted-foreground">Last 24 hours</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Critical</CardTitle>
            <AlertCircle className="size-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {stats?.bySeverity?.critical ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Requires immediate attention
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">High Priority</CardTitle>
            <AlertTriangle className="size-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-500">
              {stats?.bySeverity?.high ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Should be addressed soon
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Priority</CardTitle>
            <Info className="size-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500">
              {(stats?.bySeverity?.medium ?? 0) + (stats?.bySeverity?.low ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground">Monitor and track</p>
          </CardContent>
        </Card>
      </div>

      {/* Error by Category */}
      <Card>
        <CardHeader>
          <CardTitle>Errors by Category</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {stats?.byCategory &&
              Object.entries(stats.byCategory).map(([category, count]) => {
                const Icon = getCategoryIcon(category);
                return (
                  <div
                    key={category}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-muted rounded-lg">
                        <Icon className="size-4" />
                      </div>
                      <div>
                        <p className="font-medium capitalize">{category}</p>
                        <p className="text-sm text-muted-foreground">
                          {count} error{count !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </CardContent>
      </Card>

      {/* Recent Errors */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Errors</CardTitle>
        </CardHeader>
        <CardContent>
          {recentErrors.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead sort={sort} column="time">Time</SortableTableHead>
                  <SortableTableHead sort={sort} column="message">Message</SortableTableHead>
                  <SortableTableHead sort={sort} column="category">Category</SortableTableHead>
                  <SortableTableHead sort={sort} column="severity">Severity</SortableTableHead>
                  <SortableTableHead sort={sort} column="path">Path</SortableTableHead>
                  <SortableTableHead sort={sort} column="user">User</SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sort.rows.map((error) => (
                  <TableRow key={error.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(error.timestamp).toLocaleString()}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      {error.message}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {error.category}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getSeverityColor(error.severity) as any}>
                        {error.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {error.path ?? "-"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {error.userId ?? "Anonymous"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Info className="size-12 mx-auto mb-4 opacity-50" />
              <p>No recent errors</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
