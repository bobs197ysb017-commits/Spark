import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpDown,
  BarChart3,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Cpu,
  CreditCard,
  RefreshCw,
  Scale,
  Search,
  Tag,
} from 'lucide-react';
import type {
  AgGridWorkspaceView,
  CouponItem,
  PurchaseRecord,
  RankedProductOffer,
  SubscriptionQuotaStatus,
} from '../../types/spark';
import { buildAuthenticatedHeaders } from '../../utils/authClient';

interface AgGridAnalyticsWorkspaceProps {
  savedProducts: RankedProductOffer[];
  comparedProducts: RankedProductOffer[];
  purchases: PurchaseRecord[];
  coupons: CouponItem[];
  quotaStatus: SubscriptionQuotaStatus | null;
  onOpenDetails?: (product: RankedProductOffer) => void;
  onSelectForCheckout?: (product: RankedProductOffer) => void;
  onRefreshData?: () => void;
}

interface TableColumn<T = Record<string, unknown>> {
  field: string;
  headerName: string;
  sortable?: boolean;
  valueFormatter?: (row: T, value: unknown) => string;
  cellRenderer?: (row: T, value: unknown) => React.ReactNode;
}

export const AgGridAnalyticsWorkspace: React.FC<AgGridAnalyticsWorkspaceProps> = ({
  savedProducts,
  comparedProducts,
  purchases,
  coupons,
  quotaStatus,
  onOpenDetails,
  onSelectForCheckout,
  onRefreshData,
}) => {
  const [activeTab, setActiveTab] = useState<AgGridWorkspaceView>(() => {
    try {
      const saved = localStorage.getItem('spark_ag_default_tab') as AgGridWorkspaceView | null;
      if (
        saved &&
        [
          'saved_products',
          'comparison_matrix',
          'purchase_ledger',
          'coupon_savings',
          'quota_usage',
        ].includes(saved)
      ) {
        return saved;
      }
    } catch {
      // Ignore storage access errors
    }
    return 'saved_products';
  });
  const [quickFilterText, setQuickFilterText] = useState('');
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [pageSize, setPageSize] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const persistDashboardPrefs = useCallback(
    (tab: AgGridWorkspaceView, size: number) => {
      try {
        localStorage.setItem('spark_ag_default_tab', tab);
      } catch {
        // Ignore
      }
      fetch('/api/subscriptions/dashboard-preferences', {
        method: 'PUT',
        headers: buildAuthenticatedHeaders({ method: 'PUT' }),
        credentials: 'include',
        body: JSON.stringify({ defaultTab: tab, pageSize: size }),
      }).catch(() => {});
    },
    []
  );

  useEffect(() => {
    let mounted = true;
    fetch('/api/subscriptions/analytics', {
      headers: buildAuthenticatedHeaders({ method: 'GET' }),
      credentials: 'include',
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!mounted || !data?.dashboardPreferences) return;
        const prefTab = data.dashboardPreferences.defaultTab as AgGridWorkspaceView | undefined;
        const prefSize = Number(data.dashboardPreferences.pageSize);
        if (
          prefTab &&
          [
            'saved_products',
            'comparison_matrix',
            'purchase_ledger',
            'coupon_savings',
            'quota_usage',
          ].includes(prefTab)
        ) {
          setActiveTab(prefTab);
        }
        if ([10, 25, 50, 100].includes(prefSize)) {
          setPageSize(prefSize);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const handleSelectTab = useCallback(
    (tab: AgGridWorkspaceView) => {
      setActiveTab(tab);
      setSortField(null);
      setCurrentPage(1);
      persistDashboardPrefs(tab, pageSize);
    },
    [pageSize, persistDashboardPrefs]
  );

  // Quick summary KPIs
  const totalPurchaseVolume = useMemo(() => {
    return purchases.reduce((sum, p) => sum + (p.totalAmount || 0), 0);
  }, [purchases]);

  const verifiedCouponsCount = useMemo(() => {
    return coupons.filter((c) => c.verificationStatus === 'verified').length;
  }, [coupons]);

  // Tab 1: Saved Products Column Definitions
  const savedColDefs: TableColumn<RankedProductOffer>[] = useMemo(
    () => [
      {
        field: 'name',
        headerName: 'Product Name',
        sortable: true,
        cellRenderer: (row, value) => (
          <div className="flex items-center gap-2.5 py-1">
            {row?.imageUrl && (
              <img
                src={row.imageUrl}
                alt=""
                className="w-7 h-7 rounded-md object-cover border border-white/10 shrink-0"
              />
            )}
            <span className="font-medium text-white truncate max-w-[260px]">
              {String(value || '')}
            </span>
          </div>
        ),
      },
      {
        field: 'merchant',
        headerName: 'Merchant / Source',
        sortable: true,
      },
      {
        field: 'price',
        headerName: 'Price (USD)',
        sortable: true,
        valueFormatter: (_row, value) =>
          typeof value === 'number' ? `$${value.toFixed(2)}` : 'Unverified',
      },
      {
        field: 'rating',
        headerName: 'Rating',
        sortable: true,
        valueFormatter: (_row, value) => (value ? `★ ${value}` : '—'),
      },
      {
        field: 'verificationStatus',
        headerName: 'Verification',
        cellRenderer: (_row, value) => {
          const isVerified = value === 'verified_match' || value === 'verified_fresh';
          return (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${
                isVerified
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                  : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
              }`}
            >
              {isVerified ? '✓ Verified' : 'Catalog Record'}
            </span>
          );
        },
      },
      {
        field: 'actions',
        headerName: 'Actions',
        sortable: false,
        cellRenderer: (row) => (
          <div className="flex items-center gap-1.5 py-1">
            <button
              type="button"
              onClick={() => onOpenDetails && onOpenDetails(row)}
              className="px-2 py-0.5 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded border border-white/10 cursor-pointer"
            >
              Inspect
            </button>
            <button
              type="button"
              onClick={() => onSelectForCheckout && onSelectForCheckout(row)}
              className="px-2 py-0.5 text-[11px] bg-violet-600 hover:bg-violet-500 text-white rounded cursor-pointer"
            >
              Buy
            </button>
          </div>
        ),
      },
    ],
    [onOpenDetails, onSelectForCheckout]
  );

  // Tab 2: Comparison Matrix Column Definitions
  const comparisonColDefs: TableColumn<RankedProductOffer>[] = useMemo(
    () => [
      {
        field: 'name',
        headerName: 'Compared Product',
        sortable: true,
      },
      { field: 'merchant', headerName: 'Merchant', sortable: true },
      {
        field: 'price',
        headerName: 'Price',
        sortable: true,
        valueFormatter: (_row, val) => (typeof val === 'number' ? `$${val.toFixed(2)}` : 'N/A'),
      },
      {
        field: 'shippingCost',
        headerName: 'Shipping',
        valueFormatter: (_row, val) => (val === 0 ? 'FREE' : val ? `$${val}` : 'Standard'),
      },
      {
        field: 'rating',
        headerName: 'Score',
        valueFormatter: (_row, val) => (val ? `${val} / 5` : '—'),
      },
      {
        field: 'sourceName',
        headerName: 'API Provider',
      },
      {
        field: 'checkoutStatus',
        headerName: 'PayPal Ready',
        cellRenderer: (_row, val) => (
          <span
            className={`px-2 py-0.5 rounded text-[11px] font-medium ${
              val === 'checkout_ready'
                ? 'bg-blue-500/15 text-blue-400 border border-blue-500/25'
                : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            {val === 'checkout_ready' ? 'Supported' : 'Merchant Direct'}
          </span>
        ),
      },
    ],
    []
  );

  // Tab 3: Purchase Ledger Column Definitions
  const purchaseColDefs: TableColumn<PurchaseRecord>[] = useMemo(
    () => [
      {
        field: 'orderReference',
        headerName: 'Order ID',
        sortable: true,
        cellRenderer: (_row, val) => (
          <span className="font-mono text-xs text-violet-400">{String(val || '')}</span>
        ),
      },
      {
        field: 'createdAt',
        headerName: 'Timestamp',
        sortable: true,
        valueFormatter: (_row, val) => (val ? new Date(String(val)).toLocaleString() : '—'),
      },
      { field: 'merchant', headerName: 'Merchant', sortable: true },
      { field: 'productName', headerName: 'Item Purchased' },
      {
        field: 'quantity',
        headerName: 'Qty',
        sortable: true,
      },
      {
        field: 'totalAmount',
        headerName: 'Total (USD)',
        sortable: true,
        valueFormatter: (_row, val) => `$${Number(val || 0).toFixed(2)}`,
      },
      {
        field: 'status',
        headerName: 'Payment Status',
        cellRenderer: (_row, val) => (
          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
            {String(val || 'COMPLETED')}
          </span>
        ),
      },
      {
        field: 'merchantOrderStatus',
        headerName: 'Merchant Status',
        valueFormatter: (row) =>
          row.merchantOrderStatus || 'Merchant order not submitted — Sandbox simulation',
      },
    ],
    []
  );

  // Tab 4: Coupon Savings Column Definitions
  const couponColDefs: TableColumn<CouponItem>[] = useMemo(
    () => [
      {
        field: 'code',
        headerName: 'Promo Code',
        sortable: true,
        cellRenderer: (_row, val) => (
          <span className="font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
            {String(val || '')}
          </span>
        ),
      },
      { field: 'merchant', headerName: 'Merchant', sortable: true },
      {
        field: 'discountValue',
        headerName: 'Discount',
        sortable: true,
        valueFormatter: (row, val) =>
          row?.discountType === 'percentage'
            ? `${val}% OFF`
            : `$${Number(val || 0).toFixed(2)} OFF`,
      },
      { field: 'description', headerName: 'Terms & Conditions' },
      {
        field: 'verificationStatus',
        headerName: 'Verification',
        cellRenderer: (_row, val) => {
          const isVerified = val === 'verified';
          return (
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                isVerified
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                  : 'bg-zinc-800 text-zinc-400'
              }`}
            >
              {isVerified ? '✓ Verified Active' : 'Unverified'}
            </span>
          );
        },
      },
      {
        field: 'estimatedSavingsUsd',
        headerName: 'Est. Savings',
        sortable: true,
        valueFormatter: (_row, val) =>
          typeof val === 'number' && Number.isFinite(val) ? `$${val.toFixed(2)}` : '—',
      },
    ],
    []
  );

  // Tab 5: Subscription Quota Usage
  const quotaColDefs: TableColumn<Record<string, unknown>>[] = useMemo(
    () => [
      { field: 'metric', headerName: 'Platform Capability' },
      { field: 'planTier', headerName: 'Active Tier' },
      { field: 'used', headerName: 'Used This Cycle', sortable: true },
      { field: 'limit', headerName: 'Monthly Limit', sortable: true },
      { field: 'remaining', headerName: 'Remaining Balance', sortable: true },
      {
        field: 'status',
        headerName: 'Health',
        cellRenderer: (_row, val) => (
          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
            {String(val || '')}
          </span>
        ),
      },
    ],
    []
  );

  const quotaRows = useMemo(() => {
    if (!quotaStatus) return [];
    const { plan, usage, limits, remaining } = quotaStatus;
    return [
      {
        metric: 'Product Comparison Workflows',
        planTier: plan.name,
        used: usage.workflowsUsed,
        limit: limits.workflows,
        remaining: remaining.workflows,
        status: remaining.workflows > 0 ? 'Normal' : 'Exhausted',
      },
      {
        metric: 'Channel3 Product Discovery Searches',
        planTier: plan.name,
        used: usage.searchesUsed,
        limit: limits.searches,
        remaining: remaining.searches,
        status: remaining.searches > 0 ? 'Normal' : 'Exhausted',
      },
      {
        metric: 'Verified Coupon & Cashback Checks',
        planTier: plan.name,
        used: usage.couponsUsed,
        limit: limits.coupons,
        remaining: remaining.coupons,
        status: remaining.coupons > 0 ? 'Normal' : 'Exhausted',
      },
      {
        metric: 'Deep Chemical & Spec Analyses',
        planTier: plan.name,
        used: usage.analysesUsed,
        limit: limits.analyses,
        remaining: remaining.analyses,
        status: remaining.analyses > 0 ? 'Normal' : 'Exhausted',
      },
      {
        metric: 'Concurrent Workflow Capacity',
        planTier: plan.name,
        used: usage.activeWorkflowsCount,
        limit: limits.concurrency,
        remaining: remaining.concurrency,
        status: 'Operational',
      },
    ];
  }, [quotaStatus]);

  const activeColDefs = useMemo((): TableColumn<Record<string, unknown>>[] => {
    switch (activeTab) {
      case 'saved_products':
        return savedColDefs as unknown as TableColumn<Record<string, unknown>>[];
      case 'comparison_matrix':
        return comparisonColDefs as unknown as TableColumn<Record<string, unknown>>[];
      case 'purchase_ledger':
        return purchaseColDefs as unknown as TableColumn<Record<string, unknown>>[];
      case 'coupon_savings':
        return couponColDefs as unknown as TableColumn<Record<string, unknown>>[];
      case 'quota_usage':
        return quotaColDefs;
      default:
        return savedColDefs as unknown as TableColumn<Record<string, unknown>>[];
    }
  }, [
    activeTab,
    savedColDefs,
    comparisonColDefs,
    purchaseColDefs,
    couponColDefs,
    quotaColDefs,
  ]);

  const activeRowData = useMemo((): Record<string, unknown>[] => {
    switch (activeTab) {
      case 'saved_products':
        return savedProducts as unknown as Record<string, unknown>[];
      case 'comparison_matrix':
        return comparedProducts as unknown as Record<string, unknown>[];
      case 'purchase_ledger':
        return purchases as unknown as Record<string, unknown>[];
      case 'coupon_savings':
        return coupons as unknown as Record<string, unknown>[];
      case 'quota_usage':
        return quotaRows as unknown as Record<string, unknown>[];
      default:
        return [];
    }
  }, [activeTab, savedProducts, comparedProducts, purchases, coupons, quotaRows]);

  const filteredAndSortedRows = useMemo(() => {
    const query = quickFilterText.trim().toLowerCase();
    let rows = activeRowData;
    if (query) {
      rows = rows.filter((row) =>
        Object.values(row).some((val) =>
          val !== null && val !== undefined && String(val).toLowerCase().includes(query)
        )
      );
    }
    if (sortField) {
      rows = [...rows].sort((a, b) => {
        const va = a[sortField];
        const vb = b[sortField];
        const aMissing = va === null || va === undefined || va === '';
        const bMissing = vb === null || vb === undefined || vb === '';
        if (aMissing && bMissing) return 0;
        if (aMissing) return 1;
        if (bMissing) return -1;
        if (typeof va === 'number' && typeof vb === 'number') {
          return sortDirection === 'asc' ? va - vb : vb - va;
        }
        const sa = String(va).toLowerCase();
        const sb = String(vb).toLowerCase();
        return sortDirection === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
      });
    }
    return rows;
  }, [activeRowData, quickFilterText, sortField, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSortedRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredAndSortedRows.slice(start, start + pageSize);
  }, [filteredAndSortedRows, safePage, pageSize]);

  const handleSort = (field: string, sortable?: boolean) => {
    if (!sortable) return;
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleExportCsv = useCallback(() => {
    if (typeof window === 'undefined') return;
    const exportCols = activeColDefs.filter((c) => c.field !== 'actions');
    const headerRow = exportCols.map((c) => `"${c.headerName.replace(/"/g, '""')}"`).join(',');
    const bodyRows = filteredAndSortedRows.map((row) =>
      exportCols
        .map((c) => {
          const rawVal = row[c.field];
          const formatted = c.valueFormatter
            ? c.valueFormatter(row, rawVal)
            : String(rawVal ?? '');
          return `"${String(formatted).replace(/"/g, '""')}"`;
        })
        .join(',')
    );
    const csvContent = [headerRow, ...bodyRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `spark_analytics_${activeTab}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [activeColDefs, filteredAndSortedRows, activeTab]);

  return (
    <div data-testid="ag-grid-analytics-workspace" className="max-w-7xl mx-auto space-y-6">
      {/* Top Banner & KPI Metrics */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Intelligent Analytics Workspace
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-violet-500/15 text-violet-300 border border-violet-500/30 whitespace-nowrap shrink-0">
              Spark Tabular Engine
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Real-time tabular analytics for verified products, comparison matrices, purchase ledgers, and subscription quota usage.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onRefreshData && (
            <button
              type="button"
              onClick={onRefreshData}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-xs font-medium text-zinc-300 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          )}
          <button
            type="button"
            data-testid="analytics-export-csv-btn"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-medium text-white shadow-sm cursor-pointer"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="rounded-2xl bg-[#121217] border border-white/[0.08] p-3.5">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
            <span>Saved Items</span>
            <Bookmark className="w-3.5 h-3.5 text-violet-400" />
          </div>
          <div className="text-xl font-bold text-white">{savedProducts.length}</div>
          <div className="text-[11px] text-zinc-500 mt-0.5">Bookmarked products</div>
        </div>

        <div className="rounded-2xl bg-[#121217] border border-white/[0.08] p-3.5">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
            <span>Compared</span>
            <Scale className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <div className="text-xl font-bold text-white">{comparedProducts.length}</div>
          <div className="text-[11px] text-zinc-500 mt-0.5">Active matrix items</div>
        </div>

        <div className="rounded-2xl bg-[#121217] border border-white/[0.08] p-3.5">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
            <span>Purchase Volume</span>
            <CreditCard className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-emerald-400">
            ${totalPurchaseVolume.toFixed(2)}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5">{purchases.length} orders settled</div>
        </div>

        <div className="rounded-2xl bg-[#121217] border border-white/[0.08] p-3.5">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
            <span>Verified Deals</span>
            <Tag className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-xl font-bold text-white">{verifiedCouponsCount}</div>
          <div className="text-[11px] text-zinc-500 mt-0.5">Active promo codes</div>
        </div>

        <div className="rounded-2xl bg-[#121217] border border-white/[0.08] p-3.5">
          <div className="flex items-center justify-between text-zinc-400 text-xs mb-1">
            <span>Subscription Plan</span>
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-xl font-bold text-white uppercase">
            {quotaStatus?.plan?.id || 'Free'}
          </div>
          <div className="text-[11px] text-cyan-400/80 mt-0.5">
            {quotaStatus?.remaining?.workflows ?? 3} workflows left
          </div>
        </div>
      </div>

      {/* Table Controls & View Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#121217] border border-white/[0.08] p-2.5 rounded-2xl">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => handleSelectTab('saved_products')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer transition-colors ${
              activeTab === 'saved_products'
                ? 'bg-violet-600 text-white shadow-xs'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            <Bookmark className="w-3.5 h-3.5" />
            <span>Saved Products</span>
            <span className="px-1.5 py-0.2 rounded text-[10px] bg-black/30">
              {savedProducts.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleSelectTab('comparison_matrix')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer transition-colors ${
              activeTab === 'comparison_matrix'
                ? 'bg-violet-600 text-white shadow-xs'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            <span>Comparison Matrix</span>
            <span className="px-1.5 py-0.2 rounded text-[10px] bg-black/30">
              {comparedProducts.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleSelectTab('purchase_ledger')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer transition-colors ${
              activeTab === 'purchase_ledger'
                ? 'bg-violet-600 text-white shadow-xs'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>Purchase Ledger</span>
            <span className="px-1.5 py-0.2 rounded text-[10px] bg-black/30">
              {purchases.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleSelectTab('coupon_savings')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer transition-colors ${
              activeTab === 'coupon_savings'
                ? 'bg-violet-600 text-white shadow-xs'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            <Tag className="w-3.5 h-3.5" />
            <span>Coupon Savings</span>
            <span className="px-1.5 py-0.2 rounded text-[10px] bg-black/30">
              {coupons.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleSelectTab('quota_usage')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium cursor-pointer transition-colors ${
              activeTab === 'quota_usage'
                ? 'bg-violet-600 text-white shadow-xs'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Quota Monitor</span>
          </button>
        </div>

        {/* Quick Filter Search */}
        <div className="relative min-w-[220px]">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={quickFilterText}
            onChange={(e) => {
              setQuickFilterText(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Quick search in table..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-900 border border-white/10 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500"
          />
        </div>
      </div>

      {/* Native Tabular Analytics Container */}
      <div className="rounded-2xl border border-white/[0.08] overflow-hidden bg-[#0D0D12]">
        <div className="overflow-x-auto min-h-[420px]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/[0.08] bg-zinc-900/60">
                {activeColDefs.map((col) => {
                  const isSorted = sortField === col.field;
                  return (
                    <th
                      key={col.field}
                      aria-sort={
                        col.sortable
                          ? isSorted
                            ? sortDirection === 'asc'
                              ? 'ascending'
                              : 'descending'
                            : 'none'
                          : undefined
                      }
                      className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 select-none"
                    >
                      {col.sortable ? (
                        <button
                          type="button"
                          onClick={() => handleSort(col.field, col.sortable)}
                          className="inline-flex items-center gap-1.5 hover:text-white cursor-pointer uppercase tracking-wider font-semibold"
                        >
                          <span>{col.headerName}</span>
                          <ArrowUpDown
                            className={`w-3 h-3 ${
                              isSorted ? 'text-violet-400' : 'text-zinc-600'
                            }`}
                          />
                        </button>
                      ) : (
                        <span>{col.headerName}</span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06] text-xs text-zinc-200">
              {paginatedRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={activeColDefs.length}
                    className="py-16 text-center text-zinc-400 text-xs"
                  >
                    No records available in this analytics view. Perform searches or actions to populate data.
                  </td>
                </tr>
              ) : (
                paginatedRows.map((row, idx) => (
                  <tr
                    key={String(row.id || row.orderReference || row.code || row.metric || idx)}
                    className="hover:bg-white/[0.02] transition-colors"
                  >
                    {activeColDefs.map((col) => {
                      const val = row[col.field];
                      return (
                        <td key={col.field} className="px-4 py-3 align-middle">
                          {col.cellRenderer
                            ? col.cellRenderer(row, val)
                            : col.valueFormatter
                            ? col.valueFormatter(row, val)
                            : String(val ?? '—')}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-white/[0.08] bg-zinc-900/40 text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <span>Rows per page:</span>
            <select
              aria-label="Rows per page"
              value={pageSize}
              onChange={(e) => {
                const nextSize = Number(e.target.value);
                setPageSize(nextSize);
                setCurrentPage(1);
                persistDashboardPrefs(activeTab, nextSize);
              }}
              className="bg-zinc-900 border border-white/10 rounded-lg px-2 py-1 text-xs text-zinc-200 focus:outline-none"
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
            <span className="ml-2">
              Showing {filteredAndSortedRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1}–
              {Math.min(safePage * pageSize, filteredAndSortedRows.length)} of{' '}
              {filteredAndSortedRows.length}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Previous page"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-zinc-300 disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="px-2">
              Page {safePage} of {totalPages}
            </span>
            <button
              type="button"
              aria-label="Next page"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-zinc-300 disabled:opacity-40 cursor-pointer"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
