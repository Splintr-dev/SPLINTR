/**
 * @splintr-dev/react
 *
 * Drop-in React components for Splintr hosted checkout. Zero runtime deps.
 */

import * as React from "react";

// ---------- Context ----------

interface SplintrContextValue {
  publicKey: string;
  baseUrl: string;
}

const SplintrContext = React.createContext<SplintrContextValue | null>(null);

export interface SplintrProviderProps {
  publicKey: string;
  /** Override the API/host origin. Defaults to https://splintr.cash. */
  baseUrl?: string;
  children: React.ReactNode;
}

export function SplintrProvider({ publicKey, baseUrl, children }: SplintrProviderProps) {
  if (typeof publicKey !== "string" || !/^pk_(test|live)_[A-Za-z0-9_-]{8,}$/.test(publicKey)) {
    throw new Error(
      "[splintr] publicKey must match pk_test_… or pk_live_… (min 8 chars after prefix)",
    );
  }
  if (baseUrl !== undefined) {
    try {
      new URL(baseUrl);
    } catch {
      throw new Error("[splintr] baseUrl must be an absolute URL");
    }
  }
  const value = React.useMemo<SplintrContextValue>(
    () => ({ publicKey, baseUrl: (baseUrl ?? "https://splintr.cash").replace(/\/$/, "") }),
    [publicKey, baseUrl],
  );
  return <SplintrContext.Provider value={value}>{children}</SplintrContext.Provider>;
}

function useSplintr() {
  const ctx = React.useContext(SplintrContext);
  if (!ctx) throw new Error("Wrap your tree with <SplintrProvider>");
  return ctx;
}

// ---------- fetchWithRetry (429 + 5xx w/ Retry-After, exponential backoff) ----------

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

function parseRetryAfter(h: string | null): number | null {
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs, 60) * 1000;
  const when = Date.parse(h);
  if (!Number.isNaN(when)) return Math.max(0, Math.min(60_000, when - Date.now()));
  return null;
}

export interface FetchWithRetryOpts extends RequestInit {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Retry POSTs on 429/503; other 5xx are only retried for idempotent methods. */
  retryOnMethods?: string[];
}

/**
 * Fetch wrapper that honors Retry-After on 429/503 and does exponential backoff
 * with jitter for retryable failures. Exposed for advanced integrators.
 */
export async function fetchWithRetry(
  input: string,
  init: FetchWithRetryOpts = {},
): Promise<Response> {
  const {
    maxRetries = 4,
    baseDelayMs = 500,
    maxDelayMs = 8000,
    retryOnMethods = ["GET", "HEAD", "POST"],
    ...rest
  } = init;
  const method = (rest.method ?? "GET").toUpperCase();
  const canRetry = retryOnMethods.map((m) => m.toUpperCase()).includes(method);

  let attempt = 0;
  while (true) {
    let res: Response | null = null;
    let netErr: unknown = null;
    try {
      res = await fetch(input, rest);
    } catch (e) {
      netErr = e;
    }

    const status = res?.status ?? 0;
    const retriable =
      !!netErr || status === 429 || status === 503 || (status >= 500 && status < 600);
    if (!retriable || !canRetry || attempt >= maxRetries) {
      if (res) return res;
      throw netErr ?? new Error("network error");
    }

    const hinted = res ? parseRetryAfter(res.headers.get("retry-after")) : null;
    const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    const jitter = Math.random() * (backoff * 0.25);
    const delay = hinted ?? backoff + jitter;
    await sleep(delay, rest.signal ?? undefined);
    attempt += 1;
  }
}

// ---------- Types ----------

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

export interface PublicIntent {
  id: string;
  amount: string;
  currency: string;
  status: IntentStatus;
  settlement_chain?: string | null;
  settlement_token?: string | null;
  expires_at?: string;
  metadata?: Record<string, unknown>;
}

// ---------- Refund types + phase helper ----------

export type RefundStatus = "pending" | "processing" | "retry_scheduled" | "succeeded" | "failed";
export type RefundPhase = "queued" | "sent" | "completed" | "failed";

