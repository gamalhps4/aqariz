"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiText } from "@/components/ui/use-ui-text";
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

export interface SearchableSelectOption {
  value: string;
  label: string;
  subtitle?: string;
  badge?: string;
  icon?: React.ReactNode;
}

export interface SearchableSelectGroup {
  label: string;
  options: SearchableSelectOption[];
}

interface SearchableSelectProps {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  options?: SearchableSelectOption[];
  groups?: SearchableSelectGroup[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  disabled?: boolean;
}

export function SearchableSelect({
  id,
  value,
  onValueChange,
  options,
  groups,
  placeholder: placeholderProp,
  searchPlaceholder: searchPlaceholderProp,
  emptyMessage: emptyMessageProp,
  className,
  triggerClassName,
  contentClassName,
  disabled = false,
}: SearchableSelectProps) {
  const { text } = useUiText();
  const placeholder = placeholderProp ?? text("ui.select", "Select…");
  const searchPlaceholder = searchPlaceholderProp ?? text("ui.search", "Search…");
  const emptyMessage = emptyMessageProp ?? text("ui.noResults", "No results found.");
  const [open, setOpen] = React.useState(false);

  // Build a flat lookup for the selected option
  const allOptions = React.useMemo(() => {
    if (options) return options;
    if (groups) return groups.flatMap((g) => g.options);
    return [];
  }, [options, groups]);

  const selectedOption = allOptions.find((opt) => opt.value === value);

  const handleSelect = (selectedValue: string) => {
    onValueChange(selectedValue === value ? "" : selectedValue);
    setOpen(false);
  };

  const renderOption = (opt: SearchableSelectOption) => (
    <CommandItem
      key={opt.value}
      value={opt.value}
      keywords={[opt.label, opt.subtitle, opt.badge].filter(Boolean) as string[]}
      onSelect={handleSelect}
      className="flex items-center gap-3 py-2.5 px-2 cursor-pointer"
    >
      {opt.icon && (
        <span className="shrink-0">{opt.icon}</span>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{opt.label}</p>
        {opt.subtitle && (
          <p className="text-xs text-muted-foreground truncate">
            {opt.subtitle}
          </p>
        )}
        {opt.badge && (
          <p className="text-xs font-medium text-blue-600 truncate">
            {opt.badge}
          </p>
        )}
      </div>
      <Check
        className={cn(
          "h-4 w-4 shrink-0",
          value === opt.value ? "opacity-100" : "opacity-0"
        )}
      />
    </CommandItem>
  );

  return (
    <div className={className}>
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
              !value && "text-muted-foreground",
              triggerClassName
            )}
          >
            {selectedOption ? (
              <div className="flex items-center gap-2 min-w-0">
                {selectedOption.icon && (
                  <span className="shrink-0">{selectedOption.icon}</span>
                )}
                <span className="truncate">{selectedOption.label}</span>
              </div>
            ) : (
              <span>{placeholder}</span>
            )}
            <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className={cn("p-0", contentClassName)}
          align="start"
          style={{ width: "var(--radix-popover-trigger-width)" }}
        >
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>{emptyMessage}</CommandEmpty>
              {groups
                ? groups.map((group) => (
                    <CommandGroup key={group.label} heading={group.label}>
                      {group.options.map(renderOption)}
                    </CommandGroup>
                  ))
                : options && (
                    <CommandGroup>
                      {options.map(renderOption)}
                    </CommandGroup>
                  )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
