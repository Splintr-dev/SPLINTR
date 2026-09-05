# @splintr-dev/react

React components for the Splintr hosted checkout. Zero runtime deps.

## Install

```bash
npm install @splintr-dev/react
# or: bun add @splintr-dev/react
```

## Required environment variables

| Name                          | Where             | Example                                     |
| ----------------------------- | ----------------- | ------------------------------------------- |
| `NEXT_PUBLIC_SPLINTR_PUBLIC_KEY` | browser (public)  | `pk_live_…` or `pk_test_…`                  |
| `SPLINTR_SECRET_KEY`             | your backend only | `sk_live_…` (used by `@splintr-dev/server`) |

The React SDK never touches `sk_…`. Intent creation happens on your server
and the client uses the returned `intent.id`.

The examples use Robinhood Chain for launch. Splintr remains chain-agnostic, so
merchants can configure any supported settlement network and asset.

## End-to-end example (copy-paste)

**1. Wrap your app once**

```tsx
// app/providers.tsx
"use client";
import { SplintrProvider } from "@splintr-dev/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SplintrProvider publicKey={process.env.NEXT_PUBLIC_SPLINTR_PUBLIC_KEY!}>
      {children}
    </SplintrProvider>
  );
}
```

**2. Create a server endpoint that starts the intent**

```ts
// app/api/splintr/route.ts
import { Splintr } from "@splintr-dev/server";

const splintr = new Splintr({ secretKey: process.env.SPLINTR_SECRET_KEY! });

export async function POST(req: Request) {
  const { amount, email } = await req.json();
  const intent = await splintr.paymentIntents.create({
    amount,
    currency: "USD",
    customerEmail: email,
    settlement: { chain: "robinhood", token: "ETH", address: process.env.MERCHANT_WALLET_ADDRESS! },
  });
  return Response.json(intent);
}
```

**3. Drop the button in any page — that's it**

```tsx
// app/checkout/page.tsx
"use client";
import { SplintrButton } from "@splintr-dev/react";

export default function Checkout() {
  return (
    <SplintrButton
      endpoint="/api/splintr"
      input={{ amount: 25, email: "buyer@example.com" }}
      label="Pay $25 with Splintr"
      onSettled={(intent) => console.log("paid!", intent.id)}
      onError={(intent) => console.error("payment failed", intent.status)}
    />
  );
}
```

Behind the scenes: click → POST to your `/api/splintr` → returns intent →
embed Splintr checkout iframe → live-poll status → invoke `onSettled` when
`status === "settled"`.

## Embed vs redirect

```tsx
// Embed (default) — hosted checkout iframe with post-message events
<SplintrCheckout intentId={id} onSettled={onDone} onError={onErr} />

// Redirect — full-page navigation to hosted checkout
<SplintrCheckout intentId={id} mode="redirect" />

// Or just point the user at the hosted URL manually:
window.location.href = intent.checkout_url;
```

## Polling with `useSplintrIntent`

```tsx
const { data, status } = useSplintrIntent(intentId, { intervalMs: 3000 });
// data.status: created → quoted → executing → settled | failed | expired
```

Polling uses exponential backoff on 5xx / network errors and honors any
`Retry-After` header the API returns; on the terminal states (`settled`,
`failed`, `expired`, `cancelled`, `refunded`) polling stops automatically.

## Validation

Wrong props fail immediately with a clear message:

```tsx
<SplintrProvider publicKey="oops">…
// Error: [splintr] publicKey must match pk_test_… or pk_live_…
```

## API

- `<SplintrProvider publicKey baseUrl?>`
- `<SplintrButton endpoint input label onSettled onError>`
- `<SplintrCheckout intentId onSettled onError mode="iframe" | "redirect">`
- `useSplintrIntent(intentId, { intervalMs })`
- `useSplintrTokens({ chain })`
- `useCreateIntent({ endpoint, transform, headers })`
- `fetchWithRetry(url, init)` — exported for advanced integrators

## License

MIT
