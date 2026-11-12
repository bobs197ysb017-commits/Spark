import React, { useMemo, useState } from 'react';
import {
  Scale,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  Download,
  Copy,
  Check,
  Bookmark,
  ShoppingCart,
  ExternalLink,
  Award,
  FolderHeart,
  SlidersHorizontal,
  X,
  ShoppingBag,
} from 'lucide-react';
import type { RankedProductOffer, SavedComparisonRecord } from '../types/spark';
import { getCleanUserFacingSpecs } from '../utils/productPresentationSanitizer';

export interface ComparisonsViewProps {
  comparedProducts: RankedProductOffer[];
  candidatePool: RankedProductOffer[];
  savedComparisons: SavedComparisonRecord[];
  onRemoveFromCompare: (productId: string) => void;
  onAddToCompare: (productId: string) => void;
  onReplaceInCompare: (oldProductId: string, newProductId: string) => void;
  onClearComparison: () => void;
  onSaveComparisonSet: (title: string) => Promise<void> | void;
  onLoadSavedComparison: (record: SavedComparisonRecord) => void;
  onDeleteSavedComparison: (comparisonId: string) => Promise<void> | void;
  onSelectForCheckout: (product: RankedProductOffer) => void;
  onAddToCart: (product: RankedProductOffer) => void;
  onOpenDetails: (product: RankedProductOffer) => void;
  onNavigateToDiscovery: () => void;
}

