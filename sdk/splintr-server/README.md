# @splintr-dev/server

Runtime-agnostic Splintr SDK. Zero dependencies. Works in Node 18+, Bun, Deno,
Cloudflare Workers, Vercel Edge, and every runtime with global `fetch`.

Splintr launches on Robinhood Chain, while the SDK remains chain-agnostic across
all supported payment and settlement networks.

All inputs are validated at runtime — bad parameters throw `SplintrValidationError`
with a clear path (e.g. `[splintr] createIntent.amount: min 0.01`) before a
network round-trip.

## Install

```bash
npm install @splintr-dev/server
# or: bun add @splintr-dev/server
# or: pnpm add @splintr-dev/server
```

## Required environment variables

| Name                     | Where       | Example                                    |
| ------------------------ | ----------- | ------------------------------------------ |
| `SPLINTR_SECRET_KEY`        | server only | `sk_live_…` or `sk_test_…`                 |
| `SPLINTR_WEBHOOK_SECRET`    | server only | value shown when you create the webhook    |
| `SPLINTR_BASE_URL` _(opt.)_ | server only | override host, default `https://splintr.cash` |

Never expose `sk_…` in a browser bundle.

## End-to-end example (copy-paste)

**1. Create an intent from your backend**

```ts
// server/splintr.ts
import { Splintr } from "@splintr-dev/server";

export const splintr = new Splintr({ secretKey: process.env.SPLINTR_SECRET_KEY! });

export async function startCheckout(orderId: string, cents: number, email: string) {
  const intent = await splintr.paymentIntents.create({
    amount: cents / 100,
    currency: "USD",
    customerEmail: email,
    settlement: {
      chain: "robinhood",
      token: "ETH",
      address: process.env.MERCHANT_WALLET_ADDRESS!,
    },
    successUrl: "https://shop.example.com/thanks",
    cancelUrl: "https://shop.example.com/cart",
    metadata: { order_id: orderId },
    idempotencyKey: `order_${orderId}`,
  });
  return { intentId: intent.id, checkoutUrl: intent.checkout_url };
}
```

**2. Verify inbound webhooks**

```ts
// server/webhook.ts
import { verifyWebhook } from "@splintr-dev/server";

export async function POST(req: Request) {
  const payload = await req.text();
  const event = await verifyWebhook({
    payload,
    signature: req.headers.get("splintr-signature"),
    secret: process.env.SPLINTR_WEBHOOK_SECRET!,
  });

  if (event.type === "payment_intent.settled") {
    await markOrderPaid(event.data as { id: string; metadata: { order_id: string } });
  }
  return new Response("ok");
}
```

**3. React drop-in on the frontend** — see `@splintr-dev/react`.

## Advanced options

```ts
const splintr = new Splintr({
  secretKey: process.env.SPLINTR_SECRET_KEY!,
  baseUrl: "https://splintr.cash", // default
  timeoutMs: 15_000, // per-request timeout
  maxRetries: 3, // retries on 5xx / network errors with Retry-After honored
  fetch: myCustomFetch, // inject a custom fetch (Workers, tracing, etc.)
});
```

Every method throws `SplintrError` on non-2xx responses. It carries `status`,
`code`, `message`, and `requestId` for observability, plus the raw provider
body when available.

## Validation errors

Every method validates its arguments and throws a `SplintrValidationError`
before touching the network:

```ts
splintr.paymentIntents.create({ amount: -5 });
// SplintrValidationError: [splintr] createIntent.amount: min 0.01
```

## Public API surface

- `splintr.paymentIntents.{create, retrieve, list, cancel, transactions, routing}`
  - `routing(id)` returns router candidates evaluated for the intent (chosen + rejected with reasons). `route(id)` is kept as a deprecated alias.
- `splintr.refunds.{create, retrieve, list, retry, status}` — `retry(id, { destination })` requeues a failed refund, optionally to a different address
- `splintr.payouts.{retrieve, list, replay}`
- `splintr.webhookEndpoints.{create, list, retrieve, update, delete, rotateSecret}`
- `splintr.tokens.list({ chain })`
- `verifyWebhook({ payload, signature, secret })`
- `SplintrError` (HTTP + upstream) and `SplintrValidationError` (input)

## Idempotency

Every `POST` accepts an optional `Idempotency-Key` header (SDK auto-sends it
when you set `idempotencyKey`). Replays within 24h with the **same body**
return the original response; a **different body** returns HTTP `409` with
`code: "idempotency_conflict"`.

## Webhook events

The SDK's `WebhookEventType` union stays in sync with the API. Notable events:
`payment_intent.created`, `payment_intent.quoted`, `payment_intent.executing`,
`payment_intent.settled`, `payment_intent.failed`, `payment_intent.expired`,
`payment_intent.cancelled`, `payment_intent.refunded`, `payout.created`,
`payout.paid`, `payout.failed`, `ping`.

## License

MIT
