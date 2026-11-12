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



