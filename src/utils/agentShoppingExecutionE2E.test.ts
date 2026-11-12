import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PayPalSandboxEngine } from './paypalSandboxService';
import type { RankedProductOffer } from '../types/spark';

function createSandboxTestEngine(options?: {
  declineCapture?: boolean;
  pendingCapture?: boolean;
  networkErrorOnCapture?: boolean;
}) {
  const capturedPayPalRequestIds: string[] = [];
  let createOrderCalls = 0;
  let captureOrderCalls = 0;

  const mockFetch = async (urlInput: string | URL | Request, init?: RequestInit) => {
    const url = String(urlInput);
    const headers = (init?.headers || {}) as Record<string, string>;

    if (url.endsWith('/v1/oauth2/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'A21AA_LIVE_SANDBOX_E2E_TOKEN',
          token_type: 'Bearer',
          expires_in: 32400,
        }),
      };
    }

    if (url.endsWith('/v2/checkout/orders') && init?.method === 'POST') {
      createOrderCalls += 1;
      const bodyObj = JSON.parse(String(init?.body || '{}'));
      assert.equal(bodyObj.intent, 'CAPTURE', 'PayPal Sandbox order must use intent: CAPTURE');
      const ordId = `PAYPAL-E2E-ORD-${createOrderCalls}-${Date.now().toString(36).toUpperCase()}`;
      return {
        ok: true,
        status: 201,
        json: async () => ({
          id: ordId,
          status: 'CREATED',
          links: [
            {
              rel: 'approve',
              href: `https://www.sandbox.paypal.com/checkoutnow?token=${ordId}`,
            },
          ],
        }),
      };
    }

    if (url.includes('/v2/checkout/orders/') && url.endsWith('/capture')) {
      captureOrderCalls += 1;
      if (headers['PayPal-Request-Id']) {
        capturedPayPalRequestIds.push(headers['PayPal-Request-Id']);
      }
      if (options?.networkErrorOnCapture) {
        throw new Error('503 Service Unavailable: Network interruption during PayPal capture');
      }
      if (options?.declineCapture) {
        return {
          ok: false,
          status: 422,
          json: async () => ({
            name: 'UNPROCESSABLE_ENTITY',
            details: [
              {
                issue: 'INSTRUMENT_DECLINED',
                description: 'The instrument presented was declined by the processor.',
              },
            ],
            debug_id: 'dbg_e2e_declined',
          }),
        };
      }
      const parts = url.split('/');
      const ordId = decodeURIComponent(parts[parts.length - 2] || 'ORD');
      const capId = `CAP-E2E-${ordId}`;
      const status = options?.pendingCapture ? 'PENDING' : 'COMPLETED';
      return {
        ok: true,
        status: 201,
        json: async () => ({
          id: ordId,
          status,
          payer: {
            email_address: 'sb-buyer@personal.example.com',
            payer_id: 'SBXBUYER_E2E',
          },
          purchase_units: [
            {
              payments: {
                captures: [
                  {
                    id: capId,
                    status,
                    amount: {
                      currency_code: 'USD',
                      value: '299.00',
                    },
                  },
                ],
              },
            },
          ],
        }),
      };
    }

    if (url.includes('/v2/checkout/orders/') && (!init?.method || init.method === 'GET')) {
      const parts = url.split('/');
      const ordId = decodeURIComponent(parts[parts.length - 1] || 'ORD');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: ordId,
          status: 'COMPLETED',
          payer: {
            email_address: 'sb-buyer@personal.example.com',
            payer_id: 'SBXBUYER_E2E',
          },
          purchase_units: [
            {
              payments: {
                captures: [
                  {
                    id: `CAP-E2E-${ordId}`,
                    status: 'COMPLETED',
                    amount: {
                      currency_code: 'USD',
                      value: '299.00',
                    },
                  },
                ],
              },
            },
          ],
        }),
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({}),
    };
  };

  const engine = new PayPalSandboxEngine({
    envGetter: () => ({
      PAYPAL_CLIENT_ID: 'AeA_SANDBOX_E2E_CLIENT_ID_123456',
      PAYPAL_CLIENT_SECRET: 'E_SANDBOX_E2E_CLIENT_SECRET_123456',
      PAYPAL_ENV: 'sandbox',
      PAYPAL_WEBHOOK_ID: 'WH_SANDBOX_E2E_999',
    }),
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  return {
    engine,
    getCreateOrderCalls: () => createOrderCalls,
    getCaptureOrderCalls: () => captureOrderCalls,
    capturedPayPalRequestIds,
  };
}

function buildVerifiedChannel3Product(overrides?: Partial<RankedProductOffer>): RankedProductOffer {
  return {
    id: 'ch3_sony_xm5_001',
    productId: 'ch3_sony_xm5_001',
    offerId: 'ofr_ch3_sony_xm5_001',
    name: 'Sony WH-1000XM5 Wireless Noise-Canceling Headphones',
    brand: 'Sony',
    category: 'Headphones',
    description: 'Industry-leading noise cancellation with 30-hour battery life.',
    summary: 'Flagship wireless ANC headphones verified via Channel3.',
    price: 299.0,
    currency: 'USD',
    priceStatus: 'verified',
    availabilityStatus: 'verified_in_stock',
    availability: 'in_stock',
    shippingText: 'Free shipping',
    shippingCost: 0,
    shippingStatus: 'free',
    estimatedTaxRate: null,
    taxStatus: 'unknown',
    merchant: 'Best Buy Official',
    rating: 4.8,
    reviewCount: 2450,
    ratingStatus: 'verified',
    imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80',
    canonicalUrl: 'https://www.bestbuy.com/site/sony-wh-1000xm5/6505727.p',
    sourceUrl: 'https://www.bestbuy.com/site/sony-wh-1000xm5/6505727.p',
    sourceType: 'channel3_product_graph',
    sourceId: 'channel3_product_graph',
    sourceName: 'Channel3 Product Graph API',
    sourceLabel: 'Channel3 Product Graph API',
    retrievedAt: new Date().toISOString(),
    freshnessStatus: 'live',
    verified: true,
    verificationStatus: 'verified_live_source',
    verificationSummary: 'Verified via Channel3 Product Graph API',
    specs: {
      Brand: 'Sony',
      SKU: 'WH1000XM5/B',
      'Channel3 Offer ID': 'ofr_ch3_sony_xm5_001',
    },
    keySpecs: ['30-hour battery', 'Multi-Noise Sensor technology'],
    pros: ['Verified Channel3 price', 'In stock'],
    cons: [],
    whyRecommended: 'Top-rated wireless ANC headphones.',
    valueScore: 95,
    trustScore: 98,
    relevanceScore: 97,
    overallScore: 96,
    bestCoupon: null,
    couponDiscountAmount: 0,
    netItemPrice: 299.0,
    withinBudget: true,
    completenessScore: 96,
    couponStatus: 'no_verified_coupon',
    checkoutStatus: 'supported_paypal',
    effectivePrice: 299.0,
    savingsAmount: 0,
    hasVerifiedCoupon: false,
    ...overrides,
  };
}

test('Scenario 1: Successful purchase from Channel3 product verification -> Cart -> Order Summary -> Explicit Consent -> PayPal Sandbox Order (intent: CAPTURE) -> Buyer Approval -> Verified Capture -> Purchases', async () => {
  const { engine, getCreateOrderCalls, getCaptureOrderCalls, capturedPayPalRequestIds } =
    createSandboxTestEngine();
  const userId = 'usr_buyer_alpha';
  engine.configureBuyerSandboxBalance(userId, 500.0, 'alpha@personal.example.com');

  const product = buildVerifiedChannel3Product();

  // Step 1 & 2: Agent verifies product using Channel3 data and adds to Cart / prepares Order Summary
  const agentExec = engine.executeAgentShoppingAction({
    userId,
    action: 'prepare_purchase_consent',
    product,
    quantity: 1,
  });

  assert.equal(agentExec.action, 'prepare_purchase_consent');
  assert.equal(agentExec.requiresExplicitUserConsent, true);
  assert.equal(agentExec.autoAuthorized, false, 'Adding to cart or requesting purchase must NEVER auto-authorize payment');
  assert.ok(agentExec.cart);
  assert.equal(agentExec.cart.itemCount, 1);
  assert.equal(agentExec.cart.subtotal, 299.0);
  assert.ok(agentExec.orderSummary);
  assert.equal(agentExec.orderSummary.productName, product.name);
  assert.equal(agentExec.orderSummary.merchant, 'Best Buy Official');
  assert.equal(agentExec.orderSummary.unitPrice, 299.0);
  assert.equal(agentExec.orderSummary.finalKnownTotal, 299.0);
  assert.ok(agentExec.orderSummary.unknownOrUnconfirmedCosts.length > 0);
  assert.equal(getCreateOrderCalls(), 0, 'No PayPal order created before explicit user consent');

  // Reject unverified product (missing price or out of stock)
  const unverifiedExec = engine.executeAgentShoppingAction({
    userId,
    action: 'add_to_cart',
    product: buildVerifiedChannel3Product({
      id: 'bad_prod',
      price: null,
      priceStatus: 'price_could_not_be_verified',
    }),
  });
  assert.equal(unverifiedExec.action, 'rejected_unverified');

  // Step 3: Prepare Order & Record Explicit User Consent
  const prep = engine.prepareAutonomousPurchaseOrder({
    userId,
    userEmail: 'alpha@personal.example.com',
    itemId: '__SPARK_USER_CART__',
    fromCart: true,
    quantity: 1,
    currency: 'USD',
  });
  assert.equal(prep.ok, true);
  assert.equal(prep.orderRow?.status, 'AWAITING_USER_CONFIRMATION');

  // Verify AI agent cannot self-authorize
  const agentSelfAuth = engine.authorizePurchaseOrder({
    userId,
    orderId: prep.orderRow!.id,
    actor: 'agent',
    explicitUserConfirmed: true,
  });
  assert.equal(agentSelfAuth.ok, false);
  assert.equal(agentSelfAuth.statusCode, 403);

  // Explicit human confirmation
  const userAuth = engine.authorizePurchaseOrder({
    userId,
    orderId: prep.orderRow!.id,
    actor: 'user',
    explicitUserConfirmed: true,
    confirmedAmount: 299.0,
    confirmedCurrency: 'USD',
  });
  assert.equal(userAuth.ok, true);
  assert.ok(userAuth.authorization?.authorizationHash);

  // Step 4: Create real PayPal Sandbox Order (`intent: CAPTURE`)
  const exec = await engine.executeAuthorizedOrder({
    userId,
    userEmail: 'alpha@personal.example.com',
    orderId: prep.orderRow!.id,
    authorizationHash: userAuth.authorization!.authorizationHash,
    actor: 'user',
  });
  assert.equal(exec.ok, true);
  assert.equal(getCreateOrderCalls(), 1);
  assert.ok(exec.transaction?.paypalOrderId.startsWith('PAYPAL-E2E-ORD-'));
  assert.ok(
    exec.approvalUrl?.startsWith('https://www.sandbox.paypal.com/checkoutnow?token='),
    'Must return actual PayPal Sandbox approval URL'
  );

  // Step 5: Buyer approves on PayPal Sandbox
  const approval = engine.markOrderApproved(exec.transaction!.sparkOrderId, {
    userId,
    email: 'alpha@personal.example.com',
    payerId: 'SBXBUYER_E2E',
  });
  assert.equal(approval.ok, true);
  assert.equal(approval.transaction?.status, 'APPROVED');

  // Step 6: Server-side Capture after APPROVED verification
  const cap = await engine.captureAuthorizedOrder({
    userId,
    orderId: exec.transaction!.sparkOrderId,
    expectedAmount: 299.0,
    expectedCurrency: 'USD',
  });
  assert.equal(cap.ok, true);
  assert.equal(getCaptureOrderCalls(), 1);
  assert.ok(capturedPayPalRequestIds[0]?.startsWith('cap_'));
  assert.equal(cap.transaction?.status, 'COMPLETED');
  assert.ok(cap.purchaseRecord);
  assert.equal(cap.purchaseRecord.paymentStatus, 'COMPLETED');
  assert.equal(cap.purchaseRecord.totalAmount, 299.0);
  assert.ok(cap.purchaseRecord.completedAt, 'PurchaseRecord must include completedAt timestamp');
  assert.equal(cap.buyerWallet?.availableBalance, 201.0);

  // Cart is cleared of purchased items after verified capture
  const updatedCart = engine.getUserCart(userId);
  assert.equal(updatedCart.itemCount, 0);
});

test('Scenario 2: User rejects or cancels payment at PayPal Sandbox', async () => {
  const { engine } = createSandboxTestEngine();
  const userId = 'usr_buyer_cancel';
  engine.configureBuyerSandboxBalance(userId, 500.0);
  const product = buildVerifiedChannel3Product();
  engine.registerVerifiedLiveOffer(product);

  const prep = engine.prepareAutonomousPurchaseOrder({
    userId,
    itemId: product.id,
    quantity: 1,
  });
  const auth = engine.authorizePurchaseOrder({
    userId,
    orderId: prep.orderRow!.id,
    actor: 'user',
    explicitUserConfirmed: true,
    confirmedAmount: 299.0,
    confirmedCurrency: 'USD',
  });
  const exec = await engine.executeAuthorizedOrder({
    userId,
    orderId: prep.orderRow!.id,
    authorizationHash: auth.authorization!.authorizationHash,
    actor: 'user',
  });
  assert.equal(exec.ok, true);

  // Buyer cancels at PayPal Sandbox
  const cancelRes = engine.cancelOrder(
    exec.transaction!.sparkOrderId,
    'Buyer cancelled payment on PayPal Sandbox.',
    userId
  );
  assert.equal(cancelRes.ok, true);
  assert.equal(cancelRes.transaction?.status, 'CANCELLED');

  // Attempting to capture a cancelled order is strictly blocked
  const capRes = await engine.captureAuthorizedOrder({
    userId,
    orderId: exec.transaction!.sparkOrderId,
  });
  assert.equal(capRes.ok, false);
  assert.equal(capRes.statusCode, 409);
  assert.equal(engine.getBuyerSandboxWallet(userId).availableBalance, 500.0);
});

test('Scenario 3: Unapproved order cannot be captured', async () => {
  const { engine, getCaptureOrderCalls } = createSandboxTestEngine();
  const userId = 'usr_buyer_unapproved';
  engine.configureBuyerSandboxBalance(userId, 500.0);
  const product = buildVerifiedChannel3Product();
  engine.registerVerifiedLiveOffer(product);

  const prep = engine.prepareAutonomousPurchaseOrder({
    userId,
    itemId: product.id,
    quantity: 1,
  });

  // 3a: Cannot capture before PayPal order creation
  const earlyCap = await engine.captureAuthorizedOrder({
    userId,
    orderId: prep.orderRow!.id,
  });
  assert.equal(earlyCap.ok, false);
  assert.equal(earlyCap.statusCode, 422);
  assert.equal(earlyCap.errorCode, 'ORDER_NOT_APPROVED');

  // 3b: Create PayPal order (status = CREATED / AWAITING_PAYPAL_APPROVAL), do NOT approve
  const auth = engine.authorizePurchaseOrder({
    userId,
    orderId: prep.orderRow!.id,
    actor: 'user',
    explicitUserConfirmed: true,
    confirmedAmount: 299.0,
    confirmedCurrency: 'USD',
  });
  const exec = await engine.executeAuthorizedOrder({
    userId,
    orderId: prep.orderRow!.id,
    authorizationHash: auth.authorization!.authorizationHash,
    actor: 'user',
  });
  assert.equal(exec.ok, true);
  assert.equal(exec.transaction?.status, 'CREATED');

  const unapprovedCap = await engine.captureAuthorizedOrder({
    userId,
    orderId: exec.transaction!.sparkOrderId,
  });
  assert.equal(unapprovedCap.ok, false);
  assert.equal(unapprovedCap.statusCode, 422);
  assert.equal(unapprovedCap.errorCode, 'ORDER_NOT_APPROVED');
  assert.equal(getCaptureOrderCalls(), 0, 'Must never call PayPal capture endpoint on unapproved order');
});

test('Scenario 4: Modified amount or quantity invalidates previous consent', async () => {
  const { engine } = createSandboxTestEngine();
  const userId = 'usr_buyer_modified';
  engine.configureBuyerSandboxBalance(userId, 1000.0);
  const product = buildVerifiedChannel3Product();
  engine.registerVerifiedLiveOffer(product);

  // Prepare order for quantity = 1 ($299.00) and record consent
  const prep1 = engine.prepareAutonomousPurchaseOrder({
    userId,
    itemId: product.id,
    quantity: 1,
  });
  const auth1 = engine.authorizePurchaseOrder({
    userId,
    orderId: prep1.orderRow!.id,
    actor: 'user',
    explicitUserConfirmed: true,
    confirmedAmount: 299.0,
    confirmedCurrency: 'USD',
  });
  assert.equal(auth1.ok, true);
  const oldHash = auth1.authorization!.authorizationHash;

  // User modifies order amount to $598.00 (2 units) -> invalidates previous consent on prep1
  engine.invalidateOrderAuthorizationOnMutation(prep1.orderRow!.id, 598.0, 'USD');

  // Attempting to execute with the old authorizationHash must fail
  const execWithOldConsent = await engine.executeAuthorizedOrder({
    userId,
    orderId: prep1.orderRow!.id,
    authorizationHash: oldHash,
    actor: 'user',
  });
  assert.equal(execWithOldConsent.ok, false);
  assert.equal(execWithOldConsent.statusCode, 400);
  assert.ok(execWithOldConsent.errorCode);
});

test('Scenario 5: Duplicate Capture requests do not create duplicate payments', async () => {
  const { engine, getCaptureOrderCalls } = createSandboxTestEngine();
  const userId = 'usr_buyer_idempotent';
  engine.configureBuyerSandboxBalance(userId, 500.0);
  const product = buildVerifiedChannel3Product();
  engine.registerVerifiedLiveOffer(product);

  const prep = engine.prepareAutonomousPurchaseOrder({
    userId,
    itemId: product.id,
    quantity: 1,
  });
  const auth = engine.authorizePurchaseOrder({
    userId,
    orderId: prep.orderRow!.id,
    actor: 'user',
    explicitUserConfirmed: true,
    confirmedAmount: 299.0,
    confirmedCurrency: 'USD',
  });
  const exec = await engine.executeAuthorizedOrder({
    userId,
    orderId: prep.orderRow!.id,
    authorizationHash: auth.authorization!.authorizationHash,
    actor: 'user',
  });
  engine.markOrderApproved(exec.transaction!.sparkOrderId, { userId });

  const firstCap = await engine.captureAuthorizedOrder({
    userId,
    orderId: exec.transaction!.sparkOrderId,
    expectedAmount: 299.0,
    expectedCurrency: 'USD',
  });
  assert.equal(firstCap.ok, true);
  assert.equal(firstCap.duplicateCapturePrevented, false);
  assert.equal(firstCap.buyerWallet?.availableBalance, 201.0);

  // Second capture request for the same order
  const secondCap = await engine.captureAuthorizedOrder({
    userId,
    orderId: exec.transaction!.sparkOrderId,
    expectedAmount: 299.0,
    expectedCurrency: 'USD',
  });
  assert.equal(secondCap.ok, true);
  assert.equal(secondCap.duplicateCapturePrevented, true);
  assert.equal(secondCap.buyerWallet?.availableBalance, 201.0, 'Balance must only be deducted once');
  assert.equal(getCaptureOrderCalls(), 1, 'Upstream PayPal capture API must only be called once');
  assert.equal(engine.getUserPurchases(userId).length, 1, 'Only one purchase record must exist');
});

test('Scenario 6: Invalid, mismatched, or expired PayPal order is rejected', async () => {
  const { engine } = createSandboxTestEngine();
  const userId = 'usr_buyer_mismatch';
  engine.configureBuyerSandboxBalance(userId, 500.0);
  const product = buildVerifiedChannel3Product();
  engine.registerVerifiedLiveOffer(product);

  // 6a: Non-existent order ID
  const missingCap = await engine.captureAuthorizedOrder({
    userId,
    orderId: 'ord_non_existent_999',
  });
  assert.equal(missingCap.ok, false);
  assert.equal(missingCap.statusCode, 404);

  // Create and approve a valid order ($299.00 USD)
  const prep = engine.prepareAutonomousPurchaseOrder({
    userId,
    itemId: product.id,
    quantity: 1,
  });
  const auth = engine.authorizePurchaseOrder({
    userId,
    orderId: prep.orderRow!.id,
    actor: 'user',
    explicitUserConfirmed: true,
    confirmedAmount: 299.0,
    confirmedCurrency: 'USD',
  });
  const exec = await engine.executeAuthorizedOrder({
    userId,
    orderId: prep.orderRow!.id,
    authorizationHash: auth.authorization!.authorizationHash,
    actor: 'user',
  });
  engine.markOrderApproved(exec.transaction!.sparkOrderId, { userId });

  // 6b: Mismatched amount is rejected
  const badAmountCap = await engine.captureAuthorizedOrder({
    userId,
    orderId: exec.transaction!.sparkOrderId,
    expectedAmount: 19.99,
    expectedCurrency: 'USD',
  });
  assert.equal(badAmountCap.ok, false);
  assert.equal(badAmountCap.statusCode, 400);
  assert.equal(badAmountCap.errorCode, 'tampered_amount_rejected');

  // 6c: Mismatched currency is rejected
  const badCurrencyCap = await engine.captureAuthorizedOrder({
    userId,
    orderId: exec.transaction!.sparkOrderId,
    expectedAmount: 299.0,
    expectedCurrency: 'EUR',
  });
  assert.equal(badCurrencyCap.ok, false);
  assert.equal(badCurrencyCap.statusCode, 400);
  assert.equal(badCurrencyCap.errorCode, 'tampered_currency_rejected');
});

test('Scenario 7: Network interruption or declined payment during capture does not produce a false success', async () => {
  // 7a: Network interruption (503)
  const { engine: netEngine } = createSandboxTestEngine({ networkErrorOnCapture: true });
  const userId = 'usr_buyer_net_err';
  netEngine.configureBuyerSandboxBalance(userId, 500.0);
  const product = buildVerifiedChannel3Product();
  netEngine.registerVerifiedLiveOffer(product);

  const prep = netEngine.prepareAutonomousPurchaseOrder({
    userId,
    itemId: product.id,
    quantity: 1,
  });
  const auth = netEngine.authorizePurchaseOrder({
    userId,
    orderId: prep.orderRow!.id,
    actor: 'user',
    explicitUserConfirmed: true,
    confirmedAmount: 299.0,
    confirmedCurrency: 'USD',
  });
  const exec = await netEngine.executeAuthorizedOrder({
    userId,
    orderId: prep.orderRow!.id,
    authorizationHash: auth.authorization!.authorizationHash,
    actor: 'user',
  });
  netEngine.markOrderApproved(exec.transaction!.sparkOrderId, { userId });

  const netCap = await netEngine.captureAuthorizedOrder({
    userId,
    orderId: exec.transaction!.sparkOrderId,
  });
  assert.equal(netCap.ok, false, 'Network interruption must never report false success');
  assert.equal(netCap.statusCode, 502);
  assert.equal(netCap.transaction?.lifecycleStatus, 'REVIEW_REQUIRED');
  assert.equal(netEngine.getBuyerSandboxWallet(userId).availableBalance, 500.0);

  // 7b: Declined payment (INSTRUMENT_DECLINED) -> distinguishes DECLINED status
  const { engine: decEngine } = createSandboxTestEngine({ declineCapture: true });
  decEngine.configureBuyerSandboxBalance(userId, 500.0);
  decEngine.registerVerifiedLiveOffer(product);
  const prepDec = decEngine.prepareAutonomousPurchaseOrder({
    userId,
    itemId: product.id,
    quantity: 1,
  });
  const authDec = decEngine.authorizePurchaseOrder({
    userId,
    orderId: prepDec.orderRow!.id,
    actor: 'user',
    explicitUserConfirmed: true,
    confirmedAmount: 299.0,
    confirmedCurrency: 'USD',
  });
  const execDec = await decEngine.executeAuthorizedOrder({
    userId,
    orderId: prepDec.orderRow!.id,
    authorizationHash: authDec.authorization!.authorizationHash,
    actor: 'user',
  });
  decEngine.markOrderApproved(execDec.transaction!.sparkOrderId, { userId });

  const decCap = await decEngine.captureAuthorizedOrder({
    userId,
    orderId: execDec.transaction!.sparkOrderId,
  });
  assert.equal(decCap.ok, false);
  assert.equal(decCap.errorCode, 'INSTRUMENT_DECLINED');
  const decRecord = decEngine.buildPurchaseRecordFromTransaction(decCap.transaction!);
  assert.equal(decRecord.paymentStatus, 'DECLINED');
  assert.equal(decRecord.status, 'declined');
});

test('Scenario 8 & 9: Firebase stores the verified transaction correctly & Purchases displays the actual transaction', async () => {
  const rulesText = fs.readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  const blueprintText = fs.readFileSync(
    new URL('../../firebase-blueprint.json', import.meta.url),
    'utf8'
  );

  // Verify Firestore rules & blueprint allow all required PurchaseDoc fields
  for (const field of [
    'userId',
    'orderReference',
    'paypalOrderId',
    'paypalCaptureId',
    'paypalTransactionId',
    'productId',
    'productName',
    'merchant',
    'quantity',
    'unitPrice',
    'currency',
    'totalAmount',
    'status',
    'paymentStatus',
    'createdAt',
    'completedAt',
    'updatedAt',
  ]) {
    assert.ok(
      rulesText.includes(`'${field}'`),
      `firestore.rules isValidPurchase must include '${field}'`
    );
    assert.ok(
      blueprintText.includes(`"${field}"`),
      `firebase-blueprint.json PurchaseDoc must include "${field}"`
    );
  }

  // Verify Purchases dashboard data source has all required fields for a completed purchase
  const { engine } = createSandboxTestEngine();
  const userId = 'usr_buyer_dashboard';
  engine.configureBuyerSandboxBalance(userId, 500.0);
  const product = buildVerifiedChannel3Product();
  engine.registerVerifiedLiveOffer(product);

  const prep = engine.prepareAutonomousPurchaseOrder({
    userId,
    itemId: product.id,
    quantity: 1,
  });
  const auth = engine.authorizePurchaseOrder({
    userId,
    orderId: prep.orderRow!.id,
    actor: 'user',
    explicitUserConfirmed: true,
    confirmedAmount: 299.0,
    confirmedCurrency: 'USD',
  });
  const exec = await engine.executeAuthorizedOrder({
    userId,
    orderId: prep.orderRow!.id,
    authorizationHash: auth.authorization!.authorizationHash,
    actor: 'user',
  });
  engine.markOrderApproved(exec.transaction!.sparkOrderId, { userId });
  const cap = await engine.captureAuthorizedOrder({
    userId,
    orderId: exec.transaction!.sparkOrderId,
  });
  assert.equal(cap.ok, true);

  const purchases = engine.getUserPurchases(userId);
  assert.equal(purchases.length, 1);
  const record = purchases[0];
  assert.equal(record.userId, userId);
  assert.equal(record.orderReference, exec.transaction!.sparkOrderId);
  assert.equal(record.paypalOrderId, exec.transaction!.paypalOrderId);
  assert.ok(record.captureId?.startsWith('CAP-E2E-'));
  assert.equal(record.productName, product.name);
  assert.equal(record.merchant, product.merchant);
  assert.equal(record.quantity, 1);
  assert.equal(record.unitPrice, 299.0);
  assert.equal(record.totalAmount, 299.0);
  assert.equal(record.currency, 'USD');
  assert.equal(record.paymentStatus, 'COMPLETED');
  assert.ok(record.createdAt);
  assert.ok(record.completedAt);
});

test('Scenario 10: A user cannot access or capture another user’s purchases', async () => {
  const { engine } = createSandboxTestEngine();
  const ownerId = 'usr_owner_10';
  const attackerId = 'usr_attacker_10';
  engine.configureBuyerSandboxBalance(ownerId, 500.0);
  engine.configureBuyerSandboxBalance(attackerId, 500.0);

  const product = buildVerifiedChannel3Product();
  engine.registerVerifiedLiveOffer(product);

  const prep = engine.prepareAutonomousPurchaseOrder({
    userId: ownerId,
    itemId: product.id,
    quantity: 1,
  });
  const auth = engine.authorizePurchaseOrder({
    userId: ownerId,
    orderId: prep.orderRow!.id,
    actor: 'user',
    explicitUserConfirmed: true,
    confirmedAmount: 299.0,
    confirmedCurrency: 'USD',
  });
  const exec = await engine.executeAuthorizedOrder({
    userId: ownerId,
    orderId: prep.orderRow!.id,
    authorizationHash: auth.authorization!.authorizationHash,
    actor: 'user',
  });
  engine.markOrderApproved(exec.transaction!.sparkOrderId, { userId: ownerId });

  // 10a: Attacker cannot capture owner's approved order
  const attackerCap = await engine.captureAuthorizedOrder({
    userId: attackerId,
    orderId: exec.transaction!.sparkOrderId,
  });
  assert.equal(attackerCap.ok, false);
  assert.equal(attackerCap.statusCode, 403);
  assert.equal(attackerCap.errorCode, 'forbidden_order_ownership');

  // Owner captures order
  const ownerCap = await engine.captureAuthorizedOrder({
    userId: ownerId,
    orderId: exec.transaction!.sparkOrderId,
  });
  assert.equal(ownerCap.ok, true);

  // 10b: Attacker cannot read owner's transaction or purchase list
  const attackerTxRead = engine.getTransactionForUser(exec.transaction!.sparkOrderId, attackerId);
  assert.equal(attackerTxRead.ok, false);
  assert.equal(attackerTxRead.statusCode, 403);

  const attackerPurchases = engine.getUserPurchases(attackerId);
  assert.equal(attackerPurchases.length, 0, 'Attacker must see 0 purchases belonging to owner');
  const ownerPurchases = engine.getUserPurchases(ownerId);
  assert.equal(ownerPurchases.length, 1);
});
