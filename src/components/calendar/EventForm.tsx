"use client";

import { z } from "zod";
import { useForm } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  EventType,
  EventPriority,
  RecurrenceType,
  LocationType,
  OnlinePlatform,
} from "@/types";
import { toast } from "sonner";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

const createEventFormSchema = (t: (key: string) => string) =>
  z.object({
    title: z
      .string()
      .min(1, t("calendar.eventForm.validation.titleRequired"))
      .max(200, t("calendar.eventForm.validation.titleTooLong")),
    description: z
      .string()
      .max(2000, t("calendar.eventForm.validation.descriptionTooLong"))
      .optional()
      .or(z.literal("")),
    type: z.nativeEnum(EventType),
    priority: z.nativeEnum(EventPriority),
    startDate: z.date({
      required_error: t("calendar.eventForm.validation.startDateRequired"),
    }),
    startTime: z
      .string()
      .min(1, t("calendar.eventForm.validation.startTimeRequired")),
    endDate: z.date({
      required_error: t("calendar.eventForm.validation.endDateRequired"),
    }),
    endTime: z
      .string()
      .min(1, t("calendar.eventForm.validation.endTimeRequired")),
    allDay: z.boolean(),
    locationType: z.nativeEnum(LocationType).optional(),
    locationAddress: z.string().optional().or(z.literal("")),
    onlinePlatform: z.nativeEnum(OnlinePlatform).optional(),
    meetingLink: z.string().url().optional().or(z.literal("")),
    meetingId: z.string().optional().or(z.literal("")),
    passcode: z.string().optional().or(z.literal("")),
    propertyId: z.string().optional().or(z.literal("")),
    unitNumber: z.string().optional().or(z.literal("")),
    tenantId: z.string().optional().or(z.literal("")),
    leaseId: z.string().optional().or(z.literal("")),
    maintenanceRequestId: z.string().optional().or(z.literal("")),
    attendeeEmails: z.string().optional().or(z.literal("")),
    reminderMinutes: z.array(z.number()),
    notes: z.string().optional().or(z.literal("")),
    isRecurring: z.boolean(),
    recurrenceType: z.nativeEnum(RecurrenceType).optional(),
    recurrenceInterval: z.number().min(1).optional(),
    recurrenceEndDate: z.date().optional().nullable(),
    recurrenceOccurrences: z.number().min(1).optional(),
  });

type EventFormData = z.infer<ReturnType<typeof createEventFormSchema>>;

interface EventSubmitData
  extends Omit<
    EventFormData,
    | "startDate"
    | "endDate"
    | "locationType"
    | "locationAddress"
    | "onlinePlatform"
    | "meetingLink"
    | "meetingId"
    | "passcode"
  > {
  startDate: Date;
  endDate: Date;
  location?: {
    type: LocationType;
    address?: string;
    platform?: OnlinePlatform;
    meetingLink?: string;
    meetingId?: string;
    passcode?: string;
  };
}

interface EventFormProps {
  onSubmit: (data: EventSubmitData) => Promise<void>;
  onCancel: () => void;
  initialData?: Partial<EventFormData>;
  loading?: boolean;
}

