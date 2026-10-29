"use client";

import * as React from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DEFAULT_HOUR = 9;
const DEFAULT_MINUTE = 0;

interface FormDateTimePickerProps {
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  disabledDate?: (date: Date) => boolean;
  className?: string;
  align?: "start" | "center" | "end";
  fromYear?: number;
  toYear?: number;
  minuteStep?: number;
}

const hourOptions = Array.from({ length: 12 }, (_, index) =>
  String(index + 1).padStart(2, "0")
);

const formatMinutes = (minute: number) => String(minute).padStart(2, "0");

const normalizeMinute = (minute: number, step: number) => {
  if (step <= 1) return minute;
  return Math.round(minute / step) * step;
};

const getMinuteOptions = (step: number, currentMinute?: number) => {
  const safeStep = Math.max(1, Math.min(step, 30));
  const options = Array.from(
    { length: Math.ceil(60 / safeStep) },
    (_, index) => formatMinutes((index * safeStep) % 60)
  );

  if (
    typeof currentMinute === "number" &&
    !options.includes(formatMinutes(currentMinute))
  ) {
    options.push(formatMinutes(currentMinute));
    options.sort();
  }

  return options;
};

const to24Hour = (hour12: number, period: "AM" | "PM") => {
  const normalized = hour12 % 12;
  if (period === "PM") {
    return normalized === 12 ? 12 : normalized + 12;
  }
  return hour12 === 12 ? 0 : normalized;
};

const mergeDateAndTime = (
  date: Date,
  hours: number,
  minutes: number
) =>
  new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hours,
    minutes,
    0,
    0
  );

export function FormDateTimePicker({
  value,
  onChange,
  placeholder = "Select date & time",
  disabledDate,
  className,
  align = "start",
  fromYear,
  toYear,
  minuteStep = 15,
}: FormDateTimePickerProps) {
  const [internalValue, setInternalValue] = React.useState<Date | undefined>(
    value
  );

  React.useEffect(() => {
    setInternalValue(value);
  }, [value]);

  const hasDateSelected = Boolean(internalValue);
  const activeDate = internalValue;

  const hour24 = activeDate ? activeDate.getHours() : DEFAULT_HOUR;
  const minute = activeDate ? activeDate.getMinutes() : DEFAULT_MINUTE;
  const hour12 = ((hour24 + 11) % 12) + 1;
  const period: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM";
  const minuteOptions = React.useMemo(
    () => getMinuteOptions(minuteStep, minute),
    [minuteStep, minute]
  );

  const emitChange = (nextValue: Date | undefined) => {
    setInternalValue(nextValue);
    onChange?.(nextValue);
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) {
      emitChange(undefined);
      return;
    }

    const nextDate = mergeDateAndTime(
      date,
      hour24 ?? DEFAULT_HOUR,
      minute ?? DEFAULT_MINUTE
    );
    emitChange(nextDate);
  };

  const handleHourChange = (hourString: string) => {
    if (!internalValue) return;
    const hourNumber = parseInt(hourString, 10);
    if (Number.isNaN(hourNumber)) return;
    const nextHour = to24Hour(hourNumber, period);
    emitChange(mergeDateAndTime(internalValue, nextHour, minute));
  };

  const handleMinuteChange = (minuteString: string) => {
    if (!internalValue) return;
    const parsed = parseInt(minuteString, 10);
    if (Number.isNaN(parsed)) return;
    const normalized = normalizeMinute(parsed, minuteStep) % 60;
    emitChange(mergeDateAndTime(internalValue, hour24, normalized));
  };

  const handlePeriodChange = (nextPeriod: "AM" | "PM") => {
    if (!internalValue) return;
    const effectiveHour12 = hour12;
    const nextHour = to24Hour(effectiveHour12, nextPeriod);
    emitChange(mergeDateAndTime(internalValue, nextHour, minute));
  };

  const handleClear = (event: React.MouseEvent) => {
    event.preventDefault();
    emitChange(undefined);
  };

  const handleSetNow = (event: React.MouseEvent) => {
    event.preventDefault();
    const now = new Date();
    emitChange(now);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "h-11 w-full justify-start text-start font-normal border-2 border-border/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/20 bg-background/50 transition-all duration-200",
            !internalValue && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="me-2 h-4 w-4" />
          {internalValue ? format(internalValue, "PPP p") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <div className="flex flex-col sm:flex-row">
          <Calendar
            mode="single"
            selected={internalValue}
            onSelect={handleDateSelect}
            disabled={disabledDate}
            captionLayout="dropdown"
            fromYear={fromYear}
            toYear={toYear}
            initialFocus
          />
          <div className="border-t border-border/40 sm:border-t-0 sm:border-s bg-muted/20">
            <div className="p-3 space-y-3">
              <div className="text-sm font-medium text-foreground/80">
                Time
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={String(hour12).padStart(2, "0")}
                  onValueChange={handleHourChange}
                  disabled={!hasDateSelected}
                >
                  <SelectTrigger className="w-[70px]">
                    <SelectValue placeholder="HH" />
                  </SelectTrigger>
                  <SelectContent>
                    {hourOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground">:</span>
                <Select
                  value={formatMinutes(minute)}
                  onValueChange={handleMinuteChange}
                  disabled={!hasDateSelected}
                >
                  <SelectTrigger className="w-[70px]">
                    <SelectValue placeholder="MM" />
                  </SelectTrigger>
                  <SelectContent>
                    {minuteOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={period}
                  onValueChange={(value: "AM" | "PM") =>
                    handlePeriodChange(value)
                  }
                  disabled={!hasDateSelected}
                >
                  <SelectTrigger className="w-[75px]">
                    <SelectValue placeholder="AM/PM" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AM">AM</SelectItem>
                    <SelectItem value="PM">PM</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  onClick={handleSetNow}
                >
                  Now
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  onClick={handleClear}
                >
                  Clear
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
