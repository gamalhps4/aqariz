/**
 * Feedback, organization side: write it, and read what has been written.
 *
 * Triage — status, priority, and the reply — belongs to the platform and lives
 * at /admin/feedback. An org admin used to be able to mark their own request
 * "resolved", which said nothing about whether it would ever be built.
 *
 * The heading lives in the widget, which is a client component and so can
 * speak the reader's language.
 */

import type { Metadata } from "next";
import UserFeedbackWidget from "@/components/feedback/UserFeedbackWidget";

export const metadata: Metadata = {
  title: "Feedback",
};

export default function FeedbackPage() {
  return (
    <div className="space-y-6 p-6">
      <UserFeedbackWidget />
    </div>
  );
}
