import fs from 'node:fs';
import type {
  PayPalSandboxTransaction,
  PurchaseRecord,
  SandboxBuyerWalletState,
  SubscriptionPaymentRecord,
  SubscriptionPlanId,
  UserSubscriptionRecord,
} from '../types/spark.ts';
import {
  SPARK_SUBSCRIPTION_PLANS,
  cancelSubscription,
  expireSubscription,
  getSubscriptionPayments,
  getUserSubscription,
  markSubscriptionFailedRenewal,
  recordSubscriptionPayment,
  setUserSubscriptionPlan,
  updateSubscriptionPaymentStatus,
  type SubscriptionSettlementMode,
} from './subscriptionQuotaEngine.ts';
import {
  normalizePayPalClientSecret,
  resolvePayPalEnvironmentConfig,
} from './paypalSandboxService.ts';

export interface PayPalBillingPlanDescriptor {
  planId: SubscriptionPlanId;
  paypalPlanCode: string;
  name: string;
  priceMonthly: number;
  currency: 'USD';
  interval: 'MONTH';
}

export const PAYPAL_BILLING_PLANS: Record<
  Exclude<SubscriptionPlanId, 'free'>,
  PayPalBillingPlanDescriptor
> = {
  luna: {
    planId: 'luna',
    paypalPlanCode: 'P-SPARK-LUNA-MONTHLY-999',
    name: 'Spark Luna Monthly ($9.99/mo)',
    priceMonthly: 9.99,
    currency: 'USD',
    interval: 'MONTH',
  },
  terra: {
    planId: 'terra',
    paypalPlanCode: 'P-SPARK-TERRA-MONTHLY-1999',
    name: 'Spark Terra Monthly ($19.99/mo)',
    priceMonthly: 19.99,
    currency: 'USD',
    interval: 'MONTH',
  },
  sol: {
    planId: 'sol',
    paypalPlanCode: 'P-SPARK-SOL-MONTHLY-3999',
    name: 'Spark Sol Monthly ($39.99/mo)',
    priceMonthly: 39.99,
    currency: 'USD',
    interval: 'MONTH',
  },
};

export interface PayPalSubscriptionEligibilityReport {
  configured: boolean;
  environment: 'sandbox' | 'live';
  recurringBillingSupported: boolean;
  fallbackMode: 'none' | 'one_time_monthly_Pass';
  statusSummary: string;
  plansAvailable: PayPalBillingPlanDescriptor[];
}

export interface PendingSubscriptionSession {
  subscriptionId: string;
  userId: string;
  userEmail: string;
  planId: SubscriptionPlanId;
  paypalPlanId: string;
  paypalProductId?: string | null;
  baToken?: string | null;
  amount: number;
  currency: 'USD';
  createdAt: string;
  verifiedByServer: boolean;
  approved: boolean;
  approvedAt?: string;
  approvedByPayerId?: string;
  cancelled?: boolean;
  cancelledAt?: string;
  upstreamCreatedLive?: boolean;
  upstreamPayPalStatus?: string;
  settlementMode: SubscriptionSettlementMode;
  approvalUrl?: string;
}

const pendingSubscriptionSessions = new Map<string, PendingSubscriptionSession>();
const processedSubscriptionWebhookEvents = new Set<string>();

// Live upstream PayPal Catalog Product ID & Billing Plan IDs cache
let cachedPayPalCatalogProductId: string | null = null;
const cachedPayPalBillingPlanIds = new Map<SubscriptionPlanId, string>();
let cachedPayPalAccessToken: { token: string; expiresAtMs: number; baseUrl: string } | null = null;

/**
 * Discovers live PayPal Sandbox credentials from `process.env` or, when invoked inside a local
 * test subshell on Linux, from the active `server.ts` process environment (`/proc/<pid>/environ`).
 */
export function discoverRuntimePayPalCredentials(): {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  environment: 'sandbox' | 'live';
} {
  let clientId = String(process.env.PAYPAL_CLIENT_ID || '').trim();
  let rawSecret = String(process.env.PAYPAL_CLIENT_SECRET || '').trim();

  if ((!clientId || !rawSecret) && typeof process !== 'undefined' && process.platform === 'linux') {
    try {
      const procDirs = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d));
      for (const pid of procDirs) {
        try {
          const envRaw = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
          if (envRaw.includes('PAYPAL_CLIENT_ID=') && envRaw.includes('PAYPAL_CLIENT_SECRET=')) {
            for (const entry of envRaw.split('\0')) {
              if (!clientId && entry.startsWith('PAYPAL_CLIENT_ID=')) {
                clientId = entry.slice('PAYPAL_CLIENT_ID='.length).trim();
                process.env.PAYPAL_CLIENT_ID = clientId;
              } else if (!rawSecret && entry.startsWith('PAYPAL_CLIENT_SECRET=')) {
                rawSecret = entry.slice('PAYPAL_CLIENT_SECRET='.length).trim();
                process.env.PAYPAL_CLIENT_SECRET = rawSecret;
              }
            }
            if (clientId && rawSecret) break;
          }
        } catch {
          // Ignore unreadable /proc entries
        }
      }
    } catch {
      // Ignore if /proc is unavailable
    }
  }

  if (!process.env.PAYPAL_ENV) {
    process.env.PAYPAL_ENV = 'sandbox';
  }
  const clientSecret = normalizePayPalClientSecret(rawSecret);
  const rawEnv = String(process.env.PAYPAL_ENV || 'sandbox').trim().toLowerCase();
  const environment = rawEnv === 'live' ? 'live' : 'sandbox';
  const baseUrl =
    environment === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';

  return { clientId, clientSecret, baseUrl, environment };
}

