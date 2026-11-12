import type {
  ProductOffer,
  SourceExecutionReport,
} from '../types/spark.ts';

export const CHANNEL3_API_BASE_URL = 'https://api.trychannel3.com';
export const CHANNEL3_SOURCE_ID = 'channel3_api';
export const CHANNEL3_SOURCE_NAME = 'Channel3 Product Graph API';

export interface Channel3SearchFilterPrice {
  min_price?: number | null;
  max_price?: number | null;
}

export interface Channel3SearchFilters {
  brand_ids?: string[] | null;
  gender?: 'male' | 'female' | null;
  conditions?: Array<'new' | 'used'>;
  age?: Array<'newborn' | 'infant' | 'toddler' | 'kids' | 'adult'> | null;
  price?: Channel3SearchFilterPrice | null;
  availability?: Array<'InStock' | 'OutOfStock'>;
}

export interface Channel3SearchConfig {
  mode?: 'default' | 'keyword' | 'agentic';
  currency?: 'USD' | 'EUR' | 'GBP';
  country?: 'US' | 'GB' | 'EU';
  language?: 'en' | 'es' | 'fr' | 'de';
}

export interface Channel3SearchRequest {
  query?: string | null;
  image_url?: string | null;
  base64_image?: string | null;
  limit?: number;
  filters?: Channel3SearchFilters;
  config?: Channel3SearchConfig;
  page_token?: string | null;
}

export interface Channel3RawPrice {
  price?: number | null;
  amount?: number | null;
  compare_at_price?: number | null;
  currency?: string | null;
}

export interface Channel3RawOffer {
  url?: string | null;
  domain?: string | null;
  price?: Channel3RawPrice | null;
  availability?: 'InStock' | 'OutOfStock' | string | null;
  condition?: 'new' | 'used' | string | null;
  max_commission_rate?: number | null;
  dimensions?: Record<string, unknown> | null;
}

export interface Channel3RawImage {
  url?: string | null;
  cleaned_url?: string | null;
  is_main_image?: boolean | null;
  shot_type?: string | null;
  alt_text?: string | null;
}

export interface Channel3RawBrand {
  id?: string | null;
  name?: string | null;
}

export interface Channel3RawCategory {
  slug?: string | null;
  title?: string | null;
  has_children?: boolean | null;
  path?: Array<{ slug?: string; title?: string }> | null;
}

export interface Channel3RawRatings {
  value?: number | null;
  count?: number | null;
  source_count?: number | null;
}

export interface Channel3RawProduct {
  id?: string | null;
  title?: string | null;
  description?: string | null;
  brands?: Channel3RawBrand[] | null;
  images?: Array<Channel3RawImage | string> | null;
  category?: Channel3RawCategory | null;
  materials?: string[] | null;
  key_features?: string[] | null;
  offers?: Channel3RawOffer[] | null;
  ratings?: Channel3RawRatings | null;
  structured_attributes?: Record<string, string[]> | null;
}

export interface Channel3SafeDiagnostic {
  endpoint: string;
  httpStatus: number | null;
  errorCode:
    | 'none'
    | 'missing_credential'
    | 'unauthorized_401'
    | 'credits_exhausted_402'
    | 'rate_limited_429'
    | 'validation_422'
    | 'bad_request_400'
    | 'upstream_5xx'
    | 'timeout'
    | 'network_error'
    | 'invalid_schema';
  retryAttempts: number;
  latencyMs: number;
  safeMessage: string;
  retrievedAt: string;
}

export interface Channel3ExecutionResult {
  offers: ProductOffer[];
  report: SourceExecutionReport;
  diagnostic: Channel3SafeDiagnostic;
  nextPageToken: string | null;
}

export interface Channel3AdapterOptions {
  apiKey?: string | null;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  userId?: string | null;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
}

const PLACEHOLDER_KEYS = new Set([
  '',
  'MY_CHANNEL3_API_KEY',
  'YOUR_API_KEY',
  'YOUR_CHANNEL3_API_KEY',
  'REPLACE_ME',
  '<value>',
]);

/**
 * Checks whether a Channel3 API credential is configured without exposing its value.
 */
export function isChannel3CredentialConfigured(
  ...args: [rawKey?: string | undefined | null]
): boolean {
  const rawKey = args.length === 0 ? process.env.CHANNEL3_API_KEY : args[0];
  if (typeof rawKey !== 'string') return false;
  const trimmed = rawKey.trim();
  if (trimmed.length < 6 || PLACEHOLDER_KEYS.has(trimmed)) {
    return false;
  }
  return true;
}

/**
 * Scrubs any accidental occurrence of the API key from diagnostic strings or error messages.
 */
export function redactChannel3Secret(
  message: string,
  secretKey?: string | null
): string {
  if (!message) return '';
  let sanitized = message;
  if (secretKey && secretKey.trim().length >= 4) {
    const escaped = secretKey.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    sanitized = sanitized.replace(new RegExp(escaped, 'gi'), '[REDACTED]');
  }
  sanitized = sanitized.replace(
    /(x-api-key\s*[:=]\s*)([^\s,;'"`]+)/gi,
    '$1[REDACTED]'
  );
  return sanitized;
}

function normalizeCurrency(rawCurrency: unknown): 'USD' | 'EUR' | 'GBP' {
  const upper = String(rawCurrency || 'USD').trim().toUpperCase();
  if (upper === 'EUR') return 'EUR';
  if (upper === 'GBP') return 'GBP';
  return 'USD';
}

function selectProductImage(
  images: Channel3RawProduct['images']
): string | null {
  if (!Array.isArray(images) || images.length === 0) return null;

  const objectImages = images.filter(
    (img): img is Channel3RawImage => typeof img === 'object' && img !== null
  );
  const mainImage = objectImages.find((img) => img.is_main_image);
  if (mainImage) {
    const candidate = (mainImage.cleaned_url || mainImage.url || '').trim();
    if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
      return candidate;
    }
  }

  for (const item of images) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return trimmed;
      }
    } else if (item && typeof item === 'object') {
      const candidate = (item.cleaned_url || item.url || '').trim();
      if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
        return candidate;
      }
    }
  }
  return null;
}

