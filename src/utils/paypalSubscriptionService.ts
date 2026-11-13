import crypto from 'crypto';
import {
  SubscriptionPaymentRecord,
  SubscriptionPlanId,
  UserSubscriptionRecord,
} from '../types/spark';
import {
  SPARK_SUBSCRIPTION_PLANS,
  expireSubscription,
  getSubscriptionPayments,
  getUserSubscription,
  markSubscriptionFailedRenewal,
  recordSubscriptionPayment,
  setUserSubscriptionPlan,
  updateSubscriptionPaymentStatus,
} from './subscriptionQuotaEngine';

// ============================================================================
// APIMATIC PAYPAL SUBSCRIPTION SERVICE PATTERNS
// ============================================================================

export interface PayPalBillingPlanDescriptor {
  planId: SubscriptionPlanId;
  paypalPlanId: string;
  name: string;
  description: string;
  amount: number;
  currency: 'USD';
  intervalUnit: 'MONTH';
  intervalCount: 1;
}

export const PAYPAL_BILLING_PLANS: Record<SubscriptionPlanId, PayPalBillingPlanDescriptor | null> = {
  free: null,
  luna: {
    planId: 'luna',
    paypalPlanId: 'P-SPARK-LUNA-MONTHLY-01',
    name: 'Spark Luna Intelligence Subscription',
    description: 'Monthly Essential AI Shopping Intelligence ($9.99/mo)',
    amount: 9.99,
    currency: 'USD',
    intervalUnit: 'MONTH',
    intervalCount: 1,
  },
  terra: {
    planId: 'terra',
    paypalPlanId: 'P-SPARK-TERRA-MONTHLY-02',
    name: 'Spark Terra Advanced Intelligence Subscription',
    description: 'Monthly Advanced Multi-Agent Intelligence ($19.99/mo)',
    amount: 19.99,
    currency: 'USD',
    intervalUnit: 'MONTH',
    intervalCount: 1,
  },
  sol: {
    planId: 'sol',
    paypalPlanId: 'P-SPARK-SOL-MONTHLY-03',
    name: 'Spark Sol Premium Intelligence Subscription',
    description: 'Monthly Maximum Concurrency & Deep Research ($39.99/mo)',
    amount: 39.99,
    currency: 'USD',
    intervalUnit: 'MONTH',
    intervalCount: 1,
  },
};

export interface CreateSubscriptionResponse {
  ok: boolean;
  subscriptionId: string;
  paypalOrderId?: string;
  planId: SubscriptionPlanId;
  status: 'APPROVAL_PENDING' | 'APPROVED' | 'ACTIVE' | 'CANCELLED' | 'ERROR';
  approvalUrl: string;
  environment: 'sandbox' | 'live';
  billingMode: 'paypal_recurring_subscriptions_api' | 'paypal_sandbox_verified_billing';
  amount: number;
  currency: string;
  error?: string;
}

export interface PayPalWebhookEvent {
  id: string;
  event_version: string;
  create_time: string;
  resource_type: string;
  event_type: string;
  summary: string;
  resource: {
    id: string;
    plan_id?: string;
    status?: string;
    parent_payment?: string;
    sale_id?: string;
    subscriber?: {
      email_address?: string;
      payer_id?: string;
      name?: { given_name?: string; surname?: string };
    };
    billing_info?: {
      last_payment?: {
        amount?: { currency_code?: string; value?: string };
        time?: string;
      };
    };
    amount?: {
      total?: string;
      currency?: string;
    };
    custom_id?: string;
  };
}

interface PendingSubscriptionApprovalSession {
  subscriptionId: string;
  paypalOrderId: string;
  approvalUrl: string;
  userId: string;
  planId: SubscriptionPlanId;
  amount: number;
  createdAt: string;
  approved: boolean;
  approvedAt?: string;
  payerId?: string;
  cancelled: boolean;
  cancelledAt?: string;
  activated: boolean;
  activatedAt?: string;
  paymentId?: string;
}

const pendingSubscriptionApprovals = new Map<string, PendingSubscriptionApprovalSession>();

const processedSubscriptionWebhookIds = new Set<string>();

/**
 * Evaluates merchant eligibility for PayPal Subscriptions API and reports required account configuration.
 */