/**
 * Bucket a raw refund status into a stable UI phase. Mirrors the identical
 * helper in `@splintr-dev/server` so front-end and back-end render matching
 * status pills.
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

export interface PublicRefundStatus {
  id: string;
  payment_intent_id: string;
  amount_usd: number;
  chain: string | null;
  token: string | null;
  destination_tail: string;
  reason: string;
  status: RefundStatus;
  phase: RefundPhase;
  tx_hash: string | null;
  failure_reason: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  terminal: boolean;
}

// ---------- Polling hook ----------

export function useSplintrIntent(intentId: string | null, opts: { intervalMs?: number } = {}) {
  const { baseUrl } = useSplintr();
  if (intentId !== null && (typeof intentId !== "string" || intentId.length < 3)) {
    throw new Error("[splintr] useSplintrIntent: intentId must be a non-empty string or null");
  }
  const interval = opts.intervalMs ?? 2000;
  if (typeof interval !== "number" || interval < 250 || interval > 60_000) {
    throw new Error("[splintr] useSplintrIntent: intervalMs must be between 250 and 60000");
  }

  const [state, setState] = React.useState<{
    data: PublicIntent | null;
    status: "idle" | "loading" | "ready" | "error";
    error: string | null;
  }>({ data: null, status: "idle", error: null });

  React.useEffect(() => {
    if (!intentId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      try {
        const res = await fetchWithRetry(`${baseUrl}/api/public/v1/checkout/${intentId}`, {
          maxRetries: 4,
        });
        if (!res.ok) {
          const retryAfter = parseRetryAfter(res.headers.get("retry-after")) ?? interval * 2;
          throw Object.assign(new Error(`HTTP ${res.status}`), { retryAfter });
        }
        const data = (await res.json()) as PublicIntent;
        if (!alive) return;
        setState({ data, status: "ready", error: null });
        const terminal = ["settled", "failed", "expired", "cancelled", "refunded"].includes(
          data.status,
        );
        if (!terminal) timer = setTimeout(tick, interval);
      } catch (e) {
        if (!alive) return;
        const wait = (e as { retryAfter?: number }).retryAfter ?? interval * 2;
        setState((s) => ({ ...s, status: "error", error: (e as Error).message }));
        timer = setTimeout(tick, wait);
      }
    }
    setState({ data: null, status: "loading", error: null });
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [intentId, baseUrl, interval]);

  return state;
}

// ---------- Refund polling hook ----------

/**
 * Poll the payer-facing refund status endpoint at `/api/public/refunds/:id/status`.
 * UNAUTHENTICATED — safe to use in customer-facing receipt / order-tracking UIs.
 *
 * Returns `{ data, status, error }` where `data.phase` buckets the raw refund
 * state into `queued | sent | completed | failed` for a stable status pill.
 * Polling stops automatically once `data.terminal === true`.
 */
