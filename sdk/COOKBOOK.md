# Splintr SDK Cookbook

Real, copy-paste recipes for the most common Splintr integrations. Every snippet
below is tested against the production API at `https://splintr.cash`.

- SDK reference: [@splintr-dev/server](https://www.npmjs.com/package/@splintr-dev/server) · [@splintr-dev/react](https://www.npmjs.com/package/@splintr-dev/react)
- REST reference: <https://splintr.cash/docs/api>
- OpenAPI: <https://splintr.cash/openapi.yaml>
- Postman: <https://splintr.cash/postman-collection.json>

---

## 1. Create an intent (Node / Bun / Deno / Workers)

```ts
import { Splintr } from "@splintr-dev/server";

const splintr = new Splintr({ apiKey: process.env.SPLINTR_SECRET_KEY! });

const intent = await splintr.paymentIntents.create(
  {
    amount: 25,
    currency: "USD",
    settlement: {
      chain: "robinhood",
      token: "USDC",
      address: process.env.MERCHANT_WALLET!,
    },
    metadata: { orderId: "ord_123" },
  },
  { idempotencyKey: "ord_123" },
);

console.log(intent.id, intent.checkout_url);
```

The same call over raw HTTP:

```bash
curl -X POST https://splintr.cash/api/public/v1/payment-intents \
  -H "Authorization: Bearer $SPLINTR_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ord_123" \
  -d '{
    "amount": 25,
    "currency": "USD",
    "settlement": { "chain": "robinhood", "token": "USDC", "address": "'"$MERCHANT_WALLET"'" },
    "metadata": { "orderId": "ord_123" }
  }'
```

---

## 2. Verify a webhook

### Next.js App Router

```ts
// app/api/splintr/webhook/route.ts
import { verifyWebhook } from "@splintr-dev/server";

export async function POST(req: Request) {
  const body = await req.text(); // RAW body — never JSON.stringify
  const sig = req.headers.get("splintr-signature")!;

  try {
    const event = await verifyWebhook({
      payload: body,
      signature: sig,
      secret: process.env.SPLINTR_WEBHOOK_SECRET!,
    });

    if (event.type === "payment_intent.settled") {
      await fulfillOrder(event.data.metadata.orderId as string);
    }
  } catch {
    return new Response("bad signature", { status: 400 });
  }
  return new Response("ok");
}
```

### Express

```ts
import express from "express";
import { verifyWebhook } from "@splintr-dev/server";

const app = express();

app.post(
  "/api/splintr/webhook",
  express.raw({ type: "application/json" }), // MUST be raw
  async (req, res) => {
    try {
      const event = await verifyWebhook({
        payload: req.body.toString("utf8"),
        signature: req.header("splintr-signature")!,
        secret: process.env.SPLINTR_WEBHOOK_SECRET!,
      });
      await handle(event);
      res.send("ok");
    } catch {
      res.status(400).send("bad signature");
    }
  },
);
```

### Cloudflare Workers / Hono

```ts
app.post("/api/splintr/webhook", async (c) => {
  const body = await c.req.text();
  const event = await verifyWebhook({
    payload: body,
    signature: c.req.header("splintr-signature")!,
    secret: c.env.SPLINTR_WEBHOOK_SECRET,
  });
  await handle(event);
  return c.text("ok");
});
```

---

## 3. React checkout — full page

```tsx
import { SplintrProvider, SplintrCheckout } from "@splintr-dev/react";

export default function Pay({ intentId }: { intentId: string }) {
  return (
    <SplintrProvider publicKey={import.meta.env.VITE_SPLINTR_PUBLIC_KEY}>
      <SplintrCheckout
        intentId={intentId}
        onSettled={(i) => (location.href = `/thanks/${i.id}`)}
        onError={(err) => console.error(err)}
      />
    </SplintrProvider>
  );
}
```

## 4. React checkout — hosted redirect (no client SDK)

```tsx
async function pay() {
  const res = await fetch("/api/create-intent", { method: "POST" });
  const { checkout_url } = await res.json();
  window.location.href = checkout_url; // splintr.cash-hosted checkout
}
```

## 5. Vanilla HTML — iframe embed

See [`examples/html-vanilla/index.html`](../examples/html-vanilla/index.html):

```html
<iframe src="https://splintr.cash/checkout/INTENT_ID?embed=1" style="width:100%;height:640px;border:0"></iframe>
```

Poll status from the browser:

```js
const r = await fetch(`https://splintr.cash/api/public/v1/checkout/${id}`);
const { status } = await r.json();
```

---

## 6. Refunds

`destination` is optional. Omit it and Splintr will auto-fill the payer's
originating address from the intent's confirmed leg(s). If nothing can be
derived the refund stays `pending` with `failure_reason: "missing_destination"`
until the merchant supplies one from the dashboard.

```ts
const refund = await splintr.refunds.create({
  paymentIntentId: intent.id,
  amountUsd: 25.0,
  // destination: "0xabc...", // optional — auto-derived from payer leg when omitted
  reason: "customer_request",
  idempotencyKey: crypto.randomUUID(),
});
```

Raw REST — note the **snake_case** field names:

```bash
curl -X POST https://splintr.cash/api/public/v1/refunds \
  -H "Authorization: Bearer $SPLINTR_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "intent_id": "pi_...", "amount_usd": 25.00, "reason": "customer_request" }'
```

### Retrying a refund (optionally to a different address)

```ts
await splintr.refunds.retry(refundId);                                  // same address
await splintr.refunds.retry(refundId, { destination: "0xNewWallet…" }); // new address
```

```bash
curl -X POST https://splintr.cash/api/public/v1/refunds/$REFUND_ID/retry \
  -H "Authorization: Bearer $SPLINTR_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "destination": "0xNewWallet", "reason": "address_bounced" }'
```

Works for `failed`, `retry_scheduled` and `pending` refunds (including
`missing_destination`). Terminal refunds return `409`. Agents can do the same
through the `retry_refund` MCP tool.

### Auto-refunds on expiry

If an intent expires with partial funds, Splintr's expiry cron automatically
enqueues a refund per confirmed payer leg back to the wallet each leg came
from — idempotent, per-chain, no merchant action required. Merchants and
payers see the refund on the payment detail page and at
`https://splintr.cash/pay/{intent_id}/status`. Subscribe to `refund.created` /
`refund.paid` / `refund.failed` to react programmatically.

### Escrow model

Most payments settle via atomic, non-custodial swaps directly to the merchant
settlement address — Splintr never holds funds. Sub-$2 "dust" remainders that no
bridge will quote for route through the Splintr escrow wallet, which is what
enables per-leg refunds on expired partials.

Public payer-facing refund status (unauthenticated, safe to email):

```
https://splintr.cash/refund/{refund_id}/status
```


---

## 7. Idempotency

Every write endpoint accepts `Idempotency-Key` (or `idempotencyKey` in SDKs).
Splintr stores the response for 24h keyed on `(merchant_id, key)`. Retrying with
the same key returns the original response — never a duplicate charge or
refund. Use a stable business ID (order ID, cart ID) rather than a UUID when
possible.

---

## 8. Error handling

```ts
import { Splintr, SplintrError } from "@splintr-dev/server";

try {
  await splintr.paymentIntents.create({ ... });
} catch (err) {
  if (err instanceof SplintrError) {
    console.error(err.status, err.code, err.message, err.requestId);
    // 401  invalid_key            — swap key or check test/live mode
    // 409  intent_not_refundable  — status guard
    // 422  refund_exceeds_balance — pass err.remaining to UI
    // 429  rate_limited           — SDK auto-retries with Retry-After
  }
  throw err;
}
```

All 4xx bodies follow `{ error: string, code?: string, ...meta }`; the SDK
promotes them to `SplintrError`.

---

## 9. Multi-token "vending machine"

You don't have to enable anything. Splintr routes every payer contribution
through the fee-scored router (LI.FI, Jupiter, deBridge, KyberSwap, Rango,
and 8 more). A customer can pay half in SOL, then top up with USDC on Base;
Splintr tracks the outstanding balance and settles you in one token on one chain.

Track partial funding in your webhook handler:

```ts
if (event.type === "payment_intent.partially_funded") {
  const { amount_paid_usd, amount_remaining_usd } = event.data;
  // update your UI or send a nudge email
}
```

---

## 10. AI agents (MCP)

Splintr ships a hosted MCP server at `https://splintr.cash/mcp` with 20 tools
covering intent, refund, payout, and webhook lifecycles. See
<https://splintr.cash/.well-known/mcp-install.json> for Claude, Cursor, and
generic client install snippets.

---

## 11. Optional `destination` + escrow-backed refunds

Splintr never custodies funds without a recovery path. When you create a refund
you can either name the payer address yourself, or omit `destination` and let
Splintr resolve it from the payer legs already recorded on the intent.

```ts
// A) Merchant-supplied destination (fastest path).
await splintr.refunds.create({
  paymentIntentId: intent.id,
  amountUsd: 25.0,
  destination: "0xPayer…",          // must match one of the payer legs' families
  reason: "customer_request",
  idempotencyKey: `refund_${intent.id}_full`,
});

// B) Omit destination — Splintr auto-fills from the confirmed payer leg(s).
//    Safe for partial fills, expiries, and MCP-triggered refunds where you
//    don't have the address handy.
await splintr.refunds.create({
  paymentIntentId: intent.id,
  amountUsd: 5.0,
  reason: "auto_expiry",
  idempotencyKey: `refund_${intent.id}_expiry`,
});
```

If no payer address can be derived (rare — only for pending intents that
never received a leg), the refund parks in `pending` with
`failure_reason: "missing_destination"` and surfaces in the dashboard for a
merchant to fill in. It never silently drops.

### The escrow / atomic-swap model

Every payer leg is either:

1. **Auto-swapped and forwarded** to your settlement wallet in the same
   dispatcher tick (LI.FI / Jupiter / Across / …), OR
2. **Held in the Splintr escrow pool** for dust-sized legs (< $2.00 economic
   floor) until enough legs accumulate to clear the router's fee guard, OR
3. **Refundable to the original payer** — the payer address is always
   captured on every leg, so any leg can be returned via option B above.

You never need to reconcile a "stuck" leg manually. The expiry cron
(`/api/public/cron/expire-intents`) enqueues auto-refunds for any confirmed
partial payments on an intent that times out.

---

## 12. Query & refetch payment history (client)

Merchant-authenticated: use the server SDK from a route handler or server
function, never from the browser.

```ts
// app/api/history/route.ts (Next.js) — server only
import { Splintr } from "@splintr-dev/server";

const splintr = new Splintr({ apiKey: process.env.SPLINTR_SECRET_KEY! });

export async function GET() {
  const [{ data: intents }, { data: refunds }, { data: payouts }] =
    await Promise.all([
      splintr.paymentIntents.list({ limit: 50 }),
      splintr.refunds.list({ limit: 50 }),
      splintr.payouts.list({ limit: 50 }),
    ]);
  return Response.json({ intents, refunds, payouts });
}
```

### Refetch on demand (React Query)

```tsx
import { useQuery, useQueryClient } from "@tanstack/react-query";

function useHistory() {
  return useQuery({
    queryKey: ["splintr", "history"],
    queryFn: () => fetch("/api/history").then((r) => r.json()),
    staleTime: 15_000,
  });
}

export function HistoryPanel() {
  const qc = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useHistory();

  return (
    <div>
      <button onClick={() => refetch()} disabled={isFetching}>
        {isFetching ? "Refreshing…" : "Refresh"}
      </button>
      {/* Optimistic invalidate after a merchant action (issue refund, etc.) */}
      <button onClick={() => qc.invalidateQueries({ queryKey: ["splintr", "history"] })}>
        Invalidate cache
      </button>
      {isLoading ? "…" : <HistoryTable {...data} />}
    </div>
  );
}
```

### Payer-facing: no key needed

The customer-facing status endpoints are unauthenticated and rate-limited
(120 req/min per IP). Perfect for order-tracking pages and email templates.

```tsx
import { useSplintrIntent, useSplintrRefund, refundPhase } from "@splintr-dev/react";

export function OrderStatus({ intentId, refundId }: { intentId: string; refundId?: string }) {
  const intent = useSplintrIntent(intentId, { intervalMs: 2500 });
  const refund = useSplintrRefund(refundId ?? null);

  return (
    <>
      <div>Payment: {intent.data?.status ?? "…"}</div>
      {refund.data && (
        <div>
          Refund: <b>{refund.data.phase}</b> {/* queued | sent | completed | failed */}
          {refund.data.tx_hash && (
            <a href={`https://explorer/${refund.data.tx_hash}`}>view tx</a>
          )}
        </div>
      )}
    </>
  );
}
```

Both hooks automatically stop polling once the resource reaches a terminal
state (`settled | failed | expired | cancelled | refunded` for intents,
`terminal: true` for refunds).

### Refetch a single record without React Query

```ts
import { Splintr, refundPhase } from "@splintr-dev/server";

