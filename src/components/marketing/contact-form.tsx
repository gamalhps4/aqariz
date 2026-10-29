"use client";

/**
 * Public contact section: pick a topic, then write.
 *
 * This page used to be four `mailto:` cards, which meant every enquiry landed
 * in a personal mailbox with no trail and no way to tell whether anyone had
 * answered. It is one form now: the topic still routes the message, but as a
 * pill row inside the form rather than a screen of cards to read first. The
 * support address stays on the page for people who prefer their own client.
 */

import { useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  CheckCircle2,
  LifeBuoy,
  Loader2,
  Mail,
  Send,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export type ContactTopic = "support" | "sales" | "billing" | "security";

/**
 * Every word the form shows, in the page's language — drawn on the server from
 * the catalogue (`site.contact.*`) and handed down, since the form is the one
 * client part of the page. `{topic}` in `mailSubject` is filled in here.
 */
export interface ContactFormLabels {
  formTitle: string;
  formLead: string;
  topic: string;
  topics: Record<ContactTopic, { title: string; hint: string }>;
  sent: string;
  name: string;
  email: string;
  company: string;
  subject: string;
  message: string;
  messagePlaceholder: string;
  honeypot: string;
  preferMail: string;
  mailSubject: string;
  sending: string;
  send: string;
  success: string;
  error: {
    failed: string;
    rateLimited: string;
    name: string;
    email: string;
    subject: string;
    message: string;
  };
}

interface Channel {
  topic: ContactTopic;
  icon: LucideIcon;
}

const CHANNELS: Channel[] = [
  { topic: "support", icon: LifeBuoy },
  { topic: "sales", icon: Building2 },
  { topic: "billing", icon: Mail },
  { topic: "security", icon: ShieldCheck },
];

/** The server's own checks (api/contact), made here first so a mistake is
 * reported in the page's language rather than the API's English. */
function invalidField(
  form: typeof EMPTY_FORM,
  labels: ContactFormLabels,
): string | null {
  if (form.name.trim().length < 2) return labels.error.name;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return labels.error.email;
  if (form.subject.trim().length < 3) return labels.error.subject;
  if (form.message.trim().length < 20) return labels.error.message;
  return null;
}

const EMPTY_FORM = {
  name: "",
  email: "",
  company: "",
  subject: "",
  message: "",
};

export function ContactSection({
  supportEmail,
  labels,
}: {
  supportEmail: string;
  labels: ContactFormLabels;
}) {
  const [topic, setTopic] = useState<ContactTopic>("support");
  const [form, setForm] = useState(EMPTY_FORM);
  const [website, setWebsite] = useState(""); // honeypot
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const activeChannel =
    CHANNELS.find((channel) => channel.topic === topic) ?? CHANNELS[0];

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = invalidField(form, labels);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSending(true);
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          ...form,
          company: form.company || null,
          website,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        // The API answers in English; the visitor is told in the page's
        // language. Its field checks were already made above.
        throw new Error(
          response.status === 429 ? labels.error.rateLimited : labels.error.failed,
        );
      }
      setForm(EMPTY_FORM);
      setSent(true);
      toast.success(labels.success);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : labels.error.failed,
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto mt-14 max-w-4xl px-5 sm:px-8">
      <form
        onSubmit={submit}
        className="rounded-2xl border border-slate-200 p-6 sm:p-8"
      >
        <h2 className="text-lg font-semibold text-slate-900">
          {labels.formTitle}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {labels.formLead}
        </p>

        {/* The topic is what routes the enquiry, so it leads the form. */}
        <fieldset className="mt-6">
          <legend className="text-sm font-medium text-slate-900">{labels.topic}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {CHANNELS.map((channel) => {
              const isActive = channel.topic === topic;
              return (
                <button
                  key={channel.topic}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => {
                    setTopic(channel.topic);
                    setSent(false);
                  }}
                  className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition ${
                    isActive
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-300 text-slate-700 hover:border-blue-300 hover:text-blue-700"
                  }`}
                >
                  <channel.icon className="size-4" aria-hidden="true" />
                  {labels.topics[channel.topic].title}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            {labels.topics[activeChannel.topic].hint}
          </p>
        </fieldset>

        {sent && (
          <div className="mt-5 flex items-start gap-2.5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <p>{labels.sent}</p>
          </div>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field
            id="contact-name"
            label={labels.name}
            value={form.name}
            onChange={(name) => setForm({ ...form, name })}
            autoComplete="name"
            required
          />
          <Field
            id="contact-email"
            label={labels.email}
            type="email"
            value={form.email}
            onChange={(email) => setForm({ ...form, email })}
            autoComplete="email"
            required
          />
          <Field
            id="contact-company"
            label={labels.company}
            value={form.company}
            onChange={(company) => setForm({ ...form, company })}
            autoComplete="organization"
          />
          <Field
            id="contact-subject"
            label={labels.subject}
            value={form.subject}
            onChange={(subject) => setForm({ ...form, subject })}
            required
          />
        </div>

        <div className="mt-4">
          <label
            htmlFor="contact-message"
            className="block text-sm font-medium text-slate-900"
          >
            {labels.message}
          </label>
          <textarea
            id="contact-message"
            rows={6}
            required
            minLength={20}
            maxLength={5000}
            value={form.message}
            onChange={(event) =>
              setForm({ ...form, message: event.target.value })
            }
            placeholder={labels.messagePlaceholder}
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        {/* Honeypot: hidden from people and assistive tech, so only bots ever
            fill it in. Clipped to nothing in place rather than pushed
            off-screen: at left:-9999px it would add sideways scroll to the
            Arabic (right-to-left) page. */}
        <div
          aria-hidden="true"
          className="absolute -m-px size-px overflow-hidden whitespace-nowrap border-0 p-0 [clip-path:inset(50%)] [clip:rect(0_0_0_0)]"
        >
          <label htmlFor="contact-website">{labels.honeypot}</label>
          <input
            id="contact-website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs leading-relaxed text-slate-500">
            {labels.preferMail}{" "}
            <a
              className="font-medium text-blue-600 hover:underline"
              dir="ltr"
              href={`mailto:${supportEmail}?subject=${encodeURIComponent(
                labels.mailSubject.replace(
                  "{topic}",
                  labels.topics[activeChannel.topic].title,
                ),
              )}`}
            >
              {supportEmail}
            </a>
            .
          </p>
          <button
            type="submit"
            disabled={sending}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            {sending ? labels.sending : labels.send}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  required = false,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  autoComplete?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-900">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        required={required}
        autoComplete={autoComplete}
        // An address reads left to right on the Arabic page too.
        dir={type === "email" ? "ltr" : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      />
    </div>
  );
}
