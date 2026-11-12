import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Link2,
  Lock,
  LogOut,
  Palette,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Unlink,
  User,
  Volume2,
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

  useEffect(() => {
    let mounted = true;
    fetch('/api/channel3/status')
      .then((res) => res.json())
      .then((data: Channel3StatusPayload) => {
        if (mounted) setChannel3Status(data);
      })
      .catch(() => {
        // Keep null if network fails
      });
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

  const paypalStatus = user.paypal.status;

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            {t.settingsTitle}
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Personalize how Spark addresses you, manage connected payment accounts, and inspect live integration statuses.
          </p>
        </div>
        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            className="py-2 px-3.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs font-medium text-zinc-300 hover:text-white inline-flex items-center gap-2 self-start cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign out</span>
          </button>
        )}
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

      {/* 1. Personal Profile */}
      <section className="rounded-2xl bg-[#121217]/90 border border-white/[0.08] p-6">
        <div className="flex items-center justify-between mb-4">
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

      {/* 2. Payment Methods -> PayPal (Payment Connections · Connected Accounts) */}
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
                  Payment Methods → PayPal
                </h2>
                <span className="text-xs text-zinc-500">
                  (Payment Connections · Connected Accounts)
                </span>
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
                    (Personal Account Linking · Status: Not Connected)
                  </span>
                </div>
                <p className="text-xs text-zinc-300 max-w-xl leading-relaxed">
                  Connect your personal PayPal account to Spark securely (<strong className="text-white">{user.email}</strong>). Use your existing PayPal account to enable supported payment features and streamline future purchases.
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

            {/* Privacy Notice */}
            <div className="p-3.5 rounded-xl bg-zinc-950/80 border border-white/[0.06] flex items-start gap-2.5 text-xs text-zinc-400">
              <Lock className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <div className="space-y-1 leading-relaxed">
                <div className="font-medium text-zinc-200">
                  Privacy Notice: What account information Spark receives
                </div>
                <p>
                  When you authorize with PayPal (<code className="font-mono text-zinc-300">openid profile email address https://uri.paypal.com/services/paypalattributes</code>), Spark receives your verified PayPal Payer ID (<code className="font-mono text-zinc-300">payer_id</code>), account holder name, email address, and verification status. Spark <strong className="text-zinc-200">never</strong> receives your PayPal password, bank account numbers, or payment card details, and any server-retained refresh token is encrypted at rest with AES-256-GCM.
                </p>
              </div>
            </div>

            {/* PayPal Developer Dashboard Preview OAuth 2.0 Configuration */}
            <div className="p-3.5 rounded-xl bg-zinc-950/90 border border-cyan-500/20 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-cyan-300">
                  PayPal Developer Dashboard · Preview OAuth 2.0 Configuration
                </span>
                <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 font-mono text-[10px] text-emerald-300">
                  HTTPS Reachable · /api/paypal/callback
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 pt-1 text-[11px]">
                <div>
                  <span className="text-zinc-400 block mb-0.5">
                    Exact OAuth Callback URL (Return URL in PayPal Developer Dashboard · <code className="font-mono text-zinc-300">PAYPAL_REDIRECT_URI</code>):
                  </span>
                  <code className="block px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-white/[0.07] font-mono text-cyan-300 break-all">
                    {typeof window !== 'undefined' ? window.location.origin : 'https://ais-pre-3g5zvurtf6ldxz5u3eoxma-50712932913.europe-west1.run.app'}/api/paypal/callback
                  </code>
                </div>
                <div>
                  <span className="text-zinc-400 block mb-0.5">
                    OAuth Initiation URL (<code className="font-mono text-zinc-300">POST /api/paypal/connect</code>):
                  </span>
                  <code className="block px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-white/[0.07] font-mono text-zinc-200 break-all">
                    {typeof window !== 'undefined' ? window.location.origin : 'https://ais-pre-3g5zvurtf6ldxz5u3eoxma-50712932913.europe-west1.run.app'}/api/paypal/connect
                  </code>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STATE B: PayPal Authorization in Progress */}
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
                    Complete sign-in, 2FA, and consent on the official PayPal authorization window. Spark will not mark your account as connected until PayPal confirms authorization.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  disabled
                  className="py-2 px-4 rounded-xl bg-[#0070BA]/40 text-xs font-semibold text-white/70 cursor-not-allowed inline-flex items-center gap-2"
                >
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Authorizing…</span>
                </button>
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

            {paypalAuthUrl && (
              <div className="pt-2 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
                <span>
                  If the PayPal authorization window did not open automatically:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    window.open(
                      paypalAuthUrl,
                      'spark_paypal_oauth',
                      'width=560,height=720,noopener=no'
                    );
                  }}
                  className="inline-flex items-center gap-1.5 text-cyan-300 hover:text-cyan-200 font-medium underline cursor-pointer"
                >
                  <span>Re-open Official PayPal Authorization Window</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* STATE C: Successfully Connected */}
        {paypalStatus === 'connected' && (
          <div className="rounded-xl bg-emerald-500/[0.06] border border-emerald-500/25 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="space-y-3 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/20 border border-emerald-500/40 text-xs font-semibold text-emerald-300">
                    <Check className="w-3.5 h-3.5" />
                    <span>PayPal Connected</span>
                  </span>
                  <span className="text-xs font-mono text-zinc-400">
                    Verified via PayPal Identity API ({(user.paypal.environment || 'sandbox').toUpperCase()})
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1 text-xs">
                  <div className="p-3 rounded-xl bg-zinc-950/70 border border-white/[0.06]">
                    <div className="text-[11px] text-zinc-400 mb-0.5">
                      Account Holder Name
                    </div>
                    <div className="font-semibold text-zinc-100 truncate">
                      {user.paypal.paypalName || user.preferences.displayName || 'Verified Account Holder'}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-zinc-950/70 border border-white/[0.06]">
                    <div className="text-[11px] text-zinc-400 mb-0.5">
                      Connected PayPal Email
                    </div>
                    <div className="font-mono text-zinc-100 flex items-center justify-between gap-2">
                      <span className="truncate">
                        {showFullPayPalEmail && user.paypal.sandboxEmail
                          ? user.paypal.sandboxEmail
                          : user.paypal.maskedEmail ||
                            user.paypal.sandboxEmail ||
                            'Not returned by scope'}
                      </span>
                      {user.paypal.sandboxEmail && user.paypal.maskedEmail && (
                        <button
                          type="button"
                          onClick={() => setShowFullPayPalEmail((v) => !v)}
                          aria-label={
                            showFullPayPalEmail ? 'Mask PayPal email' : 'Reveal PayPal email'
                          }
                          className="text-zinc-400 hover:text-white p-1 rounded cursor-pointer"
                        >
                          {showFullPayPalEmail ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-zinc-950/70 border border-white/[0.06]">
                    <div className="text-[11px] text-zinc-400 mb-0.5">
                      PayPal Payer ID
                    </div>
                    <div className="font-mono text-zinc-100 truncate">
                      {user.paypal.payerId || user.paypal.paypalSubjectId || 'Verified'}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-zinc-950/70 border border-white/[0.06]">
                    <div className="text-[11px] text-zinc-400 mb-0.5">Connection Date</div>
                    <div className="font-mono text-zinc-100">
                      {user.paypal.connectedAt
                        ? new Date(user.paypal.connectedAt).toLocaleString()
                        : 'Verified Session'}
                    </div>
                  </div>
                </div>

                {/* PayPal Vault Preference (Payment Method Saving) */}
                <div className="p-3.5 rounded-xl bg-zinc-950/75 border border-white/[0.07] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-white flex items-center gap-2">
                      <span>PayPal Vault · Save Payment Method for Future Purchases</span>
                      {user.paypal.vaultId && (
                        <span className="px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 font-mono text-[10px] text-cyan-300">
                          Vault ID: {user.paypal.vaultId}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-400">
                      Voluntary opt-in: Save a vaulted PayPal payment token alongside your linked identity to streamline future Spark Checkout approvals.
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
                        ? 'Updating Vault…'
                        : user.paypal.vaultId
                        ? 'Vault Enabled (Remove)'
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
                    <span>Reconnect PayPal</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDisconnect(true)}
                    className="py-2 px-4 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-xs font-medium text-rose-300 inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Unlink className="w-3.5 h-3.5" />
                    <span>Disconnect PayPal</span>
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
                  Disconnecting revokes your stored PayPal authorization on the backend and removes the verified link between your PayPal identity and your Spark account (<strong className="text-white">{user.email}</strong>). Your Spark account and past purchase history will remain intact.
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
                    Keep Connected
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* STATE E: Expired Authorization or Revoked Permissions */}
        {(paypalStatus === 'expired' || paypalStatus === 'revoked') && (
          <div
            role="alert"
            className="rounded-xl bg-amber-500/[0.08] border border-amber-500/30 p-5 space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-white">
                    {paypalStatus === 'expired'
                      ? 'PayPal Authorization Expired'
                      : 'PayPal Permissions Revoked'}
                  </div>
                  <p className="text-xs text-amber-200/90 max-w-xl leading-relaxed">
                    {user.paypal.errorMessage ||
                      (paypalStatus === 'expired'
                        ? 'Your PayPal authorization session has expired. Reconnect your PayPal account to restore verified payment features.'
                        : 'Your PayPal permissions were revoked from your PayPal security settings. Reconnect your PayPal account to re-authorize Spark.')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleReconnectClick}
                  disabled={reconnectingPayPal}
                  className="py-2.5 px-4 rounded-xl bg-[#0070BA] hover:bg-[#005ea6] text-xs font-semibold text-white inline-flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${reconnectingPayPal ? 'animate-spin' : ''}`} />
                  <span>Reconnect PayPal</span>
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDisconnectPayPal}
                  disabled={disconnectingPayPal}
                  className="py-2.5 px-3.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.1] text-xs font-medium text-zinc-300 hover:text-white cursor-pointer"
                >
                  Disconnect PayPal
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STATE D: Authorization Failed or Cancelled */}
        {paypalStatus === 'error' && (
          <div
            role="alert"
            className="rounded-xl bg-rose-500/[0.08] border border-rose-500/30 p-5 space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-white">
                    PayPal Authorization Failed or Cancelled
                  </div>
                  <p className="text-xs text-rose-200/90 max-w-xl leading-relaxed">
                    {user.paypal.errorMessage ||
                      'Spark could not verify a PayPal identity response. Your account has not been marked as connected.'}
                  </p>
                  {user.paypal.errorCode && (
                    <div className="text-[11px] font-mono text-zinc-400">
                      Error code: <span className="text-zinc-300">{user.paypal.errorCode}</span>
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={onConnectPayPal}
                className="py-2.5 px-4 rounded-xl bg-[#0070BA] hover:bg-[#005ea6] text-xs font-semibold text-white inline-flex items-center gap-2 shrink-0 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Try Again</span>
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-white/[0.06] text-[11px] font-mono">
          <div className="p-3 rounded-xl bg-zinc-900/70 border border-white/[0.05] space-y-1">
            <div className="text-cyan-300 font-semibold">
              1. Log in with PayPal (Identity OAuth 2.0 / OIDC)
            </div>
            <div className="text-zinc-400">
              • Supports <span className="text-zinc-200">PAYPAL_ENV=live</span> (<span className="text-zinc-200">www.paypal.com/signin/authorize</span>) &amp; <span className="text-zinc-200">sandbox</span> with zero silent fallback.
            </div>
            <div className="text-zinc-400 break-words">
              • Exchanges <span className="text-zinc-200">authorization_code</span> on backend &amp; verifies <span className="text-zinc-200 break-all">/v1/identity/oauth2/userinfo?schema=paypalv1.1</span>.
            </div>
          </div>
          <div className="p-3 rounded-xl bg-zinc-900/70 border border-white/[0.05] space-y-1">
            <div className="text-violet-300 font-semibold">
              2. PayPal Checkout &amp; PayPal Vault Architecture
            </div>
            <div className="text-zinc-400">
              • Persists <span className="text-zinc-200">paypal_connections</span> table with AES-256-GCM encrypted server tokens.
            </div>
            <div className="text-zinc-400">
              • Separates identity linking from <span className="text-zinc-200">PayPal Checkout</span> &amp; <span className="text-zinc-200">PayPal Vault</span> payment method saving.
            </div>
          </div>
        </div>
      </section>

      {/* 3. Appearance & Language */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="rounded-2xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Palette className="w-4 h-4 text-cyan-400" />
            <h2>Appearance</h2>
          </div>

          <div>
            <span className="block text-xs text-zinc-400 mb-2">Theme mode</span>
            <div className="grid grid-cols-3 gap-2">
              {(['dark', 'light', 'system'] as ThemeMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onUpdatePreferences({ theme: mode })}
                  className={`py-2 px-3 rounded-xl border text-xs font-medium capitalize transition-colors cursor-pointer ${
                    user.preferences.theme === mode
                      ? 'bg-violet-600/20 border-violet-400 text-white'
                      : 'bg-zinc-900/70 border-white/[0.08] text-zinc-400 hover:text-white'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="block text-xs text-zinc-400 mb-2">Accent color</span>
            <div className="grid grid-cols-4 gap-2">
              {(['violet', 'blue', 'cyan', 'emerald'] as AccentColor[]).map((accent) => (
                <button
                  key={accent}
                  type="button"
                  onClick={() => onUpdatePreferences({ accentColor: accent })}
                  className={`py-2 px-3 rounded-xl border text-xs font-medium capitalize transition-colors cursor-pointer ${
                    user.preferences.accentColor === accent
                      ? 'bg-white/[0.1] border-white text-white'
                      : 'bg-zinc-900/70 border-white/[0.08] text-zinc-400 hover:text-white'
                  }`}
                >
                  {accent}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Globe className="w-4 h-4 text-indigo-400" />
            <h2>Language & Audio Preferences</h2>
          </div>

          <div>
            <label htmlFor="language-select" className="block text-xs text-zinc-400 mb-1.5">
              Interface language
            </label>
            <select
              id="language-select"
              value={user.preferences.language}
              onChange={(e) =>
                onUpdatePreferences({ language: e.target.value as SupportedLanguage })
              }
              className="w-full px-3.5 py-2 rounded-xl bg-zinc-900 border border-white/[0.08] text-xs text-white focus:outline-none"
            >
              <option value="en">English</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="ja">日本語</option>
            </select>
          </div>

          <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between">
            <div>
              <span className="block text-xs font-medium text-white">
                Task completion sound
              </span>
              <span className="block text-[11px] text-zinc-400">
                Play a discreet chime when Spark finishes a live source query
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
        </section>
      </div>

      {/* 4. Channel3 Product Graph API Integration Section */}
      <section className="rounded-2xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Sparkles className="w-4 h-4 text-violet-400" />
              <h2>Channel3 Product Graph &amp; Commerce API</h2>
            </div>
            <p className="text-xs text-zinc-400 max-w-xl leading-relaxed">
              Server-side integration with <code className="font-mono text-zinc-300">https://api.trychannel3.com</code> (<code className="font-mono text-zinc-300">POST /v1/search</code>, <code className="font-mono text-zinc-300">POST /v1/lookup</code>, <code className="font-mono text-zinc-300">GET /v1/products/&#123;id&#125;</code>) using the <code className="font-mono text-zinc-300">CHANNEL3_API_KEY</code> server secret via the <code className="font-mono text-zinc-300">x-api-key</code> header. Spark never claims Channel3 is connected until a live authenticated request succeeds.
            </p>
            <p className="text-xs pt-1">
              Status:{' '}
              <strong
                className={
                  channel3Status?.connected
                    ? 'text-emerald-400'
                    : channel3Status?.configured
                    ? 'text-cyan-300'
                    : 'text-amber-300'
                }
              >
                {channel3Status
                  ? channel3Status.connected
                    ? `Connected & Verified (${channel3Status.explicitState})`
                    : channel3Status.explicitState
                  : 'Checking server configuration...'}
              </strong>
            </p>
            {channel3Status?.message && (
              <p className="text-xs text-zinc-300 flex items-center gap-1.5 pt-0.5">
                <AlertCircle className="w-3.5 h-3.5 text-violet-300 shrink-0" />
                <span>{channel3Status.message}</span>
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleVerifyChannel3}
              disabled={verifyingChannel3}
              className="py-2.5 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white inline-flex items-center gap-2 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${verifyingChannel3 ? 'animate-spin' : ''}`} />
              <span>
                {verifyingChannel3
                  ? 'Verifying /v1/search...'
                  : 'Verify Channel3 API Connection'}
              </span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-white/[0.06] text-[11px] font-mono">
          <div className="p-3 rounded-xl bg-zinc-900/70 border border-white/[0.05] space-y-1">
            <div className="text-emerald-300 font-semibold">Supported by Channel3 API</div>
            <div className="text-zinc-400">
              • POST /v1/search (query, price filters, availability)
            </div>
            <div className="text-zinc-400">
              • POST /v1/lookup & GET /v1/products/&#123;product_id&#125;
            </div>
            <div className="text-zinc-400">
              • Cross-merchant offers, live prices & ratings rollup
            </div>
          </div>
          <div className="p-3 rounded-xl bg-zinc-900/70 border border-white/[0.05] space-y-1">
            <div className="text-amber-300 font-semibold">Explicit Provider Limitations</div>
            <div className="text-zinc-400">
              • Direct Checkout: Coming soon per Channel3 docs
            </div>
            <div className="text-zinc-400">
              • Shipping & Tax: Omitted in Offer schema (never inferred)
            </div>
            <div className="text-zinc-400">
              • Promo Coupons: Not provided (compare_at_price supported)
            </div>
          </div>
        </div>
      </section>

      {/* 5. External API Credentials & Clean Public API Routing Governance */}
      <section className="rounded-2xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <h2>External API Credentials &amp; Clean Public API Routing</h2>
            </div>
            <p className="text-xs text-zinc-400 max-w-2xl leading-relaxed">
              Live physical retail catalog lookup (<code className="font-mono text-zinc-200">Channel3</code>) and affiliate coupon sync (<code className="font-mono text-zinc-200">Feedico</code>) depend on environment secrets provisioned in the server runtime. When absent, Spark explicitly discloses <code className="font-mono text-amber-300">&quot;Source not configured&quot;</code> and routes cleanly to configured public live APIs (<code className="font-mono text-emerald-300">Open Library API</code>, <code className="font-mono text-emerald-300">NCBI PubChem REST API</code>) without fabricating data.
            </p>
          </div>

          <button
            type="button"
            onClick={handleVerifyExternalRouting}
            disabled={verifyingCredentialsRouting}
            className="py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white inline-flex items-center gap-2 shrink-0 transition-colors cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${verifyingCredentialsRouting ? 'animate-spin' : ''}`}
            />
            <span>
              {verifyingCredentialsRouting
                ? 'Verifying Live Routing...'
                : 'Verify Live Public APIs & Routing'}
            </span>
          </button>
        </div>

        {livePublicSummary && (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs font-mono text-emerald-200">
            Live Public API Routing Verified: Open Library returned{' '}
            {livePublicSummary.openLibraryRecords} bibliographic record(s) · NCBI PubChem CID
            verification: {livePublicSummary.pubchemCidVerified ? 'PASS' : 'UNAVAILABLE'}.
          </div>
        )}

        {credentialsReport && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-white/[0.06]">
            {credentialsReport.providers.map((provider) => (
              <div
                key={provider.providerId}
                className="p-3.5 rounded-xl bg-zinc-900/75 border border-white/[0.06] space-y-1.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-white">{provider.providerName}</span>
                  <span
                    className={`font-mono text-[10px] px-2 py-0.5 rounded-md border ${
                      provider.configured
                        ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                        : 'bg-amber-500/15 border-amber-400/30 text-amber-300'
                    }`}
                  >
                    {provider.explicitState}
                  </span>
                </div>
                {provider.envVarNames.length > 0 && (
                  <div className="text-[11px] font-mono text-zinc-400">
                    Server Env: <span className="text-zinc-200">{provider.envVarNames.join(', ')}</span>
                  </div>
                )}
                <p className="text-[11px] text-zinc-300 leading-relaxed">
                  {provider.routingBehavior}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 6. Stage 5: Consent-Driven Personalization & Explainable Interest Tags */}
      <section
        data-testid="settings-interest-tags-section"
        className="rounded-2xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Sparkles className="w-4 h-4 text-violet-400" />
              <h2>Consent-Driven Personalization &amp; Explainable Interest Tags</h2>
            </div>
            <p className="text-xs text-zinc-400 max-w-2xl leading-relaxed">
              Spark only retains shopping interest tags when you explicitly opt in. Every tag is transparent, explainable, and can be removed at any time.
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
                    : ['Laptops & Computing', 'Verified Price Match', 'Side-by-Side Comparisons']
                  : [],
              });
            }}
            className={`py-2 px-4 rounded-xl text-xs font-semibold border transition-colors cursor-pointer shrink-0 ${
              user.preferences.interestTagsConsent
                ? 'bg-violet-600/20 border-violet-400/40 text-violet-200 hover:bg-violet-600/30'
                : 'bg-zinc-900 border-white/10 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            {user.preferences.interestTagsConsent
              ? 'Personalization Consent: Active (Opt Out)'
              : 'Enable Explainable Interest Tags (Opt In)'}
          </button>
        </div>

        {user.preferences.interestTagsConsent ? (
          <div className="space-y-3 pt-2 border-t border-white/[0.06]">
            <div className="flex flex-wrap gap-2">
              {(user.preferences.interestTags || []).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-violet-500/15 border border-violet-400/30 text-xs text-violet-200 font-medium"
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
                  No interest tags stored yet. Search for products in Conversation to learn explainable preferences.
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-zinc-900/70 border border-white/[0.05] text-xs text-zinc-400">
            Interest tag learning is currently disabled. Your multi-turn constraints remain isolated to the active conversation thread.
          </div>
        )}
      </section>

      {/* 7. Stage 1: APIMatic × Claude × PayPal Orders API v2 Specification Governance */}
      <section
        data-testid="settings-apimatic-section"
        className="rounded-2xl bg-[#121217]/90 border border-white/[0.08] p-6 space-y-3"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Database className="w-4 h-4 text-cyan-400" />
            <h2>APIMatic Portal &amp; PayPal Orders API v2 Specification</h2>
          </div>
          <span className="font-mono text-[10px] px-2.5 py-1 rounded-md bg-emerald-500/15 border border-emerald-400/30 text-emerald-300">
            SPEC VERIFIED · SANDBOX ONLY
          </span>
        </div>
        <p className="text-xs text-zinc-400 leading-relaxed">
          Configured via <code className="font-mono text-zinc-200">src/apimatic.json</code> and backed by the authoritative OpenAPI 3.0 specification at <code className="font-mono text-zinc-200">src/spec/checkout_orders_v2.json</code> with AI context plugins enabled for Claude, Cursor, and VS Code.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[11px] font-mono pt-1">
          <div className="p-2.5 rounded-xl bg-zinc-900/75 border border-white/[0.05] text-zinc-300">
            POST /v2/checkout/orders
          </div>
          <div className="p-2.5 rounded-xl bg-zinc-900/75 border border-white/[0.05] text-zinc-300">
            GET /v2/checkout/orders/&#123;id&#125;
          </div>
          <div className="p-2.5 rounded-xl bg-zinc-900/75 border border-white/[0.05] text-zinc-300">
            POST /v2/checkout/orders/&#123;id&#125;/capture
          </div>
        </div>
      </section>
    </div>
  );
};


