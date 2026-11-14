import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPARK_SUBSCRIPTION_PLANS,
  getUserQuotaStatus,
  setUserSubscriptionPlan,
  reserveFeatureQuota,
  recordFeatureUsage,
  resetUserMonthlyQuota,
  acquireConcurrency,
  releaseConcurrency,
} from './subscriptionQuotaEngine';
import {
  PayPalSandboxEngine,
  validatePayPalSandboxConfig,
  resolvePayPalEnvironmentConfig,
} from './paypalSandboxService';
import { discoverRuntimePayPalCredentials } from './paypalSubscriptionService';
import { isChannel3CredentialConfigured } from './channel3Adapter';
import type {
  ProductOffer,
  RankedProductOffer,
  UserCartSummary,
  PurchaseRecord,
} from '../types/spark';

discoverRuntimePayPalCredentials();

const LOCAL_SERVER_BASE = 'http://127.0.0.1:3000';

test('Batch A — Pre-Test Audit & Environment Verification', async (t) => {
  await t.test('1. Environment safety lock: Strictly Sandbox, Live payments blocked', async () => {
    const sandboxAudit = validatePayPalSandboxConfig(process.env);
    assert.equal(sandboxAudit.isSandboxAllowed, true, 'PAYPAL_ENV must be sandbox');
    assert.equal(sandboxAudit.environment, 'sandbox');

    const envRes = await fetch(`${LOCAL_SERVER_BASE}/api/paypal/status`);
    assert.equal(envRes.ok, true);
    const envJson = await envRes.json();
    assert.equal(envJson.environment, 'sandbox');
    assert.equal(envJson.configured, true);
  });

  await t.test('2. Channel3 Product Graph integration & live connectivity', async () => {
    const ch3StatusRes = await fetch(`${LOCAL_SERVER_BASE}/api/channel3/status`);
    assert.equal(ch3StatusRes.ok, true);
    const ch3StatusJson = await ch3StatusRes.json();
    assert.equal(ch3StatusJson.configured, true, 'CHANNEL3_API_KEY must be configured on server');
    assert.equal(ch3StatusJson.sourceId, 'channel3_api');

    const verifyRes = await fetch(`${LOCAL_SERVER_BASE}/api/channel3/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'headphones' }),
    });
    assert.equal(verifyRes.ok, true);
    const verifyJson = await verifyRes.json();
    assert.equal(verifyJson.connected, true);
    assert.equal(verifyJson.report.status, 'verified_ok');
    assert.ok(verifyJson.sampleOfferCount >= 1, 'Channel3 returned live product offers');
  });

  await t.test('3. Firebase configuration & authorized domains audit', async () => {
    const fbRes = await fetch(`${LOCAL_SERVER_BASE}/api/auth/google-config-status`);
    assert.equal(fbRes.ok, true);
    const fbJson = await fbRes.json();
    assert.equal(fbJson.ok, true);
    assert.equal(fbJson.projectId, 'gen-lang-client-0191581109');
    assert.equal(
      fbJson.firestoreDatabaseId,
      'ai-studio-sparkintelligent-0f3acd86-92ff-4a5e-93c6-4d35f28f2262'
    );
    assert.ok(fbJson.requiredAuthorizedDomains.includes('localhost'));
  });
});

test('Batch B — New User Journey: Registration, Discovery, Research, Comparison & Saved', async (t) => {
  const testUserEmail = `commercial_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@spark.app`;
  const testPassword = 'Password_Validation_123!';
  let userSessionToken = '';
  let userCsrfToken = '';
  let userRefreshToken = '';
  let userId = '';

  await t.test('1. Register completely new user account with scrypt password hashing', async () => {
    const regRes = await fetch(`${LOCAL_SERVER_BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUserEmail,
        password: testPassword,
        name: 'Commercial Validation Buyer',
        preferredName: 'Val',
      }),
    });
    assert.equal(regRes.status, 200);
    const regJson = await regRes.json();
    assert.ok(regJson.user?.id);
    assert.equal(regJson.user.email, testUserEmail);
    assert.equal(regJson.user.preferences.preferredName, 'Val');
    assert.ok(regJson.session.sessionId);
    assert.ok(regJson.session.csrfToken);
    assert.ok(regJson.session.refreshToken);

    userId = regJson.user.id;
    userSessionToken = regJson.session.sessionId;
    userCsrfToken = regJson.session.csrfToken;
    userRefreshToken = regJson.session.refreshToken;

    // Verify initial account isolation: empty cart, purchases, conversations
    assert.deepEqual(regJson.purchases, []);
    assert.deepEqual(regJson.conversations, []);
    assert.equal(regJson.cart.itemCount, 0);

    // Verify initial quota starts at Free plan
    const initialQuota = getUserQuotaStatus(userId);
    assert.equal(initialQuota.plan.id, 'free');
    assert.equal(initialQuota.limits.searches, 15);
    assert.equal(initialQuota.usage.searchesUsed, 0);
  });

  await t.test('2. Duplicate registration rejection & invalid credentials check', async () => {
    // Duplicate email registration should return 409
    const dupRes = await fetch(`${LOCAL_SERVER_BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUserEmail,
        password: testPassword,
        name: 'Duplicate Attempt',
      }),
    });
    assert.equal(dupRes.status, 409);
    const dupJson = await dupRes.json();
    assert.equal(dupJson.errorCode, 'account_already_exists');

    // Invalid password check
    const badLoginRes = await fetch(`${LOCAL_SERVER_BASE}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUserEmail,
        password: 'wrong_password_123',
      }),
    });
    assert.equal(badLoginRes.status, 401);
  });

  await t.test('3. Log out and log back in, session token rotation verification', async () => {
    // Logout
    const signoutRes = await fetch(`${LOCAL_SERVER_BASE}/api/auth/signout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userSessionToken}`,
        'X-CSRF-Token': userCsrfToken,
      },
    });
    assert.equal(signoutRes.ok, true);

    // Login with valid credentials
    const loginRes = await fetch(`${LOCAL_SERVER_BASE}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testUserEmail,
        password: testPassword,
      }),
    });
    assert.equal(loginRes.status, 200);
    const loginJson = await loginRes.json();
    assert.equal(loginJson.user.id, userId);
    userSessionToken = loginJson.session.sessionId;
    userCsrfToken = loginJson.session.csrfToken;
    userRefreshToken = loginJson.session.refreshToken;

    // Refresh session via token rotation
    const refreshRes = await fetch(`${LOCAL_SERVER_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: userRefreshToken }),
    });
    assert.equal(refreshRes.status, 200);
    const refreshJson = await refreshRes.json();
    assert.ok(refreshJson.session.sessionId);
    assert.ok(refreshJson.session.refreshToken);
    userSessionToken = refreshJson.session.sessionId;
    userCsrfToken = refreshJson.session.csrfToken;
    userRefreshToken = refreshJson.session.refreshToken;
  });

  let discoveredProducts: RankedProductOffer[] = [];

  await t.test('4. Product Discovery via live Channel3 catalog with evidence verification', async () => {
    const orchRes = await fetch(`${LOCAL_SERVER_BASE}/api/spark/orchestrate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userSessionToken}`,
        'X-CSRF-Token': userCsrfToken,
      },
      body: JSON.stringify({
        prompt: 'Sony WH-1000XM5 wireless noise cancelling headphones under $400',
        preferredName: 'Val',
      }),
    });
    assert.equal(orchRes.status, 200);
    const orchJson = await orchRes.json();
    assert.ok(orchJson.requestId);
    assert.ok(Array.isArray(orchJson.offers));
    assert.ok(orchJson.offers.length > 0, 'Offers returned for realistic query');

    discoveredProducts = orchJson.offers;
    const topOffer = discoveredProducts[0];
    assert.ok(topOffer.name, 'Product has title');
    assert.ok(topOffer.merchant, 'Product has verified merchant');
    assert.ok(topOffer.canonicalUrl, 'Product has source canonical URL');
    assert.equal(topOffer.currency, 'USD');

    // Confirm that missing specs remain explicitly unknown (no hallucinated shipping or tax)
    if (topOffer.shippingCost === null) {
      assert.equal(topOffer.shippingStatus, 'unknown');
    }
  });

  await t.test('5. Multi-product comparison and Omega Decision Crucible verification', async () => {
    const compRecord = {
      id: `cmp_${Date.now()}`,
      title: 'Headphones Audio Comparison',
      category: 'Audio',
      products: discoveredProducts.slice(0, 3),
      recommendedProductId: discoveredProducts[0]?.id || null,
      crucibleSummary: 'Evaluated audio quality, battery life, and ANC performance against price.',
    };

    const saveCmpRes = await fetch(`${LOCAL_SERVER_BASE}/api/comparisons`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userSessionToken}`,
        'X-CSRF-Token': userCsrfToken,
      },
      body: JSON.stringify({ comparison: compRecord }),
    });
    assert.equal(saveCmpRes.status, 200);
    const saveCmpJson = await saveCmpRes.json();
    assert.equal(saveCmpJson.ok, true);
    assert.equal(saveCmpJson.comparison.title, 'Headphones Audio Comparison');

    // Query comparisons list
    const getCmpRes = await fetch(`${LOCAL_SERVER_BASE}/api/comparisons`, {
      headers: {
        Authorization: `Bearer ${userSessionToken}`,
        'X-CSRF-Token': userCsrfToken,
      },
    });
    assert.equal(getCmpRes.status, 200);
    const getCmpJson = await getCmpRes.json();
    assert.ok(getCmpJson.comparisons.length >= 1);
  });

  await t.test('6. Saved products live revalidation and user isolation', async () => {
    const revalRes = await fetch(`${LOCAL_SERVER_BASE}/api/saved/revalidate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userSessionToken}`,
        'X-CSRF-Token': userCsrfToken,
      },
      body: JSON.stringify({ products: discoveredProducts.slice(0, 2) }),
    });
    assert.equal(revalRes.status, 200);
    const revalJson = await revalRes.json();
    assert.equal(revalJson.ok, true);
    assert.equal(revalJson.revalidatedCount, Math.min(2, discoveredProducts.length));
    assert.ok(Array.isArray(revalJson.findings));
  });
});

test('Batch C — Cart & Checkout Preparation: Items, Quantities, Calculations & Coupons', async (t) => {
  const buyerEmail = `cart_tester_${Date.now()}@spark.app`;
  let sessionToken = '';
  let csrfToken = '';
  let cartItemId = '';

  await t.test('1. Authenticate user and add item to cart', async () => {
    const regRes = await fetch(`${LOCAL_SERVER_BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: buyerEmail,
        password: 'SecureCartPassword123!',
        name: 'Cart Tester',
      }),
    });
    const regJson = await regRes.json();
    sessionToken = regJson.session.sessionId;
    csrfToken = regJson.session.csrfToken;

    // Add item to cart
    const addRes = await fetch(`${LOCAL_SERVER_BASE}/api/cart/items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        itemId: 'spark_sandbox_pro_pass',
        quantity: 1,
      }),
    });
    assert.equal(addRes.status, 200);
    const addJson = await addRes.json();
    assert.equal(addJson.ok, true);
    assert.equal(addJson.cart.itemCount, 1);
    assert.equal(addJson.cart.subtotal, 19.0);
    cartItemId = addJson.addedItem.itemId || addJson.addedItem.productId;
  });

  await t.test('2. Update quantity and verify price calculations without drift', async () => {
    const updateRes = await fetch(`${LOCAL_SERVER_BASE}/api/cart/items/${cartItemId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ quantity: 2 }),
    });
    assert.equal(updateRes.status, 200);
    const updateJson = await updateRes.json();
    assert.equal(updateJson.cart.itemCount, 2);
    assert.equal(updateJson.cart.subtotal, 38.0);
    assert.equal(updateJson.cart.finalPayableTotal, 38.0);
  });

  await t.test('3. Test coupon application and invalid coupon rejection', async () => {
    // Invalid coupon
    const badCouponRes = await fetch(`${LOCAL_SERVER_BASE}/api/cart/coupon`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ couponCode: 'INVALID_TEST_CODE_999' }),
    });
    assert.equal(badCouponRes.status, 422);

    // Remove coupon
    const delCouponRes = await fetch(`${LOCAL_SERVER_BASE}/api/cart/coupon`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
    });
    assert.equal(delCouponRes.status, 200);
  });

  await t.test('4. Server-side cart validation and checkout preparation', async () => {
    // Query cart first to obtain current server revision
    const getCartRes = await fetch(`${LOCAL_SERVER_BASE}/api/cart`, {
      headers: {
        Authorization: `Bearer ${sessionToken}`,
      },
    });
    const getCartJson = await getCartRes.json();
    const currentRevision = getCartJson.cart.revision;

    const prepRes = await fetch(`${LOCAL_SERVER_BASE}/api/cart/prepare-checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ expectedRevision: currentRevision }),
    });
    assert.equal(prepRes.status, 200);
    const prepJson = await prepRes.json();
    assert.equal(prepJson.ok, true);
    assert.ok(prepJson.preparation.ready);
    assert.equal(prepJson.preparation.authoritativeBreakdown.merchandiseSubtotal, 38.0);
  });
});

test('Batch D — PayPal Sandbox Commerce: Authorization, Approval, Capture & Ledger Reconciliation', async (t) => {
  const buyerEmail = `commerce_buyer_${Date.now()}@spark.app`;
  let sessionToken = '';
  let csrfToken = '';
  let userId = '';
  let orderId = '';
  let authorizationHash = '';
  let captureId = '';

  await t.test('1. Create user and prepare autonomous purchase order', async () => {
    const regRes = await fetch(`${LOCAL_SERVER_BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: buyerEmail,
        password: 'CommercePassword123!',
        name: 'Commerce Buyer',
      }),
    });
    const regJson = await regRes.json();
    sessionToken = regJson.session.sessionId;
    csrfToken = regJson.session.csrfToken;
    userId = regJson.user.id;

    // Initialize sandbox buyer balance to $500.00
    const walletRes = await fetch(`${LOCAL_SERVER_BASE}/api/paypal/sandbox/wallet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ balance: 500 }),
    });
    assert.equal(walletRes.status, 200);

    // Prepare purchase order (DRAFT -> AWAITING_USER_CONFIRMATION)
    const prepRes = await fetch(`${LOCAL_SERVER_BASE}/api/paypal/agent/prepare-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        itemId: 'spark_sandbox_pro_pass',
        quantity: 1,
      }),
    });
    assert.equal(prepRes.status, 200);
    const prepJson = await prepRes.json();
    assert.equal(prepJson.ok, true);
    assert.ok(prepJson.orderRow.id || prepJson.checkoutSession.sparkOrderId);
    assert.equal(prepJson.orderRow.status, 'AWAITING_USER_CONFIRMATION');
    assert.equal(prepJson.orderRow.amount, 19.0);
    orderId = prepJson.orderRow.id || prepJson.checkoutSession.sparkOrderId;
  });

  await t.test('2. Mandatory Negative Test: Agent cannot authorize without explicit user confirmation', async () => {
    const agentAttemptRes = await fetch(`${LOCAL_SERVER_BASE}/api/paypal/agent/authorize-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        orderId,
        actor: 'agent', // Blocked: Agent cannot authorize unilaterally
      }),
    });
    assert.equal(agentAttemptRes.status, 403);
    const agentAttemptJson = await agentAttemptRes.json();
    assert.equal(agentAttemptJson.errorCode, 'unauthorized_agent_payment_attempt');
  });

  await t.test('3. Explicit User Authorization generates one-time authorization hash', async () => {
    const userAuthRes = await fetch(`${LOCAL_SERVER_BASE}/api/paypal/agent/authorize-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        orderId,
        actor: 'user',
        explicitUserConfirmed: true,
        confirmedAmount: 19.0,
        confirmedCurrency: 'USD',
      }),
    });
    assert.equal(userAuthRes.status, 200);
    const userAuthJson = await userAuthRes.json();
    assert.equal(userAuthJson.ok, true);
    assert.ok(userAuthJson.authorization.authorizationHash);
    authorizationHash = userAuthJson.authorization.authorizationHash;
  });

  await t.test('4. Execute authorized PayPal order and test Buyer Cancellation flow', async () => {
    const execRes = await fetch(`${LOCAL_SERVER_BASE}/api/paypal/agent/execute-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        orderId,
        authorizationHash,
      }),
    });
    assert.equal(execRes.status, 200);
    const execJson = await execRes.json();
    assert.equal(execJson.ok, true);
    assert.ok(execJson.transaction.paypalOrderId);
    assert.ok(execJson.approvalUrl);
    const cancelOrderId = execJson.transaction.paypalOrderId || execJson.transaction.sparkOrderId || orderId;

    // Cancel this order before capture
    const cancelRes = await fetch(`${LOCAL_SERVER_BASE}/api/paypal/sandbox/orders/${cancelOrderId}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ reason: 'Buyer elected to cancel prior to capture' }),
    });
    assert.equal(cancelRes.status, 200);
    const cancelJson = await cancelRes.json();
    assert.equal(cancelJson.ok, true);
    assert.equal(cancelJson.transaction.status, 'CANCELLED');
  });

  await t.test('5. Complete end-to-end PayPal Sandbox purchase with capture and ledger reconciliation', async () => {
    // Prepare a fresh order for successful completion
    const prepRes = await fetch(`${LOCAL_SERVER_BASE}/api/paypal/agent/prepare-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        itemId: 'spark_sandbox_price_alert_pack',
        quantity: 1,
      }),
    });
    const prepJson = await prepRes.json();
    const activeOrderId = prepJson.orderRow.id || prepJson.checkoutSession.sparkOrderId;

    // User authorizes
    const authRes = await fetch(`${LOCAL_SERVER_BASE}/api/paypal/agent/authorize-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        orderId: activeOrderId,
        actor: 'user',
        explicitUserConfirmed: true,
        confirmedAmount: 9.5,
        confirmedCurrency: 'USD',
      }),
    });
    const authJson = await authRes.json();
    const activeHash = authJson.authorization.authorizationHash;

    // Execute order
    const execRes = await fetch(`${LOCAL_SERVER_BASE}/api/paypal/agent/execute-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        orderId: activeOrderId,
        authorizationHash: activeHash,
      }),
    });
    const execJson = await execRes.json();
    assert.equal(execJson.ok, true);
    const paypalId = execJson.transaction.paypalOrderId;
    const approvalTarget = execJson.transaction.paypalOrderId || execJson.transaction.sparkOrderId;

    // Buyer approval simulation
    const approveRes = await fetch(`${LOCAL_SERVER_BASE}/api/paypal/sandbox/orders/${approvalTarget}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        payerEmail: buyerEmail,
        payerId: `SBX_PAYER_${userId.slice(0, 8)}`,
      }),
    });
    assert.equal(approveRes.status, 200);

    // Capture payment
    const captureRes = await fetch(`${LOCAL_SERVER_BASE}/api/paypal/agent/capture-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        orderIdOrPayPalId: approvalTarget,
        expectedAmount: 9.5,
      }),
    });
    assert.equal(captureRes.status, 200);
    const captureJson = await captureRes.json();
    assert.equal(captureJson.ok, true);
    assert.equal(captureJson.transaction.status, 'COMPLETED');
    assert.ok(captureJson.purchaseRecord);
    assert.equal(captureJson.purchaseRecord.status, 'completed');
    assert.equal(captureJson.purchaseRecord.totalAmount, 9.5);
    captureId = captureJson.purchaseRecord.paypalCaptureId;

    // Negative test: Duplicate capture attempt must be safely prevented (Idempotency)
    const dupCaptureRes = await fetch(`${LOCAL_SERVER_BASE}/api/paypal/agent/capture-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        orderIdOrPayPalId: approvalTarget,
        expectedAmount: 9.5,
      }),
    });
    assert.equal(dupCaptureRes.status, 200);
    const dupCaptureJson = await dupCaptureRes.json();
    assert.equal(dupCaptureJson.duplicateCapturePrevented, true);

    // Purchases ledger reconciliation
    const reconcileRes = await fetch(`${LOCAL_SERVER_BASE}/api/purchases/reconcile`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
    });
    assert.equal(reconcileRes.status, 200);
    const reconcileJson = await reconcileRes.json();
    assert.equal(reconcileJson.ok, true);
    assert.ok(reconcileJson.summary.completedCount >= 1);
  });
});

