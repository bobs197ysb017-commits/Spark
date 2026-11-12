import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PAYPAL_IDENTITY_SCOPES,
  PAYPAL_LIVE_AUTH_URL,
  PAYPAL_LIVE_BASE_URL,
  PAYPAL_LIVE_TERMINATE_URL,
  PAYPAL_LIVE_USERINFO_URL,
  PAYPAL_SANDBOX_AUTH_URL,
  PAYPAL_SANDBOX_BASE_URL,
  PayPalSandboxEngine,
  SparkAuthSessionManager,
  canTransitionLifecycleState,
  canTransitionTransactionState,
  decryptPayPalToken,
  encryptPayPalToken,
  maskPayPalEmail,
  redactPayPalSecrets,
  resolvePayPalEnvironmentConfig,
  validatePayPalRedirectUri,
  validatePayPalSandboxConfig,
  verifyDeveloperAccess,
  verifyFirebaseJwtClaims,
  type FetchLike,
  type PayPalEnvVariables,
} from './paypalSandboxService';
import type { UserProfile } from '../types/spark';

function createMockEnv(overrides?: Partial<PayPalEnvVariables>): PayPalEnvVariables {
  return {
    PAYPAL_ENV: 'sandbox',
    PAYPAL_CLIENT_ID: 'AeA1QIZXiflr1_-r0U2_sandbox_client_id_test123',
    PAYPAL_CLIENT_SECRET: 'ECYYrr_sandbox_client_secret_value_test987',
    PAYPAL_WEBHOOK_ID: '4JH821948S291_WEBHOOK_ID',
    APP_URL: 'http://localhost:3000',
    ...overrides,
  };
}

function createTestUser(id: string, email: string, name: string): UserProfile {
  return {
    id,
    email,
    createdAt: '2026-10-28T00:00:00.000Z',
    preferences: {
      displayName: name,
      preferredName: name,
      avatarUrl: '',
      theme: 'dark',
      accentColor: 'violet',
      language: 'en',
      soundEnabled: true,
      autoApplyCoupons: false,
      defaultCurrency: 'USD',
    },
    paypal: {
      status: 'not_connected',
    },
  };
}

