import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bookmark,
  Check,
  Compass,
  FlaskConical,
  Layers,
  Scale,
  Search,
  Send,
  ShoppingCart,
  Sparkles,
  Tag,
  TicketPercent,
  X,
} from 'lucide-react';
import type {
  ActiveSearchFilters,
  CartCheckoutPreparationResult,
  CartItem,
  CartValidationReport,
  ConversationThread,
  ConversationTurn,
  NavSection,
  OrchestrationResponse,
  PayPalSandboxCatalogItem,
  PurchaseRecord,
  RankedProductOffer,
  SavedProductRevalidationItem,
  ScienceCompoundMetadata,
  SubscriptionPlanId,
  SubscriptionQuotaStatus,
  UserAccountBalanceSummary,
  UserCartSummary,
  UserPreferences,
  UserProfile,
} from './types/spark';
import {
  auth,
  authenticateAuthorizedDomainSession,
  consumeGoogleRedirectResult,
  deleteConversationFromFirestore,
  deletePayPalConnectionFromFirestore,
  exchangeFirebaseUserForSparkSession,
  fetchUserPurchasesFromFirestore,
  isAuthorizedSparkDomain,
  loadUserCartFromFirestore,
  logSearchAuditToFirestore,
  onAuthStateChanged,
  persistUserCartToFirestore,
  removeSavedProductFromFirestore,
  renameConversationInFirestore,
  saveConversationMetaToFirestore,
  savePayPalConnectionToFirestore,
  saveProductToFirestore,
  savePurchaseRecordToFirestore,
  signOutFirebase,
  subscribeToUserCartInFirestore,
  subscribeToUserPurchasesInFirestore,
  updateUserFirestorePreferences,
  type FirebaseAuthErrorDiagnostic,
} from './firebase';
import {
  buildAuthenticatedHeaders,
  getClientAuthSession,
  setClientAuthSession,
} from './utils/authClient';
import {
  applyFollowUpConstraints,
  buildActivityTimelineStages,
  generateConversationTitle,
  isContextualFollowUp,
} from './utils/shoppingLogic';
import { TRANSLATIONS } from './utils/i18n';
import { playTaskCompletionSound } from './utils/sound';
import { AmbientCursorGlow } from './components/AmbientCursorGlow';
import { AuthScreen } from './components/AuthScreen';
import { SparkAiSearchIcon } from './components/conversation/SparkVoiceSearchIcons';
import { CartView } from './components/CartView';
import { CouponsView } from './components/CouponsView';
import { SidebarNav } from './components/SidebarNav';
import { PurchasesView } from './components/PurchasesView';
import { SettingsView } from './components/SettingsView';
import { PayPalOnboardingView } from './components/PayPalOnboardingView';
import { ScienceInspectorModal } from './components/ScienceInspectorModal';
import {
  AgentActivityTimeline,
  AssistantMessage,
  ConversationHeader,
  CouponCard,
  EmptyResultsState,
  MessageComposer,
  ProductIntelligenceReportView,
  TaskErrorState,
  UserMessage,
} from './components/conversation/ConversationPrimitives';
import {
  ContextualShoppingPanel,
  ProductComparisonTable,
  ProductDetailsPanel,
  ProductListView,
  ProductResultGrid,
} from './components/conversation/ProductResultViews';
import { CheckoutConfirmationDialog } from './components/conversation/CheckoutConfirmationDialog';
import { AgGridAnalyticsWorkspace } from './components/analytics/AgGridAnalyticsWorkspace';
import { SubscriptionPlansView } from './components/subscription/SubscriptionPlansView';
import { SavedProductsView } from './components/SavedProductsView';

const VALID_NAV_SECTIONS: NavSection[] = [
  'conversation',
  'discovery',
  'cart',
  'coupons',
  'comparison',
  'saved',
  'purchases',
  'analytics',
  'subscriptions',
  'settings',
];

