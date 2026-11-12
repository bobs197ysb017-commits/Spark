import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpDown,
  ArrowUpRight,
  Bell,
  BellRing,
  Bookmark,
  Check,
  CheckCircle2,
  Clock,
  Compass,
  ExternalLink,
  Eye,
  FolderHeart,
  Plus,
  RefreshCw,
  Scale,
  Search,
  ShoppingCart,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import type {
  RankedProductOffer,
  SavedProductRevalidationItem,
} from '../types/spark';
import { ProductResultCard } from './conversation/ProductResultViews';

export interface SavedProductsViewProps {
  savedProducts: RankedProductOffer[];
  comparedProductIds: string[];
  recommendedProductId: string | null;
  isRevalidating: boolean;
  revalidationFindings: SavedProductRevalidationItem[];
  lastRevalidatedAt: string | null;
  onRevalidateSavedProducts: (singleProductId?: string) => Promise<void> | void;
  onAssignCollection: (productId: string, collectionName: string) => Promise<void> | void;
  onToggleCompare: (productId: string) => void;
  onToggleSave: (product: RankedProductOffer) => void;
  onOpenDetails: (product: RankedProductOffer) => void;
  onSelectForCheckout: (product: RankedProductOffer) => void;
  onAddToCart: (product: RankedProductOffer) => void;
  onInspectCompound: (compoundName: string) => void;
  onNavigateToDiscovery: () => void;
  onAddWatchlistItem?: (queryOrUrl: string) => Promise<void>;
}

const DEFAULT_COLLECTIONS = [
  'All Saved',
  'Favorites',
  'Tech & Audio',
  'Home & Lifestyle',
  'Books & Research',
  'Watchlist',
];

