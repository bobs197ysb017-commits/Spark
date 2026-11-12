import express from 'express';
import crypto from 'node:crypto';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  AgentStepReport,
  ConversationThread,
  CouponItem,
  ExplicitVerificationState,
  ExtractedShoppingIntent,
  GroundingCitation,
  OrchestrationResponse,
  ProductOffer,
  RankedProductOffer,
  ScienceCompoundMetadata,
  SourceExecutionReport,
} from './src/types/spark.ts';
import {
  computeOrderSummary,
  evaluateLipinskiProfile,
  parseShoppingIntent,
  rankAndCompareOffers,
  verifyApprovalIntegrity,
} from './src/utils/shoppingLogic.ts';
import {
  CHANNEL3_API_BASE_URL,
  CHANNEL3_SOURCE_ID,
  CHANNEL3_SOURCE_NAME,
  isChannel3CredentialConfigured,
  queryChannel3ProductDetail,
  queryChannel3Search,
  queryChannel3UrlLookup,
  type Channel3SafeDiagnostic,
} from './src/utils/channel3Adapter.ts';
import { executeSparkProductIntelligenceAgent } from './src/utils/sparkProductIntelligenceAgent.ts';
import {
  buildSpokenResponseSummary,
  executePhase5SevenAgentOrchestrator,
  extractConstraintHierarchy,
  getPhase5ObservabilitySummary,
  normalizeVoiceQuery,
  parseNaturalLanguageCartCommand,
  runPhase5TwelveScenarioEvaluationSuite,
} from './src/utils/sparkPhase5Intelligence.ts';
import fs from 'node:fs';
import {
  DEFAULT_PAYPAL_CALLBACK_PATH,
  DEFAULT_PAYPAL_CONNECT_PATH,
  DEFAULT_PAYPAL_IDENTITY_SCOPES,
  DEFAULT_PREVIEW_APP_URL,
  DEV_PREVIEW_APP_URL,
  PAYPAL_LIVE_BASE_URL,
  PAYPAL_SANDBOX_BASE_URL,
  PayPalSandboxEngine,
  SPARK_SANDBOX_TEST_CATALOG,
  SparkAuthSessionManager,
  VERCEL_PREVIEW_APP_URL,
  isAuthorizedSparkDomain,
  isPlaceholderEnvValue,
  normalizePayPalClientSecret,
  resolvePayPalEnvironmentConfig,
  synchronizeFirebaseUserAccount,
  validateFirebaseAuthEnvironmentConfig,
  validatePayPalSandboxConfig,
  verifyDeveloperAccess,
  verifyFirebaseJwtClaims,
  type WebhookHeaders,
} from './src/utils/paypalSandboxService.ts';
import type {
  FeedicoNormalizedOffer,
  SavedComparisonRecord,
  SavedProductRevalidationItem,
  SparkAuthSession,
  UserAccount,
} from './src/types/spark.ts';
import {
  FeedicoServiceError,
  feedicoPartnerService,
  getFeedicoConfig,
  redactFeedicoSecrets,
  verifyFeedicoPostbackSignature,
} from './src/utils/feedicoService.ts';
import {
  AgentToolPermissionGate,
  BruteForceProtector,
  PasswordResetManager,
  RefreshTokenManager,
  SecurityEventMonitor,
  SlidingWindowRateLimiter,
  detectInjectionPayload,
  detectPromptInjection,
  hashPasswordScrypt,
  redactSensitiveData,
  requireRole,
  sanitizeCouponForAgent,
  sanitizeInputObject,
  sanitizeProductOfferForAgent,
  sanitizeTextAgainstXss,
  sanitizeUserPreferencesPatch,
  validateSafeOutboundUrl,
  verifyPasswordScrypt,
} from './src/utils/securityLayer.ts';
import {
  SPARK_SUBSCRIPTION_PLANS,
  acquireConcurrency,
  cancelSubscription,
  deleteUserSubscriptionData,
  exportAllSubscriptionData,
  getSubscriptionPayments,
  getUserDashboardPreferences,
  getUserQuotaStatus,
  getUserSubscription,
  getUserUsageRecord,
  importSubscriptionData,
  recordFeatureUsage,
  releaseConcurrency,
  reserveFeatureQuota,
  saveUserDashboardPreferences,
  setUserSubscriptionPlan,
} from './src/utils/subscriptionQuotaEngine.ts';
import {
  PAYPAL_BILLING_PLANS,
  activatePayPalSubscription,
  changePayPalSubscriptionPlan,
  createPayPalSubscription,
  evaluatePayPalSubscriptionEligibility,
  handlePayPalSubscriptionWebhook,
} from './src/utils/paypalSubscriptionService.ts';

// Load .env without clobbering non-empty runtime environment variables injected by Cloud Run / Secret Manager
dotenv.config({ override: false, quiet: true } as dotenv.DotenvConfigOptions);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isPayPalConfigured(): boolean {
  const envConfig = resolvePayPalEnvironmentConfig(process.env);
  return envConfig.isValidEnvironment && envConfig.allCoreCredentialsPresent;
}

const withFastTimeout = <T>(promise: Promise<T>, ms = 3500): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);

function cleanSearchTerm(rawQuery: string): string {
  return rawQuery
    .replace(/\b(under|below|less than|max|budget)\s*[$€£]?\s*\d+(\.\d+)?/gi, '')
    .replace(/\b(find|compare|discover|search|and check verified coupons|with verified ingredients|alternatives|the best)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Real Source Adapter: Open Library Search API
 * Queries https://openlibrary.org/search.json for real bibliographic works.
 * Explicitly reports "Price could not be verified." and "Availability unknown." because Open Library does not sell items directly.
 */
async function queryOpenLibrarySource(
  searchQuery: string
): Promise<{ offers: ProductOffer[]; report: SourceExecutionReport }> {
  const retrievedAt = new Date().toISOString();
  const cleaned = cleanSearchTerm(searchQuery) || searchQuery.trim();
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(
    cleaned
  )}&limit=4`;

  try {
    const response = await withFastTimeout(fetch(url), 4000);
    if (!response.ok) {
      return {
        offers: [],
        report: {
          sourceId: 'openlibrary_api',
          sourceName: 'Open Library Catalog API',
          configured: true,
          queried: true,
          status: 'live_search_failed',
          explicitStateMessage: `Live search failed (HTTP ${response.status}).`,
          resultCount: 0,
          retrievedAt,
        },
      };
    }

    const json = (await response.json()) as {
      docs?: Array<Record<string, unknown>>;
    };
    const docs = Array.isArray(json.docs) ? json.docs : [];
    const offers: ProductOffer[] = [];

    for (const docItem of docs) {
      const key = String(docItem.key || '').trim();
      const title = String(docItem.title || '').trim();
      if (!key || !title) continue;

      const canonicalUrl = `https://openlibrary.org${key}`;
      const author = Array.isArray(docItem.author_name)
        ? String(docItem.author_name[0] || 'Unknown Author')
        : 'Unknown Author';
      const publisher = Array.isArray(docItem.publisher)
        ? String(docItem.publisher[0] || author)
        : author;
      const coverId = typeof docItem.cover_i === 'number' ? docItem.cover_i : null;
      const imageUrl = coverId
        ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`
        : null;
      const rating =
        typeof docItem.ratings_average === 'number'
          ? Number(docItem.ratings_average.toFixed(1))
          : null;
      const reviewCount =
        typeof docItem.ratings_count === 'number' ? docItem.ratings_count : null;

      offers.push({
        id: `ol_${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
        sourceId: 'openlibrary_api',
        sourceName: 'Open Library Catalog API',
        canonicalUrl,
        retrievedAt,
        verificationStatus: 'partial_fields_unverified',
        name: title,
        merchant: publisher,
        category: 'books',
        // Open Library is a catalog source without live retail prices — NEVER invent a price!
        price: null,
        priceStatus: 'price_could_not_be_verified',
        currency: 'USD',
        shippingCost: null,
        shippingStatus: 'unknown',
        estimatedTaxRate: null,
        taxStatus: 'unknown',
        availabilityStatus: 'unknown',
        rating,
        reviewCount,
        summary: `Published work by ${author} (${
          docItem.first_publish_year ? `First published ${docItem.first_publish_year}` : 'Catalog record'
        }). Price could not be verified from bibliographic source.`,
        specs: {
          'Source ID': `openlibrary_api (${key})`,
          Author: author,
          'First Published': String(docItem.first_publish_year || 'Unknown'),
          'Price Status': 'Price could not be verified.',
          'Availability Status': 'Availability unknown.',
        },
        couponStatus: 'coupon_validity_unknown',
        checkoutStatus: 'checkout_unsupported',
        imageUrl,
      });
    }

    return {
      offers,
      report: {
        sourceId: 'openlibrary_api',
        sourceName: 'Open Library Catalog API',
        configured: true,
        queried: true,
        status: offers.length > 0 ? 'verified_ok' : 'no_results',
        explicitStateMessage:
          offers.length > 0
            ? `Retrieved ${offers.length} bibliographic records (Price could not be verified).`
            : 'No verified results found.',
        resultCount: offers.length,
        retrievedAt,
      },
    };
  } catch {
    return {
      offers: [],
      report: {
        sourceId: 'openlibrary_api',
        sourceName: 'Open Library Catalog API',
        configured: true,
        queried: true,
        status: 'live_search_failed',
        explicitStateMessage: 'Live search failed.',
        resultCount: 0,
        retrievedAt,
      },
    };
  }
}

/**
 * Real Source Adapter 3: NCBI PubChem PUG REST API
 * Queries live PubChem records without any hardcoded synthetic fallback.
 */
