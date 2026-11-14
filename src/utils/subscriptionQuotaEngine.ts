import type {
  AgGridWorkspaceView,
  SubscriptionPaymentRecord,
  SubscriptionPlanId,
  SubscriptionQuotaStatus,
  SubscriptionStatus,
  SubscriptionTierConfig,
  UserSubscriptionRecord,
  UserUsageQuotaRecord,
} from '../types/spark.ts';

export type QuotaFeatureType = 'search' | 'analysis' | 'coupon' | 'workflow';

export type SubscriptionSettlementMode =
  | 'PAYPAL_UPSTREAM_CAPTURED'
  | 'SANDBOX_WALLET_SIMULATION'
  | 'FREE_TIER_NO_CHARGE';

export interface ActiveQuotaReservation {
  reservationId: string;
  userId: string;
  feature: QuotaFeatureType;
  operationId?: string;
  status: 'RESERVED' | 'COMMITTED' | 'RELEASED';
  createdAt: string;
  committedAt?: string;
  releasedAt?: string;
}

export interface ExtendedUserUsageQuotaRecord extends UserUsageQuotaRecord {
  revision: number;
  activeReservationsCount: number;
}

export interface ExtendedSubscriptionPaymentRecord extends SubscriptionPaymentRecord {
  settlementMode?: SubscriptionSettlementMode;
  upstreamPayPalStatus?: string;
  paypalOrderId?: string;
  paypalCaptureId?: string;
}

export interface FirestoreTransactionalQuotaAdapter {
  onSubscriptionCommitted?: (record: UserSubscriptionRecord) => void | Promise<void>;
  onUsageQuotaCommitted?: (record: ExtendedUserUsageQuotaRecord) => void | Promise<void>;
  onPaymentCommitted?: (record: ExtendedSubscriptionPaymentRecord) => void | Promise<void>;
}

/**
 * Spark Commercial Subscription Tiers:
 * - Free: Entry-level exploration (3 workflows/mo, 15 searches/mo)
 * - Luna ($9.99/mo): Fast personal shopping intelligence
 * - Terra ($19.99/mo): Balanced multi-source intelligence & comparisons
 * - Sol ($39.99/mo): Deep autonomous research & high concurrency
 */