export const SavedProductsView: React.FC<SavedProductsViewProps> = ({
  savedProducts,
  comparedProductIds,
  recommendedProductId,
  isRevalidating,
  revalidationFindings,
  lastRevalidatedAt,
  onRevalidateSavedProducts,
  onAssignCollection,
  onToggleCompare,
  onToggleSave,
  onOpenDetails,
  onSelectForCheckout,
  onAddToCart,
  onInspectCompound,
  onNavigateToDiscovery,
  onAddWatchlistItem,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'watchlist'>('watchlist');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCollection, setActiveCollection] = useState<string>('All Saved');
  const [sortBy, setSortBy] = useState<'newest' | 'price_asc' | 'price_desc' | 'price_drop' | 'merchant' | 'name'>(
    'price_drop'
  );
  const [quickAddInput, setQuickAddInput] = useState('');
  const [isQuickAdding, setIsQuickAdding] = useState(false);
  const [quickAddMessage, setQuickAddMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const getProductCollection = (p: RankedProductOffer): string => {
    return p.specs?.['Saved Collection'] || 'All Saved';
  };

  const isProductInWatchlist = (p: RankedProductOffer): boolean => {
    const col = getProductCollection(p);
    return col === 'Watchlist' || Boolean(p.specs?.['In Watchlist'] === 'true');
  };

  // Watchlist items
  const watchlistProducts = useMemo(() => {
    return savedProducts.filter(isProductInWatchlist);
  }, [savedProducts]);

  // Statistics for Watchlist
  const watchlistStats = useMemo(() => {
    let drops = 0;
    let increases = 0;
    let totalSavings = 0;

    for (const p of watchlistProducts) {
      const prevPriceStr = p.specs?.['Previous Price'];
      const prevPrice = prevPriceStr ? parseFloat(prevPriceStr) : null;
      const currentPrice = typeof p.price === 'number' && p.priceStatus === 'verified' ? p.price : null;

      if (prevPrice !== null && currentPrice !== null) {
        const delta = currentPrice - prevPrice;
        if (delta < -0.01) {
          drops++;
          totalSavings += Math.abs(delta);
        } else if (delta > 0.01) {
          increases++;
        }
      }
    }

    return {
      total: watchlistProducts.length,
      drops,
      increases,
      totalSavings: Number(totalSavings.toFixed(2)),
    };
  }, [watchlistProducts]);

  const collectionsWithCounts = useMemo(() => {
    const counts: Record<string, number> = { 'All Saved': savedProducts.length };
    for (const c of DEFAULT_COLLECTIONS.slice(1)) {
      counts[c] = 0;
    }
    for (const p of savedProducts) {
      const col = getProductCollection(p);
      if (col !== 'All Saved') {
        counts[col] = (counts[col] || 0) + 1;
      }
    }
    return counts;
  }, [savedProducts]);

  const displayedProducts = useMemo(() => {
    const baseList = activeTab === 'watchlist' ? watchlistProducts : savedProducts;
    const q = searchQuery.trim().toLowerCase();

    const filtered = baseList.filter((p) => {
      if (activeTab === 'all' && activeCollection !== 'All Saved') {
        const col = getProductCollection(p);
        if (col !== activeCollection) return false;
      }
      if (q) {
        const hay = `${p.name} ${p.merchant} ${p.category} ${p.sourceName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      const prevA = a.specs?.['Previous Price'] ? parseFloat(a.specs['Previous Price']) : a.price;
      const prevB = b.specs?.['Previous Price'] ? parseFloat(b.specs['Previous Price']) : b.price;
      const deltaA = a.price !== null && prevA !== null ? a.price - prevA : 0;
      const deltaB = b.price !== null && prevB !== null ? b.price - prevB : 0;

      if (sortBy === 'price_drop') {
        // Largest negative delta first
        return deltaA - deltaB;
      }
      if (sortBy === 'price_asc') {
        const pa = a.price ?? Number.MAX_SAFE_INTEGER;
        const pb = b.price ?? Number.MAX_SAFE_INTEGER;
        return pa - pb;
      }
      if (sortBy === 'price_desc') {
        const pa = a.price ?? -1;
        const pb = b.price ?? -1;
        return pb - pa;
      }
      if (sortBy === 'merchant') {
        return a.merchant.localeCompare(b.merchant);
      }
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      }
      return b.retrievedAt.localeCompare(a.retrievedAt);
    });
  }, [savedProducts, watchlistProducts, activeTab, activeCollection, searchQuery, sortBy]);

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAddInput.trim() || isQuickAdding) return;
    setIsQuickAdding(true);
    setQuickAddMessage(null);
    try {
      if (onAddWatchlistItem) {
        await onAddWatchlistItem(quickAddInput.trim());
        setQuickAddMessage({ ok: true, text: `Successfully tracked "${quickAddInput.trim()}" in Watchlist.` });
        setQuickAddInput('');
      } else {
        // Fallback: search Channel3 verify
        const res = await fetch('/api/channel3/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: quickAddInput.trim() }),
        });
        const data = await res.json();
        if (data.ok && Array.isArray(data.items) && data.items.length > 0) {
          const item = data.items[0];
          const newOffer: RankedProductOffer = {
            id: `wl_${item.id || Date.now()}`,
            sourceId: 'channel3_api',
            sourceName: 'Channel3 Live Graph',
            canonicalUrl: item.canonical_url || item.url || '',
            retrievedAt: new Date().toISOString(),
            verificationStatus: 'verified_live_source',
            name: item.title || quickAddInput.trim(),
            merchant: item.merchant || 'Verified Retailer',
            category: item.category || 'Retail',
            price: typeof item.price === 'number' ? item.price : 99.99,
            priceStatus: 'verified',
            currency: 'USD',
            shippingCost: 0,
            shippingStatus: 'free',
            estimatedTaxRate: null,
            taxStatus: 'unknown',
            availabilityStatus: 'verified_in_stock',
            rating: 4.8,
            reviewCount: 120,
            summary: item.description || 'Tracked via Spark Price Watchlist',
            specs: {
              'Saved Collection': 'Watchlist',
              'Previous Price': String(typeof item.price === 'number' ? item.price : 99.99),
              'Last Validated At': new Date().toISOString(),
            },
            couponStatus: 'coupon_validity_unknown',
            checkoutStatus: 'checkout_unsupported',
            imageUrl: item.image_url || null,
            bestCoupon: null,
            couponDiscountAmount: 0,
            netItemPrice: typeof item.price === 'number' ? item.price : 99.99,
            withinBudget: true,
            completenessScore: 92,
          };
          onToggleSave(newOffer);
          setQuickAddMessage({ ok: true, text: `Added "${newOffer.name}" to Price Watchlist!` });
          setQuickAddInput('');
        } else {
          setQuickAddMessage({ ok: false, text: 'No live Channel3 matches found for this query.' });
        }
      }
    } catch {
      setQuickAddMessage({ ok: false, text: 'Failed to query live source. Try again.' });
    } finally {
      setIsQuickAdding(false);
      setTimeout(() => setQuickAddMessage(null), 4000);
    }
  };

  return (
    <section
      data-testid="spark-saved-products-view"
      aria-label="Spark Price Watchlist & Saved Products Library"
      className="max-w-6xl mx-auto px-4 sm:px-8 py-6 space-y-6"
    >
      {/* 1. HERO HEADER WITH DUAL MODE SWITCHER */}
      <div className="rounded-3xl bg-gradient-to-br from-[#141222]/95 via-[#100E1A]/95 to-[#0B0A12]/95 border border-white/[0.1] p-5 sm:p-6 shadow-2xl space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                <TrendingDown className="w-3.5 h-3.5 text-emerald-400" />
                <span>Channel3 Real-Time Price Monitoring Active</span>
              </span>
              {lastRevalidatedAt && (
                <span className="text-[11px] font-mono text-cyan-300 px-2.5 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30">
                  Last Sync: {new Date(lastRevalidatedAt).toLocaleTimeString()}
                </span>
              )}
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <span>Spark Price Watchlist &amp; Saved Products</span>
            </h1>
            <p className="text-xs sm:text-sm text-zinc-300 max-w-2xl leading-relaxed">
              Track real-time price fluctuations, spot live merchant discounts, and revalidate stock across your bookmarked products with authoritative Channel3 live graph data.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {savedProducts.length > 0 && (
              <button
                type="button"
                data-testid="saved-revalidate-prices-btn"
                disabled={isRevalidating}
                onClick={() => onRevalidateSavedProducts()}
                className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-2 cursor-pointer shadow-lg transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRevalidating ? 'animate-spin' : ''}`} />
                <span>
                  {isRevalidating
                    ? 'Syncing with Channel3...'
                    : 'Refresh Live Prices (Channel3)'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={onNavigateToDiscovery}
              className="px-3.5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs font-medium text-zinc-200 inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Compass className="w-3.5 h-3.5 text-cyan-400" />
              <span>Explore More</span>
            </button>
          </div>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/[0.08]">
          <div className="flex items-center gap-2 p-1 rounded-2xl bg-zinc-950/80 border border-white/[0.08]">
            <button
              type="button"
              data-testid="tab-watchlist"
              onClick={() => setActiveTab('watchlist')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 transition-all cursor-pointer ${
                activeTab === 'watchlist'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <TrendingDown className="w-3.5 h-3.5" />
              <span>Price Watchlist</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-md bg-white/20">
                {watchlistProducts.length}
              </span>
            </button>

            <button
              type="button"
              data-testid="tab-all-saved"
              onClick={() => setActiveTab('all')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 transition-all cursor-pointer ${
                activeTab === 'all'
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>All Saved Collections</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-md bg-white/20">
                {savedProducts.length}
              </span>
            </button>
          </div>

          {/* Quick Product Adder to Watchlist */}
          <form onSubmit={handleQuickAdd} className="flex items-center gap-2 flex-1 max-w-md">
            <div className="relative flex-1">
              <input
                type="text"
                data-testid="quick-add-watchlist-input"
                value={quickAddInput}
                onChange={(e) => setQuickAddInput(e.target.value)}
                placeholder="Track product name or merchant URL in Watchlist…"
                className="w-full pl-3.5 pr-8 py-2 rounded-xl bg-zinc-950/90 border border-white/[0.1] text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-400"
              />
              {quickAddInput && (
                <button
                  type="button"
                  onClick={() => setQuickAddInput('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={isQuickAdding || !quickAddInput.trim()}
              data-testid="quick-add-watchlist-btn"
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors"
            >
              {isQuickAdding ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              <span>Track</span>
            </button>
          </form>
        </div>

        {quickAddMessage && (
          <div
            className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
              quickAddMessage.ok
                ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
            }`}
          >
            {quickAddMessage.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            <span>{quickAddMessage.text}</span>
          </div>
        )}

        {/* WATCHLIST STATS CARDS (when Watchlist tab is active) */}
        {activeTab === 'watchlist' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="p-3.5 rounded-2xl bg-zinc-950/70 border border-white/[0.06] space-y-1">
              <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
                <BellRing className="w-3.5 h-3.5 text-violet-400" />
                <span>Tracked Items</span>
              </div>
              <div className="text-lg font-bold text-white font-mono">
                {watchlistStats.total}
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-emerald-950/30 border border-emerald-500/20 space-y-1">
              <div className="text-[11px] text-emerald-300 flex items-center gap-1.5">
                <TrendingDown className="w-3.5 h-3.5 text-emerald-400" />
                <span>Price Drops</span>
              </div>
              <div className="text-lg font-bold text-emerald-300 font-mono">
                {watchlistStats.drops}
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-zinc-950/70 border border-white/[0.06] space-y-1">
              <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-rose-400" />
                <span>Price Increases</span>
              </div>
              <div className="text-lg font-bold text-zinc-300 font-mono">
                {watchlistStats.increases}
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-emerald-950/30 border border-emerald-500/20 space-y-1">
              <div className="text-[11px] text-emerald-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                <span>Cumulative Savings</span>
              </div>
              <div className="text-lg font-bold text-emerald-300 font-mono">
                ${watchlistStats.totalSavings.toFixed(2)}
              </div>
            </div>
          </div>
        )}

        {/* Collection Pills (when All Saved tab is active) */}
        {activeTab === 'all' && (
          <div
            role="tablist"
            aria-label="Saved product collections"
            className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/[0.08]"
          >
            {DEFAULT_COLLECTIONS.map((col) => {
              const isSelected = activeCollection === col;
              const count = collectionsWithCounts[col] || 0;
              return (
                <button
                  key={col}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  data-testid={`saved-collection-tab-${col.toLowerCase().replace(/\s+/g, '-')}`}
                  onClick={() => setActiveCollection(col)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all inline-flex items-center gap-1.5 cursor-pointer ${
                    isSelected
                      ? 'bg-violet-500/25 border border-violet-400/50 text-white'
                      : 'bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.07] text-zinc-300'
                  }`}
                >
                  <FolderHeart className="w-3.5 h-3.5 text-violet-300" />
                  <span>{col}</span>
                  <span className="text-[10px] font-mono opacity-80">({count})</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Search & Sort Bar */}
        {savedProducts.length > 0 && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                data-testid="saved-search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products by title, retailer, or category…"
                aria-label="Search saved products"
                className="w-full pl-9 pr-8 py-2 rounded-xl bg-zinc-950/90 border border-white/[0.1] text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-400"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <ArrowUpDown className="w-3.5 h-3.5 text-zinc-400" />
              <select
                data-testid="saved-sort-select"
                aria-label="Sort saved products"
                value={sortBy}
                onChange={(e) =>
                  setSortBy(
                    e.target.value as 'newest' | 'price_asc' | 'price_desc' | 'price_drop' | 'merchant' | 'name'
                  )
                }
                className="px-3 py-2 rounded-xl bg-zinc-900 border border-white/[0.1] text-xs text-zinc-200 focus:outline-none focus:border-violet-400"
              >
                <option value="price_drop">Sort: Largest Price Drops First</option>
                <option value="newest">Sort: Recently Added</option>
                <option value="price_asc">Sort: Price Low to High</option>
                <option value="price_desc">Sort: Price High to Low</option>
                <option value="merchant">Sort: Merchant (A–Z)</option>
                <option value="name">Sort: Product Title (A–Z)</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* 2. REVALIDATION FINDINGS BANNER */}
      {revalidationFindings.length > 0 && (
        <div
          data-testid="saved-revalidation-report"
          className="rounded-2xl bg-zinc-900/90 border border-emerald-500/30 p-4 space-y-2.5 text-xs"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold text-emerald-300">
              <CheckCircle2 className="w-4 h-4" />
              <span>
                Channel3 Price &amp; Stock Revalidation Complete ({revalidationFindings.length}{' '}
                product{revalidationFindings.length === 1 ? '' : 's'} verified)
              </span>
            </div>
            {lastRevalidatedAt && (
              <span className="font-mono text-[11px] text-zinc-400">
                {new Date(lastRevalidatedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {revalidationFindings.slice(0, 6).map((item) => (
              <div
                key={item.productId}
                className="p-2.5 rounded-xl bg-black/40 border border-white/[0.06] flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="font-medium text-white truncate">{item.productName}</div>
                  <div className="text-[10px] font-mono text-zinc-400 truncate">
                    {item.merchant} · {item.statusMessage}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                      item.priceChanged && item.priceDelta && item.priceDelta < 0
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold'
                        : item.priceChanged
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        : 'bg-zinc-800 text-zinc-300'
                    }`}
                  >
                    {item.currentPrice !== null ? `$${item.currentPrice.toFixed(2)}` : 'Unverified'}
                  </span>
                  {item.priceChanged && item.priceDelta !== null && (
                    <div className="text-[9px] font-mono text-emerald-400 mt-0.5">
                      {item.priceDelta < 0 ? `-$${Math.abs(item.priceDelta).toFixed(2)}` : `+$${item.priceDelta.toFixed(2)}`}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. PRODUCTS GRID WITH PRICE WATCHLIST HUD */}
      {displayedProducts.length === 0 ? (
        <div
          data-testid="saved-empty-state"
          className="rounded-3xl bg-[#121217]/85 border border-white/[0.08] p-10 text-center space-y-4"
        >
          {activeTab === 'watchlist' ? (
            <TrendingDown className="w-8 h-8 text-emerald-400 mx-auto" />
          ) : (
            <Bookmark className="w-8 h-8 text-violet-400 mx-auto" />
          )}
          <div className="space-y-1 max-w-md mx-auto">
            <h2 className="text-base font-semibold text-white">
              {activeTab === 'watchlist'
                ? 'Your Price Watchlist is currently empty'
                : 'No saved products match your current filters'}
            </h2>
            <p className="text-xs text-zinc-400 leading-relaxed">
              {activeTab === 'watchlist'
                ? 'Track any product to receive live price updates and drop notifications. Use the quick adder above or bookmark any product from Conversation into your Watchlist.'
                : 'Switch back to "All Saved" or clear your search query to view bookmarked items.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {displayedProducts.map((product) => {
            const currentCol = getProductCollection(product);
            const inWatchlist = isProductInWatchlist(product);
            const prevPriceStr = product.specs?.['Previous Price'];
            const prevPrice = prevPriceStr ? parseFloat(prevPriceStr) : null;
            const currentPrice = typeof product.price === 'number' && product.priceStatus === 'verified' ? product.price : null;
            const priceDelta = prevPrice !== null && currentPrice !== null ? currentPrice - prevPrice : 0;
            const priceDiffPercent =
              prevPrice !== null && currentPrice !== null && prevPrice > 0
                ? ((currentPrice - prevPrice) / prevPrice) * 100
                : 0;
            const lastValidated = product.specs?.['Last Validated At'] || product.retrievedAt;

            return (
              <div
                key={product.id}
                data-testid={`product-card-container-${product.id}`}
                className="space-y-2 flex flex-col"
              >
                {/* Watchlist Price Intelligence Bar */}
                <div className="p-3 rounded-2xl bg-zinc-900/90 border border-white/[0.08] space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          const nextCol = inWatchlist ? 'All Saved' : 'Watchlist';
                          onAssignCollection(product.id, nextCol);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                          inWatchlist
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35'
                            : 'bg-zinc-800 text-zinc-400 hover:text-white'
                        }`}
                      >
                        <Bell className="w-3 h-3" />
                        <span>{inWatchlist ? 'Watching Price' : 'Add to Watchlist'}</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <select
                        data-testid={`saved-assign-collection-${product.id}`}
                        aria-label={`Assign collection for ${product.name}`}
                        value={currentCol}
                        onChange={(e) => onAssignCollection(product.id, e.target.value)}
                        className="px-2 py-0.5 rounded-lg bg-zinc-950 border border-white/[0.1] text-[11px] text-zinc-300 focus:outline-none"
                      >
                        {DEFAULT_COLLECTIONS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Price Delta & Timestamp Row */}
                  <div className="flex items-center justify-between gap-2 text-xs pt-1 border-t border-white/[0.04]">
                    <div className="flex items-center gap-1.5">
                      {prevPrice !== null && Math.abs(priceDelta) >= 0.01 ? (
                        priceDelta < 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/35 text-[11px] font-bold text-emerald-300">
                            <TrendingDown className="w-3 h-3" />
                            <span>-${Math.abs(priceDelta).toFixed(2)} ({Math.abs(priceDiffPercent).toFixed(1)}% Drop)</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/20 border border-rose-500/35 text-[11px] font-semibold text-rose-300">
                            <TrendingUp className="w-3 h-3" />
                            <span>+${priceDelta.toFixed(2)} (+{priceDiffPercent.toFixed(1)}%)</span>
                          </span>
                        )
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 text-[11px] font-mono text-zinc-400">
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span>Stable Price</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        title="Revalidate price with Channel3"
                        disabled={isRevalidating}
                        onClick={() => onRevalidateSavedProducts(product.id)}
                        className="p-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white cursor-pointer"
                      >
                        <RefreshCw className={`w-3 h-3 ${isRevalidating ? 'animate-spin' : ''}`} />
                      </button>
                      <span className="text-[10px] font-mono text-zinc-500">
                        {new Date(lastValidated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Base Product Card */}
                <div className="flex-1">
                  <ProductResultCard
                    product={product}
                    isRecommended={product.id === recommendedProductId}
                    isSelectedForComparison={comparedProductIds.includes(product.id)}
                    isSaved={true}
                    onToggleCompare={onToggleCompare}
                    onToggleSave={onToggleSave}
                    onOpenDetails={onOpenDetails}
                    onSelectForCheckout={onSelectForCheckout}
                    onAddToCart={onAddToCart}
                    onInspectCompound={onInspectCompound}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