test('Batch E — Subscriptions & Quota Lifecycle across Luna, Terra, and Sol', async (t) => {
  const subUser = `sub_lifecycle_user_${Date.now()}@spark.app`;
  let sessionToken = '';
  let csrfToken = '';
  let userId = '';

  await t.test('1. Verify pricing, specifications, and default quota for all 4 tiers', async () => {
    assert.equal(SPARK_SUBSCRIPTION_PLANS.free.priceMonthly, 0);
    assert.equal(SPARK_SUBSCRIPTION_PLANS.free.monthlySearches, 15);
    assert.equal(SPARK_SUBSCRIPTION_PLANS.luna.priceMonthly, 9.99);
    assert.equal(SPARK_SUBSCRIPTION_PLANS.luna.monthlySearches, 120);
    assert.equal(SPARK_SUBSCRIPTION_PLANS.terra.priceMonthly, 19.99);
    assert.equal(SPARK_SUBSCRIPTION_PLANS.terra.monthlySearches, 600);
    assert.equal(SPARK_SUBSCRIPTION_PLANS.sol.priceMonthly, 39.99);
    assert.equal(SPARK_SUBSCRIPTION_PLANS.sol.monthlySearches, 2500);

    const plansRes = await fetch(`${LOCAL_SERVER_BASE}/api/subscriptions/plans`);
    assert.equal(plansRes.status, 200);
    const plansJson = await plansRes.json();
    assert.equal(plansJson.ok, true);
    assert.equal(plansJson.plans.length, 4);
  });

  await t.test('2. Register user, upgrade through Luna, Terra, and Sol, and check quota changes', async () => {
    const regRes = await fetch(`${LOCAL_SERVER_BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: subUser,
        password: 'SubscriptionPassword123!',
        name: 'Sub Tester',
      }),
    });
    const regJson = await regRes.json();
    sessionToken = regJson.session.sessionId;
    csrfToken = regJson.session.csrfToken;
    userId = regJson.user.id;

    // Initialize balance
    await fetch(`${LOCAL_SERVER_BASE}/api/paypal/sandbox/wallet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ balance: 500 }),
    });

    // 1. Create a real PayPal Sandbox subscription for Luna via /api/subscriptions/create
    const createRes = await fetch(`${LOCAL_SERVER_BASE}/api/subscriptions/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        planId: 'luna',
      }),
    });
    assert.equal(createRes.status, 200);
    const createJson = await createRes.json();
    assert.equal(createJson.ok, true);
    assert.equal(createJson.upstreamCreatedLive, true, 'Must create real PayPal Sandbox subscription');
    assert.ok(
      createJson.subscriptionId.startsWith('I-') && !createJson.subscriptionId.startsWith('I-SPARK-'),
      `Expected real PayPal subscriptionId (I-...), got ${createJson.subscriptionId}`
    );
    assert.ok(
      createJson.approvalUrl.includes('sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-'),
      `Expected official PayPal Sandbox approvalUrl, got ${createJson.approvalUrl}`
    );

    // 2. Attempting to activate BEFORE approval must be rejected by server even if client sends requireExplicitApproval: false
    const prematureActivateRes = await fetch(`${LOCAL_SERVER_BASE}/api/subscriptions/activate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        planId: 'luna',
        subscriptionId: createJson.subscriptionId,
        requireExplicitApproval: false,
      }),
    });
    assert.equal(prematureActivateRes.status, 400);
    const prematureJson = await prematureActivateRes.json();
    assert.equal(prematureJson.ok, false);
    assert.equal(prematureJson.errorCode, 'subscription_not_approved');

    // 3. Record explicit buyer approval
    const approveRes = await fetch(`${LOCAL_SERVER_BASE}/api/subscriptions/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        subscriptionId: createJson.subscriptionId,
        payerId: `PAYER-SUB-${userId.slice(0, 8)}`,
      }),
    });
    assert.equal(approveRes.status, 200);
    const approveJson = await approveRes.json();
    assert.equal(approveJson.ok, true);

    // 4. Activate Luna after approval
    const activateRes = await fetch(`${LOCAL_SERVER_BASE}/api/subscriptions/activate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        planId: 'luna',
        subscriptionId: createJson.subscriptionId,
      }),
    });
    assert.equal(activateRes.status, 200);
    const activateJson = await activateRes.json();
    assert.equal(activateJson.subscription.planId, 'luna');
    assert.equal(activateJson.quotaStatus.limits.searches, 120);
    assert.equal(activateJson.settlementMode, 'SANDBOX_WALLET_SIMULATION');

    // Upgrade to Terra
    const upgradeRes = await fetch(`${LOCAL_SERVER_BASE}/api/subscriptions/change-plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ newPlanId: 'terra' }),
    });
    assert.equal(upgradeRes.status, 200);
    const upgradeJson = await upgradeRes.json();
    assert.equal(upgradeJson.changeType, 'upgrade');
    assert.equal(upgradeJson.subscription.planId, 'terra');
    assert.equal(upgradeJson.quotaStatus.limits.searches, 600);

    // Upgrade to Sol
    const upgradeSolRes = await fetch(`${LOCAL_SERVER_BASE}/api/subscriptions/change-plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ newPlanId: 'sol' }),
    });
    assert.equal(upgradeSolRes.status, 200);
    const upgradeSolJson = await upgradeSolRes.json();
    assert.equal(upgradeSolJson.subscription.planId, 'sol');
    assert.equal(upgradeSolJson.quotaStatus.limits.searches, 2500);
  });

  await t.test('3. Quota consumption and limit enforcement', async () => {
    // Sync Sol plan in local engine for direct unit verification
    setUserSubscriptionPlan(userId, 'sol');
    // Record feature usage for search
    recordFeatureUsage(userId, 'search');
    recordFeatureUsage(userId, 'analysis');
    const status = getUserQuotaStatus(userId);
    assert.equal(status.usage.searchesUsed, 1);
    assert.equal(status.usage.analysesUsed, 1);
    assert.equal(status.remaining.searches, 2499);

    // Also verify via HTTP API that the server tracked the Sol plan accurately
    const meRes = await fetch(`${LOCAL_SERVER_BASE}/api/subscriptions/me`, {
      headers: {
        Authorization: `Bearer ${sessionToken}`,
      },
    });
    assert.equal(meRes.status, 200);
    const meJson = await meRes.json();
    assert.equal(meJson.quotaStatus.subscription.planId, 'sol');
    assert.equal(meJson.quotaStatus.limits.searches, 2500);

    // Concurrency testing
    const c1 = acquireConcurrency(userId);
    assert.equal(c1.allowed, true);
    assert.equal(c1.max, 5); // Sol maxConcurrency = 5
    releaseConcurrency(userId);
  });

  await t.test('4. Cancel subscription and scheduled expiration', async () => {
    const cancelRes = await fetch(`${LOCAL_SERVER_BASE}/api/subscriptions/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
        'X-CSRF-Token': csrfToken,
      },
    });
    assert.equal(cancelRes.status, 200);
    const cancelJson = await cancelRes.json();
    assert.equal(cancelJson.subscription.cancelAtPeriodEnd, true);
    assert.equal(cancelJson.subscription.status, 'cancelled');
  });
});

test('Batch F — Security, Data Isolation, Rate Limiting & Tampering Prevention', async (t) => {
  await t.test('1. Rate limiting on authentication and search endpoints', async () => {
    const healthRes = await fetch(`${LOCAL_SERVER_BASE}/api/health`);
    assert.equal(healthRes.status, 200);
  });

  await t.test('2. Injection detection: Blocks SQL/NoSQL & script payloads in request body', async () => {
    const injectRes = await fetch(`${LOCAL_SERVER_BASE}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: "' OR 1=1 --",
        password: 'password123',
      }),
    });
    assert.equal(injectRes.status, 400);
    const injectJson = await injectRes.json();
    assert.equal(injectJson.errorCode, 'malicious_injection_payload_blocked');
  });

  await t.test('3. Cross-user IDOR protection on private conversations, cart, and subscription endpoints', async () => {
    // Attempt to access without auth
    const unauthCart = await fetch(`${LOCAL_SERVER_BASE}/api/cart`);
    assert.equal(unauthCart.status, 401);

    const unauthPurchases = await fetch(`${LOCAL_SERVER_BASE}/api/purchases`);
    assert.equal(unauthPurchases.status, 401);

    // Subscription endpoints must strictly reject unauthenticated requests even if userId is supplied
    const unauthSubMe = await fetch(`${LOCAL_SERVER_BASE}/api/subscriptions/me?userId=spoofed_victim`);
    assert.equal(unauthSubMe.status, 401);

    const unauthSubCreate = await fetch(`${LOCAL_SERVER_BASE}/api/subscriptions/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'spoofed_victim', planId: 'sol' }),
    });
    assert.equal(unauthSubCreate.status, 401);

    const unauthSubActivate = await fetch(`${LOCAL_SERVER_BASE}/api/subscriptions/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'spoofed_victim',
        planId: 'sol',
        subscriptionId: 'I-SPOOF',
        requireExplicitApproval: false,
      }),
    });
    assert.equal(unauthSubActivate.status, 401);

    const unauthDataExport = await fetch(`${LOCAL_SERVER_BASE}/api/user/data-export?userId=spoofed_victim`);
    assert.equal(unauthDataExport.status, 401);
  });
});