function extractAllProductImages(
  images: Channel3RawProduct['images']
): string[] {
  if (!Array.isArray(images) || images.length === 0) return [];
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const item of images) {
    let candidate = '';
    if (typeof item === 'string') {
      candidate = item.trim();
    } else if (item && typeof item === 'object') {
      candidate = (item.cleaned_url || item.url || '').trim();
    }
    if ((candidate.startsWith('http://') || candidate.startsWith('https://')) && !seen.has(candidate)) {
      seen.add(candidate);
      urls.push(candidate);
    }
  }
  return urls;
}

/**
 * Normalizes a single Channel3 Product + its merchant Offers into Spark's strict ProductOffer records.
 * Strictly distinguishes missing data (null/undefined) from a genuine zero value (0).
 */
export function normalizeChannel3ProductToOffers(
  rawProduct: Channel3RawProduct,
  retrievedAt: string
): ProductOffer[] {
  if (!rawProduct || typeof rawProduct !== 'object') return [];

  const productId = String(rawProduct.id || '').trim();
  const title = String(rawProduct.title || '').trim();
  if (!productId || !title) return [];

  const brandNames = Array.isArray(rawProduct.brands)
    ? rawProduct.brands
        .map((b) => (b && typeof b.name === 'string' ? b.name.trim() : ''))
        .filter(Boolean)
    : [];
  const primaryBrand = brandNames[0] || null;

  const categoryTitle =
    rawProduct.category && typeof rawProduct.category.title === 'string'
      ? rawProduct.category.title.trim()
      : rawProduct.category && typeof rawProduct.category.slug === 'string'
      ? rawProduct.category.slug.trim()
      : 'general';

  const imageUrl = selectProductImage(rawProduct.images);
  const galleryImages = extractAllProductImages(rawProduct.images);
  if (imageUrl && !galleryImages.includes(imageUrl)) {
    galleryImages.unshift(imageUrl);
  }

  // Ratings rollup: distinguish genuine numeric rating from missing/null rating
  const rawRatingVal = rawProduct.ratings?.value;
  const rating =
    typeof rawRatingVal === 'number' &&
    Number.isFinite(rawRatingVal) &&
    rawRatingVal >= 0 &&
    rawRatingVal <= 5
      ? Number(rawRatingVal.toFixed(1))
      : null;

  const rawReviewCount = rawProduct.ratings?.count;
  const reviewCount =
    typeof rawReviewCount === 'number' &&
    Number.isFinite(rawReviewCount) &&
    rawReviewCount >= 0
      ? Math.floor(rawReviewCount)
      : null;

  const description =
    typeof rawProduct.description === 'string' ? rawProduct.description.trim() : '';
  const keyFeatures = Array.isArray(rawProduct.key_features)
    ? rawProduct.key_features
        .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
        .slice(0, 3)
    : [];

  const rawOffers = Array.isArray(rawProduct.offers) ? rawProduct.offers : [];
  const normalizedOffers: ProductOffer[] = [];

  const structuredAttrs =
    rawProduct.structured_attributes && typeof rawProduct.structured_attributes === 'object'
      ? (rawProduct.structured_attributes as Record<string, unknown>)
      : {};
  const explicitManufacturerModel =
    typeof structuredAttrs.model_number === 'string' && structuredAttrs.model_number.trim()
      ? structuredAttrs.model_number.trim()
      : typeof structuredAttrs.mpn === 'string' && structuredAttrs.mpn.trim()
      ? structuredAttrs.mpn.trim()
      : 'UNKNOWN';
  const explicitManufacturerSku =
    typeof structuredAttrs.manufacturer_sku === 'string' && structuredAttrs.manufacturer_sku.trim()
      ? structuredAttrs.manufacturer_sku.trim()
      : typeof structuredAttrs.sku === 'string' && structuredAttrs.sku.trim()
      ? structuredAttrs.sku.trim()
      : 'Manufacturer SKU: UNKNOWN.';

  for (let idx = 0; idx < rawOffers.length; idx++) {
    const offer = rawOffers[idx];
    if (!offer || typeof offer !== 'object') continue;

    const canonicalUrl = String(offer.url || '').trim();
    const domain = String(offer.domain || '').trim();
    if (
      !canonicalUrl ||
      (!canonicalUrl.startsWith('https://') && !canonicalUrl.startsWith('http://'))
    ) {
      continue;
    }

    const lowerDomain = domain.toLowerCase().replace(/^www\./, '');
    const domainDisplayMap: Record<string, string> = {
      'adorama.com': 'Adorama',
      'bestbuy.com': 'Best Buy',
      'quickshipelectronics.com': 'QuickShip Electronics',
      'bhphotovideo.com': 'B&H Photo Video',
      'amazon.com': 'Amazon',
      'walmart.com': 'Walmart',
      'apple.com': 'Apple',
      'newegg.com': 'Newegg',
    };
    const merchant =
      domainDisplayMap[lowerDomain] || domain || primaryBrand || 'Verified Channel3 Merchant';

    // Strictly distinguish a genuine 0 price from missing/null price
    const rawNumericPrice =
      offer.price &&
      typeof offer.price.price === 'number' &&
      Number.isFinite(offer.price.price)
        ? offer.price.price
        : offer.price &&
          typeof offer.price.amount === 'number' &&
          Number.isFinite(offer.price.amount)
        ? offer.price.amount
        : null;

    const hasVerifiedPrice = rawNumericPrice !== null && rawNumericPrice >= 0;
    const price = hasVerifiedPrice ? Number(rawNumericPrice.toFixed(2)) : null;
    const currency = normalizeCurrency(offer.price?.currency);

    const compareAtPrice =
      offer.price &&
      typeof offer.price.compare_at_price === 'number' &&
      Number.isFinite(offer.price.compare_at_price) &&
      offer.price.compare_at_price > (price ?? 0)
        ? Number(offer.price.compare_at_price.toFixed(2))
        : null;

    const availabilityStatus: ProductOffer['availabilityStatus'] =
      offer.availability === 'InStock'
        ? 'verified_in_stock'
        : offer.availability === 'OutOfStock'
        ? 'verified_out_of_stock'
        : 'unknown';

    const rawConditionString = String(offer.condition || 'unknown').trim().toLowerCase();
    const normalizedConditionLabel: 'New' | 'Open-box' | 'Refurbished' | 'Used' | 'Unknown' =
      rawConditionString === 'new'
        ? 'New'
        : rawConditionString === 'open_box' || rawConditionString === 'open-box'
        ? 'Open-box'
        : rawConditionString === 'refurbished' || rawConditionString === 'renewed'
        ? 'Refurbished'
        : rawConditionString === 'used' || rawConditionString === 'pre-owned'
        ? 'Used'
        : 'Unknown';

    const domainSlug = (domain || `offer_${idx}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const merchantOfferId = `ch3_${productId}_${domainSlug}`;

    const summaryParts: string[] = [];
    if (primaryBrand) summaryParts.push(`Brand: ${primaryBrand}.`);
    if (description) {
      summaryParts.push(description.slice(0, 180));
    } else if (keyFeatures.length > 0) {
      summaryParts.push(keyFeatures.join(' · ').slice(0, 180));
    } else {
      summaryParts.push(`${title} available from ${merchant}.`);
    }

    const specs: Record<string, string> = {
      'Source ID': `${CHANNEL3_SOURCE_ID} (${productId})`,
      'Channel3 Product ID': productId,
      'Merchant Offer ID': merchantOfferId,
      'Merchant Domain': merchant,
      'Merchant Product URL': canonicalUrl,
      'Manufacturer Model Number': explicitManufacturerModel,
      'Manufacturer SKU': explicitManufacturerSku,
      'Primary Genre': categoryTitle,
      Condition: normalizedConditionLabel,
      'Raw Channel3 Condition': rawConditionString,
      'Price Verification': hasVerifiedPrice
        ? `Verified (${currency} ${price!.toFixed(2)})`
        : 'Price could not be verified.',
      'Availability Status':
        availabilityStatus === 'verified_in_stock'
          ? 'Verified in stock (InStock)'
          : availabilityStatus === 'verified_out_of_stock'
          ? 'Verified out of stock (OutOfStock)'
          : 'Availability unknown.',
      'Shipping & Tax':
        'Not provided by Channel3 Offer schema · Calculated by merchant at checkout',
      'Direct Checkout':
        'Checkout unsupported in Spark (Channel3 Checkout API is coming soon)',
    };

    if (primaryBrand) {
      specs['Brand'] = primaryBrand;
    }
    if (compareAtPrice !== null && price !== null) {
      specs['Compare At Price'] = `${currency} ${compareAtPrice.toFixed(2)}`;
    }
    if (
      typeof offer.max_commission_rate === 'number' &&
      Number.isFinite(offer.max_commission_rate) &&
      offer.max_commission_rate >= 0
    ) {
      specs['Max Commission Rate'] = `${(offer.max_commission_rate * 100).toFixed(1)}%`;
    }

    normalizedOffers.push({
      id: merchantOfferId,
      sourceId: CHANNEL3_SOURCE_ID,
      sourceName: CHANNEL3_SOURCE_NAME,
      canonicalUrl,
      retrievedAt,
      verificationStatus:
        hasVerifiedPrice && availabilityStatus !== 'unknown'
          ? 'verified_live_source'
          : 'partial_fields_unverified',
      name: primaryBrand && !title.toLowerCase().includes(primaryBrand.toLowerCase())
        ? `${primaryBrand} ${title}`
        : title,
      merchant,
      category: categoryTitle,
      price,
      priceStatus: hasVerifiedPrice ? 'verified' : 'price_could_not_be_verified',
      currency,
      // Channel3 Offer schema does not include shipping cost or tax rate; never infer them (Rule 10)
      shippingCost: null,
      shippingStatus: 'unknown',
      estimatedTaxRate: null,
      taxStatus: 'unknown',
      availabilityStatus,
      rating,
      reviewCount,
      summary: summaryParts.join(' '),
      specs,
      // Channel3 does not provide promotional coupon codes
      couponStatus: 'no_verified_coupon',
      // Channel3 Checkout endpoint is documented as "coming soon"
      checkoutStatus: 'checkout_unsupported',
      imageUrl,
      galleryImages: galleryImages.length > 0 ? galleryImages : undefined,
    });
  }

  return normalizedOffers;
}

function cleanChannel3SearchQuery(rawQuery: string): string {
  return rawQuery
    .replace(/\b(under|below|less than|max|budget)\s*[$€£]?\s*\d+(\.\d+)?/gi, '')
    .replace(
      /\b(find|compare|discover|search|and check verified coupons|with verified ingredients|alternatives|the best|please|show me)\b/gi,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function extractSafeErrorDetail(
  response: Response,
  secretKey: string
): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown; error?: unknown };
    if (typeof body?.detail === 'string' && body.detail.trim()) {
      return redactChannel3Secret(body.detail.trim(), secretKey);
    }
    if (Array.isArray(body?.detail) && body.detail.length > 0) {
      const first = body.detail[0] as { msg?: string };
      if (first && typeof first.msg === 'string') {
        return redactChannel3Secret(first.msg.trim(), secretKey);
      }
    }
  } catch {
    // Ignore non-JSON error payloads
  }
  return `HTTP ${response.status}`;
}

/**
 * Executes an authenticated request to Channel3's documented `POST /v1/search` endpoint
 * with bounded retry handling for 429 / transient 5xx responses and strict schema validation.
 */
export async function queryChannel3Search(
  rawQuery: string,
  params: {
    maxBudget?: number | null;
    minBudget?: number | null;
    currency?: 'USD' | 'EUR' | 'GBP';
    country?: 'US' | 'GB' | 'EU';
    mode?: 'default' | 'keyword' | 'agentic';
    limit?: number;
    inStockOnly?: boolean;
    pageToken?: string | null;
  } = {},
  options: Channel3AdapterOptions = {}
): Promise<Channel3ExecutionResult> {
  const retrievedAt = new Date().toISOString();
  const endpoint = '/v1/search';
  const rawApiKey =
    options.apiKey !== undefined ? options.apiKey : process.env.CHANNEL3_API_KEY;

  if (!isChannel3CredentialConfigured(rawApiKey)) {
    return {
      offers: [],
      nextPageToken: null,
      report: {
        sourceId: CHANNEL3_SOURCE_ID,
        sourceName: CHANNEL3_SOURCE_NAME,
        configured: false,
        queried: false,
        status: 'source_not_configured',
        explicitStateMessage:
          'Source not configured (CHANNEL3_API_KEY is not set in server environment).',
        resultCount: 0,
        retrievedAt,
      },
      diagnostic: {
        endpoint,
        httpStatus: null,
        errorCode: 'missing_credential',
        retryAttempts: 0,
        latencyMs: 0,
        safeMessage:
          'Source not configured. Add your authorized CHANNEL3_API_KEY in the AI Studio Secrets panel.',
        retrievedAt,
      },
    };
  }

  const apiKey = rawApiKey!.trim();
  const baseUrl = (options.baseUrl || CHANNEL3_API_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 4500;
  const maxRetries = Math.min(Math.max(0, options.maxRetries ?? 1), 2);
  const fetchFn = options.fetchFn || fetch;
  const sleepFn =
    options.sleepFn || ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  const cleanedQuery = cleanChannel3SearchQuery(rawQuery) || rawQuery.trim();
  if (!cleanedQuery && !params.pageToken) {
    return {
      offers: [],
      nextPageToken: null,
      report: {
        sourceId: CHANNEL3_SOURCE_ID,
        sourceName: CHANNEL3_SOURCE_NAME,
        configured: true,
        queried: false,
        status: 'no_results',
        explicitStateMessage: 'Empty search query skipped.',
        resultCount: 0,
        retrievedAt,
      },
      diagnostic: {
        endpoint,
        httpStatus: null,
        errorCode: 'validation_422',
        retryAttempts: 0,
        latencyMs: 0,
        safeMessage: 'Search query is empty.',
        retrievedAt,
      },
    };
  }

  const requestBody: Channel3SearchRequest = {
    query: cleanedQuery || null,
    limit: Math.min(Math.max(1, params.limit ?? 10), 30),
    filters: {
      conditions: ['new', 'used'],
      availability: params.inStockOnly ? ['InStock'] : ['InStock', 'OutOfStock'],
      ...(typeof params.maxBudget === 'number' || typeof params.minBudget === 'number'
        ? {
            price: {
              ...(typeof params.minBudget === 'number'
                ? { min_price: params.minBudget }
                : {}),
              ...(typeof params.maxBudget === 'number'
                ? { max_price: params.maxBudget }
                : {}),
            },
          }
        : {}),
    },
    config: {
      mode: params.mode || 'default',
      currency: params.currency || 'USD',
      ...(params.country ? { country: params.country } : {}),
    },
    ...(params.pageToken ? { page_token: params.pageToken } : {}),
  };

  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (options.userId && options.userId.trim()) {
    headers['x-user-id'] = options.userId.trim();
  }

  const startMs = Date.now();
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const response = await fetchWithTimeout(
        fetchFn,
        `${baseUrl}${endpoint}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
        },
        timeoutMs
      );

      const latencyMs = Math.max(1, Date.now() - startMs);

      if (response.ok) {
        const json = (await response.json()) as {
          products?: unknown;
          next_page_token?: unknown;
        };

        if (!json || typeof json !== 'object' || !Array.isArray(json.products)) {
          return {
            offers: [],
            nextPageToken: null,
            report: {
              sourceId: CHANNEL3_SOURCE_ID,
              sourceName: CHANNEL3_SOURCE_NAME,
              configured: true,
              queried: true,
              status: 'live_search_failed',
              explicitStateMessage:
                'Live search failed (Channel3 response did not match documented SearchResponse schema).',
              resultCount: 0,
              retrievedAt,
            },
            diagnostic: {
              endpoint,
              httpStatus: response.status,
              errorCode: 'invalid_schema',
              retryAttempts: attempt,
              latencyMs,
              safeMessage:
                'Channel3 API returned 200 OK but payload lacked a products[] array.',
              retrievedAt,
            },
          };
        }

        const offers: ProductOffer[] = [];
        for (const rawProd of json.products) {
          const prodOffers = normalizeChannel3ProductToOffers(
            rawProd as Channel3RawProduct,
            retrievedAt
          );
          offers.push(...prodOffers);
        }

        const nextPageToken =
          typeof json.next_page_token === 'string' && json.next_page_token.trim()
            ? json.next_page_token.trim()
            : null;

        return {
          offers,
          nextPageToken,
          report: {
            sourceId: CHANNEL3_SOURCE_ID,
            sourceName: CHANNEL3_SOURCE_NAME,
            configured: true,
            queried: true,
            status: offers.length > 0 ? 'verified_ok' : 'no_results',
            explicitStateMessage:
              offers.length > 0
                ? `Retrieved ${offers.length} verified merchant offer(s) across ${json.products.length} product(s) from Channel3.`
                : 'No verified results found from Channel3 for this query.',
            resultCount: offers.length,
            retrievedAt,
          },
          diagnostic: {
            endpoint,
            httpStatus: response.status,
            errorCode: 'none',
            retryAttempts: attempt,
            latencyMs,
            safeMessage: `Authenticated request succeeded (${offers.length} offers normalized in ${latencyMs}ms).`,
            retrievedAt,
          },
        };
      }

      // Handle non-200 status codes according to documented Channel3 error responses
      const detail = await extractSafeErrorDetail(response, apiKey);

      if (response.status === 401 || response.status === 403) {
        return {
          offers: [],
          nextPageToken: null,
          report: {
            sourceId: CHANNEL3_SOURCE_ID,
            sourceName: CHANNEL3_SOURCE_NAME,
            configured: true,
            queried: true,
            status: 'live_search_failed',
            explicitStateMessage: `Live search failed (HTTP ${response.status} — invalid, unauthorized, or expired CHANNEL3_API_KEY).`,
            resultCount: 0,
            retrievedAt,
          },
          diagnostic: {
            endpoint,
            httpStatus: response.status,
            errorCode: 'unauthorized_401',
            retryAttempts: attempt,
            latencyMs,
            safeMessage: `Channel3 authentication failed (HTTP ${response.status}): ${detail}`,
            retrievedAt,
          },
        };
      }

      if (response.status === 402) {
        return {
          offers: [],
          nextPageToken: null,
          report: {
            sourceId: CHANNEL3_SOURCE_ID,
            sourceName: CHANNEL3_SOURCE_NAME,
            configured: true,
            queried: true,
            status: 'live_search_failed',
            explicitStateMessage:
              'Live search failed (HTTP 402 Payment Required — Channel3 API credits exhausted).',
            resultCount: 0,
            retrievedAt,
          },
          diagnostic: {
            endpoint,
            httpStatus: 402,
            errorCode: 'credits_exhausted_402',
            retryAttempts: attempt,
            latencyMs,
            safeMessage: `Channel3 credits exhausted (HTTP 402): ${detail}`,
            retrievedAt,
          },
        };
      }

      if (response.status === 429) {
        const retryAfterHeader = response.headers?.get?.('retry-after');
        const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : 1;
        const waitMs =
          Number.isFinite(retryAfterSec) && retryAfterSec > 0
            ? Math.min(retryAfterSec * 1000, 2000)
            : 500;

        if (attempt < maxRetries) {
          attempt++;
          await sleepFn(waitMs);
          continue;
        }

        return {
          offers: [],
          nextPageToken: null,
          report: {
            sourceId: CHANNEL3_SOURCE_ID,
            sourceName: CHANNEL3_SOURCE_NAME,
            configured: true,
            queried: true,
            status: 'live_search_failed',
            explicitStateMessage:
              'Live search failed (HTTP 429 Too Many Requests — Channel3 rate limit reached).',
            resultCount: 0,
            retrievedAt,
          },
          diagnostic: {
            endpoint,
            httpStatus: 429,
            errorCode: 'rate_limited_429',
            retryAttempts: attempt,
            latencyMs,
            safeMessage: `Channel3 rate limit exceeded (HTTP 429): ${detail}`,
            retrievedAt,
          },
        };
      }

      if (response.status === 422 || response.status === 400) {
        return {
          offers: [],
          nextPageToken: null,
          report: {
            sourceId: CHANNEL3_SOURCE_ID,
            sourceName: CHANNEL3_SOURCE_NAME,
            configured: true,
            queried: true,
            status: 'live_search_failed',
            explicitStateMessage: `Live search failed (HTTP ${response.status} request validation error).`,
            resultCount: 0,
            retrievedAt,
          },
          diagnostic: {
            endpoint,
            httpStatus: response.status,
            errorCode: response.status === 422 ? 'validation_422' : 'bad_request_400',
            retryAttempts: attempt,
            latencyMs,
            safeMessage: `Channel3 validation error (HTTP ${response.status}): ${detail}`,
            retrievedAt,
          },
        };
      }

      // Transient 5xx errors: bounded retry
      if (response.status >= 500 && attempt < maxRetries) {
        attempt++;
        await sleepFn(300 * attempt);
        continue;
      }

      return {
        offers: [],
        nextPageToken: null,
        report: {
          sourceId: CHANNEL3_SOURCE_ID,
          sourceName: CHANNEL3_SOURCE_NAME,
          configured: true,
          queried: true,
          status: 'live_search_failed',
          explicitStateMessage: `Live search failed (Channel3 HTTP ${response.status}).`,
          resultCount: 0,
          retrievedAt,
        },
        diagnostic: {
          endpoint,
          httpStatus: response.status,
          errorCode: 'upstream_5xx',
          retryAttempts: attempt,
          latencyMs,
          safeMessage: `Channel3 upstream error (HTTP ${response.status}): ${detail}`,
          retrievedAt,
        },
      };
    } catch (err) {
      const latencyMs = Math.max(1, Date.now() - startMs);
      const rawErrMsg = err instanceof Error ? err.message : 'Network error';
      const isTimeout =
        /abort|timeout/i.test(rawErrMsg) ||
        (err instanceof Error && err.name === 'AbortError');

      if (attempt < maxRetries) {
        attempt++;
        await sleepFn(250 * attempt);
        continue;
      }

      return {
        offers: [],
        nextPageToken: null,
        report: {
          sourceId: CHANNEL3_SOURCE_ID,
          sourceName: CHANNEL3_SOURCE_NAME,
          configured: true,
          queried: true,
          status: 'live_search_failed',
          explicitStateMessage: isTimeout
            ? 'Live search failed (Channel3 request timed out).'
            : 'Live search failed (Channel3 network error).',
          resultCount: 0,
          retrievedAt,
        },
        diagnostic: {
          endpoint,
          httpStatus: null,
          errorCode: isTimeout ? 'timeout' : 'network_error',
          retryAttempts: attempt,
          latencyMs,
          safeMessage: redactChannel3Secret(
            isTimeout
              ? `Channel3 request timed out after ${timeoutMs}ms.`
              : `Channel3 network error: ${rawErrMsg}`,
            apiKey
          ),
          retrievedAt,
        },
      };
    }
  }

  return {
    offers: [],
    nextPageToken: null,
    report: {
      sourceId: CHANNEL3_SOURCE_ID,
      sourceName: CHANNEL3_SOURCE_NAME,
      configured: true,
      queried: true,
      status: 'live_search_failed',
      explicitStateMessage: 'Live search failed.',
      resultCount: 0,
      retrievedAt,
    },
    diagnostic: {
      endpoint,
      httpStatus: null,
      errorCode: 'network_error',
      retryAttempts: attempt,
      latencyMs: Math.max(1, Date.now() - startMs),
      safeMessage: 'Channel3 request exhausted bounded retries.',
      retrievedAt,
    },
  };
}

