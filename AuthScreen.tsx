import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  Info,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react';
import { validateAuthInput } from '../utils/shoppingLogic';
import {
  classifyFirebaseAuthError,
  exchangeFirebaseUserForSparkSession,
  signInWithGooglePopup,
  signInWithGoogleRedirect,
  type FirebaseAuthErrorDiagnostic,
} from '../firebase';
import { setClientAuthSession } from '../utils/authClient';
import type {
  ConversationThread,
  PurchaseRecord,
  RankedProductOffer,
  UserProfile,
} from '../types/spark';

interface AuthScreenProps {
  initialGoogleDiagnostic?: FirebaseAuthErrorDiagnostic | null;
  onAuthenticated: (
    user: UserProfile,
    isNewAccount: boolean,
    initialData?: {
      purchases?: PurchaseRecord[];
      conversations?: ConversationThread[];
      savedProducts?: RankedProductOffer[];
    }
  ) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  initialGoogleDiagnostic,
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [errors, setErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
    form?: string;
  }>({});
  const [googleDiagnostic, setGoogleDiagnostic] =
    useState<FirebaseAuthErrorDiagnostic | null>(initialGoogleDiagnostic || null);
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [redirectLoading, setRedirectLoading] = useState(false);

  useEffect(() => {
    if (initialGoogleDiagnostic) {
      setGoogleDiagnostic(initialGoogleDiagnostic);
    }
  }, [initialGoogleDiagnostic]);

