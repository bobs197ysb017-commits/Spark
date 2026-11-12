import React, { useState } from 'react';
import {
  ShoppingCart,
  Trash2,
  Plus,
  Minus,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  TicketPercent,
  CheckCircle2,
  ExternalLink,
  ShoppingBag,
  ArrowLeft,
  RotateCcw,
  Sparkles,
  Package,
  Lock,
  Info,
  X,
  Compass,
} from 'lucide-react';
import type {
  CartCheckoutPreparationResult,
  CartItem,
  CartValidationReport,
  CouponItem,
  PayPalSandboxCatalogItem,
  RankedProductOffer,
  UserCartSummary,
} from '../types/spark';
import { ProductArtwork } from './ProductArtwork';

export interface CartViewProps {
  cart: UserCartSummary | null;
  cartLoading: boolean;
  cartSyncState: 'synced' | 'syncing' | 'offline_cached' | 'error';
  cartError: string | null;
  validationReport: CartValidationReport | null;
  checkoutPreparation: CartCheckoutPreparationResult | null;
  isValidating: boolean;
  isPreparingCheckout: boolean;
  availableCoupons?: CouponItem[];
  sandboxCatalog?: PayPalSandboxCatalogItem[];
  onUpdateQuantity: (itemId: string, quantity: number) => Promise<void> | void;
  onUpdateVariant: (
    itemId: string,
    variantLabel: string,
    selectedOptions?: Record<string, string>
  ) => Promise<void> | void;
  onRemoveItem: (itemId: string) => Promise<void> | void;
  onRestoreRemovedItem: () => Promise<void> | void;
  onRemoveUnavailableItems: () => Promise<void> | void;
  onClearCart: () => Promise<void> | void;
  onApplyCoupon: (code: string) => Promise<{ ok: boolean; message: string }>;
  onRemoveCoupon: () => Promise<void> | void;
  onAcceptPriceChanges: (itemId?: string) => Promise<void> | void;
  onValidateCart: () => Promise<void> | void;
  onPrepareAndProceedToCheckout: () => Promise<void> | void;
  onAddSandboxTestItem?: (skuId: string) => Promise<void> | void;
  onOpenProductDetails?: (item: CartItem) => void;
  onNavigateToDiscovery: () => void;
  onNavigateToConversation: () => void;
}

const DEFAULT_PROMO_CHIPS: Array<{
  code: string;
  label: string;
  subtitle: string;
}> = [
  {
    code: 'SPARK10',
    label: 'SPARK10',
    subtitle: '10% Off ($50+ Min Spend)',
  },
  {
    code: 'SAVE25',
    label: 'SAVE25',
    subtitle: '$25 Off ($150+ Min Spend)',
  },
  {
    code: 'AUDIO15',
    label: 'AUDIO15',
    subtitle: '15% Off Audio & Electronics ($80+)',
  },
];

