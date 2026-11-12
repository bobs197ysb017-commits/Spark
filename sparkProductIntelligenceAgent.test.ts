import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectCategoryFromText,
  detectPurchasingMarket,
  getRelevantConversationHistory,
  assessRequirementCompleteness,
  formulateResearchStrategy,
  deduplicateProductsAndGroupMerchantOffers,
  buildBroadenedDiscoveryQuery,
  classifyProductEvidence,
  calculateProductEvidenceCoverage,
  buildPriceAccuracyBreakdown,
  isDetailedAnalysisRequested,
  computeExplainableCriterionScores,
  deriveCategoryAdaptiveSpecs,
  runFinalReportConsistencyAudit,
  evaluateProductsAndRank,
  synthesizeAutonomousIntelligenceReport,
  executeSparkProductIntelligenceAgent,
  buildAdaptiveCustomerSummary,
} from './sparkProductIntelligenceAgent.ts';
import {
  getCleanUserFacingSpecs,
  isInternalMetadataSpecKey,
  sanitizeUserFacingAttributeValue,
} from './productPresentationSanitizer.ts';
import type { ProductOffer, CouponItem, SourceExecutionReport } from '../types/spark.ts';

test('1. formulateResearchStrategy extracts category, budget, and cleans queries', () => {
  const strategy1 = formulateResearchStrategy({
    prompt: 'Find best wireless noise-cancelling headphones under $350',
  });
  assert.equal(strategy1.category, 'Audio & Acoustics');
  assert.equal(strategy1.targetBudget, 350);
  assert.equal(strategy1.currency, 'USD');
  assert.ok(strategy1.featurePriorities.includes('Active Noise Cancellation'));
  assert.ok(!strategy1.searchQuery.includes('under $350'));

  const strategy2 = formulateResearchStrategy({
    prompt: 'Compare lightweight laptops under 1200 EUR for programming',
  });
  assert.equal(strategy2.category, 'Laptops & Computing');
  assert.equal(strategy2.targetBudget, 1200);
  assert.equal(strategy2.currency, 'EUR');
  assert.ok(strategy2.featurePriorities.includes('Weight & Portability'));
});

test('2. formulateResearchStrategy preserves multi-turn budget and context', () => {
  const followUpStrategy = formulateResearchStrategy({
    prompt: 'Which one has better battery life and active noise cancellation?',
    previousPrompts: [
      'Find premium wireless headphones under $400',
    ],
  });
  // Should inherit category and budget from previous prompt
  assert.equal(followUpStrategy.category, 'Audio & Acoustics');
  assert.equal(followUpStrategy.targetBudget, 400);
  assert.ok(followUpStrategy.featurePriorities.includes('Battery Life & Portability'));
});

function createTestOffer(partial: Partial<ProductOffer> & { id: string; name: string }): ProductOffer {
  return {
    sourceId: 'channel3_api',
    sourceName: 'Channel3 Product Graph API',
    merchant: 'Test Merchant',
    category: 'electronics',
    price: 199.99,
    priceStatus: 'verified',
    currency: 'USD',
    canonicalUrl: `https://example.com/products/${partial.id}`,
    imageUrl: null,
    availabilityStatus: 'verified_in_stock',
    checkoutStatus: 'supported_paypal',
    retrievedAt: new Date().toISOString(),
    verificationStatus: 'verified_live_source',
    shippingCost: null,
    shippingStatus: 'unknown',
    estimatedTaxRate: null,
    taxStatus: 'unknown',
    rating: 4.5,
    reviewCount: 20,
    summary: 'Test summary',
    specs: {},
    couponStatus: 'no_verified_coupon',
    ...partial,
  };
}

test('3. evaluateProductsAndRank strictly scores products using verified evidence', () => {
  const sampleOffers: ProductOffer[] = [
    createTestOffer({
      id: 'prod_1',
      name: 'Sony WH-1000XM5 Noise-Canceling Headphones',
      merchant: 'Best Buy',
      price: 329.99,
      canonicalUrl: 'https://www.bestbuy.com/site/sony-wh1000xm5/1234.p',
      imageUrl: 'https://images.bestbuy.com/sony.jpg',
      rating: 4.8,
      reviewCount: 320,
    }),
    createTestOffer({
      id: 'prod_2',
      name: 'Expensive Studio Pro Headphones',
      merchant: 'AudioShop',
      price: 599.99, // Over budget ($350)
      checkoutStatus: 'checkout_unsupported',
      rating: 4.5,
      reviewCount: 50,
    }),
    createTestOffer({
      id: 'prod_3',
      name: 'Unverified Price Headphones',
      merchant: 'GenericRetail',
      price: null, // Price unverified
      priceStatus: 'price_could_not_be_verified',
      availabilityStatus: 'unknown',
      checkoutStatus: 'checkout_unsupported',
      rating: null,
      reviewCount: null,
    }),
  ];

  const strategy = formulateResearchStrategy({
    prompt: 'Best headphones under $350',
  });

  const ranked = evaluateProductsAndRank(sampleOffers, [], strategy);
  assert.equal(ranked.length, 3);
  // Prod 1 is within budget, in stock, high rating -> should be Rank 1
  assert.equal(ranked[0].id, 'prod_1');
  assert.ok((ranked[0].completenessScore || 0) > (ranked[1].completenessScore || 0));
  // Prod 2 exceeded budget -> penalized
  assert.ok((ranked[0].completenessScore || 0) > (ranked[2].completenessScore || 0));
});

test('4. synthesizeAutonomousIntelligenceReport generates a complete premium report structure', async () => {
  const strategy = formulateResearchStrategy({
    prompt: 'Clean Architecture software engineering books',
  });
  const sampleOffers: ProductOffer[] = [
    createTestOffer({
      id: 'book_1',
      sourceId: 'openlibrary_api',
      sourceName: 'Open Library Catalog API',
      name: "Clean Architecture: A Craftsman's Guide to Software Structure and Design",
      merchant: 'Open Library',
      category: 'books',
      price: 34.99,
      canonicalUrl: 'https://openlibrary.org/works/OL17860744W',
      imageUrl: 'https://covers.openlibrary.org/b/id/8231990-M.jpg',
      rating: 4.9,
    }),
  ];
  const ranked = evaluateProductsAndRank(sampleOffers, [], strategy);
  const sourceReports: SourceExecutionReport[] = [
    {
      sourceId: 'openlibrary_api',
      sourceName: 'Open Library Catalog API',
      configured: true,
      queried: true,
      status: 'verified_ok',
      explicitStateMessage: 'Retrieved 1 verified catalog record.',
      resultCount: 1,
      retrievedAt: new Date().toISOString(),
    },
  ];

  const { report, coordinatorMessage } = await synthesizeAutonomousIntelligenceReport(
    { prompt: 'Clean Architecture software engineering books' },
    strategy,
    ranked,
    [],
    sourceReports,
    null
  );

  assert.ok(report.reportId.startsWith('report_'));
  assert.ok(report.executiveSummary.length > 20);
  assert.equal(report.rankedProducts.length, 1);
  assert.equal(report.rankedProducts[0].name, sampleOffers[0].name);
  assert.equal(report.finalRecommendation.recommendedProductId, 'book_1');
  assert.equal(report.sourceCitations.length, 1);
  assert.ok(coordinatorMessage.includes('Clean Architecture'));
});

test('5. executeSparkProductIntelligenceAgent executes end-to-end pipeline honestly', async () => {
  const result = await executeSparkProductIntelligenceAgent({
    prompt: 'laptop for programming under $1200',
    preferredName: 'Alice',
  });

  assert.equal(result.needsClarification, false);
  assert.ok(result.report);
  assert.ok(result.report.query);
  assert.ok(result.sourceReports.length >= 1);
  assert.ok(Array.isArray(result.offers));
  assert.ok(result.coordinatorMessage.length > 0);
  // Source citation timestamps must be valid ISO dates
  for (const citation of result.report.sourceCitations) {
    assert.ok(!isNaN(Date.parse(citation.timestamp)));
  }
});

test('6. assessRequirementCompleteness detects ambiguous queries and generates focused clarification', () => {
  // Broad laptop request without workload or budget
  const laptopCheck = assessRequirementCompleteness({ prompt: 'I want a laptop' });
  assert.equal(laptopCheck.hasSufficientContext, false);
  assert.ok(laptopCheck.clarification);
  assert.ok(laptopCheck.clarification.question.includes('primarily use'));
  assert.ok(laptopCheck.clarification.whyItMatters.length > 20);
  assert.ok(laptopCheck.clarification.options && laptopCheck.clarification.options.length >= 3);
  assert.ok(laptopCheck.clarificationSuggestions && laptopCheck.clarificationSuggestions.length >= 3);

  // Broad audio request without form factor or environment
  const audioCheck = assessRequirementCompleteness({ prompt: 'recommend headphones' });
  assert.equal(audioCheck.hasSufficientContext, false);
  assert.ok(audioCheck.clarification);
  assert.ok(audioCheck.clarification.question.includes('use case'));

  // Specific model request has sufficient context directly
  const specificCheck = assessRequirementCompleteness({ prompt: 'MacBook Pro M3' });
  assert.equal(specificCheck.hasSufficientContext, true);

  // Specific query with category + workload + budget has sufficient context directly
  const completeCheck = assessRequirementCompleteness({ prompt: 'laptop for programming under $1500' });
  assert.equal(completeCheck.hasSufficientContext, true);
});

test('7. executeSparkProductIntelligenceAgent halts search and returns clarification for underspecified requests', async () => {
  const result = await executeSparkProductIntelligenceAgent({
    prompt: 'I want a laptop',
    preferredName: 'Jordan',
  });

  // Must halt prior to running live catalog search
  assert.equal(result.needsClarification, true);
  assert.equal(result.report, null);
  assert.equal(result.offers.length, 0);
  assert.ok(result.clarification);
  assert.ok(result.clarification.question.length > 10);
  assert.ok(result.clarification.whyItMatters.length > 20);
  assert.ok(result.coordinatorMessage.includes('Jordan'));
  assert.ok(result.coordinatorMessage.includes(result.clarification.question));
  assert.ok(Array.isArray(result.clarificationSuggestions) && result.clarificationSuggestions.length > 0);
});

