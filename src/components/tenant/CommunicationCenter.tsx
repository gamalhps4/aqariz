/**
 * PropertyPro - Communication Center Component
 * Lease-specific messaging and communication with property managers
 */

"use client";

import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { isTenantRole } from "@/lib/permissions-manager";
import {
  MessageSquare,
  Send,
  Plus,
  Search,
  Calendar,
  Building2,
  User,
  Clock,
  CheckCircle,
  AlertCircle,
  Phone,
  Mail,
  Settings,
} from "lucide-react";

interface Message {
  _id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderRole: "tenant" | "manager" | "admin";
  content: string;
  timestamp: string;
  read: boolean;
  attachments?: Array<{
    name: string;
    url: string;
    type: string;
  }>;
}

interface Conversation {
  _id: string;
  subject: string;
  leaseId: string;
  propertyName: string;
  participants: Array<{
    id: string;
    name: string;
    role: string;
    email: string;
  }>;
  lastMessage: Message;
  unreadCount: number;
  status: "open" | "closed" | "pending";
  priority: "low" | "medium" | "high";
  category: "general" | "maintenance" | "payment" | "lease" | "complaint";
  createdAt: string;
  updatedAt: string;
}

interface CommunicationCenterProps {
  leases: Array<{
    _id: string;
    propertyId: { name: string };
  }>;
  className?: string;
}