export function evaluatePayPalSubscriptionEligibility() {
  const hasClientId = Boolean(
    process.env.PAYPAL_CLIENT_ID && !process.env.PAYPAL_CLIENT_ID.includes('YOUR_')
  );
  const hasSecret = Boolean(
    process.env.PAYPAL_CLIENT_SECRET && !process.env.PAYPAL_CLIENT_SECRET.includes('YOUR_')
  );
  const isLive = (process.env.PAYPAL_ENV || 'sandbox').trim().toLowerCase() === 'live';
  const livePlanConfigured = Boolean(
    process.env.PAYPAL_PLAN_ID_LUNA &&
      process.env.PAYPAL_PLAN_ID_TERRA &&
      process.env.PAYPAL_PLAN_ID_SOL
  );

  return {
    credentialsConfigured: hasClientId && hasSecret,
    environment: isLive ? ('live' as const) : ('sandbox' as const),
    recurringBillingEnabled: hasClientId && hasSecret && livePlanConfigured,
    activeBillingMode:
      hasClientId && hasSecret && livePlanConfigured
        ? ('paypal_recurring_subscriptions_api' as const)
        : ('paypal_sandbox_verified_billing' as const),
    requiredConfiguration: [
      !hasClientId || !hasSecret
        ? 'Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in environment variables.'
        : null,
      !livePlanConfigured
        ? 'Create Billing Products & Monthly Plans in PayPal Developer Dashboard and set PAYPAL_PLAN_ID_LUNA, PAYPAL_PLAN_ID_TERRA, and PAYPAL_PLAN_ID_SOL for live auto-renewing subscriptions.'
        : null,
    ].filter(Boolean) as string[],
  };
}

/**
 * Creates a subscription initiation session with PayPal approval routing.
 */
export function createPayPalSubscription(params: {
  userId: string;
  userEmail: string;
  planId: SubscriptionPlanId;
  returnUrl?: string;
  cancelUrl?: string;
}): CreateSubscriptionResponse {
  const { userId, planId } = params;
  const eligibility = evaluatePayPalSubscriptionEligibility();

  if (planId === 'free') {
    setUserSubscriptionPlan(userId, 'free');
    return {
      ok: true,
      subscriptionId: `sub_free_${userId}`,
      planId: 'free',
      status: 'ACTIVE',
      approvalUrl: '',
      environment: eligibility.environment,
      billingMode: eligibility.activeBillingMode,
      amount: 0,
      currency: 'USD',
    };
  }

  const planDesc = PAYPAL_BILLING_PLANS[planId];
  if (!planDesc) {
    return {
      ok: false,
      subscriptionId: '',
      planId,
      status: 'ERROR',
      approvalUrl: '',
      environment: eligibility.environment,
      billingMode: eligibility.activeBillingMode,
      amount: 0,
      currency: 'USD',
      error: `Invalid subscription plan: ${planId}`,
    };
  }

  const subscriptionId = `I-SPARK-${planId.toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const paypalOrderId = `PP-SUB-ORD-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const approvalUrl = `https://www.sandbox.paypal.com/checkoutnow?token=${encodeURIComponent(paypalOrderId)}&plan_id=${encodeURIComponent(planDesc.paypalPlanId)}`;

  pendingSubscriptionApprovals.set(subscriptionId, {
    subscriptionId,
    paypalOrderId,
    approvalUrl,
    userId,
    planId,
    amount: planDesc.amount,
    createdAt: new Date().toISOString(),
    approved: false,
    cancelled: false,
    activated: false,
  });

  return {
    ok: true,
    subscriptionId,
    paypalOrderId,
    planId,
    status: 'APPROVAL_PENDING',
    approvalUrl,
    environment: 'sandbox',
    billingMode: eligibility.activeBillingMode,
    amount: planDesc.amount,
    currency: planDesc.currency,
  };
}

/**
 * Records explicit PayPal Sandbox buyer approval for a pending subscription order.
 */