test('8. Multi-turn context preservation answers clarification without redundant re-asking', async () => {
  // Turn 2: User provides workload and specs in response to previous clarification
  const turn2Input = {
    prompt: 'Software development and Docker with 32GB RAM under $1600',
    previousPrompts: ['I want a laptop'],
    preferredName: 'Jordan',
  };

  const check = assessRequirementCompleteness(turn2Input);
  assert.equal(check.hasSufficientContext, true);

  const result = await executeSparkProductIntelligenceAgent(turn2Input);
  assert.equal(result.needsClarification, false);
  assert.ok(result.report);
  assert.equal(result.report.category, 'Laptops & Computing');
});

test('9. ZERO CHEAPEST-PRICE BIAS: High-performance suitable product beats underpowered cheap product within budget', () => {
  // Strategy: Programming laptop under $1200
  const strategy = formulateResearchStrategy({
    prompt: 'laptop for programming under $1200 with 32GB RAM',
  });

  const developerLaptop = createTestOffer({
    id: 'dev_pro_laptop',
    name: 'ProWorkstation Developer Laptop 32GB RAM i7',
    summary: 'High-performance multicore developer workstation with 32GB RAM and 1TB SSD for heavy compiling and containers.',
    merchant: 'TechDirect',
    price: 1150.0, // Near budget cap of $1200
    rating: 4.9,
    reviewCount: 140,
    availabilityStatus: 'verified_in_stock',
  });

  const cheapNetbook = createTestOffer({
    id: 'cheap_netbook',
    name: 'Basic Budget Netbook 4GB RAM',
    summary: 'Low-cost netbook suitable for light web browsing and text notes.',
    merchant: 'DiscountStore',
    price: 189.99, // Extremely cheap ($189.99 vs $1150)
    rating: 3.6,
    reviewCount: 18,
    availabilityStatus: 'verified_in_stock',
  });

  const ranked = evaluateProductsAndRank([cheapNetbook, developerLaptop], [], strategy);

  assert.equal(ranked.length, 2);
  // Developer laptop MUST rank #1 because it fulfills the workload and specification requirements
  // Lowest price must NEVER displace the suitable, superior product!
  assert.equal(ranked[0].id, 'dev_pro_laptop');
  assert.equal(ranked[1].id, 'cheap_netbook');
  assert.ok(
    (ranked[0].completenessScore || 0) > (ranked[1].completenessScore || 0),
    `Developer laptop score (${ranked[0].completenessScore}) must exceed cheap netbook score (${ranked[1].completenessScore})`
  );
});

test('10. COMPREHENSIVE INTELLIGENCE UPGRADE: Verifies 10-section report, visual analytics, gallery images, and adaptive matrix', async () => {
  const strategy = formulateResearchStrategy({
    prompt: 'Compare high-end developer laptops under $2500',
  });

  const laptopA = createTestOffer({
    id: 'lap_a',
    name: 'MacBook Pro 16 M3 Max 36GB',
    brand: 'Apple',
    merchant: 'B&H Photo',
    price: 2499.0,
    rating: 4.9,
    reviewCount: 310,
    imageUrl: 'https://example.com/macbook-1.jpg',
    galleryImages: [
      'https://example.com/macbook-1.jpg',
      'https://example.com/macbook-2.jpg',
      'https://example.com/macbook-3.jpg',
    ],
    specs: {
      Processor: 'Apple M3 Max (14-core CPU)',
      RAM: '36GB Unified',
      Storage: '1TB SSD',
      Display: '16.2" Liquid Retina XDR',
    },
  });

  const laptopB = createTestOffer({
    id: 'lap_b',
    name: 'Dell XPS 16 OLED i9 32GB',
    brand: 'Dell',
    merchant: 'Dell Direct',
    price: 2299.0,
    rating: 4.7,
    reviewCount: 180,
    imageUrl: 'https://example.com/xps-1.jpg',
    galleryImages: [
      'https://example.com/xps-1.jpg',
      'https://example.com/xps-2.jpg',
    ],
    specs: {
      Processor: 'Intel Core Ultra 9 185H',
      RAM: '32GB LPDDR5X',
      Storage: '1TB NVMe SSD',
      Display: '16.3" 4K+ OLED Touch',
    },
  });

  const ranked = evaluateProductsAndRank([laptopA, laptopB], [], strategy);
  const sourceReports: SourceExecutionReport[] = [
    {
      sourceId: 'channel3_api',
      sourceName: 'Channel3 Live Product Graph API',
      configured: true,
      queried: true,
      status: 'verified_ok',
      explicitStateMessage: 'Retrieved 2 live merchant offers.',
      resultCount: 2,
      retrievedAt: new Date().toISOString(),
    },
  ];

  const { report, coordinatorMessage } = await synthesizeAutonomousIntelligenceReport(
    { prompt: 'Compare high-end developer laptops under $2500' },
    strategy,
    ranked,
    [],
    sourceReports,
    null
  );

  // 1. 10-Section Intelligence Verification
  assert.ok(report.reportId.startsWith('report_'));
  assert.ok(report.executiveSummary.length > 50);
  assert.ok(report.researchFindings, 'Must include researchFindings');
  assert.equal(report.researchFindings?.recordsEvaluated, 2);
  assert.ok(report.researchFindings?.confidenceAssessment);

  // 2. Rich Product Verification
  assert.equal(report.rankedProducts.length, 2);
  const firstProd = report.rankedProducts[0];
  assert.ok(firstProd.galleryImages && firstProd.galleryImages.length >= 2, 'Must include galleryImages');
  assert.ok(firstProd.technicalAnalysis, 'Must include technicalAnalysis');
  assert.ok(firstProd.commercialAnalysis, 'Must include commercialAnalysis');
  assert.ok(firstProd.risksAndLimitations && firstProd.risksAndLimitations.length > 0, 'Must include risksAndLimitations');
  assert.ok(firstProd.suitabilityExplanation, 'Must include suitabilityExplanation');
  assert.ok(firstProd.dimensionsBreakdown, 'Must include dimensionsBreakdown');
  assert.ok(firstProd.dimensionsBreakdown?.performance > 0);
  assert.ok(firstProd.dimensionsBreakdown?.value > 0);
  assert.ok(firstProd.dimensionsBreakdown?.buildQuality > 0);

  // 3. Dynamic Matrix with Winner Highlights
  assert.ok(report.comparisonMatrix.rows.length >= 3);
  const winnerRows = report.comparisonMatrix.rows.filter((r) => r.winnerProductId || r.winnerHighlight);
  assert.ok(winnerRows.length > 0, 'Comparison matrix must contain winner highlights');

  // 4. Real Visualizations
  assert.ok(report.visualizations, 'Must include visualizations');
  assert.ok(report.visualizations?.priceComparison && report.visualizations.priceComparison.length === 2);
  assert.ok(report.visualizations?.capabilityComparison && report.visualizations.capabilityComparison.length === 2);

  // 5. Final Recommendation Details
  assert.ok(report.finalRecommendation.whoShouldBuy);
  assert.ok(report.finalRecommendation.whoShouldSkip);
  assert.ok(report.finalRecommendation.bestFor);
  assert.ok(coordinatorMessage.length > 50);
});

test('11. COMPLETE CHEAPEST-PRICE REMOVAL: Requirement-driven recommendations win over cheaper alternatives', async () => {
  // A. Ambiguous request triggers focused clarification on intended usage
  const tabletCheck = assessRequirementCompleteness({ prompt: 'I want a tablet' });
  assert.equal(tabletCheck.hasSufficientContext, false);
  assert.ok(tabletCheck.clarification);
  assert.ok(tabletCheck.clarification.question.includes('primary use case'));
  assert.ok(tabletCheck.clarification.whyItMatters.length > 20);

  const watchCheck = assessRequirementCompleteness({ prompt: 'recommend a smartwatch' });
  assert.equal(watchCheck.hasSufficientContext, false);
  assert.ok(watchCheck.clarification);
  assert.ok(watchCheck.clarification.question.includes('primary reason'));

  // B. Multi-turn preservation: user clarifies intended usage
  const watchTurn2 = {
    prompt: 'marathon training with multi-band GPS and long battery under $500',
    previousPrompts: ['recommend a smartwatch'],
  };
  const watchTurn2Check = assessRequirementCompleteness(watchTurn2);
  assert.equal(watchTurn2Check.hasSufficientContext, true);

  // C. Ranking: High-suitability premium option beats cheap basic option within budget
  const strategy = formulateResearchStrategy(watchTurn2);

  const proGarminWatch = createTestOffer({
    id: 'garmin_pro_gps',
    name: 'Garmin Forerunner Pro GPS Marathon Watch',
    summary: 'Pro multisport watch with multi-band GPS, 14-day battery life, and advanced VO2 max training metrics.',
    merchant: 'RunningWarehouse',
    price: 449.99, // Higher price ($449.99), within $500 budget
    rating: 4.9,
    reviewCount: 220,
    availabilityStatus: 'verified_in_stock',
    specs: {
      Battery: '14 days',
      GPS: 'Multi-band GNSS',
      Waterproof: '5 ATM / 50m',
    },
  });

  const cheapStepTracker = createTestOffer({
    id: 'cheap_step_tracker',
    name: 'Generic Mini Step Counter Wristband',
    summary: 'Basic plastic band that counts daily steps with standard pedometer sensor.',
    merchant: 'BudgetBazaar',
    price: 19.99, // Drastically cheaper ($19.99 vs $449.99)
    rating: 3.2,
    reviewCount: 12,
    availabilityStatus: 'verified_in_stock',
    specs: {
      Battery: '2 days',
      Sensors: 'Basic 3-axis accelerometer',
    },
  });

  const ranked = evaluateProductsAndRank([cheapStepTracker, proGarminWatch], [], strategy);

  // Top recommendation MUST be the suitable, high-performance pro watch, NOT the $19.99 cheap band!
  assert.equal(ranked[0].id, 'garmin_pro_gps');
  assert.equal(ranked[1].id, 'cheap_step_tracker');
  assert.ok(
    (ranked[0].completenessScore || 0) > (ranked[1].completenessScore || 0),
    `Pro Garmin watch score (${ranked[0].completenessScore}) must exceed cheap step tracker score (${ranked[1].completenessScore})`
  );
});