export const SPARK_SUBSCRIPTION_PLANS: Record<SubscriptionPlanId, SubscriptionTierConfig> = {
  free: {
    id: 'free',
    name: 'Spark Free',
    tagline: 'Essential verified product search & basic price discovery',
    priceMonthly: 0,
    currency: 'USD',
    modelTier: 'fast',
    preferredModel: 'gemini-3-flash-preview',
    monthlySearches: 15,
    monthlyAnalyses: 5,
    monthlyCoupons: 5,
    monthlyWorkflows: 3,
    maxConcurrency: 1,
    description:
      'Explore live Channel3 catalog offers and basic product comparisons with strict anti-fabrication guarantees.',
    features: [
      '15 Live Channel3 Product Searches / month',
      '5 Multi-Product Evidence Comparisons / month',
      '5 Live Coupon Verifications / month',
      '3 Full 7-Agent Orchestration Workflows / month',
      '1 Concurrent Search Session',
    ],
    badgeColor: 'slate',
  },
  luna: {
    id: 'luna',
    name: 'Luna Plan',
    tagline: 'Fast everyday AI shopping assistant & coupon hunter',
    priceMonthly: 9.99,
    currency: 'USD',
    modelTier: 'fast',
    preferredModel: 'gemini-3-flash-preview',
    monthlySearches: 120,
    monthlyAnalyses: 30,
    monthlyCoupons: 40,
    monthlyWorkflows: 20,
    maxConcurrency: 1,
    description:
      'Designed for active shoppers who want fast, verified product recommendations and automatic coupon discovery.',
    features: [
      '120 Live Channel3 Product Searches / month',
      '30 Deep Product Spec Analyses / month',
      '40 Feedico & Merchant Coupon Verifications / month',
      '20 Full 7-Agent Orchestration Workflows / month',
      'AG Grid Interactive Product & Savings Workspace',
      '1 Concurrent Search Session',
    ],
    badgeColor: 'cyan',
  },
  terra: {
    id: 'terra',
    name: 'Terra Plan',
    tagline: 'Balanced deep comparison & Omega Decision Crucible',
    priceMonthly: 19.99,
    currency: 'USD',
    modelTier: 'balanced',
    preferredModel: 'gemini-3-flash-preview',
    monthlySearches: 600,
    monthlyAnalyses: 150,
    monthlyCoupons: 200,
    monthlyWorkflows: 100,
    maxConcurrency: 3,
    description:
      'Our most popular tier for power buyers requiring side-by-side decision matrices, scientific compound checks, and high quota limits.',
    features: [
      '600 Live Channel3 Product Searches / month',
      '150 Omega Decision Crucible Comparisons / month',
      '200 Verified Coupon & Deal Lookups / month',
      '100 Full 7-Agent Orchestration Workflows / month',
      'Full AG Grid Analytics & CSV Export',
      'Up to 3 Concurrent Agent Workflows',
    ],
    badgeColor: 'violet',
    isPopular: true,
  },
  sol: {
    id: 'sol',
    name: 'Sol Plan',
    tagline: 'Maximum autonomous intelligence, priority reasoning & enterprise scale',
    priceMonthly: 39.99,
    currency: 'USD',
    modelTier: 'deep',
    preferredModel: 'gemini-3.1-pro-preview',
    monthlySearches: 2500,
    monthlyAnalyses: 700,
    monthlyCoupons: 1000,
    monthlyWorkflows: 350,
    maxConcurrency: 5,
    description:
      'Uncompromising product intelligence powered by deep reasoning models, maximum monthly quotas, and 5x concurrent execution.',
    features: [
      '2,500 Live Channel3 Product Searches / month',
      '700 Deep Reasoning Product & Science Analyses / month',
      '1,000 Verified Coupon & Affiliate Audits / month',
      '350 Full 7-Agent Orchestration Workflows / month',
      'Unlimited AG Grid Workspace Views & Ledger Exports',
      'Up to 5 Concurrent Agent Workflows',
    ],
    badgeColor: 'amber',
  },
};

export const SUBSCRIPTION_PLANS = SPARK_SUBSCRIPTION_PLANS;

