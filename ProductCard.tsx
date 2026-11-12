import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Bookmark,
  ExternalLink,
  Tag,
  ShieldCheck,
  TrendingDown,
  Lock,
  GitCompare,
  Eye,
  CreditCard,
  ShoppingCart,
} from 'lucide-react';
import type { RankedProductOffer } from '../types/spark';
import { sanitizeUserFacingAttributeValue } from '../utils/productPresentationSanitizer';

export interface ProductCardItem extends Omit<Partial<RankedProductOffer>, 'currency'> {
  id: string;
  name: string;
  brand?: string;
  category?: string;
  description?: string;
  bestFor?: string;
  badge?: string;
  price?: number | null;
  priceRange?: string;
  currency?: string;
  availabilityStatus?: RankedProductOffer['availabilityStatus'];
  rating?: number | null;
  reviewCount?: number | null;
  confidenceScore?: number;
  discountPercent?: number;
  merchantName?: string;
  couponCode?: string;
  sourceUrl?: string;
  imageUrl?: string | null;
  pros?: string[];
}

interface ProductCardProps {
  product: ProductCardItem;
  isSaved: boolean;
  onToggleSave: (product: ProductCardItem) => void;
  onAddToCart?: (product: ProductCardItem) => Promise<void> | void;
  onSelectForCheckout?: (product: ProductCardItem) => void;
  onToggleCompare?: (product: ProductCardItem) => void;
  isCompared?: boolean;
  onOpenDetails?: (product: ProductCardItem) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  isSaved,
  onToggleSave,
  onAddToCart,
  onSelectForCheckout,
  onToggleCompare,
  isCompared = false,
  onOpenDetails,
}) => {
  const [imageError, setImageError] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    setImageError(false);
  }, [product.imageUrl]);

  const cleanTitle = sanitizeUserFacingAttributeValue(product.name || 'Verified Product').replace(
    /\b(?:ch3|ol|itunes)_[a-zA-Z0-9_-]+\b/gi,
    ''
  ).trim();
  const cleanBrand = (product.brand || product.merchant || '').trim();
  const cleanDescription = (product.description || product.summary || '').trim();
  const cleanBestFor = (product.bestFor || '').trim();

  const isPriceVerified = typeof product.price === 'number' && Number.isFinite(product.price) && product.price >= 0;
  const priceLabel = isPriceVerified
    ? `${product.currency || 'USD'} ${product.price!.toFixed(2)}`
    : product.priceRange || 'Price unverified';

  const availabilityTone: 'emerald' | 'amber' | 'rose' | 'slate' =
    product.availabilityStatus === 'verified_in_stock'
      ? 'emerald'
      : product.availabilityStatus === 'verified_out_of_stock'
      ? 'rose'
      : isPriceVerified
      ? 'amber'
      : 'slate';

  const availabilityLabel =
    product.availabilityStatus === 'verified_in_stock'
      ? 'In Stock'
      : product.availabilityStatus === 'verified_out_of_stock'
      ? 'Out of Stock'
      : 'Check Merchant';

  const ratingValue =
    typeof product.rating === 'number' && product.rating > 0 ? product.rating.toFixed(1) : null;
  const confidenceRatio =
    typeof product.confidenceScore === 'number' && product.confidenceScore > 0
      ? Math.min(1, product.confidenceScore > 1 ? product.confidenceScore / 100 : product.confidenceScore)
      : null;

  const hasValidImage = Boolean(
    product.imageUrl &&
      product.imageUrl.trim() !== '' &&
      !imageError &&
      !product.imageUrl.includes('undefined') &&
      !product.imageUrl.includes('null')
  );

  const badgeStyles: Record<string, string> = {
    'Best Overall': 'bg-[#0066FF] text-white',
    'Best Value': 'bg-[#00C853] text-white',
    'Budget Pick': 'bg-slate-800 text-white',
    'Premium Pick': 'bg-[#FF6D00] text-white',
    'Verified Match': 'bg-indigo-600 text-white',
  };

  const availabilityStyles: Record<'emerald' | 'amber' | 'rose' | 'slate', string> = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
    slate: 'bg-slate-100 text-slate-600 border-slate-200',
  };

  const targetUrl = product.sourceUrl || product.canonicalUrl || '';

  return (
    <div
      data-testid={`product-card-${product.id}`}
      className="group bg-white rounded-2xl border border-slate-200/90 shadow-sm hover:shadow-md hover:border-blue-300/80 transition-all duration-200 flex flex-col overflow-hidden"
    >
      {/* Top Banner / Image */}
      <div className="relative h-48 w-full bg-slate-50/80 overflow-hidden flex items-center justify-center border-b border-slate-100 p-4">
        {hasValidImage ? (
          <img
            src={product.imageUrl || undefined}
            alt={cleanTitle}
            loading="lazy"
            className="max-h-full max-w-full object-contain group-hover:scale-105 transition-transform duration-300 mix-blend-multiply"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-slate-100/70 to-blue-50/40 rounded-xl border border-dashed border-slate-200/80 p-4 text-center">
            <div className="w-11 h-11 rounded-xl bg-white shadow-xs border border-slate-200/80 flex items-center justify-center text-[#0066FF] font-display font-bold text-base mb-1.5">
              {(cleanBrand || cleanTitle).slice(0, 2).toUpperCase()}
            </div>
            <span className="text-[11px] font-semibold text-slate-600 line-clamp-1 max-w-[180px]">
              {cleanBrand || cleanTitle}
            </span>
            <span className="text-[10px] text-slate-400 mt-0.5">Verified Catalog Listing</span>
          </div>
        )}

        {/* Decision Badge */}
        {product.badge && (
          <span
            className={`absolute top-3 left-3 px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wide shadow-xs ${
              badgeStyles[product.badge] || 'bg-slate-900 text-white'
            }`}
          >
            {product.badge}
          </span>
        )}

        {/* Save Button */}
        <button
          type="button"
          onClick={() => onToggleSave(product)}
          data-testid={`product-save-btn-${product.id}`}
          title={isSaved ? 'Remove from Saved' : 'Save Product'}
          className={`absolute top-3 right-3 p-2 rounded-full backdrop-blur-md transition-colors ${
            isSaved
              ? 'bg-[#0066FF] text-white shadow-xs'
              : 'bg-white/90 text-slate-600 hover:bg-white hover:text-[#0066FF] border border-slate-200/60'
          }`}
        >
          <Bookmark className="w-4 h-4" fill={isSaved ? 'currentColor' : 'none'} />
        </button>

        {/* Discount / Price Drop Pill */}
        {product.discountPercent && product.discountPercent > 0 && (
          <div className="absolute bottom-2.5 left-3 flex items-center gap-1 bg-emerald-600 text-white text-[11px] font-semibold px-2 py-0.5 rounded-md shadow-xs">
            <TrendingDown className="w-3 h-3" />
            <span>Save {product.discountPercent}%</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 flex-1 flex flex-col justify-between space-y-3.5">
        <div>
          {/* Brand + Availability */}
          <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-1">
            <span className="font-semibold uppercase tracking-wider text-[10px] text-slate-400 truncate">
              {cleanBrand || product.category || 'Verified Brand'}
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${availabilityStyles[availabilityTone]}`}
            >
              {availabilityLabel}
            </span>
          </div>

          {/* Product Name */}
          <h4 className="font-display font-bold text-slate-900 text-base leading-snug line-clamp-2">
            {cleanTitle}
          </h4>

          {/* Rating & Confidence */}
          {(ratingValue || confidenceRatio !== null) && (
            <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-500">
              {ratingValue && (
                <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                  <span className="text-amber-500">★</span>
                  {ratingValue}
                  {product.reviewCount ? (
                    <span className="text-slate-400 font-normal">({product.reviewCount})</span>
                  ) : null}
                </span>
              )}
              {confidenceRatio !== null && (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  {Math.round(confidenceRatio * 100)}% match
                </span>
              )}
            </div>
          )}

          {/* Best For Tag */}
          {cleanBestFor && (
            <p className="mt-2 text-xs font-medium text-[#0066FF] bg-blue-50/80 border border-blue-100/80 px-2.5 py-1 rounded-lg inline-block">
              Best for: {cleanBestFor}
            </p>
          )}

          {/* Description */}
          {cleanDescription && (
            <p className="mt-2 text-xs text-slate-600 line-clamp-2 leading-relaxed">{cleanDescription}</p>
          )}

          {/* Key Pros */}
          {product.pros && product.pros.length > 0 && (
            <ul className="mt-2.5 space-y-1">
              {product.pros.slice(0, 2).map((pro: string, idx: number) => {
                const cleanPro = pro.trim();
                if (!cleanPro) return null;
                return (
                  <li key={idx} className="flex items-start gap-1.5 text-xs text-slate-600">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#00C853] shrink-0 mt-0.5" />
                    <span className="line-clamp-1">{cleanPro}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer: Price + Action Bar (Save, Compare, Details, Buy) */}
        <div className="pt-3 border-t border-slate-100 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-[10px] uppercase tracking-wider text-slate-400 block font-medium">
                {isPriceVerified ? 'Verified Offer' : 'Offer Status'}
              </span>
              <div className="flex items-baseline gap-1.5">
                <span
                  className={`font-display font-bold ${
                    isPriceVerified ? 'text-lg text-slate-900' : 'text-xs text-slate-600'
                  }`}
                >
                  {priceLabel}
                </span>
              </div>
              {(product.merchantName || product.merchant) && (
                <span className="text-[11px] text-slate-500 block truncate max-w-[160px]">
                  via {product.merchantName || product.merchant}
                </span>
              )}
            </div>

            {product.couponCode && (
              <div
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 border border-amber-200/80 text-amber-800 text-xs font-mono font-semibold"
                title="Active Promo Code"
              >
                <Tag className="w-3 h-3 text-amber-600" />
                <span>{product.couponCode}</span>
              </div>
            )}
          </div>

          {/* 4-Action Button Row: Save, Compare, Details, Buy */}
          <div className="grid grid-cols-4 gap-1.5">
            <button
              type="button"
              onClick={() => onToggleSave(product)}
              data-testid={`card-action-save-${product.id}`}
              className={`inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold border transition-colors ${
                isSaved
                  ? 'bg-blue-50 text-[#0066FF] border-blue-200'
                  : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200/80'
              }`}
            >
              <Bookmark className="w-3 h-3" fill={isSaved ? 'currentColor' : 'none'} />
              <span>{isSaved ? 'Saved' : 'Save'}</span>
            </button>

            {onToggleCompare ? (
              <button
                type="button"
                onClick={() => onToggleCompare(product)}
                data-testid={`card-action-compare-${product.id}`}
                className={`inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold border transition-colors ${
                  isCompared
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200/80'
                }`}
              >
                <GitCompare className="w-3 h-3" />
                <span>{isCompared ? 'Added' : 'Compare'}</span>
              </button>
            ) : (
              <a
                href={targetUrl || '#'}
                target={targetUrl ? '_blank' : undefined}
                rel={targetUrl ? 'noopener noreferrer' : undefined}
                onClick={(e) => {
                  if (!targetUrl) e.preventDefault();
                }}
                className="inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200/80 transition-colors"
              >
                <GitCompare className="w-3 h-3" />
                <span>Compare</span>
              </a>
            )}

            <button
              type="button"
              onClick={() => {
                if (onOpenDetails) {
                  onOpenDetails(product);
                }
              }}
              data-testid={`card-action-details-${product.id}`}
              className="inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[11px] font-semibold bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200/80 transition-colors cursor-pointer"
            >
              <Eye className="w-3 h-3" />
              <span>Details</span>
            </button>

            {onAddToCart && isPriceVerified && (
              <button
                type="button"
                disabled={isAdding}
                onClick={async () => {
                  if (isAdding) return;
                  setIsAdding(true);
                  try {
                    await onAddToCart(product);
                  } finally {
                    setIsAdding(false);
                  }
                }}
                data-testid={`card-action-cart-${product.id}`}
                className="inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 text-[11px] font-semibold transition-colors disabled:opacity-60 cursor-pointer"
                title="Add to Shopping Cart"
              >
                <ShoppingCart className="w-3 h-3" />
                <span>{isAdding ? 'Adding...' : 'Add to Cart'}</span>
              </button>
            )}

            {onSelectForCheckout && isPriceVerified ? (
              <button
                type="button"
                onClick={() => onSelectForCheckout(product)}
                data-testid={`card-action-buy-${product.id}`}
                className="inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-[#0066FF] hover:bg-blue-700 text-white text-[11px] font-semibold transition-colors shadow-xs cursor-pointer"
                title="Checkout with PayPal Sandbox"
              >
                <CreditCard className="w-3 h-3" />
                <span>Buy</span>
              </button>
            ) : targetUrl ? (
              <a
                href={targetUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={`card-action-buy-${product.id}`}
                className="inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold transition-colors"
              >
                <span>Buy</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-slate-100 text-slate-400 text-[11px] font-semibold cursor-not-allowed"
              >
                <Lock className="w-3 h-3" />
                <span>Buy</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
