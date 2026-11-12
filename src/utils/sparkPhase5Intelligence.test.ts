import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAdaptiveExpansionQueries,
  buildSpokenResponseSummary,
  classifyOrchestrationTask,
  clearDiscoveryCache,
  detectVoiceLanguage,
  executeDeduplicatedDiscovery,
  executePhase5SevenAgentOrchestrator,
  extractConstraintHierarchy,
  getPhase5ObservabilitySummary,
  normalizeDiscoveryCacheKey,
  normalizeVoiceQuery,
  parseNaturalLanguageCartCommand,
  runOmegaDecisionCrucible,
  runPhase5TwelveScenarioEvaluationSuite,
  runPreResponseAntiHallucinationAudit,
  validateSpecialistAgentContract,
} from './sparkPhase5Intelligence.ts';
import { PayPalSandboxEngine } from './paypalSandboxService.ts';
import type { RankedProductOffer } from '../types/spark.ts';

const paypalSandboxService = new PayPalSandboxEngine();

function buildSampleOffer(overrides: Partial<RankedProductOffer> = {}): RankedProductOffer {
  return {
    id: 'ch3_test_macbook_pro_m3',
    sourceId: 'channel3_api',
    sourceName: 'Channel3 Product Graph API',
    canonicalUrl: 'https://www.apple.com/macbook-pro/',
    retrievedAt: new Date().toISOString(),
    verificationStatus: 'verified_live_source',
    name: 'Apple MacBook Pro 16-inch M3 Max (36GB Unified Memory, 1TB SSD)',
    brand: 'Apple',
    category: 'Laptops & Computing',
    merchant: 'Apple Authorized Store',
    price: 1699,
    priceStatus: 'verified',
    currency: 'USD',
    shippingCost: 0,
    shippingStatus: 'free',
    estimatedTaxRate: null,
    taxStatus: 'unknown',
    availabilityStatus: 'verified_in_stock',
    availability: 'in_stock',
    rating: 4.9,
    reviewCount: 412,
    ratingStatus: 'verified',
    summary: 'Verified 16-inch Liquid Retina XDR laptop with Apple M3 Max, 36GB RAM, and 1TB NVMe SSD.',
    specs: {
      Brand: 'Apple',
      Model: 'MacBook Pro 16 M3 Max',
      Processor: 'Apple M3 Max 14-Core CPU',
      Memory: '36GB Unified RAM',
      Storage: '1TB PCIe NVMe SSD',
      Display: '16.2-inch Liquid Retina XDR (3456 x 2234) 120Hz',
      Battery: 'Up to 22 hours battery life',
      Weight: '4.7 lbs (2.14 kg)',
      Warranty: '1-Year Apple Limited Warranty',
    },
    pros: ['36GB Unified RAM', '1TB NVMe SSD'],
    cons: ['4.7 lbs chassis'],
    whyRecommended: 'Exceeds 32GB RAM requirement with 36GB Unified RAM under $1,800 budget.',
    valueScore: 91,
    trustScore: 95,
    relevanceScore: 96,
    overallScore: 94,
    couponStatus: 'no_verified_coupon',
    checkoutStatus: 'supported_paypal',
    imageUrl: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800',
    bestCoupon: null,
    couponDiscountAmount: 0,
    netItemPrice: 1699,
    withinBudget: true,
    completenessScore: 94,
    ...overrides,
  };
}