/**
 * Executes an authenticated request to Channel3's documented `POST /v1/lookup` endpoint
 * to resolve canonical product details and cross-merchant offers for a product URL.
 */
export async function queryChannel3UrlLookup(
  productUrl: string,
  options: Channel3AdapterOptions = {}
): Promise<Channel3ExecutionResult> {
  const retrievedAt = new Date().toISOString();
  const endpoint = '/v1/lookup';
  const rawApiKey =
    options.apiKey !== undefined ? options.apiKey : process.env.CHANNEL3_API_KEY;

  if (!isChannel3CredentialConfigured(rawApiKey)) {
    return {
      offers: [],
      nextPageToken: null,
      report: {
        sourceId: CHANNEL3_SOURCE_ID,
        sourceName: CHANNEL3_SOURCE_NAME,
        configured: false,
        queried: false,
        status: 'source_not_configured',
        explicitStateMessage:
          'Source not configured (CHANNEL3_API_KEY is not set in server environment).',
        resultCount: 0,
        retrievedAt,
      },
      diagnostic: {
        endpoint,
        httpStatus: null,
        errorCode: 'missing_credential',
        retryAttempts: 0,
        latencyMs: 0,
        safeMessage: 'Source not configured.',
        retrievedAt,
      },
    };
  }

  const apiKey = rawApiKey!.trim();
  const baseUrl = (options.baseUrl || CHANNEL3_API_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 4500;
  const fetchFn = options.fetchFn || fetch;
  const startMs = Date.now();

  try {
    const response = await fetchWithTimeout(
      fetchFn,
      `${baseUrl}${endpoint}`,
      {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ url: productUrl.trim() }),
      },
      timeoutMs
    );

    const latencyMs = Math.max(1, Date.now() - startMs);

    if (!response.ok) {
      const detail = await extractSafeErrorDetail(response, apiKey);
      return {
        offers: [],
        nextPageToken: null,
        report: {
          sourceId: CHANNEL3_SOURCE_ID,
          sourceName: CHANNEL3_SOURCE_NAME,
          configured: true,
          queried: true,
          status: 'live_search_failed',
          explicitStateMessage: `Live search failed (Channel3 URL lookup HTTP ${response.status}).`,
          resultCount: 0,
          retrievedAt,
        },
        diagnostic: {
          endpoint,
          httpStatus: response.status,
          errorCode:
            response.status === 401 || response.status === 403
              ? 'unauthorized_401'
              : response.status === 402
              ? 'credits_exhausted_402'
              : response.status === 429
              ? 'rate_limited_429'
              : 'upstream_5xx',
          retryAttempts: 0,
          latencyMs,
          safeMessage: `Channel3 URL lookup failed (HTTP ${response.status}): ${detail}`,
          retrievedAt,
        },
      };
    }

    const json = (await response.json()) as {
      product?: Channel3RawProduct | null;
      id?: string;
      title?: string;
      offers?: Channel3RawOffer[];
    };

    const productRecord: Channel3RawProduct | null =
      json && typeof json === 'object' && json.product
        ? json.product
        : json && typeof json.id === 'string' && typeof json.title === 'string'
        ? (json as Channel3RawProduct)
        : null;

    const offers = productRecord
      ? normalizeChannel3ProductToOffers(productRecord, retrievedAt)
      : [];

    return {
      offers,
      nextPageToken: null,
      report: {
        sourceId: CHANNEL3_SOURCE_ID,
        sourceName: CHANNEL3_SOURCE_NAME,
        configured: true,
        queried: true,
        status: offers.length > 0 ? 'verified_ok' : 'no_results',
        explicitStateMessage:
          offers.length > 0
            ? `Resolved ${offers.length} verified offer(s) via Channel3 URL lookup.`
            : 'No verified product record found for the supplied URL.',
        resultCount: offers.length,
        retrievedAt,
      },
      diagnostic: {
        endpoint,
        httpStatus: response.status,
        errorCode: 'none',
        retryAttempts: 0,
        latencyMs,
        safeMessage: `Channel3 URL lookup succeeded (${offers.length} offers).`,
        retrievedAt,
      },
    };
  } catch (err) {
    const latencyMs = Math.max(1, Date.now() - startMs);
    const rawMsg = err instanceof Error ? err.message : 'Network error';
    return {
      offers: [],
      nextPageToken: null,
      report: {
        sourceId: CHANNEL3_SOURCE_ID,
        sourceName: CHANNEL3_SOURCE_NAME,
        configured: true,
        queried: true,
        status: 'live_search_failed',
        explicitStateMessage: 'Live search failed (Channel3 URL lookup error).',
        resultCount: 0,
        retrievedAt,
      },
      diagnostic: {
        endpoint,
        httpStatus: null,
        errorCode: 'network_error',
        retryAttempts: 0,
        latencyMs,
        safeMessage: redactChannel3Secret(`Channel3 URL lookup error: ${rawMsg}`, apiKey),
        retrievedAt,
      },
    };
  }
}