// Server: pull a fresh snapshot after a webhook fires.
const intent = await splintr.paymentIntents.retrieve(id);
const refund = await splintr.refunds.retrieve(refundId);
console.log(refundPhase(refund.status)); // queued | sent | completed | failed
```

For raw HTTP the equivalents are:

```bash
curl -H "Authorization: Bearer $SPLINTR_SECRET_KEY" \
  "https://splintr.cash/api/public/v1/payment-intents?limit=50"

curl -H "Authorization: Bearer $SPLINTR_SECRET_KEY" \
  "https://splintr.cash/api/public/v1/refunds?status=processing&limit=50"

# Unauthenticated payer views:
curl "https://splintr.cash/api/public/v1/checkout/$INTENT_ID"
curl "https://splintr.cash/api/public/refunds/$REFUND_ID/status"
```

---

## 13. Provider health snapshot (CI / status page)

Confirm keyed router providers, RPC keys, and payout rails are live after a
deploy. Unauthenticated — safe to hit from GitHub Actions or an uptime probe.

```ts
import { Splintr } from "@splintr-dev/server";

const splintr = new Splintr({ apiKey: "unused-for-this-call" });
const snap = await splintr.healthProviders();

const down = snap.providers.filter(p => !p.live);
if (down.length) {
  console.warn("providers offline:", down.map(p => `${p.id} (${p.gate})`));
  process.exit(1);
}
console.log("rpc:", snap.rpc, "payouts:", snap.payouts);
```

---

## Support

- Docs: <https://splintr.cash/docs>
- Status: <https://splintr.cash/dashboard/ops>
- Email: `hello@splintr.cash`