test('12. PREMIUM RESEARCH & RESPONSE INTELLIGENCE UPGRADE: Generates all 10 mandatory ChatGPT-style sections and category-adaptive evaluation criteria', async () => {
  const laptopStrategy = formulateResearchStrategy({
    prompt: 'Best laptop for software engineering and Docker under $2000',
    previousPrompts: ['I also care about battery life and 32GB RAM'],
  });

  // Must adapt evaluation criteria to Laptops & Computing and remember multi-turn priorities
  assert.equal(laptopStrategy.category, 'Laptops & Computing');
  assert.ok(laptopStrategy.evaluationCriteria.some((c) => c.name.includes('Processor Architecture')));
  assert.ok(laptopStrategy.featurePriorities.includes('Battery Life & Portability'));
  assert.ok(laptopStrategy.featurePriorities.includes('Memory & Storage'));
  assert.ok(laptopStrategy.intendedUsage.toLowerCase().includes('software engineering'));

  const offer1 = createTestOffer({
    id: 'mbp_14_m3_pro',
    name: 'Apple MacBook Pro 14 M3 Pro 36GB RAM 1TB SSD',
    brand: 'Apple',
    merchant: 'Best Buy',
    price: 1899.0,
    canonicalUrl: 'https://www.bestbuy.com/site/macbook-pro-14-m3-pro/6534615.p',
    imageUrl: 'https://pisces.bbystatic.com/image2/BestBuy_US/images/products/6534/6534615_sd.jpg',
    rating: 4.9,
    reviewCount: 412,
    specs: {
      Processor: 'Apple M3 Pro (12-core CPU)',
      Memory: '36GB Unified RAM',
      Storage: '1TB NVMe SSD',
      Battery: 'Up to 18 hours',
    },
  });

  const offer2 = createTestOffer({
    id: 'thinkpad_p14s_gen5',
    name: 'Lenovo ThinkPad P14s Gen 5 Ryzen 7 Pro 32GB RAM',
    brand: 'Lenovo',
    merchant: 'Lenovo Official',
    price: 1449.0,
    canonicalUrl: 'https://www.lenovo.com/us/en/p/laptops/thinkpad/thinkpadp/thinkpad-p14s-gen-5',
    imageUrl: 'https://p1-ofp.static.pub/fes/cms/2024/thinkpad-p14s.png',
    rating: 4.7,
    reviewCount: 165,
    specs: {
      Processor: 'AMD Ryzen 7 PRO 8840HS',
      Memory: '32GB DDR5',
      Storage: '1TB PCIe Gen4 SSD',
      Battery: 'Up to 13 hours',
    },
  });

  const ranked = evaluateProductsAndRank([offer2, offer1], [], laptopStrategy);
  const sourceReports: SourceExecutionReport[] = [
    {
      sourceId: 'channel3_api',
      sourceName: 'Channel3 Live Product Graph API',
      configured: true,
      queried: true,
      status: 'verified_ok',
      explicitStateMessage: 'Retrieved 2 verified merchant records.',
      resultCount: 2,
      retrievedAt: new Date().toISOString(),
    },
  ];

  const { report, coordinatorMessage } = await synthesizeAutonomousIntelligenceReport(
    {
      prompt: 'Best laptop for software engineering and Docker under $2000',
      previousPrompts: ['I also care about battery life and 32GB RAM'],
      preferredName: 'Alex',
    },
    laptopStrategy,
    ranked,
    [],
    sourceReports,
    null
  );

  // Verify all 10 mandatory sections are present in the synthesized consultant response
  assert.ok(coordinatorMessage.includes('### 1. Executive Summary & Best Overall Recommendation'));
  assert.ok(coordinatorMessage.includes('### 2. Top 2 Recommended Products'));
  assert.ok(coordinatorMessage.includes('### 3. Detailed Technical Specifications'));
  assert.ok(coordinatorMessage.includes('### 4. Individual Product Analysis (Suitability & Performance)'));
  assert.ok(coordinatorMessage.includes('### 5. Advantages, Disadvantages & Trade-Offs'));
  assert.ok(coordinatorMessage.includes('### 6. Side-by-Side Comparison Table'));
  assert.ok(coordinatorMessage.includes('### 7. Real-World Use-Case Analysis'));
  assert.ok(coordinatorMessage.includes('### 8. Price-to-Performance Evaluation'));
  assert.ok(coordinatorMessage.includes('### 9. Final Verdict & Winner Justification'));
  assert.ok(coordinatorMessage.includes('### 10. Verified Sources & Direct References'));

  // Verify structured report contains realWorldUseCaseAnalysis and priceToPerformanceEvaluation
  assert.ok(report.realWorldUseCaseAnalysis && report.realWorldUseCaseAnalysis.length > 30);
  assert.ok(report.priceToPerformanceEvaluation && report.priceToPerformanceEvaluation.length > 30);
  assert.ok(report.rankedProducts[0].realWorldUseCase);
  assert.ok(report.rankedProducts[0].priceToPerformance);

  // Verify Laptop adaptive specifications (CPU, GPU, VRAM, RAM, Display) and RankedProductOffer enrichment
  assert.ok(report.rankedProducts[0].specifications['CPU']);
  assert.ok(report.rankedProducts[0].specifications['GPU']);
  assert.ok(report.rankedProducts[0].specifications['VRAM']);
  assert.ok(report.rankedProducts[0].specifications['RAM']);
  assert.ok(report.rankedProducts[0].specifications['Display']);
  assert.equal(ranked[0].recommendationTier, 'Best Overall');
  assert.ok(ranked[0].qualityAdjustedScore);
  assert.ok(ranked[0].richProfile);

  // Verify Smartphone adaptive specifications (Processor, Cameras, Battery, Display)
  const phoneStrategy = formulateResearchStrategy({
    prompt: 'Compare Google Pixel 9 Pro vs iPhone 16 Pro camera and battery under $1100',
  });
  assert.equal(phoneStrategy.category, 'Smartphones & Mobile Devices');
  const phoneRanked = evaluateProductsAndRank(
    [
      createTestOffer({
        id: 'pixel_9_pro_256',
        name: 'Google Pixel 9 Pro 6.3" LTPO OLED 120Hz 50MP Camera 4700mAh',
        brand: 'Google',
        merchant: 'Google Store',
        price: 999.0,
      }),
    ],
    [],
    phoneStrategy
  );
  assert.ok(phoneRanked[0].specs['Processor']);
  assert.ok(phoneRanked[0].specs['Cameras']);
  assert.ok(phoneRanked[0].specs['Battery']);
  assert.ok(phoneRanked[0].specs['Display']);

  // Verify zero leakage of raw upstream error payloads or internal notes into user-facing text
  assert.ok(!report.executiveSummary.includes('{"error":'));
  assert.ok(!report.executiveSummary.includes('UNAVAILABLE'));
  assert.ok(!report.executiveSummary.includes('GEMINI_API_KEY unconfigured'));
  assert.ok(!coordinatorMessage.includes('{"error":'));
});