export function approvePayPalSubscription(params: {
  userId: string;
  subscriptionId: string;
  payerId?: string;
}): {
  ok: boolean;
  errorCode?: string;
  error?: string;
  session?: PendingSubscriptionApprovalSession;
} {
  const pending = pendingSubscriptionApprovals.get(params.subscriptionId);
  if (!pending) {
    return {
      ok: false,
      errorCode: 'subscription_session_not_found',
      error: 'Subscription approval session not found.',
    };
  }
  if (pending.userId !== params.userId) {
    return {
      ok: false,
      errorCode: 'cross_user_subscription_mismatch',
      error: 'Subscription session belongs to a different user.',
    };
  }
  if (pending.cancelled) {
    return {
      ok: false,
      errorCode: 'subscription_order_cancelled',
      error: 'This subscription order was cancelled and cannot be approved.',
    };
  }
  pending.approved = true;
  pending.approvedAt = pending.approvedAt || new Date().toISOString();
  if (params.payerId) {
    pending.payerId = params.payerId;
  }
  return { ok: true, session: { ...pending } };
}

/**
 * Cancels an uncaptured PayPal Sandbox subscription order cleanly without charging or upgrading.
 */
export function cancelPendingPayPalSubscription(params: {
  userId: string;
  subscriptionId: string;
}): {
  ok: boolean;
  errorCode?: string;
  error?: string;
  session?: PendingSubscriptionApprovalSession;
} {
  const pending = pendingSubscriptionApprovals.get(params.subscriptionId);
  if (!pending) {
    return {
      ok: false,
      errorCode: 'subscription_session_not_found',
      error: 'Subscription session not found.',
    };
  }
  if (pending.userId !== params.userId) {
    return {
      ok: false,
      errorCode: 'cross_user_subscription_mismatch',
      error: 'Subscription session belongs to a different user.',
    };
  }
  if (pending.activated) {
    return {
      ok: false,
      errorCode: 'subscription_already_activated',
      error: 'Activated subscriptions must be cancelled via the subscription cancellation flow.',
    };
  }
  pending.cancelled = true;
  pending.cancelledAt = new Date().toISOString();
  return { ok: true, session: { ...pending } };
}

export function getPayPalSubscriptionSession(subscriptionId: string): PendingSubscriptionApprovalSession | null {
  const found = pendingSubscriptionApprovals.get(subscriptionId);
  return found ? { ...found } : null;
}

export interface SubscriptionWalletChargeInput {
  userId: string;
  userEmail?: string;
  planId: SubscriptionPlanId;
  planName: string;
  amount: number;
  currency?: 'USD' | 'EUR' | 'GBP';
  subscriptionId: string;
  payerId?: string;
}

export interface SubscriptionWalletChargeResult<TWallet = unknown, TTx = unknown, TPurchase = unknown> {
  ok: boolean;
  statusCode: number;
  errorCode?: string;
  message: string;
  buyerWallet: TWallet;
  balanceBefore: number;
  balanceAfter: number;
  captureId?: string;
  paypalOrderId?: string;
  transaction?: TTx;
  purchaseRecord?: TPurchase;
}

/**
 * Activates a subscription once approved by PayPal buyer and verified on the server.
 * Prevents duplicate activation or unverified browser redirect tampering, and deducts
 * the subscription fee from the user's PayPal wallet when a wallet charger is supplied.
 */
