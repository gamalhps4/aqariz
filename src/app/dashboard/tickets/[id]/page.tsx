"use client";

import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { TicketStatus, UserRole } from "@/types";
import { useState, useEffect, use } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { refreshTicketCounts } from "@/lib/sidebar-utils";
import { useAuthorization } from "@/hooks/useAuthorization";
import { TicketDetail } from "@/components/tickets/ticket-detail";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

export default function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session } = useSession();
  const { isTenant } = useAuthorization();
  const { t } = useLocalizationContext();
  const userRole = session?.user?.role ?? UserRole.TENANT;
  const [ticket, setTicket] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      fetchTicket();
    }
  }, [id]);

  const fetchTicket = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/tickets/${id}`);
      const data = await res.json();
      if (res.ok && data?.success) {
        setTicket(data?.data ?? null);
      } else {
        toast.error(data?.error || t("tickets.detail.toasts.ticketNotFound"));
        router.push(
          isTenant ? "/dashboard/tickets/my-tickets" : "/dashboard/tickets",
        );
      }
    } catch (error) {
      toast.error(t("tickets.detail.toasts.loadError"));
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (newStatus: TicketStatus) => {
    try {
      const res = await fetch(`/api/tickets/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      const data = await res.json();
      if (res.ok) {
        const statusLabel = t(
          `tickets.status.${
            newStatus === TicketStatus.IN_PROGRESS
              ? "inProgress"
              : newStatus.toLowerCase()
          }`,
        );
        setTicket((prev: any) => ({
          ...prev,
          status: newStatus,
          ...(newStatus === TicketStatus.RESOLVED
            ? { resolvedAt: new Date().toISOString() }
            : {}),
          ...(newStatus === TicketStatus.CLOSED
            ? { closedAt: new Date().toISOString() }
            : {}),
        }));
        toast.success(
          t("tickets.detail.toasts.statusUpdated", {
            values: { status: statusLabel },
          }),
        );
        refreshTicketCounts();
      } else {
        throw new Error(
          data?.error || t("tickets.detail.toasts.statusUpdateError"),
        );
      }
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : t("tickets.detail.toasts.statusUpdateError");
      toast.error(msg);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!ticket) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("tickets.detail.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {ticket.ticketNumber} - {ticket.title}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="hover:bg-blue-50 hover:text-blue-600 border transition-colors"
          onClick={() =>
            router.push(
              isTenant ? "/dashboard/tickets/my-tickets" : "/dashboard/tickets",
            )
          }
        >
          <ArrowLeft className="h-4 w-4 me-2 rtl:-scale-x-100" />
          {t("tickets.new.back")}
        </Button>
      </div>

      <TicketDetail
        ticket={ticket}
        userRole={userRole}
        onStatusChange={handleStatusChange}
        onCommentAdded={() => {
          refreshTicketCounts();
        }}
      />
    </div>
  );
}
