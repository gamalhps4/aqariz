/**
 * PropertyPro - Conversations Management Hook
 * React hook for managing conversations and messages
 */

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";

export interface Conversation {
  _id: string;
  name?: string;
  description?: string;
  type: "individual" | "group" | "announcement";
  participants: Array<{
    userId: {
      _id: string;
      firstName: string;
      lastName: string;
      email: string;
      avatar?: string;
    };
    role: "admin" | "member";
    joinedAt: Date;
    lastReadAt?: Date;
    isActive: boolean;
    permissions: {
      canAddMembers: boolean;
      canRemoveMembers: boolean;
      canEditConversation: boolean;
      canDeleteMessages: boolean;
    };
  }>;
  lastMessage?: {
    messageId: string;
    content: string;
    senderId: string;
    senderName: string;
    createdAt: Date;
    messageType: string;
  };
  settings: {
    allowFileSharing: boolean;
    allowMemberInvites: boolean;
    muteNotifications: boolean;
    autoDeleteMessages: boolean;
    autoDeleteDays?: number;
    requireApprovalForNewMembers: boolean;
  };
  unreadCount: number;
  isArchived: boolean;
  isPinned: boolean;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  _id: string;
  conversationId: string;
  senderId: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
    avatar?: string;
  };
  content: string;
  messageType:
    | "general"
    | "maintenance"
    | "payment"
    | "lease"
    | "emergency"
    | "announcement"
    | "system";
  priority: "low" | "normal" | "high" | "urgent";
  status: "sent" | "delivered" | "read" | "failed";
  attachments?: Array<{
    fileName: string;
    fileUrl: string;
    fileSize: number;
    fileType: string;
    thumbnailUrl?: string;
  }>;
  readAt?: Date;
  deliveredAt?: Date;
  replyToId?: {
    _id: string;
    content: string;
    senderId: string;
    createdAt: Date;
  };
  forwardedFromId?: string;
  isSystemMessage: boolean;
  isEdited: boolean;
  editedAt?: Date;
  mentions?: Array<{
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface UseConversationsReturn {
  // State
  conversations: Conversation[];
  currentConversation: Conversation | null;
  messages: Message[];
  loading: boolean;
  error: string | null;
  totalUnread: number;

  // Conversation management
  loadConversations: (options?: {
    includeArchived?: boolean;
    propertyId?: string;
    type?: string;
    search?: string;
  }) => Promise<void>;

  selectConversation: (conversationId: string) => Promise<void>;
  createConversation: (data: {
    type: "individual" | "group";
    name?: string;
    participants: string[];
    propertyId?: string;
  }) => Promise<void>;

  updateConversation: (
    conversationId: string,
    updates: Partial<Conversation>
  ) => Promise<void>;
  archiveConversation: (conversationId: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;

  // Message management
  loadMessages: (
    conversationId: string,
    options?: {
      page?: number;
      limit?: number;
      beforeDate?: Date;
      afterDate?: Date;
      messageType?: string;
    }
  ) => Promise<void>;

  sendMessage: (data: {
    content: string;
    messageType?: string;
    priority?: string;
    replyToId?: string;
    mentions?: string[];
    attachments?: any[];
  }) => Promise<void>;

  editMessage: (messageId: string, content: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  markAsRead: (messageId: string) => Promise<void>;

  // Search
  searchMessages: (
    query: string,
    options?: {
      conversationId?: string;
      messageType?: string;
    }
  ) => Promise<Message[]>;

  // Participants
  addParticipant: (
    conversationId: string,
    userId: string,
    role?: "admin" | "member"
  ) => Promise<void>;
  removeParticipant: (conversationId: string, userId: string) => Promise<void>;
  updateParticipant: (
    conversationId: string,
    userId: string,
    updates: any
  ) => Promise<void>;
}

export const useConversations = (): UseConversationsReturn => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] =
    useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalUnread, setTotalUnread] = useState(0);

  // Socket.io functionality removed - using database-only approach

  // API helper function
  const apiCall = async (url: string, options: RequestInit = {}) => {
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: "Network error" }));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return response.json();
  };

  // Load conversations
  const loadConversations = useCallback(
    async (
      options: {
        includeArchived?: boolean;
        propertyId?: string;
        type?: string;
        search?: string;
      } = {}
    ) => {
      try {
        setLoading(true);
        setError(null);

        const params = new URLSearchParams();
        if (options.includeArchived) params.set("includeArchived", "true");
        if (options.propertyId) params.set("propertyId", options.propertyId);
        if (options.type) params.set("type", options.type);
        if (options.search) params.set("search", options.search);

        const data = await apiCall(`/api/conversations?${params}`);

        setConversations(data?.conversations ?? []);
        setTotalUnread(data?.totalUnread ?? 0);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to load conversations";
        setError(errorMessage);
        toast.error(errorMessage);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Select conversation and load messages
  const selectConversation = useCallback(async (conversationId: string) => {
    try {
      setLoading(true);
      setError(null);

      // Get conversation details
      const conversationData = await apiCall(
        `/api/conversations/${conversationId}`
      );
      setCurrentConversation(conversationData?.conversation ?? null);

      // Load messages
      await loadMessages(conversationId);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to select conversation";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load messages for a conversation
  const loadMessages = useCallback(
    async (
      conversationId: string,
      options: {
        page?: number;
        limit?: number;
        beforeDate?: Date;
        afterDate?: Date;
        messageType?: string;
      } = {}
    ) => {
      try {
        const params = new URLSearchParams();
        params.set("conversationId", conversationId);
        if (options.page) params.set("page", options.page.toString());
        if (options.limit) params.set("limit", options.limit.toString());
        if (options.beforeDate)
          params.set("beforeDate", options.beforeDate.toISOString());
        if (options.afterDate)
          params.set("afterDate", options.afterDate.toISOString());
        if (options.messageType) params.set("messageType", options.messageType);

        const data = await apiCall(`/api/messages?${params}`);
        const messages = data?.messages ?? [];

        if (options.page && options.page > 1) {
          // Append to existing messages (pagination)
          setMessages((prev) => [...prev, ...messages]);
        } else {
          // Replace messages (new conversation or refresh)
          setMessages(messages);
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to load messages";
        setError(errorMessage);
        toast.error(errorMessage);
      }
    },
    []
  );

  // Create conversation
  const createConversation = useCallback(
    async (data: {
      type: "individual" | "group";
      name?: string;
      participants: string[];
      propertyId?: string;
    }) => {
      try {
        setLoading(true);
        setError(null);

        const response = await apiCall("/api/conversations", {
          method: "POST",
          body: JSON.stringify(data),
        });

        const conversation = response?.conversation;
        // Add to conversations list
        if (conversation) {
          setConversations((prev) => [conversation, ...prev]);
        }

        toast.success("Conversation created successfully");
        return conversation;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to create conversation";
        setError(errorMessage);
        toast.error(errorMessage);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Send message
  const sendMessage = useCallback(
    async (data: {
      content: string;
      messageType?: string;
      priority?: string;
      replyToId?: string;
      mentions?: string[];
      attachments?: any[];
    }) => {
      if (!currentConversation) {
        toast.error("No conversation selected");
        return;
      }

      try {
        const messageData = {
          conversationId: currentConversation._id,
          ...data,
        };

        // Send message via API
        const response = await apiCall("/api/messages", {
          method: "POST",
          body: JSON.stringify(messageData),
        });

        const message = response?.message;
        // Add message to local state
        if (message) {
          setMessages((prev) => [message, ...prev]);
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to send message";
        setError(errorMessage);
        toast.error(errorMessage);
      }
    },
    [currentConversation]
  );

  // Edit message
  const editMessage = useCallback(
    async (messageId: string, content: string) => {
      try {
        // Edit message via API
        await apiCall(`/api/messages/${messageId}`, {
          method: "PATCH",
          body: JSON.stringify({ content }),
        });

        // Update local state
        setMessages((prev) =>
          prev.map((msg) =>
            msg._id === messageId
              ? { ...msg, content, isEdited: true, editedAt: new Date() }
              : msg
          )
        );
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to edit message";
        toast.error(errorMessage);
      }
    },
    []
  );

  // Delete message
  const deleteMessage = useCallback(async (messageId: string) => {
    try {
      // Delete message via API
      await apiCall(`/api/messages/${messageId}`, {
        method: "DELETE",
      });

      // Remove from local state
      setMessages((prev) => prev.filter((msg) => msg._id !== messageId));
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to delete message";
      toast.error(errorMessage);
    }
  }, []);

  // Mark message as read
  const markAsRead = useCallback(
    async (messageId: string) => {
      if (!currentConversation) return;

      try {
        // Mark message as read via API
        await apiCall(`/api/messages/${messageId}/read`, {
          method: "PATCH",
        });

        // Update local state
        setMessages((prev) =>
          prev.map((msg) =>
            msg._id === messageId
              ? { ...msg, status: "read", readAt: new Date() }
              : msg
          )
        );
      } catch (err) {
        console.error("Failed to mark message as read:", err);
      }
    },
    [currentConversation]
  );

  // Search messages
  const searchMessages = useCallback(
    async (
      query: string,
      options: {
        conversationId?: string;
        messageType?: string;
      } = {}
    ): Promise<Message[]> => {
      try {
        const params = new URLSearchParams();
        params.set("type", "search");
        params.set("search", query);
        if (options.conversationId)
          params.set("conversationId", options.conversationId);
        if (options.messageType) params.set("messageType", options.messageType);

        const data = await apiCall(`/api/messages?${params}`);
        return data?.messages ?? [];
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to search messages";
        toast.error(errorMessage);
        return [];
      }
    },
    []
  );

  // Placeholder functions for participant management
  const addParticipant = useCallback(
    async (
      conversationId: string,
      userId: string,
      role: "admin" | "member" = "member"
    ) => {
      try {
        await apiCall(`/api/conversations/${conversationId}/participants`, {
          method: "POST",
          body: JSON.stringify({ userId, role }),
        });
        toast.success("Participant added successfully");
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to add participant";
        toast.error(errorMessage);
      }
    },
    []
  );

  const removeParticipant = useCallback(
    async (conversationId: string, userId: string) => {
      try {
        await apiCall(
          `/api/conversations/${conversationId}/participants?userId=${userId}`,
          {
            method: "DELETE",
          }
        );
        toast.success("Participant removed successfully");
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to remove participant";
        toast.error(errorMessage);
      }
    },
    []
  );

  const updateParticipant = useCallback(
    async (conversationId: string, userId: string, updates: any) => {
      try {
        await apiCall(
          `/api/conversations/${conversationId}/participants?userId=${userId}`,
          {
            method: "PATCH",
            body: JSON.stringify(updates),
          }
        );
        toast.success("Participant updated successfully");
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to update participant";
        toast.error(errorMessage);
      }
    },
    []
  );

  const updateConversation = useCallback(
    async (conversationId: string, updates: Partial<Conversation>) => {
      try {
        await apiCall(`/api/conversations/${conversationId}`, {
          method: "PATCH",
          body: JSON.stringify(updates),
        });
        toast.success("Conversation updated successfully");
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to update conversation";
        toast.error(errorMessage);
      }
    },
    []
  );

  const archiveConversation = useCallback(
    async (conversationId: string) => {
      await updateConversation(conversationId, { isArchived: true });
    },
    [updateConversation]
  );

  const deleteConversation = useCallback(
    async (conversationId: string) => {
      try {
        await apiCall(`/api/conversations/${conversationId}?action=delete`, {
          method: "DELETE",
        });
        setConversations((prev) =>
          prev.filter((conv) => conv._id !== conversationId)
        );
        if (currentConversation?._id === conversationId) {
          setCurrentConversation(null);
          setMessages([]);
        }
        toast.success("Conversation deleted successfully");
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to delete conversation";
        toast.error(errorMessage);
      }
    },
    [currentConversation]
  );

  // Real-time functionality removed - using database-only approach

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  return {
    conversations,
    currentConversation,
    messages,
    loading,
    error,
    totalUnread,
    loadConversations,
    selectConversation,
    createConversation,
    updateConversation,
    archiveConversation,
    deleteConversation,
    loadMessages,
    sendMessage,
    editMessage,
    deleteMessage,
    markAsRead,
    searchMessages,
    addParticipant,
    removeParticipant,
    updateParticipant,
  };
};
