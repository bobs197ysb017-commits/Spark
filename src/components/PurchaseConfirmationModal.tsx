import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Lock,
  Minus,
  Package,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  Tag,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { computeOrderSummary } from '../utils/shoppingLogic';
import type {
  CouponItem,
  PayPalConnectionStatus,
  PayPalSandboxTransaction,
  PurchaseExecutionMode,
  PurchaseRecord,
  RankedProductOffer,
  SandboxBuyerWalletState,
  SandboxOrderLifecycleStatus,
  SandboxPaymentOrderRow,
  UserCartSummary,
} from '../types/spark';
import { ProductArtwork } from './ProductArtwork';
import { buildAuthenticatedHeaders } from '../utils/authClient';

interface PurchaseConfirmationModalProps {
  product?: RankedProductOffer | null;
  cart?: UserCartSummary | null;
  fromCart?: boolean;
  initialQuantity?: number;
  availableCoupons: CouponItem[];
  paypalStatus: PayPalConnectionStatus;
  paypalEmail?: string;
  onConnectPayPal: () => Promise<void>;
  onOpenPayPalSandbox?: () => void;
  onViewMyPurchases?: () => void;
  onUpdateCartQuantity?: (itemId: string, quantity: number) => Promise<void> | void;
  onRemoveCartItem?: (itemId: string) => Promise<void> | void;
  onCartUpdated?: (cart: UserCartSummary) => void;
  onClose: () => void;
  onPurchaseSuccess: (record: PurchaseRecord, updatedCart?: UserCartSummary) => void;
}

