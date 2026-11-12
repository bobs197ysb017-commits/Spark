import React, { useState, useEffect } from 'react';
import {
  MessageSquarePlus,
  Bookmark,
  TicketPercent,
  ShoppingBag,
  ShoppingCart,
  Settings,
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquare,
  Compass,
  Crown,
  Scale,
  BarChart3,
  Wallet,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Menu,
  X,
} from 'lucide-react';
import type {
  ConversationThread,
  NavSection,
  UserAccountBalanceSummary,
  UserProfile,
} from '../types/spark';

interface SidebarNavProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  comparisonCount?: number;
  savedCount: number;
  cartCount?: number;
  couponCount?: number;
  purchaseCount: number;
  user: UserProfile;
  accountBalance?: UserAccountBalanceSummary | null;
  balanceLoading?: boolean;
  balanceError?: string | null;
  onRefreshBalance?: () => void;
  t?: unknown;
  conversations: ConversationThread[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
}

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'spark_sidebar_collapsed';

export const SidebarNav: React.FC<SidebarNavProps> = ({
  activeSection,
  onSelectSection,
  comparisonCount = 0,
  savedCount,
  cartCount = 0,
  couponCount = 0,
  purchaseCount,
  user,
  accountBalance = null,
  balanceLoading = false,
  balanceError = null,
  onRefreshBalance,
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
}) => {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      // Ignore storage errors
    }
  }, [collapsed]);

  const lang = String(user.preferences?.language || 'en');
  const isRtl = lang === 'ar';

  const labelDictionary = {
    en: {
      newSpark: 'New Conversation',
      newShort: 'New',
      conversation: 'Conversation',
      explore: 'Discover',
      comparison: 'Comparisons',
      saved: 'Saved',
      cart: 'Cart',
      coupons: 'Coupons',
      purchases: 'Purchases',
      subscriptions: 'Subscriptions',
      analyticsGrid: 'Analytics',
      paypalSandbox: 'PayPal Sandbox',
      settings: 'Settings',
      recentSparks: 'Recent Conversations',
      paypalConnected: 'PayPal Connected',
      balanceLabel: 'Available Balance',
      balanceUnavailable: 'Unavailable',
      noWalletLinked: 'No Wallet Linked',
      refreshBalance: 'Refresh account balance',
      openWallet: 'Open Wallet & Sandbox Studio',
      pendingPrefix: 'Pending:',
    },
    ar: {
      newSpark: 'محادثة جديدة',
      newShort: 'جديد',
      conversation: 'المحادثة',
      explore: 'استكشاف',
      comparison: 'المقارنات',
      saved: 'المحفوظات',
      cart: 'سلة التسوق',
      coupons: 'الكوبونات',
      purchases: 'المشتريات',
      subscriptions: 'الاشتراكات',
      analyticsGrid: 'التحليلات',
      paypalSandbox: 'بيئة PayPal التجريبية',
      settings: 'الإعدادات',
      recentSparks: 'المحادثات الأخيرة',
      paypalConnected: 'متصل بـ PayPal',
      balanceLabel: 'الرصيد المتاح',
      balanceUnavailable: 'غير متاح',
      noWalletLinked: 'لا توجد محفظة مرتبطة',
      refreshBalance: 'تحديث رصيد الحساب',
      openWallet: 'فتح المحفظة وبيئة الاختبار',
      pendingPrefix: 'معلّق:',
    },
    fr: {
      newSpark: 'Nouvelle conversation',
      newShort: 'Nouveau',
      conversation: 'Conversation',
      explore: 'Découvrir',
      comparison: 'Comparaisons',
      saved: 'Enregistrés',
      cart: 'Panier',
      coupons: 'Coupons',
      purchases: 'Achats',
      subscriptions: 'Abonnements',
      analyticsGrid: 'Analytique',
      paypalSandbox: 'PayPal Sandbox',
      settings: 'Paramètres',
      recentSparks: 'Conversations récentes',
      paypalConnected: 'PayPal connecté',
      balanceLabel: 'Solde disponible',
      balanceUnavailable: 'Indisponible',
      noWalletLinked: 'Aucun portefeuille lié',
      refreshBalance: 'Actualiser le solde du compte',
      openWallet: 'Ouvrir le portefeuille Sandbox',
      pendingPrefix: 'En attente :',
    },
  };
  const labels =
    (labelDictionary as Record<string, typeof labelDictionary.en>)[lang] ||
    labelDictionary.en;

  const navItems: {
    id: NavSection;
    label: string;
    icon: React.FC<{ className?: string }>;
    count?: number;
  }[] = [
    {
      id: 'conversation',
      label: labels.conversation,
      icon: Sparkles,
    },
    {
      id: 'discovery',
      label: labels.explore,
      icon: Compass,
    },
    {
      id: 'comparison',
      label: labels.comparison,
      icon: Scale,
      count: comparisonCount,
    },
    {
      id: 'saved',
      label: labels.saved,
      icon: Bookmark,
      count: savedCount,
    },
    {
      id: 'cart',
      label: labels.cart,
      icon: ShoppingCart,
      count: cartCount,
    },
    {
      id: 'coupons',
      label: labels.coupons,
      icon: TicketPercent,
      count: couponCount,
    },
    {
      id: 'purchases',
      label: labels.purchases,
      icon: ShoppingBag,
      count: purchaseCount,
    },
    {
      id: 'subscriptions',
      label: labels.subscriptions,
      icon: Crown,
    },
    {
      id: 'analytics',
      label: labels.analyticsGrid,
      icon: BarChart3,
    },
    {
      id: 'settings',
      label: labels.settings,
      icon: Settings,
    },
  ];

  const displayName =
    user.preferences?.displayName || user.email?.split('@')[0] || 'Spark Member';
  const initials = displayName
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const isPayPalConnected = user.paypal?.status === 'connected';
  const avatarUrl = user.preferences?.avatarUrl || '';
  const isImageAvatar =
    avatarUrl.startsWith('http://') ||
    avatarUrl.startsWith('https://') ||
    avatarUrl.startsWith('data:image/');

  // Determine formatted balance display & tooltip
  const currencyCode =
    accountBalance?.currency || user.preferences?.defaultCurrency || 'USD';
  const currencySymbol =
    accountBalance?.currencySymbol ||
    (currencyCode === 'EUR' ? '€' : currencyCode === 'GBP' ? '£' : '$');

  const isUnavailable = accountBalance?.status === 'unavailable';
  const isNotConnectedState = accountBalance?.status === 'not_connected';
  const hasNumericBalance =
    accountBalance &&
    typeof accountBalance.availableBalance === 'number' &&
    Number.isFinite(accountBalance.availableBalance);

  const primaryBalanceDisplay = balanceLoading
    ? '...'
    : balanceError
    ? 'Error'
    : isUnavailable
    ? labels.balanceUnavailable
    : hasNumericBalance
    ? accountBalance.compactAvailableBalance ||
      accountBalance.formattedAvailableBalance
    : `${currencySymbol}0.00`;

  const fullPrecisionBalanceTooltip = balanceError
    ? `Balance error: ${balanceError}`
    : isUnavailable
    ? `${labels.balanceUnavailable} — ${accountBalance?.disclosureMessage || 'PayPal Identity OAuth verifies account ownership only.'}`
    : hasNumericBalance
    ? `${labels.balanceLabel}: ${accountBalance.formattedAvailableBalance} ${currencyCode} (${accountBalance.sourceLabel})${
        accountBalance.pendingAmount > 0
          ? ` · ${labels.pendingPrefix} ${currencySymbol}${accountBalance.pendingAmount.toFixed(2)}`
          : ''
      }`
    : `${labels.balanceLabel}: ${currencySymbol}0.00 ${currencyCode}`;

  const handleSelectNav = (id: NavSection) => {
    onSelectSection(id);
    setMobileDrawerOpen(false);
  };

  const renderAvatar = (sizeClass = 'w-9 h-9 text-xs') => (
    <div className="relative shrink-0">
      {isImageAvatar ? (
        <img
          src={avatarUrl}
          alt={displayName}
          className={`${sizeClass} rounded-full object-cover border border-white/15 shadow-sm`}
          referrerPolicy="no-referrer"
        />
      ) : (
        <div
          className={`${sizeClass} rounded-full bg-gradient-to-br from-violet-600 via-indigo-600 to-cyan-500 flex items-center justify-center font-bold text-white shadow-sm border border-white/15`}
        >
          {initials}
        </div>
      )}
      <span
        className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0B0B0F] ${
          isPayPalConnected
            ? 'bg-emerald-400'
            : isUnavailable
            ? 'bg-amber-400'
            : 'bg-cyan-400'
        }`}
        title={
          isPayPalConnected
            ? `${labels.paypalConnected} (${user.paypal?.maskedEmail || user.paypal?.sandboxEmail || 'Verified'})`
            : user.email
        }
      />
    </div>
  );

  // Phase 8 strict visibility rule:
  // ONLY display a PayPal balance beside the user profile when a PayPal account is actively linked (`connected`).
  // Never display a fake/default $500.00 or $0.00 balance when PayPal is not linked, disconnected, expired, or revoked.
  const shouldDisplayPayPalBalance =
    (isPayPalConnected || accountBalance?.visible === true) &&
    accountBalance?.visible !== false &&
    accountBalance?.status !== 'not_connected';

  const multiCurrencyEntries =
    shouldDisplayPayPalBalance && Array.isArray(accountBalance?.currencies)
      ? accountBalance.currencies
      : [];

  const renderBalanceBadge = (compactMode = false) => {
    if (!shouldDisplayPayPalBalance) {
      return null;
    }

    if (balanceLoading && !accountBalance) {
      return (
        <div
          data-testid="sidebar-balance-loading"
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.06] border border-white/[0.08] animate-pulse"
        >
          <Wallet className="w-3 h-3 text-zinc-400 shrink-0" />
          <span className="h-3 w-12 rounded bg-white/15" />
        </div>
      );
    }

    if (balanceError && !accountBalance) {
      return (
        <button
          type="button"
          data-testid="sidebar-balance-error"
          onClick={(e) => {
            e.stopPropagation();
            onRefreshBalance?.();
          }}
          title={fullPrecisionBalanceTooltip}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-[11px] font-medium text-rose-300 transition-colors cursor-pointer"
        >
          <AlertCircle className="w-3 h-3 shrink-0" />
          <span>Retry</span>
        </button>
      );
    }

    if (isUnavailable) {
      return (
        <div
          data-testid="sidebar-balance-unavailable"
          title={fullPrecisionBalanceTooltip}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/12 border border-amber-500/30 text-[11px] font-medium text-amber-300"
        >
          <AlertCircle className="w-3 h-3 shrink-0" />
          <span className="truncate">{labels.balanceUnavailable}</span>
        </div>
      );
    }

    return (
      <div
        data-testid={compactMode ? 'mobile-user-balance' : 'sidebar-user-balance'}
        title={fullPrecisionBalanceTooltip}
        className={`inline-flex items-center gap-1.5 ${
          compactMode ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
        } rounded-lg border font-mono font-semibold tabular-nums transition-colors bg-emerald-500/12 border-emerald-500/30 text-emerald-300`}
      >
        <Wallet className="w-3 h-3 text-emerald-400 shrink-0" />
        <span data-testid={compactMode ? 'mobile-balance-amount' : 'sidebar-balance-amount'}>
          {primaryBalanceDisplay}
        </span>
        {!compactMode && (
          <span
            data-testid="sidebar-balance-currency"
            className="text-[10px] font-sans font-semibold uppercase tracking-wider opacity-80"
          >
            {currencyCode}
          </span>
        )}
      </div>
    );
  };

  return (
    <aside
      dir={isRtl ? 'rtl' : 'ltr'}
      aria-label="Spark primary navigation"
      className={`w-full ${
        collapsed ? 'md:w-[82px]' : 'md:w-[280px]'
      } shrink-0 border-b md:border-b-0 ${
        isRtl ? 'md:border-l' : 'md:border-r'
      } border-white/[0.08] bg-[#0B0B0F]/95 backdrop-blur-xl px-3.5 py-3.5 md:py-4 md:h-screen md:flex md:flex-col md:justify-between md:overflow-hidden transition-[width] duration-200 ease-out select-none z-30`}
    >
      {/* 1. TOP BRAND HEADER & MOBILE BAR (FIXED / NON-SCROLLING) */}
      <div className="shrink-0">
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => handleSelectNav('conversation')}
              className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 via-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-violet-600/25 shrink-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              title="Spark Shopping & Product Discovery"
            >
              <Sparkles className="w-4 h-4 text-white" />
            </button>
            {!collapsed && (
              <div className="min-w-0">
                <div className="text-base font-semibold tracking-tight text-white flex items-center gap-1.5 truncate">
                  <span>Spark</span>
                </div>
              </div>
            )}
          </div>

          {/* Desktop Collapse Toggle */}
          <button
            type="button"
            data-testid="sidebar-collapse-toggle"
            onClick={() => setCollapsed((prev) => !prev)}
            className="hidden md:inline-flex p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>

          {/* Mobile Compact User Identity + Account Balance + Actions */}
          <div className="flex md:hidden items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleSelectNav('settings')}
              className="flex items-center gap-1.5 p-1 pr-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-colors cursor-pointer"
              title={shouldDisplayPayPalBalance ? fullPrecisionBalanceTooltip : `${displayName} · ${user.email}`}
            >
              {renderAvatar('w-7 h-7 text-[10px]')}
              {renderBalanceBadge(true)}
            </button>

            <button
              type="button"
              onClick={onNewConversation}
              className="py-1.5 px-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-medium text-white inline-flex items-center gap-1 shadow-sm cursor-pointer"
              title={labels.newSpark}
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{labels.newShort}</span>
            </button>

            <button
              type="button"
              data-testid="mobile-sidebar-drawer-toggle"
              onClick={() => setMobileDrawerOpen((prev) => !prev)}
              className="p-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-200 cursor-pointer"
              aria-label="Toggle navigation drawer"
              aria-expanded={mobileDrawerOpen}
            >
              {mobileDrawerOpen ? (
                <X className="w-4 h-4" />
              ) : (
                <Menu className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {/* Desktop Primary Action Button */}
        <div className="hidden md:block mt-3.5">
          <button
            type="button"
            onClick={onNewConversation}
            title={labels.newSpark}
            className={`w-full py-2.5 ${
              collapsed ? 'px-0 justify-center' : 'px-3.5 justify-start'
            } rounded-xl bg-white hover:bg-zinc-100 text-zinc-950 font-semibold text-xs flex items-center gap-2.5 shadow-md transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400`}
          >
            <MessageSquarePlus className="w-4 h-4 shrink-0" />
            {!collapsed && <span className="truncate">{labels.newSpark}</span>}
          </button>
        </div>

        {/* Mobile Horizontal Quick-Navigation Strip */}
        <nav
          aria-label="Mobile quick navigation"
          className="flex md:hidden items-center gap-1.5 overflow-x-auto pt-3 pb-1 scrollbar-none"
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`mobile-nav-${item.id}`}
                onClick={() => handleSelectNav(item.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all shrink-0 cursor-pointer ${
                  isActive
                    ? 'bg-violet-600/20 text-white border border-violet-500/40 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <Icon
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isActive ? 'text-violet-400' : 'text-zinc-400'
                  }`}
                />
                <span className="whitespace-nowrap">{item.label}</span>
                {typeof item.count === 'number' && item.count > 0 && (
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.2 rounded-md ${
                      isActive
                        ? 'bg-violet-500/30 text-violet-200'
                        : 'bg-white/[0.07] text-zinc-300'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Mobile Expandable Drawer (Full Account Balance Card + Recent Conversations) */}
        {mobileDrawerOpen && (
          <div
            data-testid="mobile-sidebar-drawer"
            className="md:hidden mt-3 pt-3 border-t border-white/[0.08] space-y-3 animate-fadeIn"
          >
            {/* Full Mobile User Account & Balance Card */}
            <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.08] space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  {renderAvatar('w-9 h-9 text-xs')}
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-white truncate">
                      {displayName}
                    </div>
                    <div className="text-[11px] text-zinc-400 truncate">
                      {isPayPalConnected
                        ? user.paypal?.maskedEmail ||
                          user.paypal?.sandboxEmail ||
                          labels.paypalConnected
                        : user.email}
                    </div>
                  </div>
                </div>
                {shouldDisplayPayPalBalance && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    {renderBalanceBadge(false)}
                    {onRefreshBalance && (
                      <button
                        type="button"
                        onClick={onRefreshBalance}
                        disabled={balanceLoading}
                        className="p-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-zinc-300 cursor-pointer"
                        title={labels.refreshBalance}
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${
                            balanceLoading ? 'animate-spin text-violet-400' : ''
                          }`}
                        />
                      </button>
                    )}
                  </div>
                )}
              </div>
              {shouldDisplayPayPalBalance && (
                <div className="flex items-center justify-between pt-2 border-t border-white/[0.06] text-[11px] text-zinc-400">
                  <span className="truncate">
                    {accountBalance?.sourceLabel || labels.balanceLabel}
                  </span>
                  <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    {accountBalance?.paypalEnvironment || user.paypal?.environment || 'sandbox'}
                  </span>
                </div>
              )}
            </div>

            {conversations.length > 0 && (
              <div className="space-y-1">
                <div className="px-2 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                  {labels.recentSparks}
                </div>
                <div className="max-h-36 overflow-y-auto space-y-1">
                  {conversations.slice(0, 6).map((conv) => {
                    const isCurrent =
                      conv.id === activeConversationId &&
                      activeSection === 'conversation';
                    return (
                      <button
                        key={conv.id}
                        type="button"
                        onClick={() => {
                          onSelectConversation(conv.id);
                          setMobileDrawerOpen(false);
                        }}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left truncate cursor-pointer ${
                          isCurrent
                            ? 'bg-white/[0.08] text-white font-medium'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03]'
                        }`}
                      >
                        <MessageSquare className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
                        <span className="truncate">{conv.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. DESKTOP SCROLLABLE NAVIGATION & RECENT CONVERSATIONS */}
      <div className="hidden md:flex md:flex-1 md:min-h-0 md:flex-col md:overflow-y-auto scrollbar-none mt-3 space-y-4 pr-0.5">
        <nav aria-label="Desktop primary navigation" className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            const tooltipText =
              typeof item.count === 'number' && item.count > 0
                ? `${item.label} (${item.count})`
                : item.label;
            return (
              <button
                key={item.id}
                type="button"
                data-testid={`sidebar-nav-${item.id}`}
                onClick={() => handleSelectNav(item.id)}
                title={collapsed ? tooltipText : undefined}
                aria-current={isActive ? 'page' : undefined}
                className={`relative w-full flex items-center ${
                  collapsed ? 'justify-center px-2' : 'justify-between px-3'
                } py-2.5 rounded-xl text-xs font-medium transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${
                  isActive
                    ? 'bg-gradient-to-r from-violet-600/20 via-indigo-600/15 to-transparent text-white border border-violet-500/35 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                {/* Active Left/Right Indicator Bar */}
                {isActive && (
                  <span
                    className={`absolute ${
                      isRtl ? 'right-0 rounded-l-full' : 'left-0 rounded-r-full'
                    } top-2 bottom-2 w-1 bg-gradient-to-b from-violet-400 to-cyan-400`}
                  />
                )}

                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 transition-colors ${
                      isActive ? 'text-violet-400' : 'text-zinc-400'
                    }`}
                  />
                  {!collapsed && (
                    <span className="truncate">{item.label}</span>
                  )}
                </div>

                {!collapsed &&
                  typeof item.count === 'number' &&
                  item.count > 0 && (
                    <span
                      data-testid={`sidebar-badge-${item.id}`}
                      className={`text-[11px] font-mono px-1.5 py-0.5 rounded-md tabular-nums shrink-0 ${
                        isActive
                          ? 'bg-violet-500/25 text-violet-200 border border-violet-500/30'
                          : 'bg-white/[0.06] text-zinc-300'
                      }`}
                    >
                      {item.count}
                    </span>
                  )}

                {collapsed &&
                  typeof item.count === 'number' &&
                  item.count > 0 && (
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-violet-400 ring-2 ring-[#0B0B0F]" />
                  )}
              </button>
            );
          })}
        </nav>

        {/* Recent Conversations */}
        {!collapsed && conversations.length > 0 && (
          <div className="pt-3 border-t border-white/[0.07] space-y-1.5">
            <div className="px-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">
              {labels.recentSparks}
            </div>
            <div className="space-y-1">
              {conversations.slice(0, 8).map((conv) => {
                const isCurrent =
                  conv.id === activeConversationId &&
                  activeSection === 'conversation';
                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => onSelectConversation(conv.id)}
                    title={conv.title}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs text-left transition-all truncate cursor-pointer ${
                      isCurrent
                        ? 'bg-white/[0.08] text-white font-medium border border-white/[0.1]'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03] border border-transparent'
                    }`}
                  >
                    <MessageSquare
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isCurrent ? 'text-violet-400' : 'text-zinc-500'
                      }`}
                    />
                    <span className="truncate">{conv.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 3. DESKTOP PINNED USER ACCOUNT & LIVE PAYPAL BALANCE FOOTER */}
      <div
        data-testid="sidebar-user-profile-section"
        className="hidden md:block shrink-0 pt-3 mt-2 border-t border-white/[0.08]"
      >
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => handleSelectNav('settings')}
              title={
                shouldDisplayPayPalBalance
                  ? `${displayName} (${user.email})\n${fullPrecisionBalanceTooltip}`
                  : `${displayName} (${user.email})`
              }
              className="p-1.5 rounded-xl hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              {renderAvatar('w-8 h-8 text-xs')}
            </button>
            {shouldDisplayPayPalBalance && (
              <button
                type="button"
                data-testid="sidebar-collapsed-balance"
                onClick={() => handleSelectNav('settings')}
                title={fullPrecisionBalanceTooltip}
                className="px-1.5 py-1 rounded-lg bg-emerald-500/12 hover:bg-emerald-500/20 border border-emerald-500/30 text-[10px] font-mono font-semibold text-emerald-300 tabular-nums truncate max-w-[68px] cursor-pointer"
              >
                {primaryBalanceDisplay}
              </button>
            )}
          </div>
        ) : (
          <div className="p-3 rounded-2xl bg-gradient-to-b from-white/[0.045] to-white/[0.02] hover:from-white/[0.065] hover:to-white/[0.03] border border-white/[0.08] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] transition-all space-y-2.5">
            {/* Tier 1: Full-Width User Identity Row (No Truncation Collision with Balance Pill) */}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => handleSelectNav('settings')}
                className="flex items-center gap-2.5 min-w-0 flex-1 text-left group cursor-pointer focus:outline-none"
                title={`${displayName} · ${user.email}`}
              >
                {renderAvatar('w-9 h-9 text-xs')}
                <div className="min-w-0 flex-1">
                  <div
                    data-testid="sidebar-user-name"
                    className="text-xs font-semibold text-white group-hover:text-violet-200 transition-colors truncate"
                  >
                    {displayName}
                  </div>
                  <div className="text-[11px] text-zinc-400 truncate flex items-center gap-1">
                    {isPayPalConnected ? (
                      <>
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span className="text-emerald-400 truncate">
                          {user.paypal?.maskedEmail || user.email || labels.paypalConnected}
                        </span>
                      </>
                    ) : (
                      <span className="truncate">{user.email}</span>
                    )}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleSelectNav('settings')}
                title={labels.settings}
                aria-label={labels.settings}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.07] transition-colors shrink-0 cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Tier 2: Dedicated PayPal Wallet Balance Bar — rendered ONLY when PayPal is actively connected */}
            {shouldDisplayPayPalBalance && (
              <div className="pt-2 border-t border-white/[0.06] space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => handleSelectNav('settings')}
                    className="cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded-lg"
                  >
                    {renderBalanceBadge(false)}
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    <span
                      data-testid="sidebar-paypal-env-badge"
                      className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/25 text-[9px] font-mono uppercase text-emerald-300"
                    >
                      {accountBalance?.paypalEnvironment || user.paypal?.environment || 'sandbox'}
                    </span>
                    {onRefreshBalance && (
                      <button
                        type="button"
                        data-testid="sidebar-balance-refresh-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRefreshBalance();
                        }}
                        disabled={balanceLoading}
                        title={labels.refreshBalance}
                        aria-label={labels.refreshBalance}
                        className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.07] disabled:opacity-50 transition-colors cursor-pointer"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${
                            balanceLoading ? 'animate-spin text-violet-400' : ''
                          }`}
                        />
                      </button>
                    )}
                  </div>
                </div>

                {/* Multi-Currency Balances Row (when PayPal returns >1 currency without merging currencies) */}
                {multiCurrencyEntries.length > 1 && (
                  <div
                    data-testid="sidebar-multi-currency-balances"
                    className="flex flex-wrap items-center gap-1.5 pt-1"
                  >
                    {multiCurrencyEntries.map((entry) => (
                      <span
                        key={entry.currency}
                        data-testid={`sidebar-currency-pill-${entry.currency}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-[10px] font-mono text-zinc-200 tabular-nums"
                        title={`${entry.currency}: Available ${entry.formattedAvailableBalance}${
                          entry.withheldBalance > 0
                            ? ` · Withheld ${entry.currencySymbol}${entry.withheldBalance.toFixed(2)}`
                            : ''
                        }`}
                      >
                        <span className="text-emerald-300 font-semibold">
                          {entry.formattedAvailableBalance}
                        </span>
                        <span className="text-zinc-400">{entry.currency}</span>
                      </span>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => handleSelectNav('settings')}
                  title={fullPrecisionBalanceTooltip}
                  className="w-full flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-200 truncate cursor-pointer"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  <span className="truncate" data-testid="sidebar-balance-source">
                    {accountBalance?.pendingAmount &&
                    accountBalance.pendingAmount > 0
                      ? `${labels.pendingPrefix} ${currencySymbol}${accountBalance.pendingAmount.toFixed(2)}`
                      : accountBalance?.withheldAmount &&
                        accountBalance.withheldAmount > 0
                      ? `Withheld: ${currencySymbol}${accountBalance.withheldAmount.toFixed(2)}`
                      : accountBalance?.sourceLabel || labels.balanceLabel}
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
