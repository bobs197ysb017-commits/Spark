import {
  SubscriptionPaymentRecord,
  SubscriptionPlanId,
  SubscriptionQuotaStatus,
  SubscriptionTierConfig,
  UserSubscriptionRecord,
  UserUsageQuotaRecord,
} from '../types/spark';

// ============================================================================
// 1. SUBSCRIPTION PLANS SPECIFICATION (LUNA, TERRA, SOL, FREE)
// ============================================================================

export const SPARK_SUBSCRIPTION_PLANS: Record<SubscriptionPlanId, SubscriptionTierConfig> = {
  free: {
    id: 'free',
    name: 'Free Trial',
    tagline: 'Basic catalog exploration for occasional shoppers',
    priceMonthly: 0,
    currency: 'USD',
    modelTier: 'fast',
    preferredModel: 'Standard Catalog Engine',
    monthlySearches: 15,
    monthlyAnalyses: 5,
    monthlyCoupons: 10,
    monthlyWorkflows: 3,
    maxConcurrency: 1,
    description: 'Entry-level exploration with live price verification and source attribution.',
    features: [
      '15 verified product searches/mo',
      '5 deep product analyses/mo',
      '10 verified coupon checks/mo',
      '3 comparison workflows/mo',
      '1 concurrent search execution',
      'Standard community support',
    ],
    badgeColor: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    isPopular: false,
  },
  luna: {
    id: 'luna',
    name: 'LUNA — Essential Catalog',
    tagline: 'Streamlined product search & coupon discovery for active buyers',
    priceMonthly: 9.99,
    currency: 'USD',
    modelTier: 'fast',
    preferredModel: 'Luna High-Speed Search Engine',
    monthlySearches: 120,
    monthlyAnalyses: 30,
    monthlyCoupons: 40,
    monthlyWorkflows: 20,
    maxConcurrency: 1,
    description: 'Essential real-time catalog discovery for individuals shopping across multiple merchants.',
    features: [
      '120 verified product searches/mo',
      '30 deep ingredient & spec analyses/mo',
      '40 verified coupon checks/mo',
      '20 comparison workflows/mo',
      '1 concurrent search execution',
      'Channel3 Product Graph enrichment',
      'Tabular analytics workspace',
      'PayPal buyer protection integration',
    ],
    badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    isPopular: false,
  },
  terra: {
    id: 'terra',
    name: 'TERRA — Advanced Catalog',
    tagline: 'Multi-merchant comparison for power shoppers & analysts',
    priceMonthly: 19.99,
    currency: 'USD',
    modelTier: 'balanced',
    preferredModel: 'Terra Multi-Merchant Search Engine',
    monthlySearches: 600,
    monthlyAnalyses: 150,
    monthlyCoupons: 200,
    monthlyWorkflows: 100,
    maxConcurrency: 3,
    description: 'Comprehensive product discovery suite with high-volume search and parallel comparisons.',
    features: [
      '600 verified product searches/mo',
      '150 deep ingredient & spec analyses/mo',
      '200 verified coupon checks/mo',
      '100 comparison workflows/mo',
      '3 concurrent search executions',
      'Multi-merchant price comparison',
      'Full tabular analytics with CSV exports',
      'Priority price freshness monitoring',
      'Dedicated sandbox validation suite',
    ],
    badgeColor: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
    isPopular: true,
  },
  sol: {
    id: 'sol',
    name: 'SOL — Enterprise Catalog',
    tagline: 'Maximum catalog capacity with deep comparison & maximum concurrency',
    priceMonthly: 39.99,
    currency: 'USD',
    modelTier: 'deep',
    preferredModel: 'Sol Enterprise Catalog Engine',
    monthlySearches: 2500,
    monthlyAnalyses: 700,
    monthlyCoupons: 1000,
    monthlyWorkflows: 350,
    maxConcurrency: 5,
    description: 'Enterprise-grade product catalog access for high-frequency purchasing, research, and bulk comparisons.',
    features: [
      '2,500 verified product searches/mo',
      '700 deep ingredient & spec analyses/mo',
      '1,000 verified coupon checks/mo',
      '350 comparison workflows/mo',
      '5 concurrent search executions',
      'Bulk multi-merchant catalog comparison',
      'Unlimited tabular analytics views & matrix pivots',
      'Fastest API latency routing',
      'VIP priority execution queue',
    ],
    badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    isPopular: false,
  },
};