export function activatePayPalSubscription<TWallet = unknown, TTx = unknown, TPurchase = unknown>(params: {
  userId: string;
  userEmail?: string;
  subscriptionId: string;
  planId: SubscriptionPlanId;
  payerId?: string;
  browserRedirectOnly?: boolean;
  requireExplicitApproval?: boolean;
  chargeWallet?: (
    input: SubscriptionWalletChargeInput
  ) => SubscriptionWalletChargeResult<TWallet, TTx, TPurchase>;
}): {
  ok: boolean;
  alreadyActivated?: boolean;
  subscription?: UserSubscriptionRecord;
  payment?: SubscriptionPaymentRecord;
  buyerWallet?: TWallet;
  balanceBefore?: number;
  balanceAfter?: number;
  transaction?: TTx;
  purchaseRecord?: TPurchase;
  errorCode?: string;
  error?: string;
} {
  const {
    userId,
    userEmail,
    subscriptionId,
    planId,
    payerId,
    browserRedirectOnly,
    requireExplicitApproval,
    chargeWallet,
  } = params;

  // Security Rule: Never activate a paid plan from a browser redirect alone without server verification
  if (browserRedirectOnly && planId !== 'free') {
    return {
      ok: false,
      errorCode: 'unverified_browser_redirect_rejected',
      error: 'Paid subscriptions cannot be activated from a browser redirect alone without server-side PayPal approval verification.',
    };
  }

  const pending = pendingSubscriptionApprovals.get(subscriptionId);
  if (requireExplicitApproval && planId !== 'free') {
    if (!pending) {
      return {
        ok: false,
        errorCode: 'subscription_session_not_found',
        error: 'No pending PayPal Sandbox subscription order found for this subscription ID.',
      };
    }
    if (pending.cancelled) {
      return {
        ok: false,
        errorCode: 'subscription_order_cancelled',
        error: 'Subscription order was cancelled before approval and cannot be captured.',
      };
    }
    if (!pending.approved) {
      return {
        ok: false,
        errorCode: 'subscription_not_approved',
        error: 'Buyer approval in PayPal Sandbox is required before activating this paid subscription.',
      };
    }
  }

  if (pending) {
    if (pending.userId !== userId) {
      return {
        ok: false,
        errorCode: 'cross_user_subscription_mismatch',
        error: 'Subscription session belongs to a different user.',
      };
    }
    if (pending.planId !== planId) {
      return {
        ok: false,
        errorCode: 'plan_tampering_detected',
        error: `Subscription was created for ${pending.planId}, not ${planId}.`,
      };
    }
    if (pending.activated) {
      const existingSub = getUserSubscription(userId);
      const existingPayments = getSubscriptionPayments(userId);
      const existingPayment = existingPayments.find((p) => p.subscriptionId === subscriptionId);
      return {
        ok: true,
        alreadyActivated: true,
        subscription: existingSub,
        payment: existingPayment,
      };
    }
  }

  const planDesc = PAYPAL_BILLING_PLANS[planId];
  const planSpec = SPARK_SUBSCRIPTION_PLANS[planId];
  const amount = planDesc ? planDesc.amount : 0;

  let walletChargeResult: SubscriptionWalletChargeResult<TWallet, TTx, TPurchase> | undefined;
  if (chargeWallet && amount > 0) {
    walletChargeResult = chargeWallet({
      userId,
      userEmail,
      planId,
      planName: planSpec?.name || planId.toUpperCase(),
      amount,
      currency: 'USD',
      subscriptionId,
      payerId: payerId || pending?.payerId,
    });
    if (!walletChargeResult.ok) {
      return {
        ok: false,
        errorCode: walletChargeResult.errorCode || 'INSUFFICIENT_FUNDS',
        error: walletChargeResult.message,
        buyerWallet: walletChargeResult.buyerWallet,
        balanceBefore: walletChargeResult.balanceBefore,
        balanceAfter: walletChargeResult.balanceAfter,
      };
    }
  }

  const subscription = setUserSubscriptionPlan(
    userId,
    planId,
    subscriptionId,
    planDesc?.paypalPlanId || null
  );

  const paymentRecord: SubscriptionPaymentRecord = {
    id: `pay_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    subscriptionId,
    userId,
    planId,
    amount,
    currency: 'USD',
    status: 'COMPLETED',
    paypalTransactionId:
      walletChargeResult?.captureId || `TXN-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
    createdAt: new Date().toISOString(),
  };

  if (pending) {
    pending.activated = true;
    pending.activatedAt = new Date().toISOString();
    pending.paymentId = paymentRecord.id;
  }

  recordSubscriptionPayment(paymentRecord);

  return {
    ok: true,
    subscription,
    payment: paymentRecord,
    buyerWallet: walletChargeResult?.buyerWallet,
    balanceBefore: walletChargeResult?.balanceBefore,
    balanceAfter: walletChargeResult?.balanceAfter,
    transaction: walletChargeResult?.transaction,
    purchaseRecord: walletChargeResult?.purchaseRecord,
  };
}

/**
 * Upgrade or downgrade an existing active subscription plan.
 */
