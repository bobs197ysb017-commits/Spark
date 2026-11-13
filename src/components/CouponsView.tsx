import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  MousePointerClick,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
  Tag,
  TicketPercent,
  ShoppingCart,
} from 'lucide-react';
import type {
  CouponItem,
  FeedicoAffiliateClickRecord,
  FeedicoMerchantRecord,
  FeedicoNormalizedOffer,
  FeedicoStatusResponse,
  RankedProductOffer,
  UserCartSummary,
} from '../types/spark';
import { buildAuthenticatedHeaders } from '../utils/authClient';

export interface CouponsViewProps {
  sessionOffers: RankedProductOffer[];
  sessionCoupons: CouponItem[];
  cart?: UserCartSummary | null;
  onApplyCouponToCart?: (code: string) => Promise<{ ok: boolean; message: string }>;
  onNavigateToCart?: () => void;
  onNotify?: (message: string) => void;
}

const VERIFIED_CART_PROMOS = [
  {
    code: 'SPARK10',
    title: '10% Off Eligible Verified Orders ($50+ Min Spend)',
    minSpend: 50,
    discountLabel: '10% OFF',
    categoryRequirement: null,
  },
  {
    code: 'SAVE25',
    title: '$25 Off Orders Over $150 ($150+ Min Spend)',
    minSpend: 150,
    discountLabel: '$25 OFF',
    categoryRequirement: null,
  },
  {
    code: 'AUDIO15',
    title: '15% Off Audio, Headphones & Electronics ($80+ Min Spend)',
    minSpend: 80,
    discountLabel: '15% OFF',
    categoryRequirement: 'Audio / Electronics',
  },
];