test('13. UNIVERSAL PRODUCT INTELLIGENCE ACCEPTANCE SUITE: Researches all 10 distinct product categories with category-specific criteria, specs, and 12-part reports', async () => {
  const acceptanceCases: Array<{
    label: string;
    prompt: string;
    expectedCategory: string;
    expectedCriterionSubstring: string;
    expectedSpecKeys: string[];
    topOffer: Partial<ProductOffer> & { id: string; name: string };
    cheapInferiorOffer: Partial<ProductOffer> & { id: string; name: string };
  }> = [
    {
      label: 'Gaming laptop',
      prompt: 'Best gaming laptop with RTX 4070 and 165Hz OLED display under $1800',
      expectedCategory: 'Laptops & Computing',
      expectedCriterionSubstring: 'Processor Architecture (CPU), GPU & VRAM Throughput',
      expectedSpecKeys: ['CPU', 'GPU', 'VRAM', 'RAM', 'Display'],
      topOffer: {
        id: 'asus_zephyrus_g16',
        name: 'ASUS ROG Zephyrus G16 Gaming Laptop Core Ultra 9 RTX 4070 32GB RAM 16" 240Hz OLED',
        brand: 'ASUS',
        merchant: 'Best Buy',
        price: 1699.99,
        rating: 4.8,
        reviewCount: 245,
        imageUrl: 'https://example.com/zephyrus-g16.jpg',
      },
      cheapInferiorOffer: {
        id: 'budget_chromebook',
        name: 'Entry 11-inch Celeron 4GB eMMC Notebook',
        brand: 'Generic',
        merchant: 'DiscountMart',
        price: 179.99,
        rating: 3.4,
        reviewCount: 14,
      },
    },
    {
      label: 'Smartphone',
      prompt: 'Best flagship smartphone with 50MP OIS camera and 120Hz OLED battery under $1000',
      expectedCategory: 'Smartphones & Mobile Devices',
      expectedCriterionSubstring: 'Processor Silicon Performance',
      expectedSpecKeys: ['Processor', 'Cameras', 'Battery', 'Display'],
      topOffer: {
        id: 'galaxy_s24_plus',
        name: 'Samsung Galaxy S24+ Snapdragon 8 Gen 3 6.7" Dynamic AMOLED 120Hz 50MP Camera 4900mAh',
        brand: 'Samsung',
        merchant: 'Samsung Official',
        price: 899.99,
        rating: 4.8,
        reviewCount: 520,
        imageUrl: 'https://example.com/s24plus.jpg',
      },
      cheapInferiorOffer: {
        id: 'basic_3g_phone',
        name: 'Basic 3G Feature Phone 2.4-inch Screen',
        brand: 'Generic',
        merchant: 'PhoneOutlet',
        price: 39.99,
        rating: 3.3,
        reviewCount: 9,
      },
    },
    {
      label: 'Refrigerator',
      prompt: 'Counter-depth French door refrigerator with inverter compressor and ENERGY STAR under $2400',
      expectedCategory: 'Major Home Appliances',
      expectedCriterionSubstring: 'Capacity, Configuration Fit & Core Mechanical Performance',
      expectedSpecKeys: [
        'Configuration & Capacity',
        'Cooling & Compressor',
        'Energy & Acoustic Rating',
        'Interior & Build Quality',
      ],
      topOffer: {
        id: 'bosch_800_fridge',
        name: 'Bosch 800 Series 21 cu. ft. Counter-Depth French Door Refrigerator Dual Inverter Compressor ENERGY STAR Stainless Steel',
        brand: 'Bosch',
        merchant: 'Home Depot',
        price: 2199.0,
        rating: 4.8,
        reviewCount: 380,
        imageUrl: 'https://example.com/bosch-fridge.jpg',
      },
      cheapInferiorOffer: {
        id: 'mini_dorm_cooler',
        name: 'Mini 1.7 cu. ft. Thermoelectric Beverage Cooler',
        brand: 'DormBasic',
        merchant: 'BargainDepot',
        price: 89.99,
        rating: 3.5,
        reviewCount: 15,
      },
    },
    {
      label: 'Running shoes',
      prompt: 'Neutral road running shoes with maximum cushioning for marathon training under $180',
      expectedCategory: 'Footwear & Athletic Gear',
      expectedCriterionSubstring: 'Midsole Cushioning, Energy Return & Biomechanical Support',
      expectedSpecKeys: [
        'Cushioning & Midsole',
        'Arch & Pronation Support',
        'Outsole & Surface Grip',
        'Upper & Breathability',
      ],
      topOffer: {
        id: 'asics_novablast_4',
        name: 'ASICS Novablast 4 Neutral Road Running Shoes FF BLAST PLUS ECO Cushioning Marathon Trainer',
        brand: 'ASICS',
        merchant: 'Running Warehouse',
        price: 140.0,
        rating: 4.9,
        reviewCount: 410,
        imageUrl: 'https://example.com/novablast4.jpg',
      },
      cheapInferiorOffer: {
        id: 'flat_canvas_slipon',
        name: 'Flat Canvas Casual Slip-On Shoe',
        brand: 'BasicWear',
        merchant: 'ShoeBin',
        price: 19.99,
        rating: 3.2,
        reviewCount: 11,
      },
    },
    {
      label: 'Office chair',
      prompt: 'Ergonomic mesh office chair with dynamic lumbar support and 4D armrests for 8 hours under $1300',
      expectedCategory: 'Furniture & Ergonomics',
      expectedCriterionSubstring: 'Lumbar Support Geometry & Multi-Point Ergonomic Adjustability',
      expectedSpecKeys: [
        'Lumbar & Back Support',
        'Adjustability & Mechanism',
        'Upholstery & Frame Build',
        'Certification & Load Rating',
      ],
      topOffer: {
        id: 'steelcase_leap_v2',
        name: 'Steelcase Leap Ergonomic Office Chair LiveBack Dynamic Lumbar 4D Armrests BIFMA Certified 400 lb',
        brand: 'Steelcase',
        merchant: 'Steelcase Store',
        price: 1199.0,
        rating: 4.9,
        reviewCount: 620,
        imageUrl: 'https://example.com/steelcase-leap.jpg',
      },
      cheapInferiorOffer: {
        id: 'plastic_folding_stool',
        name: 'Basic Fixed Plastic Folding Desk Chair',
        brand: 'BudgetSit',
        merchant: 'OfficeClearance',
        price: 34.99,
        rating: 3.1,
        reviewCount: 8,
      },
    },
    {
      label: 'Digital camera',
      prompt: 'Full-frame mirrorless digital camera with 5-axis IBIS and 4K video for travel photography under $2200',
      expectedCategory: 'Photography & Cameras',
      expectedCriterionSubstring: 'Image Sensor Format, Dynamic Range & Low-Light ISO Performance',
      expectedSpecKeys: [
        'Sensor & Resolution',
        'Autofocus & Stabilization',
        'Video & Burst Capture',
        'Mount & Weather Sealing',
      ],
      topOffer: {
        id: 'sony_a7c_ii',
        name: 'Sony Alpha a7C II 33MP Full-Frame Mirrorless Digital Camera 5-Axis IBIS 10-Bit 4K Weather-Sealed',
        brand: 'Sony',
        merchant: 'B&H Photo Video',
        price: 2098.0,
        rating: 4.9,
        reviewCount: 290,
        imageUrl: 'https://example.com/sony-a7cii.jpg',
      },
      cheapInferiorOffer: {
        id: 'toy_vga_cam',
        name: 'Kids Pocket VGA Fixed-Focus Toy Camera',
        brand: 'ToySnap',
        merchant: 'GadgetMart',
        price: 24.99,
        rating: 3.0,
        reviewCount: 6,
      },
    },
    {
      label: 'Washing machine',
      prompt: 'Front-load inverter washing machine with steam clean and ENERGY STAR under $1100',
      expectedCategory: 'Major Home Appliances',
      expectedCriterionSubstring: 'Energy & Water Efficiency, Certifications & Acoustic Decibels',
      expectedSpecKeys: [
        'Load Type & Capacity',
        'Motor & Drive System',
        'Spin Speed & Cycles',
        'Efficiency & Certification',
      ],
      topOffer: {
        id: 'lg_wm4000hwa',
        name: 'LG 4.5 cu. ft. Front-Load Washing Machine TurboWash 360 Direct Drive Inverter Steam Sanitize 1300 RPM ENERGY STAR',
        brand: 'LG',
        merchant: 'Lowe’s',
        price: 899.0,
        rating: 4.8,
        reviewCount: 740,
        imageUrl: 'https://example.com/lg-washer.jpg',
      },
      cheapInferiorOffer: {
        id: 'mini_plastic_spinner',
        name: 'Portable Countertop Manual Hand-Crank Mini Laundry Tub',
        brand: 'CampWash',
        merchant: 'DiscountBazaar',
        price: 49.99,
        rating: 3.3,
        reviewCount: 12,
      },
    },
    {
      label: 'Power tool',
      prompt: '18V brushless cordless hammer drill and impact driver power tool kit under $280',
      expectedCategory: 'Power Tools, Hardware & Equipment',
      expectedCriterionSubstring: 'Brushless Motor Torque, RPM Output & Duty Cycle Performance',
      expectedSpecKeys: [
        'Motor & Torque Output',
        'Battery & Voltage Platform',
        'Speed & Chuck / Blade Spec',
        'Safety & Ergonomics',
      ],
      topOffer: {
        id: 'milwaukee_m18_fuel',
        name: 'Milwaukee M18 FUEL 18V Brushless Cordless 1/2 in. Hammer Drill & Impact Driver Combo Kit 1400 in-lbs All-Metal Chuck 5.0Ah',
        brand: 'Milwaukee',
        merchant: 'Acme Tools',
        price: 249.0,
        rating: 4.9,
        reviewCount: 890,
        imageUrl: 'https://example.com/milwaukee-m18.jpg',
      },
      cheapInferiorOffer: {
        id: 'rotary_hand_screwdriver',
        name: 'Basic 3.6V Brushed Plastic Mini Cordless Screwdriver',
        brand: 'EconoTool',
        merchant: 'BargainHardware',
        price: 18.99,
        rating: 3.2,
        reviewCount: 10,
      },
    },
    {
      label: 'Perfume',
      prompt: 'Woody aromatic Eau de Parfum perfume with long longevity and 100ml bottle under $190',
      expectedCategory: 'Fragrance, Beauty & Personal Care',
      expectedCriterionSubstring: 'Olfactory Composition, Note Balance & Ingredient Quality',
      expectedSpecKeys: [
        'Concentration & Type',
        'Olfactory Notes / Profile',
        'Longevity & Sillage',
        'Volume & Presentation',
      ],
      topOffer: {
        id: 'bleu_de_chanel_edp',
        name: 'Bleu de Chanel Eau de Parfum EDP Woody Aromatic Cedarwood & Amber Fragrance 100 ml Natural Spray',
        brand: 'Chanel',
        merchant: 'Sephora',
        price: 165.0,
        rating: 4.9,
        reviewCount: 1120,
        imageUrl: 'https://example.com/bleu-de-chanel.jpg',
      },
      cheapInferiorOffer: {
        id: 'generic_body_splash',
        name: 'Diluted Synthetic Aftershave Body Splash 30 ml',
        brand: 'GenericScent',
        merchant: 'ClearanceRack',
        price: 9.99,
        rating: 3.0,
        reviewCount: 7,
      },
    },
    {
      label: 'Car accessory',
      prompt: '4K dual front and rear dash cam car accessory with Sony STARVIS night vision and GPS under $240',
      expectedCategory: 'Automotive & Car Accessories',
      expectedCriterionSubstring: 'Core Functional Performance & Automotive-Grade Hardware',
      expectedSpecKeys: [
        'Primary Automotive Spec',
        'Vehicle & Power Fitment',
        'Thermal & Weather Rating',
        'Safety & Integration',
      ],
      topOffer: {
        id: 'viofo_a229_pro',
        name: 'VIOFO A229 Pro 4K UHD Dual Channel Dash Cam Sony STARVIS 2 Night Vision GPS Supercapacitor Car Accessory',
        brand: 'VIOFO',
        merchant: 'Crutchfield',
        price: 219.99,
        rating: 4.8,
        reviewCount: 340,
        imageUrl: 'https://example.com/viofo-a229.jpg',
      },
      cheapInferiorOffer: {
        id: 'vga_suction_cam',
        name: 'Basic 480p Suction Cup Dash Recorder (No Night Vision)',
        brand: 'RoadBasic',
        merchant: 'AutoClearance',
        price: 19.99,
        rating: 2.9,
        reviewCount: 9,
      },
    },
  ];

  const sourceReports: SourceExecutionReport[] = [
    {
      sourceId: 'channel3_api',
      sourceName: 'Channel3 Live Product Graph API',
      configured: true,
      queried: true,
      status: 'verified_ok',
      explicitStateMessage: 'Retrieved 2 verified merchant catalog records.',
      resultCount: 2,
      retrievedAt: new Date().toISOString(),
    },
  ];

  for (const tc of acceptanceCases) {
    // 1. Category classification & strategy formulation
    assert.equal(
      detectCategoryFromText(tc.prompt),
      tc.expectedCategory,
      `[${tc.label}] detectCategoryFromText must identify ${tc.expectedCategory}`
    );

    const strategy = formulateResearchStrategy({ prompt: tc.prompt });
    assert.equal(strategy.category, tc.expectedCategory, `[${tc.label}] strategy category mismatch`);
    assert.ok(
      strategy.evaluationCriteria.some((c) => c.name.includes(tc.expectedCriterionSubstring)),
      `[${tc.label}] evaluationCriteria must include "${tc.expectedCriterionSubstring}"`
    );

    // Non-electronics categories must NEVER receive laptop CPU/VRAM evaluation criteria
    if (tc.expectedCategory !== 'Laptops & Computing') {
      assert.ok(
        !strategy.evaluationCriteria.some((c) => c.name.includes('VRAM')),
        `[${tc.label}] non-laptop category must never use laptop VRAM criteria`
      );
    }

    // 2. Suitability-first ranking (zero cheapest-price bias)
    const offers = [
      createTestOffer(tc.cheapInferiorOffer),
      createTestOffer(tc.topOffer),
    ];
    const ranked = evaluateProductsAndRank(offers, [], strategy);
    assert.equal(
      ranked[0].id,
      tc.topOffer.id,
      `[${tc.label}] High-suitability product (${tc.topOffer.id}) must outrank cheap inferior option (${tc.cheapInferiorOffer.id})`
    );

    // 3. Category-specific specifications extracted
    for (const specKey of tc.expectedSpecKeys) {
      assert.ok(
        ranked[0].specs[specKey],
        `[${tc.label}] Ranked product must include category-adaptive spec key "${specKey}"`
      );
    }

    // 4. Complete 12-part professional report synthesis
    const { report, coordinatorMessage } = await synthesizeAutonomousIntelligenceReport(
      { prompt: tc.prompt, preferredName: 'Sam' },
      strategy,
      ranked,
      [],
      sourceReports,
      null
    );

    assert.equal(report.category, tc.expectedCategory);
    assert.equal(report.finalRecommendation.recommendedProductId, tc.topOffer.id);
    assert.ok(report.comparisonMatrix.rows.length >= 4, `[${tc.label}] Comparison matrix must have category rows`);
    assert.ok(coordinatorMessage.includes('### 1. Executive Summary & Best Overall Recommendation'));
    assert.ok(coordinatorMessage.includes('#### Research Methodology & Evaluation Criteria'));
    assert.ok(coordinatorMessage.includes('#### Product Images, Actual Prices, Merchants & Direct Links'));
    assert.ok(coordinatorMessage.includes('### 3. Detailed Technical Specifications'));
    assert.ok(coordinatorMessage.includes('### 4. Individual Product Analysis (Suitability & Performance)'));
    assert.ok(coordinatorMessage.includes('### 5. Advantages, Disadvantages & Trade-Offs'));
    assert.ok(coordinatorMessage.includes('### 6. Side-by-Side Comparison Table'));
    assert.ok(coordinatorMessage.includes('### 7. Real-World Use-Case Analysis'));
    assert.ok(coordinatorMessage.includes('### 8. Price-to-Performance Evaluation'));
    assert.ok(coordinatorMessage.includes('### 9. Final Verdict & Winner Justification'));
    assert.ok(coordinatorMessage.includes('#### Final Recommendation & Runner-Up Alternatives'));
    assert.ok(coordinatorMessage.includes('### 10. Verified Sources & Direct References'));
  }
});