/**
 * Executes an authenticated request to Channel3's documented `GET /v1/products/{product_id}` endpoint.
 */
export async function queryChannel3ProductDetail(
  productId: string,
  currency: 'USD' | 'EUR' | 'GBP' = 'USD',
  options: Channel3AdapterOptions = {}
): Promise<Channel3ExecutionResult> {
  const retrievedAt = new Date().toISOString();
  const cleanId = encodeURIComponent(productId.trim());
  const endpoint = `/v1/products/${cleanId}`;
  const rawApiKey =
    options.apiKey !== undefined ? options.apiKey : process.env.CHANNEL3_API_KEY;

  if (!isChannel3CredentialConfigured(rawApiKey)) {
    return {
      offers: [],
      nextPageToken: null,
      report: {
        sourceId: CHANNEL3_SOURCE_ID,
        sourceName: CHANNEL3_SOURCE_NAME,
        configured: false,
        queried: false,
        status: 'source_not_configured',
        explicitStateMessage:
          'Source not configured (CHANNEL3_API_KEY is not set in server environment).',
        resultCount: 0,
        retrievedAt,
      },
      diagnostic: {
        endpoint,
        httpStatus: null,
        errorCode: 'missing_credential',
        retryAttempts: 0,
        latencyMs: 0,
        safeMessage: 'Source not configured.',
        retrievedAt,
      },
    };
  }

  const apiKey = rawApiKey!.trim();
  const baseUrl = (options.baseUrl || CHANNEL3_API_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 4500;
  const fetchFn = options.fetchFn || fetch;
  const startMs = Date.now();

  try {
    const response = await fetchWithTimeout(
      fetchFn,
      `${baseUrl}${endpoint}?currency=${encodeURIComponent(currency)}`,
      {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          Accept: 'application/json',
        },
      },
      timeoutMs
    );

    const latencyMs = Math.max(1, Date.now() - startMs);
    if (!response.ok) {
      const detail = await extractSafeErrorDetail(response, apiKey);
      return {
        offers: [],
        nextPageToken: null,
        report: {
          sourceId: CHANNEL3_SOURCE_ID,
          sourceName: CHANNEL3_SOURCE_NAME,
          configured: true,
          queried: true,
          status: 'live_search_failed',
          explicitStateMessage: `Live search failed (Channel3 Product Detail HTTP ${response.status}).`,
          resultCount: 0,
          retrievedAt,
        },
        diagnostic: {
          endpoint,
          httpStatus: response.status,
          errorCode:
            response.status === 401 || response.status === 403
              ? 'unauthorized_401'
              : response.status === 429
              ? 'rate_limited_429'
              : 'upstream_5xx',
          retryAttempts: 0,
          latencyMs,
          safeMessage: `Channel3 product detail failed (HTTP ${response.status}): ${detail}`,
          retrievedAt,
        },
      };
    }

    const rawProduct = (await response.json()) as Channel3RawProduct;
    const offers = normalizeChannel3ProductToOffers(rawProduct, retrievedAt);

    return {
      offers,
      nextPageToken: null,
      report: {
        sourceId: CHANNEL3_SOURCE_ID,
        sourceName: CHANNEL3_SOURCE_NAME,
        configured: true,
        queried: true,
        status: offers.length > 0 ? 'verified_ok' : 'no_results',
        explicitStateMessage:
          offers.length > 0
            ? `Retrieved ${offers.length} verified offer(s) for Channel3 product ${productId}.`
            : 'No verified offers found for this Channel3 product ID.',
        resultCount: offers.length,
        retrievedAt,
      },
      diagnostic: {
        endpoint,
        httpStatus: response.status,
        errorCode: 'none',
        retryAttempts: 0,
        latencyMs,
        safeMessage: `Channel3 product detail succeeded (${offers.length} offers).`,
        retrievedAt,
      },
    };
  } catch (err) {
    const latencyMs = Math.max(1, Date.now() - startMs);
    const rawMsg = err instanceof Error ? err.message : 'Network error';
    return {
      offers: [],
      nextPageToken: null,
      report: {
        sourceId: CHANNEL3_SOURCE_ID,
        sourceName: CHANNEL3_SOURCE_NAME,
        configured: true,
        queried: true,
        status: 'live_search_failed',
        explicitStateMessage: 'Live search failed (Channel3 product detail network error).',
        resultCount: 0,
        retrievedAt,
      },
      diagnostic: {
        endpoint,
        httpStatus: null,
        errorCode: 'network_error',
        retryAttempts: 0,
        latencyMs,
        safeMessage: redactChannel3Secret(`Channel3 product detail error: ${rawMsg}`, apiKey),
        retrievedAt,
      },
    };
  }
}

