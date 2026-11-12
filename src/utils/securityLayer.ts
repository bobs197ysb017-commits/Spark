import crypto from 'node:crypto';
import net from 'node:net';
import type { CouponItem, ProductOffer, UserPreferences } from '../types/spark';

// ============================================================================
// PHASE 2 — IDENTITY & ACCESS SECURITY (Password Hashing, Brute-Force Lockout,
// Refresh Token Rotation & Reuse Detection, Password Recovery, PKCE, RBAC)
// ============================================================================

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;

/**
 * Hashes a plaintext password using Node's built-in `crypto.scryptSync`
 * (memory-hard KDF equivalent in strength to Argon2id/bcrypt) with a unique 16-byte random salt.
 */
export function hashPasswordScrypt(password: string): string {
  if (!password || typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters long.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  });
  return `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELIZATION}$${salt}$${derived.toString('hex')}`;
}

/**
 * Verifies a plaintext password against a stored `scrypt` hash using constant-time comparison.
 */
export function verifyPasswordScrypt(password: string, storedHash: string): boolean {
  if (!password || !storedHash || typeof password !== 'string' || typeof storedHash !== 'string') {
    return false;
  }
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const cost = Number.parseInt(parts[1], 10);
  const blockSize = Number.parseInt(parts[2], 10);
  const parallelization = Number.parseInt(parts[3], 10);
  const salt = parts[4];
  const expectedHex = parts[5];
  if (!salt || !expectedHex || !Number.isFinite(cost) || !Number.isFinite(blockSize)) {
    return false;
  }
  try {
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const derived = crypto.scryptSync(password, salt, expectedBuf.length, {
      N: cost,
      r: blockSize,
      p: parallelization,
    });
    if (derived.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(derived, expectedBuf);
  } catch {
    return false;
  }
}

export interface BruteForceState {
  attempts: number[];
  lockedUntilMs: number;
}

/**
 * Protects login and sensitive authentication endpoints against brute-force credential stuffing.
 * Enforces per-account and per-IP rate limiting + temporary lockout without leaking account existence.
 */
export class BruteForceProtector {
  private buckets = new Map<string, BruteForceState>();
  private maxAttempts: number;
  private windowMs: number;
  private lockoutDurationMs: number;
  private nowFn: () => number;

  constructor(
    optionsOrMax?:
      | {
          maxAttempts?: number;
          windowMs?: number;
          lockoutDurationMs?: number;
          nowFn?: () => number;
        }
      | number,
    windowMsArg?: number,
    lockoutDurationMsArg?: number
  ) {
    if (typeof optionsOrMax === 'number') {
      this.maxAttempts = optionsOrMax;
      this.windowMs = windowMsArg ?? 15 * 60 * 1000;
      this.lockoutDurationMs = lockoutDurationMsArg ?? 15 * 60 * 1000;
      this.nowFn = () => Date.now();
    } else {
      this.maxAttempts = optionsOrMax?.maxAttempts ?? 5;
      this.windowMs = optionsOrMax?.windowMs ?? 15 * 60 * 1000;
      this.lockoutDurationMs = optionsOrMax?.lockoutDurationMs ?? 15 * 60 * 1000;
      this.nowFn = optionsOrMax?.nowFn || (() => Date.now());
    }
  }

  private normalizeKey(ip: string, identifier?: string): string[] {
    const keys: string[] = [];
    if (ip && ip.trim()) {
      keys.push(`ip:${ip.trim().toLowerCase()}`);
    }
    if (identifier && identifier.trim()) {
      keys.push(`acct:${identifier.trim().toLowerCase()}`);
    }
    return keys.length > 0 ? keys : ['ip:unknown'];
  }

  public checkAllowed(ip: string, identifier?: string): {
    allowed: boolean;
    retryAfterSeconds: number;
    retryAfterMs: number;
    errorCode?: 'account_temporarily_locked';
    genericMessage?: string;
    message?: string;
  } {
    const now = this.nowFn();
    const keys = this.normalizeKey(ip, identifier);

    for (const key of keys) {
      const state = this.buckets.get(key);
      if (!state) continue;
      if (state.lockedUntilMs > now) {
        const retryAfterMs = Math.max(1000, state.lockedUntilMs - now);
        const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
        const msg =
          'Too many failed authentication attempts. For your security, sign-in is temporarily locked. Please try again later.';
        return {
          allowed: false,
          retryAfterSeconds,
          retryAfterMs,
          errorCode: 'account_temporarily_locked',
          genericMessage: msg,
          message: msg,
        };
      }
    }

    return { allowed: true, retryAfterSeconds: 0, retryAfterMs: 0 };
  }

  public recordFailure(ip: string, identifier?: string): {
    locked: boolean;
    remainingAttempts: number;
    retryAfterSeconds: number;
    retryAfterMs: number;
    errorCode: 'account_temporarily_locked' | 'invalid_credentials';
    message: string;
  } {
    const now = this.nowFn();
    const keys = this.normalizeKey(ip, identifier);
    let locked = false;
    let minRemaining = this.maxAttempts;
    let maxRetrySeconds = 0;
    let maxRetryMs = 0;

    for (const key of keys) {
      const existing = this.buckets.get(key) || { attempts: [], lockedUntilMs: 0 };
      const recent = existing.attempts.filter((ts) => now - ts < this.windowMs);
      recent.push(now);
      if (recent.length >= this.maxAttempts) {
        existing.lockedUntilMs = now + this.lockoutDurationMs;
        locked = true;
        minRemaining = 0;
        maxRetryMs = this.lockoutDurationMs;
        maxRetrySeconds = Math.ceil(this.lockoutDurationMs / 1000);
      } else {
        minRemaining = Math.min(minRemaining, this.maxAttempts - recent.length);
      }
      existing.attempts = recent;
      this.buckets.set(key, existing);
    }

    return {
      locked,
      remainingAttempts: minRemaining,
      retryAfterSeconds: maxRetrySeconds,
      retryAfterMs: maxRetryMs,
      errorCode: locked ? 'account_temporarily_locked' : 'invalid_credentials',
      message: locked
        ? 'Too many failed authentication attempts. Account is temporarily locked.'
        : 'Invalid email or password.',
    };
  }

  public recordSuccess(ip: string, identifier?: string): void {
    const keys = this.normalizeKey(ip, identifier);
    for (const key of keys) {
      this.buckets.delete(key);
    }
  }
}

export interface RefreshTokenRecord {
  tokenHash: string;
  familyId: string;
  sessionId: string;
  userId: string;
  email: string;
  issuedAtMs: number;
  expiresAtMs: number;
  rotated: boolean;
  revoked: boolean;
}

/**
 * Manages Refresh Token Rotation and Reuse Detection.
 * If an already-rotated refresh token is presented again, the entire token family
 * and associated sessions for that user are immediately revoked to stop token theft.
 */
export class RefreshTokenManager {
  private tokensByHash = new Map<string, RefreshTokenRecord>();
  private familyToHashes = new Map<string, Set<string>>();
  private nowFn: () => number;
  private ttlMs: number;

  constructor(options?: { nowFn?: () => number; ttlMs?: number }) {
    this.nowFn = options?.nowFn || (() => Date.now());
    this.ttlMs = options?.ttlMs ?? 7 * 24 * 60 * 60 * 1000; // 7 days
  }

  private hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  public issueRefreshToken(
    inputOrUserId:
      | {
          sessionId: string;
          userId: string;
          email?: string;
          familyId?: string;
        }
      | string,
    sessionIdArg?: string,
    familyIdArg?: string
  ): { refreshToken: string; familyId: string; expiresAt: string } {
    const input =
      typeof inputOrUserId === 'string'
        ? {
            userId: inputOrUserId,
            sessionId: sessionIdArg || `sess_${Date.now()}`,
            email: 'member@spark.app',
            familyId: familyIdArg,
          }
        : inputOrUserId;

    const now = this.nowFn();
    const rawToken = `rft_${crypto.randomBytes(32).toString('hex')}`;
    const tokenHash = this.hashToken(rawToken);
    const familyId = input.familyId || `fam_${crypto.randomBytes(12).toString('hex')}`;
    const expiresAtMs = now + this.ttlMs;

    const record: RefreshTokenRecord = {
      tokenHash,
      familyId,
      sessionId: input.sessionId,
      userId: input.userId,
      email: input.email || 'member@spark.app',
      issuedAtMs: now,
      expiresAtMs,
      rotated: false,
      revoked: false,
    };

    this.tokensByHash.set(tokenHash, record);
    const set = this.familyToHashes.get(familyId) || new Set<string>();
    set.add(tokenHash);
    this.familyToHashes.set(familyId, set);

    return {
      refreshToken: rawToken,
      familyId,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  public rotateRefreshToken(
    rawToken: string,
    newSessionId: string
  ): {
    ok: boolean;
    valid: boolean;
    reuseDetected: boolean;
    statusCode: number;
    errorCode?:
      | 'invalid_refresh_token'
      | 'refresh_token_expired'
      | 'refresh_token_reuse_detected'
      | 'refresh_token_revoked';
    message: string;
    userId?: string;
    email?: string;
    compromisedSessionIds?: string[];
    revokedSessionIds?: string[];
    newRefreshToken?: string;
    familyId?: string;
    expiresAt?: string;
  } {
    if (!rawToken || typeof rawToken !== 'string') {
      return {
        ok: false,
        valid: false,
        reuseDetected: false,
        statusCode: 401,
        errorCode: 'invalid_refresh_token',
        message: 'Refresh token is required.',
      };
    }

    const tokenHash = this.hashToken(rawToken.trim());
    const record = this.tokensByHash.get(tokenHash);
    if (!record) {
      return {
        ok: false,
        valid: false,
        reuseDetected: false,
        statusCode: 401,
        errorCode: 'invalid_refresh_token',
        message: 'Unrecognized refresh token.',
      };
    }

    if (record.rotated) {
      // REUSE DETECTED! Revoke entire family immediately.
      const compromisedSessionIds = this.revokeFamily(record.familyId);
      return {
        ok: false,
        valid: false,
        reuseDetected: true,
        statusCode: 401,
        errorCode: 'refresh_token_reuse_detected',
        message:
          'Security Alert: Refresh token reuse detected. All tokens in this session family have been revoked.',
        userId: record.userId,
        compromisedSessionIds,
        revokedSessionIds: compromisedSessionIds,
      };
    }

    if (record.revoked) {
      return {
        ok: false,
        valid: false,
        reuseDetected: false,
        statusCode: 401,
        errorCode: 'refresh_token_revoked',
        message: 'Refresh token has been revoked.',
      };
    }

    const now = this.nowFn();
    if (record.expiresAtMs <= now) {
      record.revoked = true;
      return {
        ok: false,
        valid: false,
        reuseDetected: false,
        statusCode: 401,
        errorCode: 'refresh_token_expired',
        message: 'Refresh token has expired. Please sign in again.',
      };
    }

    // Mark current token as rotated (single-use) and issue successor in same family
    record.rotated = true;
    const next = this.issueRefreshToken({
      sessionId: newSessionId,
      userId: record.userId,
      email: record.email,
      familyId: record.familyId,
    });

    return {
      ok: true,
      valid: true,
      reuseDetected: false,
      statusCode: 200,
      message: 'Refresh token rotated successfully.',
      userId: record.userId,
      email: record.email,
      newRefreshToken: next.refreshToken,
      familyId: next.familyId,
      expiresAt: next.expiresAt,
    };
  }

  public revokeFamily(familyId: string): string[] {
    const hashes = this.familyToHashes.get(familyId);
    const sessionIds: string[] = [];
    if (!hashes) return sessionIds;
    for (const h of hashes) {
      const rec = this.tokensByHash.get(h);
      if (rec) {
        rec.revoked = true;
        sessionIds.push(rec.sessionId);
      }
    }
    return sessionIds;
  }

  public revokeAllForUser(userId: string): number {
    let count = 0;
    for (const rec of this.tokensByHash.values()) {
      if (rec.userId === userId && !rec.revoked) {
        rec.revoked = true;
        count++;
      }
    }
    return count;
  }
}

export interface PasswordResetTokenRecord {
  tokenHash: string;
  userId: string;
  email: string;
  expiresAtMs: number;
  consumed: boolean;
}

/**
 * Single-use, short-TTL password recovery token manager.
 * Stores only SHA-256 hashes of reset tokens at rest.
 */
export class PasswordResetManager {
  private tokensByHash = new Map<string, PasswordResetTokenRecord>();
  private nowFn: () => number;
  private ttlMs: number;

  constructor(options?: { nowFn?: () => number; ttlMs?: number }) {
    this.nowFn = options?.nowFn || (() => Date.now());
    this.ttlMs = options?.ttlMs ?? 15 * 60 * 1000; // 15 minutes
  }

  public createResetToken(userId: string, email: string): {
    resetToken: string;
    expiresAt: string;
  } {
    for (const rec of this.tokensByHash.values()) {
      if (rec.userId === userId) {
        rec.consumed = true;
      }
    }
    const resetToken = `rst_${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expiresAtMs = this.nowFn() + this.ttlMs;
    this.tokensByHash.set(tokenHash, {
      tokenHash,
      userId,
      email: email.trim().toLowerCase(),
      expiresAtMs,
      consumed: false,
    });
    return {
      resetToken,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  public issueResetToken(userId: string, email: string): {
    resetToken: string;
    expiresAt: string;
  } {
    return this.createResetToken(userId, email);
  }

  public consumeResetToken(rawToken: string): {
    valid: boolean;
    errorCode?: 'invalid_reset_token' | 'reset_token_expired' | 'reset_token_already_used';
    message?: string;
    userId?: string;
    email?: string;
  } {
    if (!rawToken || typeof rawToken !== 'string') {
      return {
        valid: false,
        errorCode: 'invalid_reset_token',
        message: 'Password recovery token is required.',
      };
    }
    const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
    const record = this.tokensByHash.get(tokenHash);
    if (!record) {
      return {
        valid: false,
        errorCode: 'invalid_reset_token',
        message: 'Invalid password recovery token.',
      };
    }
    if (record.consumed) {
      return {
        valid: false,
        errorCode: 'reset_token_already_used',
        message: 'Password recovery token has already been used.',
      };
    }
    if (record.expiresAtMs <= this.nowFn()) {
      record.consumed = true;
      return {
        valid: false,
        errorCode: 'reset_token_expired',
        message: 'Password recovery token has expired.',
      };
    }
    record.consumed = true;
    return {
      valid: true,
      userId: record.userId,
      email: record.email,
      message: 'Password recovery token verified.',
    };
  }
}

/**
 * Generates an OAuth 2.0 PKCE S256 verifier and challenge pair.
 */
export function generatePkcePair(): {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
} {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256',
  };
}

/**
 * Verifies an OAuth 2.0 PKCE `code_verifier` against a stored `code_challenge`.
 */
export function verifyPkceCodeChallenge(
  codeVerifier: string,
  expectedCodeChallenge: string,
  method: 'S256' | 'plain' = 'S256'
): boolean {
  if (!codeVerifier || !expectedCodeChallenge) return false;
  if (method === 'plain') {
    const a = Buffer.from(codeVerifier);
    const b = Buffer.from(expectedCodeChallenge);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const computed = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(expectedCodeChallenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export type SparkRole = 'user' | 'developer' | 'admin';

const ADMIN_EMAIL_ALLOWLIST = new Set(['bobs197ysb017@gmail.com']);

/**
 * Resolves the RBAC role for an authenticated Spark user.
 * Default role is `'user'`. Admin role is restricted to verified owner emails or explicit server env allowlist.
 */
export function resolveUserRole(
  email?: string | null,
  explicitRoleOrEnv?: SparkRole | Record<string, string | undefined>
): SparkRole {
  if (explicitRoleOrEnv === 'admin' || explicitRoleOrEnv === 'developer') {
    return explicitRoleOrEnv;
  }
  const cleanEmail = (email || '').trim().toLowerCase();
  const envSource =
    explicitRoleOrEnv && typeof explicitRoleOrEnv === 'object'
      ? explicitRoleOrEnv
      : process.env;
  const envAdmins = (envSource.SPARK_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (ADMIN_EMAIL_ALLOWLIST.has(cleanEmail) || envAdmins.includes(cleanEmail)) {
    return 'admin';
  }
  return 'user';
}

export function requireRole(
  userEmail: string | null | undefined,
  requiredRole: SparkRole,
  explicitRoleOrEnv?: SparkRole | Record<string, string | undefined>
): {
  authorized: boolean;
  statusCode: number;
  role: SparkRole;
  errorCode?: 'insufficient_role_permissions';
  error?: string;
  message: string;
} {
  const actualRole = resolveUserRole(userEmail, explicitRoleOrEnv);
  const rank: Record<SparkRole, number> = {
    user: 1,
    developer: 2,
    admin: 3,
  };
  if (rank[actualRole] < rank[requiredRole]) {
    const msg = `Forbidden: "${requiredRole}" role is required to access this resource (current role: "${actualRole}").`;
    return {
      authorized: false,
      statusCode: 403,
      role: actualRole,
      errorCode: 'insufficient_role_permissions',
      error: msg,
      message: msg,
    };
  }
  return {
    authorized: true,
    statusCode: 200,
    role: actualRole,
    message: `Authorized as ${actualRole}.`,
  };
}

// ============================================================================
// PHASE 3 & 7 — INPUT VALIDATION, INJECTION DEFENSE & MASS ASSIGNMENT GUARD
// ============================================================================

const FORBIDDEN_PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const NOSQL_OPERATOR_PATTERN = /^\$(where|gt|gte|lt|lte|ne|nin|in|regex|expr|function|accumulator|or|and|nor|not)$/i;
const SQL_INJECTION_PATTERNS: RegExp[] = [
  /(?:^|[\s'")(;])union\s+(?:all\s+)?select\b/i,
  /(?:^|[\s'");])(?:drop|alter|truncate)\s+(?:table|database|schema|user)\b/i,
  /(?:^|[\s'")])or\s+['"]?1['"]?\s*=\s*['"]?1/i,
  /(?:^|[\s'")])and\s+['"]?1['"]?\s*=\s*['"]?1/i,
  /;\s*(?:exec|execute|xp_cmdshell|sp_executesql|pg_sleep|waitfor\s+delay)\b/i,
  /\/\*[\s\S]*?\*\/|(?:['";]|(?:\b(?:select|union|where|from|or|and)\b[^|\n]*))--\s+.*$/im,
];

/**
 * Recursively strips `__proto__`, `constructor`, `prototype`, and NoSQL `$` operator keys
 * from incoming JSON payloads to prevent Prototype Pollution and NoSQL injection.
 */
export function sanitizeInputObject<T>(value: T, depth = 0): T {
  if (depth > 8 || value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeInputObject(item, depth + 1)) as unknown as T;
  }
  if (typeof value === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_PROTOTYPE_KEYS.has(k)) continue;
      if (NOSQL_OPERATOR_PATTERN.test(k)) continue;
      if (k.includes('\0')) continue;
      clean[k] = sanitizeInputObject(v, depth + 1);
    }
    return clean as T;
  }
  if (typeof value === 'string') {
    return value.replace(/\0/g, '') as unknown as T;
  }
  return value;
}

/**
 * Inspects an arbitrary payload (query, body, params) for SQL or NoSQL injection attacks.
 */
export function detectInjectionPayload(input: unknown, depth = 0): {
  detected: boolean;
  type?: 'sql_injection' | 'nosql_injection' | 'prototype_pollution';
  kind?: 'sql_injection' | 'nosql_operator' | 'prototype_pollution';
  matchedPattern?: string;
  detail?: string;
} {
  if (depth > 6 || input === null || input === undefined) {
    return { detected: false };
  }
  if (typeof input === 'string') {
    for (const regex of SQL_INJECTION_PATTERNS) {
      if (regex.test(input)) {
        return {
          detected: true,
          type: 'sql_injection',
          kind: 'sql_injection',
          matchedPattern: regex.source,
          detail: regex.source,
        };
      }
    }
    return { detected: false };
  }
  if (Array.isArray(input)) {
    for (const item of input) {
      const check = detectInjectionPayload(item, depth + 1);
      if (check.detected) return check;
    }
    return { detected: false };
  }
  if (typeof input === 'object') {
    const rawObj = input as Record<string, unknown>;
    if (
      Object.prototype.hasOwnProperty.call(rawObj, '__proto__') ||
      Object.prototype.hasOwnProperty.call(rawObj, 'prototype') ||
      Object.prototype.hasOwnProperty.call(rawObj, 'constructor')
    ) {
      return {
        detected: true,
        type: 'prototype_pollution',
        kind: 'prototype_pollution',
        matchedPattern: '__proto__/constructor/prototype',
        detail: '__proto__/constructor/prototype',
      };
    }
    for (const [k, v] of Object.entries(rawObj)) {
      if (FORBIDDEN_PROTOTYPE_KEYS.has(k)) {
        return {
          detected: true,
          type: 'prototype_pollution',
          kind: 'prototype_pollution',
          matchedPattern: k,
          detail: k,
        };
      }
      if (NOSQL_OPERATOR_PATTERN.test(k)) {
        return {
          detected: true,
          type: 'nosql_injection',
          kind: 'nosql_operator',
          matchedPattern: k,
          detail: k,
        };
      }
      const nested = detectInjectionPayload(v, depth + 1);
      if (nested.detected) return nested;
    }
  }
  return { detected: false };
}

/**
 * Neutralizes XSS / HTML script injection vectors in user-supplied strings.
 */
export function sanitizeTextAgainstXss(raw: string, maxLength = 500): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\0/g, '')
    .replace(/<\s*\/?\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*\/?\s*script\b[^>]*>/gi, '')
    .replace(/<\s*\/?\s*(?:iframe|object|embed|svg|math|meta|link|style|base|img)\b[^>]*>/gi, '')
    .replace(/\bon[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, 'blocked:')
    .replace(/vbscript\s*:/gi, 'blocked:')
    .replace(/data\s*:\s*text\/html/gi, 'blocked:')
    .replace(/[<>]/g, (ch) => (ch === '<' ? '&lt;' : '&gt;'))
    .trim()
    .slice(0, maxLength);
}

/**
 * Validates and sanitizes a partial update to `UserPreferences` to prevent Mass Assignment
 * (e.g., blocking attempts to inject `role`, `isAdmin`, `id`, `paypal`, or XSS in `displayName`/`avatarUrl`).
 */
export function sanitizeUserPreferencesPatch(
  rawPreferences: unknown,
  current: UserPreferences
): UserPreferences {
  if (!rawPreferences || typeof rawPreferences !== 'object') {
    return current;
  }
  const src = rawPreferences as Record<string, unknown>;
  const allowedThemes = new Set(['dark', 'light', 'system']);
  const allowedAccents = new Set(['violet', 'blue', 'cyan', 'emerald']);
  const allowedLangs = new Set(['en', 'es', 'fr', 'de', 'ja']);
  const allowedCurrencies = new Set(['USD', 'EUR', 'GBP']);

  const displayName =
    typeof src.displayName === 'string' && src.displayName.trim()
      ? sanitizeTextAgainstXss(src.displayName, 80)
      : current.displayName;
  const preferredName =
    typeof src.preferredName === 'string' && src.preferredName.trim()
      ? sanitizeTextAgainstXss(src.preferredName, 40)
      : current.preferredName;

  let avatarUrl = current.avatarUrl;
  if (typeof src.avatarUrl === 'string' && src.avatarUrl.trim()) {
    const candidate = src.avatarUrl.trim();
    if (
      candidate.startsWith('linear-gradient(') ||
      (candidate.startsWith('https://') && !/javascript:|data:|<|>/i.test(candidate))
    ) {
      avatarUrl = candidate.slice(0, 300);
    }
  }

  const allowedAiTiers = new Set(['fast', 'balanced', 'deep']);
  const allowedCompDepths = new Set(['concise', 'standard', 'exhaustive']);

  return {
    displayName: displayName || current.displayName,
    preferredName: preferredName || current.preferredName,
    avatarUrl,
    theme:
      typeof src.theme === 'string' && allowedThemes.has(src.theme)
        ? (src.theme as UserPreferences['theme'])
        : current.theme,
    accentColor:
      typeof src.accentColor === 'string' && allowedAccents.has(src.accentColor)
        ? (src.accentColor as UserPreferences['accentColor'])
        : current.accentColor,
    language:
      typeof src.language === 'string' && allowedLangs.has(src.language)
        ? (src.language as UserPreferences['language'])
        : current.language,
    soundEnabled:
      typeof src.soundEnabled === 'boolean' ? src.soundEnabled : current.soundEnabled,
    autoApplyCoupons:
      typeof src.autoApplyCoupons === 'boolean'
        ? src.autoApplyCoupons
        : current.autoApplyCoupons,
    defaultCurrency:
      typeof src.defaultCurrency === 'string' && allowedCurrencies.has(src.defaultCurrency)
        ? (src.defaultCurrency as UserPreferences['defaultCurrency'])
        : current.defaultCurrency,
    interestTagsConsent:
      typeof src.interestTagsConsent === 'boolean'
        ? src.interestTagsConsent
        : (current.interestTagsConsent ?? true),
    interestTags: Array.isArray(src.interestTags)
      ? Array.from(
          new Set(
            src.interestTags
              .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
              .map((t) => sanitizeTextAgainstXss(t.trim(), 48))
              .filter(Boolean)
          )
        ).slice(0, 20)
      : current.interestTags || [],
    aiModelTier:
      typeof src.aiModelTier === 'string' && allowedAiTiers.has(src.aiModelTier)
        ? (src.aiModelTier as UserPreferences['aiModelTier'])
        : (current.aiModelTier ?? 'balanced'),
    aiComparisonDepth:
      typeof src.aiComparisonDepth === 'string' && allowedCompDepths.has(src.aiComparisonDepth)
        ? (src.aiComparisonDepth as UserPreferences['aiComparisonDepth'])
        : (current.aiComparisonDepth ?? 'standard'),
    aiAutoVerifyCitations:
      typeof src.aiAutoVerifyCitations === 'boolean'
        ? src.aiAutoVerifyCitations
        : (current.aiAutoVerifyCitations ?? true),
    searchHistoryLoggingConsent:
      typeof src.searchHistoryLoggingConsent === 'boolean'
        ? src.searchHistoryLoggingConsent
        : (current.searchHistoryLoggingConsent ?? true),
    notifyPriceDropAlerts:
      typeof src.notifyPriceDropAlerts === 'boolean'
        ? src.notifyPriceDropAlerts
        : (current.notifyPriceDropAlerts ?? true),
    notifyCouponExpiryAlerts:
      typeof src.notifyCouponExpiryAlerts === 'boolean'
        ? src.notifyCouponExpiryAlerts
        : (current.notifyCouponExpiryAlerts ?? true),
    notifyOrderStatusAlerts:
      typeof src.notifyOrderStatusAlerts === 'boolean'
        ? src.notifyOrderStatusAlerts
        : (current.notifyOrderStatusAlerts ?? true),
    regionCountry:
      typeof src.regionCountry === 'string' && src.regionCountry.trim()
        ? sanitizeTextAgainstXss(src.regionCountry.trim().toUpperCase(), 8)
        : (current.regionCountry ?? 'US'),
  };
}

// ============================================================================
// PHASE 5 — AI AGENT SECURITY LAYER (Prompt Injection Defense, Feed Sanitizer,
// Tool Permission Gate, Human Confirmation Binding, Cross-User Context Isolation)
// ============================================================================

const PROMPT_INJECTION_PATTERNS: Array<{ id: string; regex: RegExp; reason: string }> = [
  {
    id: 'system_prompt_override',
    regex: /\b(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+)?(?:previous|prior|above|system|developer|safety)\s+(?:instructions|prompts|rules|constraints|guardrails)\b/i,
    reason: 'Attempted to override system or developer instructions.',
  },
  {
    id: 'system_role_spoofing',
    regex: /(?:^|\n)\s*(?:\[\s*SYSTEM\s*\]|<\s*\|?\s*im_start\s*\|?\s*>\s*system|###\s*SYSTEM\s*INSTRUCTION|SYSTEM\s*OVERRIDE\s*:)/i,
    reason: 'Attempted to spoof a privileged system instruction block.',
  },
  {
    id: 'unauthorized_payment_execution',
    regex: /\b(?:execute|capture|approve|complete|force|auto-purchase)\s+(?:the\s+)?(?:payment|purchase|order|checkout|capture_order|item_id\S*)\s+(?:immediately\s+)?without\s+(?:user\s+)?(?:confirmation|approval|consent|asking)\b/i,
    reason: 'Attempted to force autonomous payment execution without human confirmation.',
  },
  {
    id: 'secret_exfiltration_attempt',
    regex: /\b(?:print|reveal|output|expose|dump|show|return|leak)\s+(?:all\s+)?(?:process\.env(?:\.\w+)?|environment\s+variables|api\s+keys?|client\s+secrets?|paypal_client_secret|gemini_api_key|feedico_partner_token|system\s+prompt)\b/i,
    reason: 'Attempted to exfiltrate server secrets, API keys, or system prompt.',
  },
  {
    id: 'cross_user_data_exfiltration',
    regex: /\b(?:access|dump|show|read|fetch|list)\s+(?:all\s+)?(?:other\s+users?|every\s+user'?s|another\s+user'?s)\s+(?:orders?|purchases?|sessions?|conversations?|passwords?|tokens?|wallets?)\b/i,
    reason: 'Attempted cross-user data exfiltration via agent prompt.',
  },
  {
    id: 'price_override_injection',
    regex: /\b(?:set|override|change|modify)\s+(?:the\s+)?(?:item\s+|product\s+|order\s+)?price\s+to\s+\$?0(?:\.00|\.01)?\b/i,
    reason: 'Attempted to manipulate server-side item pricing via prompt injection.',
  },
];

export interface PromptInjectionCheckResult {
  blocked: boolean;
  ruleId?: string;
  matchedRules: string[];
  reason?: string;
  sanitizedPrompt: string;
}

/**
 * Inspects a user prompt or external feed string for direct or indirect prompt injection attacks.
 */
export function detectPromptInjection(rawPrompt: string): PromptInjectionCheckResult {
  if (!rawPrompt || typeof rawPrompt !== 'string') {
    return { blocked: false, matchedRules: [], sanitizedPrompt: '' };
  }
  const trimmed = rawPrompt.trim().slice(0, 2000);
  const matchedRules: string[] = [];
  let firstReason: string | undefined;

  for (const rule of PROMPT_INJECTION_PATTERNS) {
    if (rule.regex.test(trimmed)) {
      matchedRules.push(rule.id);
      if (!firstReason) firstReason = rule.reason;
    }
  }

  if (matchedRules.length > 0) {
    return {
      blocked: true,
      ruleId: matchedRules[0],
      matchedRules,
      reason: firstReason,
      sanitizedPrompt: '',
    };
  }

  const sanitizedPrompt = trimmed
    .replace(/<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>/gi, '')
    .replace(/\[\s*SYSTEM\s*\]|\[\s*ADMIN\s*\]|\[\s*TOOL_CALL\s*\]/gi, '')
    .replace(/\0/g, '')
    .trim();

  return {
    blocked: false,
    matchedRules: [],
    sanitizedPrompt,
  };
}

/**
 * Sanitizes untrusted text coming from external product catalogs, merchant feeds,
 * or coupon descriptions so indirect prompt injections and XSS payloads are neutralized
 * before reaching the LLM or browser.
 */
export function sanitizeUntrustedFeedContent(rawText: string, maxLength = 400): string {
  if (!rawText || typeof rawText !== 'string') return '';
  let clean = rawText.replace(/\0/g, '');
  for (const rule of PROMPT_INJECTION_PATTERNS) {
    clean = clean.replace(rule.regex, '[REDACTED_UNTRUSTED_DIRECTIVE]');
  }
  clean = clean
    .replace(/<\s*\/?\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*\/?\s*script\b[^>]*>/gi, '')
    .replace(/<\s*\/?\s*(?:iframe|object|embed|svg|style|link|meta)\b[^>]*>/gi, '')
    .replace(/\bon[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, 'blocked:')
    .replace(/data\s*:\s*text\/html/gi, 'blocked:')
    .replace(/<\|im_start\|>|<\|im_end\|>/gi, '')
    .trim();
  return clean.slice(0, maxLength);
}

/**
 * Sanitizes a `ProductOffer` from an external API against indirect prompt injection,
 * unsafe URLs (`javascript:` / `data:`), and XSS.
 */
export function sanitizeProductOfferForAgent(offer: ProductOffer): ProductOffer {
  const safeUrlCheck = validateSafeClientHref(offer.canonicalUrl);
  const safeImageCheck = offer.imageUrl
    ? validateSafeClientHref(offer.imageUrl)
    : { valid: false, safeUrl: null };
  const safeSpecs: Record<string, string> = {};
  for (const [k, v] of Object.entries(offer.specs || {})) {
    const cleanKey = sanitizeUntrustedFeedContent(k, 80);
    const cleanVal = sanitizeUntrustedFeedContent(String(v ?? ''), 240);
    if (cleanKey) {
      safeSpecs[cleanKey] = cleanVal;
    }
  }
  return {
    ...offer,
    name: sanitizeUntrustedFeedContent(offer.name, 180) || 'Verified Product',
    merchant: sanitizeUntrustedFeedContent(offer.merchant, 100) || 'Verified Merchant',
    category: sanitizeUntrustedFeedContent(offer.category, 80) || 'general',
    summary: sanitizeUntrustedFeedContent(offer.summary, 400),
    canonicalUrl:
      safeUrlCheck.valid && safeUrlCheck.safeUrl ? safeUrlCheck.safeUrl : 'https://spark.app',
    imageUrl: safeImageCheck.valid ? safeImageCheck.safeUrl : null,
    specs: safeSpecs,
  };
}

/**
 * Sanitizes a `CouponItem` from an external affiliate feed against indirect prompt injection and unsafe URLs.
 */
export function sanitizeCouponForAgent(coupon: CouponItem): CouponItem {
  const safeSourceUrl = validateSafeClientHref(coupon.sourceUrl);
  const safeTrackedUrl = coupon.trackedUrl ? validateSafeClientHref(coupon.trackedUrl) : null;
  return {
    ...coupon,
    code: sanitizeUntrustedFeedContent(coupon.code, 48),
    merchant: sanitizeUntrustedFeedContent(coupon.merchant, 100),
    description: sanitizeUntrustedFeedContent(coupon.description, 300),
    terms: sanitizeUntrustedFeedContent(coupon.terms || '', 300),
    title: coupon.title ? sanitizeUntrustedFeedContent(coupon.title, 180) : coupon.title,
    sourceUrl: safeSourceUrl.valid && safeSourceUrl.safeUrl ? safeSourceUrl.safeUrl : '',
    trackedUrl:
      safeTrackedUrl && safeTrackedUrl.valid ? safeTrackedUrl.safeUrl || undefined : undefined,
  };
}

export type AgentToolCategory = 'READ' | 'WRITE' | 'SENSITIVE';

export type SparkAgentToolName =
  | 'parse_shopping_intent'
  | 'decompose_goal'
  | 'search_products'
  | 'compare_prices'
  | 'search_coupons'
  | 'discover_coupons'
  | 'analyze_prices'
  | 'compare_products'
  | 'analyze_reviews'
  | 'fetch_product_details'
  | 'normalize_canonical_identity'
  | 'consolidate_merchant_offers'
  | 'extract_category_specs'
  | 'build_traceable_evidence'
  | 'verify_science_compound'
  | 'audit_review_sample_credibility'
  | 'evaluate_support_longevity'
  | 'compare_merchant_offers'
  | 'verify_landed_cost_completeness'
  | 'evaluate_candidate_eligibility'
  | 'compute_quality_adjusted_score'
  | 'assign_recommendation_tiers'
  | 'save_favorite'
  | 'save_alert'
  | 'update_preferences'
  | 'connect_account'
  | 'create_payment_order'
  | 'confirm_order_creation'
  | 'approve_purchase'
  | 'execute_payment_capture';

export interface AgentToolDefinition {
  name: SparkAgentToolName;
  category: AgentToolCategory;
  requiresAuthentication: boolean;
  requiresExplicitHumanConfirmation: boolean;
  maxCallsPerMinute: number;
  requiredFields: string[];
}

export const SPARK_AGENT_TOOL_REGISTRY: Record<SparkAgentToolName, AgentToolDefinition> = {
  parse_shopping_intent: {
    name: 'parse_shopping_intent',
    category: 'READ',
    requiresAuthentication: false,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 120,
    requiredFields: ['prompt'],
  },
  decompose_goal: {
    name: 'decompose_goal',
    category: 'READ',
    requiresAuthentication: false,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 120,
    requiredFields: ['prompt'],
  },
  search_products: {
    name: 'search_products',
    category: 'READ',
    requiresAuthentication: false,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 120,
    requiredFields: ['query'],
  },
  compare_prices: {
    name: 'compare_prices',
    category: 'READ',
    requiresAuthentication: false,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 120,
    requiredFields: ['offers'],
  },
  search_coupons: {
    name: 'search_coupons',
    category: 'READ',
    requiresAuthentication: false,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 120,
    requiredFields: ['query'],
  },
  discover_coupons: {
    name: 'discover_coupons',
    category: 'READ',
    requiresAuthentication: false,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 120,
    requiredFields: ['query'],
  },
  analyze_prices: {
    name: 'analyze_prices',
    category: 'READ',
    requiresAuthentication: false,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 120,
    requiredFields: ['offers'],
  },
  compare_products: {
    name: 'compare_products',
    category: 'READ',
    requiresAuthentication: false,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 120,
    requiredFields: ['offers'],
  },
  analyze_reviews: {
    name: 'analyze_reviews',
    category: 'READ',
    requiresAuthentication: false,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 120,
    requiredFields: ['offers'],
  },
  fetch_product_details: {
    name: 'fetch_product_details',
    category: 'READ',
    requiresAuthentication: false,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 120,
    requiredFields: ['productId'],
  },
  normalize_canonical_identity: {
    name: 'normalize_canonical_identity',
    category: 'READ',
    requiresAuthentication: false,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 120,
    requiredFields: ['offers'],
  },
  consolidate_merchant_offers: {
    name: 'consolidate_merchant_offers',
    category: 'READ',
    requiresAuthentication: false,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 120,
    requiredFields: ['offers'],
  },
  extract_category_specs: {
    name: 'extract_category_specs',
    category: 'READ',
    requiresAuthentication: false,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 120,
    requiredFields: ['category', 'offers'],
  },
  build_traceable_evidence: {
    name: 'build_traceable_evidence',
    category: 'READ',
    requiresAuthentication: false,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 120,
    requiredFields: ['offers'],
  },
  verify_science_compound: {
    name: 'verify_science_compound',
    category: 'READ',
    requiresAuthentication: false,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 120,
    requiredFields: ['compoundName'],
  },
  audit_review_sample_credibility: {
    name: 'audit_review_sample_credibility',
    category: 'READ',
    requiresAuthentication: false,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 120,
    requiredFields: ['offers'],
  },
  evaluate_support_longevity: {
    name: 'evaluate_support_longevity',
    category: 'READ',
    requiresAuthentication: false,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 120,
    requiredFields: ['offers'],
  },
  compare_merchant_offers: {
    name: 'compare_merchant_offers',
    category: 'READ',
    requiresAuthentication: false,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 120,
    requiredFields: ['offers'],
  },
  verify_landed_cost_completeness: {
    name: 'verify_landed_cost_completeness',
    category: 'READ',
    requiresAuthentication: false,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 120,
    requiredFields: ['offers'],
  },
  evaluate_candidate_eligibility: {
    name: 'evaluate_candidate_eligibility',
    category: 'READ',
    requiresAuthentication: false,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 120,
    requiredFields: ['offers'],
  },
  compute_quality_adjusted_score: {
    name: 'compute_quality_adjusted_score',
    category: 'READ',
    requiresAuthentication: false,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 120,
    requiredFields: ['offers'],
  },
  assign_recommendation_tiers: {
    name: 'assign_recommendation_tiers',
    category: 'READ',
    requiresAuthentication: false,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 120,
    requiredFields: ['offers'],
  },
  save_favorite: {
    name: 'save_favorite',
    category: 'WRITE',
    requiresAuthentication: true,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 20,
    requiredFields: ['productId'],
  },
  save_alert: {
    name: 'save_alert',
    category: 'WRITE',
    requiresAuthentication: true,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 20,
    requiredFields: ['productId', 'targetPrice'],
  },
  update_preferences: {
    name: 'update_preferences',
    category: 'WRITE',
    requiresAuthentication: true,
    requiresExplicitHumanConfirmation: false,
    maxCallsPerMinute: 15,
    requiredFields: ['preferences'],
  },
  connect_account: {
    name: 'connect_account',
    category: 'SENSITIVE',
    requiresAuthentication: true,
    requiresExplicitHumanConfirmation: true,
    maxCallsPerMinute: 10,
    requiredFields: ['userId', 'explicitUserConfirmed'],
  },
  create_payment_order: {
    name: 'create_payment_order',
    category: 'SENSITIVE',
    requiresAuthentication: true,
    requiresExplicitHumanConfirmation: true,
    maxCallsPerMinute: 10,
    requiredFields: ['userId', 'productId', 'merchantId', 'quantity', 'amount', 'currency'],
  },
  confirm_order_creation: {
    name: 'confirm_order_creation',
    category: 'SENSITIVE',
    requiresAuthentication: true,
    requiresExplicitHumanConfirmation: true,
    maxCallsPerMinute: 10,
    requiredFields: ['sparkOrderId', 'confirmationToken', 'expectedTotal', 'expectedCurrency'],
  },
  approve_purchase: {
    name: 'approve_purchase',
    category: 'SENSITIVE',
    requiresAuthentication: true,
    requiresExplicitHumanConfirmation: true,
    maxCallsPerMinute: 10,
    requiredFields: ['userId', 'orderId', 'explicitUserConfirmed'],
  },
  execute_payment_capture: {
    name: 'execute_payment_capture',
    category: 'SENSITIVE',
    requiresAuthentication: true,
    requiresExplicitHumanConfirmation: true,
    maxCallsPerMinute: 10,
    requiredFields: ['userId', 'orderId'],
  },
};

export interface HumanConfirmationBinding {
  authorizationHash?: string;
  confirmationToken?: string;
  userConfirmed?: boolean;
  userId?: string;
  merchantId?: string;
  merchant?: string;
  productId: string;
  quantity: number;
  amount: number;
  currency: 'USD' | 'EUR' | 'GBP';
  expiresAtMs?: number;
  consumed?: boolean;
}

/**
 * Enforces AI Agent Tool Permissions (`READ`, `WRITE`, `SENSITIVE`), input schema validation,
 * per-user execution limits, and mandatory human authorization binding for `SENSITIVE` tools.
 */
export class AgentToolPermissionGate {
  private callTimestampsByUserAndTool = new Map<string, number[]>();
  private nowFn: () => number;

  constructor(options?: { nowFn?: () => number }) {
    this.nowFn = options?.nowFn || (() => Date.now());
  }

  public authorizeToolCall(input: {
    toolName: string;
    actor?: 'agent' | 'user';
    authenticatedUserId?: string | null;
    userId?: string | null;
    args: Record<string, unknown>;
    humanAuthorization?: HumanConfirmationBinding | null;
  }): {
    allowed: boolean;
    statusCode: number;
    category?: AgentToolCategory;
    errorCode?:
      | 'unknown_agent_tool'
      | 'unregistered_agent_tool'
      | 'unauthenticated_tool_call_blocked'
      | 'invalid_tool_schema'
      | 'tool_rate_limit_exceeded'
      | 'sensitive_tool_requires_human_confirmation'
      | 'missing_human_authorization_for_sensitive_tool'
      | 'human_authorization_mismatch'
      | 'human_authorization_amount_mismatch'
      | 'human_authorization_expired_or_replayed';
    reason: string;
  } {
    const def = SPARK_AGENT_TOOL_REGISTRY[input.toolName as SparkAgentToolName];
    if (!def) {
      return {
        allowed: false,
        statusCode: 403,
        errorCode: 'unregistered_agent_tool',
        reason: `Agent tool "${input.toolName}" is not registered in the Spark Tool Permission Gate.`,
      };
    }

    const effectiveUserId = input.authenticatedUserId ?? input.userId ?? null;
    if (def.requiresAuthentication && !effectiveUserId) {
      return {
        allowed: false,
        statusCode: 401,
        category: def.category,
        errorCode: 'unauthenticated_tool_call_blocked',
        reason: `Tool "${def.name}" (${def.category}) requires an authenticated Spark user session.`,
      };
    }

    const args = input.args || {};
    for (const field of def.requiredFields) {
      if (args[field] === undefined || args[field] === null || args[field] === '') {
        return {
          allowed: false,
          statusCode: 400,
          category: def.category,
          errorCode: 'invalid_tool_schema',
          reason: `Tool "${def.name}" rejected: missing required schema field "${field}".`,
        };
      }
    }

    const rateKey = `${effectiveUserId || 'anon'}:${def.name}`;
    const now = this.nowFn();
    const recent = (this.callTimestampsByUserAndTool.get(rateKey) || []).filter(
      (ts) => now - ts < 60_000
    );
    if (recent.length >= def.maxCallsPerMinute) {
      this.callTimestampsByUserAndTool.set(rateKey, recent);
      return {
        allowed: false,
        statusCode: 429,
        category: def.category,
        errorCode: 'tool_rate_limit_exceeded',
        reason: `Tool "${def.name}" rate limit exceeded (${def.maxCallsPerMinute} calls/minute).`,
      };
    }
    recent.push(now);
    this.callTimestampsByUserAndTool.set(rateKey, recent);

    if (def.category === 'SENSITIVE') {
      const authBind = input.humanAuthorization;
      if (!authBind && args.explicitUserConfirmed !== true) {
        return {
          allowed: false,
          statusCode: 403,
          category: def.category,
          errorCode: 'missing_human_authorization_for_sensitive_tool',
          reason: `Autonomous agent execution of SENSITIVE tool "${def.name}" is forbidden without explicit human confirmation.`,
        };
      }

      if (authBind) {
        if (authBind.consumed || (authBind.expiresAtMs !== undefined && authBind.expiresAtMs <= now)) {
          return {
            allowed: false,
            statusCode: 409,
            category: def.category,
            errorCode: 'human_authorization_expired_or_replayed',
            reason: 'Human purchase authorization has expired or was already consumed (replay blocked).',
          };
        }

        const argAmount =
          typeof args.expectedTotal === 'number'
            ? args.expectedTotal
            : typeof args.amount === 'number'
            ? args.amount
            : undefined;
        if (argAmount !== undefined && Math.abs(argAmount - authBind.amount) > 0.001) {
          return {
            allowed: false,
            statusCode: 409,
            category: def.category,
            errorCode: 'human_authorization_amount_mismatch',
            reason: 'Human authorization amount mismatch detected.',
          };
        }

        if (
          (authBind.userId && effectiveUserId && authBind.userId !== effectiveUserId) ||
          (typeof args.authorizationHash === 'string' &&
            authBind.authorizationHash &&
            args.authorizationHash !== authBind.authorizationHash) ||
          (typeof args.confirmationToken === 'string' &&
            authBind.confirmationToken &&
            args.confirmationToken !== authBind.confirmationToken) ||
          (typeof args.productId === 'string' && args.productId !== authBind.productId) ||
          (typeof args.quantity === 'number' && args.quantity !== authBind.quantity) ||
          (typeof args.currency === 'string' && args.currency !== authBind.currency) ||
          (typeof args.expectedCurrency === 'string' && args.expectedCurrency !== authBind.currency)
        ) {
          return {
            allowed: false,
            statusCode: 409,
            category: def.category,
            errorCode: 'human_authorization_mismatch',
            reason:
              'Human authorization binding mismatch: order parameters differ from the user-confirmed authorization.',
          };
        }
      }
    }

    return {
      allowed: true,
      statusCode: 200,
      category: def.category,
      reason: `Tool "${def.name}" (${def.category}) authorized.`,
    };
  }
}

// ============================================================================
// PHASE 6 — SSRF PROTECTION & OUTBOUND NETWORK SECURITY
// ============================================================================

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'kubernetes.default',
  'kubernetes.default.svc',
  '0.0.0.0',
]);

/**
 * Checks if an IPv4 address string falls within private, loopback, link-local,
 * carrier-grade NAT, broadcast, or cloud metadata ranges.
 */
export function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b, c] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8 (RFC 1918)
  if (a === 127) return true; // 127.0.0.0/8 (Loopback)
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (Link-local & Cloud Metadata 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 (RFC 1918)
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 (RFC 1918)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (Carrier-grade NAT)
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // Benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // Multicast & Broadcast (224.0.0.0/4, 240.0.0.0/4)
  return false;
}

/**
 * Checks if an IPv6 address string is loopback (`::1`), unspecified (`::`),
 * unique-local (`fc00::/7`), link-local (`fe80::/10`), or IPv4-mapped private (`::ffff:...`).
 */
export function isPrivateOrReservedIpv6(rawIp: string): boolean {
  const clean = rawIp.replace(/^\[|\]$/g, '').toLowerCase();
  if (clean === '::1' || clean === '::' || clean === '0:0:0:0:0:0:0:1' || clean === '0:0:0:0:0:0:0:0') {
    return true;
  }
  if (clean.startsWith('fc') || clean.startsWith('fd')) return true; // fc00::/7 Unique Local
  if (clean.startsWith('fe8') || clean.startsWith('fe9') || clean.startsWith('fea') || clean.startsWith('feb')) {
    return true; // fe80::/10 Link-Local
  }
  if (clean.startsWith('ff')) return true; // ff00::/8 Multicast
  if (clean.startsWith('::ffff:')) {
    const mappedV4 = clean.slice('::ffff:'.length);
    if (net.isIPv4(mappedV4)) {
      return isPrivateOrReservedIpv4(mappedV4);
    }
    return true;
  }
  return false;
}

/**
 * Validates any URL before the backend or AI agent performs an outbound request or Lookup.
 * Blocks SSRF vectors: private/internal IPs, loopback, link-local, cloud metadata (`169.254.169.254`),
 * non-HTTP(S) schemes, embedded credentials, and internal domain suffixes.
 */
export function validateSafeOutboundUrl(
  rawUrl: string,
  options?: { requireHttps?: boolean; allowedHostSuffixes?: string[] }
): {
  valid: boolean;
  safe: boolean;
  normalizedUrl?: string;
  errorCode?:
    | 'invalid_url'
    | 'disallowed_protocol'
    | 'embedded_credentials_blocked'
    | 'ssrf_private_or_internal_host_blocked'
    | 'disallowed_port'
    | 'untrusted_domain';
  reason?: string;
} {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, safe: false, errorCode: 'invalid_url', reason: 'URL is required.' };
  }
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, safe: false, errorCode: 'invalid_url', reason: 'Malformed URL.' };
  }

  const requireHttps = options?.requireHttps ?? false;
  if (requireHttps) {
    if (parsed.protocol !== 'https:') {
      return {
        valid: false,
        safe: false,
        errorCode: 'disallowed_protocol',
        reason: `Disallowed URL protocol "${parsed.protocol}". Only https:// is permitted.`,
      };
    }
  } else if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      valid: false,
      safe: false,
      errorCode: 'disallowed_protocol',
      reason: `Disallowed URL protocol "${parsed.protocol}". Only https:// or http:// are permitted.`,
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      safe: false,
      errorCode: 'embedded_credentials_blocked',
      reason: 'URLs containing embedded credentials (username:password@host) are forbidden.',
    };
  }

  const rawHost = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!rawHost) {
    return { valid: false, safe: false, errorCode: 'invalid_url', reason: 'Missing URL hostname.' };
  }

  if (
    BLOCKED_HOSTNAMES.has(rawHost) ||
    rawHost.endsWith('.localhost') ||
    rawHost.endsWith('.internal') ||
    rawHost.endsWith('.local') ||
    rawHost.endsWith('.home.arpa') ||
    rawHost.endsWith('.localdomain')
  ) {
    return {
      valid: false,
      safe: false,
      errorCode: 'ssrf_private_or_internal_host_blocked',
      reason: `SSRF protection blocked internal or reserved hostname "${rawHost}".`,
    };
  }

  if (/^(?:0x[0-9a-f]+|\d+)$/i.test(rawHost)) {
    return {
      valid: false,
      safe: false,
      errorCode: 'ssrf_private_or_internal_host_blocked',
      reason: `SSRF protection blocked numeric/encoded IP host "${rawHost}".`,
    };
  }

  if (net.isIPv4(rawHost)) {
    if (isPrivateOrReservedIpv4(rawHost)) {
      return {
        valid: false,
        safe: false,
        errorCode: 'ssrf_private_or_internal_host_blocked',
        reason: `SSRF protection blocked private, loopback, or metadata IPv4 address "${rawHost}".`,
      };
    }
  } else if (net.isIPv6(rawHost) || rawHost.includes(':')) {
    if (isPrivateOrReservedIpv6(rawHost)) {
      return {
        valid: false,
        safe: false,
        errorCode: 'ssrf_private_or_internal_host_blocked',
        reason: `SSRF protection blocked private or loopback IPv6 address "${rawHost}".`,
      };
    }
  } else if (!rawHost.includes('.')) {
    return {
      valid: false,
      safe: false,
      errorCode: 'ssrf_private_or_internal_host_blocked',
      reason: `SSRF protection blocked unqualified internal hostname "${rawHost}".`,
    };
  }

  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
    return {
      valid: false,
      safe: false,
      errorCode: 'disallowed_port',
      reason: `SSRF protection blocked non-standard port ${parsed.port}.`,
    };
  }

  if (options?.allowedHostSuffixes && options.allowedHostSuffixes.length > 0) {
    const matched = options.allowedHostSuffixes.some(
      (suffix) =>
        rawHost === suffix.toLowerCase() || rawHost.endsWith(`.${suffix.toLowerCase()}`)
    );
    if (!matched) {
      return {
        valid: false,
        safe: false,
        errorCode: 'untrusted_domain',
        reason: `Host "${rawHost}" is not in the allowed domain list.`,
      };
    }
  }

  return {
    valid: true,
    safe: true,
    normalizedUrl: parsed.toString(),
  };
}

