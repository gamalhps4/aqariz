/**
 * PropertyPro - Talking to a payment gateway over HTTP
 *
 * The adapters call the gateways' REST APIs with plain fetch (no SDKs, bar
 * Stripe's). `fetch` is passed in so the tests can answer for the gateway,
 * and every call has a timeout: a gateway that hangs must not hold a tenant's
 * checkout, or a webhook delivery, open indefinitely.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 20_000;

/** A gateway answered with an error status, or could not be reached. */
export class GatewayHttpError extends Error {
  /** HTTP status; 0 when the gateway was not reached at all. */
  status: number;
  body: unknown;
  gateway: string;
  constructor(gateway: string, status: number, message: string, body?: unknown) {
    super(message);
    this.name = "GatewayHttpError";
    this.gateway = gateway;
    this.status = status;
    this.body = body;
  }
}

/** The gateway said there is no such payment — as opposed to not answering. */
export function isNotFound(error: unknown): boolean {
  return error instanceof GatewayHttpError && error.status === 404;
}

/** Credentials or settings needed for this step are missing. */
export class GatewayConfigError extends Error {
  statusCode = 503;
  constructor(message: string) {
    super(message);
    this.name = "GatewayConfigError";
  }
}

/** First readable message in a gateway's error body. */
function messageFrom(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") {
    return typeof body === "string" && body.trim() ? body.trim().slice(0, 300) : fallback;
  }
  type Detail = { description?: unknown; message?: unknown };
  const record = body as {
    message?: unknown;
    error_description?: unknown;
    details?: Detail[];
    errors?: Detail[];
    error?: unknown;
  };
  const candidates = [
    record.message,
    record.error_description,
    record.details?.[0]?.description,
    record.errors?.[0]?.description,
    record.errors?.[0]?.message,
    (record.error as { message?: unknown } | undefined)?.message,
    typeof record.error === "string" ? record.error : undefined,
  ];
  const found = candidates.find((value) => typeof value === "string" && value.trim());
  return found ? String(found).slice(0, 300) : fallback;
}

export interface GatewayRequest {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  /** Sent as JSON unless it is already a string. */
  body?: unknown;
  timeoutMs?: number;
}

/** Call a gateway and parse its JSON answer; throws GatewayHttpError on failure. */
export async function gatewayRequest<T = unknown>(
  gateway: string,
  fetchImpl: FetchLike,
  url: string,
  request: GatewayRequest = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(request.body !== undefined && typeof request.body !== "string"
      ? { "Content-Type": "application/json" }
      : {}),
    ...request.headers,
  };
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: request.method ?? (request.body === undefined ? "GET" : "POST"),
      headers,
      body:
        request.body === undefined
          ? undefined
          : typeof request.body === "string"
            ? request.body
            : JSON.stringify(request.body),
      cache: "no-store",
      signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new GatewayHttpError(
      gateway,
      0,
      `${gateway} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const text = await response.text();
  let data: unknown = text;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Not JSON — kept as text for the error message.
    }
  } else {
    data = {};
  }

  if (!response.ok) {
    throw new GatewayHttpError(
      gateway,
      response.status,
      messageFrom(data, `${gateway} answered ${response.status}`),
      data,
    );
  }
  return data as T;
}

/** Hex HMAC-SHA256 — the signature PayTabs and Tap put on their webhooks. */
export function hmacSha256Hex(key: string, payload: string): string {
  return createHmac("sha256", key).update(payload, "utf8").digest("hex");
}

/** Constant-time string comparison (false for different lengths). */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