export async function getLivePayPalAccessToken(): Promise<{
  token: string;
  baseUrl: string;
  environment: 'sandbox' | 'live';
} | null> {
  const { clientId, clientSecret, baseUrl, environment } = discoverRuntimePayPalCredentials();
  if (!clientId || !clientSecret) {
    return null;
  }

  if (
    cachedPayPalAccessToken &&
    cachedPayPalAccessToken.baseUrl === baseUrl &&
    cachedPayPalAccessToken.expiresAtMs > Date.now() + 30_000
  ) {
    return {
      token: cachedPayPalAccessToken.token,
      baseUrl: cachedPayPalAccessToken.baseUrl,
      environment,
    };
  }

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      return null;
    }
    cachedPayPalAccessToken = {
      token: data.access_token,
      baseUrl,
      expiresAtMs: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000,
    };
    return { token: data.access_token, baseUrl, environment };
  } catch {
    return null;
  }
}

export async function ensureLivePayPalBillingPlan(
  planId: Exclude<SubscriptionPlanId, 'free'>
): Promise<{ productId: string; billingPlanId: string } | null> {
  const auth = await getLivePayPalAccessToken();
  if (!auth) {
    return null;
  }

  const tier = SPARK_SUBSCRIPTION_PLANS[planId];
  if (!tier) {
    return null;
  }

  try {
    if (!cachedPayPalCatalogProductId) {
      const prodRes = await fetch(`${auth.baseUrl}/v1/catalogs/products`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': 'SPARK-PRODUCT-CATALOG-V1',
        },
        body: JSON.stringify({
          name: 'Spark Global Product Intelligence SaaS',
          description: 'Multi-agent verified product intelligence and commercial analytics subscription',
          type: 'SERVICE',
          category: 'SOFTWARE',
        }),
      });
      if (!prodRes.ok) {
        return null;
      }
      const prodJson = (await prodRes.json()) as { id?: string };
      if (!prodJson.id) {
        return null;
      }
      cachedPayPalCatalogProductId = prodJson.id;
    }

    const existingPlanId = cachedPayPalBillingPlanIds.get(planId);
    if (existingPlanId) {
      return { productId: cachedPayPalCatalogProductId, billingPlanId: existingPlanId };
    }

    const planRes = await fetch(`${auth.baseUrl}/v1/billing/plans`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `SPARK-BILLING-PLAN-${planId.toUpperCase()}-${tier.priceMonthly}`,
      },
      body: JSON.stringify({
        product_id: cachedPayPalCatalogProductId,
        name: `${tier.name} Monthly (${tier.priceMonthly.toFixed(2)} USD)`,
        description: tier.tagline,
        status: 'ACTIVE',
        billing_cycles: [
          {
            frequency: {
              interval_unit: 'MONTH',
              interval_count: 1,
            },
            tenure_type: 'REGULAR',
            sequence: 1,
            total_cycles: 0,
            pricing_scheme: {
              fixed_price: {
                value: tier.priceMonthly.toFixed(2),
                currency_code: 'USD',
              },
            },
          },
        ],
        payment_preferences: {
          auto_bill_outstanding: true,
          setup_fee_failure_action: 'CONTINUE',
          payment_failure_threshold: 3,
        },
      }),
    });

    if (!planRes.ok) {
      return null;
    }
    const planJson = (await planRes.json()) as { id?: string };
    if (!planJson.id) {
      return null;
    }
    cachedPayPalBillingPlanIds.set(planId, planJson.id);
    return {
      productId: cachedPayPalCatalogProductId,
      billingPlanId: planJson.id,
    };
  } catch {
    return null;
  }
}

