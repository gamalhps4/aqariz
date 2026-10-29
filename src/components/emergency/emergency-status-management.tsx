"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  User,
  CheckCircle,
  XCircle,
  ArrowUp,
  Play,
  Zap,
  Phone,
  Mail,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { MaintenanceStatus } from "@/types";

interface EmergencyRequest {
  _id: string;
  title: string;
  description: string;
  status: MaintenanceStatus;
  priority: string;
  category: string;
  createdAt: string;
  hoursSinceCreation: number;
  isOverdue: boolean;
  urgencyLevel: "normal" | "overdue" | "critical";
  property: {
    name: string;
    address: string;
  };
  tenant: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  assignedUser?: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  estimatedCost?: number;
  actualCost?: number;
}

interface EmergencyStatusManagementProps {
  request: EmergencyRequest;
  onStatusUpdate: (
    requestId: string,
    newStatus: MaintenanceStatus,
    data?: any
  ) => void;
  onEscalate: (requestId: string, data: any) => void;
  availableStaff?: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    available: boolean;
  }>;
}

export function EmergencyStatusManagement({
  request,
  onStatusUpdate,
  onEscalate,
  availableStaff = [],
}: EmergencyStatusManagementProps) {
  const [loading, setLoading] = useState(false);
  const [escalationDialogOpen, setEscalationDialogOpen] = useState(false);
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
  const [completionDialogOpen, setCompletionDialogOpen] = useState(false);

  // Form states
  const [escalationReason, setEscalationReason] = useState("");
  const [escalationNotes, setEscalationNotes] = useState("");
  const [escalateTo, setEscalateTo] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [completionNotes, setCompletionNotes] = useState("");
  const [actualCost, setActualCost] = useState("");

  const handleStatusChange = async (
    newStatus: MaintenanceStatus,
    additionalData?: any
  ) => {
    setLoading(true);
    try {
      await onStatusUpdate(request._id, newStatus, additionalData);
      toast.success(`Emergency request ${newStatus.replace("_", " ")}`);
    } catch (error) {
      toast.error("Failed to update status");
    } finally {
      setLoading(false);
    }
  };

  const handleEscalation = async () => {
    if (!escalationReason.trim()) {
      toast.error("Please provide an escalation reason");
      return;
    }

    setLoading(true);
    try {
      await onEscalate(request._id, {
        escalationReason,
        escalateTo: escalateTo || undefined,
        urgencyLevel: request.urgencyLevel === "critical" ? "critical" : "high",
        notes: escalationNotes,
      });
      setEscalationDialogOpen(false);
      setEscalationReason("");
      setEscalationNotes("");
      setEscalateTo("");
      toast.success("Emergency request escalated successfully");
    } catch (error) {
      toast.error("Failed to escalate request");
    } finally {
      setLoading(false);
    }
  };

  const handleAssignment = async () => {
    if (!assignTo) {
      toast.error("Please select a staff member");
      return;
    }

    await handleStatusChange(MaintenanceStatus.ASSIGNED, {
      assignedTo: assignTo,
    });
    setAssignmentDialogOpen(false);
    setAssignTo("");
  };

  const handleCompletion = async () => {
    const data: any = { notes: completionNotes };
    if (actualCost) {
      data.actualCost = parseFloat(actualCost);
    }

    await handleStatusChange(MaintenanceStatus.COMPLETED, data);
    setCompletionDialogOpen(false);
    setCompletionNotes("");
    setActualCost("");
  };

  const getStatusColor = (status: MaintenanceStatus) => {
    switch (status) {
      case MaintenanceStatus.SUBMITTED:
        return "bg-blue-100 text-blue-800";
      case MaintenanceStatus.ASSIGNED:
        return "bg-purple-100 text-purple-800";
      case MaintenanceStatus.IN_PROGRESS:
        return "bg-orange-100 text-orange-800";
      case MaintenanceStatus.COMPLETED:
        return "bg-green-100 text-green-800";
      case MaintenanceStatus.CANCELLED:
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getUrgencyColor = (urgencyLevel: string) => {
    switch (urgencyLevel) {
      case "critical":
        return "bg-red-100 text-red-800 border-red-200";
      case "overdue":
        return "bg-orange-100 text-orange-800 border-orange-200";
      default:
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
    }
  };

  const canTransitionTo = (targetStatus: MaintenanceStatus) => {
    const currentStatus = request.status;

    switch (targetStatus) {
      case MaintenanceStatus.ASSIGNED:
        return currentStatus === MaintenanceStatus.SUBMITTED;
      case MaintenanceStatus.IN_PROGRESS:
        return currentStatus === MaintenanceStatus.ASSIGNED;
      case MaintenanceStatus.COMPLETED:
        return [
          MaintenanceStatus.ASSIGNED,
          MaintenanceStatus.IN_PROGRESS,
        ].includes(currentStatus);
      case MaintenanceStatus.CANCELLED:
        return currentStatus !== MaintenanceStatus.COMPLETED;
      default:
        return false;
    }
  };

  const getNextActions = () => {
    const actions = [];

    if (canTransitionTo(MaintenanceStatus.ASSIGNED) && !request.assignedUser) {
      actions.push({
        label: "Assign Staff",
        icon: User,
        variant: "default" as const,
        onClick: () => setAssignmentDialogOpen(true),
      });
    }

    if (canTransitionTo(MaintenanceStatus.IN_PROGRESS)) {
      actions.push({
        label: "Start Work",
        icon: Play,
        variant: "default" as const,
        onClick: () => handleStatusChange(MaintenanceStatus.IN_PROGRESS),
      });
    }

    if (canTransitionTo(MaintenanceStatus.COMPLETED)) {
      actions.push({
        label: "Mark Complete",
        icon: CheckCircle,
        variant: "default" as const,
        onClick: () => setCompletionDialogOpen(true),
      });
    }

    if (request.status !== MaintenanceStatus.COMPLETED) {
      actions.push({
        label: "Escalate",
        icon: ArrowUp,
        variant: "destructive" as const,
        onClick: () => setEscalationDialogOpen(true),
      });
    }

    if (canTransitionTo(MaintenanceStatus.CANCELLED)) {
      actions.push({
        label: "Cancel",
        icon: XCircle,
        variant: "outline" as const,
        onClick: () => handleStatusChange(MaintenanceStatus.CANCELLED),
      });
    }

    return actions;
  };

  return (
    <Card className="border-red-200">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-red-600" />
            Emergency Status Management
          </div>
          <div className="flex items-center gap-2">
            <Badge className={getUrgencyColor(request.urgencyLevel)}>
              {request.urgencyLevel.toUpperCase()}
            </Badge>
            <Badge className={getStatusColor(request.status)}>
              {request.status.replace("_", " ").toUpperCase()}
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current Status Info */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Time Elapsed</Label>
            <div
              className={`text-lg font-bold ${
                request.isOverdue ? "text-red-600" : "text-orange-600"
              }`}
            >
              {Math.round(request.hoursSinceCreation)} hours
              {request.isOverdue && (
                <span className="text-sm font-normal text-red-500 ms-2">
                  (OVERDUE)
                </span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Assigned To</Label>
            <div className="flex items-center gap-2">
              {request.assignedUser ? (
                <>
                  <User className="h-4 w-4 text-green-600" />
                  <span>
                    {request.assignedUser.firstName}{" "}
                    {request.assignedUser.lastName}
                  </span>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Mail className="h-3 w-3" />
                    {request.assignedUser.email}
                  </div>
                </>
              ) : (
                <span className="text-orange-600 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Unassigned
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Emergency Contact Info */}
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <h4 className="font-medium text-red-700 mb-2">Emergency Contact</h4>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-red-600" />
              <span>
                {request.tenant.firstName} {request.tenant.lastName}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-red-600" />
              <a
                href={`tel:${request.tenant.phone}`}
                className="text-red-600 hover:underline"
              >
                {request.tenant.phone}
              </a>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          {getNextActions().map((action, index) => {
            const Icon = action.icon;
            return (
              <Button
                key={index}
                variant={action.variant}
                size="sm"
                onClick={action.onClick}
                disabled={loading}
                className="flex items-center gap-2"
              >
                <Icon className="h-4 w-4" />
                {action.label}
              </Button>
            );
          })}
        </div>

        {/* Assignment Dialog */}
        <Dialog
          open={assignmentDialogOpen}
          onOpenChange={setAssignmentDialogOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Assign Emergency Request</DialogTitle>
              <DialogDescription>
                Select a staff member to handle this emergency request.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Assign To</Label>
                <Select value={assignTo} onValueChange={setAssignTo}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select staff member" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableStaff.map((staff) => (
                      <SelectItem key={staff.id} value={staff.id}>
                        <div className="flex items-center justify-between w-full">
                          <span>{staff.name}</span>
                          <Badge
                            variant={staff.available ? "default" : "secondary"}
                          >
                            {staff.available ? "Available" : "Busy"}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setAssignmentDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleAssignment} disabled={loading}>
                Assign
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Escalation Dialog */}
        <Dialog
          open={escalationDialogOpen}
          onOpenChange={setEscalationDialogOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Escalate Emergency Request</DialogTitle>
              <DialogDescription>
                Escalate this emergency to a higher authority for immediate
                attention.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Escalation Reason *</Label>
                <Textarea
                  placeholder="Why is this request being escalated?"
                  value={escalationReason}
                  onChange={(e) => setEscalationReason(e.target.value)}
                />
              </div>
              <div>
                <Label>Escalate To (Optional)</Label>
                <Select value={escalateTo} onValueChange={setEscalateTo}>
                  <SelectTrigger>
                    <SelectValue placeholder="Auto-assign to available manager" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableStaff
                      .filter(
                        (staff) =>
                          staff.role === "property_manager" ||
                          staff.role === "super_admin"
                      )
                      .map((staff) => (
                        <SelectItem key={staff.id} value={staff.id}>
                          {staff.name} ({staff.role.replace("_", " ")})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Additional Notes</Label>
                <Textarea
                  placeholder="Any additional information..."
                  value={escalationNotes}
                  onChange={(e) => setEscalationNotes(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setEscalationDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleEscalation}
                disabled={loading}
              >
                Escalate Now
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Completion Dialog */}
        <Dialog
          open={completionDialogOpen}
          onOpenChange={setCompletionDialogOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Complete Emergency Request</DialogTitle>
              <DialogDescription>
                Mark this emergency request as completed and provide final
                details.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Completion Notes</Label>
                <Textarea
                  placeholder="Describe the work completed and resolution..."
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                />
              </div>
              <div>
                <Label>Actual Cost (Optional)</Label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={actualCost}
                  onChange={(e) => setActualCost(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCompletionDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleCompletion} disabled={loading}>
                Mark Complete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
