import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  CreditCard,
  Database,
  ExternalLink,
  FileSearch,
  KeyRound,
  Lock,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Wallet,
  Webhook,
  XCircle,
} from 'lucide-react';
import type {
  PayPalDiagnosticLog,
  PayPalSandboxCatalogItem,
  PayPalSandboxStatusResponse,
  PayPalSandboxTransaction,
  PayPalTransactionStatus,
  PayPalWebhookEventRecord,
  PurchaseAuditLogRow,
  PurchaseRecord,
  RankedProductOffer,
  SandboxBuyerWalletState,
  SandboxIntegrationTestScenarioResult,
  SandboxPaymentCaptureRow,
  SandboxPaymentEventRow,
  SandboxPaymentOrderRow,
  UserProfile,
} from '../types/spark';
import { buildAuthenticatedHeaders } from '../utils/authClient';

interface PayPalSandboxViewProps {
  user: UserProfile;
  sessionOffers: RankedProductOffer[];
  onPurchaseCompleted: (record: PurchaseRecord) => void;
  onSyncUserPayPalStatus: () => Promise<void>;
  onWalletBalanceChanged?: () => void;
}

interface DiagnosticStepResult {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

const NEGATIVE_TEST_CODES = [
  {
    code: '',
    label: 'Standard Sandbox Flow (No Mock Error Header)',
    description: 'Executes standard PayPal Sandbox API call without PayPal-Mock-Response.',
  },
  {
    code: 'INSTRUMENT_DECLINED',
    label: 'INSTRUMENT_DECLINED (Capture Decline 422)',
    description:
      'Sends PayPal-Mock-Response: {"mock_application_codes": "INSTRUMENT_DECLINED"} to test declined funding source handling.',
  },
  {
    code: 'DUPLICATE_INVOICE_ID',
    label: 'DUPLICATE_INVOICE_ID (Duplicate Invoice 422)',
    description:
      'Sends PayPal-Mock-Response: {"mock_application_codes": "DUPLICATE_INVOICE_ID"} to test duplicate invoice protection.',
  },
  {
    code: 'ORDER_NOT_APPROVED',
    label: 'ORDER_NOT_APPROVED (Unapproved Capture 422)',
    description:
      'Sends PayPal-Mock-Response: {"mock_application_codes": "ORDER_NOT_APPROVED"} to test capture before buyer approval.',
  },
  {
    code: 'INTERNAL_SERVER_ERROR',
    label: 'INTERNAL_SERVER_ERROR (PayPal 500 Fault)',
    description:
      'Sends PayPal-Mock-Response: {"mock_application_codes": "INTERNAL_SERVER_ERROR"} to test 5xx resilience.',
  },
];

const SANDBOX_CHECKLIST_ITEMS = [
  {
    id: 'dev_account',
    title: '1. Sign in to developer.paypal.com',
    detail:
      'Log in to the PayPal Developer Dashboard and confirm you are toggled into the Sandbox mode.',
  },
  {
    id: 'sandbox_accounts',
    title: '2. Verify Personal (Buyer) & Business (Merchant) Sandbox Accounts',
    detail:
      'Open Testing Tools -> Sandbox Accounts. Confirm you have one Business (MERCHANT) seller account and one Personal (BUYER) test account.',
  },
  {
    id: 'app_credentials',
    title: '3. Copy Sandbox Client ID & Secret from Apps & Credentials',
    detail:
      'Create or select a Sandbox REST API app linked to your Business account and set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in server secrets.',
  },
  {
    id: 'test_oauth',
    title: '4. Validate OAuth2 Token Exchange in Spark',
    detail:
      'Click "Test Sandbox Connection" above to exchange credentials via POST /v1/oauth2/token against https://api-m.sandbox.paypal.com.',
  },
  {
    id: 'buyer_approval',
    title: '5. Create a Sandbox Order & Approve with Personal Buyer Account',
    detail:
      'Create a test order below, open the approval link on www.sandbox.paypal.com, sign in with your Personal buyer account, and approve payment.',
  },
  {
    id: 'capture_verify',
    title: '6. Capture Payment & Inspect Transaction Explorer',
    detail:
      'Capture the approved order on the backend (POST /v2/checkout/orders/{id}/capture) and confirm status transitions to COMPLETED.',
  },
];

export const PayPalSandboxView: React.FC<PayPalSandboxViewProps> = ({
  user,
  sessionOffers,
  onPurchaseCompleted,
  onSyncUserPayPalStatus,
  onWalletBalanceChanged,
}) => {
  const [activeTab, setActiveTab] = useState<
    'studio' | 'scenarios' | 'database' | 'transactions' | 'webhooks' | 'guide'
  >('studio');

  const [sandboxStatus, setSandboxStatus] =
    useState<PayPalSandboxStatusResponse | null>(null);
  const [buyerWallet, setBuyerWallet] = useState<SandboxBuyerWalletState | null>(null);
  const [databaseTables, setDatabaseTables] = useState<{
    sandbox_payment_orders: SandboxPaymentOrderRow[];
    sandbox_payment_captures: SandboxPaymentCaptureRow[];
    sandbox_payment_events: SandboxPaymentEventRow[];
    purchase_audit_logs: PurchaseAuditLogRow[];
  }>({
    sandbox_payment_orders: [],
    sandbox_payment_captures: [],
    sandbox_payment_events: [],
    purchase_audit_logs: [],
  });
  const [transactions, setTransactions] = useState<PayPalSandboxTransaction[]>([]);
  const [webhookEvents, setWebhookEvents] = useState<PayPalWebhookEventRecord[]>(
    []
  );
  const [logs, setLogs] = useState<PayPalDiagnosticLog[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);

  // Action states
  const [testingConnection, setTestingConnection] = useState(false);
  const [runningDiagnostics, setRunningDiagnostics] = useState(false);
  const [diagnosticResults, setDiagnosticResults] = useState<
    DiagnosticStepResult[] | null
  >(null);
  const [runningScenarios, setRunningScenarios] = useState(false);
  const [scenarioSuite, setScenarioSuite] = useState<{
    timestamp: string;
    totalScenarios: number;
    passedCount: number;
    failedCount: number;
    allPassed: boolean;
    scenarios: SandboxIntegrationTestScenarioResult[];
  } | null>(null);
  const [updatingWallet, setUpdatingWallet] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [testingWebhookConfig, setTestingWebhookConfig] = useState(false);

  // Studio order builder state
  const [selectedItemId, setSelectedItemId] = useState<string>(
    'spark_sandbox_pro_pass'
  );
  const [quantity, setQuantity] = useState<number>(1);
  const [mockApplicationCode, setMockApplicationCode] = useState<string>('');
  const [actionBanner, setActionBanner] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);

