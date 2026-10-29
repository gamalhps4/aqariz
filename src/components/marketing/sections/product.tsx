"use client";

import { useState } from "react";
import Image from "@/components/ui/app-image";
import {
  BarChart3,
  Bell,
  Building2,
  Calendar,
  CircleDollarSign,
  ClipboardCheck,
  Clock,
  FileText,
  Home,
  Inbox,
  LayoutDashboard,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Phone,
  PieChart,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  TrendingUp,
  Users,
  Video,
  WalletCards,
  Wrench,
  AlertTriangle,
} from "lucide-react";
import type { ProductContent } from "@/lib/marketing/landing-types";
import { Brand } from "./brand";

// The fixed set of preview tabs lives in PRODUCT_SLOTS (defined below the view
// components). Each slot owns its icon, the sidebar entry to highlight, and the
// built-in mockup. The admin can rename a tab and upload a screenshot per slot
// (ProductContent.tabs, positional); an uploaded image replaces the mockup.


const productNav = [
  { section: null, items: [{ icon: LayoutDashboard, label: "Dashboard" }] },
  {
    section: "Management",
    items: [
      { icon: Building2, label: "Properties" },
      { icon: Users, label: "Tenants" },
      { icon: FileText, label: "Leases" },
      { icon: Wrench, label: "Maintenance" },
      { icon: ClipboardCheck, label: "Inspections" },
    ],
  },
  {
    section: "Financials",
    items: [
      { icon: ReceiptText, label: "Transactions" },
      { icon: FileText, label: "Invoices" },
      { icon: TrendingUp, label: "Revenues" },
      { icon: CircleDollarSign, label: "Expenses" },
      { icon: BarChart3, label: "Reports" },
    ],
  },
  {
    section: "Activity",
    items: [
      { icon: Inbox, label: "Inbox", badge: "3" },
      { icon: Calendar, label: "Calendar" },
    ],
  },
  {
    section: "Administration",
    items: [
      { icon: ShieldCheck, label: "Admin" },
      { icon: Settings, label: "Settings" },
    ],
  },
] as const;

/* ------------------------------------------------------------------ */
/* Shared building blocks                                              */
/* ------------------------------------------------------------------ */

function MainHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-[11px] font-bold text-slate-900">{title}</p>
        <p className="mt-0.5 text-[6px] text-slate-400">{subtitle}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[6px] font-medium text-slate-500">
          <Search className="size-2" /> Search
        </span>
        {action && (
          <span className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[6px] font-semibold text-white">
            <Plus className="size-2" /> {action}
          </span>
        )}
      </div>
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: string }) {
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[5px] font-semibold ${tone}`}>
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

const productAlerts = [
  { icon: AlertTriangle, label: "Overdue Payments", note: "5 payments now overdue", badge: "2", tone: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  { icon: AlertTriangle, label: "Urgent Maintenance", note: "1 urgent request needs attention", badge: "1", tone: "border-rose-200 bg-rose-50 text-rose-700", dot: "bg-rose-500" },
  { icon: Clock, label: "Expiring Leases", note: "No leases expiring soon", badge: "0", tone: "border-blue-200 bg-blue-50 text-blue-700", dot: "bg-blue-500" },
] as const;

const productStatsTop = [
  ["Total Properties", "8", "Active properties in portfolio", Building2, "text-blue-600"],
  ["Occupancy Rate", "16.7%", "4 of 24 units occupied", Home, "text-emerald-600"],
  ["Monthly Revenue", "SAR 7,700.00", "Current month collected", CircleDollarSign, "text-violet-600"],
  ["Collection Rate", "64.9%", "Payment collection efficiency", PieChart, "text-amber-600"],
  ["Active Tenants", "4", "2 pending applications", Users, "text-cyan-600"],
] as const;

const productStatsBottom = [
  ["Maintenance Requests", "2", "1 urgent", Wrench, "text-rose-600"],
  ["Vacant Units", "20", "83.3% vacancy rate", Home, "text-orange-600"],
  ["Average Rent", "SAR 2,253.96", "Per unit monthly average", WalletCards, "text-emerald-600"],
  ["Lease Renewals", "0", "Due in next 30 days", FileText, "text-blue-600"],
  ["Recent Events", "8", "Logged activities", BarChart3, "text-violet-600"],
] as const;

const productActivity = [
  ["Sofia Martinez", "paid invoice for Maple Court Townhomes", "2h ago", "SAR 2,200.00"],
  ["Emma Reed", "paid invoice for Harbor Bay Apartments", "5h ago", "SAR 1,950.00"],
  ["Sofia Martinez", "paid invoice for Maple Court Townhomes", "1d ago", "SAR 2,200.00"],
  ["Liam Chen", "paid invoice for Cedar Ridge Villas", "2d ago", "SAR 1,780.00"],
] as const;

function ProductStatCard({ stat }: { stat: readonly [string, string, string, typeof Building2, string] }) {
  const [label, value, note, Icon, color] = stat;
  return (
    <div className="rounded-lg border border-slate-100 bg-white p-2 shadow-[0_1px_2px_rgba(15,23,42,.04)]">
      <div className="flex items-center justify-between">
        <p className="text-[6px] font-medium text-slate-400">{label}</p>
        <Icon className={`size-2.5 ${color}`} />
      </div>
      <p className="mt-1 text-[11px] font-bold leading-none text-slate-900">{value}</p>
      <p className="mt-1 text-[5px] leading-tight text-slate-400">{note}</p>
    </div>
  );
}

function DashboardView() {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-bold text-slate-900">Good evening, David!</p>
          <p className="mt-0.5 text-[6px] text-slate-400">Here&apos;s what&apos;s happening with your property portfolio</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[6px] font-medium text-slate-500"><RefreshCw className="size-2" /> Refresh</span>
          <span className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-[6px] font-semibold text-white"><BarChart3 className="size-2" /> Reports</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {productAlerts.map((alert) => {
          const Icon = alert.icon;
          return (
            <div key={alert.label} className={`flex items-start gap-1.5 rounded-lg border p-1.5 ${alert.tone}`}>
              <Icon className="mt-0.5 size-2.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[7px] font-semibold">{alert.label}</p>
                <p className="truncate text-[5px] opacity-80">{alert.note}</p>
              </div>
              <span className={`grid size-3 shrink-0 place-items-center rounded-full text-[5px] font-bold text-white ${alert.dot}`}>{alert.badge}</span>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {productStatsTop.map((stat) => <ProductStatCard key={stat[0]} stat={stat} />)}
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {productStatsBottom.map((stat) => <ProductStatCard key={stat[0]} stat={stat} />)}
      </div>

      <div className="grid grid-cols-[1.5fr_1fr] gap-2">
        <div className="rounded-lg border border-slate-100 p-2.5">
          <div className="mb-1 flex items-start justify-between">
            <div>
              <p className="text-[8px] font-semibold text-slate-800">Revenue &amp; Expenses</p>
              <p className="text-[5px] text-slate-400">Daily financial performance (last 30 days)</p>
            </div>
            <div className="flex gap-0.5 rounded-md bg-slate-100 p-0.5 text-[5px] font-medium text-slate-400">
              {["7 Days", "30 Days", "12 Months", "Last Year"].map((tab, index) => (
                <span key={tab} className={`rounded px-1 py-0.5 ${index === 1 ? "bg-white font-semibold text-slate-700 shadow-sm" : ""}`}>{tab}</span>
              ))}
            </div>
          </div>
          <div className="mb-1 flex gap-3 text-[5px] font-medium">
            <span className="inline-flex items-center gap-1 text-slate-500"><span className="size-1.5 rounded-full bg-emerald-500" /> Total Revenue <b className="text-slate-700">SAR 7,700.00</b></span>
            <span className="inline-flex items-center gap-1 text-slate-500"><span className="size-1.5 rounded-full bg-rose-400" /> Total Expenses <b className="text-slate-700">SAR 813.00</b></span>
          </div>
          <svg viewBox="0 0 400 110" className="h-20 w-full" aria-label="Revenue and expenses chart">
            <defs>
              <linearGradient id="product-rev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#10b981" stopOpacity=".28" />
                <stop offset="1" stopColor="#10b981" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[20, 50, 80].map((y) => <line key={y} x1="0" x2="400" y1={y} y2={y} stroke="#eef2f6" />)}
            <path d="M0 95 C40 92 60 60 95 64 S150 90 190 86 S250 30 300 40 S360 18 400 24 L400 110 L0 110Z" fill="url(#product-rev)" />
            <path d="M0 95 C40 92 60 60 95 64 S150 90 190 86 S250 30 300 40 S360 18 400 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M0 100 C60 99 120 97 190 98 S320 95 400 96" fill="none" stroke="#fb7185" strokeWidth="1.5" strokeDasharray="3 3" />
          </svg>
          <div className="mt-1 flex justify-between text-[4px] text-slate-300">
            {["Mar 24", "Mar 29", "Apr 3", "Apr 8", "Apr 13", "Apr 18", "Apr 22"].map((d) => <span key={d}>{d}</span>)}
          </div>
        </div>

        <div className="rounded-lg border border-slate-100 p-2.5">
          <p className="text-[8px] font-semibold text-slate-800">Recent Activity</p>
          <p className="mb-1.5 text-[5px] text-slate-400">Latest updates across your portfolio</p>
          <div className="space-y-1.5">
            {productActivity.map(([name, action, time, amount], index) => (
              <div key={`${name}-${index}`} className="flex items-center gap-1.5">
                <span className="grid size-4 shrink-0 place-items-center rounded-full bg-emerald-100 text-[5px] font-bold text-emerald-600">{name.charAt(0)}</span>
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-[5.5px] text-slate-600"><b className="text-slate-800">{name}</b> {action}</p>
                  <p className="text-[4.5px] text-slate-400">{time}</p>
                </div>
                <span className="text-[5.5px] font-bold text-emerald-600">{amount}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-slate-100 p-2.5">
          <p className="mb-1.5 text-[8px] font-semibold text-slate-800">Financial Summary</p>
          {[["Collected", "SAR 7,700.00", "text-emerald-600"], ["Outstanding", "SAR 4,120.00", "text-amber-600"], ["Expenses", "SAR 813.00", "text-rose-500"]].map(([label, value, color]) => (
            <div key={label} className="flex items-center justify-between py-0.5 text-[6px]">
              <span className="text-slate-400">{label}</span>
              <span className={`font-bold ${color}`}>{value}</span>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-slate-100 p-2.5">
          <p className="text-[8px] font-semibold text-slate-800">Upcoming Tasks</p>
          <p className="mb-1.5 text-[5px] text-slate-400">Important tasks requiring attention</p>
          {[["Inspect Cedar Ridge Villas", "Tomorrow"], ["Renew lease — Unit 14B", "In 3 days"], ["Follow up overdue rent", "This week"]].map(([task, when]) => (
            <div key={task} className="flex items-center gap-1.5 py-0.5">
              <span className="size-1.5 rounded-full bg-blue-500" />
              <span className="flex-1 truncate text-[5.5px] text-slate-600">{task}</span>
              <span className="text-[5px] text-slate-400">{when}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Properties                                                          */
/* ------------------------------------------------------------------ */

const properties = [
  ["Maple Court Townhomes", "123 Maple Ave, Austin", "12 units", "92%", "SAR 2,200", "from-blue-400 to-violet-500", "bg-emerald-50 text-emerald-600"],
  ["Harbor Bay Apartments", "88 Marina Blvd, Seattle", "24 units", "75%", "SAR 1,950", "from-cyan-400 to-blue-500", "bg-emerald-50 text-emerald-600"],
  ["Cedar Ridge Villas", "45 Cedar Ln, Denver", "8 units", "100%", "SAR 1,780", "from-amber-400 to-rose-500", "bg-emerald-50 text-emerald-600"],
  ["Sunset Heights", "210 Sunset Dr, Phoenix", "16 units", "44%", "SAR 1,640", "from-orange-400 to-pink-500", "bg-amber-50 text-amber-600"],
  ["Willow Park Homes", "9 Willow Way, Portland", "6 units", "67%", "SAR 2,050", "from-emerald-400 to-teal-500", "bg-amber-50 text-amber-600"],
  ["Lakeview Residences", "320 Lake Rd, Chicago", "18 units", "0%", "SAR 2,380", "from-violet-400 to-fuchsia-500", "bg-rose-50 text-rose-600"],
] as const;

function PropertiesView() {
  return (
    <div className="space-y-2.5">
      <MainHeader title="Properties" subtitle="Manage your property portfolio" action="Add Property" />
      <div className="grid grid-cols-3 gap-2">
        {properties.map(([name, address, units, occ, rent, grad, badge]) => (
          <div key={name} className="overflow-hidden rounded-lg border border-slate-100 bg-white shadow-[0_1px_2px_rgba(15,23,42,.04)]">
            <div className={`h-10 bg-linear-to-br ${grad}`} />
            <div className="space-y-1 p-2">
              <div className="flex items-start justify-between gap-1">
                <p className="truncate text-[7px] font-bold text-slate-800">{name}</p>
                <StatusPill label={`${occ} full`} tone={badge} />
              </div>
              <p className="flex items-center gap-0.5 truncate text-[5px] text-slate-400"><MapPin className="size-2" /> {address}</p>
              <div className="flex items-center justify-between border-t border-slate-100 pt-1 text-[5.5px]">
                <span className="text-slate-400">{units}</span>
                <span className="font-bold text-slate-700">{rent}<span className="font-normal text-slate-400">/mo</span></span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tenants                                                             */
/* ------------------------------------------------------------------ */

const tenants = [
  ["Sofia Martinez", "Maple Court Townhomes · 4B", "Dec 2026", "Active", "SAR 0.00", "bg-emerald-50 text-emerald-600", "bg-violet-500"],
  ["Emma Reed", "Harbor Bay Apartments · 12A", "Mar 2027", "Active", "SAR 0.00", "bg-emerald-50 text-emerald-600", "bg-blue-500"],
  ["Liam Chen", "Cedar Ridge Villas · 2", "Aug 2026", "Active", "SAR 1,780.00", "bg-amber-50 text-amber-600", "bg-cyan-500"],
  ["Noah Patel", "Sunset Heights · 7C", "Jul 2026", "Expiring", "SAR 0.00", "bg-amber-50 text-amber-600", "bg-orange-500"],
  ["Ava Johnson", "Willow Park Homes · 1", "—", "Pending", "SAR 2,050.00", "bg-blue-50 text-blue-600", "bg-fuchsia-500"],
] as const;

function TenantsView() {
  return (
    <div className="space-y-2.5">
      <MainHeader title="Tenants" subtitle="4 active · 1 pending application" action="Add Tenant" />
      <div className="overflow-hidden rounded-lg border border-slate-100">
        <div className="grid grid-cols-[1.4fr_1.6fr_.8fr_.8fr_.8fr] gap-1 bg-slate-50 px-2 py-1 text-[5px] font-semibold uppercase tracking-wide text-slate-400">
          <span>Tenant</span><span>Property / Unit</span><span>Lease ends</span><span>Status</span><span className="text-right">Balance</span>
        </div>
        {tenants.map(([name, unit, ends, status, balance, badge, avatar]) => (
          <div key={name} className="grid grid-cols-[1.4fr_1.6fr_.8fr_.8fr_.8fr] items-center gap-1 border-t border-slate-100 px-2 py-1.5 text-[6px]">
            <span className="flex items-center gap-1">
              <span className={`grid size-3.5 shrink-0 place-items-center rounded-full text-[5px] font-bold text-white ${avatar}`}>{name.charAt(0)}</span>
              <span className="truncate font-semibold text-slate-700">{name}</span>
            </span>
            <span className="truncate text-slate-500">{unit}</span>
            <span className="text-slate-500">{ends}</span>
            <span><StatusPill label={status} tone={badge} /></span>
            <span className={`text-right font-bold ${balance === "SAR 0.00" ? "text-slate-400" : "text-rose-500"}`}>{balance}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Leases                                                              */
/* ------------------------------------------------------------------ */

const leases = [
  ["Sofia Martinez", "Maple Court Townhomes · 4B", "SAR 2,200/mo", "Active", 64, "bg-emerald-500", "bg-emerald-50 text-emerald-600"],
  ["Emma Reed", "Harbor Bay Apartments · 12A", "SAR 1,950/mo", "Active", 41, "bg-emerald-500", "bg-emerald-50 text-emerald-600"],
  ["Noah Patel", "Sunset Heights · 7C", "SAR 1,640/mo", "Expiring", 92, "bg-amber-500", "bg-amber-50 text-amber-600"],
  ["Liam Chen", "Cedar Ridge Villas · 2", "SAR 1,780/mo", "Active", 78, "bg-emerald-500", "bg-emerald-50 text-emerald-600"],
] as const;

function LeasesView() {
  return (
    <div className="space-y-2.5">
      <MainHeader title="Leases" subtitle="Track terms, renewals and signatures" action="New Lease" />
      <div className="grid grid-cols-2 gap-2">
        {leases.map(([name, unit, rent, status, pct, bar, badge]) => (
          <div key={name + unit} className="space-y-1.5 rounded-lg border border-slate-100 bg-white p-2.5 shadow-[0_1px_2px_rgba(15,23,42,.04)]">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <p className="truncate text-[7px] font-bold text-slate-800">{name}</p>
                <p className="truncate text-[5px] text-slate-400">{unit}</p>
              </div>
              <StatusPill label={status} tone={badge} />
            </div>
            <div className="flex items-center justify-between text-[5.5px]">
              <span className="font-bold text-slate-700">{rent}</span>
              <span className="text-slate-400">{pct as number}% of term</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Maintenance                                                         */
/* ------------------------------------------------------------------ */

const maintenance = [
  {
    title: "Open",
    accent: "bg-rose-500",
    cards: [
      ["Leaking faucet", "Maple Court · 4B", "High", "text-rose-600 bg-rose-50"],
      ["AC not cooling", "Sunset Heights · 7C", "Urgent", "text-rose-600 bg-rose-50"],
    ],
  },
  {
    title: "In Progress",
    accent: "bg-amber-500",
    cards: [
      ["Repaint hallway", "Harbor Bay", "Medium", "text-amber-600 bg-amber-50"],
      ["Fix garage door", "Cedar Ridge · 2", "Low", "text-slate-500 bg-slate-100"],
    ],
  },
  {
    title: "Resolved",
    accent: "bg-emerald-500",
    cards: [
      ["Replace smoke alarm", "Willow Park · 1", "Done", "text-emerald-600 bg-emerald-50"],
      ["Unclog drain", "Lakeview · 9", "Done", "text-emerald-600 bg-emerald-50"],
    ],
  },
] as const;

function MaintenanceView() {
  return (
    <div className="space-y-2.5">
      <MainHeader title="Maintenance" subtitle="2 open · 1 urgent requiring attention" action="New Request" />
      <div className="grid grid-cols-3 gap-2">
        {maintenance.map((col) => (
          <div key={col.title} className="space-y-1.5 rounded-lg bg-slate-50/70 p-1.5">
            <div className="flex items-center gap-1 px-0.5">
              <span className={`size-1.5 rounded-full ${col.accent}`} />
              <p className="text-[6px] font-semibold text-slate-600">{col.title}</p>
              <span className="ml-auto text-[5px] text-slate-400">{col.cards.length}</span>
            </div>
            {col.cards.map(([title, where, priority, tone]) => (
              <div key={title} className="space-y-1 rounded-md border border-slate-100 bg-white p-1.5 shadow-[0_1px_2px_rgba(15,23,42,.04)]">
                <p className="text-[6.5px] font-semibold text-slate-700">{title}</p>
                <p className="text-[5px] text-slate-400">{where}</p>
                <span className={`inline-block rounded px-1 py-0.5 text-[4.5px] font-bold ${tone}`}>{priority}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Transactions                                                        */
/* ------------------------------------------------------------------ */

const txStats = [
  ["Income", "SAR 7,700.00", "text-emerald-600", TrendingUp],
  ["Expenses", "SAR 813.00", "text-rose-500", CircleDollarSign],
  ["Net", "SAR 6,887.00", "text-slate-900", WalletCards],
] as const;

const transactions = [
  ["Apr 22", "Rent payment", "Maple Court · 4B", "Income", "+SAR 2,200.00"],
  ["Apr 20", "Plumbing repair", "Sunset Heights", "Expense", "-SAR 320.00"],
  ["Apr 18", "Rent payment", "Harbor Bay · 12A", "Income", "+SAR 1,950.00"],
  ["Apr 15", "Landscaping", "Cedar Ridge", "Expense", "-SAR 180.00"],
  ["Apr 12", "Rent payment", "Cedar Ridge · 2", "Income", "+SAR 1,780.00"],
] as const;

function TransactionsView() {
  return (
    <div className="space-y-2.5">
      <MainHeader title="Transactions" subtitle="Income and expenses across your portfolio" action="Record" />
      <div className="grid grid-cols-3 gap-1.5">
        {txStats.map(([label, value, color, Icon]) => (
          <div key={label} className="rounded-lg border border-slate-100 bg-white p-2 shadow-[0_1px_2px_rgba(15,23,42,.04)]">
            <div className="flex items-center justify-between">
              <p className="text-[6px] font-medium text-slate-400">{label}</p>
              <Icon className={`size-2.5 ${color}`} />
            </div>
            <p className={`mt-1 text-[11px] font-bold leading-none ${color}`}>{value}</p>
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-100">
        <div className="grid grid-cols-[.7fr_1.4fr_1.3fr_.8fr_.9fr] gap-1 bg-slate-50 px-2 py-1 text-[5px] font-semibold uppercase tracking-wide text-slate-400">
          <span>Date</span><span>Description</span><span>Property</span><span>Type</span><span className="text-right">Amount</span>
        </div>
        {transactions.map(([date, desc, property, type, amount]) => (
          <div key={date + desc} className="grid grid-cols-[.7fr_1.4fr_1.3fr_.8fr_.9fr] items-center gap-1 border-t border-slate-100 px-2 py-1.5 text-[6px]">
            <span className="text-slate-400">{date}</span>
            <span className="truncate font-semibold text-slate-700">{desc}</span>
            <span className="truncate text-slate-500">{property}</span>
            <span>
              <StatusPill label={type} tone={type === "Income" ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"} />
            </span>
            <span className={`text-right font-bold ${amount.startsWith("+") ? "text-emerald-600" : "text-rose-500"}`}>{amount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

const conversations = [
  ["Sofia Martinez", "Thanks, I just sent the rent!", "2m", "bg-violet-500", true],
  ["Emma Reed", "Can someone look at the AC?", "1h", "bg-blue-500", false],
  ["Liam Chen", "Lease renewal looks good 👍", "3h", "bg-cyan-500", false],
  ["Noah Patel", "When is the inspection?", "1d", "bg-orange-500", false],
] as const;

const thread = [
  ["in", "Hi! I wanted to confirm my rent went through for April."],
  ["out", "Hi Sofia — yes, we received SAR 2,200.00. You're all set! 🎉"],
  ["in", "Perfect, thank you so much!"],
  ["out", "Anytime. Let us know if you need anything else."],
] as const;

function ChatView() {
  return (
    <div className="grid h-full grid-cols-[1fr_1.7fr] overflow-hidden rounded-lg border border-slate-100">
      <aside className="space-y-0.5 border-r border-slate-100 bg-slate-50/60 p-1.5">
        <div className="flex items-center justify-between px-1 pb-1">
          <p className="text-[7px] font-bold text-slate-700">Messages</p>
          <span className="rounded-full bg-blue-100 px-1 text-[5px] font-bold text-blue-600">3</span>
        </div>
        {conversations.map(([name, preview, time, avatar, active]) => (
          <div key={name} className={`flex items-center gap-1.5 rounded-md p-1 ${active ? "bg-white shadow-sm" : ""}`}>
            <span className={`grid size-4 shrink-0 place-items-center rounded-full text-[5px] font-bold text-white ${avatar}`}>{name.charAt(0)}</span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[6px] font-semibold text-slate-700">{name}</p>
              <p className="truncate text-[5px] text-slate-400">{preview}</p>
            </div>
            <span className="text-[4.5px] text-slate-300">{time}</span>
          </div>
        ))}
      </aside>

      <section className="flex flex-col bg-white">
        <div className="flex items-center gap-1.5 border-b border-slate-100 px-2 py-1.5">
          <span className="grid size-4 place-items-center rounded-full bg-violet-500 text-[5px] font-bold text-white">S</span>
          <div className="leading-tight">
            <p className="text-[6.5px] font-semibold text-slate-700">Sofia Martinez</p>
            <p className="text-[4.5px] text-emerald-500">● Online</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5 text-slate-300">
            <Phone className="size-2.5" />
            <Video className="size-2.5" />
            <MoreHorizontal className="size-2.5" />
          </div>
        </div>
        <div className="flex-1 space-y-1.5 p-2">
          {thread.map(([dir, text], i) => (
            <div key={i} className={`flex ${dir === "out" ? "justify-end" : "justify-start"}`}>
              <p className={`max-w-[78%] rounded-lg px-1.5 py-1 text-[6px] leading-snug ${dir === "out" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>{text}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5 border-t border-slate-100 px-2 py-1.5">
          <Paperclip className="size-2.5 text-slate-300" />
          <div className="flex-1 rounded-full bg-slate-100 px-2 py-1 text-[5.5px] text-slate-400">Type a message…</div>
          <span className="grid size-4 place-items-center rounded-full bg-blue-600 text-white"><Send className="size-2" /></span>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App frame (shared chrome) + view switch                            */
/* ------------------------------------------------------------------ */

// Fixed, positional preview slots. ProductContent.tabs overrides the label and
// (optionally) supplies a screenshot per slot; the built-in mockup is the
// fallback. Order here must match the default tabs in landing-types.
/* ------------------------------------------------------------------ */
/* Finances                                                            */
/* ------------------------------------------------------------------ */

const financeTotals = [
  ["Collected", "SAR 92,480.00", "text-emerald-600", TrendingUp],
  ["Outstanding", "SAR 4,120.00", "text-amber-600", Clock],
  ["Expenses", "SAR 18,240.00", "text-rose-500", CircleDollarSign],
  ["Net income", "SAR 70,120.00", "text-slate-900", WalletCards],
] as const;

const financeBreakdown = [
  ["Rent", "78%", "bg-blue-500"],
  ["Fees", "12%", "bg-violet-500"],
  ["Deposits", "7%", "bg-emerald-500"],
  ["Other", "3%", "bg-amber-500"],
] as const;

function FinancesView() {
  return (
    <div className="space-y-2.5">
      <MainHeader title="Finances" subtitle="Revenue, expenses and payout health" action="Export" />
      <div className="grid grid-cols-4 gap-1.5">
        {financeTotals.map(([label, value, color, Icon]) => (
          <div key={label} className="rounded-lg border border-slate-100 bg-white p-2 shadow-[0_1px_2px_rgba(15,23,42,.04)]">
            <div className="flex items-center justify-between">
              <p className="text-[6px] font-medium text-slate-400">{label}</p>
              <Icon className={`size-2.5 ${color}`} />
            </div>
            <p className={`mt-1 text-[11px] font-bold leading-none ${color}`}>{value}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[1.6fr_1fr] gap-1.5">
        <div className="rounded-lg border border-slate-100 p-2">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[7px] font-semibold text-slate-700">Collected vs billed</p>
            <span className="text-[5px] text-slate-400">Last 6 months</span>
          </div>
          <div className="flex h-16 items-end gap-1.5">
            {[62, 74, 58, 88, 70, 94].map((height, index) => (
              <div key={index} className="flex flex-1 items-end gap-0.5">
                <span className="flex-1 rounded-t bg-blue-500" style={{ height: `${height}%` }} />
                <span className="flex-1 rounded-t bg-blue-100" style={{ height: `${Math.max(height - 12, 8)}%` }} />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-slate-100 p-2">
          <p className="mb-2 text-[7px] font-semibold text-slate-700">Income mix</p>
          <div className="space-y-1.5">
            {financeBreakdown.map(([label, share, tone]) => (
              <div key={label} className="flex items-center gap-1.5 text-[6px]">
                <span className={`size-1.5 rounded-full ${tone}`} />
                <span className="flex-1 text-slate-500">{label}</span>
                <span className="font-bold text-slate-700">{share}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

type ProductSlot = {
  label: string;
  icon: typeof LayoutDashboard;
  nav: string;
  View: () => React.ReactElement;
  /** Built-in screenshot exported from the design; beats the mockup, loses to
   *  a console upload for the same slot. */
  image?: string;
};

// Eight tabs, matching the strip in the design (4:3247..4:3254).
const PRODUCT_SLOTS: ProductSlot[] = [
  { label: "Dashboard", icon: LayoutDashboard, nav: "Dashboard", View: DashboardView, image: "/images/marketing/product/dashboard.png" },
  { label: "Properties", icon: Building2, nav: "Properties", View: PropertiesView },
  { label: "Tenants", icon: Users, nav: "Tenants", View: TenantsView },
  { label: "Leases", icon: FileText, nav: "Leases", View: LeasesView },
  { label: "Maintenance", icon: Wrench, nav: "Maintenance", View: MaintenanceView },
  { label: "Transactions", icon: ReceiptText, nav: "Transactions", View: TransactionsView },
  { label: "Finances", icon: PieChart, nav: "Revenues", View: FinancesView },
  { label: "Chat", icon: MessageSquare, nav: "Inbox", View: ChatView },
];

function ProductMockup({
  View,
  activeNav,
}: {
  View: () => React.ReactElement;
  activeNav: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-[0_24px_60px_-30px_rgba(0,0,0,.5)]">
      <div className="flex h-9 items-center border-b border-slate-100 px-3">
        <Brand />
        <div className="ml-auto flex items-center gap-2.5 text-slate-300">
          <Search className="size-3" />
          <Bell className="size-3" />
          <span className="size-5 rounded-full bg-blue-100" />
        </div>
      </div>
      <div className="grid grid-cols-[132px_1fr]">
        <aside className="flex flex-col gap-2 border-r border-slate-100 bg-slate-50/70 p-2.5">
          <div className="flex-1 space-y-2">
            {productNav.map((group, groupIndex) => (
              <div key={group.section ?? `group-${groupIndex}`} className="space-y-0.5">
                {group.section && (
                  <p className="px-1.5 pb-0.5 pt-1 text-[5px] font-semibold uppercase tracking-[.12em] text-slate-300">{group.section}</p>
                )}
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = item.label === activeNav;
                  return (
                    <div
                      key={item.label}
                      className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[7px] transition-colors ${active ? "bg-blue-600 font-semibold text-white" : "text-slate-500"}`}
                    >
                      <Icon className="size-2.5" />
                      <span className="truncate">{item.label}</span>
                      {"badge" in item && item.badge && (
                        <span className={`ml-auto rounded-full px-1 text-[5px] font-bold ${active ? "bg-white/25 text-white" : "bg-blue-100 text-blue-600"}`}>{item.badge}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1.5 border-t border-slate-100 pt-2">
            <span className="size-5 rounded-full bg-linear-to-br from-blue-500 to-violet-500" />
            <div className="leading-tight">
              <p className="text-[6px] font-semibold text-slate-700">David Norman</p>
              <p className="text-[5px] text-slate-400">Admin</p>
            </div>
          </div>
        </aside>

        <main className="bg-white p-3">
          <View />
        </main>
      </div>
    </div>
  );
}

// Source of truth: Figma "PropertyPro" → "Desktop - 1", the product band at
// y 656–1418 of the 1440px artboard.
//
//   plate      4:3057   1278.709 x 644.246, r29, mesh-gradient fill
//   heading    4:3064   43px bold white, leading .86, tracking -1.29
//   tab strip  4:3245   944.811 x 38.17 on #ebebeb, r10; active pill r7 white
//   preview    4:3243   929.27 x 520.957, 9px rgba(255,255,255,.37), r14
//
// The preview deliberately runs 117px past the bottom of the plate, so the
// plate is an absolutely-positioned backdrop and the content sits in flow above
// it. From `lg` up the panel is a container and its type is sized in `cqw`, so
// the whole composition scales as one; below that it falls back to a plain
// stack with the strip scrolling horizontally.
export function ProductSection({
  content,
  screenshotAlt = "{label} screenshot",
}: {
  content: ProductContent;
  /** Alt text for an uploaded tab screenshot; `{label}` is the tab's name. */
  screenshotAlt?: string;
}) {
  const [active, setActive] = useState(0);

  // Zip the editable tabs (label + optional screenshot) onto the fixed slots so
  // a slot always has an icon, a sidebar target, and a built-in fallback.
  //
  // Overrides are positional, so a stored array from before a slot was added or
  // removed would shift every label by one. Only trust it when the lengths
  // agree; otherwise fall back to the built-ins until the console re-saves.
  const aligned = content.tabs?.length === PRODUCT_SLOTS.length;
  const tabs = PRODUCT_SLOTS.map((slot, index) => {
    const override = aligned ? content.tabs?.[index] : undefined;
    return {
      label: override?.label?.trim() || slot.label,
      image: override?.image?.trim() || slot.image || "",
      icon: slot.icon,
      nav: slot.nav,
      View: slot.View,
    };
  });
  const current = tabs[active] ?? tabs[0];

  return (
    <section id="product" className="px-5 sm:px-8">
      <div className="@container relative mx-auto max-w-[1278.709px]">
        {/* 4:3057 — the plate the copy and preview sit on. */}
        <div className="absolute inset-x-0 top-0 aspect-1278709/644246 overflow-hidden rounded-2xl lg:rounded-[2.268cqw]">
          {content.panelImage && (
            <Image
              src={content.panelImage}
              alt=""
              fill
              sizes="(max-width: 1024px) 100vw, 1279px"
              className="object-cover"
            />
          )}
        </div>

        <div className="relative flex flex-col items-center px-4 pt-10 pb-8 lg:px-0 lg:pt-[4.101%] lg:pb-0">
          {/* Arabic letterforms stand taller than the design's Latin, so the
              tight 0.86 leading is opened up for them alone. */}
          <h2 className="max-w-[26ch] text-center text-2xl font-bold leading-[0.86] tracking-[-0.72px] text-white sm:text-4xl lg:max-w-[59.37%] lg:text-[3.363cqw] lg:tracking-[-0.101cqw] [&:lang(ar)]:leading-[1.15]">
            {content.headingLine1}
            <br />
            {content.headingLine2}
          </h2>

          {/* 4:3245 — one row, scrolling on small screens where 8 tabs cannot fit. */}
          <div className="mt-8 w-full overflow-x-auto lg:mt-[4.136%] lg:w-[73.89%] lg:overflow-visible">
            <div className="mx-auto flex w-max items-center gap-1 rounded-[10px] bg-[#ebebeb] p-[3px] lg:w-full lg:justify-between lg:gap-0 lg:rounded-[0.782cqw] lg:p-[0.244%]">
              {tabs.map((item, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setActive(index)}
                  className={`cursor-pointer whitespace-nowrap rounded-[7px] px-4 py-1.5 text-[13px] font-semibold tracking-[0.26px] transition-colors lg:rounded-[0.547cqw] lg:px-[1.877%] lg:py-[0.55%] lg:text-[1.095cqw] lg:tracking-[0.022cqw] ${
                    active === index
                      ? "bg-white text-[#262626]"
                      : "text-[#5d5d5d] hover:text-[#262626]"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* 4:3243 — the preview window; its lower edge clears the plate. */}
          <div className="relative mt-6 aspect-92927/52096 w-full overflow-hidden rounded-[10px] border-4 border-white/40 shadow-[0_29px_80.3px_rgba(0,0,0,0.25)] lg:mt-[1.782%] lg:w-[72.67%] lg:rounded-[1.095cqw] lg:border-[0.704cqw]">
            {current.image ? (
              <Image
                src={current.image}
                alt={screenshotAlt.replace("{label}", current.label)}
                fill
                sizes="(max-width: 1024px) 100vw, 930px"
                className="object-cover object-top"
              />
            ) : (
              // The mockup is a drawing of the English product, laid out left
              // to right; the Arabic page shows it as it is.
              <div className="size-full overflow-y-auto bg-white" dir="ltr" lang="en">
                <ProductMockup View={current.View} activeNav={current.nav} />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
