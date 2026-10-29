import type { Metadata } from "next";
import Link from "next/link";
import { getPlatformSettings } from "@/lib/platform/settings";
import {
  MarketingPageShell,
  MarketingPageHeader,
  LegalDocument,
} from "@/components/marketing/page-shell";
import {
  LEGAL_ENTITY_NAME,
  LEGAL_JURISDICTION,
  LEGAL_LAST_UPDATED,
} from "@/lib/marketing/legal";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const { general } = await getPlatformSettings();
  return {
    // The layout's title template adds the site name.
    title: "Terms of Service",
    description: `The agreement governing your use of ${general.platformName}.`,
  };
}

export default async function TermsPage() {
  const { general } = await getPlatformSettings();
  const product = general.platformName;
  const entity = LEGAL_ENTITY_NAME || product;
  const jurisdiction =
    LEGAL_JURISDICTION || "the jurisdiction in which we are established";
  const support = general.supportEmail || "support@example.com";

  return (
    <MarketingPageShell>
      <MarketingPageHeader
        eyebrow="Legal"
        title="Terms of Service"
        lead={`These terms form the agreement between you and ${entity} for the use of ${product}.`}
      />
      <LegalDocument
        lastUpdated={LEGAL_LAST_UPDATED}
        intro={`By creating an account, subscribing, or otherwise using ${product} (the "Service"), you agree to these Terms. If you are accepting on behalf of a company, you confirm you have authority to bind that company, and "you" refers to it.`}
        sections={[
          {
            heading: "The service",
            body: (
              <>
                <p>
                  {product} is property-management software provided on a
                  subscription basis. We grant you a non-exclusive,
                  non-transferable right to access and use the Service for your
                  internal business purposes for as long as your subscription is
                  active and you comply with these Terms.
                </p>
                <p>
                  We may add, change or remove features. If we remove a feature
                  that is material to a paid plan, we will give you reasonable
                  notice by email.
                </p>
              </>
            ),
          },
          {
            heading: "Accounts and access",
            body: (
              <>
                <p>
                  You are responsible for the accuracy of your account details,
                  for keeping credentials confidential, and for all activity that
                  occurs under your organization&apos;s accounts. Tell us
                  promptly at {support} if you suspect unauthorised access.
                </p>
                <p>
                  You control which of your staff and tenants have access, and at
                  what permission level. You are responsible for what those
                  people do with the access you grant.
                </p>
              </>
            ),
          },
          {
            heading: "Acceptable use",
            body: (
              <>
                <p>You agree not to:</p>
                <ul>
                  <li>
                    upload unlawful, infringing or malicious content, or content
                    you have no right to store;
                  </li>
                  <li>
                    attempt to access another customer&apos;s data, or to probe,
                    scan or test the security of the Service without our written
                    permission;
                  </li>
                  <li>
                    resell, sublicense or white-label the Service except under a
                    separate written agreement with us;
                  </li>
                  <li>
                    use the Service to send unsolicited bulk email, or in a way
                    that degrades it for other customers.
                  </li>
                </ul>
              </>
            ),
          },
          {
            heading: "Your data",
            body: (
              <>
                <p>
                  You retain all rights in the data you and your users put into
                  the Service (&quot;Customer Data&quot;), including property,
                  tenant, lease and financial records. You grant us only the
                  licence needed to host, process, transmit and back it up in
                  order to provide the Service and support.
                </p>
                <p>
                  We process personal data in Customer Data as your processor, on
                  your instructions, as described in our{" "}
                  <Link href="/privacy" className="text-blue-600 hover:underline">
                    Privacy Policy
                  </Link>
                  . You are responsible for having a lawful basis to collect and
                  share the tenant data you enter.
                </p>
              </>
            ),
          },
          {
            heading: "Fees, billing and taxes",
            body: (
              <>
                <p>
                  Paid plans are billed in advance on a recurring basis through
                  our payment processor. Fees are non-refundable except where
                  required by law. Your subscription renews automatically until
                  cancelled.
                </p>
                <p>
                  If a payment fails, we will notify you and keep your paid
                  features available during a short grace period. If the balance
                  remains unpaid after that period, paid features are paused, and
                  prolonged non-payment may lead to suspension. Your data is
                  retained throughout and is not deleted for non-payment without
                  further notice.
                </p>
                <p>
                  Prices exclude VAT, GST, sales tax and similar charges, which
                  you are responsible for where applicable.
                </p>
              </>
            ),
          },
          {
            heading: "Cancellation and termination",
            body: (
              <>
                <p>
                  You may cancel at any time from Settings → Billing.
                  Cancellation takes effect at the end of the current billing
                  period; you keep access until then and are not charged again.
                </p>
                <p>
                  We may suspend or terminate access if you materially breach
                  these Terms and do not remedy the breach within 14 days of
                  notice, or immediately where the breach is unlawful or puts the
                  Service or other customers at risk.
                </p>
                <p>
                  For 30 days after termination you may request an export of your
                  Customer Data. After that period we may delete it.
                </p>
              </>
            ),
          },
          {
            heading: "Availability and support",
            body: (
              <p>
                We aim to keep the Service available at all times but do not
                guarantee uninterrupted access. Planned maintenance is announced
                in advance where practical. Support is provided by email at{" "}
                {support} on business days; response targets vary by plan.
              </p>
            ),
          },
          {
            heading: "Third-party services",
            body: (
              <p>
                The Service integrates with third parties you choose to enable —
                payment gateways, email delivery, and storage providers among
                them. Your use of those services is governed by their own terms,
                and we are not responsible for their acts or omissions.
              </p>
            ),
          },
          {
            heading: "Warranties and liability",
            body: (
              <>
                <p>
                  The Service is provided &quot;as is&quot;. To the maximum
                  extent permitted by law we disclaim implied warranties of
                  merchantability, fitness for a particular purpose and
                  non-infringement.
                </p>
                <p>
                  Neither party is liable for indirect, incidental or
                  consequential loss, or for loss of profits, revenue or
                  goodwill. Our total aggregate liability arising out of or
                  related to these Terms is limited to the fees you paid in the
                  12 months preceding the event giving rise to the claim.
                </p>
                <p>
                  Nothing in these Terms limits liability that cannot be limited
                  by law, including for death or personal injury caused by
                  negligence, or for fraud.
                </p>
              </>
            ),
          },
          {
            heading: "Changes to these terms",
            body: (
              <p>
                We may update these Terms. For material changes we will give at
                least 30 days&apos; notice by email or in-app before they take
                effect. Continuing to use the Service after that means you accept
                the updated Terms; if you do not, you may cancel before they take
                effect.
              </p>
            ),
          },
          {
            heading: "Governing law",
            body: (
              <p>
                These Terms are governed by the laws of {jurisdiction}, and the
                courts of {jurisdiction} have exclusive jurisdiction over any
                dispute, without prejudice to any mandatory consumer-protection
                rights available to you locally.
              </p>
            ),
          },
          {
            heading: "Contact",
            body: (
              <p>
                Questions about these Terms: {support}. See also our{" "}
                <Link href="/privacy" className="text-blue-600 hover:underline">
                  Privacy Policy
                </Link>{" "}
                and{" "}
                <Link href="/contact" className="text-blue-600 hover:underline">
                  contact page
                </Link>
                .
              </p>
            ),
          },
        ]}
      />
    </MarketingPageShell>
  );
}
