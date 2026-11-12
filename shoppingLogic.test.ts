import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAuthInput,
  parseShoppingIntent,
  deduplicateRealOffers,
  rankAndCompareOffers,
  computeOrderSummary,
  verifyApprovalIntegrity,
  evaluateLipinskiProfile,
  computePriceFreshness,
  generateConversationTitle,
  isContextualFollowUp,
  applyFollowUpConstraints,
  deriveCardAnalysis,
  deriveFilterChips,
  classifyConversationRequest,
  deriveExplainableInterestTags,
} from './shoppingLogic';
import {
  isChannel3CredentialConfigured,
  redactChannel3Secret,
  normalizeChannel3ProductToOffers,
  queryChannel3Search,
  queryChannel3UrlLookup,
} from './channel3Adapter';
import type { ProductOffer } from '../types/spark';

const sampleChannel3Record: ProductOffer = {
  id: 'ch3_497799835',
  sourceId: 'channel3_api',
  sourceName: 'Channel3 Product Graph API',
  canonicalUrl: 'https://trychannel3.com/products/497799835',
  retrievedAt: '2026-10-26T12:00:00.000Z',
  verificationStatus: 'partial_fields_unverified',
  name: 'Pro Developer Workstation Suite',
  merchant: 'Verified Retail Merchant',
  category: 'software',
  price: 29.99,
  priceStatus: 'verified',
  currency: 'USD',
  shippingCost: 0,
  shippingStatus: 'not_applicable_digital',
  estimatedTaxRate: null,
  taxStatus: 'unknown',
  availabilityStatus: 'verified_in_stock',
  rating: 4.2,
  reviewCount: 15200,
  summary: 'Developer IDE retrieved from Channel3 Product Graph API.',
  specs: {
    Source: 'Channel3 Product Graph API',
    ProductId: '497799835',
  },
  couponStatus: 'coupon_validity_unknown',
  checkoutStatus: 'checkout_unsupported',
  imageUrl: null,
};

const sampleOpenLibraryRecord: ProductOffer = {
  id: 'ol_OL45804W',
  sourceId: 'openlibrary_api',
  sourceName: 'Open Library Catalog API',
  canonicalUrl: 'https://openlibrary.org/works/OL45804W',
  retrievedAt: '2026-10-26T12:00:00.000Z',
  verificationStatus: 'partial_fields_unverified',
  name: 'Designing Data-Intensive Applications',
  merchant: 'O’Reilly Media (via Open Library)',
  category: 'books',
  price: null,
  priceStatus: 'price_could_not_be_verified',
  currency: 'USD',
  shippingCost: null,
  shippingStatus: 'unknown',
  estimatedTaxRate: null,
  taxStatus: 'unknown',
  availabilityStatus: 'unknown',
  rating: 4.6,
  reviewCount: 890,
  summary: 'Published work retrieved from Open Library REST API.',
  specs: {
    Source: 'Open Library API',
  },
  couponStatus: 'coupon_validity_unknown',
  checkoutStatus: 'checkout_unsupported',
  imageUrl: null,
};

test('validateAuthInput rejects empty or malformed inputs', () => {
  const emptySignIn = validateAuthInput('signin', '', '');
  assert.equal(emptySignIn.valid, false);
  assert.ok(emptySignIn.errors.email);
  assert.ok(emptySignIn.errors.password);
});

test('deduplicateRealOffers removes duplicate (sourceId, id, canonicalUrl) records', () => {
  const deduped = deduplicateRealOffers([sampleChannel3Record, { ...sampleChannel3Record }]);
  assert.equal(deduped.length, 1);
});

test('rankAndCompareOffers excludes unverified-price items when a strict maxBudget is set', () => {
  const intent = parseShoppingIntent('Find software under $50');
  const ranked = rankAndCompareOffers([sampleChannel3Record, sampleOpenLibraryRecord], [], intent);
  // Only sampleChannel3Record has a verified price <= $50
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, 'ch3_497799835');
});

