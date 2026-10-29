"use client";

import * as React from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { dateFnsLocale } from "@/lib/utils/date-fns-locale";
import { useUiText } from "@/components/ui/use-ui-text";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface DatePickerProps {
  date?: Date;
  onSelect?: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: (date: Date) => boolean;
  className?: string;
  align?: "start" | "center" | "end";
  fromYear?: number;
  toYear?: number;
  id?: string;
  /** The whole control is shown but cannot be opened. */
  readOnly?: boolean;
}

export function DatePicker({
  date,
  onSelect,
  placeholder,
  disabled,
  className,
  align = "start",
  fromYear,
  toYear,
  id,
  readOnly = false,
}: DatePickerProps) {
  const { text, language } = useUiText();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          disabled={readOnly}
          className={cn(
            "h-11 w-full justify-start text-start font-normal border-2 border-border/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 bg-background/50 transition-all duration-200",
            !date && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="me-2 h-4 w-4" />
          {date ? (
            format(date, "PPP", { locale: dateFnsLocale(language) })
          ) : (
            <span>{placeholder ?? text("ui.pickDate", "Pick a date")}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <Calendar
          mode="single"
          selected={date}
          onSelect={onSelect}
          disabled={disabled}
          initialFocus
          captionLayout="dropdown"
          fromYear={fromYear}
          toYear={toYear}
        />
      </PopoverContent>
    </Popover>
  );
}

interface FormDatePickerProps {
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: (date: Date) => boolean;
  className?: string;
  align?: "start" | "center" | "end";
  fromYear?: number;
  toYear?: number;
  id?: string;
  /** The whole control is shown but cannot be opened. */
  readOnly?: boolean;
}

export function FormDatePicker({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  align = "start",
  fromYear,
  toYear,
  id,
  readOnly,
}: FormDatePickerProps) {
  return (
    <DatePicker
      date={value}
      onSelect={onChange}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      align={align}
      fromYear={fromYear}
      toYear={toYear}
      id={id}
      readOnly={readOnly}
    />
  );
}
