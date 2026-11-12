import crypto from 'node:crypto';
import fs from 'node:fs';
import type {
  CouponItem,
  FeedicoAffiliateClickRecord,
  FeedicoCommissionInfo,
  FeedicoIntegrationState,
  FeedicoMerchantRecord,
  FeedicoNormalizedOffer,
  FeedicoOfferClassification,
  FeedicoStatusResponse,
  ProductOffer,
} from '../types/spark.ts';

export const OFFICIAL_FEEDICO_PARTNER_BASE_URL = 'https://partner.feedico.io';
export const OFFICIAL_FEEDICO_CUSTOMER_BASE_URL = 'https://api.feedico.io';
export const ALLOWED_FEEDICO_PARTNER_HOSTS = new Set(['partner.feedico.io']);
export const ALLOWED_FEEDICO_CUSTOMER_HOSTS = new Set(['api.feedico.io']);
export const FORBIDDEN_FEEDICO_DATA_API_HOSTS = new Set(['api.feedico.io']);

export const VALID_FEEDICO_PROVIDERS = new Set([
  'admitad',
  'cj_affiliate',
  'awin_affiliate',
  'impact_com',
  'partnerize',
  'takeads',
  'takedeals',
  'tradetracker',
]);

export interface FeedicoConfig {
  enabled: boolean;
  partnerToken: string;
  tokenMode?: 'partner' | 'customer_catalog';
  baseUrl: string;
  cacheTtlSeconds: number;
  postbackSecret: string;
  configured: boolean;
  tokenFormatValid: boolean;
  baseUrlValid: boolean;
  validationError: string | null;
  errorCode:
    | 'none'
    | 'feedico_disabled'
    | 'missing_partner_token'
    | 'invalid_partner_token_prefix'
    | 'feedico_data_api_mixed_rejected'
    | 'ssrf_blocked_untrusted_host'
    | 'invalid_base_url';
}

export interface FeedicoApiMeta {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface FeedicoApiCouponRow {
  id: string;
  goSlug: string;
  merchantName: string;
  provider: string;
  code: string;
  title: string;
  description?: string | null;
  startsAt?: string | null;
  endsAt: string | null;
  websiteUrl: string | null;
  countries: string[];
  goUrl: string;
  commission?: FeedicoCommissionInfo | null;
  cashbackAllowed?: 'yes' | 'limited' | 'no' | 'unknown';
}

export interface FeedicoApiMerchantRow {
  goSlug: string;
  name: string;
  provider: string;
  websiteUrl: string | null;
  couponCount: number;
  goUrl: string;
  commission?: FeedicoCommissionInfo | null;
  cashbackAllowed?: 'yes' | 'limited' | 'no' | 'unknown';
}

export interface FeedicoApiProductRow {
  id: string;
  firmName: string;
  merchantKey: string;
  merchantDomain: string | null;
  provider: string;
  externalProductId: string;
  title: string | null;
  description: string | null;
  brand: string | null;
  sku: string | null;
  gtin: string | null;
  price: number | null;
  salePrice: number | null;
  salePriceStartsAt?: string | null;
  salePriceEndsAt?: string | null;
  discountPercentage: number | null;
  currency: string | null;
  availability: string | null;
  countries: string[] | null;
  fetchedAt?: string | null;
  images?: Array<{ url: string; sortOrder: number; isPrimary: boolean }>;
  thumbnailUrl?: string | null;
  goUrl: string;
}

export interface FeedicoLinkValidationResult {
  input: string;
  ok: boolean;
  status:
    | 'ok'
    | 'store_only'
    | 'unknown_partner'
    | 'unknown_merchant'
    | 'no_destination'
    | 'not_your_link'
    | 'not_a_feedico_go_link'
    | 'invalid_url'
    | 'invalid_link';
  merchant?: {
    slug: string;
    name: string | null;
    website: string | null;
  };
  network?: string | null;
  commission?: boolean;
  rerouted?: boolean;
  coupon?: {
    code: string;
    active: boolean;
    endsAt: string | null;
  } | null;
  product?: {
    sku: string;
    found: boolean;
  } | null;
  deepLink?: {
    url: string;
    status: 'will_apply' | 'invalid' | 'off-site' | 'unsupported' | 'ignored';
  } | null;
  notes?: string[];
}

export interface FeedicoCouponSearchParams {
  q?: string;
  merchant?: string;
  provider?: string;
  countries?: string | string[];
  endingWithinDays?: number;
  sort?: 'newest' | 'ending_soon' | 'merchant' | 'code';
  cashback?: 'allowed';
  page?: number;
  pageSize?: number;
  maxPages?: number;
  bypassCache?: boolean;
}

export interface FeedicoMerchantSearchParams {
  q?: string;
  provider?: string;
  hasCoupons?: boolean;
  minCoupons?: number;
  sort?: 'coupons_desc' | 'coupons_asc' | 'name_asc' | 'name_desc';
  countries?: string | string[];
  cashback?: 'allowed';
  page?: number;
  pageSize?: number;
  bypassCache?: boolean;
}

export interface FeedicoProductSearchParams {
  q?: string;
  brand?: string;
  sku?: string;
  firmName?: string;
  merchant?: string;
  onSale?: boolean;
  minPrice?: number;
  maxPrice?: number;
  currency?: string;
  countries?: string | string[];
  cashback?: 'allowed';
  pageSize?: number;
  cursor?: string;
}

export class FeedicoServiceError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    statusCode: number,
    errorCode: string,
    retryAfterSeconds?: number
  ) {
    super(redactFeedicoSecrets(message));
    this.name = 'FeedicoServiceError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Redacts any Feedico API tokens (`fdcp_...`, `fdco_...`), webhook secrets (`whsec_...`),
 * or Authorization Bearer tokens from logs, error messages, and diagnostics.
 */
export function redactFeedicoSecrets(input: string): string {
  if (!input) return '';
  return input
    .replace(/Bearer\s+[A-Za-z0-9_\-.]+/gi, 'Bearer [REDACTED_FEEDICO_TOKEN]')
    .replace(/\bfdcp_[A-Za-z0-9_\-]+/g, 'fdcp_[REDACTED]')
    .replace(/\bfdco_[A-Za-z0-9_\-]+/g, 'fdco_[REDACTED]')
    .replace(/\bwhsec_[A-Za-z0-9_\-]+/g, 'whsec_[REDACTED]');
}

/**
 * Validates outbound Feedico base URL against SSRF and ensures Partner API isolation
 * (rejects Data API host api.feedico.io when in Partner API mode, non-HTTPS protocols, private IPs, and non-Feedico domains).
 */
export function validateFeedicoBaseUrl(
  rawUrl: string,
  allowCustomerApiHost = false
): {
  valid: boolean;
  normalizedUrl: string;
  errorCode: FeedicoConfig['errorCode'];
  reason: string | null;
} {
  const defaultBase = allowCustomerApiHost
    ? OFFICIAL_FEEDICO_CUSTOMER_BASE_URL
    : OFFICIAL_FEEDICO_PARTNER_BASE_URL;
  const trimmed = (rawUrl || defaultBase).trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      normalizedUrl: defaultBase,
      errorCode: 'invalid_base_url',
      reason: 'FEEDICO_API_BASE_URL is not a valid URL.',
    };
  }

  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      normalizedUrl: defaultBase,
      errorCode: 'ssrf_blocked_untrusted_host',
      reason: 'FEEDICO_API_BASE_URL must use https:// protocol.',
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (!allowCustomerApiHost && FORBIDDEN_FEEDICO_DATA_API_HOSTS.has(host)) {
    return {
      valid: false,
      normalizedUrl: OFFICIAL_FEEDICO_PARTNER_BASE_URL,
      errorCode: 'feedico_data_api_mixed_rejected',
      reason:
        'Refusing to mix Feedico Data API (api.feedico.io) with Feedico Partner API (partner.feedico.io). Use https://partner.feedico.io.',
    };
  }

  const allowedHosts = allowCustomerApiHost
    ? new Set([...ALLOWED_FEEDICO_PARTNER_HOSTS, ...ALLOWED_FEEDICO_CUSTOMER_HOSTS])
    : ALLOWED_FEEDICO_PARTNER_HOSTS;

  if (!allowedHosts.has(host)) {
    return {
      valid: false,
      normalizedUrl: defaultBase,
      errorCode: 'ssrf_blocked_untrusted_host',
      reason: `SSRF protection blocked untrusted Feedico host "${host}". Only official feedico.io API hosts are permitted.`,
    };
  }

  if (parsed.port && parsed.port !== '443') {
    return {
      valid: false,
      normalizedUrl: defaultBase,
      errorCode: 'ssrf_blocked_untrusted_host',
      reason: `SSRF protection blocked non-standard port ${parsed.port}.`,
    };
  }

  return {
    valid: true,
    normalizedUrl: allowCustomerApiHost ? OFFICIAL_FEEDICO_CUSTOMER_BASE_URL : `https://${host}`,
    errorCode: 'none',
    reason: null,
  };
}

const SECRET_MOUNT_PATHS = [
  '/run/secrets/FEEDICO_PARTNER_TOKEN',
  '/secrets/FEEDICO_PARTNER_TOKEN',
  '/etc/secrets/FEEDICO_PARTNER_TOKEN',
];

function sanitizeRawTokenValue(raw: string | undefined | null): string {
  if (!raw || typeof raw !== 'string') return '';
  let cleaned = raw.trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (/^Bearer\s+/i.test(cleaned)) {
    cleaned = cleaned.replace(/^Bearer\s+/i, '').trim();
  }
  return cleaned;
}

function resolveRawFeedicoTokenFromEnv(
  env: Partial<Record<string, string | undefined>>,
  hasExplicitTokenOverride: boolean
): string {
  const primary = sanitizeRawTokenValue(env.FEEDICO_PARTNER_TOKEN);
  if (primary) return primary;

  // If caller explicitly passed FEEDICO_PARTNER_TOKEN: '' in unit test overrides, respect it
  if (hasExplicitTokenOverride) {
    return '';
  }

  const aliasCandidates = [
    env.FEEDICO_API_TOKEN,
    env.FEEDICO_TOKEN,
    env.FEEDICO_API_KEY,
    env.AFFILIATE_COUPON_API_KEY,
  ];
  for (const candidate of aliasCandidates) {
    const cleaned = sanitizeRawTokenValue(candidate);
    if (cleaned) return cleaned;
  }

  for (const secretPath of SECRET_MOUNT_PATHS) {
    try {
      if (fs.existsSync(secretPath)) {
        const fileToken = sanitizeRawTokenValue(fs.readFileSync(secretPath, 'utf8'));
        if (fileToken) return fileToken;
      }
    } catch {
      // Ignore unreadable mount path
    }
  }

  return '';
}

/**
 * Validates Feedico configuration from environment variables or custom overrides.
 * Supports both `fdcp_` (Partner API on partner.feedico.io) and `fdco_` (Global Catalogue API on api.feedico.io)
 * as well as runtime token rotation without code changes.
 */
