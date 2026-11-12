import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Bell,
  BellRing,
  Check,
  CheckCircle2,
  Coins,
  CreditCard,
  Crown,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Key,
  Link2,
  Lock,
  LogOut,
  Palette,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sliders,
  Sparkles,
  Trash2,
  Unlink,
  User,
  Volume2,
  Wallet,
} from 'lucide-react';
import type {
  AccentColor,
  ExternalApiCredentialsReport,
  SupportedLanguage,
  ThemeMode,
  UserPreferences,
  UserProfile,
} from '../types/spark';
import type { TranslationStrings } from '../utils/i18n';
import { playTaskCompletionSound } from '../utils/sound';

interface Channel3StatusPayload {
  sourceId: string;
  sourceName: string;
  baseUrl: string;
  authHeader: string;
  configured: boolean;
  connected: boolean;
  explicitState: string;
  lastVerifiedAt: string | null;
  documentedEndpoints: string[];
  capabilities: {
    productSearch: boolean;
    urlLookup: boolean;
    productDetail: boolean;
    multiMerchantOffers: boolean;
    priceAndAvailability: boolean;
    ratingsRollup: boolean;
    shippingCalculation: boolean;
    taxCalculation: boolean;
    couponVerification: boolean;
    directCheckout: boolean;
  };
  message: string;
}

interface SettingsViewProps {
  user: UserProfile;
  t: TranslationStrings;
  paypalAuthUrl?: string | null;
  onUpdatePreferences: (updates: Partial<UserPreferences>) => Promise<void>;
  onConnectPayPal: () => Promise<void>;
  onReconnectPayPal?: () => Promise<void>;
  onTogglePayPalVault?: (enableVault: boolean) => Promise<void>;
  onCancelPayPalConnecting?: () => void;
  onDisconnectPayPal: () => Promise<void>;
  onRefreshPayPalStatus?: () => Promise<void>;
  onOpenPayPalSandbox?: () => void;
  onSignOut?: () => Promise<void>;
  onNavigateToSubscriptions?: () => void;
}

