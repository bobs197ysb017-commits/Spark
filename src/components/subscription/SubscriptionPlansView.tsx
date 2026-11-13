import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Crown,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import type {
  SandboxBuyerWalletState,
  SubscriptionPaymentRecord,
  SubscriptionPlanId,
  SubscriptionQuotaStatus,
  SubscriptionTierConfig,
  UserAccountBalanceSummary,
  UserProfile,
} from '../../types/spark';
import { buildAuthenticatedHeaders } from '../../utils/authClient';
import { syncUserSubscriptionToFirestore } from '../../firebase';

interface SubscriptionPlansViewProps {
  user: UserProfile;
  quotaStatus: SubscriptionQuotaStatus | null;
  accountBalance?: UserAccountBalanceSummary | null;
  onRefreshQuota: () => Promise<void>;
  onPlanActivated?: (
    planId: SubscriptionPlanId,
    updatedAccountBalance?: UserAccountBalanceSummary | null
  ) => void;
  onOpenAnalytics?: () => void;
}

export const SubscriptionPlansView: React.FC<SubscriptionPlansViewProps> = ({
  user,
  quotaStatus,
  accountBalance,
  onRefreshQuota,
  onPlanActivated,
  onOpenAnalytics,
}) => {
  const [selectedPlanForCheckout, setSelectedPlanForCheckout] =
    useState<SubscriptionTierConfig | null>(null);
  const [pendingSubSession, setPendingSubSession] = useState<{
    subscriptionId: string;
    paypalOrderId?: string;
    approvalUrl: string;
    planId: SubscriptionPlanId;
  } | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutSuccess, setCheckoutSuccess] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [buyerWallet, setBuyerWallet] = useState<SandboxBuyerWalletState | null>(null);
  const [subscriptionPayments, setSubscriptionPayments] = useState<SubscriptionPaymentRecord[]>([]);
  const [cancelStatusMessage, setCancelStatusMessage] = useState<string | null>(null);

  const activePlanId: SubscriptionPlanId = quotaStatus?.plan?.id || 'free';

  const fetchBuyerWallet = useCallback(async () => {
    try {
      const [meRes, analyticsRes] = await Promise.all([
        fetch(`/api/subscriptions/me?userId=${encodeURIComponent(user.id)}`, {
          headers: buildAuthenticatedHeaders({
            method: 'GET',
            extraHeaders: { 'x-spark-user-id': user.id },
          }),
          credentials: 'include',
        }),
        fetch(`/api/subscriptions/analytics?userId=${encodeURIComponent(user.id)}`, {
          headers: buildAuthenticatedHeaders({
            method: 'GET',
            extraHeaders: { 'x-spark-user-id': user.id },
          }),
          credentials: 'include',
        }),
      ]);
      if (meRes.ok) {
        const data = await meRes.json();
        if (data.buyerWallet) {
          setBuyerWallet(data.buyerWallet);
        }
        if (data.quotaStatus?.subscription) {
          const sub = data.quotaStatus.subscription;
          void syncUserSubscriptionToFirestore(user.id, {
            planId: sub.planId || 'free',
            status: sub.status || 'active',
            billingCycle: 'monthly',
            monthlyPriceUsd: data.quotaStatus.plan?.priceMonthly || 0,
            paypalSubscriptionId: sub.paypalSubscriptionId || null,
            cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd),
          });
        }
      }
      if (analyticsRes.ok) {
        const aData = await analyticsRes.json();
        if (Array.isArray(aData.payments)) {
          setSubscriptionPayments(aData.payments);
        }
      }
    } catch {
      // Ignore network fetch errors
    }
  }, [user.id]);

  useEffect(() => {
    void fetchBuyerWallet();
  }, [fetchBuyerWallet]);

  const effectiveAvailableBalance =
    buyerWallet?.availableBalance ??
    (typeof accountBalance?.availableBalance === 'number'
      ? accountBalance.availableBalance
      : 500);
  const effectiveCurrency = buyerWallet?.currency || accountBalance?.currency || 'USD';

  const plans: SubscriptionTierConfig[] = [
    {
      id: 'free',
      name: 'Free Trial',
      tagline: 'Basic catalog exploration',
      priceMonthly: 0,
      currency: 'USD',
      modelTier: 'fast',
      preferredModel: 'Standard Catalog & Price Comparison Engine',
      monthlySearches: 15,
      monthlyAnalyses: 5,
      monthlyCoupons: 10,
      monthlyWorkflows: 3,
      maxConcurrency: 1,
      description: 'Standard exploration with real-time verification and source attribution.',
      features: [
        '15 verified product searches/mo',
        '5 deep product analyses/mo',
        '10 verified coupon checks/mo',
        '3 multi-merchant comparison workflows/mo',
        '1 concurrent workflow execution',
      ],
      badgeColor: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    },
    {
      id: 'luna',
      name: 'LUNA',
      tagline: 'Essential product discovery for active online shoppers',
      priceMonthly: 9.99,
      currency: 'USD',
      modelTier: 'fast',
      preferredModel: 'High-Speed Catalog & Coupon Engine',
      monthlySearches: 120,
      monthlyAnalyses: 30,
      monthlyCoupons: 40,
      monthlyWorkflows: 20,
      maxConcurrency: 1,
      description: 'Streamlined shopping across multiple merchants with live coupon extraction.',
      features: [
        '120 verified product searches/mo',
        '30 deep ingredient & spec analyses/mo',
        '40 verified coupon checks/mo',
        '20 multi-merchant comparison workflows/mo',
        '1 concurrent workflow execution',
        'Channel3 Product Graph enrichment',
        'Tabular analytics workspace',
        'PayPal buyer protection integration',
      ],
      badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
      isPopular: false,
    },
    {
      id: 'terra',
      name: 'TERRA',
      tagline: 'Advanced Multi-Source Comparison for power buyers',
      priceMonthly: 19.99,
      currency: 'USD',
      modelTier: 'balanced',
      preferredModel: 'Balanced Multi-Merchant Comparison Engine',
      monthlySearches: 600,
      monthlyAnalyses: 150,
      monthlyCoupons: 200,
      monthlyWorkflows: 100,
      maxConcurrency: 3,
      description: 'High-volume research with parallel workflows and comprehensive matrix pivots.',
      features: [
        '600 verified product searches/mo',
        '150 deep ingredient & spec analyses/mo',
        '200 verified coupon checks/mo',
        '100 multi-merchant comparison workflows/mo',
        '3 concurrent workflow executions',
        'Multi-source catalog comparison',
        'Full tabular analytics with CSV exports',
        'Priority price freshness monitoring',
      ],
      badgeColor: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
      isPopular: true,
    },
    {
      id: 'sol',
      name: 'SOL',
      tagline: 'Premium Catalog Research with maximum concurrent capacity',
      priceMonthly: 39.99,
      currency: 'USD',
      modelTier: 'deep',
      preferredModel: 'Enterprise Catalog & Price Comparison Engine',
      monthlySearches: 2500,
      monthlyAnalyses: 700,
      monthlyCoupons: 1000,
      monthlyWorkflows: 350,
      maxConcurrency: 5,
      description: 'High-capacity catalog research with maximum concurrency and priority queueing.',
      features: [
        '2,500 verified product searches/mo',
        '700 deep ingredient & spec analyses/mo',
        '1,000 verified coupon checks/mo',
        '350 multi-merchant comparison workflows/mo',
        '5 concurrent workflow executions',
        'High-capacity multi-turn catalog comparison',
        'Unlimited tabular analytics views & matrix pivots',
        'VIP priority execution queue',
      ],
      badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      isPopular: false,
    },
  ];

  const handleStartSubscribe = (plan: SubscriptionTierConfig) => {
    setSelectedPlanForCheckout(plan);
    setPendingSubSession(null);
    setCheckoutError(null);
    setCheckoutSuccess(null);
    void fetchBuyerWallet();
  };

  const handleCloseCheckoutModal = async () => {
    if (pendingSubSession) {
      await fetch('/api/subscriptions/cancel-pending', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        credentials: 'include',
        body: JSON.stringify({
          subscriptionId: pendingSubSession.subscriptionId,
          userId: user.id,
        }),
      }).catch(() => {});
    }
    setPendingSubSession(null);
    setSelectedPlanForCheckout(null);
  };

  const handleCreateSubscriptionOrder = async () => {
    if (!selectedPlanForCheckout) return;
    setCheckoutLoading(true);
    setCheckoutError(null);

    try {
      const createRes = await fetch('/api/subscriptions/create', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        credentials: 'include',
        body: JSON.stringify({
          planId: selectedPlanForCheckout.id,
          userId: user.id,
          userEmail: user.email,
        }),
      });

      const createData = await createRes.json();
      if (!createRes.ok || !createData.ok) {
        throw new Error(createData.error || 'Failed to initialize PayPal subscription.');
      }

      if (selectedPlanForCheckout.priceMonthly === 0) {
        const activateRes = await fetch('/api/subscriptions/activate', {
          method: 'POST',
          headers: buildAuthenticatedHeaders({ method: 'POST' }),
          credentials: 'include',
          body: JSON.stringify({
            planId: selectedPlanForCheckout.id,
            subscriptionId: createData.subscriptionId,
            userId: user.id,
            userEmail: user.email,
          }),
        });
        const activateData = await activateRes.json();
        if (!activateRes.ok || !activateData.ok) {
          throw new Error(activateData.error || 'Failed to switch to Free Trial plan.');
        }
        setCheckoutSuccess('Switched to Free Trial plan. Quotas updated instantly.');
        if (onPlanActivated) {
          onPlanActivated(selectedPlanForCheckout.id, activateData.accountBalance || null);
        }
        await onRefreshQuota();
        await fetchBuyerWallet();
        setTimeout(() => {
          setPendingSubSession(null);
          setSelectedPlanForCheckout(null);
        }, 1200);
        return;
      }

      setPendingSubSession({
        subscriptionId: createData.subscriptionId,
        paypalOrderId: createData.paypalOrderId,
        approvalUrl: createData.approvalUrl,
        planId: selectedPlanForCheckout.id,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Subscription error occurred.';
      setCheckoutError(msg);
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleApproveAndActivateSubscription = async () => {
    if (!selectedPlanForCheckout || !pendingSubSession) return;
    setCheckoutLoading(true);
    setCheckoutError(null);

    try {
      const payerId = buyerWallet?.buyerAccountId || `PAYER-${user.id.slice(0, 8)}`;

      // 1. Record explicit PayPal Sandbox buyer approval
      const approveRes = await fetch('/api/subscriptions/approve', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        credentials: 'include',
        body: JSON.stringify({
          subscriptionId: pendingSubSession.subscriptionId,
          userId: user.id,
          payerId,
        }),
      });
      const approveData = await approveRes.json();
      if (!approveRes.ok || !approveData.ok) {
        throw new Error(approveData.error || 'Failed to confirm PayPal Sandbox buyer approval.');
      }

      // 2. Activate subscription & deduct plan charge from PayPal wallet
      const activateRes = await fetch('/api/subscriptions/activate', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        credentials: 'include',
        body: JSON.stringify({
          planId: selectedPlanForCheckout.id,
          subscriptionId: pendingSubSession.subscriptionId,
          userId: user.id,
          userEmail: user.email,
          payerId,
          requireExplicitApproval: true,
        }),
      });

      const activateData = await activateRes.json();
      if (activateData.buyerWallet) {
        setBuyerWallet(activateData.buyerWallet);
      }
      if (!activateRes.ok || !activateData.ok) {
        throw new Error(activateData.error || 'Failed to activate PayPal subscription.');
      }

      const newWalletBal =
        typeof activateData.balanceAfter === 'number'
          ? activateData.balanceAfter
          : typeof activateData.buyerWallet?.availableBalance === 'number'
          ? activateData.buyerWallet.availableBalance
          : Math.max(0, effectiveAvailableBalance - selectedPlanForCheckout.priceMonthly);

      setCheckoutSuccess(
        `Successfully subscribed to ${selectedPlanForCheckout.name} ($${selectedPlanForCheckout.priceMonthly.toFixed(
          2
        )}/mo)! Deducted $${selectedPlanForCheckout.priceMonthly.toFixed(
          2
        )} from your PayPal wallet — New balance: $${Number(newWalletBal).toFixed(2)} ${effectiveCurrency}.`
      );
      setPendingSubSession(null);

      if (onPlanActivated) {
        onPlanActivated(selectedPlanForCheckout.id, activateData.accountBalance || null);
      }
      await onRefreshQuota();
      await fetchBuyerWallet();
      setTimeout(() => {
        setSelectedPlanForCheckout(null);
      }, 1400);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Subscription error occurred.';
      setCheckoutError(msg);
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleCancelSubscription = async () => {
    setCancelStatusMessage(null);
    try {
      const res = await fetch('/api/subscriptions/cancel', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        credentials: 'include',
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        await onRefreshQuota();
        setCancelStatusMessage('Subscription cancellation scheduled at period end.');
      } else {
        setCancelStatusMessage('Failed to schedule cancellation.');
      }
    } catch {
      setCancelStatusMessage('Failed to schedule cancellation.');
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Spark Intelligence Subscriptions
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
              PayPal Recurring
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Choose the subscription plan that powers your shopping workflow volume, concurrency limits, and catalog comparison capacity.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Live PayPal Wallet Balance Badge */}
          <div
            data-testid="subscription-paypal-wallet-balance"
            className="inline-flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs"
          >
            <Wallet className="w-4 h-4 text-emerald-400 shrink-0" />
            <div>
              <div className="text-[10px] text-zinc-400 leading-none">PayPal Wallet Balance</div>
              <div
                data-testid="subscription-wallet-amount"
                className="font-mono font-bold text-emerald-300 text-xs mt-0.5"
              >
                ${effectiveAvailableBalance.toFixed(2)} {effectiveCurrency}
              </div>
            </div>
          </div>

          {onOpenAnalytics && (
            <button
              type="button"
              onClick={onOpenAnalytics}
              className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-xs font-medium text-zinc-200 cursor-pointer"
            >
              Open Tabular Analytics
            </button>
          )}
          <button
            type="button"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              await Promise.all([onRefreshQuota(), fetchBuyerWallet()]);
              setRefreshing(false);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-xs font-medium text-zinc-300 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh Quota
          </button>
        </div>
      </div>

      {/* Latest PayPal Wallet Deduction Ledger Entry */}
      {buyerWallet && buyerWallet.ledgerEntries.length > 0 && (
        <div
          data-testid="subscription-latest-wallet-deduction"
          className="rounded-2xl bg-emerald-500/[0.07] border border-emerald-500/20 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
        >
          <div className="flex items-center gap-2 text-emerald-300">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>
              Latest PayPal Wallet Deduction:{' '}
              <strong className="font-mono">
                -{buyerWallet.ledgerEntries[0].currency}{' '}
                {buyerWallet.ledgerEntries[0].amount.toFixed(2)}
              </strong>{' '}
              for <span className="text-white">{buyerWallet.ledgerEntries[0].productName}</span>
            </span>
          </div>
          <div className="font-mono text-[11px] text-zinc-400">
            Wallet Balance: ${buyerWallet.ledgerEntries[0].balanceBefore.toFixed(2)} →{' '}
            <span className="text-emerald-300 font-semibold">
              ${buyerWallet.ledgerEntries[0].balanceAfter.toFixed(2)} {buyerWallet.currency}
            </span>
          </div>
        </div>
      )}

      {cancelStatusMessage && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/25 px-4 py-3 text-xs text-amber-300">
          {cancelStatusMessage}
        </div>
      )}

      {/* Active Quota Monitor Panel */}
      {quotaStatus && (
        <div className="rounded-3xl bg-gradient-to-br from-[#121218] via-[#101015] to-[#0A0A0E] border border-white/[0.08] p-6 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-white/[0.06]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400">
                <Crown className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-white">
                    Current Plan: {quotaStatus.plan.name}
                  </h2>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Active
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Comparison Engine: <span className="text-violet-300 font-mono text-[11px]">{quotaStatus.plan.preferredModel}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs text-zinc-400">
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-zinc-500" />
                <span>Next Cycle Reset: {new Date(quotaStatus.periodResetDate).toLocaleDateString()}</span>
              </div>
              {activePlanId !== 'free' && (
                <button
                  type="button"
                  onClick={handleCancelSubscription}
                  className="text-xs text-red-400 hover:text-red-300 underline cursor-pointer"
                >
                  Cancel Plan
                </button>
              )}
            </div>
          </div>

          {/* Quota Progress Meters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
            {/* 1. Workflows */}
            <div className="bg-[#181820]/60 border border-white/[0.06] rounded-2xl p-4">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-zinc-400 font-medium">Comparison Workflows</span>
                <span className="font-mono font-semibold text-white">
                  {quotaStatus.usage.workflowsUsed} / {quotaStatus.limits.workflows}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-violet-500 transition-all duration-300 rounded-full"
                  style={{
                    width: `${Math.min(
                      100,
                      (quotaStatus.usage.workflowsUsed / Math.max(1, quotaStatus.limits.workflows)) * 100
                    )}%`,
                  }}
                />
              </div>
              <div className="text-[11px] text-zinc-500 mt-2 flex justify-between">
                <span>Remaining: {quotaStatus.remaining.workflows}</span>
                <span>Max Concurrency: {quotaStatus.limits.concurrency}</span>
              </div>
            </div>

            {/* 2. Searches */}
            <div className="bg-[#181820]/60 border border-white/[0.06] rounded-2xl p-4">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-zinc-400 font-medium">Channel3 Searches</span>
                <span className="font-mono font-semibold text-white">
                  {quotaStatus.usage.searchesUsed} / {quotaStatus.limits.searches}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-300 rounded-full"
                  style={{
                    width: `${Math.min(
                      100,
                      (quotaStatus.usage.searchesUsed / Math.max(1, quotaStatus.limits.searches)) * 100
                    )}%`,
                  }}
                />
              </div>
              <div className="text-[11px] text-zinc-500 mt-2">
                Remaining: {quotaStatus.remaining.searches}
              </div>
            </div>

            {/* 3. Coupons */}
            <div className="bg-[#181820]/60 border border-white/[0.06] rounded-2xl p-4">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-zinc-400 font-medium">Coupon Checks</span>
                <span className="font-mono font-semibold text-white">
                  {quotaStatus.usage.couponsUsed} / {quotaStatus.limits.coupons}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all duration-300 rounded-full"
                  style={{
                    width: `${Math.min(
                      100,
                      (quotaStatus.usage.couponsUsed / Math.max(1, quotaStatus.limits.coupons)) * 100
                    )}%`,
                  }}
                />
              </div>
              <div className="text-[11px] text-zinc-500 mt-2">
                Remaining: {quotaStatus.remaining.coupons}
              </div>
            </div>

            {/* 4. Analyses */}
            <div className="bg-[#181820]/60 border border-white/[0.06] rounded-2xl p-4">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-zinc-400 font-medium">Spec & Chemical Analyses</span>
                <span className="font-mono font-semibold text-white">
                  {quotaStatus.usage.analysesUsed} / {quotaStatus.limits.analyses}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
                  style={{
                    width: `${Math.min(
                      100,
                      (quotaStatus.usage.analysesUsed / Math.max(1, quotaStatus.limits.analyses)) * 100
                    )}%`,
                  }}
                />
              </div>
              <div className="text-[11px] text-zinc-500 mt-2">
                Remaining: {quotaStatus.remaining.analyses}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Plan Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {plans.map((plan) => {
          const isCurrent = activePlanId === plan.id;
          return (
            <div
              key={plan.id}
              className={`rounded-3xl p-5 flex flex-col justify-between border transition-all duration-200 relative ${
                plan.isPopular
                  ? 'bg-gradient-to-b from-violet-950/40 via-[#12121A] to-[#0E0E14] border-violet-500/40 shadow-lg shadow-violet-950/30'
                  : 'bg-[#121217] border-white/[0.08]'
              } ${isCurrent ? 'ring-2 ring-violet-500' : ''}`}
            >
              {plan.isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-violet-600 text-[10px] font-bold text-white tracking-wider uppercase shadow-sm">
                  Most Popular
                </div>
              )}

              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${plan.badgeColor}`}
                  >
                    {plan.modelTier}
                  </span>
                </div>

                <p className="text-xs text-zinc-400 min-h-[36px]">{plan.tagline}</p>

                <div className="my-4 pb-4 border-b border-white/[0.08]">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-extrabold text-white">
                      ${plan.priceMonthly}
                    </span>
                    <span className="text-xs text-zinc-400">/ month</span>
                  </div>
                  <div className="text-[11px] text-zinc-500 mt-1">
                    PayPal Recurring Subscription
                  </div>
                </div>

                {/* Comparison Engine */}
                <div className="mb-4 p-2.5 rounded-xl bg-black/30 border border-white/[0.06]">
                  <div className="text-[10px] uppercase font-semibold text-zinc-500 tracking-wider">
                    Comparison Engine
                  </div>
                  <div className="text-xs font-mono text-zinc-200 mt-0.5 truncate">
                    {plan.preferredModel}
                  </div>
                </div>

                {/* Features List */}
                <div className="space-y-2 mb-6">
                  {plan.features.map((feat, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs text-zinc-300">
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                {isCurrent ? (
                  <button
                    type="button"
                    disabled={true}
                    className="w-full py-2.5 px-4 rounded-xl bg-zinc-800 text-zinc-400 text-xs font-medium cursor-default flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    Current Active Plan
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid={`subscribe-plan-btn-${plan.id}`}
                    onClick={() => handleStartSubscribe(plan)}
                    className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold cursor-pointer transition-all flex items-center justify-center gap-1.5 ${
                      plan.isPopular
                        ? 'bg-violet-600 hover:bg-violet-500 text-white shadow-md'
                        : 'bg-white hover:bg-zinc-200 text-zinc-950'
                    }`}
                  >
                    <span>{plan.priceMonthly === 0 ? 'Switch to Free' : 'Subscribe with PayPal'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Plan Comparison Matrix Table */}
      <div
        data-testid="subscription-plan-comparison-matrix"
        className="rounded-3xl bg-[#121217]/95 border border-white/[0.08] overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Crown className="w-4 h-4 text-violet-400" />
            <h2 className="text-sm font-bold text-white">
              Plan Entitlements &amp; Quota Comparison Matrix
            </h2>
          </div>
          <span className="text-[11px] font-mono text-zinc-400">
            Server-Authoritative Enforcement · Synced to Firestore (/users/uid/subscriptions/current)
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/[0.08] bg-zinc-900/60">
                <th className="p-3.5 text-zinc-400 font-medium">Entitlement / Quota</th>
                {plans.map((p) => (
                  <th key={p.id} className="p-3.5 font-semibold text-white">
                    {p.name} (${p.priceMonthly}/mo)
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06] font-mono">
              <tr>
                <td className="p-3.5 text-zinc-300 font-sans">AI Reasoning Tier</td>
                {plans.map((p) => (
                  <td key={p.id} className="p-3.5 text-violet-300 uppercase">
                    {p.modelTier}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="p-3.5 text-zinc-300 font-sans">Monthly Product Searches</td>
                {plans.map((p) => (
                  <td key={p.id} className="p-3.5 text-zinc-100">
                    {p.monthlySearches.toLocaleString()} / mo
                  </td>
                ))}
              </tr>
              <tr>
                <td className="p-3.5 text-zinc-300 font-sans">Deep Product Analyses</td>
                {plans.map((p) => (
                  <td key={p.id} className="p-3.5 text-zinc-100">
                    {p.monthlyAnalyses.toLocaleString()} / mo
                  </td>
                ))}
              </tr>
              <tr>
                <td className="p-3.5 text-zinc-300 font-sans">Verified Coupon Lookups</td>
                {plans.map((p) => (
                  <td key={p.id} className="p-3.5 text-zinc-100">
                    {p.monthlyCoupons.toLocaleString()} / mo
                  </td>
                ))}
              </tr>
              <tr>
                <td className="p-3.5 text-zinc-300 font-sans">Multi-Source Workflows</td>
                {plans.map((p) => (
                  <td key={p.id} className="p-3.5 text-emerald-300">
                    {p.monthlyWorkflows.toLocaleString()} / mo
                  </td>
                ))}
              </tr>
              <tr>
                <td className="p-3.5 text-zinc-300 font-sans">Concurrent Executions</td>
                {plans.map((p) => (
                  <td key={p.id} className="p-3.5 text-cyan-300">
                    {p.maxConcurrency} simultaneous
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Subscription Billing & Audit Log History */}
      <div
        data-testid="subscription-billing-history"
        className="rounded-3xl bg-[#121217]/95 border border-white/[0.08] p-5 space-y-3"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Subscription Billing &amp; Event Audit Trail ({subscriptionPayments.length})</span>
          </h2>
          <span className="text-[11px] font-mono text-zinc-400">
            PayPal Sandbox Verified Billing Records
          </span>
        </div>
        {subscriptionPayments.length === 0 ? (
          <p className="text-xs text-zinc-400">
            No paid subscription billing events recorded yet. Upgrading to Luna, Terra, or Sol records an immutable PayPal Sandbox billing audit entry here.
          </p>
        ) : (
          <div className="divide-y divide-white/[0.06] text-xs font-mono">
            {subscriptionPayments.slice(0, 8).map((pay) => (
              <div
                key={pay.id}
                className="py-2.5 flex flex-wrap items-center justify-between gap-2"
              >
                <div>
                  <span className="text-white font-semibold uppercase">{pay.planId} Plan</span>
                  <span className="text-zinc-500 mx-2">·</span>
                  <span className="text-violet-300">{pay.paypalTransactionId}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-emerald-300 font-bold">
                    ${pay.amount.toFixed(2)} {pay.currency}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px] uppercase">
                    {pay.status}
                  </span>
                  <span className="text-zinc-500">
                    {new Date(pay.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* PayPal Subscription Checkout Modal */}
      {selectedPlanForCheckout && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="subscription-modal-title"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl bg-[#121217] border border-white/[0.12] p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <Crown className="w-5 h-5 text-violet-400" />
                <h3 id="subscription-modal-title" className="text-base font-bold text-white">
                  Confirm PayPal Subscription
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCloseCheckoutModal}
                className="text-zinc-400 hover:text-white text-xs cursor-pointer"
              >
                Cancel
              </button>
            </div>

            <div className="rounded-2xl bg-zinc-900/80 border border-white/[0.06] p-4 space-y-2.5">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Selected Plan</span>
                <span className="font-semibold text-white">{selectedPlanForCheckout.name}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Monthly Billing Charge</span>
                <span className="font-bold text-emerald-400">
                  ${selectedPlanForCheckout.priceMonthly.toFixed(2)} USD / mo
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Comparison Workflows</span>
                <span className="text-zinc-200">
                  {selectedPlanForCheckout.monthlyWorkflows} workflows / mo
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-400">Concurrency Limit</span>
                <span className="text-zinc-200">
                  {selectedPlanForCheckout.maxConcurrency} concurrent workflows
                </span>
              </div>

              {selectedPlanForCheckout.priceMonthly > 0 && (
                <div className="pt-2.5 mt-2 border-t border-white/[0.08] space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">Current PayPal Wallet Balance</span>
                    <span
                      data-testid="modal-subscription-wallet-before"
                      className="font-mono font-semibold text-zinc-200"
                    >
                      ${effectiveAvailableBalance.toFixed(2)} {effectiveCurrency}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">PayPal Wallet Deduction</span>
                    <span className="font-mono font-semibold text-amber-300">
                      -${selectedPlanForCheckout.priceMonthly.toFixed(2)} {effectiveCurrency}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-300 font-medium">Wallet Balance After Purchase</span>
                    <span
                      data-testid="modal-subscription-wallet-after"
                      className={`font-mono font-bold ${
                        effectiveAvailableBalance >= selectedPlanForCheckout.priceMonthly
                          ? 'text-emerald-400'
                          : 'text-red-400'
                      }`}
                    >
                      $
                      {Math.max(
                        0,
                        Number(
                          (effectiveAvailableBalance - selectedPlanForCheckout.priceMonthly).toFixed(2)
                        )
                      ).toFixed(2)}{' '}
                      {effectiveCurrency}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {checkoutError && (
              <div
                data-testid="subscription-checkout-error"
                className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-300 flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{checkoutError}</span>
              </div>
            )}

            {checkoutSuccess && (
              <div
                data-testid="subscription-checkout-success"
                className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-start gap-2"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{checkoutSuccess}</span>
              </div>
            )}

            {pendingSubSession && !checkoutSuccess && (
              <div
                data-testid="subscription-sandbox-approval-step"
                className="p-3.5 rounded-2xl bg-[#003087]/25 border border-[#0070BA]/50 space-y-2.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-cyan-300">
                    PayPal Sandbox Approval Pending
                  </span>
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-[10px] font-mono text-amber-300">
                    SANDBOX
                  </span>
                </div>
                <div className="font-mono text-[11px] text-zinc-300 space-y-0.5">
                  <div>Subscription ID: <span className="text-white">{pendingSubSession.subscriptionId}</span></div>
                  {pendingSubSession.paypalOrderId && (
                    <div>PayPal Order Ref: <span className="text-cyan-300">{pendingSubSession.paypalOrderId}</span></div>
                  )}
                </div>
                {pendingSubSession.approvalUrl && (
                  <a
                    href={pendingSubSession.approvalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="subscription-paypal-approval-link"
                    className="inline-flex items-center gap-1.5 text-[11px] font-medium text-cyan-300 hover:underline"
                  >
                    <span>Open PayPal Sandbox Approval Link</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}

            <div className="text-[11px] text-zinc-400 leading-relaxed">
              {pendingSubSession
                ? 'Confirm PayPal Sandbox buyer approval below to activate your subscription and deduct the fee from your PayPal Sandbox wallet.'
                : 'Step 1 creates a PayPal Sandbox subscription approval session; Step 2 records buyer approval and deducts the fee from your PayPal wallet.'}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={handleCloseCheckoutModal}
                className="flex-1 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 cursor-pointer"
              >
                {pendingSubSession ? 'Cancel Order' : 'Back'}
              </button>
              {!pendingSubSession ? (
                <button
                  type="button"
                  data-testid="create-subscription-order-btn"
                  disabled={checkoutLoading}
                  onClick={handleCreateSubscriptionOrder}
                  className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {checkoutLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating Session...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      {selectedPlanForCheckout.priceMonthly === 0
                        ? 'Confirm Free Trial'
                        : 'Continue to PayPal Sandbox'}
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="confirm-activate-subscription-btn"
                  disabled={checkoutLoading}
                  onClick={handleApproveAndActivateSubscription}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {checkoutLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Activating Plan...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Approve &amp; Activate Subscription
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
