"use client";

import { z } from "zod";
import { useState, useCallback } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useFieldArray } from "react-hook-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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
  User,
  Briefcase,
  FileText,
  CreditCard,
  Home,
  Users,
  ChevronLeft,
  ChevronRight,
  Check,
} from "lucide-react";
import { FormDatePicker } from "@/components/ui/date-picker";
import { pickedDay } from "@/lib/dates/business-day";

// Enhanced form validation schema
const applicationSchema = z.object({
  // Personal Information
  personalInfo: z.object({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.string().email("Invalid email address"),
    phone: z
      .string()
      .regex(/^[\+]?[\d\s\-\(\)\.]{10,20}$/, "Invalid phone number format"),
    dateOfBirth: z.string().min(1, "Date of birth is required"),
    ssn: z
      .string()
      .regex(/^\d{3}-\d{2}-\d{4}$/, "SSN must be in format XXX-XX-XXXX")
      .optional(),
  }),

  // Employment Information
  employmentInfo: z.object({
    employer: z.string().min(1, "Employer is required"),
    position: z.string().min(1, "Position is required"),
    income: z.number().min(1, "Income is required"),
    startDate: z.string().min(1, "Employment start date is required"),
    employerContact: z.string().optional(),
  }),

  // Emergency Contacts
  emergencyContacts: z
    .array(
      z.object({
        name: z.string().min(1, "Name is required"),
        relationship: z.string().min(1, "Relationship is required"),
        phone: z
          .string()
          .regex(/^[\+]?[\d\s\-\(\)\.]{10,20}$/, "Invalid phone number format"),
        email: z
          .string()
          .email("Invalid email address")
          .optional()
          .or(z.literal("")),
      })
    )
    .min(1, "At least one emergency contact is required"),

  // Previous Addresses
  previousAddresses: z
    .array(
      z.object({
        address: z.string().min(1, "Address is required"),
        landlordName: z.string().optional(),
        landlordContact: z.string().optional(),
        moveInDate: z.string().min(1, "Move-in date is required"),
        moveOutDate: z.string().min(1, "Move-out date is required"),
        reasonForLeaving: z.string().optional(),
      })
    )
    .optional(),

  // Additional Information
  additionalInfo: z
    .object({
      pets: z.string().optional(),
      vehicles: z.string().optional(),
      reasonForMoving: z.string().optional(),
      additionalNotes: z.string().optional(),
    })
    .optional(),

  // Terms and Conditions
  agreeToTerms: z.boolean().refine((val) => val === true, {
    message: "You must agree to the terms and conditions",
  }),
  agreeToBackgroundCheck: z.boolean().refine((val) => val === true, {
    message: "You must consent to background check",
  }),
});

type ApplicationFormData = z.infer<typeof applicationSchema>;

interface EnhancedApplicationFormProps {
  onSubmit: (data: ApplicationFormData) => void;
  onSaveDraft?: (data: Partial<ApplicationFormData>) => void;
  isLoading?: boolean;
  propertyName?: string;
  propertyId?: string;
  applicationFeeAmount?: number;
  initialData?: Partial<ApplicationFormData>;
}

const STEPS = [
  { id: 1, title: "Personal Info", icon: User },
  { id: 2, title: "Employment", icon: Briefcase },
  { id: 3, title: "Contacts", icon: Users },
  { id: 4, title: "History", icon: Home },
  { id: 5, title: "Documents", icon: FileText },
  { id: 6, title: "Payment", icon: CreditCard },
  { id: 7, title: "Review", icon: Check },
];

