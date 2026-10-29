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
import { CategorySelectItems } from "@/components/properties/category-select-items";
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
  Building2,
  MapPin,
  Users,
  DollarSign,
  Calendar,
  Wrench,
  AlertTriangle,
  CheckCircle,
  Clock,
  Plus,
  Search,
  Filter,
  Edit,
  Eye,
  Home,
  Bed,
  Bath,
  Car,
  Wifi,
  Zap,
  Droplets,
  Thermometer,
} from "lucide-react";

interface Property {
  id: string;
  name: string;
  address: string;
  type: "apartment" | "house" | "condo" | "commercial";
  totalUnits: number;
  occupiedUnits: number;
  monthlyRevenue: number;
  averageRent: number;
  occupancyRate: number;
  maintenanceRequests: number;
  lastInspection: Date;
  status: "active" | "maintenance" | "renovation" | "inactive";
  amenities: string[];
  manager: string;
}

interface Unit {
  id: string;
  propertyId: string;
  unitNumber: string;
  type: "studio" | "1br" | "2br" | "3br" | "4br+";
  bedrooms: number;
  bathrooms: number;
  squareFeet: number;
  rent: number;
  deposit: number;
  status: "occupied" | "vacant" | "maintenance" | "notice";
  tenant?: {
    id: string;
    name: string;
    email: string;
    phone: string;
    leaseStart: Date;
    leaseEnd: Date;
  };
  lastMaintenance: Date;
  amenities: string[];
}

interface MaintenanceRequest {
  id: string;
  propertyId: string;
  unitId: string;
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "in_progress" | "completed" | "cancelled";
  category: "plumbing" | "electrical" | "hvac" | "appliance" | "general";
  submittedBy: string;
  assignedTo?: string;
  submittedDate: Date;
  completedDate?: Date;
  estimatedCost: number;
  actualCost?: number;
}
import { formatCurrency } from "@/lib/utils/formatting";