test('14. MULTI-TURN CONTEXT ISOLATION: Switching product categories isolates separate searches while same-category follow-ups preserve context', () => {
  // When user switches from a Gaming Laptop search ($1500) to a Running Shoes search without a budget,
  // the new search MUST NOT inherit the $1500 laptop budget or gaming feature priorities
  const switchedHistory = getRelevantConversationHistory(
    'Neutral road running shoes with maximum cushioning for marathon training',
    ['Find gaming laptop with RTX 4070 under $1500 for 144Hz gaming']
  );
  assert.equal(switchedHistory.length, 1);
  assert.equal(switchedHistory[0], 'Neutral road running shoes with maximum cushioning for marathon training');

  const shoeStrategy = formulateResearchStrategy({
    prompt: 'Neutral road running shoes with maximum cushioning for marathon training',
    previousPrompts: ['Find gaming laptop with RTX 4070 under $1500 for 144Hz gaming'],
  });
  assert.equal(shoeStrategy.category, 'Footwear & Athletic Gear');
  assert.equal(shoeStrategy.targetBudget, null, 'Must not inherit $1500 budget from prior laptop search');
  assert.ok(!shoeStrategy.featurePriorities.includes('High-Refresh Gaming Throughput'));
  assert.ok(shoeStrategy.featurePriorities.includes('Cushioning & Biomechanical Stability'));

  // Conversely, when user stays within the same category, multi-turn history is preserved
  const sameCategoryFollowUp = formulateResearchStrategy({
    prompt: 'Which one has better arch stability for overpronation?',
    previousPrompts: [
      'Find gaming laptop with RTX 4070 under $1500',
      'Neutral road running shoes under $160',
    ],
  });
  assert.equal(sameCategoryFollowUp.category, 'Footwear & Athletic Gear');
  assert.equal(sameCategoryFollowUp.targetBudget, 160, 'Must preserve $160 budget from the running shoes turn');
});

test('15. UNIVERSAL CATEGORY CLARIFICATION: Asks focused category-specific questions when non-electronics queries are ambiguous', () => {
  const ambiguousNonElectronics = [
    { prompt: 'I need a refrigerator', expectedKeyword: 'refrigerator style' },
    { prompt: 'recommend a washing machine', expectedKeyword: 'front-load or top-load' },
    { prompt: 'recommend running shoes', expectedKeyword: 'terrain' },
    { prompt: 'I want an office chair', expectedKeyword: 'hours a day' },
    { prompt: 'recommend a power tool', expectedKeyword: 'power tool' },
    { prompt: 'recommend a perfume', expectedKeyword: 'scent family' },
    { prompt: 'looking for a car accessory', expectedKeyword: 'car accessory' },
  ];

  for (const item of ambiguousNonElectronics) {
    const assessment = assessRequirementCompleteness({ prompt: item.prompt });
    assert.equal(
      assessment.hasSufficientContext,
      false,
      `Ambiguous prompt "${item.prompt}" must request clarification`
    );
    assert.ok(assessment.clarification);
    assert.ok(
      assessment.clarification.question.toLowerCase().includes(item.expectedKeyword.toLowerCase()),
      `Clarification for "${item.prompt}" should mention "${item.expectedKeyword}", got: "${assessment.clarification.question}"`
    );
  }
});

test('16. SAMSUNG BESPOKE REFRIGERATOR FIX: Separates unique products from merchant offers, deduplicates SKUs, ranks with non-identical scores, and maintains 100% decision consistency', async () => {
  const prompt =
    'Compare counter-depth French door refrigerators with dual ice maker and inverter compressor under $2800 including Samsung Bespoke';
  const strategy = formulateResearchStrategy({ prompt });
  assert.equal(strategy.category, 'Major Home Appliances');
  assert.equal(strategy.targetBudget, 2800);

  // 4 different retailers selling the exact same Samsung Bespoke SKU (RF23BB8600QL) + 2 distinct competing models
  const rawOffers: ProductOffer[] = [
    createTestOffer({
      id: 'c3_sam_bestbuy',
      name: 'Samsung Bespoke 23 cu. ft. Counter-Depth 4-Door Flex French Door Refrigerator (RF23BB8600QL) Twin Cooling Plus Inverter ENERGY STAR',
      brand: 'Samsung',
      merchant: 'Best Buy',
      price: 2499.99,
      rating: 4.7,
      reviewCount: 640,
      canonicalUrl: 'https://www.bestbuy.com/site/samsung-bespoke-rf23bb8600ql',
      specs: {
        'Model Number': 'RF23BB8600QL',
        GTIN: '00887276624112',
      },
    }),
    createTestOffer({
      id: 'c3_sam_homedepot',
      name: 'Samsung Bespoke 4-Door Flex 23 cu. ft. Counter Depth French Door Refrigerator RF23BB8600QL Stainless Steel',
      brand: 'Samsung',
      merchant: 'Home Depot',
      price: 2399.00,
      rating: 4.7,
      reviewCount: 510,
      canonicalUrl: 'https://www.homedepot.com/p/samsung-bespoke-rf23bb8600ql',
      specs: {
        'Model Number': 'RF23BB8600QL',
        GTIN: '00887276624112',
      },
    }),
    createTestOffer({
      id: 'c3_sam_lowes',
      name: 'Samsung Bespoke Counter-Depth 23 cu. ft. 4-Door French Door Refrigerator (RF23BB8600QL)',
      brand: 'Samsung',
      merchant: 'Lowe’s',
      price: 2449.00,
      rating: 4.6,
      reviewCount: 390,
      canonicalUrl: 'https://www.lowes.com/pd/samsung-bespoke-rf23bb8600ql',
      specs: {
        'Model Number': 'RF23BB8600QL',
      },
    }),
    createTestOffer({
      id: 'c3_sam_direct',
      name: 'Samsung Bespoke 4-Door Flex Counter Depth Refrigerator 23 cu. ft. RF23BB8600QL',
      brand: 'Samsung',
      merchant: 'Samsung Official',
      price: 2549.99,
      rating: 4.8,
      reviewCount: 820,
      canonicalUrl: 'https://www.samsung.com/us/home-appliances/refrigerators/rf23bb8600ql',
      specs: {
        'Model Number': 'RF23BB8600QL',
      },
    }),
    createTestOffer({
      id: 'c3_bosch_800',
      name: 'Bosch 800 Series 21 cu. ft. Counter-Depth French Door Refrigerator (B36CT80SNS) Dual Compressors Inverter ENERGY STAR Stainless Steel',
      brand: 'Bosch',
      merchant: 'Best Buy',
      price: 2699.99,
      rating: 4.9,
      reviewCount: 470,
      canonicalUrl: 'https://www.bestbuy.com/site/bosch-800-b36ct80sns',
      specs: {
        'Model Number': 'B36CT80SNS',
        Warranty: '2-Year Full Warranty + 5-Year Sealed System',
      },
    }),
    createTestOffer({
      id: 'c3_lg_max',
      name: 'LG 26.5 cu. ft. Counter-Depth MAX French Door Refrigerator (LRFLC2706S) Linear Inverter ENERGY STAR Stainless Steel',
      brand: 'LG',
      merchant: 'Home Depot',
      price: 2199.00,
      rating: 4.6,
      reviewCount: 310,
      canonicalUrl: 'https://www.homedepot.com/p/lg-lrflc2706s',
      specs: {
        'Model Number': 'LRFLC2706S',
      },
    }),
  ];

  // Verify deduplication collapses 6 merchant listings into 3 unique refrigerator products
  const deduplicated = deduplicateProductsAndGroupMerchantOffers(rawOffers);
  assert.equal(
    deduplicated.length,
    3,
    'Four retailer listings for Samsung Bespoke RF23BB8600QL must collapse into 1 unique product alongside Bosch and LG'
  );

  const ranked = evaluateProductsAndRank(rawOffers, [], strategy);
  assert.equal(ranked.length, 3, 'evaluateProductsAndRank must return 3 unique products, not duplicate retailer listings');

  const samsungProduct = ranked.find((r) => /rf23bb8600ql|bespoke/i.test(r.name));
  assert.ok(samsungProduct, 'Samsung Bespoke unique product must be present');
  assert.equal(samsungProduct.merchantOffersCount, 4, 'Samsung Bespoke must aggregate all 4 merchant offers');
  assert.equal(samsungProduct.merchantOffers?.length, 4, 'Samsung Bespoke merchantOffers array must contain 4 retailer offers');
  assert.equal(
    samsungProduct.price,
    2399.00,
    'Lowest verified in-stock merchant offer ($2399.00 at Home Depot) must be selected as the best offer price for that SKU'
  );
  assert.equal(samsungProduct.merchant, 'Home Depot');

  // Verify all 3 unique products have strictly distinct suitability scores (never identical automatic scores)
  const uniqueScores = new Set(ranked.map((r) => r.completenessScore));
  assert.equal(uniqueScores.size, ranked.length, 'Every ranked unique product must have a distinct suitability score');

  // Synthesize full report and verify 100% decision consistency across ranked offers, report cards, table, and final verdict
  const sourceReports: SourceExecutionReport[] = [
    {
      sourceId: 'channel3_api',
      sourceName: 'Channel3 Live Product Graph API',
      configured: true,
      queried: true,
      status: 'verified_ok',
      explicitStateMessage: 'Retrieved 6 verified merchant catalog records across 3 unique refrigerator models.',
      resultCount: 6,
      retrievedAt: new Date().toISOString(),
    },
  ];

  const { report, coordinatorMessage } = await synthesizeAutonomousIntelligenceReport(
    { prompt, preferredName: 'Alex' },
    strategy,
    ranked,
    [],
    sourceReports,
    null
  );

  assert.equal(report.uniqueProductsDiscovered, 3);
  assert.equal(report.totalMerchantOffersEvaluated, 6);
  assert.equal(report.rankedProducts[0].productId, ranked[0].id);
  assert.equal(
    report.finalRecommendation.recommendedProductId,
    ranked[0].id,
    'Winning product in finalRecommendation must match Rank #1 product card and comparison table'
  );

  const samsungReportEntry = report.rankedProducts.find((p) => p.productId === samsungProduct.id);
  assert.ok(samsungReportEntry);
  assert.equal(samsungReportEntry.merchantOffersCount, 4);
  assert.equal(samsungReportEntry.lowestVerifiedOffer?.merchant, 'Home Depot');
  assert.equal(samsungReportEntry.lowestVerifiedOffer?.price, 2399.00);
  assert.ok(
    samsungReportEntry.conflictingEvidenceNotes &&
      samsungReportEntry.conflictingEvidenceNotes.some((n) => n.includes('Price varies across 4 verified merchants')),
    'Must detect and disclose price spread across multiple retailers for the same SKU'
  );
  assert.ok(
    coordinatorMessage.includes('MERCHANT_OFFER_DEDUPLICATION'),
    'Coordinator markdown report must disclose SKU deduplication across multiple merchant offers'
  );
});

