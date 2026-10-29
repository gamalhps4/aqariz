/**
 * PropertyPro - A refusal the listing routes can explain
 *
 * Thrown by the services, caught by the routes (lib/listings/api.ts), which
 * turn it into the response. `statusCode` and `code` are the names
 * `handleApiError` already reads, so even a route that forgets to catch it
 * answers with the right status instead of a 500.
 *
 * `code` is stable and machine-readable (`listing_licence_required`); the
 * screens say it in the reader's language from the code, and the English
 * `message` is only for logs and API clients.
 */

export class ListingError extends Error {
  readonly statusCode: number;
  readonly code: string;
  /** For a publish refusal: every problem, as lib/listings/publish-rules codes. */
  readonly problems?: readonly string[];
  /** For a duplicate: the listing that already exists. */
  readonly existingId?: string;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    extra: { problems?: readonly string[]; existingId?: string } = {},
  ) {
    super(message);
    this.name = "ListingError";
    this.statusCode = statusCode;
    this.code = code;
    this.problems = extra.problems;
    this.existingId = extra.existingId;
  }
}

export const notFound = (what = "Listing") =>
  new ListingError(404, "not_found", `${what} not found`);