export default function CommunicationCenter({
  leases,
  className,
}: CommunicationCenterProps) {
  const [conversations] = useState<Conversation[]>([
    {
      _id: "conv1",
      subject: "Maintenance Request - Kitchen Faucet",
      leaseId: "lease1",
      propertyName: "Sunset Apartments",
      participants: [
        {
          id: "tenant1",
          name: "John Doe",
          role: "tenant",
          email: "john@example.com",
        },
        {
          id: "manager1",
          name: "Sarah Wilson",
          role: "manager",
          email: "sarah@property.com",
        },
      ],
      lastMessage: {
        _id: "msg1",
        conversationId: "conv1",
        senderId: "manager1",
        senderName: "Sarah Wilson",
        senderRole: "manager",
        content:
          "I'll schedule a technician to look at the faucet tomorrow morning.",
        timestamp: "2024-01-20T10:30:00Z",
        read: false,
      },
      unreadCount: 1,
      status: "open",
      priority: "medium",
      category: "maintenance",
      createdAt: "2024-01-19T14:00:00Z",
      updatedAt: "2024-01-20T10:30:00Z",
    },
    {
      _id: "conv2",
      subject: "Lease Renewal Discussion",
      leaseId: "lease1",
      propertyName: "Sunset Apartments",
      participants: [
        {
          id: "tenant1",
          name: "John Doe",
          role: "tenant",
          email: "john@example.com",
        },
        {
          id: "manager1",
          name: "Sarah Wilson",
          role: "manager",
          email: "sarah@property.com",
        },
      ],
      lastMessage: {
        _id: "msg2",
        conversationId: "conv2",
        senderId: "tenant1",
        senderName: "John Doe",
        senderRole: "tenant",
        content:
          "I'm interested in renewing my lease for another year. What are the terms?",
        timestamp: "2024-01-18T16:45:00Z",
        read: true,
      },
      unreadCount: 0,
      status: "pending",
      priority: "high",
      category: "lease",
      createdAt: "2024-01-18T16:45:00Z",
      updatedAt: "2024-01-18T16:45:00Z",
    },
  ]);

  const [selectedConversation, setSelectedConversation] =
    useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showNewConversationDialog, setShowNewConversationDialog] =
    useState(false);
  const [newConversationData, setNewConversationData] = useState({
    subject: "",
    leaseId: "",
    category: "general",
    priority: "medium",
    content: "",
  });

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      open: { variant: "default" as const, color: "text-green-600" },
      closed: { variant: "secondary" as const, color: "text-gray-600" },
      pending: { variant: "outline" as const, color: "text-yellow-600" },
    };
    const config =
      statusConfig[status as keyof typeof statusConfig] || statusConfig.open;
    return <Badge variant={config.variant}>{status.toUpperCase()}</Badge>;
  };

  const getPriorityBadge = (priority: string) => {
    const priorityConfig = {
      high: { variant: "destructive" as const, icon: AlertCircle },
      medium: { variant: "outline" as const, icon: Clock },
      low: { variant: "secondary" as const, icon: CheckCircle },
    };
    const config =
      priorityConfig[priority as keyof typeof priorityConfig] ||
      priorityConfig.medium;
    const Icon = config.icon;
    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {priority.toUpperCase()}
      </Badge>
    );
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "maintenance":
        return <Settings className="h-4 w-4" />;
      case "payment":
        return <Calendar className="h-4 w-4" />;
      case "lease":
        return <Building2 className="h-4 w-4" />;
      default:
        return <MessageSquare className="h-4 w-4" />;
    }
  };

  const filteredConversations = conversations.filter((conv) => {
    const matchesSearch =
      conv.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
      conv.propertyName.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus =
      statusFilter === "all" || conv.status === statusFilter;
    const matchesCategory =
      categoryFilter === "all" || conv.category === categoryFilter;

    return matchesSearch && matchesStatus && matchesCategory;
  });

  const handleConversationSelect = (conversation: Conversation) => {
    setSelectedConversation(conversation);
    // Load messages for this conversation
    // This would typically fetch from an API
    setMessages([
      {
        _id: "msg1",
        conversationId: conversation._id,
        senderId: "tenant1",
        senderName: "John Doe",
        senderRole: "tenant",
        content:
          conversation.category === "maintenance"
            ? "Hi, I have an issue with the kitchen faucet. It's been dripping constantly for the past few days."
            : "I'm interested in renewing my lease for another year. What are the terms?",
        timestamp: conversation.createdAt,
        read: true,
      },
      conversation.lastMessage,
    ]);
  };

  const handleSendMessage = () => {
    if (!newMessage.trim() || !selectedConversation) return;

    const message: Message = {
      _id: `msg_${Date.now()}`,
      conversationId: selectedConversation._id,
      senderId: "tenant1",
      senderName: "John Doe",
      senderRole: "tenant",
      content: newMessage,
      timestamp: new Date().toISOString(),
      read: true,
    };

    setMessages([...messages, message]);
    setNewMessage("");
  };

  const handleCreateConversation = () => {
    if (!newConversationData.subject || !newConversationData.content) return;

    // Create new conversation logic would go here

    setShowNewConversationDialog(false);
    setNewConversationData({
      subject: "",
      leaseId: "",
      category: "general",
      priority: "medium",
      content: "",
    });
  };

  const totalUnread = conversations.reduce(
    (sum, conv) => sum + conv.unreadCount,
    0
  );

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Conversations
            </CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{conversations.length}</div>
            <p className="text-xs text-muted-foreground">
              {conversations.filter((c) => c.status === "open").length} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Unread Messages
            </CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalUnread}</div>
            <p className="text-xs text-muted-foreground">Require attention</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open Issues</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {conversations.filter((c) => c.status === "open").length}
            </div>
            <p className="text-xs text-muted-foreground">Need resolution</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Response Time</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">2.5h</div>
            <p className="text-xs text-muted-foreground">Average response</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Conversations List */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5" />
                  Conversations
                </CardTitle>
                <Dialog
                  open={showNewConversationDialog}
                  onOpenChange={setShowNewConversationDialog}
                >
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="h-4 w-4 me-2" />
                      New
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Start New Conversation</DialogTitle>
                      <DialogDescription>
                        Create a new conversation with your property manager
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium">Subject</label>
                        <Input
                          value={newConversationData.subject}
                          onChange={(e) =>
                            setNewConversationData({
                              ...newConversationData,
                              subject: e.target.value,
                            })
                          }
                          placeholder="Enter conversation subject"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium">Property</label>
                        <Select
                          value={newConversationData.leaseId}
                          onValueChange={(value) =>
                            setNewConversationData({
                              ...newConversationData,
                              leaseId: value,
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select property" />
                          </SelectTrigger>
                          <SelectContent>
                            {leases.map((lease) => (
                              <SelectItem key={lease._id} value={lease._id}>
                                {lease.propertyId.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm font-medium">
                            Category
                          </label>
                          <Select
                            value={newConversationData.category}
                            onValueChange={(value) =>
                              setNewConversationData({
                                ...newConversationData,
                                category: value,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="general">General</SelectItem>
                              <SelectItem value="maintenance">
                                Maintenance
                              </SelectItem>
                              <SelectItem value="payment">Payment</SelectItem>
                              <SelectItem value="lease">Lease</SelectItem>
                              <SelectItem value="complaint">
                                Complaint
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-sm font-medium">
                            Priority
                          </label>
                          <Select
                            value={newConversationData.priority}
                            onValueChange={(value) =>
                              setNewConversationData({
                                ...newConversationData,
                                priority: value,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="low">Low</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="high">High</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-medium">Message</label>
                        <Textarea
                          value={newConversationData.content}
                          onChange={(e) =>
                            setNewConversationData({
                              ...newConversationData,
                              content: e.target.value,
                            })
                          }
                          placeholder="Enter your message"
                          rows={4}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button onClick={handleCreateConversation}>
                          Create Conversation
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setShowNewConversationDialog(false)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
              <CardDescription>
                Your conversations with property managers
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {/* Filters */}
              <div className="p-4 border-b space-y-3">
                <div className="relative">
                  <Search className="absolute start-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search conversations..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="ps-8"
                  />
                </div>
                <div className="flex gap-2">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={categoryFilter}
                    onValueChange={setCategoryFilter}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      <SelectItem value="general">General</SelectItem>
                      <SelectItem value="maintenance">Maintenance</SelectItem>
                      <SelectItem value="payment">Payment</SelectItem>
                      <SelectItem value="lease">Lease</SelectItem>
                      <SelectItem value="complaint">Complaint</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Conversations List */}
              <ScrollArea className="h-96">
                <div className="space-y-1 p-2">
                  {filteredConversations.map((conversation) => (
                    <div
                      key={conversation._id}
                      className={`p-3 rounded-lg cursor-pointer transition-colors ${
                        selectedConversation?._id === conversation._id
                          ? "bg-primary/10 border border-primary/20"
                          : "hover:bg-muted/50"
                      }`}
                      onClick={() => handleConversationSelect(conversation)}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {getCategoryIcon(conversation.category)}
                          <span className="font-medium text-sm truncate">
                            {conversation.subject}
                          </span>
                        </div>
                        {conversation.unreadCount > 0 && (
                          <Badge variant="destructive" className="text-xs">
                            {conversation.unreadCount}
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-2 mb-2">
                        <Building2 className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          {conversation.propertyName}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mb-2">
                        {getStatusBadge(conversation.status)}
                        {getPriorityBadge(conversation.priority)}
                      </div>

                      <p className="text-xs text-muted-foreground truncate">
                        {conversation.lastMessage.content}
                      </p>

                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-muted-foreground">
                          {conversation.lastMessage.senderName}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(conversation.lastMessage.timestamp)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Message Thread */}
        <div className="lg:col-span-2">
          {selectedConversation ? (
            <Card className="h-full">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {getCategoryIcon(selectedConversation.category)}
                      {selectedConversation.subject}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-4 mt-1">
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3 w-3" />
                        {selectedConversation.propertyName}
                      </span>
                      {getStatusBadge(selectedConversation.status)}
                      {getPriorityBadge(selectedConversation.priority)}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col h-96">
                {/* Messages */}
                <ScrollArea className="flex-1 mb-4">
                  <div className="space-y-4">
                    {messages.map((message) => (
                      <div
                        key={message._id}
                        className={`flex ${
                          isTenantRole(message.senderRole)
                            ? "justify-end"
                            : "justify-start"
                        }`}
                      >
                        <div
                          className={`max-w-[70%] rounded-lg p-3 ${
                            isTenantRole(message.senderRole)
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <Avatar className="h-6 w-6">
                              <AvatarFallback className="text-xs">
                                {message.senderName
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-xs font-medium">
                              {message.senderName}
                            </span>
                            <span className="text-xs opacity-70">
                              {formatDate(message.timestamp)}
                            </span>
                          </div>
                          <p className="text-sm">{message.content}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                {/* Message Input */}
                <div className="flex gap-2">
                  <Textarea
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type your message..."
                    className="flex-1"
                    rows={2}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                  />
                  <Button
                    onClick={handleSendMessage}
                    disabled={!newMessage.trim()}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="h-full">
              <CardContent className="flex items-center justify-center h-96">
                <div className="text-center">
                  <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">
                    Select a Conversation
                  </h3>
                  <p className="text-muted-foreground">
                    Choose a conversation from the list to view messages
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