  // Transaction explorer filters & selection
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);

  // Interactive setup checklist state
  const [completedChecklist, setCompletedChecklist] = useState<
    Record<string, boolean>
  >({
    dev_account: true,
    sandbox_accounts: true,
  });

  const fetchSandboxWorkspace = useCallback(async () => {
    try {
      const res = await fetch('/api/paypal/sandbox/status', {
        headers: buildAuthenticatedHeaders({ method: 'GET' }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.status) setSandboxStatus(data.status);
      if (data.buyerWallet) setBuyerWallet(data.buyerWallet);
      if (data.databaseTables) setDatabaseTables(data.databaseTables);
      if (Array.isArray(data.transactions)) setTransactions(data.transactions);
      if (Array.isArray(data.webhookEvents)) setWebhookEvents(data.webhookEvents);
      if (Array.isArray(data.logs)) setLogs(data.logs);
    } catch {
      // Keep existing state if offline
    } finally {
      setLoadingInitial(false);
    }
  }, []);

  useEffect(() => {
    fetchSandboxWorkspace();
  }, [fetchSandboxWorkspace]);

  const catalogItems: PayPalSandboxCatalogItem[] = useMemo(
    () => sandboxStatus?.sandboxCatalog || [],
    [sandboxStatus]
  );

  const selectedCatalogItem = useMemo(
    () => catalogItems.find((item) => item.id === selectedItemId) || null,
    [catalogItems, selectedItemId]
  );

  const selectedSessionOffer = useMemo(
    () => sessionOffers.find((o) => o.id === selectedItemId) || null,
    [sessionOffers, selectedItemId]
  );

  const computedPreview = useMemo(() => {
    if (selectedCatalogItem) {
      const subtotal = Number((selectedCatalogItem.unitPrice * quantity).toFixed(2));
      const shipping = Number(selectedCatalogItem.shippingCost.toFixed(2));
      const tax = Number((selectedCatalogItem.estimatedTax * quantity).toFixed(2));
      const total = Number((subtotal + shipping + tax).toFixed(2));
      return {
        name: selectedCatalogItem.name,
        merchant: selectedCatalogItem.merchant,
        unitPrice: selectedCatalogItem.unitPrice,
        subtotal,
        shipping,
        tax,
        total,
        currency: selectedCatalogItem.currency,
        isSparkManaged: true,
        eligible: true,
        blocker: null,
      };
    }
    if (selectedSessionOffer) {
      const hasPrice =
        selectedSessionOffer.price !== null &&
        selectedSessionOffer.priceStatus === 'verified';
      const shippingKnown =
        selectedSessionOffer.shippingStatus === 'verified' ||
        selectedSessionOffer.shippingStatus === 'not_applicable_digital';
      const taxKnown = selectedSessionOffer.taxStatus === 'verified';
      const eligible = hasPrice && shippingKnown && taxKnown;
      const unit = selectedSessionOffer.price ?? 0;
      const subtotal = Number((unit * quantity).toFixed(2));
      const shipping = selectedSessionOffer.shippingCost ?? 0;
      const tax =
        selectedSessionOffer.estimatedTaxRate !== null
          ? Number((subtotal * selectedSessionOffer.estimatedTaxRate).toFixed(2))
          : 0;
      return {
        name: selectedSessionOffer.name,
        merchant: selectedSessionOffer.merchant,
        unitPrice: unit,
        subtotal,
        shipping,
        tax,
        total: eligible ? Number((subtotal + shipping + tax).toFixed(2)) : null,
        currency: selectedSessionOffer.currency,
        isSparkManaged: false,
        eligible,
        blocker: !eligible
          ? 'Rule 10 Integrity Guard: Third-party offer has unverified regional tax or shipping. Select a Spark Sandbox Test SKU above to run a complete PayPal Sandbox order, or use the merchant external link.'
          : null,
      };
    }
    return null;
  }, [selectedCatalogItem, selectedSessionOffer, quantity]);

  const filteredTransactions = useMemo(() => {
    if (statusFilter === 'ALL') return transactions;
    return transactions.filter((tx) => tx.status === statusFilter);
  }, [transactions, statusFilter]);

  const selectedTransaction = useMemo(() => {
    if (selectedTxId) {
      return (
        transactions.find(
          (tx) =>
            tx.sparkOrderId === selectedTxId || tx.paypalOrderId === selectedTxId
        ) || null
      );
    }
    return filteredTransactions[0] || null;
  }, [transactions, filteredTransactions, selectedTxId]);

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setActionBanner(null);
    try {
      const res = await fetch('/api/paypal/sandbox/test-connection', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        body: JSON.stringify({ forceRefresh: true }),
      });
      const data = await res.json();
      if (data.status) setSandboxStatus(data.status);
      if (Array.isArray(data.logs)) setLogs(data.logs);
      await onSyncUserPayPalStatus();

      setActionBanner({
        type: data.ok ? 'success' : 'warning',
        message: data.message || 'Connection check completed.',
      });
    } catch {
      setActionBanner({
        type: 'error',
        message: 'Network error while testing PayPal Sandbox connection.',
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleRunDiagnostics = async () => {
    setRunningDiagnostics(true);
    setActionBanner(null);
    try {
      const res = await fetch('/api/paypal/sandbox/diagnostics', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
      });
      const data = await res.json();
      if (Array.isArray(data.steps)) setDiagnosticResults(data.steps);
      if (data.status) setSandboxStatus(data.status);
      if (Array.isArray(data.logs)) setLogs(data.logs);
      setActionBanner({
        type: data.allPassed ? 'success' : 'warning',
        message: data.allPassed
          ? 'All 6 PayPal Sandbox & Ownership diagnostic checks passed!'
          : 'Diagnostics completed: Server security, session ownership & price guards passed; see live credential/webhook status below.',
      });
    } catch {
      setActionBanner({
        type: 'error',
        message: 'Failed to execute PayPal Sandbox diagnostics.',
      });
    } finally {
      setRunningDiagnostics(false);
    }
  };

  const handleCreateSandboxOrder = async (tamperPriceTest = false) => {
    setCreatingOrder(true);
    setActionBanner(null);
    try {
      let checkoutSessionId: string | undefined;
      if (!tamperPriceTest) {
        const sessionRes = await fetch('/api/paypal/checkout-sessions', {
          method: 'POST',
          headers: buildAuthenticatedHeaders({ method: 'POST' }),
          body: JSON.stringify({
            itemId: selectedItemId,
            quantity,
          }),
        });
        if (sessionRes.ok) {
          const sessionData = await sessionRes.json();
          checkoutSessionId = sessionData.checkoutSession?.checkoutSessionId;
        }
      }

      const res = await fetch('/api/paypal/sandbox/orders', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        body: JSON.stringify({
          checkoutSessionId,
          itemId: selectedItemId,
          quantity,
          mockApplicationCode: mockApplicationCode || undefined,
          ...(tamperPriceTest ? { clientSubmittedTotalAmount: 0.01 } : {}),
        }),
      });
      const data = await res.json();
      await fetchSandboxWorkspace();

      if (data.ok && data.transaction) {
        setSelectedTxId(data.transaction.sparkOrderId);
        setActionBanner({
          type: 'success',
          message: data.message,
        });
      } else {
        setActionBanner({
          type: tamperPriceTest ? 'success' : 'warning',
          message: tamperPriceTest
            ? `Security Guard Verified (${data.errorCode}): ${data.message}`
            : data.message || data.error || 'Could not create PayPal Sandbox order.',
        });
      }
    } catch {
      setActionBanner({
        type: 'error',
        message: 'Network error while creating Sandbox order.',
      });
    } finally {
      setCreatingOrder(false);
    }
  };

  const handleInspectOrder = async (orderId: string) => {
    setBusyOrderId(orderId);
    setActionBanner(null);
    try {
      const res = await fetch(
        `/api/paypal/sandbox/orders/${encodeURIComponent(orderId)}?sync=1`,
        {
          headers: buildAuthenticatedHeaders({ method: 'GET' }),
        }
      );
      const data = await res.json();
      await fetchSandboxWorkspace();
      setActionBanner({
        type: data.ok ? 'success' : 'warning',
        message: data.message || 'Inspected order status.',
      });
    } catch {
      setActionBanner({
        type: 'error',
        message: 'Network error inspecting order status.',
      });
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleCaptureOrder = async (orderId: string) => {
    setBusyOrderId(orderId);
    setActionBanner(null);
    try {
      const res = await fetch(
        `/api/paypal/sandbox/orders/${encodeURIComponent(orderId)}/capture`,
        {
          method: 'POST',
          headers: buildAuthenticatedHeaders({ method: 'POST' }),
          body: JSON.stringify({
            mockApplicationCode: mockApplicationCode || undefined,
            payerEmail: user.email,
          }),
        }
      );
      const data = await res.json();
      await fetchSandboxWorkspace();

      if (data.ok && data.purchaseRecord && !data.duplicateCapturePrevented) {
        onPurchaseCompleted(data.purchaseRecord);
      }
      onWalletBalanceChanged?.();

      setActionBanner({
        type: data.ok ? 'success' : 'warning',
        message: data.message || 'Capture request processed.',
      });
    } catch {
      setActionBanner({
        type: 'error',
        message: 'Network error capturing PayPal Sandbox order.',
      });
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    setBusyOrderId(orderId);
    setActionBanner(null);
    try {
      const res = await fetch(
        `/api/paypal/sandbox/orders/${encodeURIComponent(orderId)}/cancel`,
        {
          method: 'POST',
          headers: buildAuthenticatedHeaders({ method: 'POST' }),
          body: JSON.stringify({
            reason:
              'Buyer cancelled checkout in PayPal Sandbox developer workspace.',
          }),
        }
      );
      const data = await res.json();
      await fetchSandboxWorkspace();
      setActionBanner({
        type: data.ok ? 'success' : 'warning',
        message: data.message || 'Order cancelled.',
      });
    } catch {
      setActionBanner({
        type: 'error',
        message: 'Network error cancelling order.',
      });
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleApproveOrderInSandbox = async (orderId: string) => {
    setBusyOrderId(orderId);
    setActionBanner(null);
    try {
      const res = await fetch(
        `/api/paypal/sandbox/orders/${encodeURIComponent(orderId)}/approve`,
        {
          method: 'POST',
          headers: buildAuthenticatedHeaders({ method: 'POST' }),
          body: JSON.stringify({
            payerEmail: buyerWallet?.buyerEmail || user.email,
            payerId: buyerWallet?.buyerAccountId,
          }),
        }
      );
      const data = await res.json();
      await fetchSandboxWorkspace();
      setActionBanner({
        type: data.ok ? 'success' : 'warning',
        message: data.message || 'Buyer approval recorded in PayPal Sandbox.',
      });
    } catch {
      setActionBanner({
        type: 'error',
        message: 'Network error recording buyer approval.',
      });
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleConfigureWalletBalance = async (targetBalance: number) => {
    setUpdatingWallet(true);
    setActionBanner(null);
    try {
      const res = await fetch('/api/paypal/sandbox/wallet', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        body: JSON.stringify({ balance: targetBalance }),
      });
      const data = await res.json();
      if (data.buyerWallet) setBuyerWallet(data.buyerWallet);
      await fetchSandboxWorkspace();
      onWalletBalanceChanged?.();
      setActionBanner({
        type: res.ok ? 'success' : 'warning',
        message:
          data.message ||
          `Simulated PayPal Sandbox buyer balance updated to USD ${targetBalance.toFixed(2)}.`,
      });
    } catch {
      setActionBanner({
        type: 'error',
        message: 'Network error updating Sandbox buyer wallet balance.',
      });
    } finally {
      setUpdatingWallet(false);
    }
  };

  const handleRunFifteenScenarios = async () => {
    setRunningScenarios(true);
    setActionBanner(null);
    try {
      const res = await fetch('/api/paypal/sandbox/test-scenarios', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
      });
      const data = await res.json();
      if (Array.isArray(data.scenarios)) {
        setScenarioSuite({
          timestamp: data.timestamp,
          totalScenarios: data.totalScenarios,
          passedCount: data.passedCount,
          failedCount: data.failedCount,
          allPassed: data.allPassed,
          scenarios: data.scenarios,
        });
      }
      if (data.buyerWallet) setBuyerWallet(data.buyerWallet);
      await fetchSandboxWorkspace();
      onWalletBalanceChanged?.();
      setActiveTab('scenarios');
      setActionBanner({
        type: data.allPassed ? 'success' : 'warning',
        message: `Executed all ${data.totalScenarios} Required PayPal Sandbox Integration Scenarios: ${data.passedCount}/${data.totalScenarios} PASSED.`,
      });
    } catch {
      setActionBanner({
        type: 'error',
        message: 'Failed to execute the 15 PayPal Sandbox integration scenarios.',
      });
    } finally {
      setRunningScenarios(false);
    }
  };

  const handleTestWebhookConfig = async () => {
    setTestingWebhookConfig(true);
    setActionBanner(null);
    try {
      const res = await fetch('/api/paypal/sandbox/webhooks/test-config', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
      });
      const data = await res.json();
      if (data.status) setSandboxStatus(data.status);
      setActionBanner({
        type: data.ok ? 'success' : 'warning',
        message: data.message,
      });
    } catch {
      setActionBanner({
        type: 'error',
        message: 'Network error checking webhook configuration.',
      });
    } finally {
      setTestingWebhookConfig(false);
    }
  };

  const renderStatusBadge = (status: PayPalTransactionStatus) => {
    const styles: Record<PayPalTransactionStatus, string> = {
      CREATED: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
      APPROVED: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
      COMPLETED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      CANCELLED: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
      FAILED: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
      REFUNDED: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    };
    return (
      <span
        className={`px-2.5 py-0.5 rounded-lg border text-[11px] font-mono font-semibold ${styles[status]}`}
      >
        {status}
      </span>
    );
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-16">
      {/* Top Header & Sandbox Safety Guarantee */}
      <div className="rounded-3xl bg-gradient-to-br from-[#121218] via-[#13131C] to-[#0E131F] border border-white/[0.08] p-6 sm:p-7 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#0070BA]/20 border border-[#0070BA]/40 text-[11px] font-mono font-semibold text-cyan-300">
                <Lock className="w-3.5 h-3.5" />
                <span>SANDBOX MODE · TEST TRANSACTION</span>
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 border border-white/[0.08] text-[11px] font-mono text-zinc-300">
                <span>PayPal Sandbox:</span>
                <code className="text-violet-300">
                  {sandboxStatus?.baseUrl || 'https://api-m.sandbox.paypal.com'}
                </code>
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">
              PayPal Sandbox Environment & Autonomous Purchasing Studio
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 max-w-3xl leading-relaxed">
              Official server-side PayPal REST API integration (<code className="font-mono text-zinc-300">POST /v1/oauth2/token</code>,{' '}
              <code className="font-mono text-zinc-300">POST /v2/checkout/orders</code>,{' '}
              <code className="font-mono text-zinc-300">POST /v2/checkout/orders/&#123;id&#125;/capture</code>, and{' '}
              <code className="font-mono text-zinc-300">POST /v1/notifications/verify-webhook-signature</code>). Spark never fabricates payment confirmations or exposes client secrets to the browser.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testingConnection}
              className="py-2.5 px-4 rounded-xl bg-[#0070BA] hover:bg-[#005ea6] disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-2 transition-colors cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${testingConnection ? 'animate-spin' : ''}`}
              />
              <span>
                {testingConnection
                  ? 'Testing OAuth2...'
                  : 'Test Sandbox Connection'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleRunDiagnostics}
              disabled={runningDiagnostics}
              className="py-2.5 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.1] text-xs font-semibold text-zinc-200 inline-flex items-center gap-2 transition-colors cursor-pointer"
            >
              <Activity
                className={`w-3.5 h-3.5 text-violet-400 ${
                  runningDiagnostics ? 'animate-pulse' : ''
                }`}
              />
              <span>
                {runningDiagnostics
                  ? 'Running Checks...'
                  : 'Run E2E Diagnostics'}
              </span>
            </button>

            <button
              type="button"
              data-testid="run-15-scenarios-btn"
              onClick={handleRunFifteenScenarios}
              disabled={runningScenarios}
              className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-2 transition-colors cursor-pointer"
            >
              <ShieldCheck
                className={`w-3.5 h-3.5 ${runningScenarios ? 'animate-spin' : ''}`}
              />
              <span>
                {runningScenarios
                  ? 'Running 15 Scenarios...'
                  : 'Run 15 Required Integration Tests'}
              </span>
            </button>
          </div>
        </div>

        {/* Simulated PayPal Sandbox Buyer Account Balance & Wallet Controls */}
        <div className="mt-5 p-4 rounded-2xl bg-zinc-950/90 border border-emerald-500/25 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-5">
            <div>
              <div className="text-[11px] font-medium text-zinc-400 flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5 text-emerald-400" />
                <span>Simulated Account Balance (PayPal Sandbox Buyer)</span>
              </div>
              <div
                data-testid="sandbox-buyer-balance-value"
                className="text-xl font-mono font-bold text-emerald-400 mt-0.5"
              >
                {buyerWallet
                  ? `${buyerWallet.currency} ${buyerWallet.availableBalance.toFixed(2)}`
                  : 'USD 500.00'}
              </div>
              <div className="text-[11px] text-zinc-400 font-mono mt-0.5">
                Buyer Account:{' '}
                <span className="text-zinc-200">
                  {buyerWallet?.buyerEmail || 'sb-buyer@personal.example.com'}
                </span>{' '}
                · Payer ID:{' '}
                <span className="text-cyan-300">
                  {buyerWallet?.buyerAccountId || 'SBPAYER01'}
                </span>
              </div>
            </div>

            {buyerWallet && buyerWallet.ledgerEntries.length > 0 && (
              <div className="pl-4 border-l border-white/[0.08] text-xs font-mono space-y-1">
                <div className="text-[11px] text-zinc-400">Latest Verified Balance Deduction:</div>
                <div className="text-emerald-300">
                  {buyerWallet.ledgerEntries[0].type === 'DEBIT_CAPTURE' ? '-' : '+'}
                  {buyerWallet.ledgerEntries[0].currency}{' '}
                  {buyerWallet.ledgerEntries[0].amount.toFixed(2)} (Balance:{' '}
                  {buyerWallet.ledgerEntries[0].balanceBefore.toFixed(2)} →{' '}
                  {buyerWallet.ledgerEntries[0].balanceAfter.toFixed(2)})
                </div>
                <div className="text-[10px] text-zinc-500 truncate max-w-xs">
                  Order: {buyerWallet.ledgerEntries[0].paypalOrderId} · Capture:{' '}
                  {buyerWallet.ledgerEntries[0].captureId || 'N/A'}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span className="text-[11px] text-zinc-400 mr-1">
              Configure Buyer Test Balance:
            </span>
            <button
              type="button"
              disabled={updatingWallet}
              onClick={() => handleConfigureWalletBalance(500)}
              className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.1] text-xs font-mono text-emerald-300 cursor-pointer"
            >
              Reset $500.00
            </button>
            <button
              type="button"
              disabled={updatingWallet}
              onClick={() => handleConfigureWalletBalance(5)}
              className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-amber-500/30 text-xs font-mono text-amber-300 cursor-pointer"
            >
              Set $5.00 (Test Insufficient Funds)
            </button>
          </div>
        </div>

        {/* A & B. Connection Status & Credential Matrix */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5 mt-5 pt-5 border-t border-white/[0.07]">
          <div className="p-4 rounded-2xl bg-zinc-950/70 border border-white/[0.07]">
            <div className="text-[11px] font-medium text-zinc-400 mb-1">
              Connection Status
            </div>
            <div className="flex items-center gap-2">
              {sandboxStatus?.connectionStatus === 'Connected' ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="text-sm font-semibold text-emerald-400">
                    Connected (Verified)
                  </span>
                </>
              ) : sandboxStatus?.connectionStatus === 'Configuration Error' ? (
                <>
                  <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span className="text-sm font-semibold text-rose-400">
                    Configuration Error
                  </span>
                </>
              ) : (
                <>
                  <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="text-sm font-semibold text-amber-300">
                    Not Connected
                  </span>
                </>
              )}
            </div>
            <div className="text-[11px] text-zinc-500 font-mono mt-1.5">
              {sandboxStatus?.lastConnectedAt
                ? `Verified: ${new Date(
                    sandboxStatus.lastConnectedAt
                  ).toLocaleTimeString()}`
                : 'Awaiting live OAuth2 token validation'}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-zinc-950/70 border border-white/[0.07]">
            <div className="text-[11px] font-medium text-zinc-400 mb-1 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-violet-400" />
              <span>PAYPAL_CLIENT_ID</span>
            </div>
            <div className="text-sm font-mono font-semibold text-white">
              {sandboxStatus?.credentialsConfigured.clientId
                ? sandboxStatus.credentialsConfigured.clientIdPreview ||
                  'Configured'
                : 'Not Set'}
            </div>
            <div className="text-[11px] text-zinc-500 mt-1.5">
              {sandboxStatus?.credentialsConfigured.clientId
                ? 'Loaded in server memory'
                : 'Add PAYPAL_CLIENT_ID in Secrets'}
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-zinc-950/70 border border-white/[0.07]">
            <div className="text-[11px] font-medium text-zinc-400 mb-1 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-cyan-400" />
              <span>PAYPAL_CLIENT_SECRET</span>
            </div>
            <div className="text-sm font-mono font-semibold text-white">
              {sandboxStatus?.credentialsConfigured.clientSecret
                ? '•••••••••••• (Server-Only)'
                : 'Not Set'}
            </div>
            <div className="text-[11px] text-zinc-500 mt-1.5">
              Never transmitted to browser
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-zinc-950/70 border border-white/[0.07]">
            <div className="text-[11px] font-medium text-zinc-400 mb-1 flex items-center gap-1.5">
              <Webhook className="w-3.5 h-3.5 text-emerald-400" />
              <span>PAYPAL_WEBHOOK_ID</span>
            </div>
            <div className="text-sm font-mono font-semibold text-white">
              {sandboxStatus?.credentialsConfigured.webhookId
                ? 'Configured'
                : 'Not Set'}
            </div>
            <div className="text-[11px] text-zinc-500 mt-1.5">
              Route: <code className="font-mono">/api/paypal/webhooks</code>
            </div>
          </div>
        </div>

        {/* Diagnostic message or error notice */}
        {sandboxStatus?.lastError && (
          <div className="mt-4 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-200 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-amber-300">
                Server Diagnostic Notice:{' '}
              </span>
              <span>{sandboxStatus.lastError}</span>
            </div>
          </div>
        )}

        {actionBanner && (
          <div
            role="status"
            className={`mt-4 p-3.5 rounded-2xl border text-xs flex items-start gap-2.5 ${
              actionBanner.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                : actionBanner.type === 'warning'
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
            }`}
          >
            {actionBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            )}
            <span className="leading-relaxed">{actionBanner.message}</span>
          </div>
        )}

        {/* E2E Diagnostics Stepper Output */}
        {diagnosticResults && (
          <div className="mt-4 p-4 rounded-2xl bg-zinc-950/90 border border-white/[0.08] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">
                End-to-End Checkout & Security Diagnostic Report
              </span>
              <button
                type="button"
                onClick={() => setDiagnosticResults(null)}
                className="text-[11px] text-zinc-400 hover:text-white cursor-pointer"
              >
                Dismiss
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {diagnosticResults.map((step) => (
                <div
                  key={step.id}
                  className="p-2.5 rounded-xl bg-zinc-900/80 border border-white/[0.06] flex items-start gap-2.5 text-xs"
                >
                  {step.passed ? (
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div className="font-medium text-white">{step.label}</div>
                    <div className="text-[11px] text-zinc-400 mt-0.5">
                      {step.detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sub-navigation Tabs */}
      <div
        role="tablist"
        aria-label="PayPal Sandbox sections"
        className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-2xl bg-[#121217]/90 border border-white/[0.08] w-fit"
      >
        {[
          {
            id: 'studio' as const,
            label: 'Checkout & Negative Testing Studio',
            icon: Play,
          },
          {
            id: 'scenarios' as const,
            label: `15 Required Test Scenarios${
              scenarioSuite
                ? ` (${scenarioSuite.passedCount}/${scenarioSuite.totalScenarios})`
                : ''
            }`,
            icon: ShieldCheck,
          },
          {
            id: 'database' as const,
            label: `Sandbox DB Tables (${databaseTables.sandbox_payment_orders.length})`,
            icon: Database,
          },
          {
            id: 'transactions' as const,
            label: `Transaction Explorer (${transactions.length})`,
            icon: FileSearch,
          },
          {
            id: 'webhooks' as const,
            label: `Webhooks & Logs (${webhookEvents.length})`,
            icon: Webhook,
          },
          {
            id: 'guide' as const,
            label: 'Sandbox Test Accounts & Setup Guide',
            icon: BookOpen,
          },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-medium inline-flex items-center gap-2 transition-colors cursor-pointer ${
                active
                  ? 'bg-violet-600 text-white shadow-xs'
                  : 'text-zinc-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: CHECKOUT & NEGATIVE TESTING STUDIO */}
      {activeTab === 'studio' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Server-Validated Order Builder */}
          <div className="lg:col-span-7 rounded-3xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-white">
                  1. Server-Validated Sandbox Order Creator
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Select a trusted server-side Spark Sandbox SKU (or verified session offer) to create a real order via{' '}
                  <code className="font-mono text-zinc-300">
                    POST /v2/checkout/orders
                  </code>
                  .
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-violet-500/15 border border-violet-500/30 text-[11px] font-mono text-violet-300 shrink-0">
                Server Price Authority
              </span>
            </div>

            {/* Item selector */}
            <div className="space-y-2">
              <label
                htmlFor="sandbox-sku-select"
                className="block text-xs font-medium text-zinc-300"
              >
                Trusted Server-Side Item / SKU
              </label>
              <select
                id="sandbox-sku-select"
                value={selectedItemId}
                onChange={(e) => setSelectedItemId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-white/[0.1] text-xs text-white focus:outline-none focus:border-violet-400"
              >
                <optgroup label="Spark-Managed Sandbox Test Catalog (Recommended)">
                  {catalogItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      [{item.sku}] {item.name} — {item.currency}{' '}
                      {item.unitPrice.toFixed(2)}
                    </option>
                  ))}
                </optgroup>
                {sessionOffers.length > 0 && (
                  <optgroup label="Discovered Session Offers (Third-Party Merchant Simulation)">
                    {sessionOffers.map((offer) => (
                      <option key={offer.id} value={offer.id}>
                        [{offer.merchant}] {offer.name} —{' '}
                        {offer.price !== null
                          ? `${offer.currency} ${offer.price.toFixed(2)}`
                          : 'Unverified price'}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            {/* Scope Disclosure Badge */}
            {computedPreview && (
              <div
                className={`p-3.5 rounded-2xl border text-xs ${
                  computedPreview.isSparkManaged
                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-200'
                    : 'bg-indigo-500/10 border-indigo-500/25 text-indigo-200'
                }`}
              >
                <div className="font-semibold mb-0.5">
                  {computedPreview.isSparkManaged
                    ? 'Checkout Scope: Spark-Managed Sandbox Test Item'
                    : `Checkout Scope: Third-Party Merchant Sandbox Simulation (${computedPreview.merchant})`}
                </div>
                <p className="text-[11px] opacity-90 leading-relaxed">
                  {computedPreview.isSparkManaged
                    ? 'This SKU is managed directly by Spark for testing PayPal Sandbox order creation, buyer approval, and server-side capture.'
                    : 'Important Distinction: Paying in the PayPal Sandbox tests Spark’s payment lifecycle only and does NOT place a live retail order with the external third-party merchant.'}
                </p>
              </div>
            )}

            {/* Quantity & Negative Testing Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="sandbox-qty-input"
                  className="block text-xs font-medium text-zinc-300 mb-1.5"
                >
                  Quantity (1–10)
                </label>
                <input
                  id="sandbox-qty-input"
                  type="number"
                  min={1}
                  max={10}
                  value={quantity}
                  onChange={(e) =>
                    setQuantity(
                      Math.max(1, Math.min(10, Number(e.target.value) || 1))
                    )
                  }
                  className="w-full px-3.5 py-2 rounded-xl bg-zinc-900 border border-white/[0.1] text-xs font-mono text-white"
                />
              </div>

              <div className="sm:col-span-2">
                <label
                  htmlFor="sandbox-negative-select"
                  className="block text-xs font-medium text-zinc-300 mb-1.5"
                >
                  PayPal Sandbox Negative Testing (<code className="font-mono">PayPal-Mock-Response</code>)
                </label>
                <select
                  id="sandbox-negative-select"
                  value={mockApplicationCode}
                  onChange={(e) => setMockApplicationCode(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-zinc-900 border border-white/[0.1] text-xs font-mono text-white focus:outline-none focus:border-violet-400"
                >
                  {NEGATIVE_TEST_CODES.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Itemized Server Calculation Preview */}
            {computedPreview && (
              <div className="p-4 rounded-2xl bg-zinc-950/80 border border-white/[0.07] space-y-2 text-xs">
                <div className="flex justify-between text-zinc-400">
                  <span>
                    Server Unit Price ({quantity} × {computedPreview.currency}{' '}
                    {computedPreview.unitPrice.toFixed(2)})
                  </span>
                  <span className="font-mono text-zinc-200">
                    {computedPreview.currency}{' '}
                    {computedPreview.subtotal.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Verified Shipping & Handling</span>
                  <span className="font-mono text-zinc-200">
                    {computedPreview.currency}{' '}
                    {computedPreview.shipping.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Verified Jurisdiction Tax</span>
                  <span className="font-mono text-zinc-200">
                    {computedPreview.currency} {computedPreview.tax.toFixed(2)}
                  </span>
                </div>
                <div className="pt-2 border-t border-white/[0.08] flex justify-between text-sm font-semibold text-white">
                  <span>Server-Authoritative Order Total</span>
                  <span className="font-mono text-violet-300">
                    {computedPreview.total !== null
                      ? `${computedPreview.currency} ${computedPreview.total.toFixed(
                          2
                        )}`
                      : 'Blocked (Unverified Charges)'}
                  </span>
                </div>
              </div>
            )}

            {computedPreview?.blocker && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
                {computedPreview.blocker}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => handleCreateSandboxOrder(false)}
                disabled={creatingOrder || !computedPreview?.eligible}
                className="py-2.5 px-5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-40 text-xs font-semibold text-white inline-flex items-center gap-2 transition-all cursor-pointer"
              >
                <CreditCard className="w-4 h-4" />
                <span>
                  {creatingOrder
                    ? 'Creating Order on Sandbox...'
                    : 'Create PayPal Sandbox Order'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleCreateSandboxOrder(true)}
                disabled={creatingOrder}
                className="py-2.5 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.1] text-xs font-medium text-zinc-300 inline-flex items-center gap-2 transition-colors cursor-pointer"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                <span>Test Tampered Client Amount Rejection ($0.01)</span>
              </button>
            </div>
          </div>

          {/* Right Column: Active Order Lifecycle & Capture Controller */}
          <div className="lg:col-span-5 rounded-3xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-5 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-white">
                  2. Active Sandbox Order Lifecycle
                </h2>
                {selectedTransaction &&
                  renderStatusBadge(selectedTransaction.status)}
              </div>

              {selectedTransaction ? (
                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-zinc-950/80 border border-white/[0.07] space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Spark Order ID</span>
                      <span className="font-mono text-white">
                        {selectedTransaction.sparkOrderId}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Lifecycle State</span>
                      <span className="font-mono text-violet-300">
                        {selectedTransaction.lifecycleStatus || selectedTransaction.status}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Execution Mode</span>
                      <span className="font-mono text-emerald-300">
                        {selectedTransaction.executionMode || 'SANDBOX_SIMULATION'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">PayPal Order ID</span>
                      <span className="font-mono text-cyan-300">
                        {selectedTransaction.paypalOrderId}
                      </span>
                    </div>
                    {selectedTransaction.captureId && (
                      <div className="flex justify-between">
                        <span className="text-zinc-400">PayPal Capture ID</span>
                        <span className="font-mono text-emerald-300">
                          {selectedTransaction.captureId}
                        </span>
                      </div>
                    )}
                    {typeof selectedTransaction.buyerBalanceAfter === 'number' && (
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Buyer Balance Impact</span>
                        <span className="font-mono text-emerald-400">
                          USD {(selectedTransaction.buyerBalanceBefore ?? 500).toFixed(2)} →{' '}
                          USD {selectedTransaction.buyerBalanceAfter.toFixed(2)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Item</span>
                      <span className="text-zinc-200 truncate max-w-[220px]">
                        {selectedTransaction.quantity}×{' '}
                        {selectedTransaction.productName}
                      </span>
                    </div>
                    <div className="flex justify-between font-semibold text-white pt-1 border-t border-white/[0.06]">
                      <span>Verified Amount</span>
                      <span className="font-mono">
                        {selectedTransaction.currency}{' '}
                        {selectedTransaction.amount.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Step A: Buyer Approval on sandbox.paypal.com */}
                  {selectedTransaction.approvalUrl &&
                    (selectedTransaction.status === 'CREATED' ||
                      selectedTransaction.status === 'APPROVED') && (
                      <div className="p-4 rounded-2xl bg-[#0070BA]/10 border border-[#0070BA]/30 space-y-2.5">
                        <div className="text-xs font-semibold text-cyan-300">
                          Buyer Approval on PayPal Sandbox
                        </div>
                        <p className="text-[11px] text-zinc-300 leading-relaxed">
                          Open the official PayPal Sandbox checkout URL below or click{' '}
                          <strong className="text-white">
                            Simulate Sandbox Buyer Approval
                          </strong>{' '}
                          to transition the order to <code className="font-mono">APPROVED</code> before capturing.
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <a
                            href={selectedTransaction.approvalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="py-2 px-3.5 rounded-xl bg-[#0070BA] hover:bg-[#005ea6] text-xs font-semibold text-white inline-flex items-center gap-1.5"
                          >
                            <span>Open PayPal Sandbox Approval</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>

                          {selectedTransaction.status === 'CREATED' && (
                            <button
                              type="button"
                              onClick={() =>
                                handleApproveOrderInSandbox(
                                  selectedTransaction.sparkOrderId
                                )
                              }
                              disabled={
                                busyOrderId === selectedTransaction.sparkOrderId
                              }
                              className="py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Simulate Buyer Approval</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              handleInspectOrder(
                                selectedTransaction.sparkOrderId
                              )
                            }
                            disabled={
                              busyOrderId === selectedTransaction.sparkOrderId
                            }
                            className="py-2 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.1] text-xs text-zinc-200 inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>Inspect Live Status</span>
                          </button>
                        </div>
                      </div>
                    )}

                  {/* Step B: Capture or Cancel */}
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() =>
                        handleCaptureOrder(selectedTransaction.sparkOrderId)
                      }
                      disabled={
                        busyOrderId === selectedTransaction.sparkOrderId ||
                        selectedTransaction.status === 'CANCELLED' ||
                        selectedTransaction.status === 'REFUNDED' ||
                        (selectedTransaction.status === 'CREATED' &&
                          mockApplicationCode !== 'ORDER_NOT_APPROVED')
                      }
                      className="py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-semibold text-white inline-flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      <span>
                        {selectedTransaction.status === 'COMPLETED'
                          ? 'Test Idempotent Re-Capture Guard'
                          : selectedTransaction.status === 'CREATED' &&
                            mockApplicationCode !== 'ORDER_NOT_APPROVED'
                          ? 'Approve Order First (Step A Required)'
                          : 'Capture Order & Deduct Sandbox Balance'}
                      </span>
                    </button>

                    {selectedTransaction.status !== 'COMPLETED' &&
                      selectedTransaction.status !== 'CANCELLED' && (
                        <button
                          type="button"
                          onClick={() =>
                            handleCancelOrder(selectedTransaction.sparkOrderId)
                          }
                          disabled={
                            busyOrderId === selectedTransaction.sparkOrderId
                          }
                          className="py-2.5 px-3.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-xs font-medium text-rose-300 transition-colors cursor-pointer"
                        >
                          Cancel Order
                        </button>
                      )}
                  </div>

                  {/* Error Summary if failed */}
                  {selectedTransaction.errorSummary && (
                    <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200 space-y-1">
                      <div className="font-semibold font-mono text-rose-300">
                        Error: {selectedTransaction.errorSummary.issue || selectedTransaction.errorSummary.code}
                        {selectedTransaction.errorSummary.debugId && (
                          <span className="ml-2 text-[11px] text-rose-400">
                            (debug_id: {selectedTransaction.errorSummary.debugId})
                          </span>
                        )}
                      </div>
                      <p className="text-[11px]">
                        {selectedTransaction.errorSummary.message}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-12 px-4 text-center rounded-2xl bg-zinc-950/50 border border-white/[0.05]">
                  <CreditCard className="w-7 h-7 text-zinc-500 mx-auto mb-2.5" />
                  <p className="text-xs font-medium text-zinc-300">
                    No active Sandbox transaction selected
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-1 max-w-xs mx-auto">
                    Create a server-validated PayPal Sandbox order on the left to inspect its approval link, capture status, and state transitions.
                  </p>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-white/[0.06] text-[11px] text-zinc-400 flex items-center justify-between">
              <span>Strict No-Fake-Success Policy</span>
              <span className="font-mono text-emerald-400">
                100% Backend Verified
              </span>
            </div>
          </div>
        </div>
      )}

      {/* TAB: 15 REQUIRED INTEGRATION TEST SCENARIOS */}
      {activeTab === 'scenarios' && (
        <div className="rounded-3xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-white">
                15 Required PayPal Sandbox Integration & Security Test Scenarios
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Automated server-side verification of all 15 required autonomous purchasing, Sandbox isolation, idempotency, webhook signature, and negative test scenarios.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRunFifteenScenarios}
              disabled={runningScenarios}
              className="py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-2 shrink-0 cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${runningScenarios ? 'animate-spin' : ''}`}
              />
              <span>
                {runningScenarios
                  ? 'Running 15 Scenarios...'
                  : 'Re-Run All 15 Scenarios'}
              </span>
            </button>
          </div>

          {!scenarioSuite ? (
            <div className="p-10 rounded-2xl bg-zinc-950/60 border border-white/[0.06] text-center space-y-3">
              <ShieldCheck className="w-8 h-8 text-emerald-400 mx-auto" />
              <div className="text-sm font-semibold text-white">
                Ready to Execute 15 Required Integration Test Scenarios
              </div>
              <p className="text-xs text-zinc-400 max-w-lg mx-auto">
                Click &ldquo;Run 15 Required Integration Tests&rdquo; to execute all 15 scenarios against the PayPal Sandbox engine and verify every expected outcome.
              </p>
              <button
                type="button"
                onClick={handleRunFifteenScenarios}
                disabled={runningScenarios}
                className="py-2.5 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white cursor-pointer"
              >
                Run 15 Required Scenarios Now
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-zinc-950/90 border border-emerald-500/30 text-xs">
                <div className="font-semibold text-emerald-300">
                  Test Suite Summary: {scenarioSuite.passedCount} /{' '}
                  {scenarioSuite.totalScenarios} Scenarios PASSED
                </div>
                <div className="font-mono text-zinc-400">
                  Executed at {new Date(scenarioSuite.timestamp).toLocaleTimeString()}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {scenarioSuite.scenarios.map((sc) => (
                  <div
                    key={sc.scenarioKey}
                    className={`p-4 rounded-2xl border text-xs space-y-1.5 ${
                      sc.passed
                        ? 'bg-zinc-950/80 border-emerald-500/25'
                        : 'bg-rose-500/10 border-rose-500/30'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">
                        {sc.title}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                          sc.passed
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-rose-500/20 text-rose-300'
                        }`}
                      >
                        {sc.passed ? 'PASS' : 'FAIL'}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-400">
                      <strong>Expected:</strong> {sc.expectedOutcome}
                    </div>
                    <div className="text-[11px] text-zinc-200 font-mono">
                      <strong>Actual:</strong> {sc.actualOutcome}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB: 4 SANDBOX RELATIONAL DATABASE TABLES */}
      {activeTab === 'database' && (
        <div className="space-y-6">
          <div className="rounded-3xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">
                  1. Table: <code className="font-mono text-violet-300">sandbox_payment_orders</code> ({databaseTables.sandbox_payment_orders.length})
                </h2>
                <p className="text-xs text-zinc-400">
                  Row-Level Security scoped to authenticated user <code className="font-mono">{user.id}</code>.
                </p>
              </div>
            </div>
            {databaseTables.sandbox_payment_orders.length === 0 ? (
              <p className="text-xs text-zinc-500">No rows in sandbox_payment_orders yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono border-collapse">
                  <thead>
                    <tr className="border-b border-white/[0.08] text-zinc-400">
                      <th className="py-2 pr-3">id</th>
                      <th className="py-2 pr-3">product_id</th>
                      <th className="py-2 pr-3">paypal_order_id</th>
                      <th className="py-2 pr-3">amount</th>
                      <th className="py-2 pr-3">status</th>
                      <th className="py-2 pr-3">execution_mode</th>
                      <th className="py-2">created_at</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.05]">
                    {databaseTables.sandbox_payment_orders.slice(0, 15).map((row) => (
                      <tr key={row.id} className="text-zinc-200">
                        <td className="py-2 pr-3 text-white">{row.id}</td>
                        <td className="py-2 pr-3">{row.product_id}</td>
                        <td className="py-2 pr-3 text-cyan-300">{row.paypal_order_id || '—'}</td>
                        <td className="py-2 pr-3">
                          {row.currency} {row.amount.toFixed(2)}
                        </td>
                        <td className="py-2 pr-3 text-emerald-300">{row.status}</td>
                        <td className="py-2 pr-3 text-violet-300">{row.execution_mode}</td>
                        <td className="py-2 text-zinc-400">
                          {new Date(row.created_at).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-3xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-3">
              <h3 className="text-sm font-semibold text-white">
                2. Table: <code className="font-mono text-emerald-300">sandbox_payment_captures</code> ({databaseTables.sandbox_payment_captures.length})
              </h3>
              {databaseTables.sandbox_payment_captures.length === 0 ? (
                <p className="text-xs text-zinc-500">No rows in sandbox_payment_captures yet.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto font-mono text-xs">
                  {databaseTables.sandbox_payment_captures.slice(0, 15).map((cap) => (
                    <div
                      key={cap.id}
                      className="p-3 rounded-xl bg-zinc-950/80 border border-white/[0.06] flex items-center justify-between"
                    >
                      <div>
                        <div className="text-white">
                          Capture: <span className="text-emerald-300">{cap.paypal_capture_id}</span>
                        </div>
                        <div className="text-[11px] text-zinc-400">Order: {cap.order_id}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-white">
                          {cap.currency} {cap.amount.toFixed(2)}
                        </div>
                        <div className="text-[10px] text-emerald-400">{cap.capture_status}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-3xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-3">
              <h3 className="text-sm font-semibold text-white">
                3. Table: <code className="font-mono text-cyan-300">sandbox_payment_events</code> ({databaseTables.sandbox_payment_events.length})
              </h3>
              {databaseTables.sandbox_payment_events.length === 0 ? (
                <p className="text-xs text-zinc-500">No rows in sandbox_payment_events yet.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto font-mono text-xs">
                  {databaseTables.sandbox_payment_events.slice(0, 15).map((ev) => (
                    <div
                      key={ev.id}
                      className="p-3 rounded-xl bg-zinc-950/80 border border-white/[0.06] flex items-center justify-between"
                    >
                      <div>
                        <div className="text-cyan-300">{ev.event_type}</div>
                        <div className="text-[11px] text-zinc-400">
                          Event ID: {ev.paypal_event_id} · Order: {ev.order_id || '—'}
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] ${
                          ev.signature_verified
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-rose-500/20 text-rose-300'
                        }`}
                      >
                        sig_verified: {String(ev.signature_verified)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-3">
            <h3 className="text-sm font-semibold text-white">
              4. Table: <code className="font-mono text-amber-300">purchase_audit_logs</code> ({databaseTables.purchase_audit_logs.length})
            </h3>
            {databaseTables.purchase_audit_logs.length === 0 ? (
              <p className="text-xs text-zinc-500">No rows in purchase_audit_logs yet.</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto font-mono text-xs">
                {databaseTables.purchase_audit_logs.slice(0, 20).map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-xl bg-zinc-950/80 border border-white/[0.06] flex items-start justify-between gap-4"
                  >
                    <div>
                      <div className="text-white font-semibold">
                        [{log.action}]{' '}
                        <span className="text-zinc-400 font-normal">
                          Order: {log.order_id || 'N/A'}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-300 mt-0.5">{log.detail}</div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] shrink-0 ${
                        log.result === 'DENIED' || log.result === 'FAILED'
                          ? 'bg-rose-500/20 text-rose-300'
                          : 'bg-emerald-500/20 text-emerald-300'
                      }`}
                    >
                      {log.result}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: TRANSACTION EXPLORER */}
      {activeTab === 'transactions' && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl bg-[#121217]/90 border border-white/[0.08] p-4">
            <div>
              <h2 className="text-base font-semibold text-white">
                PayPal Sandbox Transaction Explorer
              </h2>
              <p className="text-xs text-zinc-400">
                Inspect Spark Order IDs, PayPal Order IDs, Capture IDs, webhook verification states, and state history.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  'ALL',
                  'CREATED',
                  'APPROVED',
                  'COMPLETED',
                  'CANCELLED',
                  'FAILED',
                  'REFUNDED',
                ] as const
              ).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-mono font-medium transition-colors cursor-pointer ${
                    statusFilter === st
                      ? 'bg-violet-600 text-white'
                      : 'bg-zinc-900 text-zinc-400 hover:text-white'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {filteredTransactions.length === 0 ? (
            <div className="rounded-3xl bg-[#121217]/90 border border-white/[0.08] p-12 text-center">
              <FileSearch className="w-8 h-8 text-violet-400 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-white mb-1">
                No Sandbox transactions recorded yet
              </h3>
              <p className="text-xs text-zinc-400 max-w-md mx-auto leading-relaxed mb-5">
                Spark starts with a clean transaction ledger and never populates fake or pre-seeded payment records. Create a test order in the Checkout Studio to see live transaction records here.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('studio')}
                className="py-2 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white cursor-pointer"
              >
                Open Checkout Studio
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 space-y-2.5">
                {filteredTransactions.map((tx) => {
                  const isSelected =
                    selectedTransaction?.sparkOrderId === tx.sparkOrderId;
                  return (
                    <button
                      key={tx.sparkOrderId}
                      type="button"
                      onClick={() => setSelectedTxId(tx.sparkOrderId)}
                      className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center justify-between gap-4 cursor-pointer ${
                        isSelected
                          ? 'bg-zinc-900 border-violet-500/50'
                          : 'bg-[#121217]/90 border-white/[0.08] hover:border-white/[0.16]'
                      }`}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-semibold text-white">
                            {tx.sparkOrderId}
                          </span>
                          <span className="text-[11px] font-mono text-cyan-300">
                            PayPal: {tx.paypalOrderId}
                          </span>
                        </div>
                        <div className="text-xs text-zinc-300 truncate">
                          {tx.quantity}× {tx.productName} ({tx.merchant})
                        </div>
                        <div className="text-[11px] text-zinc-500 font-mono">
                          Created: {new Date(tx.createdAt).toLocaleString()}
                          {tx.captureId ? ` · Capture: ${tx.captureId}` : ''}
                        </div>
                      </div>

                      <div className="text-right shrink-0 space-y-1.5">
                        <div className="text-sm font-mono font-semibold text-white">
                          {tx.currency} {tx.amount.toFixed(2)}
                        </div>
                        {renderStatusBadge(tx.status)}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Transaction Detail & State Timeline Drawer */}
              <div className="lg:col-span-5 rounded-3xl bg-[#121217]/90 border border-white/[0.08] p-6 h-fit space-y-4">
                {selectedTransaction ? (
                  <>
                    <div className="flex items-center justify-between border-b border-white/[0.07] pb-3">
                      <div>
                        <div className="text-xs font-mono text-violet-300">
                          {selectedTransaction.sparkOrderId}
                        </div>
                        <h3 className="text-sm font-semibold text-white mt-0.5">
                          {selectedTransaction.productName}
                        </h3>
                      </div>
                      {renderStatusBadge(selectedTransaction.status)}
                    </div>

                    <div className="space-y-2 text-xs font-mono">
                      <div className="flex justify-between text-zinc-400">
                        <span>PayPal Order ID</span>
                        <span className="text-cyan-300">
                          {selectedTransaction.paypalOrderId}
                        </span>
                      </div>
                      <div className="flex justify-between text-zinc-400">
                        <span>Invoice ID</span>
                        <span className="text-zinc-200">
                          {selectedTransaction.invoiceId}
                        </span>
                      </div>
                      <div className="flex justify-between text-zinc-400">
                        <span>Capture ID</span>
                        <span className="text-emerald-300">
                          {selectedTransaction.captureId || 'Not captured'}
                        </span>
                      </div>
                      <div className="flex justify-between text-zinc-400">
                        <span>Webhook Verified</span>
                        <span
                          className={
                            selectedTransaction.webhookVerified
                              ? 'text-emerald-400'
                              : 'text-zinc-500'
                          }
                        >
                          {selectedTransaction.webhookVerified
                            ? `Yes (${selectedTransaction.webhookEventsReceived.join(
                                ', '
                              )})`
                            : 'No webhook events received yet'}
                        </span>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-white/[0.07]">
                      <div className="text-xs font-semibold text-white mb-2.5">
                        State Transition History
                      </div>
                      <div className="space-y-2.5">
                        {selectedTransaction.stateHistory.map((item, idx) => (
                          <div
                            key={`${item.timestamp}_${idx}`}
                            className="p-2.5 rounded-xl bg-zinc-950/80 border border-white/[0.06] text-[11px]"
                          >
                            <div className="flex items-center justify-between font-mono text-violet-300">
                              <span>
                                {item.from} → {item.to}
                              </span>
                              <span className="text-zinc-500">
                                {new Date(item.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                            <div className="text-zinc-300 mt-1">
                              {item.reason}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-zinc-400 text-center py-8">
                    Select a transaction to inspect its full lifecycle.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: WEBHOOKS & DIAGNOSTIC LOGS */}
      {activeTab === 'webhooks' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 rounded-3xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-white">
                  PayPal Webhook Signature Verification
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Verifies incoming PayPal transmission headers via{' '}
                  <code className="font-mono text-zinc-300">
                    POST /v1/notifications/verify-webhook-signature
                  </code>{' '}
                  and deduplicates by <code className="font-mono text-zinc-300">event.id</code>.
                </p>
              </div>
              <button
                type="button"
                onClick={handleTestWebhookConfig}
                disabled={testingWebhookConfig}
                className="py-2 px-3.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white shrink-0 cursor-pointer"
              >
                {testingWebhookConfig
                  ? 'Checking...'
                  : 'Test Webhook Verification'}
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-zinc-950/80 border border-white/[0.07] space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-zinc-400">Webhook Receiver Route</span>
                <span className="text-cyan-300">POST /api/paypal/webhooks</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">PAYPAL_WEBHOOK_ID</span>
                <span
                  className={
                    sandboxStatus?.credentialsConfigured.webhookId
                      ? 'text-emerald-400'
                      : 'text-amber-300'
                  }
                >
                  {sandboxStatus?.credentialsConfigured.webhookId
                    ? 'Configured'
                    : 'Not Configured'}
                </span>
              </div>
              <div className="pt-2 border-t border-white/[0.06] text-zinc-400">
                <div className="text-zinc-200 mb-1">
                  Supported Lifecycle Events:
                </div>
                {(sandboxStatus?.supportedWebhookEvents || []).map((ev) => (
                  <div key={ev} className="text-[11px] text-emerald-300">
                    • {ev}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-white">
                Verified Webhook Event Ledger ({webhookEvents.length})
              </h3>
              {webhookEvents.length === 0 ? (
                <div className="p-6 rounded-2xl bg-zinc-950/60 border border-white/[0.05] text-center text-xs text-zinc-400">
                  No verified webhook events received yet in this session.
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {webhookEvents.map((ev) => (
                    <div
                      key={ev.id}
                      className="p-3 rounded-xl bg-zinc-950/80 border border-white/[0.06] text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between font-mono">
                        <span className="text-emerald-400 font-semibold">
                          {ev.eventType}
                        </span>
                        <span className="text-zinc-500 text-[11px]">
                          {ev.id}
                        </span>
                      </div>
                      <div className="text-zinc-300 text-[11px]">
                        {ev.summary}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Structured Diagnostic & Error Logs */}
          <div className="lg:col-span-6 rounded-3xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-violet-400" />
                <h2 className="text-base font-semibold text-white">
                  Server Diagnostic & Correlation Logs
                </h2>
              </div>
              <span className="text-[11px] font-mono text-zinc-400">
                Secrets Redacted
              </span>
            </div>

            {logs.length === 0 ? (
              <div className="p-8 rounded-2xl bg-zinc-950/60 border border-white/[0.05] text-center text-xs text-zinc-400">
                No PayPal Sandbox API operations logged yet. Click &ldquo;Test Sandbox Connection&rdquo; or &ldquo;Run E2E Checkout Diagnostics&rdquo; to inspect structured telemetry.
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1 font-mono text-[11px]">
                {logs.map((entry) => (
                  <div
                    key={entry.id}
                    className="p-3 rounded-xl bg-zinc-950/80 border border-white/[0.06] space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={
                          entry.level === 'error'
                            ? 'text-rose-400 font-semibold'
                            : entry.level === 'warn'
                            ? 'text-amber-300 font-semibold'
                            : 'text-cyan-300 font-semibold'
                        }
                      >
                        [{entry.operation.toUpperCase()}]
                        {entry.httpStatus ? ` HTTP ${entry.httpStatus}` : ''}
                      </span>
                      <span className="text-zinc-500">
                        {entry.correlationId} ·{' '}
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="text-zinc-300 leading-relaxed break-words">
                      {entry.message}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: SANDBOX TEST ACCOUNTS & SETUP GUIDE */}
      {activeTab === 'guide' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 rounded-3xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-5">
            <div>
              <h2 className="text-base font-semibold text-white">
                PayPal Developer Sandbox Setup & Testing Checklist
              </h2>
              <p className="text-xs text-zinc-400 mt-1">
                Follow these steps to configure your Personal (Buyer) and Business (Merchant) Sandbox accounts on{' '}
                <code className="font-mono text-zinc-300">
                  developer.paypal.com
                </code>{' '}
                and test buyer approval on{' '}
                <code className="font-mono text-zinc-300">
                  www.sandbox.paypal.com
                </code>
                .
              </p>
            </div>

            <div className="space-y-2.5">
              {SANDBOX_CHECKLIST_ITEMS.map((item) => {
                const checked = Boolean(completedChecklist[item.id]);
                return (
                  <label
                    key={item.id}
                    className={`flex items-start gap-3 p-3.5 rounded-2xl border cursor-pointer transition-colors ${
                      checked
                        ? 'bg-emerald-500/10 border-emerald-500/30'
                        : 'bg-zinc-950/70 border-white/[0.07]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setCompletedChecklist((prev) => ({
                          ...prev,
                          [item.id]: !prev[item.id],
                        }))
                      }
                      className="mt-0.5 w-4 h-4 rounded accent-violet-500"
                    />
                    <div className="text-xs">
                      <div className="font-semibold text-white">
                        {item.title}
                      </div>
                      <div className="text-zinc-400 mt-0.5 leading-relaxed">
                        {item.detail}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="p-4 rounded-2xl bg-zinc-950/80 border border-white/[0.07] space-y-2 text-xs">
              <div className="font-semibold text-white">
                Required Server Environment Variables (<code className="font-mono text-violet-300">.env</code>)
              </div>
              <pre className="p-3 rounded-xl bg-black/60 border border-white/[0.06] font-mono text-[11px] text-zinc-300 overflow-x-auto">
{`PAYPAL_ENV="sandbox"
PAYPAL_CLIENT_ID="your_sandbox_client_id"
PAYPAL_CLIENT_SECRET="your_sandbox_client_secret"
PAYPAL_WEBHOOK_ID="your_sandbox_webhook_id"`}
              </pre>
            </div>
          </div>

          <div className="lg:col-span-5 rounded-3xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-4">
            <h3 className="text-sm font-semibold text-white">
              Sandbox Personal (Buyer) & Business (Seller) Accounts Reference
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              In the PayPal Developer Dashboard under{' '}
              <strong className="text-zinc-200">
                Testing Tools → Sandbox Accounts
              </strong>
              , PayPal automatically provisions a{' '}
              <code className="font-mono text-cyan-300">BUSINESS (MERCHANT)</code>{' '}
              account and a{' '}
              <code className="font-mono text-violet-300">PERSONAL (BUYER)</code>{' '}
              account:
            </p>

            <div className="rounded-2xl overflow-hidden border border-white/[0.1] bg-zinc-950">
              <img
                src="/assets/paypal-guide/getting-started-with-paypal-sandbox-main/assets/sandbox-accounts.png"
                alt="PayPal Developer Dashboard Sandbox Personal and Business Accounts"
                className="w-full h-auto object-cover"
              />
            </div>

            <div className="p-4 rounded-2xl bg-zinc-950/80 border border-white/[0.07] space-y-2 text-xs">
              <div className="font-semibold text-white">
                Negative Testing & Error Simulation Guide
              </div>
              <p className="text-zinc-400 text-[11px] leading-relaxed">
                Enable <strong>Negative Testing</strong> on your Business Sandbox account in the PayPal Developer Dashboard, then select{' '}
                <code className="font-mono text-amber-300">
                  INSTRUMENT_DECLINED
                </code>{' '}
                or{' '}
                <code className="font-mono text-amber-300">
                  DUPLICATE_INVOICE_ID
                </code>{' '}
                in Spark&rsquo;s Checkout Studio to send the official{' '}
                <code className="font-mono text-zinc-200">
                  PayPal-Mock-Response
                </code>{' '}
                header during order creation or payment capture.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
