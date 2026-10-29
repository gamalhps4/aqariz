"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  Edit,
  MoreHorizontal,
  Search,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { MaintenanceStatus, MaintenancePriority } from "@/types";
import { formatCurrency } from "@/lib/utils/formatting";
import { SortableTableHead, useTableSort } from "@/components/ui/sortable-table";

// Priority sorts by urgency, not by its name's alphabet.
const PRIORITY_ORDER: string[] = [
  MaintenancePriority.LOW,
  MaintenancePriority.MEDIUM,
  MaintenancePriority.HIGH,
  MaintenancePriority.EMERGENCY,
];

interface MaintenanceRequest {
  _id: string;
  title: string;
  description: string;
  category: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  estimatedCost?: number;
  actualCost?: number;
  createdAt: string;
  updatedAt: string;
  propertyId: {
    _id: string;
    name: string;
  };
  tenantId?: {
    _id: string;
    userId: {
      firstName: string;
      lastName: string;
    };
  };
  unit?: {
    unitNumber: string;
    unitType: string;
  };
}

interface MaintenanceCrudOperationsProps {
  onDataChange?: () => void;
}

export function MaintenanceCrudOperations({
  onDataChange,
}: MaintenanceCrudOperationsProps) {
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] =
    useState<MaintenanceRequest | null>(null);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "",
    priority: MaintenancePriority.LOW,
    estimatedCost: "",
  });

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/maintenance");
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to fetch maintenance requests");
      }

      setRequests(result.data.requests || []);
    } catch (error) {
      toast.error("Failed to load maintenance requests", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      const response = await fetch("/api/maintenance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...formData,
          estimatedCost: formData.estimatedCost
            ? parseFloat(formData.estimatedCost)
            : undefined,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to create maintenance request");
      }

      toast.success("Maintenance request created successfully");
      setIsCreateDialogOpen(false);
      resetForm();
      fetchRequests();
      onDataChange?.();
    } catch (error) {
      toast.error("Failed to create maintenance request", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    }
  };

  const handleUpdate = async () => {
    if (!selectedRequest) return;

    try {
      const response = await fetch(`/api/maintenance/${selectedRequest._id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...formData,
          estimatedCost: formData.estimatedCost
            ? parseFloat(formData.estimatedCost)
            : undefined,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to update maintenance request");
      }

      toast.success("Maintenance request updated successfully");
      setIsEditDialogOpen(false);
      setSelectedRequest(null);
      resetForm();
      fetchRequests();
      onDataChange?.();
    } catch (error) {
      toast.error("Failed to update maintenance request", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      setDeleteLoading(id);
      const response = await fetch(`/api/maintenance/${id}`, {
        method: "DELETE",
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to delete maintenance request");
      }

      toast.success("Maintenance request deleted successfully");
      fetchRequests();
      onDataChange?.();
    } catch (error) {
      toast.error("Failed to delete maintenance request", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setDeleteLoading(null);
    }
  };

  const resetForm = () => {
    setFormData({
      title: "",
      description: "",
      category: "",
      priority: MaintenancePriority.LOW,
      estimatedCost: "",
    });
  };

  const openEditDialog = (request: MaintenanceRequest) => {
    setSelectedRequest(request);
    setFormData({
      title: request.title,
      description: request.description,
      category: request.category,
      priority: request.priority,
      estimatedCost: request.estimatedCost?.toString() || "",
    });
    setIsEditDialogOpen(true);
  };

  const getStatusBadge = (status: MaintenanceStatus) => {
    const variants = {
      [MaintenanceStatus.SUBMITTED]:
        "bg-yellow-100 text-yellow-800 border-yellow-200",
      [MaintenanceStatus.ASSIGNED]: "bg-blue-100 text-blue-800 border-blue-200",
      [MaintenanceStatus.IN_PROGRESS]:
        "bg-purple-100 text-purple-800 border-purple-200",
      [MaintenanceStatus.COMPLETED]:
        "bg-green-100 text-green-800 border-green-200",
      [MaintenanceStatus.CANCELLED]: "bg-red-100 text-red-800 border-red-200",
    };

    return (
      <Badge variant="outline" className={variants[status]}>
        {status.replace("_", " ")}
      </Badge>
    );
  };

  const getPriorityBadge = (priority: MaintenancePriority) => {
    const variants = {
      [MaintenancePriority.LOW]: "bg-green-100 text-green-800 border-green-200",
      [MaintenancePriority.MEDIUM]:
        "bg-yellow-100 text-yellow-800 border-yellow-200",
      [MaintenancePriority.HIGH]:
        "bg-orange-100 text-orange-800 border-orange-200",
      [MaintenancePriority.EMERGENCY]: "bg-red-100 text-red-800 border-red-200",
    };

    return (
      <Badge variant="outline" className={variants[priority]}>
        {priority}
      </Badge>
    );
  };

  const filteredRequests = requests.filter((request) => {
    const matchesSearch =
      request.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      request.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus =
      statusFilter === "all" || request.status === statusFilter;
    const matchesPriority =
      priorityFilter === "all" || request.priority === priorityFilter;

    return matchesSearch && matchesStatus && matchesPriority;
  });

  const sort = useTableSort(filteredRequests, {
    title: (request) => request.title,
    category: (request) => request.category,
    priority: (request) => {
      const rank = PRIORITY_ORDER.indexOf(request.priority);
      return rank < 0 ? null : rank;
    },
    // The badge's words (getStatusBadge).
    status: (request) => request.status.replace("_", " "),
    property: (request) => request.propertyId?.name ?? null,
    // The actual cost, else the estimate the cell shows with a "~".
    cost: (request) => request.actualCost || request.estimatedCost || null,
    created: (request) => new Date(request.createdAt),
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Maintenance Requests
          </h2>
          <p className="text-muted-foreground">
            Manage and track maintenance requests
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={fetchRequests} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 me-2" />
            Refresh
          </Button>
          <Dialog
            open={isCreateDialogOpen}
            onOpenChange={setIsCreateDialogOpen}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 me-2" />
                Create Request
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Create Maintenance Request</DialogTitle>
                <DialogDescription>
                  Create a new maintenance request for tracking and management.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Title</label>
                  <Input
                    value={formData.title}
                    onChange={(e) =>
                      setFormData({ ...formData, title: e.target.value })
                    }
                    placeholder="Enter request title"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Description</label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    placeholder="Describe the maintenance issue"
                    rows={3}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Category</label>
                    <Select
                      value={formData.category}
                      onValueChange={(value) =>
                        setFormData({ ...formData, category: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="plumbing">Plumbing</SelectItem>
                        <SelectItem value="electrical">Electrical</SelectItem>
                        <SelectItem value="hvac">HVAC</SelectItem>
                        <SelectItem value="general">General</SelectItem>
                        <SelectItem value="appliances">Appliances</SelectItem>
                        <SelectItem value="flooring">Flooring</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Priority</label>
                    <Select
                      value={formData.priority}
                      onValueChange={(value) =>
                        setFormData({
                          ...formData,
                          priority: value as MaintenancePriority,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={MaintenancePriority.LOW}>
                          Low
                        </SelectItem>
                        <SelectItem value={MaintenancePriority.MEDIUM}>
                          Medium
                        </SelectItem>
                        <SelectItem value={MaintenancePriority.HIGH}>
                          High
                        </SelectItem>
                        <SelectItem value={MaintenancePriority.EMERGENCY}>
                          Emergency
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">Estimated Cost</label>
                  <Input
                    type="number"
                    value={formData.estimatedCost}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        estimatedCost: e.target.value,
                      })
                    }
                    placeholder="0.00"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsCreateDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleCreate}>Create Request</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search requests..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="ps-10"
            />
          </div>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value={MaintenanceStatus.SUBMITTED}>
              Submitted
            </SelectItem>
            <SelectItem value={MaintenanceStatus.ASSIGNED}>Assigned</SelectItem>
            <SelectItem value={MaintenanceStatus.IN_PROGRESS}>
              In Progress
            </SelectItem>
            <SelectItem value={MaintenanceStatus.COMPLETED}>
              Completed
            </SelectItem>
            <SelectItem value={MaintenanceStatus.CANCELLED}>
              Cancelled
            </SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priority</SelectItem>
            <SelectItem value={MaintenancePriority.LOW}>Low</SelectItem>
            <SelectItem value={MaintenancePriority.MEDIUM}>Medium</SelectItem>
            <SelectItem value={MaintenancePriority.HIGH}>High</SelectItem>
            <SelectItem value={MaintenancePriority.EMERGENCY}>
              Emergency
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Requests Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead sort={sort} column="title">Title</SortableTableHead>
                <SortableTableHead sort={sort} column="category">Category</SortableTableHead>
                <SortableTableHead sort={sort} column="priority">Priority</SortableTableHead>
                <SortableTableHead sort={sort} column="status">Status</SortableTableHead>
                <SortableTableHead sort={sort} column="property">Property / Unit</SortableTableHead>
                <SortableTableHead sort={sort} column="cost">Cost</SortableTableHead>
                <SortableTableHead sort={sort} column="created">Created</SortableTableHead>
                <TableHead className="w-[70px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    Loading maintenance requests...
                  </TableCell>
                </TableRow>
              ) : filteredRequests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    No maintenance requests found
                  </TableCell>
                </TableRow>
              ) : (
                sort.rows.map((request) => (
                  <TableRow key={request._id}>
                    <TableCell className="font-medium">
                      {request.title}
                    </TableCell>
                    <TableCell className="capitalize">
                      {request.category}
                    </TableCell>
                    <TableCell>{getPriorityBadge(request.priority)}</TableCell>
                    <TableCell>{getStatusBadge(request.status)}</TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium">
                          {request.propertyId?.name || "N/A"}
                        </div>
                        {request.unit && (
                          <div className="text-sm text-muted-foreground">
                            Unit {request.unit.unitNumber} (
                            {request.unit.unitType})
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {request.actualCost
                        ? formatCurrency(request.actualCost)
                        : request.estimatedCost
                        ? `~${formatCurrency(request.estimatedCost)}`
                        : "N/A"}
                    </TableCell>
                    <TableCell>
                      {new Date(request.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => openEditDialog(request)}
                          >
                            <Edit className="me-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          {/* DISABLED: Delete functionality temporarily disabled */}
                          {/* <DeleteConfirmationDialog
                            itemName={request.title}
                            itemType="maintenance request"
                            onConfirm={() => handleDelete(request._id)}
                            loading={deleteLoading === request._id}
                          >
                            <DropdownMenuItem
                              onSelect={(e) => e.preventDefault()}
                              className="text-red-600"
                            >
                              <Trash2 className="me-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DeleteConfirmationDialog> */}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Maintenance Request</DialogTitle>
            <DialogDescription>
              Update the maintenance request details.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Title</label>
              <Input
                value={formData.title}
                onChange={(e) =>
                  setFormData({ ...formData, title: e.target.value })
                }
                placeholder="Enter request title"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="Describe the maintenance issue"
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Category</label>
                <Select
                  value={formData.category}
                  onValueChange={(value) =>
                    setFormData({ ...formData, category: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="plumbing">Plumbing</SelectItem>
                    <SelectItem value="electrical">Electrical</SelectItem>
                    <SelectItem value="hvac">HVAC</SelectItem>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="appliances">Appliances</SelectItem>
                    <SelectItem value="flooring">Flooring</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Priority</label>
                <Select
                  value={formData.priority}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      priority: value as MaintenancePriority,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={MaintenancePriority.LOW}>Low</SelectItem>
                    <SelectItem value={MaintenancePriority.MEDIUM}>
                      Medium
                    </SelectItem>
                    <SelectItem value={MaintenancePriority.HIGH}>
                      High
                    </SelectItem>
                    <SelectItem value={MaintenancePriority.EMERGENCY}>
                      Emergency
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Estimated Cost</label>
              <Input
                type="number"
                value={formData.estimatedCost}
                onChange={(e) =>
                  setFormData({ ...formData, estimatedCost: e.target.value })
                }
                placeholder="0.00"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleUpdate}>Update Request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