export function useSplintrRefund(refundId: string | null, opts: { intervalMs?: number } = {}) {
  const { baseUrl } = useSplintr();
  if (refundId !== null && (typeof refundId !== "string" || refundId.length < 3)) {
    throw new Error("[splintr] useSplintrRefund: refundId must be a non-empty string or null");
  }
  const interval = opts.intervalMs ?? 3000;
  if (typeof interval !== "number" || interval < 500 || interval > 60_000) {
    throw new Error("[splintr] useSplintrRefund: intervalMs must be between 500 and 60000");
  }

  const [state, setState] = React.useState<{
    data: PublicRefundStatus | null;
    status: "idle" | "loading" | "ready" | "error";
    error: string | null;
  }>({ data: null, status: "idle", error: null });

  React.useEffect(() => {
    if (!refundId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      try {
        const res = await fetchWithRetry(`${baseUrl}/api/public/refunds/${refundId}/status`, {
          maxRetries: 4,
        });
        if (!res.ok) {
          const retryAfter = parseRetryAfter(res.headers.get("retry-after")) ?? interval * 2;
          throw Object.assign(new Error(`HTTP ${res.status}`), { retryAfter });
        }
        const raw = (await res.json()) as Omit<PublicRefundStatus, "phase">;
        const data: PublicRefundStatus = { ...raw, phase: refundPhase(raw.status) };
        if (!alive) return;
        setState({ data, status: "ready", error: null });
        if (!data.terminal) timer = setTimeout(tick, interval);
      } catch (e) {
        if (!alive) return;
        const wait = (e as { retryAfter?: number }).retryAfter ?? interval * 2;
        setState((s) => ({ ...s, status: "error", error: (e as Error).message }));
        timer = setTimeout(tick, wait);
      }
    }
    setState({ data: null, status: "loading", error: null });
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [refundId, baseUrl, interval]);

  return state;
}

// ---------- Checkout embed ----------

export interface SplintrCheckoutProps {
  intentId: string;
  /** Called once the intent transitions to `settled`. */
  onSettled?: (intent: PublicIntent) => void;
  /** Called on `failed` | `expired` | `cancelled`. */
  onError?: (intent: PublicIntent) => void;
  /** Iframe height in px. Defaults to 640. */
  height?: number;
  className?: string;
  style?: React.CSSProperties;
  /** Render inline iframe (default) or open Splintr checkout in a popup. */
  mode?: "iframe" | "redirect";
}

export function SplintrCheckout({
  intentId,
  onSettled,
  onError,
  height = 640,
  className,
  style,
  mode = "iframe",
}: SplintrCheckoutProps) {
  const { baseUrl } = useSplintr();
  const url = `${baseUrl}/checkout/${intentId}?embed=1`;
  const intent = useSplintrIntent(intentId);
  const fired = React.useRef(false);

  React.useEffect(() => {
    if (fired.current || !intent.data) return;
    const s = intent.data.status;
    if (s === "settled") {
      fired.current = true;
      onSettled?.(intent.data);
    } else if (s === "failed" || s === "expired" || s === "cancelled") {
      fired.current = true;
      onError?.(intent.data);
    }
  }, [intent.data, onSettled, onError]);

  if (mode === "redirect") {
    return (
      <a
        href={`${baseUrl}/checkout/${intentId}`}
        className={className}
        style={style}
        target="_blank"
        rel="noreferrer"
      >
        Pay with Splintr
      </a>
    );
  }

  return (
    <iframe
      title="Splintr checkout"
      src={url}
      className={className}
      style={{ width: "100%", height, border: 0, borderRadius: 8, ...style }}
      allow="clipboard-write; payment"
    />
  );
}

// ---------- useSplintrTokens ----------

export interface SplintrToken {
  chain: string;
  address: string;
  symbol: string;
  decimals: number;
  verified: boolean;
  name?: string;
}

export function useSplintrTokens(params: { chain?: string } = {}) {
  const { baseUrl } = useSplintr();
  const [state, setState] = React.useState<{
    data: SplintrToken[];
    loading: boolean;
    error: string | null;
  }>({
    data: [],
    loading: true,
    error: null,
  });
  React.useEffect(() => {
    let alive = true;
    const url = params.chain
      ? `${baseUrl}/api/public/v1/tokens?chain=${encodeURIComponent(params.chain)}`
      : `${baseUrl}/api/public/v1/tokens`;
    fetchWithRetry(url, { maxRetries: 3 })
      .then((r) => r.json())
      .then((j) => {
        if (alive) setState({ data: j.data ?? [], loading: false, error: null });
      })
      .catch((e) => {
        if (alive) setState({ data: [], loading: false, error: (e as Error).message });
      });
    return () => {
      alive = false;
    };
  }, [baseUrl, params.chain]);
  return state;
}

// ---------- useCreateIntent ----------
//
// Wraps the merchant's own backend so the sk_ secret key never touches the
// browser. Pass an `endpoint` that POSTs to your server; your server calls
// `splintr.paymentIntents.create()` and returns the intent JSON.

export interface UseCreateIntentOptions<TInput = unknown> {
  /** Absolute or relative URL on YOUR backend that creates an intent. */
  endpoint: string;
  /** Custom transformer if you want to shape the request body. */
  transform?: (input: TInput) => unknown;
  headers?: Record<string, string>;
}

export function useCreateIntent<TInput = Record<string, unknown>>(
  opts: UseCreateIntentOptions<TInput>,
) {
  if (!opts || typeof opts.endpoint !== "string" || opts.endpoint.length === 0) {
    throw new Error("[splintr] useCreateIntent: `endpoint` is required");
  }
  const [state, setState] = React.useState<{
    intent: (PublicIntent & { checkout_url?: string }) | null;
    loading: boolean;
    error: string | null;
  }>({ intent: null, loading: false, error: null });

  const mutate = React.useCallback(
    async (input: TInput) => {
      setState({ intent: null, loading: true, error: null });
      try {
        const body = opts.transform ? opts.transform(input) : input;
        const res = await fetchWithRetry(opts.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
          body: JSON.stringify(body),
          maxRetries: 3,
        });
        if (!res.ok) {
          const retryAfter = res.headers.get("retry-after");
          const suffix = res.status === 429 && retryAfter ? ` (retry after ${retryAfter}s)` : "";
          throw new Error(`HTTP ${res.status}${suffix}: ${await res.text()}`);
        }
        const intent = await res.json();
        setState({ intent, loading: false, error: null });
        return intent as PublicIntent & { checkout_url?: string };
      } catch (e) {
        setState({ intent: null, loading: false, error: (e as Error).message });
        throw e;
      }
    },
    [opts.endpoint, opts.transform, opts.headers],
  );

  return { ...state, mutate };
}

// ---------- <SplintrButton> — one-line drop-in ----------

export interface SplintrButtonProps extends UseCreateIntentOptions {
  input?: Record<string, unknown>;
  label?: string;
  onSettled?: (intent: PublicIntent) => void;
  onError?: (intent: PublicIntent) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function SplintrButton({
  input,
  label = "Pay with Splintr",
  onSettled,
  onError,
  className,
  style,
  ...opts
}: SplintrButtonProps) {
  const { intent, loading, error, mutate } = useCreateIntent(opts);
  return (
    <>
      <button
        type="button"
        className={className}
        style={style}
        disabled={loading}
        onClick={() => mutate(input ?? {})}
      >
        {loading ? "Loading…" : label}
      </button>
      {error && (
        <div role="alert" style={{ color: "crimson", fontSize: 12 }}>
          {error}
        </div>
      )}
      {intent?.id && (
        <SplintrCheckout intentId={intent.id} onSettled={onSettled} onError={onError} />
      )}
    </>
  );
}
