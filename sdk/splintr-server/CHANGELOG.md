# @splintr-dev/server changelog

## 0.4.4

- Chain coverage: `Chain` type and the `CHAINS` validator now include `avalanche` and `robinhood` (Robinhood Chain, id 4663). Robinhood settles in native ETH (no canonical USDC yet).

## 0.4.3

- New `splintr.refunds.retry(id, { destination?, reason? })` — requeue a `failed`, `retry_scheduled` or `pending` refund immediately, optionally redirecting it to a different destination address. Backed by `POST /api/public/v1/refunds/{id}/retry`.

## 0.4.2

- Dependency security patch (`seroval` advisory GHSA-mv8w-475r-vwqw). No API surface changes.

## 0.4.1

- New `splintr.healthProviders()` — live router/provider health snapshot.

## 0.4.0

- `splintr.refunds.timeline(id)` plus explicit refund states (`queued`, `sent`, `completed`, `failed`).
- Automatic refunds on intent expiry are surfaced with `reason: "auto_expiry"`.

## 0.3.4

- **Refund lifecycle events**: `WebhookEventType` renamed and expanded to match server: `refund.created`, `refund.processing`, `refund.paid`, `refund.failed`. `payout.pending` renamed to `payout.created`. Subscribe to any of these on a webhook endpoint.
- **`splintr.refunds.status(id)`**: new unauthenticated payer-facing status fetch. Safe to expose in customer emails and receipts; destination address is redacted to the last 6 chars.
- Server-side retry engine documented — failed refund dispatches are retried on an exponential schedule (1m, 5m, 30m, 2h, 12h) before being marked `failed`.

## 0.2.0

- New resources: `splintr.refunds`, `splintr.payouts`, `splintr.webhookEndpoints`.
- New payment-intent helpers: `paymentIntents.transactions(id)` and `paymentIntents.route(id)` for vending-machine legs and router audit.
- New `splintr.tokens.list({ chain })` moved to the base client (was on `Splintr`).
- Auto-retry with jittered backoff on 429/5xx. Respects `Retry-After`.
- Configurable `timeout` (default 30s) and `retries` (default 2).
- `WebhookEventType` union expanded to all 17 events fired server-side.
- `checkout_url` is now an absolute URL (`SITE_URL` env on the server).
- `setDebug(true)` for redacted request/response tracing.

## 0.1.0

- Initial release: payment intents CRUD, webhook signature verification, `Splintr` alias.
