# Spark — APIMatic × Claude × PayPal Orders API v2 Integration Report

## 1. Executive Summary
This document records the Stage 1 APIMatic CLI (`@apimatic/cli@2`), OpenAPI 3.0 specification (`src/spec/checkout_orders_v2.json`), and portal configuration (`src/apimatic.json`) audit for the Spark AI Shopping & Product Intelligence Platform.

## 2. APIMatic Configuration & Specification Inventory
- **Configuration File**: `src/apimatic.json`
- **Schema**: `https://enterprise.apimatic.io/schemas/apimatic-v1.json` (Version `1`)
- **Primary OpenAPI Input**: `src/spec/checkout_orders_v2.json` (PayPal Checkout Orders API v2.130, 3,262 lines)
- **Portal Content Directory**: `src/content/` (`index.mdx`, `nav.json`)
- **Enabled AI Context Plugins**:
  - `claude`: `true` (Claude Code / Claude Agent Context Plugin)
  - `cursor`: `true`
  - `vscode`: `true`
- **Configured SDK Target Languages**: `typescript`, `python`, `csharp`, `java`, `go`, `php`, `ruby`

## 3. Verified PayPal Orders API v2 Operations in `src/spec/checkout_orders_v2.json`
1. **Create Order (`POST /v2/checkout/orders`)**:
   - Supports `intent: "CAPTURE"` and `intent: "AUTHORIZE"`.
   - Enforces `PayPal-Request-Id` idempotency header and `purchase_units` amount breakdown validation.
2. **Show Order Details (`GET /v2/checkout/orders/{id}`)**:
   - Inspects live order status (`CREATED`, `SAVED`, `APPROVED`, `VOIDED`, `COMPLETED`, `PAYER_ACTION_REQUIRED`).
3. **Confirm the Order (`POST /v2/checkout/orders/{id}/confirm-payment-source`)**:
   - Confirms payment source details and returns `payer-action` HATEOAS links when 3DS/buyer approval is required.
4. **Authorize Payment for Order (`POST /v2/checkout/orders/{id}/authorize`)**:
   - Authorizes funds on buyer-approved orders.
5. **Capture Payment for Order (`POST /v2/checkout/orders/{id}/capture`)**:
   - Captures authorized/approved buyer funds with server-side idempotency (`PayPal-Request-Id`) and replay prevention.

## 4. Spark Runtime & Security Alignment
- **Sandbox-Only Enforcement**: `PAYPAL_ENV=sandbox` (`https://api-m.sandbox.paypal.com`); live real-money endpoints are strictly blocked by `validatePayPalSandboxConfig`.
- **Diagnostic Endpoint**: `GET /api/apimatic/status` exposes live verification of `src/apimatic.json`, `src/spec/checkout_orders_v2.json`, and documented Orders v2 paths.
