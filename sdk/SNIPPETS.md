# Splintr REST snippets

Copy-paste snippets for **every** production route. Three flavors per flow:

- **cURL** — dependency-free, works anywhere.
- **Typed SDK** — [`@splintr-dev/server/openapi`](https://www.npmjs.com/package/@splintr-dev/server), full autocomplete from `public/openapi.yaml`.
- **High-level SDK** — [`@splintr-dev/server`](https://www.npmjs.com/package/@splintr-dev/server), ergonomic wrappers with validation and retries.

All examples target `https://splintr.cash`. Swap in `https://splintr.cash` for staging.
Every write endpoint accepts `Idempotency-Key` — use a stable business ID so retries don't double-charge.

---

## 0. Setup

```bash
export SPLINTR_SECRET_KEY=sk_test_...
export MERCHANT_WALLET=YourEvmOrSolanaSettlementAddress
```

```ts
// Typed low-level (regenerated from openapi.yaml on every CI run)
import { createSplintrClient } from "@splintr-dev/server/openapi";
const splintr = createSplintrClient({ apiKey: process.env.SPLINTR_SECRET_KEY! });

// High-level
import { Splintr } from "@splintr-dev/server";
const sdk = new Splintr({ apiKey: process.env.SPLINTR_SECRET_KEY! });
```

---

## 1. Payment intents

### Create intent — `POST /api/public/v1/payment-intents`

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

```ts
const { data, error } = await splintr.POST("/api/public/v1/payment-intents", {
  body: {
    amount: 25,
    currency: "USD",
    settlement: { chain: "robinhood", token: "USDC", address: process.env.MERCHANT_WALLET! },
    metadata: { orderId: "ord_123" },
  },
  headers: { "Idempotency-Key": "ord_123" },
});
if (error) throw error;
console.log(data.id, data.checkout_url);
```

```ts
const intent = await sdk.paymentIntents.create(
  {
    amount: 25,
    currency: "USD",
    settlement: { chain: "robinhood", token: "USDC", address: process.env.MERCHANT_WALLET! },
    metadata: { orderId: "ord_123" },
  },
  { idempotencyKey: "ord_123" },
);
```

### Retrieve intent — `GET /api/public/v1/payment-intents/{id}`

```bash
curl https://splintr.cash/api/public/v1/payment-intents/$INTENT_ID \
  -H "Authorization: Bearer $SPLINTR_SECRET_KEY"
```

```ts
const { data } = await splintr.GET("/api/public/v1/payment-intents/{id}", {
  params: { path: { id: intentId } },
});
```

```ts
const intent = await sdk.paymentIntents.retrieve(intentId);
```

### List intents — `GET /api/public/v1/payment-intents?limit=&status=`

```bash
curl "https://splintr.cash/api/public/v1/payment-intents?limit=20&status=settled" \
  -H "Authorization: Bearer $SPLINTR_SECRET_KEY"
```

```ts
const { data } = await splintr.GET("/api/public/v1/payment-intents", {
  params: { query: { limit: 20, status: "settled" } },
});
```

### Cancel intent — `POST /api/public/v1/payment-intents/{id}/cancel`

Cancelling a partially-funded intent auto-enqueues a refund for the received legs.

```bash
curl -X POST https://splintr.cash/api/public/v1/payment-intents/$INTENT_ID/cancel \
  -H "Authorization: Bearer $SPLINTR_SECRET_KEY"
```

```ts
await splintr.POST("/api/public/v1/payment-intents/{id}/cancel", {
  params: { path: { id: intentId } },
});
```

```ts
await sdk.paymentIntents.cancel(intentId);
```

### List routing candidates — `GET /api/public/v1/payment-intents/{id}/routes`

Every provider the cost-optimizer evaluated for this intent, with the chosen route flagged.

```bash
curl https://splintr.cash/api/public/v1/payment-intents/$INTENT_ID/routes \
  -H "Authorization: Bearer $SPLINTR_SECRET_KEY"
```

```ts
const { data } = await splintr.GET("/api/public/v1/payment-intents/{id}/routes", {
  params: { path: { id: intentId } },
});
console.log(data.data.filter((r) => r.chosen));
```

---

## 2. Public checkout view (unauthenticated)

Used by the hosted checkout and any polling client. **No auth header.**

`GET /api/public/v1/checkout/{id}`

```bash
curl https://splintr.cash/api/public/v1/checkout/$INTENT_ID
```

```ts
const { data } = await splintr.GET("/api/public/v1/checkout/{id}", {
  params: { path: { id: intentId } },
});
// { status, amount_paid_usd, amount_remaining_usd, legs, ... }
```

Poll every 2s until `status` is terminal (`settled | failed | expired | cancelled | refunded`).

---

## 3. Refunds

### Create refund — `POST /api/public/v1/refunds`

Body is **snake_case**: `intent_id` + `amount_usd`. Omit `destination` to let the merchant fill it in from the dashboard.

```bash
curl -X POST https://splintr.cash/api/public/v1/refunds \
  -H "Authorization: Bearer $SPLINTR_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: rf_ord_123" \
  -d '{
    "intent_id": "'"$INTENT_ID"'",
    "amount_usd": 25.00,
    "destination": "0xabc0000000000000000000000000000000000000",
    "reason": "customer_request"
  }'
```

```ts
const { data, error } = await splintr.POST("/api/public/v1/refunds", {
  body: {
    intent_id: intentId,
    amount_usd: 25,
    destination: "0xabc0000000000000000000000000000000000000",
    reason: "customer_request",
  },
  headers: { "Idempotency-Key": "rf_ord_123" },
});
if (error) throw error;
```

```ts
const refund = await sdk.refunds.create({
  paymentIntentId: intentId,
  amountUsd: 25,
  destination: "0xabc0000000000000000000000000000000000000",
  reason: "customer_request",
  idempotencyKey: "rf_ord_123",
});

// Refund bounced? Requeue it to a different address.
await sdk.refunds.retry(refund.id, { destination: "0xNewWallet", reason: "address_bounced" });
```

### List refunds — `GET /api/public/v1/refunds?payment_intent_id=&limit=`

```bash
curl "https://splintr.cash/api/public/v1/refunds?payment_intent_id=$INTENT_ID&limit=50" \
  -H "Authorization: Bearer $SPLINTR_SECRET_KEY"
```

### Retrieve refund — `GET /api/public/v1/refunds/{id}`

```bash
curl https://splintr.cash/api/public/v1/refunds/$REFUND_ID \
  -H "Authorization: Bearer $SPLINTR_SECRET_KEY"
```

### Payer-facing refund status (unauthenticated, safe to email)

`GET /api/public/refunds/{id}/status` — address redacted to last 6 chars, no PII.

```bash
curl https://splintr.cash/api/public/refunds/$REFUND_ID/status
```

Or link the customer to `https://splintr.cash/refund/$REFUND_ID/status`.

---

## 4. Payouts

### List payouts — `GET /api/public/v1/payouts?payment_intent_id=&limit=`

```bash
curl "https://splintr.cash/api/public/v1/payouts?limit=50" \
  -H "Authorization: Bearer $SPLINTR_SECRET_KEY"
```

### Retrieve payout — `GET /api/public/v1/payouts/{id}`

Response includes `meta.attempts_log` with rail fallbacks, cost estimates, and failure reasons.

```bash
curl https://splintr.cash/api/public/v1/payouts/$PAYOUT_ID \
  -H "Authorization: Bearer $SPLINTR_SECRET_KEY"
```

---

## 5. Webhook endpoints (CRUD)

### Create endpoint — `POST /api/public/v1/webhook-endpoints`

```bash
curl -X POST https://splintr.cash/api/public/v1/webhook-endpoints \
  -H "Authorization: Bearer $SPLINTR_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-app.com/api/splintr/webhook",
    "events": ["payment_intent.settled", "payment_intent.failed", "refund.paid"]
  }'
```

Response includes a one-time `secret` — store it in `SPLINTR_WEBHOOK_SECRET`.

### List / Retrieve / Delete endpoints

```bash
curl https://splintr.cash/api/public/v1/webhook-endpoints -H "Authorization: Bearer $SPLINTR_SECRET_KEY"
curl https://splintr.cash/api/public/v1/webhook-endpoints/$WEBHOOK_ID -H "Authorization: Bearer $SPLINTR_SECRET_KEY"
curl -X DELETE https://splintr.cash/api/public/v1/webhook-endpoints/$WEBHOOK_ID -H "Authorization: Bearer $SPLINTR_SECRET_KEY"
```

### Verify inbound webhook

```ts
import { verifyWebhook } from "@splintr-dev/server";

export async function POST(req: Request) {
  const body = await req.text(); // RAW — do NOT JSON.stringify
  const event = await verifyWebhook({
    payload: body,
    signature: req.headers.get("splintr-signature")!,
    secret: process.env.SPLINTR_WEBHOOK_SECRET!,
  });
  // switch on event.type — see COOKBOOK.md §2
  return new Response("ok");
}
```

---

## 6. Token registry (public)

`GET /api/public/v1/tokens` — the ~150 supported tokens across all chains.

```bash
curl https://splintr.cash/api/public/v1/tokens
```

```ts
const { data } = await splintr.GET("/api/public/v1/tokens");
```

---

## 7. Error shapes

Every 4xx/5xx has `{ error: string, code?: string, ...meta }`.

| Status | Meaning                                | Fix                                          |
| ------ | -------------------------------------- | -------------------------------------------- |
| 401    | Invalid or missing key                 | Swap key, check test/live mode               |
| 404    | Not found or not owned by the merchant | Confirm ID and mode                          |
| 409    | Invalid status for the action          | e.g. cannot refund an `executing` intent     |
| 422    | Validation error                       | Read `error`; for refunds, check `remaining` |
| 429    | Rate limited                           | High-level SDK auto-retries on `Retry-After` |

---

## 8. Regenerating this typed client

Run in `sdk/splintr-server`:

```bash
npm run codegen   # openapi-typescript ../../public/openapi.yaml -> src/openapi.d.ts
npm run build
```

CI (`.github/workflows/ci.yml` → `regen-check`) fails any PR whose committed
`src/openapi.d.ts` drifts from what the current `public/openapi.yaml` generates,
so the typed client is always exactly the API surface.
