export type ConversationType = "individual" | "group";

export type Participant = {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  role?: string;
};

export type LastMessage = {
  messageId: string;
  content: string;
  createdAt: string | null;
  senderId: string;
  senderName: string;
};

export type Conversation = {
  id: string;
  type: ConversationType;
  participants: Participant[];
  lastMessage: LastMessage | null;
  lastActivityAt: string | null;
  unreadCount: number;
};

export type MessageAttachment = {
  id: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  mimeType: string | null;
  createdAt: string;
};

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string | null;
  content: string;
  attachments: MessageAttachment[];
  status: "sent" | "delivered" | "read" | "failed" | string;
  createdAt: string;
  isDeleted: boolean;
};
