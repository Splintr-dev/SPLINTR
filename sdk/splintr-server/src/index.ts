/**
 * @splintr-dev/server
 *
 * Runtime-agnostic Splintr SDK. Uses only global fetch + crypto.subtle so it
 * works in Node 18+, Bun, Deno, Cloudflare Workers, and every edge runtime.
 *
 * Zero runtime dependencies. Full coverage of the public REST surface at
 * /api/public/v1/*.
 */

import {
  v,
  CHAINS,
  INTENT_STATUSES,
  PAYOUT_STATUSES,
  REFUND_STATUSES,
  WEBHOOK_EVENTS,
  SplintrValidationError,
} from "./validate";
export { SplintrValidationError } from "./validate";

// ---------- Chains + statuses ----------

export type Chain =
  | "robinhood"
  | "solana"
  | "ethereum"
  | "base"
  | "arbitrum"
  | "optimism"
  | "polygon"
  | "bnb"
  | "avalanche";

export type IntentStatus =
  | "created"
  | "requires_payment"
  | "quoted"
  | "awaiting_signature"
  | "executing"
  | "partially_filled"
  | "settled"
  | "failed"
  | "expired"
  | "cancelled"
  | "refunded";

export type PayoutStatus = "queued" | "pending" | "paid" | "failed" | "paused";
/**
 * Raw refund status as stored on the backend. See {@link refundPhase} for a
 * simplified 4-state bucket (`queued | sent | completed | failed`) suitable
 * for rendering merchant/customer-facing status pills.
 */
export type RefundStatus = "pending" | "processing" | "retry_scheduled" | "succeeded" | "failed";

/** UI-friendly refund bucket. */
export type RefundPhase = "queued" | "sent" | "completed" | "failed";

/**
 * Map a raw {@link RefundStatus} onto a stable 4-bucket UI phase.
 *
 * - `queued`    → `pending` | `retry_scheduled` (waiting to dispatch / retry)
 * - `sent`      → `processing` (broadcast on-chain / to payout provider, awaiting confirmation)
 * - `completed` → `succeeded`  (funds delivered, `paid_at` set, `tx_hash` present on-chain rails)
 * - `failed`    → `failed`     (permanent — retry budget exhausted)
 */
export function refundPhase(status: RefundStatus | string | null | undefined): RefundPhase {
  switch (status) {
    case "succeeded":
      return "completed";
    case "processing":
      return "sent";
    case "failed":
      return "failed";
    default:
      return "queued";
  }
}

// ---------- Public objects ----------

export interface Settlement {
  chain: Chain | string;
  token: string;
  address: string;
  exactAmount?: string;
}

export interface PaymentNetwork {
  slug: string;
  name: string;
  chainId: number;
  family: "evm" | "solana" | "other";
  nativeSymbol: string;
  provider: "lifi";
  mainnet: boolean;
  walletConnectable: boolean;
  payoutSupported: boolean;
  paymentStatus: "enabled" | "discovered";
}

export interface CreateIntentInput {
  amount: number | string;
  currency?: string;
  settlement?: Partial<Settlement>;
  customerEmail?: string;
  metadata?: Record<string, string | number | boolean>;
  successUrl?: string;
  cancelUrl?: string;
  /** Override merchant default expiry (seconds, 60..86400). */
  expiresInSeconds?: number;
  /** Idempotency-Key for safe client retries. */
  idempotencyKey?: string;
}

