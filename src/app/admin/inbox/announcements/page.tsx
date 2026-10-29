"use client";

/**
 * Platform announcements console.
 *
 * Drafting and publishing are separate actions on purpose: an incident notice
 * is often written before it should appear, and pulling one down in a hurry
 * (unpublish) must not also destroy what it said (delete).
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Info,
  Megaphone,
  Plus,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { ResponsiveLayout } from "@/components/layout/responsive-layout";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

type Level = "info" | "warning" | "critical";
type State = "draft" | "scheduled" | "live" | "ended";

interface Announcement {
  id: string;
  title: string;
  body: string;
  level: Level;
  audience: string | null;
  dismissible: boolean;
  publishedAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  linkLabel: string | null;
  linkUrl: string | null;
  state: State;
}

const EMPTY_FORM = {
  title: "",
  body: "",
  level: "info" as Level,
  audience: "all",
  dismissible: true,
  startsAt: "",
  endsAt: "",
  linkLabel: "",
  linkUrl: "",
};

const STATE_VARIANT: Record<State, "default" | "secondary" | "outline"> = {
  live: "default",
  scheduled: "secondary",
  draft: "outline",
  ended: "outline",
};

const LEVEL_ICON = {
  info: Info,
  warning: Megaphone,
  critical: AlertTriangle,
} as const;

/** datetime-local gives "YYYY-MM-DDTHH:mm"; the API wants a full ISO string. */
function toIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export default function PlatformAnnouncementsPage() {
  const { t, formatDate } = useLocalizationContext();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/announcements")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (active && Array.isArray(payload?.data)) {
          setAnnouncements(payload.data);
        }
      })
      .catch(() => {
        if (active) toast.error(t("platform.announcements.loadError", { defaultValue: "Could not load announcements" }));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload]);

  function refresh() {
    setLoading(true);
    setReload((n) => n + 1);
  }

  async function create(publish: boolean) {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          body: form.body,
          level: form.level,
          audience: form.audience === "all" ? null : form.audience,
          dismissible: form.dismissible,
          startsAt: toIso(form.startsAt),
          endsAt: toIso(form.endsAt),
          linkLabel: form.linkLabel || null,
          linkUrl: form.linkUrl || null,
          publish,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Could not save");
      toast.success(payload?.message || "Saved");
      setForm(EMPTY_FORM);
      setOpen(false);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("platform.announcements.saveError", { defaultValue: "Could not save" }));
    } finally {
      setBusy(false);
    }
  }

  async function act(announcement: Announcement, published?: boolean) {
    setBusy(true);
    try {
      const response = await fetch(
        `/api/admin/announcements/${announcement.id}`,
        published === undefined
          ? { method: "DELETE" }
          : {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ published }),
            },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Action failed");
      toast.success(payload?.message || "Done");
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("platform.announcements.actionError", { defaultValue: "Action failed" }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ResponsiveLayout className="space-y-6" padding="none">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("platform.announcements.title", { defaultValue: "Announcements" })}</h1>
          <p className="text-muted-foreground">
            Notices shown to every organization in the product — maintenance
            windows, incidents and release notes.
          </p>
        </div>
        <Button className="shrink-0" onClick={() => setOpen(true)}>
          <Plus className="me-2 h-4 w-4" />
          {t("platform.announcements.new", { defaultValue: "New announcement" })}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("platform.announcements.all", { defaultValue: "All announcements" })}</CardTitle>
          <CardDescription>
            {t("platform.announcements.subtitle", { defaultValue: "Live notices appear as a banner in every tenant&apos;s dashboard." })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-4 text-sm text-muted-foreground">{t("platform.common.loading", { defaultValue: "Loading…" })}</p>
          ) : announcements.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              {t("platform.announcements.empty", { defaultValue: "Nothing published yet." })}
            </p>
          ) : (
            <ul className="divide-y">
              {announcements.map((announcement) => {
                const Icon = LEVEL_ICON[announcement.level];
                return (
                  <li key={announcement.id} className="py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="font-medium">{announcement.title}</span>
                      <Badge
                        variant={STATE_VARIANT[announcement.state]}
                        className="capitalize"
                      >
                        {announcement.state}
                      </Badge>
                      <Badge variant="outline" className="capitalize">
                        {announcement.level}
                      </Badge>
                      {announcement.audience && (
                        <Badge variant="outline" className="capitalize">
                          {announcement.audience} only
                        </Badge>
                      )}
                      <div className="ms-auto flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            act(announcement, !announcement.publishedAt)
                          }
                        >
                          {announcement.publishedAt ? (
                            <>
                              <EyeOff className="me-1.5 size-3.5" />
                              {t("platform.announcements.unpublish", { defaultValue: "Unpublish" })}
                            </>
                          ) : (
                            <>
                              <Eye className="me-1.5 size-3.5" />
                              {t("platform.announcements.publish", { defaultValue: "Publish" })}
                            </>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={busy}
                          onClick={() => act(announcement)}
                        >
                          <Trash2 className="me-1.5 size-3.5" />
                          {t("platform.common.delete", { defaultValue: "Delete" })}
                        </Button>
                      </div>
                    </div>
                    <p className="mt-1.5 ps-6 text-sm text-muted-foreground">
                      {announcement.body}
                    </p>
                    {(announcement.startsAt || announcement.endsAt) && (
                      <p className="mt-1 ps-6 text-xs text-muted-foreground">
                        {announcement.startsAt &&
                          `From ${formatDate(announcement.startsAt, { format: "medium" })}`}
                        {announcement.startsAt && announcement.endsAt && " · "}
                        {announcement.endsAt &&
                          `Until ${formatDate(announcement.endsAt, { format: "medium" })}`}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("platform.announcements.new", { defaultValue: "New announcement" })}</DialogTitle>
            <DialogDescription>
              {t("platform.announcements.draftHint", { defaultValue: "Save as a draft to write it now and publish later." })}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="a-title">{t("platform.announcements.field.title", { defaultValue: "Title" })}</Label>
              <Input
                id="a-title"
                value={form.title}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="a-body">{t("platform.announcements.field.message", { defaultValue: "Message" })}</Label>
              <textarea
                id="a-body"
                rows={4}
                className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                value={form.body}
                onChange={(event) =>
                  setForm({ ...form, body: event.target.value })
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="a-level">{t("platform.announcements.field.level", { defaultValue: "Level" })}</Label>
                <Select
                  value={form.level}
                  onValueChange={(level) =>
                    setForm({ ...form, level: level as Level })
                  }
                >
                  <SelectTrigger id="a-level">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">{t("platform.announcements.level.info", { defaultValue: "Info" })}</SelectItem>
                    <SelectItem value="warning">{t("platform.announcements.level.warning", { defaultValue: "Warning" })}</SelectItem>
                    <SelectItem value="critical">{t("platform.announcements.level.critical", { defaultValue: "Critical" })}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="a-audience">{t("platform.announcements.field.audience", { defaultValue: "Audience" })}</Label>
                <Select
                  value={form.audience}
                  onValueChange={(audience) => setForm({ ...form, audience })}
                >
                  <SelectTrigger id="a-audience">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("platform.announcements.audience.everyone", { defaultValue: "Everyone" })}</SelectItem>
                    <SelectItem value="admin">{t("platform.announcements.audience.admins", { defaultValue: "Admins only" })}</SelectItem>
                    <SelectItem value="manager">{t("platform.announcements.audience.managers", { defaultValue: "Managers only" })}</SelectItem>
                    <SelectItem value="tenant">{t("platform.announcements.audience.tenants", { defaultValue: "Tenants only" })}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="a-start">{t("platform.announcements.field.showFrom", { defaultValue: "Show from (optional)" })}</Label>
                <Input
                  id="a-start"
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(event) =>
                    setForm({ ...form, startsAt: event.target.value })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="a-end">{t("platform.announcements.field.hideAfter", { defaultValue: "Hide after (optional)" })}</Label>
                <Input
                  id="a-end"
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(event) =>
                    setForm({ ...form, endsAt: event.target.value })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="a-link-label">{t("platform.announcements.field.linkText", { defaultValue: "Link text (optional)" })}</Label>
                <Input
                  id="a-link-label"
                  value={form.linkLabel}
                  onChange={(event) =>
                    setForm({ ...form, linkLabel: event.target.value })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="a-link-url">{t("platform.announcements.field.linkUrl", { defaultValue: "Link URL (optional)" })}</Label>
                <Input
                  id="a-link-url"
                  type="url"
                  placeholder="https://"
                  value={form.linkUrl}
                  onChange={(event) =>
                    setForm({ ...form, linkUrl: event.target.value })
                  }
                />
              </div>
            </div>

            <label className="flex items-center gap-3 text-sm">
              <Switch
                checked={form.dismissible}
                onCheckedChange={(dismissible) =>
                  setForm({ ...form, dismissible })
                }
              />
              {t("platform.announcements.dismissible", { defaultValue: "Readers can dismiss this notice" })}
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("platform.common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              variant="outline"
              onClick={() => create(false)}
              disabled={busy || !form.title.trim() || !form.body.trim()}
            >
              {t("platform.announcements.saveDraft", { defaultValue: "Save draft" })}
            </Button>
            <Button
              onClick={() => create(true)}
              disabled={busy || !form.title.trim() || !form.body.trim()}
            >
              {busy ? t("platform.announcements.publishing", { defaultValue: "Publishing…" }) : t("platform.announcements.publishNow", { defaultValue: "Publish now" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ResponsiveLayout>
  );
}
