import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  FeedicoPartnerService,
  FeedicoServiceError,
  buildOpaqueUserSubId,
  buildUserTrackedGoUrl,
  getFeedicoConfig,
  isOfferEligibleForCountry,
  isValidFeedicoSubId,
  matchAndRankOffersForProduct,
  normalizeFeedicoCoupon,
  normalizeFeedicoProduct,
  redactFeedicoSecrets,
  validateFeedicoBaseUrl,
  verifyFeedicoPostbackSignature,
  type FeedicoApiCouponRow,
} from './feedicoService.ts';

describe('Spark × Feedico Partner API Integration Suite (15 Required Scenarios)', () => {
  // 1. Valid Feedico authentication & SSRF / Data API isolation
  it('1. validates Feedico Partner API authentication (fdcp_ prefix) and blocks Data API / SSRF hosts', async () => {
    const validCfg = getFeedicoConfig({
      FEEDICO_ENABLED: 'true',
      FEEDICO_PARTNER_TOKEN: 'fdcp_live_valid_partner_token_12345',
      FEEDICO_API_BASE_URL: 'https://partner.feedico.io',
      FEEDICO_CACHE_TTL: '300',
    });
    assert.equal(validCfg.configured, true);
    assert.equal(validCfg.tokenFormatValid, true);
    assert.equal(validCfg.errorCode, 'none');

    // Reject Data API base URL to prevent mixing Partner API auth with Data API auth
    const dataApiUrlCheck = validateFeedicoBaseUrl('https://api.feedico.io');
    assert.equal(dataApiUrlCheck.valid, false);
    assert.equal(dataApiUrlCheck.errorCode, 'feedico_data_api_mixed_rejected');

    // Reject SSRF internal / arbitrary hosts
    const ssrfCheck = validateFeedicoBaseUrl('https://169.254.169.254/latest/meta-data');
    assert.equal(ssrfCheck.valid, false);
    assert.equal(ssrfCheck.errorCode, 'ssrf_blocked_untrusted_host');

    let capturedAuthHeader = '';
    const service = new FeedicoPartnerService({
      envOverrides: {
        FEEDICO_ENABLED: 'true',
        FEEDICO_PARTNER_TOKEN: 'fdcp_test_secret_token_999999',
        FEEDICO_API_BASE_URL: 'https://partner.feedico.io',
      },
      fetchFn: async (_input, init) => {
        const headers = init?.headers as Record<string, string>;
        capturedAuthHeader = headers?.Authorization || '';
        return new Response(
          JSON.stringify({
            coupons: [],
            meta: { total: 0, limit: 20, offset: 0, hasMore: false },
            partnerPublicId: '6b303b82cc3ad98a',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      },
    });

    await service.searchCoupons({ q: 'nike' });
    assert.equal(capturedAuthHeader, 'Bearer fdcp_test_secret_token_999999');
  });

  // 2. Coupon retrieval & normalization
  it('2. retrieves coupons from POST /api/catalog/coupons and normalizes into Spark data model', async () => {
    const sampleRow: FeedicoApiCouponRow = {
      id: '89166976',
      goSlug: '26471',
      merchantName: 'Newbalance Many geos',
      provider: 'admitad',
      code: 'NBSALE15',
      title: '15% off Outlet prices on orders over $50',
      endsAt: '2027-09-27T23:59:00.000Z',
      websiteUrl: 'https://newbalance.com/',
      countries: ['US', 'CZ'],
      goUrl: 'https://feedico.io/go/26471?p=6b303b82cc3ad98a&c=NBSALE15',
    };

    const service = new FeedicoPartnerService({
      envOverrides: {
        FEEDICO_ENABLED: 'true',
        FEEDICO_PARTNER_TOKEN: 'fdcp_valid_token_abc12345',
      },
      fetchFn: async (input, init) => {
        assert.equal(String(input), 'https://partner.feedico.io/api/catalog/coupons');
        assert.equal(init?.method, 'POST');
        return new Response(
          JSON.stringify({
            coupons: [sampleRow],
            meta: { total: 1, limit: 20, offset: 0, hasMore: false },
            partnerPublicId: '6b303b82cc3ad98a',
          }),
          { status: 200 }
        );
      },
    });

    const res = await service.searchCoupons({ q: 'newbalance' }, { userId: 'usr_alice' });
    assert.equal(res.offers.length, 1);
    const offer = res.offers[0];
    assert.equal(offer.feedico_offer_id, '89166976');
    assert.equal(offer.merchant_id, '26471');
    assert.equal(offer.coupon_code, 'NBSALE15');
    assert.equal(offer.discount.type, 'percentage');
    assert.equal(offer.discount.value, 15);
    assert.equal(offer.verification_status, 'verified_active');
    assert.deepEqual(offer.target_countries, ['US', 'CZ']);
    assert.equal(res.coupons[0].minSpend, 50);
  });

  // 3. Merchant lookup
  it('3. retrieves merchants from POST /api/catalog/merchants with commission and cashback metadata', async () => {
    const service = new FeedicoPartnerService({
      envOverrides: {
        FEEDICO_ENABLED: 'true',
        FEEDICO_PARTNER_TOKEN: 'fdcp_valid_token_abc12345',
      },
      fetchFn: async (input) => {
        assert.equal(String(input), 'https://partner.feedico.io/api/catalog/merchants');
        return new Response(
          JSON.stringify({
            merchants: [
              {
                goSlug: '104407',
                name: 'Nike Store',
                provider: 'takeads',
                websiteUrl: 'https://www.nike.com',
                couponCount: 33,
                goUrl: 'https://feedico.io/go/104407?p=6b303b82cc3ad98a',
                cashbackAllowed: 'yes',
                commission: {
                  model: 'percent',
                  currency: 'USD',
                  rate: { min: 4, max: 8 },
                  partnerRate: { min: 2.6, max: 5.2 },
                  partnerShare: 0.65,
                },
              },
            ],
            meta: { total: 1, limit: 20, offset: 0, hasMore: false },
            partnerPublicId: '6b303b82cc3ad98a',
          }),
          { status: 200 }
        );
      },
    });

    const result = await service.searchMerchants({ q: 'nike', hasCoupons: true });
    assert.equal(result.merchants.length, 1);
    assert.equal(result.merchants[0].go_slug, '104407');
    assert.equal(result.merchants[0].domain, 'nike.com');
    assert.equal(result.merchants[0].coupon_count, 33);
    assert.equal(result.merchants[0].cashback_allowed, 'yes');
  });

  // 4. Product-to-merchant matching & ranking
  it('4. matches and ranks Feedico offers for a discovered product by merchant domain, name, and discount value', () => {
    const nowMs = Date.parse('2026-06-01T00:00:00.000Z');
    const { normalized: offer10 } = normalizeFeedicoCoupon(
      {
        id: '101',
        goSlug: '104407',
        merchantName: 'Nike Store',
        provider: 'takeads',
        code: 'NIKE10',
        title: '10% off sitewide',
        endsAt: '2026-12-31T23:59:00.000Z',
        websiteUrl: 'https://nike.com',
        countries: ['US'],
        goUrl: 'https://feedico.io/go/104407?p=abc&c=NIKE10',
      },
      { nowMs }
    );
    const { normalized: offer25 } = normalizeFeedicoCoupon(
      {
        id: '102',
        goSlug: '104407',
        merchantName: 'Nike Store',
        provider: 'takeads',
        code: 'NIKE25',
        title: '25% off running footwear',
        endsAt: '2026-12-31T23:59:00.000Z',
        websiteUrl: 'https://nike.com',
        countries: ['US'],
        goUrl: 'https://feedico.io/go/104407?p=abc&c=NIKE25',
      },
      { nowMs }
    );
    const { normalized: unrelatedOffer } = normalizeFeedicoCoupon(
      {
        id: '103',
        goSlug: '99999',
        merchantName: 'Unrelated Bookstore',
        provider: 'admitad',
        code: 'BOOK50',
        title: '50% off books',
        endsAt: '2026-12-31T23:59:00.000Z',
        websiteUrl: 'https://unrelatedbooks.example.com',
        countries: ['US'],
        goUrl: 'https://feedico.io/go/99999?p=abc&c=BOOK50',
      },
      { nowMs }
    );

    const ranked = matchAndRankOffersForProduct(
      {
        name: 'Nike Pegasus 41 Running Shoes',
        merchant: 'Nike',
        canonicalUrl: 'https://www.nike.com/t/pegasus-41',
        price: 140,
        priceStatus: 'verified',
        currency: 'USD',
      },
      [offer10, offer25, unrelatedOffer],
      { targetCountry: 'US', nowMs }
    );

    assert.equal(ranked.length, 2);
    assert.equal(ranked[0].coupon_code, 'NIKE25');
    assert.equal(ranked[1].coupon_code, 'NIKE10');
  });

  // 5. Country filtering
  it('5. filters offers accurately by ISO target country, worldwide (WW), and network unspecified ([])', () => {
    const czOnly = { target_countries: ['CZ'] };
    const worldwide = { target_countries: ['WW'] };
    const unspecified = { target_countries: [] };

    assert.equal(isOfferEligibleForCountry(czOnly, 'US').eligible, false);
    assert.equal(isOfferEligibleForCountry(czOnly, 'CZ').eligible, true);
    assert.equal(isOfferEligibleForCountry(worldwide, 'US').eligible, true);
    assert.equal(isOfferEligibleForCountry(worldwide, 'US').matchType, 'worldwide');
    assert.equal(isOfferEligibleForCountry(unspecified, 'US').eligible, true);
    assert.equal(isOfferEligibleForCountry(unspecified, 'US').matchType, 'unspecified');
  });

  // 6. Expired coupon handling
  it('6. classifies expired coupons as expired and excludes them from active product recommendations', () => {
    const nowMs = Date.parse('2026-10-31T00:00:00.000Z');
    const { normalized } = normalizeFeedicoCoupon(
      {
        id: 'exp_1',
        goSlug: '26471',
        merchantName: 'Nike',
        provider: 'cj_affiliate',
        code: 'OLD2025',
        title: '30% off everything',
        endsAt: '2025-12-31T23:59:59.000Z',
        websiteUrl: 'https://nike.com',
        countries: ['US'],
        goUrl: 'https://feedico.io/go/26471?p=abc&c=OLD2025',
      },
      { nowMs }
    );

    assert.equal(normalized.verification_status, 'expired');

    const activeMatches = matchAndRankOffersForProduct(
      {
        name: 'Nike Shoes',
        merchant: 'Nike',
        canonicalUrl: 'https://nike.com/item',
        price: 100,
        priceStatus: 'verified',
        currency: 'USD',
      },
      [normalized],
      { targetCountry: 'US', includeExpired: false, nowMs }
    );
    assert.equal(activeMatches.length, 0);
  });

  // 7. Missing coupon codes (No-code deals)
  it('7. classifies offers with empty code as no_code_deal without inventing a coupon code', () => {
    const { normalized, couponItem } = normalizeFeedicoCoupon({
      id: 'deal_no_code',
      goSlug: '555',
      merchantName: 'Adidas',
      provider: 'awin_affiliate',
      code: '',
      title: 'Up to 40% off End of Season Sale',
      endsAt: null,
      websiteUrl: 'https://adidas.com',
      countries: ['WW'],
      goUrl: 'https://feedico.io/go/555?p=6b303b82cc3ad98a',
    });

    assert.equal(normalized.coupon_code, null);
    assert.equal(normalized.verification_status, 'no_code_deal');
    assert.equal(couponItem.offerClassification, 'no_code_deal');
    assert.equal(couponItem.code, 'NO_CODE_NEEDED');
  });

  // 8. Invalid API credentials & token redaction
  it('8. handles invalid credentials (non-fdcp_ prefix and HTTP 401) and redacts tokens in error strings', async () => {
    const badPrefixCfg = getFeedicoConfig({
      FEEDICO_ENABLED: 'true',
      FEEDICO_PARTNER_TOKEN: 'data_api_wrong_key_123456',
    });
    assert.equal(badPrefixCfg.configured, false);
    assert.equal(badPrefixCfg.errorCode, 'invalid_partner_token_prefix');

    const redacted = redactFeedicoSecrets(
      'Auth failed for Bearer fdcp_super_secret_token_987654 and whsec_99887766'
    );
    assert.equal(redacted.includes('fdcp_super_secret_token_987654'), false);
    assert.equal(redacted.includes('whsec_99887766'), false);

    const service401 = new FeedicoPartnerService({
      envOverrides: {
        FEEDICO_ENABLED: 'true',
        FEEDICO_PARTNER_TOKEN: 'fdcp_revoked_token_123456',
      },
      fetchFn: async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    });

    await assert.rejects(
      () => service401.searchCoupons({ q: 'nike' }),
      (err: FeedicoServiceError) => {
        assert.equal(err.statusCode, 401);
        assert.equal(err.errorCode, 'unauthorized_partner_token');
        return true;
      }
    );
  });

  // 9. Rate limit handling (HTTP 429)
  it('9. retries on HTTP 429 rate limits and throws structured rate_limited error when exhausted', async () => {
    let attempts = 0;
    const service = new FeedicoPartnerService({
      envOverrides: {
        FEEDICO_ENABLED: 'true',
        FEEDICO_PARTNER_TOKEN: 'fdcp_valid_token_rate_test',
      },
      maxRetries: 1,
      fetchFn: async () => {
        attempts++;
        return new Response(JSON.stringify({ error: 'rate_limited' }), {
          status: 429,
          headers: { 'Retry-After': '1' },
        });
      },
    });

    await assert.rejects(
      () => service.searchCoupons({ q: 'nike' }),
      (err: FeedicoServiceError) => {
        assert.equal(err.statusCode, 429);
        assert.equal(err.errorCode, 'rate_limited');
        return true;
      }
    );
    assert.equal(attempts, 2);
  });

  // 10. Network failure handling
  it('10. retries transient network failures and fails closed without fabricated fallback coupons', async () => {
    let attempts = 0;
    const service = new FeedicoPartnerService({
      envOverrides: {
        FEEDICO_ENABLED: 'true',
        FEEDICO_PARTNER_TOKEN: 'fdcp_valid_token_net_test',
      },
      maxRetries: 1,
      fetchFn: async () => {
        attempts++;
        throw new Error('ECONNRESET socket hang up');
      },
    });

    await assert.rejects(
      () => service.searchCoupons({ q: 'nike' }),
      (err: FeedicoServiceError) => {
        assert.equal(err.statusCode, 503);
        assert.equal(err.errorCode, 'network_failure');
        return true;
      }
    );
    assert.equal(attempts, 2);
  });

  // 11. Pagination handling
  it('11. traverses multiple pages when meta.hasMore is true and maxPages > 1', async () => {
    const requestedPages: number[] = [];
    const service = new FeedicoPartnerService({
      envOverrides: {
        FEEDICO_ENABLED: 'true',
        FEEDICO_PARTNER_TOKEN: 'fdcp_valid_token_page_test',
      },
      fetchFn: async (_input, init) => {
        const body = JSON.parse(String(init?.body || '{}'));
        requestedPages.push(body.page);
        const isFirstPage = body.page === 1;
        return new Response(
          JSON.stringify({
            coupons: [
              {
                id: isFirstPage ? 'c_page_1' : 'c_page_2',
                goSlug: '100',
                merchantName: 'Store',
                provider: 'cj_affiliate',
                code: isFirstPage ? 'CODE1' : 'CODE2',
                title: '10% off',
                endsAt: null,
                websiteUrl: 'https://store.com',
                countries: ['US'],
                goUrl: 'https://feedico.io/go/100?p=abc',
              },
            ],
            meta: {
              total: 2,
              limit: 1,
              offset: isFirstPage ? 0 : 1,
              hasMore: isFirstPage,
            },
          }),
          { status: 200 }
        );
      },
    });

    const result = await service.searchCoupons({ q: 'store', pageSize: 1, maxPages: 2 });
    assert.deepEqual(requestedPages, [1, 2]);
    assert.equal(result.offers.length, 2);
  });

  // 12. Duplicate offer handling
  it('12. deduplicates duplicate offer IDs across pages and in the normalized database store', async () => {
    const duplicateRow: FeedicoApiCouponRow = {
      id: 'dup_999',
      goSlug: '100',
      merchantName: 'Store',
      provider: 'cj_affiliate',
      code: 'DUP10',
      title: '10% off',
      endsAt: null,
      websiteUrl: 'https://store.com',
      countries: ['US'],
      goUrl: 'https://feedico.io/go/100?p=abc&c=DUP10',
    };

    const service = new FeedicoPartnerService({
      envOverrides: {
        FEEDICO_ENABLED: 'true',
        FEEDICO_PARTNER_TOKEN: 'fdcp_valid_token_dup_test',
      },
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            coupons: [duplicateRow, duplicateRow],
            meta: { total: 2, limit: 20, offset: 0, hasMore: false },
          }),
          { status: 200 }
        ),
    });

    const res = await service.searchCoupons({ q: 'store' });
    assert.equal(res.offers.length, 1);
    assert.equal(service.getCacheDiagnostics().totalCachedOffers, 1);
  });

  // 13. Cache refresh & staleness behavior
  it('13. serves cached offers within FEEDICO_CACHE_TTL, marks stale after TTL, and refreshes on bypassCache', async () => {
    let clockMs = 1_700_000_000_000;
    let fetchCalls = 0;

    const service = new FeedicoPartnerService({
      nowFn: () => clockMs,
      envOverrides: {
        FEEDICO_ENABLED: 'true',
        FEEDICO_PARTNER_TOKEN: 'fdcp_valid_token_cache_test',
        FEEDICO_CACHE_TTL: '60',
      },
      fetchFn: async () => {
        fetchCalls++;
        return new Response(
          JSON.stringify({
            coupons: [
              {
                id: 'cache_offer_1',
                goSlug: '200',
                merchantName: 'CacheStore',
                provider: 'admitad',
                code: 'FRESH15',
                title: '15% off',
                endsAt: null,
                websiteUrl: 'https://cachestore.com',
                countries: ['US'],
                goUrl: 'https://feedico.io/go/200?p=abc&c=FRESH15',
              },
            ],
            meta: { total: 1, limit: 20, offset: 0, hasMore: false },
          }),
          { status: 200 }
        );
      },
    });

    const first = await service.searchCoupons({ q: 'cachestore' });
    assert.equal(first.fromCache, false);
    assert.equal(fetchCalls, 1);

    // Advance 30s (within 60s TTL) -> cache hit
    clockMs += 30_000;
    const second = await service.searchCoupons({ q: 'cachestore' });
    assert.equal(second.fromCache, true);
    assert.equal(fetchCalls, 1);

    // Advance past 60s TTL -> stored offer is marked stale & new query fetches fresh data
    clockMs += 45_000;
    const staleCheck = service.getOfferById('cache_offer_1');
    assert.equal(staleCheck?.is_stale, true);

    const third = await service.searchCoupons({ q: 'cachestore' });
    assert.equal(third.fromCache, false);
    assert.equal(fetchCalls, 2);
  });

  // 14. Authorization and user isolation for affiliate click attribution
  it('14. isolates affiliate click attribution per authenticated Spark user and generates privacy-safe sub IDs', () => {
    const subAlice = buildOpaqueUserSubId('alice@example.com');
    const subBob = buildOpaqueUserSubId('bob@example.com');

    assert.equal(isValidFeedicoSubId(subAlice), true);
    assert.equal(subAlice.includes('@'), false);
    assert.equal(subAlice.includes('alice'), false);
    assert.notEqual(subAlice, subBob);

    const service = new FeedicoPartnerService();
    service.recordAffiliateClick({
      userId: 'user_alice',
      feedicoOfferId: '89166976',
      merchantId: '26471',
      merchantName: 'New Balance',
      couponCode: 'NBSALE15',
      goUrl: 'https://feedico.io/go/26471?p=6b303b82cc3ad98a&c=NBSALE15',
    });
    service.recordAffiliateClick({
      userId: 'user_bob',
      feedicoOfferId: '999999',
      merchantId: '104407',
      merchantName: 'Nike',
      couponCode: 'NIKE20',
      goUrl: 'https://feedico.io/go/104407?p=6b303b82cc3ad98a&c=NIKE20',
    });

    const aliceClicks = service.getUserAffiliateClicks('user_alice');
    const bobClicks = service.getUserAffiliateClicks('user_bob');

    assert.equal(aliceClicks.length, 1);
    assert.equal(aliceClicks[0].merchant_name, 'New Balance');
    assert.equal(aliceClicks[0].outcome_status, 'CLICK_RECORDED_NOT_PURCHASE');
    assert.equal(bobClicks.length, 1);
    assert.equal(bobClicks[0].merchant_name, 'Nike');
  });

  // 15. Affiliate tracking URL preservation & Commission Postback HMAC verification
  it('15. preserves original goUrl parameters (p, c, sku), validates same-domain deep links, and verifies HMAC postbacks', () => {
    const baseGoUrl = 'https://feedico.io/go/26471?p=6b303b82cc3ad98a&c=NBSALE15';

    // Same-domain deep link is attached, p and c are preserved, opaque sub is attached
    const trackedSameDomain = buildUserTrackedGoUrl({
      goUrl: baseGoUrl,
      userId: 'user_123',
      merchantWebsiteUrl: 'https://newbalance.cz/',
      deepLinkProductUrl: 'https://www.newbalance.cz/products/990v6',
    });
    const parsedSame = new URL(trackedSameDomain);
    assert.equal(parsedSame.searchParams.get('p'), '6b303b82cc3ad98a');
    assert.equal(parsedSame.searchParams.get('c'), 'NBSALE15');
    assert.equal(parsedSame.searchParams.get('sub'), buildOpaqueUserSubId('user_123'));
    assert.equal(parsedSame.searchParams.get('url'), 'https://www.newbalance.cz/products/990v6');

    // Off-site deep link domain is rejected (ignored) to protect affiliate attribution
    const trackedOffSite = buildUserTrackedGoUrl({
      goUrl: baseGoUrl,
      userId: 'user_123',
      merchantWebsiteUrl: 'https://newbalance.cz/',
      deepLinkProductUrl: 'https://malicious-site.example.com/phish',
    });
    const parsedOffSite = new URL(trackedOffSite);
    assert.equal(parsedOffSite.searchParams.get('url'), null);

    // Verify Commission Postback HMAC-SHA256 signature (X-Feedico-Signature)
    const secret = 'whsec_test_feedico_secret_key';
    const nowUnix = 1792224000;
    const rawBody = JSON.stringify({
      id: 'evt_1842',
      type: 'commission.approved',
      data: { commissionId: 912, status: 'approved', amount: 3.25, currency: 'USD' },
    });
    const validHmac = crypto
      .createHmac('sha256', secret)
      .update(`${nowUnix}.${rawBody}`)
      .digest('hex');

    const checkValid = verifyFeedicoPostbackSignature(
      rawBody,
      `t=${nowUnix},v1=${validHmac}`,
      secret,
      nowUnix + 30
    );
    assert.equal(checkValid.verified, true);

    // Replay older than 300s is rejected
    const checkReplay = verifyFeedicoPostbackSignature(
      rawBody,
      `t=${nowUnix},v1=${validHmac}`,
      secret,
      nowUnix + 600
    );
    assert.equal(checkReplay.verified, false);
  });

  // 16. Feedico Global Catalogue API token (fdco_) routing & normalization
  it('16. supports fdco_ Global Catalogue API tokens against https://api.feedico.io/api/v1/catalog/* and redacts fdco_ secrets', async () => {
    const fdcoCfg = getFeedicoConfig({
      FEEDICO_ENABLED: 'true',
      FEEDICO_PARTNER_TOKEN: 'fdco_test_catalog_token_1234567890abcdef',
    });
    assert.equal(fdcoCfg.configured, true);
    assert.equal(fdcoCfg.tokenMode, 'customer_catalog');
    assert.equal(fdcoCfg.baseUrl, 'https://api.feedico.io');

    const redacted = redactFeedicoSecrets('Token is fdco_test_catalog_token_1234567890abcdef');
    assert.equal(redacted.includes('fdco_test_catalog_token_1234567890abcdef'), false);

    const service = new FeedicoPartnerService({
      envOverrides: {
        FEEDICO_ENABLED: 'true',
        FEEDICO_PARTNER_TOKEN: 'fdco_test_catalog_token_1234567890abcdef',
      },
      fetchFn: async (input) => {
        const url = String(input);
        if (url === 'https://api.feedico.io/api/v1/catalog/coupons') {
          return new Response(
            JSON.stringify({
              ok: true,
              recordCount: 1,
              page: 1,
              pageSize: 20,
              availableProviders: ['cj_affiliate'],
              coupons: [
                {
                  id: 'coupon_8a7c176ae49818dd',
                  brandName: 'SwitchBot',
                  provider: 'cj_affiliate',
                  code: 'SWITCHBOT20OFF',
                  offerType: 'coupon',
                  countries: null,
                  title: 'SwitchBot 15% off Sitewide',
                  description: null,
                  startsAt: '2022-08-03T16:00:00.000Z',
                  endsAt: '2027-10-30T16:00:00.000Z',
                  merchantWebsiteUrl: 'http://www.switch-bot.com',
                  goUrl: 'https://feedico.io/go/5661292?p=XYIf5Ph5FebnAtv&c=SWITCHBOT20OFF&a=217',
                },
              ],
            }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({
            ok: true,
            recordCount: 1,
            page: 1,
            pageSize: 20,
            networks: [
              {
                id: 'firm_2d3ef4ecbaea279f',
                displayName: 'SwitchBot',
                merchantWebsiteUrl: 'http://www.switch-bot.com',
                providers: ['cj_affiliate'],
                couponCount: 6,
                goUrl: 'https://feedico.io/go/5661292?p=XYIf5Ph5FebnAtv&a=217',
              },
            ],
          }),
          { status: 200 }
        );
      },
    });

    const couponsRes = await service.searchCoupons({ q: 'SwitchBot' }, { userId: 'usr_1' });
    assert.equal(couponsRes.offers.length, 1);
    assert.equal(couponsRes.offers[0].coupon_code, 'SWITCHBOT20OFF');
    assert.equal(couponsRes.offers[0].merchant_id, '5661292');
    assert.equal(couponsRes.offers[0].discount.value, 15);
    assert.equal(couponsRes.partnerPublicId, 'XYIf5Ph5FebnAtv');

    const merchantsRes = await service.searchMerchants({ q: 'SwitchBot' });
    assert.equal(merchantsRes.merchants.length, 1);
    assert.equal(merchantsRes.merchants[0].go_slug, '5661292');
    assert.equal(merchantsRes.merchants[0].coupon_count, 6);
  });

  // 17. Explicit 6-State Integration Status, Quote Stripping, Fallback Aliases, and Runtime Credential Rotation
  it('17. reports accurate 6-state integrationState (MISSING_CONFIGURATION -> CONFIGURED_BUT_UNVERIFIED -> CONFIGURED_AND_VERIFIED) and supports runtime token rotation', async () => {
    // Missing configuration
    const missingService = new FeedicoPartnerService({
      envOverrides: { FEEDICO_ENABLED: 'true', FEEDICO_PARTNER_TOKEN: '' },
    });
    assert.equal(missingService.getStatus().integrationState, 'MISSING_CONFIGURATION');

    // Quoted token + Bearer prefix normalization
    const quotedCfg = getFeedicoConfig({
      FEEDICO_ENABLED: 'true',
      FEEDICO_PARTNER_TOKEN: '"Bearer fdcp_quoted_valid_token_123456"',
    });
    assert.equal(quotedCfg.configured, true);
    assert.equal(quotedCfg.partnerToken, 'fdcp_quoted_valid_token_123456');

    // Configured but unverified before first live request
    const rotatingService = new FeedicoPartnerService({
      envOverrides: {
        FEEDICO_ENABLED: 'true',
        FEEDICO_PARTNER_TOKEN: 'fdcp_token_version_one_123456',
      },
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            coupons: [],
            meta: { total: 0, limit: 5, offset: 0, hasMore: false },
            partnerPublicId: 'pub_v1',
          }),
          { status: 200 }
        ),
    });

    assert.equal(rotatingService.getStatus().integrationState, 'CONFIGURED_BUT_UNVERIFIED');

    // After live verification -> CONFIGURED_AND_VERIFIED (even on empty catalog response)
    const verifyRes = await rotatingService.verifyConnectivity({ q: 'laptop' });
    assert.equal(verifyRes.ok, true);
    assert.equal(verifyRes.status.integrationState, 'CONFIGURED_AND_VERIFIED');
    assert.equal(verifyRes.sampleCouponsCount, 0);

    // Rotate credential at runtime -> resets verification state back to CONFIGURED_BUT_UNVERIFIED
    rotatingService.setEnvOverrides({
      FEEDICO_ENABLED: 'true',
      FEEDICO_PARTNER_TOKEN: 'fdcp_token_version_two_999999',
    });
    assert.equal(rotatingService.getStatus().integrationState, 'CONFIGURED_BUT_UNVERIFIED');
    assert.equal(rotatingService.getStatus().partnerPublicId, null);
  });

  // 18. HTTP 403 Forbidden, Malformed JSON Response, and Request Timeout Error States
  it('18. handles HTTP 403 Forbidden, malformed non-JSON payloads without retry, and request timeouts with accurate integrationState', async () => {
    // HTTP 403 Forbidden -> INVALID_CREDENTIALS
    const service403 = new FeedicoPartnerService({
      envOverrides: {
        FEEDICO_ENABLED: 'true',
        FEEDICO_PARTNER_TOKEN: 'fdcp_expired_or_scoped_token_12345',
      },
      fetchFn: async () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    });

    await assert.rejects(
      () => service403.searchCoupons({ q: 'apple' }),
      (err: FeedicoServiceError) => {
        assert.equal(err.statusCode, 403);
        assert.equal(err.errorCode, 'forbidden_partner_token');
        return true;
      }
    );
    assert.equal(service403.getStatus().integrationState, 'INVALID_CREDENTIALS');

    // Malformed JSON response -> PROVIDER_UNAVAILABLE without retrying
    let malformedCalls = 0;
    const serviceMalformed = new FeedicoPartnerService({
      envOverrides: {
        FEEDICO_ENABLED: 'true',
        FEEDICO_PARTNER_TOKEN: 'fdcp_valid_token_malformed_test',
      },
      maxRetries: 2,
      fetchFn: async () => {
        malformedCalls++;
        return new Response('<html>502 Bad Gateway</html>', { status: 200 });
      },
    });

    await assert.rejects(
      () => serviceMalformed.searchCoupons({ q: 'sony' }),
      (err: FeedicoServiceError) => {
        assert.equal(err.statusCode, 502);
        assert.equal(err.errorCode, 'malformed_api_response');
        return true;
      }
    );
    assert.equal(malformedCalls, 1);
    assert.equal(serviceMalformed.getStatus().integrationState, 'PROVIDER_UNAVAILABLE');

    // Request timeout (AbortError) -> PROVIDER_UNAVAILABLE
    const serviceTimeout = new FeedicoPartnerService({
      envOverrides: {
        FEEDICO_ENABLED: 'true',
        FEEDICO_PARTNER_TOKEN: 'fdcp_valid_token_timeout_test',
      },
      timeoutMs: 25,
      maxRetries: 0,
      fetchFn: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const abortErr = new Error('The operation was aborted.');
            abortErr.name = 'AbortError';
            reject(abortErr);
          });
        }),
    });

    await assert.rejects(
      () => serviceTimeout.searchCoupons({ q: 'samsung' }),
      (err: FeedicoServiceError) => {
        assert.equal(err.statusCode, 503);
        assert.equal(err.errorCode, 'request_timeout');
        return true;
      }
    );
    assert.equal(serviceTimeout.getStatus().integrationState, 'PROVIDER_UNAVAILABLE');
  });

  // 19. Live Catalog Product Search & Normalization into Spark ProductOffer Schema
  it('19. retrieves products from /api/catalog/products and normalizes them into Spark ProductOffer records', async () => {
    const service = new FeedicoPartnerService({
      envOverrides: {
        FEEDICO_ENABLED: 'true',
        FEEDICO_PARTNER_TOKEN: 'fdcp_valid_catalog_product_token_123',
      },
      fetchFn: async (input) => {
        assert.equal(String(input), 'https://partner.feedico.io/api/catalog/products');
        return new Response(
          JSON.stringify({
            ok: true,
            recordCount: 1,
            nextCursor: null,
            partnerPublicId: '6b303b82cc3ad98a',
            products: [
              {
                id: 'prod_98765',
                firmName: 'Sony Direct',
                merchantKey: 'sony_direct',
                merchantDomain: 'electronics.sony.com',
                provider: 'cj_affiliate',
                externalProductId: 'WH1000XM5B',
                title: 'Sony WH-1000XM5 Wireless Noise-Canceling Headphones',
                description: 'Industry-leading noise cancellation with 30-hour battery life.',
                brand: 'Sony',
                sku: 'WH1000XM5/B',
                gtin: '027242923232',
                price: 399.99,
                salePrice: 329.99,
                discountPercentage: 18,
                currency: 'USD',
                availability: 'in_stock',
                countries: ['US'],
                thumbnailUrl: 'https://electronics.sony.com/images/xm5.jpg',
                goUrl: 'https://feedico.io/go/104407?p=6b303b82cc3ad98a&sku=WH1000XM5B',
              },
            ],
          }),
          { status: 200 }
        );
      },
    });

    const result = await service.searchNormalizedProducts(
      { q: 'Sony WH-1000XM5', pageSize: 10 },
      { userId: 'usr_spark_tester' }
    );
    assert.equal(result.offers.length, 1);
    const offer = result.offers[0];
    assert.equal(offer.id, 'feedico_prod_prod_98765');
    assert.equal(offer.sourceId, 'feedico_partner_api');
    assert.equal(offer.name, 'Sony WH-1000XM5 Wireless Noise-Canceling Headphones');
    assert.equal(offer.merchant, 'Sony Direct');
    assert.equal(offer.price, 329.99);
    assert.equal(offer.priceStatus, 'verified');
    assert.equal(offer.availabilityStatus, 'verified_in_stock');
    assert.equal(offer.canonicalUrl.includes('feedico.io/go/104407'), true);
    assert.equal(offer.canonicalUrl.includes('sub='), true);
    assert.equal(service.getStatus().integrationState, 'CONFIGURED_AND_VERIFIED');
  });
});

