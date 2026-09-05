/**
 * Typed low-level client generated from public/openapi.yaml.
 *
 * This is the raw REST surface with full request/response typing derived from
 * the OpenAPI spec — every path, param, body, and response shape is checked
 * at compile time. Use it when you need direct control over a route the
 * high-level `Splintr` helper does not model, or when you want typed
 * autocomplete on every endpoint.
 *
 *   import { createSplintrClient } from "@splintr-dev/server/openapi";
 *
 *   const splintr = createSplintrClient({ apiKey: process.env.SPLINTR_SECRET_KEY! });
 *   const { data, error, response } = await splintr.POST("/api/public/v1/payment-intents", {
 *     body: {
 *       amount: 25,
 *       currency: "USD",
 *       settlement: { chain: "solana", token: "USDC", address: WALLET },
 *     },
 *     headers: { "Idempotency-Key": "ord_123" },
 *   });
 *   if (error) throw new Error(error.error ?? "splintr_error");
 *   console.log(data.id, data.checkout_url);
 *
 * For a higher-level ergonomic API (validation, retries, typed helpers per
 * resource), use `Splintr` from the package root.
 */

import createClient, { type Client, type ClientOptions } from "openapi-fetch";
import type { paths } from "./openapi";

export type { paths } from "./openapi";
export type SplintrClient = Client<paths>;

export interface CreateSplintrClientOptions extends Omit<ClientOptions, "baseUrl" | "headers"> {
  /** `sk_test_...` or `sk_live_...` secret key. */
  apiKey: string;
  /** Origin without trailing slash. Defaults to https://splintr.cash. */
  baseUrl?: string;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
}

export function createSplintrClient(opts: CreateSplintrClientOptions): SplintrClient {
  if (!opts.apiKey) throw new Error("createSplintrClient: apiKey is required");
  const { apiKey, baseUrl, headers, ...rest } = opts;
  return createClient<paths>({
    baseUrl: (baseUrl ?? "https://splintr.cash").replace(/\/$/, ""),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(headers ?? {}),
    },
    ...rest,
  });
}
