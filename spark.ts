export type NavSection =
  | 'conversation'
  | 'spark2_intelligence'
  | 'voice'
  | 'discovery'
  | 'coupons'
  | 'comparison'
  | 'saved'
  | 'cart'
  | 'purchases'
  | 'analytics'
  | 'subscriptions'
  | 'paypal_sandbox'
  | 'settings';

export type PayPalConnectionStatus =
  | 'not_connected'
  | 'connecting'
  | 'connected'
  | 'expired'
  | 'revoked'
  | 'not_configured'
  | 'error';

export type PayPalTransactionStatus =
  | 'CREATED'
  | 'APPROVED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'
  | 'REFUNDED';

export interface PayPalSandboxCatalogItem {
  id: string;
  sku: string;
  name: string;
  description: string;
  merchant: string;
  category: string;
  unitPrice: number;
  shippingCost: number;
  estimatedTax: number;
  currency: 'USD' | 'EUR' | 'GBP';
  isSparkManagedSandboxItem: boolean;
}

export interface PayPalStateTransition {
  from: PayPalTransactionStatus | 'INITIAL';
  to: PayPalTransactionStatus;
  timestamp: string;
  reason: string;
  actor: 'system' | 'buyer' | 'webhook' | 'developer';
}

export interface PurchaseOrderItem {
  itemId: string;
  productId: string;
  offerId: string;
  productName: string;
  merchant: string;
  productUrl: string;
  imageUrl?: string | null;
  sourceId: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  currency: 'USD' | 'EUR' | 'GBP';
  shippingCost: number | null;
  shippingStatus: 'verified' | 'estimated' | 'unknown' | 'free' | 'not_applicable_digital';
  taxAmount: number | null;
  taxStatus: 'verified' | 'estimated' | 'unknown';
  specs?: Record<string, string>;
  sku?: string | null;
  variantId?: string | null;
  variantLabel?: string | null;
  selectedOptions?: Record<string, string>;
}

export interface CartItem {
  itemId: string;
  userId: string;
  productId: string;
  offerId: string;
  sku?: string | null;
  variantId?: string | null;
  variantLabel?: string | null;
  selectedOptions?: Record<string, string>;
  availableVariants?: string[];
  productName: string;
  merchant: string;
  merchantId?: string;
  category?: string;
  productUrl: string;
  imageUrl: string | null;
  sourceId: string;
  productSourceReference?: string;
  quantity: number;
  unitPrice: number;
  lastVerifiedPrice?: number | null;
  previousPrice?: number | null;
  priceChanged?: boolean;
  priceChangeAccepted?: boolean;
  priceVerifiedAt?: string;
  priceStatus?: 'verified' | 'price_could_not_be_verified';
  subtotal: number;
  currency: 'USD' | 'EUR' | 'GBP';
  shippingCost: number | null;
  shippingStatus: 'verified' | 'estimated' | 'unknown' | 'free' | 'not_applicable_digital';
  estimatedTaxRate: number | null;
  taxAmount: number | null;
  taxStatus: 'verified' | 'estimated' | 'unknown';
  additionalFee?: number | null;
  availability: 'in_stock' | 'out_of_stock' | 'unknown';
  specs: Record<string, string>;
  addedAt: string;
  updatedAt: string;
}

export interface UserCartSummary {
  cartId?: string;
  userId: string;
  items: CartItem[];
  itemCount: number;
  totalItemCount: number;
  uniqueProductCount: number;
  currency: 'USD' | 'EUR' | 'GBP';
  hasMixedCurrencies?: boolean;
  subtotal: number;
  appliedCouponCode?: string | null;
  appliedCoupon?: CouponItem | null;
  verifiedDiscountTotal?: number;
  estimatedDiscountTotal?: number;
  couponStatus?:
    | 'none'
    | 'applied_verified'
    | 'invalid'
    | 'expired'
    | 'ineligible'
    | 'min_spend_not_met'
    | 'currency_mismatch';
  couponMessage?: string | null;
  shippingCost: number | null;
  shippingStatus: 'verified' | 'estimated' | 'unknown' | 'free' | 'not_applicable_digital';
  knownShippingTotal: number;
  hasUnknownShipping: boolean;
  shippingStatusSummary: 'verified' | 'estimated' | 'unknown' | 'free' | 'not_applicable_digital';
  taxAmount: number | null;
  taxStatus: 'verified' | 'estimated' | 'unknown';
  knownTaxTotal: number;
  hasUnknownTax: boolean;
  taxStatusSummary: 'verified' | 'estimated' | 'unknown';
  additionalFeesTotal?: number;
  total: number;
  estimatedTotal: number;
  finalPayableTotal?: number | null;
  isCompleteVerifiedTotal?: boolean;
  canProceedToCheckout?: boolean;
  checkoutBlockers?: string[];
  requiresPriceChangeReview?: boolean;
  unavailableItemCount?: number;
  unverifiedItemCount?: number;
  createdAt?: string;
  updatedAt: string;
  lastValidatedAt?: string | null;
  revision?: number;
  lastRemovedItem?: CartItem | null;
}

export interface CartItemValidationFinding {
  itemId: string;
  productId: string;
  productName: string;
  variantLabel: string | null;
  merchant: string;
  validationSource: 'channel3_api' | 'spark_live_offer_registry' | 'spark_sandbox_catalog' | 'unverified';
  verified: boolean;
  previousPrice: number | null;
  currentPrice: number | null;
  priceChanged: boolean;
  priceChangeAccepted: boolean;
  availability: 'in_stock' | 'out_of_stock' | 'unknown';
  statusMessage: string;
}

export interface CartValidationReport {
  validatedAt: string;
  providerStatus: 'channel3_verified' | 'session_registry_verified' | 'degraded_fallback';
  providerMessage: string;
  findings: CartItemValidationFinding[];
  priceChangesDetected: number;
  unavailableItemsDetected: number;
  unverifiedItemsDetected: number;
  canProceedToCheckout: boolean;
  checkoutBlockers: string[];
  cart: UserCartSummary;
}

export interface CartCheckoutPreparationResult {
  ready: boolean;
  preparedAt: string;
  userId: string;
  cartId: string;
  revision: number;
  blockers: string[];
  requiresPriceChangeConfirmation: boolean;
  validationReport: CartValidationReport;
  authoritativeBreakdown: {
    currency: 'USD' | 'EUR' | 'GBP';
    merchandiseSubtotal: number;
    verifiedDiscounts: number;
    shippingCost: number | null;
    shippingStatus: 'verified' | 'estimated' | 'unknown' | 'free' | 'not_applicable_digital';
    taxAmount: number | null;
    taxStatus: 'verified' | 'estimated' | 'unknown';
    additionalFees: number;
    finalPayableTotal: number;
    hasUnknownShippingOrTax: boolean;
  };
  cart: UserCartSummary;
}

