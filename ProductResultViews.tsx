import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ExternalLink,
  Eye,
  FlaskConical,
  Minus,
  Plus,
  Scale,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import type {
  ActiveSearchFilters,
  ExtractedShoppingIntent,
  RankedProductOffer,
  UserCartSummary,
} from '../../types/spark';
import {
  computePriceFreshness,
  deriveCardAnalysis,
  deriveFilterChips,
} from '../../utils/shoppingLogic';
import {
  getCleanUserFacingSpecs,
  isInternalMetadataSpecKey,
  sanitizeUserFacingAttributeValue,
} from '../../utils/productPresentationSanitizer';

export interface ProductResultCardProps {
  product: RankedProductOffer;
  isRecommended?: boolean;
  isSelectedForComparison: boolean;
  isSaved: boolean;
  onToggleCompare: (productId: string) => void;
  onToggleSave: (product: RankedProductOffer) => void;
  onOpenDetails: (product: RankedProductOffer) => void;
  onSelectForCheckout: (product: RankedProductOffer) => void;
  onAddToCart?: (product: RankedProductOffer) => void;
  onInspectCompound?: (compoundName: string) => void;
}

export const ProductResultCard: React.FC<ProductResultCardProps> = ({
  product,
  isRecommended,
  isSelectedForComparison,
  isSaved,
  onToggleCompare,
  onToggleSave,
  onOpenDetails,
  onSelectForCheckout,
  onAddToCart,
  onInspectCompound,
}) => {
  const [imgError, setImgError] = useState(false);
  const [activeImageIdx, setActiveImageIdx] = useState(0);

  const hasVerifiedPrice = product.price !== null && product.priceStatus === 'verified';
  const analysis = useMemo(() => deriveCardAnalysis(product), [product]);
  const freshness = useMemo(
    () => computePriceFreshness(product.retrievedAt, product.priceStatus),
    [product.retrievedAt, product.priceStatus]
  );

  const gallery = useMemo(() => {
    const imgs: string[] = [];
    if (product.imageUrl) imgs.push(product.imageUrl);
    if (product.galleryImages) {
      for (const g of product.galleryImages) {
        if (g && !imgs.includes(g)) imgs.push(g);
      }
    }
    return imgs;
  }, [product.imageUrl, product.galleryImages]);

  const currentImageUrl = gallery[activeImageIdx] || product.imageUrl;

  const brandName = useMemo(() => {
    const rawBrand =
      product.richProfile?.identity?.brand ||
      product.specs['Brand'] ||
      product.specs['Author'] ||
      product.name.split(' ')[0];
    if (!rawBrand || /unverified|unknown|not provided/i.test(rawBrand)) return null;
    return rawBrand;
  }, [product]);

  const verifiedSpecEntries = useMemo(() => {
    const cleanSpecs = getCleanUserFacingSpecs(
      product.richProfile?.technicalSpecsByCategory || product.specs || {},
      { includeUnspecified: false, includeCondition: false }
    );
    return Object.entries(cleanSpecs).slice(0, 4);
  }, [product]);

  const merchantBadgeText = useMemo(() => {
    const cleanMerchant = (product.merchant || 'Store').replace(/[^a-zA-Z0-9]/g, '');
    return cleanMerchant.slice(0, 4).toUpperCase() || 'SHOP';
  }, [product.merchant]);

  const knownModelNumber = useMemo(() => {
    const rawModel =
      product.specs?.['Manufacturer Model Number'] ||
      product.specs?.['Model Number'] ||
      product.specs?.['MPN'] ||
      '';
    if (!rawModel || isInternalMetadataSpecKey('Manufacturer Model Number', rawModel)) {
      return null;
    }
    return rawModel.trim();
  }, [product.specs]);

  const formattedPrice = useMemo(() => {
    if (!hasVerifiedPrice) return 'Price Unverified';
    if (product.price === 0) return '$0';
    const symbol =
      product.currency === 'EUR' ? '€' : product.currency === 'GBP' ? '£' : '$';
    return Number.isInteger(product.price)
      ? `${symbol}${product.price}`
      : `${symbol}${product.price!.toFixed(2)}`;
  }, [hasVerifiedPrice, product.price, product.currency]);

  return (
    <article className="group relative rounded-[26px] bg-[#12101B]/95 hover:bg-[#161322] border border-white/[0.15] hover:border-violet-300/45 p-5 flex flex-col justify-between transition-all duration-200 hover:-translate-y-0.5 shadow-[0_24px_60px_rgba(0,0,0,0.65)]">
      <div>
        {/* Top Floating Compare & Bookmark Controls + Centered Product Image */}
        <div className="relative h-44 flex flex-col items-center justify-center mb-4 rounded-2xl bg-gradient-to-b from-white/[0.05] via-white/[0.02] to-transparent border border-white/[0.06] overflow-hidden p-3">
          <div className="absolute top-2 left-2 flex flex-wrap items-center gap-1.5 z-10 max-w-[75%]">
            <button
              type="button"
              onClick={() => onToggleCompare(product.id)}
              aria-pressed={isSelectedForComparison}
              className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium inline-flex items-center gap-1 transition-colors cursor-pointer backdrop-blur-md ${
                isSelectedForComparison
                  ? 'bg-violet-500/30 border-violet-300/60 text-violet-100'
                  : 'bg-black/55 hover:bg-black/75 border-white/15 text-zinc-200 hover:text-white'
              }`}
            >
              {isSelectedForComparison ? (
                <Check className="w-3 h-3 text-violet-300" />
              ) : (
                <Scale className="w-3 h-3 text-zinc-400" />
              )}
              <span>{isSelectedForComparison ? 'Comparing' : 'Compare'}</span>
            </button>

            {(product.recommendationTier || isRecommended) && (
              <span
                data-testid="product-recommendation-tier"
                className="text-[10px] font-semibold px-2.5 py-0.5 rounded-md bg-violet-500/30 border border-violet-400/50 text-violet-100 backdrop-blur-md"
              >
                {product.recommendationTier || 'Best Overall'}
              </span>
            )}
            {product.qualityAdjustedScore && (
              <span
                data-testid="product-quality-score"
                title={`Rating: ${(product.qualityAdjustedScore.scoreOutOf10 ?? product.qualityAdjustedScore.totalQualityAdjustedScore / 10).toFixed(1)}/10 · Quality-Adjusted Score: ${product.qualityAdjustedScore.totalQualityAdjustedScore}/100 (${product.qualityAdjustedScore.evidenceConfidence || 'MODERATE'} Evidence)`}
                className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-emerald-500/25 border border-emerald-500/40 text-emerald-200 backdrop-blur-md"
              >
                {(product.qualityAdjustedScore.scoreOutOf10 ?? product.qualityAdjustedScore.totalQualityAdjustedScore / 10).toFixed(1)}/10 · Q:{product.qualityAdjustedScore.totalQualityAdjustedScore}
              </span>
            )}
          </div>

          <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
            <button
              type="button"
              onClick={() => onOpenDetails(product)}
              aria-label={`Inspect details for ${product.name}`}
              title="Inspect verified specs"
              className="p-1.5 rounded-lg bg-black/55 hover:bg-black/75 border border-white/15 text-zinc-200 hover:text-white transition-colors cursor-pointer backdrop-blur-md"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onToggleSave(product)}
              aria-label={isSaved ? `Remove ${product.name} from saved` : `Save ${product.name}`}
              aria-pressed={isSaved}
              className={`p-1.5 rounded-lg border transition-colors cursor-pointer backdrop-blur-md ${
                isSaved
                  ? 'bg-violet-500/30 border-violet-400/60 text-violet-200'
                  : 'bg-black/55 hover:bg-black/75 border-white/15 text-zinc-200 hover:text-white'
              }`}
            >
              <Bookmark className={`w-3.5 h-3.5 ${isSaved ? 'fill-current' : ''}`} />
            </button>
          </div>

          {currentImageUrl && !imgError ? (
            <img
              src={currentImageUrl}
              alt={product.name}
              referrerPolicy="no-referrer"
              loading="lazy"
              onError={() => setImgError(true)}
              onClick={() => onOpenDetails(product)}
              className="h-28 w-28 sm:h-32 sm:w-32 object-contain rounded-xl drop-shadow-[0_14px_28px_rgba(0,0,0,0.75)] transition-transform duration-200 group-hover:scale-105 cursor-pointer mt-3"
            />
          ) : (
            <div
              onClick={() => onOpenDetails(product)}
              className="h-28 w-28 rounded-2xl bg-gradient-to-br from-violet-500/20 via-indigo-500/15 to-cyan-500/10 border border-white/15 flex flex-col items-center justify-center p-2.5 text-center cursor-pointer mt-3"
            >
              <ShoppingBag className="w-6 h-6 text-violet-300 mb-1" />
              <span className="text-[10px] font-mono text-zinc-300 line-clamp-2">
                {product.merchant}
              </span>
            </div>
          )}

          {/* Multi-Image Gallery Dots / Switcher */}
          {gallery.length > 1 && !imgError && (
            <div className="absolute bottom-2 inset-x-0 flex items-center justify-center gap-1.5 z-10">
              {gallery.slice(0, 5).map((imgUrl, idx) => (
                <button
                  key={imgUrl}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveImageIdx(idx);
                  }}
                  aria-label={`View product image ${idx + 1}`}
                  className={`h-1.5 rounded-full transition-all cursor-pointer ${
                    activeImageIdx === idx
                      ? 'w-4 bg-violet-400'
                      : 'w-1.5 bg-white/30 hover:bg-white/60'
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Brand, Category & Availability Header */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-mono text-violet-300 min-w-0">
            {brandName && <span className="font-semibold text-violet-200">{brandName}</span>}
            {brandName && product.category && <span className="text-zinc-600">·</span>}
            {product.category && (
              <span className="text-zinc-400 truncate max-w-[160px]">{product.category}</span>
            )}
            {knownModelNumber && (
              <>
                <span className="text-zinc-600">·</span>
                <span className="text-zinc-400 truncate max-w-[100px]">
                  Model: {knownModelNumber}
                </span>
              </>
            )}
          </div>
          {product.availabilityStatus === 'verified_in_stock' && (
            <span className="text-[10px] font-mono text-emerald-300">
              In Stock
            </span>
          )}
        </div>

        {/* Product Title */}
        <h3
          onClick={() => onOpenDetails(product)}
          className="text-[15px] font-semibold text-white hover:text-violet-200 leading-snug line-clamp-2 mb-2 cursor-pointer transition-colors"
        >
          {product.name}
        </h3>

        {/* Key Verified Specifications Pills (gracefully hidden when absent) */}
        {verifiedSpecEntries.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {verifiedSpecEntries.map(([k, v]) => (
              <span
                key={k}
                className="px-2 py-0.5 rounded-md bg-white/[0.05] border border-white/[0.08] text-[10px] font-mono text-zinc-300 truncate max-w-full"
                title={`${k}: ${String(v)}`}
              >
                <span className="text-zinc-400">{k}:</span> {String(v)}
              </span>
            ))}
          </div>
        )}

        {/* Verified Strengths (✓ Green Checkmarks) */}
        <div className="space-y-1.5 mb-2.5">
          {analysis.pros.slice(0, 2).map((pro, idx) => {
            const cleanTitle =
              pro.title === 'Verified Source Provenance'
                ? 'Verified Merchant Offer'
                : pro.title;
            const cleanDesc =
              pro.title === 'Verified Source Provenance'
                ? `Listed by ${product.merchant}${product.availabilityStatus === 'verified_in_stock' ? ' · In stock' : ''}.`
                : sanitizeUserFacingAttributeValue(pro.description);
            return (
              <div key={idx} className="flex items-start gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-zinc-100 leading-tight truncate">
                    {cleanTitle}
                  </p>
                  <p className="text-[11px] text-zinc-400 leading-snug line-clamp-1">
                    {cleanDesc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Verified Limitations / Disclosures (✕ Rose Crosses) */}
        <div className="space-y-1.5 mb-3.5">
          {analysis.cons.slice(0, 1).map((con, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <X className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-200 leading-tight truncate">
                  {con.title}
                </p>
                <p className="text-[11px] text-zinc-400 leading-snug line-clamp-1">
                  {con.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        {/* Merchant & Source Attribution Row between hairline dividers */}
        <div className="border-t border-b border-white/[0.1] py-2.5 mb-3.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-white text-[#12101B] font-bold text-[10px] tracking-tight flex items-center justify-center shrink-0 shadow-xs">
              {merchantBadgeText}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-white truncate">
                {product.merchant}
                {(product.merchantOffersCount || product.richProfile?.merchantOffers?.length || 0) > 1 && (
                  <span className="ml-1.5 px-1.5 py-0.2 rounded bg-cyan-500/15 border border-cyan-500/30 text-[10px] font-mono text-cyan-300">
                    +{(product.merchantOffersCount || product.richProfile?.merchantOffers?.length || 1) - 1} more
                  </span>
                )}
              </p>
              <div className="flex items-center gap-1.5 text-[11px] font-mono">
                {product.rating !== null ? (
                  <span className="inline-flex items-center gap-1 text-amber-400">
                    <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                    <span>{product.rating.toFixed(1)}</span>
                    {product.reviewCount !== null && (
                      <span className="text-zinc-400">({product.reviewCount})</span>
                    )}
                  </span>
                ) : (
                  <span className="text-zinc-400">{freshness.label}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onOpenDetails(product)}
              className="px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-[11px] font-medium text-zinc-200 hover:text-white transition-colors cursor-pointer"
            >
              View Details
            </button>
            <a
              href={product.canonicalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1 rounded-lg bg-violet-500/15 hover:bg-violet-500/25 border border-violet-400/30 text-[11px] font-medium text-violet-200 hover:text-white inline-flex items-center gap-1 transition-colors"
            >
              <span>Visit Store</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        {/* Bottom Price, Availability & Warm Gradient Buy Now CTA */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span
                className={`font-mono tabular-nums font-bold ${
                  hasVerifiedPrice
                    ? 'text-lg sm:text-xl text-white'
                    : 'text-sm text-amber-300'
                }`}
              >
                {formattedPrice}
              </span>
              {product.specs['Compare At Price'] && (
                <span className="text-xs font-mono text-zinc-500 line-through tabular-nums">
                  {product.specs['Compare At Price']}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  product.availabilityStatus === 'verified_in_stock'
                    ? 'bg-emerald-400'
                    : 'bg-cyan-400'
                }`}
              />
              <span className="text-[10px] font-mono text-zinc-400">
                {product.availabilityStatus === 'verified_in_stock'
                  ? 'Verified in stock'
                  : 'Available via merchant'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            {product.activeCompound && onInspectCompound && (
              <button
                type="button"
                onClick={() => onInspectCompound(product.activeCompound!)}
                title={`Verify ${product.activeCompound} on PubChem`}
                className="p-2 rounded-full bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/30 text-cyan-200 cursor-pointer"
              >
                <FlaskConical className="w-4 h-4" />
              </button>
            )}

            {onAddToCart && hasVerifiedPrice && (
              <button
                type="button"
                data-testid={`card-add-to-cart-${product.id}`}
                onClick={() => onAddToCart(product)}
                title="Add to Spark Sandbox Cart"
                className="px-3 py-1.5 rounded-full bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/40 text-violet-100 font-semibold text-xs inline-flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ShoppingCart className="w-3.5 h-3.5 text-violet-300" />
                <span>Add to Cart</span>
              </button>
            )}

            <button
              type="button"
              data-testid={`card-buy-now-${product.id}`}
              onClick={() => onSelectForCheckout(product)}
              className="px-4 py-1.5 rounded-full bg-gradient-to-r from-[#D884F8] via-[#F0A3D8] to-[#F7CBA8] hover:brightness-110 text-[#140E21] font-semibold text-xs shadow-[0_8px_24px_rgba(216,132,248,0.28)] transition-all whitespace-nowrap shrink-0 cursor-pointer"
            >
              Buy Now
            </button>
          </div>
        </div>
      </div>
    </article>
  );
};

export interface ProductResultViewProps {
  offers: RankedProductOffer[];
  queryTitle?: string;
  intent?: ExtractedShoppingIntent;
  recommendedProductId: string | null;
  comparedProductIds: string[];
  savedProductIds: string[];
  onToggleCompare: (productId: string) => void;
  onToggleSave: (product: RankedProductOffer) => void;
  onOpenDetails: (product: RankedProductOffer) => void;
  onSelectForCheckout: (product: RankedProductOffer) => void;
  onAddToCart?: (product: RankedProductOffer) => void;
  onInspectCompound?: (compoundName: string) => void;
}

export const ProductResultGrid: React.FC<ProductResultViewProps> = ({
  offers,
  queryTitle,
  intent,
  recommendedProductId,
  comparedProductIds,
  savedProductIds,
  onToggleCompare,
  onToggleSave,
  onOpenDetails,
  onSelectForCheckout,
  onAddToCart,
  onInspectCompound,
}) => {
  const [activeChipId, setActiveChipId] = useState<string>('all');
  const [pageIndex, setPageIndex] = useState(0);

  const filterChips = useMemo(() => {
    if (!intent) return [];
    return deriveFilterChips(offers, intent);
  }, [offers, intent]);

  const chipFilteredOffers = useMemo(() => {
    const activeChip = filterChips.find((c) => c.id === activeChipId);
    if (!activeChip || activeChip.type === 'all') return offers;
    if (activeChip.type === 'category') {
      return offers.filter(
        (o) => (o.specs['Primary Genre'] || o.category) === activeChip.value
      );
    }
    if (activeChip.type === 'verified_price') {
      return offers.filter((o) => o.price !== null && o.priceStatus === 'verified');
    }
    if (activeChip.type === 'budget' && typeof activeChip.value === 'number') {
      return offers.filter(
        (o) =>
          o.price !== null &&
          o.priceStatus === 'verified' &&
          o.price <= (activeChip.value as number)
      );
    }
    if (activeChip.type === 'free') {
      return offers.filter((o) => o.price === 0 && o.priceStatus === 'verified');
    }
    if (activeChip.type === 'source' && typeof activeChip.value === 'string') {
      return offers.filter((o) => o.sourceId === activeChip.value);
    }
    return offers;
  }, [offers, filterChips, activeChipId]);

  const pageSize = 3;
  const totalPages = Math.max(1, Math.ceil(chipFilteredOffers.length / pageSize));
  const safePage = Math.min(pageIndex, totalPages - 1);
  const visibleOffers = chipFilteredOffers.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize
  );

  const handleNextPage = () => {
    setPageIndex((prev) => (prev + 1) % totalPages);
  };

  const handlePrevPage = () => {
    setPageIndex((prev) => (prev - 1 + totalPages) % totalPages);
  };

  return (
    <div className="space-y-6">
      {/* Top Query Heading & Interactive Filter Chips Bar */}
      {(queryTitle || filterChips.length > 1) && (
        <div className="space-y-3.5">
          {queryTitle && (
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl sm:text-2xl font-medium text-white tracking-tight">
                {queryTitle}
              </h2>
              {totalPages > 1 && (
                <span className="text-xs font-mono text-zinc-400">
                  Showing {safePage * pageSize + 1}–
                  {Math.min((safePage + 1) * pageSize, chipFilteredOffers.length)} of{' '}
                  {chipFilteredOffers.length} verified products
                </span>
              )}
            </div>
          )}

          {filterChips.length > 1 && (
            <div
              role="group"
              aria-label="Interactive product filters"
              className="flex flex-wrap items-center gap-2.5"
            >
              {filterChips.map((chip) => {
                const isActive = activeChipId === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => {
                      setActiveChipId(chip.id);
                      setPageIndex(0);
                    }}
                    aria-pressed={isActive}
                    className={`px-5 py-2 rounded-full text-xs sm:text-sm font-medium transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                      isActive
                        ? 'bg-[#3B2763] border border-violet-300/45 text-white shadow-[0_4px_20px_rgba(139,92,246,0.28)]'
                        : 'bg-[#24193C]/80 hover:bg-[#2F214D] border border-violet-300/15 text-zinc-200'
                    }`}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 3-Column Product Cards Showcase + Carousel Navigation */}
      <div className="relative flex items-center gap-4">
        {totalPages > 1 && safePage > 0 && (
          <button
            type="button"
            onClick={handlePrevPage}
            aria-label="Previous product results"
            className="hidden xl:flex w-12 h-12 rounded-full bg-[#2A233D]/90 hover:bg-[#3A3054] border border-white/15 text-white items-center justify-center shrink-0 shadow-lg transition-all cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}

        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {visibleOffers.map((offer) => (
            <ProductResultCard
              key={offer.id}
              product={offer}
              isRecommended={offer.id === recommendedProductId}
              isSelectedForComparison={comparedProductIds.includes(offer.id)}
              isSaved={savedProductIds.includes(offer.id)}
              onToggleCompare={onToggleCompare}
              onToggleSave={onToggleSave}
              onOpenDetails={onOpenDetails}
              onSelectForCheckout={onSelectForCheckout}
              onAddToCart={onAddToCart}
              onInspectCompound={onInspectCompound}
            />
          ))}
        </div>

        {totalPages > 1 && (
          <button
            type="button"
            onClick={handleNextPage}
            aria-label="Next product results"
            className="w-12 h-12 rounded-full bg-[#2A233D]/90 hover:bg-[#3A3054] border border-white/15 text-white flex items-center justify-center shrink-0 shadow-[0_8px_25px_rgba(0,0,0,0.5)] transition-all cursor-pointer"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
};

export const ProductListView: React.FC<ProductResultViewProps> = ({
  offers,
  recommendedProductId,
  comparedProductIds,
  savedProductIds,
  onToggleCompare,
  onToggleSave,
  onOpenDetails,
  onSelectForCheckout,
  onAddToCart,
}) => {
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-3">
      {offers.map((offer) => {
        const hasPrice = offer.price !== null && offer.priceStatus === 'verified';
        const isCompared = comparedProductIds.includes(offer.id);
        const isSaved = savedProductIds.includes(offer.id);
        const hasImgError = offer.imageUrl ? imgErrors[offer.id] : true;
        return (
          <div
            key={offer.id}
            className="rounded-2xl bg-[#13111C]/95 border border-white/[0.12] hover:border-violet-400/35 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors"
          >
            <div className="flex items-start gap-3.5 min-w-0">
              {offer.imageUrl && !hasImgError ? (
                <img
                  src={offer.imageUrl}
                  alt={offer.name}
                  referrerPolicy="no-referrer"
                  onError={() => setImgErrors((prev) => ({ ...prev, [offer.id]: true }))}
                  onClick={() => onOpenDetails(offer)}
                  className="w-16 h-16 rounded-xl object-contain bg-zinc-900/90 border border-white/[0.08] p-1 shrink-0 cursor-pointer"
                />
              ) : (
                <div
                  onClick={() => onOpenDetails(offer)}
                  className="w-16 h-16 rounded-xl bg-zinc-900 border border-white/[0.08] flex items-center justify-center text-[10px] font-mono text-zinc-500 shrink-0 cursor-pointer"
                >
                  <ShoppingBag className="w-5 h-5 text-violet-300" />
                </div>
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-zinc-400">
                  {(offer.id === recommendedProductId || offer.recommendationTier) && (
                    <span className="px-2 py-0.5 rounded bg-violet-500/20 border border-violet-400/35 text-violet-200 font-semibold">
                      ★ {offer.recommendationTier || 'Top Pick'}
                    </span>
                  )}
                  <span className="text-zinc-200 font-medium">{offer.merchant}</span>
                  <span>·</span>
                  <span>{offer.category}</span>
                  {offer.rating !== null && (
                    <span className="inline-flex items-center gap-1 text-amber-400">
                      <Star className="w-3 h-3 fill-amber-400" />
                      {offer.rating.toFixed(1)}
                    </span>
                  )}
                </div>
                <h3
                  onClick={() => onOpenDetails(offer)}
                  className="text-sm font-semibold text-white hover:text-violet-200 truncate mt-1 cursor-pointer"
                >
                  {offer.name}
                </h3>
                <p className="text-xs text-zinc-400 line-clamp-1 mt-0.5">
                  {offer.summary}
                </p>
              </div>
            </div>

            <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0">
              <div className="text-right font-mono">
                {hasPrice ? (
                  <span className="text-base font-bold text-white">
                    {offer.currency} {offer.price!.toFixed(2)}
                  </span>
                ) : (
                  <span className="text-xs text-amber-300">Price unverified</span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onOpenDetails(offer)}
                  className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs text-zinc-200 cursor-pointer"
                >
                  View Details
                </button>
                <button
                  type="button"
                  onClick={() => onToggleCompare(offer.id)}
                  className={`px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer ${
                    isCompared
                      ? 'bg-violet-500/20 border-violet-400/40 text-violet-200'
                      : 'bg-zinc-900 border-white/[0.08] text-zinc-300'
                  }`}
                >
                  {isCompared ? 'Comparing' : 'Compare'}
                </button>
                <a
                  href={offer.canonicalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1.5 rounded-lg bg-violet-500/15 hover:bg-violet-500/25 border border-violet-400/30 text-xs text-violet-200 inline-flex items-center gap-1"
                >
                  <span>Visit Store</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                <button
                  type="button"
                  onClick={() => onToggleSave(offer)}
                  aria-label="Save product"
                  className={`p-1.5 rounded-lg border cursor-pointer ${
                    isSaved
                      ? 'bg-violet-500/20 border-violet-400/40 text-violet-300'
                      : 'bg-zinc-900 border-white/[0.08] text-zinc-400'
                  }`}
                >
                  <Bookmark className="w-3.5 h-3.5" />
                </button>
                {onAddToCart && hasPrice && (
                  <button
                    type="button"
                    onClick={() => onAddToCart(offer)}
                    className="px-3 py-1.5 rounded-full bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/40 text-violet-100 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <ShoppingCart className="w-3.5 h-3.5" />
                    <span>Add to Cart</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onSelectForCheckout(offer)}
                  className="px-4 py-1.5 rounded-full bg-gradient-to-r from-[#D884F8] via-[#F0A3D8] to-[#F7CBA8] text-[#140E21] text-xs font-semibold cursor-pointer"
                >
                  Buy Now
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export interface ProductComparisonTableProps {
  products: RankedProductOffer[];
  onRemoveFromCompare: (productId: string) => void;
  onSelectForCheckout: (product: RankedProductOffer) => void;
  onAddToCart?: (product: RankedProductOffer) => void;
}

export const ProductComparisonTable: React.FC<ProductComparisonTableProps> = ({
  products,
  onRemoveFromCompare,
  onSelectForCheckout,
  onAddToCart,
}) => {
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  if (products.length === 0) return null;

  return (
    <div className="rounded-2xl bg-[#12101B]/95 border border-white/[0.12] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
      <div className="px-5 py-3.5 border-b border-white/[0.08] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scale className="w-4 h-4 text-violet-400" />
          <h3 className="text-xs font-semibold text-white">
            Side-by-Side Verified Offer Comparison ({products.length})
          </h3>
        </div>
        <span className="text-[11px] font-mono text-zinc-400">
          Strictly verified source attributes
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-white/[0.07] bg-zinc-900/50">
              <th className="p-3.5 text-zinc-400 font-medium w-44">Attribute</th>
              {products.map((prod) => (
                <th key={prod.id} className="p-3.5 min-w-[210px]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {prod.imageUrl && !imgErrors[prod.id] ? (
                        <img
                          src={prod.imageUrl}
                          alt={prod.name}
                          referrerPolicy="no-referrer"
                          onError={() => setImgErrors((prev) => ({ ...prev, [prod.id]: true }))}
                          className="w-9 h-9 rounded-lg object-contain bg-black/40 border border-white/10 shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-black/40 border border-white/10 flex items-center justify-center shrink-0">
                          <ShoppingBag className="w-4 h-4 text-violet-300" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-[11px] font-mono text-violet-300">
                          {prod.merchant}
                        </div>
                        <div className="text-xs font-semibold text-white mt-0.5 line-clamp-2">
                          {prod.name}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveFromCompare(prod.id)}
                      aria-label={`Remove ${prod.name} from comparison`}
                      className="text-zinc-500 hover:text-zinc-200 p-1 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            <tr>
              <td className="p-3.5 text-zinc-400 font-medium">Recommendation Tier</td>
              {products.map((p) => (
                <td key={p.id} className="p-3.5 font-mono text-violet-300 font-semibold">
                  {p.recommendationTier || 'Ranked Candidate'}
                  {p.qualityAdjustedScore
                    ? ` · ${(p.qualityAdjustedScore.scoreOutOf10 ?? p.qualityAdjustedScore.totalQualityAdjustedScore / 10).toFixed(1)}/10`
                    : ''}
                </td>
              ))}
            </tr>
            <tr>
              <td className="p-3.5 text-zinc-400 font-medium">Verified Price</td>
              {products.map((p) => (
                <td key={p.id} className="p-3.5 font-mono font-semibold text-white">
                  {p.price !== null && p.priceStatus === 'verified'
                    ? `${p.currency} ${p.price.toFixed(2)}`
                    : 'Price could not be verified.'}
                </td>
              ))}
            </tr>
            <tr>
              <td className="p-3.5 text-zinc-400 font-medium">Shipping</td>
              {products.map((p) => (
                <td key={p.id} className="p-3.5 font-mono text-zinc-300">
                  {p.shippingStatus === 'not_applicable_digital'
                    ? '$0.00 (Digital Delivery)'
                    : 'Standard Merchant Shipping'}
                </td>
              ))}
            </tr>
            <tr>
              <td className="p-3.5 text-zinc-400 font-medium">Coupon Discount</td>
              {products.map((p) => (
                <td key={p.id} className="p-3.5 font-mono text-amber-300">
                  {p.bestCoupon
                    ? `${p.bestCoupon.code} (-${p.currency} ${p.couponDiscountAmount.toFixed(2)})`
                    : 'No active coupon required'}
                </td>
              ))}
            </tr>
            <tr>
              <td className="p-3.5 text-zinc-400 font-medium">Availability</td>
              {products.map((p) => (
                <td key={p.id} className="p-3.5 font-mono text-emerald-300">
                  {p.availabilityStatus === 'verified_in_stock'
                    ? 'Verified in stock'
                    : 'Check merchant listing'}
                </td>
              ))}
            </tr>
            <tr>
              <td className="p-3.5 text-zinc-400 font-medium">Rating / Reviews</td>
              {products.map((p) => (
                <td key={p.id} className="p-3.5 font-mono text-amber-300">
                  {p.rating !== null
                    ? `${p.rating.toFixed(1)} / 5.0 (${p.reviewCount ?? 0} reviews)`
                    : 'Not reported by merchant'}
                </td>
              ))}
            </tr>
            <tr>
              <td className="p-3.5 text-zinc-400 font-medium">Merchant &amp; Freshness</td>
              {products.map((p) => (
                <td key={p.id} className="p-3.5 font-mono text-[11px] text-zinc-400">
                  <div>{p.merchant}</div>
                  <div>Updated {new Date(p.retrievedAt).toLocaleTimeString()}</div>
                </td>
              ))}
            </tr>
            <tr>
              <td className="p-3.5 text-zinc-400 font-medium">Actions</td>
              {products.map((p) => (
                <td key={p.id} className="p-3.5">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectForCheckout(p)}
                      className="px-3.5 py-1.5 rounded-full bg-gradient-to-r from-[#D884F8] via-[#F0A3D8] to-[#F7CBA8] text-[#140E21] font-semibold text-xs cursor-pointer"
                    >
                      Buy Now
                    </button>
                    {onAddToCart && (
                      <button
                        type="button"
                        onClick={() => onAddToCart(p)}
                        className="px-2.5 py-1.5 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/40 text-violet-100 text-xs inline-flex items-center gap-1 cursor-pointer"
                      >
                        <ShoppingCart className="w-3 h-3" />
                        <span>Cart</span>
                      </button>
                    )}
                    <a
                      href={p.canonicalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs inline-flex items-center gap-1"
                    >
                      <span>Visit Store</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export interface ProductDetailsPanelProps {
  product: RankedProductOffer | null;
  onClose: () => void;
  onSelectForCheckout: (product: RankedProductOffer) => void;
  onAddToCart?: (
    product: RankedProductOffer,
    options?: {
      variantLabel?: string;
      selectedOptions?: Record<string, string>;
      quantity?: number;
    }
  ) => Promise<void> | void;
  onToggleSave: (product: RankedProductOffer) => void;
  isSaved: boolean;
}

export const ProductDetailsPanel: React.FC<ProductDetailsPanelProps> = ({
  product,
  onClose,
  onSelectForCheckout,
  onAddToCart,
  onToggleSave,
  isSaved,
}) => {
  const [selectedGalleryImage, setSelectedGalleryImage] = useState<string | null>(null);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
  const [selectedVariant, setSelectedVariant] = useState<string>('Standard Edition');
  const [quantity, setQuantity] = useState<number>(1);
  const [isAdding, setIsAdding] = useState<boolean>(false);

  if (!product) return null;

  const variantChoices = Array.from(
    new Set([
      'Standard Edition',
      ...(product.specs?.Color ? [`${product.specs.Color} Edition`] : []),
      ...(product.specs?.Capacity ? [`${product.specs.Capacity} Configuration`] : []),
      ...(product.specs?.Configuration ? [product.specs.Configuration] : []),
      'Extended Protection Bundle',
    ])
  ).slice(0, 5);

  const gallery = Array.from(
    new Set([
      ...(product.imageUrl ? [product.imageUrl] : []),
      ...(product.galleryImages || []),
    ])
  );
  const activeImage = selectedGalleryImage || gallery[0] || null;
  const activeImageFailed = activeImage ? Boolean(imgErrors[activeImage]) : true;

  const filteredSpecs = Object.entries(
    getCleanUserFacingSpecs(
      product.richProfile?.technicalSpecsByCategory || product.specs || {},
      { includeUnspecified: true, includeCondition: true }
    )
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-details-title"
      className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg bg-[#12101B] border-l border-white/[0.12] h-full overflow-y-auto p-6 flex flex-col justify-between shadow-2xl">
        <div className="space-y-5">
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-violet-300">
                  Verified Source Record Inspector
                </span>
                {product.recommendationTier && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-violet-500/25 border border-violet-400/40 text-violet-200">
                    {product.recommendationTier}
                  </span>
                )}
              </div>
              <h2 id="product-details-title" className="text-base font-semibold text-white mt-1">
                {product.name}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close product details"
              className="p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Product Gallery & Primary Commercial Overview */}
          <div className="space-y-3">
            <div className="flex items-start gap-4">
              {activeImage && !activeImageFailed ? (
                <img
                  src={activeImage}
                  alt={product.name}
                  referrerPolicy="no-referrer"
                  onError={() =>
                    setImgErrors((prev) => ({ ...prev, [activeImage]: true }))
                  }
                  className="w-24 h-24 rounded-2xl object-contain bg-black/40 border border-white/[0.1] p-1.5 shrink-0"
                />
              ) : (
                <div className="w-24 h-24 rounded-2xl bg-black/40 border border-white/[0.1] flex flex-col items-center justify-center text-zinc-400 gap-1 shrink-0 p-2 text-center">
                  <ShoppingBag className="w-6 h-6 text-violet-300" />
                  <span className="text-[9px] font-mono uppercase tracking-wider">
                    Verified
                  </span>
                </div>
              )}
              <div className="space-y-1.5 text-xs min-w-0 flex-1">
                <div className="text-zinc-400">
                  Merchant: <span className="text-white font-semibold">{product.merchant}</span>
                </div>
                <div className="text-zinc-400">
                  Category: <span className="text-zinc-200">{product.category}</span>
                </div>
                {product.rating !== null && (
                  <div className="inline-flex items-center gap-1 text-amber-400 font-mono">
                    <Star className="w-3.5 h-3.5 fill-amber-400" />
                    <span>{product.rating.toFixed(1)} / 5.0</span>
                    {product.reviewCount !== null && (
                      <span className="text-zinc-400">({product.reviewCount} reviews)</span>
                    )}
                  </div>
                )}
                <div className="font-mono text-base font-bold text-white pt-1 tabular-nums">
                  {product.price !== null && product.priceStatus === 'verified'
                    ? `${product.currency} ${product.price.toFixed(2)}`
                    : 'Price could not be verified.'}
                </div>
              </div>
            </div>

            {gallery.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {gallery.map((imgUrl, idx) => (
                  <button
                    key={imgUrl}
                    type="button"
                    onClick={() => setSelectedGalleryImage(imgUrl)}
                    className={`w-12 h-12 rounded-xl overflow-hidden border p-1 bg-black/40 shrink-0 cursor-pointer transition-all ${
                      activeImage === imgUrl
                        ? 'border-violet-400 ring-1 ring-violet-400/50'
                        : 'border-white/10 opacity-70 hover:opacity-100'
                    }`}
                  >
                    {!imgErrors[imgUrl] ? (
                      <img
                        src={imgUrl}
                        alt={`${product.name} thumbnail ${idx + 1}`}
                        referrerPolicy="no-referrer"
                        onError={() =>
                          setImgErrors((prev) => ({ ...prev, [imgUrl]: true }))
                        }
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[9px] font-mono text-zinc-500">
                        #{idx + 1}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <p className="text-xs text-zinc-300 leading-relaxed">{product.summary}</p>

          {/* Phase 2 & 6: 0-10 Rating, 0-100 Quality-Adjusted Score & 9-Dimension Breakdown */}
          {product.qualityAdjustedScore && (
            <div
              data-testid="drawer-quality-score-breakdown"
              className="rounded-2xl bg-violet-500/[0.08] border border-violet-500/25 p-3.5 space-y-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-violet-200">
                  Professional Evaluation Score ({product.qualityAdjustedScore.evidenceConfidence || 'MODERATE'})
                </span>
                <span className="font-mono font-bold text-emerald-300">
                  {(product.qualityAdjustedScore.scoreOutOf10 ?? product.qualityAdjustedScore.totalQualityAdjustedScore / 10).toFixed(1)}/10 · {product.qualityAdjustedScore.totalQualityAdjustedScore}/100
                </span>
              </div>
              {product.qualityAdjustedScore.scoreCriteriaExplanation && (
                <p className="text-[11px] text-zinc-400 leading-snug">
                  {product.qualityAdjustedScore.scoreCriteriaExplanation}
                </p>
              )}
              <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono text-zinc-300">
                <div>Relevance: {product.qualityAdjustedScore.relevanceToRequest}/100</div>
                <div>Tech Quality: {product.qualityAdjustedScore.technicalQualityAndPerformance}/100</div>
                <div>Reliability: {product.qualityAdjustedScore.reliabilityAndReviewEvidence}/100</div>
                <div>Value Ratio: {product.qualityAdjustedScore.priceToPerformanceValue}/100</div>
                <div>Longevity: {product.qualityAdjustedScore.generationAndSupportLongevity}/100</div>
                <div>Merchant: {product.qualityAdjustedScore.merchantAndOfferReliability}/100</div>
                {product.qualityAdjustedScore.nineDimensions && (
                  <>
                    <div>Build & Durability: {product.qualityAdjustedScore.nineDimensions.buildQualityAndDurability}/100</div>
                    <div>Real-World Usability: {product.qualityAdjustedScore.nineDimensions.realWorldUsability}/100</div>
                    <div>Competitive Standing: {product.qualityAdjustedScore.nineDimensions.competitiveStanding}/100</div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Phase 3 Section A & B: Product Identity & Category-Specific Technical Specifications */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-zinc-300">
              Verified Technical Specifications & Identity
            </h3>
            <div className="rounded-2xl bg-zinc-900/80 border border-white/[0.06] divide-y divide-white/[0.05] text-xs">
              {product.richProfile?.identity && (
                <>
                  {product.richProfile.identity.brand &&
                    !/unverified|unknown/i.test(product.richProfile.identity.brand) && (
                      <div className="px-3.5 py-2 flex justify-between gap-3">
                        <span className="text-zinc-400">Brand / Manufacturer</span>
                        <span className="font-mono text-zinc-200 text-right">
                          {product.richProfile.identity.brand}
                        </span>
                      </div>
                    )}
                  {product.richProfile.identity.variantConfiguration &&
                    !/unverified|unknown/i.test(
                      product.richProfile.identity.variantConfiguration
                    ) && (
                      <div className="px-3.5 py-2 flex justify-between gap-3">
                        <span className="text-zinc-400">Exact Variant / Config</span>
                        <span className="font-mono text-zinc-200 text-right">
                          {product.richProfile.identity.variantConfiguration}
                        </span>
                      </div>
                    )}
                  {product.richProfile.identity.releaseYear &&
                    !/unverified|unknown/i.test(product.richProfile.identity.releaseYear) && (
                      <div className="px-3.5 py-2 flex justify-between gap-3">
                        <span className="text-zinc-400">Release / Generation</span>
                        <span className="font-mono text-zinc-200 text-right">
                          {product.richProfile.identity.releaseYear}
                        </span>
                      </div>
                    )}
                </>
              )}
              {filteredSpecs.map(([key, val]) => (
                <div key={key} className="px-3.5 py-2.5 flex justify-between gap-3">
                  <span className="text-zinc-400">{key}</span>
                  <span className="font-mono text-zinc-200 text-right">{String(val)}</span>
                </div>
              ))}
              <div className="px-3.5 py-2.5 flex justify-between gap-3">
                <span className="text-zinc-400">Retrieved Timestamp</span>
                <span className="font-mono text-zinc-200 text-right">{product.retrievedAt}</span>
              </div>
            </div>
          </div>

          {/* Phase 3 Section C: Real-World Purchasing Insights */}
          {product.richProfile?.purchasingInsights && (
            <div
              data-testid="drawer-purchasing-insights"
              className="rounded-2xl bg-zinc-900/80 border border-white/[0.06] p-3.5 space-y-2 text-xs"
            >
              <h3 className="font-semibold text-cyan-300">
                Real-World Purchasing Insights
              </h3>
              <p className="text-zinc-300">
                <strong className="text-white">Who should buy it:</strong>{' '}
                {product.richProfile.purchasingInsights.whoShouldBuyIt}
              </p>
              <p className="text-zinc-300">
                <strong className="text-white">Who should avoid it:</strong>{' '}
                {product.richProfile.purchasingInsights.whoShouldAvoidIt}
              </p>
              <p className="text-zinc-400 text-[11px]">
                <strong className="text-zinc-200">Why it stands out:</strong>{' '}
                {product.richProfile.purchasingInsights.whatMakesItGood}
              </p>
            </div>
          )}

          {/* Phase 3 Section D: Review & Reputation Intelligence */}
          {product.richProfile?.reviewIntelligence && (
            <div
              data-testid="drawer-review-intelligence"
              className="rounded-2xl bg-zinc-900/80 border border-white/[0.06] p-3.5 space-y-1.5 text-xs"
            >
              <h3 className="font-semibold text-amber-300">
                Review & Reputation Intelligence
              </h3>
              <p className="text-zinc-300 font-mono text-[11px]">
                {product.richProfile.reviewIntelligence.reviewCredibilityAssessment}
              </p>
            </div>
          )}

          {/* Phase 3 Section E & Phase 4: Consolidated Merchant Offers */}
          {product.richProfile?.merchantOffers && product.richProfile.merchantOffers.length > 0 && (
            <div
              data-testid="drawer-merchant-offers"
              className="space-y-2"
            >
              <h3 className="text-xs font-semibold text-emerald-300">
                Consolidated Merchant Offers ({product.richProfile.merchantOffers.length})
              </h3>
              <div className="space-y-1.5">
                {product.richProfile.merchantOffers.map((mo) => (
                  <div
                    key={mo.offerId}
                    className="p-2.5 rounded-xl bg-zinc-900/85 border border-white/[0.06] flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-white truncate">
                        {mo.merchantName}
                      </div>
                      <div className="text-[10px] font-mono text-zinc-400">
                        {mo.availabilityStatus} · {mo.shippingCost !== null ? `Ship $${mo.shippingCost.toFixed(2)}` : mo.shippingStatus}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono font-bold text-emerald-300">
                        {mo.listedPrice !== null ? `${mo.currency} ${mo.listedPrice.toFixed(2)}` : 'Unverified'}
                      </span>
                      <a
                        href={mo.offerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-[10px] text-zinc-200"
                      >
                        Offer
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Phase 3 Section F: Traceable Evidence Attribution */}
          {product.richProfile?.traceableEvidence &&
            product.richProfile.traceableEvidence.length > 0 && (
              <div
                data-testid="drawer-traceable-evidence"
                className="space-y-1.5"
              >
                <h3 className="text-xs font-semibold text-zinc-300">
                  Traceable Evidence Attribution
                </h3>
                <div className="rounded-2xl bg-zinc-900/80 border border-white/[0.06] divide-y divide-white/[0.05] text-[11px]">
                  {product.richProfile.traceableEvidence.map((ev, idx) => (
                    <div key={idx} className="px-3 py-2 flex items-center justify-between gap-2">
                      <span className="text-zinc-300 truncate">
                        {sanitizeUserFacingAttributeValue(ev.label)}
                      </span>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 border border-violet-500/30 shrink-0">
                        {ev.sourceType === 'official_manufacturer_spec'
                          ? 'Verified Spec'
                          : ev.sourceType === 'merchant_offer'
                          ? 'Merchant Offer'
                          : ev.sourceType === 'channel3_catalog_record'
                          ? 'Product Listing'
                          : 'Category Analysis'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          {/* Variant & Quantity Selection for Cart */}
          <div className="p-3.5 rounded-2xl bg-zinc-900/80 border border-white/[0.07] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="details-variant-select"
                className="text-xs font-semibold text-zinc-300"
              >
                Variant / Option Selection
              </label>
              <span className="text-[10px] font-mono text-violet-300">
                Persisted with Cart Line
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <select
                id="details-variant-select"
                data-testid="details-variant-select"
                value={selectedVariant}
                onChange={(e) => setSelectedVariant(e.target.value)}
                className="sm:col-span-2 px-3 py-2 rounded-xl bg-zinc-950 border border-white/10 text-xs text-white focus:outline-none focus:border-violet-400"
              >
                {variantChoices.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <div className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-zinc-950 border border-white/10 text-xs">
                <span className="text-zinc-400">Qty</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label="Decrease detail quantity"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 text-white flex items-center justify-center cursor-pointer"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span
                    data-testid="details-quantity-value"
                    className="w-5 text-center font-mono font-semibold text-white"
                  >
                    {quantity}
                  </span>
                  <button
                    type="button"
                    aria-label="Increase detail quantity"
                    onClick={() => setQuantity((q) => Math.min(10, q + 1))}
                    className="w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 text-white flex items-center justify-center cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-white/[0.07] space-y-2.5">
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => onToggleSave(product)}
              className="py-2.5 px-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs font-medium text-zinc-200 inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Bookmark className="w-3.5 h-3.5 text-violet-400" />
              <span>{isSaved ? 'Saved' : 'Save'}</span>
            </button>
            {onAddToCart && (
              <button
                type="button"
                data-testid="details-add-to-cart-btn"
                disabled={isAdding}
                onClick={async () => {
                  if (isAdding) return;
                  setIsAdding(true);
                  try {
                    await onAddToCart(product, {
                      variantLabel: selectedVariant,
                      selectedOptions: { Edition: selectedVariant },
                      quantity,
                    });
                  } finally {
                    setIsAdding(false);
                  }
                }}
                className="py-2.5 px-2.5 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/40 text-xs font-semibold text-violet-100 inline-flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <ShoppingCart className="w-3.5 h-3.5 text-violet-300" />
                <span>{isAdding ? 'Adding...' : 'Add to Cart'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                onClose();
                onSelectForCheckout(product);
              }}
              className="py-2.5 px-3 rounded-full bg-gradient-to-r from-[#D884F8] via-[#F0A3D8] to-[#F7CBA8] text-[#140E21] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>Buy Now</span>
            </button>
          </div>
          <a
            href={product.canonicalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-2.5 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-xs font-medium text-white inline-flex items-center justify-center gap-2"
          >
            <span>Open Official Merchant Page</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
};

export interface ContextualShoppingPanelProps {
  isOpen: boolean;
  onClose: () => void;
  filters: ActiveSearchFilters;
  onUpdateFilters: (next: Partial<ActiveSearchFilters>) => void;
  comparedProducts: RankedProductOffer[];
  savedProducts: RankedProductOffer[];
  cart?: UserCartSummary | null;
  onUpdateCartQuantity?: (itemId: string, quantity: number) => void;
  onRemoveCartItem?: (itemId: string) => void;
  onCheckoutCart?: () => void;
  onRemoveCompared: (id: string) => void;
  onRemoveSaved: (product: RankedProductOffer) => void;
  onOpenComparisonSection: () => void;
  onSelectForCheckout: (product: RankedProductOffer) => void;
  isExecuting: boolean;
}

export const ContextualShoppingPanel: React.FC<ContextualShoppingPanelProps> = ({
  isOpen,
  onClose,
  filters,
  onUpdateFilters,
  comparedProducts,
  savedProducts,
  cart,
  onUpdateCartQuantity,
  onRemoveCartItem,
  onCheckoutCart,
  onRemoveCompared,
  onRemoveSaved,
  onOpenComparisonSection,
  onSelectForCheckout,
  isExecuting,
}) => {
  if (!isOpen) return null;

  return (
    <aside
      aria-label="Contextual Shopping Workspace Panel"
      className="w-full lg:w-80 shrink-0 bg-[#0E0C16]/95 border-t lg:border-t-0 lg:border-l border-white/[0.08] p-4 space-y-6 overflow-y-auto"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-violet-400" />
          <h2 className="text-xs font-semibold text-white">Shopping Cart &amp; Filters</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close contextual panel"
          className="p-1 rounded-lg text-zinc-400 hover:text-white cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Spark Sandbox Shopping Cart Section */}
      <div
        data-testid="contextual-shopping-cart"
        className="p-3.5 rounded-2xl bg-violet-950/25 border border-violet-500/30 space-y-3"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-white">
            <ShoppingCart className="w-4 h-4 text-violet-400" />
            <span>Spark Sandbox Cart ({cart?.itemCount || 0})</span>
          </div>
          <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-[10px] font-mono font-bold text-amber-300">
            SANDBOX
          </span>
        </div>

        {cart && cart.items.length > 0 ? (
          <div className="space-y-2.5">
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {cart.items.map((item) => (
                <div
                  key={item.itemId}
                  data-testid={`panel-cart-item-${item.productId}`}
                  className="p-2.5 rounded-xl bg-zinc-950/80 border border-white/[0.06] space-y-1.5 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-white truncate">{item.productName}</p>
                      <p className="text-[10px] font-mono text-zinc-400 truncate">
                        {item.merchant} · {item.currency} {item.unitPrice.toFixed(2)} each
                      </p>
                    </div>
                    {onRemoveCartItem && (
                      <button
                        type="button"
                        aria-label={`Remove ${item.productName} from cart`}
                        onClick={() => onRemoveCartItem(item.itemId)}
                        className="text-zinc-500 hover:text-rose-400 p-0.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label={`Decrease quantity for ${item.productName}`}
                        onClick={() => onUpdateCartQuantity?.(item.itemId, item.quantity - 1)}
                        className="w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 text-white flex items-center justify-center cursor-pointer"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-5 text-center font-mono font-semibold text-white">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label={`Increase quantity for ${item.productName}`}
                        onClick={() => onUpdateCartQuantity?.(item.itemId, item.quantity + 1)}
                        className="w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 text-white flex items-center justify-center cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    <span className="font-mono font-semibold text-emerald-300">
                      {item.currency} {item.subtotal.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-white/[0.08] space-y-1 text-xs">
              <div className="flex justify-between text-zinc-400">
                <span>Subtotal ({cart.itemCount} items)</span>
                <span className="font-mono text-white">
                  {cart.currency} {cart.subtotal.toFixed(2)}
                </span>
              </div>
              {(cart.verifiedDiscountTotal || 0) > 0 && (
                <div className="flex justify-between text-emerald-400">
                  <span>Coupon ({cart.appliedCouponCode})</span>
                  <span className="font-mono">
                    -{cart.currency} {(cart.verifiedDiscountTotal || 0).toFixed(2)}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-[11px] text-zinc-500">
                <span>Shipping / Tax</span>
                <span className="font-mono">
                  {cart.shippingStatus === 'unknown' || cart.hasUnknownShipping || cart.hasUnknownTax
                    ? 'Calculated at merchant'
                    : 'Verified'}
                </span>
              </div>
            </div>

            {onCheckoutCart && (
              <button
                type="button"
                data-testid="proceed-to-sandbox-checkout-btn"
                onClick={onCheckoutCart}
                className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-md cursor-pointer"
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                <span>
                  Sandbox Checkout ({cart.currency} {cart.estimatedTotal.toFixed(2)})
                </span>
              </button>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            Your Spark Cart is empty. Click <strong>Add to Cart</strong> or <strong>Buy Now</strong> on any verified product card to test PayPal Sandbox checkout.
          </p>
        )}
      </div>

      {/* Current Task Status */}
      <div className="p-3 rounded-xl bg-zinc-900/75 border border-white/[0.06] text-xs space-y-1">
        <div className="text-zinc-400">Current Task Status</div>
        <div className="font-mono text-zinc-200">
          {isExecuting ? 'Executing live source adapters...' : 'Idle · Ready for follow-up'}
        </div>
      </div>

      {/* Active Search Filters */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-zinc-300">Active Result Filters</h3>

        <div className="space-y-1.5">
          <label htmlFor="panel-source-filter" className="text-[11px] text-zinc-400 block">
            Data Source
          </label>
          <select
            id="panel-source-filter"
            value={filters.sourceFilter}
            onChange={(e) => onUpdateFilters({ sourceFilter: e.target.value })}
            className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-white/[0.08] text-xs text-white"
          >
            <option value="all">All Verified Sources</option>
            <option value="channel3_api">Channel3 Product Graph API</option>
            <option value="openlibrary_api">Open Library Catalog API</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="panel-sort-by" className="text-[11px] text-zinc-400 block">
            Sort Order
          </label>
          <select
            id="panel-sort-by"
            value={filters.sortBy}
            onChange={(e) =>
              onUpdateFilters({
                sortBy: e.target.value as ActiveSearchFilters['sortBy'],
              })
            }
            className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-white/[0.08] text-xs text-white"
          >
            <option value="relevance">Completeness & Verification</option>
            <option value="price_asc">Verified Price: Low to High</option>
            <option value="price_desc">Verified Price: High to Low</option>
            <option value="rating_desc">Customer Rating: Highest</option>
          </select>
        </div>

        <label className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-zinc-900/70 border border-white/[0.06] text-xs text-zinc-300 cursor-pointer">
          <span>Verified price records only</span>
          <input
            type="checkbox"
            checked={filters.verifiedPriceOnly}
            onChange={(e) => onUpdateFilters({ verifiedPriceOnly: e.target.checked })}
            className="accent-violet-500"
          />
        </label>
      </div>

      {/* Comparison Shortlist */}
      <div className="space-y-2.5 pt-2 border-t border-white/[0.07]">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-zinc-300">
            Comparison Shortlist ({comparedProducts.length})
          </h3>
          {comparedProducts.length >= 2 && (
            <button
              type="button"
              onClick={onOpenComparisonSection}
              className="text-[11px] text-violet-300 hover:text-white cursor-pointer"
            >
              Full Table
            </button>
          )}
        </div>

        {comparedProducts.length > 0 ? (
          <div className="space-y-2">
            {comparedProducts.map((item) => (
              <div
                key={item.id}
                className="p-2.5 rounded-xl bg-zinc-900/80 border border-white/[0.06] flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-medium text-white truncate">{item.name}</p>
                  <p className="text-[11px] font-mono text-zinc-400">
                    {item.price !== null
                      ? `${item.currency} ${item.price.toFixed(2)}`
                      : 'Price unverified'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveCompared(item.id)}
                  aria-label={`Remove ${item.name} from shortlist`}
                  className="text-zinc-500 hover:text-zinc-200 p-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-zinc-500">
            Select “Compare” on any product card to add it to your comparison shortlist.
          </p>
        )}
      </div>

      {/* Saved Products Shortlist */}
      <div className="space-y-2.5 pt-2 border-t border-white/[0.07]">
        <h3 className="text-xs font-semibold text-zinc-300">
          Saved Products ({savedProducts.length})
        </h3>
        {savedProducts.length > 0 ? (
          <div className="space-y-2">
            {savedProducts.map((item) => (
              <div
                key={item.id}
                className="p-2.5 rounded-xl bg-zinc-900/80 border border-white/[0.06] flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-medium text-white truncate">{item.name}</p>
                  <p className="text-[11px] font-mono text-zinc-400">
                    {item.price !== null
                      ? `${item.currency} ${item.price.toFixed(2)}`
                      : 'Price unverified'}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => onSelectForCheckout(item)}
                    className="px-2.5 py-1 rounded-full bg-gradient-to-r from-[#D884F8] to-[#F7CBA8] text-[#140E21] font-semibold text-[10px] cursor-pointer"
                  >
                    Buy
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveSaved(item)}
                    aria-label={`Remove ${item.name} from saved`}
                    className="text-zinc-500 hover:text-rose-300 p-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-zinc-500">
            Bookmark any verified product to persist it to your Saved Products list.
          </p>
        )}
      </div>
    </aside>
  );
};