test('Rule 10: computeOrderSummary refuses to infer final purchase cost when tax or shipping is unknown', () => {
  const summaryUnknownTax = computeOrderSummary(sampleChannel3Record, 1, null);
  assert.equal(summaryUnknownTax.subtotal, 29.99);
  assert.equal(summaryUnknownTax.taxStatus, 'unknown');
  // Must NOT infer final total from product price alone!
  assert.equal(summaryUnknownTax.totalAmount, null);
  assert.equal(
    summaryUnknownTax.totalCalculationState,
    'cannot_infer_final_cost_charges_unknown'
  );
  assert.equal(summaryUnknownTax.canInitiateCheckout, false);

  const checkIntegrity = verifyApprovalIntegrity(
    summaryUnknownTax.approvalHash,
    summaryUnknownTax
  );
  assert.equal(checkIntegrity.verified, false);
});

test('computeOrderSummary reports price_could_not_be_verified when source lacks price', () => {
  const summaryNoPrice = computeOrderSummary(sampleOpenLibraryRecord, 1, null);
  assert.equal(summaryNoPrice.unitPrice, null);
  assert.equal(summaryNoPrice.totalAmount, null);
  assert.equal(summaryNoPrice.totalCalculationState, 'price_could_not_be_verified');
  assert.equal(summaryNoPrice.canInitiateCheckout, false);
});

test('evaluateLipinskiProfile checks Rule of Five violations accurately', () => {
  const niacinamide = evaluateLipinskiProfile({
    molecularWeight: 122.12,
    xLogP: -0.4,
    hBondDonorCount: 1,
    hBondAcceptorCount: 2,
  });
  assert.equal(niacinamide.lipinskiPass, true);
  assert.equal(niacinamide.lipinskiViolations, 0);
});

test('computePriceFreshness distinguishes fresh, stale, and unverified prices', () => {
  const baseMs = Date.parse('2026-10-26T12:00:00.000Z');
  const fresh = computePriceFreshness('2026-10-26T12:00:00.000Z', 'verified', baseMs + 60_000);
  assert.equal(fresh.status, 'fresh');
  assert.equal(fresh.ageMinutes, 1);

  const stale = computePriceFreshness('2026-10-26T12:00:00.000Z', 'verified', baseMs + 120 * 60_000);
  assert.equal(stale.status, 'stale');

  const unverified = computePriceFreshness(
    '2026-10-26T12:00:00.000Z',
    'price_could_not_be_verified',
    baseMs
  );
  assert.equal(unverified.status, 'unverified');
});

test('applyFollowUpConstraints retains existing product context on budget or comparison follow-ups', () => {
  const initialIntent = parseShoppingIntent('Affinity Photo 2 macOS software');
  const cheapOffer: ProductOffer = {
    ...sampleChannel3Record,
    id: 'ch3_cheap',
    name: 'Pixelmator Photo Utility',
    price: 9.99,
  };
  const ranked = rankAndCompareOffers(
    [sampleChannel3Record, cheapOffer, sampleOpenLibraryRecord],
    [],
    initialIntent
  );
  assert.equal(ranked.length, 3);

  assert.equal(isContextualFollowUp('Only show products under $15', true), true);
  const followUp = applyFollowUpConstraints('Only show products under $15', ranked, initialIntent);
  assert.equal(followUp.shouldRunNewUpstreamSearch, false);
  assert.equal(followUp.filteredOffers.length, 1);
  assert.equal(followUp.filteredOffers[0].id, 'ch3_cheap');
});

test('generateConversationTitle creates concise contextual titles', () => {
  assert.equal(
    generateConversationTitle('  Affinity Photo 2 macOS software under $80  '),
    'Affinity Photo 2 macOS software under $80'
  );
});

test('deriveCardAnalysis and deriveFilterChips produce real source-backed pros, cons, and filter chips', () => {
  const intent = parseShoppingIntent('headphone audio apps under $50');
  const ranked = rankAndCompareOffers([sampleChannel3Record, sampleOpenLibraryRecord], [], intent);
  const analysis = deriveCardAnalysis(ranked[0]);
  assert.equal(analysis.pros.length, 3);
  assert.equal(analysis.cons.length, 3);
  assert.ok(analysis.pros[0].description.includes('Channel3 Product Graph API'));
  assert.ok(analysis.cons[1].title.includes('Coupon Validity Unknown'));

  const chips = deriveFilterChips(ranked, intent);
  assert.ok(chips.some((c) => c.label === '$0_$50'));
  assert.ok(chips.some((c) => c.type === 'verified_price'));
});

