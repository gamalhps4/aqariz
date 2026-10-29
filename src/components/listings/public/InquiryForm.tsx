"use client";

/**
 * PropertyPro - "Ask about this property": the public inquiry form
 *
 * Name, phone, an optional email and message, and a field a person never sees
 * (`website`) that a bot fills in. The words come in as props — the page was
 * drawn in one language on the server and the form must say the same — and the
 * message goes to /api/public/listings/{id}/inquiries, which does the
 * validating, the rate limiting and the storing. What it answers is shown
 * here as it is: field errors beside the field, "try again later" for a rate
 * limit, a confirmation in place of the form on success.
 */

import { useState } from "react";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { HONEYPOT_FIELD, type InquiryErrorCode } from "@/lib/listings/inquiry-fields";

export interface InquiryFormLabels {
  heading: string;
  hint: string;
  name: string;
  phone: string;
  phoneHint: string;
  email: string;
  message: string;
  messagePlaceholder: string;
  submit: string;
  sending: string;
  successTitle: string;
  successText: string;
  again: string;
  honeypot: string;
  failed: string;
  rateLimited: string;
  notAvailable: string;
  privacy: string;
  error: Record<InquiryErrorCode, string>;
}

interface InquiryFormProps {
  listingId: string;
  labels: InquiryFormLabels;
  dir: "rtl" | "ltr";
}

type FieldErrors = Partial<Record<"name" | "phone" | "email" | "message", InquiryErrorCode>>;

export function InquiryForm({ listingId, labels, dir }: InquiryFormProps) {
  const [values, setValues] = useState({
    name: "",
    phone: "",
    email: "",
    message: "",
    [HONEYPOT_FIELD]: "",
  });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const set = (key: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setProblem(null);
    setFieldErrors({});
    try {
      const response = await fetch(`/api/public/listings/${listingId}/inquiries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const payload = await response.json().catch(() => null);

      if (response.ok && payload?.success) {
        setSent(true);
        return;
      }
      if (response.status === 400 && payload?.fields) {
        setFieldErrors(payload.fields as FieldErrors);
        return;
      }
      if (response.status === 429) {
        setProblem(labels.rateLimited);
        return;
      }
      if (response.status === 404) {
        setProblem(labels.notAvailable);
        return;
      }
      setProblem(labels.failed);
    } catch {
      setProblem(labels.failed);
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div className="space-y-3 rounded-2xl border border-success/30 bg-success/10 p-5 text-center" role="status">
        <CheckCircle2 className="mx-auto h-8 w-8 text-success" />
        <p className="font-semibold">{labels.successTitle}</p>
        <p className="text-sm text-muted-foreground">{labels.successText}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setSent(false);
            setValues((current) => ({ ...current, message: "" }));
          }}
        >
          {labels.again}
        </Button>
      </div>
    );
  }

  const errorOf = (field: keyof FieldErrors) =>
    fieldErrors[field] ? labels.error[fieldErrors[field]!] : null;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate dir={dir}>
      <div>
        <h2 className="text-lg font-semibold">{labels.heading}</h2>
        <p className="text-sm text-muted-foreground">{labels.hint}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="inquiry-name">{labels.name}</Label>
        <Input
          id="inquiry-name"
          name="name"
          autoComplete="name"
          required
          maxLength={120}
          value={values.name}
          onChange={(event) => set("name")(event.target.value)}
          aria-invalid={Boolean(errorOf("name"))}
        />
        {errorOf("name") && <p className="text-sm text-destructive">{errorOf("name")}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="inquiry-phone">{labels.phone}</Label>
        <Input
          id="inquiry-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          dir="ltr"
          placeholder="05XXXXXXXX"
          maxLength={30}
          value={values.phone}
          onChange={(event) => set("phone")(event.target.value)}
          aria-invalid={Boolean(errorOf("phone"))}
          className={dir === "rtl" ? "text-end" : undefined}
        />
        <p className="text-xs text-muted-foreground">{labels.phoneHint}</p>
        {errorOf("phone") && <p className="text-sm text-destructive">{errorOf("phone")}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="inquiry-email">{labels.email}</Label>
        <Input
          id="inquiry-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          dir="ltr"
          maxLength={200}
          value={values.email}
          onChange={(event) => set("email")(event.target.value)}
          aria-invalid={Boolean(errorOf("email"))}
          className={dir === "rtl" ? "text-end" : undefined}
        />
        {errorOf("email") && <p className="text-sm text-destructive">{errorOf("email")}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="inquiry-message">{labels.message}</Label>
        <Textarea
          id="inquiry-message"
          name="message"
          rows={4}
          maxLength={1000}
          placeholder={labels.messagePlaceholder}
          value={values.message}
          onChange={(event) => set("message")(event.target.value)}
          aria-invalid={Boolean(errorOf("message"))}
        />
        {errorOf("message") && (
          <p className="text-sm text-destructive">{errorOf("message")}</p>
        )}
      </div>

      {/* The honeypot. A person never sees it, tabs to it or fills it; a bot
          that fills every input does. Clipped to nothing rather than
          display:none, which some bots skip — and not pushed off-screen: at
          left:-10000px it widened the Arabic (right-to-left) page by 10,000px
          of sideways scroll. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          margin: -1,
          padding: 0,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          clipPath: "inset(50%)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        <label htmlFor="inquiry-website">{labels.honeypot}</label>
        <input
          id="inquiry-website"
          name={HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={values[HONEYPOT_FIELD]}
          onChange={(event) => set(HONEYPOT_FIELD)(event.target.value)}
        />
      </div>

      {problem && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {problem}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={sending}>
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 rtl:-scale-x-100" />}
        {sending ? labels.sending : labels.submit}
      </Button>
      <p className="text-xs text-muted-foreground">{labels.privacy}</p>
    </form>
  );
}