describe('Phase 5: Seven-Agent Orchestration, Omega Decision Crucible, Cart & Voice Intelligence', () => {
  it('1. Validates all 7 specialist agent contracts and enforces schema integrity', async () => {
    const hierarchy = extractConstraintHierarchy(
      'Find a laptop under $1,800 with at least 32GB RAM and 1TB SSD for software engineering',
      []
    );
    const offer1 = buildSampleOffer();
    const offer2 = buildSampleOffer({
      id: 'ch3_test_thinkpad_p1',
      name: 'Lenovo ThinkPad P1 Gen 6 Workstation (32GB DDR5 RAM, 1TB SSD)',
      brand: 'Lenovo',
      merchant: 'Lenovo Official Store',
      price: 1599,
      overallScore: 89,
      rating: 4.7,
      reviewCount: 195,
      specs: {
        Brand: 'Lenovo',
        Model: 'ThinkPad P1 Gen 6',
        Processor: 'Intel Core i7-13800H',
        Memory: '32GB DDR5 RAM',
        Storage: '1TB NVMe SSD',
        Display: '16-inch WQXGA IPS 165Hz',
        Weight: '3.92 lbs',
      },
    });

    const orchestration = await executePhase5SevenAgentOrchestrator({
      orchestrationId: 'test_orch_1',
      prompt: 'Find a laptop under $1,800 with at least 32GB RAM and 1TB SSD for software engineering',
      conversationTurns: [],
      offers: [offer1, offer2],
      coupons: [],
      sourceReports: [
        {
          sourceId: 'channel3_api',
          sourceName: 'Channel3 Live Product Graph',
          configured: true,
          queried: true,
          status: 'verified_ok',
          resultCount: 2,
          explicitStateMessage: 'Channel3 returned 2 verified offers.',
          retrievedAt: new Date().toISOString(),
        },
      ],
      report: null,
    });

    assert.equal(orchestration.agentContracts.length, 7, 'Must produce exactly 7 specialist agent contracts');
    for (const contract of orchestration.agentContracts) {
      const validation = validateSpecialistAgentContract(contract);
      assert.equal(
        validation.valid,
        true,
        `Agent ${contract.agentIdentity} contract failed validation: ${validation.errors.join(', ')}`
      );
      assert.ok(contract.confidence >= 0 && contract.confidence <= 100);
    }

    assert.equal(orchestration.omegaCrucible.verdict, 'STRONG_RECOMMENDATION');
    assert.ok(orchestration.omegaCrucible.decisionConfidence >= 75);
    assert.equal(orchestration.omegaCrucible.paretoFrontierProductIds.includes(offer1.id), true);
    assert.equal(hierarchy.detectedContradictions.length, 0);
  });

  it('2. Detects impossible contradictory constraints and halts unsafe guessing', () => {
    const hierarchy = extractConstraintHierarchy(
      'Find a brand new MacBook Pro M3 Max under $150 with 64GB RAM',
      []
    );
    assert.ok(hierarchy.detectedContradictions.length > 0, 'Must detect impossible budget contradiction');
    assert.ok(hierarchy.detectedContradictions[0].resolutionQuestion.length > 10);
  });

  it('3. Evaluates mandatory requirements as satisfied, failed, or unknown without Silent Pass', async () => {
    const failingOffer = buildSampleOffer({
      id: 'ch3_failing_offer',
      name: 'Generic Ultrabook 15 (16GB RAM)',
      price: 1750,
      summary: 'Everyday 15-inch laptop with 16GB RAM.',
      specs: {
        Brand: 'Generic',
        Processor: 'Intel Core i5',
        Memory: '16GB RAM',
        // Storage is missing -> must be 'unknown', never silently 'satisfied'
      },
    });

    const orchestration = await executePhase5SevenAgentOrchestrator({
      orchestrationId: 'test_orch_fail',
      prompt: 'Find a laptop under $1,500 with 32GB RAM and 1TB SSD',
      offers: [failingOffer],
      coupons: [],
      sourceReports: [],
      report: null,
    });

    assert.equal(orchestration.omegaCrucible.verdict, 'REQUIREMENTS_NOT_SATISFIED');
    const checks = orchestration.omegaCrucible.mandatoryRequirementChecks;
    assert.ok(checks.length >= 2);
    const ramCheck = checks.find((c) => c.requirement.includes('RAM'));
    const storageCheck = checks.find((c) => c.requirement.includes('Storage'));
    assert.equal(ramCheck?.status, 'failed');
    assert.equal(storageCheck?.status, 'unknown');
  });

  it('4. Pre-response anti-hallucination audit verifies exact price and rating alignment', () => {
    const offer = buildSampleOffer();
    const audit = runPreResponseAntiHallucinationAudit(null, [offer]);
    assert.equal(audit.passed, true);
    assert.equal(audit.strippedUnsupportedClaims.length, 0);
  });

  it('5. Parses natural-language Cart commands and executes multi-step Cart operations safely', async () => {
    const testUserId = `phase5_cart_test_user_${Date.now()}`;

    const offer1 = buildSampleOffer({
      id: 'ch3_cart_sony_xm5',
      name: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones',
      brand: 'Sony',
      category: 'Audio & Headphones',
      merchant: 'Best Buy',
      price: 348,
      netItemPrice: 348,
    });
    const offer2 = buildSampleOffer({
      id: 'ch3_cart_bose_qc_ultra',
      name: 'Bose QuietComfort Ultra Wireless Headphones',
      brand: 'Bose',
      category: 'Audio & Headphones',
      merchant: 'Crutchfield',
      price: 379,
      netItemPrice: 379,
    });

    // Step 1: Add product to cart
    const addCmd = parseNaturalLanguageCartCommand('Add this product to my cart');
    assert.equal(addCmd.isShoppingCommand, true);
    assert.equal(addCmd.actionType, 'add_to_cart');

    const addRes = paypalSandboxService.executeAgentShoppingAction({
      userId: testUserId,
      action: 'add_to_cart',
      product: offer1,
      quantity: 1,
    });
    assert.ok(addRes);
    assert.equal(addRes.action, 'add_to_cart');
    assert.equal(addRes.autoAuthorized, false);
    assert.equal(addRes.cart?.itemCount, 1);

    // Step 2: Update quantity to 2
    const qtyCmd = parseNaturalLanguageCartCommand('Change the quantity to 2');
    assert.equal(qtyCmd.actionType, 'update_cart_quantity');
    assert.equal(qtyCmd.quantity, 2);

    const qtyRes = paypalSandboxService.executeAgentShoppingAction({
      userId: testUserId,
      action: 'update_cart_quantity',
      quantity: 2,
    });
    assert.ok(qtyRes);
    assert.equal(qtyRes.action, 'update_cart_quantity');
    assert.equal(qtyRes.cart?.itemCount, 2);
    assert.equal(qtyRes.cart?.subtotal, 696);

    // Step 3: Compare Cart with alternative
    const cmpCmd = parseNaturalLanguageCartCommand('Compare my cart with Bose QuietComfort Ultra');
    assert.equal(cmpCmd.actionType, 'compare_with_cart');

    const cmpRes = paypalSandboxService.executeAgentShoppingAction({
      userId: testUserId,
      action: 'compare_with_cart',
      product: offer2,
    });
    assert.ok(cmpRes);
    assert.equal(cmpRes.action, 'compare_with_cart');
    assert.ok(cmpRes.comparedAlternative);

    // Step 4: Check whether any price has changed / revalidate cart prices
    const revalCmd = parseNaturalLanguageCartCommand('Check whether any price has changed in my cart');
    assert.equal(revalCmd.actionType, 'revalidate_cart_prices');

    const revalRes = paypalSandboxService.executeAgentShoppingAction({
      userId: testUserId,
      action: 'revalidate_cart_prices',
    });
    assert.ok(revalRes);
    assert.equal(revalRes.action, 'revalidate_cart_prices');
    assert.equal(revalRes.requiresExplicitUserConsent, true);

    // Step 5: Query final payable amount
    const payCmd = parseNaturalLanguageCartCommand('What is my final payable amount?');
    assert.equal(payCmd.actionType, 'query_payable_amount');

    const payRes = paypalSandboxService.executeAgentShoppingAction({
      userId: testUserId,
      action: 'query_payable_amount',
    });
    assert.ok(payRes);
    assert.equal(payRes.action, 'query_payable_amount');
    assert.equal(payRes.orderSummary?.subtotal, 696);

    // Step 6: Remove previous item from cart
    const remCmd = parseNaturalLanguageCartCommand('Remove the previous item from my cart');
    assert.equal(remCmd.actionType, 'remove_from_cart');

    const remRes = paypalSandboxService.executeAgentShoppingAction({
      userId: testUserId,
      action: 'remove_from_cart',
    });
    assert.ok(remRes);
    assert.equal(remRes.action, 'remove_from_cart');
    assert.equal(paypalSandboxService.getUserCart(testUserId).itemCount, 0);
  });

  it('6. Normalizes multilingual Voice Mode queries (English & Arabic) and enforces voice purchase safeguards', () => {
    const enVoice = normalizeVoiceQuery(
      'find me a mac book pro under five hundred dollars',
      'en-US'
    );
    assert.equal(enVoice.detectedLanguage, 'en-US');
    assert.ok(enVoice.normalizedTranscript.includes('MacBook'));
    assert.ok(enVoice.normalizedTranscript.includes('$500'));
    assert.equal(enVoice.extractedEntities.requiresVoicePurchaseConfirmation, false);

    const arVoice = normalizeVoiceQuery('ابحث عن سماعات سوني تحت خمسمائة دولار', 'ar-SA');
    assert.equal(arVoice.detectedLanguage, 'ar-SA');
    assert.ok(arVoice.normalizedTranscript.includes('$500'));

    const buyVoice = normalizeVoiceQuery('buy the Sony WH-1000XM5 right now', 'en-US');
    assert.equal(buyVoice.extractedEntities.requiresVoicePurchaseConfirmation, true);
    assert.ok(buyVoice.extractedEntities.voiceConfirmationPrompt);

    const spoken = buildSpokenResponseSummary({
      coordinatorMessage: 'Top recommendation: Apple MacBook Pro 16-inch M3 Max at $1,699.00.',
    });
    assert.ok(spoken.includes('Apple MacBook Pro'));
  });

  it('7. Deduplicates concurrent identical Channel3 discovery requests and reuses short-TTL cache', async () => {
    clearDiscoveryCache();
    let upstreamCalls = 0;
    const sampleOffer = buildSampleOffer();
    const key = normalizeDiscoveryCacheKey('Sony WH-1000XM5', 'Audio & Headphones', 400, 'USD');

    const fetcher = async () => {
      upstreamCalls += 1;
      await new Promise((r) => setTimeout(r, 25));
      return {
        offers: [sampleOffer],
        sourceReports: [
          {
            sourceId: 'channel3_api',
            sourceName: 'Channel3 Product Graph API',
            configured: true,
            queried: true,
            status: 'verified_ok' as const,
            resultCount: 1,
            explicitStateMessage: 'OK',
            retrievedAt: new Date().toISOString(),
          },
        ],
      };
    };

    // Launch two concurrent identical calls
    const [res1, res2] = await Promise.all([
      executeDeduplicatedDiscovery(key, fetcher),
      executeDeduplicatedDiscovery(key, fetcher),
    ]);

    assert.equal(upstreamCalls, 1, 'Concurrent identical queries must share a single upstream execution');
    assert.equal(res1.offers.length, 1);
    assert.equal(res2.offers.length, 1);

    // Subsequent call within TTL must hit cache
    const res3 = await executeDeduplicatedDiscovery(key, fetcher);
    assert.equal(res3.fromCache, true);
    assert.equal(upstreamCalls, 1, 'Repeated query within TTL must reuse verified cache');
  });

  it('8. Executes all 12 required Phase 5 evaluation scenarios (Scenarios A through L) with 100% PASS status', async () => {
    const suite = await runPhase5TwelveScenarioEvaluationSuite();
    assert.equal(suite.totalScenarios, 12, 'Must evaluate all 12 required Phase 5 scenarios (A-L)');

    for (const scenario of suite.scenarios) {
      assert.equal(
        scenario.status,
        'PASS',
        `${scenario.scenarioId} (${scenario.title}) did not PASS: ${scenario.actualOutcome}`
      );
    }
    assert.equal(suite.allPassed, true, 'All 12 Phase 5 scenarios must pass');
    assert.equal(suite.passedCount, 12);

    const observability = getPhase5ObservabilitySummary();
    assert.ok(observability.totalOrchestrationsTracked >= 1);
    assert.equal(observability.hallucinationPreventionPassRatePercent, 100);
  });

  it('9. Classifies orchestration tasks and builds adaptive expansion queries accurately', () => {
    const hierarchy = extractConstraintHierarchy('Compare MacBook Pro vs Lenovo ThinkPad', []);
    const task1 = classifyOrchestrationTask('Compare MacBook Pro vs Lenovo ThinkPad', hierarchy, false);
    assert.equal(task1, 'product_comparison');

    const task2 = classifyOrchestrationTask('Add to my cart', hierarchy, false);
    assert.equal(task2, 'cart_operation');

    const queries = buildAdaptiveExpansionQueries('Samsung Bespoke refrigerator under $2000', hierarchy);
    assert.ok(queries.length >= 2);
  });
});