test('classifyConversationRequest and parseShoppingIntent distinguish general questions, missing info, and shopping tasks', () => {
  assert.equal(classifyConversationRequest('What can you do?', false), 'general_question');

  const ambiguousIntent = parseShoppingIntent('find me something', false);
  assert.equal(ambiguousIntent.responseType, 'missing_information');

  const searchIntent = parseShoppingIntent('Affinity Photo 2 macOS software under $80', false);
  assert.equal(searchIntent.responseType, 'product_search');

  const compareIntent = parseShoppingIntent('Compare the first three products and include shipping in the comparison', true);
  assert.equal(compareIntent.responseType, 'product_comparison');
  assert.equal(compareIntent.compareTopCount, 3);
  assert.equal(compareIntent.shippingIncludedRequested, true);
});

test('Channel3 credential check and secret redaction never expose API keys', () => {
  assert.equal(isChannel3CredentialConfigured(undefined), false);
  assert.equal(isChannel3CredentialConfigured(''), false);
  assert.equal(isChannel3CredentialConfigured('MY_CHANNEL3_API_KEY'), false);
  assert.equal(isChannel3CredentialConfigured('ch3_live_example_credential_999'), true);

  const rawMsg = 'Upstream failed for key ch3_live_example_credential_999 with x-api-key: secret123';
  const redacted = redactChannel3Secret(rawMsg, 'ch3_live_example_credential_999');
  assert.equal(redacted.includes('ch3_live_example_credential_999'), false);
  assert.equal(redacted.includes('secret123'), false);
  assert.ok(redacted.includes('[REDACTED]'));
});

test('normalizeChannel3ProductToOffers preserves original IDs, distinguishes 0 from missing price, and sets explicit unverified shipping/tax states', () => {
  const retrievedAt = '2026-10-27T23:00:00.000Z';
  const normalized = normalizeChannel3ProductToOffers(
    {
      id: '2yh8WH5',
      title: 'Organic Cotton T-Shirt',
      description: 'Breathable 100% organic cotton tee.',
      brands: [{ id: 'br_1', name: 'Everlane' }],
      category: { slug: 't-shirts', title: 'T-Shirts', has_children: false },
      images: [
        {
          url: 'https://cdn.trychannel3.com/raw.jpg',
          cleaned_url: 'https://cdn.trychannel3.com/cleaned.png',
          is_main_image: true,
        },
      ],
      ratings: { value: 4.76, count: 142, source_count: 2 },
      offers: [
        {
          domain: 'everlane.com',
          url: 'https://www.buy.trychannel3.com/offer1',
          price: { price: 32.5, compare_at_price: 45.0, currency: 'USD' },
          availability: 'InStock',
          condition: 'new',
          max_commission_rate: 0.08,
        },
        {
          domain: 'free-sample.com',
          url: 'https://www.buy.trychannel3.com/offer-zero',
          price: { price: 0, currency: 'USD' },
          availability: 'InStock',
          condition: 'new',
        },
        {
          domain: 'unpriced-archive.com',
          url: 'https://www.buy.trychannel3.com/offer-null',
          price: { price: null, currency: 'USD' },
          availability: 'OutOfStock',
          condition: 'used',
        },
      ],
    },
    retrievedAt
  );

  assert.equal(normalized.length, 3);

  // Offer 1: Standard verified price + compare_at_price + InStock
  assert.equal(normalized[0].id, 'ch3_2yh8WH5_everlane_com');
  assert.equal(normalized[0].sourceId, 'channel3_api');
  assert.equal(normalized[0].price, 32.5);
  assert.equal(normalized[0].priceStatus, 'verified');
  assert.equal(normalized[0].availabilityStatus, 'verified_in_stock');
  assert.equal(normalized[0].shippingStatus, 'unknown');
  assert.equal(normalized[0].taxStatus, 'unknown');
  assert.equal(normalized[0].checkoutStatus, 'checkout_unsupported');
  assert.equal(normalized[0].couponStatus, 'no_verified_coupon');
  assert.equal(normalized[0].rating, 4.8);
  assert.equal(normalized[0].reviewCount, 142);
  assert.equal(normalized[0].imageUrl, 'https://cdn.trychannel3.com/cleaned.png');
  assert.equal(normalized[0].specs['Compare At Price'], 'USD 45.00');

  // Offer 2: Genuine 0 price must be treated as verified $0.00, NOT missing
  assert.equal(normalized[1].price, 0);
  assert.equal(normalized[1].priceStatus, 'verified');

  // Offer 3: Null price must be marked price_could_not_be_verified & OutOfStock -> verified_out_of_stock
  assert.equal(normalized[2].price, null);
  assert.equal(normalized[2].priceStatus, 'price_could_not_be_verified');
  assert.equal(normalized[2].availabilityStatus, 'verified_out_of_stock');
});

