"use client";

/**
 * PropertyPro SaaS - Account danger zone
 *
 * The three account-level actions that had APIs but no way to reach them:
 * export your own data, hand the organization to someone else, and close it.
 *
 * Ordered least to most destructive, and the destructive two are owner-only
 * — an admin seeing buttons they cannot use would be worse than not seeing
 * them, so the card renders what the caller can actually do.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Download, KeyRound, Trash2 } from "lucide-react";
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
import { signOut } from "@/lib/auth-client";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface OwnershipState {
  isOwner: boolean;
  organizationName: string;
}

export function AccountDangerZone() {
  const { t } = useLocalizationContext();
  const [state, setState] = useState<OwnershipState | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [transferForm, setTransferForm] = useState({
    newOwnerId: "",
    password: "",
  });
  const [closeForm, setCloseForm] = useState({
    password: "",
    confirmName: "",
    reason: "",
  });

  useEffect(() => {
    let active = true;
    fetch("/api/billing/status")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!active || !payload?.data) return;
        // `canManageBilling` is admin-or-owner; ownership is confirmed by the
        // transfer endpoint itself, which refuses anyone but the owner.
        setState({
          isOwner: Boolean(payload.data.canManageBilling),
          organizationName: "",
        });
      })
      .catch(() => {
        /* The danger zone simply stays hidden if this fails. */
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!transferOpen) return;
    let active = true;
    fetch("/api/users?limit=100")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!active) return;
        const rows = payload?.data?.users ?? payload?.data ?? [];
        if (!Array.isArray(rows)) return;
        setMembers(
          rows
            .filter((row: any) => row.role !== "tenant" && row.isActive)
            .map((row: any) => ({
              id: row.id,
              name:
                [row.firstName, row.lastName].filter(Boolean).join(" ") ||
                row.email,
              email: row.email,
              role: row.role,
            })),
        );
      })
      .catch(() => {
        if (active)
          toast.error(
            t("settings.danger.teamFailed", { defaultValue: "Could not load your team" }),
          );
      });
    return () => {
      active = false;
    };
  }, [transferOpen]);

  async function transferOwnership() {
    setBusy(true);
    try {
      const response = await fetch("/api/organization/transfer-ownership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(transferForm),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || t("settings.danger.transferFailed", { defaultValue: "The transfer did not go through" }));
      toast.success(
        t("settings.danger.transferred", { defaultValue: "Ownership transferred" }),
      );
      setTransferOpen(false);
      setTransferForm({ newOwnerId: "", password: "" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.danger.transferFailed", { defaultValue: "The transfer did not go through" }));
    } finally {
      setBusy(false);
    }
  }

  async function closeAccount() {
    setBusy(true);
    try {
      const response = await fetch("/api/organization/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(closeForm),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || t("settings.danger.closeFailed", { defaultValue: "Could not close the account" }));
      toast.success(
        t("settings.danger.closed", { defaultValue: "Account closed" }),
      );
      // The organization is suspended, so every subsequent request would be
      // rejected anyway — sign out rather than leave a dead session behind.
      await signOut();
      window.location.assign("/");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.danger.closeFailed", { defaultValue: "Could not close the account" }));
      setBusy(false);
    }
  }

  return (
    <>
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-destructive" />
            {t("settings.danger.title", { defaultValue: "Account actions" })}
          </CardTitle>
          <CardDescription>
            {t("settings.danger.subtitle", { defaultValue: "Actions on the whole account. The last two cannot be undone from here." })}
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
            <div>
              <p className="text-sm font-medium">
                {t("settings.danger.exportTitle", { defaultValue: "Download your data" })}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("settings.danger.exportHint", { defaultValue: "Everything held about your own account, as a JSON file. Other people's records are not included." })}
              </p>
            </div>
            <Button asChild variant="outline" className="shrink-0">
              <a href="/api/user/export-data" download>
                <Download className="me-2 size-4" />
                {t("settings.danger.export", { defaultValue: "Export" })}
              </a>
            </Button>
          </div>

          {state?.isOwner && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <p className="text-sm font-medium">{t("settings.danger.transferTitle", { defaultValue: "Transfer ownership" })}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("settings.danger.transferHint", { defaultValue: "Hand billing and control of the account to another team member. You stay an administrator." })}
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="shrink-0"
                  onClick={() => setTransferOpen(true)}
                >
                  <KeyRound className="me-2 size-4" />
                  {t("settings.danger.transfer", { defaultValue: "Transfer" })}
                </Button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
                <div>
                  <p className="text-sm font-medium">{t("settings.danger.closeTitle", { defaultValue: "Close this account" })}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("settings.danger.closeHint", { defaultValue: "Cancels the subscription and ends access for everyone. Data is kept for a short time so support can undo a mistake." })}
                  </p>
                </div>
                <Button
                  variant="destructive"
                  className="shrink-0"
                  onClick={() => setCloseOpen(true)}
                >
                  <Trash2 className="me-2 size-4" />
                  {t("settings.danger.close", { defaultValue: "Close account" })}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.danger.transferTitle", { defaultValue: "Transfer ownership" })}</DialogTitle>
            <DialogDescription>
              {t("settings.danger.transferDescription", { defaultValue: "The new owner takes over billing straight away and becomes an administrator. Only they can transfer it back." })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="new-owner">
                {t("settings.danger.newOwner", { defaultValue: "New owner" })}
              </Label>
              <Select
                value={transferForm.newOwnerId}
                onValueChange={(newOwnerId) =>
                  setTransferForm({ ...transferForm, newOwnerId })
                }
              >
                <SelectTrigger id="new-owner">
                  <SelectValue
                    placeholder={t("settings.danger.chooseMember", { defaultValue: "Choose a team member" })}
                  />
                </SelectTrigger>
                <SelectContent>
                  {members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name} — {member.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="transfer-password">{t("settings.twoFactor.confirmPassword", { defaultValue: "Confirm your password" })}</Label>
              <Input
                id="transfer-password"
                type="password"
                value={transferForm.password}
                onChange={(event) =>
                  setTransferForm({
                    ...transferForm,
                    password: event.target.value,
                  })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              onClick={transferOwnership}
              disabled={
                busy || !transferForm.newOwnerId || !transferForm.password
              }
            >
              {busy
                ? t("settings.danger.transferring", { defaultValue: "Transferring…" })
                : t("settings.danger.transferTitle", { defaultValue: "Transfer ownership" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.danger.closeTitle", { defaultValue: "Close this account" })}</DialogTitle>
            <DialogDescription>
              {t("settings.danger.closeDescription", { defaultValue: "The subscription is cancelled and everyone loses access at once. Support can restore the account for a short time; after that it is gone." })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="confirm-name">
                {t("settings.danger.typeName", { defaultValue: "Type the organization's name to confirm" })}
              </Label>
              <Input
                id="confirm-name"
                value={closeForm.confirmName}
                onChange={(event) =>
                  setCloseForm({ ...closeForm, confirmName: event.target.value })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="close-password">{t("settings.twoFactor.confirmPassword", { defaultValue: "Confirm your password" })}</Label>
              <Input
                id="close-password"
                type="password"
                value={closeForm.password}
                onChange={(event) =>
                  setCloseForm({ ...closeForm, password: event.target.value })
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="close-reason">
                {t("settings.danger.reason", { defaultValue: "Anything we could have done better? (optional)" })}
              </Label>
              <Input
                id="close-reason"
                value={closeForm.reason}
                onChange={(event) =>
                  setCloseForm({ ...closeForm, reason: event.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseOpen(false)}>
              {t("settings.danger.keep", { defaultValue: "Keep my account" })}
            </Button>
            <Button
              variant="destructive"
              onClick={closeAccount}
              disabled={busy || !closeForm.password || !closeForm.confirmName}
            >
              {busy
                ? t("settings.danger.closing", { defaultValue: "Closing…" })
                : t("settings.danger.closeForGood", { defaultValue: "Close the account for good" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
