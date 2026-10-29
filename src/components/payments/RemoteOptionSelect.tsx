"use client";

/**
 * PropertyPro - A picker that searches the server
 *
 * The contract, unit and tenant pickers used to load the 300 most recent
 * contracts once and search those in the browser, so an office with more
 * could not pick the 301st at all. This one asks the server as the operator
 * types (see GET /api/payments/filter-options?section=…), and keeps the
 * chosen option's name on its button whatever the current search returns.
 */

import * as React from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface RemoteOption {
  value: string;
  label: string;
  subtitle?: string;
  /** One value per column of a picker laid out in `columns`, beside the label. */
  cells?: Array<string | null | undefined>;
  /** What the button says once this is chosen, when the label alone is not enough. */
  buttonLabel?: string;
}

/** A column of a picker laid out as a table: its heading, and how it reads. */
export interface RemoteOptionColumn {
  header: string;
  /** A phone number or a code: kept left to right inside Arabic. */
  ltr?: boolean;
}

interface RemoteOptionSelectProps {
  id?: string;
  value: string;
  onValueChange: (value: string, option?: RemoteOption) => void;
  /**
   * The options matching `search`. `chosen` holds the current value, so the
   * answer can include it and the button keep its name.
   */
  load: (search: string, chosen: string[]) => Promise<RemoteOption[]>;
  /** Offered above the matches, whatever the search — "All contracts". */
  leading?: RemoteOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  loadingMessage: string;
  triggerClassName?: string;
  disabled?: boolean;
  /**
   * Lay the matches out as a table: the label's own heading, then one column
   * per entry, each filled from the option's `cells` — so a mobile number, a
   * building and a unit read in columns of their own rather than run together
   * on one line.
   */
  labelHeader?: string;
  columns?: RemoteOptionColumn[];
}

const DEBOUNCE_MS = 250;

export function RemoteOptionSelect({
  id,
  value,
  onValueChange,
  load,
  leading = [],
  placeholder,
  searchPlaceholder,
  emptyMessage,
  loadingMessage,
  triggerClassName,
  disabled = false,
  labelHeader,
  columns,
}: RemoteOptionSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [options, setOptions] = React.useState<RemoteOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  // The chosen option, kept so its name stays on the button.
  const [chosen, setChosen] = React.useState<RemoteOption | null>(null);

  // The parent's loader, read when it is called rather than watched: a new
  // function on every render must not start a new search.
  const runLoad = React.useEffectEvent((query: string, chosenIds: string[]) =>
    load(query, chosenIds),
  );

  // A fixed option ("All contracts") needs no asking to be named.
  const valueIsLeading = leading.some((option) => option.value === value);

  // Ask again as the search changes, and once when the list opens. Closed,
  // ask only to name a value chosen elsewhere (a contract from the address).
  React.useEffect(() => {
    if (!open && (chosen?.value === value || !value || valueIsLeading)) return;
    let active = true;
    const timer = window.setTimeout(
      () => {
        setLoading(true);
        runLoad(open ? search : "", value && !valueIsLeading ? [value] : [])
          .then((next) => {
            if (!active) return;
            setOptions(next);
            const match = next.find((option) => option.value === value);
            if (match) setChosen(match);
          })
          .catch(() => {
            if (active) setOptions([]);
          })
          .finally(() => {
            if (active) setLoading(false);
          });
      },
      open && search ? DEBOUNCE_MS : 0,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [open, search, value, valueIsLeading, chosen?.value]);

  const known = [...leading, ...options];
  const selected =
    known.find((option) => option.value === value) ??
    (chosen?.value === value ? chosen : undefined);

  const pick = (next: string) => {
    const option = known.find((candidate) => candidate.value === next);
    setChosen(option ?? null);
    onValueChange(next, option);
    setOpen(false);
    setSearch("");
  };

  // The label's column is the widest; the check mark keeps its own.
  const tabular = Boolean(columns?.length);
  const gridTemplateColumns = tabular
    ? `minmax(0,1.6fr) repeat(${columns!.length}, minmax(0,1fr)) 1rem`
    : undefined;

  const item = (option: RemoteOption) => {
    const check = (
      <Check
        className={cn(
          "h-4 w-4 shrink-0",
          value === option.value ? "opacity-100" : "opacity-0",
        )}
      />
    );
    const label = (
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{option.label}</p>
        {option.subtitle && (
          <p className="truncate text-xs text-muted-foreground">
            <bdi>{option.subtitle}</bdi>
          </p>
        )}
      </div>
    );
    // A fixed option ("All contracts") has no cells to lay out.
    if (!tabular || !option.cells) {
      return (
        <CommandItem
          key={option.value}
          value={option.value}
          onSelect={pick}
          className="flex cursor-pointer items-center gap-3 px-2 py-2.5"
        >
          {label}
          {check}
        </CommandItem>
      );
    }
    return (
      <CommandItem
        key={option.value}
        value={option.value}
        onSelect={pick}
        className="grid cursor-pointer items-center gap-3 px-2 py-2.5"
        style={{ gridTemplateColumns }}
      >
        {label}
        {columns!.map((column, index) => {
          const cell = option.cells?.[index];
          return (
            <span key={column.header} className="truncate text-sm">
              {cell ? (
                <bdi dir={column.ltr ? "ltr" : undefined}>{cell}</bdi>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </span>
          );
        })}
        {check}
      </CommandItem>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            !selected && "text-muted-foreground",
            triggerClassName,
          )}
        >
          <span className="truncate">
            {selected?.buttonLabel ?? selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0"
        align="start"
        style={{
          width: "var(--radix-popover-trigger-width)",
          // A table of columns needs more room than the button it opens from.
          minWidth: tabular ? "min(36rem, calc(100vw - 2rem))" : 260,
        }}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {loading && (
              <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {loadingMessage}
              </div>
            )}
            {!loading && known.length === 0 && (
              <CommandEmpty>{emptyMessage}</CommandEmpty>
            )}
            {leading.length > 0 && <CommandGroup>{leading.map(item)}</CommandGroup>}
            {tabular && options.length > 0 && (
              <div
                className="grid gap-3 border-b px-3 py-1.5 text-xs font-medium text-muted-foreground"
                style={{ gridTemplateColumns }}
              >
                <span className="truncate">{labelHeader}</span>
                {columns!.map((column) => (
                  <span key={column.header} className="truncate">
                    {column.header}
                  </span>
                ))}
                <span />
              </div>
            )}
            {options.length > 0 && <CommandGroup>{options.map(item)}</CommandGroup>}
            {!loading && options.length === 0 && known.length > 0 && search && (
              <p className="px-3 py-2 text-xs text-muted-foreground">{emptyMessage}</p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A phone number or code kept left to right inside a line of Arabic: wrapped
 * in a directional isolate, so "+966 50…" does not come out "…50 966+".
 */
export function isolateLtr(text: string | null | undefined): string {
  return text ? `\u2066${text}\u2069` : "";
}

/** A filter-options section searched for a picker. */
export async function searchFilterOptions<T>(
  section: "leases" | "units" | "tenants",
  search: string,
  chosen: string[],
): Promise<T[]> {
  const params = new URLSearchParams({ section });
  if (search) params.set("search", search);
  if (chosen.length) params.set("ids", chosen.join(","));
  const response = await fetch(`/api/payments/filter-options?${params}`);
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) return [];
  return (result.data?.[section] ?? []) as T[];
}