test('queryChannel3Search handles missing credentials, invalid credentials (401), rate limits (429 retry), and valid responses', async () => {
  // 1. Missing credential
  const missingRes = await queryChannel3Search('running shoes', {}, { apiKey: '' });
  assert.equal(missingRes.report.configured, false);
  assert.equal(missingRes.report.queried, false);
  assert.equal(missingRes.report.status, 'source_not_configured');
  assert.equal(missingRes.diagnostic.errorCode, 'missing_credential');

  // 2. Invalid credential (401 Unauthorized)
  const fakeKey = 'ch3_invalid_test_credential_value';
  const unauthorizedRes = await queryChannel3Search(
    'running shoes',
    {},
    {
      apiKey: fakeKey,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            detail: `API key ${fakeKey} was provided but is invalid.`,
          }),
          { status: 401, headers: { 'content-type': 'application/json' } }
        ),
    }
  );
  assert.equal(unauthorizedRes.report.configured, true);
  assert.equal(unauthorizedRes.report.queried, true);
  assert.equal(unauthorizedRes.report.status, 'live_search_failed');
  assert.equal(unauthorizedRes.diagnostic.errorCode, 'unauthorized_401');
  // Ensure the secret was redacted from diagnostic messages
  assert.equal(unauthorizedRes.diagnostic.safeMessage.includes(fakeKey), false);

  // 3. Rate limit (429) with bounded retry succeeding on second attempt
  let callCount = 0;
  const retryRes = await queryChannel3Search(
    'running shoes',
    { maxBudget: 150, currency: 'USD', limit: 5 },
    {
      apiKey: 'ch3_valid_test_credential',
      maxRetries: 1,
      sleepFn: async () => {},
      fetchFn: async (_url, init) => {
        callCount++;
        const headers = init?.headers as Record<string, string>;
        assert.equal(headers['x-api-key'], 'ch3_valid_test_credential');
        if (callCount === 1) {
          return new Response(JSON.stringify({ detail: 'Rate limit exceeded' }), {
            status: 429,
            headers: { 'retry-after': '1', 'content-type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({
            products: [
              {
                id: 'prod_99',
                title: 'Pegasus Trail 5',
                brands: [{ id: 'b_nike', name: 'Nike' }],
                offers: [
                  {
                    domain: 'nike.com',
                    url: 'https://www.buy.trychannel3.com/pegasus5',
                    price: { price: 139.99, currency: 'USD' },
                    availability: 'InStock',
                    condition: 'new',
                  },
                ],
              },
            ],
            next_page_token: 'tok_next_1',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      },
    }
  );
  assert.equal(callCount, 2);
  assert.equal(retryRes.report.status, 'verified_ok');
  assert.equal(retryRes.offers.length, 1);
  assert.equal(retryRes.offers[0].name, 'Nike Pegasus Trail 5');
  assert.equal(retryRes.offers[0].price, 139.99);
  assert.equal(retryRes.nextPageToken, 'tok_next_1');

  // 4. URL Lookup (/v1/lookup)
  const lookupRes = await queryChannel3UrlLookup('https://nike.com/t/pegasus-trail-5', {
    apiKey: 'ch3_valid_test_credential',
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          product: {
            id: 'prod_99',
            title: 'Pegasus Trail 5',
            offers: [
              {
                domain: 'nike.com',
                url: 'https://www.buy.trychannel3.com/pegasus5',
                price: { price: 139.99, currency: 'USD' },
                availability: 'InStock',
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      ),
  });
  assert.equal(lookupRes.report.status, 'verified_ok');
  assert.equal(lookupRes.offers.length, 1);
});

test('Agent 1 Dispatcher Trigger: new product searches with "under $X" in an existing thread trigger new upstream search instead of skipping Agent 1', () => {
  const existingIntent = parseShoppingIntent('Sony wireless headphones under $300');
  const existingRanked = rankAndCompareOffers([sampleChannel3Record], [], existingIntent);

  // A brand-new product search with a budget ceiling ("Find gaming laptops under $900")
  // MUST NOT be treated as a pure contextual filter on existing headphone results
  assert.equal(isContextualFollowUp('Find gaming laptops under $900', true), false);
  const newTopicResult = applyFollowUpConstraints(
    'Find gaming laptops under $900',
    existingRanked,
    existingIntent
  );
  assert.equal(newTopicResult.shouldRunNewUpstreamSearch, true);

  // Even within the same category or uncategorized query, introducing new product nouns
  // ("Find Anker USB-C power bank under $60") must trigger a new upstream search
  assert.equal(isContextualFollowUp('Find Anker USB-C power bank under $60', true), false);
  const newSubjectResult = applyFollowUpConstraints(
    'Find Anker USB-C power bank under $60',
    existingRanked,
    existingIntent
  );
  assert.equal(newSubjectResult.shouldRunNewUpstreamSearch, true);

  // Conversely, a genuine budget refinement without new product subject nouns ("under $25" or "only show under $25")
  // MUST be recognized as a contextual follow-up
  assert.equal(isContextualFollowUp('under $25', true), true);
  assert.equal(isContextualFollowUp('Only show options under $25', true), true);
  const genuineFollowUp = applyFollowUpConstraints(
    'Only show options under $25',
    existingRanked,
    existingIntent
  );
  assert.equal(genuineFollowUp.shouldRunNewUpstreamSearch, false);
});

test('parseShoppingIntent extracts budget ranges, multilingual categories (EN/AR/FR), and currencies accurately for Agent 1', () => {
  const rangeIntent = parseShoppingIntent('Find a 4K monitor between $300 and $650 with USB-C');
  assert.equal(rangeIntent.category, 'monitors');
  assert.equal(rangeIntent.maxBudget, 650);
  assert.equal(rangeIntent.currency, 'USD');

  const frenchIntent = parseShoppingIntent(
    'Trouver un ordinateur portable moins de 900 € avec 16GB RAM'
  );
  assert.equal(frenchIntent.category, 'laptops');
  assert.equal(frenchIntent.maxBudget, 900);
  assert.equal(frenchIntent.currency, 'EUR');

  const arabicIntent = parseShoppingIntent('ابحث عن هاتف ذكي تحت 500 دولار مع بطارية قوية');
  assert.equal(arabicIntent.category, 'smartphones');
  assert.equal(arabicIntent.maxBudget, 500);
  assert.equal(arabicIntent.currency, 'USD');
});

test('Phase 9 Multi-Turn Intelligent Shopping Conversations: resolves camera, brand comparison, gaming suitability, price worthiness, and cheaper alternative follow-ups without losing context', () => {
  const initialIntent = parseShoppingIntent('Compare Google Pixel 9a vs Samsung Galaxy A56 under $550');
  const pixelOffer: ProductOffer = {
    ...sampleChannel3Record,
    id: 'pixel_9a',
    name: 'Google Pixel 9a 5G Smartphone',
    merchant: 'Google Store',
    category: 'Smartphones',
    price: 499.0,
    rating: 4.8,
    reviewCount: 850,
    summary: 'Google Tensor G4, 6.1" 120Hz OLED, 64MP OIS Main Camera + 13MP Ultrawide.',
    specs: {
      Brand: 'Google',
      SoC: 'Google Tensor G4',
      RAM: '8GB LPDDR5X',
      Display: '6.1" 120Hz OLED',
      Camera: '64MP OIS Main + 13MP Ultrawide',
      Battery: '5100mAh',
    },
  };
  const samsungOffer: ProductOffer = {
    ...sampleChannel3Record,
    id: 'galaxy_a56',
    name: 'Samsung Galaxy A56 5G Smartphone',
    merchant: 'Samsung Official',
    category: 'Smartphones',
    price: 449.99,
    rating: 4.6,
    reviewCount: 540,
    summary: 'Exynos 1580, 6.6" 120Hz Super AMOLED, 50MP OIS Camera.',
    specs: {
      Brand: 'Samsung',
      SoC: 'Exynos 1580',
      RAM: '8GB',
      Display: '6.6" 120Hz Super AMOLED',
      Camera: '50MP OIS Main + 12MP Ultrawide',
      Battery: '5000mAh',
    },
  };
  const ranked = rankAndCompareOffers([pixelOffer, samsungOffer], [], initialIntent);

  // 1. "What about its camera?"
  assert.equal(isContextualFollowUp('What about its camera?', true), true);
  const cameraFollowUp = applyFollowUpConstraints('What about its camera?', ranked, initialIntent);
  assert.equal(cameraFollowUp.shouldRunNewUpstreamSearch, false);
  assert.ok(cameraFollowUp.followUpAdvisorMessage?.includes('64MP OIS'));

  // 2. "Compare it with Samsung."
  assert.equal(isContextualFollowUp('Compare it with Samsung.', true), true);
  const compareSamsung = applyFollowUpConstraints('Compare it with Samsung.', ranked, initialIntent);
  assert.equal(compareSamsung.shouldRunNewUpstreamSearch, false);
  assert.equal(compareSamsung.mergedIntent.comparisonRequested, true);
  assert.ok(compareSamsung.followUpAdvisorMessage?.includes('Samsung Galaxy A56 5G'));

  // 3. "Which one is better for gaming?"
  assert.equal(isContextualFollowUp('Which one is better for gaming?', true), true);
  const gamingFollowUp = applyFollowUpConstraints('Which one is better for gaming?', ranked, initialIntent);
  assert.equal(gamingFollowUp.shouldRunNewUpstreamSearch, false);
  assert.ok(gamingFollowUp.followUpAdvisorMessage?.includes('gaming'));

  // 4. "Is it worth the price?"
  assert.equal(isContextualFollowUp('Is it worth the price?', true), true);
  const worthFollowUp = applyFollowUpConstraints('Is it worth the price?', ranked, initialIntent);
  assert.equal(worthFollowUp.shouldRunNewUpstreamSearch, false);
  assert.ok(worthFollowUp.followUpAdvisorMessage?.includes('Price & Value Assessment'));

  // 5. "Find a cheaper alternative."
  assert.equal(isContextualFollowUp('Find a cheaper alternative.', true), true);
  const cheaperFollowUp = applyFollowUpConstraints('Find a cheaper alternative.', ranked, initialIntent);
  assert.equal(cheaperFollowUp.shouldRunNewUpstreamSearch, false);
  assert.equal(cheaperFollowUp.filteredOffers[0].id, 'galaxy_a56');
  assert.ok(cheaperFollowUp.followUpAdvisorMessage?.includes('Cheaper Verified Alternatives'));
});

test('Stage 5: deriveExplainableInterestTags strictly respects user consent and provides transparent explanations', () => {
  const samplePrompts = [
    'Compare Sony and Bose noise cancelling headphones under $350 with coupon',
    'Find Apple MacBook laptops for software development',
  ];

  // When consent is false, zero tags may be derived
  const withoutConsent = deriveExplainableInterestTags(samplePrompts, false);
  assert.equal(withoutConsent.length, 0);

  // When consent is true, explainable tags are derived with category & reason
  const withConsent = deriveExplainableInterestTags(samplePrompts, true);
  assert.ok(withConsent.length >= 4);
  assert.ok(withConsent.some((t) => t.tag === 'Sony' && t.category === 'brand'));
  assert.ok(withConsent.some((t) => t.tag === 'Bose' && t.category === 'brand'));
  assert.ok(withConsent.some((t) => t.tag === 'Budget <= $350' && t.category === 'budget'));
  assert.ok(withConsent.every((t) => t.reason.length > 10));
});




