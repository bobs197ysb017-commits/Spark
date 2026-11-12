export interface ClientAuthSessionMeta {
  sessionId: string;
  csrfToken: string;
  refreshToken?: string;
  userId?: string;
  email?: string;
  expiresAt: string;
}

const SESSION_STORAGE_KEY = 'spark_auth_session_v1';
let activeAuthSession: ClientAuthSessionMeta | null = null;

function loadStoredSession(): ClientAuthSessionMeta | null {
  if (activeAuthSession) return activeAuthSession;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClientAuthSessionMeta;
    if (parsed && parsed.sessionId && parsed.csrfToken) {
      activeAuthSession = parsed;
      return parsed;
    }
  } catch {
    // Ignore storage read errors
  }
  return null;
}

export function setClientAuthSession(meta: ClientAuthSessionMeta | null): void {
  activeAuthSession = meta;
  if (typeof window === 'undefined') return;
  try {
    if (meta) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(meta));
    } else {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage write errors
  }
}

export function getClientAuthSession(): ClientAuthSessionMeta | null {
  return loadStoredSession();
}

/**
 * Builds authenticated headers for backend API calls using the server-issued session token
 * and CSRF token. Never sends an unverified frontend user ID as proof of identity.
 */
export function buildAuthenticatedHeaders(
  optionsOrHeaders?: Record<string, string | Record<string, string> | undefined>
): Record<string, string> {
  const session = loadStoredSession();
  const safeExtra: Record<string, string> = {};
  if (optionsOrHeaders) {
    for (const [key, val] of Object.entries(optionsOrHeaders)) {
      if (key.toLowerCase() === 'method') continue;
      if (key === 'extraHeaders' && val && typeof val === 'object') {
        for (const [subKey, subVal] of Object.entries(val)) {
          if (typeof subVal === 'string') {
            safeExtra[subKey] = subVal;
          }
        }
      } else if (typeof val === 'string') {
        safeExtra[key] = val;
      }
    }
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...safeExtra,
  };
  if (session?.sessionId) {
    headers['Authorization'] = `Bearer ${session.sessionId}`;
  }
  if (session?.csrfToken) {
    headers['x-csrf-token'] = session.csrfToken;
  }
  return headers;
}

const SPARK_CLOUD_RUN_BACKEND_ORIGIN =
  'https://ais-pre-3g5zvurtf6ldxz5u3eoxma-50712932913.europe-west1.run.app';

let fetchBridgeInstalled = false;

/**
 * When deployed on static preview hosts (such as spark-ten-theta.vercel.app),
 * relative `/api/...` calls may return 404 or SPA HTML if edge rewrites are not yet active.
 * This bridge transparently retries relative `/api/...` calls against the authorized
 * Cloud Run backend so API, Auth, Cart, Channel3, and PayPal Sandbox calls succeed.
 */
export function installVercelApiFetchBridge(): void {
  if (fetchBridgeInstalled || typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return;
  }
  const host = (window.location.hostname || '').toLowerCase();
  if (!host.endsWith('.vercel.app')) {
    return;
  }
  fetchBridgeInstalled = true;
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;

    const isRelativeApiCall = rawUrl.startsWith('/api/');
    if (!isRelativeApiCall) {
      return nativeFetch(input, init);
    }

    try {
      const primaryResp = await nativeFetch(input, init);
      const contentType = primaryResp.headers.get('content-type') || '';
      const isHtmlFallback =
        contentType.includes('text/html') && !rawUrl.startsWith('/api/paypal/callback');
      if (primaryResp.status !== 404 && primaryResp.status !== 405 && !isHtmlFallback) {
        return primaryResp;
      }
    } catch {
      // Fall through to Cloud Run backend origin
    }

    const fallbackUrl = `${SPARK_CLOUD_RUN_BACKEND_ORIGIN}${rawUrl}`;
    return nativeFetch(fallbackUrl, {
      ...init,
      credentials: 'include',
    });
  };
}
