# @splintr-dev/react changelog

## 0.4.4

- Version-parity release with `@splintr-dev/server@0.4.4` (avalanche + robinhood chain support). No component API changes.

## 0.4.3

- Version-parity release with `@splintr-dev/server@0.4.3` (refund retry API). No component API changes.

## 0.4.2

- Dependency security patch (`seroval` advisory GHSA-mv8w-475r-vwqw). No component API changes.

## 0.4.0

- New `useSplintrRefund(refundId)` hook — live refund timeline (`queued`, `sent`, `completed`, `failed`) for payer-facing UI.
- Refund + payout types re-exported from `@splintr-dev/server` for end-to-end parity.

## 0.3.4

- Kept in lockstep with `@splintr-dev/server@0.3.4`. No component API changes; ship this together to keep type imports aligned with the new refund event names (`refund.created`, `refund.processing`, `refund.paid`, `refund.failed`).

## 0.2.0

- New `useSplintrTokens({ chain })` — read the supported-token registry.
- New `useCreateIntent({ endpoint })` — publishable-key friendly wrapper that calls YOUR backend for the sk\_ create.
- New `<SplintrButton>` — one-line drop-in that creates + embeds in a popover.

## 0.1.0

- Initial release: `<SplintrProvider>`, `<SplintrCheckout>`, `useSplintrIntent`.