export function EnhancedApplicationForm({
  onSubmit,
  onSaveDraft,
  isLoading = false,
  propertyName,
  propertyId,
  applicationFeeAmount = 50,
  initialData,
}: EnhancedApplicationFormProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [uploadedDocuments, setUploadedDocuments] = useState<File[]>([]);

  const form = useForm<ApplicationFormData>({
    resolver: zodResolver(applicationSchema),
    defaultValues: {
      personalInfo: {
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        dateOfBirth: "",
        ssn: "",
      },
      employmentInfo: {
        employer: "",
        position: "",
        income: 0,
        startDate: "",
        employerContact: "",
      },
      emergencyContacts: [{ name: "", relationship: "", phone: "", email: "" }],
      previousAddresses: [],
      additionalInfo: {
        pets: "",
        vehicles: "",
        reasonForMoving: "",
        additionalNotes: "",
      },
      agreeToTerms: false,
      agreeToBackgroundCheck: false,
      ...initialData,
    },
  });

  const {
    fields: emergencyFields,
    append: appendEmergency,
    remove: removeEmergency,
  } = useFieldArray({
    control: form.control,
    name: "emergencyContacts",
  });

  const {
    fields: addressFields,
    append: appendAddress,
    remove: removeAddress,
  } = useFieldArray({
    control: form.control,
    name: "previousAddresses",
  });

  const addEmergencyContact = () => {
    appendEmergency({ name: "", relationship: "", phone: "", email: "" });
  };

  const addPreviousAddress = () => {
    appendAddress({
      address: "",
      landlordName: "",
      landlordContact: "",
      moveInDate: "",
      moveOutDate: "",
      reasonForLeaving: "",
    });
  };

  const handleFileUpload = useCallback((files: FileList | null) => {
    if (files) {
      const newFiles = Array.from(files);
      setUploadedDocuments((prev) => [...prev, ...newFiles]);
    }
  }, []);

  const removeDocument = (index: number) => {
    setUploadedDocuments((prev) => prev.filter((_, i) => i !== index));
  };

  const nextStep = () => {
    if (currentStep < STEPS.length) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSaveDraft = () => {
    if (onSaveDraft) {
      const currentData = form.getValues();
      onSaveDraft(currentData);
    }
  };

  const progress = (currentStep / STEPS.length) * 100;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-6 w-6" />
            Rental Application
            {propertyName && (
              <span className="text-muted-foreground">- {propertyName}</span>
            )}
          </CardTitle>
          <CardDescription>
            Complete your rental application step by step. All information is
            securely encrypted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Progress value={progress} className="w-full" />
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>
                Step {currentStep} of {STEPS.length}
              </span>
              <span>{Math.round(progress)}% Complete</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step Navigation */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex justify-between items-center">
            {STEPS.map((step) => {
              const Icon = step.icon;
              const isActive = step.id === currentStep;
              const isCompleted = step.id < currentStep;

              return (
                <div
                  key={step.id}
                  className={`flex flex-col items-center space-y-2 ${
                    isActive
                      ? "text-primary"
                      : isCompleted
                      ? "text-green-600"
                      : "text-muted-foreground"
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${
                      isActive
                        ? "border-primary bg-primary text-primary-foreground"
                        : isCompleted
                        ? "border-green-600 bg-green-600 text-white"
                        : "border-muted-foreground"
                    }`}
                  >
                    {isCompleted ? (
                      <Check className="h-5 w-5" />
                    ) : (
                      <Icon className="h-5 w-5" />
                    )}
                  </div>
                  <span className="text-xs font-medium hidden sm:block">
                    {step.title}
                  </span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Step 1: Personal Information */}
          {currentStep === 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Personal Information
                </CardTitle>
                <CardDescription>
                  Please provide your personal details
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="personalInfo.firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First Name</FormLabel>
                        <FormControl>
                          <Input placeholder="John" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="personalInfo.lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Doe" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="personalInfo.email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email Address</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="john@example.com"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="personalInfo.phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone Number</FormLabel>
                        <FormControl>
                          <Input placeholder="(555) 123-4567" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="personalInfo.dateOfBirth"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date of Birth</FormLabel>
                        <FormControl>
                          <FormDatePicker
                            value={
                              field.value ? new Date(field.value) : undefined
                            }
                            onChange={(date) =>
                              field.onChange(date ? pickedDay(date) : undefined)
                            }
                            placeholder="Select date of birth"
                            disabled={(date) =>
                              date > new Date() || date < new Date("1900-01-01")
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="personalInfo.ssn"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Social Security Number (Optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="XXX-XX-XXXX" {...field} />
                        </FormControl>
                        <FormDescription>
                          Required for background check. This information is
                          encrypted and secure.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 2: Employment Information */}
          {currentStep === 2 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Briefcase className="h-5 w-5" />
                  Employment Information
                </CardTitle>
                <CardDescription>
                  Tell us about your current employment
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="employmentInfo.employer"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Employer Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Company Name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="employmentInfo.position"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Job Title</FormLabel>
                        <FormControl>
                          <Input placeholder="Software Engineer" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="employmentInfo.income"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Annual Income</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder="75000"
                            {...field}
                            onChange={(e) =>
                              field.onChange(Number(e.target.value))
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="employmentInfo.startDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Employment Start Date</FormLabel>
                        <FormControl>
                          <FormDatePicker
                            value={
                              field.value ? new Date(field.value) : undefined
                            }
                            onChange={(date) =>
                              field.onChange(date ? pickedDay(date) : undefined)
                            }
                            placeholder="Select employment start date"
                            disabled={(date) => date > new Date()}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="employmentInfo.employerContact"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Employer Contact (Optional)</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="HR phone number or email"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Contact information for employment verification
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          )}

          {/* Navigation Buttons */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={prevStep}
                  disabled={currentStep === 1}
                >
                  <ChevronLeft className="me-2 h-4 w-4 rtl:-scale-x-100" />
                  Previous
                </Button>

                <div className="flex gap-2">
                  {onSaveDraft && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleSaveDraft}
                    >
                      Save Draft
                    </Button>
                  )}

                  {currentStep < STEPS.length ? (
                    <Button type="button" onClick={nextStep}>
                      Next
                      <ChevronRight className="ms-2 h-4 w-4 rtl:-scale-x-100" />
                    </Button>
                  ) : (
                    <Button type="submit" disabled={isLoading}>
                      {isLoading ? "Submitting..." : "Submit Application"}
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </form>
      </Form>
    </div>
  );
}