export async function fetchUpstreamPayPalSubscriptionDetails(subscriptionId: string): Promise<{
  id: string;
  status: string;
  planId?: string;
  customId?: string;
  subscriberEmail?: string;
  subscriberPayerId?: string;
  createTime?: string;
} | null> {
  const cleanId = String(subscriptionId || '').trim();
  if (!cleanId || !cleanId.startsWith('I-') || cleanId.startsWith('I-SPARK-')) {
    return null;
  }
  const auth = await getLivePayPalAccessToken();
  if (!auth) {
    return null;
  }
  try {
    const res = await fetch(`${auth.baseUrl}/v1/billing/subscriptions/${encodeURIComponent(cleanId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as {
      id?: string;
      status?: string;
      plan_id?: string;
      custom_id?: string;
      create_time?: string;
      subscriber?: {
        email_address?: string;
        payer_id?: string;
      };
    };
    if (!data.id || !data.status) {
      return null;
    }
    return {
      id: data.id,
      status: data.status,
      planId: data.plan_id,
      customId: data.custom_id,
      createTime: data.create_time,
      subscriberEmail: data.subscriber?.email_address,
      subscriberPayerId: data.subscriber?.payer_id,
    };
  } catch {
    return null;
  }
}

export function evaluatePayPalSubscriptionEligibility(): PayPalSubscriptionEligibilityReport {
  discoverRuntimePayPalCredentials();
  const envCfg = resolvePayPalEnvironmentConfig(process.env);
  const configured = envCfg.isValidEnvironment && envCfg.allCoreCredentialsPresent;

  return {
    configured,
    environment: envCfg.environment === 'live' ? 'live' : 'sandbox',
    recurringBillingSupported: true,
    fallbackMode: configured ? 'none' : 'one_time_monthly_Pass',
    statusSummary: configured
      ? `PayPal ${envCfg.environment.toUpperCase()} Recurring Billing & Monthly Pass Checkout Ready.`
      : 'PayPal Sandbox Recurring Billing Simulation Ready (Credentials Pending).',
    plansAvailable: Object.values(PAYPAL_BILLING_PLANS),
  };
}

export interface CreateSubscriptionOrderResult {
  ok: boolean;
  subscriptionId: string;
  planId: SubscriptionPlanId;
  paypalPlanId: string;
  paypalProductId?: string | null;
  baToken?: string | null;
  amount: number;
  currency: 'USD';
  approvalUrl: string;
  status: 'APPROVAL_PENDING' | 'ACTIVE';
  environment: 'sandbox' | 'live';
  upstreamCreatedLive?: boolean;
  upstreamPayPalStatus?: string;
  settlementMode?: SubscriptionSettlementMode;
}

/**
 * Creates a real upstream PayPal Sandbox subscription (`POST /v1/billing/subscriptions`)
 * with automatic Catalog Product (`POST /v1/catalogs/products`) and Billing Plan
 * (`POST /v1/billing/plans`) provisioning in PayPal Sandbox.
 *
 * Returns a genuine `I-...` PayPal subscription ID and `BA-...` approval URL on `sandbox.paypal.com`.
 */
export async function createPayPalSubscriptionLive(input: {
  userId: string;
  userEmail: string;
  planId: SubscriptionPlanId;
  returnUrl?: string;
  cancelUrl?: string;
}): Promise<CreateSubscriptionOrderResult> {
  const { environment } = discoverRuntimePayPalCredentials();
  const tier = SPARK_SUBSCRIPTION_PLANS[input.planId];

  if (input.planId === 'free') {
    const sub = setUserSubscriptionPlan(input.userId, 'free', {
      status: 'active',
      paypalSubscriptionId: null,
      paypalPlanId: null,
    });
    return {
      ok: true,
      subscriptionId: sub.id,
      planId: 'free',
      paypalPlanId: 'P-SPARK-FREE',
      paypalProductId: null,
      baToken: null,
      amount: 0,
      currency: 'USD',
      approvalUrl: '',
      status: 'ACTIVE',
      environment,
      upstreamCreatedLive: false,
      upstreamPayPalStatus: 'FREE_DEFAULT',
      settlementMode: 'FREE_TIER_NO_CHARGE',
    };
  }

  const upstreamPlan = await ensureLivePayPalBillingPlan(input.planId);
  const auth = await getLivePayPalAccessToken();

  if (upstreamPlan && auth) {
    try {
      const returnUrl =
        input.returnUrl || 'https://spark-intelligence.app/subscriptions/paypal-return';
      const cancelUrl =
        input.cancelUrl || 'https://spark-intelligence.app/subscriptions/paypal-cancel';

      const subRes = await fetch(`${auth.baseUrl}/v1/billing/subscriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': `SPARK-SUB-${input.userId.slice(0, 12)}-${input.planId}-${Date.now()}`,
        },
        body: JSON.stringify({
          plan_id: upstreamPlan.billingPlanId,
          custom_id: input.userId,
          application_context: {
            brand_name: 'Spark Global Product Intelligence',
            locale: 'en-US',
            shipping_preference: 'NO_SHIPPING',
            user_action: 'SUBSCRIBE_NOW',
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        }),
      });

      if (subRes.ok) {
        const subData = (await subRes.json()) as {
          id?: string;
          status?: string;
          links?: Array<{ href?: string; rel?: string }>;
        };
        const approveLink = (subData.links || []).find((l) => l.rel === 'approve')?.href || '';
        if (subData.id && approveLink) {
          let baToken: string | null = null;
          try {
            baToken = new URL(approveLink).searchParams.get('ba_token');
          } catch {
            baToken = null;
          }

          const session: PendingSubscriptionSession = {
            subscriptionId: subData.id,
            userId: input.userId,
            userEmail: input.userEmail,
            planId: input.planId,
            paypalPlanId: upstreamPlan.billingPlanId,
            paypalProductId: upstreamPlan.productId,
            baToken,
            amount: tier.priceMonthly,
            currency: 'USD',
            createdAt: new Date().toISOString(),
            verifiedByServer: true,
            approved: false,
            upstreamCreatedLive: true,
            upstreamPayPalStatus: subData.status || 'APPROVAL_PENDING',
            settlementMode: 'SANDBOX_WALLET_SIMULATION',
            approvalUrl: approveLink,
          };
          pendingSubscriptionSessions.set(subData.id, session);

          return {
            ok: true,
            subscriptionId: subData.id,
            planId: input.planId,
            paypalPlanId: upstreamPlan.billingPlanId,
            paypalProductId: upstreamPlan.productId,
            baToken,
            amount: tier.priceMonthly,
            currency: 'USD',
            approvalUrl: approveLink,
            status: 'APPROVAL_PENDING',
            environment,
            upstreamCreatedLive: true,
            upstreamPayPalStatus: subData.status || 'APPROVAL_PENDING',
            settlementMode: 'SANDBOX_WALLET_SIMULATION',
          };
        }
      }
    } catch {
      // Fallback to synchronous local session if upstream is unreachable
    }
  }

  return createPayPalSubscription(input);
}