export const CouponsView: React.FC<CouponsViewProps> = ({
  sessionOffers,
  sessionCoupons,
  cart = null,
  onApplyCouponToCart,
  onNavigateToCart,
  onNotify,
}) => {
  const [status, setStatus] = useState<FeedicoStatusResponse | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [countryFilter, setCountryFilter] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'ending_soon' | 'merchant' | 'code'>(
    'newest'
  );
  const [offers, setOffers] = useState<FeedicoNormalizedOffer[]>([]);
  const [merchants, setMerchants] = useState<FeedicoMerchantRecord[]>([]);
  const [clicks, setClicks] = useState<FeedicoAffiliateClickRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshingCache, setIsRefreshingCache] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedOfferId, setCopiedOfferId] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [applyingCode, setApplyingCode] = useState<string | null>(null);
  const [cartApplyFeedback, setCartApplyFeedback] = useState<{
    ok: boolean;
    code: string;
    message: string;
  } | null>(null);

  const handleApplyCodeToCart = async (code: string) => {
    if (!onApplyCouponToCart || !code) return;
    setApplyingCode(code);
    setCartApplyFeedback(null);
    try {
      const res = await onApplyCouponToCart(code);
      setCartApplyFeedback({
        ok: res.ok,
        code,
        message: res.message,
      });
    } finally {
      setApplyingCode(null);
    }
  };

  const loadFeedicoDiagnostics = useCallback(async (): Promise<FeedicoStatusResponse | null> => {
    let loadedStatus: FeedicoStatusResponse | null = null;
    try {
      const [statusRes, clicksRes] = await Promise.all([
        fetch('/api/feedico/status', {
          headers: buildAuthenticatedHeaders({ method: 'GET' }),
        }),
        fetch('/api/coupons/clicks', {
          headers: buildAuthenticatedHeaders({ method: 'GET' }),
        }),
      ]);

      if (statusRes.ok) {
        const data = await statusRes.json();
        if (data.status) {
          loadedStatus = data.status;
          setStatus(data.status);
        }
      }
      if (clicksRes.ok) {
        const clickData = await clicksRes.json();
        if (Array.isArray(clickData.clicks)) {
          setClicks(clickData.clicks);
        }
      }
    } catch {
      // Ignore transient diagnostic fetch error
    }
    return loadedStatus;
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const initialStatus = await loadFeedicoDiagnostics();
      if (!mounted || !initialStatus?.configured) return;
      // Automatically load initial live catalog coupons & merchants on first open when configured
      try {
        setIsLoading(true);
        const [couponRes, merchantRes] = await Promise.all([
          fetch('/api/coupons/search', {
            method: 'POST',
            headers: buildAuthenticatedHeaders({ method: 'POST' }),
            body: JSON.stringify({ page: 1, pageSize: 24, sort: 'newest' }),
          }),
          fetch('/api/coupons/merchants', {
            method: 'POST',
            headers: buildAuthenticatedHeaders({ method: 'POST' }),
            body: JSON.stringify({ hasCoupons: true, page: 1, pageSize: 12 }),
          }),
        ]);
        if (!mounted) return;
        if (couponRes.ok) {
          const couponData = await couponRes.json();
          if (couponData.ok && Array.isArray(couponData.offers)) {
            setOffers(couponData.offers);
          }
        }
        if (merchantRes.ok) {
          const merchData = await merchantRes.json();
          if (merchData.ok && Array.isArray(merchData.merchants)) {
            setMerchants(merchData.merchants);
          }
        }
        await loadFeedicoDiagnostics();
      } catch {
        // Ignore initial load error
      } finally {
        if (mounted) setIsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [loadFeedicoDiagnostics]);

  const handleSearchCoupons = async (e?: React.FormEvent, bypassCache = false) => {
    e?.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const [couponRes, merchantRes] = await Promise.all([
        fetch('/api/coupons/search', {
          method: 'POST',
          headers: buildAuthenticatedHeaders({ method: 'POST' }),
          body: JSON.stringify({
            q: searchQuery.trim() || undefined,
            countries: countryFilter ? [countryFilter] : undefined,
            sort: sortOrder,
            page: 1,
            pageSize: 30,
            bypassCache,
          }),
        }),
        fetch('/api/coupons/merchants', {
          method: 'POST',
          headers: buildAuthenticatedHeaders({ method: 'POST' }),
          body: JSON.stringify({
            q: searchQuery.trim() || undefined,
            countries: countryFilter ? [countryFilter] : undefined,
            hasCoupons: true,
            page: 1,
            pageSize: 12,
            bypassCache,
          }),
        }),
      ]);

      const couponData = await couponRes.json();
      if (!couponRes.ok || !couponData.ok) {
        setErrorMessage(
          couponData.error ||
            'Feedico Partner API could not complete the search. Check FEEDICO_PARTNER_TOKEN configuration.'
        );
        if (couponData.status) setStatus(couponData.status);
        setOffers([]);
      } else {
        setOffers(Array.isArray(couponData.offers) ? couponData.offers : []);
      }

      if (merchantRes.ok) {
        const merchData = await merchantRes.json();
        if (Array.isArray(merchData.merchants)) {
          setMerchants(merchData.merchants);
        }
      }

      await loadFeedicoDiagnostics();
    } catch {
      setErrorMessage('Network error communicating with Spark Feedico coupon service.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMatchProductOffers = async (product: RankedProductOffer) => {
    setSelectedProductId(product.id);
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/coupons/product', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        body: JSON.stringify({
          productId: product.id,
          productName: product.name,
          merchant: product.merchant,
          canonicalUrl: product.canonicalUrl,
          price: product.price,
          currency: product.currency,
          country: countryFilter || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrorMessage(
          data.error ||
            `Could not retrieve Feedico offers for "${product.name}" (${product.merchant}).`
        );
        if (data.status) setStatus(data.status);
        setOffers([]);
      } else {
        setOffers(Array.isArray(data.matchedOffers) ? data.matchedOffers : []);
        if (data.merchant) {
          setMerchants([data.merchant]);
        }
      }
      await loadFeedicoDiagnostics();
    } catch {
      setErrorMessage('Failed to query product-matched coupons from Feedico.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefreshCache = async () => {
    setIsRefreshingCache(true);
    try {
      const [refreshRes, verifyRes] = await Promise.all([
        fetch('/api/coupons/cache/refresh', {
          method: 'POST',
          headers: buildAuthenticatedHeaders({ method: 'POST' }),
          body: JSON.stringify({ q: searchQuery.trim() || undefined }),
        }),
        fetch('/api/feedico/verify', {
          method: 'POST',
          headers: buildAuthenticatedHeaders({ method: 'POST' }),
          body: JSON.stringify({ q: searchQuery.trim() || undefined }),
        }),
      ]);
      if (verifyRes.ok) {
        const verifyData = await verifyRes.json();
        if (verifyData.status) setStatus(verifyData.status);
        onNotify?.('Feedico Partner API live connectivity verified and cache refreshed.');
      } else if (refreshRes.ok) {
        onNotify?.('Feedico offer cache refreshed.');
      }
      await loadFeedicoDiagnostics();
    } catch {
      // Ignore refresh error
    } finally {
      setIsRefreshingCache(false);
    }
  };

  const handleCopyCode = (offerId: string, code: string | null) => {
    if (!code) return;
    navigator.clipboard?.writeText(code);
    setCopiedOfferId(offerId);
    onNotify?.(`Copied coupon code ${code} to clipboard.`);
    setTimeout(() => {
      setCopiedOfferId((prev) => (prev === offerId ? null : prev));
    }, 2000);
  };

  const handleTrackAffiliateClick = async (offer: FeedicoNormalizedOffer) => {
    try {
      const res = await fetch('/api/coupons/track-click', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        body: JSON.stringify({
          feedicoOfferId: offer.feedico_offer_id,
          merchantId: offer.merchant_id,
          merchantName: offer.merchant_name,
          couponCode: offer.coupon_code,
          goUrl: offer.tracked_url,
          merchantWebsiteUrl: offer.website_url,
          targetCountry: countryFilter || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.click) {
          setClicks((prev) => [data.click, ...prev]);
        }
      }
    } catch {
      // Non-blocking attribution recording
    }
  };

  const isVerifiedLive = status?.integrationState === 'CONFIGURED_AND_VERIFIED';
  const isConfiguredUnverified = status?.integrationState === 'CONFIGURED_BUT_UNVERIFIED';

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header & Feedico Partner API Status Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              Coupons, Deals &amp; Affiliate Attribution
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-violet-500/15 border border-violet-400/30 text-violet-200">
              {status?.enabled ? 'Feedico Partner API' : 'Channel3 Primary · Verified Promos'}
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Verified promotional discounts for Spark Cart &amp; PayPal Sandbox checkout, paired with Channel3 merchant offer intelligence. Spark never invents coupon codes, discounts, or expiration dates.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefreshCache}
          disabled={isRefreshingCache}
          data-testid="feedico-verify-refresh-btn"
          className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs font-medium text-zinc-200 inline-flex items-center gap-1.5 self-start cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingCache ? 'animate-spin' : ''}`} />
          <span>Verify & Refresh Catalog</span>
        </button>
      </div>

      {/* Direct Cart Coupon Eligibility & Apply Panel */}
      <div
        data-testid="coupons-cart-integration-card"
        className="rounded-2xl bg-[#12101B]/95 border border-violet-400/30 p-5 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-violet-300">
              <ShoppingCart className="w-4 h-4 text-violet-400" />
              <span>Direct Cart Discount Eligibility &amp; Application</span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              {cart && cart.itemCount > 0
                ? `Active Cart: ${cart.itemCount} item(s) · Verified Subtotal: $${cart.subtotal.toFixed(2)} ${cart.currency}${
                    cart.appliedCouponCode ? ` · Applied Code: ${cart.appliedCouponCode}` : ''
                  }`
                : 'Your Cart is currently empty. Add verified products to Cart to apply promotional codes directly before checkout.'}
            </p>
          </div>
          {onNavigateToCart && (
            <button
              type="button"
              data-testid="coupons-go-to-cart-btn"
              onClick={onNavigateToCart}
              className="px-3.5 py-1.5 rounded-xl bg-violet-600/25 hover:bg-violet-600/35 border border-violet-400/40 text-xs font-semibold text-violet-100 inline-flex items-center gap-1.5 self-start sm:self-center shrink-0 cursor-pointer"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>Open Cart ({cart?.itemCount || 0})</span>
            </button>
          )}
        </div>

        {cartApplyFeedback && (
          <div
            data-testid="coupons-cart-apply-feedback"
            className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-2 ${
              cartApplyFeedback.ok
                ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-200'
                : 'bg-amber-500/15 border-amber-500/35 text-amber-200'
            }`}
          >
            <span>
              <strong>[{cartApplyFeedback.code}]</strong> {cartApplyFeedback.message}
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {VERIFIED_CART_PROMOS.map((promo) => {
            const cartSubtotal = cart?.subtotal || 0;
            const cartEmpty = !cart || cart.itemCount === 0;
            const meetsMinSpend = !cartEmpty && cartSubtotal >= promo.minSpend;
            const isApplied = cart?.appliedCouponCode === promo.code;
            const ineligibilityReason = cartEmpty
              ? 'Requires at least 1 verified item in Cart'
              : !meetsMinSpend
              ? `Requires $${promo.minSpend.toFixed(2)} minimum Cart subtotal (currently $${cartSubtotal.toFixed(2)})`
              : null;

            return (
              <div
                key={promo.code}
                data-testid={`cart-promo-card-${promo.code}`}
                className={`p-3.5 rounded-xl border flex flex-col justify-between gap-3 ${
                  isApplied
                    ? 'bg-emerald-500/12 border-emerald-400/40'
                    : meetsMinSpend
                    ? 'bg-zinc-900/90 border-white/[0.1]'
                    : 'bg-zinc-950/70 border-white/[0.06] opacity-85'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-emerald-300 px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30">
                      {promo.code}
                    </span>
                    <span className="text-[11px] font-mono text-violet-300">
                      {promo.discountLabel}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-white">{promo.title}</p>
                  {ineligibilityReason ? (
                    <p className="text-[11px] text-amber-300/90 font-mono">
                      Ineligible: {ineligibilityReason}
                    </p>
                  ) : (
                    <p className="text-[11px] text-emerald-300/90 font-mono">
                      Eligible for your current Cart
                    </p>
                  )}
                </div>

                {onApplyCouponToCart && (
                  <button
                    type="button"
                    data-testid={`coupons-apply-to-cart-${promo.code}`}
                    disabled={applyingCode === promo.code || isApplied}
                    onClick={() => handleApplyCodeToCart(promo.code)}
                    className={`w-full py-1.5 px-3 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer ${
                      isApplied
                        ? 'bg-emerald-600/30 border border-emerald-400/40 text-emerald-200'
                        : 'bg-violet-600 hover:bg-violet-500 text-white'
                    }`}
                  >
                    <ShoppingCart className="w-3.5 h-3.5" />
                    <span>
                      {isApplied
                        ? 'Applied to Cart'
                        : applyingCode === promo.code
                        ? 'Applying...'
                        : 'Apply to Cart'}
                    </span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Commerce & Coupon Integration Status Card */}
      {status && (
        <div
          data-testid="feedico-status-card"
          data-integration-state={status.integrationState}
          className={`rounded-2xl border p-5 space-y-3 ${
            isVerifiedLive || !status.enabled
              ? 'bg-emerald-500/[0.06] border-emerald-500/25'
              : isConfiguredUnverified
              ? 'bg-cyan-500/[0.06] border-cyan-500/25'
              : status.integrationState === 'INVALID_CREDENTIALS' ||
                status.integrationState === 'PROVIDER_UNAVAILABLE'
              ? 'bg-rose-500/[0.06] border-rose-500/25'
              : 'bg-[#121217]/95 border-amber-500/25'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              {isVerifiedLive || !status.enabled ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle
                  className={`w-5 h-5 shrink-0 ${
                    isConfiguredUnverified
                      ? 'text-cyan-400'
                      : status.integrationState === 'INVALID_CREDENTIALS' ||
                        status.integrationState === 'PROVIDER_UNAVAILABLE'
                      ? 'text-rose-400'
                      : 'text-amber-400'
                  }`}
                />
              )}
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-white">
                    {!status.enabled
                      ? 'Channel3 Primary Commerce Mode — Verified Cart Promo Engine Active'
                      : isVerifiedLive
                      ? `Feedico Partner API Connected & Verified (${status.baseUrl})`
                      : isConfiguredUnverified
                      ? `Feedico Partner API Configured — Awaiting Live Verification (${status.baseUrl})`
                      : status.integrationState === 'INVALID_CREDENTIALS'
                      ? 'Feedico Partner API — Invalid or Unauthorized Partner Token'
                      : status.integrationState === 'RATE_LIMITED'
                      ? 'Feedico Partner API — Rate Limited (HTTP 429)'
                      : status.integrationState === 'PROVIDER_UNAVAILABLE'
                      ? 'Feedico Partner API — Upstream Provider Unavailable'
                      : 'Feedico Partner API — Partner Token Required for Live Catalog Queries'}
                  </h2>
                  <span
                    data-testid="feedico-integration-state-badge"
                    className={`px-2 py-0.5 rounded-md text-[10px] font-mono border ${
                      isVerifiedLive || !status.enabled
                        ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                        : isConfiguredUnverified
                        ? 'bg-cyan-500/15 border-cyan-400/30 text-cyan-300'
                        : status.integrationState === 'INVALID_CREDENTIALS' ||
                          status.integrationState === 'PROVIDER_UNAVAILABLE'
                        ? 'bg-rose-500/15 border-rose-400/30 text-rose-300'
                        : 'bg-amber-500/15 border-amber-400/30 text-amber-300'
                    }`}
                  >
                    {!status.enabled ? 'CHANNEL3_PRIMARY' : status.integrationState}
                  </span>
                </div>
                <p className="text-xs text-zinc-300 mt-0.5">
                  {!status.enabled
                    ? 'Spark discovery and multi-merchant offer intelligence run on Channel3 Product Graph API. Legacy Feedico lookup is disabled by default (FEEDICO_ENABLED=false).'
                    : status.statusMessage}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-zinc-300">
              <span className="px-2.5 py-1 rounded-lg bg-black/40 border border-white/10">
                Active Cart Promos: {VERIFIED_CART_PROMOS.length}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-black/40 border border-white/10">
                Session Deals: {sessionCoupons.length + offers.length}
              </span>
            </div>
          </div>

          {status.enabled && !status.configured && (
            <div className="pt-2 border-t border-white/[0.07] text-xs text-zinc-400 leading-relaxed">
              Optional external Feedico Partner API is enabled without a partner token. Set{' '}
              <code className="font-mono text-zinc-200">FEEDICO_ENABLED=false</code> to use Channel3 primary mode, or configure{' '}
              <code className="font-mono text-zinc-200">FEEDICO_PARTNER_TOKEN</code>.
            </div>
          )}
        </div>
      )}

      {/* Search & Country Filter Form */}
      <form
        onSubmit={(e) => handleSearchCoupons(e, false)}
        className="rounded-2xl bg-[#121217]/95 border border-white/[0.08] p-4 space-y-3"
      >
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-6 relative">
            <label htmlFor="feedico-coupon-search-input" className="sr-only">
              Search merchant or coupon keyword
            </label>
            <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              id="feedico-coupon-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search merchant name, domain, or keyword (e.g., nike, new balance, software)..."
              className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-zinc-900 border border-white/[0.08] text-xs sm:text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-400/50"
            />
          </div>

          <div className="md:col-span-3">
            <label htmlFor="feedico-country-select" className="sr-only">
              Target Country
            </label>
            <div className="relative">
              <Globe className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <select
                id="feedico-country-select"
                value={countryFilter}
                onChange={(e) => setCountryFilter(e.target.value)}
                className="w-full pl-8 pr-3 py-2.5 rounded-xl bg-zinc-900 border border-white/[0.08] text-xs text-white"
              >
                <option value="">All Countries (+ Worldwide)</option>
                <option value="US">United States (US + WW)</option>
                <option value="GB">United Kingdom (GB + WW)</option>
                <option value="DE">Germany (DE + WW)</option>
                <option value="FR">France (FR + WW)</option>
                <option value="CA">Canada (CA + WW)</option>
                <option value="WW">Worldwide Only (WW)</option>
              </select>
            </div>
          </div>

          <div className="md:col-span-3 flex items-center gap-2">
            <label htmlFor="feedico-sort-select" className="sr-only">
              Sort offers
            </label>
            <select
              id="feedico-sort-select"
              value={sortOrder}
              onChange={(e) =>
                setSortOrder(
                  e.target.value as 'newest' | 'ending_soon' | 'merchant' | 'code'
                )
              }
              className="flex-1 px-3 py-2.5 rounded-xl bg-zinc-900 border border-white/[0.08] text-xs text-white"
            >
              <option value="newest">Sort: Newest</option>
              <option value="ending_soon">Ending Soon</option>
              <option value="merchant">Merchant Name</option>
              <option value="code">Coupon Code</option>
            </select>

            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              {isLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <TicketPercent className="w-3.5 h-3.5" />
              )}
              <span>Search</span>
            </button>
          </div>
        </div>

        {/* Product-to-Merchant Coupon Matcher for Discovered Session Products */}
        {sessionOffers.length > 0 && (
          <div className="pt-3 border-t border-white/[0.06] flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-zinc-400">
              Match offers for discovered products:
            </span>
            {sessionOffers.slice(0, 4).map((prod) => (
              <button
                key={prod.id}
                type="button"
                onClick={() => handleMatchProductOffers(prod)}
                className={`px-3 py-1 rounded-full text-xs border transition-colors cursor-pointer ${
                  selectedProductId === prod.id
                    ? 'bg-violet-500/20 border-violet-400/40 text-violet-200'
                    : 'bg-zinc-900 hover:bg-zinc-800 border-white/[0.08] text-zinc-300'
                }`}
              >
                {prod.merchant} · {prod.name.slice(0, 28)}
              </button>
            ))}
          </div>
        )}
      </form>

      {/* Error State */}
      {errorMessage && (
        <div
          role="alert"
          className="rounded-2xl bg-amber-500/10 border border-amber-500/25 p-4 flex items-start gap-3 text-xs text-amber-200"
        >
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-semibold text-amber-300">
              Feedico Partner API Status Notice
            </div>
            <p className="leading-relaxed">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Matched Merchants Bar */}
      {merchants.length > 0 && (
        <div className="space-y-2.5">
          <h2 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <Store className="w-3.5 h-3.5 text-violet-400" />
            <span>Matched Feedico Partner Merchants ({merchants.length})</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {merchants.map((m) => (
              <div
                key={m.merchant_id}
                className="rounded-xl bg-[#14141D] border border-white/[0.08] p-3.5 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{m.name}</div>
                  <div className="text-[11px] font-mono text-zinc-400 truncate">
                    {m.domain || m.provider} · {m.coupon_count} active code(s)
                  </div>
                </div>
                <a
                  href={m.tracked_url}
                  target="_blank"
                  rel="noopener noreferrer sponsored"
                  className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-[11px] font-medium text-cyan-300 inline-flex items-center gap-1 shrink-0"
                >
                  <span>Store</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Normalized Feedico Offer Cards */}
      {offers.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Tag className="w-4 h-4 text-emerald-400" />
              <span>Normalized Feedico Offers ({offers.length})</span>
            </h2>
            <span className="text-[11px] font-mono text-zinc-400">
              Classified by verification status & expiration
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3.5">
            {offers.map((offer) => {
              const isNoCode = offer.verification_status === 'no_code_deal' || !offer.coupon_code;
              const isExpired = offer.verification_status === 'expired';
              const isCopied = copiedOfferId === offer.feedico_offer_id;
              const countriesLabel =
                offer.target_countries.length === 0
                  ? 'Unspecified (merchant terms apply)'
                  : offer.target_countries.includes('WW')
                  ? 'Worldwide (WW)'
                  : offer.target_countries.join(', ');

              return (
                <article
                  key={offer.feedico_offer_id}
                  className={`rounded-2xl border p-5 space-y-3 transition-colors ${
                    isExpired
                      ? 'bg-zinc-900/50 border-rose-500/25 opacity-75'
                      : 'bg-[#121218]/95 border-white/[0.1] hover:border-emerald-400/35'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-white">
                          {offer.merchant_name}
                        </span>
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-violet-500/15 border border-violet-400/30 text-violet-200">
                          {offer.discount.label}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-md text-[11px] font-mono border ${
                            isExpired
                              ? 'bg-rose-500/15 border-rose-400/30 text-rose-300'
                              : isNoCode
                              ? 'bg-cyan-500/15 border-cyan-400/30 text-cyan-200'
                              : 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                          }`}
                        >
                          {isExpired
                            ? 'Expired Offer'
                            : isNoCode
                            ? 'No-Code Deal'
                            : 'Verified Active Code'}
                        </span>
                        {offer.is_stale && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-amber-500/15 border border-amber-400/30 text-amber-300">
                            Stale Cache — Refresh Recommended
                          </span>
                        )}
                      </div>

                      <h3 className="text-sm font-medium text-zinc-100">{offer.title}</h3>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-zinc-400">
                        <span>
                          Source: Feedico Partner API ({offer.provider})
                        </span>
                        <span>·</span>
                        <span>Countries: {countriesLabel}</span>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {offer.expiration_date
                            ? `${isExpired ? 'Expired' : 'Ends'}: ${new Date(
                                offer.expiration_date
                              ).toLocaleDateString()}`
                            : 'No fixed expiration date'}
                        </span>
                      </div>

                      {offer.match_reason && (
                        <div className="text-[11px] font-mono text-cyan-300">
                          Match Intelligence: {offer.match_reason}
                        </div>
                      )}

                      {offer.eligibility_conditions.length > 0 && (
                        <p className="text-xs text-zinc-400 leading-relaxed">
                          Conditions: {offer.eligibility_conditions.join(' ')}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap sm:flex-col items-stretch sm:items-end gap-2 shrink-0">
                      {offer.coupon_code && !isExpired ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              handleCopyCode(offer.feedico_offer_id, offer.coupon_code)
                            }
                            className="px-3.5 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/35 text-xs font-mono font-semibold text-emerald-200 inline-flex items-center justify-center gap-2 cursor-pointer"
                          >
                            <span>{offer.coupon_code}</span>
                            {isCopied ? (
                              <Check className="w-3.5 h-3.5 text-emerald-300" />
                            ) : (
                              <Copy className="w-3.5 h-3.5 text-emerald-300" />
                            )}
                          </button>
                          {onApplyCouponToCart && (
                            <button
                              type="button"
                              data-testid={`feedico-apply-to-cart-${offer.feedico_offer_id}`}
                              disabled={applyingCode === offer.coupon_code}
                              onClick={() => handleApplyCodeToCart(offer.coupon_code!)}
                              className="px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <ShoppingCart className="w-3.5 h-3.5" />
                              <span>
                                {cart?.appliedCouponCode === offer.coupon_code
                                  ? 'Applied'
                                  : 'Apply to Cart'}
                              </span>
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="px-3 py-1.5 rounded-xl bg-zinc-900 border border-white/[0.08] text-[11px] font-mono text-zinc-400 text-center">
                          {isExpired ? 'Expired — Cannot Apply' : 'No code needed'}
                        </span>
                      )}

                      <a
                        href={offer.tracked_url}
                        target="_blank"
                        rel="noopener noreferrer sponsored"
                        onClick={() => handleTrackAffiliateClick(offer)}
                        className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/15 text-xs font-medium text-white inline-flex items-center justify-center gap-1.5"
                      >
                        <span>Visit Tracked Merchant Link</span>
                        <ExternalLink className="w-3.5 h-3.5 text-cyan-300" />
                      </a>
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400">
                    <span className="inline-flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                      <span>
                        Affiliate Disclosure: Link includes partner attribution (goUrl). Spark never claims a coupon applies at checkout unless verified by the merchant.
                      </span>
                    </span>
                    <span className="font-mono text-zinc-500">
                      Offer ID: {offer.feedico_offer_id}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        !isLoading &&
        sessionCoupons.length === 0 && (
          <div className="rounded-3xl bg-[#121217]/90 border border-white/[0.08] p-8 text-center space-y-3">
            <TicketPercent className="w-8 h-8 text-violet-400 mx-auto" />
            <h3 className="text-base font-semibold text-white">
              Verified Cart Promotional Codes Ready Above
            </h3>
            <p className="text-xs text-zinc-400 max-w-xl mx-auto leading-relaxed">
              Apply <code className="font-mono text-emerald-300">SPARK10</code> (10% off $50+),{' '}
              <code className="font-mono text-emerald-300">SAVE25</code> ($25 off $150+), or{' '}
              <code className="font-mono text-emerald-300">AUDIO15</code> (15% off $80+) directly to your Cart above, or search merchant offers when external coupon feeds are enabled.
            </p>
          </div>
        )
      )}

      {/* Per-User Affiliate Click Attribution History */}
      {clicks.length > 0 && (
        <div className="rounded-2xl bg-[#121217]/95 border border-white/[0.08] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-white flex items-center gap-2">
              <MousePointerClick className="w-4 h-4 text-cyan-400" />
              <span>Your Attributed Affiliate Clicks ({clicks.length})</span>
            </h2>
            <span className="text-[11px] font-mono text-zinc-400">
              Isolated to your Spark account · Clicks are not completed purchases
            </span>
          </div>
          <div className="divide-y divide-white/[0.06] text-xs">
            {clicks.slice(0, 5).map((clk) => (
              <div
                key={clk.click_id}
                className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div>
                  <span className="font-medium text-white">{clk.merchant_name}</span>
                  {clk.coupon_code && (
                    <span className="ml-2 font-mono text-emerald-300">
                      [{clk.coupon_code}]
                    </span>
                  )}
                  <span className="ml-2 font-mono text-[11px] text-zinc-400">
                    sub={clk.sub_id}
                  </span>
                </div>
                <div className="flex items-center gap-3 font-mono text-[11px]">
                  <span className="text-amber-300">{clk.outcome_status}</span>
                  <span className="text-zinc-500">
                    {new Date(clk.clicked_at).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
