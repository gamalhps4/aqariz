/**
 * PropertyPro - New Conversation Dialog
 * Component for creating new conversations with participant selection
 */

"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Users,
  User,
  MessageCircle,
  Search,
  X,
  Check,
  Building,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface User {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  avatar?: string;
  isActive: boolean;
}

interface Property {
  _id: string;
  name: string;
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
  };
  fullAddress?: string; // Virtual property from MongoDB
}

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateConversation: (data: {
    type: "individual" | "group";
    name?: string;
    description?: string;
    participants: string[];
    propertyId?: string;
  }) => Promise<void>;
}

export const NewConversationDialog: React.FC<NewConversationDialogProps> = ({
  open,
  onOpenChange,
  onCreateConversation,
}) => {
  const { t } = useLocalizationContext();
  const [step, setStep] = useState<"type" | "details" | "participants">("type");
  const [conversationType, setConversationType] = useState<
    "individual" | "group"
  >("individual");
  const [conversationName, setConversationName] = useState("");
  const [conversationDescription, setConversationDescription] = useState("");
  const [selectedProperty, setSelectedProperty] = useState<string>("");
  const [selectedParticipants, setSelectedParticipants] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [propertiesError, setPropertiesError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  // Helper function to format address
  const formatAddress = (property: Property): string => {
    if (property.fullAddress) {
      return property.fullAddress;
    }
    const { street, city, state, zipCode } = property.address;
    return `${street}, ${city}, ${state} ${zipCode}`;
  };

  // Load users and properties from API
  useEffect(() => {
    if (open) {
      loadUsers();
      loadProperties();
    }
  }, [open]);

  const loadUsers = async () => {
    try {
      setLoadingUsers(true);
      setUsersError(null);
      const response = await fetch("/api/conversations/contacts?limit=100");
      if (!response.ok) {
        const message = await response.text();
        throw new Error(
          message || `Failed to load participants (${response.status})`
        );
      }

      const apiResponse = await response.json();

      const usersArray =
        apiResponse.data?.users || apiResponse.users || apiResponse.data || [];

      if (Array.isArray(usersArray)) {
        const formattedUsers = usersArray
          .map((u: any) => ({
            _id: u.id || u._id,
            firstName: u.firstName,
            lastName: u.lastName,
            email: u.email,
            role: u.role,
            avatar: u.avatar ?? undefined,
            isActive: u.isActive ?? true,
          }))
          .filter((u) => u._id && u.isActive);

        setUsers(formattedUsers);
      } else {
        throw new Error(t("messages.newConversation.participantsFormatError"));
      }
    } catch (error) {
      setUsersError(
        error instanceof Error
          ? error.message
          : t("messages.newConversation.failedToLoadParticipants")
      );
      if (users.length === 0) {
        setUsers([]);
      }
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadProperties = async () => {
    try {
      setPropertiesError(null);
      const response = await fetch("/api/properties?limit=100");
      if (!response.ok) {
        const message = await response.text();
        throw new Error(
          message || `Failed to load properties (${response.status})`
        );
      }

      const apiResponse = await response.json();

      const propertiesArray =
        apiResponse.data?.properties ||
        apiResponse.properties ||
        apiResponse.data ||
        apiResponse;
      if (!Array.isArray(propertiesArray)) {
        throw new Error(t("messages.newConversation.propertiesFormatError"));
      }

      setProperties(propertiesArray);
    } catch (error) {
      setPropertiesError(
        error instanceof Error
          ? error.message
          : t("messages.newConversation.failedToLoadProperties")
      );
      if (properties.length === 0) {
        setProperties([]);
      }
    }
  };

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setStep("type");
      setConversationType("individual");
      setConversationName("");
      setConversationDescription("");
      setSelectedProperty("");
      setSelectedParticipants([]);
      setSearchQuery("");
      setUsersError(null);
      setPropertiesError(null);
      setSubmissionError(null);
    }
  }, [open]);

  // Filter users based on search query
  const filteredUsers = users.filter((user) => {
    if (!searchQuery) {
      return true;
    }
    const searchLower = searchQuery.toLowerCase();
    const first = user.firstName?.toLowerCase?.() ?? "";
    const last = user.lastName?.toLowerCase?.() ?? "";
    const email = user.email?.toLowerCase?.() ?? "";

    return (
      first.includes(searchLower) ||
      last.includes(searchLower) ||
      email.includes(searchLower)
    );
  });

  // Handle participant selection
  const handleSelectParticipant = (user: User) => {
    if (selectedParticipants.find((p) => p._id === user._id)) {
      setSelectedParticipants((prev) => prev.filter((p) => p._id !== user._id));
    } else {
      if (
        conversationType === "individual" &&
        selectedParticipants.length >= 1
      ) {
        toast.error(t("messages.newConversation.individualLimit"));
        return;
      }
      setSelectedParticipants((prev) => [...prev, user]);
    }
  };

  // Handle form submission
  const handleCreateConversation = async () => {
    if (selectedParticipants.length === 0) {
      toast.error(t("messages.newConversation.selectParticipant"));
      return;
    }

    if (conversationType === "group" && !conversationName.trim()) {
      toast.error(t("messages.newConversation.enterGroupName"));
      return;
    }

    setLoading(true);
    setSubmissionError(null);
    try {
      await onCreateConversation({
        type: conversationType,
        name: conversationType === "group" ? conversationName : undefined,
        description: conversationDescription || undefined,
        participants: selectedParticipants.map((p) => p._id),
        propertyId: selectedProperty || undefined,
      });

      onOpenChange(false);
    } catch (error) {
      setSubmissionError(
        error instanceof Error
          ? error.message
          : t("messages.newConversation.failedToCreate")
      );
    } finally {
      setLoading(false);
    }
  };

  const renderTypeSelection = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => setConversationType("individual")}
          className={cn(
            "p-6 rounded-lg border-2 transition-all duration-200 text-start",
            conversationType === "individual"
              ? "border-blue-500 bg-blue-50"
              : "border-gray-200 hover:border-gray-300"
          )}
        >
          <User className="h-8 w-8 text-blue-500 mb-3" />
          <h3 className="font-medium text-gray-900 mb-1">
            {t("messages.newConversation.directMessage")}
          </h3>
          <p className="text-sm text-gray-500">
            {t("messages.newConversation.directMessageDesc")}
          </p>
        </button>

        <button
          onClick={() => setConversationType("group")}
          className={cn(
            "p-6 rounded-lg border-2 transition-all duration-200 text-start",
            conversationType === "group"
              ? "border-blue-500 bg-blue-50"
              : "border-gray-200 hover:border-gray-300"
          )}
        >
          <Users className="h-8 w-8 text-blue-500 mb-3" />
          <h3 className="font-medium text-gray-900 mb-1">
            {t("messages.newConversation.groupChat")}
          </h3>
          <p className="text-sm text-gray-500">
            {t("messages.newConversation.groupChatDesc")}
          </p>
        </button>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={() => {
            setSubmissionError(null);
            setStep("details");
          }}
        >
          {t("messages.newConversation.next")}
        </Button>
      </div>
    </div>
  );

  const renderDetailsForm = () => (
    <div className="space-y-4">
      {conversationType === "group" && (
        <div className="space-y-2">
          <Label htmlFor="conversation-name">
            {t("messages.newConversation.groupName")}
          </Label>
          <Input
            id="conversation-name"
            placeholder={t("messages.newConversation.groupNamePlaceholder")}
            value={conversationName}
            onChange={(e) => setConversationName(e.target.value)}
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="conversation-description">
          {t("messages.newConversation.descriptionLabel")}
        </Label>
        <Textarea
          id="conversation-description"
          placeholder={t("messages.newConversation.descriptionPlaceholder")}
          value={conversationDescription}
          onChange={(e) => setConversationDescription(e.target.value)}
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="property-select">
          {t("messages.newConversation.propertyContext")}
        </Label>
        <Select value={selectedProperty} onValueChange={setSelectedProperty}>
          <SelectTrigger>
            <SelectValue
              placeholder={t("messages.newConversation.propertyPlaceholder")}
            />
          </SelectTrigger>
          <SelectContent>
            {properties.map((property) => (
              <SelectItem key={property._id} value={property._id}>
                <div className="flex items-center gap-2">
                  <Building className="h-4 w-4" />
                  <div>
                    <div className="font-medium">{property.name}</div>
                    <div className="text-sm text-gray-500">
                      {formatAddress(property)}
                    </div>
                  </div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {propertiesError && (
          <p className="text-xs text-destructive">{propertiesError}</p>
        )}
      </div>

      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => {
            setSubmissionError(null);
            setStep("type");
          }}
        >
          {t("messages.newConversation.back")}
        </Button>
        <Button
          onClick={() => {
            setSubmissionError(null);
            setStep("participants");
          }}
        >
          {t("messages.newConversation.next")}
        </Button>
      </div>
    </div>
  );

  const renderParticipantSelection = () => (
    <div className="space-y-4">
      {/* Selected Participants */}
      {selectedParticipants.length > 0 && (
        <div className="space-y-2">
          <Label>
            {t("messages.newConversation.selectedParticipants", {
              values: { count: selectedParticipants.length },
            })}
          </Label>
          <div className="flex flex-wrap gap-2">
            {selectedParticipants.map((participant) => (
              <Badge
                key={participant._id}
                variant="secondary"
                className="flex items-center gap-2 px-3 py-1"
              >
                <Avatar className="h-5 w-5">
                  <AvatarImage src={participant.avatar} />
                  <AvatarFallback className="text-xs">
                    {participant.firstName[0]}
                    {participant.lastName[0]}
                  </AvatarFallback>
                </Avatar>
                <span>
                  {participant.firstName} {participant.lastName}
                </span>
                <button
                  onClick={() => handleSelectParticipant(participant)}
                  className="ms-1 hover:bg-gray-200 rounded-full p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* User Search */}
      <div className="space-y-2">
        <Label>{t("messages.newConversation.addParticipants")}</Label>
        <div className="relative">
          <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder={t("messages.newConversation.searchUsers")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="ps-10"
          />
        </div>
      </div>

      {usersError && users.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {usersError}
        </div>
      )}

      {/* User List */}
      <ScrollArea className="h-64 border rounded-lg">
        <div className="p-2">
          {loadingUsers ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : usersError && users.length === 0 ? (
            <div className="text-center py-8 text-destructive">
              {usersError}
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {searchQuery
                ? t("messages.newConversation.noUsersFound")
                : t("messages.newConversation.noUsersAvailable")}
            </div>
          ) : (
            filteredUsers.map((user) => {
              const isSelected = selectedParticipants.find(
                (p) => p._id === user._id
              );
              return (
                <div
                  key={user._id}
                  onClick={() => handleSelectParticipant(user)}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors",
                    isSelected
                      ? "bg-blue-50 border border-blue-200"
                      : "hover:bg-gray-50"
                  )}
                >
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={user.avatar} />
                    <AvatarFallback>
                      {user.firstName[0]}
                      {user.lastName[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">
                      {user.firstName} {user.lastName}
                    </div>
                    <div className="text-sm text-gray-500">
                      {user.email} • {user.role}
                    </div>
                  </div>
                  {isSelected && <Check className="h-5 w-5 text-blue-500" />}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {submissionError && (
        <p className="text-xs text-destructive">{submissionError}</p>
      )}

      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => {
            setSubmissionError(null);
            setStep("details");
          }}
        >
          {t("messages.newConversation.back")}
        </Button>
        <Button
          onClick={handleCreateConversation}
          disabled={selectedParticipants.length === 0 || loading}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 me-2 animate-spin" />
              {t("messages.newConversation.creating")}
            </>
          ) : (
            <>
              <MessageCircle className="h-4 w-4 me-2" />
              {t("messages.newConversation.createConversation")}
            </>
          )}
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {step === "type" && t("messages.newConversation.title.type")}
            {step === "details" && t("messages.newConversation.title.details")}
            {step === "participants" &&
              t("messages.newConversation.title.participants")}
          </DialogTitle>
          <DialogDescription>
            {step === "type" && t("messages.newConversation.description.type")}
            {step === "details" &&
              t("messages.newConversation.description.details")}
            {step === "participants" &&
              t("messages.newConversation.description.participants")}
          </DialogDescription>
        </DialogHeader>

        {step === "type" && renderTypeSelection()}
        {step === "details" && renderDetailsForm()}
        {step === "participants" && renderParticipantSelection()}
      </DialogContent>
    </Dialog>
  );
};

export default NewConversationDialog;