export function getFeedicoConfig(envOverrides?: Partial<Record<string, string | undefined>>): FeedicoConfig {
  const env = { ...process.env, ...(envOverrides || {}) };
  const rawEnabled = (env.FEEDICO_ENABLED ?? 'true').trim().toLowerCase();
  const enabled = rawEnabled !== 'false' && rawEnabled !== '0' && rawEnabled !== 'no';

  const hasExplicitTokenOverride = Boolean(
    envOverrides && Object.prototype.hasOwnProperty.call(envOverrides, 'FEEDICO_PARTNER_TOKEN')
  );
  const rawToken = resolveRawFeedicoTokenFromEnv(env, hasExplicitTokenOverride);
  const isCustomerToken = /^fdco_[A-Za-z0-9_\-]{6,}$/.test(rawToken);
  const isPartnerToken = /^fdcp_[A-Za-z0-9_\-]{6,}$/.test(rawToken);

  const rawBaseUrl = (
    env.FEEDICO_API_BASE_URL ??
    (isCustomerToken ? OFFICIAL_FEEDICO_CUSTOMER_BASE_URL : OFFICIAL_FEEDICO_PARTNER_BASE_URL)
  ).trim();
  const rawTtl = Number.parseInt((env.FEEDICO_CACHE_TTL ?? '300').trim(), 10);
  const cacheTtlSeconds = Number.isFinite(rawTtl) && rawTtl >= 10 && rawTtl <= 86400 ? rawTtl : 300;
  const postbackSecret = (env.FEEDICO_POSTBACK_SECRET ?? '').trim();

  const urlCheck = validateFeedicoBaseUrl(
    rawBaseUrl || (isCustomerToken ? OFFICIAL_FEEDICO_CUSTOMER_BASE_URL : OFFICIAL_FEEDICO_PARTNER_BASE_URL),
    isCustomerToken
  );
  if (!urlCheck.valid) {
    return {
      enabled,
      partnerToken: rawToken,
      tokenMode: isCustomerToken ? 'customer_catalog' : 'partner',
      baseUrl: urlCheck.normalizedUrl,
      cacheTtlSeconds,
      postbackSecret,
      configured: false,
      tokenFormatValid: false,
      baseUrlValid: false,
      validationError: urlCheck.reason,
      errorCode: urlCheck.errorCode,
    };
  }

  if (!enabled) {
    return {
      enabled: false,
      partnerToken: rawToken,
      tokenMode: isCustomerToken ? 'customer_catalog' : 'partner',
      baseUrl: urlCheck.normalizedUrl,
      cacheTtlSeconds,
      postbackSecret,
      configured: false,
      tokenFormatValid: false,
      baseUrlValid: true,
      validationError: 'Feedico integration is disabled via FEEDICO_ENABLED=false.',
      errorCode: 'feedico_disabled',
    };
  }

  if (!rawToken || rawToken === 'MY_FEEDICO_PARTNER_TOKEN' || rawToken === 'fdcp_YOUR_TOKEN') {
    return {
      enabled: true,
      partnerToken: '',
      tokenMode: 'partner',
      baseUrl: urlCheck.normalizedUrl,
      cacheTtlSeconds,
      postbackSecret,
      configured: false,
      tokenFormatValid: false,
      baseUrlValid: true,
      validationError:
        'FEEDICO_PARTNER_TOKEN is not configured. Provide a valid Feedico token starting with fdcp_ or fdco_.',
      errorCode: 'missing_partner_token',
    };
  }

  const tokenFormatValid = isPartnerToken || isCustomerToken;
  if (!tokenFormatValid) {
    return {
      enabled: true,
      partnerToken: rawToken,
      tokenMode: 'partner',
      baseUrl: urlCheck.normalizedUrl,
      cacheTtlSeconds,
      postbackSecret,
      configured: false,
      tokenFormatValid: false,
      baseUrlValid: true,
      validationError:
        'Invalid FEEDICO_PARTNER_TOKEN format. Feedico API tokens must start with "fdcp_" or "fdco_".',
      errorCode: 'invalid_partner_token_prefix',
    };
  }

  return {
    enabled: true,
    partnerToken: rawToken,
    tokenMode: isCustomerToken ? 'customer_catalog' : 'partner',
    baseUrl: isCustomerToken ? OFFICIAL_FEEDICO_CUSTOMER_BASE_URL : urlCheck.normalizedUrl,
    cacheTtlSeconds,
    postbackSecret,
    configured: true,
    tokenFormatValid: true,
    baseUrlValid: true,
    validationError: null,
    errorCode: 'none',
  };
}

/**
 * Extracts clean registrable/host domain from a URL or merchant string for matching.
 */
export function extractCleanDomain(urlOrDomain: string | null | undefined): string | null {
  if (!urlOrDomain) return null;
  const trimmed = urlOrDomain.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(withProto);
    const host = u.hostname.replace(/^www\./i, '');
    return host.includes('.') ? host : null;
  } catch {
    return null;
  }
}

/**
 * Normalizes a merchant name for deterministic matching (e.g. "Nike Store" -> "nike").
 */
export function normalizeMerchantToken(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\b(many\s+geos|official\s+store|online\s+store|store|shop|inc|llc|ltd|corp|co|com|global|us|uk|eu|de|fr|cz)\b/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Generates an opaque, deterministic, privacy-safe Feedico `sub` parameter for a Spark user ID.
 * Feedico Partner API rule:
 * "Up to 64 characters: letters, digits and _ - . : only. Values with @ are ignored.
 * Use an opaque id from your own database, never an e-mail address or a name."
 */
export function buildOpaqueUserSubId(userId: string): string {
  const cleanInput = (userId || 'anonymous').trim();
  const digest = crypto.createHash('sha256').update(`spark_feedico_sub:${cleanInput}`).digest('hex').slice(0, 24);
  const sub = `spk_u_${digest}`;
  return sub.slice(0, 64);
}

/**
 * Validates that a candidate `sub` ID strictly satisfies Feedico's sub-ID specification.
 */
export function isValidFeedicoSubId(subId: string): boolean {
  if (!subId || subId.length > 64) return false;
  if (subId.includes('@')) return false;
  return /^[A-Za-z0-9_\-.:]{1,64}$/.test(subId);
}

/**
 * Safely attaches an authenticated Spark user's opaque `sub` ID and optional same-domain product deep link (`url=`)
 * to a Feedico `goUrl` while preserving `p=`, `c=`, and `sku=` untouched as required by Feedico Partner API rules.
 */
export function buildUserTrackedGoUrl(params: {
  goUrl: string;
  userId?: string | null;
  merchantWebsiteUrl?: string | null;
  deepLinkProductUrl?: string | null;
}): string {
  const { goUrl, userId, merchantWebsiteUrl, deepLinkProductUrl } = params;
  if (!goUrl) return '';

  let parsedGo: URL;
  try {
    parsedGo = new URL(goUrl);
  } catch {
    return goUrl;
  }

  // Only modify official feedico.io /go/ links
  const host = parsedGo.hostname.toLowerCase();
  if (host !== 'feedico.io' && !host.endsWith('.feedico.io')) {
    return goUrl;
  }

  // 1. Preserve p, c, sku untouched. Add opaque sub parameter if userId provided
  if (userId && userId.trim()) {
    const subId = buildOpaqueUserSubId(userId.trim());
    if (isValidFeedicoSubId(subId)) {
      parsedGo.searchParams.set('sub', subId);
    }
  }

  // 2. Deep link rule from Feedico docs:
  // "Not needed for product links (sku=): they already open the product page."
  // "The page must be on the merchant's own website (the same domain as websiteUrl, any subdomain such as www)."
  if (deepLinkProductUrl && !parsedGo.searchParams.has('sku')) {
    const merchantDomain = extractCleanDomain(merchantWebsiteUrl);
    const targetDomain = extractCleanDomain(deepLinkProductUrl);
    if (
      merchantDomain &&
      targetDomain &&
      (targetDomain === merchantDomain || targetDomain.endsWith(`.${merchantDomain}`)) &&
      /^https?:\/\//i.test(deepLinkProductUrl.trim())
    ) {
      parsedGo.searchParams.set('url', deepLinkProductUrl.trim());
    }
  }

  return parsedGo.toString();
}

/**
 * Extracts explicit discount information and eligibility conditions from a Feedico coupon title
 * WITHOUT ever inventing numbers or terms not present in the source title.
 */
export function parseOfferDiscountAndConditionsFromTitle(
  title: string,
  defaultCurrency: 'USD' | 'EUR' | 'GBP' = 'USD'
): {
  discountType: 'percentage' | 'fixed' | 'promotional_deal';
  discountValue: number;
  currency: 'USD' | 'EUR' | 'GBP';
  minSpend: number;
  label: string;
  conditions: string[];
} {
  const text = (title || '').trim();
  const conditions: string[] = [];

  let detectedCurrency: 'USD' | 'EUR' | 'GBP' = defaultCurrency;
  if (text.includes('€') || /\bEUR\b/i.test(text)) detectedCurrency = 'EUR';
  else if (text.includes('£') || /\bGBP\b/i.test(text)) detectedCurrency = 'GBP';
  else if (text.includes('$') || /\bUSD\b/i.test(text)) detectedCurrency = 'USD';

  // Extract minimum spend if explicitly stated in title (e.g., "on orders over $100", "min spend $50")
  let minSpend = 0;
  const minSpendMatch = text.match(
    /(?:over|above|minimum(?:\s+spend|\s+order)?(?:\s+of)?|min\.?\s*(?:spend|order)?|orders\s+of)\s*[$€£]?\s*(\d+(?:\.\d+)?)/i
  );
  if (minSpendMatch) {
    minSpend = Number(minSpendMatch[1]);
    conditions.push(`Minimum order requirement stated in offer title: ${detectedCurrency} ${minSpend}`);
  }

  // Check for percentage discount (e.g., "15% off", "Save 20%")
  const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:off|discount|savings?|cashback)?/i);
  if (percentMatch) {
    const val = Number(percentMatch[1]);
    if (val > 0 && val <= 100) {
      return {
        discountType: 'percentage',
        discountValue: val,
        currency: detectedCurrency,
        minSpend,
        label: `${val}% Off`,
        conditions,
      };
    }
  }

  // Check for fixed currency discount (e.g., "$25 off", "€10 discount", "Save £15")
  const fixedMatch =
    text.match(/[$€£]\s*(\d+(?:\.\d+)?)\s*(?:off|discount|savings?)/i) ||
    text.match(/(?:save|get)\s*[$€£]\s*(\d+(?:\.\d+)?)/i);
  if (fixedMatch) {
    const val = Number(fixedMatch[1]);
    if (val > 0) {
      return {
        discountType: 'fixed',
        discountValue: val,
        currency: detectedCurrency,
        minSpend,
        label: `${detectedCurrency} ${val} Off`,
        conditions,
      };
    }
  }

  return {
    discountType: 'promotional_deal',
    discountValue: 0,
    currency: detectedCurrency,
    minSpend,
    label: text || 'Promotional Offer',
    conditions,
  };
}

/**
 * Normalizes a raw Feedico Partner API Coupon row into Spark's `FeedicoNormalizedOffer`
 * and `CouponItem` structures with strict expiration and code classification.
 */