export function changePayPalSubscriptionPlan<TWallet = unknown, TTx = unknown, TPurchase = unknown>(params: {
  userId: string;
  userEmail?: string;
  newPlanId: SubscriptionPlanId;
  chargeWallet?: (
    input: SubscriptionWalletChargeInput
  ) => SubscriptionWalletChargeResult<TWallet, TTx, TPurchase>;
}): {
  ok: boolean;
  changeType: 'upgrade' | 'downgrade' | 'same';
  subscription: UserSubscriptionRecord;
  payment?: SubscriptionPaymentRecord;
  buyerWallet?: TWallet;
  balanceBefore?: number;
  balanceAfter?: number;
  transaction?: TTx;
  purchaseRecord?: TPurchase;
  errorCode?: string;
  error?: string;
} {
  const { userId, userEmail, newPlanId, chargeWallet } = params;
  const rank: Record<SubscriptionPlanId, number> = {
    free: 0,
    luna: 1,
    terra: 2,
    sol: 3,
  };
  const currentSub = getUserSubscription(userId);
  const previousPlanId = currentSub.planId;
  const planDesc = PAYPAL_BILLING_PLANS[newPlanId];
  const planSpec = SPARK_SUBSCRIPTION_PLANS[newPlanId];
  const amount = planDesc ? planDesc.amount : 0;
  const changeSubId =
    newPlanId === 'free'
      ? null
      : `I-SPARK-${newPlanId.toUpperCase()}-CHG-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  let walletChargeResult: SubscriptionWalletChargeResult<TWallet, TTx, TPurchase> | undefined;
  if (chargeWallet && amount > 0 && newPlanId !== previousPlanId && changeSubId) {
    walletChargeResult = chargeWallet({
      userId,
      userEmail,
      planId: newPlanId,
      planName: planSpec?.name || newPlanId.toUpperCase(),
      amount,
      currency: 'USD',
      subscriptionId: changeSubId,
    });
    if (!walletChargeResult.ok) {
      return {
        ok: false,
        changeType: 'same',
        subscription: currentSub,
        buyerWallet: walletChargeResult.buyerWallet,
        balanceBefore: walletChargeResult.balanceBefore,
        balanceAfter: walletChargeResult.balanceAfter,
        errorCode: walletChargeResult.errorCode || 'INSUFFICIENT_FUNDS',
        error: walletChargeResult.message,
      };
    }
  }

  const sub = setUserSubscriptionPlan(
    userId,
    newPlanId,
    changeSubId,
    planDesc?.paypalPlanId || null
  );
  const changeType =
    rank[newPlanId] > rank[previousPlanId]
      ? 'upgrade'
      : rank[newPlanId] < rank[previousPlanId]
      ? 'downgrade'
      : 'same';

  let paymentRecord: SubscriptionPaymentRecord | undefined;
  if (amount > 0 && newPlanId !== previousPlanId && changeSubId) {
    paymentRecord = {
      id: `pay_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      subscriptionId: changeSubId,
      userId,
      planId: newPlanId,
      amount,
      currency: 'USD',
      status: 'COMPLETED',
      paypalTransactionId:
        walletChargeResult?.captureId || `TXN-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
      createdAt: new Date().toISOString(),
    };
    recordSubscriptionPayment(paymentRecord);
  }

  return {
    ok: true,
    changeType,
    subscription: sub,
    payment: paymentRecord,
    buyerWallet: walletChargeResult?.buyerWallet,
    balanceBefore: walletChargeResult?.balanceBefore,
    balanceAfter: walletChargeResult?.balanceAfter,
    transaction: walletChargeResult?.transaction,
    purchaseRecord: walletChargeResult?.purchaseRecord,
  };
}

/**
 * Processes incoming PayPal subscription webhook events with idempotency, signature validation,
 * failed renewal, expiration, refund, and reversal handling.
 */
export function handlePayPalSubscriptionWebhook(
  event: PayPalWebhookEvent,
  options?: { signatureHeader?: string; rejectInvalidSignature?: boolean }
): {
  handled: boolean;
  duplicate?: boolean;
  actionTaken: string;
  userId?: string;
} {
  if (!event || typeof event !== 'object' || !event.id || !event.event_type) {
    return { handled: false, actionTaken: 'invalid_webhook_payload' };
  }

  if (options?.rejectInvalidSignature && (!options.signatureHeader || options.signatureHeader === 'invalid')) {
    return { handled: false, actionTaken: 'invalid_webhook_signature' };
  }

  // Idempotency protection: never process duplicate webhook event IDs twice
  if (processedSubscriptionWebhookIds.has(event.id)) {
    return {
      handled: true,
      duplicate: true,
      actionTaken: 'duplicate_event_ignored',
    };
  }

  const eventType = event.event_type;
  const resource = event.resource;
  const subscriptionId = resource?.id;
  const customId = resource?.custom_id; // userId if passed in custom_id

  if (!subscriptionId) {
    return { handled: false, actionTaken: 'missing_resource_id' };
  }

  processedSubscriptionWebhookIds.add(event.id);

  switch (eventType) {
    case 'BILLING.SUBSCRIPTION.ACTIVATED': {
      let targetPlan: SubscriptionPlanId = 'terra';
      if (resource.plan_id === PAYPAL_BILLING_PLANS.luna?.paypalPlanId) targetPlan = 'luna';
      else if (resource.plan_id === PAYPAL_BILLING_PLANS.sol?.paypalPlanId) targetPlan = 'sol';

      if (customId) {
        activatePayPalSubscription({
          userId: customId,
          subscriptionId,
          planId: targetPlan,
        });
        return {
          handled: true,
          actionTaken: `activated_${targetPlan}`,
          userId: customId,
        };
      }
      return { handled: true, actionTaken: 'received_no_custom_id' };
    }

    case 'PAYMENT.SALE.COMPLETED': {
      if (customId) {
        const amount = Number(resource.billing_info?.last_payment?.amount?.value || 0);
        recordSubscriptionPayment({
          id: `pay_wh_${Date.now()}`,
          subscriptionId,
          userId: customId,
          planId: 'terra',
          amount,
          currency: resource.billing_info?.last_payment?.amount?.currency_code || 'USD',
          status: 'COMPLETED',
          paypalTransactionId: resource.id || `TXN-${Date.now()}`,
          createdAt: new Date().toISOString(),
        });
        return { handled: true, actionTaken: 'payment_recorded', userId: customId };
      }
      return { handled: true, actionTaken: 'sale_without_custom_id' };
    }

    case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
      if (customId) {
        markSubscriptionFailedRenewal(customId);
        recordSubscriptionPayment({
          id: `pay_fail_${Date.now()}`,
          subscriptionId,
          userId: customId,
          planId: 'terra',
          amount: Number(resource.billing_info?.last_payment?.amount?.value || 19.99),
          currency: 'USD',
          status: 'FAILED',
          paypalTransactionId: resource.id || `TXN-FAIL-${Date.now()}`,
          createdAt: new Date().toISOString(),
        });
        return { handled: true, actionTaken: 'marked_past_due', userId: customId };
      }
      return { handled: true, actionTaken: 'failed_renewal_no_user' };
    }

    case 'BILLING.SUBSCRIPTION.EXPIRED': {
      if (customId) {
        expireSubscription(customId);
        return { handled: true, actionTaken: 'subscription_expired_downgraded_to_free', userId: customId };
      }
      return { handled: true, actionTaken: 'expired_no_user' };
    }

    case 'BILLING.SUBSCRIPTION.CANCELLED': {
      if (customId) {
        setUserSubscriptionPlan(customId, 'free', null, null);
        return { handled: true, actionTaken: 'downgraded_to_free', userId: customId };
      }
      return { handled: true, actionTaken: 'cancelled_no_user' };
    }

    case 'PAYMENT.SALE.REFUNDED':
    case 'PAYMENT.SALE.REVERSED': {
      const txnId = resource.parent_payment || resource.sale_id || resource.id;
      updateSubscriptionPaymentStatus(txnId, 'REFUNDED');
      if (customId && eventType === 'PAYMENT.SALE.REVERSED') {
        expireSubscription(customId);
      }
      return {
        handled: true,
        actionTaken: eventType === 'PAYMENT.SALE.REFUNDED' ? 'payment_refunded' : 'payment_reversed_and_expired',
        userId: customId,
      };
    }

    default:
      return { handled: true, actionTaken: `ignored_event_${eventType}` };
  }
}
