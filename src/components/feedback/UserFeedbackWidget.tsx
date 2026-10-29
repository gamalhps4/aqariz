'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLocalizationContext } from '@/components/providers/LocalizationProvider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Star,
  MessageSquare,
  Send,
  AlertTriangle,
  CheckCircle,
  Clock,
  TrendingUp,
  Users,
} from 'lucide-react';

interface FeedbackEntry {
  id: string;
  userId: string;
  authorName: string | null;
  userRole: string;
  category: string;
  rating: number;
  title: string;
  description: string;
  feature?: string | null;
  priority: string;
  status: string;
  tags: string[];
  createdAt: string;
  adminResponse?: string | null;
  respondedAt?: string | null;
}

interface FeedbackSummary {
  total: number;
  averageRating: number;
  openCount: number;
  answeredCount: number;
  byCategory: Record<string, number>;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  ratingTrend: 'improving' | 'declining' | 'stable' | 'insufficient_data';
}

export default function UserFeedbackWidget() {
  const { t, formatDate } = useLocalizationContext();
  /** A stored value ("feature_request") in the reader's language. */
  const valueLabel = (group: string, value: string) =>
    t(`feedback.${group}.${value}`, { defaultValue: value.replace(/_/g, ' ') });
  const [isOpen, setIsOpen] = useState(false);
  // This Tabs primitive is controlled — it has no defaultValue prop.
  const [activeTab, setActiveTab] = useState("submit");
  const [listTab, setListTab] = useState("recent");
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    category: '',
    rating: 0,
    title: '',
    description: '',
    feature: '',
  });

  // One request: the list and its counts are derived from the same rows, so
  // fetching them separately only invited the two to disagree.
  const load = async () => {
    try {
      const response = await fetch('/api/feedback');
      const data = await response.json();

      if (data.success) {
        setFeedback(data.data.feedback ?? []);
        setSummary(data.data.summary ?? null);
      }
    } catch (err) {
      console.error('Failed to load feedback:', err);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const submitFeedback = async () => {
    if (!formData.category || !formData.rating || !formData.title || !formData.description) {
      setError(t("feedback.required", { defaultValue: "Fill in the category, rating, title and description." }));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          category: formData.category,
          rating: formData.rating,
          title: formData.title,
          description: formData.description,
          // The API rejects an empty string here; omit it instead.
          ...(formData.feature ? { feature: formData.feature } : {}),
          tags: [formData.category, formData.feature].filter(Boolean),
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(t("feedback.sent", { defaultValue: "Thank you — your feedback was sent." }));
        setFormData({
          category: '',
          rating: 0,
          title: '',
          description: '',
          feature: '',
        });
        setIsOpen(false);
        void load();
      } else {
        setError(data.message || data.error || t("feedback.failed", { defaultValue: "Could not send your feedback" }));
      }
    } catch (err) {
      setError(t("feedback.failed", { defaultValue: "Could not send your feedback" }));
    } finally {
      setLoading(false);
    }
  };

  const renderStars = (rating: number, interactive: boolean = false) => {
    return (
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`h-5 w-5 ${
              star <= rating 
                ? 'fill-yellow-400 text-yellow-400' 
                : 'text-gray-300'
            } ${interactive ? 'cursor-pointer hover:text-yellow-400' : ''}`}
            onClick={interactive ? () => setFormData({ ...formData, rating: star }) : undefined}
          />
        ))}
      </div>
    );
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      new: { variant: 'default', icon: Clock },
      reviewing: { variant: 'secondary', icon: MessageSquare },
      in_progress: { variant: 'default', icon: TrendingUp },
      resolved: { variant: 'default', icon: CheckCircle },
      closed: { variant: 'outline', icon: CheckCircle },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.new;
    const Icon = config.icon;

    return (
      <Badge variant={config.variant as any} className="flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {valueLabel('status', status)}
      </Badge>
    );
  };

  const getPriorityBadge = (priority: string) => {
    const priorityColors = {
      low: 'bg-green-500',
      medium: 'bg-yellow-500',
      high: 'bg-orange-500',
      critical: 'bg-red-500',
    };

    return (
      <Badge className={priorityColors[priority as keyof typeof priorityColors]}>
        {valueLabel('priority', priority)}
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">
          {t("feedback.title", { defaultValue: "Feedback" })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("feedback.subtitle", { defaultValue: "Tell us what works, what does not, and what you would like built next. The PropertyPro team reads every submission and replies here." })}
        </p>
      </div>

      {/* Feedback Summary Cards */}
      {summary && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {t("feedback.stats.total", { defaultValue: "Feedback sent" })}
              </CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.total}</div>
              <p className="text-xs text-muted-foreground">
                {t("feedback.stats.totalHint", { defaultValue: "All time" })}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {t("feedback.stats.rating", { defaultValue: "Average rating" })}
              </CardTitle>
              <Star className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.averageRating.toFixed(1)}/5</div>
              <div className="flex mt-1">
                {renderStars(Math.round(summary.averageRating))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {t("feedback.stats.trend", { defaultValue: "Satisfaction trend" })}
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold capitalize">
                {summary.ratingTrend === 'insufficient_data'
                  ? t("feedback.trend.insufficient", { defaultValue: "Not enough yet" })
                  : valueLabel('trend', summary.ratingTrend)}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("feedback.stats.trendHint", { defaultValue: "Recent ratings against earlier ones" })}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {t("feedback.stats.open", { defaultValue: "Still open" })}
              </CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {summary.openCount}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("feedback.stats.openHint", { defaultValue: "Awaiting an answer" })}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Feedback Widget */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>
                {t("feedback.card", { defaultValue: "Your feedback" })}
              </CardTitle>
              <CardDescription>
                {t("feedback.cardHint", { defaultValue: "Share your experience and help us improve" })}
              </CardDescription>
            </div>
            <Dialog open={isOpen} onOpenChange={setIsOpen}>
              <DialogTrigger asChild>
                <Button>
                  <MessageSquare className="h-4 w-4 me-2" />
                  {t("feedback.submit", { defaultValue: "Send feedback" })}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[525px]">
                <DialogHeader>
                  <DialogTitle>{t("feedback.submit", { defaultValue: "Send feedback" })}</DialogTitle>
                  <DialogDescription>
                    {t("feedback.cardHint", { defaultValue: "Share your experience and help us improve" })}
                  </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4">
                  {error && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="category">
                      {t("feedback.form.category", { defaultValue: "Category" })} *
                    </Label>
                    <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("feedback.form.choose", { defaultValue: "Choose…" })} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="usability">{t("feedback.category.usability", { defaultValue: "Ease of use" })}</SelectItem>
                        <SelectItem value="performance">{t("feedback.category.performance", { defaultValue: "Speed" })}</SelectItem>
                        <SelectItem value="feature_request">{t("feedback.category.feature_request", { defaultValue: "Feature request" })}</SelectItem>
                        <SelectItem value="bug_report">{t("feedback.category.bug_report", { defaultValue: "Something is broken" })}</SelectItem>
                        <SelectItem value="general">{t("feedback.category.general", { defaultValue: "General" })}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>{t("feedback.form.rating", { defaultValue: "Rating" })} *</Label>
                    <div className="flex items-center gap-2">
                      {renderStars(formData.rating, true)}
                      <span className="text-sm text-muted-foreground">
                        {formData.rating > 0 && `${formData.rating}/5`}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="title">{t("feedback.form.title", { defaultValue: "Title" })} *</Label>
                    <Input
                      id="title"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      placeholder={t("feedback.form.titlePlaceholder", { defaultValue: "In a few words" })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">
                      {t("feedback.form.description", { defaultValue: "Description" })} *
                    </Label>
                    <Textarea
                      id="description"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder={t("feedback.form.descriptionPlaceholder", { defaultValue: "What happened, and what you expected" })}
                      rows={4}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="feature">
                      {t("feedback.form.feature", { defaultValue: "Part of the app (optional)" })}
                    </Label>
                    <Select value={formData.feature} onValueChange={(value) => setFormData({ ...formData, feature: value })}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("feedback.form.choose", { defaultValue: "Choose…" })} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="payment_dashboard">{t("feedback.feature.payment_dashboard", { defaultValue: "Payments page" })}</SelectItem>
                        <SelectItem value="payment_processing">{t("feedback.feature.payment_processing", { defaultValue: "Recording payments" })}</SelectItem>
                        <SelectItem value="tenant_portal">{t("feedback.feature.tenant_portal", { defaultValue: "Tenant portal" })}</SelectItem>
                        <SelectItem value="auto_pay">{t("feedback.feature.auto_pay", { defaultValue: "Automatic payment" })}</SelectItem>
                        <SelectItem value="reports">{t("feedback.feature.reports", { defaultValue: "Reports" })}</SelectItem>
                        <SelectItem value="communication">{t("feedback.feature.communication", { defaultValue: "Messages" })}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setIsOpen(false)}>
                      {t('common.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button onClick={submitFeedback} disabled={loading}>
                      <Send className="h-4 w-4 me-2" />
                      {loading
                        ? t("feedback.sending", { defaultValue: "Sending…" })
                        : t("feedback.submit", { defaultValue: "Send feedback" })}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        
        <CardContent>
          <Tabs value={listTab} onValueChange={setListTab} className="space-y-4">
            <TabsList>
              <TabsTrigger value="recent">
                {t("feedback.tabs.recent", { defaultValue: "Recent" })}
              </TabsTrigger>
              <TabsTrigger value="summary">
                {t("feedback.tabs.summary", { defaultValue: "Summary" })}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="recent" className="space-y-4">
              {feedback.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  {t("feedback.empty", { defaultValue: "No feedback sent yet" })}
                </div>
              ) : (
                <div className="space-y-4">
                  {feedback.slice(0, 5).map((item) => (
                    <Card key={item.id}>
                      <CardContent className="pt-4">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold">{item.title}</h4>
                            {getStatusBadge(item.status)}
                            {getPriorityBadge(item.priority)}
                          </div>
                          <div className="flex items-center gap-1">
                            {renderStars(item.rating)}
                          </div>
                        </div>
                        
                        <p className="text-sm text-muted-foreground mb-2">
                          {item.description}
                        </p>
                        
                        <div className="flex justify-between items-center text-xs text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{valueLabel('category', item.category)}</Badge>
                            {item.feature && (
                              <Badge variant="outline">{valueLabel('feature', item.feature)}</Badge>
                            )}
                          </div>
                          <span>{formatDate(item.createdAt)}</span>
                        </div>

                        {item.adminResponse && (
                          <div className="mt-3 p-3 bg-muted rounded-md">
                            <div className="flex items-center gap-2 mb-1">
                              <Users className="h-4 w-4" />
                              <span className="text-sm font-medium">
                                {t("feedback.reply", { defaultValue: "Reply from the PropertyPro team" })}
                              </span>
                            </div>
                            <p className="text-sm">{item.adminResponse}</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="summary" className="space-y-4">
              {summary && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle>{t("feedback.summary.byCategory", { defaultValue: "By category" })}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {Object.entries(summary.byCategory).map(([category, count]) => (
                          <div key={category} className="flex justify-between">
                            <span className="capitalize">{valueLabel('category', category)}</span>
                            <span className="font-semibold">{count}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>{t("feedback.summary.byStatus", { defaultValue: "By status" })}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {Object.entries(summary.byStatus).map(([status, count]) => (
                          <div key={status} className="flex justify-between">
                            <span className="capitalize">{valueLabel('status', status)}</span>
                            <span className="font-semibold">{count}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>{t("feedback.summary.byPriority", { defaultValue: "By priority" })}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {Object.entries(summary.byPriority).map(([priority, count]) => (
                          <div key={priority} className="flex justify-between">
                            <span className="capitalize">{valueLabel('priority', priority)}</span>
                            <span className="font-semibold">{count}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>{t("feedback.summary.answered", { defaultValue: "Answered" })}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">
                        {summary.answeredCount}
                        <span className="text-base font-normal text-muted-foreground">
                          {' '}
                          {t("feedback.summary.of", { defaultValue: "of {total}", values: { total: summary.total } })}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("feedback.summary.repliesFrom", { defaultValue: "Replies come from the PropertyPro team." })}
                      </p>
                    </CardContent>
                  </Card>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {success && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