export interface PaymentIntent {
  id: string;
  amount: string;
  currency: string;
  status: IntentStatus;
  checkout_url: string;
  expires_at: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface IntentTransaction {
  id: string;
  payment_intent_id: string;
  chain: string;
  token: string;
  amount: string;
  amount_usd: number | null;
  status: string;
  tx_hash: string | null;
  from_address: string | null;
  created_at: string;
}

export interface RouteCandidate {
  id: string;
  provider: string;
  chosen: boolean;
  ai_pick: boolean;
  score: number;
  from_chain: string;
  to_chain: string;
  from_token: string;
  to_token: string;
  to_amount_usd: number | null;
  fee_usd: number | null;
  gas_usd: number | null;
  duration_sec: number | null;
  reason: string | null;
  error: string | null;
  created_at: string;
}

export interface Refund {
  id: string;
  payment_intent_id: string;
  amount_usd: number;
  chain: string | null;
  token: string | null;
  /**
   * Payout address. May be `""` when a refund was auto-enqueued (e.g. by the
   * expiry sweeper) and Splintr has not yet resolved the payer's originating
   * address. In that case `failure_reason` is `"missing_destination"` and the
   * refund waits until the merchant supplies one, or Splintr derives it from a
   * confirmed payer leg.
   */
  destination: string;
  reason: string;
  /** Raw backend status. Use {@link refundPhase} to bucket for UI. */
  status: RefundStatus;
  /** On-chain hash once the refund broadcasts. `null` until then. */
  tx_hash: string | null;
  /** Number of dispatch attempts already made against this refund. */
  attempts: number;
  /** ISO timestamp of the next scheduled retry (only set in `retry_scheduled`). */
  next_attempt_at: string | null;
  /** ISO timestamp when the refund settled. `null` until `status="succeeded"`. */
  paid_at: string | null;
  /** Optional payer email captured at intent time. */
  customer_email?: string | null;
  created_at: string;
  updated_at: string;
  failure_reason?: string | null;
}

/**
 * Public payer-facing refund status returned by {@link RefundResource.status}.
 * UNAUTHENTICATED — safe to render on a receipt page or email. `destination`
 * is redacted to the last 6 chars via `destination_tail`. `phase` is a
 * stable 4-bucket categorization computed with {@link refundPhase}.
 */
export interface PublicRefundStatus {
  id: string;
  payment_intent_id: string;
  amount_usd: number;
  chain: string | null;
  token: string | null;
  destination_tail: string;
  reason: string;
  status: RefundStatus;
  /** UI bucket: `queued | sent | completed | failed`. */
  phase: RefundPhase;
  tx_hash: string | null;
  failure_reason: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  /** `true` once no further state change is possible (`completed` or `failed`). */
  terminal: boolean;
}

export interface Payout {
  id: string;
  payment_intent_id: string | null;
  rail: string;
  destination: string;
  chain: string;
  token: string;
  amount: string;
  currency: string;
  status: PayoutStatus;
  tx_hash: string | null;
  failure_reason: string | null;
  attempts: number;
  next_attempt_at: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  created_at: string;
  /** Present only in create + rotate-secret responses. */
  signing_secret?: string;
}

export interface SplintrToken {
  chain: Chain | string;
  address: string;
  symbol: string;
  name?: string;
  decimals: number;
  verified: boolean;
  min_liquidity_usd?: number;
}

// ---------- Webhook events ----------

export type WebhookEventType =
  | "payment_intent.created"
  | "payment_intent.quoted"
  | "payment_intent.executing"
  | "payment_intent.executed"
  | "payment_intent.settled"
  | "payment_intent.failed"
  | "payment_intent.expired"
  | "payment_intent.cancelled"
  | "payment_intent.refunded"
  | "quote.created"
  | "settlement.confirmed"
  | "payout.created"
  | "payout.paid"
  | "payout.failed"
  | "refund.created"
  | "refund.processing"
  | "refund.paid"
  | "refund.failed";

export interface WebhookEvent<T = unknown> {
  id: string;
  type: WebhookEventType;
  data: T;
  created_at: string;
}

// ---------- Options + errors ----------

export interface SplintrOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Request timeout in ms. Default 30_000. Set 0 to disable. */
  timeout?: number;
  /** Max retries on 429/5xx (jittered exponential backoff). Default 2. */
  retries?: number;
  /** Log redacted request/response info via console.debug. */
  debug?: boolean;
}

export class SplintrError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly raw: unknown;
  constructor(status: number, code: string, message: string, raw: unknown, requestId?: string) {
    super(message);
    this.name = "SplintrError";
    this.status = status;
    this.code = code;
    this.raw = raw;
    this.requestId = requestId;
  }
}

// ---------- Core client ----------

type Requester = <T>(
  path: string,
  init?: RequestInit & {
    idempotencyKey?: string;
    query?: Record<string, string | number | boolean | undefined>;
    skipAuth?: boolean;
  },
) => Promise<T>;

