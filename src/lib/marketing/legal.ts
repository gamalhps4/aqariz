/**
 * Shared constants for the legal pages.
 *
 * The copy in /terms and /privacy is a solid, complete starting point for a
 * B2B SaaS that processes tenant data and takes card payments — but it is a
 * template, not legal advice. Before launch, have counsel review it and set
 * the jurisdiction-specific values below.
 */

/** Bump whenever the terms or privacy copy changes materially. */
export const LEGAL_LAST_UPDATED = "20 August 2026";

/** The legal entity behind the service. Falls back to the platform name. */
export const LEGAL_ENTITY_NAME =
  process.env.NEXT_PUBLIC_LEGAL_ENTITY_NAME || "";

/** Governing law / venue, e.g. "England and Wales" or "the State of Delaware". */
export const LEGAL_JURISDICTION =
  process.env.NEXT_PUBLIC_LEGAL_JURISDICTION || "";

/** Postal address required by most consumer-protection and privacy regimes. */
export const LEGAL_POSTAL_ADDRESS =
  process.env.NEXT_PUBLIC_LEGAL_ADDRESS || "";