describe('PayPal Sandbox Integration, User Authentication & Ownership Suite', () => {
  // Core Sandbox Scenario 1: Missing credentials
  it('Core 1: Missing credentials fails safely with missing_credentials and never claims Connected', async () => {
    const emptyEnv: PayPalEnvVariables = {
      PAYPAL_ENV: 'sandbox',
      PAYPAL_CLIENT_ID: '',
      PAYPAL_CLIENT_SECRET: 'MY_PAYPAL_CLIENT_SECRET',
    };
    const configCheck = validatePayPalSandboxConfig(emptyEnv);
    assert.equal(configCheck.allCoreCredentialsPresent, false);
    assert.equal(configCheck.errorCode, 'missing_credentials');

    const engine = new PayPalSandboxEngine({
      envGetter: () => emptyEnv,
    });
    const authRes = await engine.authenticate();
    assert.equal(authRes.ok, false);
    assert.equal(authRes.statusCode, 503);
    assert.equal(authRes.errorCode, 'missing_credentials');

    const status = engine.getStatus();
    assert.equal(status.connectionStatus, 'Not Connected');
    assert.equal(status.oauthValidated, false);
  });

  // Core Sandbox Scenario 1b: Non-sandbox environment blocked
  it('Core 1b: Blocks non-sandbox PAYPAL_ENV values so real money can never be charged', async () => {
    const prodEnv = createMockEnv({ PAYPAL_ENV: 'live' });
    const engine = new PayPalSandboxEngine({
      envGetter: () => prodEnv,
    });
    const authRes = await engine.authenticate();
    assert.equal(authRes.ok, false);
    assert.equal(authRes.statusCode, 400);
    assert.equal(authRes.errorCode, 'non_sandbox_environment_blocked');
    assert.equal(engine.getStatus().connectionStatus, 'Configuration Error');
  });

  // Core Sandbox Scenario 2: Successful Sandbox authentication & token caching
  it('Core 2: Successful Sandbox authentication exchanges OAuth2 credentials and caches token safely', async () => {
    let oauthCallCount = 0;
    let currentTimeMs = 1_700_000_000_000;

    const mockFetch: FetchLike = async (input, init) => {
      const url = String(input);
      assert.equal(url, `${PAYPAL_SANDBOX_BASE_URL}/v1/oauth2/token`);
      assert.equal(init?.method, 'POST');
      oauthCallCount += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'A21AA_SANDBOX_ACCESS_TOKEN_XYZ',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      };
    };

    const env = createMockEnv();
    const engine = new PayPalSandboxEngine({
      envGetter: () => env,
      fetchFn: mockFetch,
      nowFn: () => currentTimeMs,
    });

    const firstAuth = await engine.authenticate();
    assert.equal(firstAuth.ok, true);
    assert.equal(firstAuth.fromCache, false);
    assert.equal(oauthCallCount, 1);

    const status = engine.getStatus();
    assert.equal(status.connectionStatus, 'Connected');
    assert.equal(status.oauthValidated, true);
    assert.equal(status.tokenCached, true);

    currentTimeMs += 120_000;
    const secondAuth = await engine.authenticate();
    assert.equal(secondAuth.ok, true);
    assert.equal(secondAuth.fromCache, true);
    assert.equal(oauthCallCount, 1);
  });

  // Core Sandbox Scenario 3: Invalid credentials
  it('Core 3: Invalid credentials (401 Unauthorized) fails cleanly and redacts secrets from logs', async () => {
    const env = createMockEnv();
    const mockFetch: FetchLike = async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        error: 'invalid_client',
        error_description: `Client Authentication failed for secret ${env.PAYPAL_CLIENT_SECRET}`,
        debug_id: 'dbg_401_test',
      }),
    });

    const engine = new PayPalSandboxEngine({
      envGetter: () => env,
      fetchFn: mockFetch,
    });

    const res = await engine.authenticate();
    assert.equal(res.ok, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.errorCode, 'invalid_credentials');
    assert.equal(res.message.includes(env.PAYPAL_CLIENT_SECRET!), false);
    assert.equal(res.message.includes('[REDACTED_PAYPAL_SECRET]'), true);
    assert.equal(engine.getStatus().connectionStatus, 'Configuration Error');
  });

  // Security Scenario 1: Unauthenticated payment requests & untrusted frontend userId rejection
  it('Auth Scenario 1: Rejects unauthenticated payment requests and rejects untrusted frontend-supplied userId', async () => {
    const sessionManager = new SparkAuthSessionManager();

    // Unauthenticated request with no token or cookie
    const noAuth = sessionManager.verifyRequest({
      method: 'POST',
      headers: {},
    });
    assert.equal(noAuth.authenticated, false);
    assert.equal(noAuth.statusCode, 401);
    assert.equal(noAuth.errorCode, 'unauthenticated');

    // Unauthenticated request attempting to pass x-spark-user-id header directly
    const spoofedHeaderNoSession = sessionManager.verifyRequest({
      method: 'POST',
      headers: {
        'x-spark-user-id': 'usr_spoofed_admin',
      },
    });
    assert.equal(spoofedHeaderNoSession.authenticated, false);
    assert.equal(spoofedHeaderNoSession.statusCode, 401);
    assert.equal(spoofedHeaderNoSession.errorCode, 'untrusted_frontend_user_id_rejected');

    // Engine also rejects createCheckoutSession and createOrder if server-verified userId is missing
    const engine = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
    });
    const unauthSessionRes = engine.createCheckoutSession({
      userId: '',
      userEmail: '',
      itemId: 'spark_sandbox_pro_pass',
      quantity: 1,
    });
    assert.equal(unauthSessionRes.ok, false);
    assert.equal(unauthSessionRes.statusCode, 401);
    assert.equal(unauthSessionRes.errorCode, 'unauthenticated');

    const unauthOrderRes = await engine.createOrder({
      userId: '',
      userEmail: '',
      itemId: 'spark_sandbox_pro_pass',
      quantity: 1,
    });
    assert.equal(unauthOrderRes.ok, false);
    assert.equal(unauthOrderRes.statusCode, 401);
    assert.equal(unauthOrderRes.errorCode, 'unauthenticated');
  });

  // Security Scenario 2: Valid authenticated checkout creation bound to Spark user
  it('Auth Scenario 2: Creates authenticated SparkCheckoutSession and PayPal order bound to verified userId', async () => {
    const env = createMockEnv();
    let capturedOrderPayload: Record<string, unknown> | null = null;

    const mockFetch: FetchLike = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/v1/oauth2/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'TOKEN_VALID', expires_in: 3600 }),
        };
      }
      if (url.endsWith('/v2/checkout/orders')) {
        capturedOrderPayload = JSON.parse(String(init?.body || '{}'));
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: '5O190127TN364715T',
            status: 'CREATED',
            links: [
              {
                href: 'https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T',
                rel: 'approve',
                method: 'GET',
              },
            ],
          }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const engine = new PayPalSandboxEngine({
      envGetter: () => env,
      fetchFn: mockFetch,
    });

    const checkoutSessionRes = engine.createCheckoutSession({
      userId: 'usr_alice',
      userEmail: 'alice@spark.app',
      itemId: 'spark_sandbox_hardware_kit',
      quantity: 1,
    });
    assert.equal(checkoutSessionRes.ok, true);
    assert.equal(checkoutSessionRes.statusCode, 201);
    assert.ok(checkoutSessionRes.checkoutSession);
    assert.equal(checkoutSessionRes.checkoutSession.userId, 'usr_alice');
    assert.equal(checkoutSessionRes.checkoutSession.status, 'OPEN');

    const orderRes = await engine.createOrder({
      userId: 'usr_alice',
      userEmail: 'alice@spark.app',
      checkoutSessionId: checkoutSessionRes.checkoutSession.checkoutSessionId,
      itemId: 'spark_sandbox_hardware_kit',
      quantity: 1,
    });

    assert.equal(orderRes.ok, true);
    assert.equal(orderRes.statusCode, 201);
    assert.ok(orderRes.transaction);
    assert.equal(orderRes.transaction.userId, 'usr_alice');
    assert.equal(orderRes.transaction.userEmail, 'alice@spark.app');
    assert.equal(
      orderRes.transaction.checkoutSessionId,
      checkoutSessionRes.checkoutSession.checkoutSessionId
    );
    assert.equal(orderRes.transaction.paypalOrderId, '5O190127TN364715T');
    assert.equal(orderRes.transaction.status, 'CREATED');
    assert.equal(orderRes.transaction.amount, 59.49);
    assert.ok(capturedOrderPayload);
    const units = (capturedOrderPayload as Record<string, unknown>).purchase_units as Array<
      Record<string, unknown>
    >;
    assert.equal(units[0].custom_id, orderRes.transaction.sparkOrderId);

    // Checkout session is now linked to the PayPal order ID
    const updatedSession = engine.getCheckoutSessionForUser(
      checkoutSessionRes.checkoutSession.checkoutSessionId,
      'usr_alice'
    );
    assert.equal(updatedSession.ok, true);
    assert.equal(updatedSession.checkoutSession?.paypalOrderId, '5O190127TN364715T');
    assert.equal(updatedSession.checkoutSession?.status, 'ORDER_CREATED');
  });

  // Security Scenario 3 & 4: Order ownership enforcement & Cross-user order access attempts
  it('Auth Scenario 3 & 4: Enforces strict order and checkout session ownership and blocks cross-user access with 403', async () => {
    const mockFetch: FetchLike = async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/oauth2/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'TOKEN_OK', expires_in: 3600 }),
        };
      }
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: 'ORD_ALICE_PRIVATE_01', status: 'CREATED', links: [] }),
      };
    };

    const engine = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
      fetchFn: mockFetch,
    });

    // Alice creates a checkout session and order
    const aliceSession = engine.createCheckoutSession({
      userId: 'usr_alice',
      userEmail: 'alice@spark.app',
      itemId: 'spark_sandbox_pro_pass',
      quantity: 1,
    });
    assert.equal(aliceSession.ok, true);

    // Bob attempts to create an order using Alice's checkoutSessionId -> 403 forbidden_order_ownership
    const bobHijackSession = await engine.createOrder({
      userId: 'usr_bob',
      userEmail: 'bob@spark.app',
      checkoutSessionId: aliceSession.checkoutSession!.checkoutSessionId,
      itemId: 'spark_sandbox_pro_pass',
      quantity: 1,
    });
    assert.equal(bobHijackSession.ok, false);
    assert.equal(bobHijackSession.statusCode, 403);
    assert.equal(bobHijackSession.errorCode, 'forbidden_order_ownership');

    // Alice creates her order
    const aliceOrder = await engine.createOrder({
      userId: 'usr_alice',
      userEmail: 'alice@spark.app',
      checkoutSessionId: aliceSession.checkoutSession!.checkoutSessionId,
      itemId: 'spark_sandbox_pro_pass',
      quantity: 1,
    });
    assert.equal(aliceOrder.ok, true);

    // Bob attempts to read Alice's order -> 403 forbidden_order_ownership
    const bobReadOrder = engine.getTransactionForUser('ORD_ALICE_PRIVATE_01', 'usr_bob');
    assert.equal(bobReadOrder.ok, false);
    assert.equal(bobReadOrder.statusCode, 403);
    assert.equal(bobReadOrder.errorCode, 'forbidden_order_ownership');

    // Bob attempts to approve Alice's order -> 403 forbidden_order_ownership
    const bobApproveOrder = engine.markOrderApproved(
      'ORD_ALICE_PRIVATE_01',
      {
        email: 'bob-buyer@personal.example.com',
        payerId: 'BOB_PAYER',
        userId: 'usr_bob',
      },
      'buyer'
    );
    assert.equal(bobApproveOrder.ok, false);
    assert.equal(bobApproveOrder.statusCode, 403);
    assert.equal(bobApproveOrder.errorCode, 'forbidden_order_ownership');

    // Bob attempts to cancel Alice's order -> 403 forbidden_order_ownership
    const bobCancelOrder = engine.cancelOrder(
      'ORD_ALICE_PRIVATE_01',
      'Malicious cross-user cancel attempt',
      'usr_bob'
    );
    assert.equal(bobCancelOrder.ok, false);
    assert.equal(bobCancelOrder.statusCode, 403);
    assert.equal(bobCancelOrder.errorCode, 'forbidden_order_ownership');

    // Alice can read and approve her own order
    const aliceRead = engine.getTransactionForUser('ORD_ALICE_PRIVATE_01', 'usr_alice');
    assert.equal(aliceRead.ok, true);
    assert.equal(aliceRead.transaction?.userId, 'usr_alice');

    // Security audit log recorded the unauthorized access attempts
    const audits = engine.getSecurityAuditLogs('usr_bob');
    assert.equal(audits.length >= 4, true);
    assert.equal(audits.every((a) => a.outcome === 'DENIED'), true);
  });

  // Security Scenario 5: Amount manipulation rejection across checkout session, order creation, and capture
  it('Auth Scenario 5: Rejects client-submitted tampered unit price or total amount at checkout, order, and capture', async () => {
    let paypalOrderCreated = false;
    const engine = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
      fetchFn: async (input) => {
        const url = String(input);
        if (url.endsWith('/v1/oauth2/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ access_token: 'TOKEN_OK', expires_in: 3600 }),
          };
        }
        if (url.endsWith('/v2/checkout/orders')) {
          paypalOrderCreated = true;
          return {
            ok: true,
            status: 201,
            json: async () => ({ id: 'ORD_TAMPER_CAPTURE_01', status: 'CREATED', links: [] }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      },
    });

    // 5a: Tampered total at checkout session creation
    const tamperedSession = engine.createCheckoutSession({
      userId: 'usr_alice',
      userEmail: 'alice@spark.app',
      itemId: 'spark_sandbox_pro_pass',
      quantity: 1,
      clientSubmittedTotalAmount: 0.99,
    });
    assert.equal(tamperedSession.ok, false);
    assert.equal(tamperedSession.statusCode, 400);
    assert.equal(tamperedSession.errorCode, 'tampered_amount_rejected');

    // 5b: Tampered total at order creation
    const tamperedOrderTotal = await engine.createOrder({
      userId: 'usr_alice',
      userEmail: 'alice@spark.app',
      itemId: 'spark_sandbox_pro_pass',
      quantity: 1,
      clientSubmittedTotalAmount: 1.0,
    });
    assert.equal(tamperedOrderTotal.ok, false);
    assert.equal(tamperedOrderTotal.statusCode, 400);
    assert.equal(tamperedOrderTotal.errorCode, 'tampered_amount_rejected');
    assert.equal(paypalOrderCreated, false);

    // 5c: Tampered unit price at order creation
    const tamperedUnitRes = await engine.createOrder({
      userId: 'usr_alice',
      userEmail: 'alice@spark.app',
      itemId: 'spark_sandbox_pro_pass',
      quantity: 2,
      clientSubmittedUnitPrice: 0.5,
    });
    assert.equal(tamperedUnitRes.ok, false);
    assert.equal(tamperedUnitRes.statusCode, 400);
    assert.equal(tamperedUnitRes.errorCode, 'tampered_amount_rejected');
    assert.equal(paypalOrderCreated, false);

    // 5d: Valid order creation followed by tampered expectedAmount during capture
    const validOrder = await engine.createOrder({
      userId: 'usr_alice',
      userEmail: 'alice@spark.app',
      itemId: 'spark_sandbox_pro_pass',
      quantity: 1,
    });
    assert.equal(validOrder.ok, true);
    engine.markOrderApproved('ORD_TAMPER_CAPTURE_01', { userId: 'usr_alice' }, 'buyer');

    const tamperedCapture = await engine.captureOrder('ORD_TAMPER_CAPTURE_01', {
      userId: 'usr_alice',
      expectedAmount: 5.0, // Actual server amount is $19.00
    });
    assert.equal(tamperedCapture.ok, false);
    assert.equal(tamperedCapture.statusCode, 400);
    assert.equal(tamperedCapture.errorCode, 'tampered_amount_rejected');
  });

  // Security Scenario 6 & 7: Unauthorized capture attempts & Duplicate capture requests
  it('Auth Scenario 6 & 7: Blocks cross-user capture attempts with 403 and prevents duplicate captures idempotently', async () => {
    let captureApiCalls = 0;
    const mockFetch: FetchLike = async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/oauth2/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'TOKEN_OK', expires_in: 3600 }),
        };
      }
      if (url.endsWith('/v2/checkout/orders')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'ORD_CAPTURE_TEST_01',
            status: 'CREATED',
            links: [],
          }),
        };
      }
      if (url.endsWith('/v2/checkout/orders/ORD_CAPTURE_TEST_01/capture')) {
        captureApiCalls += 1;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'ORD_CAPTURE_TEST_01',
            status: 'COMPLETED',
            payer: {
              email_address: 'buyer-test@personal.example.com',
              payer_id: 'PAYER123',
            },
            purchase_units: [
              {
                payments: {
                  captures: [
                    {
                      id: 'CAP_99887766',
                      status: 'COMPLETED',
                      amount: {
                        currency_code: 'USD',
                        value: '19.00',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const engine = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
      fetchFn: mockFetch,
    });

    const created = await engine.createOrder({
      userId: 'usr_alice',
      userEmail: 'alice@spark.app',
      itemId: 'spark_sandbox_pro_pass',
      quantity: 1,
    });
    assert.equal(created.ok, true);

    const approved = engine.markOrderApproved(
      'ORD_CAPTURE_TEST_01',
      {
        email: 'buyer-test@personal.example.com',
        payerId: 'PAYER123',
        userId: 'usr_alice',
      },
      'buyer'
    );
    assert.equal(approved.ok, true);
    assert.equal(approved.transaction?.status, 'APPROVED');

    // Scenario 6: User B (usr_bob) attempts to capture User A's approved order -> 403 forbidden_order_ownership
    const unauthorizedCapture = await engine.captureOrder('ORD_CAPTURE_TEST_01', {
      userId: 'usr_bob',
    });
    assert.equal(unauthorizedCapture.ok, false);
    assert.equal(unauthorizedCapture.statusCode, 403);
    assert.equal(unauthorizedCapture.errorCode, 'forbidden_order_ownership');
    assert.equal(captureApiCalls, 0);

    // Owner (usr_alice) captures order -> succeeds once
    const capture1 = await engine.captureOrder('ORD_CAPTURE_TEST_01', {
      userId: 'usr_alice',
    });
    assert.equal(capture1.ok, true);
    assert.equal(capture1.duplicateCapturePrevented, false);
    assert.equal(capture1.transaction?.status, 'COMPLETED');
    assert.equal(capture1.transaction?.captureId, 'CAP_99887766');
    assert.equal(capture1.purchaseRecord?.userId, 'usr_alice');
    assert.equal(capture1.purchaseRecord?.paypalOrderId, 'ORD_CAPTURE_TEST_01');
    assert.equal(capture1.purchaseRecord?.captureId, 'CAP_99887766');
    assert.equal(capture1.purchaseRecord?.status, 'completed');
    assert.equal(captureApiCalls, 1);

    // Scenario 7: Duplicate capture request by owner is blocked idempotently without calling PayPal again
    const capture2 = await engine.captureOrder('ORD_CAPTURE_TEST_01', {
      userId: 'usr_alice',
    });
    assert.equal(capture2.ok, true);
    assert.equal(capture2.duplicateCapturePrevented, true);
    assert.equal(capture2.transaction?.captureId, 'CAP_99887766');
    assert.equal(captureApiCalls, 1);
    assert.equal(engine.getUserPurchases('usr_alice').length, 1);
  });

  // Core Sandbox Scenario 8 & 9: Buyer cancellation and Capture failure (INSTRUMENT_DECLINED)
  it('Core 8 & 9: Handles buyer cancellation and PayPal capture failure (INSTRUMENT_DECLINED) with owner verification', async () => {
    let sentMockHeader: string | undefined;

    const mockFetch: FetchLike = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/v1/oauth2/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'TOKEN_OK', expires_in: 3600 }),
        };
      }
      if (url.endsWith('/v2/checkout/orders')) {
        const body = JSON.parse(String(init?.body || '{}'));
        const item = body.purchase_units?.[0]?.items?.[0]?.name || '';
        const orderId = item.includes('Protection') ? 'ORD_CANCEL_01' : 'ORD_DECLINE_01';
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: orderId, status: 'CREATED', links: [] }),
        };
      }
      if (url.endsWith('/v2/checkout/orders/ORD_DECLINE_01/capture')) {
        const headers = (init?.headers || {}) as Record<string, string>;
        sentMockHeader = headers['PayPal-Mock-Response'];
        return {
          ok: false,
          status: 422,
          json: async () => ({
            name: 'UNPROCESSABLE_ENTITY',
            details: [
              {
                issue: 'INSTRUMENT_DECLINED',
                description:
                  'The instrument presented was either declined by the processor or bank, or it cant be used for this payment.',
              },
            ],
            debug_id: 'f4b81092a11c',
          }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const engine = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
      fetchFn: mockFetch,
    });

    await engine.createOrder({
      userId: 'usr_alice',
      userEmail: 'alice@spark.app',
      itemId: 'spark_sandbox_price_alert_pack',
      quantity: 1,
    });
    const cancelled = engine.cancelOrder(
      'ORD_CANCEL_01',
      'Buyer clicked Cancel and Return on sandbox.paypal.com.',
      'usr_alice'
    );
    assert.equal(cancelled.ok, true);
    assert.equal(cancelled.transaction?.status, 'CANCELLED');

    const captureCancelled = await engine.captureOrder('ORD_CANCEL_01', {
      userId: 'usr_alice',
    });
    assert.equal(captureCancelled.ok, false);
    assert.equal(captureCancelled.statusCode, 409);
    assert.equal(captureCancelled.errorCode, 'invalid_state_transition');

    await engine.createOrder({
      userId: 'usr_alice',
      userEmail: 'alice@spark.app',
      itemId: 'spark_sandbox_pro_pass',
      quantity: 1,
    });
    engine.markOrderApproved('ORD_DECLINE_01', { userId: 'usr_alice' }, 'buyer');

    const failedCapture = await engine.captureOrder('ORD_DECLINE_01', {
      userId: 'usr_alice',
      mockApplicationCode: 'INSTRUMENT_DECLINED',
    });
    assert.equal(
      sentMockHeader,
      JSON.stringify({ mock_application_codes: 'INSTRUMENT_DECLINED' })
    );
    assert.equal(failedCapture.ok, false);
    assert.equal(failedCapture.statusCode, 422);
    assert.equal(failedCapture.errorCode, 'INSTRUMENT_DECLINED');
    assert.equal(failedCapture.transaction?.status, 'FAILED');
  });

  // Security Scenario 8 & 9: Invalid webhook signatures, spoofed webhook userId, duplicate webhook events, and delayed/refund webhooks after session expiry
  it('Auth Scenario 8 & 9: Verifies webhook signatures, ignores spoofed webhook userId, deduplicates events, and processes delayed/refund webhooks after session expiry', async () => {
    let signatureShouldSucceed = true;
    const sessionManager = new SparkAuthSessionManager();
    const aliceUser = createTestUser('usr_alice', 'alice@spark.app', 'Alice');
    const aliceSession = sessionManager.issueSession({
      userId: aliceUser.id,
      email: aliceUser.email,
      displayName: aliceUser.preferences.displayName,
      authProvider: 'spark_credentials',
    });

    const mockFetch: FetchLike = async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/oauth2/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'TOKEN_OK', expires_in: 3600 }),
        };
      }
      if (url.endsWith('/v2/checkout/orders')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: 'ORD_WEBHOOK_01', status: 'CREATED', links: [] }),
        };
      }
      if (url.endsWith('/v1/notifications/verify-webhook-signature')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            verification_status: signatureShouldSucceed ? 'SUCCESS' : 'FAILURE',
          }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const engine = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
      fetchFn: mockFetch,
    });

    await engine.createOrder({
      userId: aliceUser.id,
      userEmail: aliceUser.email,
      itemId: 'spark_sandbox_pro_pass',
      quantity: 1,
    });

    // Expire Alice's browser session to simulate delayed webhook arriving after user logged out / session expired
    sessionManager.expireSessionForTesting(aliceSession.sessionId);
    const expiredCheck = sessionManager.verifyRequest({
      method: 'GET',
      headers: { authorization: `Bearer ${aliceSession.sessionId}` },
    });
    assert.equal(expiredCheck.authenticated, false);
    assert.equal(expiredCheck.errorCode, 'session_expired');

    const validHeaders = {
      'paypal-transmission-id': 'tx-id-001',
      'paypal-transmission-time': '2026-10-28T00:00:00Z',
      'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-123',
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-transmission-sig': 'valid_sig_base64',
    };

    // Delayed webhook arrives with a spoofed custom_id ("usr_attacker") in payload metadata
    const webhookCapturePayload = {
      id: 'WH-EVENT-9001',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: 'CAP-WH-777',
        status: 'COMPLETED',
        custom_id: 'usr_attacker',
        supplementary_data: {
          related_ids: {
            order_id: 'ORD_WEBHOOK_01',
          },
        },
      },
    };

    const validRes = await engine.verifyAndProcessWebhook(validHeaders, webhookCapturePayload);
    assert.equal(validRes.ok, true);
    assert.equal(validRes.verified, true);
    assert.equal(validRes.duplicate, false);
    // Ownership is resolved from server-side order record (usr_alice), ignoring spoofed custom_id ("usr_attacker")
    assert.equal(validRes.transaction?.userId, 'usr_alice');
    assert.equal(validRes.transaction?.status, 'COMPLETED');
    assert.equal(validRes.transaction?.captureId, 'CAP-WH-777');

    // Alice's purchase history is updated even though her browser session had expired
    const alicePurchasesAfterCapture = engine.getUserPurchases('usr_alice');
    assert.equal(alicePurchasesAfterCapture.length, 1);
    assert.equal(alicePurchasesAfterCapture[0].status, 'completed');
    assert.equal(alicePurchasesAfterCapture[0].captureId, 'CAP-WH-777');
    assert.equal(engine.getUserPurchases('usr_attacker').length, 0);

    // Duplicate webhook event with same event.id is deduplicated idempotently
    const dupRes = await engine.verifyAndProcessWebhook(validHeaders, webhookCapturePayload);
    assert.equal(dupRes.ok, true);
    assert.equal(dupRes.verified, true);
    assert.equal(dupRes.duplicate, true);
    assert.equal(engine.getUserPurchases('usr_alice').length, 1);

    // Refund webhook transitions Alice's order and purchase record to REFUNDED / refunded
    const webhookRefundPayload = {
      id: 'WH-EVENT-9002-REFUND',
      event_type: 'PAYMENT.CAPTURE.REFUNDED',
      resource: {
        id: 'CAP-WH-777',
        status: 'REFUNDED',
        supplementary_data: {
          related_ids: {
            order_id: 'ORD_WEBHOOK_01',
          },
        },
      },
    };
    const refundRes = await engine.verifyAndProcessWebhook(validHeaders, webhookRefundPayload);
    assert.equal(refundRes.ok, true);
    assert.equal(refundRes.transaction?.status, 'REFUNDED');
    const alicePurchasesAfterRefund = engine.getUserPurchases('usr_alice');
    assert.equal(alicePurchasesAfterRefund[0].status, 'refunded');
    assert.equal(alicePurchasesAfterRefund[0].captureStatus, 'REFUNDED');

    // Invalid webhook signature is rejected with 400 invalid_webhook_signature
    signatureShouldSucceed = false;
    const invalidSigRes = await engine.verifyAndProcessWebhook(validHeaders, {
      id: 'WH-EVENT-FORGED-999',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: 'CAP-FAKE' },
    });
    assert.equal(invalidSigRes.ok, false);
    assert.equal(invalidSigRes.statusCode, 400);
    assert.equal(invalidSigRes.verified, false);
    assert.equal(invalidSigRes.errorCode, 'invalid_webhook_signature');
  });

  // Security Scenario 10: Correct purchase history isolation per authenticated user
  it('Auth Scenario 10: Isolates transactions and purchase history strictly per authenticated Spark userId', async () => {
    let orderCounter = 0;
    const mockFetch: FetchLike = async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/oauth2/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'TOKEN_OK', expires_in: 3600 }),
        };
      }
      if (url.endsWith('/v2/checkout/orders')) {
        orderCounter += 1;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: `ORD_USER_ISO_${orderCounter}`,
            status: 'CREATED',
            links: [],
          }),
        };
      }
      if (url.includes('/capture')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: `ORD_USER_ISO_${orderCounter}`,
            status: 'COMPLETED',
            purchase_units: [
              {
                payments: {
                  captures: [
                    {
                      id: `CAP_ISO_${orderCounter}`,
                      status: 'COMPLETED',
                    },
                  ],
                },
              },
            ],
          }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const engine = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
      fetchFn: mockFetch,
    });

    // Alice creates and captures an order
    await engine.createOrder({
      userId: 'usr_alice',
      userEmail: 'alice@spark.app',
      itemId: 'spark_sandbox_pro_pass',
      quantity: 1,
    });
    engine.markOrderApproved('ORD_USER_ISO_1', { userId: 'usr_alice' }, 'buyer');
    await engine.captureOrder('ORD_USER_ISO_1', { userId: 'usr_alice' });

    // Bob creates and captures a different order
    await engine.createOrder({
      userId: 'usr_bob',
      userEmail: 'bob@spark.app',
      itemId: 'spark_sandbox_hardware_kit',
      quantity: 1,
    });
    engine.markOrderApproved('ORD_USER_ISO_2', { userId: 'usr_bob' }, 'buyer');
    await engine.captureOrder('ORD_USER_ISO_2', { userId: 'usr_bob' });

    const aliceTxs = engine.getTransactions({ userId: 'usr_alice' });
    const bobTxs = engine.getTransactions({ userId: 'usr_bob' });
    assert.equal(aliceTxs.length, 1);
    assert.equal(aliceTxs[0].paypalOrderId, 'ORD_USER_ISO_1');
    assert.equal(bobTxs.length, 1);
    assert.equal(bobTxs[0].paypalOrderId, 'ORD_USER_ISO_2');

    const alicePurchases = engine.getUserPurchases('usr_alice');
    const bobPurchases = engine.getUserPurchases('usr_bob');
    assert.equal(alicePurchases.length, 1);
    assert.equal(alicePurchases[0].userId, 'usr_alice');
    assert.equal(alicePurchases[0].paypalOrderId, 'ORD_USER_ISO_1');
    assert.equal(bobPurchases.length, 1);
    assert.equal(bobPurchases[0].userId, 'usr_bob');
    assert.equal(bobPurchases[0].paypalOrderId, 'ORD_USER_ISO_2');
  });

  // Security Scenario 11: Session expiration, CSRF protection on cookie sessions, identity spoofing rejection, and Firebase JWT claim verification
  it('Auth Scenario 11: Enforces session expiration, CSRF validation on cookie sessions, anti-spoofing, and Firebase JWT verification', () => {
    let nowMs = 1_700_000_000_000;
    const sessionManager = new SparkAuthSessionManager({ nowFn: () => nowMs });
    const alice = createTestUser('usr_alice', 'alice@spark.app', 'Alice');

    const session = sessionManager.issueSession({
      userId: alice.id,
      email: alice.email,
      displayName: alice.preferences.displayName,
      authProvider: 'spark_credentials',
    });

    // 11a: Cookie-authenticated POST without x-csrf-token is rejected with 403 csrf_validation_failed
    const missingCsrf = sessionManager.verifyRequest({
      method: 'POST',
      headers: {
        cookie: `spark_session=${encodeURIComponent(session.sessionId)}`,
      },
    });
    assert.equal(missingCsrf.authenticated, false);
    assert.equal(missingCsrf.statusCode, 403);
    assert.equal(missingCsrf.errorCode, 'csrf_validation_failed');

    // 11b: Cookie-authenticated POST with valid x-csrf-token succeeds
    const validCsrf = sessionManager.verifyRequest({
      method: 'POST',
      headers: {
        cookie: `spark_session=${encodeURIComponent(session.sessionId)}`,
        'x-csrf-token': session.csrfToken,
      },
    });
    assert.equal(validCsrf.authenticated, true);
    assert.equal(validCsrf.session?.userId, 'usr_alice');

    // 11c: Authenticated user attempting to supply a mismatched userId in body/header is rejected with 403 identity_spoofing_rejected
    const spoofedBodyUser = sessionManager.verifyRequest({
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.sessionId}`,
      },
      bodyUserId: 'usr_victim',
    });
    assert.equal(spoofedBodyUser.authenticated, false);
    assert.equal(spoofedBodyUser.statusCode, 403);
    assert.equal(spoofedBodyUser.errorCode, 'identity_spoofing_rejected');

    // 11d: Advance clock past 12-hour TTL -> session expires with 401 session_expired
    nowMs += 13 * 60 * 60 * 1000;
    const expiredRes = sessionManager.verifyRequest({
      method: 'GET',
      headers: {
        authorization: `Bearer ${session.sessionId}`,
      },
    });
    assert.equal(expiredRes.authenticated, false);
    assert.equal(expiredRes.statusCode, 401);
    assert.equal(expiredRes.errorCode, 'session_expired');

    // 11e: Firebase ID token claim verification
    const nowSec = Math.floor(Date.now() / 1000);
    const validPayload = Buffer.from(
      JSON.stringify({
        iss: 'https://securetoken.google.com/gen-lang-client-0191581109',
        aud: 'gen-lang-client-0191581109',
        sub: 'firebase_uid_alice_01',
        email: 'alice@gmail.com',
        name: 'Alice G',
        exp: nowSec + 3600,
      })
    ).toString('base64url');
    const mockJwt = `eyJhbGciOiJSUzI1NiJ9.${validPayload}.sig`;
    const jwtRes = verifyFirebaseJwtClaims(mockJwt, 'gen-lang-client-0191581109');
    assert.equal(jwtRes.valid, true);
    assert.equal(jwtRes.claims?.uid, 'firebase_uid_alice_01');
    assert.equal(jwtRes.claims?.email, 'alice@gmail.com');

    // Wrong project audience is rejected
    const wrongAudRes = verifyFirebaseJwtClaims(mockJwt, 'wrong-project-id');
    assert.equal(wrongAudRes.valid, false);
  });

  // Core Sandbox Scenario 13 & 14: Developer access check, state transitions & secret redaction
  it('Core 13 & 14: Enforces strict purchase-state transitions, developer access check, and redacts secrets', () => {
    const unauthCheck = verifyDeveloperAccess(null);
    assert.equal(unauthCheck.authorized, false);
    assert.equal(unauthCheck.statusCode, 401);

    const validUser = createTestUser('usr_123', 'alex@spark.app', 'Alex');
    const authCheck = verifyDeveloperAccess(validUser);
    assert.equal(authCheck.authorized, true);
    assert.equal(authCheck.statusCode, 200);

    assert.equal(canTransitionTransactionState('CREATED', 'APPROVED'), true);
    assert.equal(canTransitionTransactionState('APPROVED', 'COMPLETED'), true);
    assert.equal(canTransitionTransactionState('CREATED', 'CANCELLED'), true);
    assert.equal(canTransitionTransactionState('APPROVED', 'CANCELLED'), true);
    assert.equal(canTransitionTransactionState('COMPLETED', 'REFUNDED'), true);
    assert.equal(canTransitionTransactionState('FAILED', 'APPROVED'), true);

    assert.equal(canTransitionTransactionState('COMPLETED', 'CANCELLED'), false);
    assert.equal(canTransitionTransactionState('CANCELLED', 'COMPLETED'), false);
    assert.equal(canTransitionTransactionState('CANCELLED', 'APPROVED'), false);
    assert.equal(canTransitionTransactionState('REFUNDED', 'COMPLETED'), false);

    const rawLog =
      'Header Authorization: Bearer A21AA_SECRET_TOKEN_999 with secret ECYYrr_sandbox_client_secret_value_test987 and code=C21AA_AUTH_CODE_SECRET_555 and refresh_token=R21AA_REFRESH_SECRET_777';
    const redacted = redactPayPalSecrets(rawLog, createMockEnv());
    assert.equal(redacted.includes('A21AA_SECRET_TOKEN_999'), false);
    assert.equal(redacted.includes('ECYYrr_sandbox_client_secret_value_test987'), false);
    assert.equal(redacted.includes('C21AA_AUTH_CODE_SECRET_555'), false);
    assert.equal(redacted.includes('R21AA_REFRESH_SECRET_777'), false);
    assert.equal(redacted.includes('[REDACTED_TOKEN]'), true);
    assert.equal(redacted.includes('[REDACTED_PAYPAL_SECRET]'), true);
    assert.equal(redacted.includes('code=[REDACTED_AUTH_CODE]'), true);
  });

  // ============================================================================
  // PAYPAL ACCOUNT LINKING (LOG IN WITH PAYPAL / IDENTITY API OAuth 2.0 / OIDC)
  // ============================================================================

  // Linking Scenario 1 & 11: Authenticated user successfully connects a PayPal Sandbox account; zero OAuth token retention
  it('Account Linking 1 & 11: Authenticated user connects a PayPal Sandbox account via authorization_code + userinfo, masking email and discarding tokens', async () => {
    let tokenBodyCaptured = '';
    const mockFetch: FetchLike = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/v1/oauth2/token')) {
        tokenBodyCaptured = String(init?.body || '');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'USER_ACCESS_TOKEN_LIVE_9911',
            refresh_token: 'USER_REFRESH_TOKEN_LIVE_9911',
            token_type: 'Bearer',
            expires_in: 28800,
            scope: 'openid email https://uri.paypal.com/services/paypalattributes',
          }),
        };
      }
      if (url.includes('/v1/identity/oauth2/userinfo')) {
        const headers = (init?.headers || {}) as Record<string, string>;
        assert.equal(headers.Authorization, 'Bearer USER_ACCESS_TOKEN_LIVE_9911');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            user_id: 'https://www.paypal.com/webapps/auth/identity/user/PP_SUB_ALICE_001',
            payer_id: 'PAYER_ALICE_99',
            verified_account: 'true',
            emails: [
              {
                value: 'alice.buyer@personal.example.com',
                primary: true,
                confirmed: true,
              },
            ],
          }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const engine = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
      fetchFn: mockFetch,
    });

    const initiated = engine.initiateAccountLinking({
      userId: 'usr_alice',
      sessionId: 'sess_alice_01',
    });
    assert.equal(initiated.ok, true);
    assert.equal(initiated.statusCode, 200);
    assert.equal(Boolean(initiated.state), true);
    assert.equal(Boolean(initiated.nonce), true);
    assert.equal(initiated.authorizationUrl?.startsWith(PAYPAL_SANDBOX_AUTH_URL), true);
    assert.equal(initiated.authorizationUrl?.includes('response_type=code'), true);
    assert.equal(initiated.authorizationUrl?.includes(`state=${initiated.state}`), true);

    const callbackRes = await engine.completeAccountLinkingCallback({
      code: 'AUTH_CODE_ALICE_VALID_001',
      state: initiated.state,
      authenticatedUserId: 'usr_alice',
      sessionId: 'sess_alice_01',
    });

    assert.equal(callbackRes.ok, true);
    assert.equal(callbackRes.statusCode, 200);
    assert.equal(tokenBodyCaptured.includes('grant_type=authorization_code'), true);
    assert.equal(tokenBodyCaptured.includes('code=AUTH_CODE_ALICE_VALID_001'), true);
    assert.equal(callbackRes.connection?.userId, 'usr_alice');
    assert.equal(
      callbackRes.connection?.paypalSubjectId,
      'https://www.paypal.com/webapps/auth/identity/user/PP_SUB_ALICE_001'
    );
    assert.equal(callbackRes.connection?.payerId, 'PAYER_ALICE_99');
    assert.equal(callbackRes.connection?.email, 'alice.buyer@personal.example.com');
    assert.equal(callbackRes.connection?.maskedEmail, 'al••••er@personal.example.com');
    assert.equal(callbackRes.connection?.emailVerified, true);
    assert.equal(callbackRes.connection?.verifiedAccount, true);
    assert.equal(callbackRes.connection?.status, 'connected');

    // Scenario 11: Verify zero OAuth token retention on persisted connection object and logs
    const rawConnJson = JSON.stringify(callbackRes.connection);
    assert.equal(rawConnJson.includes('USER_ACCESS_TOKEN_LIVE_9911'), false);
    assert.equal(rawConnJson.includes('USER_REFRESH_TOKEN_LIVE_9911'), false);
    const logsJson = JSON.stringify(engine.getLogs());
    assert.equal(logsJson.includes('USER_ACCESS_TOKEN_LIVE_9911'), false);
    assert.equal(logsJson.includes('AUTH_CODE_ALICE_VALID_001'), false);

    assert.equal(maskPayPalEmail('alice.buyer@personal.example.com'), 'al••••er@personal.example.com');
    assert.equal(validatePayPalRedirectUri('http://localhost:3000/api/paypal/callback', {}).valid, true);
    assert.equal(validatePayPalRedirectUri('http://localhost:3000/api/integrations/paypal/callback', {}).valid, true);
    assert.equal(
      validatePayPalRedirectUri(
        'https://ais-pre-3g5zvurtf6ldxz5u3eoxma-50712932913.europe-west1.run.app/api/paypal/callback',
        {
          PAYPAL_REDIRECT_URI:
            'https://ais-pre-3g5zvurtf6ldxz5u3eoxma-50712932913.europe-west1.run.app/api/paypal/callback',
        }
      ).valid,
      true
    );
    assert.equal(
      validatePayPalRedirectUri('https://spark.customdomain.com/api/paypal/callback', {
        APP_URL: 'https://spark.customdomain.com',
      }).valid,
      true
    );
    assert.equal(validatePayPalRedirectUri('http://evil.example.com/callback', {}).valid, false);
  });

  // Linking Scenario 2 & 3: Unauthenticated initiation is rejected; invalid or expired OAuth state is rejected
  it('Account Linking 2 & 3: Rejects unauthenticated initiation and rejects missing, invalid, or expired OAuth state', async () => {
    const engine = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
    });

    // Scenario 2: Unauthenticated request cannot initiate connection
    const unauthInit = engine.initiateAccountLinking({
      userId: '',
      sessionId: '',
    });
    assert.equal(unauthInit.ok, false);
    assert.equal(unauthInit.statusCode, 401);
    assert.equal(unauthInit.errorCode, 'unauthenticated');

    // Scenario 3a: Missing state in callback
    const missingState = await engine.completeAccountLinkingCallback({
      code: 'SOME_CODE',
      state: null,
    });
    assert.equal(missingState.ok, false);
    assert.equal(missingState.statusCode, 400);
    assert.equal(missingState.errorCode, 'invalid_oauth_state');

    // Scenario 3b: Forged/unknown state in callback
    const forgedState = await engine.completeAccountLinkingCallback({
      code: 'SOME_CODE',
      state: 'st_forged_unpredictable_token_999',
    });
    assert.equal(forgedState.ok, false);
    assert.equal(forgedState.statusCode, 400);
    assert.equal(forgedState.errorCode, 'invalid_oauth_state');

    // Scenario 3c: Expired OAuth state
    const validInit = engine.initiateAccountLinking({
      userId: 'usr_alice',
      sessionId: 'sess_alice_02',
    });
    assert.equal(validInit.ok, true);
    engine.expireOAuthStateForTesting(validInit.state!);

    const expiredCallback = await engine.completeAccountLinkingCallback({
      code: 'CODE_FOR_EXPIRED_STATE',
      state: validInit.state,
    });
    assert.equal(expiredCallback.ok, false);
    assert.equal(expiredCallback.statusCode, 400);
    assert.equal(expiredCallback.errorCode, 'expired_oauth_state');
  });

  // Linking Scenario 4 & 5: User cancels authorization or callback receives invalid authorization response / OIDC nonce mismatch
  it('Account Linking 4 & 5: Handles user cancellation (access_denied) and rejects missing code or invalid OIDC id_token nonce', async () => {
    const mockFetch: FetchLike = async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/oauth2/token')) {
        const badIdTokenPayload = Buffer.from(
          JSON.stringify({
            iss: 'https://www.sandbox.paypal.com',
            aud: 'AeA1QIZXiflr1_-r0U2_sandbox_client_id_test123',
            sub: 'PP_SUB_BAD_NONCE',
            nonce: 'wrong_nonce_value',
            exp: Math.floor(Date.now() / 1000) + 3600,
          })
        ).toString('base64url');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'ACCESS_TOK_1',
            id_token: `eyJhbGciOiJSUzI1NiJ9.${badIdTokenPayload}.sig`,
          }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const engine = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
      fetchFn: mockFetch,
    });

    // Scenario 4: User cancels authorization on PayPal consent screen
    const initCancel = engine.initiateAccountLinking({
      userId: 'usr_alice',
      sessionId: 'sess_alice_cancel',
    });
    const cancelledRes = await engine.completeAccountLinkingCallback({
      state: initCancel.state,
      error: 'access_denied',
      errorDescription: 'User cancelled the login flow.',
    });
    assert.equal(cancelledRes.ok, false);
    assert.equal(cancelledRes.statusCode, 400);
    assert.equal(cancelledRes.errorCode, 'authorization_cancelled');
    assert.equal(engine.getAccountConnectionForUser('usr_alice').connection, null);

    // Scenario 5a: Missing authorization code
    const initNoCode = engine.initiateAccountLinking({
      userId: 'usr_alice',
      sessionId: 'sess_alice_nocode',
    });
    const noCodeRes = await engine.completeAccountLinkingCallback({
      state: initNoCode.state,
      code: '',
    });
    assert.equal(noCodeRes.ok, false);
    assert.equal(noCodeRes.statusCode, 400);
    assert.equal(noCodeRes.errorCode, 'missing_authorization_code');

    // Scenario 5b: OIDC id_token nonce mismatch
    const initBadNonce = engine.initiateAccountLinking({
      userId: 'usr_alice',
      sessionId: 'sess_alice_badnonce',
    });
    const badNonceRes = await engine.completeAccountLinkingCallback({
      state: initBadNonce.state,
      code: 'CODE_BAD_NONCE_01',
    });
    assert.equal(badNonceRes.ok, false);
    assert.equal(badNonceRes.statusCode, 400);
    assert.equal(badNonceRes.errorCode, 'invalid_id_token');
    assert.equal(engine.getAccountConnectionForUser('usr_alice').connection, null);
  });

  // Linking Scenario 6, 7, 8 & 9: Subject uniqueness (1:1), cross-user ownership protection, replay protection, and confirmed disconnect
  it('Account Linking 6, 7, 8 & 9: Blocks duplicate PayPal subject across users, blocks cross-user view/disconnect, blocks state/code replay, and requires confirmation to disconnect', async () => {
    const mockFetch: FetchLike = async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/oauth2/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'SHARED_PP_ACCESS_TOKEN',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
        };
      }
      if (url.includes('/v1/identity/oauth2/userinfo')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            user_id: 'PP_SUBJECT_UNIQUE_777',
            payer_id: 'PAYER_UNIQUE_777',
            email: 'shared.paypal@personal.example.com',
            email_verified: true,
          }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const engine = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
      fetchFn: mockFetch,
    });

    // Alice connects PayPal account PP_SUBJECT_UNIQUE_777
    const aliceInit = engine.initiateAccountLinking({
      userId: 'usr_alice',
      sessionId: 'sess_alice',
    });
    const aliceLinked = await engine.completeAccountLinkingCallback({
      code: 'CODE_ALICE_UNIQUE_1',
      state: aliceInit.state,
    });
    assert.equal(aliceLinked.ok, true);

    // Scenario 8a: Replaying the same OAuth state is rejected immediately
    const stateReplay = await engine.completeAccountLinkingCallback({
      code: 'CODE_ALICE_UNIQUE_2',
      state: aliceInit.state,
    });
    assert.equal(stateReplay.ok, false);
    assert.equal(stateReplay.statusCode, 400);
    assert.equal(stateReplay.errorCode, 'oauth_state_replayed');

    // Scenario 8b: Reusing the same authorization code with a fresh state is rejected
    const bobInit1 = engine.initiateAccountLinking({
      userId: 'usr_bob',
      sessionId: 'sess_bob',
    });
    const codeReplay = await engine.completeAccountLinkingCallback({
      code: 'CODE_ALICE_UNIQUE_1',
      state: bobInit1.state,
    });
    assert.equal(codeReplay.ok, false);
    assert.equal(codeReplay.statusCode, 409);
    assert.equal(codeReplay.errorCode, 'authorization_code_reused');

    // Scenario 6: Bob attempts to link the exact same PayPal account (PP_SUBJECT_UNIQUE_777) -> blocked with 409 paypal_account_already_linked
    const bobInit2 = engine.initiateAccountLinking({
      userId: 'usr_bob',
      sessionId: 'sess_bob',
    });
    const bobDuplicateLink = await engine.completeAccountLinkingCallback({
      code: 'CODE_BOB_ATTEMPT_SAME_PP',
      state: bobInit2.state,
    });
    assert.equal(bobDuplicateLink.ok, false);
    assert.equal(bobDuplicateLink.statusCode, 409);
    assert.equal(bobDuplicateLink.errorCode, 'paypal_account_already_linked');
    assert.equal(engine.getAccountConnectionForUser('usr_bob').connection, null);

    // Scenario 7a: Bob attempts to view Alice's PayPal connection -> 403 forbidden_connection_ownership
    const bobSpy = engine.getAccountConnectionForUser('usr_bob', 'usr_alice');
    assert.equal(bobSpy.ok, false);
    assert.equal(bobSpy.statusCode, 403);
    assert.equal(bobSpy.errorCode, 'forbidden_connection_ownership');

    // Scenario 7b: Bob attempts to disconnect Alice's PayPal connection -> 403 forbidden_connection_ownership
    const bobDisconnectAlice = engine.disconnectAccountForUser({
      authenticatedUserId: 'usr_bob',
      targetUserId: 'usr_alice',
      confirmed: true,
    });
    assert.equal(bobDisconnectAlice.ok, false);
    assert.equal(bobDisconnectAlice.statusCode, 403);
    assert.equal(bobDisconnectAlice.errorCode, 'forbidden_connection_ownership');

    // Scenario 9a: Alice attempts to disconnect without confirmation -> 400 confirmation_required
    const unconfirmedDisconnect = engine.disconnectAccountForUser({
      authenticatedUserId: 'usr_alice',
      confirmed: false,
    });
    assert.equal(unconfirmedDisconnect.ok, false);
    assert.equal(unconfirmedDisconnect.statusCode, 400);
    assert.equal(unconfirmedDisconnect.errorCode, 'confirmation_required');
    assert.equal(engine.getAccountConnectionForUser('usr_alice').status, 'connected');

    // Scenario 9b: Alice confirms disconnect -> succeeds and releases unique subject lock
    const confirmedDisconnect = engine.disconnectAccountForUser({
      authenticatedUserId: 'usr_alice',
      confirmed: true,
    });
    assert.equal(confirmedDisconnect.ok, true);
    assert.equal(confirmedDisconnect.statusCode, 200);
    assert.equal(engine.getAccountConnectionForUser('usr_alice').status, 'not_connected');
    assert.equal(engine.getAccountConnectionForUser('usr_alice').connection, null);

    // Now that Alice disconnected, Bob can link that PayPal subject cleanly
    const bobInit3 = engine.initiateAccountLinking({
      userId: 'usr_bob',
      sessionId: 'sess_bob',
    });
    const bobNowSucceeds = await engine.completeAccountLinkingCallback({
      code: 'CODE_BOB_FRESH_PP',
      state: bobInit3.state,
    });
    assert.equal(bobNowSucceeds.ok, true);
    assert.equal(bobNowSucceeds.connection?.userId, 'usr_bob');
  });

  // Linking Scenario 10: PayPal API failures (token exchange or userinfo 500) do not leave connection marked as active
  it('Account Linking 10: PayPal token exchange or userinfo API failures never leave a connection marked as active', async () => {
    let failStep: 'token' | 'userinfo' = 'token';
    const mockFetch: FetchLike = async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/oauth2/token')) {
        if (failStep === 'token') {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              error: 'invalid_grant',
              error_description: 'Authorization code is invalid or expired.',
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'TOK_OK', expires_in: 3600 }),
        };
      }
      if (url.includes('/v1/identity/oauth2/userinfo')) {
        return {
          ok: false,
          status: 503,
          json: async () => ({ message: 'Identity service temporarily unavailable' }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const engine = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
      fetchFn: mockFetch,
    });

    // 10a: Token exchange fails
    const init1 = engine.initiateAccountLinking({
      userId: 'usr_alice',
      sessionId: 'sess_alice',
    });
    const tokenFailRes = await engine.completeAccountLinkingCallback({
      code: 'BAD_GRANT_CODE_01',
      state: init1.state,
    });
    assert.equal(tokenFailRes.ok, false);
    assert.equal(tokenFailRes.errorCode, 'token_exchange_failed');
    assert.equal(engine.getAccountConnectionForUser('usr_alice').connection, null);
    assert.equal(engine.getAccountConnectionForUser('usr_alice').status, 'error');

    // 10b: Userinfo API fails
    failStep = 'userinfo';
    const init2 = engine.initiateAccountLinking({
      userId: 'usr_alice',
      sessionId: 'sess_alice',
    });
    const userinfoFailRes = await engine.completeAccountLinkingCallback({
      code: 'VALID_CODE_USERINFO_503',
      state: init2.state,
    });
    assert.equal(userinfoFailRes.ok, false);
    assert.equal(userinfoFailRes.statusCode, 502);
    assert.equal(userinfoFailRes.errorCode, 'identity_verification_failed');
    assert.equal(engine.getAccountConnectionForUser('usr_alice').connection, null);
    assert.equal(engine.getAccountConnectionForUser('usr_alice').status, 'error');
  });

  // Linking Scenario 12: Production LIVE mode (PAYPAL_ENV=live), zero silent fallback to Sandbox, paypal_connections table, AES-256-GCM encryption, Reconnect/Lifecycle & PayPal Vault
  it('Account Linking 12: Supports PAYPAL_ENV=live official endpoints, blocks silent fallback when live credentials missing, populates paypal_connections with AES-256-GCM encryption, and supports Vault + expired/revoked lifecycle', async () => {
    // 12a: Missing LIVE credentials when PAYPAL_ENV=live never silently falls back to Sandbox
    const missingLiveEnv: PayPalEnvVariables = {
      PAYPAL_ENV: 'live',
      PAYPAL_CLIENT_ID: '',
      PAYPAL_CLIENT_SECRET: '',
      APP_URL: 'https://ais-pre-3g5zvurtf6ldxz5u3eoxma-50712932913.europe-west1.run.app',
    };
    const liveConfigMissing = resolvePayPalEnvironmentConfig(missingLiveEnv);
    assert.equal(liveConfigMissing.environment, 'live');
    assert.equal(liveConfigMissing.isLive, true);
    assert.equal(liveConfigMissing.allCoreCredentialsPresent, false);
    assert.equal(liveConfigMissing.errorCode, 'missing_credentials');
    assert.equal(liveConfigMissing.authUrl, PAYPAL_LIVE_AUTH_URL);

    const engineMissingLive = new PayPalSandboxEngine({
      envGetter: () => missingLiveEnv,
    });
    const failedLiveInit = engineMissingLive.initiateAccountLinking({
      userId: 'usr_live_user',
      sessionId: 'sess_live_01',
    });
    assert.equal(failedLiveInit.ok, false);
    assert.equal(failedLiveInit.statusCode, 503);
    assert.equal(failedLiveInit.errorCode, 'missing_credentials');

    // 12b: Configured PAYPAL_ENV=live uses official production PayPal endpoints and populates paypal_connections table
    const liveEnv: PayPalEnvVariables = {
      PAYPAL_ENV: 'live',
      PAYPAL_CLIENT_ID: 'AYSq3RDGsmBLJE-otTkBtM-jBRd1TCQwFf9RGfwddNXWz0uFU9ztymylOhRS',
      PAYPAL_CLIENT_SECRET: 'EGnHDxD_qRPdaLdZz8iCr8N7_MzF-YHPTkjs6NKYQvQSBngp4PTTVWkPZRbL',
      PAYPAL_OIDC_REDIRECT_URI:
        'https://ais-pre-3g5zvurtf6ldxz5u3eoxma-50712932913.europe-west1.run.app/api/integrations/paypal/callback',
      PAYPAL_TOKEN_ENCRYPTION_KEY: 'spark-production-test-encryption-secret-key-256',
    };

    const calledUrls: string[] = [];
    const mockLiveFetch: FetchLike = async (input) => {
      const url = String(input);
      calledUrls.push(url);
      if (url === `${PAYPAL_LIVE_BASE_URL}/v1/oauth2/token`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'LIVE_ACCESS_TOKEN_SECRET_001',
            refresh_token: 'LIVE_REFRESH_TOKEN_SECRET_001',
            token_type: 'Bearer',
            expires_in: 28800,
            scope: DEFAULT_PAYPAL_IDENTITY_SCOPES.join(' '),
          }),
        };
      }
      if (url === PAYPAL_LIVE_USERINFO_URL) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            user_id: 'https://www.paypal.com/webapps/auth/identity/user/LIVE_PAYER_9001',
            payer_id: 'LIVE_PAYER_9001',
            name: 'Jordan Taylor',
            email: 'jordan.taylor@paypal-live.example.com',
            email_verified: true,
            verified_account: 'true',
            address: {
              street_address: '2211 N First St',
              locality: 'San Jose',
              region: 'CA',
              postal_code: '95131',
              country: 'US',
            },
          }),
        };
      }
      if (url === PAYPAL_LIVE_TERMINATE_URL) {
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
        };
      }
      throw new Error(`Unexpected LIVE URL: ${url}`);
    };

    const liveEngine = new PayPalSandboxEngine({
      envGetter: () => liveEnv,
      fetchFn: mockLiveFetch,
    });

    const liveInit = liveEngine.initiateAccountLinking({
      userId: 'usr_jordan',
      sessionId: 'sess_jordan_live',
    });
    assert.equal(liveInit.ok, true);
    assert.equal(liveInit.authorizationUrl?.startsWith(PAYPAL_LIVE_AUTH_URL), true);
    assert.equal(
      liveInit.authorizationUrl?.includes(
        encodeURIComponent(
          'https://ais-pre-3g5zvurtf6ldxz5u3eoxma-50712932913.europe-west1.run.app/api/integrations/paypal/callback'
        )
      ),
      true
    );
    for (const expectedScope of DEFAULT_PAYPAL_IDENTITY_SCOPES) {
      assert.equal(liveInit.scopes?.includes(expectedScope), true);
    }

    const liveCallback = await liveEngine.completeAccountLinkingCallback({
      code: 'LIVE_AUTH_CODE_JORDAN_001',
      state: liveInit.state,
      authenticatedUserId: 'usr_jordan',
      sessionId: 'sess_jordan_live',
    });
    assert.equal(liveCallback.ok, true);
    assert.equal(calledUrls.includes(`${PAYPAL_LIVE_BASE_URL}/v1/oauth2/token`), true);
    assert.equal(calledUrls.includes(PAYPAL_LIVE_USERINFO_URL), true);
    assert.equal(liveCallback.connection?.paypalName, 'Jordan Taylor');
    assert.equal(liveCallback.connection?.payerId, 'LIVE_PAYER_9001');
    assert.equal(liveCallback.connection?.environment, 'live');
    assert.equal(liveCallback.connection?.address?.locality, 'San Jose');

    // Verify paypal_connections table row (client-safe omits encrypted_refresh_token; server-internal retains AES-256-GCM encrypted_refresh_token)
    const sanitizedRow = liveEngine.getPayPalConnectionsTableRow('usr_jordan');
    assert.ok(sanitizedRow);
    assert.equal(sanitizedRow.spark_user_id, 'usr_jordan');
    assert.equal(sanitizedRow.paypal_payer_id, 'LIVE_PAYER_9001');
    assert.equal(sanitizedRow.paypal_email, 'jordan.taylor@paypal-live.example.com');
    assert.equal(sanitizedRow.paypal_name, 'Jordan Taylor');
    assert.equal(sanitizedRow.email_verified, true);
    assert.equal(sanitizedRow.connection_status, 'connected');
    assert.equal(sanitizedRow.encrypted_refresh_token, undefined);

    const internalRow = liveEngine.getPayPalConnectionsTableRow('usr_jordan', {
      includeEncryptedInternal: true,
    });
    assert.ok(internalRow?.encrypted_refresh_token);
    assert.equal(
      internalRow.encrypted_refresh_token.includes('LIVE_REFRESH_TOKEN_SECRET_001'),
      false
    );
    const decrypted = decryptPayPalToken(internalRow.encrypted_refresh_token, liveEnv);
    assert.equal(decrypted, 'LIVE_REFRESH_TOKEN_SECRET_001');

    // Verify direct helper round-trip
    const cipherSample = encryptPayPalToken('SAMPLE_SECRET_TOKEN', liveEnv);
    assert.equal(decryptPayPalToken(cipherSample, liveEnv), 'SAMPLE_SECRET_TOKEN');

    // 12c: Save PayPal Vault token for future purchases
    const vaultRes = liveEngine.saveVaultTokenForUser({
      authenticatedUserId: 'usr_jordan',
      vaultId: 'VAULT_LIVE_TOKEN_88',
      enabled: true,
    });
    assert.equal(vaultRes.ok, true);
    assert.equal(vaultRes.vaultId, 'VAULT_LIVE_TOKEN_88');
    assert.equal(liveEngine.getPayPalConnectionsTableRow('usr_jordan')?.vault_id, 'VAULT_LIVE_TOKEN_88');

    // 12d: Mark connection expired -> forceReconnect -> disconnect terminates token
    const expiredState = liveEngine.markConnectionExpiredOrRevoked({
      authenticatedUserId: 'usr_jordan',
      newStatus: 'expired',
    });
    assert.equal(expiredState.ok, true);
    assert.equal(expiredState.connection?.status, 'expired');
    assert.equal(
      liveEngine.getPayPalConnectionsTableRow('usr_jordan')?.connection_status,
      'expired'
    );

    const reconnectInit = liveEngine.initiateAccountLinking({
      userId: 'usr_jordan',
      sessionId: 'sess_jordan_live',
      forceReconnect: true,
    });
    assert.equal(reconnectInit.ok, true);

    const disconnectRes = liveEngine.disconnectAccountForUser({
      authenticatedUserId: 'usr_jordan',
      confirmed: true,
    });
    assert.equal(disconnectRes.ok, true);
    assert.equal(
      liveEngine.getPayPalConnectionsTableRow('usr_jordan')?.connection_status,
      'disconnected'
    );
    assert.equal(
      liveEngine.getPayPalConnectionsTableRow('usr_jordan', { includeEncryptedInternal: true })
        ?.encrypted_refresh_token,
      null
    );
  });

  // Linking Scenario 13: OpenID-only Sandbox apps returning HTTP 400 on /userinfo succeed via verified token exchange and persist across server restarts
  it('Account Linking 13: Succeeds when PayPal app has only openid scope and /userinfo returns HTTP 400, and preserves state across restarts', async () => {
    const mockFetch: FetchLike = async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/oauth2/token')) {
        const idTokenPayload = Buffer.from(
          JSON.stringify({
            iss: 'https://api.sandbox.paypal.com',
            aud: ['AeA1QIZXiflr1_-r0U2_sandbox_client_id_test123'],
            sub: 'https://www.paypal.com/webapps/auth/identity/user/PP_OPENID_ONLY_USER_01',
            nonce: '2026-10-30T19:01:06Z5Q6pv8kvYeY7_S2gXqgChckNDouogaeVKMLUL-9Qs-E',
            exp: Math.floor(Date.now() / 1000) + 3600,
          })
        ).toString('base64url');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'OPENID_ONLY_USER_ACCESS_TOKEN',
            id_token: `eyJhbGciOiJSUzI1NiJ9.${idTokenPayload}.sig`,
            token_type: 'Bearer',
            expires_in: 28800,
            scope: 'openid',
            app_id: 'APP-9NP86146MN611911K',
            nonce: '2026-10-30T19:01:06Z5Q6pv8kvYeY7_S2gXqgChckNDouogaeVKMLUL-9Qs-E',
          }),
        };
      }
      if (url.includes('/v1/identity/')) {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            name: 'INVALID_REQUEST',
            message: 'Request is not well-formed, syntactically incorrect, or violates schema.',
          }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const engine1 = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
      fetchFn: mockFetch,
    });

    const init = engine1.initiateAccountLinking({
      userId: 'usr_bobs',
      sessionId: 'sess_bobs_01',
      scopes: ['openid'],
    });
    assert.equal(init.ok, true);

    // Simulate server restart by exporting from engine1 and importing into engine2
    const snapshot = engine1.exportAccountLinkingState();
    const engine2 = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
      fetchFn: mockFetch,
    });
    engine2.importAccountLinkingState(snapshot);

    const cbRes = await engine2.completeAccountLinkingCallback({
      code: 'REAL_AUTH_CODE_OPENID_ONLY_01',
      state: init.state,
      authenticatedUserId: 'usr_bobs',
      authenticatedUserEmail: 'bobs197ysb017@gmail.com',
      authenticatedUserName: 'Bob S',
      sessionId: 'sess_bobs_01',
    });

    assert.equal(cbRes.ok, true);
    assert.equal(cbRes.statusCode, 200);
    assert.equal(cbRes.connection?.status, 'connected');
    assert.equal(
      cbRes.connection?.paypalSubjectId,
      'https://www.paypal.com/webapps/auth/identity/user/PP_OPENID_ONLY_USER_01'
    );
    assert.equal(cbRes.connection?.email, 'bobs197ysb017@gmail.com');
  });

  // Autonomous Purchasing Agent & 15 Required Scenarios Verification
  it('Autonomous Purchasing 14: Enforces lifecycle state machine (forbidding DRAFT -> COMPLETED) and executes all 15 Required PayPal Sandbox Scenarios with 15/15 passing', async () => {
    // 1. Verify lifecycle state machine rules
    assert.equal(canTransitionLifecycleState('DRAFT', 'AWAITING_USER_CONFIRMATION'), true);
    assert.equal(
      canTransitionLifecycleState('AWAITING_USER_CONFIRMATION', 'AWAITING_PAYPAL_APPROVAL'),
      true
    );
    assert.equal(canTransitionLifecycleState('AWAITING_PAYPAL_APPROVAL', 'APPROVED'), true);
    assert.equal(canTransitionLifecycleState('APPROVED', 'CAPTURE_PENDING'), true);
    assert.equal(canTransitionLifecycleState('CAPTURE_PENDING', 'COMPLETED'), true);
    // Forbidden direct jump DRAFT -> COMPLETED
    assert.equal(canTransitionLifecycleState('DRAFT', 'COMPLETED'), false);
    assert.equal(canTransitionLifecycleState('AWAITING_USER_CONFIRMATION', 'COMPLETED'), false);

    // 2. Run all 15 required integration test scenarios
    const engine = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
    });
    const suite = await engine.runFifteenRequiredSandboxScenarios('usr_autonomous_test');
    assert.equal(suite.totalScenarios, 15);
    assert.equal(suite.passedCount, 15);
    assert.equal(suite.failedCount, 0);
    assert.equal(suite.allPassed, true);

    for (const sc of suite.scenarios) {
      assert.equal(
        sc.passed,
        true,
        `Expected scenario #${sc.scenarioNumber} (${sc.title}) to pass, got: ${sc.actualOutcome}`
      );
    }

    // 3. Verify 4 database tables are populated and RLS-filtered for usr_autonomous_test
    const dbTables = engine.getSandboxDatabaseTables('usr_autonomous_test');
    assert.ok(dbTables.sandbox_payment_orders.length > 0);
    assert.ok(dbTables.sandbox_payment_captures.length > 0);
    assert.ok(dbTables.sandbox_payment_events.length > 0);
    assert.ok(dbTables.purchase_audit_logs.length > 0);
    assert.ok(
      dbTables.sandbox_payment_orders.every((r) => r.user_id === 'usr_autonomous_test')
    );
  });

  it('Account Linking 15: Completes PayPal Orders v2 Buyer Handshake (token + PayerID) when Return URL is dynamic and syncs buyer Sandbox wallet', async () => {
    const mockFetch: FetchLike = async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/oauth2/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'SANDBOX_APP_ACCESS_TOKEN_V2',
            token_type: 'Bearer',
            expires_in: 32400,
            app_id: 'APP-32Y30363W65213303',
          }),
        };
      }
      if (url.includes('/v2/checkout/orders/8GT7870142448842S')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: '8GT7870142448842S',
            intent: 'AUTHORIZE',
            status: 'APPROVED',
            payer: {
              name: {
                given_name: 'Bob',
                surname: 'Buyer',
              },
              email_address: 'sb-buyer-bobs@personal.example.com',
              payer_id: 'SANDBOX_PAYER_BOBS_99',
              address: {
                country_code: 'US',
              },
            },
          }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const engine = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
      fetchFn: mockFetch,
    });

    const init = engine.initiateAccountLinking({
      userId: 'usr_bobs_v2',
      sessionId: 'sess_bobs_v2',
      forceReconnect: true,
    });
    assert.equal(init.ok, true);

    const cbRes = await engine.completeAccountLinkingCallback({
      state: init.state,
      orderToken: '8GT7870142448842S',
      payerId: 'SANDBOX_PAYER_BOBS_99',
      authenticatedUserId: 'usr_bobs_v2',
      authenticatedUserEmail: 'bobs197ysb017@gmail.com',
      authenticatedUserName: 'Bob S',
      sessionId: 'sess_bobs_v2',
      forceReconnect: true,
    });

    assert.equal(cbRes.ok, true);
    assert.equal(cbRes.statusCode, 200);
    assert.equal(cbRes.connection?.status, 'connected');
    assert.equal(cbRes.connection?.payerId, 'SANDBOX_PAYER_BOBS_99');
    assert.equal(cbRes.connection?.email, 'sb-buyer-bobs@personal.example.com');
    assert.equal(cbRes.connection?.paypalName, 'Bob Buyer');

    const wallet = engine.getBuyerSandboxWallet('usr_bobs_v2');
    assert.equal(wallet.buyerEmail, 'sb-buyer-bobs@personal.example.com');
    assert.equal(wallet.buyerAccountId, 'SANDBOX_PAYER_BOBS_99');
  });

  it('Pre-Approval Flow: Registers live discovered product via registerVerifiedLiveOffer, prepares order, authorizes, creates PayPal Sandbox order, and emits structured diagnostic events', async () => {
    const mockFetch: FetchLike = async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/oauth2/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'SANDBOX_PREAPPROVAL_TOKEN_123',
            token_type: 'Bearer',
            expires_in: 32400,
          }),
        };
      }
      if (url.endsWith('/v2/checkout/orders')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: '9PREAPPROVAL778899',
            status: 'CREATED',
            links: [
              {
                href: 'https://www.sandbox.paypal.com/checkoutnow?token=9PREAPPROVAL778899',
                rel: 'approve',
                method: 'GET',
              },
            ],
          }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const engine = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
      fetchFn: mockFetch,
    });

    // Register a live discovered product offer (e.g. from Channel3)
    engine.registerVerifiedLiveOffer({
      id: 'ch3_497799835',
      sourceId: 'channel3_api',
      sourceName: 'Channel3 Product Graph API',
      canonicalUrl: 'https://trychannel3.com/products/497799835',
      retrievedAt: new Date().toISOString(),
      verificationStatus: 'verified_live_source',
      name: 'Studio Audio Workstation',
      merchant: 'Verified Retail Merchant',
      category: 'Music',
      price: 199.99,
      priceStatus: 'verified',
      currency: 'USD',
      shippingCost: 0,
      shippingStatus: 'not_applicable_digital',
      estimatedTaxRate: null,
      taxStatus: 'unknown',
      availabilityStatus: 'verified_in_stock',
      rating: 4.8,
      reviewCount: 2594,
      summary: 'Professional music production studio',
      specs: { Platform: 'macOS', Developer: 'Pro Audio Labs' },
      couponStatus: 'no_verified_coupon',
      checkoutStatus: 'checkout_unsupported',
      imageUrl: 'https://example.com/logic.jpg',
    });

    const correlationId = 'corr_preapproval_test_01';

    // Step 1 & 2: Prepare order for live product
    const prep = engine.prepareAutonomousPurchaseOrder({
      userId: 'usr_preapproval',
      userEmail: 'buyer@spark.app',
      itemId: 'ch3_497799835',
      quantity: 1,
      currency: 'USD',
      executionMode: 'SANDBOX_SIMULATION',
      correlationId,
    });
    assert.equal(prep.ok, true);
    assert.ok(prep.orderRow);
    assert.equal(prep.orderRow.product_id, 'ch3_497799835');
    assert.equal(prep.orderRow.amount, 199.99);
    assert.equal(prep.orderRow.status, 'AWAITING_USER_CONFIRMATION');

    // Step 3: Authorize order
    const auth = engine.authorizePurchaseOrder({
      userId: 'usr_preapproval',
      orderId: prep.orderRow.id,
      actor: 'user',
      explicitUserConfirmed: true,
      confirmedAmount: prep.orderRow.amount,
      confirmedCurrency: prep.orderRow.currency,
      confirmedProductId: prep.orderRow.product_id,
      confirmedMerchant: prep.orderRow.merchant_id,
    });
    assert.equal(auth.ok, true);
    assert.ok(auth.authorization?.authorizationHash);

    // Step 4: Execute order (Create PayPal Sandbox Order and generate approval URL)
    const exec = await engine.executeAuthorizedOrder({
      userId: 'usr_preapproval',
      userEmail: 'buyer@spark.app',
      orderId: prep.orderRow.id,
      authorizationHash: auth.authorization.authorizationHash,
      correlationId,
    });
    assert.equal(exec.ok, true);
    assert.equal(exec.statusCode, 201);
    assert.equal(exec.transaction?.paypalOrderId, '9PREAPPROVAL778899');
    assert.equal(
      exec.approvalUrl,
      'https://www.sandbox.paypal.com/checkoutnow?token=9PREAPPROVAL778899'
    );

    const events = engine
      .getLogs()
      .filter((d) => d.correlationId === correlationId)
      .map((d) => d.event);
    assert.ok(events.includes('PAYMENT_TOOL_STARTED'));
    assert.ok(events.includes('PAYPAL_OAUTH_STARTED'));
    assert.ok(events.includes('PAYPAL_OAUTH_SUCCEEDED'));
    assert.ok(events.includes('PAYPAL_CREATE_ORDER_STARTED'));
    assert.ok(events.includes('PAYPAL_CREATE_ORDER_SUCCEEDED'));
    assert.ok(events.includes('APPROVAL_URL_GENERATED'));
  });

  it('enforces all 10 account balance, decimal precision, ORDER_NOT_APPROVED guard, persistence, and multi-user isolation scenarios', async () => {
    let createdOrderCount = 0;
    const mockFetch: FetchLike = async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/oauth2/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'SANDBOX_ACCESS_TOKEN_BALANCE_TEST',
            refresh_token: 'SANDBOX_REFRESH_TOKEN_BALANCE_TEST',
            expires_in: 3600,
          }),
        };
      }
      if (url.includes('/v1/identity/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            user_id: 'https://www.paypal.com/webapps/auth/identity/user/SUB_LINKED_USER_01',
            sub: 'SUB_LINKED_USER_01',
            payer_id: 'PAYER_LINKED_01',
            name: 'Linked Sandbox Buyer',
            emails: [{ value: 'linked@spark.app', primary: true, confirmed: true }],
            verified_account: 'true',
          }),
        };
      }
      if (url.endsWith('/v2/checkout/orders')) {
        createdOrderCount += 1;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: `ORD_BAL_${createdOrderCount}`,
            status: 'CREATED',
            links: [
              {
                rel: 'approve',
                href: `https://www.sandbox.paypal.com/checkoutnow?token=ORD_BAL_${createdOrderCount}`,
              },
            ],
          }),
        };
      }
      if (url.includes('/v2/checkout/orders/') && url.endsWith('/capture')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'ORD_BAL_1',
            status: 'COMPLETED',
            payer: {
              email_address: 'owner@spark.app',
              payer_id: 'BUYER123456',
            },
            purchase_units: [
              {
                payments: {
                  captures: [
                    {
                      id: 'CAP_BAL_1',
                      status: 'COMPLETED',
                      amount: { currency_code: 'USD', value: '19.00' },
                    },
                  ],
                },
              },
            ],
          }),
        };
      }
      if (url.includes('/v2/checkout/orders/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'ORD_BAL_1',
            status: 'CREATED',
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    };

    const engine = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
      fetchFn: mockFetch,
    });

    // Scenario 1: New user with no connected account & no wallet initialized -> status 'not_connected', $0.00
    const newUserRes = engine.getAccountBalanceForUser({
      authenticatedUserId: 'usr_fresh_new',
      userEmail: 'fresh@spark.app',
      preferredCurrency: 'USD',
      autoInitializeSandboxWallet: false,
    });
    assert.equal(newUserRes.ok, true);
    assert.equal(newUserRes.statusCode, 200);
    assert.equal(newUserRes.balance?.status, 'not_connected');
    assert.equal(newUserRes.balance?.availableBalance, 0);
    assert.equal(newUserRes.balance?.formattedAvailableBalance, '$0.00');
    assert.equal(newUserRes.balance?.currency, 'USD');

    // Scenario 2: Authenticated user with existing balance -> status 'available', $500.00
    const existingUserRes = engine.getAccountBalanceForUser({
      authenticatedUserId: 'usr_balance_owner',
      userEmail: 'owner@spark.app',
      preferredCurrency: 'USD',
      autoInitializeSandboxWallet: true,
    });
    assert.equal(existingUserRes.ok, true);
    assert.equal(existingUserRes.balance?.status, 'available');
    assert.equal(existingUserRes.balance?.availableBalance, 500);
    assert.equal(existingUserRes.balance?.formattedAvailableBalance, '$500.00');
    assert.equal(existingUserRes.balance?.source, 'spark_sandbox_wallet');

    // Scenario 3: User with connected PayPal account -> source 'paypal_sandbox_linked'
    const stateInit = engine.initiateAccountLinking({
      userId: 'usr_paypal_linked',
      sessionId: 'sess_linked_test_01',
      redirectUri: 'http://localhost:3000/api/paypal/callback',
    });
    assert.equal(stateInit.ok, true);
    const stateToken = new URL(stateInit.authorizationUrl!).searchParams.get('state')!;
    const cbRes = await engine.completeAccountLinkingCallback({
      code: 'valid_auth_code',
      state: stateToken,
      authenticatedUserId: 'usr_paypal_linked',
      authenticatedUserEmail: 'linked@spark.app',
      sessionId: 'sess_linked_test_01',
    });
    assert.equal(cbRes.ok, true);

    const linkedBalRes = engine.getAccountBalanceForUser({
      authenticatedUserId: 'usr_paypal_linked',
      userEmail: 'linked@spark.app',
      preferredCurrency: 'USD',
    });
    assert.equal(linkedBalRes.ok, true);
    assert.equal(linkedBalRes.balance?.status, 'available');
    assert.equal(linkedBalRes.balance?.paypalConnectionStatus, 'connected');
    assert.equal(linkedBalRes.balance?.source, 'spark_sandbox_wallet');
    assert.equal(linkedBalRes.balance?.sourceLabel, 'PayPal Sandbox Buyer Wallet');
    assert.equal(linkedBalRes.balance?.availableBalance, 500);

    // Scenario 4: Unavailable balance state (simulated outage or live mode without personal balance API)
    const unavailableRes = engine.getAccountBalanceForUser({
      authenticatedUserId: 'usr_balance_owner',
      userEmail: 'owner@spark.app',
      simulateUnavailable: true,
    });
    assert.equal(unavailableRes.ok, true);
    assert.equal(unavailableRes.balance?.status, 'unavailable');
    assert.equal(unavailableRes.balance?.availableBalance, null);
    assert.equal(unavailableRes.balance?.formattedAvailableBalance, 'Unavailable');

    // Scenario 5 & 6: Pending order tracking, ORDER_NOT_APPROVED capture guard, and exact minor-unit deduction
    const createdOrder = await engine.createOrder({
      itemId: 'spark_sandbox_pro_pass',
      quantity: 1,
      userId: 'usr_balance_owner',
      userEmail: 'owner@spark.app',
    });
    assert.equal(createdOrder.ok, true);
    const sparkOrderId = createdOrder.transaction!.sparkOrderId;

    // While order is in CREATED state, available balance is unchanged ($500.00) and pendingAmount is $19.00
    const pendingBal = engine.getAccountBalanceForUser({
      authenticatedUserId: 'usr_balance_owner',
      userEmail: 'owner@spark.app',
    });
    assert.equal(pendingBal.balance?.availableBalance, 500);
    assert.equal(pendingBal.balance?.pendingAmount, 19);

    // Attempting to capture an unapproved order (CREATED) before buyer approval is blocked with 409 invalid_state_transition (and 422 ORDER_NOT_APPROVED when negative testing)
    const unapprovedCapture = await engine.captureOrder(sparkOrderId, {
      userId: 'usr_balance_owner',
    });
    assert.equal(unapprovedCapture.ok, false);
    assert.equal(unapprovedCapture.statusCode, 409);
    assert.equal(unapprovedCapture.errorCode, 'invalid_state_transition');

    const unapprovedMockCapture = await engine.captureOrder(sparkOrderId, {
      userId: 'usr_balance_owner',
      mockApplicationCode: 'ORDER_NOT_APPROVED',
    });
    assert.equal(unapprovedMockCapture.ok, false);
    assert.equal(unapprovedMockCapture.statusCode, 422);
    assert.equal(unapprovedMockCapture.errorCode, 'ORDER_NOT_APPROVED');
    assert.equal(
      engine.getAccountBalanceForUser({
        authenticatedUserId: 'usr_balance_owner',
      }).balance?.availableBalance,
      500
    );

    // Approve and capture the $19.00 order -> balance deducts to $481.00 and pendingAmount clears to $0.00
    engine.markOrderApproved(
      sparkOrderId,
      {
        email: 'owner@spark.app',
        payerId: 'BUYER123456',
        userId: 'usr_balance_owner',
      },
      'buyer'
    );
    const captured = await engine.captureOrder(sparkOrderId, {
      userId: 'usr_balance_owner',
    });
    assert.equal(captured.ok, true);
    const postCaptureBal = engine.getAccountBalanceForUser({
      authenticatedUserId: 'usr_balance_owner',
      userEmail: 'owner@spark.app',
    });
    assert.equal(postCaptureBal.balance?.availableBalance, 481);
    assert.equal(postCaptureBal.balance?.formattedAvailableBalance, '$481.00');
    assert.equal(postCaptureBal.balance?.pendingAmount, 0);

    // Verify integer minor-unit math prevents IEEE-754 floating point drift ($481.00 -> $461.01 -> $461.00)
    engine.configureBuyerSandboxBalance('usr_balance_owner', 481 - 19.99 - 0.01, 'owner@spark.app');
    const decBal = engine.getAccountBalanceForUser({
      authenticatedUserId: 'usr_balance_owner',
    });
    assert.equal(decBal.balance?.availableBalance, 461);
    assert.equal(decBal.balance?.formattedAvailableBalance, '$461.00');

    // Scenario 7: Persistence across restart (exportAccountLinkingState + importAccountLinkingState)
    const snapshot = engine.exportAccountLinkingState();
    const restoredEngine = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
      fetchFn: mockFetch,
    });
    restoredEngine.importAccountLinkingState(snapshot);
    const restoredBal = restoredEngine.getAccountBalanceForUser({
      authenticatedUserId: 'usr_balance_owner',
    });
    assert.equal(restoredBal.balance?.availableBalance, 461);

    // Scenario 8: Compact formatting for large balances (€12,500.00 -> €12.5K)
    engine.configureBuyerSandboxBalance('usr_balance_owner', 12500, 'owner@spark.app');
    const largeBal = engine.getAccountBalanceForUser({
      authenticatedUserId: 'usr_balance_owner',
      preferredCurrency: 'EUR',
    });
    assert.equal(largeBal.balance?.currency, 'EUR');
    assert.equal(largeBal.balance?.currencySymbol, '€');
    assert.equal(largeBal.balance?.compactAvailableBalance, '€12.5K');
    assert.equal(largeBal.balance?.formattedAvailableBalance, '€12,500.00');

    // Scenario 9 & 10: Unauthenticated and cross-user balance access blocked
    const unauthRes = engine.getAccountBalanceForUser({
      authenticatedUserId: '',
    });
    assert.equal(unauthRes.ok, false);
    assert.equal(unauthRes.statusCode, 401);

    const crossUserRes = engine.getAccountBalanceForUser({
      authenticatedUserId: 'usr_attacker_a',
      targetUserId: 'usr_balance_owner',
    });
    assert.equal(crossUserRes.ok, false);
    assert.equal(crossUserRes.statusCode, 403);
    assert.equal(crossUserRes.errorCode, 'forbidden_balance_ownership');
    assert.equal(crossUserRes.balance, undefined);

    // Scenario 11 (Phase 8): Strict PayPal Balance Visibility & Multi-Currency Reporting
    // 11a: User without a linked PayPal account MUST have visible: false and status: 'not_connected'
    const unlinkedUserRes = engine.getAccountBalanceForUser({
      authenticatedUserId: 'usr_never_linked_paypal',
      userEmail: 'unlinked@spark.app',
    });
    assert.equal(unlinkedUserRes.ok, true);
    assert.equal(unlinkedUserRes.balance?.visible, false);
    assert.equal(unlinkedUserRes.balance?.status, 'not_connected');
    assert.equal(unlinkedUserRes.balance?.availableBalance, 0);

    // 11b: Multi-currency balances via configureMultiCurrencyReportingBalances do not merge currencies
    engine.configureMultiCurrencyReportingBalances('usr_balance_owner', [
      { currency: 'USD', availableBalance: 461.0, withheldBalance: 15.0, primary: true },
      { currency: 'EUR', availableBalance: 220.5, withheldBalance: 0, primary: false },
    ]);
    const multiCurrBal = engine.getAccountBalanceForUser({
      authenticatedUserId: 'usr_balance_owner',
      userEmail: 'owner@spark.app',
    });
    assert.equal(multiCurrBal.ok, true);
    assert.equal(multiCurrBal.balance?.currencies?.length, 2);
    assert.equal(multiCurrBal.balance?.currencies?.[0].currency, 'USD');
    assert.equal(multiCurrBal.balance?.currencies?.[0].formattedAvailableBalance, '$461.00');
    assert.equal(multiCurrBal.balance?.currencies?.[0].withheldBalance, 15);
    assert.equal(multiCurrBal.balance?.currencies?.[1].currency, 'EUR');
    assert.equal(multiCurrBal.balance?.currencies?.[1].formattedAvailableBalance, '€220.50');

    // 11c: Disconnecting PayPal account immediately clears and hides the balance (visible: false)
    engine.disconnectAccountForUser({
      authenticatedUserId: 'usr_balance_owner',
      confirmed: true,
    });
    const afterDisconnectBal = engine.getAccountBalanceForUser({
      authenticatedUserId: 'usr_balance_owner',
      userEmail: 'owner@spark.app',
    });
    assert.equal(afterDisconnectBal.ok, true);
    assert.equal(afterDisconnectBal.balance?.visible, false);
    assert.equal(afterDisconnectBal.balance?.status, 'not_connected');
    assert.equal(afterDisconnectBal.balance?.availableBalance, 0);
  });

  it('Spark Buy End-to-End: Channel3 product selection, Cart quantity & price calculations, honest shipping/tax disclosure, PayPal Sandbox multi-item order creation & capture, internal Sandbox Order persistence, and merchant-independent status', async () => {
    let capturedOrderPayload: Record<string, unknown> | null = null;
    let captureCallCount = 0;

    const mockFetch: FetchLike = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/v1/oauth2/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'SANDBOX_SPARK_BUY_TOKEN',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
        };
      }
      if (url.endsWith('/v2/checkout/orders')) {
        capturedOrderPayload = JSON.parse(String(init?.body || '{}'));
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'ORD_SPARK_BUY_CART_01',
            status: 'CREATED',
            links: [
              {
                href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORD_SPARK_BUY_CART_01',
                rel: 'approve',
                method: 'GET',
              },
            ],
          }),
        };
      }
      if (url.endsWith('/v2/checkout/orders/ORD_SPARK_BUY_CART_01/capture')) {
        captureCallCount += 1;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'ORD_SPARK_BUY_CART_01',
            status: 'COMPLETED',
            payer: {
              email_address: 'buyer-sandbox@spark.app',
              payer_id: 'PAYER_SPARK_BUY_99',
            },
            purchase_units: [
              {
                payments: {
                  captures: [
                    {
                      id: 'CAP_SPARK_BUY_CART_01',
                      status: 'COMPLETED',
                      amount: {
                        currency_code: 'USD',
                        value: '139.97',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const engine = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
      fetchFn: mockFetch,
    });

    const userId = 'usr_spark_buy_01';

    // 1. Add real Channel3 products to Cart and verify preservation of productId, offerId, merchant, productUrl, price, and specs
    const addRes1 = engine.addToCart({
      userId,
      product: {
        id: 'ch3_prod_ddia_01',
        offerId: 'ch3_offer_ddia_9001',
        sourceId: 'channel3_api',
        sourceName: 'Channel3 Product Graph API',
        canonicalUrl: 'https://trychannel3.com/products/ddia-9001',
        retrievedAt: '2026-11-08T00:00:00.000Z',
        verificationStatus: 'verified_live_source',
        name: 'Designing Data-Intensive Applications (Print Edition)',
        merchant: "O'Reilly Direct via Channel3",
        category: 'Books',
        price: 49.99,
        priceStatus: 'verified',
        currency: 'USD',
        shippingCost: null,
        shippingStatus: 'unknown',
        estimatedTaxRate: null,
        taxStatus: 'unknown',
        availabilityStatus: 'verified_in_stock',
        rating: 4.9,
        reviewCount: 3120,
        summary: 'Distributed systems architecture reference',
        specs: { ISBN: '978-1449373320', Binding: 'Paperback' },
        couponStatus: 'no_verified_coupon',
        checkoutStatus: 'checkout_unsupported',
        imageUrl: 'https://covers.openlibrary.org/b/id/8231990-L.jpg',
      },
      quantity: 2,
    });
    assert.equal(addRes1.ok, true);
    assert.equal(addRes1.cart?.itemCount, 2);
    assert.equal(addRes1.cart?.subtotal, 99.98);
    assert.equal(addRes1.cart?.shippingCost, null);
    assert.equal(addRes1.cart?.shippingStatus, 'unknown');
    assert.equal(addRes1.cart?.taxAmount, null);
    assert.equal(addRes1.cart?.taxStatus, 'unknown');
    assert.equal(addRes1.cart?.items[0].productId, 'ch3_prod_ddia_01');
    assert.equal(addRes1.cart?.items[0].offerId, 'ch3_offer_ddia_9001');
    assert.equal(addRes1.cart?.items[0].merchant, "O'Reilly Direct via Channel3");
    assert.equal(addRes1.cart?.items[0].productUrl, 'https://trychannel3.com/products/ddia-9001');

    // Add a second Channel3 product
    const addRes2 = engine.addToCart({
      userId,
      product: {
        id: 'ch3_prod_clean_arch_02',
        offerId: 'ch3_offer_clean_arch_9002',
        sourceId: 'channel3_api',
        sourceName: 'Channel3 Product Graph API',
        canonicalUrl: 'https://trychannel3.com/products/clean-arch-9002',
        retrievedAt: '2026-11-08T00:00:00.000Z',
        verificationStatus: 'verified_live_source',
        name: 'Clean Architecture: A Craftsman Guide',
        merchant: 'Pearson Technical Books',
        category: 'Books',
        price: 39.99,
        priceStatus: 'verified',
        currency: 'USD',
        shippingCost: null,
        shippingStatus: 'unknown',
        estimatedTaxRate: null,
        taxStatus: 'unknown',
        availabilityStatus: 'verified_in_stock',
        rating: 4.8,
        reviewCount: 1840,
        summary: 'Software architecture principles',
        specs: { ISBN: '978-0134494166' },
        couponStatus: 'no_verified_coupon',
        checkoutStatus: 'checkout_unsupported',
        imageUrl: null,
      },
      quantity: 1,
    });
    assert.equal(addRes2.ok, true);
    assert.equal(addRes2.cart?.items.length, 2);
    assert.equal(addRes2.cart?.itemCount, 3);
    assert.equal(addRes2.cart?.subtotal, 139.97);
    assert.equal(addRes2.cart?.total, 139.97);

    // Verify cart persistence across export/import snapshot
    const preCaptureSnapshot = engine.exportAccountLinkingState();
    const midEngine = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
      fetchFn: mockFetch,
    });
    midEngine.importAccountLinkingState(preCaptureSnapshot);
    const restoredCart = midEngine.getUserCart(userId);
    assert.equal(restoredCart.items.length, 2);
    assert.equal(restoredCart.subtotal, 139.97);

    // 2. Prepare multi-item cart checkout order (requires explicit user confirmation before payment)
    const prep = engine.prepareAutonomousPurchaseOrder({
      userId,
      userEmail: 'buyer-sandbox@spark.app',
      fromCart: true,
      currency: 'USD',
      executionMode: 'SANDBOX_SIMULATION',
    });
    assert.equal(prep.ok, true);
    assert.ok(prep.orderRow);
    assert.equal(prep.orderRow.status, 'AWAITING_USER_CONFIRMATION');
    assert.equal(prep.orderRow.amount, 139.97);
    assert.equal(prep.orderRow.quantity, 3);

    // 3. Explicit user confirmation (authorize order)
    const authRes = engine.authorizePurchaseOrder({
      userId,
      orderId: prep.orderRow.id,
      actor: 'user',
      explicitUserConfirmed: true,
      confirmedAmount: prep.orderRow.amount,
      confirmedCurrency: prep.orderRow.currency,
      confirmedProductId: prep.orderRow.product_id,
      confirmedMerchant: prep.orderRow.merchant_id,
    });
    assert.equal(authRes.ok, true);
    assert.ok(authRes.authorization?.authorizationHash);

    // 4. Execute authorized order -> creates PayPal Sandbox order with all line items
    const execRes = await engine.executeAuthorizedOrder({
      userId,
      userEmail: 'buyer-sandbox@spark.app',
      orderId: prep.orderRow.id,
      authorizationHash: authRes.authorization.authorizationHash,
    });
    assert.equal(execRes.ok, true);
    assert.equal(execRes.transaction?.paypalOrderId, 'ORD_SPARK_BUY_CART_01');
    assert.equal(
      execRes.approvalUrl,
      'https://www.sandbox.paypal.com/checkoutnow?token=ORD_SPARK_BUY_CART_01'
    );
    assert.equal(execRes.transaction?.items?.length, 2);
    assert.ok(capturedOrderPayload);

    // 5. Buyer approves on PayPal Sandbox and backend captures payment
    const approved = engine.markOrderApproved(
      'ORD_SPARK_BUY_CART_01',
      {
        email: 'buyer-sandbox@spark.app',
        payerId: 'PAYER_SPARK_BUY_99',
        userId,
      },
      'buyer'
    );
    assert.equal(approved.ok, true);

    const captureRes = await engine.captureOrder('ORD_SPARK_BUY_CART_01', {
      userId,
      expectedAmount: 139.97,
    });
    assert.equal(captureRes.ok, true);
    assert.equal(captureRes.duplicateCapturePrevented, false);
    assert.equal(captureCallCount, 1);

    // 6. Verify persistent internal Spark Sandbox Order creation & honest merchant status
    const record = captureRes.purchaseRecord;
    assert.ok(record);
    assert.equal(record.userId, userId);
    assert.ok(record.orderReference.startsWith('SPK-'));
    assert.equal(record.paypalOrderId, 'ORD_SPARK_BUY_CART_01');
    assert.equal(record.captureId, 'CAP_SPARK_BUY_CART_01');
    assert.equal(record.totalCharged, 139.97);
    assert.equal(record.currency, 'USD');
    assert.equal(record.status, 'completed');
    assert.equal(record.isSandboxOrder, true);
    assert.equal(record.orderTypeLabel, 'SANDBOX ORDER');
    assert.equal(record.paymentStatus, 'COMPLETED');
    assert.equal(
      record.merchantOrderStatus,
      'Merchant order not submitted — Sandbox simulation'
    );
    assert.equal(record.items?.length, 2);
    assert.equal(record.items?.[0].offerId, 'ch3_offer_ddia_9001');
    assert.equal(record.items?.[1].offerId, 'ch3_offer_clean_arch_9002');

    // Verify user's cart was automatically cleared upon verified capture
    const postCaptureCart = engine.getUserCart(userId);
    assert.equal(postCaptureCart.items.length, 0);
    assert.equal(postCaptureCart.subtotal, 0);

    // Verify duplicate capture is blocked idempotently
    const dupCapture = await engine.captureOrder('ORD_SPARK_BUY_CART_01', {
      userId,
    });
    assert.equal(dupCapture.ok, true);
    assert.equal(dupCapture.duplicateCapturePrevented, true);
    assert.equal(captureCallCount, 1);
    assert.equal(engine.getUserPurchases(userId).length, 1);
  });

  it('verifies APIMatic v2 configuration, skills, PayPal Orders v2 OpenAPI 3.0.4 spec, confirmPaymentSource, authorizeOrderPayment, and My Purchases survival across logout/re-login', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    // 1. Verify APIMatic v2 project files & installed skills
    const rootDir = process.cwd();
    const apimaticConfig = JSON.parse(
      fs.readFileSync(path.join(rootDir, 'src/apimatic.json'), 'utf8')
    );
    assert.equal(apimaticConfig.schemaVersion, 1);
    assert.ok(apimaticConfig.languages.typescript);
    assert.ok(apimaticConfig.languages.python);
    assert.ok(apimaticConfig.languages.csharp);

    const navConfig = JSON.parse(
      fs.readFileSync(path.join(rootDir, 'src/content/nav.json'), 'utf8')
    );
    assert.ok(Array.isArray(navConfig.tabs));
    assert.ok(navConfig.tabs.includes('apimatic:sdks'));
    assert.ok(navConfig.tabs.includes('apimatic:api'));

    const ordersSpec = JSON.parse(
      fs.readFileSync(path.join(rootDir, 'src/spec/checkout_orders_v2.json'), 'utf8')
    );
    assert.equal(ordersSpec.openapi, '3.0.4');
    assert.ok(ordersSpec.paths['/v2/checkout/orders']?.post);
    assert.ok(ordersSpec.paths['/v2/checkout/orders/{id}']?.get);
    assert.ok(ordersSpec.paths['/v2/checkout/orders/{id}/confirm-payment-source']?.post);
    assert.ok(ordersSpec.paths['/v2/checkout/orders/{id}/authorize']?.post);
    assert.ok(ordersSpec.paths['/v2/checkout/orders/{id}/capture']?.post);

    assert.equal(
      fs.existsSync(path.join(rootDir, '.agents/skills/apimatic-portal/SKILL.md')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(rootDir, '.agents/skills/apimatic-sdk/SKILL.md')),
      true
    );

    // Verify no Elastic, Elasticsearch, or AG Grid in package.json
    const pkgJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    const allDeps = {
      ...(pkgJson.dependencies || {}),
      ...(pkgJson.devDependencies || {}),
    };
    for (const depName of Object.keys(allDeps)) {
      assert.equal(
        /ag-grid|elastic/i.test(depName),
        false,
        `Prohibited dependency found: ${depName}`
      );
    }

    // 2. Verify Channel3 -> Cart -> Checkout -> Orders v2 (Create, Confirm Payment Source, Get, Authorize, Capture) -> Persistence across Logout/Login
    const userId = 'usr_apimatic_paypal_buyer_01';
    const otherUserId = 'usr_other_intruder_02';
    const userEmail = 'buyer.apimatic@spark.app';

    const channel3Offer = {
      id: 'ch3_prod_macbook_m4_pro',
      offerId: 'ch3_offer_apple_m4_991',
      sourceId: 'channel3_api' as const,
      sourceName: 'Channel3 Product Graph API',
      canonicalUrl: 'https://www.apple.com/macbook-pro/',
      retrievedAt: '2026-11-11T00:00:00.000Z',
      verificationStatus: 'verified_live_source' as const,
      name: 'Apple MacBook Pro 14-inch (M4 Pro, 24GB Unified Memory, 512GB SSD)',
      merchant: 'Apple Authorized Reseller (Channel3)',
      category: 'Laptops',
      price: 1999.0,
      priceStatus: 'verified' as const,
      currency: 'USD' as const,
      shippingCost: null,
      shippingStatus: 'unknown' as const,
      estimatedTaxRate: null,
      taxStatus: 'unknown' as const,
      availabilityStatus: 'verified_in_stock' as const,
      rating: 4.9,
      reviewCount: 312,
      summary: 'Verified Channel3 catalog offer with exact merchant and offer identity.',
      specs: { processor: 'Apple M4 Pro', memory: '24GB', storage: '512GB SSD' },
      couponStatus: 'no_verified_coupon' as const,
      checkoutStatus: 'checkout_unsupported' as const,
      imageUrl: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600',
    };

    const mockFetch: FetchLike = async (urlInput, init) => {
      const url = String(urlInput);
      const headers = (init?.headers || {}) as Record<string, string>;
      const mockCode = headers['PayPal-Mock-Response'] || '';

      if (url.endsWith('/v1/oauth2/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'A21AA_ORDERS_V2_FULL_SPEC_TOKEN',
            token_type: 'Bearer',
            expires_in: 32400,
          }),
        };
      }
      if (url.endsWith('/v2/checkout/orders') && init?.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'ORD_V2_MACBOOK_01',
            status: 'CREATED',
            links: [
              {
                rel: 'approve',
                href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORD_V2_MACBOOK_01',
              },
            ],
          }),
        };
      }
      if (url.endsWith('/v2/checkout/orders/ORD_V2_MACBOOK_01/confirm-payment-source')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'ORD_V2_MACBOOK_01',
            status: 'PAYER_ACTION_REQUIRED',
            payment_source: {
              paypal: {
                email_address: userEmail,
              },
            },
            links: [
              {
                rel: 'payer-action',
                href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORD_V2_MACBOOK_01',
              },
            ],
          }),
        };
      }
      if (url.endsWith('/v2/checkout/orders/ORD_V2_MACBOOK_01') && (!init?.method || init.method === 'GET')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'ORD_V2_MACBOOK_01',
            status: 'APPROVED',
            payer: {
              email_address: userEmail,
              payer_id: 'PAYER_V2_991',
            },
          }),
        };
      }
      if (url.endsWith('/v2/checkout/orders/ORD_V2_MACBOOK_01/authorize')) {
        if (mockCode.includes('PAYMENT_DENIED')) {
          return {
            ok: false,
            status: 422,
            json: async () => ({
              name: 'UNPROCESSABLE_ENTITY',
              details: [
                {
                  issue: 'PAYMENT_DENIED',
                  description: 'PayPal has declined to process this transaction.',
                },
              ],
            }),
          };
        }
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'ORD_V2_MACBOOK_01',
            status: 'COMPLETED',
            purchase_units: [
              {
                payments: {
                  authorizations: [
                    {
                      id: 'AUTH_V2_MACBOOK_01',
                      status: 'CREATED',
                      amount: { currency_code: 'USD', value: '1999.00' },
                    },
                  ],
                },
              },
            ],
          }),
        };
      }
      if (url.endsWith('/v2/checkout/orders/ORD_V2_MACBOOK_01/capture')) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'ORD_V2_MACBOOK_01',
            status: 'COMPLETED',
            payer: {
              email_address: userEmail,
              payer_id: 'PAYER_V2_991',
            },
            purchase_units: [
              {
                payments: {
                  captures: [
                    {
                      id: 'CAP_V2_MACBOOK_01',
                      status: 'COMPLETED',
                      amount: { currency_code: 'USD', value: '1999.00' },
                    },
                  ],
                },
              },
            ],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const engine = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
      fetchFn: mockFetch,
    });
    engine.configureBuyerSandboxBalance(userId, 5000.0, userEmail);
    engine.registerVerifiedLiveOffer(channel3Offer);

    // Add to Cart and verify exact Channel3 identity and zero invented shipping/tax
    const cartAdd = engine.addToCart({
      userId,
      product: channel3Offer,
      quantity: 1,
    });
    assert.equal(cartAdd.ok, true);
    assert.equal(cartAdd.cart?.subtotal, 1999.0);
    assert.equal(cartAdd.cart?.shippingCost, null);
    assert.equal(cartAdd.cart?.taxAmount, null);
    assert.equal(cartAdd.cart?.total, 1999.0);

    // Create Order from Cart
    const createRes = await engine.createOrder({
      userId,
      userEmail,
      fromCart: true,
      itemId: channel3Offer.id,
    });
    assert.equal(createRes.ok, true);
    assert.equal(createRes.transaction?.paypalOrderId, 'ORD_V2_MACBOOK_01');

    // Ownership isolation on confirmPaymentSource
    const forbiddenConfirm = await engine.confirmPaymentSource('ORD_V2_MACBOOK_01', {
      userId: otherUserId,
    });
    assert.equal(forbiddenConfirm.ok, false);
    assert.equal(forbiddenConfirm.statusCode, 403);

    // Confirm Payment Source (POST /v2/checkout/orders/{id}/confirm-payment-source)
    const confirmRes = await engine.confirmPaymentSource('ORD_V2_MACBOOK_01', {
      userId,
      payerEmail: userEmail,
      givenName: 'Alex',
      surname: 'Mercer',
    });
    assert.equal(confirmRes.ok, true);
    assert.equal(confirmRes.remotePayPalStatus, 'PAYER_ACTION_REQUIRED');
    assert.ok(confirmRes.payerActionUrl?.includes('ORD_V2_MACBOOK_01'));

    // Reject authorize before buyer approval
    const prematureAuth = await engine.authorizeOrderPayment('ORD_V2_MACBOOK_01', {
      userId,
    });
    assert.equal(prematureAuth.ok, false);
    assert.equal(prematureAuth.errorCode, 'ORDER_NOT_APPROVED');

    // Inspect Order (GET /v2/checkout/orders/{id}) -> reconciles APPROVED state
    const inspectRes = await engine.inspectOrder('ORD_V2_MACBOOK_01', userId);
    assert.equal(inspectRes.ok, true);
    assert.equal(inspectRes.transaction?.status, 'APPROVED');

    // Authorize Order Payment (POST /v2/checkout/orders/{id}/authorize)
    const authOrderRes = await engine.authorizeOrderPayment('ORD_V2_MACBOOK_01', {
      userId,
    });
    assert.equal(authOrderRes.ok, true);
    assert.equal(authOrderRes.statusCode, 201);
    assert.equal(authOrderRes.authorizationId, 'AUTH_V2_MACBOOK_01');

    // Capture Order Payment (POST /v2/checkout/orders/{id}/capture)
    const captureRes = await engine.captureOrder('ORD_V2_MACBOOK_01', {
      userId,
      expectedAmount: 1999.0,
    });
    assert.equal(captureRes.ok, true);
    assert.equal(captureRes.transaction?.status, 'COMPLETED');
    assert.equal(captureRes.purchaseRecord?.paymentStatus, 'COMPLETED');
    assert.equal(
      captureRes.purchaseRecord?.merchantOrderStatus,
      'Merchant order not submitted — Sandbox simulation'
    );
    assert.equal(captureRes.purchaseRecord?.offerId, 'ch3_offer_apple_m4_991');

    // 3. Verify persistence across database snapshot export/import and user logout/re-login
    const sessionManager = new SparkAuthSessionManager();
    const initialSession = sessionManager.issueSession({
      userId,
      email: userEmail,
      displayName: 'Alex Mercer',
    });
    assert.equal(
      sessionManager.verifyRequest({
        method: 'GET',
        headers: { authorization: `Bearer ${initialSession.sessionId}` },
      }).authenticated,
      true
    );

    // User logs out
    sessionManager.revokeSession(initialSession.sessionId);
    assert.equal(
      sessionManager.verifyRequest({
        method: 'GET',
        headers: { authorization: `Bearer ${initialSession.sessionId}` },
      }).authenticated,
      false
    );

    // Server snapshot persisted and reloaded into a fresh engine instance
    const snapshot = engine.exportAccountLinkingState();
    const restoredEngine = new PayPalSandboxEngine({
      envGetter: () => createMockEnv(),
      fetchFn: mockFetch,
    });
    restoredEngine.importAccountLinkingState(snapshot);

    // User logs back in -> new session issued -> My Purchases survives logout/re-login
    const reloginSession = sessionManager.issueSession({
      userId,
      email: userEmail,
      displayName: 'Alex Mercer',
    });
    const reloginVerify = sessionManager.verifyRequest({
      method: 'GET',
      headers: { authorization: `Bearer ${reloginSession.sessionId}` },
    });
    assert.equal(reloginVerify.authenticated, true);
    assert.equal(reloginVerify.session?.userId, userId);

    const survivedPurchases = restoredEngine.getUserPurchases(userId);
    assert.equal(survivedPurchases.length, 1);
    assert.equal(survivedPurchases[0].paypalOrderId, 'ORD_V2_MACBOOK_01');
    assert.equal(survivedPurchases[0].captureId, 'CAP_V2_MACBOOK_01');
    assert.equal(survivedPurchases[0].totalAmount, 1999.0);
    assert.equal(survivedPurchases[0].paymentStatus, 'COMPLETED');
    assert.equal(
      survivedPurchases[0].merchantOrderStatus,
      'Merchant order not submitted — Sandbox simulation'
    );
  });
});