export const PurchaseConfirmationModal: React.FC<PurchaseConfirmationModalProps> = ({
  product,
  cart,
  fromCart = false,
  initialQuantity = 1,
  availableCoupons,
  paypalStatus,
  paypalEmail,
  onConnectPayPal,
  onOpenPayPalSandbox,
  onViewMyPurchases,
  onUpdateCartQuantity,
  onRemoveCartItem,
  onCartUpdated,
  onClose,
  onPurchaseSuccess,
}) => {
  const isCartCheckout = Boolean(fromCart && !product);
  const [quantity, setQuantity] = useState(() =>
    Math.max(1, Math.min(10, Math.floor(Number(initialQuantity) || 1)))
  );
  const [selectedCouponCode, setSelectedCouponCode] = useState<string | null>(
    !isCartCheckout ? product?.bestCoupon?.code || null : null
  );
  const [executionMode, setExecutionMode] =
    useState<PurchaseExecutionMode>('SANDBOX_SIMULATION');
  const [userConfirmedTerms, setUserConfirmedTerms] = useState(false);

  // 6-Step Autonomous Purchasing Lifecycle State
  const [workflowStep, setWorkflowStep] = useState<
    | 'preview'
    | 'preparing'
    | 'awaiting_paypal_approval'
    | 'capturing'
    | 'completed'
    | 'failed'
  >('preview');

  const [buyerWallet, setBuyerWallet] = useState<SandboxBuyerWalletState | null>(null);
  const [orderRow, setOrderRow] = useState<SandboxPaymentOrderRow | null>(null);
  const [authorizationHash, setAuthorizationHash] = useState<string | null>(null);
  const [paypalOrderId, setPaypalOrderId] = useState<string | null>(null);
  const [approvalUrl, setApprovalUrl] = useState<string | null>(null);
  const [activeTransaction, setActiveTransaction] =
    useState<PayPalSandboxTransaction | null>(null);
  const [completedPurchase, setCompletedPurchase] = useState<PurchaseRecord | null>(null);
  const [agentSummaryMessage, setAgentSummaryMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedCoupon = useMemo(
    () => availableCoupons.find((c) => c.code === selectedCouponCode) || null,
    [availableCoupons, selectedCouponCode]
  );

  const singleSummary = useMemo(() => {
    if (!product) return null;
    return computeOrderSummary(product, quantity, selectedCoupon);
  }, [product, quantity, selectedCoupon]);

  const sandboxTotalPreview = useMemo(() => {
    if (isCartCheckout) {
      const items = cart?.items || [];
      const subtotal = items.length > 0 ? cart!.subtotal : completedPurchase?.subtotal ?? orderRow?.amount ?? 0;
      const discount = items.length > 0 ? cart?.verifiedDiscountTotal || 0 : completedPurchase?.discountAmount ?? 0;
      const shipping = cart && cart.shippingCost !== null ? cart.shippingCost : 0;
      const tax = cart && cart.taxAmount !== null ? cart.taxAmount : 0;
      const total =
        items.length > 0 && typeof cart?.finalPayableTotal === 'number'
          ? cart.finalPayableTotal
          : Math.max(0, Number((subtotal - discount + shipping + tax).toFixed(2)));
      return {
        unitPrice: items[0]?.unitPrice ?? completedPurchase?.unitPrice ?? 0,
        subtotal,
        discount,
        shipping,
        shippingStatus: cart?.shippingStatus || completedPurchase?.shippingStatus || 'unknown',
        tax,
        taxStatus: cart?.taxStatus || completedPurchase?.taxStatus || 'unknown',
        total,
        currency: cart?.currency || completedPurchase?.currency || orderRow?.currency || 'USD',
        hasVerifiedUnitPrice: (items.length > 0 && subtotal > 0) || Boolean(completedPurchase || orderRow),
        itemCount: items.length > 0 ? cart!.itemCount : completedPurchase?.quantity ?? orderRow?.quantity ?? 1,
        lineItemCount: items.length > 0 ? items.length : completedPurchase?.items?.length ?? 1,
        primaryName:
          items.length === 1
            ? items[0].productName
            : items.length > 1
              ? `${items[0].productName} + ${items.length - 1} more item(s)`
              : completedPurchase?.productName || orderRow?.product_name || 'Spark Sandbox Cart Order',
        primaryMerchant:
          items.length === 0
            ? completedPurchase?.merchant || orderRow?.merchant_id || 'Sandbox Merchant'
            : new Set(items.map((i) => i.merchant)).size === 1
              ? items[0].merchant
              : `${items[0].merchant} + ${new Set(items.map((i) => i.merchant)).size - 1} more`,
      };
    }

    const unit = product?.price ?? 0;
    const subtotal = Number((unit * quantity).toFixed(2));
    const discount = singleSummary?.couponDiscount || 0;
    const discountedSubtotal = Math.max(0, Number((subtotal - discount).toFixed(2)));
    const shipping =
      singleSummary && singleSummary.shippingCost !== null ? singleSummary.shippingCost : 0;
    const tax =
      singleSummary && singleSummary.estimatedTax !== null ? singleSummary.estimatedTax : 0;
    const total = Number((discountedSubtotal + shipping + tax).toFixed(2));
    return {
      unitPrice: unit,
      subtotal,
      discount,
      shipping,
      shippingStatus: product?.shippingStatus || 'unknown',
      tax,
      taxStatus: product?.taxStatus || 'unknown',
      total,
      currency: singleSummary?.currency || product?.currency || 'USD',
      hasVerifiedUnitPrice: Boolean(
        product && product.price !== null && product.price > 0 && product.priceStatus === 'verified'
      ),
      itemCount: quantity,
      lineItemCount: 1,
      primaryName: product?.name || 'Selected Product',
      primaryMerchant: product?.merchant || 'Merchant',
    };
  }, [isCartCheckout, cart, product, quantity, singleSummary]);

  const fetchBuyerWallet = useCallback(async () => {
    try {
      const res = await fetch('/api/paypal/sandbox/database', {
        headers: buildAuthenticatedHeaders({ method: 'GET' }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.buyerWallet) {
        setBuyerWallet(data.buyerWallet);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchBuyerWallet();
  }, [fetchBuyerWallet]);

  // Any external change to the selected product, initial quantity, or cart revision/total invalidates previous consent
  useEffect(() => {
    if (!isCartCheckout && initialQuantity) {
      setQuantity(Math.max(1, Math.min(10, Math.floor(Number(initialQuantity) || 1))));
    }
    setUserConfirmedTerms(false);
  }, [product?.id, initialQuantity, isCartCheckout, cart?.revision, cart?.finalPayableTotal]);

  const resetAuthorizationFlow = () => {
    setUserConfirmedTerms(false);
    setOrderRow(null);
    setAuthorizationHash(null);
    setPaypalOrderId(null);
    setApprovalUrl(null);
    setActiveTransaction(null);
    setCompletedPurchase(null);
    setAgentSummaryMessage(null);
    setErrorMessage(null);
    setWorkflowStep('preview');
  };

  const handleQuantityChange = (delta: number) => {
    setQuantity((prev) => Math.max(1, Math.min(10, prev + delta)));
    resetAuthorizationFlow();
  };

  const handleCouponChange = (code: string | null) => {
    setSelectedCouponCode(code);
    resetAuthorizationFlow();
  };

  const handleModeChange = (mode: PurchaseExecutionMode) => {
    setExecutionMode(mode);
    resetAuthorizationFlow();
  };

  const formatShippingDisclosure = () => {
    if (sandboxTotalPreview.shippingStatus === 'unknown') {
      return executionMode === 'SANDBOX_SIMULATION'
        ? `Unavailable from merchant — ${sandboxTotalPreview.currency} 0.00 in Sandbox`
        : 'Unavailable from merchant (calculated at merchant checkout)';
    }
    if (sandboxTotalPreview.shippingStatus === 'free') {
      return `Free Shipping (${sandboxTotalPreview.currency} 0.00)`;
    }
    if (sandboxTotalPreview.shippingStatus === 'estimated') {
      return `Estimated (${sandboxTotalPreview.currency} ${sandboxTotalPreview.shipping.toFixed(2)})`;
    }
    return `${sandboxTotalPreview.currency} ${sandboxTotalPreview.shipping.toFixed(2)}`;
  };

  const formatTaxDisclosure = () => {
    if (sandboxTotalPreview.taxStatus === 'unknown') {
      return executionMode === 'SANDBOX_SIMULATION'
        ? `Unavailable from merchant — ${sandboxTotalPreview.currency} 0.00 in Sandbox`
        : 'Unavailable from merchant (calculated at merchant checkout)';
    }
    if (sandboxTotalPreview.taxStatus === 'estimated') {
      return `Estimated (${sandboxTotalPreview.currency} ${sandboxTotalPreview.tax.toFixed(2)})`;
    }
    return `${sandboxTotalPreview.currency} ${sandboxTotalPreview.tax.toFixed(2)}`;
  };

  // STEP 2 -> STEP 3 -> STEP 4: Prepare Order, Record Explicit User Authorization, and Create PayPal Sandbox Order
  const handlePrepareAuthorizeAndCreateOrder = async () => {
    if (!sandboxTotalPreview.hasVerifiedUnitPrice) {
      setErrorMessage('Cannot execute Sandbox purchase: Product unit price is not verified.');
      return;
    }
    if (!userConfirmedTerms) {
      setErrorMessage(
        'Explicit user confirmation is required before Spark can create a PayPal Sandbox order.'
      );
      return;
    }

    setErrorMessage(null);
    setWorkflowStep('preparing');

    const correlationId = `corr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const flowStartMs = Date.now();

    const resolvedOfferId =
      !isCartCheckout && product
        ? String(
            product.specs?.['Channel3 Offer ID'] ||
              product.specs?.['Offer ID'] ||
              `ofr_${product.sourceId}_${product.id}`
          )
        : undefined;

    console.info('[PAYPAL_DIAGNOSTIC]', {
      event: 'PAYMENT_TOOL_STARTED',
      correlationId,
      itemId: isCartCheckout ? '__SPARK_USER_CART__' : product?.id,
      fromCart: isCartCheckout,
      quantity: sandboxTotalPreview.itemCount,
      currency: sandboxTotalPreview.currency,
      executionMode,
    });

    const parseJsonSafely = async (res: Response) => {
      try {
        return await res.json();
      } catch {
        return null;
      }
    };

    try {
      // 1. Prepare Order (DRAFT -> AWAITING_USER_CONFIRMATION)
      const prepRes = await fetch('/api/paypal/agent/prepare-order', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({
          method: 'POST',
          extraHeaders: { 'x-correlation-id': correlationId },
        }),
        body: JSON.stringify({
          itemId: isCartCheckout ? '__SPARK_USER_CART__' : product?.id,
          fromCart: isCartCheckout,
          offerId: resolvedOfferId,
          product: !isCartCheckout ? product : undefined,
          quantity: isCartCheckout ? sandboxTotalPreview.itemCount : quantity,
          currency: sandboxTotalPreview.currency,
          couponCode: !isCartCheckout ? selectedCouponCode : undefined,
          executionMode,
        }),
      });
      const prepData = await parseJsonSafely(prepRes);
      if (!prepRes.ok || !prepData?.ok || !prepData?.orderRow) {
        const errMsg =
          prepData?.message ||
          prepData?.error ||
          `Failed to prepare purchase order (HTTP ${prepRes.status}).`;
        setWorkflowStep('failed');
        setErrorMessage(errMsg);
        return;
      }

      const preparedOrder: SandboxPaymentOrderRow = prepData.orderRow;
      setOrderRow(preparedOrder);
      if (prepData.buyerWallet) {
        setBuyerWallet(prepData.buyerWallet);
      }

      // 2. Record Explicit One-Time User Authorization
      const authRes = await fetch('/api/paypal/agent/authorize-order', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({
          method: 'POST',
          extraHeaders: { 'x-correlation-id': correlationId },
        }),
        body: JSON.stringify({
          orderId: preparedOrder.id,
          actor: 'user',
          confirmedAmount: preparedOrder.amount,
          confirmedCurrency: preparedOrder.currency,
          confirmedProductId: preparedOrder.product_id,
          confirmedMerchantId: preparedOrder.merchant_id,
        }),
      });
      const authData = await parseJsonSafely(authRes);
      if (!authRes.ok || !authData?.ok || !authData?.authorization) {
        const errMsg =
          authData?.message ||
          authData?.error ||
          `Explicit user authorization validation failed (HTTP ${authRes.status}).`;
        setWorkflowStep('failed');
        setErrorMessage(errMsg);
        return;
      }

      const oneTimeHash: string = authData.authorization.authorizationHash;
      setAuthorizationHash(oneTimeHash);
      if (authData.orderRow) {
        setOrderRow(authData.orderRow);
      }

      // 3. Execute Authorized Order on PayPal Sandbox (`POST /v2/checkout/orders` with `intent = CAPTURE`)
      const returnUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}${window.location.pathname}?paypal_sandbox_return=1&sparkOrderId=${encodeURIComponent(preparedOrder.id)}`
          : undefined;
      const cancelUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}${window.location.pathname}?paypal_sandbox_cancel=1&sparkOrderId=${encodeURIComponent(preparedOrder.id)}`
          : undefined;

      const execRes = await fetch('/api/paypal/agent/execute-order', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({
          method: 'POST',
          extraHeaders: { 'x-correlation-id': correlationId },
        }),
        body: JSON.stringify({
          orderId: preparedOrder.id,
          authorizationHash: oneTimeHash,
          returnUrl,
          cancelUrl,
        }),
      });
      const execData = await parseJsonSafely(execRes);
      if (!execRes.ok || !execData?.ok || !execData?.transaction) {
        const errMsg =
          execData?.message ||
          execData?.error ||
          `PayPal Sandbox order creation failed (HTTP ${execRes.status}).`;
        setWorkflowStep('failed');
        setErrorMessage(errMsg);
        return;
      }

      const resolvedApprovalUrl =
        execData.approvalUrl || execData.transaction.approvalUrl || null;
      console.info('[PAYPAL_DIAGNOSTIC]', {
        event: 'APPROVAL_URL_GENERATED',
        correlationId,
        paypalOrderId: execData.transaction.paypalOrderId,
        approvalUrl: resolvedApprovalUrl,
        durationMs: Date.now() - flowStartMs,
      });

      setPaypalOrderId(execData.transaction.paypalOrderId);
      setApprovalUrl(resolvedApprovalUrl);
      setActiveTransaction(execData.transaction);
      if (execData.orderRow) setOrderRow(execData.orderRow);
      if (execData.buyerWallet) setBuyerWallet(execData.buyerWallet);
      setWorkflowStep('awaiting_paypal_approval');
    } catch {
      setWorkflowStep('failed');
      setErrorMessage('Network error while communicating with Spark PayPal Sandbox backend.');
    }
  };

  // STEP 5 & 6: Retrieve Order Status, Confirm APPROVED & Exact Match, then Capture Payment on Server (`POST /v2/checkout/orders/{id}/capture`)
  const handleCaptureAuthorizedSandboxPayment = async () => {
    if (!paypalOrderId && !orderRow?.id) return;
    if (workflowStep === 'capturing' || workflowStep === 'completed') return;
    setErrorMessage(null);
    setWorkflowStep('capturing');

    const targetId = orderRow?.id || paypalOrderId!;
    const expectedAmount = orderRow?.amount ?? sandboxTotalPreview.total;
    const expectedCurrency = orderRow?.currency ?? sandboxTotalPreview.currency;

    try {
      await fetch(`/api/paypal/sandbox/orders/${encodeURIComponent(targetId)}/approve`, {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        body: JSON.stringify({
          payerEmail: buyerWallet?.buyerEmail || paypalEmail,
          payerId: buyerWallet?.buyerAccountId,
        }),
      });

      // Step 5a: Retrieve actual PayPal order status from the server and verify APPROVED state, amount, and currency before Capture
      const statusRes = await fetch(`/api/paypal/sandbox/orders/${encodeURIComponent(targetId)}`, {
        method: 'GET',
        headers: buildAuthenticatedHeaders({ method: 'GET' }),
      });
      const statusData = await statusRes.json().catch(() => null);
      const serverTx = statusData?.transaction;
      if (
        !statusRes.ok ||
        !statusData?.ok ||
        !serverTx ||
        (serverTx.status !== 'APPROVED' && serverTx.status !== 'COMPLETED')
      ) {
        setWorkflowStep('failed');
        setErrorMessage(
          statusData?.message ||
            'Cannot capture payment: PayPal Sandbox order has not been approved by the buyer (status must be APPROVED).'
        );
        return;
      }

      if (
        Math.abs(Number(serverTx.amount) - expectedAmount) > 0.01 ||
        serverTx.currency !== expectedCurrency
      ) {
        setWorkflowStep('failed');
        setErrorMessage(
          `Order verification mismatch: Approved order amount (${serverTx.currency} ${Number(
            serverTx.amount
          ).toFixed(2)}) does not match confirmed checkout total (${expectedCurrency} ${expectedAmount.toFixed(
            2
          )}).`
        );
        return;
      }

      const capRes = await fetch('/api/paypal/agent/capture-order', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        body: JSON.stringify({
          orderIdOrPayPalId: targetId,
          expectedAmount,
          expectedCurrency,
        }),
      });
      const capData = await capRes.json();

      if (capData.buyerWallet) {
        setBuyerWallet(capData.buyerWallet);
      }
      if (capData.transaction) {
        setActiveTransaction(capData.transaction);
      }
      if (capData.cart && onCartUpdated) {
        onCartUpdated(capData.cart);
      }

      if (!capRes.ok || !capData.ok || !capData.purchaseRecord) {
        setWorkflowStep('failed');
        setErrorMessage(
          capData.message || capData.error || 'PayPal Sandbox capture failed.'
        );
        return;
      }

      setCompletedPurchase(capData.purchaseRecord);
      setAgentSummaryMessage(
        capData.agentNotification?.agentSummaryMessage ||
          capData.agentNotification?.summaryMessage ||
          capData.message
      );
      setWorkflowStep('completed');
      onPurchaseSuccess(capData.purchaseRecord, capData.cart);
    } catch {
      setWorkflowStep('failed');
      setErrorMessage('Unable to verify PayPal Sandbox payment capture with server.');
    }
  };

  const handleCancelSandboxOrder = async () => {
    const targetId = orderRow?.id || paypalOrderId;
    if (targetId) {
      try {
        await fetch(`/api/paypal/sandbox/orders/${encodeURIComponent(targetId)}/cancel`, {
          method: 'POST',
          headers: buildAuthenticatedHeaders({ method: 'POST' }),
          body: JSON.stringify({
            reason: 'User cancelled PayPal Sandbox approval in Purchase Confirmation modal.',
          }),
        });
      } catch {
        // ignore
      }
    }
    resetAuthorizationFlow();
  };

  const currentLifecycleStatus: SandboxOrderLifecycleStatus =
    activeTransaction?.lifecycleStatus ||
    orderRow?.status ||
    (workflowStep === 'completed'
      ? 'COMPLETED'
      : workflowStep === 'failed'
      ? 'FAILED'
      : 'DRAFT');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="purchase-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
    >
      <div className="relative w-full max-w-2xl rounded-3xl bg-[#121217] border border-white/[0.1] text-[#FAFAFA] p-6 sm:p-7 shadow-2xl max-h-[92vh] overflow-y-auto">
        {/* Top Sandbox Isolation Header */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                data-testid="sandbox-environment-badge"
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-[11px] font-mono font-bold text-amber-300"
              >
                <Lock className="w-3 h-3" />
                <span>SANDBOX</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-[#0070BA]/25 border border-[#0070BA]/50 text-[11px] font-mono font-semibold text-cyan-300">
                <span>SANDBOX ORDER · TEST TRANSACTION</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-zinc-900 border border-white/[0.1] text-[11px] font-mono text-violet-300">
                PayPal Sandbox (api-m.sandbox.paypal.com)
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-mono font-semibold text-emerald-300">
                Status: {currentLifecycleStatus}
              </span>
            </div>
            <h2 id="purchase-modal-title" className="text-xl font-semibold tracking-tight">
              {workflowStep === 'completed'
                ? 'Spark Sandbox Order Confirmation'
                : isCartCheckout
                ? `Spark Buy · Sandbox Cart Checkout (${sandboxTotalPreview.itemCount} ${sandboxTotalPreview.itemCount === 1 ? 'item' : 'items'})`
                : 'Spark Buy · PayPal Sandbox Checkout'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close purchase confirmation"
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Simulated PayPal Sandbox Buyer Balance Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-2xl bg-zinc-950/90 border border-white/[0.08] mb-5">
          <div>
            <div className="text-[11px] text-zinc-400 flex items-center gap-1">
              <Wallet className="w-3.5 h-3.5 text-cyan-400" />
              <span>Sandbox Buyer Balance</span>
            </div>
            <div
              data-testid="modal-sandbox-buyer-balance"
              className="text-base font-mono font-semibold text-emerald-400 mt-0.5"
            >
              {buyerWallet
                ? `${buyerWallet.currency} ${buyerWallet.availableBalance.toFixed(2)}`
                : 'USD 500.00'}
            </div>
            <div className="text-[10px] text-zinc-500 font-mono truncate">
              Buyer: {buyerWallet?.buyerEmail || paypalEmail || 'sb-buyer@personal.example.com'}
            </div>
          </div>

          <div>
            <div className="text-[11px] text-zinc-400">Checkout Total</div>
            <div
              data-testid="modal-checkout-total"
              className="text-base font-mono font-semibold text-white mt-0.5"
            >
              {sandboxTotalPreview.currency}{' '}
              {(orderRow?.amount ?? sandboxTotalPreview.total).toFixed(2)}
            </div>
            <div className="text-[10px] text-zinc-500 font-mono">
              Payment Method: PayPal Sandbox
            </div>
          </div>

          <div>
            <div className="text-[11px] text-zinc-400">Spark / PayPal Ref</div>
            <div className="text-xs font-mono font-semibold text-cyan-300 mt-1 truncate">
              {completedPurchase?.orderReference ||
                activeTransaction?.captureId ||
                paypalOrderId ||
                orderRow?.id ||
                'Awaiting Confirmation'}
            </div>
            <div className="text-[10px] text-zinc-500 font-mono">
              {activeTransaction?.captureId ? 'Verified Capture ID' : 'Sandbox Order Ref'}
            </div>
          </div>
        </div>

        {/* Ecommerce Checkout Mode Selector (Mode A vs Mode B) */}
        {workflowStep !== 'completed' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-5">
            <button
              type="button"
              onClick={() => handleModeChange('SANDBOX_SIMULATION')}
              className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                executionMode === 'SANDBOX_SIMULATION'
                  ? 'bg-violet-600/15 border-violet-500/50 text-white'
                  : 'bg-zinc-900/60 border-white/[0.07] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <div className="text-xs font-semibold flex items-center justify-between">
                <span>Mode A · PayPal Sandbox Order</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet-500/20 text-violet-300">
                  SANDBOX
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                Executes a real PayPal Sandbox transaction (<code className="font-mono">POST /v2/checkout/orders</code> + <code className="font-mono">/capture</code>) and creates an internal Spark Sandbox Order even without merchant API integration.
              </p>
            </button>

            <button
              type="button"
              onClick={() => handleModeChange('MERCHANT_CHECKOUT')}
              className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                executionMode === 'MERCHANT_CHECKOUT'
                  ? 'bg-cyan-600/15 border-cyan-500/50 text-white'
                  : 'bg-zinc-900/60 border-white/[0.07] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <div className="text-xs font-semibold flex items-center justify-between">
                <span>Mode B · Direct Merchant Link</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300">
                  EXTERNAL
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                Opens the external merchant&rsquo;s canonical product page directly in a new tab without creating a Spark Sandbox order.
              </p>
            </button>
          </div>
        )}

        {/* Selected Product(s) & Channel3 Offer Metadata */}
        {workflowStep !== 'completed' &&
          (isCartCheckout && cart ? (
            <div className="rounded-2xl bg-zinc-900/80 border border-white/[0.07] p-4 mb-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <ShoppingCart className="w-4 h-4 text-violet-400" />
                  <span>Selected Cart Products ({cart.itemCount} total units)</span>
                </div>
                <span className="text-[11px] font-mono text-zinc-400">
                  {cart.items.length} unique {cart.items.length === 1 ? 'offer' : 'offers'}
                </span>
              </div>
              <div className="space-y-2.5 max-h-52 overflow-y-auto pr-1">
                {cart.items.map((item) => (
                  <div
                    key={item.itemId}
                    data-testid={`checkout-cart-item-${item.productId}`}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-zinc-950/70 border border-white/[0.05]"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <ProductArtwork
                        imageUrl={item.imageUrl}
                        sourceName={item.sourceId}
                        name={item.productName}
                        className="w-12 h-12 rounded-lg shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-white truncate">
                          {item.productName}
                        </div>
                        <div className="text-[11px] text-zinc-400 truncate">
                          Merchant: <span className="text-zinc-200">{item.merchant}</span> · ID:{' '}
                          <span className="font-mono text-zinc-300">{item.productId}</span> · Offer:{' '}
                          <span className="font-mono text-violet-300">{item.offerId}</span>
                        </div>
                        {item.productUrl && (
                          <a
                            href={item.productUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-cyan-400 hover:underline mt-0.5"
                          >
                            <span>Merchant product link</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      {workflowStep === 'preview' && onUpdateCartQuantity ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-label={`Decrease quantity for ${item.productName}`}
                            onClick={() => {
                              onUpdateCartQuantity(item.itemId, item.quantity - 1);
                              resetAuthorizationFlow();
                            }}
                            className="w-6 h-6 rounded-md bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-white text-xs cursor-pointer"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="w-5 text-center text-xs font-mono font-semibold">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            aria-label={`Increase quantity for ${item.productName}`}
                            onClick={() => {
                              onUpdateCartQuantity(item.itemId, item.quantity + 1);
                              resetAuthorizationFlow();
                            }}
                            className="w-6 h-6 rounded-md bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-white text-xs cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs font-mono text-zinc-300">Qty: {item.quantity}</span>
                      )}

                      <div className="text-right min-w-[78px]">
                        <div className="text-xs font-mono font-semibold text-white">
                          {item.currency} {item.subtotal.toFixed(2)}
                        </div>
                        <div className="text-[10px] font-mono text-zinc-400">
                          {item.currency} {item.unitPrice.toFixed(2)} ea
                        </div>
                      </div>

                      {workflowStep === 'preview' && onRemoveCartItem && (
                        <button
                          type="button"
                          aria-label={`Remove ${item.productName}`}
                          onClick={() => {
                            onRemoveCartItem(item.itemId);
                            resetAuthorizationFlow();
                          }}
                          className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : product ? (
            <div className="flex items-center gap-4 p-4 rounded-2xl bg-zinc-900/80 border border-white/[0.06] mb-4">
              <ProductArtwork
                imageUrl={product.imageUrl}
                sourceName={product.sourceName}
                name={product.name}
                className="w-18 h-16 rounded-xl shrink-0"
              />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-white truncate">{product.name}</h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Merchant: <span className="text-zinc-200 font-medium">{product.merchant}</span> ·{' '}
                  ID: <span className="font-mono text-[11px] text-zinc-300">{product.id}</span> ·{' '}
                  Offer:{' '}
                  <span className="font-mono text-[11px] text-violet-300">
                    {product.specs?.['Channel3 Offer ID'] ||
                      product.specs?.['Offer ID'] ||
                      `ofr_${product.sourceId}_${product.id}`}
                  </span>
                </p>
                {product.canonicalUrl && (
                  <a
                    href={product.canonicalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:underline mt-1"
                  >
                    <span>Open canonical merchant listing</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          ) : null)}

        {/* Single-Item Quantity & Coupon Controls */}
        {workflowStep === 'preview' && !isCartCheckout && product && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mb-4">
            <div className="p-3 rounded-2xl bg-zinc-900/60 border border-white/[0.06] flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-300">Quantity</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  onClick={() => handleQuantityChange(-1)}
                  disabled={quantity <= 1}
                  className="w-7 h-7 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 flex items-center justify-center text-white transition-colors cursor-pointer"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span
                  data-testid="checkout-quantity-value"
                  className="w-6 text-center text-sm font-mono tabular-nums font-semibold"
                >
                  {quantity}
                </span>
                <button
                  type="button"
                  aria-label="Increase quantity"
                  onClick={() => handleQuantityChange(1)}
                  className="w-7 h-7 rounded-lg bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-white transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-zinc-900/60 border border-white/[0.06] flex flex-col justify-center">
              <label
                htmlFor="coupon-select"
                className="text-xs font-medium text-zinc-300 mb-1 flex items-center gap-1.5"
              >
                <Tag className="w-3.5 h-3.5 text-violet-400" />
                <span>Verified Coupon</span>
              </label>
              <select
                id="coupon-select"
                value={selectedCouponCode || ''}
                onChange={(e) => handleCouponChange(e.target.value || null)}
                className="bg-transparent text-xs font-mono text-white focus:outline-none cursor-pointer"
              >
                <option value="" className="bg-zinc-900">
                  {availableCoupons.length === 0
                    ? 'Coupon validity unknown. (0 verified)'
                    : 'No coupon applied'}
                </option>
                {availableCoupons.map((cpn) => (
                  <option key={cpn.id} value={cpn.code} className="bg-zinc-900">
                    {cpn.code} —{' '}
                    {cpn.discountType === 'percentage'
                      ? `${cpn.discountValue}% off`
                      : `$${cpn.discountValue} off`}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Itemized Order Details & Honest Cost Disclosures */}
        {workflowStep !== 'completed' && (
          <div className="p-4 rounded-2xl bg-zinc-900/90 border border-white/[0.07] space-y-2 text-xs mb-4">
            <div className="flex items-center justify-between text-zinc-300">
              <span>
                {isCartCheckout
                  ? `Products Subtotal (${sandboxTotalPreview.itemCount} ${sandboxTotalPreview.itemCount === 1 ? 'unit' : 'units'})`
                  : `Unit Price (${quantity} × ${sandboxTotalPreview.currency} ${sandboxTotalPreview.unitPrice.toFixed(2)})`}
              </span>
              <span className="font-mono tabular-nums">
                {sandboxTotalPreview.hasVerifiedUnitPrice
                  ? `${sandboxTotalPreview.currency} ${sandboxTotalPreview.subtotal.toFixed(2)}`
                  : 'Price could not be verified.'}
              </span>
            </div>

            {sandboxTotalPreview.discount > 0 && (
              <div className="flex items-center justify-between text-emerald-400">
                <span>
                  Verified coupon (
                  {isCartCheckout
                    ? cart?.appliedCouponCode || 'APPLIED'
                    : singleSummary?.couponCode}
                  )
                </span>
                <span className="font-mono tabular-nums">
                  -{sandboxTotalPreview.currency} {sandboxTotalPreview.discount.toFixed(2)}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between text-zinc-400">
              <span>Shipping</span>
              <span data-testid="checkout-shipping-disclosure" className="font-mono tabular-nums">
                {formatShippingDisclosure()}
              </span>
            </div>

            <div className="flex items-center justify-between text-zinc-400">
              <span>Taxes</span>
              <span data-testid="checkout-tax-disclosure" className="font-mono tabular-nums">
                {formatTaxDisclosure()}
              </span>
            </div>

            <div className="flex items-center justify-between text-zinc-400">
              <span>Other Known Fees</span>
              <span data-testid="checkout-fees-disclosure" className="font-mono tabular-nums">
                {sandboxTotalPreview.currency} 0.00 (No additional platform fees)
              </span>
            </div>

            {(sandboxTotalPreview.shippingStatus === 'unknown' ||
              sandboxTotalPreview.taxStatus === 'unknown') && (
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-200 leading-relaxed">
                <strong>Cost Disclosure:</strong> Live merchant shipping and regional tax rates were not provided in the product feed. Spark never invents shipping fees or taxes; your PayPal Sandbox test charge includes only the verified product price ({sandboxTotalPreview.currency} {(orderRow?.amount ?? sandboxTotalPreview.total).toFixed(2)}).
              </div>
            )}

            <div className="pt-2 border-t border-white/[0.08] flex items-center justify-between text-sm font-semibold text-white">
              <span>Backend-Validated Total Amount</span>
              <span className="font-mono tabular-nums text-violet-300">
                {sandboxTotalPreview.currency}{' '}
                {(orderRow?.amount ?? sandboxTotalPreview.total).toFixed(2)}
              </span>
            </div>
          </div>
        )}

        {/* STEP 1-3: Preview & Explicit User Authorization */}
        {workflowStep === 'preview' && executionMode === 'SANDBOX_SIMULATION' && (
          <label className="flex items-start gap-3 p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.08] cursor-pointer mb-4">
            <input
              type="checkbox"
              data-testid="explicit-user-confirmation-checkbox"
              checked={userConfirmedTerms}
              onChange={(e) => setUserConfirmedTerms(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded accent-violet-500"
            />
            <span className="text-xs text-zinc-200 leading-relaxed">
              <strong>Explicit User Confirmation:</strong> I confirm this{' '}
              <span className="text-amber-300 font-mono font-semibold">SANDBOX ORDER</span> for{' '}
              <strong>
                {isCartCheckout
                  ? `${sandboxTotalPreview.itemCount} item(s) (${sandboxTotalPreview.primaryName})`
                  : `${quantity} × ${product?.name}`}
              </strong>{' '}
              ({sandboxTotalPreview.primaryMerchant}) in the exact backend-verified amount of{' '}
              <strong className="font-mono text-violet-300">
                {sandboxTotalPreview.currency} {sandboxTotalPreview.total.toFixed(2)}
              </strong>{' '}
              via PayPal Sandbox (<code className="font-mono">intent=CAPTURE</code>). I understand no real merchant order or shipment is placed.
            </span>
          </label>
        )}

        {/* STEP 4: PayPal Sandbox Buyer Approval Screen */}
        {workflowStep === 'awaiting_paypal_approval' && (
          <div className="p-4 rounded-2xl bg-[#003087]/25 border border-[#0070BA]/50 space-y-3 mb-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-cyan-300 flex items-center gap-2">
                  <span>PayPal Sandbox Buyer Approval Required</span>
                  <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-[10px] font-mono text-amber-300">
                    SANDBOX
                  </span>
                </div>
                <div className="text-[11px] text-zinc-300 font-mono mt-0.5">
                  PayPal Order ID: <strong className="text-white">{paypalOrderId}</strong> · Spark Order:{' '}
                  <span className="text-violet-300">{orderRow?.id}</span>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-[#0070BA]/30 text-xs font-mono font-semibold text-white">
                {sandboxTotalPreview.currency}{' '}
                {(orderRow?.amount ?? sandboxTotalPreview.total).toFixed(2)}
              </span>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              Your PayPal Sandbox order (<code className="font-mono">intent = CAPTURE</code>) has been created on{' '}
              <code className="font-mono text-cyan-300">api-m.sandbox.paypal.com</code>. You can open the PayPal Sandbox approval URL or click{' '}
              <strong>Approve &amp; Capture Sandbox Payment</strong> below to verify capture on the backend and create your internal Spark Sandbox Order.
            </p>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              {approvalUrl && (
                <a
                  href={approvalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="paypal-sandbox-approval-link"
                  className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/15 text-xs font-medium text-cyan-300 inline-flex items-center gap-1.5"
                >
                  <span>Redirect / Open PayPal Sandbox Checkout</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}

              <div className="flex items-center gap-2.5 ml-auto">
                <button
                  type="button"
                  onClick={handleCancelSandboxOrder}
                  className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 cursor-pointer"
                >
                  Cancel Order
                </button>
                <button
                  type="button"
                  data-testid="approve-and-capture-sandbox-btn"
                  onClick={handleCaptureAuthorizedSandboxPayment}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Approve &amp; Capture Sandbox Payment</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 4/5: Processing Spinner */}
        {(workflowStep === 'preparing' || workflowStep === 'capturing') && (
          <div className="p-5 rounded-2xl bg-zinc-900/90 border border-violet-500/30 flex items-center gap-3.5 mb-4">
            <RefreshCw className="w-5 h-5 text-violet-400 animate-spin shrink-0" />
            <div className="text-xs">
              <div className="font-semibold text-white">
                {workflowStep === 'preparing'
                  ? 'Validating Confirmation & Creating PayPal Sandbox Order (POST /v2/checkout/orders)...'
                  : 'Verifying PayPal Sandbox Capture & Creating Internal Spark Order (POST /v2/checkout/orders/{id}/capture)...'}
              </div>
              <div className="text-zinc-400 mt-0.5">
                Communicating with https://api-m.sandbox.paypal.com · Duplicate-capture lock active
              </div>
            </div>
          </div>
        )}

        {/* STEP 6: Complete Sandbox Order Confirmation Screen */}
        {workflowStep === 'completed' && completedPurchase && (
          <div
            data-testid="sandbox-order-confirmation"
            className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/35 space-y-3.5 mb-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-emerald-300 font-semibold text-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span>Spark Sandbox Order Confirmed</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="px-2.5 py-0.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-[11px] font-mono font-bold text-amber-300">
                  {completedPurchase.orderTypeLabel || 'SANDBOX ORDER'}
                </span>
                <span className="px-2.5 py-0.5 rounded-lg bg-emerald-500/20 text-[11px] font-mono text-emerald-200">
                  SANDBOX
                </span>
              </div>
            </div>

            {/* Explicit Separation: Payment Status vs Merchant Order Status */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="p-3 rounded-xl bg-zinc-950/90 border border-emerald-500/30">
                <div className="text-[10px] uppercase tracking-wider font-mono text-zinc-400">
                  Payment Status (PayPal Sandbox)
                </div>
                <div
                  data-testid="confirmation-payment-status"
                  className="text-xs font-mono font-semibold text-emerald-300 mt-1 flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>{completedPurchase.paymentStatus || completedPurchase.captureStatus || 'COMPLETED'}</span>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-zinc-950/90 border border-amber-500/30">
                <div className="text-[10px] uppercase tracking-wider font-mono text-zinc-400">
                  Merchant Order Status
                </div>
                <div
                  data-testid="confirmation-merchant-order-status"
                  className="text-xs font-mono font-semibold text-amber-300 mt-1 flex items-center gap-1.5"
                >
                  <Package className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>
                    {completedPurchase.merchantOrderStatus ||
                      'Merchant order not submitted — Sandbox simulation'}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-xl bg-zinc-950/80 border border-white/[0.06] text-[11px] font-mono">
              <div>
                <div className="text-zinc-400">Spark Order ID</div>
                <div
                  data-testid="confirmation-spark-order-id"
                  className="text-violet-300 font-semibold truncate"
                >
                  {completedPurchase.orderReference}
                </div>
              </div>
              <div>
                <div className="text-zinc-400">PayPal Order ID</div>
                <div
                  data-testid="confirmation-paypal-order-id"
                  className="text-cyan-300 font-semibold truncate"
                >
                  {completedPurchase.paypalOrderId}
                </div>
              </div>
              <div>
                <div className="text-zinc-400">PayPal Capture ID</div>
                <div
                  data-testid="confirmation-paypal-capture-id"
                  className="text-emerald-300 font-semibold truncate"
                >
                  {completedPurchase.captureId}
                </div>
              </div>
              <div>
                <div className="text-zinc-400">Total Captured</div>
                <div className="text-white font-semibold">
                  {completedPurchase.currency} {completedPurchase.totalAmount.toFixed(2)}
                </div>
              </div>
            </div>

            {completedPurchase.items && completedPurchase.items.length > 0 && (
              <div className="p-3 rounded-xl bg-zinc-950/70 border border-white/[0.06] space-y-1.5">
                <div className="text-[11px] font-semibold text-zinc-300">
                  Confirmed Order Items ({completedPurchase.quantity} total units)
                </div>
                {completedPurchase.items.map((line, idx) => (
                  <div
                    key={`${line.productId}_${idx}`}
                    className="flex items-center justify-between text-[11px] text-zinc-300 gap-2 py-1 border-b border-white/[0.04] last:border-0"
                  >
                    <div className="truncate">
                      <span className="font-medium text-white">{line.productName}</span> ·{' '}
                      <span className="text-zinc-400">{line.merchant}</span> ·{' '}
                      <span className="font-mono text-zinc-500">Offer: {line.offerId}</span>
                    </div>
                    <div className="font-mono shrink-0">
                      {line.quantity} × {line.currency} {line.unitPrice.toFixed(2)} ={' '}
                      <strong className="text-emerald-300">
                        {line.currency} {line.subtotal.toFixed(2)}
                      </strong>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {agentSummaryMessage && (
              <p className="text-xs text-emerald-200 leading-relaxed">{agentSummaryMessage}</p>
            )}
          </div>
        )}

        {/* Error / Failed State */}
        {errorMessage && (
          <div
            role="alert"
            className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200 mb-4"
          >
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold text-rose-300">
                Sandbox Payment Execution Halted
              </div>
              <div>{errorMessage}</div>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/[0.08]">
          <div className="flex items-center gap-2">
            {onOpenPayPalSandbox && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenPayPalSandbox();
                }}
                className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-xs font-medium text-violet-300 cursor-pointer"
              >
                Open Sandbox Studio
              </button>
            )}
            {paypalStatus !== 'connected' && workflowStep !== 'completed' && (
              <button
                type="button"
                onClick={onConnectPayPal}
                className="px-3.5 py-2 rounded-xl bg-[#0070BA] hover:bg-[#005ea6] text-white text-xs font-medium cursor-pointer"
              >
                Connect Personal PayPal
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5 ml-auto">
            {workflowStep === 'completed' && onViewMyPurchases && (
              <button
                type="button"
                data-testid="view-in-my-purchases-btn"
                onClick={() => {
                  onClose();
                  onViewMyPurchases();
                }}
                className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white cursor-pointer"
              >
                View in My Purchases
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 cursor-pointer"
            >
              {workflowStep === 'completed' ? 'Done' : 'Close'}
            </button>

            {executionMode === 'MERCHANT_CHECKOUT' && product?.canonicalUrl && (
              <a
                href={product.canonicalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold text-white inline-flex items-center gap-1.5"
              >
                <span>Continue to Official Merchant Checkout</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            {executionMode === 'SANDBOX_SIMULATION' &&
              (workflowStep === 'preview' || workflowStep === 'failed') && (
                <button
                  type="button"
                  data-testid="authorize-create-sandbox-order-btn"
                  onClick={handlePrepareAuthorizeAndCreateOrder}
                  disabled={!sandboxTotalPreview.hasVerifiedUnitPrice || !userConfirmedTerms}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 disabled:opacity-40 text-xs font-semibold text-white inline-flex items-center gap-2 transition-all cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>
                    Confirm &amp; Pay with PayPal Sandbox ({sandboxTotalPreview.currency}{' '}
                    {sandboxTotalPreview.total.toFixed(2)})
                  </span>
                </button>
              )}
          </div>
        </div>
      </div>
    </div>
  );
};