class SplintrClient {
  readonly paymentIntents: PaymentIntentResource;
  readonly refunds: RefundResource;
  readonly payouts: PayoutResource;
  readonly webhookEndpoints: WebhookEndpointResource;
  readonly webhooks: WebhookHelpers;
  readonly tokens: TokenResource;
  readonly networks: NetworkResource;
  readonly checkout: PublicCheckoutResource;
  #opts: Required<Omit<SplintrOptions, "fetch" | "debug">> & { fetch: typeof fetch; debug: boolean };

  constructor(opts: SplintrOptions) {
    if (!opts || typeof opts !== "object") {
      throw new SplintrValidationError("options", "expected SplintrOptions object");
    }
    if (
      typeof opts.apiKey !== "string" ||
      !/^sk_(test|live)_[A-Za-z0-9_-]{8,}$/.test(opts.apiKey)
    ) {
      throw new SplintrValidationError(
        "options.apiKey",
        "must match sk_test_… or sk_live_… (min 8 chars after prefix)",
      );
    }
    if (opts.baseUrl !== undefined) v.url("options.baseUrl", opts.baseUrl);
    if (opts.timeout !== undefined)
      v.num("options.timeout", opts.timeout, { min: 0, max: 600_000, int: true });
    if (opts.retries !== undefined)
      v.num("options.retries", opts.retries, { min: 0, max: 10, int: true });
    this.#opts = {
      apiKey: opts.apiKey,
      baseUrl: (opts.baseUrl ?? "https://splintr.cash").replace(/\/$/, ""),
      fetch: opts.fetch ?? globalThis.fetch.bind(globalThis),
      timeout: opts.timeout ?? 30_000,
      retries: opts.retries ?? 2,
      debug: opts.debug ?? false,
    };
    const req = ((path, init) => this.#req(path, init)) as Requester;
    this.paymentIntents = new PaymentIntentResource(req);
    this.refunds = new RefundResource(req);
    this.payouts = new PayoutResource(req);
    this.webhookEndpoints = new WebhookEndpointResource(req);
    this.tokens = new TokenResource(req);
    this.networks = new NetworkResource(req);
    this.checkout = new PublicCheckoutResource(req);
    this.webhooks = new WebhookHelpers();
  }

  /**
   * Unauthenticated health probe against the API host. Safe to call from
   * uptime monitors and CI. Returns `{ status: "ok" | "degraded" | "down", ... }`.
   */
  health(): Promise<{
    status: "ok" | "degraded" | "down";
    service: string;
    version: string;
    time: string;
    latency_ms: number;
    checks: { env: Record<string, boolean>; database: "ok" | "degraded" | "down" };
  }> {
    return this.#req(`/api/public/health`, { skipAuth: true });
  }

  /**
   * Unauthenticated snapshot of which router providers, RPC keys and payout
   * rails are live in the current deployment. Ops-friendly — use it in CI
   * or a status page after a deploy to confirm keyed providers didn't
   * silently fall back to a no-op adapter.
   */
  healthProviders(): Promise<{
    providers: { id: string; live: boolean; gate: string }[];
    rpc: { alchemy: boolean; helius: boolean };
    payouts: {
      circle: boolean;
      nowpayments: boolean;
      evmHotWallet: boolean;
      solanaHotWallet: boolean;
    };
    generatedAt: string;
  }> {
    return this.#req(`/api/public/health/providers`, { skipAuth: true });
  }

  setDebug(on: boolean) {
    this.#opts.debug = on;
  }