export default function EventForm({
  onSubmit,
  onCancel,
  initialData,
  loading = false,
}: EventFormProps) {
  const { t } = useLocalizationContext();

  const form = useForm<EventFormData>({
    resolver: zodResolver(createEventFormSchema(t)),
    defaultValues: {
      title: "",
      description: "",
      type: EventType.GENERAL,
      priority: EventPriority.MEDIUM,
      allDay: false,
      locationType: LocationType.PHYSICAL,
      locationAddress: "",
      onlinePlatform: OnlinePlatform.ZOOM,
      meetingLink: "",
      meetingId: "",
      passcode: "",
      propertyId: undefined,
      unitNumber: "",
      tenantId: undefined,
      leaseId: undefined,
      maintenanceRequestId: undefined,
      attendeeEmails: "",
      reminderMinutes: [15],
      notes: "",
      isRecurring: false,
      recurrenceType: RecurrenceType.NONE,
      recurrenceInterval: 1,
      startTime: "09:00",
      endTime: "10:00",
      ...initialData,
    },
  });

  const handleSubmit = async (data: EventFormData) => {
    try {
      // Combine date and time
      const startDateTime = new Date(data.startDate);
      const endDateTime = new Date(data.endDate);

      if (!data.allDay) {
        const [startHour, startMinute] = data.startTime.split(":").map(Number);
        const [endHour, endMinute] = data.endTime.split(":").map(Number);

        startDateTime.setHours(startHour, startMinute, 0, 0);
        endDateTime.setHours(endHour, endMinute, 0, 0);
      }

      // Validate end time is after start time
      if (endDateTime <= startDateTime) {
        toast.error(t("calendar.eventForm.endBeforeStart", { defaultValue: "The end must come after the start" }));
        return;
      }

      // Format location data
      const location = data.locationType
        ? {
            type: data.locationType,
            ...(data.locationType === LocationType.PHYSICAL && {
              address: data.locationAddress,
            }),
            ...(data.locationType === LocationType.ONLINE && {
              platform: data.onlinePlatform,
              meetingLink: data.meetingLink,
              meetingId: data.meetingId,
              passcode: data.passcode,
            }),
          }
        : undefined;

      // Destructure to remove location-specific fields from the payload
      // These destructured vars are intentionally unused - they're being excluded from the final payload
      /* eslint-disable @typescript-eslint/no-unused-vars */
      const {
        locationType,
        locationAddress,
        onlinePlatform,
        meetingLink,
        meetingId,
        passcode,
        propertyId,
        tenantId,
        leaseId,
        maintenanceRequestId,
        ...rest
      } = data;
      /* eslint-enable @typescript-eslint/no-unused-vars */

      const formattedData: EventSubmitData = {
        ...rest,
        startDate: startDateTime,
        endDate: endDateTime,
        location,
        // Only include non-empty ObjectId fields
        ...(propertyId && propertyId !== "" && { propertyId }),
        ...(tenantId && tenantId !== "" && { tenantId }),
        ...(leaseId && leaseId !== "" && { leaseId }),
        ...(maintenanceRequestId &&
          maintenanceRequestId !== "" && { maintenanceRequestId }),
      };

      await onSubmit(formattedData);
    } catch (error) {
      console.error("Error submitting form:", error);
      toast.error(t("calendar.eventForm.saveFailed", { defaultValue: "Could not save the event" }));
    }
  };

  // Same catalogue entries the event details dialog and the list read.
  const EVENT_TYPE_KEYS: Record<EventType, string> = {
    [EventType.GENERAL]: "calendar.settings.events.typeGeneral",
    [EventType.PROPERTY_SHOWING]: "calendar.settings.events.typePropertyShowing",
    [EventType.PROPERTY_INSPECTION]: "calendar.settings.events.typePropertyInspection",
    [EventType.MAINTENANCE_APPOINTMENT]: "calendar.settings.events.typeMaintenance",
    [EventType.TENANT_MEETING]: "calendar.settings.events.typeTenantMeeting",
    [EventType.LEASE_RENEWAL]: "calendar.settings.events.typeLeaseRenewal",
    [EventType.RENT_COLLECTION]: "calendar.settings.events.typeRentCollection",
    [EventType.MOVE_IN]: "calendar.settings.events.typeMoveIn",
    [EventType.MOVE_OUT]: "calendar.settings.events.typeMoveOut",
  };

  const getEventTypeLabel = (type: EventType) => {
    const english = type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
    const key = EVENT_TYPE_KEYS[type];
    return key ? t(key, { defaultValue: english }) : english;
  };

  const getPriorityLabel = (priority: EventPriority) => {
    return t(`calendar.priority.${priority}`, {
      defaultValue: priority.charAt(0).toUpperCase() + priority.slice(1),
    });
  };

  return (
    <div className="h-full flex flex-col">
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleSubmit)}
          className="h-full flex flex-col"
        >
          <div className="flex-1 overflow-y-auto pe-2">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 p-1">
              {/* Left Column */}
              <div className="space-y-5">
                {/* Title */}
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("calendar.eventForm.title")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t("calendar.eventForm.titlePlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Type and Priority */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("calendar.eventForm.type")}</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={t(
                                  "calendar.eventForm.typePlaceholder"
                                )}
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {Object.values(EventType).map((type) => (
                              <SelectItem key={type} value={type}>
                                {getEventTypeLabel(type)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("calendar.eventForm.priority")}
                        </FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={t(
                                  "calendar.eventForm.priorityPlaceholder"
                                )}
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {Object.values(EventPriority).map((priority) => (
                              <SelectItem key={priority} value={priority}>
                                {getPriorityLabel(priority)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* All Day Toggle */}
                <FormField
                  control={form.control}
                  name="allDay"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <FormLabel className="text-sm font-medium">
                          {t("calendar.eventForm.allDayEvent")}
                        </FormLabel>
                        <FormDescription className="text-xs">
                          {t("calendar.eventForm.allDayEventDesc")}
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {/* Date Fields */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="startDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t("calendar.eventForm.startDate")}
                        </FormLabel>
                        <FormControl>
                          <DatePicker
                            date={field.value}
                            onSelect={field.onChange}
                            placeholder={t(
                              "calendar.eventForm.startDatePlaceholder"
                            )}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="endDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("calendar.eventForm.endDate")}</FormLabel>
                        <FormControl>
                          <DatePicker
                            date={field.value}
                            onSelect={field.onChange}
                            placeholder={t(
                              "calendar.eventForm.endDatePlaceholder"
                            )}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Time Fields (only show if not all day) */}
                {!form.watch("allDay") && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="startTime"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t("calendar.eventForm.startTime")}
                          </FormLabel>
                          <FormControl>
                            <Input type="time" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="endTime"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t("calendar.eventForm.endTime")}
                          </FormLabel>
                          <FormControl>
                            <Input type="time" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
              </div>

              {/* Right Column */}
              <div className="space-y-5">
                {/* Description */}
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("calendar.eventForm.description")}
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder={t(
                            "calendar.eventForm.descriptionPlaceholder"
                          )}
                          className="min-h-[140px] resize-none"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Location Type */}
                <FormField
                  control={form.control}
                  name="locationType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("calendar.eventForm.locationType")}
                      </FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue
                              placeholder={t(
                                "calendar.eventForm.locationTypePlaceholder"
                              )}
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={LocationType.PHYSICAL}>
                            {t("calendar.eventForm.locationTypePhysical")}
                          </SelectItem>
                          <SelectItem value={LocationType.ONLINE}>
                            {t("calendar.eventForm.locationTypeOnline")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Conditional Location Fields */}
                {form.watch("locationType") === LocationType.PHYSICAL && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="locationAddress"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t("calendar.eventForm.address")}
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t(
                                "calendar.eventForm.addressPlaceholder"
                              )}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="unitNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t("calendar.eventForm.unitNumber")}
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t(
                                "calendar.eventForm.unitNumberPlaceholder"
                              )}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {form.watch("locationType") === LocationType.ONLINE && (
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="onlinePlatform"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("calendar.eventForm.platform", { defaultValue: "Platform" })}</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder={t("calendar.eventForm.platformPlaceholder", { defaultValue: "Choose a platform" })} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value={OnlinePlatform.ZOOM}>
                                Zoom
                              </SelectItem>
                              <SelectItem value={OnlinePlatform.GOOGLE_MEET}>
                                Google Meet
                              </SelectItem>
                              <SelectItem
                                value={OnlinePlatform.MICROSOFT_TEAMS}
                              >
                                Microsoft Teams
                              </SelectItem>
                              <SelectItem value={OnlinePlatform.WEBEX}>
                                Webex
                              </SelectItem>
                              <SelectItem value={OnlinePlatform.OTHER}>
                                {t("calendar.platform.other", { defaultValue: "Other" })}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="meetingLink"
                      render={({ field }) => {
                        const platform = form.watch("onlinePlatform");
                        const getPlaceholder = () => {
                          switch (platform) {
                            case OnlinePlatform.ZOOM:
                              return "https://zoom.us/j/123456789";
                            case OnlinePlatform.GOOGLE_MEET:
                              return "https://meet.google.com/abc-defg-hij";
                            case OnlinePlatform.MICROSOFT_TEAMS:
                              return "https://teams.microsoft.com/l/meetup-join/...";
                            case OnlinePlatform.WEBEX:
                              return "https://company.webex.com/meet/...";
                            default:
                              return t("calendar.eventForm.meetingLinkPlaceholder", { defaultValue: "Paste the meeting link" });
                          }
                        };

                        return (
                          <FormItem>
                            <FormLabel>{t("calendar.eventForm.meetingLink", { defaultValue: "Meeting link" })}</FormLabel>
                            <FormControl>
                              <Input
                                placeholder={getPlaceholder()}
                                type="url"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="meetingId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("calendar.eventForm.meetingId", { defaultValue: "Meeting ID (optional)" })}</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="passcode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("calendar.eventForm.passcode", { defaultValue: "Passcode (optional)" })}</FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                )}

                {/* Attendee Emails */}
                <FormField
                  control={form.control}
                  name="attendeeEmails"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        {t("calendar.eventForm.attendeeEmails")}
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t(
                            "calendar.eventForm.attendeeEmailsPlaceholder"
                          )}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription className="text-xs">
                        {t("calendar.eventForm.attendeeEmailsDesc")}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex justify-end gap-4 pt-6 border-t mt-6">
            <Button type="button" variant="outline" onClick={onCancel}>
              {t("calendar.eventForm.cancel")}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading
                ? t("calendar.eventForm.creating")
                : t("calendar.eventForm.createButton")}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

export { EventForm };
