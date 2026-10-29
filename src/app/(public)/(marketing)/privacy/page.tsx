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
  LEGAL_LAST_UPDATED,
  LEGAL_POSTAL_ADDRESS,
} from "@/lib/marketing/legal";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const { general } = await getPlatformSettings();
  return {
    // The layout's title template adds the site name.
    title: "Privacy Policy",
    description: `How ${general.platformName} collects, uses and protects personal data.`,
  };
}

export default async function PrivacyPage() {
  const { general } = await getPlatformSettings();
  const product = general.platformName;
  const entity = LEGAL_ENTITY_NAME || product;
  const support = general.supportEmail || "support@example.com";

  return (
    <MarketingPageShell>
      <MarketingPageHeader
        eyebrow="Legal"
        title="Privacy Policy"
        lead={`How ${entity} collects, uses, shares and protects personal data in ${product}.`}
      />
      <LegalDocument
        lastUpdated={LEGAL_LAST_UPDATED}
        intro={`This policy covers two different relationships. When you visit our site or manage your own ${product} account, we are the data controller. When your organization stores tenant, lease and payment records in ${product}, your organization is the controller and we act as its processor — we handle that data only on your instructions.`}
        sections={[
          {
            heading: "Data we collect as controller",
            body: (
              <>
                <p>For account holders and site visitors:</p>
                <ul>
                  <li>
                    <strong>Account data</strong> — name, work email, phone
                    number, organization name, and the password hash used to
                    authenticate you.
                  </li>
                  <li>
                    <strong>Billing data</strong> — plan, subscription status and
                    billing history. Card numbers never reach our servers; they
                    are handled by our payment processor.
                  </li>
                  <li>
                    <strong>Usage and device data</strong> — pages visited,
                    features used, IP address, browser, operating system and
                    device type, plus session records so you can review and
                    revoke your own logins.
                  </li>
                  <li>
                    <strong>Support correspondence</strong> — messages you send
                    us and our replies.
                  </li>
                </ul>
              </>
            ),
          },
          {
            heading: "Data we process on your behalf",
            body: (
              <>
                <p>
                  When your organization uses {product}, it puts records into the
                  system that typically include tenant names and contact details,
                  lease terms, rent and payment history, maintenance requests,
                  documents and messages. We process this only to run the Service
                  for you, to provide support, and to meet legal obligations.
                </p>
                <p>
                  We do not sell this data, use it to build advertising profiles,
                  or use it to train machine-learning models.
                </p>
              </>
            ),
          },
          {
            heading: "Why we process data",
            body: (
              <ul>
                <li>
                  <strong>To perform our contract</strong> — creating your
                  account, providing the Service, taking payment, and supporting
                  you.
                </li>
                <li>
                  <strong>Legitimate interests</strong> — securing the platform,
                  preventing abuse and fraud, and improving the product in
                  aggregate.
                </li>
                <li>
                  <strong>Legal obligation</strong> — keeping financial records
                  and responding to lawful requests.
                </li>
                <li>
                  <strong>Consent</strong> — optional communications such as
                  product announcements. You can withdraw consent at any time.
                </li>
              </ul>
            ),
          },
          {
            heading: "Tenant isolation",
            body: (
              <p>
                Every record in {product} is bound to the organization that owns
                it, and that boundary is enforced in the database itself through
                row-level security — not only in application code. One
                customer&apos;s data is not visible to another, and our own
                staff access is limited to what is needed for support and
                operations.
              </p>
            ),
          },
          {
            heading: "Sharing and sub-processors",
            body: (
              <>
                <p>
                  We share data only with service providers who help us run{" "}
                  {product}, each bound by contract to protect it:
                </p>
                <ul>
                  <li>
                    <strong>Payment processors</strong> — to take subscription
                    and rent payments.
                  </li>
                  <li>
                    <strong>Cloud hosting and object storage</strong> — to run
                    the application and store uploaded documents and images.
                  </li>
                  <li>
                    <strong>Email delivery</strong> — to send transactional mail
                    such as invitations, receipts and reminders.
                  </li>
                  <li>
                    <strong>Product analytics and error monitoring</strong> — to
                    understand usage and diagnose faults.
                  </li>
                </ul>
                <p>
                  We may also disclose data where required by law, or in
                  connection with a merger or acquisition — in which case we will
                  notify you before your data becomes subject to a different
                  policy.
                </p>
              </>
            ),
          },
          {
            heading: "International transfers",
            body: (
              <p>
                Our providers may process data outside your country. Where that
                happens, transfers are covered by an appropriate safeguard such
                as the Standard Contractual Clauses or an adequacy decision.
              </p>
            ),
          },
          {
            heading: "Retention",
            body: (
              <p>
                We keep account data for as long as your subscription is active.
                After termination, Customer Data remains available for export for
                30 days and may then be deleted. Audit logs are retained for the
                period configured by your organization; financial records are
                kept for as long as tax law requires. Backups are cycled out on a
                rolling schedule.
              </p>
            ),
          },
          {
            heading: "Security",
            body: (
              <p>
                Passwords are stored using industry-standard hashing, traffic is
                encrypted in transit, and access to production systems is limited
                and logged. Sessions are listed in-app so you can revoke a device
                you no longer recognise. No system is perfectly secure, but we
                will notify you and any applicable regulator without undue delay
                if a breach affects your data.
              </p>
            ),
          },
          {
            heading: "Your rights",
            body: (
              <>
                <p>
                  Depending on where you live, you may have the right to access,
                  correct, delete, restrict or object to the processing of your
                  personal data, and to receive it in a portable format. To
                  exercise a right relating to your own account, email {support}.
                </p>
                <p>
                  If you are a tenant and your data was entered by a landlord or
                  property manager, that organization is the controller — contact
                  them first, and we will support them in responding. You also
                  have the right to complain to your local data-protection
                  authority.
                </p>
              </>
            ),
          },
          {
            heading: "Cookies",
            body: (
              <p>
                We use strictly necessary cookies to keep you signed in and to
                protect against cross-site request forgery; these cannot be
                turned off without breaking the Service. We also use a small
                number of analytics cookies to understand product usage. We do
                not use advertising or cross-site tracking cookies.
              </p>
            ),
          },
          {
            heading: "Children",
            body: (
              <p>
                {product} is a business tool and is not directed at children. We
                do not knowingly collect personal data from anyone under 16. If
                you believe a child&apos;s data has been provided to us, contact{" "}
                {support} and we will delete it.
              </p>
            ),
          },
          {
            heading: "Changes and contact",
            body: (
              <>
                <p>
                  We will post any changes to this policy on this page and update
                  the date above. Material changes are announced by email or
                  in-app before they take effect.
                </p>
                <p>
                  Contact us at {support}
                  {LEGAL_POSTAL_ADDRESS ? `, or by post at ${LEGAL_POSTAL_ADDRESS}` : ""}
                  . See also our{" "}
                  <Link href="/terms" className="text-blue-600 hover:underline">
                    Terms of Service
                  </Link>
                  .
                </p>
              </>
            ),
          },
        ]}
      />
    </MarketingPageShell>
  );
}