function getCurrentBillingPeriodMonth(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getNextMonthResetIso(): string {
  const now = new Date();
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
  return nextMonth.toISOString();
}

// Transactional stores with optimistic concurrency revisions (`revision`)
const subscriptionsByUserId = new Map<string, UserSubscriptionRecord>();
const usageByUserId = new Map<string, ExtendedUserUsageQuotaRecord>();
const paymentsByUserId = new Map<string, ExtendedSubscriptionPaymentRecord[]>();
const activeConcurrencyByUserId = new Map<string, number>();
const processedUsageOperations = new Set<string>();
const reservationsById = new Map<string, ActiveQuotaReservation>();
const pendingReservationQueueByUserFeature = new Map<string, string[]>();
const firestoreAdapters = new Set<FirestoreTransactionalQuotaAdapter>();

export interface UserDashboardPreferences {
  userId: string;
  defaultTab: AgGridWorkspaceView;
  pageSize: number;
  quickFilterDefault: string;
  updatedAt: string;
}

const dashboardPrefsByUserId = new Map<string, UserDashboardPreferences>();

export function registerFirestoreQuotaAdapter(
  adapter: FirestoreTransactionalQuotaAdapter
): () => void {
  firestoreAdapters.add(adapter);
  return () => {
    firestoreAdapters.delete(adapter);
  };
}

function notifySubscriptionCommitted(record: UserSubscriptionRecord): void {
  for (const adapter of firestoreAdapters) {
    try {
      void adapter.onSubscriptionCommitted?.({ ...record });
    } catch {
      // Non-blocking listener notification
    }
  }
}

function notifyUsageQuotaCommitted(record: ExtendedUserUsageQuotaRecord): void {
  for (const adapter of firestoreAdapters) {
    try {
      void adapter.onUsageQuotaCommitted?.({ ...record });
    } catch {
      // Non-blocking listener notification
    }
  }
}

function notifyPaymentCommitted(record: ExtendedSubscriptionPaymentRecord): void {
  for (const adapter of firestoreAdapters) {
    try {
      void adapter.onPaymentCommitted?.({ ...record });
    } catch {
      // Non-blocking listener notification
    }
  }
}

/**
 * Executes a synchronous atomic state transaction on a user's subscription and usage quota
 * with automatic monotonic revision increment and rollback on thrown errors.
 */
export function runAtomicQuotaTransaction<T>(
  userId: string,
  mutator: (ctx: {
    subscription: UserSubscriptionRecord;
    usage: ExtendedUserUsageQuotaRecord;
    plan: SubscriptionTierConfig;
  }) => T
): T {
  const cleanUserId = String(userId || 'anonymous').trim() || 'anonymous';
  const subSnapshot = { ...getUserSubscription(cleanUserId) };
  const usageSnapshot = { ...getUserUsageRecord(cleanUserId) };
  const effectivePlanId: SubscriptionPlanId =
    subSnapshot.status === 'active' || subSnapshot.status === 'trialing'
      ? subSnapshot.planId
      : 'free';
  const plan = SPARK_SUBSCRIPTION_PLANS[effectivePlanId] || SPARK_SUBSCRIPTION_PLANS.free;

  try {
    const result = mutator({
      subscription: subSnapshot,
      usage: usageSnapshot,
      plan,
    });
    usageSnapshot.revision = Math.max(1, (usageSnapshot.revision || 1) + 1);
    usageSnapshot.updatedAt = new Date().toISOString();
    subscriptionsByUserId.set(cleanUserId, subSnapshot);
    usageByUserId.set(cleanUserId, usageSnapshot);
    notifySubscriptionCommitted(subSnapshot);
    notifyUsageQuotaCommitted(usageSnapshot);
    return result;
  } catch (err) {
    // Roll back on any error inside the transaction
    throw err;
  }
}

export function getUserDashboardPreferences(userId: string): UserDashboardPreferences {
  const existing = dashboardPrefsByUserId.get(userId);
  if (existing) return existing;
  const fallback: UserDashboardPreferences = {
    userId,
    defaultTab: 'saved_products',
    pageSize: 10,
    quickFilterDefault: '',
    updatedAt: new Date().toISOString(),
  };
  dashboardPrefsByUserId.set(userId, fallback);
  return fallback;
}

export function saveUserDashboardPreferences(
  userId: string,
  patch: Partial<Pick<UserDashboardPreferences, 'defaultTab' | 'pageSize' | 'quickFilterDefault'>>
): UserDashboardPreferences {
  const current = getUserDashboardPreferences(userId);
  const validTabs: AgGridWorkspaceView[] = [
    'saved_products',
    'comparison_matrix',
    'purchase_ledger',
    'coupon_savings',
    'quota_usage',
  ];
  const updated: UserDashboardPreferences = {
    userId,
    defaultTab:
      patch.defaultTab && validTabs.includes(patch.defaultTab)
        ? patch.defaultTab
        : current.defaultTab,
    pageSize:
      typeof patch.pageSize === 'number' && [10, 25, 50].includes(patch.pageSize)
        ? patch.pageSize
        : current.pageSize,
    quickFilterDefault:
      typeof patch.quickFilterDefault === 'string'
        ? patch.quickFilterDefault.slice(0, 120)
        : current.quickFilterDefault,
    updatedAt: new Date().toISOString(),
  };
  dashboardPrefsByUserId.set(userId, updated);
  return updated;
}

export function getUserSubscription(userId: string): UserSubscriptionRecord {
  const existing = subscriptionsByUserId.get(userId);
  if (existing) {
    // Check if period ended for cancelled or past_due subscriptions
    if (
      (existing.status === 'cancelled' || existing.cancelAtPeriodEnd) &&
      new Date(existing.currentPeriodEnd).getTime() <= Date.now()
    ) {
      existing.status = 'expired';
      existing.planId = 'free';
      existing.cancelAtPeriodEnd = false;
      existing.updatedAt = new Date().toISOString();
      subscriptionsByUserId.set(userId, existing);
      notifySubscriptionCommitted(existing);
    }
    return existing;
  }

  const now = new Date().toISOString();
  const defaultSub: UserSubscriptionRecord = {
    id: `sub_free_${userId.slice(0, 16)}`,
    userId,
    planId: 'free',
    status: 'active',
    currentPeriodStart: now,
    currentPeriodEnd: getNextMonthResetIso(),
    cancelAtPeriodEnd: false,
    paypalSubscriptionId: null,
    paypalPlanId: null,
    createdAt: now,
    updatedAt: now,
  };
  subscriptionsByUserId.set(userId, defaultSub);
  return defaultSub;
}

export function getUserUsageRecord(userId: string): ExtendedUserUsageQuotaRecord {
  const currentMonth = getCurrentBillingPeriodMonth();
  const sub = getUserSubscription(userId);
  const existing = usageByUserId.get(userId);
  const activeCount = activeConcurrencyByUserId.get(userId) || 0;

  if (existing && existing.billingPeriodMonth === currentMonth) {
    existing.planId = sub.status === 'active' || sub.status === 'trialing' ? sub.planId : 'free';
    existing.activeWorkflowsCount = activeCount;
    return existing;
  }

  const now = new Date().toISOString();
  const fresh: ExtendedUserUsageQuotaRecord = {
    userId,
    planId: sub.status === 'active' || sub.status === 'trialing' ? sub.planId : 'free',
    billingPeriodMonth: currentMonth,
    searchesUsed: 0,
    analysesUsed: 0,
    couponsUsed: 0,
    workflowsUsed: 0,
    activeWorkflowsCount: activeCount,
    totalTokensEstimated: 0,
    totalEstimatedCostUsd: 0,
    lastResetAt: now,
    updatedAt: now,
    revision: existing ? (existing.revision || 1) + 1 : 1,
    activeReservationsCount: 0,
  };
  usageByUserId.set(userId, fresh);
  return fresh;
}

export function resetUserMonthlyQuota(
  userId: string,
  overrideMonth?: string
): ExtendedUserUsageQuotaRecord {
  const sub = getUserSubscription(userId);
  const now = new Date().toISOString();
  const previous = usageByUserId.get(userId);

  // Clear any pending reservations for this user
  for (const [resId, resEntry] of Array.from(reservationsById.entries())) {
    if (resEntry.userId === userId) {
      reservationsById.delete(resId);
    }
  }
  for (const key of Array.from(pendingReservationQueueByUserFeature.keys())) {
    if (key.startsWith(`${userId}:`)) {
      pendingReservationQueueByUserFeature.delete(key);
    }
  }

  const fresh: ExtendedUserUsageQuotaRecord = {
    userId,
    planId: sub.status === 'active' || sub.status === 'trialing' ? sub.planId : 'free',
    billingPeriodMonth: overrideMonth || getCurrentBillingPeriodMonth(),
    searchesUsed: 0,
    analysesUsed: 0,
    couponsUsed: 0,
    workflowsUsed: 0,
    activeWorkflowsCount: activeConcurrencyByUserId.get(userId) || 0,
    totalTokensEstimated: 0,
    totalEstimatedCostUsd: 0,
    lastResetAt: now,
    updatedAt: now,
    revision: previous ? (previous.revision || 1) + 1 : 1,
    activeReservationsCount: 0,
  };
  usageByUserId.set(userId, fresh);
  notifyUsageQuotaCommitted(fresh);
  return fresh;
}

export function getUserQuotaStatus(userId: string): SubscriptionQuotaStatus {
  const subscription = getUserSubscription(userId);
  const effectivePlanId: SubscriptionPlanId =
    subscription.status === 'active' || subscription.status === 'trialing'
      ? subscription.planId
      : 'free';
  const plan = SPARK_SUBSCRIPTION_PLANS[effectivePlanId] || SPARK_SUBSCRIPTION_PLANS.free;
  const usage = getUserUsageRecord(userId);

  const limits = {
    searches: plan.monthlySearches,
    analyses: plan.monthlyAnalyses,
    coupons: plan.monthlyCoupons,
    workflows: plan.monthlyWorkflows,
    concurrency: plan.maxConcurrency,
  };

  const remaining = {
    searches: Math.max(0, limits.searches - usage.searchesUsed),
    analyses: Math.max(0, limits.analyses - usage.analysesUsed),
    coupons: Math.max(0, limits.coupons - usage.couponsUsed),
    workflows: Math.max(0, limits.workflows - usage.workflowsUsed),
    concurrency: Math.max(0, limits.concurrency - usage.activeWorkflowsCount),
  };

  return {
    plan,
    subscription,
    usage,
    limits,
    remaining,
    periodResetDate: getNextMonthResetIso(),
  };
}

function getFeatureUsageAndLimit(
  usage: ExtendedUserUsageQuotaRecord,
  plan: SubscriptionTierConfig,
  feature: QuotaFeatureType
): { used: number; limit: number; label: string } {
  switch (feature) {
    case 'search':
      return {
        used: usage.searchesUsed,
        limit: plan.monthlySearches,
        label: 'monthly product searches',
      };
    case 'analysis':
      return {
        used: usage.analysesUsed,
        limit: plan.monthlyAnalyses,
        label: 'monthly deep analyses',
      };
    case 'coupon':
      return {
        used: usage.couponsUsed,
        limit: plan.monthlyCoupons,
        label: 'monthly coupon verifications',
      };
    case 'workflow':
      return {
        used: usage.workflowsUsed,
        limit: plan.monthlyWorkflows,
        label: 'monthly 7-agent workflows',
      };
  }
}

function mutateFeatureCounter(
  usage: ExtendedUserUsageQuotaRecord,
  feature: QuotaFeatureType,
  delta: 1 | -1
): void {
  switch (feature) {
    case 'search':
      usage.searchesUsed = Math.max(0, usage.searchesUsed + delta);
      break;
    case 'analysis':
      usage.analysesUsed = Math.max(0, usage.analysesUsed + delta);
      break;
    case 'coupon':
      usage.couponsUsed = Math.max(0, usage.couponsUsed + delta);
      break;
    case 'workflow':
      usage.workflowsUsed = Math.max(0, usage.workflowsUsed + delta);
      break;
  }
}

/**
 * Atomically checks AND reserves 1 quota unit for `feature` immediately inside an atomic
 * revision-locked transaction.
 *
 * Because the counter is incremented at reservation time (before async work runs), concurrent
 * requests can never pass the check simultaneously and overrun the user's plan limit.
 *
 * - When the downstream operation succeeds, `recordFeatureUsage` commits the pending reservation
 *   (adding token/cost telemetry without incrementing the counter a second time).
 * - If the downstream operation aborts/fails, `releaseFeatureQuotaReservation` (or `releaseConcurrency`
 *   when a workflow fails before completion) rolls back the reserved counter.
 */
export function reserveFeatureQuota(
  userId: string,
  feature: QuotaFeatureType,
  operationId?: string
): {
  allowed: boolean;
  remaining: number;
  limit: number;
  error?: string;
  reservationId?: string;
  revision?: number;
} {
  const cleanOpKey = operationId ? `${userId}:${feature}:${operationId.trim()}` : '';
  if (cleanOpKey && reservationsById.has(cleanOpKey)) {
    const existing = reservationsById.get(cleanOpKey)!;
    if (existing.status !== 'RELEASED') {
      const status = getUserQuotaStatus(userId);
      const { used, limit } = getFeatureUsageAndLimit(
        status.usage as ExtendedUserUsageQuotaRecord,
        status.plan,
        feature
      );
      return {
        allowed: true,
        remaining: Math.max(0, limit - used),
        limit,
        reservationId: existing.reservationId,
        revision: (status.usage as ExtendedUserUsageQuotaRecord).revision,
      };
    }
  }

  return runAtomicQuotaTransaction(userId, ({ usage, plan }) => {
    const { used, limit, label } = getFeatureUsageAndLimit(usage, plan, feature);
    if (used >= limit) {
      return {
        allowed: false,
        remaining: 0,
        limit,
        error: `You have reached your ${plan.name} limit of ${limit} ${label} for this billing period. Upgrade to Luna, Terra, or Sol to continue.`,
      };
    }

    // Atomically increment the feature counter on reservation so concurrent calls cannot overrun
    mutateFeatureCounter(usage, feature, 1);
    usage.activeReservationsCount = Math.max(0, (usage.activeReservationsCount || 0) + 1);

    const reservationId =
      cleanOpKey ||
      `res_${userId}_${feature}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const reservation: ActiveQuotaReservation = {
      reservationId,
      userId,
      feature,
      operationId,
      status: 'RESERVED',
      createdAt: new Date().toISOString(),
    };
    reservationsById.set(reservationId, reservation);

    const queueKey = `${userId}:${feature}`;
    const queue = pendingReservationQueueByUserFeature.get(queueKey) || [];
    queue.push(reservationId);
    pendingReservationQueueByUserFeature.set(queueKey, queue);

    const afterUsed = used + 1;
    return {
      allowed: true,
      remaining: Math.max(0, limit - afterUsed),
      limit,
      reservationId,
      revision: (usage.revision || 1) + 1,
    };
  });
}

/**
 * Atomically releases an uncommitted quota reservation if a workflow or operation fails before completion.
 */
export function releaseFeatureQuotaReservation(
  userId: string,
  feature: QuotaFeatureType,
  reservationId?: string
): ExtendedUserUsageQuotaRecord {
  return runAtomicQuotaTransaction(userId, ({ usage }) => {
    const queueKey = `${userId}:${feature}`;
    const queue = pendingReservationQueueByUserFeature.get(queueKey) || [];

    let targetId = reservationId;
    if (targetId && !reservationsById.has(targetId)) {
      const prefixed = `${userId}:${feature}:${targetId.trim()}`;
      if (reservationsById.has(prefixed)) {
        targetId = prefixed;
      }
    }
    if (!targetId && queue.length > 0) {
      targetId = queue[queue.length - 1];
    }

    if (!targetId) {
      return usage;
    }

    const entry = reservationsById.get(targetId);
    if (!entry || entry.userId !== userId || entry.status !== 'RESERVED') {
      return usage;
    }

    entry.status = 'RELEASED';
    entry.releasedAt = new Date().toISOString();
    reservationsById.set(targetId, entry);

    const nextQueue = queue.filter((id) => id !== targetId);
    pendingReservationQueueByUserFeature.set(queueKey, nextQueue);

    mutateFeatureCounter(usage, feature, -1);
    usage.activeReservationsCount = Math.max(0, (usage.activeReservationsCount || 1) - 1);
    return usage;
  });
}

/**
 * Atomically commits feature usage (or increments if no prior reservation exists for this operation)
 * with idempotency protection via `operationId`.
 */
export function recordFeatureUsage(
  userId: string,
  feature: QuotaFeatureType,
  estimatedTokens = 0,
  estimatedCostUsd = 0,
  operationId?: string
): ExtendedUserUsageQuotaRecord {
  if (operationId) {
    const dedupeKey = `${userId}:${feature}:${operationId}`;
    if (processedUsageOperations.has(dedupeKey)) {
      return getUserUsageRecord(userId);
    }
    processedUsageOperations.add(dedupeKey);
  }

  return runAtomicQuotaTransaction(userId, ({ usage, plan }) => {
    const queueKey = `${userId}:${feature}`;
    const queue = pendingReservationQueueByUserFeature.get(queueKey) || [];

    // Match explicit operationId reservation first, or FIFO pending reservation for this user+feature
    let matchedReservation: ActiveQuotaReservation | undefined;
    if (operationId) {
      const opKey = `${userId}:${feature}:${operationId.trim()}`;
      const byOp = reservationsById.get(opKey) || reservationsById.get(operationId.trim());
      if (byOp && byOp.userId === userId && byOp.feature === feature && byOp.status === 'RESERVED') {
        matchedReservation = byOp;
      }
    }
    if (!matchedReservation && queue.length > 0) {
      while (queue.length > 0) {
        const candidateId = queue.shift()!;
        const candidate = reservationsById.get(candidateId);
        if (
          candidate &&
          candidate.userId === userId &&
          candidate.feature === feature &&
          candidate.status === 'RESERVED'
        ) {
          matchedReservation = candidate;
          break;
        }
      }
      pendingReservationQueueByUserFeature.set(queueKey, queue);
    }

    if (matchedReservation) {
      // Counter was already atomically incremented in `reserveFeatureQuota` — commit without double-counting!
      matchedReservation.status = 'COMMITTED';
      matchedReservation.committedAt = new Date().toISOString();
      reservationsById.set(matchedReservation.reservationId, matchedReservation);
      const filteredQueue = (pendingReservationQueueByUserFeature.get(queueKey) || []).filter(
        (id) => id !== matchedReservation!.reservationId
      );
      pendingReservationQueueByUserFeature.set(queueKey, filteredQueue);
      usage.activeReservationsCount = Math.max(0, (usage.activeReservationsCount || 1) - 1);
    } else {
      // Direct call without prior reservation: enforce limit and increment atomically
      const { used, limit } = getFeatureUsageAndLimit(usage, plan, feature);
      if (used < limit) {
        mutateFeatureCounter(usage, feature, 1);
      }
    }

    usage.totalTokensEstimated += Math.max(0, estimatedTokens);
    usage.totalEstimatedCostUsd = Number(
      (usage.totalEstimatedCostUsd + Math.max(0, estimatedCostUsd)).toFixed(6)
    );
    return usage;
  });
}

export function acquireConcurrency(userId: string): {
  allowed: boolean;
  current: number;
  max: number;
  error?: string;
} {
  const status = getUserQuotaStatus(userId);
  const current = activeConcurrencyByUserId.get(userId) || 0;
  const max = status.limits.concurrency;

  if (current >= max) {
    return {
      allowed: false,
      current,
      max,
      error: `Maximum concurrent workflows (${max}) reached for your ${status.plan.name}. Please wait for your active search to complete or upgrade your tier.`,
    };
  }

  const next = current + 1;
  activeConcurrencyByUserId.set(userId, next);
  const usage = getUserUsageRecord(userId);
  usage.activeWorkflowsCount = next;
  usageByUserId.set(userId, usage);
  return { allowed: true, current: next, max };
}

export function releaseConcurrency(userId: string): void {
  const current = activeConcurrencyByUserId.get(userId) || 0;
  const next = Math.max(0, current - 1);
  activeConcurrencyByUserId.set(userId, next);
  const usage = getUserUsageRecord(userId);
  usage.activeWorkflowsCount = next;
  usageByUserId.set(userId, usage);
}

export function setUserSubscriptionPlan(
  userId: string,
  planId: SubscriptionPlanId,
  options?: {
    paypalSubscriptionId?: string | null;
    paypalPlanId?: string | null;
    status?: SubscriptionStatus;
    cancelAtPeriodEnd?: boolean;
  }
): UserSubscriptionRecord {
  return runAtomicQuotaTransaction(userId, ({ subscription: current, usage }) => {
    const now = new Date().toISOString();
    current.id =
      options?.paypalSubscriptionId ||
      (current.id.startsWith('sub_free_') ? `sub_${planId}_${userId.slice(0, 12)}` : current.id);
    current.userId = userId;
    current.planId = planId;
    current.status = options?.status || 'active';
    current.currentPeriodStart = now;
    current.currentPeriodEnd = getNextMonthResetIso();
    current.cancelAtPeriodEnd = options?.cancelAtPeriodEnd ?? false;
    current.paypalSubscriptionId =
      options?.paypalSubscriptionId !== undefined
        ? options.paypalSubscriptionId
        : current.paypalSubscriptionId;
    current.paypalPlanId =
      options?.paypalPlanId !== undefined ? options.paypalPlanId : current.paypalPlanId;
    current.updatedAt = now;

    usage.planId =
      current.status === 'active' || current.status === 'trialing' ? planId : 'free';

    return { ...current };
  });
}

export function cancelSubscription(userId: string): UserSubscriptionRecord {
  return runAtomicQuotaTransaction(userId, ({ subscription: current }) => {
    current.cancelAtPeriodEnd = true;
    current.status = 'cancelled';
    current.updatedAt = new Date().toISOString();
    return { ...current };
  });
}

export function expireSubscription(userId: string): UserSubscriptionRecord {
  return runAtomicQuotaTransaction(userId, ({ subscription: current, usage }) => {
    current.status = 'expired';
    current.planId = 'free';
    current.cancelAtPeriodEnd = false;
    current.updatedAt = new Date().toISOString();
    usage.planId = 'free';
    return { ...current };
  });
}

export function markSubscriptionFailedRenewal(userId: string): UserSubscriptionRecord {
  return runAtomicQuotaTransaction(userId, ({ subscription: current, usage }) => {
    current.status = 'past_due';
    current.updatedAt = new Date().toISOString();
    usage.planId = 'free';
    return { ...current };
  });
}

export function recordSubscriptionPayment(
  payment: ExtendedSubscriptionPaymentRecord
): ExtendedSubscriptionPaymentRecord {
  const list = paymentsByUserId.get(payment.userId) || [];
  const idx = list.findIndex(
    (p) => p.id === payment.id || p.paypalTransactionId === payment.paypalTransactionId
  );
  if (idx >= 0) {
    list[idx] = payment;
  } else {
    list.unshift(payment);
  }
  paymentsByUserId.set(payment.userId, list);
  notifyPaymentCommitted(payment);
  return payment;
}

export function updateSubscriptionPaymentStatus(
  userId: string,
  paypalTransactionId: string,
  status: SubscriptionPaymentRecord['status']
): ExtendedSubscriptionPaymentRecord | null {
  const list = paymentsByUserId.get(userId) || [];
  const found = list.find(
    (p) => p.paypalTransactionId === paypalTransactionId || p.id === paypalTransactionId
  );
  if (!found) return null;
  found.status = status;
  paymentsByUserId.set(userId, list);
  notifyPaymentCommitted(found);
  return found;
}

export function getSubscriptionPayments(userId: string): ExtendedSubscriptionPaymentRecord[] {
  return paymentsByUserId.get(userId) || [];
}

export function exportAllSubscriptionData(): {
  subscriptions: Array<[string, UserSubscriptionRecord]>;
  usage: Array<[string, ExtendedUserUsageQuotaRecord]>;
  payments: Array<[string, ExtendedSubscriptionPaymentRecord[]]>;
  dashboardPreferences: Array<[string, UserDashboardPreferences]>;
} {
  return {
    subscriptions: Array.from(subscriptionsByUserId.entries()),
    usage: Array.from(usageByUserId.entries()),
    payments: Array.from(paymentsByUserId.entries()),
    dashboardPreferences: Array.from(dashboardPrefsByUserId.entries()),
  };
}

export function importSubscriptionData(data?: {
  subscriptions?: Array<[string, UserSubscriptionRecord]>;
  usage?: Array<[string, Partial<ExtendedUserUsageQuotaRecord> & UserUsageQuotaRecord]>;
  payments?: Array<[string, ExtendedSubscriptionPaymentRecord[]]>;
  dashboardPreferences?: Array<[string, UserDashboardPreferences]>;
}): void {
  if (!data) return;
  if (Array.isArray(data.subscriptions)) {
    for (const [k, v] of data.subscriptions) {
      if (k && v) subscriptionsByUserId.set(k, v);
    }
  }
  if (Array.isArray(data.usage)) {
    for (const [k, v] of data.usage) {
      if (k && v) {
        usageByUserId.set(k, {
          ...v,
          activeWorkflowsCount: 0,
          revision: typeof v.revision === 'number' && v.revision >= 1 ? v.revision : 1,
          activeReservationsCount: 0,
        });
      }
    }
  }
  if (Array.isArray(data.payments)) {
    for (const [k, v] of data.payments) {
      if (k && Array.isArray(v)) paymentsByUserId.set(k, v);
    }
  }
  if (Array.isArray(data.dashboardPreferences)) {
    for (const [k, v] of data.dashboardPreferences) {
      if (k && v) dashboardPrefsByUserId.set(k, v);
    }
  }
}

export function deleteUserSubscriptionData(userId: string): void {
  subscriptionsByUserId.delete(userId);
  usageByUserId.delete(userId);
  paymentsByUserId.delete(userId);
  activeConcurrencyByUserId.delete(userId);
  dashboardPrefsByUserId.delete(userId);
  for (const [resId, entry] of Array.from(reservationsById.entries())) {
    if (entry.userId === userId) {
      reservationsById.delete(resId);
    }
  }
  for (const key of Array.from(pendingReservationQueueByUserFeature.keys())) {
    if (key.startsWith(`${userId}:`)) {
      pendingReservationQueueByUserFeature.delete(key);
    }
  }
}
