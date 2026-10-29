"use client";

import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Calendar,
  DollarSign,
  Clock,
  CheckCircle,
  Calculator,
  FileText,
} from "lucide-react";
import {
  showErrorToast,
  showSuccessToast,
  showWarningToast,
  showInfoToast,
  validateRequired,
  validateAmount,
  retryWithBackoff,
  PropertyProError,
  ErrorType,
  validateEmail,
  validatePhone,
} from "@/lib/error-handling";
import { formatCurrency } from "@/lib/utils/formatting";

interface PaymentConfiguration {
  baseMonthlyRent: number;
  lateFee: {
    amount: number;
    gracePeriodDays: number;
    type: "fixed" | "percentage";
  };
  returnedPaymentFee: number;
  annualIncrease: {
    enabled: boolean;
    type: "percentage" | "fixed";
    amount: number;
    startingYear: number;
  };
  preferredPaymentMethods: string[];
  autoPayDiscount: {
    enabled: boolean;
    amount: number;
  };
}

interface ProrationCalculation {
  moveInDate: Date;
  fullMonthRent: number;
  proratedAmount: number;
  daysInMonth: number;
  daysOccupied: number;
  dailyRate: number;
}

export default function EnhancedLeaseCreation() {
  const [leaseData, setLeaseData] = useState({
    tenantName: "",
    propertyAddress: "",
    unitNumber: "",
    leaseStartDate: "",
    leaseEndDate: "",
    moveInDate: "",
    securityDeposit: 0,
  });

  const [paymentConfig, setPaymentConfig] = useState<PaymentConfiguration>({
    baseMonthlyRent: 0,
    lateFee: {
      amount: 50,
      gracePeriodDays: 5,
      type: "fixed",
    },
    returnedPaymentFee: 35,
    annualIncrease: {
      enabled: false,
      type: "percentage",
      amount: 3,
      startingYear: 2,
    },
    preferredPaymentMethods: ["auto_pay", "online", "check"],
    autoPayDiscount: {
      enabled: true,
      amount: 10,
    },
  });

  const [proration, setProration] = useState<ProrationCalculation | null>(null);
  const [paymentSchedule, setPaymentSchedule] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Calculate proration when move-in date or rent changes
  useEffect(() => {
    if (leaseData.moveInDate && paymentConfig.baseMonthlyRent > 0) {
      calculateProration();
    }
  }, [leaseData.moveInDate, paymentConfig.baseMonthlyRent]);

  // Generate payment schedule when lease dates change
  useEffect(() => {
    if (
      leaseData.leaseStartDate &&
      leaseData.leaseEndDate &&
      paymentConfig.baseMonthlyRent > 0
    ) {
      generatePaymentSchedule();
    }
  }, [
    leaseData.leaseStartDate,
    leaseData.leaseEndDate,
    paymentConfig.baseMonthlyRent,
    paymentConfig.annualIncrease,
  ]);

  const calculateProration = () => {
    const moveInDate = new Date(leaseData.moveInDate);
    const year = moveInDate.getFullYear();
    const month = moveInDate.getMonth();

    // Get days in the move-in month
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const dayOfMonth = moveInDate.getDate();
    const daysOccupied = daysInMonth - dayOfMonth + 1;

    const dailyRate = paymentConfig.baseMonthlyRent / daysInMonth;
    const proratedAmount = dailyRate * daysOccupied;

    setProration({
      moveInDate,
      fullMonthRent: paymentConfig.baseMonthlyRent,
      proratedAmount: Math.round(proratedAmount * 100) / 100,
      daysInMonth,
      daysOccupied,
      dailyRate: Math.round(dailyRate * 100) / 100,
    });
  };

  const generatePaymentSchedule = () => {
    const startDate = new Date(leaseData.leaseStartDate);
    const endDate = new Date(leaseData.leaseEndDate);
    const schedule = [];

    const currentDate = new Date(startDate);
    let currentRent = paymentConfig.baseMonthlyRent;
    let paymentNumber = 1;

    while (currentDate <= endDate) {
      // Apply annual increase if enabled
      if (paymentConfig.annualIncrease.enabled && paymentNumber > 12) {
        const yearsPassed = Math.floor((paymentNumber - 1) / 12);
        if (yearsPassed >= paymentConfig.annualIncrease.startingYear - 1) {
          if (paymentConfig.annualIncrease.type === "percentage") {
            currentRent =
              paymentConfig.baseMonthlyRent *
              Math.pow(
                1 + paymentConfig.annualIncrease.amount / 100,
                yearsPassed
              );
          } else {
            currentRent =
              paymentConfig.baseMonthlyRent +
              paymentConfig.annualIncrease.amount * yearsPassed;
          }
        }
      }

      schedule.push({
        paymentNumber,
        dueDate: new Date(currentDate),
        amount: Math.round(currentRent * 100) / 100,
        type: paymentNumber === 1 && proration ? "prorated" : "regular",
        actualAmount:
          paymentNumber === 1 && proration
            ? proration.proratedAmount
            : Math.round(currentRent * 100) / 100,
      });

      // Move to next month
      currentDate.setMonth(currentDate.getMonth() + 1);
      paymentNumber++;
    }

    setPaymentSchedule(schedule.slice(0, 12)); // Show first 12 payments
  };

  // const formatCurrency = (amount: number) => {
  //   return new Intl.NumberFormat("en-US", {
  //     style: "currency",
  //     currency: "USD",
  //   }).format(amount);
  // };

  const handleSaveLease = async () => {
    try {
      setIsSaving(true);

      // Comprehensive validation
      const validationErrors: string[] = [];

      // Required field validation
      const requiredFields = [
        { value: leaseData.tenantName, name: "Tenant Name" },
        { value: leaseData.propertyAddress, name: "Property Address" },
        { value: leaseData.leaseStartDate, name: "Lease Start Date" },
        { value: leaseData.leaseEndDate, name: "Lease End Date" },
      ];

      requiredFields.forEach((field) => {
        const error = validateRequired(field.value, field.name);
        if (error) validationErrors.push(error);
      });

      // Amount validation
      const amountError = validateAmount(paymentConfig.baseMonthlyRent);
      if (amountError) {
        validationErrors.push(`Monthly Rent: ${amountError}`);
      }

      // Date validation
      const startDate = new Date(leaseData.leaseStartDate);
      const endDate = new Date(leaseData.leaseEndDate);
      const moveInDate = leaseData.moveInDate
        ? new Date(leaseData.moveInDate)
        : null;

      if (endDate <= startDate) {
        validationErrors.push("Lease end date must be after start date");
      }

      if (moveInDate && (moveInDate < startDate || moveInDate > endDate)) {
        validationErrors.push(
          "Move-in date must be between lease start and end dates"
        );
      }

      // Security deposit validation
      if (leaseData.securityDeposit < 0) {
        validationErrors.push("Security deposit cannot be negative");
      }

      if (validationErrors.length > 0) {
        showErrorToast(
          new PropertyProError(
            ErrorType.VALIDATION,
            validationErrors.join("; "),
            { code: "VALIDATION_REQUIRED_FIELD" }
          )
        );
        return;
      }

      // Prepare lease data with payment configuration
      const leasePayload = {
        tenantName: leaseData.tenantName,
        propertyAddress: leaseData.propertyAddress,
        unitNumber: leaseData.unitNumber,
        startDate: leaseData.leaseStartDate,
        endDate: leaseData.leaseEndDate,
        moveInDate: leaseData.moveInDate,
        terms: {
          monthlyRent: paymentConfig.baseMonthlyRent,
          securityDeposit: leaseData.securityDeposit,
          paymentConfig: {
            ...paymentConfig,
            autoCreatePayments: true,
            autoGenerateInvoices: true,
            autoEmailInvoices: true,
            enableProration: !!proration,
            proratedFirstMonth:
              proration?.proratedAmount || paymentConfig.baseMonthlyRent,
          },
        },
        status: "active",
      };

      // Step 1: Create the lease with retry logic
      showInfoToast("Creating lease...");

      const leaseResult = await retryWithBackoff(
        async () => {
          const leaseResponse = await fetch("/api/leases", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(leasePayload),
          });

          if (!leaseResponse.ok) {
            const errorData = await leaseResponse.json();
            throw new PropertyProError(
              ErrorType.DATABASE,
              errorData.message || "Failed to create lease",
              {
                code: "LEASE_CREATION_FAILED",
                details: errorData,
                retryable: leaseResponse.status >= 500,
              }
            );
          }

          return leaseResponse.json();
        },
        3,
        1000
      );

      const leaseId = leaseResult.data._id;

      // Step 2: Set up payment system with synchronization
      showInfoToast("Setting up payment system...");

      try {
        const syncResult = await retryWithBackoff(
          async () => {
            const syncResponse = await fetch(
              `/api/leases/${leaseId}/payment-sync`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  createRecurringPayments: true,
                  autoGenerateInvoices: true,
                  autoEmailInvoices: true,
                  updateLeaseStatus: true,
                  notifyTenant: true,
                  enableProration: !!proration,
                }),
              }
            );

            if (!syncResponse.ok) {
              const errorData = await syncResponse.json();
              throw new PropertyProError(
                ErrorType.DATABASE,
                errorData.message || "Failed to setup payment system",
                {
                  code: "PAYMENT_SYNC_FAILED",
                  details: errorData,
                  retryable: syncResponse.status >= 500,
                }
              );
            }

            return syncResponse.json();
          },
          3,
          1000
        );
      } catch (syncError) {
        showWarningToast(
          "Lease created successfully, but payment system setup encountered issues. You may need to set up payments manually."
        );
      }

      // Show success message with details
      const successMessage = `Lease created successfully for ${leaseData.tenantName}!`;
      const prorationMessage = proration
        ? ` First month prorated to ${formatCurrency(
            proration.proratedAmount
          )}.`
        : "";

      showSuccessToast(successMessage + prorationMessage, {
        duration: 6000,
        action: {
          label: "View Lease",
          onClick: () => {
            // Navigate to lease details page (implementation can be added here)
          },
        },
      });

      // Reset form
      setLeaseData({
        tenantName: "",
        propertyAddress: "",
        unitNumber: "",
        leaseStartDate: "",
        leaseEndDate: "",
        moveInDate: "",
        securityDeposit: 0,
      });

      setPaymentConfig({
        baseMonthlyRent: 0,
        lateFee: {
          amount: 50,
          gracePeriodDays: 5,
          type: "fixed",
        },
        returnedPaymentFee: 35,
        annualIncrease: {
          enabled: false,
          type: "percentage",
          amount: 3,
          startingYear: 2,
        },
        preferredPaymentMethods: ["auto_pay", "online", "check"],
        autoPayDiscount: {
          enabled: true,
          amount: 10,
        },
      });

      setProration(null);
      setPaymentSchedule([]);
    } catch (error) {
      // Show user-friendly error message
      showErrorToast(error);

      // Additional context for specific errors
      if (error instanceof PropertyProError) {
        switch (error.code) {
          case "LEASE_CREATION_FAILED":
            showWarningToast(
              "Please check your lease details and try again. If the problem persists, contact support."
            );
            break;
          case "PAYMENT_SYNC_FAILED":
            showWarningToast(
              "The lease may have been created but payment setup failed. Please check the lease list and set up payments manually if needed."
            );
            break;
        }
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Create New Lease</h2>
        <p className="text-muted-foreground">
          Set up lease terms with automated payment configuration
        </p>
      </div>

      <Tabs defaultValue="basic" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="basic">Basic Info</TabsTrigger>
          <TabsTrigger value="payment">Payment Config</TabsTrigger>
          <TabsTrigger value="schedule">Payment Schedule</TabsTrigger>
          <TabsTrigger value="review">Review & Save</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Lease Information</CardTitle>
              <CardDescription>Basic lease details and dates</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="tenant-name">Tenant Name</Label>
                  <Input
                    id="tenant-name"
                    value={leaseData.tenantName}
                    onChange={(e) =>
                      setLeaseData({ ...leaseData, tenantName: e.target.value })
                    }
                    placeholder="John Doe"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="property-address">Property Address</Label>
                  <Input
                    id="property-address"
                    value={leaseData.propertyAddress}
                    onChange={(e) =>
                      setLeaseData({
                        ...leaseData,
                        propertyAddress: e.target.value,
                      })
                    }
                    placeholder="123 Main St, City, State"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="unit-number">Unit Number</Label>
                  <Input
                    id="unit-number"
                    value={leaseData.unitNumber}
                    onChange={(e) =>
                      setLeaseData({ ...leaseData, unitNumber: e.target.value })
                    }
                    placeholder="Apt 101"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="security-deposit">Security Deposit</Label>
                  <Input
                    id="security-deposit"
                    type="number"
                    value={leaseData.securityDeposit}
                    onChange={(e) =>
                      setLeaseData({
                        ...leaseData,
                        securityDeposit: parseFloat(e.target.value),
                      })
                    }
                    placeholder="2000"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="lease-start">Lease Start Date</Label>
                  <Input
                    id="lease-start"
                    type="date"
                    value={leaseData.leaseStartDate}
                    onChange={(e) =>
                      setLeaseData({
                        ...leaseData,
                        leaseStartDate: e.target.value,
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lease-end">Lease End Date</Label>
                  <Input
                    id="lease-end"
                    type="date"
                    value={leaseData.leaseEndDate}
                    onChange={(e) =>
                      setLeaseData({
                        ...leaseData,
                        leaseEndDate: e.target.value,
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="move-in">Move-in Date</Label>
                  <Input
                    id="move-in"
                    type="date"
                    value={leaseData.moveInDate}
                    onChange={(e) =>
                      setLeaseData({ ...leaseData, moveInDate: e.target.value })
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payment" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Rent & Fees
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="monthly-rent">Base Monthly Rent</Label>
                  <Input
                    id="monthly-rent"
                    type="number"
                    value={paymentConfig.baseMonthlyRent}
                    onChange={(e) =>
                      setPaymentConfig({
                        ...paymentConfig,
                        baseMonthlyRent: parseFloat(e.target.value),
                      })
                    }
                    placeholder="2000"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Late Fee Structure</Label>
                  <div className="grid gap-2">
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        value={paymentConfig.lateFee.amount}
                        onChange={(e) =>
                          setPaymentConfig({
                            ...paymentConfig,
                            lateFee: {
                              ...paymentConfig.lateFee,
                              amount: parseFloat(e.target.value),
                            },
                          })
                        }
                        placeholder="50"
                      />
                      <Select
                        value={paymentConfig.lateFee.type}
                        onValueChange={(value) =>
                          setPaymentConfig({
                            ...paymentConfig,
                            lateFee: {
                              ...paymentConfig.lateFee,
                              type: value as "fixed" | "percentage",
                            },
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fixed">Fixed Amount</SelectItem>
                          <SelectItem value="percentage">Percentage</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      <span className="text-sm">After</span>
                      <Input
                        type="number"
                        className="w-20"
                        value={paymentConfig.lateFee.gracePeriodDays}
                        onChange={(e) =>
                          setPaymentConfig({
                            ...paymentConfig,
                            lateFee: {
                              ...paymentConfig.lateFee,
                              gracePeriodDays: parseInt(e.target.value),
                            },
                          })
                        }
                      />
                      <span className="text-sm">day grace period</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="returned-payment-fee">
                    Returned Payment Fee
                  </Label>
                  <Input
                    id="returned-payment-fee"
                    type="number"
                    value={paymentConfig.returnedPaymentFee}
                    onChange={(e) =>
                      setPaymentConfig({
                        ...paymentConfig,
                        returnedPaymentFee: parseFloat(e.target.value),
                      })
                    }
                    placeholder="35"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="h-5 w-5" />
                  Annual Increase & Incentives
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="annual-increase"
                      checked={paymentConfig.annualIncrease.enabled}
                      onCheckedChange={(checked) =>
                        setPaymentConfig({
                          ...paymentConfig,
                          annualIncrease: {
                            ...paymentConfig.annualIncrease,
                            enabled: checked as boolean,
                          },
                        })
                      }
                    />
                    <Label htmlFor="annual-increase">
                      Enable Annual Rent Increase
                    </Label>
                  </div>

                  {paymentConfig.annualIncrease.enabled && (
                    <div className="grid gap-2 ms-6">
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          value={paymentConfig.annualIncrease.amount}
                          onChange={(e) =>
                            setPaymentConfig({
                              ...paymentConfig,
                              annualIncrease: {
                                ...paymentConfig.annualIncrease,
                                amount: parseFloat(e.target.value),
                              },
                            })
                          }
                          placeholder="3"
                        />
                        <Select
                          value={paymentConfig.annualIncrease.type}
                          onValueChange={(value) =>
                            setPaymentConfig({
                              ...paymentConfig,
                              annualIncrease: {
                                ...paymentConfig.annualIncrease,
                                type: value as "percentage" | "fixed",
                              },
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="percentage">
                              Percentage
                            </SelectItem>
                            <SelectItem value="fixed">Fixed Amount</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm">Starting year</span>
                        <Input
                          type="number"
                          className="w-20"
                          value={paymentConfig.annualIncrease.startingYear}
                          onChange={(e) =>
                            setPaymentConfig({
                              ...paymentConfig,
                              annualIncrease: {
                                ...paymentConfig.annualIncrease,
                                startingYear: parseInt(e.target.value),
                              },
                            })
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="autopay-discount"
                      checked={paymentConfig.autoPayDiscount.enabled}
                      onCheckedChange={(checked) =>
                        setPaymentConfig({
                          ...paymentConfig,
                          autoPayDiscount: {
                            ...paymentConfig.autoPayDiscount,
                            enabled: checked as boolean,
                          },
                        })
                      }
                    />
                    <Label htmlFor="autopay-discount">Auto-pay Discount</Label>
                  </div>

                  {paymentConfig.autoPayDiscount.enabled && (
                    <div className="ms-6">
                      <Input
                        type="number"
                        value={paymentConfig.autoPayDiscount.amount}
                        onChange={(e) =>
                          setPaymentConfig({
                            ...paymentConfig,
                            autoPayDiscount: {
                              ...paymentConfig.autoPayDiscount,
                              amount: parseFloat(e.target.value),
                            },
                          })
                        }
                        placeholder="10"
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Preferred Payment Methods</Label>
                  <div className="space-y-2">
                    {[
                      { id: "auto_pay", label: "Auto-pay (ACH)" },
                      { id: "online", label: "Online Payment" },
                      { id: "check", label: "Check" },
                      { id: "money_order", label: "Money Order" },
                    ].map((method) => (
                      <div
                        key={method.id}
                        className="flex items-center space-x-2"
                      >
                        <Checkbox
                          id={method.id}
                          checked={paymentConfig.preferredPaymentMethods.includes(
                            method.id
                          )}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setPaymentConfig({
                                ...paymentConfig,
                                preferredPaymentMethods: [
                                  ...paymentConfig.preferredPaymentMethods,
                                  method.id,
                                ],
                              });
                            } else {
                              setPaymentConfig({
                                ...paymentConfig,
                                preferredPaymentMethods:
                                  paymentConfig.preferredPaymentMethods.filter(
                                    (m) => m !== method.id
                                  ),
                              });
                            }
                          }}
                        />
                        <Label htmlFor={method.id}>{method.label}</Label>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Proration Calculator */}
          {proration && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="h-5 w-5" />
                  Prorated First Month Calculation
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span>Move-in Date:</span>
                      <span className="font-medium">
                        {proration.moveInDate.toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Days in Month:</span>
                      <span className="font-medium">
                        {proration.daysInMonth}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Days Occupied:</span>
                      <span className="font-medium">
                        {proration.daysOccupied}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Daily Rate:</span>
                      <span className="font-medium">
                        {formatCurrency(proration.dailyRate)}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span>Full Month Rent:</span>
                      <span className="font-medium">
                        {formatCurrency(proration.fullMonthRent)}
                      </span>
                    </div>
                    <div className="flex justify-between text-lg font-bold">
                      <span>Prorated Amount:</span>
                      <span className="text-green-600">
                        {formatCurrency(proration.proratedAmount)}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="schedule" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Payment Schedule Preview
              </CardTitle>
              <CardDescription>
                First 12 months of payment schedule
              </CardDescription>
            </CardHeader>
            <CardContent>
              {paymentSchedule.length > 0 ? (
                <div className="space-y-2">
                  {paymentSchedule.map((payment) => (
                    <div
                      key={payment.paymentNumber}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <Badge
                          variant={
                            payment.type === "prorated"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          Payment #{payment.paymentNumber}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          Due: {payment.dueDate.toLocaleDateString()}
                        </span>
                        {payment.type === "prorated" && (
                          <Badge variant="secondary">Prorated</Badge>
                        )}
                      </div>
                      <div className="text-end">
                        <div className="font-medium">
                          {formatCurrency(payment.actualAmount)}
                        </div>
                        {payment.type === "prorated" && (
                          <div className="text-xs text-muted-foreground">
                            (Full: {formatCurrency(payment.amount)})
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  Complete lease dates and rent amount to generate payment
                  schedule
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="review" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Lease Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <h4 className="font-semibold mb-2">Lease Details</h4>
                  <div className="space-y-1 text-sm">
                    <div>Tenant: {leaseData.tenantName}</div>
                    <div>Property: {leaseData.propertyAddress}</div>
                    <div>Unit: {leaseData.unitNumber}</div>
                    <div>
                      Term: {leaseData.leaseStartDate} to{" "}
                      {leaseData.leaseEndDate}
                    </div>
                    <div>Move-in: {leaseData.moveInDate}</div>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Payment Configuration</h4>
                  <div className="space-y-1 text-sm">
                    <div>
                      Monthly Rent:{" "}
                      {formatCurrency(paymentConfig?.baseMonthlyRent ?? 0)}
                    </div>
                    <div>
                      Late Fee:{" "}
                      {formatCurrency(paymentConfig?.lateFee?.amount ?? 0)}{" "}
                      after {paymentConfig?.lateFee?.gracePeriodDays ?? 0} days
                    </div>
                    <div>
                      Security Deposit:{" "}
                      {formatCurrency(leaseData?.securityDeposit ?? 0)}
                    </div>
                    {proration && (
                      <div>
                        First Month (Prorated):{" "}
                        {formatCurrency(proration?.proratedAmount ?? 0)}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  Review all details carefully before creating the lease.
                  Payment schedule will be automatically generated.
                </AlertDescription>
              </Alert>

              <div className="flex gap-2">
                <Button
                  onClick={handleSaveLease}
                  className="flex-1"
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <>
                      <Clock className="h-4 w-4 me-2 animate-spin" />
                      Creating Lease...
                    </>
                  ) : (
                    "Create Lease & Generate Payments"
                  )}
                </Button>
                <Button variant="outline" disabled={isSaving}>
                  Save as Draft
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