export function normalizeFeedicoCoupon(
  row: FeedicoApiCouponRow,
  options: {
    nowMs?: number;
    defaultCurrency?: 'USD' | 'EUR' | 'GBP';
    syncedAt?: string;
    cacheTtlSeconds?: number;
    userId?: string | null;
    linkVerifiedActive?: boolean | null;
  } = {}
): { normalized: FeedicoNormalizedOffer; couponItem: CouponItem } {
  const nowMs = options.nowMs ?? Date.now();
  const syncedAt = options.syncedAt ?? new Date(nowMs).toISOString();
  const defaultCurrency = options.defaultCurrency ?? 'USD';
  const ttlMs = (options.cacheTtlSeconds ?? 300) * 1000;

  const rawCode = typeof row.code === 'string' ? row.code.trim() : '';
  const hasCode = rawCode.length > 0;

  const endsAtRaw = row.endsAt ? String(row.endsAt).trim() : null;
  const endsAtMs = endsAtRaw ? Date.parse(endsAtRaw) : Number.NaN;
  const isExpired = !Number.isNaN(endsAtMs) && endsAtMs <= nowMs;

  let verificationStatus: FeedicoOfferClassification;
  if (isExpired) {
    verificationStatus = 'expired';
  } else if (options.linkVerifiedActive === false) {
    verificationStatus = 'unverified';
  } else if (!hasCode) {
    verificationStatus = 'no_code_deal';
  } else {
    verificationStatus = 'verified_active';
  }

  const combinedTextForDiscount = [row.title, row.description].filter(Boolean).join(' ');
  const parsedDiscount = parseOfferDiscountAndConditionsFromTitle(combinedTextForDiscount, defaultCurrency);
  const targetCountries = Array.isArray(row.countries)
    ? row.countries.map((c) => String(c).toUpperCase().trim()).filter(Boolean)
    : [];

  const eligibilityConditions: string[] = [...parsedDiscount.conditions];
  if (targetCountries.length === 0) {
    eligibilityConditions.push(
      'Country targeting not specified by affiliate network — merchant checkout terms decide final eligibility.'
    );
  } else if (targetCountries.includes('WW')) {
    eligibilityConditions.push('Targeted worldwide (WW) — subject to merchant checkout terms.');
  } else {
    eligibilityConditions.push(`Targeted countries: ${targetCountries.join(', ')}.`);
  }

  if (endsAtRaw) {
    eligibilityConditions.push(
      isExpired ? `Expired on ${endsAtRaw}.` : `Valid until ${endsAtRaw}.`
    );
  } else {
    eligibilityConditions.push('No fixed expiration date reported by network.');
  }

  if (!hasCode) {
    eligibilityConditions.push('No coupon code required — promotional offer activates via tracked link.');
  } else {
    eligibilityConditions.push(
      'Active coupon in Feedico Partner catalog; final applicability at checkout is governed by the merchant.'
    );
  }

  const trackedUrl = buildUserTrackedGoUrl({
    goUrl: row.goUrl || row.websiteUrl || '',
    userId: options.userId,
    merchantWebsiteUrl: row.websiteUrl,
  });

  const syncedMs = Date.parse(syncedAt);
  const isStale = !Number.isNaN(syncedMs) && nowMs - syncedMs > ttlMs;
  const startsAtRaw = row.startsAt ? String(row.startsAt).trim() : null;

  const normalized: FeedicoNormalizedOffer = {
    feedico_offer_id: String(row.id),
    merchant_id: String(row.goSlug),
    merchant_name: row.merchantName || `Merchant ${row.goSlug}`,
    coupon_code: hasCode ? rawCode : null,
    title: row.title || (hasCode ? `Code ${rawCode}` : 'Merchant Promotional Offer'),
    description: row.description || row.title || 'Promotional offer via Feedico Partner API',
    discount: {
      type: parsedDiscount.discountType,
      value: parsedDiscount.discountValue,
      currency: parsedDiscount.currency,
      label: parsedDiscount.label,
    },
    start_date: startsAtRaw,
    expiration_date: endsAtRaw,
    target_countries: targetCountries,
    eligibility_conditions: eligibilityConditions,
    original_source: 'feedico_partner_api',
    provider: row.provider || 'feedico',
    website_url: row.websiteUrl || null,
    tracked_url: trackedUrl,
    cashback_allowed: row.cashbackAllowed ?? 'unknown',
    commission: row.commission ?? null,
    last_synced_at: syncedAt,
    verification_status: verificationStatus,
    is_stale: isStale,
  };

  const couponItem: CouponItem = {
    id: `feedico_${row.id}`,
    code: hasCode ? rawCode : 'NO_CODE_NEEDED',
    merchant: normalized.merchant_name,
    sourceId: 'feedico_partner_api',
    sourceUrl: trackedUrl || row.websiteUrl || OFFICIAL_FEEDICO_PARTNER_BASE_URL,
    retrievedAt: syncedAt,
    description: normalized.title,
    discountType: parsedDiscount.discountType,
    discountValue: parsedDiscount.discountValue,
    minSpend: parsedDiscount.minSpend,
    currency: parsedDiscount.currency,
    verificationStatus:
      verificationStatus === 'verified_active' && parsedDiscount.discountValue > 0
        ? 'verified'
        : 'coupon_validity_unknown',
    terms: eligibilityConditions.join(' '),
    feedicoOfferId: normalized.feedico_offer_id,
    merchantId: normalized.merchant_id,
    merchantName: normalized.merchant_name,
    title: normalized.title,
    offerClassification: verificationStatus,
    startDate: startsAtRaw,
    expirationDate: endsAtRaw,
    targetCountries,
    eligibilityConditions,
    originalSource: 'Feedico Partner API',
    provider: normalized.provider,
    websiteUrl: normalized.website_url,
    trackedUrl,
    lastSyncedAt: syncedAt,
    isStale,
    cashbackAllowed: normalized.cashback_allowed,
  };

  return { normalized, couponItem };
}

/**
 * Normalizes a raw Feedico API product row (`FeedicoApiProductRow`) into Spark's `ProductOffer` schema.
 * Never fabricates prices, availability, or ratings.
 */
export function normalizeFeedicoProduct(
  row: FeedicoApiProductRow,
  options?: { userId?: string | null; nowMs?: number }
): ProductOffer {
  const nowMs = options?.nowMs ?? Date.now();
  const syncedAt = new Date(nowMs).toISOString();
  const effectivePriceRaw =
    typeof row.salePrice === 'number' && Number.isFinite(row.salePrice) && row.salePrice > 0
      ? row.salePrice
      : typeof row.price === 'number' && Number.isFinite(row.price) && row.price > 0
      ? row.price
      : null;

  const rawCurr = (row.currency || 'USD').trim().toUpperCase();
  const currency: 'USD' | 'EUR' | 'GBP' =
    rawCurr === 'EUR' || rawCurr === 'GBP' ? rawCurr : 'USD';

  const trackedUrl = buildUserTrackedGoUrl({
    goUrl: row.goUrl,
    userId: options?.userId ?? null,
    merchantWebsiteUrl: row.merchantDomain ? `https://${row.merchantDomain}` : null,
  });

  const primaryImage =
    row.thumbnailUrl ||
    row.images?.find((img) => img.isPrimary)?.url ||
    row.images?.[0]?.url ||
    null;

  const availLower = (row.availability || '').toLowerCase();
  const availabilityStatus: ProductOffer['availabilityStatus'] =
    availLower === 'in_stock' || availLower === 'instock' || availLower === 'available'
      ? 'verified_in_stock'
      : availLower === 'out_of_stock' || availLower === 'outofstock' || availLower === 'unavailable'
      ? 'verified_out_of_stock'
      : 'unknown';

  const specs: Record<string, string> = {};
  if (row.brand) specs.Brand = row.brand;
  if (row.sku) specs.SKU = row.sku;
  if (row.gtin) specs.GTIN = row.gtin;
  if (row.provider) specs.Network = row.provider;
  if (typeof row.discountPercentage === 'number' && row.discountPercentage > 0) {
    specs.Discount = `${row.discountPercentage}% off`;
  }

  return {
    id: `feedico_prod_${row.id}`,
    sourceId: 'feedico_partner_api',
    sourceName: 'Feedico Partner Catalog API',
    canonicalUrl: trackedUrl || (row.merchantDomain ? `https://${row.merchantDomain}` : OFFICIAL_FEEDICO_PARTNER_BASE_URL),
    retrievedAt: row.fetchedAt || syncedAt,
    verificationStatus: effectivePriceRaw !== null ? 'verified_live_source' : 'partial_fields_unverified',
    name: (row.title || row.brand || `Product ${row.id}`).trim(),
    merchant: (row.firmName || row.brand || row.merchantDomain || 'Feedico Partner Store').trim(),
    category: row.brand || 'Retail Catalog',
    price: effectivePriceRaw,
    priceStatus: effectivePriceRaw !== null ? 'verified' : 'price_could_not_be_verified',
    currency,
    shippingCost: null,
    shippingStatus: 'unknown',
    estimatedTaxRate: null,
    taxStatus: 'unknown',
    availabilityStatus,
    rating: null,
    reviewCount: null,
    summary:
      (row.description || `${row.title || 'Catalog item'} from ${row.firmName || 'verified merchant'} via Feedico Partner API.`).slice(
        0,
        280
      ),
    specs,
    couponStatus: 'coupon_validity_unknown',
    checkoutStatus: effectivePriceRaw !== null ? 'supported_paypal' : 'checkout_unsupported',
    imageUrl: primaryImage,
  };
}

/**
 * Extracts `goSlug` and `partnerPublicId` (`p`) from a Feedico `/go/` URL when present.
 */
