/**
 * Zero-dependency runtime validators for Splintr SDK payloads.
 *
 * Every public method funnels user input through these guards so mistakes
 * (wrong type, missing field, malformed id) fail fast with a clear message
 * instead of surfacing as an HTTP 400 later.
 */

export class SplintrValidationError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`[splintr] ${path}: ${message}`);
    this.name = "SplintrValidationError";
    this.path = path;
  }
}

const fail = (path: string, msg: string): never => {
  throw new SplintrValidationError(path, msg);
};

export const v = {
  str(
    path: string,
    val: unknown,
    opts: { min?: number; max?: number; pattern?: RegExp } = {},
  ): string {
    if (typeof val !== "string") return fail(path, `expected string, got ${typeof val}`);
    if (opts.min != null && val.length < opts.min) fail(path, `min length ${opts.min}`);
    if (opts.max != null && val.length > opts.max) fail(path, `max length ${opts.max}`);
    if (opts.pattern && !opts.pattern.test(val)) fail(path, `does not match ${opts.pattern}`);
    return val;
  },
  optStr(
    path: string,
    val: unknown,
    opts?: { min?: number; max?: number; pattern?: RegExp },
  ): string | undefined {
    if (val === undefined || val === null) return undefined;
    return v.str(path, val, opts);
  },
  num(
    path: string,
    val: unknown,
    opts: { min?: number; max?: number; int?: boolean } = {},
  ): number {
    const n = typeof val === "string" ? Number(val) : val;
    if (typeof n !== "number" || !Number.isFinite(n))
      return fail(path, `expected finite number, got ${JSON.stringify(val)}`);
    if (opts.int && !Number.isInteger(n)) fail(path, "expected integer");
    if (opts.min != null && n < opts.min) fail(path, `min ${opts.min}`);
    if (opts.max != null && n > opts.max) fail(path, `max ${opts.max}`);
    return n;
  },
  optNum(
    path: string,
    val: unknown,
    opts?: { min?: number; max?: number; int?: boolean },
  ): number | undefined {
    if (val === undefined || val === null) return undefined;
    return v.num(path, val, opts);
  },
  enum<T extends string>(path: string, val: unknown, allowed: readonly T[]): T {
    if (typeof val !== "string" || !allowed.includes(val as T)) {
      return fail(path, `expected one of ${allowed.join("|")}`);
    }
    return val as T;
  },
  optEnum<T extends string>(path: string, val: unknown, allowed: readonly T[]): T | undefined {
    if (val === undefined || val === null) return undefined;
    return v.enum(path, val, allowed);
  },
  obj(path: string, val: unknown): Record<string, unknown> {
    if (!val || typeof val !== "object" || Array.isArray(val)) return fail(path, "expected object");
    return val as Record<string, unknown>;
  },
  id(path: string, val: unknown): string {
    return v.str(path, val, { min: 3, max: 128, pattern: /^[A-Za-z0-9_-]+$/ });
  },
  url(path: string, val: unknown): string {
    const s = v.str(path, val, { min: 1, max: 2048 });
    try {
      new URL(s);
    } catch {
      fail(path, "must be an absolute URL");
    }
    return s;
  },
  email(path: string, val: unknown): string {
    return v.str(path, val, { max: 254, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ });
  },
};

export const CHAINS = [
  "robinhood",
  "solana",
  "ethereum",
  "base",
  "arbitrum",
  "optimism",
  "polygon",
  "bnb",
  "avalanche",
] as const;
export const INTENT_STATUSES = [
  "created",
  "requires_payment",
  "quoted",
  "awaiting_signature",
  "executing",
  "partially_filled",
  "settled",
  "failed",
  "expired",
  "cancelled",
  "refunded",
] as const;
export const PAYOUT_STATUSES = ["queued", "pending", "paid", "failed", "paused"] as const;
export const REFUND_STATUSES = [
  "pending",
  "processing",
  "retry_scheduled",
  "succeeded",
  "failed",
] as const;
export const WEBHOOK_EVENTS = [
  "payment_intent.created",
  "payment_intent.quoted",
  "payment_intent.executing",
  "payment_intent.executed",
  "payment_intent.settled",
  "payment_intent.failed",
  "payment_intent.expired",
  "payment_intent.cancelled",
  "payment_intent.refunded",
  "quote.created",
  "settlement.confirmed",
  "payout.pending",
  "payout.paid",
  "payout.failed",
  "refund.pending",
  "refund.paid",
  "refund.failed",
] as const;