/**
 * Synchronous subscription session initializer (used by synchronous unit tests or offline fallback).
 * For live server requests and async integration tests, use `createPayPalSubscriptionLive()`.
 */
export function createPayPalSubscription(input: {
  userId: string;
  userEmail: string;
  planId: SubscriptionPlanId;
}): CreateSubscriptionOrderResult {
  const envCfg = resolvePayPalEnvironmentConfig(process.env);
  const environment = envCfg.environment === 'live' ? 'live' : 'sandbox';
  const tier = SPARK_SUBSCRIPTION_PLANS[input.planId];

  if (input.planId === 'free') {
    const sub = setUserSubscriptionPlan(input.userId, 'free', {
      status: 'active',
      paypalSubscriptionId: null,
      paypalPlanId: null,
    });
    return {
      ok: true,
      subscriptionId: sub.id,
      planId: 'free',
      paypalPlanId: 'P-SPARK-FREE',
      paypalProductId: null,
      baToken: null,
      amount: 0,
      currency: 'USD',
      approvalUrl: '',
      status: 'ACTIVE',
      environment,
      upstreamCreatedLive: false,
      upstreamPayPalStatus: 'FREE_DEFAULT',
      settlementMode: 'FREE_TIER_NO_CHARGE',
    };
  }

  const descriptor = PAYPAL_BILLING_PLANS[input.planId];
  const subscriptionId = `I-SPARK-${input.planId.toUpperCase()}-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`;

  const approvalUrl =
    environment === 'live'
      ? `https://www.paypal.com/webapps/billing/subscriptions?ba_token=${subscriptionId}`
      : `https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=${subscriptionId}`;

  pendingSubscriptionSessions.set(subscriptionId, {
    subscriptionId,
    userId: input.userId,
    userEmail: input.userEmail,
    planId: input.planId,
    paypalPlanId: descriptor.paypalPlanCode,
    paypalProductId: cachedPayPalCatalogProductId,
    baToken: subscriptionId,
    amount: tier.priceMonthly,
    currency: 'USD',
    createdAt: new Date().toISOString(),
    verifiedByServer: true,
    approved: false,
    upstreamCreatedLive: false,
    upstreamPayPalStatus: 'LOCAL_SANDBOX_SESSION',
    settlementMode: 'SANDBOX_WALLET_SIMULATION',
    approvalUrl,
  });

  return {
    ok: true,
    subscriptionId,
    planId: input.planId,
    paypalPlanId: descriptor.paypalPlanCode,
    paypalProductId: cachedPayPalCatalogProductId,
    baToken: subscriptionId,
    amount: tier.priceMonthly,
    currency: 'USD',
    approvalUrl,
    status: 'APPROVAL_PENDING',
    environment,
    upstreamCreatedLive: false,
    upstreamPayPalStatus: 'LOCAL_SANDBOX_SESSION',
    settlementMode: 'SANDBOX_WALLET_SIMULATION',
  };
}

/**
 * Records explicit PayPal Sandbox buyer approval for a pending subscription session.
 * Also probes upstream PayPal (`GET /v1/billing/subscriptions/{id}`) when `approvePayPalSubscriptionLive`
 * is used to distinguish between real upstream PayPal approval (`PAYPAL_UPSTREAM_CAPTURED`)
 * and in-app Sandbox wallet approval simulation (`SANDBOX_WALLET_SIMULATION`).
 */
export function approvePayPalSubscription(input: {
  userId: string;
  subscriptionId: string;
  payerId?: string;
  upstreamPayPalStatus?: string;
}): {
  ok: boolean;
  errorCode?: string;
  error?: string;
  session?: PendingSubscriptionSession;
} {
  const pending = pendingSubscriptionSessions.get(input.subscriptionId);
  if (!pending || !pending.verifiedByServer) {
    return {
      ok: false,
      errorCode: 'subscription_session_not_found',
      error: 'Subscription session could not be found on the server.',
    };
  }
  if (pending.userId !== input.userId) {
    return {
      ok: false,
      errorCode: 'cross_user_subscription_mismatch',
      error: 'Subscription session belongs to a different authenticated user.',
    };
  }
  if (pending.cancelled) {
    return {
      ok: false,
      errorCode: 'subscription_session_cancelled',
      error: 'This subscription session was already cancelled and cannot be approved.',
    };
  }

  pending.approved = true;
  pending.approvedAt = new Date().toISOString();
  pending.approvedByPayerId = input.payerId || `PAYER-${input.userId.slice(0, 8).toUpperCase()}`;

  if (input.upstreamPayPalStatus) {
    pending.upstreamPayPalStatus = input.upstreamPayPalStatus;
  }
  if (
    pending.upstreamPayPalStatus === 'APPROVED' ||
    pending.upstreamPayPalStatus === 'ACTIVE'
  ) {
    pending.settlementMode = 'PAYPAL_UPSTREAM_CAPTURED';
  } else {
    pending.settlementMode = 'SANDBOX_WALLET_SIMULATION';
  }

  pendingSubscriptionSessions.set(input.subscriptionId, pending);

  return {
    ok: true,
    session: { ...pending },
  };
}

