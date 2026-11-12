import React, { useMemo, useState, useEffect } from 'react';
import {
  Compass,
  Search,
  SlidersHorizontal,
  ArrowUpDown,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  X,
  Clock,
  Layers,
  ShieldCheck,
  Filter,
} from 'lucide-react';
import type { ActiveSearchFilters, RankedProductOffer } from '../types/spark';
import {
  ProductResultGrid,
  ProductListView,
} from './conversation/ProductResultViews';

export interface DiscoverViewProps {
  offers: RankedProductOffer[];
  discoverySourceFilter: string;
  onChangeSourceFilter: (source: string) => void;
  activeFilters: ActiveSearchFilters;
  onUpdateActiveFilters: (patch: Partial<ActiveSearchFilters>) => void;
  onResetFilters: () => void;
  viewMode: 'grid' | 'list';
  onChangeViewMode: (mode: 'grid' | 'list') => void;
  isSearching: boolean;
  onRunDiscoveryQuery: (query: string) => Promise<void> | void;
  recommendedProductId: string | null;
  comparedProductIds: string[];
  savedProductIds: string[];
  onToggleCompare: (productId: string) => void;
  onToggleSave: (product: RankedProductOffer) => void;
  onOpenDetails: (product: RankedProductOffer) => void;
  onSelectForCheckout: (product: RankedProductOffer) => void;
  onAddToCart: (product: RankedProductOffer) => void;
  onInspectCompound: (compoundName: string) => void;
  recentSearches?: string[];
}

const DISCOVER_CATEGORIES = [
  { id: 'all', label: 'All Categories', query: '' },
  {
    id: 'audio',
    label: 'Headphones & Audio',
    query: 'Best wireless noise cancelling headphones under $350',
  },
  {
    id: 'laptops',
    label: 'Laptops & Computing',
    query: 'Compare top ultrabook laptops for engineering under $1200',
  },
  {
    id: 'monitors',
    label: 'Monitors & Displays',
    query: 'Best 4K USB-C monitors for productivity under $600',
  },
  {
    id: 'espresso',
    label: 'Home & Espresso',
    query: 'Best home espresso machines with PID temperature control under $700',
  },
  {
    id: 'books',
    label: 'Books & Research',
    query: 'Compare classic books on artificial intelligence and distributed systems',
  },
];

const RECENT_DISCOVERY_STORAGE_KEY = 'spark_recent_discovery_searches_v1';