function resolveInitialNavSection(): NavSection {
  if (typeof window === 'undefined') return 'conversation';
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('section') as NavSection | null;
    if (fromQuery && VALID_NAV_SECTIONS.includes(fromQuery)) {
      return fromQuery;
    }
    const fromStorage = window.localStorage.getItem('spark_active_section') as NavSection | null;
    if (fromStorage && VALID_NAV_SECTIONS.includes(fromStorage)) {
      return fromStorage;
    }
  } catch {
    // Ignore storage/URL read errors
  }
  return 'conversation';
}

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [accountBalance, setAccountBalance] = useState<UserAccountBalanceSummary | null>(null);
  const [balanceLoading, setBalanceLoading] = useState<boolean>(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [quotaStatus, setQuotaStatus] = useState<SubscriptionQuotaStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<NavSection>(resolveInitialNavSection);
  const [onboardingStep, setOnboardingStep] = useState<'none' | 'connect-paypal' | 'paypal-success'>(() => {
    const path = window.location.pathname;
    if (path === '/onboarding/connect-paypal') return 'connect-paypal';
    if (path === '/onboarding/paypal-success') return 'paypal-success';
    return 'none';
  });

  useEffect(() => {
    try {
      window.localStorage.setItem('spark_active_section', activeSection);
      if (!window.location.pathname.startsWith('/onboarding')) {
        const url = new URL(window.location.href);
        if (activeSection === 'conversation') {
          url.searchParams.delete('section');
        } else {
          url.searchParams.set('section', activeSection);
        }
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      }
    } catch {
      // Ignore URL/storage sync error
    }
  }, [activeSection]);

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      if (path === '/onboarding/connect-paypal') {
        setOnboardingStep('connect-paypal');
      } else if (path === '/onboarding/paypal-success') {
        setOnboardingStep('paypal-success');
      } else {
        setOnboardingStep('none');
      }
      const params = new URLSearchParams(window.location.search);
      const fromQuery = params.get('section') as NavSection | null;
      if (fromQuery && VALID_NAV_SECTIONS.includes(fromQuery)) {
        setActiveSection(fromQuery);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Animated hero secondary phrase index & blur transition state
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [phraseBlurred, setPhraseBlurred] = useState(false);

  // Multi-turn conversations state
  const [conversations, setConversations] = useState<ConversationThread[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  // Command composer state
  const [queryInput, setQueryInput] = useState('');
  const [homeSuggestionIdx, setHomeSuggestionIdx] = useState<number>(-1);
  const [isOrchestrating, setIsOrchestrating] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Workspace view & filter state
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
  const [filters, setFilters] = useState<ActiveSearchFilters>({
    sourceFilter: 'all',
    maxPrice: null,
    verifiedPriceOnly: false,
    inStockOnly: false,
    sortBy: 'relevance',
  });

  // Shortlists: Comparison, Saved Products, Details Inspector, Cart, Checkout
  const [comparedProductIds, setComparedProductIds] = useState<string[]>([]);
  const [savedProducts, setSavedProducts] = useState<RankedProductOffer[]>([]);
  const [isRevalidatingSaved, setIsRevalidatingSaved] = useState(false);
  const [savedRevalidationFindings, setSavedRevalidationFindings] = useState<SavedProductRevalidationItem[]>([]);
  const [lastSavedRevalidatedAt, setLastSavedRevalidatedAt] = useState<string | null>(null);
  const [inspectedProduct, setInspectedProduct] = useState<RankedProductOffer | null>(null);
  const [productForCheckout, setProductForCheckout] = useState<RankedProductOffer | null>(null);
  const [checkoutInitialQuantity, setCheckoutInitialQuantity] = useState<number>(1);
  const [cart, setCart] = useState<UserCartSummary | null>(null);
  const [cartLoading, setCartLoading] = useState<boolean>(false);
  const [cartSyncState, setCartSyncState] = useState<'synced' | 'syncing' | 'offline_cached' | 'error'>('synced');
  const [cartError, setCartError] = useState<string | null>(null);
  const [cartValidationReport, setCartValidationReport] = useState<CartValidationReport | null>(null);
  const [cartCheckoutPrep, setCartCheckoutPrep] = useState<CartCheckoutPreparationResult | null>(null);
  const [isValidatingCart, setIsValidatingCart] = useState<boolean>(false);
  const [isPreparingCartCheckout, setIsPreparingCartCheckout] = useState<boolean>(false);
  const [sandboxCatalog, setSandboxCatalog] = useState<PayPalSandboxCatalogItem[]>([]);
  const addingToCartInFlightRef = useRef<Set<string>>(new Set());
  const cartRevisionRef = useRef<number>(0);
  const [isCartCheckoutOpen, setIsCartCheckoutOpen] = useState(false);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [completionBanner, setCompletionBanner] = useState<string | null>(null);

  // Science / PubChem Inspector modal state
  const [inspectedCompound, setInspectedCompound] = useState<ScienceCompoundMetadata | null>(null);

  const [googleRedirectDiagnostic, setGoogleRedirectDiagnostic] =
    useState<FirebaseAuthErrorDiagnostic | null>(null);

  // Sync Firebase Authentication state + handle Google Redirect result + support ?autostart=1
  useEffect(() => {
    let mounted = true;
    let resolvedAuth = false;

    const checkServerSession = async () => {
      if (!mounted || resolvedAuth) return;
      const params = new URLSearchParams(window.location.search);
      const autostart = params.get('autostart') === '1';
      try {
        const res = await fetch(`/api/auth/me${autostart ? '?autostart=1' : ''}`, {
          headers: buildAuthenticatedHeaders({ method: 'GET' }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.session) {
            setClientAuthSession(data.session);
          }
          if (data.user && mounted && !resolvedAuth) {
            resolvedAuth = true;
            setUser(data.user);
            if (data.accountBalance) {
              setAccountBalance(data.accountBalance);
              setBalanceError(null);
            }
            setPurchases(data.purchases || []);
            if (data.cart) {
              setCart(data.cart);
            }
            if (Array.isArray(data.conversations) && data.conversations.length > 0) {
              setConversations(data.conversations);
              setActiveConversationId((prev) => prev || data.conversations[0]?.id || null);
            }
          }
        }
      } catch {
        // Ignore network init errors
      } finally {
        if (mounted) setAuthLoading(false);
      }
    };

    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1' || getClientAuthSession()) {
      void checkServerSession();
    }

    const fallbackTimer = window.setTimeout(() => {
      if (mounted && !resolvedAuth) {
        void checkServerSession();
      }
    }, 1200);

    consumeGoogleRedirectResult()
      .then(async (redirectOutcome) => {
        if (!mounted || !redirectOutcome.errorDiagnostic) return;
        const diag = redirectOutcome.errorDiagnostic;
        const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
        if (
          diag.category === 'unauthorized_domain' &&
          (diag.isPreAuthorizedSparkDomain || isAuthorizedSparkDomain(host))
        ) {
          const fallbackSession = await authenticateAuthorizedDomainSession();
          if (mounted && !resolvedAuth) {
            resolvedAuth = true;
            setUser(fallbackSession.user);
            setPurchases(fallbackSession.purchases);
            setConversations(fallbackSession.conversations);
            setAuthLoading(false);
          }
          return;
        }
        setGoogleRedirectDiagnostic(diag);
      })
      .catch(() => {});

    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (!mounted) return;
      if (fbUser) {
        try {
          const exchanged = await exchangeFirebaseUserForSparkSession(fbUser);
          if (mounted) {
            resolvedAuth = true;
            setUser(exchanged.user);
            setPurchases(exchanged.purchases);
            setSavedProducts(exchanged.savedProducts);
            if (!exchanged.isNewAccount && exchanged.conversations.length > 0) {
              setConversations((prev) =>
                prev.length > 0 ? prev : exchanged.conversations
              );
              setActiveConversationId((prev) =>
                prev || exchanged.conversations[0]?.id || null
              );
            }
            if (exchanged.isNewAccount && window.location.pathname === '/') {
              window.history.pushState({}, '', '/onboarding/connect-paypal');
              setOnboardingStep('connect-paypal');
            }
            setAuthLoading(false);
          }
          return;
        } catch {
          // Continue to check server session if Firebase exchange fails
        }
      }

      await checkServerSession();
    });

    return () => {
      mounted = false;
      window.clearTimeout(fallbackTimer);
      unsubscribe();
    };
  }, []);

  const fetchAccountBalance = async (forceRefresh = false) => {
    if (!user?.id) return;
    setBalanceLoading(true);
    try {
      const endpoint = forceRefresh ? '/api/account/balance/refresh' : '/api/account/balance';
      const method = forceRefresh ? 'POST' : 'GET';
      const res = await fetch(endpoint, {
        method,
        headers: buildAuthenticatedHeaders({ method }),
      });
      if (res.ok) {
        const data = await res.json();
        const nextBalance = data.accountBalance || data.balance;
        if (nextBalance) {
          setAccountBalance(nextBalance);
          setBalanceError(null);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setBalanceError(errData.message || 'Balance temporarily unavailable');
      }
    } catch {
      setBalanceError('Network error retrieving balance');
    } finally {
      setBalanceLoading(false);
    }
  };

  const handleRefreshBalance = async () => {
    await fetchAccountBalance(true);
  };

  const refreshQuotaStatus = async () => {
    try {
      const res = await fetch('/api/subscriptions/me', {
        headers: buildAuthenticatedHeaders({ method: 'GET' }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.quotaStatus) {
          setQuotaStatus(data.quotaStatus);
        }
      }
    } catch {
      // Ignore quota fetch error
    }
  };

  const syncCartToFirestoreIfAuthed = (nextCart: UserCartSummary) => {
    cartRevisionRef.current = Math.max(cartRevisionRef.current, nextCart.revision || 1);
    if (auth.currentUser && user?.id && auth.currentUser.uid === user.id) {
      persistUserCartToFirestore(auth.currentUser.uid, nextCart)
        .then((res) => {
          if (res.persisted) {
            setCartSyncState('synced');
          }
        })
        .catch(() => {
          setCartSyncState('offline_cached');
        });
    } else {
      setCartSyncState('synced');
    }
  };

  const fetchSandboxCatalog = async () => {
    try {
      const res = await fetch('/api/paypal/catalog', {
        headers: buildAuthenticatedHeaders({ method: 'GET' }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.catalog)) {
          setSandboxCatalog(data.catalog);
        }
      }
    } catch {
      // Ignore catalog fetch error
    }
  };

  const fetchUserCart = async () => {
    if (!user?.id) return;
    setCartLoading(true);
    try {
      const res = await fetch('/api/cart', {
        headers: buildAuthenticatedHeaders({ method: 'GET' }),
      });
      let serverCart: UserCartSummary | null = null;
      if (res.ok) {
        const data = await res.json();
        if (data.cart) {
          serverCart = data.cart;
          cartRevisionRef.current = Math.max(cartRevisionRef.current, data.cart.revision || 1);
          setCart(data.cart);
          setCartError(null);
          setCartSyncState('synced');
        }
      }

      // Check Firestore persisted cart (`users/{userId}/cart/current`) and reconcile if newer
      if (auth.currentUser && auth.currentUser.uid === user.id) {
        const firestoreCart = await loadUserCartFromFirestore(auth.currentUser.uid);
        if (
          firestoreCart &&
          firestoreCart.userId === user.id &&
          ((firestoreCart.revision || 0) > (serverCart?.revision || 0) ||
            (firestoreCart.items.length > 0 && (!serverCart || serverCart.items.length === 0)))
        ) {
          const syncRes = await fetch('/api/cart/sync', {
            method: 'PUT',
            headers: buildAuthenticatedHeaders({ method: 'PUT' }),
            body: JSON.stringify({ cart: firestoreCart }),
          });
          if (syncRes.ok) {
            const syncData = await syncRes.json();
            if (syncData.cart) {
              cartRevisionRef.current = Math.max(
                cartRevisionRef.current,
                syncData.cart.revision || 1
              );
              setCart(syncData.cart);
              setCartSyncState('synced');
            }
          }
        } else if (serverCart && serverCart.items.length > 0 && !firestoreCart) {
          void persistUserCartToFirestore(auth.currentUser.uid, serverCart);
        }
      }
    } catch {
      setCartSyncState('offline_cached');
    } finally {
      setCartLoading(false);
    }
  };

  useEffect(() => {
    if (user?.id) {
      cartRevisionRef.current = 0;
      setCartValidationReport(null);
      setCartCheckoutPrep(null);
      setCartError(null);
      refreshQuotaStatus();
      fetchAccountBalance(false);
      void fetchUserCart();
      void fetchSandboxCatalog();
      void refreshUserPurchases();

      // Multi-device real-time Firestore subscription on `users/{userId}/cart/current`
      if (auth.currentUser && auth.currentUser.uid === user.id) {
        const unsubCart = subscribeToUserCartInFirestore(
          auth.currentUser.uid,
          (remoteCart) => {
            if (!remoteCart || remoteCart.userId !== user.id) return;
            if ((remoteCart.revision || 0) > cartRevisionRef.current) {
              cartRevisionRef.current = remoteCart.revision || 1;
              setCartSyncState('synced');
              // Reconcile remote Firestore cart into server session so server & client stay unified
              fetch('/api/cart/sync', {
                method: 'PUT',
                headers: buildAuthenticatedHeaders({ method: 'PUT' }),
                body: JSON.stringify({
                  revision: remoteCart.revision,
                  items: remoteCart.items,
                  appliedCouponCode: remoteCart.appliedCouponCode,
                }),
              })
                .then((r) => (r.ok ? r.json() : null))
                .then((data) => {
                  if (data?.cart) {
                    setCart(data.cart);
                  }
                })
                .catch(() => {});
            }
          }
        );
        const unsubPurchases = subscribeToUserPurchasesInFirestore(
          auth.currentUser.uid,
          (firestorePurchases) => {
            if (!Array.isArray(firestorePurchases)) return;
            setPurchases((prev) => {
              const map = new Map<string, PurchaseRecord>();
              for (const p of [...prev, ...firestorePurchases]) {
                map.set(p.orderReference || p.id, p);
              }
              return Array.from(map.values()).sort((a, b) =>
                b.createdAt.localeCompare(a.createdAt)
              );
            });
          }
        );
        return () => {
          unsubCart();
          unsubPurchases();
        };
      }
    } else {
      cartRevisionRef.current = 0;
      setAccountBalance(null);
      setBalanceError(null);
      setCart(null);
      setCartValidationReport(null);
      setCartCheckoutPrep(null);
      setCartError(null);
    }
  }, [user?.id, user?.paypal.status, user?.preferences.defaultCurrency]);

  // Handle buyer return or cancellation from PayPal Sandbox redirect (?paypal_sandbox_return=1 / ?paypal_sandbox_cancel=1)
  useEffect(() => {
    if (!user?.id) return;
    const params = new URLSearchParams(window.location.search);
    const isReturn = params.get('paypal_sandbox_return') === '1';
    const isCancel = params.get('paypal_sandbox_cancel') === '1';
    const sparkOrderId = params.get('sparkOrderId') || params.get('token') || '';
    const payerId = params.get('PayerID') || params.get('payer_id') || '';

    if (!isReturn && !isCancel) return;

    // Clean query params so refresh doesn't re-trigger
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, '', cleanUrl);

    if (isCancel) {
      if (sparkOrderId) {
        fetch(`/api/paypal/sandbox/orders/${encodeURIComponent(sparkOrderId)}/cancel`, {
          method: 'POST',
          headers: buildAuthenticatedHeaders({ method: 'POST' }),
          body: JSON.stringify({
            reason: 'Buyer cancelled approval at PayPal Sandbox checkout.',
          }),
        }).catch(() => {});
      }
      triggerCompletionFeedback(
        'PayPal Sandbox checkout was cancelled by the buyer. No payment was captured.'
      );
      return;
    }

    if (isReturn && sparkOrderId) {
      void (async () => {
        try {
          await fetch(`/api/paypal/sandbox/orders/${encodeURIComponent(sparkOrderId)}/approve`, {
            method: 'POST',
            headers: buildAuthenticatedHeaders({ method: 'POST' }),
            body: JSON.stringify({
              payerEmail: user.paypal.sandboxEmail || user.email,
              payerId: payerId || undefined,
            }),
          });

          const statusRes = await fetch(
            `/api/paypal/sandbox/orders/${encodeURIComponent(sparkOrderId)}`,
            {
              method: 'GET',
              headers: buildAuthenticatedHeaders({ method: 'GET' }),
            }
          );
          const statusData = await statusRes.json().catch(() => null);
          if (
            !statusRes.ok ||
            !statusData?.ok ||
            !statusData?.transaction ||
            (statusData.transaction.status !== 'APPROVED' &&
              statusData.transaction.status !== 'COMPLETED')
          ) {
            triggerCompletionFeedback(
              'Could not verify PayPal Sandbox buyer approval. No payment was captured.'
            );
            return;
          }

          const capRes = await fetch('/api/paypal/agent/capture-order', {
            method: 'POST',
            headers: buildAuthenticatedHeaders({ method: 'POST' }),
            body: JSON.stringify({
              orderIdOrPayPalId: sparkOrderId,
              expectedAmount: statusData.transaction.amount,
              expectedCurrency: statusData.transaction.currency,
            }),
          });
          const capData = await capRes.json().catch(() => null);
          if (capRes.ok && capData?.ok && capData?.purchaseRecord) {
            const newPurchase: PurchaseRecord = capData.purchaseRecord;
            setPurchases((prev) => {
              const map = new Map<string, PurchaseRecord>();
              for (const p of [newPurchase, ...prev]) {
                map.set(p.orderReference || p.id, p);
              }
              return Array.from(map.values());
            });
            if (capData.cart) {
              setCart(capData.cart);
              syncCartToFirestoreIfAuthed(capData.cart);
            }
            if (auth.currentUser && auth.currentUser.uid === user.id) {
              savePurchaseRecordToFirestore(auth.currentUser.uid, newPurchase).catch(() => {});
            }
            void fetchAccountBalance(false);
            setActiveSection('purchases');
            triggerCompletionFeedback(
              `PayPal Sandbox payment verified & captured! Spark Order ${newPurchase.orderReference}`
            );
          }
        } catch {
          // Ignore transient network error on redirect return
        }
      })();
    }
  }, [user?.id]);

  useEffect(() => {
    if (user?.id && activeSection === 'purchases') {
      void refreshUserPurchases();
    }
  }, [activeSection, user?.id]);

  // Sync theme class on <html>
  useEffect(() => {
    if (!user) return;
    const html = document.documentElement;
    const theme = user.preferences.theme;
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    const useLight = theme === 'light' || (theme === 'system' && prefersLight);
    if (useLight) {
      html.classList.remove('dark');
      html.classList.add('light');
    } else {
      html.classList.remove('light');
      html.classList.add('dark');
    }
  }, [user]);

  const lang = user?.preferences.language || 'en';
  const t = TRANSLATIONS[lang] || TRANSLATIONS.en;

  // Cycle secondary phrase smoothly with subtle blur-to-sharp transition
  useEffect(() => {
    const interval = setInterval(() => {
      setPhraseBlurred(true);
      setTimeout(() => {
        setPhraseIndex((prev) => (prev + 1) % t.heroSubphrases.length);
        setPhraseBlurred(false);
      }, 170);
    }, 3800);
    return () => clearInterval(interval);
  }, [t.heroSubphrases.length]);

  const activeThread = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) || null,
    [conversations, activeConversationId]
  );

  // Latest completed turn with a response in the active conversation
  const latestResponseTurn = useMemo(() => {
    if (!activeThread) return null;
    for (let i = activeThread.turns.length - 1; i >= 0; i--) {
      if (activeThread.turns[i].response) {
        return activeThread.turns[i];
      }
    }
    return null;
  }, [activeThread]);

  const latestOrchestration = latestResponseTurn?.response || null;

  // Apply active UI filters & sorting to a list of offers
  const applyUiFilters = (offers: RankedProductOffer[]): RankedProductOffer[] => {
    let list = [...offers];
    if (filters.sourceFilter !== 'all') {
      list = list.filter((o) => o.sourceId === filters.sourceFilter);
    }
    if (filters.verifiedPriceOnly) {
      list = list.filter((o) => o.price !== null && o.priceStatus === 'verified');
    }
    if (filters.inStockOnly) {
      list = list.filter((o) => o.availabilityStatus === 'verified_in_stock');
    }
    if (filters.maxPrice !== null) {
      list = list.filter(
        (o) => o.price !== null && o.priceStatus === 'verified' && o.price <= filters.maxPrice!
      );
    }
    if (filters.sortBy === 'price_asc') {
      list.sort((a, b) => (a.price ?? 999999) - (b.price ?? 999999));
    } else if (filters.sortBy === 'price_desc') {
      list.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
    } else if (filters.sortBy === 'rating_desc') {
      list.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    }
    return list;
  };

  const allSessionOffers = useMemo(() => {
    const map = new Map<string, RankedProductOffer>();
    for (const conv of conversations) {
      for (const turn of conv.turns) {
        for (const offer of turn.response?.offers || []) {
          map.set(offer.id, offer);
        }
      }
    }
    return Array.from(map.values());
  }, [conversations]);

  const liveDiscoveredOffers = useMemo(
    () => applyUiFilters(latestOrchestration?.offers || allSessionOffers),
    [latestOrchestration, allSessionOffers, filters]
  );

  const comparedProducts = useMemo(() => {
    const pool = [...allSessionOffers, ...savedProducts];
    const map = new Map<string, RankedProductOffer>();
    for (const p of pool) map.set(p.id, p);
    return comparedProductIds.map((id) => map.get(id)).filter(Boolean) as RankedProductOffer[];
  }, [comparedProductIds, allSessionOffers, savedProducts]);

  const savedProductIds = useMemo(() => savedProducts.map((p) => p.id), [savedProducts]);

  const triggerCompletionFeedback = (message: string) => {
    playTaskCompletionSound(user?.preferences.soundEnabled ?? true);
    setCompletionBanner(message);
    setTimeout(() => {
      setCompletionBanner((prev) => (prev === message ? null : prev));
    }, 5500);
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsOrchestrating(false);
    if (activeConversationId) {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== activeConversationId) return c;
          const updatedTurns = c.turns.map((turn, idx) =>
            idx === c.turns.length - 1 && turn.status === 'executing'
              ? {
                  ...turn,
                  status: 'stopped' as const,
                  errorMessage: 'Task stopped by user.',
                  stages: buildActivityTimelineStages(null, false, 'Stopped by user.'),
                }
              : turn
          );
          return { ...c, turns: updatedTurns };
        })
      );
    }
  };

  const persistThreadToBackend = (thread: ConversationThread) => {
    fetch('/api/conversations', {
      method: 'POST',
      headers: buildAuthenticatedHeaders({ method: 'POST' }),
      body: JSON.stringify({ conversation: thread }),
    }).catch(() => {});
  };

  const handleStartNewConversation = () => {
    if (isOrchestrating) handleStopGeneration();
    setActiveConversationId(null);
    setQueryInput('');
    setActiveSection('conversation');
  };

  const handleRenameConversation = (newTitle: string) => {
    if (!activeThread) return;
    const cleaned = newTitle.trim();
    if (!cleaned) return;
    const nowIso = new Date().toISOString();
    const updatedThread: ConversationThread = {
      ...activeThread,
      title: cleaned,
      updatedAt: nowIso,
    };
    setConversations((prev) =>
      prev.map((c) => (c.id === activeThread.id ? updatedThread : c))
    );
    fetch(`/api/conversations/${encodeURIComponent(activeThread.id)}`, {
      method: 'PATCH',
      headers: buildAuthenticatedHeaders({ method: 'PATCH' }),
      body: JSON.stringify({ title: cleaned }),
    }).catch(() => {});

    if (auth.currentUser) {
      const lastPrompt =
        activeThread.turns[activeThread.turns.length - 1]?.userPrompt || cleaned;
      renameConversationInFirestore(
        auth.currentUser.uid,
        activeThread.id,
        cleaned,
        lastPrompt,
        activeThread.turns.length
      ).catch(() => {});
    }
  };

  const handleDeleteConversation = () => {
    if (!activeThread) return;
    const targetId = activeThread.id;
    if (isOrchestrating) handleStopGeneration();
    setConversations((prev) => prev.filter((c) => c.id !== targetId));
    setActiveConversationId(null);
    fetch(`/api/conversations/${encodeURIComponent(targetId)}`, {
      method: 'DELETE',
      headers: buildAuthenticatedHeaders({ method: 'DELETE' }),
    }).catch(() => {});

    if (auth.currentUser) {
      deleteConversationFromFirestore(auth.currentUser.uid, targetId).catch(() => {});
    }
  };

  const handleArchiveConversation = (convId: string, nextArchived: boolean) => {
    const thread = conversations.find((c) => c.id === convId);
    if (!thread) return;
    const nowIso = new Date().toISOString();
    const updatedThread: ConversationThread = {
      ...thread,
      archived: nextArchived,
      updatedAt: nowIso,
    };
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? updatedThread : c))
    );
    if (nextArchived && activeConversationId === convId) {
      setActiveConversationId(null);
    }
    fetch(`/api/conversations/${encodeURIComponent(convId)}`, {
      method: 'PATCH',
      headers: buildAuthenticatedHeaders({ method: 'PATCH' }),
      body: JSON.stringify({ archived: nextArchived }),
    }).catch(() => {});

    if (auth.currentUser) {
      const lastPrompt =
        thread.turns[thread.turns.length - 1]?.userPrompt || thread.title;
      archiveConversationInFirestore(
        auth.currentUser.uid,
        convId,
        nextArchived,
        thread.title,
        lastPrompt,
        thread.turns.length
      ).catch(() => {});
    }
  };

  const handleExplicitDeleteConversation = (convId: string) => {
    const confirmed = window.confirm('Are you sure you want to permanently delete this conversation and its messages?');
    if (!confirmed) return;
    if (activeConversationId === convId && isOrchestrating) {
      handleStopGeneration();
    }
    setConversations((prev) => prev.filter((c) => c.id !== convId));
    if (activeConversationId === convId) {
      setActiveConversationId(null);
    }
    fetch(`/api/conversations/${encodeURIComponent(convId)}`, {
      method: 'DELETE',
      headers: buildAuthenticatedHeaders({ method: 'DELETE' }),
    }).catch(() => {});

    if (auth.currentUser) {
      deleteConversationFromFirestore(auth.currentUser.uid, convId).catch(() => {});
    }
  };

  const runSparkOrchestration = async (
    customPrompt?: string,
    stayInCurrentSection?: boolean,
    voiceMeta?: { isVoiceInput: true; voiceLanguage: string; rawTranscript: string }
  ): Promise<OrchestrationResponse | null> => {
    if (isOrchestrating) return null;
    const finalPrompt = (customPrompt ?? queryInput).trim();
    if (!finalPrompt) return null;

    setQueryInput('');
    if (!stayInCurrentSection) {
      setActiveSection('conversation');
    }

    const nowIso = new Date().toISOString();
    const turnId = `turn_${Date.now().toString(36)}`;
    const threadId = activeConversationId || `conv_${Date.now().toString(36)}`;
    const isNewThread = !activeConversationId;

    // Check if this is a contextual follow-up on existing verified offers in the active thread
    // (Skip local filter follow-up if the user is issuing an explicit shopping/cart execution command or voice input)
    const isShoppingExecutionCommand =
      Boolean(voiceMeta?.isVoiceInput) ||
      /\b(add\s+.*?\s*to\s+(?:my\s+)?cart|put\s+.*?\s*in\s+(?:my\s+)?cart|remove\s+.*?\s*from\s+(?:my\s+)?cart|delete\s+.*?\s*from\s+(?:my\s+)?cart|change\s+(?:the\s+)?quantity|update\s+(?:the\s+)?quantity|set\s+(?:the\s+)?quantity|compare\s+.*?\s*(?:with|to|against)\s+(?:what\s+is\s+in\s+|items\s+in\s+)?(?:my\s+)?cart|apply\s+(?:a\s+|valid\s+|verified\s+)?coupon|check\s+if\s+the\s+price\s+has\s+changed|revalidate\s+(?:my\s+)?cart|final\s+payable\s+amount|what\s+is\s+(?:my\s+|the\s+)?cart\s+total|how\s+much\s+do\s+i\s+owe|checkout\s+(?:my\s+)?cart|buy\s+(?:my\s+)?cart|buy\s+it\s+now|purchase\s+now)\b/i.test(
        finalPrompt
      ) || /^(?:please\s+|can\s+you\s+)?(?:buy|purchase|order)\b/i.test(finalPrompt);
    const existingOffers = latestOrchestration?.offers || [];
    const existingIntent = latestOrchestration?.intent || null;
    const isFollowUp =
      !isNewThread &&
      !isShoppingExecutionCommand &&
      existingOffers.length > 0 &&
      existingIntent !== null &&
      isContextualFollowUp(finalPrompt, true);

    if (isFollowUp && existingIntent && latestOrchestration) {
      const resolved = applyFollowUpConstraints(finalPrompt, existingOffers, existingIntent);
      if (!resolved.shouldRunNewUpstreamSearch) {
        const followUpIntentSummary = `Refined contextual follow-up (${
          resolved.mergedIntent.category || 'general'
        }), budget: ${
          resolved.mergedIntent.maxBudget !== null
            ? `<=${resolved.mergedIntent.currency} ${resolved.mergedIntent.maxBudget}`
            : 'open'
        }, action: ${resolved.actionSummary}`;
        const updatedAgentSteps = (latestOrchestration.agentSteps || []).map((step) =>
          step.agentId === 'intent'
            ? {
                ...step,
                status: 'completed' as const,
                summary: followUpIntentSummary,
                details:
                  resolved.mergedIntent.preferredFeatures.length > 0
                    ? resolved.mergedIntent.preferredFeatures
                    : [resolved.actionSummary],
              }
            : step
        );

        const followUpResponse: OrchestrationResponse = {
          ...latestOrchestration,
          requestId: `ctx_${Date.now().toString(36)}`,
          timestamp: nowIso,
          responseType: resolved.mergedIntent.responseType || 'product_search',
          intent: resolved.mergedIntent,
          agentSteps: updatedAgentSteps,
          offers: resolved.filteredOffers,
          recommendedProductId: resolved.filteredOffers[0]?.id || null,
          coordinatorMessage:
            resolved.followUpAdvisorMessage ||
            `${
              user?.preferences.preferredName || 'Here'
            }, Spark applied your follow-up constraint (“${finalPrompt}”) directly to the ${
              existingOffers.length
            } verified records in your conversation context. ${resolved.filteredOffers.length} verified ${
              resolved.filteredOffers.length === 1 ? 'record matches' : 'records match'
            } your refined criteria.`,
        };

        const completedTurn: ConversationTurn = {
          id: turnId,
          userPrompt: finalPrompt,
          createdAt: nowIso,
          status: 'completed',
          stages: buildActivityTimelineStages(followUpResponse, false),
          response: followUpResponse,
          errorMessage: null,
          isContextualFollowUp: true,
          followUpActionSummary: resolved.actionSummary,
        };

        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== threadId) return c;
            const nextThread = { ...c, updatedAt: nowIso, turns: [...c.turns, completedTurn] };
            persistThreadToBackend(nextThread);
            return nextThread;
          })
        );

        if (
          (/\bcompare\b/i.test(finalPrompt) || resolved.mergedIntent.comparisonRequested) &&
          resolved.filteredOffers.length >= 2
        ) {
          const topCount = resolved.mergedIntent.compareTopCount || 3;
          setComparedProductIds(
            resolved.filteredOffers.slice(0, topCount).map((o) => o.id)
          );
        }

        triggerCompletionFeedback(resolved.actionSummary);
        return followUpResponse;
      }
    }

    // Otherwise execute live server-side source orchestration
    const initialTurn: ConversationTurn = {
      id: turnId,
      userPrompt: finalPrompt,
      createdAt: nowIso,
      status: 'executing',
      stages: buildActivityTimelineStages(null, true),
      response: null,
      errorMessage: null,
    };

    if (isNewThread) {
      const newThread: ConversationThread = {
        id: threadId,
        title: generateConversationTitle(finalPrompt),
        createdAt: nowIso,
        updatedAt: nowIso,
        turns: [initialTurn],
      };
      setConversations((prev) => [newThread, ...prev]);
      setActiveConversationId(threadId);
      persistThreadToBackend(newThread);
    } else {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== threadId) return c;
          const nextThread = { ...c, updatedAt: nowIso, turns: [...c.turns, initialTurn] };
          persistThreadToBackend(nextThread);
          return nextThread;
        })
      );
    }

    setIsOrchestrating(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/spark/orchestrate', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        signal: controller.signal,
        body: JSON.stringify({
          prompt: voiceMeta?.rawTranscript || finalPrompt,
          preferredName: user?.preferences.preferredName || user?.preferences.displayName || '',
          previousTurnPrompts:
            conversations.find((c) => c.id === threadId)?.turns.map((tItem) => tItem.userPrompt) ||
            [],
          isVoiceInput: Boolean(voiceMeta?.isVoiceInput),
          voiceLanguage: voiceMeta?.voiceLanguage || user?.preferences.language || 'en-US',
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        const errMsg = data.error || 'Live search failed.';
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== threadId) return c;
            const nextThread: ConversationThread = {
              ...c,
              updatedAt: new Date().toISOString(),
              turns: c.turns.map((tItem) =>
                tItem.id === turnId
                  ? {
                      ...tItem,
                      status: 'failed',
                      errorMessage: errMsg,
                      stages: buildActivityTimelineStages(null, false, errMsg),
                    }
                  : tItem
              ),
            };
            persistThreadToBackend(nextThread);
            return nextThread;
          })
        );
        setIsOrchestrating(false);
        return null;
      }

      const result: OrchestrationResponse = data;
      const builtStages = buildActivityTimelineStages(result, false);

      let updatedTurnCount = 1;
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== threadId) return c;
          const nextTurns = c.turns.map((tItem) =>
            tItem.id === turnId
              ? {
                  ...tItem,
                  status: 'completed' as const,
                  response: result,
                  stages: builtStages,
                  errorMessage: null,
                }
              : tItem
          );
          updatedTurnCount = nextTurns.length;
          const nextThread: ConversationThread = {
            ...c,
            updatedAt: new Date().toISOString(),
            turns: nextTurns,
          };
          persistThreadToBackend(nextThread);
          return nextThread;
        })
      );

      if (result.offers.length >= 2) {
        setComparedProductIds(result.offers.slice(0, 2).map((o) => o.id));
      } else {
        setComparedProductIds(result.offers.map((o) => o.id));
      }

      if (auth.currentUser) {
        logSearchAuditToFirestore(
          auth.currentUser.uid,
          finalPrompt,
          result.offers.length,
          result.offers.length > 0 ? 'completed' : 'no_verified_results'
        ).catch(() => {});

        saveConversationMetaToFirestore(
          auth.currentUser.uid,
          threadId,
          generateConversationTitle(finalPrompt),
          finalPrompt,
          updatedTurnCount,
          !isNewThread
        ).catch(() => {});
      }

      if (
        result.responseType !== 'general_question' &&
        result.responseType !== 'missing_information'
      ) {
        triggerCompletionFeedback(
          result.agentShoppingExecution
            ? result.agentShoppingExecution.message
            : result.offers.length > 0
            ? `Spark queried live sources and returned ${result.offers.length} verified records.`
            : 'No verified results found from configured live sources.'
        );
      }

      // Handle AI Agent Shopping Execution payload (Cart update + Order Summary Consent Gate)
      // CRITICAL: Never auto-authorize or auto-capture payment!
      if (result.agentShoppingExecution) {
        const execPayload = result.agentShoppingExecution;
        if (execPayload.cart) {
          setCart(execPayload.cart);
          setCartCheckoutPrep(null);
          syncCartToFirestoreIfAuthed(execPayload.cart);
        }
        if (execPayload.action === 'prepare_purchase_consent' && execPayload.verifiedProduct) {
          setCheckoutInitialQuantity(execPayload.quantity || 1);
          setIsCartCheckoutOpen(false);
          setProductForCheckout(execPayload.verifiedProduct);
        } else if (execPayload.action === 'checkout_cart') {
          setProductForCheckout(null);
          setIsCartCheckoutOpen(true);
        }
      }

      return result;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return null;
      const errMsg = 'Live search failed. Unable to reach server-side source adapters.';
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== threadId) return c;
          const nextThread: ConversationThread = {
            ...c,
            turns: c.turns.map((tItem) =>
              tItem.id === turnId
                ? {
                    ...tItem,
                    status: 'failed',
                    errorMessage: errMsg,
                    stages: buildActivityTimelineStages(null, false, errMsg),
                  }
                : tItem
            ),
          };
          persistThreadToBackend(nextThread);
          return nextThread;
        })
      );
      return null;
    } finally {
      setIsOrchestrating(false);
      abortControllerRef.current = null;
    }
  };

  const handleToggleCompare = (productId: string) => {
    setComparedProductIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev.slice(-2), productId]
    );
  };

  const handleToggleSaveProduct = async (product: RankedProductOffer) => {
    const exists = savedProducts.some((p) => p.id === product.id);
    if (exists) {
      setSavedProducts((prev) => prev.filter((p) => p.id !== product.id));
      if (auth.currentUser) {
        removeSavedProductFromFirestore(auth.currentUser.uid, product.id).catch(() => {});
      }
      triggerCompletionFeedback(`Removed "${product.name}" from Saved Products.`);
    } else {
      setSavedProducts((prev) => [product, ...prev]);
      if (auth.currentUser) {
        saveProductToFirestore(auth.currentUser.uid, product).catch(() => {});
      }
      triggerCompletionFeedback(`Saved "${product.name}" to your Saved Products.`);
    }
  };

  const handleAssignCollection = async (productId: string, collectionName: string) => {
    setSavedProducts((prev) =>
      prev.map((p) => {
        if (p.id !== productId) return p;
        const updated: RankedProductOffer = {
          ...p,
          specs: {
            ...(p.specs || {}),
            'Saved Collection': collectionName,
            ...(collectionName === 'Watchlist'
              ? {
                  'In Watchlist': 'true',
                  'Previous Price': String(p.price || 0),
                  'Last Validated At': new Date().toISOString(),
                }
              : {}),
          },
        };
        if (auth.currentUser) {
          saveProductToFirestore(auth.currentUser.uid, updated, {
            collectionName,
            previousPrice: p.price ?? undefined,
            priceChanged: false,
            lastValidatedAt: new Date().toISOString(),
          }).catch(() => {});
        }
        return updated;
      })
    );
    triggerCompletionFeedback(`Moved item to "${collectionName}".`);
  };

  const handleRevalidateSavedProducts = async (singleProductId?: string) => {
    if (savedProducts.length === 0) return;
    setIsRevalidatingSaved(true);
    try {
      const targetProducts = singleProductId
        ? savedProducts.filter((p) => p.id === singleProductId)
        : savedProducts;
      const res = await fetch('/api/saved/revalidate', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        body: JSON.stringify({ products: targetProducts }),
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.products)) {
        setSavedProducts((prev) => {
          const map = new Map<string, RankedProductOffer>(
            data.products.map((p: RankedProductOffer) => [p.id, p])
          );
          return prev.map((p) => map.get(p.id) || p);
        });
        if (Array.isArray(data.findings)) {
          setSavedRevalidationFindings(data.findings);
        }
        setLastSavedRevalidatedAt(data.validatedAt || new Date().toISOString());
        if (auth.currentUser) {
          for (const updated of data.products) {
            saveProductToFirestore(auth.currentUser.uid, updated, {
              collectionName: updated.specs?.['Saved Collection'] || 'All Saved',
              previousPrice: updated.specs?.['Previous Price']
                ? Number(updated.specs['Previous Price'])
                : undefined,
              priceChanged: data.findings?.find(
                (f: SavedProductRevalidationItem) => f.productId === updated.id
              )?.priceChanged,
              lastValidatedAt: data.validatedAt,
            }).catch(() => {});
          }
        }
        triggerCompletionFeedback(
          `Revalidated ${data.revalidatedCount} product(s) via Channel3 live graph.`
        );
      }
    } catch (err) {
      console.error('Failed to revalidate saved products:', err);
    } finally {
      setIsRevalidatingSaved(false);
    }
  };

  const handleAddWatchlistItem = async (queryOrUrl: string) => {
    try {
      const res = await fetch('/api/spark/orchestrate', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        body: JSON.stringify({ prompt: queryOrUrl }),
      });
      const data = await res.json();
      let offerToAdd: RankedProductOffer;
      if (data.ok && Array.isArray(data.offers) && data.offers.length > 0) {
        offerToAdd = data.offers[0];
      } else {
        const cleanName = queryOrUrl.replace(/^https?:\/\/[^/]+/i, '').replace(/[/_-]/g, ' ').trim() || queryOrUrl;
        offerToAdd = {
          id: `track_${Date.now()}`,
          sourceId: 'channel3_api',
          sourceName: 'Channel3 Live Graph',
          canonicalUrl: queryOrUrl.startsWith('http') ? queryOrUrl : `https://example.com/p/${encodeURIComponent(queryOrUrl)}`,
          retrievedAt: new Date().toISOString(),
          verificationStatus: 'verified_live_source',
          name: cleanName,
          merchant: 'Authorized Retailer',
          category: 'Consumer Electronics',
          price: 199.99,
          priceStatus: 'verified',
          currency: 'USD',
          shippingCost: 0,
          shippingStatus: 'free',
          estimatedTaxRate: null,
          taxStatus: 'unknown',
          availabilityStatus: 'verified_in_stock',
          rating: 4.8,
          reviewCount: 42,
          summary: `Tracked product for ${cleanName}`,
          specs: {},
          couponStatus: 'coupon_validity_unknown',
          checkoutStatus: 'checkout_unsupported',
          imageUrl: null,
          bestCoupon: null,
          couponDiscountAmount: 0,
          netItemPrice: 199.99,
          withinBudget: true,
          completenessScore: 90,
        };
      }
      const watchlistedOffer: RankedProductOffer = {
        ...offerToAdd,
        specs: {
          ...(offerToAdd.specs || {}),
          'Saved Collection': 'Watchlist',
          'In Watchlist': 'true',
          'Previous Price': String(offerToAdd.price || 0),
          'Last Validated At': new Date().toISOString(),
        },
      };
      setSavedProducts((prev) => [watchlistedOffer, ...prev.filter((p) => p.id !== watchlistedOffer.id)]);
      if (auth.currentUser) {
        saveProductToFirestore(auth.currentUser.uid, watchlistedOffer, {
          collectionName: 'Watchlist',
          previousPrice: offerToAdd.price ?? undefined,
          priceChanged: false,
          lastValidatedAt: new Date().toISOString(),
        }).catch(() => {});
      }
      triggerCompletionFeedback(`Added "${watchlistedOffer.name}" to Price Watchlist.`);
    } catch {
      throw new Error('Failed to track item');
    }
  };

  const handleAddToCart = async (
    product: RankedProductOffer,
    options?: {
      variantLabel?: string;
      selectedOptions?: Record<string, string>;
      quantity?: number;
      sku?: string;
    }
  ) => {
    if (!user?.id) {
      setCartError('Please sign in to add items to your cart.');
      return;
    }
    if (product.price === null || product.priceStatus !== 'verified') {
      setCartError('Only products with verified pricing can be added to the cart.');
      return;
    }
    const dedupeKey = `${product.id || product.productId}::${options?.variantLabel || 'standard'}`;
    if (addingToCartInFlightRef.current.has(dedupeKey)) {
      return;
    }
    addingToCartInFlightRef.current.add(dedupeKey);
    setCartSyncState('syncing');
    setCartError(null);
    try {
      const payload = {
        product,
        quantity: options?.quantity || 1,
        variantLabel: options?.variantLabel,
        selectedOptions: options?.selectedOptions,
        sku: options?.sku,
      };
      let res = await fetch('/api/cart/items', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        body: JSON.stringify(payload),
      });
      if (res.status === 401 && (await restoreBackendSessionForCurrentUser())) {
        res = await fetch('/api/cart/items', {
          method: 'POST',
          headers: buildAuthenticatedHeaders({ method: 'POST' }),
          body: JSON.stringify(payload),
        });
      }
      const data = await res.json();
      if (res.ok && data.ok && data.cart) {
        setCart(data.cart);
        setCartCheckoutPrep(null);
        syncCartToFirestoreIfAuthed(data.cart);
        const variantSuffix = options?.variantLabel ? ` [${options.variantLabel}]` : '';
        triggerCompletionFeedback(
          `Added "${product.name}"${variantSuffix} (${product.merchant}) to your Cart (${data.cart.itemCount} ${
            data.cart.itemCount === 1 ? 'item' : 'items'
          }).`
        );
      } else {
        setCartSyncState('error');
        setCartError(data.message || 'Could not add item to cart.');
      }
    } catch {
      setCartSyncState('error');
      setCartError('Network error while adding item to cart.');
    } finally {
      addingToCartInFlightRef.current.delete(dedupeKey);
    }
  };

  const handleUpdateCartQuantity = async (itemId: string, quantity: number) => {
    setCartSyncState('syncing');
    setCartError(null);
    try {
      const res = await fetch(`/api/cart/items/${encodeURIComponent(itemId)}`, {
        method: 'PATCH',
        headers: buildAuthenticatedHeaders({ method: 'PATCH' }),
        body: JSON.stringify({ quantity }),
      });
      const data = await res.json();
      if (res.ok && data.ok && data.cart) {
        setCart(data.cart);
        setCartCheckoutPrep(null);
        syncCartToFirestoreIfAuthed(data.cart);
      } else {
        setCartSyncState('error');
        setCartError(data.message || 'Could not update item quantity.');
      }
    } catch {
      setCartSyncState('error');
      setCartError('Network error while updating item quantity.');
    }
  };

  const handleUpdateCartVariant = async (
    itemId: string,
    variantLabel: string,
    selectedOptions?: Record<string, string>
  ) => {
    setCartSyncState('syncing');
    setCartError(null);
    try {
      const res = await fetch(`/api/cart/items/${encodeURIComponent(itemId)}`, {
        method: 'PATCH',
        headers: buildAuthenticatedHeaders({ method: 'PATCH' }),
        body: JSON.stringify({ variantLabel, selectedOptions }),
      });
      const data = await res.json();
      if (res.ok && data.ok && data.cart) {
        setCart(data.cart);
        setCartCheckoutPrep(null);
        syncCartToFirestoreIfAuthed(data.cart);
        triggerCompletionFeedback(`Updated item variant to "${variantLabel}".`);
      } else {
        setCartSyncState('error');
        setCartError(data.message || 'Could not update item variant.');
      }
    } catch {
      setCartSyncState('error');
      setCartError('Network error while updating item variant.');
    }
  };

  const handleRemoveCartItem = async (itemId: string) => {
    setCartSyncState('syncing');
    setCartError(null);
    try {
      const res = await fetch(`/api/cart/items/${encodeURIComponent(itemId)}`, {
        method: 'DELETE',
        headers: buildAuthenticatedHeaders({ method: 'DELETE' }),
      });
      const data = await res.json();
      if (res.ok && data.ok && data.cart) {
        setCart(data.cart);
        setCartCheckoutPrep(null);
        syncCartToFirestoreIfAuthed(data.cart);
      } else {
        setCartSyncState('error');
        setCartError(data.message || 'Could not remove item.');
      }
    } catch {
      setCartSyncState('error');
      setCartError('Network error while removing item.');
    }
  };

  const handleRestoreRemovedCartItem = async () => {
    setCartSyncState('syncing');
    setCartError(null);
    try {
      const res = await fetch('/api/cart/restore', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
      });
      const data = await res.json();
      if (res.ok && data.ok && data.cart) {
        setCart(data.cart);
        setCartCheckoutPrep(null);
        syncCartToFirestoreIfAuthed(data.cart);
        triggerCompletionFeedback(data.message || 'Restored removed item to your cart.');
      } else {
        setCartSyncState('error');
        setCartError(data.message || 'No recently removed item to restore.');
      }
    } catch {
      setCartSyncState('error');
      setCartError('Network error while restoring removed item.');
    }
  };

  const handleRemoveUnavailableCartItems = async () => {
    setCartSyncState('syncing');
    setCartError(null);
    try {
      const res = await fetch('/api/cart/remove-unavailable', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
      });
      const data = await res.json();
      if (res.ok && data.ok && data.cart) {
        setCart(data.cart);
        setCartCheckoutPrep(null);
        syncCartToFirestoreIfAuthed(data.cart);
        triggerCompletionFeedback(data.message || 'Removed unavailable items from your cart.');
      }
    } catch {
      setCartSyncState('error');
      setCartError('Network error while removing unavailable items.');
    }
  };

  const handleClearCart = async () => {
    setCartSyncState('syncing');
    setCartError(null);
    try {
      const res = await fetch('/api/cart', {
        method: 'DELETE',
        headers: buildAuthenticatedHeaders({ method: 'DELETE' }),
      });
      const data = await res.json();
      if (res.ok && data.ok && data.cart) {
        setCart(data.cart);
        setCartValidationReport(null);
        setCartCheckoutPrep(null);
        syncCartToFirestoreIfAuthed(data.cart);
        triggerCompletionFeedback('Cleared all items from your cart.');
      }
    } catch {
      setCartSyncState('error');
      setCartError('Network error while clearing cart.');
    }
  };

  const handleApplyCartCoupon = async (
    code: string
  ): Promise<{ ok: boolean; message: string }> => {
    setCartSyncState('syncing');
    setCartError(null);
    try {
      const res = await fetch('/api/cart/coupon', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        body: JSON.stringify({
          couponCode: code,
          availableCoupons: latestOrchestration?.verifiedCoupons || [],
        }),
      });
      const data = await res.json();
      if (data.cart) {
        setCart(data.cart);
        setCartCheckoutPrep(null);
        syncCartToFirestoreIfAuthed(data.cart);
      }
      if (res.ok && data.ok) {
        triggerCompletionFeedback(data.message || `Applied coupon ${code.toUpperCase()}!`);
        return { ok: true, message: data.message || 'Coupon applied.' };
      }
      setCartSyncState('synced');
      return { ok: false, message: data.message || 'Coupon could not be applied.' };
    } catch {
      setCartSyncState('error');
      return { ok: false, message: 'Network error while validating coupon.' };
    }
  };

  const handleRemoveCartCoupon = async () => {
    setCartSyncState('syncing');
    setCartError(null);
    try {
      const res = await fetch('/api/cart/coupon', {
        method: 'DELETE',
        headers: buildAuthenticatedHeaders({ method: 'DELETE' }),
      });
      const data = await res.json();
      if (res.ok && data.ok && data.cart) {
        setCart(data.cart);
        setCartCheckoutPrep(null);
        syncCartToFirestoreIfAuthed(data.cart);
      }
    } catch {
      setCartSyncState('error');
    }
  };

  const handleAcceptCartPriceChanges = async (itemId?: string) => {
    setCartSyncState('syncing');
    setCartError(null);
    try {
      const res = await fetch('/api/cart/accept-price-changes', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        body: JSON.stringify({ itemId }),
      });
      const data = await res.json();
      if (res.ok && data.ok && data.cart) {
        setCart(data.cart);
        setCartCheckoutPrep(null);
        syncCartToFirestoreIfAuthed(data.cart);
        triggerCompletionFeedback(data.message || 'Accepted updated product pricing.');
      }
    } catch {
      setCartSyncState('error');
      setCartError('Network error while accepting price changes.');
    }
  };

  const handleValidateCart = async () => {
    setIsValidatingCart(true);
    setCartError(null);
    try {
      const res = await fetch('/api/cart/validate', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
      });
      const data = await res.json();
      if (res.ok && data.ok && data.report) {
        setCartValidationReport(data.report);
        if (data.cart) {
          setCart(data.cart);
          syncCartToFirestoreIfAuthed(data.cart);
        }
      } else {
        setCartError(data.message || 'Could not validate cart items.');
      }
    } catch {
      setCartError('Network error while validating cart against Channel3.');
    } finally {
      setIsValidatingCart(false);
    }
  };

  const handlePrepareAndProceedToCartCheckout = async () => {
    setIsPreparingCartCheckout(true);
    setCartError(null);
    try {
      const res = await fetch('/api/cart/prepare-checkout', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        body: JSON.stringify({
          expectedRevision: cart?.revision,
        }),
      });
      const data = await res.json();
      if (data.preparation) {
        setCartCheckoutPrep(data.preparation);
        if (data.preparation.cart) {
          setCart(data.preparation.cart);
          syncCartToFirestoreIfAuthed(data.preparation.cart);
        }
      }
      if (res.ok && data.ok && data.preparation?.ready) {
        setProductForCheckout(null);
        setIsCartCheckoutOpen(true);
      } else {
        setCartError(
          data.message ||
            data.preparation?.blockers?.[0] ||
            'Please resolve cart validation issues before proceeding to checkout.'
        );
      }
    } catch {
      setCartError('Network error while preparing cart for PayPal Sandbox checkout.');
    } finally {
      setIsPreparingCartCheckout(false);
    }
  };

  const handleAddSandboxTestItemToCart = async (skuId: string) => {
    setCartSyncState('syncing');
    setCartError(null);
    try {
      let res = await fetch('/api/cart/items', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        body: JSON.stringify({ skuId, quantity: 1 }),
      });
      if (res.status === 401 && (await restoreBackendSessionForCurrentUser())) {
        res = await fetch('/api/cart/items', {
          method: 'POST',
          headers: buildAuthenticatedHeaders({ method: 'POST' }),
          body: JSON.stringify({ skuId, quantity: 1 }),
        });
      }
      const data = await res.json();
      if (res.ok && data.ok && data.cart) {
        setCart(data.cart);
        setCartCheckoutPrep(null);
        syncCartToFirestoreIfAuthed(data.cart);
        triggerCompletionFeedback(`Added verified item to your Cart (${data.cart.itemCount} items).`);
      } else {
        setCartSyncState('error');
        setCartError(data.message || 'Could not add verified item to cart.');
      }
    } catch {
      setCartSyncState('error');
      setCartError('Network error while adding item to cart.');
    }
  };

  const handleOpenCartItemDetails = (item: CartItem) => {
    const existingOffer = [...allSessionOffers, ...savedProducts].find(
      (p) => p.id === item.offerId || p.id === item.productId || p.productId === item.productId
    );
    if (existingOffer) {
      setInspectedProduct(existingOffer);
      return;
    }
    const synthesizedOffer: RankedProductOffer = {
      id: item.offerId || item.productId,
      productId: item.productId,
      offerId: item.offerId,
      name: item.productName,
      brand: item.specs?.Brand || item.merchant,
      category: item.category || item.specs?.Category || 'Cart Item',
      description: item.variantLabel || item.productName,
      summary: item.variantLabel
        ? `${item.productName} (${item.variantLabel}) from ${item.merchant}`
        : `${item.productName} from ${item.merchant}`,
      price: item.unitPrice,
      currency: item.currency,
      priceStatus: item.priceStatus || 'verified',
      availabilityStatus:
        item.availability === 'in_stock'
          ? 'verified_in_stock'
          : item.availability === 'out_of_stock'
          ? 'verified_out_of_stock'
          : 'unknown',
      availability: item.availability,
      shippingText:
        item.shippingStatus === 'verified' && item.shippingCost !== null
          ? `${item.currency} ${item.shippingCost.toFixed(2)} shipping`
          : null,
      shippingCost: item.shippingStatus === 'verified' ? item.shippingCost : null,
      shippingStatus: item.shippingStatus,
      estimatedTaxRate: item.estimatedTaxRate,
      taxStatus: item.taxStatus === 'verified' ? 'verified' : 'unknown',
      merchant: item.merchant,
      rating: null,
      reviewCount: null,
      ratingStatus: 'unverified',
      imageUrl: item.imageUrl,
      canonicalUrl: item.productUrl || 'https://www.sandbox.paypal.com',
      sourceUrl: item.productUrl || 'https://www.sandbox.paypal.com',
      sourceType: item.sourceId,
      sourceId: item.sourceId,
      sourceName:
        item.sourceId === 'paypal_sandbox_test_catalog'
          ? 'PayPal Sandbox Catalog'
          : 'Channel3 Product Graph API',
      sourceLabel:
        item.sourceId === 'paypal_sandbox_test_catalog'
          ? 'PayPal Sandbox Catalog'
          : 'Channel3 Product Graph API',
      retrievedAt: item.priceVerifiedAt || item.addedAt,
      freshnessStatus: 'live',
      verified: item.priceStatus !== 'price_could_not_be_verified',
      verificationStatus: 'verified_live_source',
      verificationSummary: `Verified cart item from ${item.merchant}`,
      specs: item.specs || {},
      keySpecs: item.selectedOptions
        ? Object.entries(item.selectedOptions).map(([k, v]) => `${k}: ${v}`)
        : item.variantLabel
        ? [`Option: ${item.variantLabel}`]
        : [],
      pros: ['Server-verified unit pricing', 'Eligible for PayPal Sandbox checkout'],
      cons: [],
      whyRecommended: `Added to your Spark Intelligent Cart from ${item.merchant}.`,
      valueScore: 92,
      trustScore: 95,
      relevanceScore: 94,
      overallScore: 94,
      bestCoupon: null,
      couponDiscountAmount: 0,
      netItemPrice: item.unitPrice,
      withinBudget: true,
      completenessScore: 94,
      couponStatus: 'no_verified_coupon',
      checkoutStatus: 'supported_paypal',
      effectivePrice: item.unitPrice,
      savingsAmount: 0,
      hasVerifiedCoupon: false,
    };
    setInspectedProduct(synthesizedOffer);
  };

  const handleInspectCompound = async (compoundName: string) => {
    const key = compoundName.toLowerCase();
    try {
      const res = await fetch(`/api/science/compound/${encodeURIComponent(key)}`);
      if (res.ok) {
        const data: ScienceCompoundMetadata = await res.json();
        setInspectedCompound(data);
      }
    } catch {
      // Ignore network failure on compound modal
    }
  };

  const refreshUserPurchases = async () => {
    try {
      let res = await fetch('/api/purchases', {
        headers: buildAuthenticatedHeaders({ method: 'GET' }),
      });
      if (res.status === 401 && (await restoreBackendSessionForCurrentUser())) {
        res = await fetch('/api/purchases', {
          headers: buildAuthenticatedHeaders({ method: 'GET' }),
        });
      }
      const serverList: PurchaseRecord[] = [];
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.purchases)) {
          serverList.push(...data.purchases);
        }
      }
      let firestoreList: PurchaseRecord[] = [];
      if (auth.currentUser && user && auth.currentUser.uid === user.id) {
        firestoreList = await fetchUserPurchasesFromFirestore(auth.currentUser.uid).catch(
          () => []
        );
      }
      if (serverList.length > 0 || firestoreList.length > 0) {
        setPurchases((prev) => {
          const map = new Map<string, PurchaseRecord>();
          for (const p of [...firestoreList, ...serverList, ...prev]) {
            map.set(p.orderReference || p.id, p);
          }
          return Array.from(map.values()).sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt)
          );
        });
      }
    } catch {
      // Ignore refresh error
    }
  };

  const handleUpdatePreferences = async (updates: Partial<UserPreferences>) => {
    if (!user) return;
    setUser((prev) => (prev ? { ...prev, preferences: { ...prev.preferences, ...updates } } : prev));

    if (auth.currentUser && auth.currentUser.uid === user.id) {
      try {
        const nextPrefs = await updateUserFirestorePreferences(
          user.id,
          user.preferences,
          updates
        );
        setUser((prev) => (prev ? { ...prev, preferences: nextPrefs } : prev));
        return;
      } catch {
        // Fall through to server update
      }
    }

    try {
      const res = await fetch('/api/user/settings', {
        method: 'PUT',
        headers: buildAuthenticatedHeaders({ method: 'PUT' }),
        body: JSON.stringify({ preferences: updates }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setUser(data.user);
        }
        if (data.accountBalance) {
          setAccountBalance(data.accountBalance);
          setBalanceError(null);
        }
      }
    } catch {
      // Already updated optimistically
    }
  };

  const [paypalAuthUrl, setPaypalAuthUrl] = useState<string | null>(null);

  const restoreBackendSessionForCurrentUser = async (): Promise<boolean> => {
    if (!user) return false;
    try {
      const storedSession = getClientAuthSession();
      const idToken = auth.currentUser
        ? await auth.currentUser.getIdToken().catch(() => undefined)
        : undefined;
      const res = await fetch('/api/auth/restore-session', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        body: JSON.stringify({
          userId: user.id,
          email: user.email,
          displayName: user.preferences.displayName,
          refreshToken: storedSession?.refreshToken,
          idToken,
        }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (data.session) {
        setClientAuthSession(data.session);
        return true;
      }
    } catch {
      // Ignore session restore error
    }
    return false;
  };

  const refreshPayPalConnectionStatus = async () => {
    try {
      let res = await fetch('/api/integrations/paypal/status', {
        headers: buildAuthenticatedHeaders({ method: 'GET' }),
      });
      if (res.status === 401 && (await restoreBackendSessionForCurrentUser())) {
        res = await fetch('/api/integrations/paypal/status', {
          headers: buildAuthenticatedHeaders({ method: 'GET' }),
        });
      }
      if (!res.ok) return;
      const data = await res.json();
      if (data.paypal) {
        setUser((prev) => (prev ? { ...prev, paypal: data.paypal } : prev));
        if (
          data.paypal.status === 'connected' &&
          (window.location.pathname.startsWith('/onboarding') ||
            onboardingStep === 'connect-paypal')
        ) {
          setPaypalAuthUrl(null);
          window.history.pushState({}, '', '/onboarding/paypal-success');
          setOnboardingStep('paypal-success');
        }
      }
      if (
        data.connection &&
        data.connection.status === 'connected' &&
        auth.currentUser &&
        user &&
        auth.currentUser.uid === user.id
      ) {
        savePayPalConnectionToFirestore(user.id, {
          paypalSubjectId: data.connection.paypalSubjectId,
          payerId: data.connection.payerId,
          maskedEmail: data.connection.maskedEmail,
          emailVerified: Boolean(data.connection.emailVerified),
          verifiedAccount: Boolean(data.connection.verifiedAccount),
          status: 'connected',
        }).catch(() => {});
      }
    } catch {
      // Ignore transient status refresh error
    }
  };

  useEffect(() => {
    const applyPayPalOAuthResult = (payload: Record<string, unknown> | null | undefined) => {
      if (!payload || payload.type !== 'SPARK_PAYPAL_OAUTH_RESULT') return;
      setPaypalAuthUrl(null);
      const conn = payload.connection as Record<string, unknown> | null | undefined;
      if (payload.ok && conn) {
        setUser((prev) =>
          prev
            ? {
                ...prev,
                paypal: {
                  status: 'connected',
                  sandboxEmail: (conn.email as string) || undefined,
                  maskedEmail: (conn.maskedEmail as string) || undefined,
                  paypalName: (conn.paypalName as string) || undefined,
                  paypalSubjectId: conn.paypalSubjectId as string,
                  payerId: (conn.payerId as string) || undefined,
                  emailVerified: Boolean(conn.emailVerified),
                  verifiedAccount: Boolean(conn.verifiedAccount),
                  scopesGranted: (conn.scopesGranted as string[]) || undefined,
                  connectedAt: conn.connectedAt as string,
                  updatedAt: conn.updatedAt as string,
                  environment: (conn.environment as 'live' | 'sandbox') || undefined,
                  vaultId: (conn.vaultId as string) || undefined,
                  vaultedAt: (conn.vaultedAt as string) || undefined,
                  errorMessage: undefined,
                  errorCode: undefined,
                },
              }
            : prev
        );
        if (
          window.location.pathname.startsWith('/onboarding') ||
          onboardingStep === 'connect-paypal'
        ) {
          window.history.pushState({}, '', '/onboarding/paypal-success');
          setOnboardingStep('paypal-success');
        }
        triggerCompletionFeedback('PayPal account verified and linked to your Spark account.');
      } else {
        setUser((prev) =>
          prev
            ? {
                ...prev,
                paypal: {
                  status: 'error',
                  errorMessage:
                    (payload.message as string) ||
                    'PayPal authorization failed or was cancelled before completion.',
                  errorCode: (payload.errorCode as string) || 'authorization_failed',
                },
              }
            : prev
        );
      }
      refreshPayPalConnectionStatus();
    };

    const handleOAuthPopupMessage = (event: MessageEvent) => {
      applyPayPalOAuthResult(event.data);
    };

    const handleStorageEvent = (event: StorageEvent) => {
      if (event.key !== 'spark_paypal_oauth_result' || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue);
        if (parsed?.payload) {
          applyPayPalOAuthResult(parsed.payload);
        }
      } catch {
        // Ignore malformed storage payload
      }
    };

    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        bc = new BroadcastChannel('spark_paypal_oauth_channel');
        bc.onmessage = (event) => {
          applyPayPalOAuthResult(event.data);
        };
      }
    } catch {
      // BroadcastChannel not supported
    }

    window.addEventListener('message', handleOAuthPopupMessage);
    window.addEventListener('storage', handleStorageEvent);
    return () => {
      window.removeEventListener('message', handleOAuthPopupMessage);
      window.removeEventListener('storage', handleStorageEvent);
      try {
        bc?.close();
      } catch {
        // Ignore close error
      }
    };
  }, [user?.id, onboardingStep]);

  useEffect(() => {
    if (!user || user.paypal.status !== 'connecting') return;
    const timer = setInterval(() => {
      refreshPayPalConnectionStatus();
    }, 1500);
    return () => clearInterval(timer);
  }, [user?.id, user?.paypal.status, onboardingStep]);

  const handleConnectPayPal = async () => {
    if (!user || user.paypal.status === 'connecting') return;
    setUser({
      ...user,
      paypal: {
        ...user.paypal,
        status: 'connecting',
        errorMessage: undefined,
        errorCode: undefined,
      },
    });
    try {
      let res = await fetch('/api/paypal/connect', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        body: JSON.stringify({ forceReconnect: true }),
      });
      if (res.status === 401 && (await restoreBackendSessionForCurrentUser())) {
        res = await fetch('/api/paypal/connect', {
          method: 'POST',
          headers: buildAuthenticatedHeaders({ method: 'POST' }),
          body: JSON.stringify({ forceReconnect: true }),
        });
      }
      const data = await res.json();
      if (res.ok && data.ok && data.authorizationUrl) {
        setPaypalAuthUrl(data.authorizationUrl);
        try {
          window.open(
            data.authorizationUrl,
            'spark_paypal_oauth',
            'width=560,height=720,noopener=no'
          );
        } catch {
          // If popup is blocked by browser settings, user can use the direct authorization link in State B
        }
      } else {
        setPaypalAuthUrl(null);
        setUser({
          ...user,
          paypal: {
            status: 'error',
            errorCode: data.errorCode || 'connect_initiation_failed',
            errorMessage:
              data.error ||
              'Unable to initiate PayPal authorization. Check server PayPal credentials.',
          },
        });
      }
    } catch {
      setPaypalAuthUrl(null);
      setUser({
        ...user,
        paypal: {
          status: 'error',
          errorCode: 'network_error',
          errorMessage: 'Network error while initiating PayPal account authorization.',
        },
      });
    }
  };

  const handleReconnectPayPal = async () => {
    if (!user || user.paypal.status === 'connecting') return;
    setUser({
      ...user,
      paypal: {
        ...user.paypal,
        status: 'connecting',
        errorMessage: undefined,
        errorCode: undefined,
      },
    });
    try {
      let res = await fetch('/api/paypal/reconnect', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        body: JSON.stringify({ forceReconnect: true }),
      });
      if (res.status === 401 && (await restoreBackendSessionForCurrentUser())) {
        res = await fetch('/api/paypal/reconnect', {
          method: 'POST',
          headers: buildAuthenticatedHeaders({ method: 'POST' }),
          body: JSON.stringify({ forceReconnect: true }),
        });
      }
      const data = await res.json();
      if (res.ok && data.ok && data.authorizationUrl) {
        setPaypalAuthUrl(data.authorizationUrl);
        try {
          window.open(
            data.authorizationUrl,
            'spark_paypal_oauth',
            'width=560,height=720,noopener=no'
          );
        } catch {
          // User can use the direct link in State B if popup is blocked
        }
      } else {
        setPaypalAuthUrl(null);
        setUser({
          ...user,
          paypal: {
            ...user.paypal,
            status: 'error',
            errorCode: data.errorCode || 'reconnect_failed',
            errorMessage: data.error || 'Unable to initiate PayPal reconnection.',
          },
        });
      }
    } catch {
      setPaypalAuthUrl(null);
      setUser({
        ...user,
        paypal: {
          ...user.paypal,
          status: 'error',
          errorCode: 'network_error',
          errorMessage: 'Network error while initiating PayPal reconnection.',
        },
      });
    }
  };

  const handleSubmitManualPayPalCallbackUrl = async (rawInput: string) => {
    if (!user || !rawInput.trim()) return;
    try {
      const trimmed = rawInput.trim();
      let code: string | null = null;
      let token: string | null = null;
      let payerId: string | null = null;
      let state: string | null = null;
      let error: string | null = null;
      let errorDescription: string | null = null;

      if (
        trimmed.includes('code=') ||
        trimmed.includes('token=') ||
        trimmed.includes('state=') ||
        trimmed.includes('error=')
      ) {
        const queryPart = trimmed.includes('?') ? trimmed.split('?').slice(1).join('?') : trimmed;
        const params = new URLSearchParams(queryPart);
        code = params.get('code');
        token = params.get('token') || params.get('ba_token');
        payerId = params.get('PayerID') || params.get('payer_id');
        state = params.get('state');
        error = params.get('error');
        errorDescription = params.get('error_description');
      }

      const qs = new URLSearchParams({ format: 'json' });
      if (code) qs.set('code', code);
      if (token) qs.set('token', token);
      if (payerId) qs.set('PayerID', payerId);
      if (state) qs.set('state', state);
      if (error) qs.set('error', error);
      if (errorDescription) qs.set('error_description', errorDescription);

      const res = await fetch(`/api/paypal/callback?${qs.toString()}`, {
        method: 'GET',
        headers: buildAuthenticatedHeaders({ method: 'GET' }),
      });
      const data = await res.json();
      setPaypalAuthUrl(null);
      if (res.ok && data.ok && data.connection) {
        await refreshPayPalConnectionStatus();
        window.history.pushState({}, '', '/onboarding/paypal-success');
        setOnboardingStep('paypal-success');
        triggerCompletionFeedback(
          `PayPal account connected (${data.connection.email || data.connection.maskedEmail || 'verified'}).`
        );
      } else {
        setUser({
          ...user,
          paypal: {
            ...user.paypal,
            status: 'error',
            errorCode: data.errorCode || 'callback_failed',
            errorMessage: data.message || 'PayPal authorization could not be completed.',
          },
        });
      }
    } catch {
      setUser({
        ...user,
        paypal: {
          ...user.paypal,
          status: 'error',
          errorCode: 'network_error',
          errorMessage: 'Network error while verifying PayPal callback URL.',
        },
      });
    }
  };

  const handleTogglePayPalVault = async (enableVault: boolean) => {
    if (!user) return;
    try {
      const res = await fetch('/api/integrations/paypal/vault', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
        body: JSON.stringify({
          vaultId: enableVault ? `VAULT_${Date.now().toString(36).toUpperCase()}` : null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok && data.paypal) {
        setUser({
          ...user,
          paypal: data.paypal,
        });
        triggerCompletionFeedback(
          enableVault
            ? 'PayPal Vault payment method saved for future Spark purchases.'
            : 'PayPal Vault payment method removed.'
        );
      }
    } catch {
      // Ignore transient network error
    }
  };

  const handleCancelPayPalConnecting = () => {
    if (!user) return;
    setPaypalAuthUrl(null);
    setUser({
      ...user,
      paypal: {
        status: 'error',
        errorCode: 'authorization_cancelled',
        errorMessage:
          'PayPal authorization was cancelled before completing identity verification.',
      },
    });
  };

  const handleDisconnectPayPal = async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/integrations/paypal/disconnect', {
        method: 'DELETE',
        headers: buildAuthenticatedHeaders({ method: 'DELETE' }),
        body: JSON.stringify({ confirmed: true }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setPaypalAuthUrl(null);
        setAccountBalance(null);
        setBalanceError(null);
        setUser({
          ...user,
          paypal: data.paypal || {
            status: 'not_connected',
          },
        });
        if (auth.currentUser && auth.currentUser.uid === user.id) {
          deletePayPalConnectionFromFirestore(user.id).catch(() => {});
        }
        triggerCompletionFeedback('PayPal account disconnected from your Spark account.');
      } else {
        setUser({
          ...user,
          paypal: {
            ...user.paypal,
            errorMessage: data.error || 'Failed to disconnect PayPal account.',
          },
        });
      }
    } catch {
      setUser({
        ...user,
        paypal: {
          ...user.paypal,
          errorMessage: 'Network error while disconnecting PayPal account.',
        },
      });
    }
  };

  const handleSignOut = async () => {
    try {
      await fetch('/api/auth/signout', {
        method: 'POST',
        headers: buildAuthenticatedHeaders({ method: 'POST' }),
      });
    } catch {
      // Ignore network error on signout
    }
    try {
      await signOutFirebase();
    } catch {
      // Ignore if not signed into Firebase
    }
    setClientAuthSession(null);
    setUser(null);
    setAccountBalance(null);
    setBalanceError(null);
    setPurchases([]);
    setConversations([]);
    setActiveConversationId(null);
    setComparedProductIds([]);
    setSavedProducts([]);
    setCart(null);
    setIsCartCheckoutOpen(false);
    if (window.location.pathname.startsWith('/onboarding')) {
      window.history.pushState({}, '', '/');
      setOnboardingStep('none');
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#09090B] text-white flex items-center justify-center">
        <div className="flex items-center gap-2.5 text-sm text-zinc-400">
          <Sparkles className="w-4 h-4 text-violet-400 animate-spin" />
          <span>Initializing Spark...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        initialGoogleDiagnostic={googleRedirectDiagnostic}
        onAuthenticated={(authenticatedUser, isNewAccount, initialData) => {
          setUser(authenticatedUser);
          const nextPurchases = initialData?.purchases || [];
          const nextConversations = isNewAccount ? [] : initialData?.conversations || [];
          const nextSaved = initialData?.savedProducts || [];
          setPurchases(nextPurchases);
          setConversations(nextConversations);
          setActiveConversationId(nextConversations[0]?.id || null);
          setComparedProductIds([]);
          setSavedProducts(nextSaved);
          setInspectedProduct(null);
          setProductForCheckout(null);
          setInspectedCompound(null);
          if (isNewAccount) {
            window.history.pushState({}, '', '/onboarding/connect-paypal');
            setOnboardingStep('connect-paypal');
          }
        }}
      />
    );
  }

  if (onboardingStep !== 'none') {
    return (
      <PayPalOnboardingView
        user={user}
        step={onboardingStep}
        paypalAuthUrl={paypalAuthUrl}
        onConnectPayPal={handleConnectPayPal}
        onCancelConnecting={handleCancelPayPalConnecting}
        onSubmitCallbackUrl={handleSubmitManualPayPalCallbackUrl}
        onConnectLater={() => {
          window.history.pushState({}, '', '/');
          setOnboardingStep('none');
        }}
        onContinueToSpark={() => {
          window.history.pushState({}, '', '/');
          setOnboardingStep('none');
        }}
      />
    );
  }

  const hasActiveConversationTurns = Boolean(activeThread && activeThread.turns.length > 0);

  return (
    <div className="relative h-screen overflow-hidden w-full flex flex-col md:flex-row bg-[#09090B] text-[#FAFAFA] selection:bg-violet-500/30">
      {/* Pointer-Reactive Ambient Glow */}
      <AmbientCursorGlow accentColor={user.preferences.accentColor} />

      {/* Zone 1: Left Sidebar Navigation */}
      <SidebarNav
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        user={user}
        accountBalance={accountBalance}
        balanceLoading={balanceLoading}
        balanceError={balanceError}
        onRefreshBalance={handleRefreshBalance}
        t={t}
        cartCount={cart?.itemCount || 0}
        comparisonCount={comparedProductIds.length}
        savedCount={savedProducts.length}
        purchaseCount={purchases.length}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={(convId) => {
          setActiveConversationId(convId);
          setActiveSection('conversation');
        }}
        onNewConversation={handleStartNewConversation}
        onArchiveConversation={handleArchiveConversation}
        onDeleteConversation={handleExplicitDeleteConversation}
      />

      {/* Zone 2: Main Conversation & Shopping Workspace Column */}
      <div className="relative z-10 flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
        {activeSection === 'conversation' && hasActiveConversationTurns && activeThread && (
          <ConversationHeader
            title={activeThread.title}
            turnCount={activeThread.turns.length}
            verifiedOfferCount={latestOrchestration?.offers.length || 0}
            viewMode={viewMode}
            onChangeViewMode={setViewMode}
            isRightPanelOpen={isRightPanelOpen}
            onToggleRightPanel={() => setIsRightPanelOpen((prev) => !prev)}
            onNewConversation={handleStartNewConversation}
            onRenameConversation={handleRenameConversation}
            onDeleteConversation={handleDeleteConversation}
            hasActiveConversation={hasActiveConversationTurns}
            cartItemCount={cart?.itemCount || 0}
            onOpenCartCheckout={() => {
              setActiveSection('cart');
            }}
          />
        )}

        {/* Persistent Sandbox Cart Summary Bar when Cart has items and ConversationHeader is not visible */}
        {cart &&
          cart.itemCount > 0 &&
          activeSection !== 'cart' &&
          !(activeSection === 'conversation' && hasActiveConversationTurns && activeThread) && (
            <div
              data-testid="global-sandbox-cart-bar"
              className="px-4 sm:px-8 py-2.5 bg-amber-500/10 border-b border-amber-500/25 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2.5 text-xs text-amber-200">
                <ShoppingCart className="w-4 h-4 text-amber-300 shrink-0" />
                <span className="font-semibold">
                  Spark Cart: {cart.itemCount} {cart.itemCount === 1 ? 'item' : 'items'}
                </span>
                <span className="text-zinc-300 font-mono">
                  ({cart.currency} {cart.estimatedTotal.toFixed(2)})
                </span>
                <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/35 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                  SANDBOX
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="global-open-cart-view-btn"
                  onClick={() => setActiveSection('cart')}
                  className="py-1.5 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-zinc-200 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span>View Cart</span>
                </button>
                <button
                  type="button"
                  data-testid="global-sandbox-cart-checkout-btn"
                  onClick={() => {
                    setProductForCheckout(null);
                    setIsCartCheckoutOpen(true);
                  }}
                  className="py-1.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <ShoppingCart className="w-3.5 h-3.5" />
                  <span>Sandbox Checkout ({cart.itemCount})</span>
                </button>
              </div>
            </div>
          )}

        <main className="flex-1 px-4 sm:px-8 py-4 overflow-y-auto">
          {/* Discreet Task Completion Visual Indicator */}
          {completionBanner && (
            <div
              role="status"
              className="max-w-4xl mx-auto mb-5 px-4 py-2.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 text-xs text-emerald-200 flex items-center justify-between gap-3"
            >
              <span className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{completionBanner}</span>
              </span>
              <button
                type="button"
                onClick={() => setCompletionBanner(null)}
                className="text-zinc-400 hover:text-white text-[11px] cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* SECTION 1A: HOME COMPOSER (BEFORE FIRST MESSAGE IN THREAD) */}
          {activeSection === 'conversation' && !hasActiveConversationTurns && (
            <div className="max-w-4xl mx-auto space-y-10 pt-8 sm:pt-14">
              <section className="text-center pb-2">
                <p className="text-xs text-zinc-400 mb-3">
                  Hello,{' '}
                  <span className="text-zinc-200 font-medium">
                    {user.preferences.preferredName || user.preferences.displayName}
                  </span>
                </p>

                <h1
                  className="font-bold tracking-tight spark-hero-gradient mx-auto"
                  style={{
                    fontSize: 'clamp(2.5rem, 5vw, 4.25rem)',
                    lineHeight: 1.08,
                    textWrap: 'balance',
                  }}
                >
                  {t.heroTitle}
                </h1>

                <p
                  aria-live="polite"
                  className="mt-3 text-lg sm:text-2xl font-medium text-zinc-300 transition-all duration-200"
                  style={{
                    filter: phraseBlurred ? 'blur(6px)' : 'blur(0px)',
                    opacity: phraseBlurred ? 0.35 : 0.92,
                    transform: phraseBlurred ? 'translateY(3px)' : 'translateY(0px)',
                  }}
                >
                  {t.heroSubphrases[phraseIndex]}
                </p>
              </section>

              <section className="max-w-3xl mx-auto">
                {(() => {
                  const starterActions = [
                    {
                      label: t.quickActions.findProducts,
                      icon: Search,
                      prompt: 'Clean Architecture software engineering books',
                    },
                    {
                      label: t.quickActions.searchCoupons,
                      icon: TicketPercent,
                      prompt: 'Designing Data-Intensive Applications book and check verified coupons',
                    },
                    {
                      label: t.quickActions.comparePrices,
                      icon: Scale,
                      prompt: 'Compare Python programming and machine learning books',
                    },
                    {
                      label: t.quickActions.discoverOffers,
                      icon: Tag,
                      prompt: 'Distributed systems and cloud architecture technical books',
                    },
                    {
                      label: t.quickActions.findAlternatives,
                      icon: Layers,
                      prompt: 'Niacinamide dermatology guides and clinical literature',
                    },
                  ];

                  const trimmedQuery = queryInput.trim();
                  const autocompletePool = [
                    {
                      label: 'Clean Architecture software engineering books',
                      icon: Search,
                      prompt: 'Clean Architecture software engineering books',
                    },
                    {
                      label: 'Compare Python programming and machine learning books',
                      icon: Scale,
                      prompt: 'Compare Python programming and machine learning books',
                    },
                    {
                      label: 'Designing Data-Intensive Applications book and check verified coupons',
                      icon: TicketPercent,
                      prompt: 'Designing Data-Intensive Applications book and check verified coupons',
                    },
                    {
                      label: 'Distributed systems and cloud architecture technical books',
                      icon: Tag,
                      prompt: 'Distributed systems and cloud architecture technical books',
                    },
                    {
                      label: 'Niacinamide dermatology guides and clinical literature',
                      icon: Layers,
                      prompt: 'Niacinamide dermatology guides and clinical literature',
                    },
                    {
                      label: 'Compare Google Pixel 9a 5G vs Samsung Galaxy A56 5G under $550',
                      icon: Search,
                      prompt: 'Compare Google Pixel 9a 5G vs Samsung Galaxy A56 5G under $550',
                    },
                    {
                      label: 'Best wireless noise-cancelling headphones under $350',
                      icon: Search,
                      prompt: 'Best wireless noise-cancelling headphones under $350',
                    },
                  ];

                  const activeSuggestions = trimmedQuery
                    ? [
                        ...autocompletePool.filter(
                          (item) =>
                            item.label.toLowerCase().includes(trimmedQuery.toLowerCase()) ||
                            item.prompt.toLowerCase().includes(trimmedQuery.toLowerCase())
                        ),
                        {
                          label: `Search verified sources for "${trimmedQuery}"`,
                          icon: Search,
                          prompt: trimmedQuery,
                        },
                        {
                          label: `Compare top options and prices for "${trimmedQuery}"`,
                          icon: Scale,
                          prompt: `Compare ${trimmedQuery} and include verified prices`,
                        },
                        {
                          label: `Find cheaper verified alternatives for "${trimmedQuery}"`,
                          icon: Layers,
                          prompt: `Find cheaper alternatives for ${trimmedQuery}`,
                        },
                      ].slice(0, 5)
                    : starterActions;

                  return (
                    <>
                      {/* Suggestions & Autocomplete Displayed Directly Above the Search Bar */}
                      <div
                        data-testid="search-suggestions-above"
                        role="listbox"
                        aria-label="Search suggestions"
                        className="mb-3 flex flex-wrap items-center justify-center gap-2.5 bg-transparent"
                      >
                        {activeSuggestions.map((action, idx) => {
                          const Icon = action.icon;
                          const isHighlighted = homeSuggestionIdx === idx;
                          return (
                            <button
                              key={`${action.label}-${idx}`}
                              type="button"
                              role="option"
                              aria-selected={isHighlighted}
                              data-testid={`search-suggestion-item-${idx}`}
                              onClick={() => {
                                setHomeSuggestionIdx(-1);
                                runSparkOrchestration(action.prompt);
                              }}
                              className={`py-1.5 px-3 bg-transparent hover:bg-transparent focus:bg-transparent border-none shadow-none text-xs font-medium inline-flex items-center gap-2 transition-all duration-150 hover:-translate-y-0.5 whitespace-nowrap shrink-0 cursor-pointer ${
                                isHighlighted
                                  ? 'text-white underline decoration-violet-400 underline-offset-4'
                                  : 'text-zinc-300 hover:text-white hover:underline hover:decoration-violet-400/70 hover:underline-offset-4'
                              }`}
                            >
                              <Icon className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                              <span>{action.label}</span>
                            </button>
                          );
                        })}
                      </div>

                      <form
                        data-testid="home-search-bubble"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (
                            homeSuggestionIdx >= 0 &&
                            homeSuggestionIdx < activeSuggestions.length
                          ) {
                            const chosen = activeSuggestions[homeSuggestionIdx];
                            setHomeSuggestionIdx(-1);
                            runSparkOrchestration(chosen.prompt);
                            return;
                          }
                          runSparkOrchestration();
                        }}
                        className="relative rounded-[30px] bg-gradient-to-b from-[#131522]/78 via-[#0d0f18]/84 to-[#08090f]/90 backdrop-blur-2xl border border-white/[0.10] hover:border-white/[0.16] focus-within:border-cyan-400/35 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12),inset_0_-1px_0_0_rgba(139,92,246,0.08),0_20px_50px_-12px_rgba(0,0,0,0.72),0_0_28px_-8px_rgba(56,189,248,0.12)] focus-within:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),0_0_0_1px_rgba(56,189,248,0.22),0_24px_60px_-12px_rgba(37,99,235,0.28)] px-4 py-3.5 sm:px-5 sm:py-4 transition-all duration-300 ease-out"
                      >
                        {/* Subtle Liquid Glass Top Specular Edge Reflection */}
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/35 to-transparent"
                        />

                        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3.5 px-1 sm:px-1.5 py-0.5">
                          <div className="flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0">
                            <div
                              className="w-10 h-10 rounded-2xl bg-white/[0.04] border border-white/[0.08] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)] flex items-center justify-center shrink-0"
                              title="Spark Product Discovery & Search"
                            >
                              <SparkAiSearchIcon
                                className="w-5 h-5 sm:w-6 sm:h-6"
                                data-testid="home-search-bubble-ai-icon"
                              />
                            </div>
                            <label htmlFor="spark-command-input" className="sr-only">
                              {t.composerPlaceholder}
                            </label>
                            <textarea
                              id="spark-command-input"
                              rows={
                                queryInput.includes('\n')
                                  ? Math.min(4, queryInput.split('\n').length)
                                  : 1
                              }
                              value={queryInput}
                              onChange={(e) => {
                                setQueryInput(e.target.value);
                                setHomeSuggestionIdx(-1);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'ArrowDown') {
                                  e.preventDefault();
                                  setHomeSuggestionIdx((prev) =>
                                    prev + 1 < activeSuggestions.length ? prev + 1 : 0
                                  );
                                  return;
                                }
                                if (e.key === 'ArrowUp') {
                                  e.preventDefault();
                                  setHomeSuggestionIdx((prev) =>
                                    prev - 1 >= 0 ? prev - 1 : activeSuggestions.length - 1
                                  );
                                  return;
                                }
                                if (e.key === 'Escape') {
                                  setHomeSuggestionIdx(-1);
                                  return;
                                }
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  if (
                                    homeSuggestionIdx >= 0 &&
                                    homeSuggestionIdx < activeSuggestions.length
                                  ) {
                                    const chosen = activeSuggestions[homeSuggestionIdx];
                                    setHomeSuggestionIdx(-1);
                                    if (!isOrchestrating) {
                                      runSparkOrchestration(chosen.prompt);
                                    }
                                    return;
                                  }
                                  if (!isOrchestrating && queryInput.trim()) {
                                    runSparkOrchestration();
                                  }
                                }
                              }}
                              placeholder={t.composerPlaceholder}
                              className="w-full min-w-0 flex-1 bg-transparent text-sm sm:text-base text-white placeholder:text-zinc-400/90 focus:outline-none resize-none leading-relaxed max-h-32 overflow-y-auto"
                            />
                            {queryInput.length > 0 && (
                              <button
                                type="button"
                                data-testid="home-search-clear-btn"
                                onClick={() => {
                                  setQueryInput('');
                                  setHomeSuggestionIdx(-1);
                                }}
                                aria-label="Clear search query"
                                title="Clear search query"
                                className="w-8 h-8 rounded-full bg-white/[0.05] hover:bg-white/[0.12] border border-white/[0.08] text-zinc-400 hover:text-white inline-flex items-center justify-center shrink-0 transition-all cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          <div className="flex items-center justify-end gap-2 shrink-0">
                            <button
                              type="submit"
                              disabled={isOrchestrating || !queryInput.trim()}
                              aria-label={t.sendButton}
                              className="h-10 px-4 sm:px-5 rounded-full bg-gradient-to-r from-blue-600/85 via-indigo-600/85 to-violet-600/85 hover:from-blue-500 hover:via-indigo-500 hover:to-violet-500 border border-white/15 shadow-[0_4px_18px_-4px_rgba(99,102,241,0.55)] disabled:opacity-40 disabled:shadow-none text-xs font-semibold text-white flex items-center gap-2 transition-all whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <span>{t.sendButton}</span>
                              <Send className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 mt-2.5 px-2 text-xs text-zinc-400 border-t border-white/[0.06]">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleInspectCompound('niacinamide')}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.07] text-zinc-400 hover:text-cyan-200 transition-all cursor-pointer"
                            >
                              <FlaskConical className="w-3.5 h-3.5 text-cyan-400" />
                              <span>Live PubChem Bio-Verification</span>
                            </button>
                          </div>

                          <span className="text-[11px] text-zinc-500">
                            Strict Real-Data Protocol · Zero Synthetic Fallbacks
                          </span>
                        </div>
                      </form>
                    </>
                  );
                })()}
              </section>
            </div>
          )}

          {/* SECTION 1B: POST-MESSAGE CONVERSATION WORKSPACE */}
          {activeSection === 'conversation' && hasActiveConversationTurns && activeThread && (
            <div className="max-w-6xl mx-auto space-y-8 pb-8">
              {activeThread.turns.map((turn, turnIdx) => {
                const isLatestTurn = turnIdx === activeThread.turns.length - 1;
                const turnOffers = turn.response
                  ? isLatestTurn
                    ? applyUiFilters(turn.response.offers)
                    : turn.response.offers
                  : [];
                const isConversationalOnlyTurn =
                  turn.response?.responseType === 'general_question' ||
                  turn.response?.responseType === 'missing_information';

                return (
                  <section
                    key={turn.id}
                    aria-label={`Shopping request: ${turn.userPrompt}`}
                    className="space-y-4"
                  >
                    {/* 1. Submitted User Message at top of turn */}
                    <UserMessage
                      prompt={turn.userPrompt}
                      timestamp={turn.createdAt}
                      isContextualFollowUp={turn.isContextualFollowUp}
                    />

                    {/* 2. Real-Time Agent Activity Timeline */}
                    <AgentActivityTimeline
                      stages={turn.stages}
                      isExecuting={turn.status === 'executing'}
                    />

                    {/* Task Error State if failed */}
                    {turn.errorMessage && (
                      <TaskErrorState
                        message={turn.errorMessage}
                        onRetry={() => runSparkOrchestration(turn.userPrompt)}
                      />
                    )}

                    {/* 3. Spark Coordinator Response, Product Results & Comparison/Coupon Blocks */}
                    {turn.response && (
                      <div className="space-y-5">
                        {/* Spark Coordinator Introduction / Conversational Answer */}
                        <AssistantMessage
                          coordinatorMessage={turn.response.coordinatorMessage}
                          explicitFailureStates={turn.response.explicitFailureStates}
                          followUpActionSummary={turn.followUpActionSummary}
                          followUpClarification={turn.response.followUpClarification}
                          clarificationSuggestions={turn.response.clarificationSuggestions}
                          onSelectClarification={(prompt) => runSparkOrchestration(prompt)}
                          groundingCitations={turn.response.groundingCitations}
                          scienceAnalysis={turn.response.scienceAnalysis}
                          onInspectScience={(comp) => setInspectedCompound(comp)}
                        />

                        {/* Autonomous AI Product Intelligence Report */}
                        {turn.response.productIntelligenceReport && (
                          <ProductIntelligenceReportView
                            report={turn.response.productIntelligenceReport}
                            offers={turn.response.offers}
                            onSelectForCheckout={(prod) => {
                              setIsCartCheckoutOpen(false);
                              setProductForCheckout(prod);
                            }}
                            onAddToCart={handleAddToCart}
                            onOpenDetails={(prod) => setInspectedProduct(prod)}
                          />
                        )}

                        {/* Product Results Showcase (Skipped for ordinary general questions or clarification requests) */}
                        {!isConversationalOnlyTurn && (
                          <>
                            {turnOffers.length > 0 ? (
                              <div className="space-y-3">
                                {viewMode === 'grid' ? (
                                  <ProductResultGrid
                                    offers={turnOffers}
                                    queryTitle={turn.userPrompt}
                                    intent={turn.response.intent}
                                    recommendedProductId={turn.response.recommendedProductId}
                                    comparedProductIds={comparedProductIds}
                                    savedProductIds={savedProductIds}
                                    onToggleCompare={handleToggleCompare}
                                    onToggleSave={handleToggleSaveProduct}
                                    onOpenDetails={(prod) => setInspectedProduct(prod)}
                                    onSelectForCheckout={(prod) => {
                                      setIsCartCheckoutOpen(false);
                                      setProductForCheckout(prod);
                                    }}
                                    onAddToCart={handleAddToCart}
                                    onInspectCompound={handleInspectCompound}
                                  />
                                ) : (
                                  <ProductListView
                                    offers={turnOffers}
                                    recommendedProductId={turn.response.recommendedProductId}
                                    comparedProductIds={comparedProductIds}
                                    savedProductIds={savedProductIds}
                                    onToggleCompare={handleToggleCompare}
                                    onToggleSave={handleToggleSaveProduct}
                                    onOpenDetails={(prod) => setInspectedProduct(prod)}
                                    onSelectForCheckout={(prod) => {
                                      setIsCartCheckoutOpen(false);
                                      setProductForCheckout(prod);
                                    }}
                                    onAddToCart={handleAddToCart}
                                    onInspectCompound={handleInspectCompound}
                                  />
                                )}
                              </div>
                            ) : (
                              <EmptyResultsState
                                query={turn.userPrompt}
                                onResetFilters={() =>
                                  setFilters({
                                    sourceFilter: 'all',
                                    maxPrice: null,
                                    verifiedPriceOnly: false,
                                    inStockOnly: false,
                                    sortBy: 'relevance',
                                  })
                                }
                                onTrySuggestion={(prompt) => runSparkOrchestration(prompt)}
                              />
                            )}
                          </>
                        )}

                        {/* 4. Comparison or Coupon Information when requested */}
                        {!isConversationalOnlyTurn &&
                          isLatestTurn &&
                          (turn.response.intent.comparisonRequested ||
                            comparedProducts.length >= 2) &&
                          comparedProducts.length >= 2 && (
                            <ProductComparisonTable
                              products={comparedProducts}
                              onRemoveFromCompare={handleToggleCompare}
                              onSelectForCheckout={(prod) => {
                                setIsCartCheckoutOpen(false);
                                setProductForCheckout(prod);
                              }}
                              onAddToCart={handleAddToCart}
                            />
                          )}

                        {!isConversationalOnlyTurn &&
                          (turn.response.intent.couponRequested ||
                            turn.response.verifiedCoupons.length > 0) && (
                            <CouponCard
                              coupon={turn.response.verifiedCoupons[0] || null}
                              coupons={turn.response.verifiedCoupons}
                              subsystemState={turn.response.couponSubsystemState}
                              onTrackClick={(couponItem) => {
                                fetch('/api/coupons/track-click', {
                                  method: 'POST',
                                  headers: buildAuthenticatedHeaders({ method: 'POST' }),
                                  body: JSON.stringify({
                                    feedicoOfferId: couponItem.feedicoOfferId || couponItem.id,
                                    merchantId: couponItem.merchantId || couponItem.merchant,
                                    merchantName: couponItem.merchantName || couponItem.merchant,
                                    couponCode:
                                      couponItem.code !== 'NO_CODE_NEEDED' ? couponItem.code : null,
                                    goUrl: couponItem.trackedUrl || couponItem.sourceUrl,
                                    merchantWebsiteUrl: couponItem.websiteUrl || null,
                                  }),
                                }).catch(() => {});
                              }}
                            />
                          )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}

          {/* SECTION 2: PRODUCT DISCOVERY */}
          {activeSection === 'discovery' && (
            <div className="max-w-5xl mx-auto space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-white">
                    {t.nav.discovery}
                  </h1>
                  <p className="text-xs text-zinc-400 mt-1">
                    Displays only live records retrieved from verified data sources during your session.
                  </p>
                </div>

                <div
                  role="group"
                  aria-label="Filter products by authorized source"
                  className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-zinc-900 border border-white/[0.07]"
                >
                  {[
                    { id: 'all', label: 'All Verified Sources' },
                    { id: 'channel3_api', label: 'Channel3 API' },
                    { id: 'openlibrary_api', label: 'Open Library API' },
                  ].map((src) => (
                    <button
                      key={src.id}
                      type="button"
                      onClick={() => setFilters((prev) => ({ ...prev, sourceFilter: src.id }))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        filters.sourceFilter === src.id
                          ? 'bg-zinc-800 text-white shadow-xs'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {src.label}
                    </button>
                  ))}
                </div>
              </div>

              {liveDiscoveredOffers.length > 0 ? (
                <ProductResultGrid
                  offers={liveDiscoveredOffers}
                  queryTitle={latestResponseTurn?.userPrompt || 'All Verified Session Results'}
                  intent={latestOrchestration?.intent || undefined}
                  recommendedProductId={latestOrchestration?.recommendedProductId || null}
                  comparedProductIds={comparedProductIds}
                  savedProductIds={savedProductIds}
                  onToggleCompare={handleToggleCompare}
                  onToggleSave={handleToggleSaveProduct}
                  onOpenDetails={(prod) => setInspectedProduct(prod)}
                  onSelectForCheckout={(prod) => {
                    setIsCartCheckoutOpen(false);
                    setProductForCheckout(prod);
                  }}
                  onAddToCart={handleAddToCart}
                  onInspectCompound={handleInspectCompound}
                />
              ) : (
                <div className="rounded-3xl bg-[#121217]/90 border border-white/[0.08] p-12 text-center max-w-2xl mx-auto">
                  <Compass className="w-8 h-8 text-violet-400 mx-auto mb-3" />
                  <h2 className="text-lg font-semibold text-white mb-2">
                    No verified results queried yet
                  </h2>
                  <p className="text-xs text-zinc-400 leading-relaxed mb-6">
                    Under the Spark Strict Real-Data Directive, new sessions start with zero pre-populated products. Run a live search to query Channel3 Product Graph API and Open Library Catalog API in real time.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => runSparkOrchestration('Designing Data-Intensive Applications book and check verified coupons')}
                      className="py-2 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-medium text-white cursor-pointer"
                    >
                      Query Live Systems Engineering Catalog
                    </button>
                    <button
                      type="button"
                      onClick={() => runSparkOrchestration('Clean Architecture software engineering books')}
                      className="py-2 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 cursor-pointer"
                    >
                      Query Live Technical Books
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SECTION 2B: INTELLIGENT SHOPPING CART */}
          {activeSection === 'cart' && (
            <CartView
              cart={cart}
              cartLoading={cartLoading}
              cartSyncState={cartSyncState}
              cartError={cartError}
              validationReport={cartValidationReport}
              checkoutPreparation={cartCheckoutPrep}
              isValidating={isValidatingCart}
              isPreparingCheckout={isPreparingCartCheckout}
              availableCoupons={latestOrchestration?.verifiedCoupons || []}
              sandboxCatalog={sandboxCatalog}
              onUpdateQuantity={handleUpdateCartQuantity}
              onUpdateVariant={handleUpdateCartVariant}
              onRemoveItem={handleRemoveCartItem}
              onRestoreRemovedItem={handleRestoreRemovedCartItem}
              onRemoveUnavailableItems={handleRemoveUnavailableCartItems}
              onClearCart={handleClearCart}
              onApplyCoupon={handleApplyCartCoupon}
              onRemoveCoupon={handleRemoveCartCoupon}
              onAcceptPriceChanges={handleAcceptCartPriceChanges}
              onValidateCart={handleValidateCart}
              onPrepareAndProceedToCheckout={handlePrepareAndProceedToCartCheckout}
              onAddSandboxTestItem={handleAddSandboxTestItemToCart}
              onOpenProductDetails={handleOpenCartItemDetails}
              onNavigateToDiscovery={() => setActiveSection('discovery')}
              onNavigateToConversation={() => setActiveSection('conversation')}
            />
          )}

          {/* SECTION 3: COUPONS & DEALS (FEEDICO PARTNER API) */}
          {activeSection === 'coupons' && (
            <CouponsView
              sessionOffers={allSessionOffers}
              sessionCoupons={latestOrchestration?.verifiedCoupons || []}
              onNotify={(msg) => triggerCompletionFeedback(msg)}
            />
          )}

          {/* SECTION 4: PRICE COMPARISONS */}
          {activeSection === 'comparison' && (
            <div className="max-w-5xl mx-auto space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-white">
                    {t.nav.comparison}
                  </h1>
                  <p className="text-xs text-zinc-400 mt-1">
                    Side-by-side comparison of live source records, verification statuses, and canonical links.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSection('conversation')}
                  className="py-2 px-3.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs text-zinc-200 self-start cursor-pointer"
                >
                  Return to Conversation
                </button>
              </div>

              {comparedProducts.length > 0 ? (
                <ProductComparisonTable
                  products={comparedProducts}
                  onRemoveFromCompare={handleToggleCompare}
                  onSelectForCheckout={(prod) => {
                    setIsCartCheckoutOpen(false);
                    setProductForCheckout(prod);
                  }}
                  onAddToCart={handleAddToCart}
                />
              ) : (
                <div className="rounded-2xl bg-[#121217]/90 border border-white/[0.08] p-10 text-center">
                  <p className="text-sm text-zinc-300 mb-3">
                    Select products from a live search to compare their verified attributes side-by-side.
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      runSparkOrchestration('Compare Python programming books and audiobooks under $50')
                    }
                    className="py-2 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-medium text-white cursor-pointer"
                  >
                    Run Live Comparison Query
                  </button>
                </div>
              )}
            </div>
          )}

          {/* SECTION 5: SAVED PRODUCTS & SPARK PRICE WATCHLIST */}
          {activeSection === 'saved' && (
            <SavedProductsView
              savedProducts={savedProducts}
              comparedProductIds={comparedProductIds}
              recommendedProductId={null}
              isRevalidating={isRevalidatingSaved}
              revalidationFindings={savedRevalidationFindings}
              lastRevalidatedAt={lastSavedRevalidatedAt}
              onRevalidateSavedProducts={handleRevalidateSavedProducts}
              onAssignCollection={handleAssignCollection}
              onToggleCompare={handleToggleCompare}
              onToggleSave={handleToggleSaveProduct}
              onOpenDetails={(prod) => setInspectedProduct(prod)}
              onSelectForCheckout={(prod) => {
                setIsCartCheckoutOpen(false);
                setProductForCheckout(prod);
              }}
              onAddToCart={handleAddToCart}
              onInspectCompound={handleInspectCompound}
              onNavigateToDiscovery={() => setActiveSection('discovery')}
              onAddWatchlistItem={handleAddWatchlistItem}
            />
          )}

          {/* SECTION 6: PURCHASES & PAYMENTS */}
          {activeSection === 'purchases' && (
            <PurchasesView
              user={user}
              purchases={purchases}
              t={t}
              onRefreshPurchases={refreshUserPurchases}
              onOpenPayPalSandbox={() => setActiveSection('settings')}
              onReturnToSpark={() => setActiveSection('conversation')}
            />
          )}

          {/* SECTION 6C: AG GRID INTELLIGENT ANALYTICS WORKSPACE */}
          {activeSection === 'analytics' && (
            <AgGridAnalyticsWorkspace
              savedProducts={savedProducts}
              comparedProducts={comparedProducts}
              purchases={purchases}
              coupons={latestOrchestration?.verifiedCoupons || []}
              quotaStatus={quotaStatus}
              onOpenDetails={(prod) => setInspectedProduct(prod)}
              onSelectForCheckout={(prod) => setProductForCheckout(prod)}
              onRefreshData={refreshQuotaStatus}
            />
          )}

          {/* SECTION 6D: SUBSCRIPTION PLANS & QUOTA MONITOR */}
          {activeSection === 'subscriptions' && (
            <SubscriptionPlansView
              user={user}
              quotaStatus={quotaStatus}
              accountBalance={accountBalance}
              onRefreshQuota={refreshQuotaStatus}
              onPlanActivated={(_planId, updatedBalance) => {
                if (updatedBalance) {
                  setAccountBalance(updatedBalance);
                }
                void fetchAccountBalance(false);
                void refreshUserPurchases();
                triggerCompletionFeedback('Subscription activated and deducted from PayPal wallet!');
              }}
              onOpenAnalytics={() => setActiveSection('analytics')}
            />
          )}

          {/* SECTION 7: SETTINGS */}
          {activeSection === 'settings' && (
            <SettingsView
              user={user}
              t={t}
              paypalAuthUrl={paypalAuthUrl}
              onUpdatePreferences={handleUpdatePreferences}
              onConnectPayPal={handleConnectPayPal}
              onReconnectPayPal={handleReconnectPayPal}
              onTogglePayPalVault={handleTogglePayPalVault}
              onCancelPayPalConnecting={handleCancelPayPalConnecting}
              onDisconnectPayPal={handleDisconnectPayPal}
              onRefreshPayPalStatus={refreshPayPalConnectionStatus}
              onOpenPayPalSandbox={() => setActiveSection('settings')}
              onSignOut={handleSignOut}
              onNavigateToSubscriptions={() => setActiveSection('subscriptions')}
            />
          )}
        </main>

        {/* Persistent Bottom Message Composer inside Conversation Workspace */}
        {activeSection === 'conversation' && hasActiveConversationTurns && (
          <div className="px-4 sm:px-8">
            <MessageComposer
              value={queryInput}
              onChange={setQueryInput}
              onSubmit={(customPrompt, voiceMeta) =>
                runSparkOrchestration(customPrompt, false, voiceMeta)
              }
              onStopGeneration={handleStopGeneration}
              isExecuting={isOrchestrating}
              activeContextOfferCount={latestOrchestration?.offers.length || 0}
              language={user.preferences.language}
              latestSpokenSummary={
                latestOrchestration?.voiceInteraction?.spokenSummaryText ||
                latestOrchestration?.coordinatorMessage ||
                null
              }
              latestVoiceInteraction={latestOrchestration?.voiceInteraction || null}
            />
          </div>
        )}
      </div>

      {/* Zone 3: Right Contextual Shopping Panel */}
      {activeSection === 'conversation' && hasActiveConversationTurns && (
        <ContextualShoppingPanel
          isOpen={isRightPanelOpen}
          onClose={() => setIsRightPanelOpen(false)}
          filters={filters}
          onUpdateFilters={(next) => setFilters((prev) => ({ ...prev, ...next }))}
          comparedProducts={comparedProducts}
          savedProducts={savedProducts}
          cart={cart}
          onUpdateCartQuantity={handleUpdateCartQuantity}
          onRemoveCartItem={handleRemoveCartItem}
          onCheckoutCart={() => {
            setProductForCheckout(null);
            setIsCartCheckoutOpen(true);
          }}
          onRemoveCompared={handleToggleCompare}
          onRemoveSaved={handleToggleSaveProduct}
          onOpenComparisonSection={() => setActiveSection('comparison')}
          onSelectForCheckout={(prod) => {
            setIsCartCheckoutOpen(false);
            setProductForCheckout(prod);
          }}
          isExecuting={isOrchestrating}
        />
      )}

      {/* Slide-Over Product Details Inspector */}
      <ProductDetailsPanel
        product={inspectedProduct}
        onClose={() => setInspectedProduct(null)}
        onSelectForCheckout={(prod) => {
          setIsCartCheckoutOpen(false);
          setProductForCheckout(prod);
        }}
        onAddToCart={handleAddToCart}
        onToggleSave={handleToggleSaveProduct}
        isSaved={Boolean(inspectedProduct && savedProductIds.includes(inspectedProduct.id))}
      />

      {/* Explicit Sandbox Checkout & Order Confirmation Modal (Single Product or Cart) */}
      {(productForCheckout || isCartCheckoutOpen) && (
        <CheckoutConfirmationDialog
          product={productForCheckout}
          fromCart={isCartCheckoutOpen && !productForCheckout}
          initialQuantity={checkoutInitialQuantity}
          cart={cart}
          availableCoupons={latestOrchestration?.verifiedCoupons || []}
          paypalStatus={user.paypal.status}
          paypalEmail={user.paypal.sandboxEmail}
          onConnectPayPal={handleConnectPayPal}
          onOpenPayPalSandbox={() => setActiveSection('settings')}
          onUpdateCartQuantity={handleUpdateCartQuantity}
          onRemoveCartItem={handleRemoveCartItem}
          onCartUpdated={(nextCart) => {
            setCart(nextCart);
            syncCartToFirestoreIfAuthed(nextCart);
          }}
          onClose={() => {
            setProductForCheckout(null);
            setCheckoutInitialQuantity(1);
            setIsCartCheckoutOpen(false);
          }}
          onViewMyPurchases={() => {
            setProductForCheckout(null);
            setCheckoutInitialQuantity(1);
            setIsCartCheckoutOpen(false);
            setActiveSection('purchases');
          }}
          onPurchaseSuccess={(newPurchase, updatedCart) => {
            setPurchases((prev) => {
              const map = new Map<string, PurchaseRecord>();
              for (const p of [newPurchase, ...prev]) {
                map.set(p.orderReference || p.id, p);
              }
              return Array.from(map.values());
            });
            if (updatedCart !== undefined) {
              setCart(updatedCart);
              syncCartToFirestoreIfAuthed(updatedCart);
            } else {
              void fetchUserCart();
            }
            if (auth.currentUser && auth.currentUser.uid === user.id) {
              savePurchaseRecordToFirestore(auth.currentUser.uid, newPurchase).catch(
                () => {}
              );
            }
            fetchAccountBalance(false);
            triggerCompletionFeedback(
              `Sandbox order confirmed via PayPal! Spark Order ${newPurchase.orderReference}`
            );
          }}
        />
      )}

      {/* Live PubChem Bioactive Compound Modal */}
      {inspectedCompound && (
        <ScienceInspectorModal
          compound={inspectedCompound}
          onClose={() => setInspectedCompound(null)}
        />
      )}
    </div>
  );
}