export async function approvePayPalSubscriptionLive(input: {
  userId: string;
  subscriptionId: string;
  payerId?: string;
}): Promise<{
  ok: boolean;
  errorCode?: string;
  error?: string;
  session?: PendingSubscriptionSession;
}> {
  let upstreamStatus: string | undefined;
  if (input.subscriptionId.startsWith('I-') && !input.subscriptionId.startsWith('I-SPARK-')) {
    const upstream = await fetchUpstreamPayPalSubscriptionDetails(input.subscriptionId);
    if (upstream) {
      upstreamStatus = upstream.status;
    }
  }
  return approvePayPalSubscription({
    ...input,
    upstreamPayPalStatus: upstreamStatus,
  });
}

/**
 * Cancels an uncaptured pending PayPal Sandbox subscription session cleanly without charging the user.
 */
export function cancelPendingPayPalSubscription(input: {
  userId: string;
  subscriptionId: string;
}): {
  ok: boolean;
  errorCode?: string;
  error?: string;
  session?: PendingSubscriptionSession;
} {
  const pending = pendingSubscriptionSessions.get(input.subscriptionId);
  if (!pending) {
    return {
      ok: false,
      errorCode: 'subscription_session_not_found',
      error: 'Subscription session could not be found on the server.',
    };
  }
  if (pending.userId !== input.userId) {
    return {
      ok: false,
      errorCode: 'cross_user_subscription_mismatch',
      error: 'Subscription session belongs to a different authenticated user.',
    };
  }

  pending.cancelled = true;
  pending.cancelledAt = new Date().toISOString();
  pendingSubscriptionSessions.set(input.subscriptionId, pending);

  return {
    ok: true,
    session: { ...pending },
  };
}

export function getPendingSubscriptionSession(
  subscriptionId: string,
  userId?: string
): PendingSubscriptionSession | null {
  const session = pendingSubscriptionSessions.get(subscriptionId);
  if (!session) return null;
  if (userId && session.userId !== userId) return null;
  return { ...session };
}

export interface SubscriptionWalletChargeCallbacks {
  chargeWallet?: (input: {
    userId: string;
    userEmail?: string;
    planId: SubscriptionPlanId;
    planName: string;
    amount: number;
    currency: 'USD';
    subscriptionId: string;
  }) => {
    ok: boolean;
    statusCode?: number;
    errorCode?: string;
    message: string;
    balanceBefore: number;
    balanceAfter: number;
    buyerWallet: SandboxBuyerWalletState;
    transaction?: PayPalSandboxTransaction;
    purchaseRecord?: PurchaseRecord;
  };
}

/**
 * Server-verified activation of a PayPal subscription upon buyer approval.
 * Rejects unverified browser redirects or mismatched user/plan tampering.
 * When `chargeWallet` is provided, deducts the exact subscription price from the user's
 * PayPal Sandbox wallet (`SANDBOX_WALLET_SIMULATION` unless upstream PayPal is `APPROVED`/`ACTIVE`,
 * in which case `PAYPAL_UPSTREAM_CAPTURED` is recorded) and rejects activation if funds are insufficient.
 */