export interface SparkCheckoutSession {
  checkoutSessionId: string;
  userId: string;
  userEmail: string;
  itemId: string;
  offerId?: string;
  productUrl?: string;
  imageUrl?: string | null;
  productName: string;
  merchant: string;
  checkoutScope: 'spark_managed_sandbox_test' | 'third_party_merchant_sandbox_simulation';
  quantity: number;
  unitPrice: number;
  subtotal: number;
  discountAmount: number;
  shippingAmount: number;
  shippingStatus?: 'verified' | 'estimated' | 'unknown' | 'free' | 'not_applicable_digital';
  taxAmount: number;
  taxStatus?: 'verified' | 'estimated' | 'unknown';
  totalAmount: number;
  currency: 'USD' | 'EUR' | 'GBP';
  items?: PurchaseOrderItem[];
  status:
    | 'OPEN'
    | 'ORDER_CREATED'
    | 'APPROVED'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'FAILED'
    | 'REFUNDED'
    | 'EXPIRED';
  sparkOrderId: string | null;
  paypalOrderId: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface SparkAuthSession {
  sessionId: string;
  csrfToken: string;
  userId: string;
  email: string;
  displayName: string;
  authProvider: 'firebase_google' | 'spark_credentials';
  emailVerified: boolean;
  issuedAt: string;
  expiresAt: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

/**
 * Authoritative row schema for the `paypal_connections` database table.
 * Refresh/access tokens are encrypted at rest with AES-256-GCM on the server
 * and never returned to frontend clients.
 */
export interface PayPalConnectionsTableRow {
  id: string;
  spark_user_id: string;
  paypal_payer_id: string;
  paypal_email: string | null;
  paypal_name: string | null;
  email_verified: boolean;
  connection_status: 'connected' | 'disconnected' | 'expired' | 'revoked' | 'failed';
  granted_scopes: string[];
  connected_at: string;
  updated_at: string;
  environment: 'live' | 'sandbox';
  address?: {
    street_address?: string;
    locality?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  } | null;
  vault_id?: string | null;
  vaulted_at?: string | null;
  encrypted_refresh_token?: string | null;
}

export interface PayPalAccountConnection {
  connectionId: string;
  userId: string;
  provider: 'paypal';
  status: 'connected' | 'disconnected' | 'expired' | 'revoked';
  paypalSubjectId: string;
  payerId: string | null;
  email: string | null;
  maskedEmail: string | null;
  emailVerified: boolean;
  displayName: string | null;
  paypalName?: string | null;
  verifiedAccount: boolean;
  scopesGranted: string[];
  environment: 'sandbox' | 'live';
  connectedAt: string;
  updatedAt: string;
  disconnectedAt?: string | null;
  address?: {
    street_address?: string;
    locality?: string;
    region?: string;
    postal_code?: string;
    country?: string;
  } | null;
  vaultId?: string | null;
  vaultedAt?: string | null;
}

export interface PayPalOAuthStateRecord {
  state: string;
  nonce: string;
  userId: string;
  sessionId: string;
  redirectUri: string;
  scopes: string[];
  issuedAt: string;
  expiresAt: string;
  issuedAtMs: number;
  expiresAtMs: number;
  consumed: boolean;
  consumedAt?: string | null;
}

export interface PayPalSecurityAuditRecord {
  id: string;
  timestamp: string;
  userId: string | null;
  actor: 'buyer' | 'system' | 'webhook' | 'developer' | 'unauthenticated';
  action:
    | 'SESSION_ISSUED'
    | 'SESSION_EXPIRED'
    | 'UNAUTHENTICATED_REJECTED'
    | 'CSRF_REJECTED'
    | 'IDENTITY_SPOOF_REJECTED'
    | 'PAYPAL_LINK_INITIATED'
    | 'PAYPAL_LINK_COMPLETED'
    | 'PAYPAL_LINK_CANCELLED'
    | 'PAYPAL_LINK_FAILED'
    | 'PAYPAL_LINK_DUPLICATE_BLOCKED'
    | 'PAYPAL_DISCONNECTED'
    | 'CHECKOUT_SESSION_CREATED'
    | 'ORDER_CREATED'
    | 'ORDER_APPROVED'
    | 'ORDER_CAPTURED'
    | 'ORDER_CANCELLED'
    | 'CROSS_USER_ACCESS_BLOCKED'
    | 'TAMPERED_AMOUNT_BLOCKED'
    | 'DUPLICATE_CAPTURE_BLOCKED'
    | 'WEBHOOK_VERIFIED'
    | 'WEBHOOK_REJECTED';
  sparkOrderId: string | null;
  paypalOrderId: string | null;
  checkoutSessionId: string | null;
  outcome: 'ALLOWED' | 'DENIED';
  detail: string;
}

export type SandboxOrderLifecycleStatus =
  | 'CREATED'
  | 'APPROVAL_PENDING'
  | 'DRAFT'
  | 'AWAITING_USER_CONFIRMATION'
  | 'AWAITING_PAYPAL_APPROVAL'
  | 'APPROVED'
  | 'CAPTURE_PENDING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'
  | 'EXPIRED'
  | 'REVIEW_REQUIRED'
  | 'REFUNDED';

export type PurchaseExecutionMode = 'SANDBOX_SIMULATION' | 'MERCHANT_CHECKOUT';

export interface SandboxPaymentOrderRow {
  id: string;
  user_id: string;
  product_id: string;
  product_name?: string;
  merchant_id: string;
  paypal_order_id: string | null;
  quantity?: number;
  amount: number;
  currency: 'USD' | 'EUR' | 'GBP';
  status: SandboxOrderLifecycleStatus;
  execution_mode: PurchaseExecutionMode;
  authorization_hash: string | null;
  created_at: string;
  expires_at: string;
  completed_at: string | null;
}

export interface SandboxPaymentCaptureRow {
  id: string;
  order_id: string;
  paypal_capture_id: string;
  amount: number;
  currency: 'USD' | 'EUR' | 'GBP';
  capture_status: 'COMPLETED' | 'PENDING' | 'DECLINED' | 'REFUNDED' | 'FAILED';
  created_at: string;
}

export interface SandboxPaymentEventRow {
  id: string;
  paypal_event_id: string;
  order_id: string | null;
  event_type: string;
  signature_verified: boolean;
  processed_at: string;
}

export interface PurchaseAuditLogRow {
  id: string;
  user_id: string | null;
  order_id: string | null;
  action: string;
  result: 'ALLOWED' | 'DENIED' | 'COMPLETED' | 'FAILED';
  timestamp: string;
  detail?: string;
}

export interface UserPurchaseAuthorizationRecord {
  authorizationId: string;
  authorizationHash: string;
  orderId: string;
  userId: string;
  productId: string;
  merchantId: string;
  amount: number;
  currency: 'USD' | 'EUR' | 'GBP';
  executionMode: PurchaseExecutionMode;
  issuedAt: string;
  expiresAt: string;
  expiresAtMs: number;
  consumed: boolean;
  consumedAt: string | null;
  invalidated: boolean;
  invalidationReason: string | null;
}

export interface SandboxBuyerLedgerEntry {
  id: string;
  orderId: string;
  paypalOrderId: string;
  captureId: string;
  type: 'DEBIT_CAPTURE' | 'CREDIT_REFUND';
  amount: number;
  currency: 'USD' | 'EUR' | 'GBP';
  balanceBefore: number;
  balanceAfter: number;
  merchantName: string;
  productName: string;
  timestamp: string;
}

export interface SandboxBuyerWalletState {
  userId: string;
  buyerAccountId: string;
  buyerEmail: string;
  merchantAccountId: string;
  environment: 'SANDBOX';
  currency: 'USD' | 'EUR' | 'GBP';
  initialBalance: number;
  availableBalance: number;
  totalDeducted: number;
  totalRefunded: number;
  lastUpdatedAt: string;
  ledgerEntries: SandboxBuyerLedgerEntry[];
}

export interface SandboxIntegrationTestScenarioResult {
  scenarioNumber: number;
  scenarioKey: string;
  title: string;
  expectedOutcome: string;
  actualOutcome: string;
  passed: boolean;
  statusCode: number;
  errorCode?: string;
  orderStatus?: string;
  durationMs: number;
}

export interface PayPalSandboxTransaction {
  sparkOrderId: string;
  paypalOrderId: string;
  invoiceId: string;
  captureId: string | null;
  userId: string;
  userEmail: string;
  checkoutSessionId: string;
  productId: string;
  offerId?: string;
  productUrl?: string;
  imageUrl?: string | null;
  productName: string;
  merchant: string;
  checkoutScope: 'spark_managed_sandbox_test' | 'third_party_merchant_sandbox_simulation';
  executionMode?: PurchaseExecutionMode;
  lifecycleStatus?: SandboxOrderLifecycleStatus;
  authorizationHash?: string | null;
  buyerBalanceBefore?: number | null;
  buyerBalanceAfter?: number | null;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  discountAmount: number;
  shippingAmount: number;
  shippingStatus?: 'verified' | 'estimated' | 'unknown' | 'free' | 'not_applicable_digital';
  taxAmount: number;
  taxStatus?: 'verified' | 'estimated' | 'unknown';
  amount: number;
  currency: 'USD' | 'EUR' | 'GBP';
  items?: PurchaseOrderItem[];
  isSandboxOrder?: boolean;
  orderTypeLabel?: 'SANDBOX ORDER';
  paymentStatus?: 'COMPLETED' | 'APPROVED' | 'PENDING' | 'FAILED' | 'CANCELLED' | 'REFUNDED';
  merchantOrderStatus?: string;
  status: PayPalTransactionStatus;
  approvalUrl: string | null;
  payerEmail: string | null;
  payerId: string | null;
  webhookVerified: boolean;
  webhookEventsReceived: string[];
  errorSummary: {
    code: string;
    issue?: string;
    message: string;
    debugId?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  stateHistory: PayPalStateTransition[];
}

export interface PayPalWebhookEventRecord {
  id: string;
  eventType: string;
  resourceId: string;
  userId: string | null;
  sparkOrderId: string | null;
  paypalOrderId: string | null;
  verificationStatus: 'SUCCESS' | 'FAILURE';
  processedAt: string;
  duplicate: boolean;
  summary: string;
}

export interface PayPalDiagnosticLog {
  id: string;
  timestamp: string;
  correlationId: string;
  event?:
    | 'PAYMENT_TOOL_STARTED'
    | 'BACKEND_REQUEST_RECEIVED'
    | 'PAYPAL_OAUTH_STARTED'
    | 'PAYPAL_OAUTH_SUCCEEDED'
    | 'PAYPAL_CREATE_ORDER_STARTED'
    | 'PAYPAL_CREATE_ORDER_SUCCEEDED'
    | 'APPROVAL_URL_GENERATED'
    | 'PAYMENT_INITIALIZATION_FAILED';
  operation:
    | 'config_check'
    | 'payment_tool'
    | 'backend_request'
    | 'oauth_token'
    | 'identity_link'
    | 'identity_disconnect'
    | 'create_order'
    | 'approval_url'
    | 'inspect_order'
    | 'capture_order'
    | 'cancel_order'
    | 'webhook_verify'
    | 'security_audit'
    | 'diagnostic_suite';
  level: 'info' | 'warn' | 'error';
  httpStatus?: number;
  durationMs?: number;
  errorCode?: string;
  paypalDebugId?: string;
  message: string;
}

export interface PayPalSandboxStatusResponse {
  environment: string;
  isSandboxAllowed: boolean;
  baseUrl: string;
  connectionStatus: 'Connected' | 'Not Connected' | 'Configuration Error';
  credentialsConfigured: {
    paypalEnv: boolean;
    clientId: boolean;
    clientSecret: boolean;
    webhookId: boolean;
    clientIdPreview: string | null;
  };
  oauthValidated: boolean;
  tokenCached: boolean;
  tokenExpiresAt: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
  webhookEndpointPath: string;
  supportedWebhookEvents: string[];
  sandboxCatalog: PayPalSandboxCatalogItem[];
}

export type ThemeMode = 'dark' | 'light' | 'system';
export type AccentColor = 'violet' | 'blue' | 'cyan' | 'emerald';
export type SupportedLanguage = 'en' | 'es' | 'fr' | 'de' | 'ja';

export interface UserPreferences {
  displayName: string;
  preferredName: string; // "What would you like Spark to call you?"
  avatarUrl: string;
  theme: ThemeMode;
  accentColor: AccentColor;
  language: SupportedLanguage;
  soundEnabled: boolean;
  autoApplyCoupons: boolean;
  defaultCurrency: 'USD' | 'EUR' | 'GBP';
  interestTagsConsent?: boolean;
  interestTags?: string[];
}

export interface UserProfile {
  id: string;
  email: string;
  createdAt: string;
  preferences: UserPreferences;
  paypal: {
    status: PayPalConnectionStatus;
    sandboxEmail?: string;
    maskedEmail?: string;
    paypalName?: string;
    paypalSubjectId?: string;
    payerId?: string;
    emailVerified?: boolean;
    verifiedAccount?: boolean;
    scopesGranted?: string[];
    environment?: 'live' | 'sandbox';
    connectedAt?: string;
    updatedAt?: string;
    vaultId?: string | null;
    vaultedAt?: string | null;
    errorMessage?: string;
    errorCode?: string;
  };
}

export type UserAccount = UserProfile;

export type ExplicitVerificationState =
  | 'Source not configured.'
  | 'Live search failed.'
  | 'No verified results found.'
  | 'Price could not be verified.'
  | 'Availability unknown.'
  | 'Coupon validity unknown.'
  | 'Checkout unsupported.';

export interface SourceExecutionReport {
  sourceId: string;
  sourceName: string;
  configured: boolean;
  queried: boolean;
  status:
    | 'verified_ok'
    | 'no_results'
    | 'source_not_configured'
    | 'live_search_failed';
  explicitStateMessage: string;
  resultCount: number;
  retrievedAt: string;
}

export type FeedicoOfferClassification =
  | 'verified_active'
  | 'no_code_deal'
  | 'unverified'
  | 'expired';

export interface FeedicoCommissionInfo {
  model: 'percent' | 'fixed' | 'mixed' | 'unknown';
  currency?: string | null;
  rate?: { min: number; max: number } | null;
  partnerRate?: { min: number; max: number } | null;
  fixed?: { min: number; max: number } | null;
  partnerFixed?: { min: number; max: number } | null;
  averageRate?: number | null;
  partnerShare?: number | null;
  cookieDays?: number | null;
  approvalRate?: number | null;
  validationDays?: number | null;
  paymentDays?: number | null;
  epc?: number | null;
  policies?: {
    cashback?: 'allowed' | 'limited' | 'forbidden' | null;
    couponSites?: 'allowed' | 'limited' | 'forbidden' | null;
    browserExtensions?: 'allowed' | 'limited' | 'forbidden' | null;
    standDown?: boolean | null;
  } | null;
  updatedAt?: string | null;
}

export interface FeedicoNormalizedOffer {
  feedico_offer_id: string;
  merchant_id: string;
  merchant_name: string;
  coupon_code: string | null;
  title: string;
  description: string;
  discount: {
    type: 'percentage' | 'fixed' | 'promotional_deal';
    value: number;
    currency: 'USD' | 'EUR' | 'GBP';
    label: string;
  };
  start_date: string | null;
  expiration_date: string | null;
  target_countries: string[];
  eligibility_conditions: string[];
  original_source: string;
  provider: string;
  website_url: string | null;
  tracked_url: string;
  cashback_allowed?: 'yes' | 'limited' | 'no' | 'unknown';
  commission?: FeedicoCommissionInfo | null;
  last_synced_at: string;
  verification_status: FeedicoOfferClassification;
  is_stale?: boolean;
  relevance_score?: number;
  match_reason?: string;
}

export interface FeedicoMerchantRecord {
  merchant_id: string;
  go_slug: string;
  name: string;
  provider: string;
  website_url: string | null;
  domain: string | null;
  coupon_count: number;
  tracked_url: string;
  cashback_allowed: 'yes' | 'limited' | 'no' | 'unknown';
  commission: FeedicoCommissionInfo | null;
  last_synced_at: string;
}

export interface FeedicoAffiliateClickRecord {
  click_id: string;
  user_id: string;
  sub_id: string;
  feedico_offer_id: string | null;
  merchant_id: string;
  merchant_name: string;
  coupon_code: string | null;
  product_id: string | null;
  product_name: string | null;
  tracked_url: string;
  target_country: string | null;
  clicked_at: string;
  outcome_status: 'CLICK_RECORDED_NOT_PURCHASE' | 'COMMISSION_PENDING' | 'COMMISSION_APPROVED' | 'COMMISSION_DECLINED' | 'COMMISSION_PAID';
  disclosure_shown: boolean;
}

export type FeedicoIntegrationState =
  | 'CONFIGURED_AND_VERIFIED'
  | 'CONFIGURED_BUT_UNVERIFIED'
  | 'MISSING_CONFIGURATION'
  | 'INVALID_CREDENTIALS'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE';

export interface FeedicoStatusResponse {
  enabled: boolean;
  configured: boolean;
  tokenFormatValid: boolean;
  integrationState: FeedicoIntegrationState;
  apiType: 'feedico_partner_api';
  baseUrl: string;
  cacheTtlSeconds: number;
  partnerPublicId: string | null;
  statusMessage: string;
  accountApprovalRequired: boolean;
  cachedOffersCount: number;
  cachedMerchantsCount: number;
  staleOffersCount: number;
  recordedClicksCount: number;
  lastSyncAt: string | null;
  lastVerifiedAt?: string | null;
  lastError: string | null;
  lastErrorCode?: string | null;
}

export interface CouponItem {
  id: string;
  code: string;
  merchant: string;
  sourceId: string;
  sourceUrl: string;
  retrievedAt: string;
  description: string;
  discountType: 'percentage' | 'fixed' | 'promotional_deal';
  discountValue: number;
  minSpend: number;
  currency: 'USD' | 'EUR' | 'GBP';
  verificationStatus: 'verified' | 'coupon_validity_unknown';
  terms: string;
  // Feedico Partner API Extended Fields
  feedicoOfferId?: string;
  merchantId?: string;
  merchantName?: string;
  title?: string;
  offerClassification?: FeedicoOfferClassification;
  startDate?: string | null;
  expirationDate?: string | null;
  targetCountries?: string[];
  eligibilityConditions?: string[];
  originalSource?: string;
  provider?: string;
  websiteUrl?: string | null;
  trackedUrl?: string;
  lastSyncedAt?: string;
  isStale?: boolean;
  cashbackAllowed?: 'yes' | 'limited' | 'no' | 'unknown';
}

export interface ScienceCompoundMetadata {
  compoundName: string;
  sourceId: 'pubchem_ncbi_api';
  retrievedAt: string;
  cid?: number;
  molecularFormula?: string;
  molecularWeight?: string;
  canonicalSmiles?: string;
  inChIKey?: string;
  xLogP?: number;
  tpsa?: number;
  hBondDonorCount?: number;
  hBondAcceptorCount?: number;
  rotatableBondCount?: number;
  lipinskiPass?: boolean;
  lipinskiViolations?: number;
  structureImageUrl?: string;
  fdaStatus?: string;
  fdaIndications?: string;
  provenanceUrl?: string;
  verificationState?: string;
}

export interface ProductOffer {
  id: string;
  offerId?: string;
  sourceId: string;
  sourceName: string;
  canonicalUrl: string;
  retrievedAt: string;
  verificationStatus: 'verified_live_source' | 'partial_fields_unverified';
  name: string;
  merchant: string;
  category: string;
  price: number | null;
  priceStatus: 'verified' | 'price_could_not_be_verified';
  currency: 'USD' | 'EUR' | 'GBP';
  shippingCost: number | null;
  shippingStatus: 'verified' | 'not_applicable_digital' | 'unknown';
  estimatedTaxRate: number | null;
  taxStatus: 'verified' | 'unknown';
  availabilityStatus: 'verified_in_stock' | 'verified_out_of_stock' | 'unknown';
  availability?: 'in_stock' | 'out_of_stock' | 'unknown';
  rating: number | null;
  reviewCount: number | null;
  summary: string;
  specs: Record<string, string>;
  couponStatus: 'verified' | 'coupon_validity_unknown' | 'no_verified_coupon';
  checkoutStatus: 'supported_paypal' | 'checkout_unsupported';
  imageUrl: string | null;
  galleryImages?: string[];
  brand?: string;
  activeCompound?: string;
}

export type RecommendationTierBadge =
  | 'Best Overall'
  | 'Best Value'
  | 'Best Budget'
  | 'Best Premium'
  | 'Best Alternative';

export type TraceableEvidenceSourceType =
  | 'official_manufacturer_spec'
  | 'channel3_catalog_record'
  | 'merchant_offer'
  | 'independent_expert_review'
  | 'customer_ratings'
  | 'estimated_or_unavailable';

export interface TraceableFactAttribution {
  field: string;
  label: string;
  value: string;
  sourceType: TraceableEvidenceSourceType;
  sourceName: string;
  verified: boolean;
}

export interface MerchantOfferRecord {
  offerId: string;
  merchantName: string;
  variantConfiguration: string;
  listedPrice: number | null;
  currency: string;
  shippingCost: number | null;
  shippingStatus: string;
  verifiedDiscountAmount: number;
  couponCode: string | null;
  taxAmount: number | null;
  taxStatus: string;
  confirmedFinalTotal: number | null;
  estimatedTotalWithUnconfirmedComponents: number | null;
  missingCostComponents: string[];
  availabilityStatus: string;
  offerUrl: string;
  checkoutSupported: boolean;
}

export interface CandidateEligibilityReport {
  eligible: boolean;
  rejectionReasons: string[];
  categoryRelevancePassed: boolean;
  generationRelevancePassed: boolean;
  releaseYearEstimate: number | null;
  supportAndAvailabilityPassed: boolean;
  minimumQualityFloorPassed: boolean;
  conditionVerified: 'new' | 'refurbished' | 'used' | 'digital' | 'unspecified';
  exactConfigurationLabel: string;
}

export interface NineDimensionEvaluationScores {
  technicalPerformance: number;
  buildQualityAndDurability: number;
  featuresAndSpecifications: number;
  realWorldUsability: number;
  reliabilityAndLongevity: number;
  priceToPerformance: number;
  strengthsWeaknessesBalance: number;
  suitabilityForUserNeeds: number;
  competitiveStanding: number;
}

export interface QualityAdjustedScoreBreakdown {
  relevanceToRequest: number; // Base weight 25%
  technicalQualityAndPerformance: number; // Base weight 20%
  reliabilityAndReviewEvidence: number; // Base weight 15%
  priceToPerformanceValue: number; // Base weight 20%
  generationAndSupportLongevity: number; // Base weight 10%
  merchantAndOfferReliability: number; // Base weight 10%
  weightsApplied: {
    relevance: number;
    technical: number;
    reliability: number;
    value: number;
    longevity: number;
    merchant: number;
  };
  totalQualityAdjustedScore: number;
  scoreOutOf10?: number;
  evidenceConfidence?: 'HIGH' | 'MODERATE' | 'LIMITED_EVIDENCE';
  scoreCriteriaExplanation?: string;
  nineDimensions?: NineDimensionEvaluationScores;
  minimumQualityThreshold: number;
  passedQualityFloor: boolean;
}

export interface RichProductIntelligenceProfile {
  identity: {
    officialProductName: string;
    brand: string;
    exactModelNumber: string;
    category: string;
    generation: string;
    releaseYear: string;
    regionalVersion: string;
    variantConfiguration: string;
    condition: string;
    officialManufacturerUrl: string | null;
    mainImageUrl: string | null;
  };
  technicalSpecsByCategory: Record<string, string>;
  purchasingInsights: {
    whatMakesItGood: string;
    strongestFeatures: string[];
    practicalAdvantages: string[];
    importantLimitations: string[];
    competitiveAdvantages: string[];
    competitiveWeaknesses: string[];
    whoShouldBuyIt: string;
    whoShouldAvoidIt: string;
    suitableAlternatives: string[];
  };
  reviewIntelligence: {
    actualRating: number | null;
    ratingCount: number | null;
    reviewSource: string;
    reviewCredibilityAssessment: string;
    sampleSizeSufficient: boolean;
    expertReviewSummary: string;
    commonPros: string[];
    commonCons: string[];
    reviewRecency: string;
  };
  pricingIntelligence: {
    primaryMerchant: string;
    exactVariant: string;
    listedPrice: number | null;
    currency: string;
    shipping: string;
    verifiedCoupon: string | null;
    taxes: string;
    confirmedTotal: number | null;
    missingCostComponents: string[];
    cheapestClaimAllowed: boolean;
    priceIntegrityNote: string;
  };
  merchantOffers: MerchantOfferRecord[];
  traceableEvidence: TraceableFactAttribution[];
}

export interface RankedProductOffer extends ProductOffer {
  bestCoupon: CouponItem | null;
  couponDiscountAmount: number;
  netItemPrice: number | null;
  withinBudget: boolean;
  completenessScore: number;
  recommendationTier?: RecommendationTierBadge | null;
  eligibilityReport?: CandidateEligibilityReport;
  qualityAdjustedScore?: QualityAdjustedScoreBreakdown;
  richProfile?: RichProductIntelligenceProfile;
  richIntelligence?: RichProductIntelligenceProfile;
  merchantOffers?: MerchantOfferRecord[];
  merchantOffersCount?: number;
}

export interface GroundingCitation {
  type: 'web' | 'maps';
  title: string;
  uri: string;
  retrievedAt: string;
  snippet?: string;
}

export interface AgentStepReport {
  agentId: 'intent' | 'discovery' | 'comparison' | 'coupon' | 'coordinator' | 'science';
  agentName: string;
  modelUsed: string;
  status: 'completed' | 'source_not_configured' | 'live_search_failed' | 'no_verified_results';
  durationMs: number;
  summary: string;
  details: string[];
}

export type ConversationResponseType =
  | 'general_question'
  | 'missing_information'
  | 'product_search'
  | 'product_comparison'
  | 'coupon_search'
  | 'alternative_products';

export interface ExtractedShoppingIntent {
  rawQuery: string;
  actionType: 'discover' | 'coupons' | 'compare' | 'offers' | 'alternatives' | 'science';
  responseType?: ConversationResponseType;
  category: string | null;
  maxBudget: number | null;
  currency: 'USD' | 'EUR' | 'GBP';
  keywords: string[];
  preferredFeatures: string[];
  couponRequested: boolean;
  comparisonRequested: boolean;
  shippingIncludedRequested?: boolean;
  compareTopCount?: number | null;
  localStoreRequested: boolean;
  scienceCompound: string | null;
}

export interface ClarificationRequirement {
  question: string;
  whyItMatters: string;
  missingRequirement: 'intended_use' | 'budget' | 'specifications' | 'preferences';
  options?: string[];
}

export interface OrchestrationResponse {
  requestId: string;
  timestamp: string;
  responseType?: ConversationResponseType;
  clarificationSuggestions?: string[];
  followUpClarification?: ClarificationRequirement;
  intent: ExtractedShoppingIntent;
  sourceReports: SourceExecutionReport[];
  agentSteps: AgentStepReport[];
  coordinatorMessage: string;
  explicitFailureStates: ExplicitVerificationState[];
  recommendedProductId: string | null;
  offers: RankedProductOffer[];
  verifiedCoupons: CouponItem[];
  couponSubsystemState: string;
  groundingCitations: GroundingCitation[];
  scienceAnalysis?: ScienceCompoundMetadata | null;
  autonomousAgent?: AutonomousOrchestrationMetadata;
  spark2Intelligence?: Spark2IntelligenceReport;
  opalSevenAgentReport?: OpalSevenAgentSystemReport;
  productIntelligenceReport?: ProductIntelligenceReport;
}

export interface ProductIntelligenceReport {
  reportId: string;
  generatedAt: string;
  query: string;
  category: string;
  recommendationScope?: 'user_specified_intent' | 'general_market_recommendation';
  purchasingMarket?: string;
  isMarketExplicitlySpecified?: boolean;
  uniqueProductsDiscovered?: number;
  totalMerchantOffersEvaluated?: number;
  searchCoverageDisclosures?: string[];
  executiveSummary: string;
  conciseCustomerSummary?: string;
  conciseWordCount?: number;
  evaluationCriteria: Array<{
    name: string;
    weight: number;
    description: string;
  }>;
  rankedProducts: Array<{
    rank: number;
    productId: string;
    name: string;
    brand: string;
    merchant: string;
    price: number | null;
    currency: string;
    productUrl: string;
    imageUrl: string | null;
    galleryImages?: string[];
    rating: number | null;
    reviewCount: number | null;
    score: number;
    specifications: Record<string, string>;
    pros: string[];
    cons: string[];
    verdict: string;
    sourceId: string;
    evidenceCompletenessPercent: number;
    technicalAnalysis?: string;
    commercialAnalysis?: string;
    realWorldUseCase?: string;
    priceToPerformance?: string;
    risksAndLimitations?: string[];
    suitabilityExplanation?: string;
    rankingExplanationVsNext?: string;
    merchantOffers?: MerchantOfferRecord[];
    merchantOffersCount?: number;
    lowestVerifiedOffer?: {
      merchant: string;
      price: number;
      currency: string;
      url: string;
      availabilityStatus: string;
    } | null;
    priceBreakdown?: {
      lowestListedPrice: number | null;
      lowestListedMerchant: string;
      lowestInStockPrice: number | null;
      lowestInStockMerchant: string | null;
      currency: string;
      shippingCost: number | null;
      shippingStatusLabel: string;
      taxAmount: number | null;
      taxStatusLabel: string;
      estimatedCheckoutTotal: number | null;
      isLandedTotalConfirmed: boolean;
      checkoutTotalLabel: string;
    };
    criterionScores?: Array<{
      criterion: string;
      weight: number;
      score: number;
      evidenceNote: string;
    }>;
    specEvidenceSources?: Record<
      string,
      {
        value: string;
        status: 'verified_fact' | 'source_claim' | 'inference' | 'unknown';
        source: string;
        verified: boolean;
      }
    >;
    evidenceClassification?: Record<string, 'verified_fact' | 'source_claim' | 'inference' | 'unknown'>;
    conflictingEvidenceNotes?: string[];
    dimensionsBreakdown?: {
      performance: number;
      value: number;
      buildQuality: number;
      usability: number;
      reliability: number;
    };
  }>;
  comparisonMatrix: {
    headers: string[];
    rows: Array<{
      feature: string;
      values: Record<string, string>;
      winnerProductId?: string;
      winnerHighlight?: string;
    }>;
  };
  realWorldUseCaseAnalysis?: string;
  priceToPerformanceEvaluation?: string;
  finalRecommendation: {
    recommendedProductId: string;
    recommendedProductName: string;
    justification: string;
    bestFor: string;
    valueAssessment: string;
    whoShouldBuy?: string;
    whoShouldSkip?: string;
    alternativePick?: string;
  };
  sourceCitations: Array<{
    sourceId: string;
    sourceName: string;
    url?: string;
    timestamp: string;
    recordsRetrieved: number;
    status: string;
  }>;
  activeModel: string;
  researchFindings?: {
    methodology: string;
    recordsEvaluated: number;
    uniqueProductsEvaluated?: number;
    merchantOffersAggregated?: number;
    sourcesQueried: string[];
    confidenceAssessment: string;
  };
  consistencyAudit?: {
    passed: boolean;
    canonicalUniqueProducts: number;
    canonicalMerchantOffers: number;
    canonicalRankedCount: number;
    checksVerified: string[];
    correctionsApplied: string[];
  };
  visualizations?: {
    priceComparison?: Array<{
      productId: string;
      productName: string;
      price: number;
      currency: string;
      isWithinBudget: boolean;
      isWinner: boolean;
    }>;
    capabilityComparison?: Array<{
      productId: string;
      productName: string;
      performance: number;
      value: number;
      buildQuality: number;
      usability: number;
      reliability: number;
    }>;
  };
}

export type AutonomousTaskStatus =
  | 'CREATED'
  | 'PLANNING'
  | 'RESEARCHING'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'WAITING_FOR_USER'
  | 'FAILED'
  | 'CANCELLED'
  | 'RECOVERY_REQUIRED';

export type VerificationOutcomeStage =
  | 'Planned'
  | 'Attempted'
  | 'Accepted'
  | 'Completed'
  | 'Failed';

export type SpecializedAgentRole =
  | 'intent_requirements_intelligence'
  | 'global_product_discovery'
  | 'product_identity_catalog'
  | 'technical_product_research'
  | 'quality_reputation_intelligence'
  | 'pricing_value_intelligence'
  | 'independent_verification_decision'
  | 'orchestrator'
  | 'product_research'
  | 'price_intelligence'
  | 'coupon_intelligence'
  | 'product_evaluation'
  | 'shopping_execution'
  | 'security_guardian';

export type AgentLifecycleState =
  | 'initialized'
  | 'invoked'
  | 'model_responded'
  | 'task_completed'
  | 'output_consumed';

export interface AgentLifecycleTransition {
  state: AgentLifecycleState;
  timestamp: string;
  detail: string;
}

export type EvidenceClassification =
  | 'confirmed_fact'
  | 'merchant_claim'
  | 'customer_opinion'
  | 'estimate'
  | 'unverified';

export type FieldVerificationLevel = 'verified' | 'estimated' | 'unavailable';

export type ConversationalLanguageCode = 'en' | 'ar' | 'fr';

export interface GoalDecomposition {
  whatUserWants: string;
  whyItMatters: string;
  howToAchieve: string[];
  inferredDomainRequirements: Record<string, string>;
  explicitConstraints: {
    maxBudget: number | null;
    currency: 'USD' | 'EUR' | 'GBP';
    category: string | null;
    requiredSpecs: string[];
    preferredBrands: string[];
    excludedMerchants: string[];
  };
  hypotheses: string[];
}

export interface ExecutionPlanStep {
  stepNumber: number;
  phase:
    | 'understand_objective'
    | 'identify_constraints'
    | 'determine_required_information'
    | 'select_appropriate_tools'
    | 'execute_research'
    | 'evaluate_results'
    | 'verify_critical_facts'
    | 'produce_final_answer';
  title: string;
  assignedAgent: SpecializedAgentRole;
  selectedTools: string[];
  status: VerificationOutcomeStage;
  summary: string;
  durationMs: number;
}

export interface TaskOperationRecord {
  operationId: string;
  name: string;
  assignedAgent: SpecializedAgentRole;
  toolCategory: 'READ' | 'WRITE' | 'SENSITIVE';
  toolName: string;
  status: AutonomousTaskStatus;
  outcomeStage: VerificationOutcomeStage;
  dependsOn: string[];
  retryCount: number;
  maxRetries: number;
  startedAt: string;
  completedAt: string | null;
  durationMs: number;
  errorInfo: {
    code: string;
    message: string;
    recovered: boolean;
    recoveryStrategy?: string;
  } | null;
}

export interface AutonomousTaskRecord {
  taskId: string;
  userId: string;
  prompt: string;
  detectedLanguage: ConversationalLanguageCode;
  status: AutonomousTaskStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  goalDecomposition: GoalDecomposition;
  executionPlan: ExecutionPlanStep[];
  operations: TaskOperationRecord[];
  interruptedReason: string | null;
  canResume: boolean;
  loopGuardTriggered: boolean;
}

export interface InterAgentMessage {
  messageId: string;
  taskId: string;
  fromAgent: SpecializedAgentRole;
  toAgent: SpecializedAgentRole;
  intent: 'TASK_ASSIGNMENT' | 'RESEARCH_PAYLOAD' | 'SECURITY_VALIDATION' | 'CONFLICT_RESOLUTION' | 'FINAL_SYNTHESIS';
  timestamp: string;
  schemaValidated: boolean;
  summary: string;
  payloadKeys: string[];
}

export interface SpecializedAgentExecutionReport {
  agentRole: SpecializedAgentRole;
  agentTitle: string;
  modelTier: string;
  status: 'COMPLETED' | 'DEGRADED_FALLBACK' | 'BLOCKED_BY_SECURITY' | 'SKIPPED' | 'FAILED';
  outcomeStage: VerificationOutcomeStage;
  durationMs: number;
  timeoutBudgetMs: number;
  toolsInvoked: string[];
  summary: string;
  findings: string[];
  warnings: string[];
  executionId?: string;
  agentNumber?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  canonicalAgentName?: string;
  lifecycleStates?: AgentLifecycleTransition[];
  currentLifecycleState?: AgentLifecycleState;
  inputValidationStatus?: 'VALID' | 'INVALID' | 'SKIPPED';
  modelInvocationStatus?:
    | 'INVOKED_SUCCESS'
    | 'DETERMINISTIC_FALLBACK'
    | 'FAILED'
    | 'NOT_REQUIRED';
  toolExecutionResults?: Array<{
    toolName: string;
    status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
    recordCount?: number;
    summary: string;
  }>;
  executionTimestamp?: string;
  structuredInput?: Record<string, unknown>;
  structuredOutput?: Record<string, unknown>;
  validationResult?: {
    valid: boolean;
    schemaVerified: boolean;
    issues: string[];
  };
  errorDetails?: string | null;
  downstreamHandoffStatus?: 'HANDOFF_COMPLETED' | 'TERMINAL_STAGE' | 'BLOCKED_ON_ERROR';
}

export interface UnifiedProductRecord {
  productId: string;
  merchantId: string;
  title: string;
  description: string;
  images: string[];
  brand: string;
  category: string;
  specifications: Record<string, string>;
  currentPrice: number | null;
  originalPrice: number | null;
  currency: 'USD' | 'EUR' | 'GBP';
  availability: 'in_stock' | 'out_of_stock' | 'unknown';
  shippingInfo: {
    cost: number | null;
    status: FieldVerificationLevel;
    summary: string;
  };
  merchantUrl: string;
  dataSource: string;
  lastVerifiedTimestamp: string;
  fieldVerification: {
    price: FieldVerificationLevel;
    availability: FieldVerificationLevel;
    specifications: FieldVerificationLevel;
    shipping: FieldVerificationLevel;
    coupon: FieldVerificationLevel;
  };
  duplicateClusterId: string;
  isDuplicateListing: boolean;
  suspiciousDiscountFlag: boolean;
  suspiciousDiscountReason: string | null;
}

export interface AlternativeProductRecommendation {
  productId: string;
  title: string;
  merchant: string;
  price: number | null;
  currency: 'USD' | 'EUR' | 'GBP';
  savingsAmount: number | null;
  savingsPercentage: number | null;
  specSimilarityScore: number;
  valueScore: number;
  matchedSpecs: string[];
  compromises: string[];
  recommendationReason: string;
}

export interface ProductEvaluationReport {
  productId: string;
  title: string;
  merchant: string;
  technicalSpecScore: number;
  priceValueScore: number;
  reviewCredibilityScore: number;
  suspiciousReviewPatternDetected: boolean;
  suspiciousReviewReason: string | null;
  strengths: string[];
  weaknesses: string[];
  tradeOffAnalysis: string;
  scoreOutOf10?: number;
  totalQualityAdjustedScore?: number;
  evidenceConfidence?: 'HIGH' | 'MODERATE' | 'LIMITED_EVIDENCE';
  scoreCriteriaExplanation?: string;
  nineDimensions?: NineDimensionEvaluationScores;
  suitableFor?: string;
  competitiveAlternativeSummary?: string;
}

export interface EvidenceRecord {
  claimId: string;
  subjectId: string;
  field: string;
  statement: string;
  classification: EvidenceClassification;
  sourceId: string;
  sourceReliabilityScore: number;
  verifiedAt: string;
  isFresh: boolean;
  contradictionDetected: boolean;
  confidenceScore: number;
}

export interface SelfVerificationChecklist {
  taskId: string;
  verifiedAt: string;
  overallStage: VerificationOutcomeStage;
  allRequiredToolsExecuted: boolean;
  providerResponsesConfirmed: boolean;
  priceFreshnessVerified: boolean;
  couponClaimsSupportedByEvidence: boolean;
  userBudgetAndConstraintsRespected: boolean;
  noFabricatedDataDetected: boolean;
  contradictionsResolved: boolean;
  qualityScore: number;
  verificationNotes: string[];
}

export interface ShoppingCartDraftItem {
  itemId: string;
  productId: string;
  title: string;
  merchant: string;
  sourceId: string;
  quantity: number;
  unitPrice: number | null;
  currency: 'USD' | 'EUR' | 'GBP';
  appliedCouponCode: string | null;
  discountAmount: number;
  shippingCost: number | null;
  taxEstimate: number | null;
  netSubtotal: number | null;
  checkoutSupported: boolean;
  requiresExplicitUserApproval: true;
  addedAt: string;
}

export interface UserPreferenceMemory {
  userId: string;
  preferredBrands: string[];
  dislikedBrands: string[];
  budgetRangesByCategory: Record<string, { min?: number; max: number; currency: 'USD' | 'EUR' | 'GBP' }>;
  preferredMerchants: string[];
  avoidedMerchants: string[];
  preferredCurrency: 'USD' | 'EUR' | 'GBP';
  preferredLanguage: ConversationalLanguageCode;
  commonConstraints: string[];
  updatedAt: string;
  expiresAt: string;
}

export interface TaskMemoryRecord {
  taskId: string;
  userId: string;
  prompt: string;
  status: AutonomousTaskStatus;
  recommendedProductId: string | null;
  resultCount: number;
  summary: string;
  createdAt: string;
  expiresAt: string;
}

export interface ShoppingMemoryRecord {
  userId: string;
  savedProductIds: string[];
  comparedProductIds: string[];
  rejectedProductIds: string[];
  authorizedPurchaseIds: string[];
  shoppingLists: Record<
    string,
    {
      listId: string;
      name: string;
      items: ShoppingCartDraftItem[];
      createdAt: string;
      updatedAt: string;
    }
  >;
  activeCart: ShoppingCartDraftItem[];
  updatedAt: string;
  expiresAt: string;
}

export interface FeedbackAdaptationSignal {
  feedbackId: string;
  userId: string;
  productId?: string;
  merchant?: string;
  brand?: string;
  signalType:
    | 'accept_recommendation'
    | 'reject_recommendation'
    | 'price_too_high'
    | 'prefer_brand'
    | 'avoid_merchant'
    | 'helpful_coupon';
  note?: string;
  createdAt: string;
}

export interface ModelRoutingDecision {
  taskComplexity: 'LOW' | 'MEDIUM' | 'HIGH';
  selectedModel: 'gemini-3.1-flash-lite' | 'gemini-3.8-flash' | 'deterministic-reasoning-engine';
  fallbackModel: 'gemini-3.1-flash-lite' | 'deterministic-reasoning-engine';
  providerIndependentAdapter: string;
  estimatedTokenBudget: number;
  cacheHit: boolean;
  rationale: string;
}

export interface ExternalProviderCredentialEntry {
  providerId:
    | 'channel3_api'
    | 'feedico_partner_api'
    | 'google_search_grounding'
    | 'paypal_checkout_api'
    | 'openlibrary_api'
    | 'pubchem_ncbi_api';
  providerName: string;
  capabilityCategory:
    | 'physical_retail_catalog'
    | 'affiliate_coupon_sync'
    | 'gemini_grounding_and_llm'
    | 'payment_checkout'
    | 'public_bibliographic_catalog'
    | 'public_chemical_verification';
  requiresRuntimeSecret: boolean;
  envVarNames: string[];
  configured: boolean;
  explicitState: 'Configured' | 'Source not configured';
  routingBehavior: string;
  fallbackTargets: string[];
  zeroFabricationPolicy: string;
}

export interface ExternalApiCredentialsReport {
  generatedAt: string;
  allSecretProvidersConfigured: boolean;
  configuredSecretProviders: string[];
  unconfiguredSecretProviders: string[];
  activePublicLiveApis: string[];
  deterministicReasoningEngineActive: boolean;
  zeroFabricationGuaranteed: true;
  explicitDisclosureSummary: string;
  providers: ExternalProviderCredentialEntry[];
}

export interface GeminiProviderDiagnostics {
  configured: boolean;
  invoked: boolean;
  modelUsed: string;
  status: 'SUCCESS' | 'FALLBACK_UNCONFIGURED' | 'FALLBACK_ERROR' | 'SKIPPED';
  latencyMs: number;
  retryCount: number;
  userAgentHeader: string;
  errorMessage: string | null;
}

export interface AutonomousOrchestrationMetadata {
  taskId: string;
  taskStatus: AutonomousTaskStatus;
  detectedLanguage: ConversationalLanguageCode;
  goalDecomposition: GoalDecomposition;
  executionPlan: ExecutionPlanStep[];
  specializedAgents: SpecializedAgentExecutionReport[];
  interAgentMessages: InterAgentMessage[];
  unifiedProducts: UnifiedProductRecord[];
  productEvaluations: ProductEvaluationReport[];
  cheaperAlternatives: AlternativeProductRecommendation[];
  evidenceRecords: EvidenceRecord[];
  selfVerification: SelfVerificationChecklist;
  modelRouting: ModelRoutingDecision;
  externalCredentialsRouting?: ExternalApiCredentialsReport;
  geminiProviderDiagnostics?: GeminiProviderDiagnostics;
  agentExecutionSummary?: {
    totalRegisteredRoles: number;
    specialistAgentsExecuted: number;
    specialistAgentsSucceeded: number;
    specialistAgentsDegraded: number;
    specialistAgentsFailed: number;
    functionalRolesExecuted: number;
    allRequiredAgentsSucceeded: boolean;
  };
  memoryContextApplied: {
    userId: string;
    preferencesApplied: string[];
    recentTasksCount: number;
    savedProductsCount: number;
    rejectedProductsFiltered: number;
    feedbackBoostsApplied: number;
  };
  rejectedCandidates?: Array<{
    id: string;
    name: string;
    category: string;
    price: number | null;
    rejectionReasons: string[];
  }>;
  specialistAdvisorSummary?: {
    verdict: string;
    whyConsider: string;
    keySpecsSummary: string;
    practicalBenefits: string;
    importantLimitations: string;
    reviewEvidenceSummary: string;
    merchantOffersSummary: string;
    alternativesComparison: string;
    valueAssessment: string;
  };
  spark2Intelligence?: Spark2IntelligenceReport;
}

export interface AgentObservabilitySnapshot {
  generatedAt: string;
  totalTasksExecuted: number;
  completedTasksCount: number;
  failedTasksCount: number;
  recoveredWorkflowsCount: number;
  taskCompletionSuccessRate: number;
  toolSuccessRate: number;
  averageExecutionDurationMs: number;
  cacheHitRate: number;
  securityViolationsBlocked: number;
  userFeedbackCount: number;
  recommendationAcceptanceRate: number;
  toolInvocationStats: Record<
    string,
    {
      calls: number;
      successes: number;
      failures: number;
      avgDurationMs: number;
    }
  >;
  modelUsageBreakdown: Record<string, number>;
  recentAgentMessages: InterAgentMessage[];
}

export interface AgentBenchmarkScenarioResult {
  scenarioId: string;
  title: string;
  category:
    | 'product_discovery'
    | 'price_comparison'
    | 'coupon_verification'
    | 'cheaper_alternatives'
    | 'personalization_memory'
    | 'multilingual_intelligence'
    | 'security_injection_defense'
    | 'checkout_authorization';
  passed: boolean;
  durationMs: number;
  verificationStage: VerificationOutcomeStage;
  assertionsChecked: number;
  details: string;
}

export interface OrderSummaryCalculation {
  productId: string;
  sourceId: string;
  productName: string;
  merchant: string;
  canonicalUrl: string;
  quantity: number;
  unitPrice: number | null;
  subtotal: number | null;
  couponCode: string | null;
  couponDiscount: number;
  discountedSubtotal: number | null;
  shippingCost: number | null;
  shippingStatus: ProductOffer['shippingStatus'];
  estimatedTax: number | null;
  taxStatus: ProductOffer['taxStatus'];
  totalAmount: number | null;
  totalCalculationState:
    | 'verified_complete'
    | 'cannot_infer_final_cost_charges_unknown'
    | 'price_could_not_be_verified';
  canInitiateCheckout: boolean;
  checkoutBlockerReason: string | null;
  currency: 'USD' | 'EUR' | 'GBP';
  terms: string;
  approvalHash: string;
}

export interface PurchaseRecord {
  id: string;
  userId?: string;
  checkoutSessionId?: string;
  orderReference: string;
  paypalOrderId?: string;
  paypalTransactionId: string;
  captureId?: string | null;
  captureStatus?:
    | 'COMPLETED'
    | 'PENDING'
    | 'DENIED'
    | 'REFUNDED'
    | 'REVERSED'
    | 'CANCELLED'
    | 'AWAITING_CAPTURE';
  sourceId: string;
  productId: string;
  offerId?: string;
  productUrl?: string;
  imageUrl?: string | null;
  productName: string;
  merchant: string;
  quantity: number;
  unitPrice: number;
  subtotal?: number;
  couponCode: string | null;
  discountAmount: number;
  shippingAmount: number | null;
  shippingStatus?: 'verified' | 'estimated' | 'unknown' | 'free' | 'not_applicable_digital';
  taxAmount: number | null;
  taxStatus?: 'verified' | 'estimated' | 'unknown';
  totalAmount: number;
  totalCharged?: number;
  currency: 'USD' | 'EUR' | 'GBP';
  items?: PurchaseOrderItem[];
  isSandboxOrder?: boolean;
  orderTypeLabel?: 'SANDBOX ORDER';
  paymentStatus?: 'COMPLETED' | 'APPROVED' | 'PENDING' | 'FAILED' | 'CANCELLED' | 'REFUNDED';
  merchantOrderStatus?: string;
  status: 'completed' | 'pending' | 'failed' | 'cancelled' | 'refunded';
  createdAt: string;
  updatedAt?: string;
  payerEmail: string;
  webhookVerified?: boolean;
  termsAccepted: string;
}

export type ActivityStageState =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'requires_user_input';

export interface ActivityTimelineStage {
  id: string;
  label: string;
  state: ActivityStageState;
  sourceQueried?: string;
  summary: string;
  details: string[];
  errorReason?: string;
  durationMs?: number;
}

export interface PriceFreshnessInfo {
  status: 'fresh' | 'recent' | 'stale' | 'unverified';
  ageMinutes: number | null;
  label: string;
  retrievedAt: string;
}

export interface ActiveSearchFilters {
  sourceFilter: string;
  maxPrice: number | null;
  verifiedPriceOnly: boolean;
  inStockOnly: boolean;
  sortBy: 'relevance' | 'price_asc' | 'price_desc' | 'rating_desc';
}

export interface ConversationTurn {
  id: string;
  userPrompt: string;
  createdAt: string;
  status: 'executing' | 'completed' | 'failed' | 'stopped';
  stages: ActivityTimelineStage[];
  response: OrchestrationResponse | null;
  errorMessage: string | null;
  isContextualFollowUp?: boolean;
  followUpActionSummary?: string;
}

export interface ConversationThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: ConversationTurn[];
}

// ============================================================================
// SUBSCRIPTION PLANS, QUOTAS & AG GRID ANALYTICS TYPES
// ============================================================================

export type SubscriptionPlanId = 'free' | 'luna' | 'terra' | 'sol';

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'cancelled'
  | 'expired';

export interface SubscriptionTierConfig {
  id: SubscriptionPlanId;
  name: string;
  tagline: string;
  priceMonthly: number;
  currency: 'USD';
  modelTier: 'fast' | 'balanced' | 'deep';
  preferredModel: string;
  monthlySearches: number;
  monthlyAnalyses: number;
  monthlyCoupons: number;
  monthlyWorkflows: number;
  maxConcurrency: number;
  description: string;
  features: string[];
  badgeColor: string;
  isPopular?: boolean;
}

export interface UserSubscriptionRecord {
  id: string;
  userId: string;
  planId: SubscriptionPlanId;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  paypalSubscriptionId: string | null;
  paypalPlanId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserUsageQuotaRecord {
  userId: string;
  planId: SubscriptionPlanId;
  billingPeriodMonth: string; // YYYY-MM
  searchesUsed: number;
  analysesUsed: number;
  couponsUsed: number;
  workflowsUsed: number;
  activeWorkflowsCount: number;
  totalTokensEstimated: number;
  totalEstimatedCostUsd: number;
  lastResetAt: string;
  updatedAt: string;
}

export interface SubscriptionQuotaStatus {
  plan: SubscriptionTierConfig;
  subscription: UserSubscriptionRecord;
  usage: UserUsageQuotaRecord;
  limits: {
    searches: number;
    analyses: number;
    coupons: number;
    workflows: number;
    concurrency: number;
  };
  remaining: {
    searches: number;
    analyses: number;
    coupons: number;
    workflows: number;
    concurrency: number;
  };
  periodResetDate: string;
}

export interface SubscriptionPaymentRecord {
  id: string;
  subscriptionId: string;
  userId: string;
  planId: SubscriptionPlanId;
  amount: number;
  currency: string;
  status: 'COMPLETED' | 'PENDING' | 'FAILED' | 'REFUNDED';
  paypalTransactionId: string;
  createdAt: string;
}

export type AgGridWorkspaceView =
  | 'saved_products'
  | 'comparison_matrix'
  | 'purchase_ledger'
  | 'coupon_savings'
  | 'quota_usage';

export type SearchBubbleVoiceState =
  | 'Idle'
  | 'Connecting'
  | 'Listening'
  | 'Processing'
  | 'Speaking'
  | 'Interrupted'
  | 'Reconnecting'
  | 'Error';

export type AccountBalanceStatus =
  | 'available'
  | 'unavailable'
  | 'not_connected'
  | 'error';

export type AccountBalanceSource =
  | 'paypal_reporting_api'
  | 'paypal_reporting_balances_api'
  | 'spark_sandbox_wallet'
  | 'spark_internal_ledger'
  | 'paypal_live_oauth_identity_only'
  | 'uninitialized';

export interface PayPalCurrencyBalanceEntry {
  currency: 'USD' | 'EUR' | 'GBP';
  currencySymbol: '$' | '€' | '£';
  primary?: boolean;
  availableBalance: number;
  availableBalanceMinorUnits: number;
  pendingBalance: number;
  pendingBalanceMinorUnits: number;
  withheldBalance: number;
  withheldBalanceMinorUnits: number;
  totalBalance: number;
  formattedAvailableBalance: string;
  compactAvailableBalance: string;
  formattedAvailable?: string;
  formattedPending?: string;
}

export interface UserAccountBalanceSummary {
  userId: string;
  visible?: boolean;
  status: AccountBalanceStatus;
  source: AccountBalanceSource;
  sourceLabel: string;
  currency: 'USD' | 'EUR' | 'GBP';
  currencySymbol: '$' | '€' | '£';
  availableBalance: number | null;
  availableBalanceMinorUnits: number | null;
  pendingAmount: number;
  pendingAmountMinorUnits: number;
  withheldAmount?: number;
  withheldAmountMinorUnits?: number;
  initialBalance: number | null;
  totalSpent: number;
  totalRefunded: number;
  formattedAvailableBalance: string;
  compactAvailableBalance: string;
  currencies?: PayPalCurrencyBalanceEntry[];
  paypalConnectionStatus: PayPalConnectionStatus;
  paypalEnvironment: 'sandbox' | 'live';
  paypalLiveBalanceSupported: boolean;
  paypalReportingApiQueried?: boolean;
  paypalReportingApiStatus?:
    | 'authorized_ok'
    | 'permission_denied_or_scope_missing'
    | 'not_connected'
    | 'network_or_sandbox_fallback';
  paypalConnectedEmail?: string | null;
  buyerAccountId?: string | null;
  disclosureMessage: string;
  lastUpdatedAt: string;
}

// ============================================================================
// SPARK 2.0 — ADVANCED AGENTIC PRODUCT INTELLIGENCE ARCHITECTURE TYPES
// ============================================================================

export type Spark2ConditionalRoute =
  | 'Clarification Required'
  | 'Research Execution'
  | 'Expanded Research'
  | 'Verification Failure'
  | 'Conflicting Evidence'
  | 'Research Completed'
  | 'Follow-up Request'
  | 'Unsupported Capability';

export type Spark2RequirementPriority =
  | 'Mandatory'
  | 'High Priority'
  | 'Preferred'
  | 'Optional'
  | 'Excluded';

export interface Spark2ClassifiedRequirementItem {
  id: string;
  field: string;
  statement: string;
  classification: Spark2RequirementPriority;
  objectivelyVerifiable: boolean;
  verificationMethod: string;
}

export interface Spark2RequirementSpecification {
  productCategory: Spark2ProductCategoryId;
  specificProductType: string;
  intendedUse: string;
  targetPrice: number | null;
  minPrice: number | null;
  currency: string;
  countryAndMarket: string;
  technicalRequirements: string[];
  performanceRequirements: string[];
  compatibilityRequirements: string[];
  qualityExpectations: string[];
  brandPreferences: string[];
  excludedBrandsOrProducts: string[];
  mandatoryRequirements: string[];
  optionalPreferences: string[];
  userPriorities: string[];
  classifiedRequirements: Spark2ClassifiedRequirementItem[];
  contradictionsDetected: string[];
  clarificationQuestion: string | null;
  requiresClarificationBeforeResearch: boolean;
  transparentAssumptions: string[];
}

export type Spark2ProductCategoryId =
  | 'Smartphones'
  | 'Laptops'
  | 'Desktop computers'
  | 'CPUs and GPUs'
  | 'Tablets'
  | 'Monitors'
  | 'Cameras'
  | 'Headphones'
  | 'Audio equipment'
  | 'Gaming hardware'
  | 'Networking equipment'
  | 'Smart home products'
  | 'Software and digital tools'
  | 'General consumer electronics'
  | 'Other product categories discovered through research';

export interface Spark2CategoryProfile {
  categoryId: Spark2ProductCategoryId;
  displayName: string;
  description: string;
  requiredTechnicalSpecs: string[];
  evaluationPriorities: string[];
  workloadConsiderations: string[];
  defaultNineDimensionWeights: Spark2NineDimensionWeights;
}

export type Spark2SpecialistRoleId =
  | 'requirements_intelligence_specialist'
  | 'global_product_discovery_specialist'
  | 'technical_research_specialist'
  | 'source_intelligence_specialist'
  | 'market_intelligence_specialist'
  | 'trust_and_risk_specialist'
  | 'evaluation_and_ranking_specialist'
  | 'decision_intelligence_specialist'
  | 'response_synthesis_specialist';

export interface Spark2SpecialistRoleReport {
  roleId: Spark2SpecialistRoleId;
  roleNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  roleTitle: string;
  status: 'COMPLETED' | 'SKIPPED' | 'REQUIRES_CLARIFICATION' | 'LIMITED_BY_EVIDENCE';
  summary: string;
  keyOutputs: string[];
  toolsUsed: string[];
  durationMs: number;
}

export type Spark2ResearchStageNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface Spark2ResearchStageReport {
  stageNumber: Spark2ResearchStageNumber;
  stageCode:
    | 'query_planning'
    | 'broad_discovery'
    | 'candidate_selection'
    | 'deep_investigation'
    | 'evidence_cross_checking'
    | 'conflict_resolution'
    | 'evaluation'
    | 'final_decision'
    | 'adversarial_review'
    | 'response_generation';
  stageTitle: string;
  uiStatusLabel:
    | 'Understanding requirements'
    | 'Planning research'
    | 'Discovering products'
    | 'Investigating specifications'
    | 'Verifying evidence'
    | 'Evaluating candidates'
    | 'Preparing recommendations';
  status: 'completed' | 'in_progress' | 'skipped' | 'blocked_by_limitation';
  summary: string;
  artifacts: string[];
  durationMs: number;
}

export type Spark2EvidenceProvenanceClassification =
  | 'Officially Confirmed'
  | 'Independently Corroborated'
  | 'Channel3 Catalog Evidence'
  | 'Single-Source Evidence'
  | 'Unverified'
  | 'Conflicting'
  | 'Unavailable';

export type Spark2ProductIntentMatchClass =
  | 'Exact Match'
  | 'Partial Match'
  | 'Related Alternative'
  | 'Unqualified Candidate';

export type Spark2NormalizedCondition =
  | 'New'
  | 'Open-box'
  | 'Refurbished'
  | 'Used'
  | 'Unknown';

export interface Spark2ProductIdentifierClassification {
  channel3ProductId: string | null;
  merchantOfferId: string;
  merchantProductUrl: string;
  manufacturerModelNumber: string;
  manufacturerSku: string;
  configurationIdentifier: string;
}

export interface Spark2EvidenceCoverageBreakdown {
  productIdentityCoveragePercent: number;
  technicalSpecificationCoveragePercent: number;
  commercialOfferCoveragePercent: number;
  sourceProvenanceCoveragePercent: number;
  overallEvidenceCoveragePercent: number;
  missingCriticalAttributes: string[];
}

export interface Spark2SourceQualityEvaluation {
  sourceId: string;
  sourceName: string;
  sourceUrl: string;
  sourceType:
    | 'official_manufacturer'
    | 'independent_technical_review'
    | 'authorized_retailer'
    | 'catalog_api'
    | 'search_grounding'
    | 'unverified_listing';
  authorityScore: number; // 0-100
  relevanceScore: number; // 0-100
  directnessScore: number; // 0-100
  recencyScore: number; // 0-100
  technicalDepthScore: number; // 0-100
  independenceScore: number; // 0-100
  consistencyScore: number; // 0-100
  overallQualityScore: number; // 0-100
  observedAt: string;
  isDirectSource: boolean;
  notes: string;
}

export interface Spark2TraceableClaimEvidence {
  claimId: string;
  productId: string;
  claim: string;
  field: string;
  supportingSource: string;
  directUrl: string;
  sourceType: Spark2SourceQualityEvaluation['sourceType'];
  publicationDate: string | null;
  observationDate: string;
  evidenceExcerpt: string;
  verificationStatus: Spark2EvidenceProvenanceClassification;
  confidenceLevel: 'High' | 'Moderate' | 'Low' | 'Insufficient Data';
  sourceQuality: Spark2SourceQualityEvaluation;
  conflictDetail?: string | null;
}

export interface Spark2NineDimensionWeights {
  requirementMatch: number; // default 0.22 (22%)
  technicalSpecifications: number; // default 0.15 (15%)
  performance: number; // default 0.12 (12%)
  priceToValue: number; // default 0.15 (15%)
  buildQualityAndDurability: number; // default 0.10 (10%)
  merchantReliability: number; // default 0.08 (8%)
  availability: number; // default 0.05 (5%)
  warrantyAndSupport: number; // default 0.05 (5%)
  longTermSuitability: number; // default 0.08 (8%)
}

export interface Spark2NineDimensionBreakdown {
  dimensionScores: {
    requirementMatch: number | null;
    technicalSpecifications: number | null;
    performance: number | null;
    priceToValue: number | null;
    buildQualityAndDurability: number | null;
    merchantReliability: number | null;
    availability: number | null;
    warrantyAndSupport: number | null;
    longTermSuitability: number | null;
  };
  normalizedWeights: Spark2NineDimensionWeights;
  weightedScore100: number;
  weightedScore10: number;
  unverifiedDimensions: string[];
  adaptationRationale: string;
  benchmarkEvidenceState?: 'INDEPENDENT_LAB_VERIFIED' | 'ESTIMATED_FROM_ARCHITECTURE' | 'UNKNOWN';
  technicalScoringAuditNote?: string;
}

export interface Spark2SeparatedMetrics {
  productScore100: number;
  productScore10: number;
  evidenceCoveragePercent: number;
  evidenceCoverageBreakdown?: Spark2EvidenceCoverageBreakdown;
  verifiedClaimsCount: number;
  totalRequiredClaimsCount: number;
  recommendationConfidenceScore: number | null;
  recommendationConfidenceClassification:
    | 'High Confidence (Corroborated Multi-Source Evidence)'
    | 'Moderate Confidence (Primary Source Verified, Partial Secondary)'
    | 'Cautious Confidence (Single-Source or Partial Specs)'
    | 'Insufficient Evidence (Cannot Issue High-Confidence Verdict)';
  confidenceFormulaExplanation: string;
}

export type Spark2DecisionLabel =
  | 'Best Overall Match'
  | 'Best Budget Option'
  | 'Best Performance Option'
  | 'Best Value Option'
  | 'Best Alternative'
  | 'Avoid — Risk or Mismatch Identified';

export type Spark2TrustRiskLevel = 'Low Risk' | 'Moderate Caution' | 'Elevated Risk' | 'High Risk — Unverified / Suspicious';

export interface Spark2TrustAndRiskAssessment {
  riskClassification: Spark2TrustRiskLevel;
  riskScore: number; // 0 (safest) to 100 (highest risk)
  suspiciousSellerDetected: boolean;
  unusualPricingDetected: boolean;
  duplicateListingDetected: boolean;
  incorrectIdentityDetected: boolean;
  misleadingClaimsDetected: boolean;
  conflictingSpecificationsDetected: boolean;
  counterfeitIndicators: string[];
  missingWarrantyDisclosures: string[];
  evidenceSummary: string;
}

export interface Spark2CanonicalProductRecord {
  productId: string;
  canonicalProductName: string;
  manufacturer: string;
  productCategory: Spark2ProductCategoryId;
  exactModelNumber: string;
  variant: string;
  sku: string | null;
  region: string;
  intentMatchClass?: Spark2ProductIntentMatchClass;
  intentMatchJustification?: string;
  identifierClassification?: Spark2ProductIdentifierClassification;
  normalizedCondition?: Spark2NormalizedCondition;
  rawChannel3Condition?: string;
  technicalSpecifications: Record<string, string>;
  manufacturerSpecsVsIndependentMeasurements: {
    manufacturerClaimedSpecs: Record<string, string>;
    independentMeasurements: Record<string, string>;
    unverifiedSpecFields: string[];
  };
  price: number | null;
  estimatedTotalPurchaseCost: number | null;
  shippingCost: number | null;
  taxEstimate: number | null;
  verifiedCouponDiscount: number;
  currency: string;
  retailer: string;
  merchantAuthorizationStatus: 'Official Manufacturer' | 'Authorized Retailer' | 'Third-Party Marketplace' | 'Unverified Seller';
  productUrl: string;
  productImageUrl: string | null;
  availabilityStatus: string;
  warrantyInformation: string;
  returnPolicyInformation: string;
  supportingEvidence: Spark2TraceableClaimEvidence[];
  sourceReferences: Spark2SourceQualityEvaluation[];
  lastObservedTime: string;
  verificationStatus: Spark2EvidenceProvenanceClassification;
  confidenceLevel: 'High' | 'Moderate' | 'Low' | 'Insufficient Data';
  nineDimensionEvaluation: Spark2NineDimensionBreakdown;
  separatedMetrics: Spark2SeparatedMetrics;
  trustAndRisk: Spark2TrustAndRiskAssessment;
  decisionLabels: Spark2DecisionLabel[];
  avoidReason: string | null;
  individualRetailerOffers: Array<{
    offerId: string;
    channel3ProductId?: string | null;
    retailer: string;
    domain?: string;
    variant: string;
    region: string;
    condition?: Spark2NormalizedCondition;
    rawChannel3Condition?: string;
    conditionNotes?: string;
    listedPrice: number | null;
    shippingCost?: number | null;
    shippingStatus?: 'verified' | 'unknown';
    taxEstimate?: number | null;
    taxStatus?: 'verified' | 'unknown';
    estimatedTotalCost: number | null;
    currency: string;
    availability: string;
    url: string;
    observedAt: string;
    isPrimaryNewSelection?: boolean;
  }>;
}

export interface Spark2AdversarialReviewReport {
  preferredProductId: string | null;
  preferredProductName: string | null;
  counterArgumentsAgainstPreferred: string[];
  competingCandidateChecked: string | null;
  competingCandidateSatisfiesMandatoryBetter: boolean;
  adversarialVerdict: 'PREFERRED_UPHELD' | 'COMPETING_CANDIDATE_PROMOTED' | 'TIE_DISCLOSED_WITH_TRADEOFFS' | 'NO_CANDIDATE_AVAILABLE';
  rationale: string;
}

export interface Spark2OpalWorkflowNode {
  nodeId: 'A_user_request_input' | 'B_agent_orchestrator' | 'C_conditional_routing' | 'D_research_evidence_processing' | 'E_evaluation_decision_synthesis' | 'F_persistent_memory' | 'G_final_interactive_results';
  nodeLabel: string;
  opalPrimitive: '@Input' | 'Opal Agent Mode' | '@Go to' | '@Search + Provenance' | '@Code Evaluation' | '@Memory' | '@Output UI';
  status: 'completed' | 'active' | 'skipped' | 'degraded';
  upstreamReferences: string[];
  executionSummary: string;
}

export interface Spark2ToolCapabilityEntry {
  toolName: '@Search' | '@Memory' | '@Code' | '@Go to' | 'Channel3 Product Discovery' | 'Feedico Partner Catalog & Coupons' | 'Open Library Catalog API' | 'NCBI PubChem API';
  category: 'opal_core_tool' | 'external_integration';
  actuallyAvailable: boolean;
  connectionStatus: 'Operational' | 'Not Configured — Boundary Enforced' | 'Degraded / Offline';
  supportedOperations: string[];
  requiredInputs: string[];
  outputCharacteristics: string;
  knownLimitations: string[];
}

export interface Spark2InputValidationReport {
  valid: boolean;
  emptyRequest: boolean;
  contradictoryBudgets: boolean;
  invalidCurrency: boolean;
  ambiguousModelNames: boolean;
  unsupportedCategory: boolean;
  impossibleTechnicalRequirements: boolean;
  missingCriticalContext: boolean;
  promptInjectionBlocked: boolean;
  issues: string[];
  recoveryAction: string;
}

export interface Spark2ProfessionalOutputSections {
  isComplexInvestigation: boolean;
  executiveVerdict: string;
  requirementAnalysis: string;
  researchScope: string;
  rankedProductsSummary: string;
  technicalAnalysis: string;
  detailedComparison: string;
  priceAndMerchantAnalysis: string;
  advantagesAndDisadvantages: string;
  evidenceAndSourceVerification: string;
  finalRecommendation: string;
}

export interface Spark2ConversationContextSnapshot {
  userRequest: string;
  activeResearchObjective: string;
  isContextualFollowUp: boolean;
  detectedFollowUpIntent: string | null;
  selectedProductIds: string[];
  previousComparisons: string[];
  explicitConstraints: string[];
  unresolvedQuestions: string[];
  researchFindingsSummary: string[];
  currentRecommendationIds: string[];
  persistentMemoryApplied: {
    preferredCurrency: string;
    generalBudgetPreference: number | null;
    frequentlyUsedCategories: string[];
    explicitlySavedPreferences: string[];
    temporarySessionContextSeparated: true;
  };
}

export interface Spark2ValidationTestCaseResult {
  testNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  testId: string;
  title: string;
  promptUsed: string;
  activeRoute: Spark2ConditionalRoute;
  categorySelected: Spark2ProductCategoryId;
  passed: boolean;
  candidatesEvaluated: number;
  evidenceClaimsVerified: number;
  adversarialReviewExecuted: boolean;
  keyVerificationFindings: string[];
  durationMs: number;
}

export interface Spark2IntelligenceReport {
  architectureVersion: 'Spark 2.0 Opal Agentic Architecture';
  generatedAt: string;
  researchComplexity: 'SIMPLE' | 'MODERATE' | 'COMPLEX_MULTI_STAGE';
  activeConditionalRoute: Spark2ConditionalRoute;
  routeRationale: string;
  allConditionalRoutesEvaluated: Array<{
    route: Spark2ConditionalRoute;
    triggered: boolean;
    reason: string;
  }>;
  inputValidation: Spark2InputValidationReport;
  requirementSpecification: Spark2RequirementSpecification;
  categoryProfile: Spark2CategoryProfile;
  specialistRoles: Spark2SpecialistRoleReport[];
  researchStages: Spark2ResearchStageReport[];
  canonicalProducts: Spark2CanonicalProductRecord[];
  adversarialReview: Spark2AdversarialReviewReport;
  opalWorkflowNodes: Spark2OpalWorkflowNode[];
  toolCapabilityRegistry: Spark2ToolCapabilityEntry[];
  conversationContext: Spark2ConversationContextSnapshot;
  professionalOutput: Spark2ProfessionalOutputSections;
  stoppingCriteriaMet: {
    majorRequirementsInvestigated: boolean;
    principalRecommendationsSupported: boolean;
    importantUncertaintiesDisclosed: boolean;
    additionalResearchUnlikelyToImprove: boolean;
    toolOrExecutionLimitationsDisclosed: string[];
  };
  purchaseSafetyBoundary: {
    prototypeMode: 'Opal Research & Recommendation Engine + Authorized Production Backend';
    directMerchantLinksProvided: boolean;
    autonomousPaymentExecutionBlocked: true;
    safetyDisclosure: string;
  };
  opalSevenAgentReport?: OpalSevenAgentSystemReport;
}

// ============================================================================
// GOOGLE OPAL 7-AGENT INTELLIGENCE SYSTEM & OMEGA DECISION CRUCIBLE TYPES
// ============================================================================

export type OpalInputNodeId =
  | 'ask_user_product_query'
  | 'ask_user_category_type'
  | 'ask_user_target_market'
  | 'ask_user_budget_preference'
  | 'ask_user_requirements_list';

export type OpalSpecialistAgentId =
  | 'node_step_orchestrator_planning'
  | 'node_step_product_discovery'
  | 'node_step_product_identity'
  | 'node_step_technical_intelligence'
  | 'node_step_commercial_intelligence'
  | 'node_step_source_verification'
  | 'node_step_omega_decision_crucible';

export type OpalBudgetSourceTier =
  | '1_latest_explicit_user_clarification'
  | '2_current_request_budget'
  | '3_connected_budget_input'
  | '4_conversation_history_budget'
  | 'none_unbounded_market_analysis';

export interface OpalBudgetContext {
  amount: number | null;
  minAmount: number | null;
  currency: 'USD' | 'EUR' | 'GBP';
  type: 'strict' | 'approximate' | 'flexible' | 'unknown';
  sourceTier: OpalBudgetSourceTier;
  rawBudgetExpression: string | null;
  explicitlyProvided: boolean;
  neverAskToRepeat: boolean;
}

export interface OpalDirectUserContext {
  ask_user_product_query: string;
  ask_user_category_type: Spark2ProductCategoryId;
  ask_user_target_market: string;
  ask_user_budget_preference: string;
  ask_user_requirements_list: string[];
  budget: OpalBudgetContext;
  conversationHistoryPrompts: string[];
  userPreferencesSummary: string[];
  clarificationsApplied: string[];
}

export interface OpalWorkflowEdge {
  fromNode: OpalInputNodeId | OpalSpecialistAgentId;
  toNode: OpalSpecialistAgentId | '6ca0bb70-2215-479a-9d14-122b3648da0c';
  parameterKey: string;
  payloadSummary: string;
}

export interface OpalSpecialistAgentNodeReport {
  agentNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  opalNodeId: OpalSpecialistAgentId;
  opalTitle: string;
  canonicalRoleTitle: string;
  executionMode: 'sequential' | 'parallel_promise_all';
  status: 'COMPLETED' | 'DEGRADED_FALLBACK' | 'SKIPPED';
  startedAt: string;
  completedAt: string;
  durationMs: number;
  directUserInputsReceived: OpalInputNodeId[];
  upstreamAgentInputsReceived: OpalSpecialistAgentId[];
  toolsInvoked: string[];
  summary: string;
  structuredFindings: string[];
  structuredPayload: Record<string, unknown>;
}

export interface OpalOmegaScenarioSimulation {
  scenarioId:
    | 'budget_sensitive_buyer'
    | 'performance_first_buyer'
    | 'long_term_ownership_buyer'
    | 'reliability_first_buyer'
    | 'best_value_buyer';
  scenarioTitle: string;
  winningProductId: string | null;
  winningProductName: string;
  scoreUnderScenario: number;
  rationale: string;
}

export interface OpalOmegaCounterfactualAnalysis {
  counterfactualId: string;
  whatIfCondition: string;
  impactOnRanking: string;
  newTopCandidateName: string;
  quantifiedDelta: string;
}

export interface OpalOmegaSensitivityAndDominance {
  paretoOptimalProductIds: string[];
  dominatedProductIds: Array<{
    productId: string;
    productName: string;
    dominatedByProductName: string;
    reason: string;
  }>;
  weightPerturbationStabilityPercent: number;
  priceFluctuationTolerancePercent: number;
  missingDataImpactSummary: string;
  rankingStabilityClass: 'Robust Lock' | 'Moderately Sensitive' | 'Highly Contested Tie';
}

export interface OpalOmegaTotalCostOfOwnership {
  productId: string;
  productName: string;
  basePurchasePrice: number | null;
  shippingAndHandling: number | null;
  estimatedTax: number | null;
  verifiedCouponSavings: number;
  requiredAccessoriesEstimate: number;
  recurringSubscriptionOrMaintenance3Yr: number;
  estimatedResaleValue3Yr: number | null;
  netThreeYearTco: number | null;
  partialThreeYearTcoBeforeShippingAndTax?: number | null;
  tcoCompleteness?: 'COMPLETE_VERIFIED_TCO' | 'PARTIAL_TCO_MISSING_SHIPPING_AND_TAX' | 'UNKNOWN_PRICE';
  formattedThreeYearTcoLabel?: string;
  residualValueDepreciationMethod?: string;
  inputEvidenceClassifications?: Record<string, 'VERIFIED' | 'ESTIMATED' | 'UNKNOWN'>;
  arithmeticValidity?: boolean;
  inputAccuracy?: string;
  financialCompleteness?: string;
  budgetComplianceStatement?: string;
  currency: 'USD' | 'EUR' | 'GBP';
  budgetDelta: number | null;
  withinOriginalBudget: boolean;
}

export interface OpalOmegaQualityGateResult {
  gateNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  gateName:
    | 'Identity Verification Gate'
    | 'Budget Compliance Gate'
    | 'Evidence Minimum Gate'
    | 'Source Credibility Gate'
    | 'Specification Consistency Gate'
    | 'Commercial Integrity Gate'
    | 'Risk Threshold Gate'
    | 'Scenario Stability Gate'
    | 'Final Recommendation Confidence Gate';
  passed: boolean;
  verificationDetail: string;
}

export interface OpalOmegaDecisionProof {
  selectedProductId: string | null;
  selectedProductName: string;
  whySelectedWins: string[];
  whyAlternativesLose: Array<{
    productId: string;
    productName: string;
    primaryDeficit: string;
    scoreDelta: number;
  }>;
  mandatoryConstraintsSatisfied: string[];
  keyRisksAndMitigations: string[];
  conditionsThatWouldChangeDecision: string[];
  traceableClaimIds: string[];
}

export interface OpalOmegaDecisionCrucibleReport {
  directUserContextReceived: OpalDirectUserContext;
  qualityGates: OpalOmegaQualityGateResult[];
  allQualityGatesPassed: boolean;
  scenarioSimulations: OpalOmegaScenarioSimulation[];
  counterfactualAnalyses: OpalOmegaCounterfactualAnalysis[];
  sensitivityAndDominance: OpalOmegaSensitivityAndDominance;
  tcoBreakdowns: OpalOmegaTotalCostOfOwnership[];
  adversarialReview: Spark2AdversarialReviewReport;
  decisionProof: OpalOmegaDecisionProof;
}

export interface OpalTenSectionNativeReport {
  section1_executiveSummary: string;
  section2_userRequirementsAndBudgetConfirmation: string;
  section3_productDiscoveryResults: string;
  section4_productIdentityAndConfiguration: string;
  section5_technicalAnalysis: string;
  section6_marketAndCommercialAnalysis: string;
  section7_sourceVerificationAndRiskAssessment: string;
  section8_comparativeEvaluation: string;
  section9_omegaFinalRankingAndRecommendation: string;
  section10_sourcesConfidenceAndLimitations: string;
}

export interface OpalAcceptanceTestResult {
  testId: 'Test A' | 'Test B' | 'Test C' | 'Test D' | 'Test E' | 'Test F' | 'Test G' | 'Test H' | 'Test I' | 'Test J' | 'Test K' | 'Test L' | 'TEST A' | 'TEST B' | 'TEST C' | 'TEST D' | 'TEST E' | 'TEST F' | 'TEST G' | 'TEST H' | 'TEST I' | 'TEST J' | 'TEST K' | 'TEST L';
  title: string;
  passed: boolean;
  verificationDetail: string;
  assertionsChecked: number;
  durationMs: number;
}

export interface OpalSevenAgentSystemReport {
  systemArchitectureName: 'Google Opal 7-Agent Intelligence System (Omega Decision Crucible)';
  opalWorkflowVersion: string;
  legacyAgentCompletelyRemoved: true;
  generatedAt: string;
  totalDurationMs: number;
  directUserContext: OpalDirectUserContext;
  inputNodes: Record<OpalInputNodeId, string>;
  workflowEdges: OpalWorkflowEdge[];
  agentNodes: OpalSpecialistAgentNodeReport[];
  parallelExecutionVerified: {
    agents04And05Concurrent: true;
    agent04DurationMs: number;
    agent05DurationMs: number;
    combinedWallClockMs: number;
  };
  channel3IntegrationStatus: {
    configured: boolean;
    endpointsWired: Array<'POST /v1/search' | 'GET /v1/products/{product_id}' | 'POST /v1/lookup' | 'POST /v1/similar' | 'GET /v1/brands' | 'POST /v1/enrich'>;
    searchModeUsed: 'agentic' | 'default' | 'keyword';
    liveRecordsRetrieved: number;
    statusMessage: string;
  };
  omegaCrucible: OpalOmegaDecisionCrucibleReport;
  tenSectionReport: OpalTenSectionNativeReport;
  omegaRegressionTests?: OpalAcceptanceTestResult[];
}