export const DiscoverView: React.FC<DiscoverViewProps> = ({
  offers,
  discoverySourceFilter,
  onChangeSourceFilter,
  activeFilters,
  onUpdateActiveFilters,
  onResetFilters,
  viewMode,
  onChangeViewMode,
  isSearching,
  onRunDiscoveryQuery,
  recommendedProductId,
  comparedProductIds,
  savedProductIds,
  onToggleCompare,
  onToggleSave,
  onOpenDetails,
  onSelectForCheckout,
  onAddToCart,
  onInspectCompound,
  recentSearches: externalRecentSearches = [],
}) => {
  const [searchInput, setSearchInput] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedMerchant, setSelectedMerchant] = useState<string>('all');
  const [keywordFilter, setKeywordFilter] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(9);
  const [localRecentSearches, setLocalRecentSearches] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(RECENT_DISCOVERY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.slice(0, 8);
      }
    } catch {
      // Ignore storage errors
    }
    return [
      'Wireless noise cancelling headphones under $350',
      '4K monitor for MacBook Pro under $500',
      'Artificial intelligence textbooks',
    ];
  });

  useEffect(() => {
    if (externalRecentSearches.length > 0) {
      setLocalRecentSearches((prev) => {
        const merged = Array.from(new Set([...externalRecentSearches, ...prev])).slice(0, 8);
        try {
          localStorage.setItem(RECENT_DISCOVERY_STORAGE_KEY, JSON.stringify(merged));
        } catch {
          // Ignore
        }
        return merged;
      });
    }
  }, [externalRecentSearches]);

  const recordSearchTerm = (term: string) => {
    const clean = term.trim();
    if (!clean) return;
    setLocalRecentSearches((prev) => {
      const next = [clean, ...prev.filter((s) => s.toLowerCase() !== clean.toLowerCase())].slice(
        0,
        8
      );
      try {
        localStorage.setItem(RECENT_DISCOVERY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore
      }
      return next;
    });
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = searchInput.trim();
    if (!clean || isSearching) return;
    recordSearchTerm(clean);
    setVisibleLimit(9);
    await onRunDiscoveryQuery(clean);
  };

  // Deduplicate offers by canonical product ID or normalized title+merchant
  const { deduplicatedOffers, duplicatesRemovedCount } = useMemo(() => {
    const seenKeys = new Set<string>();
    const unique: RankedProductOffer[] = [];
    let dupCount = 0;

    for (const offer of offers) {
      const normKey = `${offer.id || ''}::${(offer.name || '').trim().toLowerCase()}::${(
        offer.merchant || ''
      )
        .trim()
        .toLowerCase()}`;
      if (seenKeys.has(normKey)) {
        dupCount++;
        continue;
      }
      seenKeys.add(normKey);
      unique.push(offer);
    }
    return { deduplicatedOffers: unique, duplicatesRemovedCount: dupCount };
  }, [offers]);

  // Available merchants across discovered offers
  const merchants = useMemo(() => {
    const set = new Set<string>();
    for (const o of deduplicatedOffers) {
      if (o.merchant && o.merchant.trim()) {
        set.add(o.merchant.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [deduplicatedOffers]);

  // Apply all active filters & sorting
  const filteredAndSortedOffers = useMemo(() => {
    const kw = keywordFilter.trim().toLowerCase();
    const filtered = deduplicatedOffers.filter((o) => {
      if (discoverySourceFilter !== 'all' && o.sourceId !== discoverySourceFilter) {
        return false;
      }
      if (selectedMerchant !== 'all' && o.merchant !== selectedMerchant) {
        return false;
      }
      if (activeFilters.verifiedPriceOnly) {
        if (o.price === null || o.priceStatus !== 'verified') return false;
      }
      if (activeFilters.inStockOnly) {
        if (o.availabilityStatus !== 'verified_in_stock') return false;
      }
      if (activeFilters.maxPrice !== null) {
        if (o.price === null || o.priceStatus !== 'verified' || o.price > activeFilters.maxPrice) {
          return false;
        }
      }
      if (kw) {
        const hay = `${o.name} ${o.merchant} ${o.category} ${o.summary}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (activeFilters.sortBy === 'price_asc') {
        const pa = a.price !== null && a.priceStatus === 'verified' ? a.price : Number.MAX_SAFE_INTEGER;
        const pb = b.price !== null && b.priceStatus === 'verified' ? b.price : Number.MAX_SAFE_INTEGER;
        return pa - pb;
      }
      if (activeFilters.sortBy === 'price_desc') {
        const pa = a.price !== null && a.priceStatus === 'verified' ? a.price : -1;
        const pb = b.price !== null && b.priceStatus === 'verified' ? b.price : -1;
        return pb - pa;
      }
      if (activeFilters.sortBy === 'rating_desc') {
        const ra = a.rating ?? a.qualityAdjustedScore?.scoreOutOf10 ?? -1;
        const rb = b.rating ?? b.qualityAdjustedScore?.scoreOutOf10 ?? -1;
        return rb - ra;
      }
      return (b.completenessScore || 0) - (a.completenessScore || 0);
    });

    return sorted;
  }, [
    deduplicatedOffers,
    discoverySourceFilter,
    selectedMerchant,
    activeFilters,
    keywordFilter,
  ]);

  const visibleOffers = filteredAndSortedOffers.slice(0, visibleLimit);

  return (
    <section
      data-testid="spark-discover-view"
      aria-label="Global Product Discovery Workspace"
      className="max-w-6xl mx-auto px-4 sm:px-8 py-6 space-y-6"
    >
      {/* 1. HEADER & LIVE CHANNEL3 SEARCH BAR */}
      <div className="rounded-3xl bg-gradient-to-br from-[#141222]/95 via-[#100E1A]/95 to-[#0B0A12]/95 border border-white/[0.1] p-5 sm:p-6 shadow-2xl space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-violet-500/20 text-violet-200 border border-violet-400/30">
                <Compass className="w-3.5 h-3.5 text-violet-300" />
                <span>Channel3 Global Product Graph</span>
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Zero Synthetic Fallbacks</span>
              </span>
              {duplicatesRemovedCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-cyan-500/15 text-cyan-200 border border-cyan-500/30">
                  <Layers className="w-3 h-3" />
                  <span>{duplicatesRemovedCount} duplicate(s) deduplicated</span>
                </span>
              )}
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              Global Product Discovery
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400">
              Query live merchant listings via Channel3 API and OpenLibrary, filter by price, merchant, and stock verification, and compare or add directly to Cart.
            </p>
          </div>

          {/* Source Adapter Switcher */}
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            {[
              { id: 'all', label: `All Sources (${deduplicatedOffers.length})` },
              {
                id: 'channel3_api',
                label: `Channel3 (${
                  deduplicatedOffers.filter((o) => o.sourceId === 'channel3_api').length
                })`,
              },
              {
                id: 'openlibrary_api',
                label: `OpenLibrary (${
                  deduplicatedOffers.filter((o) => o.sourceId === 'openlibrary_api').length
                })`,
              },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                data-testid={`discover-source-${tab.id}`}
                onClick={() => onChangeSourceFilter(tab.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                  discoverySourceFilter === tab.id
                    ? 'bg-violet-600 text-white'
                    : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-white/[0.08]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Direct Channel3 Discovery Search Form */}
        <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-violet-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              data-testid="discover-search-input"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search live products on Channel3 (e.g. 'Sony WH-1000XM5 headphones under $350')..."
              aria-label="Search live products on Channel3"
              className="w-full pl-10 pr-9 py-2.5 rounded-2xl bg-zinc-950/90 border border-white/[0.12] text-xs sm:text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-400"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                aria-label="Clear search query"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            type="submit"
            data-testid="discover-search-submit-btn"
            disabled={isSearching || !searchInput.trim()}
            className="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 disabled:opacity-50 text-xs sm:text-sm font-semibold text-white inline-flex items-center justify-center gap-2 shrink-0 cursor-pointer shadow-lg"
          >
            {isSearching ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Searching Channel3...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Discover Live Offers</span>
              </>
            )}
          </button>
        </form>

        {/* Category Navigation Pills */}
        <div
          role="group"
          aria-label="Discovery category navigation"
          className="flex flex-wrap items-center gap-2"
        >
          {DISCOVER_CATEGORIES.map((cat) => {
            const isActive = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                data-testid={`discover-category-${cat.id}`}
                disabled={isSearching}
                onClick={async () => {
                  setSelectedCategory(cat.id);
                  if (cat.query) {
                    setSearchInput(cat.query);
                    recordSearchTerm(cat.query);
                    await onRunDiscoveryQuery(cat.query);
                  }
                }}
                className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer ${
                  isActive
                    ? 'bg-violet-500/25 border border-violet-400/50 text-violet-100'
                    : 'bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-300'
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Recent Discovery Searches Strip */}
        {localRecentSearches.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/[0.07] text-xs">
            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-zinc-400">
              <Clock className="w-3 h-3 text-zinc-500" />
              <span>Recent:</span>
            </span>
            {localRecentSearches.slice(0, 4).map((term) => (
              <button
                key={term}
                type="button"
                disabled={isSearching}
                onClick={async () => {
                  setSearchInput(term);
                  await onRunDiscoveryQuery(term);
                }}
                className="px-2.5 py-1 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 border border-white/[0.07] text-[11px] text-zinc-300 hover:text-white truncate max-w-[240px] cursor-pointer"
              >
                {term}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 2. FILTER, MERCHANT, PRICE & SORT TOOLBAR */}
      <div
        data-testid="discover-filter-toolbar"
        className="rounded-2xl bg-[#12101B]/95 border border-white/[0.09] p-4 flex flex-wrap items-center justify-between gap-3"
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-300 mr-1">
            <Filter className="w-3.5 h-3.5" />
            <span>Filters:</span>
          </div>

          {/* Instant Keyword Filter within current results */}
          <input
            type="text"
            data-testid="discover-within-results-input"
            value={keywordFilter}
            onChange={(e) => {
              setKeywordFilter(e.target.value);
              setVisibleLimit(9);
            }}
            placeholder="Filter current results..."
            aria-label="Filter within discovered results"
            className="px-3 py-1.5 rounded-xl bg-zinc-900 border border-white/[0.1] text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-violet-400 w-44"
          />

          {/* Merchant Filter */}
          <select
            data-testid="discover-merchant-select"
            aria-label="Filter by merchant"
            value={selectedMerchant}
            onChange={(e) => {
              setSelectedMerchant(e.target.value);
              setVisibleLimit(9);
            }}
            className="px-3 py-1.5 rounded-xl bg-zinc-900 border border-white/[0.1] text-xs text-zinc-200 focus:outline-none focus:border-violet-400"
          >
            <option value="all">All Merchants ({merchants.length})</option>
            {merchants.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          {/* Max Price Ceiling Selector */}
          <select
            data-testid="discover-max-price-select"
            aria-label="Filter by maximum price"
            value={activeFilters.maxPrice === null ? 'all' : String(activeFilters.maxPrice)}
            onChange={(e) => {
              const val = e.target.value;
              onUpdateActiveFilters({
                maxPrice: val === 'all' ? null : Number(val),
              });
              setVisibleLimit(9);
            }}
            className="px-3 py-1.5 rounded-xl bg-zinc-900 border border-white/[0.1] text-xs text-zinc-200 focus:outline-none focus:border-violet-400"
          >
            <option value="all">Any Price</option>
            <option value="50">Under $50</option>
            <option value="150">Under $150</option>
            <option value="350">Under $350</option>
            <option value="600">Under $600</option>
            <option value="1200">Under $1,200</option>
          </select>

          {/* Verified Price Only Toggle */}
          <button
            type="button"
            data-testid="discover-verified-price-toggle"
            aria-pressed={activeFilters.verifiedPriceOnly}
            onClick={() =>
              onUpdateActiveFilters({
                verifiedPriceOnly: !activeFilters.verifiedPriceOnly,
              })
            }
            className={`px-3 py-1.5 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer ${
              activeFilters.verifiedPriceOnly
                ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200'
                : 'bg-zinc-900 border-white/[0.1] text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Verified Price Only</span>
          </button>

          {/* In-Stock Only Toggle */}
          <button
            type="button"
            data-testid="discover-instock-toggle"
            aria-pressed={activeFilters.inStockOnly}
            onClick={() =>
              onUpdateActiveFilters({
                inStockOnly: !activeFilters.inStockOnly,
              })
            }
            className={`px-3 py-1.5 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer ${
              activeFilters.inStockOnly
                ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-200'
                : 'bg-zinc-900 border-white/[0.1] text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>In Stock Only</span>
          </button>
        </div>

        {/* Sort & Reset Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <ArrowUpDown className="w-3.5 h-3.5 text-zinc-400" />
            <select
              data-testid="discover-sort-select"
              aria-label="Sort discovered products"
              value={activeFilters.sortBy}
              onChange={(e) =>
                onUpdateActiveFilters({
                  sortBy: e.target.value as ActiveSearchFilters['sortBy'],
                })
              }
              className="px-3 py-1.5 rounded-xl bg-zinc-900 border border-white/[0.1] text-xs text-zinc-200 focus:outline-none focus:border-violet-400"
            >
              <option value="relevance">Sort: Relevance &amp; Completeness</option>
              <option value="price_asc">Sort: Price Low to High</option>
              <option value="price_desc">Sort: Price High to Low</option>
              <option value="rating_desc">Sort: Highest Rating / Score</option>
            </select>
          </div>

          <button
            type="button"
            data-testid="discover-reset-filters-btn"
            onClick={() => {
              setSelectedMerchant('all');
              setKeywordFilter('');
              onChangeSourceFilter('all');
              onResetFilters();
            }}
            className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs text-zinc-300 cursor-pointer"
          >
            Reset Filters
          </button>
        </div>
      </div>

      {/* 3. RESULTS SUMMARY & GRID / LIST */}
      {isSearching && deduplicatedOffers.length === 0 ? (
        <div className="rounded-3xl bg-[#121217]/85 border border-white/[0.08] p-12 text-center space-y-3">
          <RefreshCw className="w-7 h-7 text-violet-400 animate-spin mx-auto" />
          <h2 className="text-base font-semibold text-white">
            Querying Channel3 Global Product Graph...
          </h2>
          <p className="text-xs text-zinc-400">
            Retrieving live merchant pricing, stock verification, and product telemetry.
          </p>
        </div>
      ) : filteredAndSortedOffers.length === 0 ? (
        <div
          data-testid="discover-empty-state"
          className="rounded-3xl bg-[#121217]/85 border border-white/[0.08] p-10 text-center space-y-4"
        >
          <Compass className="w-8 h-8 text-violet-400 mx-auto" />
          <div className="space-y-1 max-w-md mx-auto">
            <h2 className="text-base font-semibold text-white">
              {deduplicatedOffers.length === 0
                ? 'No live products discovered in this session yet'
                : 'No discovered products match your active filters'}
            </h2>
            <p className="text-xs text-zinc-400">
              {deduplicatedOffers.length === 0
                ? 'Run a live Channel3 product search above or click a quick category below to populate the Global Product Discovery grid.'
                : 'Try relaxing your price ceiling, merchant filter, or stock filter to view all discovered offers.'}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {deduplicatedOffers.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSelectedMerchant('all');
                  setKeywordFilter('');
                  onChangeSourceFilter('all');
                  onResetFilters();
                }}
                className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white cursor-pointer"
              >
                Clear Active Filters ({deduplicatedOffers.length} available)
              </button>
            )}
            <button
              type="button"
              data-testid="discover-preset-headphones-btn"
              onClick={() =>
                onRunDiscoveryQuery(
                  'Compare wireless noise cancelling headphones under $350'
                )
              }
              className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs text-zinc-200 cursor-pointer"
            >
              Discover Headphones (Channel3)
            </button>
            <button
              type="button"
              data-testid="discover-preset-books-btn"
              onClick={() =>
                onRunDiscoveryQuery('Compare books on artificial intelligence')
              }
              className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs text-zinc-200 cursor-pointer"
            >
              Discover AI Books (OpenLibrary)
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-zinc-400">
            <span>
              Showing <strong className="text-white">{visibleOffers.length}</strong> of{' '}
              <strong className="text-white">{filteredAndSortedOffers.length}</strong> verified
              product offer(s)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onChangeViewMode('grid')}
                className={`px-2.5 py-1 rounded-lg text-xs cursor-pointer ${
                  viewMode === 'grid'
                    ? 'bg-violet-500/20 text-violet-200 border border-violet-400/40'
                    : 'bg-zinc-900 text-zinc-400'
                }`}
              >
                Grid View
              </button>
              <button
                type="button"
                onClick={() => onChangeViewMode('list')}
                className={`px-2.5 py-1 rounded-lg text-xs cursor-pointer ${
                  viewMode === 'list'
                    ? 'bg-violet-500/20 text-violet-200 border border-violet-400/40'
                    : 'bg-zinc-900 text-zinc-400'
                }`}
              >
                List View
              </button>
            </div>
          </div>

          {viewMode === 'grid' ? (
            <ProductResultGrid
              offers={visibleOffers}
              recommendedProductId={recommendedProductId}
              comparedProductIds={comparedProductIds}
              savedProductIds={savedProductIds}
              onToggleCompare={onToggleCompare}
              onToggleSave={onToggleSave}
              onOpenDetails={onOpenDetails}
              onSelectForCheckout={onSelectForCheckout}
              onAddToCart={onAddToCart}
              onInspectCompound={onInspectCompound}
            />
          ) : (
            <ProductListView
              offers={visibleOffers}
              recommendedProductId={recommendedProductId}
              comparedProductIds={comparedProductIds}
              savedProductIds={savedProductIds}
              onToggleCompare={onToggleCompare}
              onToggleSave={onToggleSave}
              onOpenDetails={onOpenDetails}
              onSelectForCheckout={onSelectForCheckout}
              onAddToCart={onAddToCart}
            />
          )}

          {filteredAndSortedOffers.length > visibleLimit && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                data-testid="discover-load-more-btn"
                onClick={() => setVisibleLimit((prev) => prev + 9)}
                className="px-6 py-2.5 rounded-2xl bg-zinc-900 hover:bg-zinc-800 border border-violet-400/35 text-xs font-semibold text-violet-200 cursor-pointer"
              >
                Load More Verified Offers ({filteredAndSortedOffers.length - visibleLimit}{' '}
                remaining)
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
