"use client";

/**
 * PropertyPro - Assigning an employee to compounds and buildings
 *
 * The Access tab behind `User.scopeRestricted`. Off is the normal state and
 * is shown as such: staff see the office's own data until somebody
 * deliberately narrows them. The switch and lists are BuildingAssignmentPicker,
 * shared with the new-employee form.
 *
 * Read-only when the server says the caller may not change it — their own
 * access, a colleague beyond their own rights, or no Manage roles — so the
 * card never offers a save the server would refuse.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { showSimpleError, showSimpleSuccess } from "@/lib/toast-notifications";
import {
  BuildingAssignmentPicker,
  type AssignableBuildings,
  type BuildingAssignmentValue,
} from "@/components/users/BuildingAssignmentPicker";

interface ScopePayload extends BuildingAssignmentValue {
  canEdit?: boolean;
  assignable: AssignableBuildings;
}

export function BuildingScopeCard({ userId }: { userId: string }) {
  const { t } = useLocalizationContext();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ScopePayload | null>(null);
  const [value, setValue] = useState<BuildingAssignmentValue>({
    restricted: false,
    compoundIds: [],
    propertyIds: [],
  });

  /**
   * Fetch only — no state is touched here, so the effect below can await
   * before its first `setState` and the component does not re-render
   * synchronously on mount.
   */
  const fetchScope = useCallback(async (): Promise<
    { ok: true; payload: ScopePayload } | { ok: false; error: string }
  > => {
    try {
      const response = await fetch(`/api/users/${userId}/building-scope`);
      const result = await response.json();
      if (!response.ok || !result?.success) {
        return {
          ok: false,
          error:
            result?.error ??
            t("admin.scope.loadFailed", {
              defaultValue: "Could not load building access",
            }),
        };
      }
      return { ok: true, payload: result.data as ScopePayload };
    } catch {
      return {
        ok: false,
        error: t("admin.scope.loadFailed", {
          defaultValue: "Could not load building access",
        }),
      };
    }
  }, [userId, t]);

  const apply = useCallback((payload: ScopePayload) => {
    setData(payload);
    setValue({
      restricted: payload.restricted,
      compoundIds: payload.compoundIds,
      propertyIds: payload.propertyIds,
    });
  }, []);

  useEffect(() => {
    // `cancelled` guards the case where the operator navigates to another
    // user while this request is still in flight — at this latency that is
    // not a hypothetical.
    let cancelled = false;
    void (async () => {
      const result = await fetchScope();
      if (cancelled) return;
      if (result.ok) {
        apply(result.payload);
        setError(null);
      } else {
        setError(result.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchScope, apply]);

  const canEdit = data?.canEdit !== false;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/users/${userId}/building-scope`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const result = await response.json();
      if (!response.ok || !result?.success) {
        const message =
          result?.error ??
          t("admin.scope.saveFailed", {
            defaultValue: "Could not save building access",
          });
        setError(message);
        showSimpleError(
          t("admin.scope.saveFailedTitle", { defaultValue: "Save failed" }),
          message,
        );
        return;
      }
      showSimpleSuccess(
        t("admin.userDetail.buildingScope.saved", {
          defaultValue: "Building access updated",
        }),
      );
      // Re-read rather than trusting the local state: the server clears the
      // lists when the restriction is switched off, and the card should show
      // what was actually stored.
      const refreshed = await fetchScope();
      if (refreshed.ok) apply(refreshed.payload);
    } catch {
      setError(
        t("admin.scope.saveFailed", {
          defaultValue: "Could not save building access",
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading", { defaultValue: "Loading…" })}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          {t("admin.userDetail.buildingScope.title", {
            defaultValue: "Building access",
          })}
        </CardTitle>
        <CardDescription>
          {t("admin.userDetail.buildingScope.description", {
            defaultValue:
              "By default an employee sees every property in the organization. Limit them here to the compounds and buildings they are responsible for.",
          })}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {data && (
          <BuildingAssignmentPicker
            assignable={data.assignable}
            value={value}
            onChange={setValue}
            disabled={!canEdit}
          />
        )}

        {data &&
          (canEdit ? (
            <div className="flex justify-end">
              <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                {t("common.save", { defaultValue: "Save" })}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("admin.userDetail.buildingScope.readOnly", {
                defaultValue:
                  "You can see this employee's buildings but not change them: that needs Manage roles, and a colleague whose rights are within your own — never your own access.",
              })}
            </p>
          ))}
      </CardContent>
    </Card>
  );
}
