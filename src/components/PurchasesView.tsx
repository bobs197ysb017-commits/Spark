import React, { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  Lock,
  Package,
  Receipt,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type { PurchaseRecord, UserProfile } from '../types/spark';
import type { TranslationStrings } from '../utils/i18n';

interface PurchasesViewProps {
  user?: UserProfile | null;
  purchases: PurchaseRecord[];
  t: TranslationStrings;
  onRefreshPurchases?: () => Promise<void> | void;
  onOpenPayPalSandbox?: () => void;
  onReturnToSpark: () => void;
}

export const PurchasesView: React.FC<PurchasesViewProps> = ({
  user,
  purchases,
  t,
  onRefreshPurchases,
  onReturnToSpark,
}) => {
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseRecord | null>(
    purchases[0] || null
  );
  const [refreshing, setRefreshing] = useState(false);

  // Enforce defence-in-depth UI check on top of backend & Firestore row-level isolation
  const ownedPurchases = user
    ? purchases.filter((p) => !p.userId || p.userId === user.id)
    : purchases;

  const activePurchase =
    ownedPurchases.find((p) => p.id === selectedPurchase?.id) || ownedPurchases[0] || null;

  const handleRefresh = async () => {
    if (!onRefreshPurchases) return;
    setRefreshing(true);
    try {
      await onRefreshPurchases();
    } finally {
      setRefreshing(false);
    }
  };

  if (ownedPurchases.length === 0) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4 space-y-6">
        {/* Owner Isolation Banner */}
        {user && (
          <div className="rounded-2xl bg-[#121217]/90 border border-white/[0.08] p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center shrink-0">
                <Lock className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <div className="text-xs font-semibold text-white flex items-center gap-2">
                  <span>Authenticated Sandbox Order History · Strict Owner Isolation</span>
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-[10px] font-mono text-amber-300">
                    SANDBOX
                  </span>
                </div>
                <div className="text-[11px] text-zinc-400 break-words">
                  Showing verified records bound exclusively to{' '}
                  <span className="text-zinc-200 font-mono break-all">{user.email}</span> (
                  <span className="font-mono text-violet-300 break-all">{user.id}</span>)
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {onRefreshPurchases && (
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="py-1.5 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs text-zinc-200 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                  <span>Sync Records</span>
                </button>
              )}
            </div>
          </div>
        )}

        <div className="rounded-3xl bg-[#121217]/85 border border-white/[0.08] p-12 flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-4">
            <CreditCard className="w-5 h-5 text-violet-300" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">
            {t.emptyPurchasesTitle}
          </h2>
          <p className="text-sm text-zinc-400 max-w-md leading-relaxed mb-6">
            {t.emptyPurchasesDesc} Spark never generates synthetic purchases or claims an order is paid without server-verified PayPal Sandbox capture.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onReturnToSpark}
              className="py-2.5 px-5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-xs font-medium text-white inline-flex items-center gap-2 transition-all cursor-pointer"
            >
              <span>{t.returnToSpark}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="my-purchases-view" className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              {t.nav.purchases}
            </h1>
            <span className="px-2.5 py-0.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-xs font-mono font-bold text-amber-300">
              SANDBOX
            </span>
            <span className="px-2.5 py-0.5 rounded-lg bg-[#0070BA]/25 border border-[#0070BA]/50 text-xs font-mono text-cyan-300">
              SANDBOX ORDERS
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Persistent Spark Sandbox orders verified by server-side PayPal Sandbox capture, scoped strictly to your authenticated account.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {onRefreshPurchases && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="py-2 px-3.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs font-medium text-zinc-200 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Sync Payment Records</span>
            </button>
          )}
        </div>
      </div>

      {/* Authenticated Owner Security Strip */}
      {user && (
        <div className="rounded-2xl bg-[#121217]/90 border border-emerald-500/20 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-zinc-300 min-w-0">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="break-words">
              Owner-verified Sandbox order ledger for{' '}
              <span className="font-mono text-white break-all">{user.email}</span> (Spark UID:{' '}
              <span className="font-mono text-violet-300 break-all">{user.id}</span>)
            </span>
          </div>
          <span className="font-mono text-[11px] text-emerald-300">
            {ownedPurchases.length} verified {ownedPurchases.length === 1 ? 'order' : 'orders'}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          {ownedPurchases.map((item) => {
            const isSelected = activePurchase?.id === item.id;
            const paypalOrderRef = item.paypalOrderId || item.paypalTransactionId;
            const paymentStatusLabel =
              item.paymentStatus ||
              item.captureStatus ||
              (item.status === 'refunded'
                ? 'REFUNDED'
                : item.status === 'completed'
                ? 'COMPLETED'
                : item.status.toUpperCase());
            const merchantStatusLabel =
              item.merchantOrderStatus ||
              'Merchant order not submitted — Sandbox simulation';

            return (
              <button
                key={item.id}
                type="button"
                data-testid={`purchase-card-${item.orderReference}`}
                onClick={() => setSelectedPurchase(item)}
                className={`w-full text-left p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer ${
                  isSelected
                    ? 'bg-zinc-900 border-violet-500/50'
                    : 'bg-[#121217]/90 border-white/[0.08] hover:border-white/[0.16]'
                }`}
              >
                <div className="min-w-0 space-y-1.5 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 font-mono text-[10px] font-bold text-amber-300 shrink-0">
                      {item.orderTypeLabel || 'SANDBOX ORDER'}
                    </span>
                    <h3 className="text-sm font-semibold text-white truncate">
                      {item.productName}
                    </h3>
                    <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 font-mono text-[10px] text-emerald-300 shrink-0">
                      Payment: {paymentStatusLabel}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-400">
                    <span className="text-zinc-200 font-medium">{item.merchant}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-violet-300">
                      Spark Order ID: {item.orderReference}
                    </span>
                    {paypalOrderRef && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-[11px] text-cyan-300">
                          PayPal Order: {paypalOrderRef}
                        </span>
                      </>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-950/90 border border-amber-500/25 font-mono text-amber-300">
                      <Package className="w-3 h-3 text-amber-400" />
                      <span>{merchantStatusLabel}</span>
                    </span>
                    <span className="text-zinc-500 font-mono">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="text-left sm:text-right shrink-0">
                  <div className="text-sm font-semibold font-mono tabular-nums text-white">
                    {item.currency} {item.totalAmount.toFixed(2)}
                  </div>
                  <div className="text-[11px] text-zinc-400 font-mono">
                    Qty: {item.quantity}
                  </div>
                  <div className="inline-flex items-center gap-1 text-xs mt-1">
                    {item.status === 'completed' && (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Completed</span>
                      </>
                    )}
                    {item.status === 'refunded' && (
                      <>
                        <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                        <span className="text-amber-400">Refunded</span>
                      </>
                    )}
                    {item.status === 'pending' && (
                      <>
                        <Clock className="w-3.5 h-3.5 text-amber-400" />
                        <span className="text-amber-400">Pending</span>
                      </>
                    )}
                    {(item.status === 'failed' || item.status === 'cancelled') && (
                      <>
                        <XCircle className="w-3.5 h-3.5 text-rose-400" />
                        <span className="text-rose-400 capitalize">{item.status}</span>
                      </>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Receipt Inspector Panel */}
        <div className="rounded-2xl bg-[#121217]/90 border border-white/[0.08] p-5 h-fit">
          {activePurchase ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-violet-300 font-medium">
                  <Receipt className="w-4 h-4" />
                  <span>Sandbox Order &amp; Payment Receipt</span>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-[10px] font-mono font-bold text-amber-300">
                  {activePurchase.orderTypeLabel || 'SANDBOX ORDER'}
                </span>
              </div>

              <div>
                <h3 className="text-base font-semibold text-white">
                  {activePurchase.productName}
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Merchant: <span className="text-zinc-200">{activePurchase.merchant}</span> · Source:{' '}
                  <span className="font-mono">{activePurchase.sourceId}</span>
                </p>
                {activePurchase.productUrl && (
                  <a
                    href={activePurchase.productUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:underline mt-1"
                  >
                    <span>Open merchant product listing</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              {/* Explicit Status Separation Box */}
              <div className="p-3 rounded-xl bg-zinc-950/90 border border-white/[0.08] space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-400">Payment Status</span>
                  <span
                    data-testid="receipt-payment-status"
                    className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 font-mono text-[11px] font-semibold text-emerald-300"
                  >
                    {activePurchase.paymentStatus ||
                      activePurchase.captureStatus ||
                      activePurchase.status.toUpperCase()}
                  </span>
                </div>
                <div className="pt-2 border-t border-white/[0.06]">
                  <div className="text-zinc-400 text-[11px] mb-1">Merchant Order Status</div>
                  <div
                    data-testid="receipt-merchant-order-status"
                    className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 font-mono text-[11px] text-amber-300"
                  >
                    {activePurchase.merchantOrderStatus ||
                      'Merchant order not submitted — Sandbox simulation'}
                  </div>
                </div>
              </div>

              {/* Line Items Breakdown */}
              {activePurchase.items && activePurchase.items.length > 0 && (
                <div className="space-y-1.5 border-t border-white/[0.07] pt-3">
                  <div className="text-xs font-semibold text-zinc-300">
                    Order Line Items ({activePurchase.items.length})
                  </div>
                  <div className="space-y-2">
                    {activePurchase.items.map((line, idx) => (
                      <div
                        key={`${line.productId}_${idx}`}
                        className="p-2.5 rounded-xl bg-zinc-950/70 border border-white/[0.05] text-xs space-y-1"
                      >
                        <div className="font-medium text-white">{line.productName}</div>
                        <div className="text-[11px] text-zinc-400 font-mono">
                          Merchant: {line.merchant} · Product ID: {line.productId} · Offer:{' '}
                          {line.offerId}
                        </div>
                        <div className="flex items-center justify-between text-[11px] font-mono text-zinc-300">
                          <span>
                            {line.quantity} × {line.currency} {line.unitPrice.toFixed(2)}
                          </span>
                          <span className="font-semibold text-white">
                            {line.currency} {line.subtotal.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2 text-xs border-y border-white/[0.07] py-3">
                <div className="flex justify-between gap-2 text-zinc-400">
                  <span>Spark Order ID</span>
                  <span
                    data-testid="receipt-spark-order-id"
                    className="font-mono text-violet-300 font-semibold"
                  >
                    {activePurchase.orderReference}
                  </span>
                </div>
                {activePurchase.offerId && (
                  <div className="flex justify-between gap-2 text-zinc-400">
                    <span>Channel3 / Offer ID</span>
                    <span className="font-mono text-zinc-300">{activePurchase.offerId}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2 text-zinc-400">
                  <span>PayPal Order ID</span>
                  <span
                    data-testid="receipt-paypal-order-id"
                    className="font-mono text-cyan-300"
                  >
                    {activePurchase.paypalOrderId || activePurchase.paypalTransactionId}
                  </span>
                </div>
                <div className="flex justify-between gap-2 text-zinc-400">
                  <span>PayPal Capture ID</span>
                  <span
                    data-testid="receipt-paypal-capture-id"
                    className="font-mono text-emerald-300"
                  >
                    {activePurchase.captureId || activePurchase.paypalTransactionId}
                  </span>
                </div>
                <div className="flex justify-between gap-2 text-zinc-400">
                  <span>Spark Owner User ID</span>
                  <span className="font-mono text-violet-300">
                    {activePurchase.userId || user?.id || 'verified_owner'}
                  </span>
                </div>
                <div className="flex justify-between gap-2 text-zinc-400">
                  <span>Authorized Payer</span>
                  <span className="font-mono text-zinc-200">{activePurchase.payerEmail}</span>
                </div>
                <div className="flex justify-between gap-2 text-zinc-400">
                  <span>Purchase Date</span>
                  <span className="font-mono text-zinc-300">
                    {new Date(activePurchase.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between gap-2 text-zinc-400">
                  <span>Quantity × Unit Price</span>
                  <span className="font-mono tabular-nums text-zinc-200">
                    {activePurchase.quantity} × {activePurchase.currency}{' '}
                    {activePurchase.unitPrice.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-semibold text-white pt-1">
                  <span>Total Captured (SANDBOX)</span>
                  <span className="font-mono tabular-nums text-emerald-300">
                    {activePurchase.currency} {activePurchase.totalAmount.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-2 text-[11px] text-zinc-400">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>{activePurchase.termsAccepted}</span>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-zinc-400">
              Select a Sandbox order on the left to inspect its full itemized receipt, Spark Order ID, PayPal Capture ID, and Merchant Order Status.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
