import type {
  Conversation,
  LastMessage,
  Message,
  MessageAttachment,
  Participant,
} from "./types";

export function normalizeId(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if (value._id) return normalizeId(value._id);
    if (value.id) return normalizeId(value.id);
    if (typeof value.toString === "function") return value.toString();
  }
  return String(value);
}

function extractParticipant(raw: any): Participant | null {
  if (!raw) return null;
  const user = raw.userId || raw.user || raw;
  const id = normalizeId(
    user?._id ?? user?.id ?? raw.userId ?? raw.id ?? raw
  );
  if (!id) return null;

  const firstName = user?.firstName ?? raw.firstName ?? "";
  const lastName = user?.lastName ?? raw.lastName ?? "";
  const email = user?.email ?? raw.email ?? "";
  const avatar = user?.avatar ?? raw.avatar ?? null;
  const role = user?.role ?? raw.role ?? undefined;
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  return {
    id,
    name: fullName || email || "Unknown",
    email,
    avatar: avatar || null,
    role,
  };
}

export function normalizeConversation(raw: any): Conversation | null {
  if (!raw) return null;
  const id = normalizeId(raw._id ?? raw.id);
  if (!id) return null;

  const participantsRaw: any[] = Array.isArray(raw.participants)
    ? raw.participants
    : [];
  const participants = participantsRaw
    .map(extractParticipant)
    .filter((p): p is Participant => Boolean(p));

  let lastMessage: LastMessage | null = null;
  const rawLast = raw.lastMessage;
  if (rawLast && typeof rawLast === "object") {
    const senderId = normalizeId(
      rawLast.senderId?._id ?? rawLast.senderId ?? rawLast.sender?._id ?? rawLast.sender?.id
    );
    const matched = participants.find((p) => p.id === senderId);
    lastMessage = {
      messageId: normalizeId(rawLast.messageId ?? rawLast._id ?? rawLast.id),
      content: rawLast.content ?? "",
      createdAt: rawLast.createdAt ?? null,
      senderId,
      senderName:
        rawLast.senderName ||
        matched?.name ||
        "",
    };
  }

  const lastActivityAt =
    raw.lastActivity ||
    raw.metadata?.lastActivity ||
    raw.updatedAt ||
    raw.createdAt ||
    lastMessage?.createdAt ||
    null;

  return {
    id,
    type: (raw.type === "group" ? "group" : "individual") as "individual" | "group",
    participants,
    lastMessage,
    lastActivityAt: lastActivityAt ? new Date(lastActivityAt).toISOString() : null,
    unreadCount: typeof raw.unreadCount === "number" ? raw.unreadCount : 0,
  };
}

function normalizeAttachment(raw: any): MessageAttachment | null {
  if (!raw) return null;
  return {
    id: normalizeId(raw._id ?? raw.id ?? raw.fileUrl),
    fileName: raw.fileName || raw.name || "file",
    fileUrl: raw.fileUrl || raw.url || "",
    fileType: raw.fileType || inferFileType(raw.mimeType || raw.type || ""),
    fileSize: typeof raw.fileSize === "number" ? raw.fileSize : raw.size ?? 0,
    mimeType: raw.mimeType || raw.type || null,
    createdAt: raw.createdAt || new Date().toISOString(),
  };
}

function inferFileType(mime: string): string {
  if (!mime) return "file";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  return "file";
}

export function normalizeMessage(raw: any): Message | null {
  if (!raw) return null;
  const id = normalizeId(raw._id ?? raw.id);
  if (!id) return null;

  const senderSource = raw.senderId ?? raw.sender;
  const senderId = normalizeId(senderSource?._id ?? senderSource?.id ?? senderSource);
  const senderObj = typeof senderSource === "object" && senderSource !== null ? senderSource : null;
  const firstName = senderObj?.firstName ?? "";
  const lastName = senderObj?.lastName ?? "";
  const senderName =
    [firstName, lastName].filter(Boolean).join(" ").trim() ||
    senderObj?.email ||
    raw.senderName ||
    "";

  const attachments = Array.isArray(raw.attachments)
    ? raw.attachments.map(normalizeAttachment).filter((a: MessageAttachment | null): a is MessageAttachment => Boolean(a))
    : [];

  return {
    id,
    conversationId: normalizeId(raw.conversationId),
    senderId,
    senderName,
    senderAvatar: senderObj?.avatar || null,
    content: raw.content ?? "",
    attachments,
    status: raw.status || "sent",
    createdAt: raw.createdAt || new Date().toISOString(),
    isDeleted: Boolean(raw.isDeleted),
  };
}

export function getInitials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "?";
  return parts.map((p) => p[0]?.toUpperCase() || "").join("");
}
