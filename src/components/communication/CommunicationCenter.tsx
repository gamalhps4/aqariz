'use client';

import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { 
  Mail, 
  MessageSquare, 
  Send, 
  Phone, 
  CheckCircle,
  AlertTriangle,
  Search,
  Plus
} from 'lucide-react';

interface CommunicationMessage {
  id: string;
  type: 'payment_reminder' | 'overdue_notice' | 'late_fee_notice' | 'general' | 'maintenance';
  channel: 'email' | 'sms' | 'push' | 'phone';
  recipient: {
    id: string;
    name: string;
    email: string;
    phone: string;
  };
  subject: string;
  content: string;
  status: 'draft' | 'scheduled' | 'sent' | 'delivered' | 'failed' | 'opened';
  scheduledTime?: Date;
  sentTime?: Date;
  deliveredTime?: Date;
  openedTime?: Date;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  tags: string[];
  relatedPayment?: string;
}

interface CommunicationTemplate {
  id: string;
  name: string;
  type: 'payment_reminder' | 'overdue_notice' | 'late_fee_notice' | 'general';
  channel: 'email' | 'sms' | 'both';
  subject: string;
  content: string;
  variables: string[];
  isActive: boolean;
}

export default function CommunicationCenter() {
  const [messages, setMessages] = useState<CommunicationMessage[]>([
    {
      id: 'msg_1',
      type: 'payment_reminder',
      channel: 'email',
      recipient: {
        id: 'tenant_1',
        name: 'John Smith',
        email: 'john@example.com',
        phone: '+1234567890',
      },
      subject: 'Payment Reminder - Rent Due in 3 Days',
      content: 'Hi John, this is a friendly reminder that your rent payment of $1,500 is due on February 1st...',
      status: 'sent',
      sentTime: new Date('2024-01-29T09:00:00'),
      deliveredTime: new Date('2024-01-29T09:01:00'),
      openedTime: new Date('2024-01-29T10:30:00'),
      priority: 'medium',
      tags: ['automated', 'rent'],
      relatedPayment: 'pay_123',
    },
    {
      id: 'msg_2',
      type: 'overdue_notice',
      channel: 'sms',
      recipient: {
        id: 'tenant_2',
        name: 'Sarah Johnson',
        email: 'sarah@example.com',
        phone: '+1987654321',
      },
      subject: 'Overdue Payment Notice',
      content: 'URGENT: Your rent payment is now 7 days overdue. Please pay immediately to avoid additional fees.',
      status: 'delivered',
      sentTime: new Date('2024-01-30T14:00:00'),
      deliveredTime: new Date('2024-01-30T14:01:00'),
      priority: 'urgent',
      tags: ['overdue', 'urgent'],
      relatedPayment: 'pay_124',
    },
  ]);

  const [templates, setTemplates] = useState<CommunicationTemplate[]>([
    {
      id: 'tpl_1',
      name: 'Payment Reminder (7 days)',
      type: 'payment_reminder',
      channel: 'email',
      subject: 'Payment Reminder - Rent Due in {{days_until_due}} Days',
      content: 'Hi {{tenant_name}}, this is a friendly reminder that your rent payment of {{amount}} is due on {{due_date}}...',
      variables: ['tenant_name', 'amount', 'due_date', 'days_until_due'],
      isActive: true,
    },
    {
      id: 'tpl_2',
      name: 'Overdue Notice',
      type: 'overdue_notice',
      channel: 'both',
      subject: 'OVERDUE: Payment Required',
      content: 'URGENT: Your rent payment is now {{days_overdue}} days overdue. Please pay immediately...',
      variables: ['tenant_name', 'amount', 'days_overdue', 'total_due'],
      isActive: true,
    },
  ]);

  const [selectedMessages, setSelectedMessages] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [newMessage, setNewMessage] = useState({
    type: 'general',
    channel: 'email',
    recipients: [],
    subject: '',
    content: '',
    priority: 'medium',
    scheduleTime: '',
  });

  const getStatusBadge = (status: CommunicationMessage['status']) => {
    const statusConfig = {
      draft: { label: 'Draft', variant: 'secondary' },
      scheduled: { label: 'Scheduled', variant: 'default' },
      sent: { label: 'Sent', variant: 'default' },
      delivered: { label: 'Delivered', variant: 'default' },
      failed: { label: 'Failed', variant: 'destructive' },
      opened: { label: 'Opened', variant: 'default' },
    };

    const config = statusConfig[status];
    return (
      <Badge variant={config.variant as any}>
        {config.label}
      </Badge>
    );
  };

  const getPriorityBadge = (priority: CommunicationMessage['priority']) => {
    const priorityConfig = {
      low: { label: 'Low', variant: 'outline' },
      medium: { label: 'Medium', variant: 'secondary' },
      high: { label: 'High', variant: 'default' },
      urgent: { label: 'Urgent', variant: 'destructive' },
    };

    const config = priorityConfig[priority];
    return (
      <Badge variant={config.variant as any}>
        {config.label}
      </Badge>
    );
  };

  const getChannelIcon = (channel: CommunicationMessage['channel']) => {
    switch (channel) {
      case 'email':
        return <Mail className="h-4 w-4" />;
      case 'sms':
        return <MessageSquare className="h-4 w-4" />;
      case 'phone':
        return <Phone className="h-4 w-4" />;
      default:
        return <MessageSquare className="h-4 w-4" />;
    }
  };

  const filteredMessages = messages.filter(message => {
    const matchesStatus = filterStatus === 'all' || message.status === filterStatus;
    const matchesType = filterType === 'all' || message.type === filterType;
    const matchesSearch = searchQuery === '' || 
      message.recipient.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      message.subject.toLowerCase().includes(searchQuery.toLowerCase());
    
    return matchesStatus && matchesType && matchesSearch;
  });

  const handleSendMessage = async () => {
    // Implementation for sending message

  };

  const handleBulkAction = (action: string) => {

  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Communication Center</h2>
          <p className="text-muted-foreground">
            Manage tenant communications and automated messaging
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 me-2" />
                New Message
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px]">
              <DialogHeader>
                <DialogTitle>Send New Message</DialogTitle>
                <DialogDescription>
                  Send a message to tenants via email or SMS
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="message-type">Message Type</Label>
                    <Select value={newMessage.type} onValueChange={(value) => setNewMessage({ ...newMessage, type: value })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="general">General</SelectItem>
                        <SelectItem value="payment_reminder">Payment Reminder</SelectItem>
                        <SelectItem value="overdue_notice">Overdue Notice</SelectItem>
                        <SelectItem value="maintenance">Maintenance</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="channel">Channel</Label>
                    <Select value={newMessage.channel} onValueChange={(value) => setNewMessage({ ...newMessage, channel: value })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="sms">SMS</SelectItem>
                        <SelectItem value="both">Both</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="subject">Subject</Label>
                  <Input
                    id="subject"
                    value={newMessage.subject}
                    onChange={(e) => setNewMessage({ ...newMessage, subject: e.target.value })}
                    placeholder="Message subject"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="content">Message Content</Label>
                  <Textarea
                    id="content"
                    value={newMessage.content}
                    onChange={(e) => setNewMessage({ ...newMessage, content: e.target.value })}
                    placeholder="Type your message here..."
                    rows={6}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="priority">Priority</Label>
                    <Select value={newMessage.priority} onValueChange={(value) => setNewMessage({ ...newMessage, priority: value })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="schedule">Schedule (Optional)</Label>
                    <Input
                      id="schedule"
                      type="datetime-local"
                      value={newMessage.scheduleTime}
                      onChange={(e) => setNewMessage({ ...newMessage, scheduleTime: e.target.value })}
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline">Save Draft</Button>
                  <Button onClick={handleSendMessage}>
                    <Send className="h-4 w-4 me-2" />
                    Send Message
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs defaultValue="messages" className="space-y-4">
        <TabsList>
          <TabsTrigger value="messages">Messages</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="automation">Automation Rules</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="messages" className="space-y-4">
          {/* Filters and Search */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex gap-4 items-center">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute start-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search messages..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="ps-8"
                    />
                  </div>
                </div>
                
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="delivered">Delivered</SelectItem>
                    <SelectItem value="opened">Opened</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
                
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="payment_reminder">Payment Reminder</SelectItem>
                    <SelectItem value="overdue_notice">Overdue Notice</SelectItem>
                    <SelectItem value="general">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Bulk Actions */}
          {selectedMessages.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <div className="flex justify-between items-center">
                  <span>{selectedMessages.length} messages selected</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleBulkAction('resend')}>
                      Resend
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleBulkAction('delete')}>
                      Delete
                    </Button>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Messages List */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Messages</CardTitle>
              <CardDescription>
                Communication history and status tracking
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {filteredMessages.map((message) => (
                  <div key={message.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-4">
                      <input
                        type="checkbox"
                        checked={selectedMessages.includes(message.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedMessages([...selectedMessages, message.id]);
                          } else {
                            setSelectedMessages(selectedMessages.filter(id => id !== message.id));
                          }
                        }}
                      />
                      
                      <div className="flex items-center gap-2">
                        {getChannelIcon(message.channel)}
                        <div>
                          <div className="font-medium">{message.subject}</div>
                          <div className="text-sm text-muted-foreground">
                            To: {message.recipient.name} • {message.sentTime?.toLocaleString()}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex gap-2">
                        {getStatusBadge(message.status)}
                        {getPriorityBadge(message.priority)}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {message.openedTime && (
                        <div className="text-xs text-green-600">
                          Opened {message.openedTime.toLocaleString()}
                        </div>
                      )}
                      <Button size="sm" variant="outline">
                        View
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle>Message Templates</CardTitle>
                  <CardDescription>
                    Pre-configured templates for automated messaging
                  </CardDescription>
                </div>
                <Button>
                  <Plus className="h-4 w-4 me-2" />
                  New Template
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {templates.map((template) => (
                  <div key={template.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <div className="font-medium">{template.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {template.type.replace('_', ' ').toUpperCase()} • {template.channel.toUpperCase()}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Variables: {template.variables.join(', ')}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Badge variant={template.isActive ? 'default' : 'secondary'}>
                        {template.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                      <Button size="sm" variant="outline">
                        Edit
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="automation" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Automation Rules</CardTitle>
              <CardDescription>
                Configure automated communication workflows
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    Automation rules are managed in the main Automation dashboard. 
                    This section shows communication-specific automation settings.
                  </AlertDescription>
                </Alert>
                
                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Payment Reminders</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm">
                        <div>• 7 days before due date</div>
                        <div>• 3 days before due date</div>
                        <div>• 1 day before due date</div>
                        <div>• Day of due date</div>
                      </div>
                    </CardContent>
                  </Card>
                  
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Overdue Notices</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm">
                        <div>• 1 day overdue</div>
                        <div>• 5 days overdue (with late fee)</div>
                        <div>• 15 days overdue</div>
                        <div>• 30 days overdue (escalation)</div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Messages Sent</CardTitle>
                <Send className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">1,234</div>
                <p className="text-xs text-muted-foreground">This month</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Delivery Rate</CardTitle>
                <CheckCircle className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">98.5%</div>
                <p className="text-xs text-muted-foreground">Successfully delivered</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Open Rate</CardTitle>
                <Mail className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">76.2%</div>
                <p className="text-xs text-muted-foreground">Email open rate</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Response Rate</CardTitle>
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">23.1%</div>
                <p className="text-xs text-muted-foreground">Tenant responses</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