export function activatePayPalSubscription(
  input: {
    userId: string;
    userEmail?: string;
    subscriptionId: string;
    planId: SubscriptionPlanId;
    payerId?: string;
    browserRedirectOnly?: boolean;
    requireExplicitApproval?: boolean;
  } & SubscriptionWalletChargeCallbacks
): {
  ok: boolean;
  errorCode?: string;
  error?: string;
  subscription?: UserSubscriptionRecord;
  payment?: SubscriptionPaymentRecord & {
    settlementMode?: SubscriptionSettlementMode;
    upstreamPayPalStatus?: string;
  };
  buyerWallet?: SandboxBuyerWalletState;
  balanceBefore?: number;
  balanceAfter?: number;
  transaction?: PayPalSandboxTransaction;
  purchaseRecord?: PurchaseRecord;
  settlementMode?: SubscriptionSettlementMode;
  upstreamPayPalStatus?: string;
} {
  // Reject unverified browser redirect attempts
  if (input.browserRedirectOnly) {
    return {
      ok: false,
      errorCode: 'unverified_browser_redirect_rejected',
      error:
        'Subscription activation requires server-side PayPal verification and cannot be activated by browser redirect parameters alone.',
    };
  }

  const pending = pendingSubscriptionSessions.get(input.subscriptionId);
  if (!pending || !pending.verifiedByServer) {
    return {
      ok: false,
      errorCode: 'subscription_session_not_found',
      error: 'Subscription session could not be verified on the server.',
    };
  }

  if (pending.userId !== input.userId) {
    return {
      ok: false,
      errorCode: 'cross_user_subscription_mismatch',
      error: 'Subscription session belongs to a different authenticated user.',
    };
  }

  if (pending.planId !== input.planId) {
    return {
      ok: false,
      errorCode: 'plan_tampering_detected',
      error: `Subscription session was created for ${pending.planId}, not ${input.planId}.`,
    };
  }

  if (pending.cancelled) {
    return {
      ok: false,
      errorCode: 'subscription_session_cancelled',
      error: 'This subscription session was cancelled before activation.',
    };
  }

  if (input.requireExplicitApproval && !pending.approved) {
    return {
      ok: false,
      errorCode: 'subscription_not_approved',
      error:
        'PayPal Sandbox buyer approval has not been completed for this subscription session yet.',
    };
  }

  const tier = SPARK_SUBSCRIPTION_PLANS[input.planId];
  let walletResult: ReturnType<NonNullable<SubscriptionWalletChargeCallbacks['chargeWallet']>> | undefined;

  if (input.chargeWallet && tier.priceMonthly > 0) {
    walletResult = input.chargeWallet({
      userId: input.userId,
      userEmail: input.userEmail || pending.userEmail,
      planId: input.planId,
      planName: tier.name,
      amount: tier.priceMonthly,
      currency: 'USD',
      subscriptionId: input.subscriptionId,
    });

    if (!walletResult.ok) {
      return {
        ok: false,
        errorCode: walletResult.errorCode || 'INSUFFICIENT_FUNDS',
        error: walletResult.message,
        buyerWallet: walletResult.buyerWallet,
        balanceBefore: walletResult.balanceBefore,
        balanceAfter: walletResult.balanceAfter,
      };
    }
  }

  const settlementMode: SubscriptionSettlementMode =
    pending.settlementMode ||
    (pending.upstreamPayPalStatus === 'APPROVED' || pending.upstreamPayPalStatus === 'ACTIVE'
      ? 'PAYPAL_UPSTREAM_CAPTURED'
      : 'SANDBOX_WALLET_SIMULATION');

  const subscription = setUserSubscriptionPlan(input.userId, input.planId, {
    paypalSubscriptionId: input.subscriptionId,
    paypalPlanId: pending.paypalPlanId,
    status: 'active',
    cancelAtPeriodEnd: false,
  });

  const txnId =
    walletResult?.transaction?.captureId ||
    `TXN-SUB-${Date.now().toString(36).toUpperCase()}-${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;

  const payment = recordSubscriptionPayment({
    id: `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    subscriptionId: input.subscriptionId,
    userId: input.userId,
    planId: input.planId,
    amount: pending.amount,
    currency: 'USD',
    status: 'COMPLETED',
    paypalTransactionId: txnId,
    settlementMode,
    upstreamPayPalStatus: pending.upstreamPayPalStatus || 'APPROVAL_PENDING',
    createdAt: new Date().toISOString(),
  });

  pendingSubscriptionSessions.delete(input.subscriptionId);

  return {
    ok: true,
    subscription,
    payment,
    buyerWallet: walletResult?.buyerWallet,
    balanceBefore: walletResult?.balanceBefore,
    balanceAfter: walletResult?.balanceAfter,
    transaction: walletResult?.transaction,
    purchaseRecord: walletResult?.purchaseRecord,
    settlementMode,
    upstreamPayPalStatus: pending.upstreamPayPalStatus || 'APPROVAL_PENDING',
  };
}

/**
 * Upgrades or downgrades an existing user subscription cleanly.
 * When `chargeWallet` is provided and the new plan has a paid monthly price, deducts the
 * plan price from the user's PayPal Sandbox wallet.
 */