test('17. EVIDENCE-BASED VERIFICATION: Distinguishes verified facts, source claims, and unverified fields without fabricating missing specs', () => {
  const sparseRefrigerator = createTestOffer({
    id: 'c3_sparse_fridge',
    name: 'Whirlpool French Door Refrigerator Stainless Steel',
    brand: 'Whirlpool',
    merchant: 'ApplianceDirect',
    price: 1799.00,
    specs: {
      'Channel3 Product ID': 'c3_sparse_fridge',
    },
  });

  const evidence = classifyProductEvidence(sparseRefrigerator, 'Major Home Appliances');
  assert.equal(
    evidence.classification['Channel3 Product ID'],
    'verified_fact',
    'Direct catalog identifier must be classified as verified_fact'
  );
  assert.equal(
    evidence.classification['Energy & Acoustic Rating'],
    'unknown',
    'Missing ENERGY STAR / decibel rating must be classified as unknown rather than fabricated'
  );
  assert.equal(
    evidence.classification['Warranty & Support'],
    'unknown',
    'Missing warranty terms must be classified as unknown rather than invented'
  );
});

test('18. REGIONAL MARKET INTELLIGENCE & BROADENED DISCOVERY: Detects non-US purchasing markets and expands sparse search queries', () => {
  const ukMarket = detectPurchasingMarket('Best counter-depth refrigerator under £1500 in the UK');
  assert.equal(ukMarket.market, 'United Kingdom (GBP)');
  assert.equal(ukMarket.currency, 'GBP');
  assert.ok(
    ukMarket.regionalDisclosure && ukMarket.regionalDisclosure.includes('United Kingdom (GBP)'),
    'Non-US market query must generate a regional pricing & availability disclosure'
  );

  const euStrategy = formulateResearchStrategy({
    prompt: 'Best mirrorless camera under €1800 in Germany',
  });
  assert.equal(euStrategy.purchasingMarket, 'European Union (EUR)');
  assert.equal(euStrategy.currency, 'EUR');
  assert.ok(euStrategy.regionalDisclosure);

  // Broadened query helper strips narrow model numbers to discover competing brands/models when initial results < 4 unique products
  const narrowedStrategy = formulateResearchStrategy({
    prompt: 'Samsung Bespoke RF23BB8600QL counter-depth refrigerator under $2600',
  });
  const broadenedQuery = buildBroadenedDiscoveryQuery(narrowedStrategy);
  assert.ok(
    !broadenedQuery.toLowerCase().includes('rf23bb8600ql'),
    `Broadened discovery query must strip specific SKU code RF23BB8600QL to find competing models, got: "${broadenedQuery}"`
  );
  assert.ok(broadenedQuery.toLowerCase().includes('refrigerator'));
});

test('19. EVIDENCE INTEGRITY & PRICE ACCURACY PATCH: Never labels products 95% verified when specs/model IDs are unknown, and never labels prices "Landed" without confirmed shipping and tax', () => {
  // 1. Product with price ($1799), merchant, and URL, but missing model number and missing major appliance specs
  const sparseFridge = createTestOffer({
    id: 'c3_sparse_1',
    name: 'Generic Stainless Steel French Door Refrigerator',
    merchant: 'ApplianceWorld',
    price: 1799.00,
    availabilityStatus: 'verified_in_stock',
    shippingCost: null,
    estimatedTaxRate: null,
    specs: {},
  });

  const sparseCoverage = calculateProductEvidenceCoverage(sparseFridge, 'Major Home Appliances');
  assert.equal(
    sparseCoverage.hasExactModelIdentifier,
    false,
    'Product without manufacturer model number or GTIN must have hasExactModelIdentifier = false'
  );
  assert.ok(
    sparseCoverage.unknownSpecs.length >= 2,
    `Expected at least 2 unknown specs for sparse refrigerator, got: ${sparseCoverage.unknownSpecs.join(', ')}`
  );
  assert.ok(
    sparseCoverage.evidenceCompletenessPercent <= 68,
    `Product with unknown major specs and missing model ID must NEVER be labeled 95% verified (got ${sparseCoverage.evidenceCompletenessPercent}%)`
  );
  assert.equal(sparseCoverage.specEvidenceSources['Cooling & Compressor']?.status, 'unknown');
  assert.equal(sparseCoverage.specEvidenceSources['Model / SKU Identifier']?.verified, false);

  // 2. Product with full specs and model number
  const completeFridge = createTestOffer({
    id: 'c3_complete_1',
    name: 'Bosch 800 Series 21 cu. ft. Counter-Depth French Door Refrigerator (B36CT80SNS) Dual Inverter Compressor ENERGY STAR Stainless Steel',
    merchant: 'Best Buy',
    price: 2699.99,
    availabilityStatus: 'verified_in_stock',
    specs: {
      'Manufacturer Model Number': 'B36CT80SNS',
      GTIN: '00825225956129',
    },
  });
  const completeCoverage = calculateProductEvidenceCoverage(completeFridge, 'Major Home Appliances');
  assert.equal(completeCoverage.hasExactModelIdentifier, true);
  assert.equal(completeCoverage.unknownSpecs.length, 0);
  assert.ok(
    completeCoverage.evidenceCompletenessPercent > sparseCoverage.evidenceCompletenessPercent,
    `Complete product coverage (${completeCoverage.evidenceCompletenessPercent}%) must exceed sparse product coverage (${sparseCoverage.evidenceCompletenessPercent}%)`
  );

  // 3. Price accuracy: separate listed price, in-stock price, shipping, tax, and checkout total
  const strategy = formulateResearchStrategy({
    prompt: 'Compare counter-depth French door refrigerators',
  });
  // Verify user intent & market disclosures when not specified in prompt
  assert.equal(
    strategy.recommendationScope,
    'general_market_recommendation',
    'Prompt without personal workload or household size must be labeled general_market_recommendation'
  );
  assert.equal(
    strategy.isMarketExplicitlySpecified,
    false,
    'Prompt without country or currency symbol must set isMarketExplicitlySpecified = false'
  );
  assert.ok(
    strategy.regionalDisclosure && strategy.regionalDisclosure.includes('US'),
    'Must disclose default market when target country/currency is not specified'
  );

  const ranked = evaluateProductsAndRank([sparseFridge, completeFridge], [], strategy);
  const pbUnconfirmed = buildPriceAccuracyBreakdown(ranked[0]);
  assert.equal(pbUnconfirmed.lowestListedPrice, 2699.99);
  assert.equal(pbUnconfirmed.lowestInStockPrice, 2699.99);
  assert.equal(pbUnconfirmed.shippingCost, null);
  assert.equal(pbUnconfirmed.taxAmount, null);
  assert.equal(
    pbUnconfirmed.isLandedTotalConfirmed,
    false,
    'Price without confirmed shipping and tax must NEVER be marked as a confirmed landed total'
  );
  assert.equal(pbUnconfirmed.estimatedCheckoutTotal, null);
  assert.ok(pbUnconfirmed.checkoutTotalLabel.includes('not a landed total'));

  // 4. Explainable criterion scores
  const critScores = computeExplainableCriterionScores(ranked[0], strategy, completeCoverage);
  assert.equal(critScores.length, strategy.evaluationCriteria.length);
  for (const cs of critScores) {
    assert.ok(cs.weight > 0);
    assert.ok(cs.score >= 50 && cs.score <= 99);
    assert.ok(cs.evidenceNote.length > 10);
  }
});