  const handleGoogleSignIn = async () => {
    if (googleLoading || redirectLoading || submitting) return;
    setErrors({});
    setGoogleDiagnostic(null);
    setGoogleLoading(true);
    try {
      const fbUser = await signInWithGooglePopup();
      const exchanged = await exchangeFirebaseUserForSparkSession(fbUser, {
        preferredName: preferredName.trim() || undefined,
      });
      onAuthenticated(exchanged.user, exchanged.isNewAccount, {
        purchases: exchanged.purchases,
        conversations: exchanged.conversations,
        savedProducts: exchanged.savedProducts,
      });
    } catch (err) {
      const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
      const diag = classifyFirebaseAuthError(err, host);
      setGoogleDiagnostic(diag);
      if (diag.shouldFallbackToRedirect) {
        // Automatically offer redirect fallback and keep UI clear
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleGoogleRedirectFallback = async () => {
    if (googleLoading || redirectLoading || submitting) return;
    setErrors({});
    setGoogleDiagnostic(null);
    setRedirectLoading(true);
    try {
      await signInWithGoogleRedirect();
    } catch (err) {
      const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
      setGoogleDiagnostic(classifyFirebaseAuthError(err, host));
      setRedirectLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = validateAuthInput(mode, email, password, name);
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }

    setErrors({});
    setGoogleDiagnostic(null);
    setSubmitting(true);

    try {
      const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/signin';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          preferredName:
            preferredName.trim() || name.trim().split(' ')[0] || email.split('@')[0],
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setErrors({
          form: data.error || 'Authentication failed. Please check your credentials.',
        });
        setSubmitting(false);
        return;
      }
      if (data.session) {
        setClientAuthSession(data.session);
      }
      onAuthenticated(data.user, mode === 'signup', {
        purchases: Array.isArray(data.purchases) ? data.purchases : [],
        conversations: Array.isArray(data.conversations) ? data.conversations : [],
      });
    } catch {
      setErrors({ form: 'Unable to reach authentication service. Please try again.' });
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex flex-col justify-between bg-[#09090B] text-[#FAFAFA] px-6 py-8 overflow-hidden">
      {/* Subtle ambient background gradients */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed top-[-18%] left-[15%] w-[540px] h-[540px] rounded-full opacity-20 blur-[110px]"
        style={{ background: 'radial-gradient(circle, #8b5cf6 0%, #3b82f6 55%, transparent 75%)' }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed bottom-[-20%] right-[12%] w-[480px] h-[480px] rounded-full opacity-15 blur-[110px]"
        style={{ background: 'radial-gradient(circle, #06b6d4 0%, #6366f1 55%, transparent 75%)' }}
      />

      {/* Top Bar */}
      <header className="relative z-10 max-w-6xl w-full mx-auto flex items-center justify-between gap-8">
        <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-sm">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-white">Spark</span>
        </div>
        <div className="text-xs text-zinc-400 whitespace-nowrap shrink-0">
          Intelligent Shopping Companion · Strict Real-Data Protocol
        </div>
      </header>

      {/* Center Auth Container */}
      <main className="relative z-10 w-full max-w-md mx-auto my-auto py-8">
        <div className="rounded-3xl bg-[#121217]/90 backdrop-blur-xl border border-white/[0.08] p-8 shadow-[0_24px_64px_rgba(0,0,0,0.55)]">
          <div className="text-center mb-6">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white mb-2">
              {mode === 'signin' ? 'Welcome to Spark' : 'Create your Spark account'}
            </h1>
            <p className="text-sm text-zinc-400 leading-relaxed">
              {mode === 'signin'
                ? 'Tell Spark what you want. Query live authorized sources, inspect verified facts, and require explicit approval before any purchase.'
                : 'Start with a clean, zero-seed personal shopping workspace backed by Firebase Authentication & Cloud Firestore.'}
            </p>
          </div>

          {/* Primary Firebase Google Authentication Button */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleLoading || redirectLoading || submitting}
            className="w-full py-2.5 px-4 rounded-xl bg-white hover:bg-zinc-100 text-zinc-900 text-xs font-semibold flex items-center justify-center gap-2.5 shadow-sm transition-colors mb-2.5 cursor-pointer disabled:opacity-50"
          >
            <ShieldCheck className="w-4 h-4 text-violet-600" />
            <span>
              {googleLoading
                ? 'Connecting with Google...'
                : redirectLoading
                ? 'Redirecting to Google...'
                : 'Continue with Google (Firebase Auth)'}
            </span>
          </button>

          {/* Structured Google Auth Status / Error / Redirect Fallback Banner */}
          {googleDiagnostic && (
            <div
              role={googleDiagnostic.isSilentCancel ? 'status' : 'alert'}
              className={`mb-4 p-3.5 rounded-xl border text-xs space-y-2 ${
                googleDiagnostic.isSilentCancel
                  ? 'bg-zinc-900/90 border-white/[0.1] text-zinc-300'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
              }`}
            >
              <div className="flex items-start gap-2">
                {googleDiagnostic.isSilentCancel ? (
                  <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                )}
                <div className="space-y-1 flex-1">
                  <p className="font-medium leading-relaxed">{googleDiagnostic.userMessage}</p>
                  {googleDiagnostic.technicalHint && (
                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                      {googleDiagnostic.technicalHint}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {googleDiagnostic.retryable && (
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={googleLoading || redirectLoading}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-[11px] font-medium transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Retry Popup Sign-In</span>
                  </button>
                )}
                {(googleDiagnostic.shouldFallbackToRedirect ||
                  googleDiagnostic.category === 'cancelled') && (
                  <button
                    type="button"
                    onClick={handleGoogleRedirectFallback}
                    disabled={googleLoading || redirectLoading}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/30 text-violet-200 text-[11px] font-medium transition-colors cursor-pointer"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>Continue via Google Redirect</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {!googleDiagnostic && (
            <div className="flex items-center justify-center mb-4">
              <button
                type="button"
                onClick={handleGoogleRedirectFallback}
                disabled={googleLoading || redirectLoading || submitting}
                className="text-[11px] text-zinc-400 hover:text-zinc-200 underline underline-offset-2 transition-colors cursor-pointer disabled:opacity-50"
              >
                Popup blocked in your browser? Continue via Google Redirect
              </button>
            </div>
          )}

          <div className="relative flex items-center justify-center mb-5">
            <div className="border-t border-white/[0.08] w-full" />
            <span className="bg-[#121217] px-3 text-[11px] text-zinc-500 whitespace-nowrap">
              or use Spark credentials
            </span>
            <div className="border-t border-white/[0.08] w-full" />
          </div>

          {/* Segmented Mode Switch */}
          <div
            role="tablist"
            aria-label="Authentication mode"
            className="grid grid-cols-2 p-1 rounded-xl bg-zinc-900/90 border border-white/[0.06] mb-5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signin'}
              onClick={() => {
                setMode('signin');
                setErrors({});
              }}
              className={`py-2 px-4 text-xs font-medium rounded-lg transition-all duration-150 whitespace-nowrap cursor-pointer ${
                mode === 'signin'
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signup'}
              onClick={() => {
                setMode('signup');
                setErrors({});
              }}
              className={`py-2 px-4 text-xs font-medium rounded-lg transition-all duration-150 whitespace-nowrap cursor-pointer ${
                mode === 'signup'
                  ? 'bg-zinc-800 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Create account
            </button>
          </div>

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label htmlFor="auth-name" className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Display name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="auth-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Alex Rivera"
                    autoComplete="name"
                    className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl bg-zinc-900/90 border border-white/[0.08] text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-400/70 transition-colors"
                  />
                </div>
                {errors.name && (
                  <p role="alert" className="mt-1.5 text-xs text-rose-400">
                    {errors.name}
                  </p>
                )}
              </div>
            )}

            {mode === 'signup' && (
              <div>
                <label htmlFor="auth-preferred" className="block text-xs font-medium text-zinc-300 mb-1.5">
                  What would you like Spark to call you? <span className="text-zinc-500">(optional)</span>
                </label>
                <input
                  id="auth-preferred"
                  type="text"
                  value={preferredName}
                  onChange={(e) => setPreferredName(e.target.value)}
                  placeholder="Alex"
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl bg-zinc-900/90 border border-white/[0.08] text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-400/70 transition-colors"
                />
              </div>
            )}

            <div>
              <label htmlFor="auth-email" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Email address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl bg-zinc-900/90 border border-white/[0.08] text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-400/70 transition-colors"
                />
              </div>
              {errors.email && (
                <p role="alert" className="mt-1.5 text-xs text-rose-400">
                  {errors.email}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="auth-password" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="auth-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl bg-zinc-900/90 border border-white/[0.08] text-white placeholder:text-zinc-500 focus:outline-none focus:border-violet-400/70 transition-colors"
                />
              </div>
              {errors.password && (
                <p role="alert" className="mt-1.5 text-xs text-rose-400">
                  {errors.password}
                </p>
              )}
            </div>

            {errors.form && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-300"
              >
                {errors.form}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || googleLoading}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-600 hover:from-violet-500 hover:via-indigo-500 hover:to-cyan-500 text-white text-sm font-medium shadow-md transition-all duration-150 flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              <span>
                {submitting
                  ? 'Entering Spark...'
                  : mode === 'signin'
                  ? 'Sign in to Spark'
                  : 'Create account & continue'}
              </span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>
      </main>

      {/* Quiet Footer */}
      <footer className="relative z-10 max-w-6xl w-full mx-auto flex items-center justify-between text-xs text-zinc-500">
        <span>Spark AI Shopping Companion</span>
        <span>Zero Mock Data · Verified Source Provenance · Explicit Purchase Confirmation</span>
      </footer>
    </div>
  );
};
