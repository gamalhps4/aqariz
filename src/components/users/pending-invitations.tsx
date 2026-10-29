"use client";

/**
 * PropertyPro - Staff invitations panel
 *
 * Replaces the old "create the user and tell them their password" flow. An
 * invitation creates no account: it is a pending row until the invitee sets
 * their own password, which is why this list exists at all — without it,
 * an admin has no way to see who was invited, chase them, or take it back.
 *
 * The card hides itself when there is nothing pending, so a tidy account
 * doesn't carry an empty panel around forever.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Mail, RefreshCw, Send, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { UserRole } from "@/types";
import { useGroupNames } from "@/hooks/useGroupNames";

interface Invitation {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  /** The group's names beside its stored key; null for a built-in role. */
  roleLabel?: string | null;
  roleLabelAr?: string | null;
  invitedBy: string;
  invitedAt: string;
  expiresAt: string;
  expired: boolean;
}

interface RoleOption {
  name: string;
  label: string;
  labelAr?: string | null;
  isSystem: boolean;
}

const EMPTY_FORM = {
  email: "",
  firstName: "",
  lastName: "",
  role: UserRole.MANAGER as string,
  phone: "",
};

export function PendingInvitations({ canManage }: { canManage: boolean }) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { t, formatDate } = useLocalizationContext();
  const { roleName } = useGroupNames();

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/users/invitations").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/roles?includeSystem=true&limit=100").then((r) =>
        r.ok ? r.json() : null,
      ),
    ])
      .then(([invitationPayload, rolePayload]) => {
        if (!active) return;
        if (Array.isArray(invitationPayload?.data)) {
          setInvitations(invitationPayload.data);
        }
        const roleRows = rolePayload?.data?.roles;
        if (Array.isArray(roleRows)) {
          setRoles(
            roleRows
              // Tenants are created through the tenant flow, which collects
              // lease and contact details this form does not.
              .filter((role: any) => role.name !== UserRole.TENANT)
              .map((role: any) => ({
                name: role.name,
                label: role.label || role.name,
                labelAr: role.labelAr ?? null,
                isSystem: Boolean(role.isSystem),
              })),
          );
        }
      })
      .catch(() => {
        if (active)
          toast.error(
            t("admin.invites.loadFailed", { defaultValue: "Could not load the invitations" }),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload]);

  const refresh = useCallback(() => {
    setLoading(true);
    setReload((n) => n + 1);
  }, []);

  async function submitInvite() {
    setSubmitting(true);
    try {
      const response = await fetch("/api/users/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || t("admin.invites.inviteFailed", { defaultValue: "Could not send the invitation" }));
      toast.success(
        t("admin.invites.sent", { defaultValue: "Invitation sent to {email}", values: { email: form.email } }),
      );
      setForm(EMPTY_FORM);
      setDialogOpen(false);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("admin.invites.inviteFailed", { defaultValue: "Could not send the invitation" }));
    } finally {
      setSubmitting(false);
    }
  }

  async function act(invitation: Invitation, action: "resend" | "revoke") {
    setBusyId(invitation.id);
    try {
      const response = await fetch(
        `/api/users/invitations/${invitation.id}`,
        { method: action === "resend" ? "POST" : "DELETE" },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || t("admin.invites.actionFailed", { defaultValue: "That did not work" }));
      toast.success(
        action === "resend"
          ? t("admin.invites.resent", { defaultValue: "Invitation sent again" })
          : t("admin.invites.revoked", { defaultValue: "Invitation withdrawn" }),
      );
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("admin.invites.actionFailed", { defaultValue: "That did not work" }));
    } finally {
      setBusyId(null);
    }
  }

  if (!canManage) return null;

  const inviteButton = (
    <Button size="sm" onClick={() => setDialogOpen(true)}>
      <UserPlus className="me-2 h-4 w-4" />
      {t("admin.invites.inviteButton", { defaultValue: "Invite an employee" })}
    </Button>
  );

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">
              {t("admin.invites.title", { defaultValue: "Pending invitations" })}
            </CardTitle>
            <CardDescription>
              {t("admin.invites.subtitle", { defaultValue: "Invited people appear here until they set a password; their account exists only once they do." })}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={loading}
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
              <span className="sr-only">
                {t("admin.invites.refresh", { defaultValue: "Refresh" })}
              </span>
            </Button>
            {inviteButton}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-4 text-sm text-muted-foreground">
              {t("admin.invites.loading", { defaultValue: "Loading…" })}
            </p>
          ) : invitations.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              {t("admin.invites.empty", { defaultValue: "No one is waiting on an invitation." })}
            </p>
          ) : (
            <ul className="divide-y">
              {invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex flex-wrap items-center gap-3 py-3"
                >
                  <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-48 flex-1">
                    <p className="text-sm font-medium">
                      {[invitation.firstName, invitation.lastName]
                        .filter(Boolean)
                        .join(" ") || invitation.email}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {invitation.email} ·{" "}
                      {t("admin.invites.invitedBy", { defaultValue: "invited by {name}", values: { name: invitation.invitedBy } })}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {roleName(
                      invitation.role,
                      invitation.roleLabel
                        ? {
                            label: invitation.roleLabel,
                            labelAr: invitation.roleLabelAr,
                          }
                        : null,
                    )}
                  </Badge>
                  {invitation.expired ? (
                    <Badge variant="destructive">
                      {t("admin.invites.expired", { defaultValue: "Expired" })}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {t("admin.invites.expires", { defaultValue: "Expires {date}", values: { date: formatDate(invitation.expiresAt) } })}
                    </span>
                  )}
                  <div className="ms-auto flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyId === invitation.id}
                      onClick={() => act(invitation, "resend")}
                    >
                      <Send className="me-1.5 h-3.5 w-3.5" />
                      {t("admin.invites.resend", { defaultValue: "Resend" })}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={busyId === invitation.id}
                      onClick={() => act(invitation, "revoke")}
                    >
                      <Trash2 className="me-1.5 h-3.5 w-3.5" />
                      {t("admin.invites.revoke", { defaultValue: "Withdraw" })}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("admin.invites.dialogTitle", { defaultValue: "Invite an employee" })}
            </DialogTitle>
            <DialogDescription>
              {t("admin.invites.dialogDescription", { defaultValue: "They get an email with a link to set their own password — you never see or choose it." })}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="invite-first">
                  {t("admin.invites.firstName", { defaultValue: "First name" })}
                </Label>
                <Input
                  id="invite-first"
                  value={form.firstName}
                  onChange={(event) =>
                    setForm({ ...form, firstName: event.target.value })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="invite-last">
                  {t("admin.invites.lastName", { defaultValue: "Last name" })}
                </Label>
                <Input
                  id="invite-last"
                  value={form.lastName}
                  onChange={(event) =>
                    setForm({ ...form, lastName: event.target.value })
                  }
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="invite-email">
                {t("admin.invites.email", { defaultValue: "Work email" })}
              </Label>
              <Input
                id="invite-email"
                type="email"
                value={form.email}
                onChange={(event) =>
                  setForm({ ...form, email: event.target.value })
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="invite-role">
                {t("admin.invites.role", { defaultValue: "Role" })}
              </Label>
              <Select
                value={form.role}
                onValueChange={(role) => setForm({ ...form, role })}
              >
                <SelectTrigger id="invite-role">
                  <SelectValue
                    placeholder={t("admin.invites.rolePlaceholder", { defaultValue: "Choose a role" })}
                  />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.name} value={role.name}>
                      {roleName(
                        role.name,
                        role.isSystem
                          ? null
                          : { label: role.label, labelAr: role.labelAr },
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("admin.invites.roleHint", { defaultValue: "You can only give roles at or below your own." })}
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="invite-phone">
                {t("admin.invites.phone", { defaultValue: "Phone (optional)" })}
              </Label>
              <Input
                id="invite-phone"
                value={form.phone}
                onChange={(event) =>
                  setForm({ ...form, phone: event.target.value })
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              onClick={submitInvite}
              disabled={
                submitting ||
                !form.email.trim() ||
                !form.firstName.trim() ||
                !form.lastName.trim()
              }
            >
              {submitting
                ? t("admin.invites.sending", { defaultValue: "Sending…" })
                : t("admin.invites.send", { defaultValue: "Send invitation" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
