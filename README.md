# Splintr

**One payment. Many coins, tokens, chains. One clean settlement.**

Splintr is a crypto payment primitive that lets merchants accept any token on any
supported chain and settle in a single asset — no bridging, no manual swaps,
no consolidating dust.

Launching first on Robinhood Chain, with a chain-agnostic architecture built
for payments and settlement across every supported network.

- 🌐 Live app: [splintr.cash](https://splintr.cash)
- 📚 Docs: [splintr.cash/docs](https://splintr.cash/docs)
- 🤖 MCP server: 20 tools — any OAuth-capable AI agent (Claude, Cursor, custom) can create invoices, poll settlement, issue refunds, and dispatch payouts

## Packages

| Package                                    | Description                              | npm                                                      |
| ------------------------------------------ | ---------------------------------------- | -------------------------------------------------------- |
| [`@splintr-dev/server`](./sdk/splintr-server) | Server SDK (Node / Bun / Deno / Workers) | ![npm](https://img.shields.io/npm/v/@splintr-dev/server) |
| [`@splintr-dev/react`](./sdk/splintr-react)   | Hosted-checkout React components         | ![npm](https://img.shields.io/npm/v/@splintr-dev/react)  |

## Quick start

```ts
import { Splintr } from "@splintr-dev/server";

const splintr = new Splintr({ apiKey: process.env.SPLINTR_SECRET_KEY! });

const intent = await splintr.paymentIntents.create({
  amount: "42.00",
  currency: "USD",
  settlement: { chain: "robinhood", token: "ETH" },
  expiresInSeconds: 900,
});

console.log(intent.checkoutUrl);
```

See [`sdk/splintr-server/README.md`](./sdk/splintr-server/README.md) and
[`sdk/splintr-react/README.md`](./sdk/splintr-react/README.md) for full API docs.

## Repository layout

See [CONTRIBUTING.md](./.github/CONTRIBUTING.md).

## License

MIT © Splintr