  async #req<T>(
    path: string,
    init: RequestInit & {
      idempotencyKey?: string;
      query?: Record<string, string | number | boolean | undefined>;
      skipAuth?: boolean;
    } = {},
  ): Promise<T> {
    const query = init.query
      ? "?" +
        new URLSearchParams(
          Object.entries(init.query)
            .filter(([, v]) => v !== undefined && v !== null && v !== "")
            .map(([k, v]) => [k, String(v)]),
        ).toString()
      : "";
    const url = `${this.#opts.baseUrl}${path}${query}`;
    const headers = new Headers(init.headers);
    if (!init.skipAuth) headers.set("authorization", `Bearer ${this.#opts.apiKey}`);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (init.idempotencyKey) headers.set("idempotency-key", init.idempotencyKey);

    const maxAttempts = Math.max(1, this.#opts.retries + 1);
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ctrl = this.#opts.timeout ? new AbortController() : null;
      const to = ctrl ? setTimeout(() => ctrl.abort(), this.#opts.timeout) : null;
      try {
        if (this.#opts.debug) {
          console.debug(`[splintr] ${init.method ?? "GET"} ${url} attempt=${attempt}`);
        }
        const res = await this.#opts.fetch(url, {
          ...init,
          headers,
          signal: ctrl?.signal ?? init.signal,
        });
        const text = await res.text();
        let body: unknown = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = text;
        }

        if (res.ok) return body as T;

        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < maxAttempts) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const backoff =
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : Math.min(2000 * 2 ** (attempt - 1), 10_000) + Math.random() * 250;
          await sleep(backoff);
          continue;
        }
        const b = (body ?? {}) as { error?: string; code?: string };
        throw new SplintrError(
          res.status,
          b.code ?? `http_${res.status}`,
          b.error ?? res.statusText,
          body,
          res.headers.get("x-request-id") ?? undefined,
        );
      } catch (e) {
        lastErr = e;
        if (e instanceof SplintrError) throw e;
        if (attempt < maxAttempts) {
          await sleep(500 * attempt + Math.random() * 200);
          continue;
        }
        throw e;
      } finally {
        if (to) clearTimeout(to);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("splintr request failed");
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- Resources ----------

class PaymentIntentResource {
  constructor(private req: Requester) {}

  create(input: CreateIntentInput): Promise<PaymentIntent> {
    if (!input || typeof input !== "object")
      throw new SplintrValidationError("createIntent", "expected object");
    const amount = v.num("createIntent.amount", input.amount, { min: 0.01, max: 10_000_000 });
    const currency =
      v.optStr("createIntent.currency", input.currency, {
        min: 3,
        max: 8,
        pattern: /^[A-Z]{3,8}$/,
      }) ?? "USD";
    if (input.settlement !== undefined) v.obj("createIntent.settlement", input.settlement);
    const settlementChain = input.settlement?.chain
      ? v.enum("createIntent.settlement.chain", input.settlement.chain, CHAINS)
      : undefined;
    const settlementToken = v.optStr("createIntent.settlement.token", input.settlement?.token, {
      min: 1,
      max: 64,
    });
    const settlementAddress = v.optStr(
      "createIntent.settlement.address",
      input.settlement?.address,
      { min: 26, max: 128 },
    );
    const customerEmail =
      input.customerEmail !== undefined
        ? v.email("createIntent.customerEmail", input.customerEmail)
        : undefined;
    const expiresInSeconds = v.optNum("createIntent.expiresInSeconds", input.expiresInSeconds, {
      min: 60,
      max: 86400,
      int: true,
    });
    const idempotencyKey = v.optStr("createIntent.idempotencyKey", input.idempotencyKey, {
      min: 8,
      max: 128,
    });
    const successUrl =
      input.successUrl !== undefined
        ? v.url("createIntent.successUrl", input.successUrl)
        : undefined;
    const cancelUrl =
      input.cancelUrl !== undefined ? v.url("createIntent.cancelUrl", input.cancelUrl) : undefined;
    if (input.metadata !== undefined) v.obj("createIntent.metadata", input.metadata);

    return this.req<PaymentIntent>("/api/public/v1/payment-intents", {
      method: "POST",
      body: JSON.stringify({
        amount,
        currency,
        settlement_chain: settlementChain,
        settlement_token: settlementToken,
        settlement_address: settlementAddress,
        customer_email: customerEmail,
        expires_in_seconds: expiresInSeconds,
        metadata: {
          ...(input.metadata ?? {}),
          ...(successUrl ? { success_url: successUrl } : {}),
          ...(cancelUrl ? { cancel_url: cancelUrl } : {}),
        },
      }),
      idempotencyKey,
    });
  }

  retrieve(id: string): Promise<PaymentIntent> {
    v.id("paymentIntents.retrieve.id", id);
    return this.req<PaymentIntent>(`/api/public/v1/payment-intents/${encodeURIComponent(id)}`);
  }

  list(params: { limit?: number; status?: IntentStatus } = {}): Promise<{ data: PaymentIntent[] }> {
    const limit = v.optNum("list.limit", params.limit, { min: 1, max: 100, int: true });
    const status = v.optEnum("list.status", params.status, INTENT_STATUSES);
    return this.req(`/api/public/v1/payment-intents`, { query: { limit, status } });
  }

  cancel(id: string): Promise<PaymentIntent> {
    v.id("paymentIntents.cancel.id", id);
    return this.req<PaymentIntent>(
      `/api/public/v1/payment-intents/${encodeURIComponent(id)}/cancel`,
      { method: "POST" },
    );
  }

  transactions(id: string): Promise<{ data: IntentTransaction[] }> {
    v.id("paymentIntents.transactions.id", id);
    return this.req(`/api/public/v1/payment-intents/${encodeURIComponent(id)}/transactions`);
  }

  routing(id: string): Promise<{ data: RouteCandidate[] }> {
    v.id("paymentIntents.routing.id", id);
    return this.req(`/api/public/v1/payment-intents/${encodeURIComponent(id)}/routing`);
  }

  /** @deprecated use `routing()` — kept for backwards compatibility. */
  route(id: string): Promise<{ data: RouteCandidate[] }> {
    return this.routing(id);
  }
}

class RefundResource {
  constructor(private req: Requester) {}
  create(input: {
    paymentIntentId: string;
    amountUsd: number;
    /**
     * Payer address to refund to. Optional — omit to let Splintr auto-fill from
     * the intent's confirmed payer leg(s). If no payer address can be derived
     * the refund is created in `pending` with `failure_reason: "missing_destination"`
     * until the merchant provides one from the dashboard.
     */
    destination?: string;
    reason?: string;
    idempotencyKey?: string;
  }): Promise<Refund> {
    if (!input || typeof input !== "object")
      throw new SplintrValidationError("refunds.create", "expected object");
    v.id("refunds.create.paymentIntentId", input.paymentIntentId);
    v.num("refunds.create.amountUsd", input.amountUsd, { min: 0.01, max: 10_000_000 });
    v.optStr("refunds.create.destination", input.destination, { min: 26, max: 128 });
    v.optStr("refunds.create.reason", input.reason, { max: 500 });
    v.optStr("refunds.create.idempotencyKey", input.idempotencyKey, { min: 8, max: 128 });
    return this.req<Refund>("/api/public/v1/refunds", {
      method: "POST",
      body: JSON.stringify({
        intent_id: input.paymentIntentId,
        amount_usd: input.amountUsd,
        destination: input.destination,
        reason: input.reason,
      }),
      idempotencyKey: input.idempotencyKey,
    });
  }

  /**
   * Requeue a refund that is `failed`, `retry_scheduled` or `pending` for
   * another dispatch attempt. Pass `destination` to send the funds to a
   * different address than the one on file — useful when the original payer
   * address bounced, was a non-custodial contract that can't receive the
   * settlement asset, or the customer supplied a new wallet.
   *
   * ```ts
   * await splintr.refunds.retry("re_...", { destination: "0xNewWallet..." });
   * ```
   */
  retry(
    id: string,
    input: { destination?: string; reason?: string } = {},
  ): Promise<{ retried: boolean; refund: Refund }> {
    v.id("refunds.retry.id", id);
    v.optStr("refunds.retry.destination", input.destination, { min: 26, max: 128 });
    v.optStr("refunds.retry.reason", input.reason, { max: 280 });
    return this.req(`/api/public/v1/refunds/${encodeURIComponent(id)}/retry`, {
      method: "POST",
      body: JSON.stringify({ destination: input.destination, reason: input.reason }),
    });
  }

  retrieve(id: string): Promise<Refund> {
    v.id("refunds.retrieve.id", id);
    return this.req<Refund>(`/api/public/v1/refunds/${encodeURIComponent(id)}`);
  }
  list(
    params: { paymentIntentId?: string; status?: RefundStatus; limit?: number } = {},
  ): Promise<{ data: Refund[] }> {
    if (params.paymentIntentId !== undefined)
      v.id("refunds.list.paymentIntentId", params.paymentIntentId);
    v.optEnum("refunds.list.status", params.status, REFUND_STATUSES);
    v.optNum("refunds.list.limit", params.limit, { min: 1, max: 100, int: true });
    return this.req(`/api/public/v1/refunds`, {
      query: {
        payment_intent_id: params.paymentIntentId,
        status: params.status,
        limit: params.limit,
      },
    });
  }
  /**
   * Fetch the payer-facing safe status view for a refund. UNAUTHENTICATED —
   * safe to expose in a customer-facing page or email. Redacts the destination
   * address (only the last 6 chars) and omits merchant PII. The returned
   * `phase` field is a stable 4-bucket categorization
   * (`queued | sent | completed | failed`) computed on the client for
   * convenient status pills.
   */
  async status(id: string): Promise<PublicRefundStatus> {
    v.id("refunds.status.id", id);
    const raw = await this.req<Omit<PublicRefundStatus, "phase">>(
      `/api/public/refunds/${encodeURIComponent(id)}/status`,
      { skipAuth: true },
    );
    return { ...raw, phase: refundPhase(raw.status) };
  }
  /** Client-side helper: bucket a raw {@link RefundStatus} to a UI phase. */
  phase(status: RefundStatus | string | null | undefined): RefundPhase {
    return refundPhase(status);
  }
}

/**
 * Unauthenticated public checkout view used by hosted checkout pages and the
 * @splintr-dev/react polling hook. Exposes only non-PII fields — no merchant
 * data, no keys, no idempotency records. Rate-limited to 120 req/min per IP.
 */
class PublicCheckoutResource {
  constructor(private req: Requester) {}
  retrieve(id: string): Promise<{
    id: string;
    amount: string;
    currency: string;
    status: IntentStatus;
    settlement_chain: string | null;
    settlement_token: string | null;
    expires_at: string;
    metadata?: Record<string, unknown>;
  }> {
    v.id("checkout.retrieve.id", id);
    return this.req(`/api/public/v1/checkout/${encodeURIComponent(id)}`, { skipAuth: true });
  }
}

class PayoutResource {
  constructor(private req: Requester) {}
  retrieve(id: string): Promise<Payout> {
    v.id("payouts.retrieve.id", id);
    return this.req<Payout>(`/api/public/v1/payouts/${encodeURIComponent(id)}`);
  }
  list(
    params: { status?: PayoutStatus; paymentIntentId?: string; limit?: number } = {},
  ): Promise<{ data: Payout[] }> {
    v.optEnum("payouts.list.status", params.status, PAYOUT_STATUSES);
    if (params.paymentIntentId !== undefined)
      v.id("payouts.list.paymentIntentId", params.paymentIntentId);
    v.optNum("payouts.list.limit", params.limit, { min: 1, max: 100, int: true });
    return this.req(`/api/public/v1/payouts`, {
      query: {
        status: params.status,
        payment_intent_id: params.paymentIntentId,
        limit: params.limit,
      },
    });
  }
  replay(id: string): Promise<{ replayed: boolean; result: unknown }> {
    v.id("payouts.replay.id", id);
    return this.req(`/api/public/v1/payouts/${encodeURIComponent(id)}/replay`, { method: "POST" });
  }
}

class WebhookEndpointResource {
  constructor(private req: Requester) {}
  create(input: {
    url: string;
    events: WebhookEventType[] | string[];
    enabled?: boolean;
  }): Promise<WebhookEndpoint> {
    if (!input || typeof input !== "object")
      throw new SplintrValidationError("webhookEndpoints.create", "expected object");
    v.url("webhookEndpoints.create.url", input.url);
    if (!Array.isArray(input.events) || input.events.length === 0) {
      throw new SplintrValidationError(
        "webhookEndpoints.create.events",
        "at least one event required",
      );
    }
    input.events.forEach((e, i) =>
      v.enum(`webhookEndpoints.create.events[${i}]`, e, WEBHOOK_EVENTS),
    );
    return this.req<WebhookEndpoint>("/api/public/v1/webhook-endpoints", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }
  list(): Promise<{ data: WebhookEndpoint[] }> {
    return this.req(`/api/public/v1/webhook-endpoints`);
  }
  retrieve(id: string): Promise<WebhookEndpoint> {
    v.id("webhookEndpoints.retrieve.id", id);
    return this.req<WebhookEndpoint>(`/api/public/v1/webhook-endpoints/${encodeURIComponent(id)}`);
  }
  update(
    id: string,
    patch: Partial<{ url: string; events: string[]; enabled: boolean }>,
  ): Promise<WebhookEndpoint> {
    v.id("webhookEndpoints.update.id", id);
    if (patch.url !== undefined) v.url("webhookEndpoints.update.url", patch.url);
    if (patch.events !== undefined) {
      if (!Array.isArray(patch.events))
        throw new SplintrValidationError("webhookEndpoints.update.events", "expected array");
      patch.events.forEach((e, i) =>
        v.enum(`webhookEndpoints.update.events[${i}]`, e, WEBHOOK_EVENTS),
      );
    }
    return this.req<WebhookEndpoint>(`/api/public/v1/webhook-endpoints/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }
  delete(id: string): Promise<{ deleted: true }> {
    v.id("webhookEndpoints.delete.id", id);
    return this.req(`/api/public/v1/webhook-endpoints/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }
  rotateSecret(id: string): Promise<WebhookEndpoint> {
    v.id("webhookEndpoints.rotateSecret.id", id);
    return this.req<WebhookEndpoint>(
      `/api/public/v1/webhook-endpoints/${encodeURIComponent(id)}/rotate-secret`,
      { method: "POST" },
    );
  }
}

class TokenResource {
  constructor(private req: Requester) {}
  list(params: { chain?: Chain | string } = {}): Promise<{ data: SplintrToken[] }> {
    if (params.chain !== undefined) v.str("tokens.list.chain", params.chain, { min: 1, max: 64 });
    return this.req(`/api/public/v1/tokens`, { query: { chain: params.chain } });
  }
}

class NetworkResource {
  constructor(private req: Requester) {}
  list(): Promise<{ data: PaymentNetwork[] }> {
    return this.req("/api/public/v1/networks");
  }
}

// ---------- Webhook signature verification ----------

class WebhookHelpers {
  async verify(
    payload: string,
    header: string | null,
    secret: string,
    tolerance = 300,
  ): Promise<boolean> {
    if (!header) return false;
    const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
    const t = Number(parts.t);
    const sig = parts.v1;
    if (!t || !sig) return false;
    const skew = Math.abs(Math.floor(Date.now() / 1000) - t);
    if (skew > tolerance) return false;
    const expected = await hmacHex(secret, `${t}.${payload}`);
    return timingSafeEqualHex(expected, sig);
  }

  parse<T = unknown>(payload: string): WebhookEvent<T> {
    return JSON.parse(payload) as WebhookEvent<T>;
  }
}

export interface VerifyWebhookInput {
  payload: string;
  signature: string | null | undefined;
  secret: string;
  tolerance?: number;
}

/** Verify + parse in one call. Throws SplintrError on any failure. */
export async function verifyWebhook<T = unknown>(
  input: VerifyWebhookInput,
): Promise<WebhookEvent<T>> {
  if (!input || typeof input !== "object")
    throw new SplintrValidationError("verifyWebhook", "expected object");
  v.str("verifyWebhook.payload", input.payload, { min: 1 });
  v.str("verifyWebhook.secret", input.secret, { min: 8 });
  if (input.tolerance !== undefined)
    v.num("verifyWebhook.tolerance", input.tolerance, { min: 0, max: 3600, int: true });
  const helper = new WebhookHelpers();
  const ok = await helper.verify(
    input.payload,
    input.signature ?? null,
    input.secret,
    input.tolerance,
  );
  if (!ok)
    throw new SplintrError(401, "invalid_signature", "webhook signature verification failed", null);
  return helper.parse<T>(input.payload);
}

// ---------- Splintr: alias with a nicer ctor + tokens on the root ----------

export class Splintr extends SplintrClient {
  constructor(
    opts:
      | SplintrOptions
      | {
          secretKey: string;
          baseUrl?: string;
          fetch?: typeof fetch;
          timeout?: number;
          retries?: number;
          debug?: boolean;
        },
  ) {
    const apiKey = "secretKey" in opts ? opts.secretKey : opts.apiKey;
    super({
      apiKey,
      baseUrl: opts.baseUrl,
      fetch: opts.fetch,
      timeout: opts.timeout,
      retries: opts.retries,
      debug: opts.debug,
    });
  }
}

// ---------- Crypto helpers ----------

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