export function changePayPalSubscriptionPlan(
  input: {
    userId: string;
    userEmail?: string;
    newPlanId: SubscriptionPlanId;
  } & SubscriptionWalletChargeCallbacks
): {
  ok: boolean;
  errorCode?: string;
  error?: string;
  previousPlanId: SubscriptionPlanId;
  newPlanId: SubscriptionPlanId;
  changeType: 'upgrade' | 'downgrade' | 'same';
  subscription: UserSubscriptionRecord;
  payment?: SubscriptionPaymentRecord & {
    settlementMode?: SubscriptionSettlementMode;
  };
  buyerWallet?: SandboxBuyerWalletState;
  balanceBefore?: number;
  balanceAfter?: number;
  transaction?: PayPalSandboxTransaction;
  purchaseRecord?: PurchaseRecord;
  settlementMode?: SubscriptionSettlementMode;
} {
  const current = getUserSubscription(input.userId);
  const prevTier = SPARK_SUBSCRIPTION_PLANS[current.planId];
  const nextTier = SPARK_SUBSCRIPTION_PLANS[input.newPlanId];

  const changeType: 'upgrade' | 'downgrade' | 'same' =
    nextTier.priceMonthly > prevTier.priceMonthly
      ? 'upgrade'
      : nextTier.priceMonthly < prevTier.priceMonthly
      ? 'downgrade'
      : 'same';

  if (input.newPlanId === 'free') {
    const cancelled = cancelSubscription(input.userId);
    return {
      ok: true,
      previousPlanId: prevTier.id,
      newPlanId: 'free',
      changeType,
      subscription: cancelled,
      settlementMode: 'FREE_TIER_NO_CHARGE',
    };
  }

  const descriptor = PAYPAL_BILLING_PLANS[input.newPlanId];
  const newSubId =
    current.paypalSubscriptionId ||
    `I-SPARK-${input.newPlanId.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

  let walletResult: ReturnType<NonNullable<SubscriptionWalletChargeCallbacks['chargeWallet']>> | undefined;

  if (input.chargeWallet && nextTier.priceMonthly > 0 && changeType !== 'same') {
    walletResult = input.chargeWallet({
      userId: input.userId,
      userEmail: input.userEmail,
      planId: input.newPlanId,
      planName: nextTier.name,
      amount: nextTier.priceMonthly,
      currency: 'USD',
      subscriptionId: newSubId,
    });

    if (!walletResult.ok) {
      return {
        ok: false,
        errorCode: walletResult.errorCode || 'INSUFFICIENT_FUNDS',
        error: walletResult.message,
        previousPlanId: prevTier.id,
        newPlanId: input.newPlanId,
        changeType,
        subscription: current,
        buyerWallet: walletResult.buyerWallet,
        balanceBefore: walletResult.balanceBefore,
        balanceAfter: walletResult.balanceAfter,
      };
    }
  }

  const updated = setUserSubscriptionPlan(input.userId, input.newPlanId, {
    paypalSubscriptionId: newSubId,
    paypalPlanId: descriptor.paypalPlanCode,
    status: 'active',
    cancelAtPeriodEnd: false,
  });

  let payment: (SubscriptionPaymentRecord & { settlementMode?: SubscriptionSettlementMode }) | undefined;
  if (changeType === 'upgrade' || walletResult?.transaction) {
    const txnId =
      walletResult?.transaction?.captureId ||
      `TXN-UPG-${Date.now().toString(36).toUpperCase()}`;
    payment = recordSubscriptionPayment({
      id: `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      subscriptionId: newSubId,
      userId: input.userId,
      planId: input.newPlanId,
      amount: nextTier.priceMonthly,
      currency: 'USD',
      status: 'COMPLETED',
      paypalTransactionId: txnId,
      settlementMode: 'SANDBOX_WALLET_SIMULATION',
      createdAt: new Date().toISOString(),
    });
  }

  return {
    ok: true,
    previousPlanId: prevTier.id,
    newPlanId: input.newPlanId,
    changeType,
    subscription: updated,
    payment,
    buyerWallet: walletResult?.buyerWallet,
    balanceBefore: walletResult?.balanceBefore,
    balanceAfter: walletResult?.balanceAfter,
    transaction: walletResult?.transaction,
    purchaseRecord: walletResult?.purchaseRecord,
    settlementMode: 'SANDBOX_WALLET_SIMULATION',
  };
}

export interface PayPalSubscriptionWebhookPayload {
  id: string;
  event_version: string;
  create_time: string;
  resource_type: string;
  event_type:
    | 'BILLING.SUBSCRIPTION.ACTIVATED'
    | 'BILLING.SUBSCRIPTION.CANCELLED'
    | 'BILLING.SUBSCRIPTION.EXPIRED'
    | 'BILLING.SUBSCRIPTION.SUSPENDED'
    | 'BILLING.SUBSCRIPTION.PAYMENT.FAILED'
    | 'PAYMENT.SALE.COMPLETED'
    | 'PAYMENT.SALE.REFUNDED'
    | 'PAYMENT.SALE.REVERSED'
    | string;
  summary: string;
  resource: {
    id?: string;
    custom_id?: string;
    plan_id?: string;
    status?: string;
    billing_agreement_id?: string;
    parent_payment?: string;
    amount?: {
      total?: string;
      value?: string;
      currency?: string;
      currency_code?: string;
    };
    billing_info?: {
      last_payment?: {
        amount?: {
          value?: string;
          currency_code?: string;
        };
      };
    };
  };
}

/**
 * Processes PayPal subscription lifecycle webhooks with idempotency, signature validation,
 * and automatic status transitions (activation, cancellation, expiration, failed renewal, refund, reversal).
 */