export const CartView: React.FC<CartViewProps> = ({
  cart,
  cartLoading,
  cartSyncState,
  cartError,
  validationReport,
  checkoutPreparation,
  isValidating,
  isPreparingCheckout,
  availableCoupons = [],
  sandboxCatalog = [],
  onUpdateQuantity,
  onUpdateVariant,
  onRemoveItem,
  onRestoreRemovedItem,
  onRemoveUnavailableItems,
  onClearCart,
  onApplyCoupon,
  onRemoveCoupon,
  onAcceptPriceChanges,
  onValidateCart,
  onPrepareAndProceedToCheckout,
  onAddSandboxTestItem,
  onOpenProductDetails,
  onNavigateToDiscovery,
  onNavigateToConversation,
}) => {
  const [couponInput, setCouponInput] = useState<string>(cart?.appliedCouponCode || '');
  const [couponBusy, setCouponBusy] = useState<boolean>(false);
  const [couponFeedback, setCouponFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);
  const [busyItemIds, setBusyItemIds] = useState<Record<string, boolean>>({});
  const [addingSandboxSku, setAddingSandboxSku] = useState<string | null>(null);

  const items = cart?.items || [];
  const currency = cart?.currency || 'USD';
  const currencySymbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  const itemCount = cart?.itemCount || 0;
  const uniqueCount = cart?.uniqueProductCount || items.length;
  const subtotal = cart?.subtotal || 0;
  const verifiedDiscounts = cart?.verifiedDiscountTotal || 0;
  const additionalFees = cart?.additionalFeesTotal || 0;
  const finalPayableTotal = cart?.finalPayableTotal ?? cart?.estimatedTotal ?? 0;

  const hasUnavailable = (cart?.unavailableItemCount || 0) > 0;
  const hasUnverified = (cart?.unverifiedItemCount || 0) > 0;
  const hasPriceChanges = Boolean(cart?.requiresPriceChangeReview);
  const canProceed = Boolean(cart?.canProceedToCheckout && items.length > 0);

  const withItemLock = async (itemId: string, fn: () => Promise<void> | void) => {
    if (busyItemIds[itemId]) return;
    setBusyItemIds((prev) => ({ ...prev, [itemId]: true }));
    try {
      await fn();
    } finally {
      setBusyItemIds((prev) => ({ ...prev, [itemId]: false }));
    }
  };

  const handleCouponSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = couponInput.trim().toUpperCase();
    if (!clean || couponBusy) return;
    setCouponBusy(true);
    setCouponFeedback(null);
    try {
      const res = await onApplyCoupon(clean);
      setCouponFeedback({
        type: res.ok ? 'success' : 'error',
        text: res.message,
      });
    } finally {
      setCouponBusy(false);
    }
  };

  const handleQuickApplyCoupon = async (code: string) => {
    if (couponBusy) return;
    setCouponInput(code);
    setCouponBusy(true);
    setCouponFeedback(null);
    try {
      const res = await onApplyCoupon(code);
      setCouponFeedback({
        type: res.ok ? 'success' : 'error',
        text: res.message,
      });
    } finally {
      setCouponBusy(false);
    }
  };

  const buildRankedArtworkStub = (item: CartItem): RankedProductOffer => ({
    id: item.productId,
    offerId: item.offerId,
    sourceId: item.sourceId,
    sourceName:
      item.sourceId === 'paypal_sandbox_test_catalog'
        ? 'PayPal Sandbox Catalog'
        : 'Channel3 Product Graph API',
    sourceLabel:
      item.sourceId === 'paypal_sandbox_test_catalog'
        ? 'PayPal Sandbox Catalog'
        : 'Channel3 Product Graph API',
    verificationStatus: 'verified_live_source',
    name: item.productName,
    brand: item.specs?.Brand || item.merchant,
    merchant: item.merchant,
    category: item.category || 'Cart Item',
    summary: item.productName,
    price: item.unitPrice,
    priceStatus: item.priceStatus || 'verified',
    currency: item.currency,
    shippingCost: item.shippingCost,
    shippingStatus: item.shippingStatus,
    estimatedTaxRate: item.estimatedTaxRate,
    taxStatus: item.taxStatus === 'verified' ? 'verified' : 'unknown',
    availability: item.availability,
    availabilityStatus:
      item.availability === 'in_stock'
        ? 'verified_in_stock'
        : item.availability === 'out_of_stock'
          ? 'verified_out_of_stock'
          : 'availability_unverified',
    rating: null,
    reviewCount: null,
    canonicalUrl: item.productUrl,
    imageUrl: item.imageUrl,
    specs: item.specs || {},
    retrievedAt: item.updatedAt,
    couponStatus: 'no_verified_coupon',
    checkoutStatus: 'supported_paypal',
    bestCoupon: null,
    couponDiscountAmount: 0,
    netItemPrice: item.unitPrice,
    withinBudget: true,
    completenessScore: 95,
    rank: 1,
    pros: [],
    cons: [],
    whyRecommended: '',
  });

  return (
    <section
      data-testid="spark-cart-view"
      aria-label="Spark Intelligent Shopping Cart"
      className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 text-zinc-100"
    >
      {/* 1. TOP HEADER & PERSISTENCE / SYNC TELEMETRY */}
      <div className="rounded-3xl bg-gradient-to-br from-[#141220]/95 via-[#0F0E18]/95 to-[#0B0A12]/95 border border-white/[0.1] p-5 sm:p-6 shadow-2xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-violet-500/20 text-violet-200 border border-violet-400/30">
                <ShoppingCart className="w-3.5 h-3.5 text-violet-300" />
                <span>Spark Intelligent Cart System</span>
              </span>

              <span
                data-testid="cart-sync-badge"
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono border ${
                  cartSyncState === 'synced'
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : cartSyncState === 'syncing'
                      ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                      : cartSyncState === 'offline_cached'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    cartSyncState === 'synced'
                      ? 'bg-emerald-400'
                      : cartSyncState === 'syncing'
                        ? 'bg-cyan-400 animate-pulse'
                        : cartSyncState === 'offline_cached'
                          ? 'bg-amber-400'
                          : 'bg-rose-400'
                  }`}
                />
                <span>
                  {cartSyncState === 'synced'
                    ? `Firestore Synced · Rev #${cart?.revision || 1}`
                    : cartSyncState === 'syncing'
                      ? 'Synchronizing Cart...'
                      : cartSyncState === 'offline_cached'
                        ? 'Offline Mode · Local Cache Active'
                        : 'Sync Warning'}
                </span>
              </span>

              <span className="text-[11px] font-mono text-zinc-400 px-2.5 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.07]">
                Path: users/{cart?.userId?.slice(0, 10) || 'user'}/cart/current
              </span>
            </div>

            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              Shopping Cart &amp; Checkout Preparation
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 max-w-2xl">
              Server-authoritative pricing, live Channel3 product verification, Feedico coupon evaluation, and multi-device Firestore persistence.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              data-testid="cart-back-to-discovery-btn"
              onClick={onNavigateToDiscovery}
              className="px-3.5 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-xs font-medium text-zinc-200 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Compass className="w-3.5 h-3.5 text-cyan-400" />
              <span>Discover Products</span>
            </button>

            <button
              type="button"
              data-testid="cart-back-to-conversation-btn"
              onClick={onNavigateToConversation}
              className="px-3.5 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-xs font-medium text-zinc-200 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-violet-400" />
              <span>AI Shopping Assistant</span>
            </button>

            {items.length > 0 && (
              <>
                <button
                  type="button"
                  data-testid="cart-validate-channel3-btn"
                  disabled={isValidating}
                  onClick={() => onValidateCart()}
                  className="px-3.5 py-2 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/35 text-xs font-semibold text-violet-100 inline-flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isValidating ? 'animate-spin' : ''}`} />
                  <span>{isValidating ? 'Verifying...' : 'Verify Prices & Stock'}</span>
                </button>

                <button
                  type="button"
                  data-testid="cart-clear-trigger-btn"
                  onClick={() => setShowClearConfirm(true)}
                  className="px-3.5 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-xs font-medium text-rose-200 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear Cart</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Clear Cart Confirmation Dialog Bar */}
        {showClearConfirm && (
          <div
            data-testid="cart-clear-confirmation-bar"
            role="alertdialog"
            aria-label="Confirm clearing cart"
            className="p-4 rounded-2xl bg-rose-950/50 border border-rose-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2.5 text-xs text-rose-100">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>
                Are you sure you want to remove all <strong>{itemCount}</strong> item(s) from your cart?
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="cart-clear-confirm-btn"
                onClick={async () => {
                  setShowClearConfirm(false);
                  await onClearCart();
                }}
                className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white cursor-pointer"
              >
                Yes, Clear Entire Cart
              </button>
            </div>
          </div>
        )}

        {/* Undo / Restore Accidentally Removed Item Banner */}
        {cart?.lastRemovedItem && (
          <div
            data-testid="cart-restore-removed-banner"
            className="p-3.5 rounded-2xl bg-indigo-950/40 border border-indigo-400/35 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2.5 text-xs text-indigo-100">
              <RotateCcw className="w-4 h-4 text-indigo-300 shrink-0" />
              <span>
                Removed <strong>{cart.lastRemovedItem.productName}</strong> ({cart.lastRemovedItem.variantLabel || 'Standard Edition'}).
              </span>
            </div>
            <button
              type="button"
              data-testid="cart-restore-removed-btn"
              onClick={() => onRestoreRemovedItem()}
              className="px-3.5 py-1.5 rounded-xl bg-indigo-500/25 hover:bg-indigo-500/35 border border-indigo-400/40 text-xs font-semibold text-indigo-100 inline-flex items-center gap-1.5 self-start sm:self-center shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Undo / Restore Item</span>
            </button>
          </div>
        )}

        {/* Error Banner */}
        {cartError && (
          <div
            data-testid="cart-error-banner"
            role="alert"
            className="p-3.5 rounded-2xl bg-rose-500/15 border border-rose-500/35 flex items-center gap-2.5 text-xs text-rose-200"
          >
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{cartError}</span>
          </div>
        )}

        {/* Price Change Detection Warning Banner */}
        {hasPriceChanges && (
          <div
            data-testid="cart-price-change-banner"
            role="alert"
            className="p-4 rounded-2xl bg-amber-500/15 border border-amber-400/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Product Price Update Detected</span>
              </div>
              <p className="text-xs text-amber-100/90 leading-relaxed">
                One or more items in your cart have a newly verified merchant price. Spark never silently charges an updated price—please review and accept the updated pricing before checkout.
              </p>
            </div>
            <button
              type="button"
              data-testid="cart-accept-all-price-changes-btn"
              onClick={() => onAcceptPriceChanges()}
              className="px-4 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-zinc-950 text-xs font-bold shrink-0 cursor-pointer"
            >
              Accept Updated Prices
            </button>
          </div>
        )}

        {/* Unavailable or Unverified Item Warning Banner */}
        {(hasUnavailable || hasUnverified) && (
          <div
            data-testid="cart-unavailable-banner"
            role="alert"
            className="p-4 rounded-2xl bg-rose-500/15 border border-rose-500/35 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-rose-300">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Unavailable or Unverified Cart Items</span>
              </div>
              <p className="text-xs text-rose-100/90 leading-relaxed">
                Checkout is blocked while out-of-stock or unverified items remain in your cart. Remove unavailable items to proceed.
              </p>
            </div>
            <button
              type="button"
              data-testid="cart-remove-unavailable-btn"
              onClick={() => onRemoveUnavailableItems()}
              className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-white text-xs font-semibold shrink-0 cursor-pointer"
            >
              Remove Unavailable Items
            </button>
          </div>
        )}
      </div>

      {/* 2. LOADING STATE */}
      {cartLoading && items.length === 0 ? (
        <div
          data-testid="cart-loading-state"
          className="rounded-3xl bg-[#12101B]/90 border border-white/[0.08] p-12 text-center space-y-3"
        >
          <RefreshCw className="w-7 h-7 text-violet-400 animate-spin mx-auto" />
          <p className="text-sm font-semibold text-white">
            Loading your verified shopping cart...
          </p>
          <p className="text-xs text-zinc-400">
            Synchronizing persistent cart state from Firestore and verifying merchant offers.
          </p>
        </div>
      ) : items.length === 0 ? (
        /* 3. EMPTY CART STATE + QUICK SANDBOX ADDERS */
        <div
          data-testid="cart-empty-state"
          className="rounded-3xl bg-[#12101B]/95 border border-white/[0.09] p-8 sm:p-10 text-center space-y-6 shadow-xl"
        >
          <div className="w-16 h-16 rounded-2xl bg-violet-500/15 border border-violet-400/30 flex items-center justify-center mx-auto">
            <ShoppingCart className="w-8 h-8 text-violet-300" />
          </div>
          <div className="space-y-2 max-w-lg mx-auto">
            <h2 className="text-lg sm:text-xl font-bold text-white">
              Your Spark Cart is currently empty
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
              Add verified products from Product Discovery, AI Shopping Recommendations, Price Comparisons, or select a verified item below to test multi-item cart persistence, coupons, and PayPal Sandbox checkout.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              data-testid="empty-cart-discover-btn"
              onClick={onNavigateToDiscovery}
              className="px-5 py-2.5 rounded-full bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 text-xs sm:text-sm font-semibold text-white inline-flex items-center gap-2 shadow-lg cursor-pointer"
            >
              <Compass className="w-4 h-4" />
              <span>Explore Verified Products</span>
            </button>
            <button
              type="button"
              onClick={onNavigateToConversation}
              className="px-5 py-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] text-xs sm:text-sm font-medium text-zinc-200 inline-flex items-center gap-2 cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-violet-400" />
              <span>Ask Spark Shopping Agent</span>
            </button>
          </div>

          {onAddSandboxTestItem && sandboxCatalog.length > 0 && (
            <div className="pt-6 border-t border-white/[0.08] max-w-3xl mx-auto space-y-3 text-left">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-300">
                  Quick-Add Verified Catalog Products (Instant Cart &amp; Checkout Testing)
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  Server-Authoritative Pricing
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {sandboxCatalog.slice(0, 3).map((sku) => (
                  <div
                    key={sku.id}
                    className="p-3.5 rounded-2xl bg-zinc-900/85 border border-white/[0.07] flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <span className="text-[10px] font-mono text-violet-300">{sku.merchant}</span>
                      <h3 className="text-xs font-semibold text-white line-clamp-2">{sku.name}</h3>
                      <p className="text-sm font-mono font-bold text-emerald-300">
                        ${sku.unitPrice.toFixed(2)} {sku.currency}
                      </p>
                    </div>
                    <button
                      type="button"
                      data-testid={`empty-cart-quick-add-${sku.id}`}
                      disabled={addingSandboxSku === sku.id}
                      onClick={async () => {
                        setAddingSandboxSku(sku.id);
                        try {
                          await onAddSandboxTestItem(sku.id);
                        } finally {
                          setAddingSandboxSku(null);
                        }
                      }}
                      className="w-full py-2 px-3 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/35 text-xs font-semibold text-violet-100 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" />
                      <span>{addingSandboxSku === sku.id ? 'Adding...' : 'Add to Cart'}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* 4. POPULATED CART: 2-COLUMN WORKSPACE (ITEMS + AUTHORITATIVE SUMMARY) */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Cart Items & Channel3 Verification Findings (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold text-zinc-200">
                Cart Line Items ({uniqueCount} distinct product{uniqueCount === 1 ? '' : 's'} · {itemCount} total unit{itemCount === 1 ? '' : 's'})
              </h2>
              <span className="text-[11px] font-mono text-zinc-400">
                Currency: {currency}
              </span>
            </div>

            <div className="space-y-3.5">
              {items.map((item) => {
                const isBusy = Boolean(busyItemIds[item.itemId]);
                const variantOptions = Array.from(
                  new Set([
                    item.variantLabel || 'Standard Edition',
                    ...(item.availableVariants || []),
                    'Standard Edition',
                    'Pro Configuration',
                    'Extended Warranty Edition',
                  ])
                ).slice(0, 6);

                return (
                  <article
                    key={item.itemId}
                    data-testid={`cart-view-item-${item.productId}`}
                    className={`rounded-2xl border p-4 sm:p-5 transition-all space-y-4 ${
                      item.availability !== 'in_stock'
                        ? 'bg-rose-950/20 border-rose-500/35'
                        : item.priceChanged && !item.priceChangeAccepted
                          ? 'bg-amber-950/20 border-amber-400/40'
                          : 'bg-[#12101B]/95 border-white/[0.09] hover:border-white/[0.15]'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row gap-4">
                      {/* Product Artwork */}
                      <div className="w-full sm:w-28 h-28 shrink-0">
                        <ProductArtwork
                          imageUrl={item.imageUrl || null}
                          sourceName={item.merchant}
                          name={item.productName || 'Cart Item'}
                          className="w-full h-full rounded-xl border border-white/[0.08]"
                        />
                      </div>

                      {/* Item Core Metadata */}
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-semibold text-violet-300">
                              {item.merchant}
                            </span>
                            <span className="text-zinc-600">·</span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/[0.05] text-zinc-300 border border-white/[0.07]">
                              {item.sourceId === 'paypal_sandbox_test_catalog'
                                ? 'PayPal Sandbox SKU'
                                : 'Channel3 Verified'}
                            </span>
                            {item.sku && (
                              <span className="text-[10px] font-mono text-zinc-400">
                                SKU: {item.sku}
                              </span>
                            )}
                          </div>

                          {/* Availability Badge */}
                          <span
                            data-testid={`cart-item-availability-${item.productId}`}
                            className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border ${
                              item.availability === 'in_stock'
                                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                : item.availability === 'out_of_stock'
                                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/35'
                                  : 'bg-amber-500/20 text-amber-300 border-amber-500/35'
                            }`}
                          >
                            {item.availability === 'in_stock'
                              ? 'In Stock'
                              : item.availability === 'out_of_stock'
                                ? 'Out of Stock'
                                : 'Availability Unverified'}
                          </span>
                        </div>

                        <h3 className="text-sm sm:text-base font-semibold text-white leading-snug">
                          {item.productName}
                        </h3>

                        {/* Variant & Option Selector */}
                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                          <label
                            htmlFor={`variant-select-${item.itemId}`}
                            className="text-[11px] text-zinc-400"
                          >
                            Variant:
                          </label>
                          <select
                            id={`variant-select-${item.itemId}`}
                            data-testid={`cart-item-variant-select-${item.productId}`}
                            disabled={isBusy}
                            value={item.variantLabel || 'Standard Edition'}
                            onChange={(e) => {
                              const nextVar = e.target.value;
                              withItemLock(item.itemId, () =>
                                onUpdateVariant(item.itemId, nextVar, { Edition: nextVar })
                              );
                            }}
                            className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-white/[0.1] text-xs text-zinc-100 focus:outline-none focus:border-violet-400"
                          >
                            {variantOptions.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>

                          {onOpenProductDetails && (
                            <button
                              type="button"
                              data-testid={`cart-item-inspect-${item.productId}`}
                              onClick={() => onOpenProductDetails(item)}
                              className="text-[11px] text-violet-300 hover:text-white underline cursor-pointer"
                            >
                              Product Details
                            </button>
                          )}

                          {item.productUrl && (
                            <a
                              href={item.productUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:text-cyan-200"
                            >
                              <span>Merchant Page</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>

                        {/* Individual Price Change Alert */}
                        {item.priceChanged && !item.priceChangeAccepted && (
                          <div
                            data-testid={`cart-item-price-warning-${item.productId}`}
                            className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-400/35 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-200"
                          >
                            <span>
                              Price updated from{' '}
                              <strong className="line-through">
                                {currencySymbol}
                                {(item.previousPrice ?? item.unitPrice).toFixed(2)}
                              </strong>{' '}
                              to{' '}
                              <strong>
                                {currencySymbol}
                                {item.unitPrice.toFixed(2)}
                              </strong>
                            </span>
                            <button
                              type="button"
                              onClick={() => onAcceptPriceChanges(item.itemId)}
                              className="px-2.5 py-1 rounded-lg bg-amber-400 text-zinc-950 font-semibold text-[11px] cursor-pointer"
                            >
                              Accept New Price
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Bottom Controls: Verified Unit Price, Quantity Stepper, Subtotal & Remove */}
                    <div className="pt-3 border-t border-white/[0.07] flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="text-xs text-zinc-400">
                          Verified Unit Price:{' '}
                          <span
                            data-testid={`cart-item-unit-price-${item.productId}`}
                            className="font-mono font-semibold text-zinc-200"
                          >
                            {item.priceStatus === 'price_could_not_be_verified'
                              ? 'Unverified'
                              : `${currencySymbol}${item.unitPrice.toFixed(2)} ${item.currency}`}
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-zinc-500">
                          Shipping:{' '}
                          {item.shippingStatus === 'free'
                            ? 'Free'
                            : item.shippingStatus === 'not_applicable_digital'
                              ? 'Digital Delivery ($0.00)'
                              : item.shippingCost !== null
                                ? `${currencySymbol}${item.shippingCost.toFixed(2)} (${item.shippingStatus})`
                                : 'Unknown (Merchant checkout)'}{' '}
                          · Tax:{' '}
                          {item.taxAmount !== null
                            ? `${currencySymbol}${item.taxAmount.toFixed(2)} (${item.taxStatus})`
                            : 'Unknown (Merchant checkout)'}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {/* Quantity Selector */}
                        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-xl bg-zinc-900 border border-white/[0.09]">
                          <button
                            type="button"
                            data-testid={`cart-qty-dec-${item.productId}`}
                            aria-label={`Decrease quantity for ${item.productName}`}
                            disabled={isBusy}
                            onClick={() =>
                              withItemLock(item.itemId, () =>
                                onUpdateQuantity(item.itemId, item.quantity - 1)
                              )
                            }
                            className="w-6 h-6 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white flex items-center justify-center disabled:opacity-40 cursor-pointer"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span
                            data-testid={`cart-qty-val-${item.productId}`}
                            className="w-6 text-center font-mono text-xs font-bold text-white tabular-nums"
                          >
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            data-testid={`cart-qty-inc-${item.productId}`}
                            aria-label={`Increase quantity for ${item.productName}`}
                            disabled={isBusy || item.quantity >= 10}
                            onClick={() =>
                              withItemLock(item.itemId, () =>
                                onUpdateQuantity(item.itemId, item.quantity + 1)
                              )
                            }
                            className="w-6 h-6 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white flex items-center justify-center disabled:opacity-40 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Item Subtotal */}
                        <div className="text-right min-w-[84px]">
                          <div className="text-[10px] text-zinc-400">Item Subtotal</div>
                          <div
                            data-testid={`cart-item-subtotal-${item.productId}`}
                            className="text-sm font-mono font-bold text-emerald-300 tabular-nums"
                          >
                            {currencySymbol}
                            {item.subtotal.toFixed(2)}
                          </div>
                        </div>

                        {/* Remove Action */}
                        <button
                          type="button"
                          data-testid={`cart-remove-btn-${item.productId}`}
                          aria-label={`Remove ${item.productName} from cart`}
                          disabled={isBusy}
                          onClick={() =>
                            withItemLock(item.itemId, () => onRemoveItem(item.itemId))
                          }
                          className="p-2 rounded-xl bg-zinc-900 hover:bg-rose-500/20 border border-white/[0.08] hover:border-rose-500/35 text-zinc-400 hover:text-rose-300 transition-colors cursor-pointer"
                          title="Remove item"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Channel3 Validation Report Card */}
            {validationReport && (
              <div
                data-testid="cart-channel3-validation-report"
                className="rounded-2xl bg-zinc-900/80 border border-white/[0.08] p-4 space-y-2.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold text-violet-300">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>Channel3 &amp; Catalog Verification Report</span>
                  </div>
                  <span className="font-mono text-[10px] text-zinc-400">
                    {new Date(validationReport.validatedAt).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-zinc-300">{validationReport.providerMessage}</p>
                <div className="space-y-1.5 pt-1">
                  {validationReport.findings.map((f) => (
                    <div
                      key={f.itemId}
                      className="px-3 py-2 rounded-xl bg-black/40 border border-white/[0.05] flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <span className="font-medium text-white">{f.productName}</span>
                        <span className="text-zinc-400 ml-1.5">({f.variantLabel})</span>
                        <p className="text-[10px] font-mono text-zinc-400">{f.statusMessage}</p>
                      </div>
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                          f.verified
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-amber-500/20 text-amber-300'
                        }`}
                      >
                        {f.currentPrice !== null
                          ? `${currencySymbol}${f.currentPrice.toFixed(2)} · ${f.availability}`
                          : 'Unverified'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Coupons, Authoritative 6-Line Pricing Breakdown & Checkout Prep (5 cols) */}
          <div className="lg:col-span-5 space-y-5 lg:sticky lg:top-6">
            {/* Coupons & Promotional Discounts Card */}
            <div
              data-testid="cart-coupon-section"
              className="rounded-3xl bg-[#12101B]/95 border border-white/[0.1] p-5 space-y-4 shadow-xl"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-violet-300">
                  <TicketPercent className="w-4 h-4 text-violet-400" />
                  <span>Coupons &amp; Discounts</span>
                </div>
                <span className="text-[10px] font-mono text-zinc-400">
                  Feedico Partner Engine
                </span>
              </div>

              <form onSubmit={handleCouponSubmit} className="flex gap-2">
                <label htmlFor="cart-coupon-input" className="sr-only">
                  Coupon Code
                </label>
                <input
                  id="cart-coupon-input"
                  data-testid="cart-coupon-input"
                  type="text"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  placeholder="Enter promo code (e.g. SPARK10)"
                  className="flex-1 min-w-0 px-3.5 py-2 rounded-xl bg-zinc-900 border border-white/[0.1] text-xs font-mono text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-400"
                />
                <button
                  type="submit"
                  data-testid="cart-apply-coupon-btn"
                  disabled={couponBusy || !couponInput.trim()}
                  className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-xs font-semibold text-white shrink-0 cursor-pointer"
                >
                  {couponBusy ? 'Checking...' : 'Apply'}
                </button>
              </form>

              {/* Active Applied Coupon Pill */}
              {cart?.appliedCouponCode && (
                <div
                  data-testid="cart-active-coupon-pill"
                  className={`p-3 rounded-2xl border flex items-center justify-between gap-2 text-xs ${
                    cart.couponStatus === 'applied_verified'
                      ? 'bg-emerald-500/12 border-emerald-500/30 text-emerald-200'
                      : 'bg-amber-500/12 border-amber-500/30 text-amber-200'
                  }`}
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-1.5 font-mono font-bold">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Code: {cart.appliedCouponCode}</span>
                    </div>
                    <p className="text-[11px] opacity-90">{cart.couponMessage}</p>
                  </div>
                  <button
                    type="button"
                    data-testid="cart-remove-coupon-btn"
                    onClick={async () => {
                      setCouponFeedback(null);
                      setCouponInput('');
                      await onRemoveCoupon();
                    }}
                    className="p-1.5 rounded-lg bg-black/30 hover:bg-black/50 text-zinc-300 hover:text-white shrink-0 cursor-pointer"
                    title="Remove coupon"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {couponFeedback && !cart?.appliedCouponCode && (
                <div
                  data-testid="cart-coupon-feedback"
                  className={`p-2.5 rounded-xl text-xs ${
                    couponFeedback.type === 'success'
                      ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/30'
                      : 'bg-rose-500/15 text-rose-200 border border-rose-500/30'
                  }`}
                >
                  {couponFeedback.text}
                </div>
              )}

              {/* Quick-Apply Verified Coupon Chips */}
              <div className="space-y-1.5">
                <span className="text-[11px] text-zinc-400 block">
                  Available Verified Coupons (Click to Apply):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    ...DEFAULT_PROMO_CHIPS,
                    ...availableCoupons
                      .filter(
                        (c) =>
                          c.verificationStatus === 'verified' &&
                          c.code &&
                          c.code !== 'NO_CODE_NEEDED' &&
                          !DEFAULT_PROMO_CHIPS.some((d) => d.code === c.code.toUpperCase())
                      )
                      .slice(0, 2)
                      .map((c) => ({
                        code: c.code.toUpperCase(),
                        label: c.code.toUpperCase(),
                        subtitle: c.title || c.description,
                      })),
                  ].map((chip) => (
                    <button
                      key={chip.code}
                      type="button"
                      data-testid={`cart-quick-coupon-${chip.code}`}
                      onClick={() => handleQuickApplyCoupon(chip.code)}
                      className="px-2.5 py-1.5 rounded-xl bg-zinc-900 hover:bg-violet-500/20 border border-white/[0.08] hover:border-violet-400/35 text-left transition-colors cursor-pointer"
                    >
                      <span className="text-[11px] font-mono font-bold text-violet-300 block">
                        {chip.label}
                      </span>
                      <span className="text-[10px] text-zinc-400 block">{chip.subtitle}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Authoritative 6-Line Pricing Breakdown & Checkout Preparation */}
            <div
              data-testid="cart-pricing-breakdown-card"
              className="rounded-3xl bg-gradient-to-b from-[#161324]/95 to-[#0E0C17]/95 border border-white/[0.12] p-5 sm:p-6 space-y-5 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-white/[0.08] pb-3.5">
                <div>
                  <h2 className="text-sm font-bold text-white">
                    Authoritative Order Summary
                  </h2>
                  <p className="text-[11px] text-zinc-400">
                    Calculated server-side · Minor-unit precision
                  </p>
                </div>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  {cart?.isCompleteVerifiedTotal ? 'Complete Verified Total' : 'Merchant Checkout Est.'}
                </span>
              </div>

              <div className="space-y-2.5 text-xs">
                {/* 1. Merchandise Subtotal */}
                <div className="flex items-center justify-between text-zinc-300">
                  <span>1. Merchandise Subtotal ({itemCount} items)</span>
                  <span
                    data-testid="cart-summary-subtotal"
                    className="font-mono font-semibold text-white tabular-nums"
                  >
                    {currencySymbol}
                    {subtotal.toFixed(2)} {currency}
                  </span>
                </div>

                {/* 2. Verified Discounts */}
                <div className="flex items-center justify-between text-zinc-300">
                  <span>
                    2. Verified Discounts
                    {cart?.appliedCouponCode ? ` (${cart.appliedCouponCode})` : ''}
                  </span>
                  <span
                    data-testid="cart-summary-discount"
                    className={`font-mono font-semibold tabular-nums ${
                      verifiedDiscounts > 0 ? 'text-emerald-400' : 'text-zinc-400'
                    }`}
                  >
                    {verifiedDiscounts > 0
                      ? `-${currencySymbol}${verifiedDiscounts.toFixed(2)} ${currency}`
                      : `${currencySymbol}0.00`}
                  </span>
                </div>

                {/* 3. Shipping Cost */}
                <div className="flex items-center justify-between text-zinc-300">
                  <span>3. Shipping Cost</span>
                  <span
                    data-testid="cart-summary-shipping"
                    className="font-mono text-zinc-200 tabular-nums text-right"
                  >
                    {cart?.hasUnknownShipping || cart?.shippingStatusSummary === 'unknown' ? (
                      <span className="text-amber-300">
                        Unknown · Calculated at merchant checkout
                      </span>
                    ) : cart?.shippingStatusSummary === 'free' || cart?.knownShippingTotal === 0 ? (
                      <span className="text-emerald-300">Free ({currencySymbol}0.00)</span>
                    ) : (
                      `${currencySymbol}${(cart?.knownShippingTotal || 0).toFixed(2)} (${
                        cart?.shippingStatusSummary
                      })`
                    )}
                  </span>
                </div>

                {/* 4. Tax */}
                <div className="flex items-center justify-between text-zinc-300">
                  <span>4. Estimated / Verified Tax</span>
                  <span
                    data-testid="cart-summary-tax"
                    className="font-mono text-zinc-200 tabular-nums text-right"
                  >
                    {cart?.hasUnknownTax || cart?.taxStatusSummary === 'unknown' ? (
                      <span className="text-amber-300">
                        Unknown · Calculated at merchant checkout
                      </span>
                    ) : (
                      `${currencySymbol}${(cart?.knownTaxTotal || 0).toFixed(2)} (${
                        cart?.taxStatusSummary
                      })`
                    )}
                  </span>
                </div>

                {/* 5. Additional Known Fees */}
                <div className="flex items-center justify-between text-zinc-300">
                  <span>5. Additional Known Fees</span>
                  <span
                    data-testid="cart-summary-fees"
                    className="font-mono text-zinc-300 tabular-nums"
                  >
                    {currencySymbol}
                    {additionalFees.toFixed(2)}
                  </span>
                </div>

                {/* 6. Final Payable Total */}
                <div className="pt-3 border-t border-white/[0.1] flex items-baseline justify-between">
                  <div>
                    <span className="text-sm font-bold text-white block">
                      6. Final Payable Total
                    </span>
                    {(cart?.hasUnknownShipping || cart?.hasUnknownTax) && (
                      <span className="text-[10px] text-amber-300/90 block">
                        Excludes unverified third-party shipping/tax
                      </span>
                    )}
                  </div>
                  <span
                    data-testid="cart-summary-total"
                    className="text-lg sm:text-xl font-mono font-bold text-emerald-300 tabular-nums"
                  >
                    {currencySymbol}
                    {finalPayableTotal.toFixed(2)} {currency}
                  </span>
                </div>
              </div>

              {/* Checkout Blockers Disclosure */}
              {cart?.checkoutBlockers && cart.checkoutBlockers.length > 0 && (
                <div
                  data-testid="cart-checkout-blockers"
                  className="p-3.5 rounded-2xl bg-rose-950/40 border border-rose-500/35 space-y-1.5 text-xs text-rose-200"
                >
                  <div className="font-semibold flex items-center gap-1.5 text-rose-300">
                    <Lock className="w-3.5 h-3.5 shrink-0" />
                    <span>Action Required Before Checkout</span>
                  </div>
                  <ul className="list-disc pl-4 space-y-1 text-[11px]">
                    {cart.checkoutBlockers.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Checkout Preparation Verification Result */}
              {checkoutPreparation && checkoutPreparation.ready && (
                <div
                  data-testid="cart-checkout-prep-ready"
                  className="p-3 rounded-2xl bg-emerald-500/12 border border-emerald-500/30 text-xs text-emerald-200 flex items-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    Checkout preparation verified (Rev #{checkoutPreparation.revision}). Ready for PayPal Sandbox authorization.
                  </span>
                </div>
              )}

              {/* Primary Checkout Action */}
              <button
                type="button"
                data-testid="cart-proceed-to-checkout-btn"
                disabled={!canProceed || isPreparingCheckout}
                onClick={() => onPrepareAndProceedToCheckout()}
                className="w-full py-3.5 px-5 rounded-2xl bg-gradient-to-r from-[#D884F8] via-[#F0A3D8] to-[#F7CBA8] hover:opacity-95 disabled:opacity-40 text-[#140E21] text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-xl transition-all cursor-pointer disabled:cursor-not-allowed"
              >
                <ShoppingBag className="w-4 h-4" />
                <span>
                  {isPreparingCheckout
                    ? 'Validating Cart & Preparing Checkout...'
                    : `Proceed to PayPal Sandbox Checkout (${currencySymbol}${finalPayableTotal.toFixed(
                        2
                      )})`}
                </span>
              </button>

              <div className="p-3 rounded-xl bg-black/30 border border-white/[0.06] flex items-start gap-2 text-[11px] text-zinc-400 leading-relaxed">
                <Info className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                <span>
                  <strong>PayPal Sandbox Safety Boundary:</strong> Clicking Proceed validates all cart items and opens the PayPal Sandbox confirmation modal. No payment is ever captured without your explicit review and approval.
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
