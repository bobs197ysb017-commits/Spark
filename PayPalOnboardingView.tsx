import React from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  ExternalLink,
  Lock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { UserProfile } from '../types/spark';

interface PayPalOnboardingViewProps {
  user: UserProfile;
  step: 'connect-paypal' | 'paypal-success';
  paypalAuthUrl: string | null;
  onConnectPayPal: () => Promise<void>;
  onCancelConnecting: () => void;
  onSubmitCallbackUrl?: (callbackUrlInput: string) => Promise<void>;
  onConnectLater: () => void;
  onContinueToSpark: () => void;
}

export const PayPalOnboardingView: React.FC<PayPalOnboardingViewProps> = ({
  user,
  step,
  paypalAuthUrl,
  onConnectPayPal,
  onCancelConnecting,
  onSubmitCallbackUrl,
  onConnectLater,
  onContinueToSpark,
}) => {
  const [callbackUrlInput, setCallbackUrlInput] = React.useState('');
  const [submittingCallback, setSubmittingCallback] = React.useState(false);
  const isConnecting = user.paypal.status === 'connecting';
  const hasError = user.paypal.status === 'error';
  const connectedEmail =
    user.paypal.sandboxEmail ||
    user.paypal.maskedEmail ||
    user.email;
  const connectedName =
    user.paypal.paypalName ||
    user.preferences.displayName ||
    user.preferences.preferredName ||
    'Verified PayPal Account Holder';
  const connectedDateFormatted = user.paypal.connectedAt
    ? new Date(user.paypal.connectedAt).toLocaleString()
    : new Date().toLocaleString();

  return (
    <div className="relative min-h-screen w-full flex flex-col justify-between bg-[#09090B] text-[#FAFAFA] px-6 py-8 overflow-y-auto">
      {/* Ambient background glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed top-[-18%] left-[12%] w-[540px] h-[540px] rounded-full opacity-20 blur-[120px]"
        style={{
          background:
            'radial-gradient(circle, #0070BA 0%, #003087 55%, transparent 75%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed bottom-[-18%] right-[12%] w-[500px] h-[500px] rounded-full opacity-15 blur-[120px]"
        style={{
          background:
            'radial-gradient(circle, #8b5cf6 0%, #06b6d4 55%, transparent 75%)',
        }}
      />

      {/* Header */}
      <header className="relative z-10 max-w-5xl w-full mx-auto flex items-center justify-between gap-6">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-sm">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-white">Spark</span>
          <span className="text-xs font-mono text-zinc-500">
            {step === 'connect-paypal'
              ? '/onboarding/connect-paypal'
              : '/onboarding/paypal-success'}
          </span>
        </div>

        <div className="inline-flex items-center gap-2 text-xs text-zinc-400">
          <ShieldCheck className="w-4 h-4 text-cyan-400" />
          <span>Official PayPal Identity API (OAuth 2.0 + OpenID Connect)</span>
        </div>
      </header>

      {/* Main Card */}
      <main className="relative z-10 w-full max-w-xl mx-auto my-auto py-8">
        {step === 'connect-paypal' ? (
          <div className="rounded-3xl bg-[#121217]/95 backdrop-blur-2xl border border-white/[0.1] p-8 sm:p-10 shadow-[0_28px_80px_rgba(0,0,0,0.65)] space-y-6">
            {/* Official-style PayPal Identity Emblem */}
            <div className="flex items-center justify-between">
              <div className="inline-flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#003087] to-[#0070BA] border border-[#38bdf8]/30 flex items-center justify-center shadow-lg">
                  <span className="text-lg font-extrabold italic tracking-tight text-white">
                    PayPal
                  </span>
                </div>
                <div>
                  <span className="text-[11px] font-mono uppercase tracking-wider text-cyan-400 block">
                    Post-Signup Account Onboarding
                  </span>
                  <span className="text-xs text-zinc-400">
                    Spark Account:{' '}
                    <strong className="text-zinc-200 font-mono">{user.email}</strong>
                  </span>
                </div>
              </div>

              <span className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-white/[0.08] text-[11px] font-mono text-zinc-300 whitespace-nowrap shrink-0">
                Status:{' '}
                {isConnecting ? (
                  <span className="text-cyan-300">Authorizing…</span>
                ) : (
                  <span className="text-amber-300">Not Connected</span>
                )}
              </span>
            </div>

            <div className="space-y-2.5">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">
                Connect your PayPal account
              </h1>
              <p className="text-sm text-zinc-300 leading-relaxed">
                Connect your PayPal account to Spark securely. Use your existing PayPal account to enable supported payment features and streamline future purchases.
              </p>
            </div>

            {/* Error or Missing Live Credential Notice */}
            {hasError && (
              <div
                role="alert"
                className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold text-rose-200">
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>PayPal Authorization Not Completed</span>
                  </div>
                  <button
                    type="button"
                    onClick={onConnectPayPal}
                    className="px-3 py-1 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/30 text-rose-100 font-semibold text-[11px] shrink-0 cursor-pointer"
                  >
                    Try Again
                  </button>
                </div>
                <p className="text-rose-200/90 leading-relaxed">
                  {user.paypal.errorMessage ||
                    'PayPal did not confirm authorization. Your Spark account remains Not Connected.'}
                </p>
                {user.paypal.errorCode && (
                  <div className="text-[11px] font-mono text-zinc-400 pt-0.5">
                    Code: <span className="text-zinc-200">{user.paypal.errorCode}</span>
                  </div>
                )}
              </div>
            )}

            {/* Connecting State */}
            {isConnecting && (
              <div
                role="status"
                className="p-4 rounded-2xl bg-[#0070BA]/15 border border-[#0070BA]/40 space-y-3 text-xs"
              >
                <div className="flex items-start gap-3">
                  <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="font-semibold text-white">
                      Waiting for official PayPal authorization &amp; consent…
                    </div>
                    <p className="text-zinc-300 leading-relaxed">
                      Sign in with your personal PayPal credentials and complete 2FA / security verification on PayPal. Spark will never mark your account as connected until PayPal returns a verified authorization code.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/[0.08]">
                  {paypalAuthUrl ? (
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
                      <span>Open Official PayPal Login Window</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <span className="text-zinc-400">Preparing secure OAuth state &amp; nonce…</span>
                  )}

                  <button
                    type="button"
                    onClick={onCancelConnecting}
                    className="py-1.5 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/[0.1] text-zinc-300 hover:text-white cursor-pointer"
                  >
                    Cancel request
                  </button>
                </div>

                {onSubmitCallbackUrl && (
                  <div className="pt-2.5 border-t border-white/[0.08] space-y-2">
                    <label
                      htmlFor="paypal-manual-callback-url"
                      className="block text-[11px] text-zinc-300 leading-relaxed"
                    >
                      If PayPal redirected your popup to <code className="font-mono text-cyan-300">ais-pre-.../api/paypal/callback?code=...</code> (which shows 404 until the app is shared), paste that redirected URL from the popup address bar here to complete verification immediately:
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="paypal-manual-callback-url"
                        type="text"
                        value={callbackUrlInput}
                        onChange={(e) => setCallbackUrlInput(e.target.value)}
                        placeholder="https://ais-pre-.../api/paypal/callback?code=...&state=..."
                        className="flex-1 min-w-0 px-3 py-1.5 rounded-xl bg-zinc-950 border border-white/[0.12] font-mono text-[11px] text-white focus:outline-none focus:border-cyan-400"
                      />
                      <button
                        type="button"
                        disabled={!callbackUrlInput.trim() || submittingCallback}
                        onClick={async () => {
                          setSubmittingCallback(true);
                          try {
                            await onSubmitCallbackUrl(callbackUrlInput);
                            setCallbackUrlInput('');
                          } finally {
                            setSubmittingCallback(false);
                          }
                        }}
                        className="px-3.5 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-zinc-950 font-semibold text-[11px] shrink-0 cursor-pointer"
                      >
                        {submittingCallback ? 'Verifying…' : 'Complete Verification'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Official OIDC Scopes & Security Architecture Notice */}
            <div className="p-4 rounded-2xl bg-zinc-950/80 border border-white/[0.07] space-y-2.5 text-xs text-zinc-400">
              <div className="flex items-center gap-2 font-medium text-zinc-200">
                <Lock className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>Log in with PayPal · Zero Password Exposure</span>
              </div>
              <p className="leading-relaxed">
                PayPal handles your login credentials, 2FA, and consent screen directly. Spark never collects or stores your PayPal password, card numbers, or bank credentials.
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[
                  'openid',
                  'profile',
                  'email',
                  'address',
                  'paypalattributes',
                ].map((scope) => (
                  <span
                    key={scope}
                    className="px-2 py-0.5 rounded-md bg-zinc-900 border border-white/[0.06] font-mono text-[10px] text-zinc-300"
                  >
                    {scope}
                  </span>
                ))}
              </div>
              <div className="pt-2.5 border-t border-white/[0.06] space-y-2 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-200 font-medium">
                    PayPal Developer Dashboard Return URLs (Add both under Log in with PayPal → Return URL):
                  </span>
                  <a
                    href="https://developer.paypal.com/dashboard/applications/sandbox"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200 underline shrink-0"
                  >
                    <span>Open PayPal Dashboard</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                {[
                  {
                    label: 'Dev Preview Callback',
                    url: 'https://ais-dev-3g5zvurtf6ldxz5u3eoxma-50712932913.europe-west1.run.app/api/paypal/callback',
                  },
                  {
                    label: 'Shared Preview Callback',
                    url: 'https://ais-pre-3g5zvurtf6ldxz5u3eoxma-50712932913.europe-west1.run.app/api/paypal/callback',
                  },
                ].map((item) => (
                  <div
                    key={item.url}
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-900/90 border border-white/[0.07]"
                  >
                    <div className="min-w-0">
                      <span className="text-[10px] text-zinc-400 block">{item.label}</span>
                      <code className="font-mono text-[10px] text-cyan-300 break-all">
                        {item.url}
                      </code>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(item.url);
                      }}
                      className="px-2 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 border border-white/[0.1] text-[10px] font-medium text-zinc-200 shrink-0 cursor-pointer"
                    >
                      Copy
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Primary & Secondary Actions */}
            <div className="space-y-3 pt-1">
              <button
                type="button"
                onClick={onConnectPayPal}
                disabled={isConnecting}
                className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-[#003087] via-[#0070BA] to-[#009CDE] hover:from-[#00256B] hover:via-[#005ea6] hover:to-[#0086be] disabled:opacity-60 text-sm font-semibold text-white shadow-lg flex items-center justify-center gap-2.5 transition-all cursor-pointer"
              >
                <span className="font-extrabold italic tracking-tight text-base">PayPal</span>
                <span>Connect PayPal</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={onConnectLater}
                className="w-full py-2.5 px-4 rounded-2xl bg-zinc-900/90 hover:bg-zinc-800 border border-white/[0.08] text-xs font-medium text-zinc-300 hover:text-white transition-colors cursor-pointer"
              >
                Connect later
              </button>
            </div>
          </div>
        ) : (
          /* STEP 2: /onboarding/paypal-success */
          <div className="rounded-3xl bg-[#121217]/95 backdrop-blur-2xl border border-emerald-500/30 p-8 sm:p-10 shadow-[0_28px_80px_rgba(0,0,0,0.65)] space-y-6">
            <div className="flex items-center justify-between">
              {/* Official PayPal Logo Emblem */}
              <div className="inline-flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#003087] to-[#0070BA] border border-[#38bdf8]/40 flex items-center justify-center shadow-lg">
                  <span className="text-lg font-extrabold italic tracking-tight text-white">
                    PayPal
                  </span>
                </div>
                <div>
                  <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-400 block">
                    Identity Verified via PayPal OIDC
                  </span>
                  <span className="text-xs text-zinc-400">
                    Environment:{' '}
                    <strong className="text-zinc-200 font-mono uppercase">
                      {user.paypal.environment || 'Verified'}
                    </strong>
                  </span>
                </div>
              </div>

              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/35 text-xs font-semibold text-emerald-300">
                <Check className="w-3.5 h-3.5" />
                <span>Connected</span>
              </span>
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">
                PayPal Successfully Connected
              </h1>
              <p className="text-sm text-zinc-300 leading-relaxed">
                Your personal PayPal identity has been verified and linked to your Spark account. You can manage your connection or PayPal Vault preferences anytime in Settings.
              </p>
            </div>

            {/* Verified Connection Summary Table */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3.5 rounded-2xl bg-zinc-950/80 border border-white/[0.07]">
                <div className="text-[11px] text-zinc-400 mb-1">Account holder&apos;s name</div>
                <div className="font-semibold text-white truncate">{connectedName}</div>
              </div>

              <div className="p-3.5 rounded-2xl bg-zinc-950/80 border border-white/[0.07]">
                <div className="text-[11px] text-zinc-400 mb-1">Connected PayPal email</div>
                <div className="font-mono text-zinc-100 truncate">{connectedEmail}</div>
              </div>

              <div className="p-3.5 rounded-2xl bg-zinc-950/80 border border-white/[0.07]">
                <div className="text-[11px] text-zinc-400 mb-1">Connection status</div>
                <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" />
                  <span>Connected</span>
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-zinc-950/80 border border-white/[0.07]">
                <div className="text-[11px] text-zinc-400 mb-1">Connection date</div>
                <div className="font-mono text-zinc-200">{connectedDateFormatted}</div>
              </div>
            </div>

            <button
              type="button"
              onClick={onContinueToSpark}
              className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 text-sm font-semibold text-white shadow-lg flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <span>Continue to Spark</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="relative z-10 max-w-5xl w-full mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-zinc-500">
        <span>Spark AI Shopping Companion · PayPal Identity &amp; Checkout Architecture</span>
        <span>AES-256-GCM Encrypted Server Storage · Zero Client Token Exposure</span>
      </footer>
    </div>
  );
};