export const ComparisonsView: React.FC<ComparisonsViewProps> = ({
  comparedProducts,
  candidatePool,
  savedComparisons,
  onRemoveFromCompare,
  onAddToCompare,
  onReplaceInCompare,
  onClearComparison,
  onSaveComparisonSet,
  onLoadSavedComparison,
  onDeleteSavedComparison,
  onSelectForCheckout,
  onAddToCart,
  onOpenDetails,
  onNavigateToDiscovery,
}) => {
  const [highlightDifferencesOnly, setHighlightDifferencesOnly] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [showAddProductPicker, setShowAddProductPicker] = useState(false);
  const [replacingProductId, setReplacingProductId] = useState<string | null>(null);

  // Available products not currently in the active comparison
  const availableToAdd = useMemo(() => {
    const activeIds = new Set(comparedProducts.map((p) => p.id));
    const uniqueMap = new Map<string, RankedProductOffer>();
    for (const item of candidatePool) {
      if (item && item.id && !activeIds.has(item.id) && !uniqueMap.has(item.id)) {
        uniqueMap.set(item.id, item);
      }
    }
    return Array.from(uniqueMap.values());
  }, [candidatePool, comparedProducts]);

  // Omega Decision Crucible Winner & Trade-Off Synthesis
  const crucibleEvaluation = useMemo(() => {
    if (comparedProducts.length === 0) return null;
    const scored = [...comparedProducts].sort((a, b) => {
      const sa =
        a.qualityAdjustedScore?.totalQualityAdjustedScore ?? a.completenessScore ?? 50;
      const sb =
        b.qualityAdjustedScore?.totalQualityAdjustedScore ?? b.completenessScore ?? 50;
      if (sb !== sa) return sb - sa;
      const pa = a.price ?? Number.MAX_SAFE_INTEGER;
      const pb = b.price ?? Number.MAX_SAFE_INTEGER;
      return pa - pb;
    });

    const winner = scored[0];
    const verifiedPrices = comparedProducts
      .filter((p) => p.price !== null && p.priceStatus === 'verified')
      .map((p) => p.price as number);
    const lowestPrice =
      verifiedPrices.length > 0 ? Math.min(...verifiedPrices) : null;
    const highestPrice =
      verifiedPrices.length > 0 ? Math.max(...verifiedPrices) : null;
    const priceSpread =
      lowestPrice !== null && highestPrice !== null
        ? Number((highestPrice - lowestPrice).toFixed(2))
        : null;

    const lowestPricedProduct =
      lowestPrice !== null
        ? comparedProducts.find(
            (p) => p.price !== null && Math.abs(p.price - lowestPrice) < 0.01
          ) || null
        : null;

    return {
      winner,
      lowestPricedProduct,
      lowestPrice,
      highestPrice,
      priceSpread,
      alternatives: scored.slice(1),
    };
  }, [comparedProducts]);

  // Normalized specification keys across all compared products
  const specComparisonRows = useMemo(() => {
    const keyMap = new Map<string, Record<string, string>>();
    for (const prod of comparedProducts) {
      const cleanSpecs = getCleanUserFacingSpecs(
        prod.richProfile?.technicalSpecsByCategory || prod.specs || {},
        { includeUnspecified: false, includeCondition: true }
      );
      for (const [rawKey, rawVal] of Object.entries(cleanSpecs)) {
        if (rawKey === 'Source ID' || rawKey === 'Saved Record ID') continue;
        const row = keyMap.get(rawKey) || {};
        row[prod.id] = String(rawVal);
        keyMap.set(rawKey, row);
      }
    }

    return Array.from(keyMap.entries()).map(([attrName, valuesByProductId]) => {
      const values = comparedProducts.map((p) => valuesByProductId[p.id] || '—');
      const distinctValues = new Set(values);
      const hasDifference = distinctValues.size > 1;
      const hasMissing = values.some((v) => v === '—');
      return {
        attrName,
        valuesByProductId,
        hasDifference,
        hasMissing,
      };
    });
  }, [comparedProducts]);

  const visibleSpecRows = useMemo(() => {
    if (!highlightDifferencesOnly) return specComparisonRows;
    return specComparisonRows.filter((r) => r.hasDifference);
  }, [specComparisonRows, highlightDifferencesOnly]);

  const handleSaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (comparedProducts.length === 0 || isSaving) return;
    const defaultTitle =
      saveTitle.trim() ||
      `${comparedProducts[0]?.category || 'Verified'} Comparison (${comparedProducts.length} items)`;
    setIsSaving(true);
    setSaveFeedback(null);
    try {
      await onSaveComparisonSet(defaultTitle);
      setSaveTitle('');
      setSaveFeedback(`Saved "${defaultTitle}" to your Comparison Library.`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportCsv = () => {
    if (comparedProducts.length === 0) return;
    const headers = ['Attribute', ...comparedProducts.map((p) => `"${p.name.replace(/"/g, '""')}"`)];
    const rows: string[][] = [
      headers,
      ['Merchant', ...comparedProducts.map((p) => `"${p.merchant}"`)],
      [
        'Verified Price',
        ...comparedProducts.map((p) =>
          p.price !== null && p.priceStatus === 'verified'
            ? `${p.currency} ${p.price.toFixed(2)}`
            : 'Unverified'
        ),
      ],
      [
        'Availability',
        ...comparedProducts.map((p) =>
          p.availabilityStatus === 'verified_in_stock' ? 'In Stock' : 'Check Merchant'
        ),
      ],
      [
        'Quality Score',
        ...comparedProducts.map((p) =>
          p.qualityAdjustedScore
            ? `${p.qualityAdjustedScore.totalQualityAdjustedScore}/100`
            : `${p.completenessScore}/100`
        ),
      ],
      ...specComparisonRows.map((row) => [
        `"${row.attrName.replace(/"/g, '""')}"`,
        ...comparedProducts.map(
          (p) => `"${(row.valuesByProductId[p.id] || 'Not reported').replace(/"/g, '""')}"`
        ),
      ]),
    ];

    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spark-comparison-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyMarkdownSummary = () => {
    if (comparedProducts.length === 0) return;
    const lines = [
      `# Spark Verified Product Comparison (${comparedProducts.length} Offers)`,
      crucibleEvaluation?.winner
        ? `**Omega Crucible Recommendation:** ${crucibleEvaluation.winner.name} (${crucibleEvaluation.winner.merchant})`
        : '',
      '',
      ...comparedProducts.map(
        (p, i) =>
          `${i + 1}. **${p.name}** — ${p.merchant} · ${
            p.price !== null && p.priceStatus === 'verified'
              ? `${p.currency} ${p.price.toFixed(2)}`
              : 'Price Unverified'
          }`
      ),
    ];
    navigator.clipboard?.writeText(lines.filter(Boolean).join('\n'));
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  return (
    <section
      data-testid="spark-comparisons-view"
      aria-label="Product Comparisons Workspace"
      className="max-w-6xl mx-auto px-4 sm:px-8 py-6 space-y-6"
    >
      {/* 1. HEADER & COMPARISON CONTROLS */}
      <div className="rounded-3xl bg-gradient-to-br from-[#141222]/95 via-[#100E1A]/95 to-[#0B0A12]/95 border border-white/[0.1] p-5 sm:p-6 shadow-2xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-violet-500/20 text-violet-200 border border-violet-400/30">
                <Scale className="w-3.5 h-3.5 text-violet-300" />
                <span>Omega Decision Crucible · Side-by-Side Workspace</span>
              </span>
              <span className="text-[11px] font-mono text-zinc-400 px-2.5 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.08]">
                {comparedProducts.length} active · {savedComparisons.length} saved set(s)
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              Side-by-Side Product Comparisons
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400">
              Compare verified technical specifications, merchant pricing, shipping, and quality-adjusted scores side by side, or save comparison workspaces to Firestore.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              data-testid="comparison-add-product-trigger-btn"
              onClick={() => setShowAddProductPicker((prev) => !prev)}
              className="px-3.5 py-2 rounded-xl bg-violet-600/25 hover:bg-violet-600/35 border border-violet-400/40 text-xs font-semibold text-violet-100 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Product to Compare ({availableToAdd.length})</span>
            </button>

            {comparedProducts.length > 0 && (
              <>
                <button
                  type="button"
                  data-testid="comparison-highlight-diffs-toggle"
                  aria-pressed={highlightDifferencesOnly}
                  onClick={() => setHighlightDifferencesOnly((prev) => !prev)}
                  className={`px-3.5 py-2 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer ${
                    highlightDifferencesOnly
                      ? 'bg-amber-500/20 border-amber-400/45 text-amber-200'
                      : 'bg-zinc-900 border-white/[0.08] text-zinc-300 hover:text-white'
                  }`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>Highlight Differences Only</span>
                </button>

                <button
                  type="button"
                  data-testid="comparison-export-csv-btn"
                  onClick={handleExportCsv}
                  className="px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs text-zinc-200 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Export CSV</span>
                </button>

                <button
                  type="button"
                  data-testid="comparison-copy-summary-btn"
                  onClick={handleCopyMarkdownSummary}
                  className="px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs text-zinc-200 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedSummary ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-violet-400" />
                  )}
                  <span>{copiedSummary ? 'Copied Summary' : 'Share Summary'}</span>
                </button>

                <button
                  type="button"
                  data-testid="comparison-clear-all-btn"
                  onClick={onClearComparison}
                  className="px-3 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-xs text-rose-200 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Save Comparison Form */}
        {comparedProducts.length > 0 && (
          <form
            onSubmit={handleSaveSubmit}
            className="pt-3 border-t border-white/[0.08] flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center"
          >
            <input
              type="text"
              data-testid="comparison-save-title-input"
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              placeholder={`Name this comparison set (e.g. "${
                comparedProducts[0]?.category || 'Headphones'
              } Top ${comparedProducts.length} Finalists")...`}
              aria-label="Comparison set title"
              className="flex-1 px-3.5 py-2 rounded-xl bg-zinc-950/90 border border-white/[0.1] text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-400"
            />
            <button
              type="submit"
              data-testid="comparison-save-submit-btn"
              disabled={isSaving}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Saving...' : 'Save Comparison to Library'}</span>
            </button>
          </form>
        )}

        {saveFeedback && (
          <div
            data-testid="comparison-save-feedback"
            className="px-3.5 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-200 flex items-center justify-between"
          >
            <span>{saveFeedback}</span>
            <button
              type="button"
              onClick={() => setSaveFeedback(null)}
              className="text-emerald-300 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Quick-Add / Replace Product Picker Drawer */}
        {(showAddProductPicker || replacingProductId) && (
          <div
            data-testid="comparison-product-picker"
            className="p-4 rounded-2xl bg-zinc-950/95 border border-violet-400/35 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-violet-200">
                {replacingProductId
                  ? 'Select a verified product to replace the selected column:'
                  : 'Add verified products from your Discovery & Saved pool:'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setShowAddProductPicker(false);
                  setReplacingProductId(null);
                }}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {availableToAdd.length === 0 ? (
              <p className="text-xs text-zinc-400">
                All currently discovered/saved products are already in the active comparison. Discover more products to add additional candidates.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-60 overflow-y-auto">
                {availableToAdd.slice(0, 12).map((cand) => (
                  <div
                    key={cand.id}
                    className="p-3 rounded-xl bg-zinc-900 border border-white/[0.08] flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-[10px] font-mono text-violet-300 truncate">
                        {cand.merchant}
                      </div>
                      <div className="text-xs font-medium text-white truncate">
                        {cand.name}
                      </div>
                      <div className="text-[11px] font-mono text-emerald-300">
                        {cand.price !== null && cand.priceStatus === 'verified'
                          ? `${cand.currency} ${cand.price.toFixed(2)}`
                          : 'Price Unverified'}
                      </div>
                    </div>
                    <button
                      type="button"
                      data-testid={`comparison-picker-add-${cand.id}`}
                      onClick={() => {
                        if (replacingProductId) {
                          onReplaceInCompare(replacingProductId, cand.id);
                          setReplacingProductId(null);
                        } else {
                          onAddToCompare(cand.id);
                        }
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shrink-0 cursor-pointer"
                    >
                      {replacingProductId ? 'Replace' : '+ Add'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. OMEGA DECISION CRUCIBLE RECOMMENDATION & TRADE-OFF BANNER */}
      {crucibleEvaluation && comparedProducts.length >= 2 && (
        <div
          data-testid="comparison-omega-crucible-card"
          className="rounded-3xl bg-gradient-to-r from-violet-950/50 via-[#13111E] to-cyan-950/35 border border-violet-400/35 p-5 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-violet-300">
              <Award className="w-4 h-4 text-emerald-400" />
              <span>Omega Decision Crucible · Comparative Trade-Off Synthesis</span>
            </div>
            {crucibleEvaluation.priceSpread !== null && (
              <span className="text-xs font-mono text-cyan-300 px-2.5 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30">
                Verified Price Spread: ${crucibleEvaluation.priceSpread.toFixed(2)}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-3.5 rounded-2xl bg-black/40 border border-emerald-500/30 space-y-1">
              <div className="text-[11px] font-mono text-emerald-300 font-semibold">
                ★ Top Quality-Adjusted Selection
              </div>
              <div className="text-sm font-bold text-white">
                {crucibleEvaluation.winner.name}
              </div>
              <p className="text-zinc-300 leading-relaxed">
                Listed by <strong>{crucibleEvaluation.winner.merchant}</strong> at{' '}
                <strong>
                  {crucibleEvaluation.winner.price !== null
                    ? `${crucibleEvaluation.winner.currency} ${crucibleEvaluation.winner.price.toFixed(2)}`
                    : 'Unverified Price'}
                </strong>
                . Leads on evidence completeness ({crucibleEvaluation.winner.completenessScore}%)
                {crucibleEvaluation.winner.qualityAdjustedScore
                  ? ` and quality-adjusted score (${crucibleEvaluation.winner.qualityAdjustedScore.totalQualityAdjustedScore}/100).`
                  : '.'}
              </p>
            </div>

            {crucibleEvaluation.lowestPricedProduct && (
              <div className="p-3.5 rounded-2xl bg-black/40 border border-cyan-500/30 space-y-1">
                <div className="text-[11px] font-mono text-cyan-300 font-semibold">
                  ◆ Best Verified Commercial Value
                </div>
                <div className="text-sm font-bold text-white">
                  {crucibleEvaluation.lowestPricedProduct.name}
                </div>
                <p className="text-zinc-300 leading-relaxed">
                  Lowest verified price at{' '}
                  <strong>
                    {crucibleEvaluation.lowestPricedProduct.currency}{' '}
                    {crucibleEvaluation.lowestPrice?.toFixed(2)}
                  </strong>{' '}
                  via <strong>{crucibleEvaluation.lowestPricedProduct.merchant}</strong>.
                  {crucibleEvaluation.priceSpread && crucibleEvaluation.priceSpread > 0
                    ? ` Saves $${crucibleEvaluation.priceSpread.toFixed(2)} compared to the highest-priced alternative.`
                    : ' Matches the lowest verified price in this set.'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. ACTIVE SIDE-BY-SIDE COMPARISON TABLE */}
      {comparedProducts.length === 0 ? (
        <div
          data-testid="comparison-empty-state"
          className="rounded-3xl bg-[#121217]/85 border border-white/[0.08] p-10 text-center space-y-4"
        >
          <Scale className="w-8 h-8 text-violet-400 mx-auto" />
          <div className="space-y-1 max-w-md mx-auto">
            <h2 className="text-base font-semibold text-white">
              No products currently selected for side-by-side comparison
            </h2>
            <p className="text-xs text-zinc-400">
              Select &ldquo;Compare&rdquo; on any product card in Conversation, Discover, or Saved, add products from the picker above, or load a saved comparison set below.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2.5">
            {availableToAdd.length > 0 && (
              <button
                type="button"
                data-testid="comparison-empty-quick-populate-btn"
                onClick={() => {
                  availableToAdd.slice(0, 3).forEach((p) => onAddToCompare(p.id));
                }}
                className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white cursor-pointer"
              >
                Compare Top {Math.min(3, availableToAdd.length)} Discovered Products
              </button>
            )}
            <button
              type="button"
              onClick={onNavigateToDiscovery}
              className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs text-zinc-200 cursor-pointer"
            >
              Browse Discover Catalog
            </button>
          </div>
        </div>
      ) : (
        <div
          data-testid="comparison-matrix-table-wrapper"
          className="rounded-3xl bg-[#12101B]/95 border border-white/[0.12] overflow-hidden shadow-2xl"
        >
          <div className="px-5 py-3.5 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Scale className="w-4 h-4 text-violet-400" />
              <h2 className="text-xs sm:text-sm font-semibold text-white">
                Normalized Technical &amp; Commercial Matrix ({comparedProducts.length} products)
              </h2>
            </div>
            <span className="text-[11px] font-mono text-zinc-400">
              {specComparisonRows.filter((r) => r.hasDifference).length} differing attribute(s) ·{' '}
              {specComparisonRows.filter((r) => r.hasMissing).length} partial attribute(s) disclosed
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/[0.08] bg-zinc-900/60">
                  <th className="p-3.5 text-zinc-400 font-medium w-48">Attribute</th>
                  {comparedProducts.map((prod) => {
                    const isWinner = crucibleEvaluation?.winner?.id === prod.id;
                    return (
                      <th key={prod.id} className="p-3.5 min-w-[230px] align-top">
                        <div className="space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] font-mono text-violet-300">
                                  {prod.merchant}
                                </span>
                                {isWinner && (
                                  <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 border border-emerald-500/40 text-[10px] font-mono text-emerald-300">
                                    ★ Top Pick
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => onOpenDetails(prod)}
                                className="text-xs font-semibold text-white hover:text-violet-200 text-left line-clamp-2 mt-0.5 cursor-pointer"
                              >
                                {prod.name}
                              </button>
                            </div>
                            <button
                              type="button"
                              data-testid={`comparison-remove-${prod.id}`}
                              onClick={() => onRemoveFromCompare(prod.id)}
                              aria-label={`Remove ${prod.name} from comparison`}
                              className="p-1 rounded-lg bg-zinc-800/80 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-300 cursor-pointer shrink-0"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setReplacingProductId(prod.id)}
                              className="px-2 py-0.5 rounded bg-white/[0.05] hover:bg-white/[0.1] text-[10px] font-mono text-zinc-300 cursor-pointer"
                            >
                              Replace Product
                            </button>
                            <span className="text-[10px] font-mono text-zinc-500">
                              {prod.category}
                            </span>
                          </div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {/* Commercial Rows */}
                <tr>
                  <td className="p-3.5 text-zinc-400 font-medium">Verified Price</td>
                  {comparedProducts.map((p) => {
                    const isLowest =
                      crucibleEvaluation?.lowestPrice !== null &&
                      p.price !== null &&
                      Math.abs(p.price - (crucibleEvaluation?.lowestPrice ?? -1)) < 0.01;
                    return (
                      <td key={p.id} className="p-3.5 font-mono font-bold text-white">
                        {p.price !== null && p.priceStatus === 'verified' ? (
                          <span className={isLowest ? 'text-emerald-300' : 'text-white'}>
                            {p.currency} {p.price.toFixed(2)}
                            {isLowest && comparedProducts.length > 1 ? ' (Lowest)' : ''}
                          </span>
                        ) : (
                          <span className="text-amber-300">Price unverified</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td className="p-3.5 text-zinc-400 font-medium">Quality &amp; Completeness</td>
                  {comparedProducts.map((p) => (
                    <td key={p.id} className="p-3.5 font-mono text-violet-300">
                      {p.qualityAdjustedScore
                        ? `${p.qualityAdjustedScore.totalQualityAdjustedScore}/100 (${p.qualityAdjustedScore.evidenceConfidence})`
                        : `Completeness: ${p.completenessScore}%`}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-3.5 text-zinc-400 font-medium">Availability &amp; Stock</td>
                  {comparedProducts.map((p) => (
                    <td key={p.id} className="p-3.5 font-mono text-emerald-300">
                      {p.availabilityStatus === 'verified_in_stock'
                        ? 'Verified In Stock'
                        : p.availabilityStatus === 'verified_out_of_stock'
                        ? 'Out of Stock'
                        : 'Check merchant listing'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-3.5 text-zinc-400 font-medium">Shipping &amp; Coupon</td>
                  {comparedProducts.map((p) => (
                    <td key={p.id} className="p-3.5 font-mono text-zinc-300 text-[11px]">
                      <div>
                        {p.shippingStatus === 'not_applicable_digital'
                          ? 'Digital ($0.00)'
                          : p.shippingCost === 0
                          ? 'Free Standard Shipping'
                          : 'Merchant Standard'}
                      </div>
                      {p.bestCoupon && (
                        <div className="text-amber-300">
                          Coupon: {p.bestCoupon.code} (-{p.currency}{' '}
                          {p.couponDiscountAmount.toFixed(2)})
                        </div>
                      )}
                    </td>
                  ))}
                </tr>

                {/* Dynamic Specification Rows */}
                {visibleSpecRows.map((row) => (
                  <tr
                    key={row.attrName}
                    className={
                      row.hasDifference && highlightDifferencesOnly
                        ? 'bg-amber-500/[0.06]'
                        : ''
                    }
                  >
                    <td className="p-3.5 text-zinc-300 font-medium">
                      <div className="flex items-center gap-1.5">
                        <span>{row.attrName}</span>
                        {row.hasDifference && (
                          <span
                            title="Values differ across compared products"
                            className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                          />
                        )}
                      </div>
                    </td>
                    {comparedProducts.map((p) => {
                      const val = row.valuesByProductId[p.id];
                      return (
                        <td key={p.id} className="p-3.5 font-mono text-zinc-200">
                          {val ? (
                            val
                          ) : (
                            <span className="text-zinc-500 italic">
                              Not reported by merchant
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}

                {/* Action Row */}
                <tr className="bg-zinc-950/60">
                  <td className="p-3.5 text-zinc-400 font-medium">Purchase &amp; Cart Actions</td>
                  {comparedProducts.map((p) => (
                    <td key={p.id} className="p-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          data-testid={`comparison-buy-now-${p.id}`}
                          onClick={() => onSelectForCheckout(p)}
                          className="px-3.5 py-1.5 rounded-full bg-gradient-to-r from-[#D884F8] via-[#F0A3D8] to-[#F7CBA8] text-[#140E21] font-semibold text-xs cursor-pointer"
                        >
                          Buy Now
                        </button>
                        <button
                          type="button"
                          data-testid={`comparison-add-to-cart-${p.id}`}
                          onClick={() => onAddToCart(p)}
                          className="px-3 py-1.5 rounded-full bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/40 text-violet-100 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <ShoppingCart className="w-3.5 h-3.5" />
                          <span>Add to Cart</span>
                        </button>
                        <a
                          href={p.canonicalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs inline-flex items-center gap-1"
                        >
                          <span>Store</span>
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
      )}

      {/* 4. SAVED COMPARISONS LIBRARY (BACKEND + FIRESTORE PERSISTENCE) */}
      <div
        data-testid="saved-comparisons-library"
        className="rounded-3xl bg-[#12101B]/95 border border-white/[0.1] p-5 sm:p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderHeart className="w-4 h-4 text-violet-400" />
            <h2 className="text-sm sm:text-base font-bold text-white">
              Saved Comparison Workspaces ({savedComparisons.length})
            </h2>
          </div>
          <span className="text-[11px] font-mono text-zinc-400">
            Synced to Backend &amp; Firestore (/users/uid/comparisons)
          </span>
        </div>

        {savedComparisons.length === 0 ? (
          <p className="text-xs text-zinc-400">
            You haven&apos;t saved any comparison sets yet. Add products above and click &ldquo;Save Comparison to Library&rdquo; to revisit them across sessions.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {savedComparisons.map((record) => (
              <div
                key={record.id}
                data-testid={`saved-comparison-card-${record.id}`}
                className="p-4 rounded-2xl bg-zinc-900/90 border border-white/[0.08] hover:border-violet-400/35 flex flex-col justify-between gap-3 transition-all"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet-500/20 text-violet-200 border border-violet-400/30">
                      {record.category} · {record.products.length} products
                    </span>
                    <span className="text-[10px] font-mono text-zinc-500">
                      {new Date(record.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-white">{record.title}</h3>
                  <p className="text-xs text-zinc-400 line-clamp-2">
                    {record.crucibleSummary}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/[0.06]">
                  <button
                    type="button"
                    data-testid={`load-saved-comparison-${record.id}`}
                    onClick={() => onLoadSavedComparison(record)}
                    className="px-3.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white cursor-pointer"
                  >
                    Load into Workspace
                  </button>
                  <button
                    type="button"
                    data-testid={`delete-saved-comparison-${record.id}`}
                    onClick={() => onDeleteSavedComparison(record.id)}
                    className="p-1.5 rounded-xl bg-zinc-800 hover:bg-rose-500/20 text-zinc-400 hover:text-rose-300 cursor-pointer"
                    title="Delete saved comparison"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