// ============================================================================
// 2. IN-MEMORY RUNTIME STATE & QUOTA ENGINE
// ============================================================================

const subscriptionsByUser = new Map<string, UserSubscriptionRecord>();
const usageRecordsByUserMonth = new Map<string, UserUsageQuotaRecord>();
const activeConcurrencyByUser = new Map<string, number>();
const subscriptionPayments: SubscriptionPaymentRecord[] = [];

/**
 * Returns current billing period key, e.g. "2026-11".
 */
export function getCurrentBillingPeriod(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Formats standard next reset date for the end of the current UTC calendar month.
 */
export function getBillingPeriodResetDate(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const nextMonthFirst = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0));
  return nextMonthFirst.toISOString();
}

/**
 * Retrieve or initialize user subscription record.
 */
export function getUserSubscription(userId: string): UserSubscriptionRecord {
  const cleanId = (userId || 'anonymous').trim();
  let sub = subscriptionsByUser.get(cleanId);
  if (!sub) {
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const periodEnd = getBillingPeriodResetDate(now);
    sub = {
      id: `sub_${cleanId}_${Date.now()}`,
      userId: cleanId,
      planId: 'free',
      status: 'active',
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      paypalSubscriptionId: null,
      paypalPlanId: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    subscriptionsByUser.set(cleanId, sub);
    return sub;
  }

  // Automatically expire paid or cancelled-at-period-end subscriptions once period end elapses
  if (sub.planId !== 'free' && sub.currentPeriodEnd) {
    const endMs = Date.parse(sub.currentPeriodEnd);
    if (Number.isFinite(endMs) && endMs <= Date.now()) {
      return expireSubscription(cleanId);
    }
  }

  return sub;
}

/**
 * Retrieve or initialize usage record for the user's active billing month.
 */
export function getUserUsageRecord(userId: string): UserUsageQuotaRecord {
  const cleanId = (userId || 'anonymous').trim();
  const period = getCurrentBillingPeriod();
  const key = `${cleanId}:${period}`;

  let record = usageRecordsByUserMonth.get(key);
  if (!record) {
    const sub = getUserSubscription(cleanId);
    record = {
      userId: cleanId,
      planId: sub.planId,
      billingPeriodMonth: period,
      searchesUsed: 0,
      analysesUsed: 0,
      couponsUsed: 0,
      workflowsUsed: 0,
      activeWorkflowsCount: activeConcurrencyByUser.get(cleanId) || 0,
      totalTokensEstimated: 0,
      totalEstimatedCostUsd: 0,
      lastResetAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    usageRecordsByUserMonth.set(key, record);
  } else {
    record.activeWorkflowsCount = activeConcurrencyByUser.get(cleanId) || 0;
  }
  return record;
}

/**
 * Get unified quota status with plan limits and remaining balance.
 */
export function getUserQuotaStatus(userId: string): SubscriptionQuotaStatus {
  const sub = getUserSubscription(userId);
  const plan = SPARK_SUBSCRIPTION_PLANS[sub.planId] || SPARK_SUBSCRIPTION_PLANS.free;
  const usage = getUserUsageRecord(userId);
  const activeConcurrency = activeConcurrencyByUser.get(userId) || 0;

  const remainingSearches = Math.max(0, plan.monthlySearches - usage.searchesUsed);
  const remainingAnalyses = Math.max(0, plan.monthlyAnalyses - usage.analysesUsed);
  const remainingCoupons = Math.max(0, plan.monthlyCoupons - usage.couponsUsed);
  const remainingWorkflows = Math.max(0, plan.monthlyWorkflows - usage.workflowsUsed);
  const remainingConcurrency = Math.max(0, plan.maxConcurrency - activeConcurrency);

  return {
    plan,
    subscription: sub,
    usage: {
      ...usage,
      activeWorkflowsCount: activeConcurrency,
    },
    limits: {
      searches: plan.monthlySearches,
      analyses: plan.monthlyAnalyses,
      coupons: plan.monthlyCoupons,
      workflows: plan.monthlyWorkflows,
      concurrency: plan.maxConcurrency,
    },
    remaining: {
      searches: remainingSearches,
      analyses: remainingAnalyses,
      coupons: remainingCoupons,
      workflows: remainingWorkflows,
      concurrency: remainingConcurrency,
    },
    periodResetDate: sub.currentPeriodEnd || getBillingPeriodResetDate(),
  };
}

/**
 * Atomically checks and reserves quota before executing an action.
 */
export function reserveFeatureQuota(
  userId: string,
  feature: 'search' | 'analysis' | 'coupon' | 'workflow'
): { allowed: boolean; remaining: number; limit: number; error?: string } {
  const status = getUserQuotaStatus(userId);
  let used = 0;
  let limit = 0;

  switch (feature) {
    case 'search':
      used = status.usage.searchesUsed;
      limit = status.limits.searches;
      break;
    case 'analysis':
      used = status.usage.analysesUsed;
      limit = status.limits.analyses;
      break;
    case 'coupon':
      used = status.usage.couponsUsed;
      limit = status.limits.coupons;
      break;
    case 'workflow':
      used = status.usage.workflowsUsed;
      limit = status.limits.workflows;
      break;
  }

  if (used >= limit) {
    return {
      allowed: false,
      remaining: 0,
      limit,
      error: `Monthly quota exceeded for ${feature}s (${used}/${limit}). Upgrade your plan (Luna, Terra, Sol) to increase limits.`,
    };
  }

  return {
    allowed: true,
    remaining: limit - used,
    limit,
  };
}

/**
 * Concurrency Limiter: Acquire execution slot for an agent workflow.
 */
export function acquireConcurrency(userId: string): {
  allowed: boolean;
  current: number;
  max: number;
  error?: string;
} {
  const cleanId = (userId || 'anonymous').trim();
  const sub = getUserSubscription(cleanId);
  const plan = SPARK_SUBSCRIPTION_PLANS[sub.planId] || SPARK_SUBSCRIPTION_PLANS.free;
  const current = activeConcurrencyByUser.get(cleanId) || 0;

  if (current >= plan.maxConcurrency) {
    return {
      allowed: false,
      current,
      max: plan.maxConcurrency,
      error: `Concurrency limit reached (${current}/${plan.maxConcurrency} active workflows). Wait for current workflows to complete or upgrade your plan.`,
    };
  }

  const updated = current + 1;
  activeConcurrencyByUser.set(cleanId, updated);
  return {
    allowed: true,
    current: updated,
    max: plan.maxConcurrency,
  };
}

/**
 * Concurrency Limiter: Release execution slot when workflow completes or errors.
 */
export function releaseConcurrency(userId: string): void {
  const cleanId = (userId || 'anonymous').trim();
  const current = activeConcurrencyByUser.get(cleanId) || 0;
  if (current <= 1) {
    activeConcurrencyByUser.delete(cleanId);
  } else {
    activeConcurrencyByUser.set(cleanId, current - 1);
  }
}

const recordedOperationIds = new Set<string>();
const dashboardPreferencesByUser = new Map<
  string,
  {
    defaultTab: string;
    pageSize: number;
    quickFilterDefault?: string;
    updatedAt: string;
  }
>();


/**
 * Record actual usage after successful execution with idempotency protection.
 */
export function recordFeatureUsage(
  userId: string,
  feature: 'search' | 'analysis' | 'coupon' | 'workflow',
  tokens = 0,
  costUsd = 0,
  operationId?: string
): UserUsageQuotaRecord {
  const usage = getUserUsageRecord(userId);
  if (operationId) {
    const dedupKey = `${userId}:${feature}:${operationId}`;
    if (recordedOperationIds.has(dedupKey)) {
      return usage;
    }
    recordedOperationIds.add(dedupKey);
  }

  switch (feature) {
    case 'search':
      usage.searchesUsed += 1;
      break;
    case 'analysis':
      usage.analysesUsed += 1;
      break;
    case 'coupon':
      usage.couponsUsed += 1;
      break;
    case 'workflow':
      usage.workflowsUsed += 1;
      break;
  }

  if (tokens > 0) {
    usage.totalTokensEstimated += tokens;
  }
  if (costUsd > 0) {
    usage.totalEstimatedCostUsd = Number((usage.totalEstimatedCostUsd + costUsd).toFixed(4));
  }
  usage.updatedAt = new Date().toISOString();
  return usage;
}

/**
 * Explicitly reset user's monthly quota for a new billing cycle while preserving historical records.
 */
export function resetUserMonthlyQuota(
  userId: string,
  newPeriodMonth: string = getCurrentBillingPeriod()
): UserUsageQuotaRecord {
  const cleanId = (userId || 'anonymous').trim();
  const sub = getUserSubscription(cleanId);
  const key = `${cleanId}:${newPeriodMonth}`;
  const freshRecord: UserUsageQuotaRecord = {
    userId: cleanId,
    planId: sub.status === 'expired' ? 'free' : sub.planId,
    billingPeriodMonth: newPeriodMonth,
    searchesUsed: 0,
    analysesUsed: 0,
    couponsUsed: 0,
    workflowsUsed: 0,
    activeWorkflowsCount: activeConcurrencyByUser.get(cleanId) || 0,
    totalTokensEstimated: 0,
    totalEstimatedCostUsd: 0,
    lastResetAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  usageRecordsByUserMonth.set(key, freshRecord);
  return freshRecord;
}

/**
 * Update or activate user subscription plan (handles activation, upgrade, and downgrade).
 */
export function setUserSubscriptionPlan(
  userId: string,
  planId: SubscriptionPlanId,
  paypalSubscriptionId: string | null = null,
  paypalPlanId: string | null = null
): UserSubscriptionRecord {
  const cleanId = (userId || 'anonymous').trim();
  const sub = getUserSubscription(cleanId);
  const now = new Date();
  const periodEnd = getBillingPeriodResetDate(now);

  sub.planId = planId;
  sub.status = 'active';
  sub.cancelAtPeriodEnd = false;
  sub.currentPeriodStart = now.toISOString();
  sub.currentPeriodEnd = periodEnd;
  if (paypalSubscriptionId !== null) {
    sub.paypalSubscriptionId = paypalSubscriptionId;
  }
  if (paypalPlanId !== null) {
    sub.paypalPlanId = paypalPlanId;
  }
  sub.updatedAt = now.toISOString();

  // Also update usage planId
  const usage = getUserUsageRecord(cleanId);
  usage.planId = planId;
  usage.updatedAt = now.toISOString();

  subscriptionsByUser.set(cleanId, sub);
  return sub;
}

/**
 * Mark subscription cancelled (active until currentPeriodEnd).
 */
export function cancelSubscription(userId: string): UserSubscriptionRecord {
  const cleanId = (userId || 'anonymous').trim();
  const sub = getUserSubscription(cleanId);
  sub.cancelAtPeriodEnd = true;
  sub.status = 'cancelled';
  sub.updatedAt = new Date().toISOString();
  subscriptionsByUser.set(cleanId, sub);
  return sub;
}

/**
 * Handle subscription expiration at end of period: downgrades active quota tier to free
 * without restricting user access to their saved data.
 */
export function expireSubscription(userId: string): UserSubscriptionRecord {
  const cleanId = (userId || 'anonymous').trim();
  const sub = getUserSubscription(cleanId);
  sub.status = 'expired';
  sub.planId = 'free';
  sub.cancelAtPeriodEnd = false;
  sub.updatedAt = new Date().toISOString();
  const usage = getUserUsageRecord(cleanId);
  usage.planId = 'free';
  usage.updatedAt = new Date().toISOString();
  subscriptionsByUser.set(cleanId, sub);
  return sub;
}

/**
 * Handle failed subscription renewal (marks status past_due).
 */
export function markSubscriptionFailedRenewal(userId: string): UserSubscriptionRecord {
  const cleanId = (userId || 'anonymous').trim();
  const sub = getUserSubscription(cleanId);
  sub.status = 'past_due';
  sub.updatedAt = new Date().toISOString();
  subscriptionsByUser.set(cleanId, sub);
  return sub;
}

/**
 * Record a billing ledger entry for payment history in AG Grid.
 */
export function recordSubscriptionPayment(record: SubscriptionPaymentRecord): void {
  subscriptionPayments.unshift(record);
}

/**
 * Update status of an existing subscription payment (e.g., REFUNDED or FAILED).
 */
export function updateSubscriptionPaymentStatus(
  paypalTransactionId: string,
  status: 'COMPLETED' | 'PENDING' | 'FAILED' | 'REFUNDED'
): SubscriptionPaymentRecord | null {
  const found = subscriptionPayments.find(
    (p) => p.paypalTransactionId === paypalTransactionId || p.id === paypalTransactionId
  );
  if (found) {
    found.status = status;
    return found;
  }
  return null;
}

/**
 * Retrieve payment history for user.
 */
export function getSubscriptionPayments(userId?: string): SubscriptionPaymentRecord[] {
  if (!userId) return [...subscriptionPayments];
  return subscriptionPayments.filter((p) => p.userId === userId);
}

/**
 * Save and retrieve persistent AG Grid dashboard preferences per user.
 */
export function saveUserDashboardPreferences(
  userId: string,
  prefs: { defaultTab: string; pageSize: number; quickFilterDefault?: string }
) {
  const cleanId = (userId || 'anonymous').trim();
  const record = {
    defaultTab: prefs.defaultTab || 'saved_products',
    pageSize: Number(prefs.pageSize) || 10,
    quickFilterDefault: prefs.quickFilterDefault || '',
    updatedAt: new Date().toISOString(),
  };
  dashboardPreferencesByUser.set(cleanId, record);
  return record;
}

export function getUserDashboardPreferences(userId: string) {
  const cleanId = (userId || 'anonymous').trim();
  return (
    dashboardPreferencesByUser.get(cleanId) || {
      defaultTab: 'saved_products',
      pageSize: 10,
      quickFilterDefault: '',
      updatedAt: new Date().toISOString(),
    }
  );
}

/**
 * Delete all subscription & quota data for a specific user (GDPR / Account Deletion).
 */
export function deleteUserSubscriptionData(userId: string): void {
  const cleanId = (userId || 'anonymous').trim();
  subscriptionsByUser.delete(cleanId);
  activeConcurrencyByUser.delete(cleanId);
  dashboardPreferencesByUser.delete(cleanId);
  for (const key of Array.from(usageRecordsByUserMonth.keys())) {
    if (key.startsWith(`${cleanId}:`)) {
      usageRecordsByUserMonth.delete(key);
    }
  }
}

/**
 * State serialization for data persistence.
 */
export function exportAllSubscriptionData() {
  return {
    subscriptions: Array.from(subscriptionsByUser.values()),
    usage: Array.from(usageRecordsByUserMonth.values()),
    payments: [...subscriptionPayments],
    dashboardPreferences: Array.from(dashboardPreferencesByUser.entries()),
  };
}

/**
 * State hydration from snapshot.
 */
export function importSubscriptionData(data?: {
  subscriptions?: UserSubscriptionRecord[];
  usage?: UserUsageQuotaRecord[];
  payments?: SubscriptionPaymentRecord[];
  dashboardPreferences?: [string, { defaultTab: string; pageSize: number; quickFilterDefault?: string; updatedAt: string }][];
}): void {
  if (!data) return;
  if (Array.isArray(data.subscriptions)) {
    for (const sub of data.subscriptions) {
      if (sub && sub.userId) {
        subscriptionsByUser.set(sub.userId, sub);
      }
    }
  }
  if (Array.isArray(data.usage)) {
    for (const rec of data.usage) {
      if (rec && rec.userId && rec.billingPeriodMonth) {
        usageRecordsByUserMonth.set(`${rec.userId}:${rec.billingPeriodMonth}`, rec);
      }
    }
  }
  if (Array.isArray(data.payments)) {
    subscriptionPayments.length = 0;
    subscriptionPayments.push(...data.payments);
  }
  if (Array.isArray(data.dashboardPreferences)) {
    for (const [uid, pref] of data.dashboardPreferences) {
      if (uid && pref) {
        dashboardPreferencesByUser.set(uid, pref);
      }
    }
  }
}
