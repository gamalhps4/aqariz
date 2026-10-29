"use client";

import React from "react";
import { LeaseResponse } from "@/lib/services/lease.service";
import { deriveCompanyInitials } from "@/lib/invoice/logo-utils";

export interface CleanLeaseInvoiceProps {
  lease: LeaseResponse;
  companyInfo?: {
    name: string;
    address: string;
    phone: string;
    email: string;
    website?: string;
    logo?: string;
  };
  invoiceNumber?: string;
  issueDate?: Date;
  dueDate?: Date;
}
import { formatCurrency } from "@/lib/utils/formatting";

export function CleanLeaseInvoice({
  lease,
  companyInfo = {
    name: "PropertyPro Management",
    address: "123 Business Ave, Suite 100, City, State 12345",
    phone: "+1 (555) 123-4567",
    email: "info@PropertyPro.com",
    website: "www.PropertyPro.com",
  },
  invoiceNumber,
  issueDate = new Date(),
  dueDate,
}: CleanLeaseInvoiceProps) {
  // Generate invoice number if not provided
  const generatedInvoiceNumber =
    invoiceNumber || `INV-A7C35476-${new Date().getFullYear()}`;

  // Calculate due date if not provided (30 days from issue date)
  const calculatedDueDate =
    dueDate || new Date(issueDate.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Format currency
  // const formatCurrency = (amount: number) => {
  //   return new Intl.NumberFormat("en-US", {
  //     style: "currency",
  //     currency: "USD",
  //   }).format(amount);
  // };

  // Format date
  const formatDate = (date: Date | string) => {
    const dateObj = typeof date === "string" ? new Date(date) : date;
    return dateObj.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // Calculate subtotal and total
  const subtotal =
    lease.terms.rentAmount +
    (lease.terms.securityDeposit ?? 0) +
    (lease.terms.petDeposit || 0);
  const shipping = 0;
  const discount = 0;
  const taxes = 0;
  const totalAmount = subtotal + shipping - discount + taxes;
  const companyInitials = deriveCompanyInitials(companyInfo.name);

  return (
    <div
      style={{
        fontFamily: "Arial, sans-serif",
        fontSize: "14px",
        lineHeight: "1.5",
        color: "#333333",
        backgroundColor: "#ffffff",
        padding: "32px",
        maxWidth: "210mm",
        minHeight: "297mm",
        margin: "0 auto",
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "40px",
        }}
      >
        <div>
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "16px",
              backgroundColor: companyInfo.logo ? "transparent" : "#10b981",
              overflow: "hidden",
            }}
          >
            {companyInfo.logo ? (
              <img
                src={companyInfo.logo}
                alt={companyInfo.name}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
                crossOrigin="anonymous"
              />
            ) : (
              <span
                style={{
                  color: "white",
                  fontWeight: "bold",
                  fontSize: "16px",
                  fontFamily: "Arial, sans-serif",
                }}
              >
                {companyInitials}
              </span>
            )}
          </div>
          <h1
            style={{
              fontSize: "20px",
              fontWeight: "bold",
              color: "#111827",
              margin: "0 0 4px 0",
              lineHeight: "1.2",
            }}
          >
            {companyInfo.name}
          </h1>
          <div
            style={{
              color: "#6b7280",
              fontSize: "13px",
              lineHeight: "1.4",
              marginBottom: "16px",
            }}
          >
            <p style={{ margin: "1px 0" }}>{companyInfo.address}</p>
            <p style={{ margin: "1px 0" }}>{companyInfo.phone}</p>
            <p style={{ margin: "1px 0" }}>{companyInfo.email}</p>
            {companyInfo.website && (
              <p style={{ margin: "1px 0" }}>{companyInfo.website}</p>
            )}
          </div>
          <div>
            <span style={{ color: "#6b7280", fontSize: "13px" }}>Paid</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              backgroundColor: "#dcfce7",
              color: "#166534",
              padding: "6px 16px",
              borderRadius: "4px",
              fontSize: "14px",
              fontWeight: "600",
              display: "inline-block",
              marginBottom: "8px",
            }}
          >
            Paid
          </div>
          <p
            style={{
              margin: "0 0 12px 0",
              fontSize: "13px",
              color: "#6b7280",
              fontWeight: "500",
            }}
          >
            {generatedInvoiceNumber}
          </p>
          <div
            style={{ fontSize: "13px", color: "#6b7280", textAlign: "right" }}
          >
            <p style={{ margin: "2px 0", fontWeight: "500" }}>
              Issue Date: {formatDate(issueDate)}
            </p>
            <p style={{ margin: "2px 0", fontWeight: "500" }}>
              Due Date: {formatDate(calculatedDueDate)}
            </p>
          </div>
        </div>
      </div>

      {/* Invoice From/To */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "48px",
          marginBottom: "32px",
        }}
      >
        <div>
          <h3
            style={{
              fontWeight: "600",
              color: "#111827",
              marginBottom: "8px",
              fontSize: "14px",
              margin: "0 0 8px 0",
            }}
          >
            Invoice from
          </h3>
          <div
            style={{ color: "#374151", fontSize: "13px", lineHeight: "1.4" }}
          >
            <p style={{ fontWeight: "600", margin: "1px 0", color: "#111827" }}>
              {companyInfo.name}
            </p>
            <p style={{ margin: "1px 0" }}>{companyInfo.address}</p>
            <p style={{ margin: "1px 0" }}>{companyInfo.phone}</p>
          </div>
        </div>
        <div>
          <h3
            style={{
              fontWeight: "600",
              color: "#111827",
              marginBottom: "8px",
              fontSize: "14px",
              margin: "0 0 8px 0",
            }}
          >
            Invoice to
          </h3>
          <div
            style={{ color: "#374151", fontSize: "13px", lineHeight: "1.4" }}
          >
            <p style={{ fontWeight: "600", margin: "1px 0", color: "#111827" }}>
              {lease.tenantId.firstName} {lease.tenantId.lastName}
            </p>
            <p style={{ margin: "1px 0" }}>
              {lease.propertyId.address.street}, {lease.propertyId.address.city}
              , {lease.propertyId.address.state} /{" "}
              {lease.propertyId.address.zipCode}
            </p>
            <p style={{ margin: "1px 0" }}>
              {lease.tenantId.phone || lease.tenantId.email}
            </p>
          </div>
        </div>
      </div>

      {/* Invoice Details */}
      <div style={{ marginBottom: "24px" }}>
        <h3
          style={{
            fontWeight: "600",
            color: "#111827",
            marginBottom: "12px",
            fontSize: "14px",
            margin: "0 0 12px 0",
          }}
        >
          Invoice details
        </h3>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            border: "1px solid #e5e7eb",
          }}
        >
          <thead style={{ backgroundColor: "#f9fafb" }}>
            <tr>
              <th
                style={{
                  padding: "12px 16px",
                  textAlign: "left",
                  fontSize: "13px",
                  fontWeight: "600",
                  color: "#111827",
                  borderBottom: "1px solid #e5e7eb",
                  borderRight: "1px solid #e5e7eb",
                  width: "8%",
                }}
              >
                #
              </th>
              <th
                style={{
                  padding: "12px 16px",
                  textAlign: "left",
                  fontSize: "13px",
                  fontWeight: "600",
                  color: "#111827",
                  borderBottom: "1px solid #e5e7eb",
                  borderRight: "1px solid #e5e7eb",
                  width: "50%",
                }}
              >
                Description
              </th>
              <th
                style={{
                  padding: "12px 16px",
                  textAlign: "right",
                  fontSize: "13px",
                  fontWeight: "600",
                  color: "#111827",
                  borderBottom: "1px solid #e5e7eb",
                  borderRight: "1px solid #e5e7eb",
                  width: "12%",
                }}
              >
                Qty
              </th>
              <th
                style={{
                  padding: "12px 16px",
                  textAlign: "right",
                  fontSize: "13px",
                  fontWeight: "600",
                  color: "#111827",
                  borderBottom: "1px solid #e5e7eb",
                  borderRight: "1px solid #e5e7eb",
                  width: "15%",
                }}
              >
                Unit price
              </th>
              <th
                style={{
                  padding: "12px 16px",
                  textAlign: "right",
                  fontSize: "13px",
                  fontWeight: "600",
                  color: "#111827",
                  borderBottom: "1px solid #e5e7eb",
                  width: "15%",
                }}
              >
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td
                style={{
                  padding: "12px 16px",
                  fontSize: "13px",
                  color: "#111827",
                  borderBottom: "1px solid #e5e7eb",
                  borderRight: "1px solid #e5e7eb",
                }}
              >
                1
              </td>
              <td
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid #e5e7eb",
                  borderRight: "1px solid #e5e7eb",
                }}
              >
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: "600",
                    color: "#111827",
                    marginBottom: "2px",
                  }}
                >
                  Monthly Rent - {lease.propertyId.name}
                </div>
                <div style={{ fontSize: "12px", color: "#6b7280" }}>
                  Lease period: {formatDate(lease.startDate)} -{" "}
                  {formatDate(lease.endDate)}
                </div>
              </td>
              <td
                style={{
                  padding: "12px 16px",
                  textAlign: "right",
                  fontSize: "13px",
                  color: "#111827",
                  borderBottom: "1px solid #e5e7eb",
                  borderRight: "1px solid #e5e7eb",
                }}
              >
                1
              </td>
              <td
                style={{
                  padding: "12px 16px",
                  textAlign: "right",
                  fontSize: "13px",
                  color: "#111827",
                  borderBottom: "1px solid #e5e7eb",
                  borderRight: "1px solid #e5e7eb",
                }}
              >
                {formatCurrency(lease.terms.rentAmount)}
              </td>
              <td
                style={{
                  padding: "12px 16px",
                  textAlign: "right",
                  fontSize: "13px",
                  color: "#111827",
                  borderBottom: "1px solid #e5e7eb",
                }}
              >
                {formatCurrency(lease.terms.rentAmount)}
              </td>
            </tr>
            <tr>
              <td
                style={{
                  padding: "12px 16px",
                  fontSize: "13px",
                  color: "#111827",
                  borderBottom: "1px solid #e5e7eb",
                  borderRight: "1px solid #e5e7eb",
                }}
              >
                2
              </td>
              <td
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid #e5e7eb",
                  borderRight: "1px solid #e5e7eb",
                }}
              >
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: "600",
                    color: "#111827",
                    marginBottom: "2px",
                  }}
                >
                  Security Deposit
                </div>
                <div style={{ fontSize: "12px", color: "#6b7280" }}>
                  Refundable security deposit for property protection
                </div>
              </td>
              <td
                style={{
                  padding: "12px 16px",
                  textAlign: "right",
                  fontSize: "13px",
                  color: "#111827",
                  borderBottom: "1px solid #e5e7eb",
                  borderRight: "1px solid #e5e7eb",
                }}
              >
                1
              </td>
              <td
                style={{
                  padding: "12px 16px",
                  textAlign: "right",
                  fontSize: "13px",
                  color: "#111827",
                  borderBottom: "1px solid #e5e7eb",
                  borderRight: "1px solid #e5e7eb",
                }}
              >
                {formatCurrency(lease.terms.securityDeposit)}
              </td>
              <td
                style={{
                  padding: "12px 16px",
                  textAlign: "right",
                  fontSize: "13px",
                  color: "#111827",
                  borderBottom: "1px solid #e5e7eb",
                }}
              >
                {formatCurrency(lease.terms.securityDeposit)}
              </td>
            </tr>
            {lease.terms.petDeposit && lease.terms.petDeposit > 0 && (
              <tr>
                <td
                  style={{
                    padding: "12px 16px",
                    fontSize: "13px",
                    color: "#111827",
                    borderBottom: "1px solid #e5e7eb",
                    borderRight: "1px solid #e5e7eb",
                  }}
                >
                  3
                </td>
                <td
                  style={{
                    padding: "12px 16px",
                    borderBottom: "1px solid #e5e7eb",
                    borderRight: "1px solid #e5e7eb",
                  }}
                >
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: "600",
                      color: "#111827",
                      marginBottom: "2px",
                    }}
                  >
                    Pet Deposit
                  </div>
                  <div style={{ fontSize: "12px", color: "#6b7280" }}>
                    Additional deposit for pet accommodation
                  </div>
                </td>
                <td
                  style={{
                    padding: "12px 16px",
                    textAlign: "right",
                    fontSize: "13px",
                    color: "#111827",
                    borderBottom: "1px solid #e5e7eb",
                    borderRight: "1px solid #e5e7eb",
                  }}
                >
                  1
                </td>
                <td
                  style={{
                    padding: "12px 16px",
                    textAlign: "right",
                    fontSize: "13px",
                    color: "#111827",
                    borderBottom: "1px solid #e5e7eb",
                    borderRight: "1px solid #e5e7eb",
                  }}
                >
                  {formatCurrency(lease.terms.petDeposit)}
                </td>
                <td
                  style={{
                    padding: "12px 16px",
                    textAlign: "right",
                    fontSize: "13px",
                    color: "#111827",
                    borderBottom: "1px solid #e5e7eb",
                  }}
                >
                  {formatCurrency(lease.terms.petDeposit)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginBottom: "48px",
        }}
      >
        <div style={{ width: "280px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "13px",
                paddingBottom: "4px",
              }}
            >
              <span style={{ color: "#6b7280" }}>Subtotal</span>
              <span style={{ color: "#111827" }}>
                {formatCurrency(subtotal)}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "13px",
                paddingBottom: "4px",
              }}
            >
              <span style={{ color: "#6b7280" }}>Shipping</span>
              <span style={{ color: "#111827" }}>
                {formatCurrency(shipping)}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "13px",
                paddingBottom: "4px",
              }}
            >
              <span style={{ color: "#6b7280" }}>Discount</span>
              <span style={{ color: "#111827" }}>
                {formatCurrency(discount)}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "13px",
                paddingBottom: "8px",
              }}
            >
              <span style={{ color: "#6b7280" }}>Taxes</span>
              <span style={{ color: "#111827" }}>{formatCurrency(taxes)}</span>
            </div>
            <div
              style={{
                borderTop: "1px solid #e5e7eb",
                paddingTop: "12px",
                marginTop: "4px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span
                  style={{
                    fontSize: "16px",
                    fontWeight: "700",
                    color: "#111827",
                  }}
                >
                  Total
                </span>
                <span
                  style={{
                    fontSize: "16px",
                    fontWeight: "700",
                    color: "#111827",
                  }}
                >
                  {formatCurrency(totalAmount)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Notes */}
      <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "24px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div>
            <h3
              style={{
                fontWeight: "600",
                color: "#111827",
                marginBottom: "6px",
                fontSize: "14px",
                margin: "0 0 6px 0",
              }}
            >
              NOTES
            </h3>
            <p
              style={{
                fontSize: "13px",
                color: "#6b7280",
                maxWidth: "320px",
                lineHeight: "1.4",
                margin: "0",
              }}
            >
              We appreciate your business. Should you need us to add VAT or
              extra notes let us know!
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <h3
              style={{
                fontWeight: "600",
                color: "#111827",
                marginBottom: "6px",
                fontSize: "14px",
                margin: "0 0 6px 0",
              }}
            >
              Have a question?
            </h3>
            <p style={{ fontSize: "13px", color: "#6b7280", margin: "0" }}>
              {companyInfo.email}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