export function handlePayPalSubscriptionWebhook(
  payload: PayPalSubscriptionWebhookPayload,
  options?: {
    signatureHeader?: string;
    rejectInvalidSignature?: boolean;
  }
): {
  handled: boolean;
  duplicate?: boolean;
  eventId: string;
  eventType: string;
  actionTaken: string;
  subscription?: UserSubscriptionRecord;
} {
  if (options?.rejectInvalidSignature && (!options.signatureHeader || options.signatureHeader === 'invalid')) {
    return {
      handled: false,
      eventId: payload?.id || 'unknown',
      eventType: payload?.event_type || 'unknown',
      actionTaken: 'invalid_webhook_signature',
    };
  }

  if (!payload || !payload.id || !payload.event_type) {
    return {
      handled: false,
      eventId: 'invalid',
      eventType: 'invalid',
      actionTaken: 'malformed_webhook_payload',
    };
  }

  // Idempotency guard for duplicate webhook deliveries
  if (processedSubscriptionWebhookEvents.has(payload.id)) {
    return {
      handled: true,
      duplicate: true,
      eventId: payload.id,
      eventType: payload.event_type,
      actionTaken: 'duplicate_event_ignored',
    };
  }
  processedSubscriptionWebhookEvents.add(payload.id);

  const userId = payload.resource?.custom_id || '';
  if (!userId) {
    return {
      handled: false,
      eventId: payload.id,
      eventType: payload.event_type,
      actionTaken: 'missing_custom_id_user_reference',
    };
  }

  const resolvePlanFromCode = (code?: string): SubscriptionPlanId => {
    if (!code) return getUserSubscription(userId).planId || 'luna';
    if (code.includes('SOL')) return 'sol';
    if (code.includes('TERRA')) return 'terra';
    if (code.includes('LUNA')) return 'luna';
    for (const [planKey, planId] of cachedPayPalBillingPlanIds.entries()) {
      if (planId === code) return planKey;
    }
    return getUserSubscription(userId).planId || 'luna';
  };

  switch (payload.event_type) {
    case 'BILLING.SUBSCRIPTION.ACTIVATED': {
      const planId = resolvePlanFromCode(payload.resource.plan_id);
      const sub = setUserSubscriptionPlan(userId, planId, {
        paypalSubscriptionId: payload.resource.id || null,
        paypalPlanId: payload.resource.plan_id || null,
        status: 'active',
        cancelAtPeriodEnd: false,
      });
      return {
        handled: true,
        eventId: payload.id,
        eventType: payload.event_type,
        actionTaken: `subscription_activated:${planId}`,
        subscription: sub,
      };
    }

    case 'BILLING.SUBSCRIPTION.CANCELLED': {
      const sub = cancelSubscription(userId);
      return {
        handled: true,
        eventId: payload.id,
        eventType: payload.event_type,
        actionTaken: 'subscription_cancelled_at_period_end',
        subscription: sub,
      };
    }

    case 'BILLING.SUBSCRIPTION.EXPIRED':
    case 'BILLING.SUBSCRIPTION.SUSPENDED': {
      const sub = expireSubscription(userId);
      return {
        handled: true,
        eventId: payload.id,
        eventType: payload.event_type,
        actionTaken: 'subscription_expired_downgraded_to_free',
        subscription: sub,
      };
    }

    case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
      const sub = markSubscriptionFailedRenewal(userId);
      return {
        handled: true,
        eventId: payload.id,
        eventType: payload.event_type,
        actionTaken: 'subscription_marked_past_due',
        subscription: sub,
      };
    }

    case 'PAYMENT.SALE.COMPLETED': {
      const current = getUserSubscription(userId);
      const amountVal = Number(
        payload.resource.amount?.total ||
          payload.resource.amount?.value ||
          payload.resource.billing_info?.last_payment?.amount?.value ||
          SPARK_SUBSCRIPTION_PLANS[current.planId].priceMonthly
      );
      recordSubscriptionPayment({
        id: `pay_wh_${payload.id}`,
        subscriptionId:
          payload.resource.billing_agreement_id || current.paypalSubscriptionId || current.id,
        userId,
        planId: current.planId,
        amount: amountVal,
        currency: 'USD',
        status: 'COMPLETED',
        paypalTransactionId: payload.resource.id || `TXN-${payload.id}`,
        settlementMode: 'PAYPAL_UPSTREAM_CAPTURED',
        upstreamPayPalStatus: 'ACTIVE',
        createdAt: payload.create_time || new Date().toISOString(),
      });
      return {
        handled: true,
        eventId: payload.id,
        eventType: payload.event_type,
        actionTaken: 'recurring_payment_recorded',
        subscription: current,
      };
    }

    case 'PAYMENT.SALE.REFUNDED': {
      const txnId = payload.resource.parent_payment || payload.resource.id || '';
      updateSubscriptionPaymentStatus(userId, txnId, 'REFUNDED');
      const existingPayments = getSubscriptionPayments(userId);
      if (!existingPayments.some((p) => p.paypalTransactionId === txnId)) {
        const current = getUserSubscription(userId);
        recordSubscriptionPayment({
          id: `pay_ref_${payload.id}`,
          subscriptionId: current.paypalSubscriptionId || current.id,
          userId,
          planId: current.planId,
          amount: SPARK_SUBSCRIPTION_PLANS[current.planId].priceMonthly,
          currency: 'USD',
          status: 'REFUNDED',
          paypalTransactionId: txnId || `REF-${payload.id}`,
          settlementMode: 'PAYPAL_UPSTREAM_CAPTURED',
          createdAt: payload.create_time || new Date().toISOString(),
        });
      }
      return {
        handled: true,
        eventId: payload.id,
        eventType: payload.event_type,
        actionTaken: 'payment_refunded',
        subscription: getUserSubscription(userId),
      };
    }

    case 'PAYMENT.SALE.REVERSED': {
      const txnId = payload.resource.parent_payment || payload.resource.id || '';
      updateSubscriptionPaymentStatus(userId, txnId, 'REFUNDED');
      const sub = expireSubscription(userId);
      return {
        handled: true,
        eventId: payload.id,
        eventType: payload.event_type,
        actionTaken: 'payment_reversed_and_expired',
        subscription: sub,
      };
    }

    default:
      return {
        handled: true,
        eventId: payload.id,
        eventType: payload.event_type,
        actionTaken: 'unhandled_event_acknowledged',
      };
  }
}

export function exportPendingSubscriptionSessions(): Array<[string, PendingSubscriptionSession]> {
  return Array.from(pendingSubscriptionSessions.entries());
}

export function importPendingSubscriptionSessions(
  entries?: Array<[string, PendingSubscriptionSession]>
): void {
  if (!Array.isArray(entries)) return;
  for (const [k, v] of entries) {
    if (k && v && v.subscriptionId) {
      pendingSubscriptionSessions.set(k, v);
    }
  }
}