/**
 * Executes an authenticated request to Channel3's documented `POST /v1/similar` endpoint
 * using an original Channel3 product_id (never a free-text query).
 */
export async function queryChannel3SimilarProducts(
  channel3ProductId: string,
  params: {
    limit?: number;
    currency?: 'USD' | 'EUR' | 'GBP';
  } = {},
  options: Channel3AdapterOptions = {}
): Promise<Channel3ExecutionResult> {
  const retrievedAt = new Date().toISOString();
  const endpoint = '/v1/similar';
  const cleanId = (channel3ProductId || '').trim();

  if (!cleanId || /\s/.test(cleanId)) {
    return {
      offers: [],
      nextPageToken: null,
      report: {
        sourceId: CHANNEL3_SOURCE_ID,
        sourceName: CHANNEL3_SOURCE_NAME,
        configured: isChannel3CredentialConfigured(options.apiKey),
        queried: false,
        status: 'live_search_failed',
        explicitStateMessage:
          'Channel3 /v1/similar requires a valid Channel3 product_id (free-text queries are rejected).',
        resultCount: 0,
        retrievedAt,
      },
      diagnostic: {
        endpoint,
        httpStatus: null,
        errorCode: 'validation_422',
        retryAttempts: 0,
        latencyMs: 0,
        safeMessage: 'Invalid Channel3 product_id passed to /v1/similar.',
        retrievedAt,
      },
    };
  }

  const rawApiKey =
    options.apiKey !== undefined ? options.apiKey : process.env.CHANNEL3_API_KEY;

  if (!isChannel3CredentialConfigured(rawApiKey)) {
    return {
      offers: [],
      nextPageToken: null,
      report: {
        sourceId: CHANNEL3_SOURCE_ID,
        sourceName: CHANNEL3_SOURCE_NAME,
        configured: false,
        queried: false,
        status: 'source_not_configured',
        explicitStateMessage:
          'Source not configured (CHANNEL3_API_KEY is not set in server environment).',
        resultCount: 0,
        retrievedAt,
      },
      diagnostic: {
        endpoint,
        httpStatus: null,
        errorCode: 'missing_credential',
        retryAttempts: 0,
        latencyMs: 0,
        safeMessage: 'Source not configured.',
        retrievedAt,
      },
    };
  }

  const apiKey = rawApiKey!.trim();
  const baseUrl = (options.baseUrl || CHANNEL3_API_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 4500;
  const fetchFn = options.fetchFn || fetch;
  const startMs = Date.now();

  try {
    const response = await fetchWithTimeout(
      fetchFn,
      `${baseUrl}${endpoint}`,
      {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          product_id: cleanId,
          limit: Math.min(Math.max(1, params.limit ?? 6), 20),
          config: {
            currency: params.currency || 'USD',
          },
        }),
      },
      timeoutMs
    );

    const latencyMs = Math.max(1, Date.now() - startMs);
    if (!response.ok) {
      const detail = await extractSafeErrorDetail(response, apiKey);
      return {
        offers: [],
        nextPageToken: null,
        report: {
          sourceId: CHANNEL3_SOURCE_ID,
          sourceName: CHANNEL3_SOURCE_NAME,
          configured: true,
          queried: true,
          status: 'live_search_failed',
          explicitStateMessage: `Live search failed (Channel3 Similar Products HTTP ${response.status}).`,
          resultCount: 0,
          retrievedAt,
        },
        diagnostic: {
          endpoint,
          httpStatus: response.status,
          errorCode:
            response.status === 401 || response.status === 403
              ? 'unauthorized_401'
              : response.status === 429
              ? 'rate_limited_429'
              : 'upstream_5xx',
          retryAttempts: 0,
          latencyMs,
          safeMessage: `Channel3 similar products failed (HTTP ${response.status}): ${detail}`,
          retrievedAt,
        },
      };
    }

    const json = (await response.json()) as { products?: Channel3RawProduct[] };
    const products = Array.isArray(json?.products) ? json.products : [];
    const offers: ProductOffer[] = [];
    for (const rawProd of products) {
      offers.push(...normalizeChannel3ProductToOffers(rawProd, retrievedAt));
    }

    return {
      offers,
      nextPageToken: null,
      report: {
        sourceId: CHANNEL3_SOURCE_ID,
        sourceName: CHANNEL3_SOURCE_NAME,
        configured: true,
        queried: true,
        status: offers.length > 0 ? 'verified_ok' : 'no_results',
        explicitStateMessage:
          offers.length > 0
            ? `Retrieved ${offers.length} similar product offer(s) for Channel3 product ${cleanId}.`
            : `No similar products returned by Channel3 for ${cleanId}.`,
        resultCount: offers.length,
        retrievedAt,
      },
      diagnostic: {
        endpoint,
        httpStatus: response.status,
        errorCode: 'none',
        retryAttempts: 0,
        latencyMs,
        safeMessage: `Channel3 similar products succeeded (${offers.length} offers).`,
        retrievedAt,
      },
    };
  } catch (err) {
    const latencyMs = Math.max(1, Date.now() - startMs);
    const rawMsg = err instanceof Error ? err.message : 'Network error';
    return {
      offers: [],
      nextPageToken: null,
      report: {
        sourceId: CHANNEL3_SOURCE_ID,
        sourceName: CHANNEL3_SOURCE_NAME,
        configured: true,
        queried: true,
        status: 'live_search_failed',
        explicitStateMessage: 'Live search failed (Channel3 similar products network error).',
        resultCount: 0,
        retrievedAt,
      },
      diagnostic: {
        endpoint,
        httpStatus: null,
        errorCode: 'network_error',
        retryAttempts: 0,
        latencyMs,
        safeMessage: redactChannel3Secret(`Channel3 similar products error: ${rawMsg}`, apiKey),
        retrievedAt,
      },
    };
  }
}
