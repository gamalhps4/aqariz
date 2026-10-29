"use client";

/**
 * PropertyPro - Client communication log
 *
 * One timeline of everything said to a client, whether it happened in the
 * product or on the phone. Shared by the tenant and owner profiles, so a
 * person who is both has one history rather than two half-histories.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  FileText,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { SendMessageDialog } from "@/components/clients/SendMessageDialog";

type Channel =
  | "call"
  | "email"
  | "meeting"
  | "whatsapp"
  | "sms"
  | "letter"
  | "note"
  | "in_app";

interface CommunicationEntry {
  id: string;
  source: "logged" | "message";
  channel: string;
  direction: string;
  subject: string;
  body: string | null;
  occurredAt: string;
  propertyName: string | null;
  recordedBy: string | null;
  followUpAt: string | null;
  followUpDone: boolean;
  editable: boolean;
}

interface CommunicationHistory {
  entries: CommunicationEntry[];
  summary: {
    total: number;
    logged: number;
    messages: number;
    openFollowUps: number;
    lastContactAt: string | null;
  };
}

const CHANNEL_ICONS: Record<string, typeof Phone> = {
  call: Phone,
  email: Mail,
  meeting: Users,
  whatsapp: MessageSquare,
  sms: MessageSquare,
  letter: FileText,
  note: FileText,
  in_app: Send,
};

const LOGGABLE_CHANNELS: Channel[] = [
  "call",
  "email",
  "meeting",
  "whatsapp",
  "sms",
  "letter",
  "note",
];

function isoDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function CommunicationLog({ clientId }: { clientId: string }) {
  const { t, formatDate } = useLocalizationContext();

  const [history, setHistory] = useState<CommunicationHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("channel", filter);
      const response = await fetch(
        `/api/clients/${clientId}/communications?${params}`,
      );
      const payload = await response.json();
      if (payload?.success) {
        setHistory(payload.data as CommunicationHistory);
        setError(null);
      } else {
        setError(payload?.error ?? t("errors.ui.loadFailed", { defaultValue: "Could not load this. Try again." }));
      }
    } catch (loadError) {
      console.error("Failed to load communications:", loadError);
      setError("Could not load the history");
    } finally {
      setLoading(false);
    }
  }, [clientId, filter, t]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleFollowUp = async (entry: CommunicationEntry) => {
    setBusy(true);
    try {
      await fetch(`/api/clients/${clientId}/communications/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followUpDone: !entry.followUpDone }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: CommunicationEntry) => {
    setBusy(true);
    try {
      await fetch(`/api/clients/${clientId}/communications/${entry.id}`, {
        method: "DELETE",
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const summary = history?.summary;
  const entries = history?.entries ?? [];

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
            <span className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              {t("clients.communications.title", {
                defaultValue: "Communication history",
              })}
              {(summary?.openFollowUps ?? 0) > 0 && (
                <Badge
                  variant="outline"
                  className="border-warning/20 bg-warning/10 text-xs text-warning"
                >
                  {t("clients.communications.followUpsDue", {
                    defaultValue: "{count} follow-up(s) due",
                    values: { count: summary?.openFollowUps ?? 0 },
                  })}
                </Badge>
              )}
            </span>
            <span className="flex items-center gap-2">
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="h-9 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("clients.communications.allChannels", {
                      defaultValue: "All channels",
                    })}
                  </SelectItem>
                  {LOGGABLE_CHANNELS.map((channel) => (
                    <SelectItem key={channel} value={channel}>
                      {t(`clients.communications.channel.${channel}`, {
                        defaultValue: channel,
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSendingMessage(true)}
              >
                <Send className="h-4 w-4" />
                {t("clients.communications.send.button", {
                  defaultValue: "SMS / WhatsApp",
                })}
              </Button>
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" />
                {t("clients.communications.log", { defaultValue: "Log" })}
              </Button>
            </span>
          </CardTitle>
          {summary?.lastContactAt && (
            <p className="text-sm text-muted-foreground">
              {t("clients.communications.lastContact", {
                defaultValue: "Last contact {date}",
                values: { date: formatDate(summary.lastContactAt) },
              })}
            </p>
          )}
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <MessageSquare className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium">
                {t("clients.communications.empty.title", {
                  defaultValue: "Nothing recorded yet",
                })}
              </p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {t("clients.communications.empty.description", {
                  defaultValue:
                    "Log a call, meeting or letter so the next person to speak to this client knows what was said.",
                })}
              </p>
            </div>
          ) : (
            <ol className="space-y-3">
              {entries.map((entry) => {
                const Icon = CHANNEL_ICONS[entry.channel] ?? FileText;
                const Direction =
                  entry.direction === "inbound" ? ArrowDownLeft : ArrowUpRight;
                return (
                  <li
                    key={`${entry.source}-${entry.id}`}
                    className="flex gap-3 rounded-lg border p-3"
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </span>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {entry.subject}
                        </span>
                        <Badge
                          variant="outline"
                          className="gap-1 text-[10px] font-normal capitalize"
                        >
                          <Direction className="h-3 w-3" />
                          {t(
                            `clients.communications.channel.${entry.channel}`,
                            { defaultValue: entry.channel.replace(/_/g, " ") },
                          )}
                        </Badge>
                        {/* Says plainly where a row came from, so nobody
                            wonders why an in-app message cannot be edited. */}
                        {entry.source === "message" && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] font-normal"
                          >
                            {t("clients.communications.fromMessaging", {
                              defaultValue: "From messaging",
                            })}
                          </Badge>
                        )}
                      </div>

                      {entry.body && (
                        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                          {entry.body}
                        </p>
                      )}

                      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatDate(entry.occurredAt)}</span>
                        {entry.recordedBy && <span>· {entry.recordedBy}</span>}
                        {entry.propertyName && (
                          <span>· {entry.propertyName}</span>
                        )}
                      </p>

                      {entry.followUpAt && (
                        <button
                          type="button"
                          onClick={() => void toggleFollowUp(entry)}
                          disabled={busy}
                          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
                            entry.followUpDone
                              ? "border-success/20 bg-success/10 text-success"
                              : "border-warning/20 bg-warning/10 text-warning"
                          }`}
                        >
                          {entry.followUpDone ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <CalendarClock className="h-3 w-3" />
                          )}
                          {entry.followUpDone
                            ? t("clients.communications.followUpDone", {
                                defaultValue: "Follow-up done",
                              })
                            : t("clients.communications.followUpOn", {
                                defaultValue: "Follow up {date}",
                                values: {
                                  date: formatDate(entry.followUpAt),
                                },
                              })}
                        </button>
                      )}
                    </div>

                    {/* Asked first: it ran on one click, and a record of what
                        was said to a client is what gets asked about later. */}
                    {entry.editable && (
                      <ConfirmationDialog
                        title={t("clients.communications.delete.title", {
                          defaultValue: "Delete this entry?",
                        })}
                        description={t("clients.communications.delete.description", {
                          defaultValue:
                            "“{subject}” is removed from this client's history.",
                          values: { subject: entry.subject },
                        })}
                        confirmText={t("clients.communications.delete.confirm", {
                          defaultValue: "Delete entry",
                        })}
                        variant="destructive"
                        onConfirm={() => remove(entry)}
                        loading={busy}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 shrink-0 p-0 text-destructive"
                          disabled={busy}
                          aria-label={t("clients.communications.delete.confirm", {
                            defaultValue: "Delete entry",
                          })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </ConfirmationDialog>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      <LogCommunicationDialog
        clientId={clientId}
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={async () => {
          setAdding(false);
          await load();
        }}
        onError={setError}
      />
      <SendMessageDialog
        clientId={clientId}
        open={sendingMessage}
        onClose={() => setSendingMessage(false)}
        onSent={async () => {
          setSendingMessage(false);
          await load();
        }}
      />
    </div>
  );
}

function LogCommunicationDialog({
  clientId,
  open,
  onClose,
  onSaved,
  onError,
}: {
  clientId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const { t } = useLocalizationContext();
  const [saving, setSaving] = useState(false);
  const initial = useMemo(
    () => ({
      channel: "call" as Channel,
      direction: "outbound",
      subject: "",
      body: "",
      occurredAt: isoDateTimeLocal(new Date()),
      followUpAt: "",
    }),
    [],
  );
  const [form, setForm] = useState(initial);

  useEffect(() => {
    if (open) setForm({ ...initial, occurredAt: isoDateTimeLocal(new Date()) });
  }, [open, initial]);

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/clients/${clientId}/communications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: form.channel,
          direction: form.direction,
          subject: form.subject,
          body: form.body || null,
          occurredAt: form.occurredAt,
          followUpAt: form.followUpAt || null,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result?.success) {
        onError(result?.error ?? t("errors.ui.saveFailed", { defaultValue: "Could not save. Try again." }));
        return;
      }
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("clients.communications.logTitle", {
              defaultValue: "Log a communication",
            })}
          </DialogTitle>
          <DialogDescription>
            {t("clients.communications.logDescription", {
              defaultValue:
                "Record a call, meeting or letter so it becomes part of this client's history.",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>
                {t("clients.communications.channelLabel", {
                  defaultValue: "Channel",
                })}
              </Label>
              <Select
                value={form.channel}
                onValueChange={(value) =>
                  setForm((c) => ({ ...c, channel: value as Channel }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOGGABLE_CHANNELS.map((channel) => (
                    <SelectItem key={channel} value={channel}>
                      {t(`clients.communications.channel.${channel}`, {
                        defaultValue: channel,
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>
                {t("clients.communications.directionLabel", {
                  defaultValue: "Direction",
                })}
              </Label>
              <Select
                value={form.direction}
                onValueChange={(value) =>
                  setForm((c) => ({ ...c, direction: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="outbound">
                    {t("clients.communications.direction.outbound", {
                      defaultValue: "We contacted them",
                    })}
                  </SelectItem>
                  <SelectItem value="inbound">
                    {t("clients.communications.direction.inbound", {
                      defaultValue: "They contacted us",
                    })}
                  </SelectItem>
                  <SelectItem value="internal">
                    {t("clients.communications.direction.internal", {
                      defaultValue: "Internal note",
                    })}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="comm-subject">
              {t("clients.communications.subject", { defaultValue: "Subject" })}
            </Label>
            <Input
              id="comm-subject"
              value={form.subject}
              onChange={(event) =>
                setForm((c) => ({ ...c, subject: event.target.value }))
              }
              placeholder={t("clients.communications.subjectPlaceholder", {
                defaultValue: "Called about the overdue quarter",
              })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="comm-body">
              {t("clients.communications.notes", { defaultValue: "Notes" })}
            </Label>
            <Textarea
              id="comm-body"
              rows={4}
              value={form.body}
              onChange={(event) =>
                setForm((c) => ({ ...c, body: event.target.value }))
              }
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="comm-when">
                {t("clients.communications.when", {
                  defaultValue: "When it happened",
                })}
              </Label>
              <Input
                id="comm-when"
                type="datetime-local"
                value={form.occurredAt}
                onChange={(event) =>
                  setForm((c) => ({ ...c, occurredAt: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="comm-followup">
                {t("clients.communications.followUp", {
                  defaultValue: "Follow up on (optional)",
                })}
              </Label>
              <Input
                id="comm-followup"
                type="date"
                value={form.followUpAt}
                onChange={(event) =>
                  setForm((c) => ({ ...c, followUpAt: event.target.value }))
                }
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button onClick={save} disabled={saving || !form.subject.trim()}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("clients.communications.save", { defaultValue: "Log it" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
