"use client";

/**
 * PropertyPro - A permission group's rights, a box per department
 *
 * The client's reference page: Select All at the top, then a box for each
 * department of the office with a tick for the whole box and its
 * sub-permissions beneath. A sub-permission with View, Add, Edit, Delete and
 * Export opens to show the five, so each can be granted on its own — the
 * review's "View, Add, Edit, Delete and Export separately".
 *
 * The layout is lib/permission-departments.ts; this only draws it.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { PERMISSION_METADATA, type SystemPermission } from "@/lib/permission-catalog";
import {
  PERMISSION_ACTIONS,
  isCovered,
  isGranted,
  toggleAction,
  toggleModule,
  type PermissionAction,
  type PermissionModule,
} from "@/lib/permission-matrix";
import {
  PERMISSION_DEPARTMENTS,
  departmentState,
  moduleState,
  pageState,
  toggleDepartment,
  togglePage,
  type DepartmentEntry,
  type SelectionState,
} from "@/lib/permission-departments";

const ACTION_FALLBACK: Record<PermissionAction, string> = {
  view: "View",
  create: "Add",
  edit: "Edit",
  delete: "Delete",
  export: "Export",
};

interface PermissionDepartmentsProps {
  selected: string[];
  onChange: (next: string[]) => void;
  /** Read-only: a built-in role, shown as it is. */
  disabled?: boolean;
}

function tick(state: SelectionState) {
  return { checked: state === "all", indeterminate: state === "some" };
}

export function PermissionDepartments({
  selected,
  onChange,
  disabled = false,
}: PermissionDepartmentsProps) {
  const { t } = useLocalizationContext();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const permissionName = (permission: SystemPermission) =>
    t(`admin.roles.permissions.${permission}.name`, {
      defaultValue: PERMISSION_METADATA[permission].label,
    });
  const permissionDescription = (permission: SystemPermission) =>
    t(`admin.roles.permissions.${permission}.description`, {
      defaultValue: PERMISSION_METADATA[permission].description,
    });
  const moduleName = (module: PermissionModule) =>
    t(`admin.roles.matrix.modules.${module.id}`, {
      defaultValue: module.fallback,
    });
  const actionName = (action: PermissionAction) =>
    t(`admin.roles.matrix.actions.${action}`, {
      defaultValue: ACTION_FALLBACK[action],
    });

  const everything = pageState(selected);

  const toggleOpen = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const coveredHint = t("admin.roles.departments.coveredByFinance", {
    defaultValue: "Included in Full finance access",
  });

  const renderModule = (module: PermissionModule) => {
    const state = moduleState(selected, module);
    const covered = isCovered(selected, module);
    const umbrellaHeld = Boolean(module.full && selected.includes(module.full));
    const expanded = open.has(module.id);
    const granted = PERMISSION_ACTIONS.filter((action) =>
      isGranted(selected, module, action),
    );
    const boxId = `module-${module.id}`;

    return (
      <li key={module.id} className="space-y-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => toggleOpen(module.id)}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted"
            aria-expanded={expanded}
            aria-controls={`${boxId}-actions`}
            aria-label={t("admin.roles.departments.showActions", {
              defaultValue: "Show View, Add, Edit, Delete and Export for {name}",
              values: { name: moduleName(module) },
            })}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4 rtl:rotate-180" />
            )}
          </button>
          <Checkbox
            id={boxId}
            {...tick(state)}
            disabled={disabled || covered}
            onCheckedChange={(checked) =>
              onChange(toggleModule(selected, module, checked))
            }
          />
          <label htmlFor={boxId} className="flex-1 text-sm leading-tight">
            {moduleName(module)}
            {covered ? (
              <span className="ms-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" />
                {coveredHint}
              </span>
            ) : state === "some" && !expanded ? (
              <span className="ms-2 text-xs text-muted-foreground">
                {granted.map(actionName).join(" · ")}
              </span>
            ) : null}
          </label>
        </div>
        {expanded && (
          <div
            id={`${boxId}-actions`}
            className="ms-12 flex flex-wrap gap-x-4 gap-y-2"
          >
            {PERMISSION_ACTIONS.map((action) => {
              const permission = module.actions[action];
              if (!permission) return null;
              const cellId = `${boxId}-${action}`;
              return (
                <div
                  key={action}
                  className="flex items-center gap-1.5"
                  title={
                    covered
                      ? coveredHint
                      : umbrellaHeld
                        ? t("admin.roles.matrix.coveredByFull", {
                            defaultValue: "Included in full access",
                          })
                        : permissionDescription(permission)
                  }
                >
                  <Checkbox
                    id={cellId}
                    checked={covered || isGranted(selected, module, action)}
                    disabled={disabled || covered}
                    onCheckedChange={(checked) =>
                      onChange(toggleAction(selected, module, action, checked))
                    }
                  />
                  <label htmlFor={cellId} className="text-xs">
                    {actionName(action)}
                  </label>
                </div>
              );
            })}
          </div>
        )}
      </li>
    );
  };

  const renderEntry = (entry: DepartmentEntry) => {
    if (entry.kind === "module") return renderModule(entry.module);

    if (entry.kind === "always") {
      return (
        <li key={entry.id} className="flex items-center gap-2 ps-6">
          <Checkbox checked disabled aria-readonly />
          <span className="text-sm leading-tight">
            {t(`admin.roles.departments.always.${entry.id}`, {
              defaultValue: entry.fallback,
            })}
            <span className="ms-2 text-xs text-muted-foreground">
              {t("admin.roles.departments.everyEmployee", {
                defaultValue: "Every employee",
              })}
            </span>
          </span>
        </li>
      );
    }

    const id = `perm-${entry.permission}`;
    return (
      <li
        key={entry.permission}
        className="flex items-start gap-2 ps-6"
        title={permissionDescription(entry.permission)}
      >
        <Checkbox
          id={id}
          checked={selected.includes(entry.permission)}
          disabled={disabled}
          onCheckedChange={(checked) => {
            const next = new Set(selected);
            if (checked) next.add(entry.permission);
            else next.delete(entry.permission);
            onChange([...next]);
          }}
        />
        <label htmlFor={id} className="text-sm leading-tight">
          {permissionName(entry.permission)}
          <span className="block text-xs text-muted-foreground">
            {permissionDescription(entry.permission)}
          </span>
        </label>
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Checkbox
          id="permissions-select-all"
          {...tick(everything)}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(togglePage(selected, checked))}
        />
        <label
          htmlFor="permissions-select-all"
          className="text-sm font-semibold"
        >
          {t("admin.roles.dialog.selectAll", { defaultValue: "Select all" })}
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {PERMISSION_DEPARTMENTS.map((department) => {
          const state = departmentState(selected, department);
          const id = `department-${department.id}`;
          return (
            <section
              key={department.id}
              aria-labelledby={`${id}-title`}
              className="rounded-lg border p-4"
            >
              <div className="mb-3 flex items-center gap-2">
                <Checkbox
                  id={id}
                  {...tick(state)}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    onChange(toggleDepartment(selected, department, checked))
                  }
                />
                <label
                  id={`${id}-title`}
                  htmlFor={id}
                  className="text-sm font-semibold"
                >
                  {t(`admin.roles.departments.${department.id}`, {
                    defaultValue: department.fallback,
                  })}
                </label>
              </div>
              <ul className="space-y-3">
                {department.entries.map(renderEntry)}
              </ul>
            </section>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        {t("admin.roles.departments.hint", {
          defaultValue:
            "Open a line to grant View, Add, Edit, Delete and Export one by one.",
        })}
      </p>
    </div>
  );
}