export default function PropertyManagementDashboard() {
  const [properties, setProperties] = useState<Property[]>([
    {
      id: "prop_1",
      name: "Sunset Apartments",
      address: "123 Main Street, Downtown",
      type: "apartment",
      totalUnits: 24,
      occupiedUnits: 22,
      monthlyRevenue: 36000,
      averageRent: 1500,
      occupancyRate: 0.92,
      maintenanceRequests: 3,
      lastInspection: new Date("2024-01-15"),
      status: "active",
      amenities: ["Pool", "Gym", "Parking", "Laundry"],
      manager: "John Smith",
    },
    {
      id: "prop_2",
      name: "Oak Hill Residences",
      address: "456 Oak Avenue, Suburbs",
      type: "house",
      totalUnits: 12,
      occupiedUnits: 11,
      monthlyRevenue: 24000,
      averageRent: 2000,
      occupancyRate: 0.92,
      maintenanceRequests: 1,
      lastInspection: new Date("2024-01-20"),
      status: "active",
      amenities: ["Garage", "Garden", "Parking"],
      manager: "Sarah Johnson",
    },
  ]);

  const [units, setUnits] = useState<Unit[]>([
    {
      id: "unit_1",
      propertyId: "prop_1",
      unitNumber: "101",
      type: "2br",
      bedrooms: 2,
      bathrooms: 1,
      squareFeet: 850,
      rent: 1500,
      deposit: 1500,
      status: "occupied",
      tenant: {
        id: "tenant_1",
        name: "Alice Johnson",
        email: "alice@example.com",
        phone: "+1234567890",
        leaseStart: new Date("2023-06-01"),
        leaseEnd: new Date("2024-05-31"),
      },
      lastMaintenance: new Date("2024-01-10"),
      amenities: ["AC", "Dishwasher", "Balcony"],
    },
    {
      id: "unit_2",
      propertyId: "prop_1",
      unitNumber: "102",
      type: "1br",
      bedrooms: 1,
      bathrooms: 1,
      squareFeet: 650,
      rent: 1200,
      deposit: 1200,
      status: "vacant",
      lastMaintenance: new Date("2024-01-25"),
      amenities: ["AC", "Dishwasher"],
    },
  ]);

  const [maintenanceRequests, setMaintenanceRequests] = useState<
    MaintenanceRequest[]
  >([
    {
      id: "maint_1",
      propertyId: "prop_1",
      unitId: "unit_1",
      title: "Leaky Faucet in Kitchen",
      description: "Kitchen faucet has been dripping for several days",
      priority: "medium",
      status: "open",
      category: "plumbing",
      submittedBy: "Alice Johnson",
      submittedDate: new Date("2024-01-30"),
      estimatedCost: 150,
    },
    {
      id: "maint_2",
      propertyId: "prop_1",
      unitId: "unit_1",
      title: "AC Not Working",
      description: "Air conditioning unit not cooling properly",
      priority: "high",
      status: "in_progress",
      category: "hvac",
      submittedBy: "Alice Johnson",
      assignedTo: "Mike Davis",
      submittedDate: new Date("2024-01-28"),
      estimatedCost: 300,
    },
  ]);

  const [selectedProperty, setSelectedProperty] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // const formatCurrency = (amount: number) => {
  //   return new Intl.NumberFormat('en-US', {
  //     style: 'currency',
  //     currency: 'USD',
  //   }).format(amount);
  // };

  const getStatusBadge = (
    status: string,
    type: "property" | "unit" | "maintenance"
  ) => {
    const configs: Record<
      "property" | "unit" | "maintenance",
      Record<string, { label: string; variant: string }>
    > = {
      property: {
        active: { label: "Active", variant: "default" },
        maintenance: { label: "Maintenance", variant: "secondary" },
        renovation: { label: "Renovation", variant: "secondary" },
        inactive: { label: "Inactive", variant: "outline" },
      },
      unit: {
        occupied: { label: "Occupied", variant: "default" },
        vacant: { label: "Vacant", variant: "secondary" },
        maintenance: { label: "Maintenance", variant: "secondary" },
        notice: { label: "Notice Given", variant: "default" },
      },
      maintenance: {
        open: { label: "Open", variant: "destructive" },
        in_progress: { label: "In Progress", variant: "default" },
        completed: { label: "Completed", variant: "default" },
        cancelled: { label: "Cancelled", variant: "outline" },
      },
    };

    const config = configs[type][status];
    return (
      <Badge variant={config?.variant as any}>{config?.label || status}</Badge>
    );
  };

  const getPriorityBadge = (priority: MaintenanceRequest["priority"]) => {
    const priorityConfig = {
      low: { label: "Low", variant: "outline" },
      medium: { label: "Medium", variant: "secondary" },
      high: { label: "High", variant: "default" },
      urgent: { label: "Urgent", variant: "destructive" },
    };

    const config = priorityConfig[priority];
    return <Badge variant={config.variant as any}>{config.label}</Badge>;
  };

  const getTypeIcon = (type: Property["type"]) => {
    switch (type) {
      case "apartment":
        return <Building2 className="h-4 w-4" />;
      case "house":
        return <Home className="h-4 w-4" />;
      case "condo":
        return <Building2 className="h-4 w-4" />;
      case "commercial":
        return <Building2 className="h-4 w-4" />;
      default:
        return <Building2 className="h-4 w-4" />;
    }
  };

  const filteredProperties = properties.filter((property) => {
    const matchesSearch =
      searchQuery === "" ||
      property.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      property.address.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      filterStatus === "all" || property.status === filterStatus;

    return matchesSearch && matchesStatus;
  });

  const totalRevenue = properties.reduce(
    (sum, prop) => sum + prop.monthlyRevenue,
    0
  );
  const totalUnits = properties.reduce((sum, prop) => sum + prop.totalUnits, 0);
  const totalOccupied = properties.reduce(
    (sum, prop) => sum + prop.occupiedUnits,
    0
  );
  const overallOccupancyRate =
    totalUnits > 0 ? (totalOccupied / totalUnits) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            Property Management
          </h2>
          <p className="text-muted-foreground">
            Manage your property portfolio, units, and maintenance requests
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 me-2" />
                Add Property
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>Add New Property</DialogTitle>
                <DialogDescription>
                  Add a new property to your portfolio
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="property-name">Property Name</Label>
                    <Input
                      id="property-name"
                      placeholder="Enter property name"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="property-type">Property Type</Label>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <CategorySelectItems kind="property" />
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="address">Address</Label>
                  <Input id="address" placeholder="Property address" />
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="total-units">Total Units</Label>
                    <Input id="total-units" type="number" placeholder="0" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="average-rent">Average Rent</Label>
                    <Input id="average-rent" type="number" placeholder="0" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="manager">Property Manager</Label>
                    <Input id="manager" placeholder="Manager name" />
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline">Cancel</Button>
                  <Button>Add Property</Button>
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
            <CardTitle className="text-sm font-medium">
              Total Properties
            </CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{properties.length}</div>
            <p className="text-xs text-muted-foreground">
              {totalUnits} total units
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Monthly Revenue
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(totalRevenue)}
            </div>
            <p className="text-xs text-muted-foreground">
              From {totalOccupied} occupied units
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Occupancy Rate
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {overallOccupancyRate.toFixed(1)}%
            </div>
            <Progress value={overallOccupancyRate} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Maintenance Requests
            </CardTitle>
            <Wrench className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {
                maintenanceRequests.filter((req) => req.status === "open")
                  .length
              }
            </div>
            <p className="text-xs text-muted-foreground">
              {
                maintenanceRequests.filter(
                  (req) => req.status === "in_progress"
                ).length
              }{" "}
              in progress
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="properties" className="space-y-4">
        <TabsList>
          <TabsTrigger value="properties">Properties</TabsTrigger>
          <TabsTrigger value="units">Units</TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
          <TabsTrigger value="inspections">Inspections</TabsTrigger>
        </TabsList>

        <TabsContent value="properties" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex gap-4 items-center">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute start-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search properties..."
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
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                    <SelectItem value="renovation">Renovation</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Properties Grid */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredProperties.map((property) => (
              <Card
                key={property.id}
                className="hover:shadow-md transition-shadow"
              >
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      {getTypeIcon(property.type)}
                      <div>
                        <CardTitle className="text-lg">
                          {property.name}
                        </CardTitle>
                        <CardDescription className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {property.address}
                        </CardDescription>
                      </div>
                    </div>
                    {getStatusBadge(property.status, "property")}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Key Metrics */}
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-muted-foreground">Units</div>
                        <div className="font-medium">
                          {property.occupiedUnits}/{property.totalUnits}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Occupancy</div>
                        <div className="font-medium">
                          {(property.occupancyRate * 100).toFixed(1)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">
                          Monthly Revenue
                        </div>
                        <div className="font-medium">
                          {formatCurrency(property.monthlyRevenue)}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Avg. Rent</div>
                        <div className="font-medium">
                          {formatCurrency(property.averageRent)}
                        </div>
                      </div>
                    </div>

                    {/* Occupancy Progress */}
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span>Occupancy Rate</span>
                        <span>
                          {(property.occupancyRate * 100).toFixed(1)}%
                        </span>
                      </div>
                      <Progress value={property.occupancyRate * 100} />
                    </div>

                    {/* Amenities */}
                    <div>
                      <div className="text-sm text-muted-foreground mb-2">
                        Amenities
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {property.amenities.slice(0, 3).map((amenity) => (
                          <Badge
                            key={amenity}
                            variant="outline"
                            className="text-xs"
                          >
                            {amenity}
                          </Badge>
                        ))}
                        {property.amenities.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{property.amenities.length - 3} more
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Maintenance Alert */}
                    {property.maintenanceRequests > 0 && (
                      <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          {property.maintenanceRequests} pending maintenance
                          request{property.maintenanceRequests > 1 ? "s" : ""}
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1">
                        <Eye className="h-4 w-4 me-2" />
                        View Details
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

        <TabsContent value="units" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle>Unit Management</CardTitle>
                  <CardDescription>
                    Manage individual units across all properties
                  </CardDescription>
                </div>
                <Button>
                  <Plus className="h-4 w-4 me-2" />
                  Add Unit
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {units.map((unit) => (
                  <div
                    key={unit.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Home className="h-4 w-4" />
                        <div>
                          <div className="font-medium">
                            Unit {unit.unitNumber}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {
                              properties.find((p) => p.id === unit.propertyId)
                                ?.name
                            }
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-1">
                          <Bed className="h-3 w-3" />
                          {unit.bedrooms}
                        </div>
                        <div className="flex items-center gap-1">
                          <Bath className="h-3 w-3" />
                          {unit.bathrooms}
                        </div>
                        <div>{unit.squareFeet} sq ft</div>
                        <div className="font-medium">
                          {formatCurrency(unit.rent)}/mo
                        </div>
                      </div>

                      {getStatusBadge(unit.status, "unit")}
                    </div>

                    <div className="flex items-center gap-2">
                      {unit.tenant && (
                        <div className="text-sm text-end">
                          <div className="font-medium">{unit.tenant.name}</div>
                          <div className="text-muted-foreground">
                            Lease ends{" "}
                            {unit.tenant.leaseEnd.toLocaleDateString()}
                          </div>
                        </div>
                      )}
                      <Button size="sm" variant="outline">
                        <Eye className="h-4 w-4 me-2" />
                        View
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="maintenance" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle>Maintenance Requests</CardTitle>
                  <CardDescription>
                    Track and manage maintenance requests across all properties
                  </CardDescription>
                </div>
                <Button>
                  <Plus className="h-4 w-4 me-2" />
                  New Request
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {maintenanceRequests.map((request) => (
                  <div
                    key={request.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Wrench className="h-4 w-4" />
                        <div>
                          <div className="font-medium">{request.title}</div>
                          <div className="text-sm text-muted-foreground">
                            {
                              properties.find(
                                (p) => p.id === request.propertyId
                              )?.name
                            }{" "}
                            • Unit{" "}
                            {
                              units.find((u) => u.id === request.unitId)
                                ?.unitNumber
                            }
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Submitted by {request.submittedBy} on{" "}
                            {request.submittedDate.toLocaleDateString()}
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        {getStatusBadge(request.status, "maintenance")}
                        {getPriorityBadge(request.priority)}
                        <Badge variant="outline">{request.category}</Badge>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="text-sm text-end">
                        <div className="font-medium">
                          Est. {formatCurrency(request.estimatedCost)}
                        </div>
                        {request.assignedTo && (
                          <div className="text-muted-foreground">
                            Assigned to {request.assignedTo}
                          </div>
                        )}
                      </div>
                      <Button size="sm" variant="outline">
                        <Eye className="h-4 w-4 me-2" />
                        View
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inspections" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Property Inspections</CardTitle>
              <CardDescription>
                Schedule and track property inspections
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Alert>
                  <Calendar className="h-4 w-4" />
                  <AlertDescription>
                    Next scheduled inspection: Sunset Apartments on February 15,
                    2024
                  </AlertDescription>
                </Alert>

                <div className="grid gap-4 md:grid-cols-2">
                  {properties.map((property) => (
                    <Card key={property.id}>
                      <CardHeader>
                        <CardTitle className="text-lg">
                          {property.name}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span>Last Inspection:</span>
                            <span>
                              {property.lastInspection.toLocaleDateString()}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Next Due:</span>
                            <span className="text-orange-600">
                              {new Date(
                                property.lastInspection.getTime() +
                                  90 * 24 * 60 * 60 * 1000
                              ).toLocaleDateString()}
                            </span>
                          </div>
                          <Button size="sm" className="w-full mt-2">
                            <Calendar className="h-4 w-4 me-2" />
                            Schedule Inspection
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