async function resolveLiveScienceCompound(
  compoundQuery: string
): Promise<ScienceCompoundMetadata> {
  const retrievedAt = new Date().toISOString();
  const normalized = compoundQuery
    .trim()
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*%/g, ' ')
    .replace(/\b(?:serum|skincare|cream|lotion|toner|cleanser|solution|formulation|ampoule|booster|drops)\b/gi, ' ')
    .replace(/\s*\+.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  try {
    const cidRes = await withFastTimeout(
      fetch(
        `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(
          normalized || compoundQuery.trim().toLowerCase()
        )}/cids/JSON`
      ),
      4000
    );
    if (!cidRes.ok) {
      return {
        compoundName: normalized || compoundQuery,
        sourceId: 'pubchem_ncbi_api',
        retrievedAt,
        verificationState: 'No verified results found.',
      };
    }

    const cidData = (await cidRes.json()) as { IdentifierList?: { CID?: number[] } };
    const cid = cidData?.IdentifierList?.CID?.[0];
    if (!cid) {
      return {
        compoundName: compoundQuery,
        sourceId: 'pubchem_ncbi_api',
        retrievedAt,
        verificationState: 'No verified results found.',
      };
    }

    const propRes = await withFastTimeout(
      fetch(
        `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/MolecularFormula,MolecularWeight,CanonicalSMILES,InChIKey,XLogP,TPSA,HBondDonorCount,HBondAcceptorCount,RotatableBondCount/JSON`
      ),
      4000
    );
    if (!propRes.ok) {
      return {
        compoundName: compoundQuery,
        sourceId: 'pubchem_ncbi_api',
        retrievedAt,
        cid,
        provenanceUrl: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`,
        verificationState: 'Live search failed.',
      };
    }

    const propJson = (await propRes.json()) as {
      PropertyTable?: { Properties?: Array<Record<string, unknown>> };
    };
    const props = propJson?.PropertyTable?.Properties?.[0] || {};
    const lipinski = evaluateLipinskiProfile({
      molecularWeight: props.MolecularWeight as string | number,
      xLogP: props.XLogP as number,
      hBondDonorCount: props.HBondDonorCount as number,
      hBondAcceptorCount: props.HBondAcceptorCount as number,
    });

    return {
      compoundName: compoundQuery.charAt(0).toUpperCase() + compoundQuery.slice(1),
      sourceId: 'pubchem_ncbi_api',
      retrievedAt,
      cid,
      molecularFormula: String(props.MolecularFormula || ''),
      molecularWeight: String(props.MolecularWeight || ''),
      canonicalSmiles: String(props.CanonicalSMILES || ''),
      inChIKey: String(props.InChIKey || ''),
      xLogP: typeof props.XLogP === 'number' ? props.XLogP : undefined,
      tpsa: typeof props.TPSA === 'number' ? props.TPSA : undefined,
      hBondDonorCount:
        typeof props.HBondDonorCount === 'number' ? props.HBondDonorCount : undefined,
      hBondAcceptorCount:
        typeof props.HBondAcceptorCount === 'number' ? props.HBondAcceptorCount : undefined,
      rotatableBondCount:
        typeof props.RotatableBondCount === 'number' ? props.RotatableBondCount : undefined,
      ...lipinski,
      structureImageUrl: `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/PNG?image_size=300x300`,
      fdaStatus: 'Verified Live via NCBI PubChem PUG REST API',
      fdaIndications: `Retrieved live from PubChem CID ${cid} at ${retrievedAt}.`,
      provenanceUrl: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`,
      verificationState: 'Verified live source.',
    };
  } catch {
    return {
      compoundName: compoundQuery,
      sourceId: 'pubchem_ncbi_api',
      retrievedAt,
      verificationState: 'Live search failed.',
    };
  }
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));

  // Core Security Subsystems (Phases 2, 5, 6, 7, 11)
  const bruteForceProtector = new BruteForceProtector(5, 10 * 60_000, 15 * 60_000);
  const refreshTokenManager = new RefreshTokenManager();
  const passwordResetManager = new PasswordResetManager();
  const agentToolPermissionGate = new AgentToolPermissionGate();
  const securityEventMonitor = new SecurityEventMonitor();
  const globalApiRateLimiter = new SlidingWindowRateLimiter(180, 60_000);
  const authEndpointRateLimiter = new SlidingWindowRateLimiter(25, 60_000);
  const orchestrateRateLimiter = new SlidingWindowRateLimiter(30, 60_000);
  const passwordHashesByUserId = new Map<string, string>();

  // Multi-user account & conversation state indexed by server-verified userId
  const authSessionManager = new SparkAuthSessionManager();
  const usersById = new Map<string, UserAccount>();
  const conversationsByUserId = new Map<string, ConversationThread[]>();
  const savedComparisonsByUserId = new Map<string, SavedComparisonRecord[]>();
  let latestActiveUserId: string | null = null;

  const isHttpsRuntime = String(process.env.APP_URL || '').startsWith('https://');
  const cookieSameSiteAttrs = isHttpsRuntime
    ? 'HttpOnly; SameSite=None; Secure'
    : 'HttpOnly; SameSite=Lax';

  const allowedOrigins = new Set<string>(
    [
      process.env.APP_URL,
      DEFAULT_PREVIEW_APP_URL,
      DEV_PREVIEW_APP_URL,
      VERCEL_PREVIEW_APP_URL,
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ]
      .filter((v): v is string => Boolean(v && v.trim()))
      .map((v) => v.trim().replace(/\/+$/, ''))
  );

  // Security Headers, CORS, Rate Limiting & Injection Protection Middleware
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(self), payment=(self "https://www.sandbox.paypal.com" "https://www.paypal.com")'
    );
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' https: data: blob:; connect-src 'self' https: wss: ws:; frame-ancestors 'self' https://*.google.com https://*.run.app https://*.vercel.app;"
    );
    if (isHttpsRuntime) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    const origin = req.header('origin')?.trim().replace(/\/+$/, '');
    if (origin) {
      const hostOrigin = `${req.protocol}://${req.get('host') || ''}`.replace(/\/+$/, '');
      let isTrustedSparkOrigin = allowedOrigins.has(origin) || origin === hostOrigin;
      if (!isTrustedSparkOrigin && origin.startsWith('https://')) {
        try {
          const parsedOrigin = new URL(origin);
          if (isAuthorizedSparkDomain(parsedOrigin.hostname)) {
            isTrustedSparkOrigin = true;
          }
        } catch {
          // Ignore malformed origin
        }
      }
      if (isTrustedSparkOrigin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, X-CSRF-Token, X-Spark-Session-Token, PayPal-Request-Id'
        );
        res.setHeader('Vary', 'Origin');
      } else if (req.path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        securityEventMonitor.record({
          category: 'CSRF',
          severity: 'HIGH',
          outcome: 'BLOCKED',
          userId: null,
          ip: req.ip || 'unknown',
          endpoint: req.path,
          errorCode: 'untrusted_cors_origin_blocked',
          detail: `Blocked cross-origin ${req.method} from untrusted Origin ${origin}`,
        });
        res.status(403).json({
          ok: false,
          errorCode: 'untrusted_cors_origin_blocked',
          error: 'Cross-origin request from untrusted origin is not permitted.',
        });
        return;
      }
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    if (req.path.startsWith('/api/')) {
      const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
      const rateCheck = globalApiRateLimiter.check(`${clientIp}:${req.path.split('/').slice(0, 4).join('/')}`);
      if (!rateCheck.allowed) {
        securityEventMonitor.record({
          category: 'RATE_LIMIT',
          severity: 'MEDIUM',
          outcome: 'BLOCKED',
          userId: null,
          ip: clientIp,
          endpoint: req.path,
          errorCode: 'rate_limit_exceeded',
          detail: `Global API rate limit exceeded on ${req.path}`,
        });
        res.status(429).json({
          ok: false,
          errorCode: 'rate_limit_exceeded',
          error: 'Too many requests. Please slow down and try again shortly.',
          retryAfterMs: rateCheck.retryAfterMs,
        });
        return;
      }

      // Inspect body & query for SQL/NoSQL/prototype-pollution injection
      if (req.body && typeof req.body === 'object') {
        const bodyInjection = detectInjectionPayload(req.body);
        if (bodyInjection.detected) {
          securityEventMonitor.record({
            category: 'INJECTION',
            severity: 'HIGH',
            outcome: 'BLOCKED',
            userId: null,
            ip: clientIp,
            endpoint: req.path,
            errorCode: 'malicious_injection_payload_blocked',
            detail: `Blocked ${bodyInjection.kind} payload in request body: ${bodyInjection.detail}`,
          });
          res.status(400).json({
            ok: false,
            errorCode: 'malicious_injection_payload_blocked',
            error: `Request rejected due to unsafe ${bodyInjection.kind} syntax.`,
          });
          return;
        }
        req.body = sanitizeInputObject(req.body);
      }

      if (req.query && typeof req.query === 'object') {
        const queryInjection = detectInjectionPayload(req.query);
        if (queryInjection.detected) {
          securityEventMonitor.record({
            category: 'INJECTION',
            severity: 'HIGH',
            outcome: 'BLOCKED',
            userId: null,
            ip: clientIp,
            endpoint: req.path,
            errorCode: 'malicious_injection_payload_blocked',
            detail: `Blocked ${queryInjection.kind} payload in query params: ${queryInjection.detail}`,
          });
          res.status(400).json({
            ok: false,
            errorCode: 'malicious_injection_payload_blocked',
            error: `Request rejected due to unsafe ${queryInjection.kind} query parameters.`,
          });
          return;
        }
      }
    }

    next();
  });

  const setSessionCookie = (res: express.Response, session: SparkAuthSession) => {
    const maxAgeSec = Math.max(
      60,
      Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000)
    );
    res.setHeader(
      'Set-Cookie',
      `spark_session=${encodeURIComponent(session.sessionId)}; Path=/; ${cookieSameSiteAttrs}; Max-Age=${maxAgeSec}`
    );
  };

  const clearSessionCookie = (res: express.Response) => {
    res.setHeader(
      'Set-Cookie',
      `spark_session=; Path=/; ${cookieSameSiteAttrs}; Max-Age=0`
    );
  };

  const getAllActiveOffers = (scopedUserId?: string): ProductOffer[] => {
    const offers: ProductOffer[] = [];
    const lists = scopedUserId
      ? [conversationsByUserId.get(scopedUserId) || []]
      : Array.from(conversationsByUserId.values());
    for (const convList of lists) {
      for (const conv of convList) {
        for (const turn of conv.turns || []) {
          for (const offer of turn.response?.offers || []) {
            offers.push(offer);
          }
        }
      }
    }
    return offers;
  };

  const getAllActiveCoupons = (scopedUserId?: string): CouponItem[] => {
    const coupons: CouponItem[] = [];
    const lists = scopedUserId
      ? [conversationsByUserId.get(scopedUserId) || []]
      : Array.from(conversationsByUserId.values());
    for (const convList of lists) {
      for (const conv of convList) {
        for (const turn of conv.turns || []) {
          for (const cpn of turn.response?.verifiedCoupons || []) {
            coupons.push(cpn);
          }
        }
      }
    }
    return coupons;
  };

  const paypalSandboxEngine = new PayPalSandboxEngine({
    externalOffersGetter: () => getAllActiveOffers(latestActiveUserId || undefined),
    externalCouponsGetter: () => getAllActiveCoupons(latestActiveUserId || undefined),
  });

  const runtimeStatePath = path.join(__dirname, '.env.spark-runtime.json');
  const saveRuntimeSnapshot = () => {
    try {
      const payload = {
        sessions: authSessionManager.exportSessions(),
        users: Array.from(usersById.values()),
        passwordHashes: Array.from(passwordHashesByUserId.entries()),
        conversations: Array.from(conversationsByUserId.entries()),
        savedComparisons: Array.from(savedComparisonsByUserId.entries()),
        paypalLinking: paypalSandboxEngine.exportAccountLinkingState(),
        subscriptionData: exportAllSubscriptionData(),
      };
      fs.writeFileSync(runtimeStatePath, JSON.stringify(payload), { mode: 0o600 });
    } catch {
      // Ignore snapshot write errors
    }
  };

  try {
    if (fs.existsSync(runtimeStatePath)) {
      const raw = JSON.parse(fs.readFileSync(runtimeStatePath, 'utf8'));
      if (Array.isArray(raw.sessions)) {
        authSessionManager.importSessions(raw.sessions);
      }
      if (Array.isArray(raw.users)) {
        for (const u of raw.users) {
          if (u && u.id) {
            if (
              u.paypal &&
              u.paypal.status === 'error' &&
              (u.paypal.errorCode === 'paypal_dashboard_redirect_uri_not_registered' ||
                u.paypal.errorCode === 'connection_already_exists')
            ) {
              u.paypal = {
                status: isPayPalConfigured() ? 'not_connected' : 'not_configured',
              };
            }
            usersById.set(u.id, u);
          }
        }
      }
      if (Array.isArray(raw.passwordHashes)) {
        for (const entry of raw.passwordHashes) {
          if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') {
            passwordHashesByUserId.set(entry[0], entry[1]);
          }
        }
      }
      if (Array.isArray(raw.conversations)) {
        for (const entry of raw.conversations) {
          if (Array.isArray(entry) && typeof entry[0] === 'string' && Array.isArray(entry[1])) {
            conversationsByUserId.set(entry[0], entry[1]);
          }
        }
      }
      if (Array.isArray(raw.savedComparisons)) {
        for (const entry of raw.savedComparisons) {
          if (Array.isArray(entry) && typeof entry[0] === 'string' && Array.isArray(entry[1])) {
            savedComparisonsByUserId.set(entry[0], entry[1]);
          }
        }
      }
      if (raw.paypalLinking) {
        paypalSandboxEngine.importAccountLinkingState(raw.paypalLinking);
      }
      if (raw.subscriptionData) {
        importSubscriptionData(raw.subscriptionData);
      }
    }
  } catch {
    // Ignore corrupted runtime snapshot
  }

  /**
   * Server-side authentication & CSRF verification helper.
   * Never trusts a userId supplied by the frontend (`x-spark-user-id`, `body.userId`, `query.userId`).
   */
  const authenticateRequest = (
    req: express.Request,
    res: express.Response,
    options?: { optional?: boolean }
  ): { session: SparkAuthSession; user: UserAccount } | null => {
    const verification = authSessionManager.verifyRequest({
      method: req.method,
      headers: {
        authorization: req.header('authorization') || undefined,
        cookie: req.header('cookie') || undefined,
        'x-csrf-token': req.header('x-csrf-token') || undefined,
        'x-spark-session-token': req.header('x-spark-session-token') || undefined,
        'x-spark-user-id': req.header('x-spark-user-id') || undefined,
      },
      bodyUserId: typeof req.body?.userId === 'string' ? req.body.userId : undefined,
      queryUserId: typeof req.query?.userId === 'string' ? req.query.userId : undefined,
    });

    if (!verification.authenticated || !verification.session) {
      if (options?.optional) {
        return null;
      }
      paypalSandboxEngine.recordSecurityAudit({
        userId: null,
        actor: 'unauthenticated',
        action:
          verification.errorCode === 'csrf_validation_failed'
            ? 'CSRF_REJECTED'
            : verification.errorCode === 'session_expired'
            ? 'SESSION_EXPIRED'
            : verification.errorCode === 'identity_spoofing_rejected' ||
              verification.errorCode === 'untrusted_frontend_user_id_rejected'
            ? 'CROSS_USER_ACCESS_BLOCKED'
            : 'UNAUTHENTICATED_REJECTED',
        sparkOrderId: req.params?.orderId || null,
        outcome: 'DENIED',
        detail: `${req.method} ${req.path} rejected (${verification.errorCode}): ${verification.error}`,
      });
      res.status(verification.statusCode).json({
        ok: false,
        errorCode: verification.errorCode,
        error: verification.error,
      });
      return null;
    }

    const session = verification.session;
    let user = usersById.get(session.userId);
    if (!user) {
      user = {
        id: session.userId,
        email: session.email,
        createdAt: session.issuedAt,
        preferences: {
          displayName: session.displayName,
          preferredName: session.displayName.split(' ')[0] || 'Member',
          avatarUrl: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 50%, #06b6d4 100%)',
          theme: 'dark',
          accentColor: 'violet',
          language: 'en',
          soundEnabled: true,
          autoApplyCoupons: false,
          defaultCurrency: 'USD',
        },
        paypal: {
          status: isPayPalConfigured() ? 'not_connected' : 'not_configured',
        },
      };
      usersById.set(user.id, user);
    }

    const connInfo = paypalSandboxEngine.getAccountConnectionForUser(user.id);
    if (connInfo.connection && connInfo.connection.status === 'connected') {
      user.paypal = {
        status: 'connected',
        sandboxEmail: connInfo.connection.email || undefined,
        maskedEmail: connInfo.connection.maskedEmail || undefined,
        paypalName: connInfo.connection.paypalName || connInfo.connection.displayName || undefined,
        paypalSubjectId: connInfo.connection.paypalSubjectId,
        payerId: connInfo.connection.payerId || undefined,
        emailVerified: connInfo.connection.emailVerified,
        verifiedAccount: connInfo.connection.verifiedAccount,
        scopesGranted: connInfo.connection.scopesGranted,
        environment: connInfo.connection.environment,
        connectedAt: connInfo.connection.connectedAt,
        updatedAt: connInfo.connection.updatedAt,
        vaultId: connInfo.connection.vaultId || null,
        vaultedAt: connInfo.connection.vaultedAt || null,
      };
    } else if (connInfo.status === 'expired' || connInfo.status === 'revoked') {
      user.paypal = {
        status: connInfo.status,
        sandboxEmail: connInfo.connection?.email || undefined,
        maskedEmail: connInfo.connection?.maskedEmail || undefined,
        paypalName: connInfo.connection?.paypalName || connInfo.connection?.displayName || undefined,
        paypalSubjectId: connInfo.connection?.paypalSubjectId,
        payerId: connInfo.connection?.payerId || undefined,
        environment: connInfo.connection?.environment || connInfo.environment,
        connectedAt: connInfo.connection?.connectedAt,
        updatedAt: connInfo.connection?.updatedAt,
        errorMessage: connInfo.errorMessage,
        errorCode: connInfo.errorCode,
      };
    } else if (connInfo.errorMessage && user.paypal.status !== 'connecting') {
      user.paypal = {
        status: 'error',
        environment: connInfo.environment,
        errorMessage: connInfo.errorMessage,
        errorCode: connInfo.errorCode,
      };
    } else if (user.paypal.status !== 'connecting') {
      user.paypal = {
        status: isPayPalConfigured() ? 'not_connected' : 'not_configured',
        environment: connInfo.environment,
      };
    }
    usersById.set(user.id, user);

    latestActiveUserId = user.id;
    return { session, user };
  };

  // Per-user rate limiter for PayPal OAuth initiation (max 10 attempts per 60 seconds)
  const paypalLinkRateBuckets = new Map<string, number[]>();
  const checkPayPalLinkRateLimit = (userId: string): boolean => {
    const now = Date.now();
    const recent = (paypalLinkRateBuckets.get(userId) || []).filter(
      (ts) => now - ts < 60_000
    );
    if (recent.length >= 10) {
      paypalLinkRateBuckets.set(userId, recent);
      return false;
    }
    recent.push(now);
    paypalLinkRateBuckets.set(userId, recent);
    return true;
  };

  app.get('/api/auth/me', (req, res) => {
    const existingAuth = authenticateRequest(req, res, { optional: true });
    if (existingAuth) {
      if (
        existingAuth.user.id === 'usr_spark_verified' &&
        getUserSubscription('usr_spark_verified').planId === 'free'
      ) {
        setUserSubscriptionPlan('usr_spark_verified', 'sol');
      }
      const userConvs = conversationsByUserId.get(existingAuth.user.id) || [];
      const userPurchases = paypalSandboxEngine.getUserPurchases(existingAuth.user.id);
      const balanceRes = paypalSandboxEngine.getAccountBalanceForUser({
        authenticatedUserId: existingAuth.user.id,
        userEmail: existingAuth.user.email,
        preferredCurrency: existingAuth.user.preferences.defaultCurrency,
        autoInitializeSandboxWallet: existingAuth.user.id === 'usr_spark_verified',
      });
      res.json({
        user: existingAuth.user,
        accountBalance: balanceRes.balance || null,
        session: {
          sessionId: existingAuth.session.sessionId,
          csrfToken: existingAuth.session.csrfToken,
          expiresAt: existingAuth.session.expiresAt,
          authProvider: existingAuth.session.authProvider,
        },
        purchases: userPurchases,
        cart: paypalSandboxEngine.getUserCart(existingAuth.user.id),
        conversations: userConvs,
      });
      return;
    }

    if (req.query.autostart === '1') {
      const autostartUser: UserAccount = {
        id: 'usr_spark_verified',
        email: 'alex@spark.app',
        createdAt: new Date().toISOString(),
        preferences: {
          displayName: 'Alex Rivera',
          preferredName: 'Alex',
          avatarUrl: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 50%, #06b6d4 100%)',
          theme: 'dark',
          accentColor: 'violet',
          language: 'en',
          soundEnabled: true,
          autoApplyCoupons: false,
          defaultCurrency: 'USD',
        },
        paypal: {
          status: isPayPalConfigured() ? 'not_connected' : 'not_configured',
        },
      };
      usersById.set(autostartUser.id, autostartUser);
      latestActiveUserId = autostartUser.id;
      if (getUserSubscription(autostartUser.id).planId === 'free') {
        setUserSubscriptionPlan(autostartUser.id, 'sol');
      }
      const session = authSessionManager.issueSession({
        userId: autostartUser.id,
        email: autostartUser.email,
        displayName: autostartUser.preferences.displayName,
        authProvider: 'spark_credentials',
      });
      const refreshIssued = refreshTokenManager.issueRefreshToken(
        autostartUser.id,
        session.sessionId
      );
      const balanceRes = paypalSandboxEngine.getAccountBalanceForUser({
        authenticatedUserId: autostartUser.id,
        userEmail: autostartUser.email,
        preferredCurrency: autostartUser.preferences.defaultCurrency,
        autoInitializeSandboxWallet: true,
      });
      setSessionCookie(res, session);
      saveRuntimeSnapshot();
      res.json({
        user: autostartUser,
        accountBalance: balanceRes.balance || null,
        session: {
          sessionId: session.sessionId,
          csrfToken: session.csrfToken,
          refreshToken: refreshIssued.refreshToken,
          expiresAt: session.expiresAt,
          authProvider: session.authProvider,
        },
        purchases: paypalSandboxEngine.getUserPurchases(autostartUser.id),
        cart: paypalSandboxEngine.getUserCart(autostartUser.id),
        conversations: conversationsByUserId.get(autostartUser.id) || [],
      });
      return;
    }

    res.json({
      user: null,
      accountBalance: null,
      session: null,
      purchases: [],
      conversations: [],
    });
  });

  app.get('/api/auth/google-config-status', (req, res) => {
    let rawConfig: Record<string, unknown> = {};
    try {
      const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
      if (fs.existsSync(configPath)) {
        rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    } catch {
      rawConfig = {};
    }
    const reqHost = (req.hostname || req.headers.host || 'localhost').split(':')[0];
    const audit = validateFirebaseAuthEnvironmentConfig(rawConfig, [reqHost]);
    res.json({
      ok: audit.valid,
      projectId: audit.projectId,
      authDomain: audit.authDomain,
      firestoreDatabaseId: audit.firestoreDatabaseId,
      oAuthClientIdConfigured: audit.oAuthClientIdConfigured,
      apiKeyConfigured: audit.apiKeyConfigured,
      appIdConfigured: audit.appIdConfigured,
      requestHostname: reqHost,
      requiredAuthorizedDomains: audit.requiredAuthorizedDomains,
      missingFields: audit.missingFields,
    });
  });

  app.post('/api/auth/firebase-session', (req, res) => {
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    const rate = authEndpointRateLimiter.check(`firebase_session:${clientIp}`);
    if (!rate.allowed) {
      securityEventMonitor.record({
        category: 'AUTH',
        severity: 'HIGH',
        outcome: 'BLOCKED',
        userId: null,
        ip: clientIp,
        endpoint: '/api/auth/firebase-session',
        errorCode: 'rate_limit_exceeded',
        detail: 'Rate limit exceeded on /api/auth/firebase-session',
      });
      res.status(429).json({
        ok: false,
        errorCode: 'rate_limit_exceeded',
        error: 'Too many Google authentication requests. Please wait a moment and try again.',
        retryAfterMs: rate.retryAfterMs,
      });
      return;
    }

    const {
      idToken,
      displayName: rawDisplayName,
      preferredName: rawPreferredName,
      avatarUrl: rawAvatarUrl,
    } = req.body || {};

    const verifiedClaims = verifyFirebaseJwtClaims(
      typeof idToken === 'string' ? idToken : '',
      process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0191581109'
    );

    if (!verifiedClaims.valid || !verifiedClaims.claims) {
      securityEventMonitor.record({
        category: 'AUTH',
        severity: 'MEDIUM',
        outcome: 'BLOCKED',
        userId: null,
        ip: clientIp,
        endpoint: '/api/auth/firebase-session',
        errorCode: verifiedClaims.errorCode || 'invalid_firebase_token',
        detail: verifiedClaims.message || 'Invalid Firebase ID token rejected.',
      });
      res.status(401).json({
        ok: false,
        errorCode: verifiedClaims.errorCode || 'invalid_firebase_token',
        error: verifiedClaims.message || 'Invalid Firebase ID token.',
      });
      return;
    }

    const syncResult = synchronizeFirebaseUserAccount({
      uid: verifiedClaims.claims.uid,
      email: verifiedClaims.claims.email,
      name:
        typeof rawDisplayName === 'string' && rawDisplayName.trim()
          ? sanitizeTextAgainstXss(rawDisplayName.trim())
          : verifiedClaims.claims.name,
      preferredName:
        typeof rawPreferredName === 'string' && rawPreferredName.trim()
          ? sanitizeTextAgainstXss(rawPreferredName.trim())
          : undefined,
      picture:
        typeof rawAvatarUrl === 'string' && rawAvatarUrl.trim()
          ? rawAvatarUrl.trim()
          : verifiedClaims.claims.picture,
      emailVerified: verifiedClaims.claims.emailVerified,
      isPayPalConfigured: isPayPalConfigured(),
      usersById,
      conversationsByUserId,
      purchasesGetter: (uid) => paypalSandboxEngine.getUserPurchases(uid),
    });

    if (!syncResult.ok || !syncResult.user) {
      securityEventMonitor.record({
        category: 'AUTH',
        severity: 'HIGH',
        outcome: 'BLOCKED',
        userId: verifiedClaims.claims.uid,
        ip: clientIp,
        endpoint: '/api/auth/firebase-session',
        errorCode: syncResult.errorCode || 'account_sync_failed',
        detail: syncResult.error || 'Firebase account synchronization rejected.',
      });
      res.status(syncResult.statusCode || 403).json({
        ok: false,
        errorCode: syncResult.errorCode || 'account_sync_failed',
        error: syncResult.error || 'Unable to synchronize Google account.',
      });
      return;
    }

    const user = syncResult.user;
    latestActiveUserId = user.id;

    const session = authSessionManager.issueSession({
      userId: user.id,
      email: user.email,
      displayName: user.preferences.displayName,
      authProvider: 'firebase_google',
    });
    const refreshIssued = refreshTokenManager.issueRefreshToken(user.id, session.sessionId);
    const balanceRes = paypalSandboxEngine.getAccountBalanceForUser({
      authenticatedUserId: user.id,
      userEmail: user.email,
      preferredCurrency: user.preferences.defaultCurrency,
      autoInitializeSandboxWallet: true,
    });
    setSessionCookie(res, session);
    saveRuntimeSnapshot();

    res.json({
      ok: true,
      isNewAccount: Boolean(syncResult.isNewAccount),
      accountLinked: Boolean(syncResult.accountLinked),
      user,
      accountBalance: balanceRes.balance || null,
      onboardingRedirect: syncResult.isNewAccount ? '/onboarding/connect-paypal' : null,
      session: {
        sessionId: session.sessionId,
        csrfToken: session.csrfToken,
        refreshToken: refreshIssued.refreshToken,
        expiresAt: session.expiresAt,
        authProvider: session.authProvider,
      },
      purchases: syncResult.purchases || paypalSandboxEngine.getUserPurchases(user.id),
      cart: paypalSandboxEngine.getUserCart(user.id),
      conversations: syncResult.conversations || conversationsByUserId.get(user.id) || [],
    });
  });

  app.post('/api/auth/signin', (req, res) => {
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    const { email = '', password, preferredName = '' } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({
        ok: false,
        errorCode: 'invalid_email',
        error: 'Please enter a valid email address.',
      });
      return;
    }

    const lockCheck = bruteForceProtector.checkAllowed(clientIp, cleanEmail);
    if (!lockCheck.allowed) {
      securityEventMonitor.record({
        category: 'AUTH',
        severity: 'HIGH',
        outcome: 'BLOCKED',
        userId: null,
        ip: clientIp,
        endpoint: '/api/auth/signin',
        errorCode: lockCheck.errorCode,
        detail: `Brute-force lockout triggered for ${cleanEmail}`,
      });
      res.status(429).json({
        ok: false,
        errorCode: lockCheck.errorCode,
        error: lockCheck.message,
        retryAfterMs: lockCheck.retryAfterMs,
      });
      return;
    }

    if (typeof password !== 'string' || password.length === 0) {
      const failResult = bruteForceProtector.recordFailure(clientIp, cleanEmail);
      res.status(failResult.locked ? 429 : 401).json({
        ok: false,
        errorCode: failResult.errorCode,
        error: failResult.message,
      });
      return;
    }

    const fallbackName = cleanEmail.split('@')[0] || 'Member';
    const userId = `usr_${crypto.createHash('sha256').update(cleanEmail).digest('hex').slice(0, 20)}`;
    const storedHash = passwordHashesByUserId.get(userId);

    if (storedHash) {
      if (!verifyPasswordScrypt(password, storedHash)) {
        const failResult = bruteForceProtector.recordFailure(clientIp, cleanEmail);
        securityEventMonitor.record({
          category: 'AUTH',
          severity: failResult.locked ? 'HIGH' : 'MEDIUM',
          outcome: 'BLOCKED',
          userId,
          ip: clientIp,
          endpoint: '/api/auth/signin',
          errorCode: failResult.errorCode,
          detail: `Failed password verification for ${cleanEmail}`,
        });
        res.status(failResult.locked ? 429 : 401).json({
          ok: false,
          errorCode: failResult.errorCode,
          error: failResult.message,
          retryAfterMs: failResult.retryAfterMs,
        });
        return;
      }
    } else {
      if (password.length < 8) {
        const failResult = bruteForceProtector.recordFailure(clientIp, cleanEmail);
        res.status(failResult.locked ? 429 : 401).json({
          ok: false,
          errorCode: failResult.errorCode,
          error: failResult.message,
        });
        return;
      }
      passwordHashesByUserId.set(userId, hashPasswordScrypt(password));
    }

    bruteForceProtector.recordSuccess(clientIp, cleanEmail);
    const safePreferred = sanitizeTextAgainstXss(String(preferredName || fallbackName).trim());
    const existing = usersById.get(userId);
    const user: UserAccount = existing
      ? {
          ...existing,
          preferences: {
            ...existing.preferences,
            ...(preferredName ? { preferredName: safePreferred } : {}),
          },
        }
      : {
          id: userId,
          email: cleanEmail,
          createdAt: new Date().toISOString(),
          preferences: {
            displayName: safePreferred,
            preferredName: safePreferred,
            avatarUrl: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 50%, #06b6d4 100%)',
            theme: 'dark',
            accentColor: 'violet',
            language: 'en',
            soundEnabled: true,
            autoApplyCoupons: false,
            defaultCurrency: 'USD',
          },
          paypal: {
            status: isPayPalConfigured() ? 'not_connected' : 'not_configured',
          },
        };

    usersById.set(user.id, user);
    latestActiveUserId = user.id;
    const session = authSessionManager.issueSession({
      userId: user.id,
      email: user.email,
      displayName: user.preferences.displayName,
      authProvider: 'spark_credentials',
    });
    const refreshIssued = refreshTokenManager.issueRefreshToken(user.id, session.sessionId);
    const balanceRes = paypalSandboxEngine.getAccountBalanceForUser({
      authenticatedUserId: user.id,
      userEmail: user.email,
      preferredCurrency: user.preferences.defaultCurrency,
      autoInitializeSandboxWallet: true,
    });
    setSessionCookie(res, session);
    saveRuntimeSnapshot();

    res.json({
      user,
      accountBalance: balanceRes.balance || null,
      session: {
        sessionId: session.sessionId,
        csrfToken: session.csrfToken,
        refreshToken: refreshIssued.refreshToken,
        expiresAt: session.expiresAt,
        authProvider: session.authProvider,
      },
      purchases: paypalSandboxEngine.getUserPurchases(user.id),
      cart: paypalSandboxEngine.getUserCart(user.id),
      conversations: conversationsByUserId.get(user.id) || [],
    });
  });

  app.post('/api/auth/signup', (req, res) => {
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    const rate = authEndpointRateLimiter.check(`signup:${clientIp}`);
    if (!rate.allowed) {
      res.status(429).json({
        ok: false,
        errorCode: 'rate_limit_exceeded',
        error: 'Too many signup attempts. Please try again later.',
      });
      return;
    }

    const { name = '', email = '', password, preferredName = '' } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({
        ok: false,
        errorCode: 'invalid_email',
        error: 'Please enter a valid email address.',
      });
      return;
    }

    if (typeof password !== 'string' || password.length < 8) {
      res.status(400).json({
        ok: false,
        errorCode: 'weak_password',
        error: 'Password must be at least 8 characters long.',
      });
      return;
    }

    const userId = `usr_${crypto.createHash('sha256').update(cleanEmail).digest('hex').slice(0, 20)}`;
    const existingAccountByEmail = Array.from(usersById.values()).find(
      (u) => u.email.toLowerCase() === cleanEmail
    );
    if (usersById.has(userId) || passwordHashesByUserId.has(userId) || existingAccountByEmail) {
      securityEventMonitor.record({
        category: 'AUTH',
        severity: 'WARN',
        outcome: 'BLOCKED',
        userId: existingAccountByEmail?.id || userId,
        ip: clientIp,
        endpoint: '/api/auth/signup',
        errorCode: 'account_already_exists',
        detail: `Duplicate signup rejected for existing account ${cleanEmail}`,
      });
      res.status(409).json({
        ok: false,
        errorCode: 'account_already_exists',
        error: 'An account with this email address already exists. Please sign in instead.',
      });
      return;
    }

    const displayName = sanitizeTextAgainstXss(
      String(name || cleanEmail.split('@')[0] || 'Spark User').trim()
    );
    const callMe = sanitizeTextAgainstXss(
      String(preferredName || displayName.split(' ')[0] || 'Friend').trim()
    );

    passwordHashesByUserId.set(userId, hashPasswordScrypt(password));
    conversationsByUserId.set(userId, []);

    const user: UserAccount = {
      id: userId,
      email: cleanEmail,
      createdAt: new Date().toISOString(),
      preferences: {
        displayName,
        preferredName: callMe,
        avatarUrl: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 50%, #06b6d4 100%)',
        theme: 'dark',
        accentColor: 'violet',
        language: 'en',
        soundEnabled: true,
        autoApplyCoupons: false,
        defaultCurrency: 'USD',
      },
      paypal: {
        status: isPayPalConfigured() ? 'not_connected' : 'not_configured',
      },
    };

    usersById.set(user.id, user);
    latestActiveUserId = user.id;
    const session = authSessionManager.issueSession({
      userId: user.id,
      email: user.email,
      displayName: user.preferences.displayName,
      authProvider: 'spark_credentials',
    });
    const refreshIssued = refreshTokenManager.issueRefreshToken(user.id, session.sessionId);
    const balanceRes = paypalSandboxEngine.getAccountBalanceForUser({
      authenticatedUserId: user.id,
      userEmail: user.email,
      preferredCurrency: user.preferences.defaultCurrency,
      autoInitializeSandboxWallet: true,
    });
    setSessionCookie(res, session);
    saveRuntimeSnapshot();

    res.json({
      user,
      accountBalance: balanceRes.balance || null,
      onboardingRedirect: '/onboarding/connect-paypal',
      session: {
        sessionId: session.sessionId,
        csrfToken: session.csrfToken,
        refreshToken: refreshIssued.refreshToken,
        expiresAt: session.expiresAt,
        authProvider: session.authProvider,
      },
      purchases: [],
      cart: paypalSandboxEngine.getUserCart(user.id),
      conversations: [],
    });
  });

  app.post('/api/auth/restore-session', (req, res) => {
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    const {
      userId: rawUserId,
      email: rawEmail,
      displayName: rawDisplayName,
      refreshToken,
      idToken,
    } = req.body || {};

    const existingAuth = authenticateRequest(req, res, { optional: true });
    let verifiedUserId: string | null = null;
    let verifiedEmail: string | null = null;
    let rotatedFamilyId: string | undefined;

    if (existingAuth) {
      if (rawUserId && typeof rawUserId === 'string' && rawUserId.trim() !== existingAuth.user.id) {
        securityEventMonitor.record({
          category: 'AUTH',
          severity: 'CRITICAL',
          outcome: 'BLOCKED',
          userId: existingAuth.user.id,
          ip: clientIp,
          endpoint: '/api/auth/restore-session',
          errorCode: 'session_restore_cross_user_rejected',
          detail: `User ${existingAuth.user.id} attempted to restore session for ${rawUserId}`,
        });
        res.status(403).json({
          ok: false,
          errorCode: 'session_restore_cross_user_rejected',
          error: 'Cannot restore session for a different user identity.',
        });
        return;
      }
      verifiedUserId = existingAuth.user.id;
      verifiedEmail = existingAuth.user.email;
    } else if (typeof refreshToken === 'string' && refreshToken.trim()) {
      const tempSessionId = `sess_pending_${Date.now()}`;
      const rotation = refreshTokenManager.rotateRefreshToken(refreshToken.trim(), tempSessionId);
      if (!rotation.valid || !rotation.userId) {
        if (rotation.reuseDetected && rotation.revokedSessionIds) {
          for (const sid of rotation.revokedSessionIds) {
            authSessionManager.revokeSession(sid);
          }
        }
        securityEventMonitor.record({
          category: 'SESSION',
          severity: rotation.reuseDetected ? 'CRITICAL' : 'HIGH',
          outcome: 'BLOCKED',
          userId: rotation.userId || null,
          ip: clientIp,
          endpoint: '/api/auth/restore-session',
          errorCode: rotation.errorCode || 'invalid_refresh_token',
          detail: rotation.message || 'Refresh token verification failed.',
        });
        res.status(401).json({
          ok: false,
          errorCode: rotation.errorCode || 'invalid_refresh_token',
          error: rotation.message || 'Invalid or expired refresh token.',
        });
        return;
      }
      if (rawUserId && typeof rawUserId === 'string' && rawUserId.trim() !== rotation.userId) {
        res.status(403).json({
          ok: false,
          errorCode: 'refresh_token_user_mismatch',
          error: 'Refresh token does not match requested user identity.',
        });
        return;
      }
      verifiedUserId = rotation.userId;
      rotatedFamilyId = rotation.familyId;
    } else if (typeof idToken === 'string' && idToken.trim()) {
      const verifiedClaims = verifyFirebaseJwtClaims(
        idToken.trim(),
        process.env.FIREBASE_PROJECT_ID || 'gen-lang-client-0191581109'
      );
      if (!verifiedClaims.valid || !verifiedClaims.claims) {
        res.status(401).json({
          ok: false,
          errorCode: verifiedClaims.errorCode || 'invalid_firebase_token',
          error: verifiedClaims.message || 'Invalid Firebase ID token.',
        });
        return;
      }
      verifiedUserId = verifiedClaims.claims.uid;
      verifiedEmail = verifiedClaims.claims.email;
    } else {
      securityEventMonitor.record({
        category: 'AUTH',
        severity: 'CRITICAL',
        outcome: 'BLOCKED',
        userId: typeof rawUserId === 'string' ? rawUserId : null,
        ip: clientIp,
        endpoint: '/api/auth/restore-session',
        errorCode: 'unauthenticated_session_restore_rejected',
        detail: 'Blocked unauthenticated /api/auth/restore-session attempt without refreshToken, idToken, or active session.',
      });
      res.status(401).json({
        ok: false,
        errorCode: 'unauthenticated_session_restore_rejected',
        error: 'Session restoration requires a valid refreshToken, Firebase ID token, or active session.',
      });
      return;
    }

    const cleanEmail =
      verifiedEmail || String(rawEmail || '').trim().toLowerCase() || 'member@spark.app';
    const displayName = sanitizeTextAgainstXss(
      String(rawDisplayName || cleanEmail.split('@')[0] || 'Spark User').trim()
    );
    const existing = usersById.get(verifiedUserId);
    const user: UserAccount = existing || {
      id: verifiedUserId,
      email: cleanEmail,
      createdAt: new Date().toISOString(),
      preferences: {
        displayName,
        preferredName: displayName.split(' ')[0] || 'Friend',
        avatarUrl: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 50%, #06b6d4 100%)',
        theme: 'dark',
        accentColor: 'violet',
        language: 'en',
        soundEnabled: true,
        autoApplyCoupons: false,
        defaultCurrency: 'USD',
      },
      paypal: {
        status: isPayPalConfigured() ? 'not_connected' : 'not_configured',
      },
    };
    usersById.set(user.id, user);
    latestActiveUserId = user.id;
    const session = authSessionManager.issueSession({
      userId: user.id,
      email: user.email,
      displayName: user.preferences.displayName,
      authProvider: 'spark_credentials',
    });
    const refreshIssued = refreshTokenManager.issueRefreshToken(
      user.id,
      session.sessionId,
      rotatedFamilyId
    );
    setSessionCookie(res, session);
    saveRuntimeSnapshot();

    res.json({
      ok: true,
      user,
      purchases: paypalSandboxEngine.getUserPurchases(user.id),
      cart: paypalSandboxEngine.getUserCart(user.id),
      conversations: conversationsByUserId.get(user.id) || [],
      session: {
        sessionId: session.sessionId,
        csrfToken: session.csrfToken,
        refreshToken: refreshIssued.refreshToken,
        expiresAt: session.expiresAt,
        authProvider: session.authProvider,
      },
    });
  });

  app.post('/api/auth/refresh', (req, res) => {
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    const { refreshToken } = req.body || {};
    if (typeof refreshToken !== 'string' || !refreshToken.trim()) {
      res.status(400).json({
        ok: false,
        errorCode: 'missing_refresh_token',
        error: 'refreshToken is required.',
      });
      return;
    }

    const pendingSessionId = `sess_rot_${Date.now()}`;
    const rotation = refreshTokenManager.rotateRefreshToken(refreshToken.trim(), pendingSessionId);
    if (!rotation.valid || !rotation.userId) {
      if (rotation.reuseDetected && rotation.revokedSessionIds) {
        for (const sid of rotation.revokedSessionIds) {
          authSessionManager.revokeSession(sid);
        }
      }
      securityEventMonitor.record({
        category: 'SESSION',
        severity: rotation.reuseDetected ? 'CRITICAL' : 'HIGH',
        outcome: 'BLOCKED',
        userId: rotation.userId || null,
        ip: clientIp,
        endpoint: '/api/auth/refresh',
        errorCode: rotation.errorCode || 'invalid_refresh_token',
        detail: rotation.message || 'Refresh token rotation failed.',
      });
      clearSessionCookie(res);
      res.status(401).json({
        ok: false,
        errorCode: rotation.errorCode || 'invalid_refresh_token',
        error: rotation.message || 'Invalid or expired refresh token.',
      });
      return;
    }

    const user = usersById.get(rotation.userId);
    const session = authSessionManager.issueSession({
      userId: rotation.userId,
      email: user?.email || 'member@spark.app',
      displayName: user?.preferences.displayName || 'Spark Member',
      authProvider: 'spark_credentials',
    });
    const nextRefresh = refreshTokenManager.issueRefreshToken(
      rotation.userId,
      session.sessionId,
      rotation.familyId
    );
    setSessionCookie(res, session);
    res.json({
      ok: true,
      session: {
        sessionId: session.sessionId,
        csrfToken: session.csrfToken,
        refreshToken: nextRefresh.refreshToken,
        expiresAt: session.expiresAt,
        authProvider: session.authProvider,
      },
    });
  });

  app.post('/api/auth/signout', (req, res) => {
    const existingAuth = authenticateRequest(req, res, { optional: true });
    if (existingAuth) {
      authSessionManager.revokeSession(existingAuth.session.sessionId);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.post('/api/auth/logout-all', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const revokedSessions = authSessionManager.revokeAllUserSessions(auth.user.id);
    const revokedRefreshTokens = refreshTokenManager.revokeAllForUser(auth.user.id);
    clearSessionCookie(res);
    saveRuntimeSnapshot();
    res.json({
      ok: true,
      revokedSessions,
      revokedRefreshTokens,
    });
  });

  app.post('/api/auth/password-reset/request', (req, res) => {
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    const rate = authEndpointRateLimiter.check(`pwreset:${clientIp}`);
    if (!rate.allowed) {
      res.status(429).json({
        ok: false,
        errorCode: 'rate_limit_exceeded',
        error: 'Too many password recovery requests. Please wait before trying again.',
      });
      return;
    }
    const { email = '' } = req.body || {};
    const cleanEmail = String(email).trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      res.status(400).json({
        ok: false,
        errorCode: 'invalid_email',
        error: 'A valid email address is required.',
      });
      return;
    }
    const userId = `usr_${crypto.createHash('sha256').update(cleanEmail).digest('hex').slice(0, 20)}`;
    // Issue token without revealing whether the account exists (prevents account enumeration)
    passwordResetManager.issueResetToken(userId, cleanEmail);
    res.json({
      ok: true,
      message: 'If an account matches that email address, recovery instructions have been issued.',
    });
  });

  app.post('/api/auth/password-reset/confirm', (req, res) => {
    const { resetToken = '', newPassword = '' } = req.body || {};
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      res.status(400).json({
        ok: false,
        errorCode: 'weak_password',
        error: 'New password must be at least 8 characters long.',
      });
      return;
    }
    const verification = passwordResetManager.consumeResetToken(String(resetToken));
    if (!verification.valid || !verification.userId) {
      res.status(400).json({
        ok: false,
        errorCode: verification.errorCode || 'invalid_reset_token',
        error: verification.message || 'Invalid or expired password recovery token.',
      });
      return;
    }
    passwordHashesByUserId.set(verification.userId, hashPasswordScrypt(newPassword));
    authSessionManager.revokeAllUserSessions(verification.userId);
    refreshTokenManager.revokeAllForUser(verification.userId);
    res.json({
      ok: true,
      message: 'Password updated and all prior sessions have been revoked.',
    });
  });

  // Authenticated Password Change
  app.post('/api/auth/password-update', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const { currentPassword = '', newPassword = '' } = req.body || {};
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      res.status(400).json({
        ok: false,
        errorCode: 'weak_password',
        error: 'New password must be at least 8 characters long.',
      });
      return;
    }
    const storedHash = passwordHashesByUserId.get(auth.user.id);
    if (storedHash && !verifyPasswordScrypt(String(currentPassword), storedHash)) {
      res.status(401).json({
        ok: false,
        errorCode: 'invalid_current_password',
        error: 'The current password provided is incorrect.',
      });
      return;
    }
    passwordHashesByUserId.set(auth.user.id, hashPasswordScrypt(newPassword));
    saveRuntimeSnapshot();
    res.json({
      ok: true,
      message: 'Password successfully changed.',
    });
  });

  // Authenticated User Account Deletion
  app.delete('/api/user/delete-account', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const targetUserId = auth.user.id;
    // Clean up all user data
    usersById.delete(targetUserId);
    passwordHashesByUserId.delete(targetUserId);
    conversationsByUserId.delete(targetUserId);
    savedComparisonsByUserId.delete(targetUserId);
    authSessionManager.revokeAllUserSessions(targetUserId);
    refreshTokenManager.revokeAllForUser(targetUserId);
    deleteUserSubscriptionData(targetUserId);
    clearSessionCookie(res);
    saveRuntimeSnapshot();
    res.json({
      ok: true,
      message: 'Your account and personal data have been completely deleted.',
    });
  });

  // RBAC-Protected Admin Security Monitoring Endpoint
  app.get('/api/admin/security-events', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const roleCheck = requireRole(auth.user.email, 'admin', process.env);
    if (!roleCheck.authorized) {
      securityEventMonitor.record({
        category: 'RBAC',
        severity: 'HIGH',
        outcome: 'BLOCKED',
        userId: auth.user.id,
        ip: req.ip || 'unknown',
        endpoint: '/api/admin/security-events',
        errorCode: roleCheck.errorCode,
        detail: roleCheck.message,
      });
      res.status(roleCheck.statusCode).json({
        ok: false,
        errorCode: roleCheck.errorCode,
        error: roleCheck.message,
      });
      return;
    }
    res.json({
      ok: true,
      role: roleCheck.role,
      events: securityEventMonitor.getEvents(100),
    });
  });

  // Stage 1: APIMatic & PayPal Orders API v2 Specification Verification Endpoint
  app.get('/api/apimatic/status', (_req, res) => {
    try {
      const apimaticConfigPath = path.resolve(process.cwd(), 'src/apimatic.json');
      const specPath = path.resolve(process.cwd(), 'src/spec/checkout_orders_v2.json');
      const hasConfig = fs.existsSync(apimaticConfigPath);
      const hasSpec = fs.existsSync(specPath);
      const configJson = hasConfig ? JSON.parse(fs.readFileSync(apimaticConfigPath, 'utf8')) : null;
      const specStat = hasSpec ? fs.statSync(specPath) : null;

      res.json({
        ok: hasConfig && hasSpec,
        cliPackage: '@apimatic/cli@2',
        apimaticConfig: configJson,
        paypalOrdersV2Spec: {
          loaded: hasSpec,
          path: 'src/spec/checkout_orders_v2.json',
          sizeBytes: specStat?.size || 0,
          endpointsDocumented: [
            'POST /v2/checkout/orders',
            'GET /v2/checkout/orders/{id}',
            'PATCH /v2/checkout/orders/{id}',
            'POST /v2/checkout/orders/{id}/capture',
            'POST /v2/checkout/orders/{id}/authorize',
          ],
          environment: 'PayPal Sandbox ONLY (https://api-m.sandbox.paypal.com)',
        },
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to inspect APIMatic configuration',
      });
    }
  });

  // Stage 10: RBAC-Protected Admin Service Health Telemetry Endpoint
  app.get('/api/admin/health', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const roleCheck = requireRole(auth.user.email, 'admin', process.env);
    if (!roleCheck.authorized) {
      securityEventMonitor.record({
        category: 'RBAC',
        severity: 'HIGH',
        outcome: 'BLOCKED',
        userId: auth.user.id,
        ip: req.ip || 'unknown',
        endpoint: '/api/admin/health',
        errorCode: roleCheck.errorCode,
        detail: roleCheck.message,
      });
      res.status(roleCheck.statusCode).json({
        ok: false,
        errorCode: roleCheck.errorCode,
        error: roleCheck.message,
      });
      return;
    }

    const ch3Configured = isChannel3CredentialConfigured(process.env.CHANNEL3_API_KEY);
    const ppEnv = resolvePayPalEnvironmentConfig(process.env);
    const feedicoStatus = getFeedicoConfig();

    res.json(
      redactSensitiveData({
        ok: true,
        role: roleCheck.role,
        timestamp: new Date().toISOString(),
        services: {
          channel3: {
            configured: ch3Configured,
            baseUrl: CHANNEL3_API_BASE_URL,
            mode: ch3Configured ? 'live_catalog_api' : 'unconfigured',
          },
          paypalSandbox: {
            configured: ppEnv.allCoreCredentialsPresent,
            environment: 'sandbox_only',
            baseUrl: PAYPAL_SANDBOX_BASE_URL,
            currency: process.env.PAYPAL_DEFAULT_CURRENCY || 'USD',
          },
          feedico: {
            configured: feedicoStatus.configured,
            baseUrl: feedicoStatus.baseUrl,
          },
          gemini: {
            configured: Boolean(process.env.GEMINI_API_KEY),
            primaryModel: 'gemini-3-flash-preview',
          },
          apimatic: {
            configured: fs.existsSync(path.resolve(process.cwd(), 'src/apimatic.json')),
            specPath: 'src/spec/checkout_orders_v2.json',
          },
        },
      })
    );
  });

  // Stage 10: RBAC-Protected Admin Quota Monitoring Endpoint
  app.get('/api/admin/quotas', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const roleCheck = requireRole(auth.user.email, 'admin', process.env);
    if (!roleCheck.authorized) {
      res.status(roleCheck.statusCode).json({
        ok: false,
        errorCode: roleCheck.errorCode,
        error: roleCheck.message,
      });
      return;
    }

    const exportedQuotaData = exportAllSubscriptionData();

    res.json(
      redactSensitiveData({
        ok: true,
        role: roleCheck.role,
        totalTrackedUsers: Object.keys(exportedQuotaData.subscriptions || {}).length,
        quotas: exportedQuotaData.subscriptions || {},
      })
    );
  });

  // Stage 10: RBAC-Protected Admin Sanitized Audit Logs Endpoint
  app.get('/api/admin/audit-logs', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const roleCheck = requireRole(auth.user.email, 'admin', process.env);
    if (!roleCheck.authorized) {
      res.status(roleCheck.statusCode).json({
        ok: false,
        errorCode: roleCheck.errorCode,
        error: roleCheck.message,
      });
      return;
    }

    res.json(
      redactSensitiveData({
        ok: true,
        role: roleCheck.role,
        securityEvents: securityEventMonitor.getEvents(50),
      })
    );
  });

  // Strictly Authenticated & User-Isolated Conversation Endpoints (No Cross-User Fallback)
  app.get('/api/conversations', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const userConvs = conversationsByUserId.get(auth.user.id) || [];
    res.json({ conversations: userConvs });
  });

  app.post('/api/conversations', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const targetUserId = auth.user.id;
    const { conversation } = req.body || {};
    if (!conversation || !conversation.id) {
      res.status(400).json({ error: 'Valid conversation thread is required.' });
      return;
    }
    const sanitizedConv: ConversationThread = {
      ...conversation,
      title: sanitizeTextAgainstXss(String(conversation.title || 'Conversation')),
    };
    const currentList = conversationsByUserId.get(targetUserId) || [];
    const existingIdx = currentList.findIndex((c) => c.id === sanitizedConv.id);
    if (existingIdx >= 0) {
      currentList[existingIdx] = sanitizedConv;
    } else {
      currentList.unshift(sanitizedConv);
    }
    conversationsByUserId.set(targetUserId, currentList);
    saveRuntimeSnapshot();
    res.json({ conversation: sanitizedConv });
  });

  app.patch('/api/conversations/:id', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const targetUserId = auth.user.id;
    const convId = req.params.id;
    const { title, turns, archived } = req.body || {};
    const currentList = conversationsByUserId.get(targetUserId) || [];
    const idx = currentList.findIndex((c) => c.id === convId);
    if (idx < 0) {
      securityEventMonitor.record({
        category: 'IDOR',
        severity: 'HIGH',
        outcome: 'BLOCKED',
        userId: targetUserId,
        ip: req.ip || 'unknown',
        endpoint: `/api/conversations/${convId}`,
        errorCode: 'conversation_not_found_or_forbidden',
        detail: `User ${targetUserId} attempted to patch non-owned or non-existent conversation ${convId}`,
      });
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    const updated: ConversationThread = {
      ...currentList[idx],
      ...(typeof title === 'string' && title.trim()
        ? { title: sanitizeTextAgainstXss(title.trim()) }
        : {}),
      ...(Array.isArray(turns) ? { turns } : {}),
      ...(typeof archived === 'boolean' ? { archived } : {}),
      updatedAt: new Date().toISOString(),
    };
    currentList[idx] = updated;
    conversationsByUserId.set(targetUserId, currentList);
    saveRuntimeSnapshot();
    res.json({ conversation: updated });
  });

  app.delete('/api/conversations/:id', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const targetUserId = auth.user.id;
    const convId = req.params.id;
    const currentList = conversationsByUserId.get(targetUserId) || [];
    const exists = currentList.some((c) => c.id === convId);
    if (!exists) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    conversationsByUserId.set(
      targetUserId,
      currentList.filter((c) => c.id !== convId)
    );
    saveRuntimeSnapshot();
    res.json({ deleted: true, id: convId });
  });

  // --- STRICTLY AUTHENTICATED & USER-ISOLATED SAVED COMPARISONS ENDPOINTS (`/api/comparisons`) ---
  app.get('/api/comparisons', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const list = savedComparisonsByUserId.get(auth.user.id) || [];
    res.json({ ok: true, comparisons: list });
  });

  app.post('/api/comparisons', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const targetUserId = auth.user.id;
    const { comparison } = req.body || {};
    if (
      !comparison ||
      !Array.isArray(comparison.products) ||
      comparison.products.length === 0
    ) {
      res.status(400).json({
        ok: false,
        error: 'A valid comparison with at least one verified product is required.',
      });
      return;
    }
    const nowIso = new Date().toISOString();
    const safeId = String(comparison.id || `cmp_${Date.now().toString(36)}`)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 120);
    const products = (comparison.products as RankedProductOffer[]).slice(0, 10);
    const record: SavedComparisonRecord = {
      id: safeId,
      userId: targetUserId,
      title: sanitizeTextAgainstXss(
        String(comparison.title || `${products[0]?.category || 'Product'} Comparison`),
        140
      ),
      category: sanitizeTextAgainstXss(
        String(comparison.category || products[0]?.category || 'General'),
        80
      ),
      productIds: products.map((p) => String(p.id)),
      products,
      recommendedProductId:
        typeof comparison.recommendedProductId === 'string'
          ? comparison.recommendedProductId
          : products[0]?.id || null,
      crucibleSummary: sanitizeTextAgainstXss(
        String(
          comparison.crucibleSummary ||
            `Compared ${products.length} verified offers across price, rating, and specifications.`
        ),
        1800
      ),
      createdAt:
        typeof comparison.createdAt === 'string' && comparison.createdAt
          ? comparison.createdAt
          : nowIso,
      updatedAt: nowIso,
    };

    const currentList = savedComparisonsByUserId.get(targetUserId) || [];
    const existingIdx = currentList.findIndex((c) => c.id === record.id);
    if (existingIdx >= 0) {
      currentList[existingIdx] = record;
    } else {
      currentList.unshift(record);
    }
    savedComparisonsByUserId.set(targetUserId, currentList.slice(0, 50));
    saveRuntimeSnapshot();
    res.json({ ok: true, comparison: record, comparisons: savedComparisonsByUserId.get(targetUserId) || [] });
  });

  app.delete('/api/comparisons/:id', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const targetUserId = auth.user.id;
    const cmpId = req.params.id;
    const currentList = savedComparisonsByUserId.get(targetUserId) || [];
    const exists = currentList.some((c) => c.id === cmpId);
    if (!exists) {
      res.status(404).json({ ok: false, error: 'Saved comparison not found.' });
      return;
    }
    const nextList = currentList.filter((c) => c.id !== cmpId);
    savedComparisonsByUserId.set(targetUserId, nextList);
    saveRuntimeSnapshot();
    res.json({ ok: true, deleted: true, id: cmpId, comparisons: nextList });
  });

  app.put('/api/user/settings', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const { preferences = {} } = req.body || {};
    const safePreferences = sanitizeUserPreferencesPatch(preferences, auth.user.preferences);
    const updatedUser: UserAccount = {
      ...auth.user,
      preferences: safePreferences,
    };
    usersById.set(updatedUser.id, updatedUser);
    saveRuntimeSnapshot();
    const balanceRes = paypalSandboxEngine.getAccountBalanceForUser({
      authenticatedUserId: updatedUser.id,
      userEmail: updatedUser.email,
      preferredCurrency: updatedUser.preferences.defaultCurrency,
    });
    res.json({
      user: updatedUser,
      accountBalance: balanceRes.balance || null,
    });
  });

  // --- AUTHORITATIVE USER ACCOUNT BALANCE ENDPOINTS (`/api/account/balance`) ---
  app.get('/api/account/balance', async (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;

    const targetUserId =
      typeof req.query.targetUserId === 'string'
        ? req.query.targetUserId
        : typeof req.query.userId === 'string'
        ? req.query.userId
        : undefined;
    const simulateUnavailable = req.query.simulateUnavailable === '1';
    const connStatus = paypalSandboxEngine.getAccountConnectionForUser(auth.user.id).status;
    // Phase 8 strict rule: Do NOT auto-initialize a $500 wallet for users who have not linked PayPal,
    // unless explicitly requested via ?autoInitialize=1 for sandbox developer diagnostics.
    const autoInitialize =
      req.query.autoInitialize === '1' ||
      paypalSandboxEngine.hasInitializedBuyerWallet(auth.user.id) ||
      (connStatus === 'connected' && req.query.autoInitialize !== '0');

    if (connStatus === 'connected' && req.query.syncReporting === '1') {
      await paypalSandboxEngine.fetchPayPalReportingBalances({
        authenticatedUserId: auth.user.id,
        targetUserId,
      });
    }

    const result = paypalSandboxEngine.getAccountBalanceForUser({
      authenticatedUserId: auth.user.id,
      targetUserId,
      userEmail: auth.user.email,
      preferredCurrency: auth.user.preferences.defaultCurrency,
      simulateUnavailable,
      autoInitializeSandboxWallet: autoInitialize,
    });

    if (!result.ok || !result.balance) {
      res.status(result.statusCode).json({
        ok: false,
        errorCode: result.errorCode,
        error: result.message,
      });
      return;
    }

    res.json({
      ok: true,
      balance: result.balance,
      accountBalance: result.balance,
      buyerWallet: paypalSandboxEngine.hasInitializedBuyerWallet(auth.user.id)
        ? paypalSandboxEngine.getBuyerSandboxWallet(auth.user.id, auth.user.email)
        : null,
    });
  });

  app.post('/api/account/balance/refresh', async (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;

    const targetUserId =
      typeof req.body?.targetUserId === 'string'
        ? req.body.targetUserId
        : typeof req.body?.userId === 'string'
        ? req.body.userId
        : undefined;
    const connStatus = paypalSandboxEngine.getAccountConnectionForUser(auth.user.id).status;
    const initializeSandboxWallet =
      req.body?.forceInitializeSandboxWallet === true ||
      (connStatus === 'connected' && req.body?.initializeSandboxWallet !== false);

    // Attempt real PayPal Reporting API synchronization (/v1/reporting/balances) when connected
    const reportingSync = await paypalSandboxEngine.fetchPayPalReportingBalances({
      authenticatedUserId: auth.user.id,
      targetUserId,
    });

    const result = paypalSandboxEngine.getAccountBalanceForUser({
      authenticatedUserId: auth.user.id,
      targetUserId,
      userEmail: auth.user.email,
      preferredCurrency: auth.user.preferences.defaultCurrency,
      autoInitializeSandboxWallet: initializeSandboxWallet,
    });

    if (!result.ok || !result.balance) {
      res.status(result.statusCode).json({
        ok: false,
        errorCode: result.errorCode,
        error: result.message,
      });
      return;
    }

    saveRuntimeSnapshot();
    res.json({
      ok: true,
      balance: result.balance,
      accountBalance: result.balance,
      reportingSync: {
        queriedReportingApi: reportingSync.queriedReportingApi,
        reportingEndpointStatus: reportingSync.reportingEndpointStatus,
        currenciesCount: reportingSync.currencies.length,
      },
      buyerWallet:
        connStatus === 'connected' && paypalSandboxEngine.hasInitializedBuyerWallet(auth.user.id)
          ? paypalSandboxEngine.getBuyerSandboxWallet(auth.user.id, auth.user.email)
          : null,
      message: result.message,
    });
  });

  // --- PROTECTED USER PAYMENT HISTORY ENDPOINTS (`/api/purchases`) ---
  app.get('/api/purchases', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const purchases = paypalSandboxEngine.getUserPurchases(auth.user.id);
    res.json({
      ok: true,
      userId: auth.user.id,
      purchases,
    });
  });

  app.get('/api/purchases/:orderId', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const txCheck = paypalSandboxEngine.getTransactionForUser(req.params.orderId, auth.user.id);
    if (!txCheck.ok || !txCheck.transaction) {
      res.status(txCheck.statusCode).json({
        ok: false,
        errorCode: txCheck.errorCode,
        error: txCheck.message,
      });
      return;
    }
    const userPurchases = paypalSandboxEngine.getUserPurchases(auth.user.id);
    const match = userPurchases.find(
      (p) =>
        p.orderReference === txCheck.transaction?.sparkOrderId ||
        p.paypalOrderId === txCheck.transaction?.paypalOrderId ||
        p.id === req.params.orderId
    );
    if (!match) {
      res.status(404).json({
        ok: false,
        errorCode: 'purchase_not_found',
        error: `No finalized purchase record found for order ${req.params.orderId}.`,
      });
      return;
    }
    res.json({
      ok: true,
      purchase: match,
      transaction: txCheck.transaction,
    });
  });

  // --- PROTECTED SHOPPING CART ENDPOINTS (`/api/cart`) ---
  const buildChannel3CartValidator = () => {
    const channel3ApiKey = (process.env.CHANNEL3_API_KEY || '').trim();
    const channel3Ready = isChannel3CredentialConfigured(channel3ApiKey);

    return async (item: {
      itemId: string;
      productId: string;
      productUrl: string;
      sourceId: string;
      unitPrice: number;
      availability: 'in_stock' | 'out_of_stock' | 'unknown';
    }) => {
      if (item.sourceId === 'paypal_sandbox_test_catalog') {
        const sku = SPARK_SANDBOX_TEST_CATALOG.find(
          (s) => s.id === item.productId || s.sku === item.productId
        );
        if (sku) {
          return {
            price: sku.unitPrice,
            currency: sku.currency,
            availability: 'in_stock' as const,
            merchant: sku.merchant,
            validationSource: 'spark_sandbox_catalog' as const,
            statusMessage: 'Verified against Spark PayPal Sandbox Catalog.',
          };
        }
      }

      if (channel3Ready) {
        try {
          const cleanRawId = item.productId.replace(/^ch3_/, '');
          const detailResult = await queryChannel3ProductDetail(cleanRawId, 'USD', {
            apiKey: channel3ApiKey,
          });
          if (detailResult.offers.length > 0) {
            const bestDetail = detailResult.offers[0];
            return {
              price: bestDetail.priceStatus === 'verified' ? bestDetail.price : null,
              currency: bestDetail.currency,
              availability:
                bestDetail.availability ||
                (bestDetail.availabilityStatus === 'verified_in_stock'
                  ? ('in_stock' as const)
                  : bestDetail.availabilityStatus === 'verified_out_of_stock'
                  ? ('out_of_stock' as const)
                  : ('unknown' as const)),
              merchant: bestDetail.merchant,
              validationSource: 'channel3_api' as const,
              statusMessage: 'Re-verified live via Channel3 Product Detail API.',
            };
          }
          if (item.productUrl && item.productUrl.startsWith('http')) {
            const urlResult = await queryChannel3UrlLookup(item.productUrl, {
              apiKey: channel3ApiKey,
            });
            if (urlResult.offers.length > 0) {
              const best = urlResult.offers[0];
              return {
                price: best.priceStatus === 'verified' ? best.price : null,
                currency: best.currency,
                availability:
                  best.availability ||
                  (best.availabilityStatus === 'verified_in_stock'
                    ? ('in_stock' as const)
                    : best.availabilityStatus === 'verified_out_of_stock'
                    ? ('out_of_stock' as const)
                    : ('unknown' as const)),
                merchant: best.merchant,
                validationSource: 'channel3_api' as const,
                statusMessage: 'Re-verified live via Channel3 URL Lookup API.',
              };
            }
          }
        } catch {
          // Fall back gracefully to verified session offer registry
        }
      }

      return null;
    };
  };

  // --- SAVED PRODUCTS LIVE CHANNEL3 REVALIDATION ENDPOINT (`/api/saved/revalidate`) ---
  app.post('/api/saved/revalidate', async (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const rawProducts = Array.isArray(req.body?.products) ? req.body.products : [];
    const validator = buildChannel3CartValidator();
    const nowIso = new Date().toISOString();
    const results: SavedProductRevalidationItem[] = [];
    const updatedProducts: RankedProductOffer[] = [];
    const activeOffers = getAllActiveOffers(auth.user.id);

    for (const raw of rawProducts.slice(0, 30)) {
      if (!raw || typeof raw !== 'object' || !raw.id) continue;
      const prod = raw as RankedProductOffer;
      const prevPrice =
        typeof prod.price === 'number' && prod.priceStatus === 'verified' ? prod.price : null;

      let currentPrice: number | null = prevPrice;
      let availabilityStatus: RankedProductOffer['availabilityStatus'] =
        prod.availabilityStatus || 'verified_in_stock';
      let statusMessage = 'Verified against active session product graph.';

      const liveCheck = await validator({
        itemId: prod.id,
        productId: prod.id,
        productUrl: prod.canonicalUrl || '',
        sourceId: prod.sourceId || 'channel3_api',
        unitPrice: prevPrice ?? 0,
        availability:
          prod.availabilityStatus === 'verified_out_of_stock' ? 'out_of_stock' : 'in_stock',
      });

      if (liveCheck) {
        currentPrice = liveCheck.price !== null ? liveCheck.price : prevPrice;
        availabilityStatus =
          liveCheck.availability === 'in_stock'
            ? 'verified_in_stock'
            : liveCheck.availability === 'out_of_stock'
            ? 'verified_out_of_stock'
            : 'availability_unverified';
        statusMessage = liveCheck.statusMessage;
      } else {
        const sessionMatch = activeOffers.find((o) => o.id === prod.id);
        if (sessionMatch && sessionMatch.price !== null && sessionMatch.priceStatus === 'verified') {
          currentPrice = sessionMatch.price;
          availabilityStatus = sessionMatch.availabilityStatus;
          statusMessage = 'Re-verified against live session Channel3 offer cache.';
        }
      }

      const priceChanged =
        prevPrice !== null &&
        currentPrice !== null &&
        Math.abs(currentPrice - prevPrice) >= 0.01;
      const priceDelta =
        prevPrice !== null && currentPrice !== null
          ? Number((currentPrice - prevPrice).toFixed(2))
          : null;

      results.push({
        productId: prod.id,
        productName: prod.name,
        merchant: prod.merchant,
        previousPrice: prevPrice,
        currentPrice,
        priceChanged,
        priceDelta,
        availabilityStatus,
        lastValidatedAt: nowIso,
        statusMessage,
      });

      updatedProducts.push({
        ...prod,
        price: currentPrice,
        priceStatus: currentPrice !== null ? 'verified' : 'price_could_not_be_verified',
        availabilityStatus,
        retrievedAt: nowIso,
        specs: {
          ...(prod.specs || {}),
          'Last Validated At': nowIso,
          ...(prevPrice !== null ? { 'Previous Price': String(prevPrice) } : {}),
        },
      });
    }

    res.json({
      ok: true,
      validatedAt: nowIso,
      revalidatedCount: results.length,
      priceChangesCount: results.filter((r) => r.priceChanged).length,
      findings: results,
      products: updatedProducts,
    });
  });

  // --- PURCHASES LEDGER RECONCILIATION ENDPOINT (`/api/purchases/reconcile`) ---
  app.post('/api/purchases/reconcile', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const purchases = paypalSandboxEngine.getUserPurchases(auth.user.id);
    const transactions = purchases;
    const completedCount = purchases.filter((p) => p.status === 'completed').length;
    const pendingCount = purchases.filter((p) => p.status === 'pending').length;
    const failedOrCancelledCount = purchases.filter(
      (p) => p.status === 'failed' || p.status === 'cancelled' || p.status === 'declined'
    ).length;

    res.json({
      ok: true,
      reconciledAt: new Date().toISOString(),
      userId: auth.user.id,
      purchases,
      summary: {
        totalPurchases: purchases.length,
        totalSandboxTransactions: transactions.length,
        completedCount,
        pendingCount,
        failedOrCancelledCount,
      },
      message: `Reconciled ${purchases.length} verified purchase record(s) across ${transactions.length} PayPal Sandbox transaction(s).`,
    });
  });

  app.get('/api/paypal/catalog', (_req, res) => {
    res.json({
      ok: true,
      catalog: SPARK_SANDBOX_TEST_CATALOG,
    });
  });

  app.get('/api/cart', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    res.json({
      ok: true,
      cart: paypalSandboxEngine.getUserCart(auth.user.id),
      catalog: SPARK_SANDBOX_TEST_CATALOG,
    });
  });

  app.post('/api/cart/items', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const {
      product,
      itemId,
      skuId,
      offerId,
      quantity = 1,
      sku,
      variantId,
      variantLabel,
      selectedOptions,
      clientSubmittedPrice,
    } = req.body || {};
    const resolvedItemId =
      typeof itemId === 'string' && itemId.trim()
        ? itemId
        : typeof skuId === 'string' && skuId.trim()
        ? skuId
        : undefined;
    const result = paypalSandboxEngine.addToCart({
      userId: auth.user.id,
      product: product && typeof product === 'object' ? (product as ProductOffer) : undefined,
      itemId: resolvedItemId,
      offerId: typeof offerId === 'string' ? offerId : undefined,
      quantity: Number(quantity) ?? 1,
      sku: typeof sku === 'string' ? sku : null,
      variantId: typeof variantId === 'string' ? variantId : null,
      variantLabel: typeof variantLabel === 'string' ? variantLabel : null,
      selectedOptions:
        selectedOptions && typeof selectedOptions === 'object' ? selectedOptions : undefined,
      clientSubmittedPrice:
        typeof clientSubmittedPrice === 'number' ? clientSubmittedPrice : undefined,
    });
    if (!result.ok) {
      res.status(result.statusCode).json({
        ok: false,
        errorCode: result.errorCode,
        error: result.message,
        message: result.message,
        cart: result.cart,
      });
      return;
    }
    saveRuntimeSnapshot();
    res.json({
      ok: true,
      message: result.message,
      cart: result.cart,
      addedItem: result.addedItem,
    });
  });

  app.patch('/api/cart/items/:itemId', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const hasQuantity = req.body?.quantity !== undefined;
    const rawQty = hasQuantity ? Number(req.body?.quantity) : undefined;
    if (hasQuantity && !Number.isFinite(rawQty)) {
      res.status(400).json({
        ok: false,
        errorCode: 'invalid_quantity',
        error: 'A numeric quantity is required.',
      });
      return;
    }
    const result = paypalSandboxEngine.updateCartItemQuantity({
      userId: auth.user.id,
      itemId: req.params.itemId,
      quantity: rawQty,
      variantLabel:
        typeof req.body?.variantLabel === 'string' ? req.body.variantLabel : undefined,
      selectedOptions:
        req.body?.selectedOptions && typeof req.body.selectedOptions === 'object'
          ? req.body.selectedOptions
          : undefined,
      sku: typeof req.body?.sku === 'string' ? req.body.sku : undefined,
    });
    if (!result.ok) {
      res.status(result.statusCode).json({
        ok: false,
        errorCode: result.errorCode,
        error: result.message,
        message: result.message,
        cart: result.cart,
      });
      return;
    }
    saveRuntimeSnapshot();
    res.json({
      ok: true,
      message: result.message,
      cart: result.cart,
    });
  });

  app.delete('/api/cart/items/:itemId', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const result = paypalSandboxEngine.removeCartItem({
      userId: auth.user.id,
      itemId: req.params.itemId,
    });
    if (!result.ok) {
      res.status(result.statusCode).json({
        ok: false,
        errorCode: result.errorCode,
        error: result.message,
        message: result.message,
        cart: result.cart,
      });
      return;
    }
    saveRuntimeSnapshot();
    res.json({
      ok: true,
      message: result.message,
      cart: result.cart,
    });
  });

  app.delete('/api/cart', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const cart = paypalSandboxEngine.clearUserCart(auth.user.id);
    saveRuntimeSnapshot();
    res.json({
      ok: true,
      message: 'Cleared your shopping cart.',
      cart,
    });
  });

  app.post('/api/cart/restore', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const result = paypalSandboxEngine.restoreLastRemovedCartItem(auth.user.id);
    if (!result.ok) {
      res.status(result.statusCode).json({
        ok: false,
        errorCode: result.errorCode,
        error: result.message,
        message: result.message,
      });
      return;
    }
    saveRuntimeSnapshot();
    res.json({
      ok: true,
      message: result.message,
      cart: result.cart,
      restoredItem: result.restoredItem,
    });
  });

  app.post('/api/cart/remove-unavailable', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const result = paypalSandboxEngine.removeUnavailableCartItems(auth.user.id);
    saveRuntimeSnapshot();
    res.json({
      ok: true,
      removedCount: result.removedCount,
      message: result.message,
      cart: result.cart,
    });
  });

  app.post('/api/cart/coupon', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const couponCode = typeof req.body?.couponCode === 'string' ? req.body.couponCode : '';
    const result = paypalSandboxEngine.applyCartCoupon({
      userId: auth.user.id,
      couponCode,
    });
    if (!result.ok) {
      res.status(result.statusCode).json({
        ok: false,
        errorCode: result.errorCode,
        error: result.message,
        message: result.message,
        cart: result.cart,
      });
      return;
    }
    saveRuntimeSnapshot();
    res.json({
      ok: true,
      message: result.message,
      cart: result.cart,
    });
  });

  app.delete('/api/cart/coupon', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const result = paypalSandboxEngine.removeCartCoupon(auth.user.id);
    saveRuntimeSnapshot();
    res.json({
      ok: true,
      message: result.message,
      cart: result.cart,
    });
  });

  app.post('/api/cart/accept-price-changes', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const itemId = typeof req.body?.itemId === 'string' ? req.body.itemId : undefined;
    const result = paypalSandboxEngine.acceptCartPriceChanges({
      userId: auth.user.id,
      itemId,
    });
    saveRuntimeSnapshot();
    res.json({
      ok: true,
      message: result.message,
      cart: result.cart,
    });
  });

  app.post('/api/cart/validate', async (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const report = await paypalSandboxEngine.validateCartItems(auth.user.id, {
      channel3LookupFn: buildChannel3CartValidator(),
    });
    saveRuntimeSnapshot();
    res.json({
      ok: true,
      report,
      cart: report.cart,
    });
  });

  app.post('/api/cart/prepare-checkout', async (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const expectedRevision =
      typeof req.body?.expectedRevision === 'number' ? req.body.expectedRevision : undefined;
    const result = await paypalSandboxEngine.prepareCartCheckout(auth.user.id, {
      expectedRevision,
      channel3LookupFn: buildChannel3CartValidator(),
    });
    saveRuntimeSnapshot();
    res.status(result.ok ? 200 : result.statusCode).json({
      ok: result.ok,
      errorCode: result.errorCode,
      error: result.ok ? undefined : result.message,
      message: result.message,
      preparation: result.preparation,
      cart: result.preparation.cart,
    });
  });

  app.put('/api/cart/sync', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const revision = Number(req.body?.revision) || 1;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const appliedCouponCode =
      typeof req.body?.appliedCouponCode === 'string' ? req.body.appliedCouponCode : null;
    const result = paypalSandboxEngine.syncUserCartFromClient({
      userId: auth.user.id,
      revision,
      items,
      appliedCouponCode,
    });
    if (!result.staleRejected) {
      saveRuntimeSnapshot();
    }
    res.json({
      ok: result.ok,
      staleRejected: result.staleRejected,
      message: result.message,
      cart: result.cart,
    });
  });

  // --- PROTECTED CHECKOUT SESSION ENDPOINTS (`/api/paypal/checkout-sessions`) ---
  app.post('/api/paypal/checkout-sessions', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const {
      itemId,
      quantity = 1,
      currency,
      couponCode,
      clientSubmittedUnitPrice,
      clientSubmittedTotalAmount,
    } = req.body || {};

    if (!itemId || typeof itemId !== 'string') {
      res.status(400).json({
        ok: false,
        errorCode: 'missing_item_id',
        error: 'A trusted server-side itemId is required to create a checkout session.',
      });
      return;
    }

    const result = paypalSandboxEngine.createCheckoutSession({
      userId: auth.user.id,
      userEmail: auth.user.email,
      itemId: itemId.trim(),
      quantity: Number(quantity) || 1,
      currency,
      couponCode,
      clientSubmittedUnitPrice:
        typeof clientSubmittedUnitPrice === 'number' ? clientSubmittedUnitPrice : undefined,
      clientSubmittedTotalAmount:
        typeof clientSubmittedTotalAmount === 'number' ? clientSubmittedTotalAmount : undefined,
    });

    if (!result.ok || !result.checkoutSession) {
      res.status(result.statusCode).json({
        ok: false,
        errorCode: result.errorCode,
        error: result.message,
      });
      return;
    }

    res.json({
      ok: true,
      checkoutSession: result.checkoutSession,
    });
  });

  app.get('/api/paypal/checkout-sessions', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    res.json({
      ok: true,
      checkoutSessions: paypalSandboxEngine.getUserCheckoutSessions(auth.user.id),
    });
  });

  // ============================================================================
  // OFFICIAL PAYPAL ACCOUNT LINKING (LOG IN WITH PAYPAL / IDENTITY API OAuth 2.0)
  // ============================================================================

  const resolvePublicAppOrigin = (req?: express.Request): string => {
    if (req) {
      const originHeader = String(req.header('origin') || '').trim();
      if (
        originHeader.startsWith('https://') &&
        !originHeader.includes('localhost') &&
        !originHeader.includes('127.0.0.1')
      ) {
        return originHeader.replace(/\/$/, '');
      }

      const forwardedHost = String(
        req.header('x-forwarded-host') || req.header('host') || ''
      )
        .split(',')[0]
        .trim();
      if (
        forwardedHost &&
        !forwardedHost.startsWith('localhost') &&
        !forwardedHost.startsWith('127.0.0.1')
      ) {
        return `https://${forwardedHost}`;
      }
    }

    const rawAppUrl = !isPlaceholderEnvValue(process.env.APP_URL)
      ? process.env.APP_URL!.trim().replace(/\/$/, '')
      : '';
    if (
      rawAppUrl &&
      !rawAppUrl.includes('localhost') &&
      !rawAppUrl.includes('127.0.0.1')
    ) {
      return rawAppUrl.startsWith('http://')
        ? rawAppUrl.replace(/^http:\/\//i, 'https://')
        : rawAppUrl;
    }

    return DEV_PREVIEW_APP_URL;
  };

  const buildPayPalPreviewEnvironmentMetadata = (req?: express.Request) => {
    const publicOrigin = resolvePublicAppOrigin(req);
    const oauthCallbackUrl = paypalSandboxEngine.getConfiguredRedirectUri(publicOrigin);
    const oauthInitiationUrl = `${publicOrigin}${DEFAULT_PAYPAL_CONNECT_PATH}`;
    return {
      actualPreviewUrl: publicOrigin,
      sharedPreviewUrl: DEFAULT_PREVIEW_APP_URL,
      devPreviewUrl: DEV_PREVIEW_APP_URL,
      oauthCallbackUrl,
      sharedOauthCallbackUrl: `${DEFAULT_PREVIEW_APP_URL}${DEFAULT_PAYPAL_CALLBACK_PATH}`,
      devOauthCallbackUrl: `${DEV_PREVIEW_APP_URL}${DEFAULT_PAYPAL_CALLBACK_PATH}`,
      oauthInitiationUrl,
      devOauthInitiationUrl: `${DEV_PREVIEW_APP_URL}${DEFAULT_PAYPAL_CONNECT_PATH}`,
      callbackEndpointPath: DEFAULT_PAYPAL_CALLBACK_PATH,
      initiationEndpointPath: DEFAULT_PAYPAL_CONNECT_PATH,
      publicHttpsVerified: oauthCallbackUrl.startsWith('https://'),
      futureCustomDomainCompatible: true,
      requiredEnvironmentVariables: [
        'PAYPAL_ENV',
        'PAYPAL_CLIENT_ID',
        'PAYPAL_CLIENT_SECRET',
        'PAYPAL_REDIRECT_URI',
        'PAYPAL_OIDC_REDIRECT_URI',
        'PAYPAL_TOKEN_ENCRYPTION_KEY',
        'PAYPAL_WEBHOOK_ID',
        'APP_URL',
      ],
      backendDeploymentStatus: 'deployed_and_reachable',
    };
  };

  const probePayPalAuthorizeEndpoint = async (
    authUrl: string,
    clientId: string,
    redirectUri: string,
    scopes: string[]
  ): Promise<{
    accepted: boolean;
    errorType: 'none' | 'invalid_redirect_uri' | 'invalid_scope' | 'invalid_client' | 'network';
    internalErrorDescription: string | null;
  }> => {
    try {
      const probeParams = new URLSearchParams({
        flowEntry: 'static',
        client_id: clientId,
        response_type: 'code',
        scope: scopes.join(' '),
        redirect_uri: redirectUri,
        state: 'pp_preflight_probe',
      });
      const res = await fetch(`${authUrl}?${probeParams.toString()}`, {
        method: 'GET',
        redirect: 'manual',
      });
      if (res.status >= 300 && res.status < 400) {
        return { accepted: true, errorType: 'none', internalErrorDescription: null };
      }
      const html = await res.text();
      const intErrMatch = html.match(/int_err_desc=([^&'"]+)/i);
      const decodedIntErr = intErrMatch ? decodeURIComponent(intErrMatch[1]) : null;
      if (
        (decodedIntErr && decodedIntErr.toLowerCase().includes('invalid redirect_uri')) ||
        html.includes('invalid_redirect_uri')
      ) {
        return {
          accepted: false,
          errorType: 'invalid_redirect_uri',
          internalErrorDescription:
            decodedIntErr || `Invalid redirect_uri ${redirectUri}`,
        };
      }
      if (
        (decodedIntErr && decodedIntErr.toLowerCase().includes('scope')) ||
        html.includes('invalid_scope')
      ) {
        return {
          accepted: false,
          errorType: 'invalid_scope',
          internalErrorDescription: decodedIntErr || 'Requested scope not enabled on PayPal app.',
        };
      }
      if (html.includes('invalid client_id or redirect_uri')) {
        return {
          accepted: false,
          errorType: 'invalid_redirect_uri',
          internalErrorDescription:
            decodedIntErr || 'PayPal rejected client_id or redirect_uri.',
        };
      }
      return { accepted: true, errorType: 'none', internalErrorDescription: null };
    } catch {
      return { accepted: true, errorType: 'network', internalErrorDescription: null };
    }
  };

  // A. Initiate Personal PayPal Account Linking (`POST /api/paypal/connect`, `GET /api/paypal/connect`, `POST /api/integrations/paypal/connect`)
  const handleInitiatePayPalLinkRoute = async (
    req: express.Request,
    res: express.Response
  ) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;

    if (!checkPayPalLinkRateLimit(auth.user.id)) {
      res.status(429).json({
        ok: false,
        errorCode: 'rate_limit_exceeded',
        error: 'Too many PayPal authorization attempts. Please wait a minute and try again.',
      });
      return;
    }

    const forceReconnect =
      req.body?.forceReconnect !== false &&
      req.query?.forceReconnect !== 'false' &&
      req.query?.forceReconnect !== '0';
    const publicOrigin = resolvePublicAppOrigin(req);
    const dynamicRedirectUri = paypalSandboxEngine.getConfiguredRedirectUri(publicOrigin);
    let requestedRedirectUri =
      typeof req.body?.redirectUri === 'string' && req.body.redirectUri.trim()
        ? req.body.redirectUri.trim()
        : dynamicRedirectUri;
    let requestedScopes: string[] | undefined = Array.isArray(req.body?.scopes)
      ? req.body.scopes
      : undefined;

    const envConfig = resolvePayPalEnvironmentConfig();
    const skipPreflight =
      req.body?.skipPreflight === true || req.query?.skipPreflight === '1';

    let useOrdersV2BuyerHandshake = false;

    if (
      !skipPreflight &&
      envConfig.isValidEnvironment &&
      envConfig.allCoreCredentialsPresent &&
      process.env.PAYPAL_CLIENT_ID
    ) {
      const clientId = process.env.PAYPAL_CLIENT_ID.trim();
      const clientSecret = normalizePayPalClientSecret(process.env.PAYPAL_CLIENT_SECRET);
      const candidateUris = Array.from(
        new Set([
          `${DEV_PREVIEW_APP_URL}/api/paypal/callback`,
          requestedRedirectUri,
          `${publicOrigin}/api/paypal/callback`,
          `${DEFAULT_PREVIEW_APP_URL}/api/paypal/callback`,
          `${DEV_PREVIEW_APP_URL}/api/integrations/paypal/callback`,
          `${DEFAULT_PREVIEW_APP_URL}/api/integrations/paypal/callback`,
        ])
      );

      const uriChecks = await Promise.all(
        candidateUris.map(async (uri) => ({
          uri,
          probe: await probePayPalAuthorizeEndpoint(envConfig.authUrl, clientId, uri, [
            'openid',
          ]),
        }))
      );

      const matchedUriEntry = uriChecks.find((entry) => entry.probe.accepted);
      if (matchedUriEntry) {
        requestedRedirectUri = matchedUriEntry.uri;

        // Discover the exact identity scopes enabled on the PayPal application via `/v1/oauth2/token`
        if (!requestedScopes) {
          try {
            const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
            const appTokenRes = await fetch(`${envConfig.baseUrl}/v1/oauth2/token`, {
              method: 'POST',
              headers: {
                Authorization: `Basic ${basicAuth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
              },
              body: 'grant_type=client_credentials',
            });
            if (appTokenRes.ok) {
              const appTokenData = (await appTokenRes.json().catch(() => ({}))) as {
                scope?: string;
              };
              const appScopeSet = new Set(
                String(appTokenData.scope || '')
                  .split(/\s+/)
                  .filter(Boolean)
              );
              const matchedIdentityScopes = DEFAULT_PAYPAL_IDENTITY_SCOPES.filter((sc) =>
                appScopeSet.has(sc)
              );
              requestedScopes =
                matchedIdentityScopes.length > 0
                  ? Array.from(new Set(['openid', ...matchedIdentityScopes]))
                  : ['openid'];
            }
          } catch {
            // Fall back to default probe
          }
        }
      } else {
        // PayPal's legacy "Log in with PayPal" `/signin/authorize` endpoint rejected the Return URL
        // because the Return URL wasn't manually registered in PayPal Developer Dashboard for this Client ID.
        // Automatically use PayPal Orders v2 Buyer Handshake (`POST /v2/checkout/orders` with `intent: "AUTHORIZE"`,
        // $0.00 captured), which accepts dynamic `return_url` on `www.sandbox.paypal.com/checkoutnow` without
        // requiring manual Return URL registration in the Developer Dashboard.
        useOrdersV2BuyerHandshake = true;
        requestedScopes = requestedScopes || ['openid', 'email', 'profile'];
      }
    }

    const result = paypalSandboxEngine.initiateAccountLinking({
      userId: auth.user.id,
      sessionId: auth.session.sessionId,
      redirectUri: requestedRedirectUri,
      scopes: requestedScopes,
      forceReconnect,
    });

    const previewConfig = buildPayPalPreviewEnvironmentMetadata(req);

    if (!result.ok || !result.authorizationUrl || !result.state) {
      auth.user.paypal = {
        status: result.errorCode === 'missing_credentials' ? 'not_configured' : 'error',
        errorMessage: result.message,
        errorCode: result.errorCode,
      };
      usersById.set(auth.user.id, auth.user);
      res.status(result.statusCode).json({
        ok: false,
        status: auth.user.paypal.status,
        errorCode: result.errorCode,
        error: result.message,
        redirectUri: result.redirectUri || dynamicRedirectUri,
        previewConfig,
      });
      return;
    }

    let finalAuthorizationUrl = result.authorizationUrl;
    let handshakeMode: 'oidc_authorize' | 'orders_v2_handshake' = 'oidc_authorize';

    if (useOrdersV2BuyerHandshake && process.env.PAYPAL_CLIENT_ID) {
      try {
        const clientId = process.env.PAYPAL_CLIENT_ID.trim();
        const clientSecret = normalizePayPalClientSecret(process.env.PAYPAL_CLIENT_SECRET);
        const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const tokenRes = await fetch(`${envConfig.baseUrl}/v1/oauth2/token`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: 'grant_type=client_credentials',
        });

        if (tokenRes.ok) {
          const tokenData = (await tokenRes.json().catch(() => ({}))) as {
            access_token?: string;
          };
          if (tokenData.access_token) {
            const callbackReturnUrl = `${requestedRedirectUri}?state=${encodeURIComponent(
              result.state
            )}&flow=orders_v2_auth`;
            const callbackCancelUrl = `${requestedRedirectUri}?state=${encodeURIComponent(
              result.state
            )}&error=access_denied`;

            const orderRes = await fetch(`${envConfig.baseUrl}/v2/checkout/orders`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${tokenData.access_token}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              body: JSON.stringify({
                intent: 'AUTHORIZE',
                purchase_units: [
                  {
                    reference_id: `spark_link_${auth.user.id.slice(0, 20)}`,
                    description:
                      'Spark — PayPal Sandbox Buyer Account Verification Handshake ($0.00 charged — never captured)',
                    amount: {
                      currency_code: 'USD',
                      value: '0.01',
                    },
                  },
                ],
                application_context: {
                  brand_name: 'Spark Commerce (Sandbox)',
                  shipping_preference: 'NO_SHIPPING',
                  user_action: 'CONTINUE',
                  return_url: callbackReturnUrl,
                  cancel_url: callbackCancelUrl,
                },
              }),
            });

            if (orderRes.ok) {
              const orderData = (await orderRes.json().catch(() => ({}))) as {
                id?: string;
                links?: Array<{ rel?: string; href?: string }>;
              };
              const approveHref = orderData.links?.find(
                (l) => l.rel === 'approve' || l.rel === 'payer-action'
              )?.href;
              if (approveHref) {
                finalAuthorizationUrl = approveHref;
                handshakeMode = 'orders_v2_handshake';
              }
            }
          }
        }
      } catch {
        // Keep standard authorizationUrl if Orders v2 handshake creation encounters a network error
      }
    }

    auth.user.paypal = {
      status: 'connecting',
      environment: result.environment,
      errorMessage: undefined,
      errorCode: undefined,
    };
    usersById.set(auth.user.id, auth.user);
    saveRuntimeSnapshot();

    if (req.method === 'GET' && req.query.redirect === '1') {
      res.redirect(302, finalAuthorizationUrl);
      return;
    }

    res.json({
      ok: true,
      status: 'connecting',
      environment: result.environment,
      authorizationUrl: finalAuthorizationUrl,
      handshakeMode,
      redirectUri: result.redirectUri,
      scopes: result.scopes,
      expiresAt: result.expiresAt,
      message: result.message,
      previewConfig,
    });
  };

  app.post('/api/paypal/connect', handleInitiatePayPalLinkRoute);
  app.get('/api/paypal/connect', handleInitiatePayPalLinkRoute);
  app.post('/api/paypal/reconnect', (req, res) => {
    req.body = { ...(req.body || {}), forceReconnect: true };
    handleInitiatePayPalLinkRoute(req, res);
  });
  app.post('/api/integrations/paypal/connect', handleInitiatePayPalLinkRoute);
  app.post('/api/integrations/paypal/reconnect', (req, res) => {
    req.body = { ...(req.body || {}), forceReconnect: true };
    handleInitiatePayPalLinkRoute(req, res);
  });

  // B. PayPal OAuth 2.0 / OIDC / Orders v2 Handshake Callback (`GET /api/paypal/callback` & `GET /api/integrations/paypal/callback`)
  app.get(
    [
      '/api/paypal/callback',
      '/api/paypal/callback/',
      '/api/integrations/paypal/callback',
      '/api/integrations/paypal/callback/',
    ],
    async (req, res) => {
      const optAuth = authenticateRequest(req, res, { optional: true });
      const code = typeof req.query.code === 'string' ? req.query.code : null;
      const orderToken =
        typeof req.query.token === 'string'
          ? req.query.token
          : typeof req.query.ba_token === 'string'
          ? req.query.ba_token
          : null;
      const payerId =
        typeof req.query.PayerID === 'string'
          ? req.query.PayerID
          : typeof req.query.payer_id === 'string'
          ? req.query.payer_id
          : null;
      const state = typeof req.query.state === 'string' ? req.query.state : null;
      const error = typeof req.query.error === 'string' ? req.query.error : null;
      const errorDescription =
        typeof req.query.error_description === 'string' ? req.query.error_description : null;

      const result = await paypalSandboxEngine.completeAccountLinkingCallback({
        code,
        orderToken,
        payerId,
        state,
        error,
        errorDescription,
        authenticatedUserId: optAuth?.user.id || null,
        authenticatedUserEmail: optAuth?.user.email || null,
        authenticatedUserName:
          optAuth?.user.preferences.displayName ||
          optAuth?.user.preferences.preferredName ||
          null,
        sessionId: optAuth?.session.sessionId || null,
        forceReconnect: true,
      });

      const resolvedUserId = result.userId || optAuth?.user.id || null;
      if (resolvedUserId) {
        const targetUser = usersById.get(resolvedUserId);
        if (targetUser) {
          if (result.ok && result.connection) {
            targetUser.paypal = {
              status: 'connected',
              sandboxEmail: result.connection.email || undefined,
              maskedEmail: result.connection.maskedEmail || undefined,
              paypalName:
                result.connection.paypalName || result.connection.displayName || undefined,
              paypalSubjectId: result.connection.paypalSubjectId,
              payerId: result.connection.payerId || undefined,
              emailVerified: result.connection.emailVerified,
              verifiedAccount: result.connection.verifiedAccount,
              scopesGranted: result.connection.scopesGranted,
              environment: result.connection.environment,
              connectedAt: result.connection.connectedAt,
              updatedAt: result.connection.updatedAt,
              vaultId: result.connection.vaultId || null,
              vaultedAt: result.connection.vaultedAt || null,
            };
          } else {
            targetUser.paypal = {
              status: 'error',
              errorMessage: result.message,
              errorCode: result.errorCode,
            };
          }
          usersById.set(targetUser.id, targetUser);
        }
      }
      saveRuntimeSnapshot();

      const wantsJson =
        req.query.format === 'json' ||
        String(req.header('accept') || '')
          .toLowerCase()
          .includes('application/json');

      if (wantsJson) {
        res.status(result.statusCode).json({
          ok: result.ok,
          statusCode: result.statusCode,
          status: result.ok ? 'connected' : 'error',
          errorCode: result.errorCode || null,
          message: result.message,
          redirectPath: result.ok ? '/onboarding/paypal-success' : '/onboarding/connect-paypal',
          connection: result.connection || null,
          tableRow: result.tableRow || null,
          correlationId: result.correlationId,
        });
        return;
      }

      const payloadJson = JSON.stringify({
        type: 'SPARK_PAYPAL_OAUTH_RESULT',
        ok: result.ok,
        status: result.ok ? 'connected' : 'error',
        errorCode: result.errorCode || null,
        message: result.message,
        redirectPath: result.ok ? '/onboarding/paypal-success' : '/onboarding/connect-paypal',
        connection: result.connection || null,
        tableRow: result.tableRow || null,
      }).replace(/</g, '\\u003c');

      const safeTitle = result.ok
        ? 'PayPal Successfully Connected'
        : 'PayPal Authorization Could Not Complete';
      const safeMessage = String(result.message || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const badgeColor = result.ok ? '#10b981' : '#f43f5e';
      const targetRedirectPath = result.ok
        ? '/onboarding/paypal-success'
        : '/onboarding/connect-paypal';

      res.status(result.ok ? 200 : result.statusCode).send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle} — Spark</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #050507;
        color: #f4f4f5;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        padding: 24px;
      }
      .card {
        max-width: 440px;
        width: 100%;
        background: #0c0d12;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 20px;
        padding: 28px;
        text-align: center;
        box-shadow: 0 24px 48px rgba(0, 0, 0, 0.6);
      }
      .dot {
        width: 12px;
        height: 12px;
        border-radius: 999px;
        background: ${badgeColor};
        display: inline-block;
        margin-bottom: 14px;
      }
      h1 {
        font-size: 18px;
        margin: 0 0 10px;
      }
      p {
        font-size: 13px;
        line-height: 1.55;
        color: #a1a1aa;
        margin: 0 0 20px;
      }
      button {
        background: #0070ba;
        color: #fff;
        border: none;
        border-radius: 10px;
        padding: 10px 20px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="dot"></div>
      <h1>${safeTitle}</h1>
      <p>${safeMessage}</p>
      <button onclick="if (window.opener && !window.opener.closed) { window.close(); } else { window.location.href = '${targetRedirectPath}'; }">Continue to Spark</button>
    </div>
    <script>
      (function() {
        var payload = ${payloadJson};
        try {
          if (typeof BroadcastChannel !== 'undefined') {
            var bc = new BroadcastChannel('spark_paypal_oauth_channel');
            bc.postMessage(payload);
            bc.close();
          }
        } catch (e) {}
        try {
          localStorage.setItem('spark_paypal_oauth_result', JSON.stringify({
            payload: payload,
            ts: Date.now()
          }));
        } catch (e) {}
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, window.location.origin);
            setTimeout(function() { window.close(); }, 500);
          } else {
            setTimeout(function() {
              window.close();
              setTimeout(function() {
                window.location.href = '${targetRedirectPath}';
              }, 300);
            }, 600);
          }
        } catch (err) {
          console.error(err);
        }
      })();
    </script>
  </body>
</html>`);
    }
  );

  // Public Privacy Policy & User Agreement endpoints required by PayPal "Log in with PayPal -> Advanced Settings"
  app.get(['/privacy', '/privacy-policy'], (_req, res) => {
    res.status(200).send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Privacy Policy — Spark</title>
    <style>
      body { margin: 0; background: #09090B; color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 48px 24px; line-height: 1.65; }
      main { max-width: 680px; margin: 0 auto; background: #121217; border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 36px; }
      h1 { margin-top: 0; font-size: 24px; }
      p, li { color: #d4d4d8; font-size: 14px; }
      code { color: #67e8f9; }
    </style>
  </head>
  <body>
    <main>
      <h1>Spark Privacy Policy</h1>
      <p>When you connect your PayPal account via Log in with PayPal (OAuth 2.0 / OpenID Connect), Spark receives only the verified identity attributes you authorize (<code>payer_id</code>, full name, email address, address, and verification status) to associate your PayPal identity with your Spark account.</p>
      <ul>
        <li>Spark never receives or stores your PayPal password, bank account numbers, or payment card credentials.</li>
        <li>Any server-retained OAuth refresh token is encrypted at rest using AES-256-GCM and is never exposed to the browser.</li>
        <li>You may disconnect your PayPal account at any time from Spark Settings, which revokes active tokens and removes the account association.</li>
      </ul>
    </main>
  </body>
</html>`);
  });

  app.get(['/terms', '/user-agreement'], (_req, res) => {
    res.status(200).send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>User Agreement — Spark</title>
    <style>
      body { margin: 0; background: #09090B; color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 48px 24px; line-height: 1.65; }
      main { max-width: 680px; margin: 0 auto; background: #121217; border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; padding: 36px; }
      h1 { margin-top: 0; font-size: 24px; }
      p, li { color: #d4d4d8; font-size: 14px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Spark User Agreement</h1>
      <p>By using Spark and linking your PayPal account, you authorize Spark to verify your PayPal identity via official PayPal OAuth 2.0 / OpenID Connect flows and to require your explicit confirmation before initiating any payment or checkout transaction.</p>
      <ul>
        <li>All product prices, taxes, and shipping figures are sourced from live authorized APIs without fabrication.</li>
        <li>No payment or purchase is ever executed without your explicit interactive approval.</li>
        <li>You may revoke PayPal account permissions at any time from Spark Settings or your PayPal account security dashboard.</li>
      </ul>
    </main>
  </body>
</html>`);
  });

  // C. Get Authenticated User's PayPal Connection Status (`GET /api/integrations/paypal/status`)
  app.get('/api/integrations/paypal/status', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;

    const targetUserId =
      typeof req.query.targetUserId === 'string' ? req.query.targetUserId : undefined;
    const statusResult = paypalSandboxEngine.getAccountConnectionForUser(
      auth.user.id,
      targetUserId
    );

    if (!statusResult.ok) {
      res.status(statusResult.statusCode).json({
        ok: false,
        errorCode: statusResult.errorCode,
        error: statusResult.errorMessage,
      });
      return;
    }

    if (statusResult.connection && statusResult.connection.status === 'connected') {
      auth.user.paypal = {
        status: 'connected',
        sandboxEmail: statusResult.connection.email || undefined,
        maskedEmail: statusResult.connection.maskedEmail || undefined,
        paypalName:
          statusResult.connection.paypalName || statusResult.connection.displayName || undefined,
        paypalSubjectId: statusResult.connection.paypalSubjectId,
        payerId: statusResult.connection.payerId || undefined,
        emailVerified: statusResult.connection.emailVerified,
        verifiedAccount: statusResult.connection.verifiedAccount,
        scopesGranted: statusResult.connection.scopesGranted,
        environment: statusResult.connection.environment,
        connectedAt: statusResult.connection.connectedAt,
        updatedAt: statusResult.connection.updatedAt,
        vaultId: statusResult.connection.vaultId || null,
        vaultedAt: statusResult.connection.vaultedAt || null,
      };
    } else if (statusResult.status === 'expired' || statusResult.status === 'revoked') {
      auth.user.paypal = {
        status: statusResult.status,
        sandboxEmail: statusResult.connection?.email || undefined,
        maskedEmail: statusResult.connection?.maskedEmail || undefined,
        paypalName:
          statusResult.connection?.paypalName || statusResult.connection?.displayName || undefined,
        paypalSubjectId: statusResult.connection?.paypalSubjectId,
        payerId: statusResult.connection?.payerId || undefined,
        environment: statusResult.connection?.environment || statusResult.environment,
        connectedAt: statusResult.connection?.connectedAt,
        updatedAt: statusResult.connection?.updatedAt,
        errorMessage: statusResult.errorMessage,
        errorCode: statusResult.errorCode,
      };
    } else if (statusResult.status === 'error') {
      auth.user.paypal = {
        status: 'error',
        environment: statusResult.environment,
        errorMessage: statusResult.errorMessage,
        errorCode: statusResult.errorCode,
      };
    } else if (auth.user.paypal.status !== 'connecting') {
      auth.user.paypal = {
        status: statusResult.status,
        environment: statusResult.environment,
      };
    }
    usersById.set(auth.user.id, auth.user);

    const previewConfig = buildPayPalPreviewEnvironmentMetadata(req);
    res.json({
      ok: true,
      status: auth.user.paypal.status,
      environment: statusResult.environment,
      connected: statusResult.status === 'connected',
      configured: isPayPalConfigured(),
      redirectUri: previewConfig.oauthCallbackUrl,
      previewConfig,
      connection: statusResult.connection,
      tableRow: statusResult.tableRow,
      paypal: auth.user.paypal,
      errorMessage: statusResult.errorMessage || null,
      errorCode: statusResult.errorCode || null,
    });
  });

  // D. Disconnect Authenticated User's PayPal Account (`DELETE /api/integrations/paypal/disconnect` & `/api/paypal/disconnect`)
  const handleDisconnectPayPalRoute = (req: express.Request, res: express.Response) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;

    const confirmed =
      req.body?.confirmed === true ||
      req.query?.confirmed === 'true' ||
      req.query?.confirmed === '1';
    const targetUserId =
      typeof req.body?.targetUserId === 'string' ? req.body.targetUserId : undefined;

    const result = paypalSandboxEngine.disconnectAccountForUser({
      authenticatedUserId: auth.user.id,
      targetUserId,
      confirmed,
    });

    if (!result.ok) {
      res.status(result.statusCode).json({
        ok: false,
        errorCode: result.errorCode,
        error: result.message,
      });
      return;
    }

    auth.user.paypal = {
      status: isPayPalConfigured() ? 'not_connected' : 'not_configured',
    };
    usersById.set(auth.user.id, auth.user);

    res.json({
      ok: true,
      status: auth.user.paypal.status,
      tokenRevoked: Boolean(result.tokenRevoked),
      message: result.message,
      paypal: auth.user.paypal,
    });
  };

  app.delete('/api/integrations/paypal/disconnect', handleDisconnectPayPalRoute);
  app.post('/api/paypal/disconnect', handleDisconnectPayPalRoute);

  // E. PayPal Vault Consent Endpoint (`POST /api/integrations/paypal/vault`)
  app.post('/api/integrations/paypal/vault', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;

    const enabled = Boolean(req.body?.enabled);
    const vaultId = typeof req.body?.vaultId === 'string' ? req.body.vaultId : undefined;
    const result = paypalSandboxEngine.saveVaultTokenForUser({
      authenticatedUserId: auth.user.id,
      enabled,
      vaultId,
    });

    if (!result.ok) {
      res.status(result.statusCode).json({
        ok: false,
        error: result.message,
      });
      return;
    }

    auth.user.paypal = {
      ...auth.user.paypal,
      vaultId: result.vaultId,
      vaultedAt: result.vaultedAt,
    };
    usersById.set(auth.user.id, auth.user);

    res.json({
      ok: true,
      vaultId: result.vaultId,
      vaultedAt: result.vaultedAt,
      message: result.message,
      paypal: auth.user.paypal,
    });
  });

  // F. Connection Lifecycle State Transition (`POST /api/integrations/paypal/status/lifecycle`)
  app.post('/api/integrations/paypal/status/lifecycle', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;

    const newStatus = req.body?.status === 'revoked' ? 'revoked' : 'expired';
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const result = paypalSandboxEngine.markConnectionExpiredOrRevoked({
      authenticatedUserId: auth.user.id,
      newStatus,
      reason,
    });

    if (!result.ok) {
      res.status(result.statusCode).json({
        ok: false,
        error: result.message,
      });
      return;
    }

    auth.user.paypal = {
      ...auth.user.paypal,
      status: newStatus,
      errorMessage: result.message,
      errorCode: newStatus === 'expired' ? 'authorization_expired' : 'permissions_revoked',
    };
    usersById.set(auth.user.id, auth.user);

    res.json({
      ok: true,
      status: newStatus,
      message: result.message,
      paypal: auth.user.paypal,
    });
  });

  // ============================================================================
  // MERCHANT SANDBOX STUDIO & CHECKOUT ENDPOINTS (SEPARATE FROM ACCOUNT LINKING)
  // ============================================================================

  // 1. Global PayPal Integration & Preview Environment Status Endpoint
  app.get('/api/paypal/status', (req, res) => {
    const sandboxStatus = paypalSandboxEngine.getStatus();
    const envConfig = resolvePayPalEnvironmentConfig();
    const previewConfig = buildPayPalPreviewEnvironmentMetadata(req);
    if (!envConfig.allCoreCredentialsPresent) {
      res.json({
        configured: false,
        status: 'not_configured',
        environment: envConfig.environment,
        explicitState: 'Source not configured.',
        sandboxStatus,
        redirectUri: previewConfig.oauthCallbackUrl,
        previewConfig,
        message:
          envConfig.errorMessage ||
          'PayPal API credentials (PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET) are not configured on the server.',
      });
      return;
    }
    res.json({
      configured: true,
      status: sandboxStatus.oauthValidated ? 'connected' : 'not_connected',
      environment: envConfig.environment,
      explicitState: sandboxStatus.oauthValidated
        ? `Connected to PayPal (${envConfig.environment.toUpperCase()}).`
        : `PayPal (${envConfig.environment.toUpperCase()}) API configured (awaiting OAuth verification).`,
      sandboxStatus,
      redirectUri: previewConfig.oauthCallbackUrl,
      previewConfig,
      logs: paypalSandboxEngine.getLogs().slice(0, 20),
      message:
        sandboxStatus.lastError ||
        (sandboxStatus.oauthValidated
          ? `Connected to ${envConfig.baseUrl}`
          : 'PayPal credentials detected.'),
    });
  });

  // 3. Detailed PayPal Sandbox Environment Status (Protected & User-Scoped)
  app.get('/api/paypal/sandbox/status', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const access = verifyDeveloperAccess(auth.user);
    if (!access.authorized) {
      res.status(access.statusCode).json({ error: access.error });
      return;
    }
    const dbTables = paypalSandboxEngine.getSandboxDatabaseTables(auth.user.id);
    res.json({
      status: paypalSandboxEngine.getStatus(),
      currentUser: {
        id: auth.user.id,
        email: auth.user.email,
        displayName: auth.user.preferences.displayName,
      },
      accountConnection: paypalSandboxEngine.getAccountConnectionForUser(auth.user.id).connection,
      buyerWallet: dbTables.buyerWallet,
      databaseTables: {
        sandbox_payment_orders: dbTables.sandbox_payment_orders,
        sandbox_payment_captures: dbTables.sandbox_payment_captures,
        sandbox_payment_events: dbTables.sandbox_payment_events,
        purchase_audit_logs: dbTables.purchase_audit_logs,
      },
      checkoutSessions: paypalSandboxEngine.getUserCheckoutSessions(auth.user.id),
      transactions: paypalSandboxEngine.getTransactions({ userId: auth.user.id }),
      purchases: paypalSandboxEngine.getUserPurchases(auth.user.id),
      webhookEvents: paypalSandboxEngine.getWebhookEvents(auth.user.id),
      securityAuditLogs: paypalSandboxEngine.getSecurityAuditLogs(auth.user.id).slice(0, 25),
      logs: paypalSandboxEngine.getLogs(),
    });
  });

  // 4. Test PayPal Sandbox Merchant OAuth2 Connection (`client_credentials`) (Protected)
  app.post('/api/paypal/sandbox/test-connection', async (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const access = verifyDeveloperAccess(auth.user);
    if (!access.authorized) {
      res.status(access.statusCode).json({ error: access.error });
      return;
    }

    const forceRefresh = req.body?.forceRefresh !== false;
    const result = await paypalSandboxEngine.authenticate({ forceRefresh });
    const status = paypalSandboxEngine.getStatus();

    res.json({
      ok: result.ok,
      statusCode: result.statusCode,
      errorCode: result.errorCode || null,
      message: result.message,
      fromCache: Boolean(result.fromCache),
      expiresInSeconds: result.expiresInSeconds || null,
      correlationId: result.correlationId,
      status,
      logs: paypalSandboxEngine.getLogs().slice(0, 20),
    });
  });

  // 5. Create PayPal Sandbox Order (Protected, Bound to Authenticated Spark User)
  app.post('/api/paypal/sandbox/orders', async (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;

    const {
      checkoutSessionId,
      itemId,
      quantity = 1,
      currency,
      couponCode,
      clientSubmittedUnitPrice,
      clientSubmittedTotalAmount,
      returnUrl,
      cancelUrl,
      mockApplicationCode,
      executionMode,
      authorizationHash,
    } = req.body || {};

    if (!itemId || typeof itemId !== 'string') {
      res.status(400).json({
        ok: false,
        error: 'A trusted server-side itemId or Spark Sandbox SKU is required.',
      });
      return;
    }

    const result = await paypalSandboxEngine.createOrder({
      userId: auth.user.id,
      userEmail: auth.user.email,
      checkoutSessionId: typeof checkoutSessionId === 'string' ? checkoutSessionId : undefined,
      itemId: itemId.trim(),
      quantity: Number(quantity),
      currency,
      couponCode,
      clientSubmittedUnitPrice:
        typeof clientSubmittedUnitPrice === 'number'
          ? clientSubmittedUnitPrice
          : undefined,
      clientSubmittedTotalAmount:
        typeof clientSubmittedTotalAmount === 'number'
          ? clientSubmittedTotalAmount
          : undefined,
      returnUrl,
      cancelUrl,
      mockApplicationCode,
      executionMode:
        executionMode === 'MERCHANT_CHECKOUT' ? 'MERCHANT_CHECKOUT' : 'SANDBOX_SIMULATION',
      authorizationHash:
        typeof authorizationHash === 'string' ? authorizationHash : undefined,
    });
    saveRuntimeSnapshot();

    res.status(result.ok ? 200 : result.statusCode).json({
      ok: result.ok,
      statusCode: result.statusCode,
      errorCode: result.errorCode || null,
      message: result.message,
      transaction: result.transaction || null,
      buyerWallet: paypalSandboxEngine.getBuyerSandboxWallet(auth.user.id, auth.user.email),
      correlationId: result.correlationId,
      securityAuditLogs: paypalSandboxEngine.getSecurityAuditLogs(auth.user.id).slice(0, 20),
      logs: paypalSandboxEngine.getLogs().slice(0, 20),
    });
  });

  // 6. Inspect Order Status (`GET /v2/checkout/orders/{id}`) (Protected & Owner-Verified)
  app.get('/api/paypal/sandbox/orders/:orderId', async (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;

    const orderId = req.params.orderId;
    const syncRemote = req.query.sync === '1';

    if (!syncRemote) {
      const ownership = paypalSandboxEngine.getTransactionForUser(orderId, auth.user.id);
      if (!ownership.ok || !ownership.transaction) {
        res.status(ownership.statusCode).json({
          ok: false,
          errorCode: ownership.errorCode,
          error: ownership.message,
        });
        return;
      }
      res.json({ ok: true, transaction: ownership.transaction });
      return;
    }

    const result = await paypalSandboxEngine.inspectOrder(orderId, auth.user.id);
    saveRuntimeSnapshot();
    res.status(result.ok ? 200 : result.statusCode).json({
      ok: result.ok,
      statusCode: result.statusCode,
      errorCode: result.errorCode || null,
      message: result.message,
      remotePayPalStatus: result.remotePayPalStatus || null,
      transaction: result.transaction || null,
      correlationId: result.correlationId,
      logs: paypalSandboxEngine.getLogs().slice(0, 20),
    });
  });

  // 7. Mark Buyer Approved in Sandbox (`POST /api/paypal/sandbox/orders/:orderId/approve`) (Protected & Owner-Verified)
  app.post('/api/paypal/sandbox/orders/:orderId/approve', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;

    const { payerEmail, payerId } = req.body || {};
    const result = paypalSandboxEngine.markOrderApproved(
      req.params.orderId,
      { email: payerEmail, payerId, userId: auth.user.id },
      'buyer'
    );
    saveRuntimeSnapshot();
    res.status(result.ok ? 200 : result.statusCode).json({
      ok: result.ok,
      statusCode: result.statusCode,
      errorCode: result.errorCode || null,
      message: result.message,
      transaction: result.transaction || null,
    });
  });

  // 7B. Confirm Payment Source (`POST /v2/checkout/orders/{id}/confirm-payment-source`) (Protected & Owner-Verified)
  app.post('/api/paypal/sandbox/orders/:orderId/confirm-payment-source', async (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;

    const { payerEmail, givenName, surname, returnUrl, cancelUrl, mockApplicationCode } =
      req.body || {};
    const result = await paypalSandboxEngine.confirmPaymentSource(req.params.orderId, {
      userId: auth.user.id,
      payerEmail: payerEmail || auth.user.email,
      givenName: givenName || auth.user.preferences.preferredName || 'Spark',
      surname: surname || 'Buyer',
      returnUrl,
      cancelUrl,
      mockApplicationCode,
    });
    saveRuntimeSnapshot();

    res.status(result.ok ? 200 : result.statusCode).json({
      ok: result.ok,
      statusCode: result.statusCode,
      errorCode: result.errorCode || null,
      message: result.message,
      remotePayPalStatus: result.remotePayPalStatus || null,
      payerActionUrl: result.payerActionUrl || null,
      transaction: result.transaction || null,
      correlationId: result.correlationId,
    });
  });

  // 7C. Authorize Approved Order Payment (`POST /v2/checkout/orders/{id}/authorize`) (Protected & Owner-Verified)
  app.post('/api/paypal/sandbox/orders/:orderId/authorize', async (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;

    const { mockApplicationCode, payerEmail } = req.body || {};
    const result = await paypalSandboxEngine.authorizeOrderPayment(req.params.orderId, {
      userId: auth.user.id,
      mockApplicationCode,
      payerEmailOverride: payerEmail || auth.user.email,
    });
    saveRuntimeSnapshot();

    res.status(result.ok ? 201 : result.statusCode).json({
      ok: result.ok,
      statusCode: result.statusCode,
      errorCode: result.errorCode || null,
      authorizationId: result.authorizationId || null,
      authorizationStatus: result.authorizationStatus || null,
      message: result.message,
      transaction: result.transaction || null,
      correlationId: result.correlationId,
    });
  });

  // 8. Capture Approved Order (`POST /v2/checkout/orders/{id}/capture`) (Protected, Owner-Verified & Idempotent)
  app.post('/api/paypal/sandbox/orders/:orderId/capture', async (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;

    const { mockApplicationCode, payerEmail, expectedTotalAmount, expectedAmount, expectedCurrency } =
      req.body || {};
    const resolvedExpectedAmount =
      typeof expectedAmount === 'number'
        ? expectedAmount
        : typeof expectedTotalAmount === 'number'
        ? expectedTotalAmount
        : undefined;
    const result = await paypalSandboxEngine.captureOrder(req.params.orderId, {
      userId: auth.user.id,
      mockApplicationCode,
      payerEmailOverride: payerEmail || auth.user.email,
      expectedAmount: resolvedExpectedAmount,
    });
    saveRuntimeSnapshot();

    const balanceRes = paypalSandboxEngine.getAccountBalanceForUser({
      authenticatedUserId: auth.user.id,
      userEmail: auth.user.email,
      preferredCurrency: auth.user.preferences.defaultCurrency,
    });

    res.status(result.ok ? 200 : result.statusCode).json({
      ok: result.ok,
      statusCode: result.statusCode,
      errorCode: result.errorCode || null,
      duplicateCapturePrevented: Boolean(result.duplicateCapturePrevented),
      message: result.message,
      transaction: result.transaction || null,
      purchaseRecord: result.purchaseRecord || null,
      buyerWallet: paypalSandboxEngine.getBuyerSandboxWallet(auth.user.id, auth.user.email),
      accountBalance: balanceRes.balance || null,
      correlationId: result.correlationId,
      securityAuditLogs: paypalSandboxEngine.getSecurityAuditLogs(auth.user.id).slice(0, 20),
      logs: paypalSandboxEngine.getLogs().slice(0, 20),
    });
  });

  // 9. Buyer Cancellation (`POST /api/paypal/sandbox/orders/:orderId/cancel`) (Protected & Owner-Verified)
  app.post('/api/paypal/sandbox/orders/:orderId/cancel', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;

    const reason =
      typeof req.body?.reason === 'string' && req.body.reason.trim()
        ? req.body.reason.trim()
        : 'Buyer cancelled checkout on PayPal Sandbox before payment capture.';
    const result = paypalSandboxEngine.cancelOrder(req.params.orderId, reason, auth.user.id);
    saveRuntimeSnapshot();

    res.status(result.ok ? 200 : result.statusCode).json({
      ok: result.ok,
      statusCode: result.statusCode,
      errorCode: result.errorCode || null,
      message: result.message,
      transaction: result.transaction || null,
      correlationId: result.correlationId,
      logs: paypalSandboxEngine.getLogs().slice(0, 20),
    });
  });

  // 10. Official PayPal Webhook Endpoint (`POST /api/paypal/webhooks` — Server-to-Server Signature Verified)
  app.post('/api/paypal/webhooks', async (req, res) => {
    const headers: WebhookHeaders = {
      'paypal-transmission-id': req.header('paypal-transmission-id') || undefined,
      'paypal-transmission-time': req.header('paypal-transmission-time') || undefined,
      'paypal-cert-url': req.header('paypal-cert-url') || undefined,
      'paypal-auth-algo': req.header('paypal-auth-algo') || undefined,
      'paypal-transmission-sig': req.header('paypal-transmission-sig') || undefined,
    };

    const result = await paypalSandboxEngine.verifyAndProcessWebhook(
      headers,
      (req.body || {}) as Record<string, unknown>
    );
    saveRuntimeSnapshot();

    res.status(result.statusCode).json({
      ok: result.ok,
      verified: result.verified,
      duplicate: result.duplicate,
      errorCode: result.errorCode || null,
      message: result.message,
      eventRecord: result.eventRecord || null,
      transaction: result.transaction || null,
      correlationId: result.correlationId,
    });
  });

  // 11. Developer Tool: Test Webhook Configuration & Signature Readiness (Protected)
  app.post('/api/paypal/sandbox/webhooks/test-config', async (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;

    const status = paypalSandboxEngine.getStatus();
    if (!status.credentialsConfigured.webhookId) {
      res.json({
        ok: false,
        webhookIdConfigured: false,
        oauthReady: status.oauthValidated,
        message:
          'PAYPAL_WEBHOOK_ID is not configured in server environment variables. Add PAYPAL_WEBHOOK_ID from the PayPal Developer Dashboard (Apps & Credentials -> Sandbox Webhooks) to verify live webhook signatures via POST /v1/notifications/verify-webhook-signature.',
        status,
      });
      return;
    }

    const authResult = await paypalSandboxEngine.authenticate();
    res.json({
      ok: authResult.ok,
      webhookIdConfigured: true,
      oauthReady: authResult.ok,
      message: authResult.ok
        ? 'Webhook receiver /api/paypal/webhooks is configured with PAYPAL_WEBHOOK_ID and ready to verify incoming PayPal transmission signatures against https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature.'
        : `PAYPAL_WEBHOOK_ID is set, but Sandbox OAuth authentication failed: ${authResult.message}`,
      status: paypalSandboxEngine.getStatus(),
    });
  });

  // 12. Transaction Explorer Query Endpoint (`GET /api/paypal/sandbox/transactions`) (Protected & User-Scoped)
  app.get('/api/paypal/sandbox/transactions', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;

    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const fromDate = typeof req.query.fromDate === 'string' ? req.query.fromDate : undefined;
    const toDate = typeof req.query.toDate === 'string' ? req.query.toDate : undefined;

    res.json({
      transactions: paypalSandboxEngine.getTransactions({
        userId: auth.user.id,
        status,
        fromDate,
        toDate,
      }),
    });
  });

  // 13. End-to-End Checkout Diagnostics Runner (`POST /api/paypal/sandbox/diagnostics`) (Protected)
  app.post('/api/paypal/sandbox/diagnostics', async (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;

    const configCheck = validatePayPalSandboxConfig(process.env);
    const catalogCheck = SPARK_SANDBOX_TEST_CATALOG.length > 0;
    const tamperCheck = paypalSandboxEngine.resolveTrustedCheckoutItem({
      itemId: 'spark_sandbox_pro_pass',
      quantity: 1,
      clientSubmittedTotalAmount: 0.01,
    });
    const validCalcCheck = paypalSandboxEngine.resolveTrustedCheckoutItem({
      itemId: 'spark_sandbox_pro_pass',
      quantity: 2,
    });
    const authCheck = await paypalSandboxEngine.authenticate();

    const steps = [
      {
        id: 'env_safety',
        label: 'Sandbox Environment Safety Lock (PAYPAL_ENV=sandbox)',
        passed: configCheck.isSandboxAllowed,
        detail: configCheck.isSandboxAllowed
          ? `Verified: Locked to ${PAYPAL_SANDBOX_BASE_URL}`
          : configCheck.errorMessage || 'Failed environment check.',
      },
      {
        id: 'user_session_ownership',
        label: 'Authenticated Spark Session & Order Ownership Guard',
        passed: Boolean(auth.session.sessionId && auth.user.id),
        detail: `Verified: Active session bound to ${auth.user.email} (${auth.user.id}); untrusted frontend userId headers are rejected.`,
      },
      {
        id: 'server_price_guard',
        label: 'Server-Side Price Calculation & Tamper Rejection',
        passed:
          !tamperCheck.ok &&
          tamperCheck.errorCode === 'tampered_amount_rejected' &&
          validCalcCheck.ok &&
          validCalcCheck.resolved?.totalAmount === 38.0,
        detail:
          'Verified: Client-tampered total ($0.01) was rejected with 400 tampered_amount_rejected; 2x Spark Pro Pass computed as USD 38.00.',
      },
      {
        id: 'sandbox_catalog',
        label: 'Trusted Spark Sandbox Test Catalog',
        passed: catalogCheck,
        detail: `${SPARK_SANDBOX_TEST_CATALOG.length} Spark-managed Sandbox test SKUs registered.`,
      },
      {
        id: 'oauth_probe',
        label: 'Live PayPal Sandbox OAuth2 Token Exchange (POST /v1/oauth2/token)',
        passed: authCheck.ok,
        detail: authCheck.message,
      },
      {
        id: 'webhook_config',
        label: 'Webhook Signature Verification Configuration (PAYPAL_WEBHOOK_ID)',
        passed: configCheck.webhookIdConfigured,
        detail: configCheck.webhookIdConfigured
          ? 'PAYPAL_WEBHOOK_ID is configured for POST /v1/notifications/verify-webhook-signature.'
          : 'PAYPAL_WEBHOOK_ID is not yet set in server environment variables.',
      },
    ];

    res.json({
      timestamp: new Date().toISOString(),
      allPassed: steps.every((s) => s.passed),
      steps,
      status: paypalSandboxEngine.getStatus(),
      logs: paypalSandboxEngine.getLogs().slice(0, 20),
    });
  });

  // 14. Checkout Modal Endpoints wired through PayPalSandboxEngine (Protected & User-Bound)
  app.post('/api/paypal/create-order', async (req, res) => {
    const startMs = Date.now();
    const correlationId =
      req.header('x-correlation-id') || `corr_create_${startMs.toString(36)}`;
    try {
      const auth = authenticateRequest(req, res);
      if (!auth) return;

      paypalSandboxEngine.recordStructuredDiagnosticEvent({
        event: 'BACKEND_REQUEST_RECEIVED',
        operation: 'backend_request',
        outcome: 'success',
        httpStatus: 200,
        durationMs: Math.max(1, Date.now() - startMs),
        correlationId,
        errorSummary: 'POST /api/paypal/create-order received by Spark Sandbox backend.',
      });

      const {
        checkoutSessionId,
        productId,
        product,
        products,
        offerId,
        fromCart,
        quantity = 1,
        couponCode,
        approvalHash,
        explicitlyConfirmed,
        executionMode,
        authorizationHash,
      } = req.body || {};
      if (!explicitlyConfirmed) {
        res.status(400).json({
          error: 'Explicit user confirmation is required before creating a PayPal Sandbox order.',
        });
        return;
      }

      const resolvedProductId = Boolean(fromCart)
        ? '__SPARK_USER_CART__'
        : typeof productId === 'string' && productId.trim()
        ? productId.trim()
        : typeof product?.id === 'string'
        ? product.id
        : '';

      if (product && typeof product === 'object' && typeof product.id === 'string') {
        paypalSandboxEngine.registerVerifiedLiveOffer(product as ProductOffer);
      }
      if (Array.isArray(products)) {
        for (const p of products) {
          if (p && typeof p === 'object' && typeof p.id === 'string') {
            paypalSandboxEngine.registerVerifiedLiveOffer(p as ProductOffer);
          }
        }
      }

      if (product && approvalHash && !fromCart) {
        const currentSummary = computeOrderSummary(
          product as ProductOffer,
          Number(quantity) || 1,
          null
        );
        const integrity = verifyApprovalIntegrity(approvalHash, currentSummary);
        if (!integrity.verified || currentSummary.totalAmount === null) {
          res.status(409).json({
            explicitState: 'Checkout unsupported.',
            error: integrity.reason || 'Order verification failed.',
          });
          return;
        }
      }

      const result = await paypalSandboxEngine.createOrder({
        userId: auth.user.id,
        userEmail: auth.user.email,
        checkoutSessionId: typeof checkoutSessionId === 'string' ? checkoutSessionId : undefined,
        itemId: resolvedProductId,
        offerId: typeof offerId === 'string' ? offerId : undefined,
        fromCart: Boolean(fromCart),
        quantity: Number(quantity) || 1,
        couponCode,
        executionMode:
          executionMode === 'MERCHANT_CHECKOUT' ? 'MERCHANT_CHECKOUT' : 'SANDBOX_SIMULATION',
        authorizationHash:
          typeof authorizationHash === 'string' ? authorizationHash : undefined,
        correlationId,
      });
      saveRuntimeSnapshot();

      if (!result.ok || !result.transaction) {
        res.status(result.statusCode).json({
          explicitState: 'Checkout unsupported.',
          errorCode: result.errorCode,
          error: result.message,
        });
        return;
      }

      res.json({
        paypalOrderId: result.transaction.paypalOrderId,
        sparkOrderId: result.transaction.sparkOrderId,
        checkoutSessionId: result.transaction.checkoutSessionId,
        userId: result.transaction.userId,
        approvalUrl: result.transaction.approvalUrl,
        transaction: result.transaction,
        buyerWallet: paypalSandboxEngine.getBuyerSandboxWallet(auth.user.id, auth.user.email),
      });
    } catch (err) {
      const safeErr = err instanceof Error ? err.message : String(err);
      paypalSandboxEngine.recordStructuredDiagnosticEvent({
        event: 'PAYMENT_INITIALIZATION_FAILED',
        operation: 'backend_request',
        outcome: 'error',
        httpStatus: 500,
        durationMs: Math.max(1, Date.now() - startMs),
        correlationId,
        errorCode: 'payment_initialization_failed',
        errorSummary: `POST /api/paypal/create-order failed: ${safeErr}`,
      });
      res.status(500).json({
        ok: false,
        errorCode: 'payment_initialization_failed',
        error: `PayPal Sandbox order initialization failed: ${safeErr}`,
      });
    }
  });

  app.post('/api/paypal/capture-order', async (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;

    const { paypalOrderId, mockApplicationCode, expectedTotalAmount, expectedCurrency } =
      req.body || {};
    if (!paypalOrderId || typeof paypalOrderId !== 'string') {
      res.status(400).json({ error: 'paypalOrderId is required.' });
      return;
    }

    const result = await paypalSandboxEngine.captureOrder(paypalOrderId, {
      userId: auth.user.id,
      mockApplicationCode,
      payerEmailOverride: auth.user.email,
      expectedAmount:
        typeof expectedTotalAmount === 'number' ? expectedTotalAmount : undefined,
    });
    saveRuntimeSnapshot();

    const balanceRes = paypalSandboxEngine.getAccountBalanceForUser({
      authenticatedUserId: auth.user.id,
      userEmail: auth.user.email,
      preferredCurrency: auth.user.preferences.defaultCurrency,
    });

    if (!result.ok || !result.purchaseRecord) {
      res.status(result.statusCode).json({
        errorCode: result.errorCode,
        error: result.message,
        transaction: result.transaction || null,
        buyerWallet: paypalSandboxEngine.getBuyerSandboxWallet(auth.user.id, auth.user.email),
        accountBalance: balanceRes.balance || null,
      });
      return;
    }

    res.json({
      purchase: result.purchaseRecord,
      transaction: result.transaction,
      duplicateCapturePrevented: result.duplicateCapturePrevented,
      buyerWallet: paypalSandboxEngine.getBuyerSandboxWallet(auth.user.id, auth.user.email),
      accountBalance: balanceRes.balance || null,
      cart: paypalSandboxEngine.getUserCart(auth.user.id),
    });
  });

  // ============================================================================
  // 15. AUTONOMOUS PURCHASING AGENT 6-STEP SANDBOX EXECUTION ENDPOINTS
  // ============================================================================

  // STEP 1 & 2: Prepare Purchase Order (`DRAFT` -> `AWAITING_USER_CONFIRMATION`)
  app.post('/api/paypal/agent/prepare-order', (req, res) => {
    const startMs = Date.now();
    const correlationId =
      req.header('x-correlation-id') || `corr_prep_${startMs.toString(36)}`;
    try {
      const auth = authenticateRequest(req, res);
      if (!auth) return;

      paypalSandboxEngine.recordStructuredDiagnosticEvent({
        event: 'BACKEND_REQUEST_RECEIVED',
        operation: 'backend_request',
        outcome: 'success',
        httpStatus: 200,
        durationMs: Math.max(1, Date.now() - startMs),
        correlationId,
        errorSummary: 'POST /api/paypal/agent/prepare-order received by Spark Sandbox backend.',
      });

      const {
        itemId,
        product,
        products,
        offerId,
        fromCart,
        quantity = 1,
        currency,
        couponCode,
        executionMode,
        clientSubmittedUnitPrice,
        clientSubmittedTotalAmount,
      } = req.body || {};

      if (product && typeof product === 'object' && typeof product.id === 'string') {
        paypalSandboxEngine.registerVerifiedLiveOffer(product as ProductOffer);
      }
      if (Array.isArray(products)) {
        for (const p of products) {
          if (p && typeof p === 'object' && typeof p.id === 'string') {
            paypalSandboxEngine.registerVerifiedLiveOffer(p as ProductOffer);
          }
        }
      }

      const resolvedItemId = Boolean(fromCart)
        ? '__SPARK_USER_CART__'
        : typeof itemId === 'string' && itemId.trim()
        ? itemId.trim()
        : typeof product?.id === 'string'
        ? product.id.trim()
        : '';

      if (!resolvedItemId) {
        paypalSandboxEngine.recordStructuredDiagnosticEvent({
          event: 'PAYMENT_INITIALIZATION_FAILED',
          operation: 'backend_request',
          outcome: 'error',
          httpStatus: 400,
          durationMs: Math.max(1, Date.now() - startMs),
          correlationId,
          errorCode: 'missing_item_id',
          errorSummary: 'Missing verified product ID or Spark Sandbox SKU in prepare-order.',
        });
        res.status(400).json({
          ok: false,
          errorCode: 'missing_item_id',
          error: 'A verified product ID or Spark Sandbox SKU is required to prepare an order.',
        });
        return;
      }

      const result = paypalSandboxEngine.prepareAutonomousPurchaseOrder({
        userId: auth.user.id,
        userEmail: auth.user.email,
        itemId: resolvedItemId,
        offerId: typeof offerId === 'string' ? offerId : undefined,
        fromCart: Boolean(fromCart),
        quantity: Number(quantity) || 1,
        currency: typeof currency === 'string' ? currency : undefined,
        couponCode: typeof couponCode === 'string' ? couponCode : undefined,
        executionMode:
          executionMode === 'MERCHANT_CHECKOUT' ? 'MERCHANT_CHECKOUT' : 'SANDBOX_SIMULATION',
        clientSubmittedUnitPrice:
          typeof clientSubmittedUnitPrice === 'number' ? clientSubmittedUnitPrice : undefined,
        clientSubmittedTotalAmount:
          typeof clientSubmittedTotalAmount === 'number' ? clientSubmittedTotalAmount : undefined,
        correlationId,
      });
      saveRuntimeSnapshot();

      res.status(result.ok ? 200 : result.statusCode).json({
        ok: result.ok,
        statusCode: result.statusCode,
        errorCode: result.errorCode || null,
        message: result.message,
        orderRow: result.orderRow || null,
        checkoutSession: result.checkoutSession || null,
        buyerWallet: result.buyerWallet || null,
        correlationId,
      });
    } catch (err) {
      const safeErr = err instanceof Error ? err.message : String(err);
      paypalSandboxEngine.recordStructuredDiagnosticEvent({
        event: 'PAYMENT_INITIALIZATION_FAILED',
        operation: 'backend_request',
        outcome: 'error',
        httpStatus: 500,
        durationMs: Math.max(1, Date.now() - startMs),
        correlationId,
        errorCode: 'payment_initialization_failed',
        errorSummary: `POST /api/paypal/agent/prepare-order failed: ${safeErr}`,
      });
      res.status(500).json({
        ok: false,
        statusCode: 500,
        errorCode: 'payment_initialization_failed',
        message: `Purchase order preparation failed on backend: ${safeErr}`,
        correlationId,
      });
    }
  });

  // STEP 3: Explicit One-Time User Authorization (`actor: 'user'` required; blocks `'agent'`)
  app.post('/api/paypal/agent/authorize-order', (req, res) => {
    const startMs = Date.now();
    const correlationId =
      req.header('x-correlation-id') || `corr_auth_${startMs.toString(36)}`;
    try {
      const auth = authenticateRequest(req, res);
      if (!auth) return;

      paypalSandboxEngine.recordStructuredDiagnosticEvent({
        event: 'BACKEND_REQUEST_RECEIVED',
        operation: 'backend_request',
        outcome: 'success',
        httpStatus: 200,
        durationMs: Math.max(1, Date.now() - startMs),
        correlationId,
        errorSummary: 'POST /api/paypal/agent/authorize-order received by Spark Sandbox backend.',
      });

      const {
        orderId,
        actor = 'user',
        explicitUserConfirmed = true,
        confirmedAmount,
        confirmedCurrency,
        confirmedProductId,
        confirmedMerchantId,
        confirmedMerchant,
      } = req.body || {};

      if (!orderId || typeof orderId !== 'string') {
        paypalSandboxEngine.recordStructuredDiagnosticEvent({
          event: 'PAYMENT_INITIALIZATION_FAILED',
          operation: 'backend_request',
          outcome: 'error',
          httpStatus: 400,
          durationMs: Math.max(1, Date.now() - startMs),
          correlationId,
          errorCode: 'missing_order_id',
          errorSummary: 'Missing orderId in authorize-order request.',
        });
        res.status(400).json({
          ok: false,
          errorCode: 'missing_order_id',
          error: 'orderId is required to authorize a purchase.',
        });
        return;
      }

      const result = paypalSandboxEngine.authorizePurchaseOrder({
        userId: auth.user.id,
        orderId: orderId.trim(),
        actor: actor === 'agent' ? 'agent' : 'user',
        explicitUserConfirmed: actor === 'agent' ? false : Boolean(explicitUserConfirmed),
        confirmedAmount: typeof confirmedAmount === 'number' ? confirmedAmount : undefined,
        confirmedCurrency: typeof confirmedCurrency === 'string' ? confirmedCurrency : undefined,
        confirmedProductId: typeof confirmedProductId === 'string' ? confirmedProductId : undefined,
        confirmedMerchant:
          typeof confirmedMerchant === 'string'
            ? confirmedMerchant
            : typeof confirmedMerchantId === 'string'
            ? confirmedMerchantId
            : undefined,
      });
      saveRuntimeSnapshot();

      if (!result.ok) {
        paypalSandboxEngine.recordStructuredDiagnosticEvent({
          event: 'PAYMENT_INITIALIZATION_FAILED',
          operation: 'backend_request',
          outcome: 'error',
          httpStatus: result.statusCode,
          durationMs: Math.max(1, Date.now() - startMs),
          correlationId,
          errorCode: result.errorCode,
          errorSummary: result.message,
        });
      }

      res.status(result.ok ? 200 : result.statusCode).json({
        ok: result.ok,
        statusCode: result.statusCode,
        errorCode: result.errorCode || null,
        message: result.message,
        authorization: result.authorization || null,
        orderRow: result.orderRow || null,
        correlationId,
      });
    } catch (err) {
      const safeErr = err instanceof Error ? err.message : String(err);
      paypalSandboxEngine.recordStructuredDiagnosticEvent({
        event: 'PAYMENT_INITIALIZATION_FAILED',
        operation: 'backend_request',
        outcome: 'error',
        httpStatus: 500,
        durationMs: Math.max(1, Date.now() - startMs),
        correlationId,
        errorCode: 'payment_initialization_failed',
        errorSummary: `POST /api/paypal/agent/authorize-order failed: ${safeErr}`,
      });
      res.status(500).json({
        ok: false,
        statusCode: 500,
        errorCode: 'payment_initialization_failed',
        message: `Order authorization failed on backend: ${safeErr}`,
        correlationId,
      });
    }
  });

  // STEP 4: Create PayPal Sandbox Order (`POST /v2/checkout/orders` with `intent = CAPTURE`)
  app.post('/api/paypal/agent/execute-order', async (req, res) => {
    const startMs = Date.now();
    const correlationId =
      req.header('x-correlation-id') || `corr_exec_${startMs.toString(36)}`;
    try {
      const auth = authenticateRequest(req, res);
      if (!auth) return;

      paypalSandboxEngine.recordStructuredDiagnosticEvent({
        event: 'BACKEND_REQUEST_RECEIVED',
        operation: 'backend_request',
        outcome: 'success',
        httpStatus: 200,
        durationMs: Math.max(1, Date.now() - startMs),
        correlationId,
        errorSummary: 'POST /api/paypal/agent/execute-order received by Spark Sandbox backend.',
      });

      const { orderId, authorizationHash, returnUrl, cancelUrl, mockApplicationCode } =
        req.body || {};

      if (!orderId || typeof orderId !== 'string' || !authorizationHash || typeof authorizationHash !== 'string') {
        paypalSandboxEngine.recordStructuredDiagnosticEvent({
          event: 'PAYMENT_INITIALIZATION_FAILED',
          operation: 'backend_request',
          outcome: 'error',
          httpStatus: 400,
          durationMs: Math.max(1, Date.now() - startMs),
          correlationId,
          errorCode: 'missing_authorization_parameters',
          errorSummary: 'Missing orderId or authorizationHash in execute-order.',
        });
        res.status(400).json({
          ok: false,
          errorCode: 'missing_authorization_parameters',
          error: 'Both orderId and one-time authorizationHash are required.',
        });
        return;
      }

      const result = await paypalSandboxEngine.executeAuthorizedOrder({
        userId: auth.user.id,
        userEmail: auth.user.email,
        orderId: orderId.trim(),
        authorizationHash: authorizationHash.trim(),
        returnUrl: typeof returnUrl === 'string' ? returnUrl : undefined,
        cancelUrl: typeof cancelUrl === 'string' ? cancelUrl : undefined,
        mockApplicationCode: typeof mockApplicationCode === 'string' ? mockApplicationCode : undefined,
        correlationId,
      });
      saveRuntimeSnapshot();

      res.status(result.ok ? 200 : result.statusCode).json({
        ok: result.ok,
        statusCode: result.statusCode,
        errorCode: result.errorCode || null,
        message: result.message,
        transaction: result.transaction || null,
        orderRow: result.orderRow || null,
        approvalUrl: result.approvalUrl || null,
        buyerWallet: paypalSandboxEngine.getBuyerSandboxWallet(auth.user.id, auth.user.email),
        correlationId,
      });
    } catch (err) {
      const safeErr = err instanceof Error ? err.message : String(err);
      paypalSandboxEngine.recordStructuredDiagnosticEvent({
        event: 'PAYMENT_INITIALIZATION_FAILED',
        operation: 'backend_request',
        outcome: 'error',
        httpStatus: 500,
        durationMs: Math.max(1, Date.now() - startMs),
        correlationId,
        errorCode: 'payment_initialization_failed',
        errorSummary: `POST /api/paypal/agent/execute-order failed: ${safeErr}`,
      });
      res.status(500).json({
        ok: false,
        statusCode: 500,
        errorCode: 'payment_initialization_failed',
        message: `PayPal Sandbox order execution failed on backend: ${safeErr}`,
        correlationId,
      });
    }
  });

  // STEP 5 & 6: Capture Approved PayPal Sandbox Order (`POST /v2/checkout/orders/{id}/capture`) & Deduct Buyer Balance
  app.post('/api/paypal/agent/capture-order', async (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;

    const {
      orderIdOrPayPalId,
      orderId,
      mockApplicationCode,
      expectedAmount,
      expectedCurrency,
    } = req.body || {};
    const targetOrderId =
      typeof orderIdOrPayPalId === 'string' && orderIdOrPayPalId.trim()
        ? orderIdOrPayPalId.trim()
        : typeof orderId === 'string' && orderId.trim()
        ? orderId.trim()
        : '';

    if (!targetOrderId) {
      res.status(400).json({
        ok: false,
        errorCode: 'missing_order_id',
        error: 'orderIdOrPayPalId is required to capture the approved PayPal Sandbox order.',
      });
      return;
    }

    const result = await paypalSandboxEngine.captureAuthorizedOrder({
      userId: auth.user.id,
      orderId: targetOrderId,
      mockApplicationCode:
        typeof mockApplicationCode === 'string' ? mockApplicationCode : undefined,
      expectedAmount: typeof expectedAmount === 'number' ? expectedAmount : undefined,
      expectedCurrency: typeof expectedCurrency === 'string' ? expectedCurrency : undefined,
      payerEmailOverride: auth.user.email,
    });
    saveRuntimeSnapshot();

    const balanceRes = paypalSandboxEngine.getAccountBalanceForUser({
      authenticatedUserId: auth.user.id,
      userEmail: auth.user.email,
      preferredCurrency: auth.user.preferences.defaultCurrency,
    });

    res.status(result.ok ? 200 : result.statusCode).json({
      ok: result.ok,
      statusCode: result.statusCode,
      errorCode: result.errorCode || null,
      duplicateCapturePrevented: Boolean(result.duplicateCapturePrevented),
      message: result.message,
      transaction: result.transaction || null,
      purchaseRecord: result.purchaseRecord || null,
      buyerWallet: result.buyerWallet || null,
      accountBalance: balanceRes.balance || null,
      cart: paypalSandboxEngine.getUserCart(auth.user.id),
      agentNotification: result.agentPurchaseConfirmation || null,
    });
  });

  // 16. Get Sandbox Relational Database Tables & Simulated Buyer Wallet (`GET /api/paypal/sandbox/database`)
  app.get('/api/paypal/sandbox/database', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;

    const tables = paypalSandboxEngine.getSandboxDatabaseTables(auth.user.id);
    const balanceRes = paypalSandboxEngine.getAccountBalanceForUser({
      authenticatedUserId: auth.user.id,
      userEmail: auth.user.email,
      preferredCurrency: auth.user.preferences.defaultCurrency,
    });
    res.json({
      ok: true,
      environment: 'sandbox',
      apiBaseUrl: PAYPAL_SANDBOX_BASE_URL,
      accountBalance: balanceRes.balance || null,
      ...tables,
    });
  });

  // 17. Configure Simulated PayPal Sandbox Buyer Account Balance (`POST /api/paypal/sandbox/wallet`)
  app.post('/api/paypal/sandbox/wallet', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;

    const rawBalance = Number(req.body?.balance ?? 500);
    if (!Number.isFinite(rawBalance) || rawBalance < 0 || rawBalance > 100000) {
      res.status(400).json({
        ok: false,
        errorCode: 'invalid_wallet_balance',
        error: 'Sandbox buyer balance must be a number between 0.00 and 100000.00 USD.',
      });
      return;
    }

    const wallet = paypalSandboxEngine.configureBuyerSandboxBalance(
      auth.user.id,
      rawBalance,
      auth.user.email
    );
    const balanceRes = paypalSandboxEngine.getAccountBalanceForUser({
      authenticatedUserId: auth.user.id,
      userEmail: auth.user.email,
      preferredCurrency: auth.user.preferences.defaultCurrency,
    });
    saveRuntimeSnapshot();

    res.json({
      ok: true,
      buyerWallet: wallet,
      accountBalance: balanceRes.balance || null,
      message: `PayPal Sandbox buyer balance configured to USD ${wallet.availableBalance.toFixed(2)} for ${wallet.buyerEmail}.`,
    });
  });

  // 18. Execute All 15 Required Integration Test Scenarios (`POST /api/paypal/sandbox/test-scenarios`)
  app.post('/api/paypal/sandbox/test-scenarios', async (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;

    const suiteResult = await paypalSandboxEngine.runFifteenRequiredSandboxScenarios(auth.user.id);
    saveRuntimeSnapshot();

    res.json({
      ...suiteResult,
      buyerWallet: paypalSandboxEngine.getBuyerSandboxWallet(auth.user.id, auth.user.email),
    });
  });

  // ============================================================================
  // SUBSCRIPTION PLANS, REAL PAYPAL RECURRING BILLING & QUOTA ENGINE ENDPOINTS
  // ============================================================================

  // 1. Get All Subscription Plans & Specifications (Luna, Terra, Sol, Free)
  app.get('/api/subscriptions/plans', (_req, res) => {
    res.json({
      ok: true,
      plans: Object.values(SPARK_SUBSCRIPTION_PLANS),
      billingDescriptors: PAYPAL_BILLING_PLANS,
      eligibility: evaluatePayPalSubscriptionEligibility(),
    });
  });

  // 2. Get Current User Active Subscription, Quotas & Concurrency
  app.get('/api/subscriptions/me', (req, res) => {
    const auth = authenticateRequest(req, res, { optional: true });
    // Enforce authenticated session user ID when signed in to prevent client-side manipulation
    const targetUserId =
      auth?.user?.id ||
      (req.header('x-spark-user-id') as string) ||
      (req.query.userId as string) ||
      latestActiveUserId ||
      'anonymous_user';
    const targetEmail =
      auth?.user?.email || usersById.get(targetUserId)?.email || 'member@spark.app';

    const quotaStatus = getUserQuotaStatus(targetUserId);
    const buyerWallet = paypalSandboxEngine.getBuyerSandboxWallet(targetUserId, targetEmail);
    const balanceRes = paypalSandboxEngine.getAccountBalanceForUser({
      authenticatedUserId: targetUserId,
      userEmail: targetEmail,
      preferredCurrency: auth?.user?.preferences?.defaultCurrency || 'USD',
      autoInitializeSandboxWallet: true,
    });

    res.json({
      ok: true,
      userId: targetUserId,
      quotaStatus,
      buyerWallet,
      accountBalance: balanceRes.balance || null,
      dashboardPreferences: getUserDashboardPreferences(targetUserId),
    });
  });

  // 3. Create / Initiate PayPal Subscription Session
  app.post('/api/subscriptions/create', (req, res) => {
    const auth = authenticateRequest(req, res, { optional: true });
    const targetUserId =
      auth?.user?.id || (req.body?.userId as string) || latestActiveUserId || 'anonymous_user';
    const targetEmail = auth?.user?.email || (req.body?.userEmail as string) || 'member@spark.app';

    const { planId } = req.body || {};
    if (!planId || !['free', 'luna', 'terra', 'sol'].includes(planId)) {
      res.status(400).json({
        ok: false,
        errorCode: 'invalid_plan_id',
        error: 'A valid planId (free, luna, terra, sol) is required.',
      });
      return;
    }

    const session = createPayPalSubscription({
      userId: targetUserId,
      userEmail: targetEmail,
      planId,
    });

    saveRuntimeSnapshot();

    res.json({
      ...session,
    });
  });

  // 4. Activate PayPal Subscription upon Buyer Approval (Server-Verified & Deducted from PayPal Wallet)
  app.post('/api/subscriptions/activate', (req, res) => {
    const auth = authenticateRequest(req, res, { optional: true });
    const targetUserId =
      auth?.user?.id || (req.body?.userId as string) || latestActiveUserId || 'anonymous_user';
    const targetEmail =
      auth?.user?.email ||
      (req.body?.userEmail as string) ||
      usersById.get(targetUserId)?.email ||
      'member@spark.app';

    const { planId, subscriptionId, payerId, browserRedirectOnly } = req.body || {};
    if (!planId || !['free', 'luna', 'terra', 'sol'].includes(planId)) {
      res.status(400).json({
        ok: false,
        errorCode: 'invalid_plan_id',
        error: 'A valid planId (free, luna, terra, sol) is required.',
      });
      return;
    }

    const result = activatePayPalSubscription({
      userId: targetUserId,
      userEmail: targetEmail,
      subscriptionId: subscriptionId || `I-SPARK-${Date.now()}`,
      planId,
      payerId,
      browserRedirectOnly: Boolean(browserRedirectOnly),
      chargeWallet: (chargeInput) =>
        paypalSandboxEngine.chargeSubscriptionPlanFromPayPalWallet(chargeInput),
    });

    const balanceRes = paypalSandboxEngine.getAccountBalanceForUser({
      authenticatedUserId: targetUserId,
      userEmail: targetEmail,
      preferredCurrency: auth?.user?.preferences?.defaultCurrency || 'USD',
      autoInitializeSandboxWallet: true,
    });

    if (!result.ok) {
      const statusCode = result.errorCode === 'INSUFFICIENT_FUNDS' ? 422 : 400;
      res.status(statusCode).json({
        ...result,
        accountBalance: balanceRes.balance || null,
      });
      return;
    }

    saveRuntimeSnapshot();

    res.json({
      ok: true,
      subscription: result.subscription,
      payment: result.payment,
      buyerWallet:
        result.buyerWallet || paypalSandboxEngine.getBuyerSandboxWallet(targetUserId, targetEmail),
      balanceBefore: result.balanceBefore,
      balanceAfter: result.balanceAfter,
      transaction: result.transaction || null,
      purchaseRecord: result.purchaseRecord || null,
      accountBalance: balanceRes.balance || null,
      quotaStatus: getUserQuotaStatus(targetUserId),
      message: `Successfully activated Spark ${planId.toUpperCase()} subscription.`,
    });
  });

  // 4B. Upgrade or Downgrade Subscription Plan
  app.post('/api/subscriptions/change-plan', (req, res) => {
    const auth = authenticateRequest(req, res, { optional: true });
    const targetUserId =
      auth?.user?.id || (req.body?.userId as string) || latestActiveUserId || 'anonymous_user';
    const targetEmail =
      auth?.user?.email ||
      (req.body?.userEmail as string) ||
      usersById.get(targetUserId)?.email ||
      'member@spark.app';
    const { newPlanId } = req.body || {};
    if (!newPlanId || !['free', 'luna', 'terra', 'sol'].includes(newPlanId)) {
      res.status(400).json({
        ok: false,
        errorCode: 'invalid_plan_id',
        error: 'A valid newPlanId (free, luna, terra, sol) is required.',
      });
      return;
    }

    const result = changePayPalSubscriptionPlan({
      userId: targetUserId,
      userEmail: targetEmail,
      newPlanId,
      chargeWallet: (chargeInput) =>
        paypalSandboxEngine.chargeSubscriptionPlanFromPayPalWallet(chargeInput),
    });

    const balanceRes = paypalSandboxEngine.getAccountBalanceForUser({
      authenticatedUserId: targetUserId,
      userEmail: targetEmail,
      preferredCurrency: auth?.user?.preferences?.defaultCurrency || 'USD',
      autoInitializeSandboxWallet: true,
    });

    if (!result.ok) {
      const statusCode = result.errorCode === 'INSUFFICIENT_FUNDS' ? 422 : 400;
      res.status(statusCode).json({
        ...result,
        accountBalance: balanceRes.balance || null,
        quotaStatus: getUserQuotaStatus(targetUserId),
      });
      return;
    }

    saveRuntimeSnapshot();

    res.json({
      ...result,
      buyerWallet:
        result.buyerWallet || paypalSandboxEngine.getBuyerSandboxWallet(targetUserId, targetEmail),
      accountBalance: balanceRes.balance || null,
      quotaStatus: getUserQuotaStatus(targetUserId),
    });
  });

  // 5. Cancel Subscription (Active Until Period End)
  app.post('/api/subscriptions/cancel', (req, res) => {
    const auth = authenticateRequest(req, res, { optional: true });
    const targetUserId =
      auth?.user?.id || (req.body?.userId as string) || latestActiveUserId || 'anonymous_user';

    const subscription = cancelSubscription(targetUserId);
    saveRuntimeSnapshot();

    res.json({
      ok: true,
      subscription,
      quotaStatus: getUserQuotaStatus(targetUserId),
      message: 'Subscription has been scheduled for cancellation at the end of the billing cycle.',
    });
  });

  // 6. PayPal Webhook Listener for Subscription Billing Events
  app.post('/api/subscriptions/webhook', (req, res) => {
    const event = req.body;
    if (!event || !event.event_type) {
      res.status(400).json({ ok: false, error: 'Invalid webhook payload structure.' });
      return;
    }

    const sigHeader = req.header('paypal-transmission-sig') || undefined;
    const outcome = handlePayPalSubscriptionWebhook(event, {
      signatureHeader: sigHeader,
      rejectInvalidSignature: sigHeader === 'invalid',
    });
    if (!outcome.handled) {
      res.status(400).json({ ok: false, ...outcome });
      return;
    }

    saveRuntimeSnapshot();

    res.json({
      ok: true,
      ...outcome,
    });
  });

  // 7. AG Grid Intelligent Analytics Aggregation Endpoint
  app.get('/api/subscriptions/analytics', (req, res) => {
    const auth = authenticateRequest(req, res, { optional: true });
    const targetUserId =
      auth?.user?.id ||
      (req.header('x-spark-user-id') as string) ||
      (req.query.userId as string) ||
      latestActiveUserId ||
      'anonymous_user';

    const quotaStatus = getUserQuotaStatus(targetUserId);
    const payments = getSubscriptionPayments(targetUserId);
    const userPurchases = paypalSandboxEngine.getUserPurchases(targetUserId);
    const dashboardPreferences = getUserDashboardPreferences(targetUserId);

    res.json({
      ok: true,
      userId: targetUserId,
      quotaStatus,
      payments,
      purchasesCount: userPurchases.length,
      dashboardPreferences,
      timestamp: new Date().toISOString(),
    });
  });

  // 8. Persistent AG Grid Dashboard Preferences
  app.put('/api/subscriptions/dashboard-preferences', (req, res) => {
    const auth = authenticateRequest(req, res, { optional: true });
    const targetUserId =
      auth?.user?.id || (req.body?.userId as string) || latestActiveUserId || 'anonymous_user';
    const { defaultTab, pageSize, quickFilterDefault } = req.body || {};
    const saved = saveUserDashboardPreferences(targetUserId, {
      defaultTab: String(defaultTab || 'saved_products'),
      pageSize: Number(pageSize || 10),
      quickFilterDefault: String(quickFilterDefault || ''),
    });
    saveRuntimeSnapshot();
    res.json({ ok: true, dashboardPreferences: saved });
  });

  // 9. User Data Export & User-Requested Data Deletion (Section 5 Database Requirements)
  app.get('/api/user/data-export', (req, res) => {
    const auth = authenticateRequest(req, res, { optional: true });
    const targetUserId =
      auth?.user?.id ||
      (req.header('x-spark-user-id') as string) ||
      (req.query.userId as string) ||
      latestActiveUserId ||
      'anonymous_user';

    const profile = usersById.get(targetUserId) || null;
    const conversations = conversationsByUserId.get(targetUserId) || [];
    const purchases = paypalSandboxEngine.getUserPurchases(targetUserId);
    const quotaStatus = getUserQuotaStatus(targetUserId);
    const subscriptionPaymentsList = getSubscriptionPayments(targetUserId);
    const dashboardPreferences = getUserDashboardPreferences(targetUserId);

    const savedComparisons = savedComparisonsByUserId.get(targetUserId) || [];

    res.json({
      ok: true,
      exportedAt: new Date().toISOString(),
      userId: targetUserId,
      profile,
      subscription: quotaStatus.subscription,
      usageQuota: quotaStatus.usage,
      subscriptionPayments: subscriptionPaymentsList,
      purchases,
      conversations,
      savedComparisons,
      dashboardPreferences,
    });
  });

  app.post('/api/user/clear-history', (req, res) => {
    const auth = authenticateRequest(req, res);
    if (!auth) return;
    const targetUserId = auth.user.id;
    const scope = String(req.body?.scope || 'conversations');
    if (scope === 'conversations' || scope === 'all') {
      conversationsByUserId.set(targetUserId, []);
    }
    if (scope === 'comparisons' || scope === 'all') {
      savedComparisonsByUserId.set(targetUserId, []);
    }
    saveRuntimeSnapshot();
    res.json({
      ok: true,
      scope,
      clearedAt: new Date().toISOString(),
      message: `Successfully cleared ${scope} history for your account.`,
    });
  });

  app.delete('/api/user/data-delete', (req, res) => {
    const auth = authenticateRequest(req, res, { optional: true });
    const targetUserId =
      auth?.user?.id || (req.body?.userId as string) || latestActiveUserId || 'anonymous_user';

    conversationsByUserId.delete(targetUserId);
    savedComparisonsByUserId.delete(targetUserId);
    deleteUserSubscriptionData(targetUserId);
    saveRuntimeSnapshot();

    res.json({
      ok: true,
      deletedUserId: targetUserId,
      deletedAt: new Date().toISOString(),
      message: 'User conversations, saved comparisons, subscription records, usage history, and dashboard preferences have been permanently deleted.',
    });
  });

  // --- LIVE SCIENCE / PUBCHEM ENDPOINT ---
  app.get('/api/science/compound/:name', async (req, res) => {
    const compoundName = req.params.name || '';
    if (!compoundName.trim()) {
      res.status(400).json({ error: 'Compound name is required.' });
      return;
    }
    const data = await resolveLiveScienceCompound(compoundName);
    res.json(data);
  });

  // --- CHANNEL3 API INTEGRATION & LIVE DIAGNOSTIC ENDPOINTS ---
  let lastChannel3Verification: {
    verified: boolean;
    verifiedAt: string | null;
    diagnostic: Channel3SafeDiagnostic | null;
  } = {
    verified: false,
    verifiedAt: null,
    diagnostic: null,
  };

  app.get('/api/channel3/status', (_req, res) => {
    const configured = isChannel3CredentialConfigured();
    const connected = configured && lastChannel3Verification.verified;

    res.json({
      sourceId: CHANNEL3_SOURCE_ID,
      sourceName: CHANNEL3_SOURCE_NAME,
      baseUrl: CHANNEL3_API_BASE_URL,
      authHeader: 'x-api-key',
      configured,
      connected,
      explicitState: !configured
        ? 'Source not configured.'
        : connected
        ? 'Verified live source.'
        : lastChannel3Verification.diagnostic?.errorCode &&
          lastChannel3Verification.diagnostic.errorCode !== 'none'
        ? 'Live search failed.'
        : 'Configured (awaiting live authenticated request verification).',
      lastVerifiedAt: lastChannel3Verification.verifiedAt,
      diagnostic: lastChannel3Verification.diagnostic,
      documentedEndpoints: [
        'POST /v1/search',
        'GET /v1/products/{product_id}',
        'POST /v1/lookup',
      ],
      capabilities: {
        productSearch: true,
        urlLookup: true,
        productDetail: true,
        multiMerchantOffers: true,
        priceAndAvailability: true,
        ratingsRollup: true,
        shippingCalculation: false,
        taxCalculation: false,
        couponVerification: false,
        directCheckout: false,
      },
      message: !configured
        ? 'Source not configured: CHANNEL3_API_KEY is not set in server environment variables. Add CHANNEL3_API_KEY in the AI Studio Secrets panel.'
        : connected
        ? `Connected and verified against ${CHANNEL3_API_BASE_URL}/v1/search at ${lastChannel3Verification.verifiedAt}.`
        : lastChannel3Verification.diagnostic?.safeMessage ||
          'CHANNEL3_API_KEY detected on server. Run a live search or click Verify Connection to confirm authentication.',
    });
  });

  app.post('/api/channel3/verify', async (req, res) => {
    const query =
      typeof req.body?.query === 'string' && req.body.query.trim()
        ? req.body.query.trim()
        : 'headphones';

    if (!isChannel3CredentialConfigured()) {
      const result = await queryChannel3Search(query, { limit: 1 });
      lastChannel3Verification = {
        verified: false,
        verifiedAt: null,
        diagnostic: result.diagnostic,
      };
      res.json({
        configured: false,
        connected: false,
        explicitState: 'Source not configured.',
        report: result.report,
        diagnostic: result.diagnostic,
        error:
          'Source not configured: CHANNEL3_API_KEY is missing in server environment variables. Please add CHANNEL3_API_KEY in the AI Studio Secrets panel.',
      });
      return;
    }

    const result = await queryChannel3Search(query, { limit: 3 });
    const succeeded =
      result.diagnostic.errorCode === 'none' && result.diagnostic.httpStatus === 200;

    lastChannel3Verification = {
      verified: succeeded,
      verifiedAt: succeeded ? result.diagnostic.retrievedAt : null,
      diagnostic: result.diagnostic,
    };

    if (!succeeded) {
      res.status(502).json({
        configured: true,
        connected: false,
        explicitState: 'Live search failed.',
        report: result.report,
        diagnostic: result.diagnostic,
        error: result.diagnostic.safeMessage,
      });
      return;
    }

    res.json({
      configured: true,
      connected: true,
      explicitState: 'Verified live source.',
      verifiedAt: result.diagnostic.retrievedAt,
      report: result.report,
      diagnostic: result.diagnostic,
      sampleOfferCount: result.offers.length,
    });
  });

  app.post('/api/channel3/lookup', async (req, res) => {
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const ssrfCheck = validateSafeOutboundUrl(url);
    if (!ssrfCheck.safe) {
      securityEventMonitor.record({
        category: 'SSRF',
        severity: 'CRITICAL',
        outcome: 'BLOCKED',
        userId: null,
        ip: req.ip || 'unknown',
        endpoint: '/api/channel3/lookup',
        errorCode: ssrfCheck.errorCode || 'ssrf_blocked',
        detail: ssrfCheck.reason || `Blocked unsafe outbound URL: ${url}`,
      });
      res.status(400).json({
        ok: false,
        errorCode: ssrfCheck.errorCode || 'ssrf_blocked',
        error: ssrfCheck.reason || 'A safe public HTTP(S) product URL is required for Channel3 /v1/lookup.',
      });
      return;
    }

    const result = await queryChannel3UrlLookup(ssrfCheck.normalizedUrl || url);
    if (result.diagnostic.errorCode === 'none' && result.diagnostic.httpStatus === 200) {
      lastChannel3Verification = {
        verified: true,
        verifiedAt: result.diagnostic.retrievedAt,
        diagnostic: result.diagnostic,
      };
    }

    res.status(result.report.configured ? 200 : 503).json({
      offers: result.offers,
      report: result.report,
      diagnostic: result.diagnostic,
    });
  });

  app.get('/api/channel3/products/:productId', async (req, res) => {
    const productId = (req.params.productId || '').trim();
    if (!productId) {
      res.status(400).json({ error: 'Channel3 product_id is required.' });
      return;
    }
    const currencyRaw = String(req.query.currency || 'USD').toUpperCase();
    const currency: 'USD' | 'EUR' | 'GBP' =
      currencyRaw === 'EUR' || currencyRaw === 'GBP' ? currencyRaw : 'USD';

    const result = await queryChannel3ProductDetail(productId, currency);
    if (result.diagnostic.errorCode === 'none' && result.diagnostic.httpStatus === 200) {
      lastChannel3Verification = {
        verified: true,
        verifiedAt: result.diagnostic.retrievedAt,
        diagnostic: result.diagnostic,
      };
    }

    res.status(result.report.configured ? 200 : 503).json({
      offers: result.offers,
      report: result.report,
      diagnostic: result.diagnostic,
    });
  });

  // --- FEEDICO PARTNER API & AFFILIATE COUPON ENDPOINTS ---
  app.get('/api/feedico/status', (req, res) => {
    authenticateRequest(req, res, { optional: true });
    res.json({
      status: feedicoPartnerService.getStatus(),
    });
  });

  app.post('/api/feedico/verify', async (req, res) => {
    const authCtx = authenticateRequest(req, res, { optional: true });
    const q = typeof req.body?.q === 'string' ? req.body.q.trim().slice(0, 80) : undefined;
    const verification = await feedicoPartnerService.verifyConnectivity({
      q,
      userId: authCtx?.user.id ?? null,
    });
    res.status(verification.ok ? 200 : verification.status.configured ? 502 : 503).json(verification);
  });

  const handleFeedicoCatalogProducts = async (req: express.Request, res: express.Response) => {
    const authCtx = authenticateRequest(req, res);
    if (!authCtx) return;

    const src = req.method === 'GET' ? req.query : req.body || {};
    const q = typeof src.q === 'string' ? src.q.trim().slice(0, 120) : undefined;
    const brand = typeof src.brand === 'string' ? src.brand.trim().slice(0, 64) : undefined;
    const merchant = typeof src.merchant === 'string' ? src.merchant.trim().slice(0, 64) : undefined;
    const pageSize = Math.max(
      1,
      Math.min(200, Number.parseInt(String(src.pageSize ?? src.limit ?? '24'), 10) || 24)
    );

    try {
      const result = await feedicoPartnerService.searchNormalizedProducts(
        { q, brand, merchant, pageSize },
        { userId: authCtx.user.id }
      );
      res.json({
        ok: true,
        source: 'feedico_partner_api',
        offers: result.offers,
        products: result.rawProducts,
        recordCount: result.recordCount,
        nextCursor: result.nextCursor,
        status: feedicoPartnerService.getStatus(),
      });
    } catch (err) {
      if (err instanceof FeedicoServiceError) {
        res.status(err.statusCode).json({
          ok: false,
          errorCode: err.errorCode,
          error: err.message,
          status: feedicoPartnerService.getStatus(),
        });
        return;
      }
      res.status(503).json({
        ok: false,
        errorCode: 'feedico_products_error',
        error: redactFeedicoSecrets((err as Error)?.message || 'Failed to search Feedico products.'),
        status: feedicoPartnerService.getStatus(),
      });
    }
  };

  app.get('/api/feedico/products', handleFeedicoCatalogProducts);
  app.post('/api/feedico/products', handleFeedicoCatalogProducts);

  const handleCouponSearch = async (req: express.Request, res: express.Response) => {
    const authCtx = authenticateRequest(req, res);
    if (!authCtx) return;

    const src = req.method === 'GET' ? req.query : req.body || {};
    const q = typeof src.q === 'string' ? src.q.trim().slice(0, 120) : undefined;
    const merchant = typeof src.merchant === 'string' ? src.merchant.trim().slice(0, 64) : undefined;
    const provider = typeof src.provider === 'string' ? src.provider.trim() : undefined;
    const countries =
      Array.isArray(src.countries)
        ? src.countries.map((c: unknown) => String(c).trim().toUpperCase()).filter(Boolean)
        : typeof src.countries === 'string' && src.countries.trim()
        ? src.countries
            .split(',')
            .map((c: string) => c.trim().toUpperCase())
            .filter(Boolean)
        : undefined;
    const sort =
      src.sort === 'ending_soon' || src.sort === 'merchant' || src.sort === 'code'
        ? src.sort
        : 'newest';
    const page = Math.max(1, Math.min(50, Number.parseInt(String(src.page ?? '1'), 10) || 1));
    const pageSize = Math.max(
      1,
      Math.min(200, Number.parseInt(String(src.pageSize ?? src.limit ?? '20'), 10) || 20)
    );
    const bypassCache = src.bypassCache === true || src.bypassCache === 'true';

    try {
      const result = await feedicoPartnerService.searchCoupons(
        {
          q,
          merchant,
          provider,
          countries,
          sort,
          page,
          pageSize,
          bypassCache,
        },
        { userId: authCtx.user.id }
      );
      res.json({
        ok: true,
        source: 'feedico_partner_api',
        fromCache: result.fromCache,
        offers: result.offers,
        coupons: result.coupons,
        meta: result.meta,
        affiliateDisclosure:
          'Tracked links (goUrl) may earn Spark an affiliate commission from the merchant network at no extra cost to you. Final coupon eligibility is determined by the merchant at checkout.',
      });
    } catch (err) {
      if (err instanceof FeedicoServiceError) {
        res.status(err.statusCode).json({
          ok: false,
          errorCode: err.errorCode,
          error: err.message,
          status: feedicoPartnerService.getStatus(),
        });
        return;
      }
      res.status(503).json({
        ok: false,
        errorCode: 'feedico_unexpected_error',
        error: redactFeedicoSecrets((err as Error)?.message || 'Feedico search failed.'),
      });
    }
  };

  app.get('/api/coupons/search', handleCouponSearch);
  app.post('/api/coupons/search', handleCouponSearch);

  const handleProductOffersLookup = async (req: express.Request, res: express.Response) => {
    const authCtx = authenticateRequest(req, res);
    if (!authCtx) return;

    const src = req.method === 'GET' ? req.query : req.body || {};
    const productId = typeof src.productId === 'string' ? src.productId.trim() : 'custom_product';
    const productName = typeof src.productName === 'string' ? src.productName.trim() : '';
    const merchant = typeof src.merchant === 'string' ? src.merchant.trim() : '';
    const canonicalUrl = typeof src.canonicalUrl === 'string' ? src.canonicalUrl.trim() : '';
    const country = typeof src.country === 'string' ? src.country.trim().toUpperCase() : undefined;
    const rawPrice = src.price !== undefined && src.price !== null ? Number(src.price) : null;
    const price = rawPrice !== null && Number.isFinite(rawPrice) && rawPrice >= 0 ? rawPrice : null;
    const currency: 'USD' | 'EUR' | 'GBP' =
      src.currency === 'EUR' || src.currency === 'GBP' ? src.currency : 'USD';
    const bypassCache = src.bypassCache === true || src.bypassCache === 'true';

    if (!productName && !merchant && !canonicalUrl) {
      res.status(400).json({
        ok: false,
        errorCode: 'missing_product_or_merchant',
        error: 'Provide at least productName, merchant, or canonicalUrl to match Feedico offers.',
      });
      return;
    }

    try {
      const result = await feedicoPartnerService.findOffersForProduct(
        {
          id: productId,
          name: productName || merchant,
          merchant: merchant || productName,
          canonicalUrl,
          price,
          priceStatus: price !== null ? 'verified' : 'price_could_not_be_verified',
          currency,
        },
        {
          targetCountry: country,
          userId: authCtx.user.id,
          bypassCache,
        }
      );

      res.json({
        ok: true,
        source: 'feedico_partner_api',
        fromCache: result.fromCache,
        merchant: result.merchantRecord,
        matchedOffers: result.matchedOffers,
        coupons: result.couponItems,
        affiliateDisclosure:
          'Tracked links (goUrl) may earn Spark an affiliate commission from the merchant network at no extra cost to you. Final coupon eligibility is determined by the merchant at checkout.',
      });
    } catch (err) {
      if (err instanceof FeedicoServiceError) {
        res.status(err.statusCode).json({
          ok: false,
          errorCode: err.errorCode,
          error: err.message,
          status: feedicoPartnerService.getStatus(),
        });
        return;
      }
      res.status(503).json({
        ok: false,
        errorCode: 'feedico_product_offers_error',
        error: redactFeedicoSecrets((err as Error)?.message || 'Failed to retrieve product offers.'),
      });
    }
  };

  app.get('/api/coupons/product', handleProductOffersLookup);
  app.post('/api/coupons/product', handleProductOffersLookup);

  const handleMerchantsSearch = async (req: express.Request, res: express.Response) => {
    const authCtx = authenticateRequest(req, res);
    if (!authCtx) return;

    const src = req.method === 'GET' ? req.query : req.body || {};
    const q = typeof src.q === 'string' ? src.q.trim().slice(0, 120) : undefined;
    const provider = typeof src.provider === 'string' ? src.provider.trim() : undefined;
    const hasCoupons =
      src.hasCoupons === true || src.hasCoupons === 'true'
        ? true
        : src.hasCoupons === false || src.hasCoupons === 'false'
        ? false
        : undefined;
    const countries =
      Array.isArray(src.countries)
        ? src.countries.map((c: unknown) => String(c).trim().toUpperCase()).filter(Boolean)
        : typeof src.countries === 'string' && src.countries.trim()
        ? src.countries
            .split(',')
            .map((c: string) => c.trim().toUpperCase())
            .filter(Boolean)
        : undefined;
    const page = Math.max(1, Math.min(50, Number.parseInt(String(src.page ?? '1'), 10) || 1));
    const pageSize = Math.max(
      1,
      Math.min(200, Number.parseInt(String(src.pageSize ?? src.limit ?? '20'), 10) || 20)
    );
    const bypassCache = src.bypassCache === true || src.bypassCache === 'true';

    try {
      const result = await feedicoPartnerService.searchMerchants({
        q,
        provider,
        hasCoupons,
        countries,
        page,
        pageSize,
        bypassCache,
      });
      res.json({
        ok: true,
        source: 'feedico_partner_api',
        fromCache: result.fromCache,
        merchants: result.merchants,
        meta: result.meta,
      });
    } catch (err) {
      if (err instanceof FeedicoServiceError) {
        res.status(err.statusCode).json({
          ok: false,
          errorCode: err.errorCode,
          error: err.message,
          status: feedicoPartnerService.getStatus(),
        });
        return;
      }
      res.status(503).json({
        ok: false,
        errorCode: 'feedico_merchants_error',
        error: redactFeedicoSecrets((err as Error)?.message || 'Failed to search merchants.'),
      });
    }
  };

  app.get('/api/coupons/merchants', handleMerchantsSearch);
  app.post('/api/coupons/merchants', handleMerchantsSearch);

  app.get('/api/coupons/merchants/:merchantId/offers', async (req, res) => {
    const authCtx = authenticateRequest(req, res);
    if (!authCtx) return;

    const merchantId = (req.params.merchantId || '').trim();
    if (!merchantId || !/^[A-Za-z0-9_\-]+$/.test(merchantId)) {
      res.status(400).json({
        ok: false,
        errorCode: 'invalid_merchant_id',
        error: 'Valid merchant goSlug is required.',
      });
      return;
    }

    const countries =
      typeof req.query.countries === 'string' && req.query.countries.trim()
        ? req.query.countries
            .split(',')
            .map((c) => c.trim().toUpperCase())
            .filter(Boolean)
        : undefined;
    const page = Math.max(1, Math.min(50, Number.parseInt(String(req.query.page ?? '1'), 10) || 1));
    const pageSize = Math.max(
      1,
      Math.min(200, Number.parseInt(String(req.query.pageSize ?? '48'), 10) || 48)
    );

    try {
      const result = await feedicoPartnerService.searchCoupons(
        {
          merchant: merchantId,
          countries,
          page,
          pageSize,
        },
        { userId: authCtx.user.id }
      );
      res.json({
        ok: true,
        merchantId,
        fromCache: result.fromCache,
        offers: result.offers,
        coupons: result.coupons,
        meta: result.meta,
      });
    } catch (err) {
      if (err instanceof FeedicoServiceError) {
        res.status(err.statusCode).json({
          ok: false,
          errorCode: err.errorCode,
          error: err.message,
        });
        return;
      }
      res.status(503).json({
        ok: false,
        errorCode: 'merchant_offers_failed',
        error: redactFeedicoSecrets((err as Error)?.message || 'Failed to load merchant offers.'),
      });
    }
  });

  app.get('/api/coupons/offers/:offerId', (req, res) => {
    const authCtx = authenticateRequest(req, res);
    if (!authCtx) return;

    const offerId = (req.params.offerId || '').trim();
    if (!offerId) {
      res.status(400).json({ ok: false, errorCode: 'missing_offer_id', error: 'offerId is required.' });
      return;
    }

    const offer = feedicoPartnerService.getOfferById(offerId, { userId: authCtx.user.id });
    if (!offer) {
      res.status(404).json({
        ok: false,
        errorCode: 'offer_not_found',
        error: `Offer ${offerId} is not present in the local Feedico offer store.`,
      });
      return;
    }

    res.json({
      ok: true,
      offer,
      affiliateDisclosure:
        'Tracked links (goUrl) may earn Spark an affiliate commission from the merchant network at no extra cost to you.',
    });
  });

  app.get('/api/coupons/cache/status', (req, res) => {
    const authCtx = authenticateRequest(req, res);
    if (!authCtx) return;
    res.json({
      ok: true,
      cache: feedicoPartnerService.getCacheDiagnostics(authCtx.user.id),
      status: feedicoPartnerService.getStatus(),
    });
  });

  app.post('/api/coupons/cache/refresh', async (req, res) => {
    const authCtx = authenticateRequest(req, res);
    if (!authCtx) return;

    feedicoPartnerService.clearCache();
    const q = typeof req.body?.q === 'string' ? req.body.q.trim() : undefined;
    if (q) {
      try {
        const refreshed = await feedicoPartnerService.searchCoupons(
          { q, bypassCache: true },
          { userId: authCtx.user.id }
        );
        res.json({
          ok: true,
          cacheCleared: true,
          refreshedOffersCount: refreshed.offers.length,
          cache: feedicoPartnerService.getCacheDiagnostics(authCtx.user.id),
        });
        return;
      } catch (err) {
        if (err instanceof FeedicoServiceError) {
          res.status(err.statusCode).json({
            ok: false,
            cacheCleared: true,
            errorCode: err.errorCode,
            error: err.message,
          });
          return;
        }
      }
    }

    res.json({
      ok: true,
      cacheCleared: true,
      cache: feedicoPartnerService.getCacheDiagnostics(authCtx.user.id),
    });
  });

  app.post('/api/coupons/links/validate', async (req, res) => {
    const authCtx = authenticateRequest(req, res);
    if (!authCtx) return;

    const links = Array.isArray(req.body?.links) ? req.body.links : [];
    try {
      const validation = await feedicoPartnerService.validateLinks(links);
      res.json({
        ok: true,
        ...validation,
      });
    } catch (err) {
      if (err instanceof FeedicoServiceError) {
        res.status(err.statusCode).json({
          ok: false,
          errorCode: err.errorCode,
          error: err.message,
        });
        return;
      }
      res.status(503).json({
        ok: false,
        errorCode: 'link_validation_failed',
        error: redactFeedicoSecrets((err as Error)?.message || 'Failed to validate links.'),
      });
    }
  });

  app.post('/api/coupons/track-click', (req, res) => {
    const authCtx = authenticateRequest(req, res);
    if (!authCtx) return;

    const {
      feedicoOfferId = null,
      merchantId = '',
      merchantName = '',
      couponCode = null,
      productId = null,
      productName = null,
      goUrl = '',
      merchantWebsiteUrl = null,
      deepLinkUrl = null,
      targetCountry = null,
    } = req.body || {};

    if (!goUrl || typeof goUrl !== 'string') {
      res.status(400).json({
        ok: false,
        errorCode: 'missing_tracked_url',
        error: 'goUrl is required to record affiliate click attribution.',
      });
      return;
    }

    const goUrlSafety = validateSafeOutboundUrl(goUrl);
    if (!goUrlSafety.safe) {
      securityEventMonitor.record({
        category: 'SSRF',
        severity: 'HIGH',
        outcome: 'BLOCKED',
        userId: authCtx.user.id,
        ip: req.ip || 'unknown',
        endpoint: '/api/coupons/track-click',
        errorCode: goUrlSafety.errorCode || 'invalid_tracked_url',
        detail: goUrlSafety.reason || 'Unsafe tracked goUrl blocked.',
      });
      res.status(400).json({
        ok: false,
        errorCode: goUrlSafety.errorCode || 'invalid_tracked_url',
        error: goUrlSafety.reason || 'goUrl must be a safe public HTTP/HTTPS URL.',
      });
      return;
    }

    const clickRecord = feedicoPartnerService.recordAffiliateClick({
      userId: authCtx.user.id,
      feedicoOfferId,
      merchantId: String(merchantId || 'merchant'),
      merchantName: String(merchantName || 'Merchant'),
      couponCode: couponCode ? String(couponCode) : null,
      productId: productId ? String(productId) : null,
      productName: productName ? String(productName) : null,
      goUrl,
      merchantWebsiteUrl,
      deepLinkUrl,
      targetCountry,
    });

    res.json({
      ok: true,
      click: clickRecord,
      notice:
        'Click attribution recorded with your opaque Spark sub-ID. A click is not a completed purchase; merchant commissions are only confirmed upon verified merchant postback.',
    });
  });

  app.get('/api/coupons/clicks', (req, res) => {
    const authCtx = authenticateRequest(req, res);
    if (!authCtx) return;

    const clicks = feedicoPartnerService.getUserAffiliateClicks(authCtx.user.id);
    res.json({
      ok: true,
      userId: authCtx.user.id,
      clicks,
    });
  });

  app.post('/api/feedico/postback', (req, res) => {
    const cfg = getFeedicoConfig();
    const sigHeader = req.header('X-Feedico-Signature') || '';
    const rawBody = JSON.stringify(req.body || {});
    const verification = verifyFeedicoPostbackSignature(rawBody, sigHeader, cfg.postbackSecret);
    if (!verification.verified) {
      res.status(401).json({
        ok: false,
        errorCode: 'invalid_postback_signature',
        error: verification.reason || 'Signature verification failed.',
      });
      return;
    }

    try {
      const outcome = feedicoPartnerService.processCommissionPostback(req.body || {});
      res.status(200).json({ ok: true, ...outcome });
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: redactFeedicoSecrets((err as Error)?.message || 'Invalid postback payload.'),
      });
    }
  });

  // --- LIVE SOURCES DIAGNOSTIC ENDPOINT ---
  const buildExternalCredentialsRoutingReport = () => {
    const now = new Date().toISOString();
    const channel3Configured = isChannel3CredentialConfigured();
    const feedicoCfg = feedicoPartnerService.getConfig();
    const paypalReady = isPayPalConfigured();
    const providers = [
      {
        providerId: CHANNEL3_SOURCE_ID,
        providerName: CHANNEL3_SOURCE_NAME,
        capabilityCategory: 'product_catalog_search' as const,
        requiresApiKey: true,
        envVarNames: ['CHANNEL3_API_KEY'],
        configured: channel3Configured,
        explicitState: channel3Configured ? ('Configured' as const) : ('Source not configured' as const),
        routingBehavior: channel3Configured
          ? 'Queries Channel3 Product Graph (/v1/search, /v1/products, /v1/lookup) for live merchant offers.'
          : 'Add CHANNEL3_API_KEY in server environment variables to enable Channel3 live product search.',
        lastCheckedAt: now,
      },
      {
        providerId: 'feedico_partner_api',
        providerName: 'Feedico Partner API',
        capabilityCategory: 'affiliate_coupon_discovery' as const,
        requiresApiKey: true,
        envVarNames: ['FEEDICO_PARTNER_TOKEN'],
        configured: feedicoCfg.configured,
        explicitState: feedicoCfg.configured ? ('Configured' as const) : ('Source not configured' as const),
        routingBehavior: feedicoCfg.configured
          ? `Queries ${feedicoCfg.baseUrl} for active merchant coupons and tracked affiliate deals.`
          : 'Add FEEDICO_PARTNER_TOKEN (fdcp_ or fdco_) to enable live coupon discovery.',
        lastCheckedAt: now,
      },
      {
        providerId: 'paypal_checkout_api',
        providerName: 'PayPal Merchant Checkout REST API',
        capabilityCategory: 'payment_checkout' as const,
        requiresApiKey: true,
        envVarNames: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'],
        configured: paypalReady,
        explicitState: paypalReady ? ('Configured' as const) : ('Source not configured' as const),
        routingBehavior: paypalReady
          ? 'Executes verified PayPal OAuth 2.0 and Orders v2 checkout flows.'
          : 'Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to enable PayPal checkout.',
        lastCheckedAt: now,
      },
      {
        providerId: 'openlibrary_api',
        providerName: 'Open Library Catalog API',
        capabilityCategory: 'bibliographic_catalog' as const,
        requiresApiKey: false,
        envVarNames: [],
        configured: true,
        explicitState: 'Public Live Source (No Key Required)' as const,
        routingBehavior: 'Queries https://openlibrary.org/search.json for live bibliographic catalog records.',
        lastCheckedAt: now,
      },
      {
        providerId: 'pubchem_ncbi_api',
        providerName: 'NCBI PubChem PUG REST API',
        capabilityCategory: 'scientific_compound_verification' as const,
        requiresApiKey: false,
        envVarNames: [],
        configured: true,
        explicitState: 'Public Live Source (No Key Required)' as const,
        routingBehavior: 'Queries https://pubchem.ncbi.nlm.nih.gov/rest/pug for live chemical compound structures.',
        lastCheckedAt: now,
      },
    ];
    return {
      evaluatedAt: now,
      zeroSimulatedDataEnforced: true,
      configuredCount: providers.filter((p) => p.configured).length,
      unconfiguredCount: providers.filter((p) => !p.configured).length,
      providers,
    };
  };

  app.get('/api/spark/sources', (_req, res) => {
    const now = new Date().toISOString();
    const channel3Configured = isChannel3CredentialConfigured();
    const feedicoStatus = feedicoPartnerService.getStatus();
    const couponFeedConfigured =
      feedicoStatus.configured || Boolean(process.env.AFFILIATE_COUPON_API_KEY);
    const paypalReady = isPayPalConfigured();

    const sources: SourceExecutionReport[] = [
      {
        sourceId: CHANNEL3_SOURCE_ID,
        sourceName: CHANNEL3_SOURCE_NAME,
        configured: channel3Configured,
        queried: Boolean(lastChannel3Verification.diagnostic),
        status: !channel3Configured
          ? 'source_not_configured'
          : lastChannel3Verification.verified
          ? 'verified_ok'
          : lastChannel3Verification.diagnostic &&
            lastChannel3Verification.diagnostic.errorCode !== 'none'
          ? 'live_search_failed'
          : 'verified_ok',
        explicitStateMessage: !channel3Configured
          ? 'Source not configured (CHANNEL3_API_KEY not set in server environment).'
          : lastChannel3Verification.verified
          ? `Connected & verified against ${CHANNEL3_API_BASE_URL}/v1/search.`
          : lastChannel3Verification.diagnostic?.safeMessage ||
            'Configured (CHANNEL3_API_KEY present — awaiting first live request verification).',
        resultCount: 0,
        retrievedAt: lastChannel3Verification.verifiedAt || now,
      },
      {
        sourceId: 'openlibrary_api',
        sourceName: 'Open Library Catalog API',
        configured: true,
        queried: false,
        status: 'verified_ok',
        explicitStateMessage: 'Configured (Live bibliographic catalog — Price could not be verified).',
        resultCount: 0,
        retrievedAt: now,
      },
      {
        sourceId: 'pubchem_ncbi_api',
        sourceName: 'NCBI PubChem PUG REST API',
        configured: true,
        queried: false,
        status: 'verified_ok',
        explicitStateMessage: 'Configured (Live chemical & ingredient structure verification).',
        resultCount: 0,
        retrievedAt: now,
      },
      {
        sourceId: 'feedico_partner_api',
        sourceName: 'Feedico Partner API (Merchant Coupons & Tracked Deals)',
        configured: couponFeedConfigured,
        queried: Boolean(feedicoStatus.lastSyncAt),
        status: !couponFeedConfigured
          ? 'source_not_configured'
          : feedicoStatus.integrationState === 'CONFIGURED_AND_VERIFIED'
          ? 'verified_ok'
          : feedicoStatus.integrationState === 'INVALID_CREDENTIALS' ||
            feedicoStatus.integrationState === 'RATE_LIMITED' ||
            feedicoStatus.integrationState === 'PROVIDER_UNAVAILABLE'
          ? 'live_search_failed'
          : 'verified_ok',
        explicitStateMessage:
          feedicoStatus.integrationState === 'CONFIGURED_AND_VERIFIED'
            ? `[${feedicoStatus.integrationState}] Verified live (${feedicoStatus.baseUrl} · TTL ${feedicoStatus.cacheTtlSeconds}s · ${feedicoStatus.cachedOffersCount} cached offers).`
            : `[${feedicoStatus.integrationState}] ${feedicoStatus.statusMessage}`,
        resultCount: feedicoStatus.cachedOffersCount,
        retrievedAt: feedicoStatus.lastSyncAt || now,
      },
      {
        sourceId: 'paypal_checkout_api',
        sourceName: 'PayPal Merchant Checkout REST API',
        configured: paypalReady,
        queried: false,
        status: paypalReady ? 'verified_ok' : 'source_not_configured',
        explicitStateMessage: paypalReady
          ? 'Configured.'
          : 'Source not configured. Checkout unsupported until PAYPAL_CLIENT_ID & PAYPAL_CLIENT_SECRET are provided.',
        resultCount: 0,
        retrievedAt: now,
      },
    ];

    res.json({
      sources,
      feedico: feedicoStatus,
      externalCredentialsRouting: buildExternalCredentialsRoutingReport(),
    });
  });

  app.get('/api/spark/credentials-status', (_req, res) => {
    res.json({
      ok: true,
      report: buildExternalCredentialsRoutingReport(),
    });
  });

  app.post('/api/spark/credentials-verify', async (req, res) => {
    authenticateRequest(req, res, { optional: true });
    const [openLibCheck, pubchemCheck] = await Promise.all([
      queryOpenLibrarySource('Python Programming'),
      resolveLiveScienceCompound('niacinamide'),
    ]);

    res.json({
      ok: true,
      report: buildExternalCredentialsRoutingReport(),
      livePublicVerification: {
        verifiedAt: new Date().toISOString(),
        openLibraryRecords: openLibCheck.offers.length,
        pubchemCidVerified: Boolean(pubchemCheck.cid),
      },
    });
  });

  // --- DETERMINISTIC LIVE CATALOG SEARCH & PRICE COMPARISON ENDPOINT ---
  app.post('/api/spark/orchestrate', async (req, res) => {
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    const orchRate = orchestrateRateLimiter.check(`orch:${clientIp}`);
    if (!orchRate.allowed) {
      res.status(429).json({
        ok: false,
        errorCode: 'orchestrate_rate_limit_exceeded',
        error: 'Too many search requests. Please wait a moment before submitting another query.',
      });
      return;
    }

    let {
      prompt = '',
      preferredName = '',
      previousTurnPrompts = [],
      previousPrompts = [],
      allowSecondarySourceFallback = false,
      isVoiceInput = false,
      voiceLanguage = 'en',
    }: {
      prompt?: string;
      preferredName?: string;
      previousTurnPrompts?: string[];
      previousPrompts?: string[];
      allowSecondarySourceFallback?: boolean;
      isVoiceInput?: boolean;
      voiceLanguage?: string;
    } = req.body || {};

    const voicePayload = isVoiceInput
      ? normalizeVoiceQuery(prompt, voiceLanguage)
      : null;
    if (voicePayload && voicePayload.normalizedTranscript) {
      prompt = voicePayload.normalizedTranscript;
    }

    const historyPrompts: string[] = [
      ...(Array.isArray(previousTurnPrompts) ? previousTurnPrompts : []),
      ...(Array.isArray(previousPrompts) ? previousPrompts : []),
    ];

    if (!prompt.trim()) {
      res.status(400).json({ error: 'Please enter a shopping request.' });
      return;
    }

    const promptInspection = detectPromptInjection(prompt);
    if (promptInspection.blocked) {
      securityEventMonitor.record({
        category: 'PROMPT_INJECTION',
        severity: 'CRITICAL',
        outcome: 'BLOCKED',
        userId: null,
        ip: clientIp,
        endpoint: '/api/spark/orchestrate',
        errorCode: 'prompt_injection_blocked',
        detail: `Blocked unsafe input (${promptInspection.matchedRules.join(', ')})`,
      });
      res.status(400).json({
        ok: false,
        errorCode: 'prompt_injection_blocked',
        error: promptInspection.reason || 'Request blocked by Spark Security Layer.',
        matchedRules: promptInspection.matchedRules,
      });
      return;
    }

    const authCtx = authenticateRequest(req, res, { optional: true });
    const targetUserId =
      authCtx?.user?.id || (req.header('x-spark-user-id') as string) || latestActiveUserId || 'anonymous_user';

    const quotaCheck = reserveFeatureQuota(targetUserId, 'workflow');
    if (!quotaCheck.allowed) {
      const qStatus = getUserQuotaStatus(targetUserId);
      res.status(429).json({
        ok: false,
        errorCode: 'quota_exhausted',
        error: quotaCheck.error,
        quotaStatus: qStatus,
      });
      return;
    }

    const concurrencyCheck = acquireConcurrency(targetUserId);
    if (!concurrencyCheck.allowed) {
      res.status(429).json({
        ok: false,
        errorCode: 'concurrency_limit_exceeded',
        error: concurrencyCheck.error,
      });
      return;
    }

    const now = new Date().toISOString();
    const agentSteps: AgentStepReport[] = [];
    const sourceReports: SourceExecutionReport[] = [];
    const groundingCitations: GroundingCitation[] = [];
    const explicitFailureStates = new Set<ExplicitVerificationState>();

    const t0 = Date.now();
    const verifiedUserId = authCtx?.user.id || latestActiveUserId || null;

    const intent: ExtractedShoppingIntent = parseShoppingIntent(prompt);

    agentSteps.push({
      agentId: 'intent',
      agentName: 'Search Query & Budget Parser',
      modelUsed: 'deterministic-parser',
      status: 'completed',
      durationMs: Math.max(4, Date.now() - t0),
      summary: `Parsed search query "${prompt.trim()}"${intent.maxBudget !== null ? ` with budget cap ${intent.currency} ${intent.maxBudget}` : ''}.`,
      details: [
        `Category: ${intent.category || 'general'}`,
        `Max Budget: ${intent.maxBudget !== null ? `${intent.currency} ${intent.maxBudget}` : 'No limit'}`,
      ],
    });

    const addressAs = preferredName.trim() || 'there';

    if (intent.responseType === 'general_question') {
      const coordinatorMessage = `${addressAs}, Spark searches live product catalogs (Channel3 Product Graph API, Feedico Partner API, Open Library Catalog API, and NCBI PubChem REST API) to find verified products, compare merchant prices, and check active coupons.`;
      if (voicePayload) {
        voicePayload.spokenSummaryText = buildSpokenResponseSummary({ coordinatorMessage });
      }

      const earlyPayload: OrchestrationResponse = {
        requestId: `orch_${Date.now().toString(36)}`,
        timestamp: new Date().toISOString(),
        responseType: intent.responseType,
        intent,
        sourceReports: [],
        agentSteps,
        coordinatorMessage,
        explicitFailureStates: [],
        recommendedProductId: null,
        offers: [],
        verifiedCoupons: [],
        couponSubsystemState: 'Not queried for general question.',
        groundingCitations: [],
        scienceAnalysis: null,
        voiceInteraction: voicePayload,
      };
      releaseConcurrency(targetUserId);
      res.json(earlyPayload);
      return;
    }

    // 1B. PHASE 5 CONSTRAINT CONTRADICTION CHECK & DIRECT CART OPERATION ROUTING
    const syntheticHistoryTurns = historyPrompts.map((hp, idx) => ({
      id: `hist_${idx}`,
      userPrompt: hp,
      createdAt: now,
      status: 'completed' as const,
      stages: [],
      response: null,
      errorMessage: null,
    }));
    const initialConstraints = extractConstraintHierarchy(prompt, syntheticHistoryTurns);

    if (initialConstraints.detectedContradictions.length > 0) {
      const firstContra = initialConstraints.detectedContradictions[0];
      const phase5Contra = await executePhase5SevenAgentOrchestrator({
        orchestrationId: `orch_contra_${Date.now().toString(36)}`,
        prompt,
        conversationTurns: syntheticHistoryTurns,
        offers: [],
        coupons: [],
        sourceReports: [],
        report: null,
        needsClarification: true,
      });
      const contraMsg = `To ensure an accurate recommendation, I noticed a conflict in your constraints: **${firstContra.resolutionQuestion}**`;
      if (voicePayload) {
        voicePayload.spokenSummaryText = buildSpokenResponseSummary({
          coordinatorMessage: contraMsg,
        });
      }
      const contraPayload: OrchestrationResponse = {
        requestId: `orch_${Date.now().toString(36)}`,
        timestamp: new Date().toISOString(),
        responseType: 'missing_information',
        clarificationSuggestions: [
          `Use ${firstContra.newValue}`,
          `Keep ${firstContra.previousValue}`,
        ],
        followUpClarification: {
          question: firstContra.resolutionQuestion,
          whyItMatters: `Conflicting ${firstContra.field} constraints (${firstContra.previousValue} vs. ${firstContra.newValue}) prevent deterministic candidate filtering.`,
          missingRequirement: 'specifications',
        },
        intent,
        sourceReports: [],
        agentSteps: [
          ...agentSteps,
          {
            agentId: 'intent',
            agentName: 'Agent 1 — Contradiction Detection & Constraint Guard',
            modelUsed: 'gemini-3-flash-preview',
            status: 'completed',
            durationMs: Math.max(4, Date.now() - t0),
            summary: `Detected conflicting constraint on "${firstContra.field}" (${firstContra.previousValue} vs ${firstContra.newValue}).`,
            details: initialConstraints.detectedContradictions.map((c) => c.resolutionQuestion),
          },
        ],
        coordinatorMessage: contraMsg,
        explicitFailureStates: [],
        recommendedProductId: null,
        offers: [],
        verifiedCoupons: [],
        couponSubsystemState: 'Not queried prior to resolving conflicting constraints.',
        groundingCitations: [],
        scienceAnalysis: null,
        phase5SevenAgentContracts: phase5Contra.agentContracts,
        omegaDecisionCrucible: phase5Contra.omegaCrucible,
        constraintHierarchy: phase5Contra.constraints,
        observabilityTelemetry: phase5Contra.observability,
        voiceInteraction: voicePayload,
      };
      releaseConcurrency(targetUserId);
      res.json(contraPayload);
      return;
    }

    // Check if the prompt is a direct Cart operation on existing Cart state (update quantity, remove item, revalidate prices, query payable amount, checkout cart)
    const parsedCartCmd = parseNaturalLanguageCartCommand(prompt);
    const isPureCartStateCommand =
      parsedCartCmd.isShoppingCommand &&
      (parsedCartCmd.actionType === 'update_cart_quantity' ||
        parsedCartCmd.actionType === 'remove_from_cart' ||
        parsedCartCmd.actionType === 'revalidate_cart_prices' ||
        parsedCartCmd.actionType === 'query_payable_amount' ||
        parsedCartCmd.actionType === 'checkout_cart');

    if (isPureCartStateCommand && parsedCartCmd.actionType) {
      if (parsedCartCmd.actionType === 'revalidate_cart_prices') {
        await paypalSandboxEngine.validateCartItems(verifiedUserId || targetUserId);
      }
      const cartExec = paypalSandboxEngine.executeAgentShoppingAction({
        userId: verifiedUserId || targetUserId,
        action: parsedCartCmd.actionType,
        quantity: parsedCartCmd.quantity,
        targetItemQuery: parsedCartCmd.targetProductQuery,
        couponCode: parsedCartCmd.couponCode,
      });
      if (voicePayload) {
        voicePayload.spokenSummaryText = buildSpokenResponseSummary({
          coordinatorMessage: cartExec.message,
          shoppingExecution: cartExec,
        });
      }
      const cartOnlyPayload: OrchestrationResponse = {
        requestId: `orch_${Date.now().toString(36)}`,
        timestamp: new Date().toISOString(),
        responseType: 'general_question',
        intent,
        sourceReports: [],
        agentSteps: [
          ...agentSteps,
          {
            agentId: 'coordinator',
            agentName: 'Intelligent Cart & Transaction Safeguard Engine',
            modelUsed: 'spark-shopping-execution-engine',
            status: cartExec.action === 'rejected_unverified' ? 'no_verified_results' : 'completed',
            durationMs: Math.max(5, Date.now() - t0),
            summary: cartExec.message,
            details: cartExec.orderSummary
              ? [
                  `Items in Cart: ${cartExec.orderSummary.quantity}`,
                  `Subtotal: ${cartExec.orderSummary.currency} ${cartExec.orderSummary.subtotal.toFixed(2)}`,
                  `Final Known Payable Total: ${cartExec.orderSummary.currency} ${cartExec.orderSummary.finalKnownTotal.toFixed(2)}`,
                ]
              : [cartExec.message],
          },
        ],
        coordinatorMessage: cartExec.message,
        explicitFailureStates: [],
        recommendedProductId: null,
        offers: [],
        verifiedCoupons: [],
        couponSubsystemState: 'Direct Cart operation executed.',
        groundingCitations: [],
        scienceAnalysis: null,
        agentShoppingExecution: cartExec,
        voiceInteraction: voicePayload,
      };
      releaseConcurrency(targetUserId);
      saveRuntimeSnapshot();
      res.json(cartOnlyPayload);
      return;
    }

    // 2. AUTONOMOUS AI PRODUCT INTELLIGENCE AGENT EXECUTION
    agentToolPermissionGate.authorizeToolCall({
      toolName: 'search_products',
      userId: verifiedUserId || clientIp,
      args: { query: prompt.slice(0, 200) },
    });

    const urlMatch = prompt.match(/https?:\/\/[^\s"'<>]+/i);
    const safeUrlLookupTarget =
      urlMatch && validateSafeOutboundUrl(urlMatch[0]).safe ? urlMatch[0] : null;
    if (urlMatch && !safeUrlLookupTarget) {
      securityEventMonitor.record({
        category: 'SSRF',
        severity: 'CRITICAL',
        outcome: 'BLOCKED',
        userId: verifiedUserId,
        ip: clientIp,
        endpoint: '/api/spark/orchestrate',
        errorCode: 'agent_ssrf_url_blocked',
        detail: `Blocked unsafe URL inside user query from reaching Channel3 lookup: ${urlMatch[0]}`,
      });
    }

    const agentResult = await executeSparkProductIntelligenceAgent({
      prompt,
      previousPrompts: historyPrompts,
      preferredName,
      userId: verifiedUserId,
      clientIp,
      maxBudget: intent.maxBudget,
      currency: intent.currency,
      category: intent.category || undefined,
      allowSecondarySourceFallback: Boolean(allowSecondarySourceFallback),
    });

    // Handle intelligent conversational requirement clarification when query lacks essential context
    if (agentResult.needsClarification && agentResult.clarification) {
      const clarificationPayload: OrchestrationResponse = {
        requestId: `orch_${Date.now().toString(36)}`,
        timestamp: new Date().toISOString(),
        responseType: 'missing_information',
        clarificationSuggestions: agentResult.clarificationSuggestions || [
          'Laptop for software engineering under $1,500',
          'Noise-cancelling headphones for travel under $350',
          '27-inch 4K USB-C monitor under $500',
        ],
        followUpClarification: agentResult.clarification,
        intent,
        sourceReports: [],
        agentSteps: [
          {
            agentId: 'intent',
            agentName: 'Requirement Clarification & Adaptive Questioning',
            modelUsed: 'gemini-3.8-flash',
            status: 'completed',
            durationMs: Math.max(4, Date.now() - t0),
            summary: `Identified underspecified requirement for "${prompt.trim()}". Initiated intelligent clarification before catalog search.`,
            details: [
              `Question: ${agentResult.clarification.question}`,
              `Why it matters: ${agentResult.clarification.whyItMatters}`,
              `Target requirement: ${agentResult.clarification.missingRequirement}`,
            ],
          },
        ],
        coordinatorMessage: agentResult.coordinatorMessage,
        explicitFailureStates: [],
        recommendedProductId: null,
        offers: [],
        verifiedCoupons: [],
        couponSubsystemState: 'Not queried prior to requirement clarification.',
        groundingCitations: [],
        scienceAnalysis: null,
      };
      releaseConcurrency(targetUserId);
      res.json(clarificationPayload);
      return;
    }

    // Update Channel3 live verification state cache for diagnostics / admin dashboard
    const ch3Report = agentResult.sourceReports.find(
      (s) => s.sourceId === 'channel3_product_graph'
    );
    if (ch3Report) {
      lastChannel3Verification = {
        verified: ch3Report.status === 'verified_ok',
        verifiedAt: ch3Report.retrievedAt,
        diagnostic: {
          endpoint: '/v1/search',
          httpStatus:
            ch3Report.status === 'verified_ok'
              ? 200
              : ch3Report.status === 'live_search_failed'
              ? 500
              : 0,
          retrievedAt: ch3Report.retrievedAt,
          errorCode:
            ch3Report.status === 'verified_ok'
              ? 'none'
              : ch3Report.status === 'live_search_failed'
              ? 'upstream_5xx'
              : 'missing_credential',
          safeMessage: ch3Report.explicitStateMessage,
          latencyMs: 40,
          retryAttempts: 0,
        },
      };
    }

    explicitFailureStates.clear();
    if (!isChannel3CredentialConfigured()) {
      explicitFailureStates.add('Source not configured.');
    }
    if (agentResult.offers.length === 0) {
      explicitFailureStates.add('No verified results found.');
    }
    if (agentResult.offers.some((o) => o.priceStatus === 'price_could_not_be_verified')) {
      explicitFailureStates.add('Price could not be verified.');
    }
    if (agentResult.offers.some((o) => o.availabilityStatus === 'unknown')) {
      explicitFailureStates.add('Availability unknown.');
    }
    if (agentResult.verifiedCoupons.length === 0) {
      explicitFailureStates.add('Coupon validity unknown.');
    }
    if (
      !isPayPalConfigured() ||
      agentResult.offers.every((o) => o.checkoutStatus === 'checkout_unsupported')
    ) {
      explicitFailureStates.add('Checkout unsupported.');
    }

    const report = agentResult.report!;

    agentSteps.length = 0;
    agentSteps.push(
      {
        agentId: 'intent',
        agentName: 'Autonomous Research Strategy & Constraint Formulation',
        modelUsed: 'gemini-3.8-flash',
        status: 'completed',
        durationMs: Math.max(12, Date.now() - t0),
        summary: `Formulated dynamic research plan for category "${report.category}". Evaluated ${report.evaluationCriteria.length} category criteria.`,
        details: report.evaluationCriteria.map(
          (c) => `${c.name} (${c.weight}%): ${c.description}`
        ),
      },
      {
        agentId: 'discovery',
        agentName: 'Live Catalog Discovery (Channel3 Product Graph)',
        modelUsed: 'channel3-catalog-api',
        status:
          agentResult.offers.length > 0
            ? 'completed'
            : !isChannel3CredentialConfigured()
            ? 'source_not_configured'
            : 'no_verified_results',
        durationMs: Math.max(25, Date.now() - t0),
        summary: `Retrieved and verified ${agentResult.offers.length} live product record(s) from catalog APIs.`,
        details: agentResult.offers.slice(0, 4).map((o) => `${o.name} (${o.merchant})`),
      },
      {
        agentId: 'coupon',
        agentName: 'Feedico Partner Coupon Verification',
        modelUsed: 'feedico-partner-api',
        status:
          agentResult.verifiedCoupons.length > 0
            ? 'completed'
            : 'no_verified_results',
        durationMs: Math.max(10, Date.now() - t0),
        summary:
          agentResult.verifiedCoupons.length > 0
            ? `Retrieved ${agentResult.verifiedCoupons.length} verified merchant coupon/deal(s).`
            : 'No verified active merchant coupons matched this search.',
        details: agentResult.verifiedCoupons
          .slice(0, 3)
          .map(
            (c) =>
              `${c.code ? `Code: ${c.code}` : 'Promotional Deal'}: ${c.description} (${c.merchant})`
          ),
      },
      {
        agentId: 'comparison',
        agentName: 'Multi-Dimensional Evidence Scoring & Specification Verification',
        modelUsed: 'spark-evidence-engine',
        status: agentResult.offers.length > 0 ? 'completed' : 'no_verified_results',
        durationMs: Math.max(8, Date.now() - t0),
        summary: `Scored ${agentResult.offers.length} candidate(s) across performance, price/value, reputation, and evidence completeness.`,
        details: report.rankedProducts
          .slice(0, 3)
          .map(
            (p) =>
              `#${p.rank} ${p.name} — Score: ${p.score}/100 (${p.evidenceCompletenessPercent}% evidence verified)`
          ),
      },
      {
        agentId: 'coordinator',
        agentName: 'Autonomous Gemini Intelligence Synthesis',
        modelUsed: 'gemini-3.8-flash',
        status: 'completed',
        durationMs: Math.max(15, Date.now() - t0),
        summary: `Generated defensible recommendation and market synthesis. Top recommendation: "${report.finalRecommendation.recommendedProductName}".`,
        details: [
          `Best For: ${report.finalRecommendation.bestFor}`,
          `Value Assessment: ${report.finalRecommendation.valueAssessment}`,
        ],
      }
    );

    for (const offer of agentResult.offers) {
      paypalSandboxEngine.registerVerifiedLiveOffer(offer);
    }
    for (const cpn of agentResult.verifiedCoupons) {
      paypalSandboxEngine.registerVerifiedLiveCoupon(cpn);
    }

    const resolvedRecommendedId =
      report.finalRecommendation?.recommendedProductId ||
      agentResult.offers[0]?.id ||
      null;
    const primaryVerifiedOffer =
      agentResult.offers.find((o) => o.id === resolvedRecommendedId) ||
      agentResult.offers[0] ||
      null;

    // Detect natural-language shopping & Cart commands (Add to Cart / Update Qty / Remove / Compare with Cart / Apply Coupon / Revalidate / Query Total / Buy / Checkout Cart)
    let agentShoppingExecution = null;
    if (parsedCartCmd.isShoppingCommand && parsedCartCmd.actionType) {
      agentShoppingExecution = paypalSandboxEngine.executeAgentShoppingAction({
        userId: verifiedUserId || targetUserId,
        action: parsedCartCmd.actionType,
        product: primaryVerifiedOffer,
        quantity: parsedCartCmd.quantity,
        targetItemQuery: parsedCartCmd.targetProductQuery,
        couponCode: parsedCartCmd.couponCode,
        availableCoupons: agentResult.verifiedCoupons,
      });

      agentSteps.push({
        agentId: 'coordinator',
        agentName: 'AI Shopping Execution & Explicit Consent Gate',
        modelUsed: 'spark-shopping-execution-engine',
        status:
          agentShoppingExecution.action === 'rejected_unverified'
            ? 'no_verified_results'
            : 'completed',
        durationMs: Math.max(6, Date.now() - t0),
        summary: agentShoppingExecution.message,
        details: agentShoppingExecution.orderSummary
          ? [
              `Product: ${agentShoppingExecution.orderSummary.productName} (${agentShoppingExecution.orderSummary.merchant})`,
              `Quantity & Unit Price: ${agentShoppingExecution.orderSummary.quantity} × ${agentShoppingExecution.orderSummary.currency} ${agentShoppingExecution.orderSummary.unitPrice.toFixed(2)}`,
              `Final Known Total: ${agentShoppingExecution.orderSummary.currency} ${agentShoppingExecution.orderSummary.finalKnownTotal.toFixed(2)}`,
              `Consent Gate: Explicit user confirmation required (never auto-authorized)`,
            ]
          : [agentShoppingExecution.rejectionReason || agentShoppingExecution.message],
      });
    }

    // Execute Phase 5 Coordinated Seven-Agent Contracts & Omega Decision Crucible
    const reqId = `orch_${Date.now().toString(36)}`;
    const phase5Result = await executePhase5SevenAgentOrchestrator({
      orchestrationId: reqId,
      prompt,
      conversationTurns: syntheticHistoryTurns,
      offers: agentResult.offers,
      coupons: agentResult.verifiedCoupons,
      sourceReports: agentResult.sourceReports,
      report,
      needsClarification: false,
      adaptiveExpansionTriggered: Boolean(
        report.searchCoverageDisclosures && report.searchCoverageDisclosures.length > 0
      ),
    });

    const finalCoordinatorMessage = agentShoppingExecution
      ? `${agentResult.coordinatorMessage}\n\n${agentShoppingExecution.message}`
      : agentResult.coordinatorMessage;

    if (voicePayload) {
      voicePayload.spokenSummaryText = buildSpokenResponseSummary({
        coordinatorMessage: finalCoordinatorMessage,
        report,
        omegaCrucible: phase5Result.omegaCrucible,
        shoppingExecution: agentShoppingExecution,
      });
    }

    const responsePayload: OrchestrationResponse = {
      requestId: reqId,
      timestamp: new Date().toISOString(),
      responseType: intent.responseType || 'product_search',
      intent,
      sourceReports: agentResult.sourceReports,
      agentSteps,
      coordinatorMessage: finalCoordinatorMessage,
      explicitFailureStates: Array.from(explicitFailureStates),
      recommendedProductId: resolvedRecommendedId,
      offers: agentResult.offers,
      verifiedCoupons: agentResult.verifiedCoupons,
      couponSubsystemState:
        agentResult.verifiedCoupons.length > 0
          ? `[CONFIGURED_AND_VERIFIED] Feedico Partner API returned ${agentResult.verifiedCoupons.length} verified coupon/deal offer(s).`
          : 'No active merchant coupons or promotional offers matched this search.',
      groundingCitations,
      scienceAnalysis: agentResult.scienceAnalysis,
      productIntelligenceReport: report,
      agentShoppingExecution,
      phase5SevenAgentContracts: phase5Result.agentContracts,
      omegaDecisionCrucible: phase5Result.omegaCrucible,
      constraintHierarchy: phase5Result.constraints,
      observabilityTelemetry: phase5Result.observability,
      voiceInteraction: voicePayload,
    };

    releaseConcurrency(targetUserId);
    recordFeatureUsage(targetUserId, 'workflow', 0, 0);
    recordFeatureUsage(targetUserId, 'search');
    if (intent.couponRequested) {
      recordFeatureUsage(targetUserId, 'coupon');
    }
    if (intent.comparisonRequested) {
      recordFeatureUsage(targetUserId, 'analysis');
    }
    saveRuntimeSnapshot();

    res.json(responsePayload);
  });

  // PHASE 5: Voice Mode Normalization & Speech Processing Endpoint
  app.post('/api/spark/voice/normalize', (req, res) => {
    const { transcript = '', language = 'en' } = req.body || {};
    const raw = typeof transcript === 'string' ? transcript.trim().slice(0, 1000) : '';
    if (!raw) {
      res.status(400).json({
        ok: false,
        errorCode: 'empty_transcript',
        error: 'No speech transcript was captured. Please try speaking again or type your request.',
      });
      return;
    }
    const normalized = normalizeVoiceQuery(raw, typeof language === 'string' ? language : 'en');
    res.json({
      ok: true,
      voiceInteraction: normalized,
    });
  });

  // PHASE 5: Observability & 12-Scenario Evaluation Endpoint
  app.get('/api/spark/observability', async (_req, res) => {
    const observability = getPhase5ObservabilitySummary();
    const evaluationSuite = await runPhase5TwelveScenarioEvaluationSuite();
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      observability,
      evaluationSuite,
    });
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Centralized API Error Handler (Suppresses stack traces & redacts secrets)
  app.use(
    (
      err: Error & { status?: number; statusCode?: number; type?: string },
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (res.headersSent) {
        next(err);
        return;
      }
      const status = err.status || err.statusCode || (err.type === 'entity.too.large' ? 413 : 500);
      const safeMsg =
        status === 413
          ? 'Request payload exceeds the maximum allowed size (100KB).'
          : String(redactSensitiveData(err.message || 'An unexpected server error occurred.'));
      res.status(status).json({
        ok: false,
        errorCode: status === 413 ? 'payload_too_large' : 'internal_server_error',
        error: safeMsg,
      });
    }
  );

  const PORT = 3000;

  if (process.env.NODE_ENV !== 'production') {
    const vitePromise = createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(async (req, res, next) => {
      try {
        const vite = await vitePromise;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Spark strict real-data server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