test('20. FINAL CONSISTENCY AUDIT & NO UNSUPPORTED CLAIMS: Enforces canonical counts, strips unverified landed price labels, and aligns all report sections', async () => {
  const prompt = 'Compare counter-depth French door refrigerators';
  const strategy = formulateResearchStrategy({ prompt });

  const rawOffers: ProductOffer[] = [
    createTestOffer({
      id: 'fridge_sam_1',
      name: 'Samsung Bespoke 23 cu. ft. Counter-Depth French Door Refrigerator RF23BB8600QL Stainless Steel',
      brand: 'Samsung',
      merchant: 'Best Buy',
      price: 2399.00,
      availabilityStatus: 'verified_in_stock',
      rating: 4.8,
      reviewCount: 420,
      specs: { 'Model Number': 'RF23BB8600QL' },
    }),
    createTestOffer({
      id: 'fridge_sam_2',
      name: 'Samsung Bespoke 23 cu. ft. Counter-Depth French Door Refrigerator RF23BB8600QL',
      brand: 'Samsung',
      merchant: 'Home Depot',
      price: 2499.00,
      availabilityStatus: 'verified_in_stock',
      rating: 4.7,
      reviewCount: 310,
      specs: { 'Model Number': 'RF23BB8600QL' },
    }),
    createTestOffer({
      id: 'fridge_sparse_alt',
      name: 'Entry Counter-Depth Refrigerator Model',
      brand: 'GenericAppliance',
      merchant: 'ApplianceOutlet',
      price: 1599.00,
      availabilityStatus: 'verified_in_stock',
      rating: null,
      reviewCount: null,
      specs: {},
    }),
  ];

  const ranked = evaluateProductsAndRank(rawOffers, [], strategy);
  assert.equal(ranked.length, 2, '3 merchant offers must deduplicate into 2 unique products');

  const sourceReports: SourceExecutionReport[] = [
    {
      sourceId: 'channel3_api',
      sourceName: 'Channel3 Live Product Graph API',
      configured: true,
      queried: true,
      status: 'verified_ok',
      explicitStateMessage: 'Retrieved 3 live merchant offers.',
      resultCount: 3,
      retrievedAt: new Date().toISOString(),
    },
  ];

  const { report, coordinatorMessage } = await synthesizeAutonomousIntelligenceReport(
    { prompt },
    strategy,
    ranked,
    [],
    sourceReports,
    null
  );

  // 1. Final Consistency Audit passed and canonical counts match across every section
  assert.ok(report.consistencyAudit, 'Report must include consistencyAudit');
  assert.equal(report.consistencyAudit?.passed, true);
  assert.equal(report.uniqueProductsDiscovered, 2);
  assert.equal(report.totalMerchantOffersEvaluated, 3);
  assert.equal(report.researchFindings?.uniqueProductsEvaluated, 2);
  assert.equal(report.researchFindings?.merchantOffersAggregated, 3);
  assert.equal(report.researchFindings?.recordsEvaluated, 3);
  assert.equal(report.rankedProducts.length, 2);

  // 2. Sparse product must NOT have 95% evidence completeness
  const sparseRanked = report.rankedProducts.find((p) => p.productId === 'fridge_sparse_alt');
  assert.ok(sparseRanked);
  assert.ok(
    sparseRanked.evidenceCompletenessPercent < 80,
    `Sparse refrigerator with unknown cooling/energy/interior specs must have < 80% evidence coverage, got ${sparseRanked.evidenceCompletenessPercent}%`
  );
  assert.ok(
    sparseRanked.technicalAnalysis?.includes('Unknown / undisclosed in merchant feed'),
    'Technical analysis must explicitly disclose unknown specifications rather than making unsupported thermal/acoustic claims'
  );

  // 3. Comparison matrix must NOT contain "Verified Landed Price" when shipping/tax are unconfirmed
  for (const row of report.comparisonMatrix.rows) {
    assert.ok(
      !/verified\s+landed\s+price/i.test(row.feature),
      `Comparison matrix row must not claim "Verified Landed Price" without confirmed shipping and tax, got: "${row.feature}"`
    );
    // Both productId and short name keys must be populated in row.values so UI Tab 1, Tab 3, and Markdown Section 6 match
    for (const prod of report.rankedProducts) {
      assert.ok(row.values[prod.productId], `Missing row.values[${prod.productId}] in row "${row.feature}"`);
      assert.equal(
        row.values[prod.productId],
        row.values[prod.name.slice(0, 28)],
        `row.values by productId and header name must match for "${prod.name}"`
      );
    }
  }

  // 4. User Intent & Market disclosures present in report and markdown
  assert.equal(report.recommendationScope, 'general_market_recommendation');
  assert.equal(report.isMarketExplicitlySpecified, false);
  assert.ok(coordinatorMessage.includes('General-Market Recommendation'));
  assert.ok(coordinatorMessage.includes('Unspecified Region'));
  assert.ok(coordinatorMessage.includes('Canonical Discovery & Deduplication Summary'));
});

test('21. RESPONSE LENGTH & INFORMATION DENSITY OPTIMIZATION: Reduces response length by ~40-50%, eliminates cross-section repetition, preserves all 10 sections and disclosures, and expands only when requested', async () => {
  const standardPrompt =
    'Compare counter-depth French door refrigerators with inverter compressor under $2800';
  const detailedPrompt =
    'Provide a detailed, in-depth analysis comparing counter-depth French door refrigerators with inverter compressor under $2800';

  assert.equal(isDetailedAnalysisRequested(standardPrompt), false);
  assert.equal(isDetailedAnalysisRequested(detailedPrompt), true);

  const strategy = formulateResearchStrategy({ prompt: standardPrompt });
  const offers: ProductOffer[] = [
    createTestOffer({
      id: 'bosch_800_ref',
      name: 'Bosch 800 Series 21 cu. ft. Counter-Depth French Door Refrigerator (B36CT80SNS) Dual Inverter Compressor ENERGY STAR Stainless Steel',
      brand: 'Bosch',
      merchant: 'Best Buy',
      price: 2699.99,
      rating: 4.9,
      reviewCount: 470,
      specs: { 'Model Number': 'B36CT80SNS' },
    }),
    createTestOffer({
      id: 'samsung_bespoke_ref',
      name: 'Samsung Bespoke 23 cu. ft. Counter-Depth 4-Door Flex French Door Refrigerator (RF23BB8600QL) Twin Cooling Plus Inverter ENERGY STAR',
      brand: 'Samsung',
      merchant: 'Home Depot',
      price: 2399.00,
      rating: 4.7,
      reviewCount: 510,
      specs: { 'Model Number': 'RF23BB8600QL' },
    }),
    createTestOffer({
      id: 'lg_max_ref',
      name: 'LG 26.5 cu. ft. Counter-Depth MAX French Door Refrigerator (LRFLC2706S) Linear Inverter',
      brand: 'LG',
      merchant: 'Lowe’s',
      price: 2199.00,
      rating: 4.6,
      reviewCount: 310,
      specs: { 'Model Number': 'LRFLC2706S' },
    }),
  ];

  const ranked = evaluateProductsAndRank(offers, [], strategy);
  const sourceReports: SourceExecutionReport[] = [
    {
      sourceId: 'channel3_api',
      sourceName: 'Channel3 Live Product Graph API',
      configured: true,
      queried: true,
      status: 'verified_ok',
      explicitStateMessage: 'Retrieved 3 verified merchant catalog records.',
      resultCount: 3,
      retrievedAt: new Date().toISOString(),
    },
  ];

  const { report: conciseReport, coordinatorMessage: conciseMsg } =
    await synthesizeAutonomousIntelligenceReport(
      { prompt: standardPrompt, preferredName: 'Alex' },
      strategy,
      ranked,
      [],
      sourceReports,
      null
    );

  // 1. Verify ~40-50% length reduction compared to legacy verbose ~7,800-character 3-product report
  assert.ok(
    conciseMsg.length <= 4600,
    `Standard concise 3-product report must be <= 4600 chars (~40-50% reduction from ~7800 chars), got ${conciseMsg.length} chars`
  );
  assert.ok(
    conciseReport.executiveSummary.length <= 360,
    `Executive summary must be concise (<= 360 chars), got ${conciseReport.executiveSummary.length}`
  );

  // 2. Verify all 10 mandatory sections, citations, uncertainty disclosures, weighted scores, and critical limitations remain present
  for (let s = 1; s <= 10; s++) {
    assert.ok(
      conciseMsg.includes(`### ${s}. `),
      `Concise report must preserve Section ${s} heading`
    );
  }
  assert.ok(conciseMsg.includes('User-Specified Intent'));
  assert.ok(conciseMsg.includes('Unknown / undisclosed in merchant feed'));
  assert.ok(conciseMsg.includes('Canonical Discovery & Deduplication Summary'));

  // 3. Verify zero cross-section duplication of commercial metadata inside Section 3
  const sec3Slice = conciseMsg.split('### 3. Detailed Technical Specifications')[1]?.split('### 4.')[0] || '';
  assert.ok(
    !sec3Slice.includes('Lowest Listed Price:'),
    'Section 3 must not repeat Lowest Listed Price metadata already presented in Section 2'
  );
  assert.ok(
    !sec3Slice.includes('Shipping & Tax Status:'),
    'Section 3 must not repeat Shipping & Tax Status metadata already presented in Section 2'
  );

  // 4. Verify explicit detailed request expands output on demand
  const { coordinatorMessage: detailedMsg } = await synthesizeAutonomousIntelligenceReport(
    { prompt: detailedPrompt, preferredName: 'Alex' },
    strategy,
    ranked,
    [],
    sourceReports,
    null
  );
  assert.ok(
    detailedMsg.length > conciseMsg.length * 1.2,
    `Detailed analysis request (${detailedMsg.length} chars) must expand meaningfully over standard concise mode (${conciseMsg.length} chars)`
  );
});

