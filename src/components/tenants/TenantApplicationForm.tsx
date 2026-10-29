"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  User,
  Briefcase,
  Phone,
  FileText,
  CheckCircle,
  AlertCircle,
  Info,
} from "lucide-react";

const tenantApplicationSchema = z.object({
  firstName: z.string().min(2, "First name must be at least 2 characters"),
  lastName: z.string().min(2, "Last name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(10, "Phone number must be at least 10 digits"),
  dateOfBirth: z.string().min(1, "Date of birth is required"),
  ssn: z.string().optional(),

  employmentInfo: z.object({
    employer: z.string().min(1, "Employer is required"),
    position: z.string().min(1, "Position is required"),
    income: z.number().min(0, "Income must be positive"),
    startDate: z.string().min(1, "Employment start date is required"),
  }),

  emergencyContacts: z
    .array(
      z.object({
        name: z.string().min(1, "Emergency contact name is required"),
        relationship: z.string().min(1, "Relationship is required"),
        phone: z.string().min(10, "Phone number must be at least 10 digits"),
        email: z.string().email().optional().or(z.literal("")),
      })
    )
    .min(1, "At least one emergency contact is required"),

  creditScore: z.number().min(300).max(850).optional(),
  applicationNotes: z.string().optional(),
  preferredContactMethod: z.enum(["email", "phone", "text", "app"]),

  backgroundCheckConsent: z.boolean().refine((val) => val === true, {
    message: "Background check consent is required",
  }),
  termsAccepted: z.boolean().refine((val) => val === true, {
    message: "Terms and conditions must be accepted",
  }),
});

type TenantApplicationData = z.infer<typeof tenantApplicationSchema>;

interface TenantApplicationFormProps {
  onSubmit: (data: TenantApplicationData) => Promise<void>;
  initialData?: Partial<TenantApplicationData>;
  isEditing?: boolean;
}

export default function TenantApplicationForm({
  onSubmit,
  initialData,
  isEditing = false,
}: TenantApplicationFormProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadedDocuments, setUploadedDocuments] = useState<string[]>([]);

  const totalSteps = 5;
  const progress = (currentStep / totalSteps) * 100;

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
    trigger,
  } = useForm<TenantApplicationData>({
    resolver: zodResolver(tenantApplicationSchema),
    defaultValues: {
      emergencyContacts: [{ name: "", relationship: "", phone: "", email: "" }],
      preferredContactMethod: "email",
      backgroundCheckConsent: false,
      termsAccepted: false,
      ...initialData,
    },
  });

  const watchedValues = watch();

  const handleStepSubmit = async () => {
    const fieldsToValidate = getFieldsForStep(currentStep);
    const isValid = await trigger(fieldsToValidate);

    if (isValid) {
      if (currentStep < totalSteps) {
        setCurrentStep(currentStep + 1);
      } else {
        await handleFinalSubmit();
      }
    }
  };

  const handleFinalSubmit = async () => {
    setIsSubmitting(true);
    try {
      await onSubmit(watchedValues);
      toast.success(
        isEditing
          ? "Application updated successfully"
          : "Application submitted successfully"
      );
    } catch (error) {
      toast.error("Failed to submit application", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getFieldsForStep = (step: number): (keyof TenantApplicationData)[] => {
    switch (step) {
      case 1:
        return ["firstName", "lastName", "email", "phone", "dateOfBirth"];
      case 2:
        return ["employmentInfo"];
      case 3:
        return ["emergencyContacts"];
      case 4:
        return ["creditScore", "applicationNotes", "preferredContactMethod"];
      case 5:
        return ["backgroundCheckConsent", "termsAccepted"];
      default:
        return [];
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Personal Information
              </CardTitle>
              <CardDescription>
                Please provide your basic personal information
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="firstName">First Name *</Label>
                  <Input
                    id="firstName"
                    {...register("firstName")}
                    className={errors.firstName ? "border-red-500" : ""}
                  />
                  {errors.firstName && (
                    <p className="text-sm text-red-500 mt-1">
                      {errors.firstName.message}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="lastName">Last Name *</Label>
                  <Input
                    id="lastName"
                    {...register("lastName")}
                    className={errors.lastName ? "border-red-500" : ""}
                  />
                  {errors.lastName && (
                    <p className="text-sm text-red-500 mt-1">
                      {errors.lastName.message}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <Label htmlFor="email">Email Address *</Label>
                <Input
                  id="email"
                  type="email"
                  {...register("email")}
                  className={errors.email ? "border-red-500" : ""}
                />
                {errors.email && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.email.message}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="phone">Phone Number *</Label>
                  <Input
                    id="phone"
                    {...register("phone")}
                    placeholder="+1 (555) 123-4567"
                    className={errors.phone ? "border-red-500" : ""}
                  />
                  {errors.phone && (
                    <p className="text-sm text-red-500 mt-1">
                      {errors.phone.message}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="dateOfBirth">Date of Birth *</Label>
                  <Input
                    id="dateOfBirth"
                    type="date"
                    {...register("dateOfBirth")}
                    className={errors.dateOfBirth ? "border-red-500" : ""}
                  />
                  {errors.dateOfBirth && (
                    <p className="text-sm text-red-500 mt-1">
                      {errors.dateOfBirth.message}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <Label htmlFor="ssn">Social Security Number (Optional)</Label>
                <Input
                  id="ssn"
                  {...register("ssn")}
                  placeholder="XXX-XX-XXXX"
                  type="password"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  This information is encrypted and used only for background
                  checks
                </p>
              </div>
            </CardContent>
          </Card>
        );

      case 2:
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Briefcase className="h-5 w-5" />
                Employment Information
              </CardTitle>
              <CardDescription>
                Please provide your current employment details
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="employer">Employer *</Label>
                  <Input
                    id="employer"
                    {...register("employmentInfo.employer")}
                    className={
                      errors.employmentInfo?.employer ? "border-red-500" : ""
                    }
                  />
                  {errors.employmentInfo?.employer && (
                    <p className="text-sm text-red-500 mt-1">
                      {errors.employmentInfo.employer.message}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="position">Position *</Label>
                  <Input
                    id="position"
                    {...register("employmentInfo.position")}
                    className={
                      errors.employmentInfo?.position ? "border-red-500" : ""
                    }
                  />
                  {errors.employmentInfo?.position && (
                    <p className="text-sm text-red-500 mt-1">
                      {errors.employmentInfo.position.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="income">Annual Income *</Label>
                  <Input
                    id="income"
                    type="number"
                    {...register("employmentInfo.income", {
                      valueAsNumber: true,
                    })}
                    placeholder="50000"
                    className={
                      errors.employmentInfo?.income ? "border-red-500" : ""
                    }
                  />
                  {errors.employmentInfo?.income && (
                    <p className="text-sm text-red-500 mt-1">
                      {errors.employmentInfo.income.message}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="startDate">Employment Start Date *</Label>
                  <Input
                    id="startDate"
                    type="date"
                    {...register("employmentInfo.startDate")}
                    className={
                      errors.employmentInfo?.startDate ? "border-red-500" : ""
                    }
                  />
                  {errors.employmentInfo?.startDate && (
                    <p className="text-sm text-red-500 mt-1">
                      {errors.employmentInfo.startDate.message}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );

      case 3:
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-5 w-5" />
                Emergency Contact
              </CardTitle>
              <CardDescription>
                Please provide at least one emergency contact
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {watchedValues.emergencyContacts?.map((_, index) => (
                <div key={index} className="space-y-4 p-4 border rounded-lg">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">
                      Emergency Contact {index + 1}
                    </h4>
                    {index > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const contacts = [
                            ...(watchedValues.emergencyContacts || []),
                          ];
                          contacts.splice(index, 1);
                          setValue("emergencyContacts", contacts);
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor={`contact-name-${index}`}>Name *</Label>
                      <Input
                        id={`contact-name-${index}`}
                        {...register(`emergencyContacts.${index}.name`)}
                        className={
                          errors.emergencyContacts?.[index]?.name
                            ? "border-red-500"
                            : ""
                        }
                      />
                      {errors.emergencyContacts?.[index]?.name && (
                        <p className="text-sm text-red-500 mt-1">
                          {errors.emergencyContacts[index]?.name?.message}
                        </p>
                      )}
                    </div>
                    <div>
                      <Label htmlFor={`contact-relationship-${index}`}>
                        Relationship *
                      </Label>
                      <Select
                        onValueChange={(value) =>
                          setValue(
                            `emergencyContacts.${index}.relationship`,
                            value
                          )
                        }
                        defaultValue={
                          watchedValues.emergencyContacts?.[index]?.relationship
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select relationship" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="parent">Parent</SelectItem>
                          <SelectItem value="sibling">Sibling</SelectItem>
                          <SelectItem value="spouse">Spouse</SelectItem>
                          <SelectItem value="friend">Friend</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      {errors.emergencyContacts?.[index]?.relationship && (
                        <p className="text-sm text-red-500 mt-1">
                          {
                            errors.emergencyContacts[index]?.relationship
                              ?.message
                          }
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor={`contact-phone-${index}`}>Phone *</Label>
                      <Input
                        id={`contact-phone-${index}`}
                        {...register(`emergencyContacts.${index}.phone`)}
                        placeholder="+1 (555) 123-4567"
                        className={
                          errors.emergencyContacts?.[index]?.phone
                            ? "border-red-500"
                            : ""
                        }
                      />
                      {errors.emergencyContacts?.[index]?.phone && (
                        <p className="text-sm text-red-500 mt-1">
                          {errors.emergencyContacts[index]?.phone?.message}
                        </p>
                      )}
                    </div>
                    <div>
                      <Label htmlFor={`contact-email-${index}`}>
                        Email (Optional)
                      </Label>
                      <Input
                        id={`contact-email-${index}`}
                        type="email"
                        {...register(`emergencyContacts.${index}.email`)}
                        className={
                          errors.emergencyContacts?.[index]?.email
                            ? "border-red-500"
                            : ""
                        }
                      />
                      {errors.emergencyContacts?.[index]?.email && (
                        <p className="text-sm text-red-500 mt-1">
                          {errors.emergencyContacts[index]?.email?.message}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const contacts = [...(watchedValues.emergencyContacts || [])];
                  contacts.push({
                    name: "",
                    relationship: "",
                    phone: "",
                    email: "",
                  });
                  setValue("emergencyContacts", contacts);
                }}
              >
                Add Another Contact
              </Button>
            </CardContent>
          </Card>
        );

      case 4:
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Additional Information
              </CardTitle>
              <CardDescription>
                Optional information to help process your application
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="creditScore">Credit Score (Optional)</Label>
                <Input
                  id="creditScore"
                  type="number"
                  min="300"
                  max="850"
                  {...register("creditScore", { valueAsNumber: true })}
                  placeholder="700"
                  className={errors.creditScore ? "border-red-500" : ""}
                />
                {errors.creditScore && (
                  <p className="text-sm text-red-500 mt-1">
                    {errors.creditScore.message}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  If you know your credit score, providing it can help expedite
                  your application
                </p>
              </div>

              <div>
                <Label htmlFor="preferredContactMethod">
                  Preferred Contact Method
                </Label>
                <Select
                  onValueChange={(value) =>
                    setValue("preferredContactMethod", value as any)
                  }
                  defaultValue={watchedValues.preferredContactMethod}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="phone">Phone Call</SelectItem>
                    <SelectItem value="text">Text Message</SelectItem>
                    <SelectItem value="app">In-App Notification</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="applicationNotes">
                  Additional Notes (Optional)
                </Label>
                <Textarea
                  id="applicationNotes"
                  {...register("applicationNotes")}
                  placeholder="Any additional information you'd like to share..."
                  rows={4}
                />
              </div>
            </CardContent>
          </Card>
        );

      case 5:
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                Review & Submit
              </CardTitle>
              <CardDescription>
                Please review your information and accept the terms
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Application Summary */}
              <div className="space-y-4">
                <h4 className="font-medium">Application Summary</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Name:</span>
                    <p>
                      {watchedValues.firstName} {watchedValues.lastName}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Email:</span>
                    <p>{watchedValues.email}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Phone:</span>
                    <p>{watchedValues.phone}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Employer:</span>
                    <p>{watchedValues.employmentInfo?.employer}</p>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Consent and Terms */}
              <div className="space-y-4">
                <div className="flex items-start space-x-2">
                  <Checkbox
                    id="backgroundCheckConsent"
                    checked={watchedValues.backgroundCheckConsent}
                    onCheckedChange={(checked) =>
                      setValue("backgroundCheckConsent", checked as boolean)
                    }
                  />
                  <div className="grid gap-1.5 leading-none">
                    <Label
                      htmlFor="backgroundCheckConsent"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Background Check Consent *
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      I consent to a background check being performed as part of
                      the application process.
                    </p>
                  </div>
                </div>
                {errors.backgroundCheckConsent && (
                  <p className="text-sm text-red-500">
                    {errors.backgroundCheckConsent.message}
                  </p>
                )}

                <div className="flex items-start space-x-2">
                  <Checkbox
                    id="termsAccepted"
                    checked={watchedValues.termsAccepted}
                    onCheckedChange={(checked) =>
                      setValue("termsAccepted", checked as boolean)
                    }
                  />
                  <div className="grid gap-1.5 leading-none">
                    <Label
                      htmlFor="termsAccepted"
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      Terms and Conditions *
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      I agree to the terms and conditions and privacy policy.
                    </p>
                  </div>
                </div>
                {errors.termsAccepted && (
                  <p className="text-sm text-red-500">
                    {errors.termsAccepted.message}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        );

      default:
        return null;
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Progress Bar */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>
                Step {currentStep} of {totalSteps}
              </span>
              <span>{Math.round(progress)}% Complete</span>
            </div>
            <Progress value={progress} className="w-full" />
          </div>
        </CardContent>
      </Card>

      {/* Current Step */}
      {renderStep()}

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
          disabled={currentStep === 1}
        >
          Previous
        </Button>

        <Button
          type="button"
          onClick={handleStepSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting
            ? "Submitting..."
            : currentStep === totalSteps
            ? "Submit Application"
            : "Next"}
        </Button>
      </div>
    </div>
  );
}
