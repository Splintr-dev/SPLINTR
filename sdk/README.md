# Splintr SDKs

Two packages, both fully typed, zero required dependencies beyond peer React 18+.

- `@splintr-dev/server` — server-side REST client + webhook verification. Works in Node, Bun, Deno, Cloudflare Workers, and edge runtimes (uses only global `fetch`, `crypto.subtle`).
- `@splintr-dev/react` — `<SplintrProvider>` + `<SplintrCheckout>` embed component + `useSplintrIntent()` polling hook.

Source of truth for both packages lives in this folder. Copy into your app or publish to your registry.

## Quickstart

```bash
npm install @splintr-dev/server @splintr-dev/react
```

```ts
// server
import { Splintr } from "@splintr-dev/server";
const splintr = new Splintr({ apiKey: process.env.SPLINTR_SECRET_KEY! });
const intent = await splintr.paymentIntents.create({
  amount: 99,
  currency: "USD",
  settlement: { chain: "robinhood", token: "USDC", address: MERCHANT_WALLET },
  metadata: { orderId: "order_8841" },
});
```

```tsx
// client
<SplintrProvider publicKey="pk_test_...">
  <SplintrCheckout intentId={intent.id} onSettled={(i) => unlockProduct(i.metadata.orderId)} />
</SplintrProvider>
```

See [/docs](https://splintr.cash/docs) for full reference.

**New here? Follow the [10-minute Quickstart](./QUICKSTART.md) — exact steps, env vars, and copy-paste snippets to finish setup end-to-end.**