test('22. CLEAN PRODUCT INTELLIGENCE OUTPUT & INTERNAL METADATA SEPARATION (Nike Pegasus Acceptance Test): Strips raw Channel3 IDs and feed fragments from user-facing reports while preserving all internal metadata for cart and PayPal checkout', async () => {
  const prompt = 'Compare Nike Pegasus road running shoes for daily training';
  const strategy = formulateResearchStrategy({ prompt });
  assert.equal(strategy.category, 'Footwear & Athletic Gear');

  // Simulate raw Channel3 Nike Pegasus Premium record with generic "cushioning" in summary and full internal metadata in specs
  const pegasusPremiumOffer = createTestOffer({
    id: 'ch3_v2yA2Ht_dickssportinggoods_com',
    name: 'Nike Pegasus Premium',
    brand: 'Nike',
    summary: 'Responsive cushioning for daily road running miles.',
    merchant: "Dick's Sporting Goods",
    price: 219.99,
    currency: 'USD',
    availabilityStatus: 'verified_in_stock',
    canonicalUrl: 'https://www.dickssportinggoods.com/p/nike-pegasus-premium',
    imageUrl: 'https://example.com/nike-pegasus-premium.jpg',
    specs: {
      'Source ID': 'channel3_api (v2yA2Ht)',
      'Channel3 Product ID': 'v2yA2Ht',
      'Merchant Offer ID': 'ch3_v2yA2Ht_dickssportinggoods_com',
      'Merchant Domain': 'dickssportinggoods.com',
      'Raw Channel3 Condition': 'new',
      'Catalog API': 'Channel3 Product Graph API',
      'Manufacturer Model Number': 'UNKNOWN',
      'Manufacturer SKU': 'Manufacturer SKU: UNKNOWN.',
      'Max Commission Rate': '8%',
      'Direct Checkout': 'Checkout unsupported in Spark (Channel3 Checkout API is coming soon)',
      Condition: 'New',
    },
  });

  // 1. Verify category-adaptive spec extraction transforms raw feed fragments into natural product analysis
  const adaptiveSpecs = deriveCategoryAdaptiveSpecs('Footwear & Athletic Gear', pegasusPremiumOffer);
  assert.notEqual(
    adaptiveSpecs['Cushioning & Midsole'],
    'cushioning Midsole Cushioning',
    'Must NEVER expose malformed "cushioning Midsole Cushioning" from generic word match'
  );
  assert.equal(
    adaptiveSpecs['Cushioning & Midsole'],
    'Not specified in the available product information.',
    'When specific midsole foam is undisclosed, must state "Not specified in the available product information."'
  );
  assert.equal(
    adaptiveSpecs['Arch & Pronation Support'],
    'Not specified in the available product information.',
    'Must transform "Not disclosed in merchant feed" into "Not specified in the available product information."'
  );
  assert.equal(
    adaptiveSpecs['Outsole & Surface Grip'],
    'Designed for road running',
    'Must transform "Road Running Outsole" into "Designed for road running" without claiming verified grip test data'
  );
  assert.equal(
    adaptiveSpecs['Upper & Breathability'],
    'Upper material not specified.',
    'Must transform "Standard Athletic Upper (material not disclosed in feed)" into "Upper material not specified."'
  );

  // 2. Verify sanitizer transforms legacy feed strings directly
  assert.equal(
    sanitizeUserFacingAttributeValue('cushioning Midsole Cushioning'),
    'Not specified in the available product information.'
  );
  assert.equal(
    sanitizeUserFacingAttributeValue('Not disclosed in merchant feed'),
    'Not specified in the available product information.'
  );
  assert.equal(
    sanitizeUserFacingAttributeValue('Road Running Outsole'),
    'Designed for road running'
  );
  assert.equal(
    sanitizeUserFacingAttributeValue('Standard Athletic Upper (material not disclosed in feed)'),
    'Upper material not specified.'
  );

  // 3. Evaluate, rank, and synthesize report
  const ranked = evaluateProductsAndRank([pegasusPremiumOffer], [], strategy);
  assert.equal(ranked.length, 1);

  // Verify internal metadata is 100% preserved on RankedProductOffer for deduplication, cart, and PayPal Sandbox checkout
  assert.equal(ranked[0].id, 'ch3_v2yA2Ht_dickssportinggoods_com');
  assert.equal(ranked[0].specs['Channel3 Product ID'], 'v2yA2Ht');
  assert.equal(ranked[0].specs['Merchant Offer ID'], 'ch3_v2yA2Ht_dickssportinggoods_com');
  assert.equal(ranked[0].specs['Source ID'], 'channel3_api (v2yA2Ht)');
  assert.equal(ranked[0].specs['Merchant Domain'], 'dickssportinggoods.com');
  assert.equal(ranked[0].canonicalUrl, 'https://www.dickssportinggoods.com/p/nike-pegasus-premium');

  const sourceReports: SourceExecutionReport[] = [
    {
      sourceId: 'channel3_api',
      sourceName: 'Channel3 Product Graph API',
      configured: true,
      queried: true,
      status: 'verified_ok',
      explicitStateMessage: 'Retrieved 1 verified product record.',
      resultCount: 1,
      retrievedAt: new Date().toISOString(),
    },
  ];

  const { report, coordinatorMessage } = await synthesizeAutonomousIntelligenceReport(
    { prompt: 'Provide a detailed analysis of Nike Pegasus road running shoes' },
    strategy,
    ranked,
    [],
    sourceReports,
    null
  );

  const reportProd = report.rankedProducts[0];
  assert.ok(reportProd);

  // 4. Verify internal fields are completely stripped from user-facing report specifications
  const forbiddenSpecKeys = [
    'Source ID',
    'Channel3 Product ID',
    'Merchant Offer ID',
    'Merchant Domain',
    'Raw Channel3 Condition',
    'Catalog API',
    'Source Provider',
    'Max Commission Rate',
    'Direct Checkout',
    'Manufacturer Model Number',
    'Manufacturer SKU',
  ];
  for (const forbiddenKey of forbiddenSpecKeys) {
    assert.equal(
       forbiddenKey in reportProd.specifications,
      false,
      `User-facing report specifications must NEVER expose internal field "${forbiddenKey}"`
    );
    assert.equal(
      isInternalMetadataSpecKey(forbiddenKey, ranked[0].specs[forbiddenKey]),
      true,
      `isInternalMetadataSpecKey must flag "${forbiddenKey}"`
    );
  }

  // 5. Verify clean user-facing specifications are present and properly phrased
  assert.equal(reportProd.specifications['Cushioning & Midsole'], 'Not specified in the available product information.');
  assert.equal(reportProd.specifications['Arch & Pronation Support'], 'Not specified in the available product information.');
  assert.equal(reportProd.specifications['Outsole & Surface Grip'], 'Designed for road running');
  assert.equal(reportProd.specifications['Upper & Breathability'], 'Upper material not specified.');

  // 6. Verify coordinatorMessage and comparisonMatrix contain zero raw Channel3 IDs or malformed feed strings
  const forbiddenSubstrings = [
    'cushioning Midsole Cushioning',
    'Not disclosed in merchant feed',
    'Road Running Outsole',
    'Standard Athletic Upper (material not disclosed in feed)',
    'Source ID:',
    'Channel3 Product ID:',
    'v2yA2Ht',
    'Merchant Offer ID:',
    'ch3_v2yA2Ht_dickssportinggoods_com',
    'Max Commission Rate',
    'Manufacturer SKU: UNKNOWN',
  ];
  for (const forbidden of forbiddenSubstrings) {
    assert.ok(
      !coordinatorMessage.includes(forbidden),
      `User-facing coordinatorMessage must NEVER contain "${forbidden}"`
    );
  }

  // 7. Verify undocumented technical attributes do not receive high technical criterion scores
  const cushioningCriterion = reportProd.criterionScores?.find((c) =>
    c.criterion.toLowerCase().includes('cushioning')
  );
  assert.ok(cushioningCriterion, 'Footwear report must include cushioning evaluation criterion');
  assert.ok(
    cushioningCriterion.score <= 68,
    `Undocumented midsole cushioning must not receive a high technical score (got ${cushioningCriterion.score}/100)`
  );

  // 8. Verify getCleanUserFacingSpecs helper filters RankedProductOffer.specs for UI cards
  const cleanCardSpecs = getCleanUserFacingSpecs(ranked[0].specs, {
    includeUnspecified: false,
    includeCondition: false,
  });
  assert.deepEqual(cleanCardSpecs, {
    'Outsole & Surface Grip': 'Designed for road running',
  });
});

test('23. STAGE 7 ADAPTIVE CUSTOMER SUMMARY: Enforces 40-70 words for direct search, 70-120 words for comparison, and strips all internal IDs', async () => {
  const strategy = formulateResearchStrategy({
    prompt: 'Compare Sony WH-1000XM5 vs Bose QuietComfort Ultra wireless headphones under $450',
  });
  const offers: ProductOffer[] = [
    createTestOffer({
      id: 'ch3_sony_xm5_internal_id',
      name: 'Sony WH-1000XM5 Wireless Noise Canceling Headphones',
      brand: 'Sony',
      merchant: 'Best Buy',
      price: 349.99,
      rating: 4.8,
      reviewCount: 2400,
    }),
    createTestOffer({
      id: 'ch3_bose_qcultra_internal_id',
      name: 'Bose QuietComfort Ultra Wireless Noise Cancelling Headphones',
      brand: 'Bose',
      merchant: 'Crutchfield',
      price: 399.00,
      rating: 4.7,
      reviewCount: 1850,
    }),
  ];
  const ranked = evaluateProductsAndRank(offers, [], strategy);
  const { report } = await synthesizeAutonomousIntelligenceReport(
    { prompt: 'Compare Sony WH-1000XM5 vs Bose QuietComfort Ultra wireless headphones under $450' },
    strategy,
    ranked,
    [],
    [],
    null
  );

  // Verify comparison summary is 70-120 words
  const compSummary = buildAdaptiveCustomerSummary(report, true);
  assert.ok(
    compSummary.wordCount >= 70 && compSummary.wordCount <= 120,
    `Comparison summary word count must be 70-120 words (got ${compSummary.wordCount})`
  );
  assert.equal(compSummary.summary.includes('ch3_sony_xm5_internal_id'), false);
  assert.equal(compSummary.summary.includes('ch3_bose_qcultra_internal_id'), false);

  // Verify direct search summary is 40-70 words
  const directSummary = buildAdaptiveCustomerSummary(report, false);
  assert.ok(
    directSummary.wordCount >= 40 && directSummary.wordCount <= 70,
    `Direct search summary word count must be 40-70 words (got ${directSummary.wordCount})`
  );
  assert.equal(directSummary.summary.includes('ch3_'), false);
});