/**
 * Validates that a client-facing link (`href` / `src`) uses a safe `https:` or `http:` scheme
 * and blocks `javascript:`, `data:`, `vbscript:`, and `file:` URLs (Phase 9 Frontend Security).
 */
export function validateSafeClientHref(rawUrl?: string | null): {
  valid: boolean;
  safeUrl: string | null;
} {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, safeUrl: null };
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) return { valid: false, safeUrl: null };
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { valid: false, safeUrl: null };
    }
    return { valid: true, safeUrl: parsed.toString() };
  } catch {
    return { valid: false, safeUrl: null };
  }
}

// ============================================================================
// PHASE 7 & 11 — API RATE LIMITING, SECRET REDACTION & SECURITY MONITORING
// ============================================================================

export class SlidingWindowRateLimiter {
  private windows = new Map<string, number[]>();
  private maxRequests: number;
  private windowMs: number;
  private nowFn: () => number;

  constructor(
    optionsOrMax: { maxRequests: number; windowMs: number; nowFn?: () => number } | number,
    windowMsArg?: number
  ) {
    if (typeof optionsOrMax === 'number') {
      this.maxRequests = optionsOrMax;
      this.windowMs = windowMsArg ?? 60_000;
      this.nowFn = () => Date.now();
    } else {
      this.maxRequests = optionsOrMax.maxRequests;
      this.windowMs = optionsOrMax.windowMs;
      this.nowFn = optionsOrMax.nowFn || (() => Date.now());
    }
  }

