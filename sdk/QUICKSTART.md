# Splintr SDK — 10-Minute Quickstart

Accept any token on any chain and settle in one. Copy-paste every block below in order. Total time: ~10 minutes.

---

## 0. Prerequisites

- Node 18+ (or Bun / Deno / Cloudflare Workers)
- A Splintr account → sign in at `https://splintr.cash/auth`
- A settlement wallet address (EVM `0x…` or Solana) you control

---

## 1. Get your keys (2 min)

1. Open the dashboard → **Developers → API Keys**
2. Copy your **publishable** key (`pk_test_...`) and **secret** key (`sk_test_...`)
3. Copy your webhook signing secret from **Developers → Webhooks** (create an endpoint first if none exists)

---

## 2. Set environment variables (1 min)

```bash
# .env (server)
SPLINTR_SECRET_KEY=sk_test_xxx
SPLINTR_WEBHOOK_SECRET=whsec_xxx
SPLINTR_API_URL=https://splintr.cash   # optional, defaults to prod

# .env (client — Vite/Next/etc.)
VITE_SPLINTR_PUBLIC_KEY=pk_test_xxx
```

Required vars:

| Name                   | Where       | Purpose                       |
| ---------------------- | ----------- | ----------------------------- |
| `SPLINTR_SECRET_KEY`      | server only | Auth for REST calls           |
| `SPLINTR_WEBHOOK_SECRET`  | server only | Verify inbound webhooks       |
| `VITE_SPLINTR_PUBLIC_KEY` | client      | Mount `<SplintrCheckout>` |

Never expose `SPLINTR_SECRET_KEY` to the browser.

---

## 3. Install the SDKs (30 sec)

```bash
npm install @splintr-dev/server @splintr-dev/react
# or: bun add / pnpm add / yarn add
```

---

## 4. Create a payment intent on your server (2 min)

```ts
// server/checkout.ts
import { Splintr } from "@splintr-dev/server";

const splintr = new Splintr({ apiKey: process.env.SPLINTR_SECRET_KEY! });

export async function createCheckout(orderId: string, amountUsd: number) {
  return splintr.paymentIntents.create(
    {
      amount: amountUsd,
      currency: "USD",
      settlement: {
        chain: "robinhood", // launch example; every supported settlement chain is available
        token: "ETH",
        address: process.env.MERCHANT_WALLET!,
      },
      // Splintr is vending-machine by default: the payer picks any supported
      // token on any supported chain and Splintr auto-swaps to your settlement
      // token. No `accept` allow-list needed.
      metadata: { orderId },
    },
    { idempotencyKey: `order:${orderId}` }, // safe to retry
  );
}
```

---

## 5. Mount the checkout widget (2 min)

```tsx
// app/checkout-page.tsx
import { SplintrProvider, SplintrCheckout } from "@splintr-dev/react";

export default function CheckoutPage({ intentId }: { intentId: string }) {
  return (
    <SplintrProvider publicKey={import.meta.env.VITE_SPLINTR_PUBLIC_KEY}>
      <SplintrCheckout
        intentId={intentId}
        onSettled={(intent) => {
          // fire-and-forget: your webhook is the source of truth
          window.location.href = `/thanks/${intent.metadata.orderId}`;
        }}
        onError={(err) => console.error(err)}
      />
    </SplintrProvider>
  );
}
```

The widget auto-handles wallet connect (Reown/WalletConnect v2), multi-token contributions ("send some SOL now, top up with USDC"), quotes, and confirmations.

---

## 6. Verify webhooks (2 min)

Point your endpoint at `POST https://your-app.com/api/splintr/webhook`, then:

```ts
// server/routes/splintr-webhook.ts
import { verifyWebhook } from "@splintr-dev/server";

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("splintr-signature")!;

  const event = await verifyWebhook({
    payload: body,
    signature: sig,
    secret: process.env.SPLINTR_WEBHOOK_SECRET!,
  });

  switch (event.type) {
    case "payment_intent.settled":
      await fulfillOrder(event.data.metadata.orderId);
      break;
    case "payment_intent.expired":
    case "payment_intent.failed":
      await releaseInventory(event.data.metadata.orderId);
      break;
  }
  return new Response("ok");
}
```

Test locally: **Developers → Webhooks → Send test event** in the dashboard.

---

## 7. Go live (30 sec)

1. Swap `pk_test_` / `sk_test_` → `pk_live_` / `sk_live_` keys
2. Set live webhook secret
3. Toggle **Live mode** in the dashboard header

Done. You're accepting payments.

---

## Troubleshooting

| Symptom                                       | Fix                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `401 Unauthorized` on `paymentIntents.create` | Wrong / test-vs-live key mismatch                                                                                        |
| Widget stuck on "Loading intent"              | `publicKey` missing or mismatched env                                                                                    |
| Webhook signature invalid                     | Verify `SPLINTR_WEBHOOK_SECRET` matches the endpoint's secret exactly; use the raw request body, not `JSON.stringify(body)` |
| `429 Too Many Requests`                       | SDK auto-retries with `Retry-After`; upgrade plan if sustained                                                           |

Full reference: [/docs](https://splintr.cash/docs) · API: [/docs/api](https://splintr.cash/docs/api)