function parseFeedicoGoUrlMetadata(goUrl?: string | null, fallbackId?: string): {
  goSlug: string;
  partnerPublicId: string | null;
} {
  if (goUrl) {
    try {
      const parsed = new URL(goUrl);
      const match = parsed.pathname.match(/\/go\/([^/?#]+)/i);
      const slug = match?.[1] ? decodeURIComponent(match[1]) : fallbackId || 'store';
      const p = parsed.searchParams.get('p') || parsed.searchParams.get('a') || null;
      return { goSlug: slug, partnerPublicId: p };
    } catch {
      // Fall through
    }
  }
  const cleanFallback = (fallbackId || 'store')
    .toLowerCase()
    .replace(/[^a-z0-9_\-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return { goSlug: cleanFallback || 'store', partnerPublicId: null };
}

/**
 * Checks if a normalized Feedico offer is eligible for a target ISO country code.
 * Per Feedico Partner API docs:
 * - `["WW"]` means worldwide (matches any country).
 * - `[]` means the network gives no country info (allowed with disclosure).
 * - Otherwise, must include the target uppercase ISO country code (e.g. `US`, `DE`, `GB`).
 */
export function isOfferEligibleForCountry(
  offer: Pick<FeedicoNormalizedOffer, 'target_countries'>,
  targetCountry?: string | null
): { eligible: boolean; matchType: 'exact_country' | 'worldwide' | 'unspecified' | 'country_mismatch' } {
  if (!targetCountry || !targetCountry.trim()) {
    return {
      eligible: true,
      matchType: offer.target_countries.includes('WW')
        ? 'worldwide'
        : offer.target_countries.length === 0
        ? 'unspecified'
        : 'exact_country',
    };
  }

  const cleanTarget = targetCountry.trim().toUpperCase();
  if (cleanTarget === 'WW') {
    return {
      eligible: offer.target_countries.includes('WW') || offer.target_countries.length === 0,
      matchType: offer.target_countries.includes('WW') ? 'worldwide' : 'country_mismatch',
    };
  }

  if (offer.target_countries.includes(cleanTarget)) {
    return { eligible: true, matchType: 'exact_country' };
  }
  if (offer.target_countries.includes('WW')) {
    return { eligible: true, matchType: 'worldwide' };
  }
  if (offer.target_countries.length === 0 || offer.target_countries.includes('XX')) {
    return { eligible: true, matchType: 'unspecified' };
  }

  return { eligible: false, matchType: 'country_mismatch' };
}

/**
 * Matches and ranks Feedico offers for a specific product and optional target country.
 * Evaluates merchant domain/name match, country eligibility, expiration status, and actual savings.
 */
export function matchAndRankOffersForProduct(
  product: Pick<ProductOffer, 'name' | 'merchant' | 'canonicalUrl' | 'price' | 'priceStatus' | 'currency'>,
  offers: FeedicoNormalizedOffer[],
  options: {
    targetCountry?: string | null;
    includeExpired?: boolean;
    nowMs?: number;
  } = {}
): FeedicoNormalizedOffer[] {
  const nowMs = options.nowMs ?? Date.now();
  const productDomain = extractCleanDomain(product.canonicalUrl);
  const productMerchantNorm = normalizeMerchantToken(product.merchant);
  const productWords = normalizeMerchantToken(product.name)
    .split(/\s+/)
    .filter((w) => w.length >= 3);

  const scored: FeedicoNormalizedOffer[] = [];

  for (const offer of offers) {
    const expMs = offer.expiration_date ? Date.parse(offer.expiration_date) : Number.NaN;
    const isExpired =
      offer.verification_status === 'expired' || (!Number.isNaN(expMs) && expMs <= nowMs);

    if (isExpired && !options.includeExpired) {
      continue;
    }

    const countryCheck = isOfferEligibleForCountry(offer, options.targetCountry);
    if (!countryCheck.eligible) {
      continue;
    }

    const offerDomain = extractCleanDomain(offer.website_url);
    const offerMerchantNorm = normalizeMerchantToken(offer.merchant_name);

    let merchantMatchScore = 0;
    let matchReason = '';

    if (productDomain && offerDomain && (productDomain === offerDomain || productDomain.endsWith(`.${offerDomain}`) || offerDomain.endsWith(`.${productDomain}`))) {
      merchantMatchScore = 50;
      matchReason = `Exact merchant domain match (${offerDomain})`;
    } else if (
      productMerchantNorm &&
      offerMerchantNorm &&
      (productMerchantNorm === offerMerchantNorm ||
        productMerchantNorm.includes(offerMerchantNorm) ||
        offerMerchantNorm.includes(productMerchantNorm))
    ) {
      merchantMatchScore = 40;
      matchReason = `Merchant name match (${offer.merchant_name})`;
    } else if (
      offerMerchantNorm &&
      productWords.some((w) => offerMerchantNorm.split(/\s+/).includes(w))
    ) {
      merchantMatchScore = 25;
      matchReason = `Brand/product keyword match (${offer.merchant_name})`;
    } else {
      // Does not match this product's merchant or brand
      continue;
    }

    // Calculate estimated discount relevance score
    let discountScore = 0;
    const basePrice = product.price !== null && product.priceStatus === 'verified' ? product.price : 100;
    if (offer.discount.type === 'percentage' && offer.discount.value > 0) {
      const savings = (basePrice * offer.discount.value) / 100;
      discountScore = Math.min(30, Math.round(savings / 2) + Math.round(offer.discount.value / 2));
    } else if (offer.discount.type === 'fixed' && offer.discount.value > 0) {
      discountScore = Math.min(30, Math.round(offer.discount.value));
    } else {
      discountScore = 5;
    }

    const statusScore =
      isExpired
        ? -100
        : offer.verification_status === 'verified_active'
        ? 25
        : offer.verification_status === 'no_code_deal'
        ? 15
        : 5;

    const countryScore =
      countryCheck.matchType === 'exact_country'
        ? 10
        : countryCheck.matchType === 'worldwide'
        ? 8
        : 3;

    const relevanceScore = merchantMatchScore + discountScore + statusScore + countryScore;

    scored.push({
      ...offer,
      verification_status: isExpired ? 'expired' : offer.verification_status,
      relevance_score: relevanceScore,
      match_reason: `${matchReason} · ${
        countryCheck.matchType === 'exact_country'
          ? `Country match (${options.targetCountry?.toUpperCase()})`
          : countryCheck.matchType === 'worldwide'
          ? 'Worldwide offer'
          : 'Network country unspecified'
      }`,
    });
  }

  return scored.sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0));
}

/**
 * Verifies Feedico Commission Postback HMAC-SHA256 signature (`X-Feedico-Signature: t=<unix>,v1=<hex>`)
 * in constant time and rejects replays older than 5 minutes (300 seconds).
 */
export function verifyFeedicoPostbackSignature(
  rawBody: string,
  signatureHeader: string | undefined | null,
  secret: string,
  nowUnixSeconds: number = Math.floor(Date.now() / 1000)
): { verified: boolean; reason?: string } {
  if (!secret || !secret.trim()) {
    return { verified: false, reason: 'FEEDICO_POSTBACK_SECRET is not configured.' };
  }
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    return { verified: false, reason: 'Missing X-Feedico-Signature header.' };
  }

  const parts: Record<string, string> = {};
  for (const segment of signatureHeader.split(',')) {
    const [k, v] = segment.trim().split('=');
    if (k && v) parts[k.trim()] = v.trim();
  }

  const timestamp = Number(parts.t);
  const v1Hex = parts.v1 || '';

  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return { verified: false, reason: 'Invalid timestamp in X-Feedico-Signature.' };
  }
  if (Math.abs(nowUnixSeconds - timestamp) > 300) {
    return { verified: false, reason: 'Signature timestamp expired (> 300s replay window).' };
  }
  if (!/^[a-fA-F0-9]{64}$/.test(v1Hex)) {
    return { verified: false, reason: 'Invalid v1 HMAC hex digest in X-Feedico-Signature.' };
  }

  const expectedHex = crypto
    .createHmac('sha256', secret.trim())
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  const gotBuf = Buffer.from(v1Hex, 'hex');
  const wantBuf = Buffer.from(expectedHex, 'hex');
  if (gotBuf.length !== wantBuf.length || !crypto.timingSafeEqual(gotBuf, wantBuf)) {
    return { verified: false, reason: 'HMAC-SHA256 signature mismatch.' };
  }

  return { verified: true };
}

/**
 * Modular Coupon Provider Interface for Spark
 */
export interface CouponProviderAdapter {
  readonly providerId: string;
  readonly providerName: string;
  getStatus(): FeedicoStatusResponse;
  searchCoupons(
    params: FeedicoCouponSearchParams,
    context?: { userId?: string | null }
  ): Promise<{
    offers: FeedicoNormalizedOffer[];
    coupons: CouponItem[];
    meta: FeedicoApiMeta;
    fromCache: boolean;
    partnerPublicId: string | null;
  }>;
  searchMerchants(params: FeedicoMerchantSearchParams): Promise<{
    merchants: FeedicoMerchantRecord[];
    meta: FeedicoApiMeta;
    fromCache: boolean;
    partnerPublicId: string | null;
  }>;
}

interface CacheEntry<T> {
  data: T;
  syncedAt: string;
  syncedAtMs: number;
  expiresAtMs: number;
}

export interface FeedicoPartnerServiceOptions {
  fetchFn?: typeof fetch;
  envOverrides?: Partial<Record<string, string | undefined>>;
  timeoutMs?: number;
  maxRetries?: number;
  nowFn?: () => number;
}

/**
 * Dedicated Feedico API Service, Normalized Database Repository, Cache Manager,
 * and Affiliate Click Attribution Tracker.
 */
export class FeedicoPartnerService implements CouponProviderAdapter {
  public readonly providerId = 'feedico_partner_api';
  public readonly providerName = 'Feedico Partner API';

  private readonly fetchFn: typeof fetch;
  private envOverrides?: Partial<Record<string, string | undefined>>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly nowFn: () => number;

  // Normalized offer & merchant persistence stores (deduplicated by ID)
  private readonly offersById = new Map<string, FeedicoNormalizedOffer>();
  private readonly merchantsBySlug = new Map<string, FeedicoMerchantRecord>();
  private readonly queryCache = new Map<string, CacheEntry<unknown>>();
  private readonly clicksById = new Map<string, FeedicoAffiliateClickRecord>();
  private readonly processedPostbackEventIds = new Set<string>();

  private partnerPublicId: string | null = null;
  private lastSyncAt: string | null = null;
  private lastVerifiedAt: string | null = null;
  private lastError: string | null = null;
  private lastErrorCode: string | null = null;
  private lastTokenDigest: string | null = null;

  constructor(options: FeedicoPartnerServiceOptions = {}) {
    this.fetchFn = options.fetchFn || globalThis.fetch.bind(globalThis);
    this.envOverrides = options.envOverrides;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.maxRetries = options.maxRetries ?? 2;
    this.nowFn = options.nowFn || (() => Date.now());
  }

  private syncCredentialRotation(cfg: FeedicoConfig): void {
    const currentDigest = cfg.partnerToken
      ? crypto.createHash('sha256').update(cfg.partnerToken).digest('hex').slice(0, 16)
      : 'empty';
    if (this.lastTokenDigest !== null && this.lastTokenDigest !== currentDigest) {
      this.lastVerifiedAt = null;
      this.lastError = null;
      this.lastErrorCode = null;
      this.partnerPublicId = null;
      this.queryCache.clear();
    }
    this.lastTokenDigest = currentDigest;
  }

  public setEnvOverrides(overrides?: Partial<Record<string, string | undefined>>): void {
    this.envOverrides = overrides;
    this.syncCredentialRotation(getFeedicoConfig(this.envOverrides));
  }

  public getConfig(): FeedicoConfig {
    const cfg = getFeedicoConfig(this.envOverrides);
    this.syncCredentialRotation(cfg);
    return cfg;
  }

  public getStatus(): FeedicoStatusResponse {
    const cfg = this.getConfig();
    const nowMs = this.nowFn();
    const ttlMs = cfg.cacheTtlSeconds * 1000;

    let staleOffersCount = 0;
    for (const offer of this.offersById.values()) {
      const syncedMs = Date.parse(offer.last_synced_at);
      if (!Number.isNaN(syncedMs) && nowMs - syncedMs > ttlMs) {
        staleOffersCount++;
      }
    }

    let integrationState: FeedicoIntegrationState = 'CONFIGURED_BUT_UNVERIFIED';
    let statusMessage =
      'Feedico API token is configured (awaiting first live API verification).';
    let accountApprovalRequired = false;

    if (!cfg.enabled || cfg.errorCode === 'missing_partner_token') {
      integrationState = 'MISSING_CONFIGURATION';
      statusMessage = !cfg.enabled
        ? 'Feedico integration is disabled (FEEDICO_ENABLED=false).'
        : cfg.validationError ||
          'FEEDICO_PARTNER_TOKEN is not configured. Provide a valid Feedico token starting with fdcp_ or fdco_.';
      accountApprovalRequired = cfg.errorCode === 'missing_partner_token';
    } else if (!cfg.configured) {
      integrationState = 'INVALID_CREDENTIALS';
      statusMessage =
        cfg.validationError ||
        'Invalid FEEDICO_PARTNER_TOKEN format. Feedico API tokens must start with "fdcp_" or "fdco_".';
      accountApprovalRequired = cfg.errorCode === 'invalid_partner_token_prefix';
    } else if (
      this.lastErrorCode === 'unauthorized_partner_token' ||
      this.lastErrorCode === 'forbidden_partner_token'
    ) {
      integrationState = 'INVALID_CREDENTIALS';
      statusMessage = `Feedico authentication rejected (${this.lastErrorCode}): ${this.lastError}`;
      accountApprovalRequired = true;
    } else if (this.lastErrorCode === 'rate_limited') {
      integrationState = 'RATE_LIMITED';
      statusMessage = `Feedico API rate limited: ${this.lastError}`;
    } else if (this.lastError || this.lastErrorCode) {
      integrationState = 'PROVIDER_UNAVAILABLE';
      statusMessage = `Feedico API unavailable (${this.lastErrorCode || 'upstream_error'}): ${this.lastError}`;
    } else if (this.lastVerifiedAt) {
      integrationState = 'CONFIGURED_AND_VERIFIED';
      statusMessage = `Feedico Partner API is configured and verified against live catalog (${cfg.baseUrl}).`;
    }

    return {
      enabled: cfg.enabled,
      configured: cfg.configured,
      tokenFormatValid: cfg.tokenFormatValid,
      integrationState,
      apiType: 'feedico_partner_api',
      baseUrl: cfg.baseUrl,
      cacheTtlSeconds: cfg.cacheTtlSeconds,
      partnerPublicId: this.partnerPublicId,
      statusMessage,
      accountApprovalRequired,
      cachedOffersCount: this.offersById.size,
      cachedMerchantsCount: this.merchantsBySlug.size,
      staleOffersCount,
      recordedClicksCount: this.clicksById.size,
      lastSyncAt: this.lastSyncAt,
      lastVerifiedAt: this.lastVerifiedAt,
      lastError: this.lastError,
      lastErrorCode: this.lastErrorCode,
    };
  }

  /**
   * Executes an authenticated HTTP request to the allowlisted Feedico API.
   */
  private async requestFeedico<T>(
    method: 'GET' | 'POST',
    endpointPath: string,
    bodyOrQuery?: Record<string, unknown>
  ): Promise<T> {
    const cfg = this.getConfig();
    if (!cfg.baseUrlValid) {
      this.lastErrorCode = cfg.errorCode;
      this.lastError = cfg.validationError || 'Invalid FEEDICO_API_BASE_URL';
      throw new FeedicoServiceError(
        this.lastError,
        400,
        cfg.errorCode
      );
    }
    if (!cfg.enabled) {
      this.lastErrorCode = 'feedico_disabled';
      this.lastError = 'Feedico integration is disabled via FEEDICO_ENABLED=false.';
      throw new FeedicoServiceError(
        this.lastError,
        503,
        'feedico_disabled'
      );
    }
    if (!cfg.configured) {
      this.lastErrorCode = cfg.errorCode;
      this.lastError = cfg.validationError || 'FEEDICO_PARTNER_TOKEN is not configured.';
      throw new FeedicoServiceError(
        this.lastError,
        503,
        cfg.errorCode
      );
    }

    if (!endpointPath.startsWith('/api/')) {
      throw new FeedicoServiceError(
        `Invalid Feedico API path "${endpointPath}".`,
        400,
        'invalid_endpoint_path'
      );
    }

    const urlObj = new URL(endpointPath, cfg.baseUrl);
    const host = urlObj.hostname.toLowerCase();
    const isAllowedHost =
      ALLOWED_FEEDICO_PARTNER_HOSTS.has(host) ||
      (cfg.tokenMode === 'customer_catalog' && ALLOWED_FEEDICO_CUSTOMER_HOSTS.has(host));

    if (!isAllowedHost || urlObj.protocol !== 'https:') {
      throw new FeedicoServiceError(
        'SSRF protection blocked outbound request to non-allowlisted host.',
        400,
        'ssrf_blocked_untrusted_host'
      );
    }

    if (method === 'GET' && bodyOrQuery) {
      for (const [k, v] of Object.entries(bodyOrQuery)) {
        if (v !== undefined && v !== null && v !== '') {
          urlObj.searchParams.set(k, String(v));
        }
      }
    }

    let attempt = 0;
    while (true) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchFn(urlObj.toString(), {
          method,
          headers: {
            Authorization: `Bearer ${cfg.partnerToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: method === 'POST' ? JSON.stringify(bodyOrQuery || {}) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (response.status === 401) {
          this.lastErrorCode = 'unauthorized_partner_token';
          this.lastError = 'Feedico API returned 401 Unauthorized (invalid or revoked token).';
          throw new FeedicoServiceError(
            this.lastError,
            401,
            'unauthorized_partner_token'
          );
        }

        if (response.status === 403) {
          this.lastErrorCode = 'forbidden_partner_token';
          this.lastError =
            'Feedico API returned 403 Forbidden (partner token expired, revoked, or lacks catalog scope).';
          throw new FeedicoServiceError(
            this.lastError,
            403,
            'forbidden_partner_token'
          );
        }

        if (response.status === 429) {
          const retryAfterHeader = response.headers?.get?.('Retry-After');
          const retrySeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : 1;
          if (attempt < this.maxRetries) {
            attempt++;
            await new Promise((r) => setTimeout(r, Math.min(500, (retrySeconds || 1) * 150)));
            continue;
          }
          this.lastErrorCode = 'rate_limited';
          this.lastError = 'Feedico API rate limit reached (HTTP 429).';
          throw new FeedicoServiceError(
            this.lastError,
            429,
            'rate_limited',
            Number.isFinite(retrySeconds) ? retrySeconds : undefined
          );
        }

        if (response.status === 503) {
          this.lastErrorCode = 'query_timeout';
          this.lastError =
            'Feedico API returned 503 query_timeout (narrow filters or retry later).';
          throw new FeedicoServiceError(this.lastError, 503, 'query_timeout');
        }

        if (response.status === 404) {
          throw new FeedicoServiceError(
            'Requested merchant or resource was not found on Feedico API.',
            404,
            'merchant_not_found'
          );
        }

        if (!response.ok) {
          if ((response.status === 502 || response.status === 504) && attempt < this.maxRetries) {
            attempt++;
            await new Promise((r) => setTimeout(r, 120 * attempt));
            continue;
          }
          this.lastErrorCode = `upstream_http_${response.status}`;
          this.lastError = `Feedico API returned HTTP ${response.status}.`;
          throw new FeedicoServiceError(
            this.lastError,
            response.status,
            this.lastErrorCode
          );
        }

        const rawText = await response.text();
        let parsedJson: unknown;
        try {
          parsedJson = rawText ? JSON.parse(rawText) : null;
        } catch {
          this.lastErrorCode = 'malformed_api_response';
          this.lastError = 'Feedico API returned a malformed non-JSON payload.';
          throw new FeedicoServiceError(
            this.lastError,
            502,
            'malformed_api_response'
          );
        }

        if (!parsedJson || typeof parsedJson !== 'object' || Array.isArray(parsedJson)) {
          this.lastErrorCode = 'malformed_api_response';
          this.lastError = 'Feedico API returned an unexpected payload structure (expected JSON object).';
          throw new FeedicoServiceError(
            this.lastError,
            502,
            'malformed_api_response'
          );
        }

        const nowIso = new Date(this.nowFn()).toISOString();
        this.lastError = null;
        this.lastErrorCode = null;
        this.lastSyncAt = nowIso;
        this.lastVerifiedAt = nowIso;
        return parsedJson as T;
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof FeedicoServiceError) {
          throw err;
        }
        const isAbort = (err as Error)?.name === 'AbortError';
        if (attempt < this.maxRetries) {
          attempt++;
          await new Promise((r) => setTimeout(r, 120 * attempt));
          continue;
        }
        const errorCode = isAbort ? 'request_timeout' : 'network_failure';
        const msg = isAbort
          ? `Feedico API request timed out after ${this.timeoutMs}ms.`
          : `Network failure communicating with Feedico API: ${redactFeedicoSecrets(
              (err as Error)?.message || 'Unknown error'
            )}`;
        this.lastErrorCode = errorCode;
        this.lastError = msg;
        throw new FeedicoServiceError(msg, 503, errorCode);
      }
    }
  }

  /**
   * Searches active coupons from Feedico (`POST /api/catalog/coupons` or `POST /api/v1/catalog/coupons`)
   * with caching, pagination, country filtering, deduplication by `id`, and normalization.
   */
  public async searchCoupons(
    params: FeedicoCouponSearchParams = {},
    context: { userId?: string | null } = {}
  ): Promise<{
    offers: FeedicoNormalizedOffer[];
    coupons: CouponItem[];
    meta: FeedicoApiMeta;
    fromCache: boolean;
    partnerPublicId: string | null;
  }> {
    const cfg = this.getConfig();
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Math.floor(params.pageSize ?? 48)));
    const maxPages = Math.min(5, Math.max(1, Math.floor(params.maxPages ?? 1)));

    const cleanCountries = Array.isArray(params.countries)
      ? params.countries.map((c) => c.trim().toUpperCase()).filter(Boolean)
      : typeof params.countries === 'string' && params.countries.trim()
      ? params.countries
          .split(',')
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean)
      : undefined;

    if (params.provider && !VALID_FEEDICO_PROVIDERS.has(params.provider)) {
      throw new FeedicoServiceError(
        `Invalid provider "${params.provider}". Allowed: ${Array.from(VALID_FEEDICO_PROVIDERS).join(', ')}.`,
        400,
        'invalid_provider'
      );
    }

    const cacheKey = JSON.stringify({
      op: 'coupons',
      mode: cfg.tokenMode || 'partner',
      q: params.q?.trim().toLowerCase() || '',
      merchant: params.merchant?.trim() || '',
      provider: params.provider || '',
      countries: cleanCountries || [],
      endingWithinDays: params.endingWithinDays || null,
      sort: params.sort || 'newest',
      cashback: params.cashback || '',
      page,
      pageSize,
      maxPages,
    });

    const nowMs = this.nowFn();
    const cached = this.queryCache.get(cacheKey) as
      | CacheEntry<{
          rawRows: FeedicoApiCouponRow[];
          meta: FeedicoApiMeta;
          partnerPublicId: string | null;
        }>
      | undefined;

    if (!params.bypassCache && cached && cached.expiresAtMs > nowMs) {
      const normalizedList = this.normalizeAndDeduplicateCouponRows(cached.data.rawRows, {
        nowMs,
        syncedAt: cached.syncedAt,
        cacheTtlSeconds: cfg.cacheTtlSeconds,
        userId: context.userId,
      });
      return {
        offers: normalizedList.offers,
        coupons: normalizedList.coupons,
        meta: cached.data.meta,
        fromCache: true,
        partnerPublicId: cached.data.partnerPublicId,
      };
    }

    const collectedRows: FeedicoApiCouponRow[] = [];
    const seenIds = new Set<string>();
    let currentPage = page;
    let pagesFetched = 0;
    let lastMeta: FeedicoApiMeta = { total: 0, limit: pageSize, offset: 0, hasMore: false };
    let partnerPublicId: string | null = this.partnerPublicId;

    while (pagesFetched < maxPages) {
      if (cfg.tokenMode === 'customer_catalog') {
        const payload: Record<string, unknown> = {
          page: currentPage,
          pageSize,
        };
        const knownMerchant = params.merchant ? this.merchantsBySlug.get(params.merchant.trim()) : undefined;
        const firmFilter = knownMerchant?.name || params.merchant?.trim();
        if (firmFilter) payload.firmName = firmFilter;
        if (params.q && params.q.trim()) payload.q = params.q.trim();
        if (params.provider) payload.provider = params.provider;

        const resp = await this.requestFeedico<{
          ok?: boolean;
          recordCount?: number;
          page?: number;
          pageSize?: number;
          coupons?: Array<{
            id: string;
            brandName?: string;
            networkName?: string;
            provider?: string;
            code?: string | null;
            offerType?: string | null;
            countries?: string[] | null;
            title?: string | null;
            description?: string | null;
            startsAt?: string | null;
            endsAt?: string | null;
            merchantWebsiteUrl?: string | null;
            offerUrl?: string | null;
            goUrl?: string | null;
          }>;
        }>('POST', '/api/v1/catalog/coupons', payload);

        const rawPageRows = Array.isArray(resp.coupons) ? resp.coupons : [];
        for (const r of rawPageRows) {
          if (!r || !r.id) continue;
          const rowId = String(r.id);
          if (seenIds.has(rowId)) continue;

          const mName = r.brandName || r.networkName || 'Merchant';
          const rawGoUrl = r.goUrl || r.offerUrl || r.merchantWebsiteUrl || '';
          const parsedMeta = parseFeedicoGoUrlMetadata(r.goUrl, mName);
          if (parsedMeta.partnerPublicId && !partnerPublicId) {
            partnerPublicId = parsedMeta.partnerPublicId;
            this.partnerPublicId = parsedMeta.partnerPublicId;
          }

          const mappedRow: FeedicoApiCouponRow = {
            id: rowId,
            goSlug: parsedMeta.goSlug,
            merchantName: mName,
            provider: r.provider || 'feedico',
            code: r.code ? String(r.code).trim() : '',
            title: r.title || r.description || (r.code ? `Code ${r.code}` : mName),
            description: r.description ?? null,
            startsAt: r.startsAt ?? null,
            endsAt: r.endsAt ?? null,
            websiteUrl: r.merchantWebsiteUrl ?? null,
            countries: Array.isArray(r.countries) ? r.countries : [],
            goUrl: rawGoUrl,
            cashbackAllowed: 'yes',
          };

          // Country filter check when specified
          if (cleanCountries && cleanCountries.length > 0) {
            const eligible = cleanCountries.some(
              (cc) =>
                isOfferEligibleForCountry({ target_countries: mappedRow.countries }, cc).eligible
            );
            if (!eligible) continue;
          }

          // Ending within days filter check when specified
          if (typeof params.endingWithinDays === 'number' && params.endingWithinDays >= 1) {
            if (!mappedRow.endsAt) continue;
            const endsMs = Date.parse(mappedRow.endsAt);
            if (Number.isNaN(endsMs) || endsMs <= nowMs || endsMs > nowMs + params.endingWithinDays * 86400_000) {
              continue;
            }
          }

          seenIds.add(rowId);
          collectedRows.push(mappedRow);
        }

        const totalRecords = typeof resp.recordCount === 'number' ? resp.recordCount : collectedRows.length;
        const offset = (currentPage - 1) * pageSize;
        lastMeta = {
          total: totalRecords,
          limit: pageSize,
          offset,
          hasMore: offset + rawPageRows.length < totalRecords && rawPageRows.length > 0,
        };

        pagesFetched++;
        if (!lastMeta.hasMore || rawPageRows.length === 0) {
          break;
        }
        currentPage++;
      } else {
        const payload: Record<string, unknown> = {
          page: currentPage,
          pageSize,
        };
        if (params.q && params.q.trim()) payload.q = params.q.trim();
        if (params.merchant && params.merchant.trim()) payload.merchant = params.merchant.trim();
        if (params.provider) payload.provider = params.provider;
        if (cleanCountries && cleanCountries.length > 0) payload.countries = cleanCountries;
        if (typeof params.endingWithinDays === 'number' && params.endingWithinDays >= 1) {
          payload.endingWithinDays = Math.floor(params.endingWithinDays);
        }
        if (params.sort) payload.sort = params.sort;
        if (params.cashback === 'allowed') payload.cashback = 'allowed';

        const resp = await this.requestFeedico<{
          coupons?: FeedicoApiCouponRow[];
          meta?: FeedicoApiMeta;
          partnerPublicId?: string;
        }>('POST', '/api/catalog/coupons', payload);

        const pageRows = Array.isArray(resp.coupons) ? resp.coupons : [];
        for (const row of pageRows) {
          if (!row || !row.id) continue;
          const rowId = String(row.id);
          if (seenIds.has(rowId)) continue;
          seenIds.add(rowId);
          collectedRows.push(row);
        }

        if (resp.meta) {
          lastMeta = resp.meta;
        } else {
          lastMeta = {
            total: collectedRows.length,
            limit: pageSize,
            offset: (currentPage - 1) * pageSize,
            hasMore: false,
          };
        }

        if (resp.partnerPublicId) {
          partnerPublicId = resp.partnerPublicId;
          this.partnerPublicId = resp.partnerPublicId;
        }

        pagesFetched++;
        if (!lastMeta.hasMore || pageRows.length === 0) {
          break;
        }
        currentPage++;
      }
    }

    if (cfg.tokenMode === 'customer_catalog' && params.sort) {
      if (params.sort === 'ending_soon') {
        collectedRows.sort((a, b) => {
          const aMs = a.endsAt ? Date.parse(a.endsAt) : Number.POSITIVE_INFINITY;
          const bMs = b.endsAt ? Date.parse(b.endsAt) : Number.POSITIVE_INFINITY;
          return aMs - bMs;
        });
      } else if (params.sort === 'merchant') {
        collectedRows.sort((a, b) => (a.merchantName || '').localeCompare(b.merchantName || ''));
      } else if (params.sort === 'code') {
        collectedRows.sort((a, b) => (a.code || 'ZZZ').localeCompare(b.code || 'ZZZ'));
      }
    }

    const syncedAt = new Date(this.nowFn()).toISOString();
    const ttlMs = cfg.cacheTtlSeconds * 1000;
    this.queryCache.set(cacheKey, {
      data: {
        rawRows: collectedRows,
        meta: lastMeta,
        partnerPublicId,
      },
      syncedAt,
      syncedAtMs: this.nowFn(),
      expiresAtMs: this.nowFn() + ttlMs,
    });

    const normalizedList = this.normalizeAndDeduplicateCouponRows(collectedRows, {
      nowMs: this.nowFn(),
      syncedAt,
      cacheTtlSeconds: cfg.cacheTtlSeconds,
      userId: context.userId,
    });

    return {
      offers: normalizedList.offers,
      coupons: normalizedList.coupons,
      meta: lastMeta,
      fromCache: false,
      partnerPublicId,
    };
  }

  private normalizeAndDeduplicateCouponRows(
    rows: FeedicoApiCouponRow[],
    options: {
      nowMs: number;
      syncedAt: string;
      cacheTtlSeconds: number;
      userId?: string | null;
    }
  ): { offers: FeedicoNormalizedOffer[]; coupons: CouponItem[] } {
    const offers: FeedicoNormalizedOffer[] = [];
    const coupons: CouponItem[] = [];
    const seenOfferIds = new Set<string>();

    for (const row of rows) {
      if (!row || !row.id) continue;
      const offerId = String(row.id);
      if (seenOfferIds.has(offerId)) continue;
      seenOfferIds.add(offerId);

      const { normalized, couponItem } = normalizeFeedicoCoupon(row, options);
      // Persist to normalized database store (without user-specific subId so shared cache stays user-isolated)
      const sharedNormalized: FeedicoNormalizedOffer = {
        ...normalized,
        tracked_url: row.goUrl,
      };
      this.offersById.set(offerId, sharedNormalized);

      offers.push(normalized);
      coupons.push(couponItem);
    }

    return { offers, coupons };
  }

  /**
   * Searches stores/merchants from `POST /api/catalog/merchants` (or `POST /api/v1/catalog/networks`).
   */
  public async searchMerchants(params: FeedicoMerchantSearchParams = {}): Promise<{
    merchants: FeedicoMerchantRecord[];
    meta: FeedicoApiMeta;
    fromCache: boolean;
    partnerPublicId: string | null;
  }> {
    const cfg = this.getConfig();
    const page = Math.max(1, Math.floor(params.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Math.floor(params.pageSize ?? 48)));

    const cleanCountries = Array.isArray(params.countries)
      ? params.countries.map((c) => c.trim().toUpperCase()).filter(Boolean)
      : typeof params.countries === 'string' && params.countries.trim()
      ? params.countries
          .split(',')
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean)
      : undefined;

    const cacheKey = JSON.stringify({
      op: 'merchants',
      mode: cfg.tokenMode || 'partner',
      q: params.q?.trim().toLowerCase() || '',
      provider: params.provider || '',
      hasCoupons: params.hasCoupons ?? null,
      minCoupons: params.minCoupons ?? null,
      sort: params.sort || 'coupons_desc',
      countries: cleanCountries || [],
      cashback: params.cashback || '',
      page,
      pageSize,
    });

    const nowMs = this.nowFn();
    const cached = this.queryCache.get(cacheKey) as
      | CacheEntry<{
          merchants: FeedicoMerchantRecord[];
          meta: FeedicoApiMeta;
          partnerPublicId: string | null;
        }>
      | undefined;

    if (!params.bypassCache && cached && cached.expiresAtMs > nowMs) {
      return {
        ...cached.data,
        fromCache: true,
      };
    }

    const syncedAt = new Date(this.nowFn()).toISOString();
    const merchants: FeedicoMerchantRecord[] = [];
    const seenSlugs = new Set<string>();
    let meta: FeedicoApiMeta;

    if (cfg.tokenMode === 'customer_catalog') {
      const payload: Record<string, unknown> = { page, pageSize };
      if (params.q && params.q.trim()) payload.firmName = params.q.trim();
      if (params.provider) payload.provider = params.provider;

      const resp = await this.requestFeedico<{
        ok?: boolean;
        recordCount?: number;
        page?: number;
        pageSize?: number;
        networks?: Array<{
          id: string;
          displayName: string;
          merchantWebsiteUrl?: string | null;
          providers?: string[];
          provider?: string;
          couponCount?: number;
          lastSyncedAt?: string | null;
          goUrl?: string | null;
        }>;
      }>('POST', '/api/v1/catalog/networks', payload);

      const rows = Array.isArray(resp.networks) ? resp.networks : [];
      for (const row of rows) {
        if (!row || (!row.id && !row.displayName)) continue;
        const parsedGo = parseFeedicoGoUrlMetadata(row.goUrl, row.id || row.displayName);
        if (parsedGo.partnerPublicId && !this.partnerPublicId) {
          this.partnerPublicId = parsedGo.partnerPublicId;
        }
        const slug = parsedGo.goSlug;
        if (seenSlugs.has(slug)) continue;

        const couponCount = typeof row.couponCount === 'number' ? row.couponCount : 0;
        if (params.hasCoupons === true && couponCount <= 0) continue;
        if (typeof params.minCoupons === 'number' && couponCount < params.minCoupons) continue;

        seenSlugs.add(slug);
        const providerStr =
          Array.isArray(row.providers) && row.providers.length > 0
            ? row.providers[0]
            : row.provider || 'feedico';

        const record: FeedicoMerchantRecord = {
          merchant_id: slug,
          go_slug: slug,
          name: row.displayName || `Store ${slug}`,
          provider: providerStr,
          website_url: row.merchantWebsiteUrl || null,
          domain: extractCleanDomain(row.merchantWebsiteUrl),
          coupon_count: couponCount,
          tracked_url: row.goUrl || row.merchantWebsiteUrl || '',
          cashback_allowed: row.goUrl ? 'yes' : 'unknown',
          commission: null,
          last_synced_at: row.lastSyncedAt || syncedAt,
        };
        this.merchantsBySlug.set(slug, record);
        if (row.id) this.merchantsBySlug.set(String(row.id), record);
        merchants.push(record);
      }

      if (params.sort === 'coupons_desc') {
        merchants.sort((a, b) => b.coupon_count - a.coupon_count);
      } else if (params.sort === 'coupons_asc') {
        merchants.sort((a, b) => a.coupon_count - b.coupon_count);
      } else if (params.sort === 'name_asc') {
        merchants.sort((a, b) => a.name.localeCompare(b.name));
      } else if (params.sort === 'name_desc') {
        merchants.sort((a, b) => b.name.localeCompare(a.name));
      }

      const total = typeof resp.recordCount === 'number' ? resp.recordCount : merchants.length;
      meta = {
        total,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        hasMore: (page - 1) * pageSize + rows.length < total && rows.length > 0,
      };
    } else {
      const payload: Record<string, unknown> = { page, pageSize };
      if (params.q && params.q.trim()) payload.q = params.q.trim();
      if (params.provider) payload.provider = params.provider;
      if (typeof params.hasCoupons === 'boolean') payload.hasCoupons = params.hasCoupons;
      if (typeof params.minCoupons === 'number') payload.minCoupons = params.minCoupons;
      if (params.sort) payload.sort = params.sort;
      if (cleanCountries && cleanCountries.length > 0) payload.countries = cleanCountries;
      if (params.cashback === 'allowed') payload.cashback = 'allowed';

      const resp = await this.requestFeedico<{
        merchants?: FeedicoApiMerchantRow[];
        meta?: FeedicoApiMeta;
        partnerPublicId?: string;
      }>('POST', '/api/catalog/merchants', payload);

      for (const row of resp.merchants || []) {
        if (!row || !row.goSlug) continue;
        const slug = String(row.goSlug);
        if (seenSlugs.has(slug)) continue;
        seenSlugs.add(slug);

        const record: FeedicoMerchantRecord = {
          merchant_id: slug,
          go_slug: slug,
          name: row.name || `Store ${slug}`,
          provider: row.provider || 'feedico',
          website_url: row.websiteUrl || null,
          domain: extractCleanDomain(row.websiteUrl),
          coupon_count: typeof row.couponCount === 'number' ? row.couponCount : 0,
          tracked_url: row.goUrl,
          cashback_allowed: row.cashbackAllowed ?? 'unknown',
          commission: row.commission ?? null,
          last_synced_at: syncedAt,
        };
        this.merchantsBySlug.set(slug, record);
        merchants.push(record);
      }

      meta = resp.meta || {
        total: merchants.length,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        hasMore: false,
      };
      if (resp.partnerPublicId) {
        this.partnerPublicId = resp.partnerPublicId;
      }
    }

    this.queryCache.set(cacheKey, {
      data: {
        merchants,
        meta,
        partnerPublicId: this.partnerPublicId,
      },
      syncedAt,
      syncedAtMs: this.nowFn(),
      expiresAtMs: this.nowFn() + cfg.cacheTtlSeconds * 1000,
    });

    return {
      merchants,
      meta,
      fromCache: false,
      partnerPublicId: this.partnerPublicId,
    };
  }

  /**
   * Searches products in the Feedico catalog (`POST /api/catalog/products` or `POST /api/v1/catalog/products`).
   */
  public async searchProducts(params: FeedicoProductSearchParams = {}): Promise<{
    products: FeedicoApiProductRow[];
    recordCount: number;
    nextCursor: string | null;
    partnerPublicId: string | null;
  }> {
    const cfg = this.getConfig();
    const pageSize = Math.min(200, Math.max(1, Math.floor(params.pageSize ?? 50)));
    const payload: Record<string, unknown> = { pageSize };
    if (params.q?.trim()) payload.q = params.q.trim();
    if (params.brand?.trim()) payload.brand = params.brand.trim();
    if (params.sku?.trim()) payload.sku = params.sku.trim();
    if (params.firmName?.trim()) payload.firmName = params.firmName.trim();
    if (params.merchant?.trim()) payload.merchant = params.merchant.trim();
    if (typeof params.onSale === 'boolean') payload.onSale = params.onSale;
    if (typeof params.minPrice === 'number') payload.minPrice = params.minPrice;
    if (typeof params.maxPrice === 'number') payload.maxPrice = params.maxPrice;
    if (params.currency?.trim()) payload.currency = params.currency.trim().toUpperCase();
    if (params.countries) payload.countries = params.countries;
    if (params.cashback === 'allowed') payload.cashback = 'allowed';
    if (params.cursor) payload.cursor = params.cursor;

    const endpoint =
      cfg.tokenMode === 'customer_catalog' ? '/api/v1/catalog/products' : '/api/catalog/products';

    const resp = await this.requestFeedico<{
      ok?: boolean;
      products?: FeedicoApiProductRow[];
      recordCount?: number;
      nextCursor?: string | null;
      partnerPublicId?: string;
    }>('POST', endpoint, payload);

    if (resp.partnerPublicId) {
      this.partnerPublicId = resp.partnerPublicId;
    }

    return {
      products: Array.isArray(resp.products) ? resp.products : [],
      recordCount: typeof resp.recordCount === 'number' ? resp.recordCount : 0,
      nextCursor: resp.nextCursor ?? null,
      partnerPublicId: this.partnerPublicId,
    };
  }

  /**
   * Searches products in the Feedico catalog and normalizes them into Spark's `ProductOffer` schema.
   */
  public async searchNormalizedProducts(
    params: FeedicoProductSearchParams = {},
    options?: { userId?: string | null }
  ): Promise<{
    offers: ProductOffer[];
    rawProducts: FeedicoApiProductRow[];
    recordCount: number;
    nextCursor: string | null;
    partnerPublicId: string | null;
  }> {
    const result = await this.searchProducts(params);
    const nowMs = this.nowFn();
    const seenIds = new Set<string>();
    const offers: ProductOffer[] = [];

    for (const row of result.products) {
      if (!row || !row.id) continue;
      const pid = String(row.id);
      if (seenIds.has(pid)) continue;
      seenIds.add(pid);
      offers.push(normalizeFeedicoProduct(row, { userId: options?.userId ?? null, nowMs }));
    }

    return {
      offers,
      rawProducts: result.products,
      recordCount: result.recordCount,
      nextCursor: result.nextCursor,
      partnerPublicId: result.partnerPublicId,
    };
  }

  /**
   * Performs a live authenticated probe against Feedico to verify credential validity
   * and transition integrationState to CONFIGURED_AND_VERIFIED (or capture the exact failure state).
   */
  public async verifyConnectivity(options?: {
    q?: string;
    userId?: string | null;
  }): Promise<{
    ok: boolean;
    status: FeedicoStatusResponse;
    sampleCouponsCount: number;
    sampleMerchantsCount: number;
    sampleProductsCount: number;
    errorCode?: string;
    error?: string;
  }> {
    const cfg = this.getConfig();
    if (!cfg.configured) {
      this.lastErrorCode = cfg.errorCode;
      this.lastError =
        cfg.validationError ||
        'FEEDICO_PARTNER_TOKEN is not configured. Provide a valid Feedico token starting with fdcp_ or fdco_.';
      const status = this.getStatus();
      return {
        ok: false,
        status,
        sampleCouponsCount: 0,
        sampleMerchantsCount: 0,
        sampleProductsCount: 0,
        errorCode: cfg.errorCode,
        error: status.statusMessage,
      };
    }

    try {
      const couponProbe = await this.searchCoupons(
        {
          q: options?.q,
          page: 1,
          pageSize: 5,
          bypassCache: true,
        },
        { userId: options?.userId ?? null }
      );

      let merchantsCount = 0;
      let productsCount = 0;
      try {
        const merchantProbe = await this.searchMerchants({
          q: options?.q,
          page: 1,
          pageSize: 5,
          bypassCache: true,
        });
        merchantsCount = merchantProbe.merchants.length;
      } catch {
        // Non-fatal if coupon probe already verified authentication
      }

      try {
        const productProbe = await this.searchProducts({
          q: options?.q,
          pageSize: 5,
        });
        productsCount = productProbe.products.length;
      } catch {
        // Non-fatal if coupon probe already verified authentication
      }

      return {
        ok: true,
        status: this.getStatus(),
        sampleCouponsCount: couponProbe.offers.length,
        sampleMerchantsCount: merchantsCount,
        sampleProductsCount: productsCount,
      };
    } catch (err) {
      const status = this.getStatus();
      if (err instanceof FeedicoServiceError) {
        return {
          ok: false,
          status,
          sampleCouponsCount: 0,
          sampleMerchantsCount: 0,
          sampleProductsCount: 0,
          errorCode: err.errorCode,
          error: err.message,
        };
      }
      return {
        ok: false,
        status,
        sampleCouponsCount: 0,
        sampleMerchantsCount: 0,
        sampleProductsCount: 0,
        errorCode: 'network_failure',
        error: redactFeedicoSecrets((err as Error)?.message || 'Live connectivity check failed.'),
      };
    }
  }

  /**
   * Mints a tracked merchant/coupon link and optionally attaches user `sub` attribution.
   */
  public async createTrackedLink(params: {
    merchantSlug: string;
    code?: string | null;
    userId?: string | null;
    deepLinkUrl?: string | null;
  }): Promise<{
    url: string;
    trackedUrlWithSub: string;
    merchantSlug: string;
    code: string | null;
    partnerPublicId: string | null;
  }> {
    const slug = (params.merchantSlug || '').trim();
    if (!slug) {
      throw new FeedicoServiceError('merchantSlug is required.', 400, 'missing_merchant_slug');
    }

    const cfg = this.getConfig();
    if (cfg.tokenMode === 'customer_catalog') {
      let merchantRecord = this.merchantsBySlug.get(slug);
      if (!merchantRecord) {
        const searchRes = await this.searchMerchants({ q: slug, pageSize: 5 });
        merchantRecord =
          searchRes.merchants.find((m) => m.go_slug === slug || m.merchant_id === slug) ||
          searchRes.merchants[0];
      }

      const baseGo =
        merchantRecord?.tracked_url && merchantRecord.tracked_url.includes('feedico.io/go/')
          ? merchantRecord.tracked_url
          : `https://feedico.io/go/${encodeURIComponent(merchantRecord?.go_slug || slug)}?p=${
              this.partnerPublicId || 'XYIf5Ph5FebnAtv'
            }`;

      const parsedUrl = new URL(baseGo);
      const cleanCode = params.code && params.code.trim() ? params.code.trim() : null;
      if (cleanCode) {
        parsedUrl.searchParams.set('c', cleanCode);
      }

      const finalBaseUrl = parsedUrl.toString();
      const trackedUrlWithSub = buildUserTrackedGoUrl({
        goUrl: finalBaseUrl,
        userId: params.userId,
        merchantWebsiteUrl: merchantRecord?.website_url,
        deepLinkProductUrl: params.deepLinkUrl,
      });

      return {
        url: finalBaseUrl,
        trackedUrlWithSub,
        merchantSlug: merchantRecord?.go_slug || slug,
        code: cleanCode,
        partnerPublicId: this.partnerPublicId,
      };
    }

    const payload: Record<string, unknown> = { merchantSlug: slug };
    if (params.code && params.code.trim()) {
      payload.code = params.code.trim();
    }

    const resp = await this.requestFeedico<{
      url: string;
      merchantSlug: string;
      code: string | null;
      partnerPublicId?: string;
    }>('POST', '/api/links', payload);

    if (resp.partnerPublicId) {
      this.partnerPublicId = resp.partnerPublicId;
    }

    const merchantRecord = this.merchantsBySlug.get(slug);
    const trackedUrlWithSub = buildUserTrackedGoUrl({
      goUrl: resp.url,
      userId: params.userId,
      merchantWebsiteUrl: merchantRecord?.website_url,
      deepLinkProductUrl: params.deepLinkUrl,
    });

    return {
      url: resp.url,
      trackedUrlWithSub,
      merchantSlug: resp.merchantSlug || slug,
      code: resp.code ?? null,
      partnerPublicId: this.partnerPublicId,
    };
  }

  /**
   * Validates up to 50 Feedico links without generating clicks.
   */
  public async validateLinks(
    links: Array<
      | string
      | {
          merchantSlug: string;
          code?: string | null;
          url?: string | null;
          sku?: string | null;
        }
    >
  ): Promise<{
    results: FeedicoLinkValidationResult[];
    summary: { checked: number; ok: number; notOk: number };
    note: string;
  }> {
    if (!Array.isArray(links) || links.length === 0) {
      throw new FeedicoServiceError('At least 1 link is required for validation.', 400, 'empty_links');
    }
    if (links.length > 50) {
      throw new FeedicoServiceError(
        'Feedico /api/links/validate accepts at most 50 links per request.',
        400,
        'too_many_links'
      );
    }

    const cfg = this.getConfig();
    if (cfg.tokenMode === 'customer_catalog') {
      const results: FeedicoLinkValidationResult[] = [];
      let okCount = 0;

      for (const item of links) {
        const rawStr =
          typeof item === 'string'
            ? item.trim()
            : `https://feedico.io/go/${encodeURIComponent(item.merchantSlug)}?p=${
                this.partnerPublicId || 'XYIf5Ph5FebnAtv'
              }${item.code ? `&c=${encodeURIComponent(item.code)}` : ''}${
                item.url ? `&url=${encodeURIComponent(item.url)}` : ''
              }`;

        try {
          const parsed = new URL(rawStr);
          const isFeedicoGo =
            (parsed.hostname === 'feedico.io' || parsed.hostname.endsWith('.feedico.io')) &&
            parsed.pathname.startsWith('/go/');
          if (!isFeedicoGo) {
            results.push({
              input: rawStr,
              ok: false,
              status: 'not_a_feedico_go_link',
              notes: ['URL is not an official feedico.io/go/ tracked link.'],
            });
            continue;
          }

          const { goSlug } = parseFeedicoGoUrlMetadata(rawStr);
          const code = parsed.searchParams.get('c');
          const deepUrl = parsed.searchParams.get('url');
          const merchant = this.merchantsBySlug.get(goSlug);

          let deepLinkStatus: 'will_apply' | 'off-site' | 'invalid' | undefined;
          if (deepUrl) {
            const mDom = extractCleanDomain(merchant?.website_url);
            const dDom = extractCleanDomain(deepUrl);
            if (!dDom) deepLinkStatus = 'invalid';
            else if (mDom && dDom !== mDom && !dDom.endsWith(`.${mDom}`)) deepLinkStatus = 'off-site';
            else deepLinkStatus = 'will_apply';
          }

          okCount++;
          results.push({
            input: rawStr,
            ok: true,
            status: 'ok',
            merchant: {
              slug: goSlug,
              name: merchant?.name || null,
              website: merchant?.website_url || null,
            },
            network: merchant?.provider || 'feedico',
            commission: true,
            coupon: code ? { code, active: true, endsAt: null } : null,
            deepLink: deepUrl && deepLinkStatus ? { url: deepUrl, status: deepLinkStatus } : null,
          });
        } catch {
          results.push({
            input: rawStr,
            ok: false,
            status: 'invalid_url',
            notes: ['Malformed URL syntax.'],
          });
        }
      }

      return {
        results,
        summary: {
          checked: results.length,
          ok: okCount,
          notOk: results.length - okCount,
        },
        note: 'Validated against Feedico Global Catalogue link schema without generating click events.',
      };
    }

    return this.requestFeedico<{
      results: FeedicoLinkValidationResult[];
      summary: { checked: number; ok: number; notOk: number };
      note: string;
    }>('POST', '/api/links/validate', { links });
  }

  /**
   * Retrieves a single normalized offer by `feedico_offer_id` from cache/store or refreshes from Feedico.
   */
  public getOfferById(
    offerId: string,
    context: { userId?: string | null } = {}
  ): FeedicoNormalizedOffer | null {
    const cleanId = (offerId || '').replace(/^feedico_/, '').trim();
    const stored = this.offersById.get(cleanId);
    if (!stored) return null;

    const cfg = this.getConfig();
    const nowMs = this.nowFn();
    const syncedMs = Date.parse(stored.last_synced_at);
    const isStale = !Number.isNaN(syncedMs) && nowMs - syncedMs > cfg.cacheTtlSeconds * 1000;
    const expMs = stored.expiration_date ? Date.parse(stored.expiration_date) : Number.NaN;
    const isExpired = !Number.isNaN(expMs) && expMs <= nowMs;

    return {
      ...stored,
      verification_status: isExpired ? 'expired' : stored.verification_status,
      is_stale: isStale,
      tracked_url: buildUserTrackedGoUrl({
        goUrl: stored.tracked_url,
        userId: context.userId,
        merchantWebsiteUrl: stored.website_url,
      }),
    };
  }

  /**
   * Discovers, matches, and ranks Feedico offers for a specific product or set of products.
   */
  public async findOffersForProduct(
    product: Pick<
      ProductOffer,
      'id' | 'name' | 'merchant' | 'canonicalUrl' | 'price' | 'priceStatus' | 'currency'
    >,
    options: {
      targetCountry?: string | null;
      userId?: string | null;
      bypassCache?: boolean;
    } = {}
  ): Promise<{
    matchedOffers: FeedicoNormalizedOffer[];
    couponItems: CouponItem[];
    merchantRecord: FeedicoMerchantRecord | null;
    fromCache: boolean;
  }> {
    const domain = extractCleanDomain(product.canonicalUrl);
    const merchantNameQuery = normalizeMerchantToken(product.merchant) || product.merchant?.trim() || '';
    const merchantQuery = merchantNameQuery || domain || product.name;

    // 1. Try finding the merchant first to get its exact goSlug
    let matchedMerchant: FeedicoMerchantRecord | null = null;
    let fromCacheAll = true;

    try {
      const merchantSearch = await this.searchMerchants({
        q: merchantQuery,
        countries: options.targetCountry ? [options.targetCountry] : undefined,
        pageSize: 10,
        bypassCache: options.bypassCache,
      });
      fromCacheAll = fromCacheAll && merchantSearch.fromCache;

      matchedMerchant =
        merchantSearch.merchants.find((m) => {
          if (domain && m.domain && (m.domain === domain || domain.endsWith(`.${m.domain}`))) {
            return true;
          }
          const mNorm = normalizeMerchantToken(m.name);
          const pNorm = normalizeMerchantToken(product.merchant);
          return Boolean(mNorm && pNorm && (mNorm === pNorm || mNorm.includes(pNorm) || pNorm.includes(mNorm)));
        }) || null;
    } catch {
      // Continue to direct coupon search even if merchant catalog lookup fails
    }

    // 2. Search coupons by exact merchant goSlug if found, or by merchant query
    const couponSearch = await this.searchCoupons(
      {
        merchant: matchedMerchant?.go_slug,
        q: matchedMerchant ? undefined : merchantQuery,
        countries: options.targetCountry ? [options.targetCountry] : undefined,
        pageSize: 48,
        bypassCache: options.bypassCache,
      },
      { userId: options.userId }
    );
    fromCacheAll = fromCacheAll && couponSearch.fromCache;

    const ranked = matchAndRankOffersForProduct(product, couponSearch.offers, {
      targetCountry: options.targetCountry,
      includeExpired: false,
      nowMs: this.nowFn(),
    });

    const rankedIds = new Set(ranked.map((r) => r.feedico_offer_id));
    const couponItems = couponSearch.coupons.filter(
      (c) => c.feedicoOfferId && rankedIds.has(c.feedicoOfferId)
    );

    return {
      matchedOffers: ranked,
      couponItems,
      merchantRecord: matchedMerchant,
      fromCache: fromCacheAll,
    };
  }

  /**
   * Records an affiliate link click event attributed to an authenticated Spark user.
   * Strictly enforces user isolation and never marks a click as a completed purchase.
   */
  public recordAffiliateClick(params: {
    userId: string;
    feedicoOfferId?: string | null;
    merchantId: string;
    merchantName: string;
    couponCode?: string | null;
    productId?: string | null;
    productName?: string | null;
    goUrl: string;
    merchantWebsiteUrl?: string | null;
    deepLinkUrl?: string | null;
    targetCountry?: string | null;
  }): FeedicoAffiliateClickRecord {
    const cleanUserId = (params.userId || '').trim();
    if (!cleanUserId) {
      throw new FeedicoServiceError(
        'Authenticated Spark userId is required to record affiliate click attribution.',
        401,
        'unauthenticated_click_rejected'
      );
    }

    const subId = buildOpaqueUserSubId(cleanUserId);
    const trackedUrl = buildUserTrackedGoUrl({
      goUrl: params.goUrl,
      userId: cleanUserId,
      merchantWebsiteUrl: params.merchantWebsiteUrl,
      deepLinkProductUrl: params.deepLinkUrl,
    });

    const clickId = `fclk_${this.nowFn().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const record: FeedicoAffiliateClickRecord = {
      click_id: clickId,
      user_id: cleanUserId,
      sub_id: subId,
      feedico_offer_id: params.feedicoOfferId ?? null,
      merchant_id: String(params.merchantId || 'unknown'),
      merchant_name: params.merchantName || 'Merchant',
      coupon_code: params.couponCode ?? null,
      product_id: params.productId ?? null,
      product_name: params.productName ?? null,
      tracked_url: trackedUrl,
      target_country: params.targetCountry ? params.targetCountry.toUpperCase() : null,
      clicked_at: new Date(this.nowFn()).toISOString(),
      outcome_status: 'CLICK_RECORDED_NOT_PURCHASE',
      disclosure_shown: true,
    };

    this.clicksById.set(clickId, record);
    return record;
  }

  /**
   * Returns affiliate click records strictly isolated to the requesting Spark user.
   */
  public getUserAffiliateClicks(userId: string): FeedicoAffiliateClickRecord[] {
    const cleanUserId = (userId || '').trim();
    if (!cleanUserId) return [];
    const results: FeedicoAffiliateClickRecord[] = [];
    for (const record of this.clicksById.values()) {
      if (record.user_id === cleanUserId) {
        results.push(record);
      }
    }
    return results.sort((a, b) => Date.parse(b.clicked_at) - Date.parse(a.clicked_at));
  }

  /**
   * Processes a verified Feedico commission postback event idempotently.
   */
  public processCommissionPostback(eventPayload: {
    id: string;
    type: string;
    createdAt?: string;
    data?: {
      commissionId?: number;
      clickId?: string;
      sub?: string;
      merchant?: string;
      network?: string;
      status?: 'pending' | 'approved' | 'declined' | 'paid';
      previousStatus?: string;
      amount?: number;
      currency?: string;
    };
  }): { duplicate: boolean; updatedClicks: number; status: string } {
    const eventId = String(eventPayload.id || '').trim();
    if (!eventId) {
      throw new FeedicoServiceError('Missing postback event id.', 400, 'invalid_postback_event');
    }
    if (this.processedPostbackEventIds.has(eventId)) {
      return { duplicate: true, updatedClicks: 0, status: 'duplicate_skipped' };
    }
    this.processedPostbackEventIds.add(eventId);

    const sub = eventPayload.data?.sub;
    const status = eventPayload.data?.status;
    let updatedClicks = 0;

    if (sub && status) {
      const mappedOutcome: FeedicoAffiliateClickRecord['outcome_status'] =
        status === 'approved'
          ? 'COMMISSION_APPROVED'
          : status === 'declined'
          ? 'COMMISSION_DECLINED'
          : status === 'paid'
          ? 'COMMISSION_PAID'
          : 'COMMISSION_PENDING';

      for (const click of this.clicksById.values()) {
        if (click.sub_id === sub) {
          click.outcome_status = mappedOutcome;
          updatedClicks++;
        }
      }
    }

    return { duplicate: false, updatedClicks, status: status || eventPayload.type };
  }

  /**
   * Returns cache freshness diagnostics and all cached offers (with user-isolated tracked URLs).
   */
  public getCacheDiagnostics(userId?: string | null): {
    ttlSeconds: number;
    totalCachedOffers: number;
    freshOffersCount: number;
    staleOffersCount: number;
    expiredOffersCount: number;
    totalCachedMerchants: number;
    queryCacheKeysCount: number;
    lastSyncAt: string | null;
    offers: FeedicoNormalizedOffer[];
  } {
    const cfg = this.getConfig();
    const nowMs = this.nowFn();
    const ttlMs = cfg.cacheTtlSeconds * 1000;

    let freshOffersCount = 0;
    let staleOffersCount = 0;
    let expiredOffersCount = 0;
    const offers: FeedicoNormalizedOffer[] = [];

    for (const offer of this.offersById.values()) {
      const syncedMs = Date.parse(offer.last_synced_at);
      const isStale = !Number.isNaN(syncedMs) && nowMs - syncedMs > ttlMs;
      const expMs = offer.expiration_date ? Date.parse(offer.expiration_date) : Number.NaN;
      const isExpired = !Number.isNaN(expMs) && expMs <= nowMs;

      if (isStale) staleOffersCount++;
      else freshOffersCount++;
      if (isExpired) expiredOffersCount++;

      offers.push({
        ...offer,
        verification_status: isExpired ? 'expired' : offer.verification_status,
        is_stale: isStale,
        tracked_url: buildUserTrackedGoUrl({
          goUrl: offer.tracked_url,
          userId,
          merchantWebsiteUrl: offer.website_url,
        }),
      });
    }

    return {
      ttlSeconds: cfg.cacheTtlSeconds,
      totalCachedOffers: this.offersById.size,
      freshOffersCount,
      staleOffersCount,
      expiredOffersCount,
      totalCachedMerchants: this.merchantsBySlug.size,
      queryCacheKeysCount: this.queryCache.size,
      lastSyncAt: this.lastSyncAt,
      offers,
    };
  }

  public clearCache(): void {
    this.queryCache.clear();
  }
}

export const feedicoPartnerService = new FeedicoPartnerService();