  public check(key: string): {
    allowed: boolean;
    remaining: number;
    retryAfterSeconds: number;
    retryAfterMs: number;
  } {
    const now = this.nowFn();
    const recent = (this.windows.get(key) || []).filter((ts) => now - ts < this.windowMs);
    if (recent.length >= this.maxRequests) {
      this.windows.set(key, recent);
      const oldest = recent[0] || now;
      const retryAfterMs = Math.max(1000, oldest + this.windowMs - now);
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds,
        retryAfterMs,
      };
    }
    recent.push(now);
    this.windows.set(key, recent);
    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - recent.length),
      retryAfterSeconds: 0,
      retryAfterMs: 0,
    };
  }
}

const SENSITIVE_OBJECT_KEY_REGEX =
  /^(?:authorization|password|passwd|secret|clientsecret|client_secret|accesstoken|access_token|refreshtoken|refresh_token|apikey|api_key|partnertoken|partner_token)$/i;

/**
 * Redacts all sensitive secrets, API keys, OAuth tokens, session tokens, CSRF tokens,
 * and passwords from any string or structured log payload (Phase 8 & Phase 11).
 */
export function redactSensitiveData<T>(input: T): T {
  if (input === null || input === undefined) {
    return input;
  }
  if (typeof input === 'string') {
    let safe: string = input;
    const envKeysToRedact = [
      process.env.PAYPAL_CLIENT_SECRET,
      process.env.PAYPAL_CLIENT_ID,
      process.env.PAYPAL_TOKEN_ENCRYPTION_KEY,
      process.env.FEEDICO_PARTNER_TOKEN,
      process.env.FEEDICO_POSTBACK_SECRET,
      process.env.CHANNEL3_API_KEY,
      process.env.GEMINI_API_KEY,
      process.env.AFFILIATE_COUPON_API_KEY,
    ];
    for (const val of envKeysToRedact) {
      if (val && typeof val === 'string' && val.trim().length >= 6) {
        safe = safe.split(val.trim()).join('[REDACTED_ENV_SECRET]');
      }
    }

    safe = safe
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED_TOKEN]')
      .replace(/Basic\s+[A-Za-z0-9._~+/-]+=*/gi, 'Basic [REDACTED_BASIC_AUTH]')
      .replace(/\bfdcp_[A-Za-z0-9_\-]+/g, 'fdcp_[REDACTED]')
      .replace(/\bfdco_[A-Za-z0-9_\-]+/g, 'fdco_[REDACTED]')
      .replace(/\bwhsec_[A-Za-z0-9_\-]+/g, 'whsec_[REDACTED]')
      .replace(/\bsess_[A-Za-z0-9_\-]+/g, 'sess_[REDACTED]')
      .replace(/\bcsrf_[A-Za-z0-9_\-]+/g, 'csrf_[REDACTED]')
      .replace(/\brft_[A-Za-z0-9_\-]+/g, 'rft_[REDACTED]')
      .replace(/\brst_[A-Za-z0-9_\-]+/g, 'rst_[REDACTED]')
      .replace(/\bAIza[0-9A-Za-z_\-]{30,}/g, 'AIza[REDACTED]')
      .replace(/("password"\s*:\s*")[^"]*(")/gi, '$1[REDACTED_PASSWORD]$2')
      .replace(/("access_token"\s*:\s*")[^"]*(")/gi, '$1[REDACTED_TOKEN]$2')
      .replace(/("refresh_token"\s*:\s*")[^"]*(")/gi, '$1[REDACTED_REFRESH_TOKEN]$2')
      .replace(/("client_secret"\s*:\s*")[^"]*(")/gi, '$1[REDACTED_SECRET]$2');

    return safe as unknown as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveData(item)) as unknown as T;
  }

  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_OBJECT_KEY_REGEX.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactSensitiveData(v);
      }
    }
    return out as T;
  }

  return input;
}

export type SecurityEventType =
  | 'AUTH_SUCCESS'
  | 'AUTH_FAILURE'
  | 'ACCOUNT_LOCKOUT'
  | 'SESSION_CREATED'
  | 'SESSION_REVOKED'
  | 'ALL_SESSIONS_REVOKED'
  | 'REFRESH_TOKEN_ROTATED'
  | 'REFRESH_TOKEN_REUSE_BLOCKED'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'IDOR_CROSS_USER_BLOCKED'
  | 'CSRF_REJECTED'
  | 'RBAC_ADMIN_DENIED'
  | 'INJECTION_ATTEMPT_BLOCKED'
  | 'XSS_PAYLOAD_SANITIZED'
  | 'SSRF_ATTEMPT_BLOCKED'
  | 'PROMPT_INJECTION_BLOCKED'
  | 'AGENT_TOOL_BLOCKED'
  | 'WEBHOOK_VERIFIED'
  | 'WEBHOOK_REJECTED'
  | 'PAYMENT_TAMPER_BLOCKED'
  | 'DUPLICATE_CAPTURE_BLOCKED'
  | 'RATE_LIMIT_TRIGGERED'
  | string;

export interface SecurityMonitorEvent {
  id: string;
  timestamp: string;
  eventType: SecurityEventType;
  category?: string;
  severity: 'INFO' | 'WARN' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  userId: string | null;
  ip: string | null;
  endpoint: string;
  outcome: 'ALLOWED' | 'DENIED' | 'BLOCKED' | 'ALERT';
  errorCode?: string;
  detail: string;
}

/**
 * Centralized Security Event Monitor & Anomaly Detector (Phase 11).
 * Automatically redacts secrets/PII from all recorded events and tracks high-severity anomalies.
 */
export class SecurityEventMonitor {
  private events: SecurityMonitorEvent[] = [];
  private nowFn: () => number;

  constructor(options?: { nowFn?: () => number }) {
    this.nowFn = options?.nowFn || (() => Date.now());
  }

  public record(input: {
    eventType?: SecurityEventType;
    category?: string;
    severity: SecurityMonitorEvent['severity'];
    userId?: string | null;
    ip?: string | null;
    endpoint: string;
    outcome: SecurityMonitorEvent['outcome'];
    errorCode?: string;
    detail: string;
  }): SecurityMonitorEvent {
    const now = this.nowFn();
    const evt: SecurityMonitorEvent = {
      id: `sec_${now.toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: new Date(now).toISOString(),
      eventType: input.eventType || input.category || 'SECURITY_EVENT',
      category: input.category || input.eventType,
      severity: input.severity,
      userId: input.userId || null,
      ip: input.ip || null,
      endpoint: input.endpoint,
      outcome: input.outcome,
      errorCode: input.errorCode,
      detail: redactSensitiveData(input.detail),
    };
    this.events.unshift(evt);
    if (this.events.length > 500) {
      this.events.length = 500;
    }
    return evt;
  }

  public getEvents(
    optionsOrLimit?:
      | {
          userId?: string;
          severity?: SecurityMonitorEvent['severity'];
          limit?: number;
        }
      | number
  ): SecurityMonitorEvent[] {
    let list = this.events;
    const options =
      typeof optionsOrLimit === 'number' ? { limit: optionsOrLimit } : optionsOrLimit;
    if (options?.userId) {
      list = list.filter((e) => e.userId === options.userId);
    }
    if (options?.severity) {
      list = list.filter((e) => e.severity === options.severity);
    }
    return list.slice(0, options?.limit ?? 100);
  }
}