const AVATAR_GRADIENTS = [
  { id: 'violet', value: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 50%, #06b6d4 100%)', label: 'Nebula Violet' },
  { id: 'ocean', value: 'linear-gradient(135deg, #0284c7 0%, #06b6d4 50%, #10b981 100%)', label: 'Cyan Horizon' },
  { id: 'obsidian', value: 'linear-gradient(135deg, #27272a 0%, #52525b 50%, #8b5cf6 100%)', label: 'Graphite Pulse' },
];

export const SettingsView: React.FC<SettingsViewProps> = ({
  user,
  t,
  paypalAuthUrl,
  onUpdatePreferences,
  onConnectPayPal,
  onReconnectPayPal,
  onTogglePayPalVault,
  onCancelPayPalConnecting,
  onDisconnectPayPal,
  onRefreshPayPalStatus,
  onOpenPayPalSandbox,
  onSignOut,
  onNavigateToSubscriptions,
}) => {
  const [displayName, setDisplayName] = useState(user.preferences.displayName);
  const [preferredName, setPreferredName] = useState(user.preferences.preferredName);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [channel3Status, setChannel3Status] = useState<Channel3StatusPayload | null>(null);
  const [verifyingChannel3, setVerifyingChannel3] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [disconnectingPayPal, setDisconnectingPayPal] = useState(false);
  const [reconnectingPayPal, setReconnectingPayPal] = useState(false);
  const [updatingVault, setUpdatingVault] = useState(false);
  const [showFullPayPalEmail, setShowFullPayPalEmail] = useState(false);
  const [credentialsReport, setCredentialsReport] =
    useState<ExternalApiCredentialsReport | null>(null);
  const [verifyingCredentialsRouting, setVerifyingCredentialsRouting] = useState(false);
  const [livePublicSummary, setLivePublicSummary] = useState<{
    openLibraryRecords: number;
    pubchemCidVerified: boolean;
  } | null>(null);

  const [activeSettingsTab, setActiveSettingsTab] = useState<
    'all' | 'account' | 'appearance' | 'preferences' | 'notifications' | 'privacy' | 'billing' | 'security'
  >('all');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState<{ ok?: boolean; msg?: string } | null>(null);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [confirmingAccountDeletion, setConfirmingAccountDeletion] = useState(false);
  const [deleteConfirmationWord, setDeleteConfirmationWord] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [accountDeleteError, setAccountDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch('/api/channel3/status')
      .then((res) => res.json())
      .then((data: Channel3StatusPayload) => {
        if (mounted) setChannel3Status(data);
      })
      .catch(() => {});
    fetch('/api/spark/credentials-status')
      .then((res) => res.json())
      .then((data: { ok?: boolean; report?: ExternalApiCredentialsReport }) => {
        if (mounted && data.report) setCredentialsReport(data.report);
      })
      .catch(() => {});
    if (onRefreshPayPalStatus) {
      onRefreshPayPalStatus().catch(() => {});
    }
    return () => {
      mounted = false;
    };
  }, []);

  const handleVerifyExternalRouting = async () => {
    setVerifyingCredentialsRouting(true);
    try {
      const res = await fetch('/api/spark/credentials-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.report) setCredentialsReport(data.report);
      if (data.livePublicVerification) setLivePublicSummary(data.livePublicVerification);
    } catch {
      // Ignore transient network errors
    } finally {
      setVerifyingCredentialsRouting(false);
    }
  };

  const handleVerifyChannel3 = async () => {
    setVerifyingChannel3(true);
    try {
      const res = await fetch('/api/channel3/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'headphones' }),
      });
      const payload = await res.json();
      const statusRes = await fetch('/api/channel3/status');
      const statusData = (await statusRes.json()) as Channel3StatusPayload;
      setChannel3Status({
        ...statusData,
        message: payload.error || statusData.message,
      });
    } catch {
      setChannel3Status((prev) =>
        prev
          ? {
              ...prev,
              connected: false,
              explicitState: 'Live search failed.',
              message: 'Network error while verifying Channel3 connection.',
            }
          : null
      );
    } finally {
      setVerifyingChannel3(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    await onUpdatePreferences({
      displayName: displayName.trim() || user.preferences.displayName,
      preferredName: preferredName.trim() || displayName.trim() || 'Friend',
    });
    setSavedNotice('Personal profile synced to Cloud Firestore.');
    setTimeout(() => setSavedNotice(null), 2500);
  };

  const handleConfirmDisconnectPayPal = async () => {
    setDisconnectingPayPal(true);
    try {
      await onDisconnectPayPal();
      setConfirmingDisconnect(false);
      setShowFullPayPalEmail(false);
    } finally {
      setDisconnectingPayPal(false);
    }
  };

  const handleReconnectClick = async () => {
    setReconnectingPayPal(true);
    try {
      if (onReconnectPayPal) {
        await onReconnectPayPal();
      } else {
        await onConnectPayPal();
      }
    } finally {
      setReconnectingPayPal(false);
    }
  };

  const handleToggleVaultClick = async (enable: boolean) => {
    if (!onTogglePayPalVault) return;
    setUpdatingVault(true);
    try {
      await onTogglePayPalVault(enable);
    } finally {
      setUpdatingVault(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordStatus(null);
    if (!newPassword || newPassword.length < 8) {
      setPasswordStatus({ ok: false, msg: 'New password must be at least 8 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordStatus({ ok: false, msg: 'New passwords do not match.' });
      return;
    }
    setIsUpdatingPassword(true);
    try {
      const res = await fetch('/api/auth/password-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to update password.');
      }
      setPasswordStatus({ ok: true, msg: 'Password successfully updated!' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      setPasswordStatus({
        ok: false,
        msg: err instanceof Error ? err.message : 'Error changing password',
      });
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const handleExecuteAccountDeletion = async () => {
    if (deleteConfirmationWord.trim().toUpperCase() !== 'DELETE') {
      setAccountDeleteError('Please type DELETE to confirm permanent account deletion.');
      return;
    }
    setIsDeletingAccount(true);
    setAccountDeleteError(null);
    try {
      const res = await fetch('/api/user/delete-account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Account deletion failed.');
      }
      if (onSignOut) {
        await onSignOut();
      } else {
        window.location.reload();
      }
    } catch (err: unknown) {
      setAccountDeleteError(err instanceof Error ? err.message : 'Deletion failed.');
      setIsDeletingAccount(false);
    }
  };

  const handleExportData = () => {
    const exportPayload = {
      sparkExportVersion: '2.0',
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
        preferences: user.preferences,
        paypal: {
          status: user.paypal.status,
          maskedEmail: user.paypal.maskedEmail,
          payerId: user.paypal.payerId,
          environment: user.paypal.environment,
          connectedAt: user.paypal.connectedAt,
        },
      },
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spark-account-data-${user.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const paypalStatus = user.paypal.status;

  const showSection = (tab: typeof activeSettingsTab) => {
    return activeSettingsTab === 'all' || activeSettingsTab === tab;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            {t.settingsTitle}
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Personalize your shopping preferences, notification triggers, privacy controls, and connected payment integrations.
          </p>
        </div>
        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            className="py-2 px-3.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs font-medium text-zinc-300 hover:text-white inline-flex items-center gap-2 self-start cursor-pointer transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign out</span>
          </button>
        )}
      </div>

      {/* Settings Center Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Settings Categories"
        className="flex items-center gap-1.5 p-1 rounded-2xl bg-zinc-900/80 border border-white/[0.08] overflow-x-auto scrollbar-none"
      >
        {[
          { id: 'all', label: 'All Settings', icon: Sliders },
          { id: 'account', label: 'Account & Profile', icon: User },
          { id: 'appearance', label: 'Appearance', icon: Palette },
          { id: 'preferences', label: 'App Preferences', icon: Globe },
          { id: 'notifications', label: 'Notifications', icon: Bell },
          { id: 'privacy', label: 'Privacy & Data', icon: Shield },
          { id: 'billing', label: 'Subscription & Billing', icon: CreditCard },
          { id: 'security', label: 'Security & Access', icon: Lock },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSettingsTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-testid={`settings-tab-${tab.id}`}
              onClick={() => setActiveSettingsTab(tab.id as typeof activeSettingsTab)}
              className={`px-3.5 py-2 rounded-xl text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap transition-all cursor-pointer ${
                isActive
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {savedNotice && (
        <div
          role="status"
          className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs text-emerald-300 flex items-center gap-2"
        >
          <Check className="w-4 h-4" />
          <span>{savedNotice}</span>
        </div>
      )}

      {/* SECTION 1: ACCOUNT & PROFILE */}
      {showSection('account') && (
        <>
          <section
            data-testid="settings-account-section"
            className="rounded-2xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-5"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <User className="w-4 h-4 text-violet-400" />
                <h2>Personal Profile</h2>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-emerald-400">
                <Database className="w-3.5 h-3.5" />
                <span>Cloud Firestore Persistence Active</span>
              </span>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div>
                <span className="block text-xs font-medium text-zinc-300 mb-2">
                  Profile emblem style
                </span>
                <div className="flex flex-wrap items-center gap-3">
                  {AVATAR_GRADIENTS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => onUpdatePreferences({ avatarUrl: preset.value })}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs transition-all cursor-pointer ${
                        user.preferences.avatarUrl === preset.value
                          ? 'border-violet-400 bg-white/[0.07] text-white'
                          : 'border-white/[0.08] text-zinc-400 hover:text-white'
                      }`}
                    >
                      <span
                        className="w-4 h-4 rounded-full"
                        style={{ background: preset.value }}
                      />
                      <span>{preset.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="settings-display-name" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Display name
                  </label>
                  <input
                    id="settings-display-name"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full px-3.5 py-2 text-sm rounded-xl bg-zinc-900 border border-white/[0.08] text-white focus:outline-none focus:border-violet-400"
                  />
                </div>

                <div>
                  <label htmlFor="settings-preferred-name" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    {t.callYouPrompt}
                  </label>
                  <input
                    id="settings-preferred-name"
                    type="text"
                    value={preferredName}
                    onChange={(e) => setPreferredName(e.target.value)}
                    placeholder="e.g., Alex"
                    className="w-full px-3.5 py-2 text-sm rounded-xl bg-zinc-900 border border-white/[0.08] text-white focus:outline-none focus:border-violet-400"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-zinc-400">
                  Account Email (Isolated in <code className="font-mono text-zinc-300">/users/&#123;uid&#125;/private/info</code>):{' '}
                  <strong className="text-zinc-200 font-mono">{user.email}</strong>
                </span>
                <button
                  type="submit"
                  className="py-2 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-medium text-white transition-colors cursor-pointer"
                >
                  Save Profile
                </button>
              </div>
            </form>
          </section>

          {/* Connected PayPal Account Section */}
          <section
            aria-label="Payment Methods · PayPal"
            className="rounded-2xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#003087] to-[#0070BA] border border-[#38bdf8]/35 flex items-center justify-center shrink-0">
                  <span className="text-xs font-extrabold italic tracking-tight text-white">PP</span>
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold text-white">
                      Connected PayPal Account
                    </h2>
                    {paypalStatus === 'connected' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-semibold text-emerald-300">
                        <Check className="w-3 h-3" />
                        <span>Connected</span>
                      </span>
                    )}
                    {(paypalStatus === 'expired' || paypalStatus === 'revoked') && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-[11px] font-semibold text-amber-300 uppercase">
                        <AlertCircle className="w-3 h-3" />
                        <span>{paypalStatus}</span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400">
                    Official PayPal Identity API (OAuth 2.0 + OpenID Connect) · Bound to Spark User{' '}
                    <code className="font-mono text-zinc-300 break-all">{user.id}</code>
                  </p>
                </div>
              </div>
            </div>

            {/* STATE A: PayPal Not Connected */}
            {(paypalStatus === 'not_connected' || paypalStatus === 'not_configured') && (
              <div className="rounded-xl bg-zinc-900/75 border border-white/[0.07] p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">PayPal</span>
                      <span className="text-[11px] font-mono text-zinc-400">
                        (Status: Not Connected)
                      </span>
                    </div>
                    <p className="text-xs text-zinc-300 max-w-xl leading-relaxed">
                      Connect your personal PayPal account to Spark securely (<strong className="text-white">{user.email}</strong>) to enable verified payments and automated subscription billing.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={onConnectPayPal}
                    className="py-2.5 px-5 rounded-xl bg-[#0070BA] hover:bg-[#005ea6] text-xs font-semibold text-white inline-flex items-center gap-2 shrink-0 transition-colors cursor-pointer"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    <span>Connect PayPal</span>
                  </button>
                </div>
              </div>
            )}

            {/* STATE B: PayPal Connecting */}
            {paypalStatus === 'connecting' && (
              <div
                role="status"
                className="rounded-xl bg-[#0070BA]/10 border border-[#0070BA]/30 p-5 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <RefreshCw className="w-5 h-5 text-cyan-400 animate-spin shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-white">
                        PayPal Authorization in Progress…
                      </div>
                      <p className="text-xs text-zinc-300 max-w-xl leading-relaxed">
                        Complete sign-in and consent in the PayPal window. Spark will automatically mark your account as connected once confirmed.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    {onCancelPayPalConnecting && (
                      <button
                        type="button"
                        onClick={onCancelPayPalConnecting}
                        className="py-2 px-3.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.1] text-xs font-medium text-zinc-300 hover:text-white cursor-pointer"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* STATE C: PayPal Connected */}
            {paypalStatus === 'connected' && (
              <div className="rounded-xl bg-emerald-500/[0.06] border border-emerald-500/25 p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="space-y-3 flex-1">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                      <div className="p-3 rounded-xl bg-zinc-950/70 border border-white/[0.06]">
                        <div className="text-[11px] text-zinc-400 mb-0.5">Account Holder</div>
                        <div className="font-semibold text-zinc-100 truncate">
                          {user.paypal.paypalName || user.preferences.displayName || 'Verified Account Holder'}
                        </div>
                      </div>
                      <div className="p-3 rounded-xl bg-zinc-950/70 border border-white/[0.06]">
                        <div className="text-[11px] text-zinc-400 mb-0.5">Connected Email</div>
                        <div className="font-mono text-zinc-100 flex items-center justify-between gap-2">
                          <span className="truncate">
                            {showFullPayPalEmail && user.paypal.sandboxEmail
                              ? user.paypal.sandboxEmail
                              : user.paypal.maskedEmail || user.paypal.sandboxEmail || 'Verified'}
                          </span>
                          {user.paypal.sandboxEmail && (
                            <button
                              type="button"
                              onClick={() => setShowFullPayPalEmail((v) => !v)}
                              className="text-zinc-400 hover:text-white p-1 rounded cursor-pointer"
                            >
                              {showFullPayPalEmail ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="p-3 rounded-xl bg-zinc-950/70 border border-white/[0.06]">
                        <div className="text-[11px] text-zinc-400 mb-0.5">Payer ID</div>
                        <div className="font-mono text-zinc-100 truncate">
                          {user.paypal.payerId || user.paypal.paypalSubjectId || 'Verified'}
                        </div>
                      </div>
                      <div className="p-3 rounded-xl bg-zinc-950/70 border border-white/[0.06]">
                        <div className="text-[11px] text-zinc-400 mb-0.5">Environment</div>
                        <div className="font-mono text-emerald-300 uppercase">
                          {user.paypal.environment || 'Sandbox'}
                        </div>
                      </div>
                    </div>

                    {/* PayPal Vault */}
                    <div className="p-3.5 rounded-xl bg-zinc-950/75 border border-white/[0.07] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="text-xs font-semibold text-white flex items-center gap-2">
                          <span>PayPal Vault · Saved Payment Method</span>
                          {user.paypal.vaultId && (
                            <span className="px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 font-mono text-[10px] text-cyan-300">
                              Vault ID: {user.paypal.vaultId}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-zinc-400">
                          Save a vaulted PayPal payment token to streamline one-click checkout and automated subscription renewals.
                        </p>
                      </div>

                      {onTogglePayPalVault && (
                        <button
                          type="button"
                          disabled={updatingVault}
                          onClick={() => handleToggleVaultClick(!user.paypal.vaultId)}
                          className={`py-1.5 px-3.5 rounded-xl text-xs font-medium shrink-0 transition-colors cursor-pointer ${
                            user.paypal.vaultId
                              ? 'bg-cyan-500/20 border border-cyan-400/40 text-cyan-200 hover:bg-cyan-500/30'
                              : 'bg-zinc-800 hover:bg-zinc-700 border border-white/[0.08] text-zinc-200'
                          }`}
                        >
                          {updatingVault
                            ? 'Updating…'
                            : user.paypal.vaultId
                            ? 'Vault Enabled (Disable)'
                            : 'Enable PayPal Vault'}
                        </button>
                      )}
                    </div>
                  </div>

                  {!confirmingDisconnect && (
                    <div className="flex flex-wrap sm:flex-col items-stretch gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={handleReconnectClick}
                        disabled={reconnectingPayPal}
                        className="py-2 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.1] text-xs font-medium text-zinc-200 hover:text-white inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${reconnectingPayPal ? 'animate-spin' : ''}`} />
                        <span>Reconnect</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDisconnect(true)}
                        className="py-2 px-4 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-xs font-medium text-rose-300 inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Unlink className="w-3.5 h-3.5" />
                        <span>Disconnect</span>
                      </button>
                    </div>
                  )}
                </div>

                {confirmingDisconnect && (
                  <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/35 space-y-3">
                    <div className="text-xs font-semibold text-rose-200">
                      Confirm Disconnecting Your PayPal Account
                    </div>
                    <p className="text-xs text-zinc-300 leading-relaxed">
                      Disconnecting removes the verified link between your PayPal identity and your Spark account.
                    </p>
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={handleConfirmDisconnectPayPal}
                        disabled={disconnectingPayPal}
                        className="py-2 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white cursor-pointer"
                      >
                        {disconnectingPayPal ? 'Disconnecting…' : 'Confirm Disconnect'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDisconnect(false)}
                        disabled={disconnectingPayPal}
                        className="py-2 px-3.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.1] text-xs font-medium text-zinc-300 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </>
      )}

      {/* SECTION 2: APPEARANCE */}
      {showSection('appearance') && (
        <section
          data-testid="settings-appearance-section"
          className="rounded-2xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-5"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Palette className="w-4 h-4 text-cyan-400" />
            <h2>Appearance &amp; Theme</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <span className="block text-xs font-medium text-zinc-300 mb-2">Theme mode</span>
              <div className="grid grid-cols-3 gap-2">
                {(['dark', 'light', 'system'] as ThemeMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    data-testid={`theme-mode-${mode}`}
                    onClick={() => onUpdatePreferences({ theme: mode })}
                    className={`py-2 px-3 rounded-xl border text-xs font-medium capitalize transition-colors cursor-pointer ${
                      user.preferences.theme === mode
                        ? 'bg-violet-600/25 border-violet-400 text-white shadow-sm'
                        : 'bg-zinc-900/70 border-white/[0.08] text-zinc-400 hover:text-white'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-zinc-400 mt-2">
                Light mode delivers pristine WCAG AAA contrast with soft shadows, crisp borders, and zero dark-clipping.
              </p>
            </div>

            <div>
              <span className="block text-xs font-medium text-zinc-300 mb-2">Accent color</span>
              <div className="grid grid-cols-4 gap-2">
                {(['violet', 'blue', 'cyan', 'emerald'] as AccentColor[]).map((accent) => (
                  <button
                    key={accent}
                    type="button"
                    data-testid={`accent-color-${accent}`}
                    onClick={() => onUpdatePreferences({ accentColor: accent })}
                    className={`py-2 px-3 rounded-xl border text-xs font-medium capitalize transition-colors cursor-pointer ${
                      user.preferences.accentColor === accent
                        ? 'bg-white/[0.1] border-white text-white shadow-sm'
                        : 'bg-zinc-900/70 border-white/[0.08] text-zinc-400 hover:text-white'
                    }`}
                  >
                    {accent}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* SECTION 3: APP PREFERENCES */}
      {showSection('preferences') && (
        <section
          data-testid="settings-preferences-section"
          className="rounded-2xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-5"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Globe className="w-4 h-4 text-indigo-400" />
            <h2>App Preferences &amp; Regional Localization</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="settings-language" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Interface Language
              </label>
              <select
                id="settings-language"
                data-testid="settings-language-select"
                value={user.preferences.language}
                onChange={(e) =>
                  onUpdatePreferences({ language: e.target.value as SupportedLanguage })
                }
                className="w-full px-3.5 py-2 rounded-xl bg-zinc-900 border border-white/[0.08] text-xs text-white focus:outline-none focus:border-violet-400"
              >
                <option value="en">English (US / Global)</option>
                <option value="es">Español</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
                <option value="ja">日本語</option>
              </select>
            </div>

            <div>
              <label htmlFor="settings-currency" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Default Currency
              </label>
              <select
                id="settings-currency"
                data-testid="settings-currency-select"
                value={user.preferences.defaultCurrency || 'USD'}
                onChange={(e) =>
                  onUpdatePreferences({ defaultCurrency: e.target.value as 'USD' | 'EUR' | 'GBP' })
                }
                className="w-full px-3.5 py-2 rounded-xl bg-zinc-900 border border-white/[0.08] text-xs text-white focus:outline-none focus:border-violet-400"
              >
                <option value="USD">USD ($ - United States Dollar)</option>
                <option value="EUR">EUR (€ - Euro)</option>
                <option value="GBP">GBP (£ - British Pound)</option>
              </select>
            </div>

            <div>
              <label htmlFor="settings-region" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Shopping Region
              </label>
              <select
                id="settings-region"
                data-testid="settings-region-select"
                value={user.preferences.regionCountry || 'US'}
                onChange={(e) =>
                  onUpdatePreferences({ regionCountry: e.target.value })
                }
                className="w-full px-3.5 py-2 rounded-xl bg-zinc-900 border border-white/[0.08] text-xs text-white focus:outline-none focus:border-violet-400"
              >
                <option value="US">United States (Domestic & Global)</option>
                <option value="UK">United Kingdom</option>
                <option value="EU">European Union</option>
                <option value="CA">Canada</option>
                <option value="JP">Japan</option>
                <option value="GLOBAL">Global Retail Catalog</option>
              </select>
            </div>
          </div>

          <div className="pt-3 border-t border-white/[0.06] space-y-3">
            {/* Auto Apply Coupons Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <span className="block text-xs font-medium text-white">
                  Auto-Apply Verified Coupons
                </span>
                <span className="block text-[11px] text-zinc-400">
                  Automatically test and apply verified affiliate coupons to items before checkout
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={user.preferences.autoApplyCoupons !== false}
                onClick={() =>
                  onUpdatePreferences({ autoApplyCoupons: user.preferences.autoApplyCoupons === false })
                }
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                  user.preferences.autoApplyCoupons !== false
                    ? 'bg-emerald-500/20 border border-emerald-400/40 text-emerald-300'
                    : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {user.preferences.autoApplyCoupons !== false ? 'Enabled' : 'Disabled'}
              </button>
            </div>

            {/* Task Completion Sound Toggle */}
            <div className="flex items-center justify-between pt-2 border-t border-white/[0.04]">
              <div>
                <span className="block text-xs font-medium text-white">
                  Task Completion Sound
                </span>
                <span className="block text-[11px] text-zinc-400">
                  Play a subtle harmonic chime when Spark finishes a multi-source orchestration
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => playTaskCompletionSound(true)}
                  aria-label="Preview completion sound"
                  className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors cursor-pointer"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={user.preferences.soundEnabled}
                  onClick={() =>
                    onUpdatePreferences({ soundEnabled: !user.preferences.soundEnabled })
                  }
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                    user.preferences.soundEnabled
                      ? 'bg-emerald-500/20 border border-emerald-400/40 text-emerald-300'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {user.preferences.soundEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* SECTION 4: NOTIFICATIONS */}
      {showSection('notifications') && (
        <section
          data-testid="settings-notifications-section"
          className="rounded-2xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-5"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <BellRing className="w-4 h-4 text-emerald-400" />
            <h2>Notifications &amp; Price Drop Alerts</h2>
          </div>
          <p className="text-xs text-zinc-400">
            Configure real-time automated alerts for price changes on your Watchlist, coupon discoveries, and order fulfillments.
          </p>

          <div className="space-y-4 pt-1">
            {/* Price Drop Alert */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-zinc-900/60 border border-white/[0.06]">
              <div className="space-y-0.5">
                <div className="text-xs font-medium text-white flex items-center gap-2">
                  <span>Price Drop Alerts (Spark Price Watchlist)</span>
                  <span className="px-2 py-0.2 rounded text-[10px] font-mono bg-emerald-500/20 text-emerald-300">
                    Live Channel3 Monitoring
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400">
                  Notify me immediately when any tracked item in my Watchlist experiences a price drop or new merchant deal.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                data-testid="toggle-price-drop-alerts"
                aria-checked={user.preferences.notifyPriceDropAlerts !== false}
                onClick={() =>
                  onUpdatePreferences({
                    notifyPriceDropAlerts: user.preferences.notifyPriceDropAlerts === false,
                  })
                }
                className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                  user.preferences.notifyPriceDropAlerts !== false
                    ? 'bg-emerald-500/20 border border-emerald-400/40 text-emerald-300'
                    : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {user.preferences.notifyPriceDropAlerts !== false ? 'Active' : 'Muted'}
              </button>
            </div>

            {/* Coupon Expiry Alert */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-zinc-900/60 border border-white/[0.06]">
              <div className="space-y-0.5">
                <div className="text-xs font-medium text-white">
                  Coupon Expiry &amp; Promo Code Alerts
                </div>
                <p className="text-[11px] text-zinc-400">
                  Alert me when a high-value discount code for a saved item is within 48 hours of expiration.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                data-testid="toggle-coupon-expiry-alerts"
                aria-checked={user.preferences.notifyCouponExpiryAlerts !== false}
                onClick={() =>
                  onUpdatePreferences({
                    notifyCouponExpiryAlerts: user.preferences.notifyCouponExpiryAlerts === false,
                  })
                }
                className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                  user.preferences.notifyCouponExpiryAlerts !== false
                    ? 'bg-emerald-500/20 border border-emerald-400/40 text-emerald-300'
                    : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {user.preferences.notifyCouponExpiryAlerts !== false ? 'Active' : 'Muted'}
              </button>
            </div>

            {/* Order Status Alert */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-zinc-900/60 border border-white/[0.06]">
              <div className="space-y-0.5">
                <div className="text-xs font-medium text-white">
                  Order Execution &amp; Checkout Confirmations
                </div>
                <p className="text-[11px] text-zinc-400">
                  Deliver instant receipt summaries and order status updates upon completed PayPal Sandbox checkout.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                data-testid="toggle-order-status-alerts"
                aria-checked={user.preferences.notifyOrderStatusAlerts !== false}
                onClick={() =>
                  onUpdatePreferences({
                    notifyOrderStatusAlerts: user.preferences.notifyOrderStatusAlerts === false,
                  })
                }
                className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                  user.preferences.notifyOrderStatusAlerts !== false
                    ? 'bg-emerald-500/20 border border-emerald-400/40 text-emerald-300'
                    : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {user.preferences.notifyOrderStatusAlerts !== false ? 'Active' : 'Muted'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* SECTION 5: PRIVACY & DATA */}
      {showSection('privacy') && (
        <>
          <section
            data-testid="settings-privacy-section"
            className="rounded-2xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-5"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Shield className="w-4 h-4 text-violet-400" />
              <h2>Privacy, Consent &amp; Data Control</h2>
            </div>

            {/* Explainable Interest Tags */}
            <div className="rounded-xl bg-zinc-900/60 border border-white/[0.06] p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-white">
                    Consent-Driven Personalization &amp; Explainable Interest Tags
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Spark only retains shopping interest tags when you explicitly opt in. Every tag is transparent and removable.
                  </p>
                </div>
                <button
                  type="button"
                  data-testid="toggle-interest-consent-btn"
                  onClick={() => {
                    const nextConsent = !user.preferences.interestTagsConsent;
                    onUpdatePreferences({
                      interestTagsConsent: nextConsent,
                      interestTags: nextConsent
                        ? user.preferences.interestTags && user.preferences.interestTags.length > 0
                          ? user.preferences.interestTags
                          : ['Laptops & Computing', 'Verified Price Match', 'Audio & Headphones']
                        : [],
                    });
                  }}
                  className={`py-1.5 px-3.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer shrink-0 ${
                    user.preferences.interestTagsConsent
                      ? 'bg-violet-600/25 border-violet-400/40 text-violet-200'
                      : 'bg-zinc-800 border-white/10 text-zinc-400'
                  }`}
                >
                  {user.preferences.interestTagsConsent ? 'Opted In' : 'Opt In'}
                </button>
              </div>

              {user.preferences.interestTagsConsent && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-white/[0.06]">
                  {(user.preferences.interestTags || []).map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-violet-500/15 border border-violet-400/30 text-xs text-violet-200 font-medium"
                    >
                      <span>{tag}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const filtered = (user.preferences.interestTags || []).filter((tItem) => tItem !== tag);
                          onUpdatePreferences({ interestTags: filtered });
                        }}
                        className="text-violet-300 hover:text-white font-mono text-[10px] cursor-pointer"
                        title={`Remove ${tag}`}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                  {(!user.preferences.interestTags || user.preferences.interestTags.length === 0) && (
                    <span className="text-xs text-zinc-500">
                      No tags stored yet. Search products in Conversation to develop explainable interests.
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Conversation Search History Logging */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-zinc-900/60 border border-white/[0.06]">
              <div className="space-y-0.5">
                <div className="text-xs font-medium text-white">
                  Search &amp; Conversation History Persistence
                </div>
                <p className="text-[11px] text-zinc-400">
                  Allow Spark to sync conversation threads and comparisons across sessions via Firestore.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={user.preferences.searchHistoryLoggingConsent !== false}
                onClick={() =>
                  onUpdatePreferences({
                    searchHistoryLoggingConsent: user.preferences.searchHistoryLoggingConsent === false,
                  })
                }
                className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                  user.preferences.searchHistoryLoggingConsent !== false
                    ? 'bg-emerald-500/20 border border-emerald-400/40 text-emerald-300'
                    : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {user.preferences.searchHistoryLoggingConsent !== false ? 'Enabled' : 'Disabled'}
              </button>
            </div>

            {/* Data Export Button */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-zinc-900/60 border border-white/[0.06]">
              <div className="space-y-0.5">
                <div className="text-xs font-medium text-white flex items-center gap-2">
                  <Download className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Download Personal Data Export (JSON)</span>
                </div>
                <p className="text-[11px] text-zinc-400">
                  Export your complete account snapshot including preferences, saved items, and purchase ledger.
                </p>
              </div>
              <button
                type="button"
                onClick={handleExportData}
                data-testid="export-personal-data-btn"
                className="py-1.5 px-3.5 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-400/30 text-xs font-medium text-cyan-200 inline-flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Data</span>
              </button>
            </div>
          </section>

          {/* Channel3 Integration Health & Governance */}
          <section className="rounded-2xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Sparkles className="w-4 h-4 text-violet-400" />
                  <h2>Channel3 Product Graph &amp; Commerce API</h2>
                </div>
                <p className="text-xs text-zinc-400 max-w-xl leading-relaxed">
                  Server-side integration with <code className="font-mono text-zinc-300">https://api.trychannel3.com</code> using the <code className="font-mono text-zinc-300">CHANNEL3_API_KEY</code> server secret.
                </p>
                <p className="text-xs pt-1">
                  Status:{' '}
                  <strong className={channel3Status?.connected ? 'text-emerald-400' : 'text-cyan-300'}>
                    {channel3Status ? (channel3Status.connected ? `Connected (${channel3Status.explicitState})` : channel3Status.explicitState) : 'Checking...'}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={handleVerifyChannel3}
                disabled={verifyingChannel3}
                className="py-2 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white inline-flex items-center gap-2 transition-colors cursor-pointer shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${verifyingChannel3 ? 'animate-spin' : ''}`} />
                <span>{verifyingChannel3 ? 'Verifying...' : 'Test Connection'}</span>
              </button>
            </div>
          </section>
        </>
      )}

      {/* SECTION 6: SUBSCRIPTION & BILLING */}
      {showSection('billing') && (
        <section
          data-testid="settings-billing-section"
          className="rounded-2xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-5"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <CreditCard className="w-4 h-4 text-indigo-400" />
              <h2>Subscription &amp; Commercial Billing</h2>
            </div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-violet-500/20 text-violet-300 border border-violet-400/30">
              <Crown className="w-3.5 h-3.5" />
              <span>Commercial Plan Active</span>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-xl bg-zinc-900/70 border border-white/[0.06] space-y-1">
              <div className="text-[11px] text-zinc-400">Current Plan</div>
              <div className="text-sm font-bold text-white flex items-center gap-1.5">
                <Crown className="w-4 h-4 text-amber-400" />
                <span>Pro Intelligence</span>
              </div>
              <div className="text-[11px] text-emerald-400 font-mono">PayPal Sandbox Active</div>
            </div>

            <div className="p-3.5 rounded-xl bg-zinc-900/70 border border-white/[0.06] space-y-1">
              <div className="text-[11px] text-zinc-400">Omega AI Orchestrations</div>
              <div className="text-sm font-bold text-white font-mono">1,000 / month</div>
              <div className="text-[11px] text-zinc-400">Real-time live multi-source queries</div>
            </div>

            <div className="p-3.5 rounded-xl bg-zinc-900/70 border border-white/[0.06] space-y-1">
              <div className="text-[11px] text-zinc-400">Price Watchlist Slots</div>
              <div className="text-sm font-bold text-white font-mono">Unlimited Tracking</div>
              <div className="text-[11px] text-emerald-400">Channel3 Automated Revalidation</div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-950/80 border border-white/[0.07] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-white">
                Manage Quotas, Switch Plans, or Top Up Sandbox Wallet
              </div>
              <p className="text-[11px] text-zinc-400">
                Upgrade to Enterprise, switch billing cycles, or simulate recurring wallet deductions in the Subscriptions Studio.
              </p>
            </div>

            {onNavigateToSubscriptions && (
              <button
                type="button"
                data-testid="settings-open-subscriptions-btn"
                onClick={onNavigateToSubscriptions}
                className="py-2 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white inline-flex items-center gap-2 shrink-0 cursor-pointer transition-colors shadow-sm"
              >
                <Crown className="w-3.5 h-3.5" />
                <span>Open Subscriptions &amp; Plans</span>
              </button>
            )}
          </div>
        </section>
      )}

      {/* SECTION 7: SECURITY & ACCESS */}
      {showSection('security') && (
        <>
          <section
            data-testid="settings-security-section"
            className="rounded-2xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-5"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Lock className="w-4 h-4 text-emerald-400" />
                <h2>Security &amp; Password Governance</h2>
              </div>
              <span className="text-[11px] font-mono text-zinc-400">
                scrypt Hashed (Salted)
              </span>
            </div>

            {/* Password Update Form */}
            <form onSubmit={handleUpdatePassword} className="space-y-3.5 max-w-lg">
              <div>
                <label htmlFor="settings-current-password" className="block text-xs font-medium text-zinc-300 mb-1">
                  Current Password
                </label>
                <input
                  id="settings-current-password"
                  data-testid="input-current-password"
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter your current password"
                  className="w-full px-3.5 py-2 text-xs rounded-xl bg-zinc-900 border border-white/[0.08] text-white focus:outline-none focus:border-violet-400"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="settings-new-password" className="block text-xs font-medium text-zinc-300 mb-1">
                    New Password
                  </label>
                  <input
                    id="settings-new-password"
                    data-testid="input-new-password"
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min 8 characters"
                    className="w-full px-3.5 py-2 text-xs rounded-xl bg-zinc-900 border border-white/[0.08] text-white focus:outline-none focus:border-violet-400"
                  />
                </div>
                <div>
                  <label htmlFor="settings-confirm-password" className="block text-xs font-medium text-zinc-300 mb-1">
                    Confirm New Password
                  </label>
                  <input
                    id="settings-confirm-password"
                    data-testid="input-confirm-password"
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    className="w-full px-3.5 py-2 text-xs rounded-xl bg-zinc-900 border border-white/[0.08] text-white focus:outline-none focus:border-violet-400"
                  />
                </div>
              </div>

              {passwordStatus && (
                <div
                  className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                    passwordStatus.ok
                      ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                      : 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
                  }`}
                >
                  {passwordStatus.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                  <span>{passwordStatus.msg}</span>
                </div>
              )}

              <button
                type="submit"
                data-testid="btn-update-password"
                disabled={isUpdatingPassword}
                className="py-2 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-xs font-medium text-white transition-colors cursor-pointer inline-flex items-center gap-2"
              >
                {isUpdatingPassword ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
                <span>{isUpdatingPassword ? 'Updating Password…' : 'Change Password'}</span>
              </button>
            </form>

            {/* Firebase Authorized Domains Audit */}
            <div
              data-testid="firebase-authorized-domains-panel"
              className="mt-5 pt-4 border-t border-white/[0.06] space-y-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>
                    Firebase Authentication · Authorized Domains (<code className="font-mono text-cyan-300">gen-lang-client-0191581109</code>)
                  </span>
                </div>
                <a
                  href="https://console.firebase.google.com/project/gen-lang-client-0191581109/authentication/settings"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:text-cyan-200 underline underline-offset-2"
                >
                  <span>Console Settings</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
                {[
                  'spark-ten-theta.vercel.app',
                  'ais-pre-3g5zvurtf6ldxz5u3eoxma-50712932913.europe-west1.run.app',
                  'ais-dev-3g5zvurtf6ldxz5u3eoxma-50712932913.europe-west1.run.app',
                  'gen-lang-client-0191581109.firebaseapp.com',
                  'localhost',
                ].map((domain) => (
                  <span
                    key={domain}
                    className={`px-2.5 py-1 rounded-lg border inline-flex items-center gap-1.5 ${
                      domain === 'spark-ten-theta.vercel.app'
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200 font-semibold'
                        : 'bg-zinc-900/80 border-white/[0.07] text-zinc-300'
                    }`}
                  >
                    <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                    <span>{domain}</span>
                  </span>
                ))}
              </div>
            </div>
          </section>

          {/* DANGER ZONE: Account Deletion */}
          <section
            data-testid="settings-danger-zone-section"
            className="rounded-2xl bg-rose-950/20 border border-rose-500/30 p-6 space-y-4"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-rose-300">
              <Trash2 className="w-4 h-4 text-rose-400" />
              <h2>Danger Zone · Account Deletion</h2>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed max-w-xl">
              Permanently delete your Spark account, private user profiles, active shopping carts, saved products, and conversation histories. This action cannot be reversed.
            </p>

            {!confirmingAccountDeletion ? (
              <button
                type="button"
                data-testid="btn-init-delete-account"
                onClick={() => setConfirmingAccountDeletion(true)}
                className="py-2 px-4 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-xs font-semibold text-rose-200 transition-colors cursor-pointer inline-flex items-center gap-2"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Account…</span>
              </button>
            ) : (
              <div className="p-4 rounded-xl bg-zinc-950/90 border border-rose-500/40 space-y-3 max-w-md">
                <div className="text-xs font-semibold text-rose-200">
                  Type DELETE to confirm permanent account erasure
                </div>
                <input
                  type="text"
                  data-testid="input-delete-confirm-word"
                  value={deleteConfirmationWord}
                  onChange={(e) => setDeleteConfirmationWord(e.target.value)}
                  placeholder="Type DELETE"
                  className="w-full px-3 py-1.5 text-xs rounded-lg bg-zinc-900 border border-rose-500/40 text-white font-mono focus:outline-none"
                />
                {accountDeleteError && (
                  <div className="text-[11px] text-rose-400">{accountDeleteError}</div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    data-testid="btn-confirm-delete-account"
                    disabled={isDeletingAccount}
                    onClick={handleExecuteAccountDeletion}
                    className="py-1.5 px-3.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white cursor-pointer"
                  >
                    {isDeletingAccount ? 'Erasing Account…' : 'Permanently Delete'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmingAccountDeletion(false);
                      setDeleteConfirmationWord('');
                      setAccountDeleteError(null);
                    }}
                    className="py-1.5 px-3 rounded-lg bg-zinc-800 text-xs font-medium text-zinc-300 hover:text-white cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};
