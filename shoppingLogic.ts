import type {
  ActivityTimelineStage,
  ConversationResponseType,
  CouponItem,
  ExtractedShoppingIntent,
  OrchestrationResponse,
  OrderSummaryCalculation,
  PriceFreshnessInfo,
  ProductOffer,
  RankedProductOffer,
  ScienceCompoundMetadata,
} from '../types/spark.ts';

export interface AuthValidationResult {
  valid: boolean;
  errors: {
    name?: string;
    email?: string;
    password?: string;
  };
}

export function validateAuthInput(
  mode: 'signin' | 'signup',
  email: string,
  password: string,
  name = ''
): AuthValidationResult {
  const errors: AuthValidationResult['errors'] = {};
  const trimmedEmail = email.trim();
  const trimmedName = name.trim();

  if (mode === 'signup' && trimmedName.length < 2) {
    errors.name = 'Please enter a display name (at least 2 characters).';
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!trimmedEmail) {
    errors.email = 'Email address is required.';
  } else if (!emailRegex.test(trimmedEmail)) {
    errors.email = 'Please enter a valid email address.';
  }

  if (!password) {
    errors.password = 'Password is required.';
  } else if (password.length < 6) {
    errors.password = 'Password must be at least 6 characters long.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function classifyConversationRequest(
  rawQuery: string,
  hasExistingContext = false
): ConversationResponseType {
  const trimmed = rawQuery.trim();
  const lower = trimmed.toLowerCase();

  // 1. Check for ordinary conversational greetings or general system questions
  const generalPatterns = [
    /^(hi|hello|hey|greetings|good\s+(morning|afternoon|evening)|thanks|thank\s+you)\b[!?.]*$/i,
    /^what\s+(can\s+you\s+do|is\s+spark|sources\s+are\s+connected|apis?\s+do\s+you\s+use)\b/i,
    /^how\s+(does\s+spark\s+work|do\s+you\s+verify|does\s+checkout\s+work|do\s+coupons\s+work)\b/i,
    /^who\s+are\s+you\b/i,
    /^help$/i,
  ];
  if (generalPatterns.some((re) => re.test(lower))) {
    return 'general_question';
  }

  // 2. Check for ambiguous requests missing product/category details when no prior context exists
  const ambiguousWithoutContextPatterns = [
    /^(buy|purchase|order|checkout)(\s+(it|this|that|one|now|please))*[!?.]*$/i,
    /^(compare|compare\s+them|compare\s+these|compare\s+products)[!?.]*$/i,
    /^(find\s+me\s+something|search|shop|looking\s+for\s+something|recommend\s+something)[!?.]*$/i,
    /^(check\s+coupon|apply\s+coupon|is\s+this\s+coupon\s+valid)[!?.]*$/i,
  ];
  if (!hasExistingContext && ambiguousWithoutContextPatterns.some((re) => re.test(lower))) {
    return 'missing_information';
  }

  // 3. Specific shopping response types
  if (/\balternative|instead\s+of|cheaper\s+option|similar\s+to\b/i.test(lower)) {
    return 'alternative_products';
  }
  if (/\b(compare|comparison|versus|vs|difference\s+between)\b/i.test(lower)) {
    return 'product_comparison';
  }
  if (/\b(coupon|promo\s+code|discount\s+code|voucher)\b/i.test(lower) && !/\b(find|apps?|software|books?)\b/i.test(lower)) {
    return 'coupon_search';
  }

  return 'product_search';
}

export function parseShoppingIntent(
  rawQuery: string,
  hasExistingContext = false
): ExtractedShoppingIntent {
  const query = rawQuery.trim();
  const lower = query.toLowerCase();

  let maxBudget: number | null = null;
  const rangeMatch = lower.match(
    /(?:between|from|ما\s*بين|من|entre|de)\s*[$€£]?\s*(\d+(?:\.\d+)?)\s*(?:and|to|-|و|إلى|et|à)\s*[$€£]?\s*(\d+(?:\.\d+)?)/i
  );
  const budgetMatch =
    lower.match(
      /(?:under|below|max|maximum|within|up\s+to|budget(?:\s+of)?|less\s+than|at\s+most|تحت|أقل\s+من|بميزانية|حد\s+أقصى|sous|moins\s+de|budget(?:\s+de)?|maximum\s+de)\s*[$€£]?\s*(\d+(?:\.\d+)?)/i
    ) ||
    lower.match(/[$€£]\s*(\d+(?:\.\d+)?)\s*(?:or\s+less|max|maximum|budget)/i) ||
    lower.match(/(\d+(?:\.\d+)?)\s*(?:دولار|ريال|درهم|يورو|usd|eur|gbp|dollars?|euros?)\s*(?:أو\s+أقل|كحد\s+أقصى|or\s+less|max)?/i);
  if (rangeMatch) {
    maxBudget = Number(rangeMatch[2]);
  } else if (budgetMatch) {
    maxBudget = Number(budgetMatch[1]);
  }

  let currency: 'USD' | 'EUR' | 'GBP' = 'USD';
  if (query.includes('€') || /\b(eur|euros?)\b|يورو/i.test(query)) currency = 'EUR';
  else if (query.includes('£') || /\b(gbp|pounds?)\b|جنيه/i.test(query)) currency = 'GBP';

  let category: string | null = null;
  if (
    /\b(landline|cordless(?:\s+home)?\s+phone|dect(?:\s*6(?:\.0)?)?|home\s+(?:phone|telephone)|desk\s+phone)\b|هاتف\s*أرضي|هاتف\s*منزلي/i.test(
      lower
    )
  ) {
    category = 'cordless_landline';
  } else if (
    /\b(smartphone|smartphones|iphone|galaxy\s+s|galaxy\s+a\d+|pixel\s+\d|android\s+phone|5g\s+phone|mobile\s+phone|cell\s+phone)\b|هاتف\s*ذكي|هواتف\s*ذكية|جوال|موبايل|ايفون|آيفون|سامسونج|\b(téléphone\s+intelligent|téléphones?\s+portables?)\b/i.test(
      lower
    ) ||
    (/\b(phone|phones)\b/i.test(lower) &&
      !/\b(headphone|headphones|earphone|earphones|microphone|gramophone|landline|cordless)\b/i.test(
        lower
      ))
  ) {
    category = 'smartphones';
  } else if (
    /\b(laptop|laptops|notebook|macbook|thinkpad|ultrabook|ordinateur\s+portable|ordinateurs?\s+portables?)\b|لابتوب|حاسوب\s*محمول|كمبيوتر\s*محمول/i.test(
      lower
    )
  ) {
    category = 'laptops';
  } else if (
    /\b(monitor|monitors|ultrawide|oled\s+display|4k\s+display|moniteur|écran\s+4k)\b|شاشة\s*كمبيوتر|شاشة\s*ألعاب/i.test(
      lower
    )
  ) {
    category = 'monitors';
  } else if (
    /\b(appliance|appliances|vacuum|espresso\s+machine|air\s+fryer|refrigerator|fridge|freezer|washing\s+machine|washer|dryer|dishwasher|électroménager|aspirateur)\b|أجهزة\s*منزلية|مكنسة|ماكينة\s*قهوة|ثلاجة|غسالة/i.test(
      lower
    )
  ) {
    category = 'appliances';
  } else if (
    /\b(digital\s+camera|mirrorless(?:\s+camera)?|dslr(?:\s+camera)?|action\s+camera|camcorder|camera\s+lens)\b|كاميرا\s*رقمية/i.test(
      lower
    )
  ) {
    category = 'cameras';
  } else if (
    /\b(running\s+shoes?|sneakers?|trainers?|athletic\s+shoes?|hiking\s+boots?|footwear|trail\s+shoes?)\b|حذاء\s*جري|أحذية\s*رياضية/i.test(
      lower
    )
  ) {
    category = 'footwear';
  } else if (
    /\b(office\s+chair|ergonomic\s+chair|task\s+chair|standing\s+desk|desk\s+chair|mattress|sofa|couch|furniture)\b|كرسي\s*مكتب|أثاث/i.test(
      lower
    )
  ) {
    category = 'furniture';
  } else if (
    /\b(power\s+tools?|cordless\s+drill|impact\s+driver|hammer\s+drill|circular\s+saw|angle\s+grinder|miter\s+saw|jigsaw|rotary\s+hammer|tool\s+kit)\b|أدوات\s*كهربائية|مثقاب/i.test(
      lower
    )
  ) {
    category = 'power_tools';
  } else if (
    /\b(perfumes?|eau\s+de\s+(?:parfum|toilette)|cologne|fragrances?|parfum)\b|عطر|عطور/i.test(
      lower
    )
  ) {
    category = 'fragrance';
  } else if (
    /\b(car\s+accessor(?:y|ies)|dash\s*cams?|jump\s+starter|tire\s+inflator|obd2(?:\s+scanner)?|car\s+mount|car\s+charger|floor\s+mats?|roof\s+rack)\b|إكسسوارات\s*سيارات/i.test(
      lower
    )
  ) {
    category = 'automotive';
  } else if (
    /\b(book|books|novel|textbook|author|isbn|edition|reading|ebook|audiobook|livre|livres|roman)\b|كتاب|كتب|رواية/i.test(
      lower
    )
  ) {
    category = 'books';
  } else if (
    /\b(software|app|apps|macos|productivity|developer|tool|utility|code|ide|photo|video|editor|logiciel|logiciels|affinity|pixelmator)\b|برنامج|برامج|تطبيق|تصميم/i.test(
      lower
    )
  ) {
    category = 'software';
  } else if (
    /\b(serum|skincare|niacinamide|retinol|vitamin\s+c|ascorbic|salicylic|caffeine|compound|sérum)\b|سيروم|بشرة|نياسيناميد|ريتينول|فيتامين/i.test(
      lower
    )
  ) {
    category = 'science';
  } else if (
    /\b(headphone|headphones|earbud|earbuds|audio|music|album|podcast|sound|track|synth|casque\s+audio|écouteurs)\b|سماعة|سماعات|صوتيات/i.test(
      lower
    )
  ) {
    category = 'audio';
  }

  const couponRequested =
    /\b(coupon|coupons|discount|promo|code|deal|voucher|save|code\s+promo|réduction)\b|كوبون|قسيمة|خصم|كود\s*خصم/i.test(
      lower
    );
  const comparisonRequested =
    /\b(compare|comparison|comparer|versus|vs|difference|better|best|meilleur)\b|قارن|مقارنة|أفضل/i.test(
      lower
    );
  const shippingIncludedRequested =
    /\b(include\s+shipping|with\s+shipping|shipping\s+cost|shipping\s+in\s+the\s+comparison|livraison\s+incluse)\b|مع\s*الشحن|شامل\s*الشحن/i.test(
      lower
    );
  const localStoreRequested =
    /\b(near\s+me|nearby|local|store|pickup|in-store|city|map|magasin\s+proche)\b|قريب\s*مني|متجر\s*محلي/i.test(
      lower
    );

  let compareTopCount: number | null = null;
  const topCountMatch = lower.match(/\b(?:first|top)\s+(two|three|four|2|3|4)\b/i);
  if (topCountMatch) {
    const token = topCountMatch[1].toLowerCase();
    compareTopCount =
      token === 'two' || token === '2'
        ? 2
        : token === 'four' || token === '4'
        ? 4
        : 3;
  }

  let scienceCompound: string | null = null;
  if (/\bniacinamide\b|نياسيناميد/i.test(lower)) scienceCompound = 'niacinamide';
  else if (/\bcaffeine\b|\bespresso\b|\bcoffee\b|كافيين/i.test(lower)) scienceCompound = 'caffeine';
  else if (/\bascorbic\b|\bvitamin\s+c\b|فيتامين\s*سي/i.test(lower)) scienceCompound = 'ascorbic acid';
  else if (/\bsalicylic\b|ساليسيليك/i.test(lower)) scienceCompound = 'salicylic acid';
  else if (/\bretinol\b|ريتينول/i.test(lower)) scienceCompound = 'retinol';

  const responseType = classifyConversationRequest(query, hasExistingContext);

  let actionType: ExtractedShoppingIntent['actionType'] = 'discover';
  if (comparisonRequested) actionType = 'compare';
  else if (couponRequested && !category) actionType = 'coupons';
  else if (/\balternative|بديل|بدائل/i.test(lower)) actionType = 'alternatives';
  else if (/\boffer|deal|عرض|عروض/i.test(lower)) actionType = 'offers';
  else if (category === 'science' && scienceCompound) actionType = 'science';

  const stopWords = new Set([
    'find',
    'the',
    'best',
    'with',
    'good',
    'and',
    'for',
    'under',
    'per',
    'month',
    'within',
    'my',
    'budget',
    'these',
    'products',
    'available',
    'compare',
    'search',
    'discover',
    'a',
    'an',
    'to',
    'in',
    'of',
    'chercher',
    'trouver',
    'comparer',
    'meilleur',
    'sous',
    'avec',
    'pour',
  ]);
  const keywords = lower
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  const preferredFeatures: string[] = [];
  if (maxBudget !== null) preferredFeatures.push(`Budget constraint: <= ${currency} ${maxBudget}`);
  if (couponRequested) preferredFeatures.push('Verified coupon requested');
  if (comparisonRequested) preferredFeatures.push('Multi-offer comparison');
  if (shippingIncludedRequested) preferredFeatures.push('Shipping details included in comparison');
  if (localStoreRequested) preferredFeatures.push('Google Maps local store grounding');

  return {
    rawQuery: query,
    actionType,
    responseType,
    category,
    maxBudget,
    currency,
    keywords,
    preferredFeatures,
    couponRequested,
    comparisonRequested,
    shippingIncludedRequested,
    compareTopCount,
    localStoreRequested,
    scienceCompound,
  };
}

/**
 * Deduplicates real source records by canonicalUrl or (sourceId + id) without merging distinct products.
 */
export function deduplicateRealOffers(offers: ProductOffer[]): ProductOffer[] {
  const seenKeys = new Set<string>();
  const output: ProductOffer[] = [];

  for (const offer of offers) {
    if (!offer.sourceId || !offer.retrievedAt || !offer.name) {
      continue;
    }
    const key = `${offer.sourceId}::${offer.id}::${offer.canonicalUrl}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    output.push(offer);
  }
  return output;
}

export function evaluateCoupon(
  coupon: CouponItem,
  product: ProductOffer,
  subtotal: number | null = product.price
): { valid: boolean; discountAmount: number; reason?: string } {
  if (coupon.offerClassification === 'expired') {
    return { valid: false, discountAmount: 0, reason: 'Coupon offer has expired.' };
  }
  if (coupon.verificationStatus !== 'verified') {
    return { valid: false, discountAmount: 0, reason: 'Coupon validity unknown.' };
  }
  if (subtotal === null || product.priceStatus !== 'verified') {
    return { valid: false, discountAmount: 0, reason: 'Price could not be verified.' };
  }
  const couponMerchLower = coupon.merchant.toLowerCase().trim();
  const prodMerchLower = product.merchant.toLowerCase().trim();
  const cleanCouponToken = couponMerchLower
    .replace(/\b(many\s+geos|official\s+store|store|shop|inc|llc|ltd|com)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const cleanProdToken = prodMerchLower
    .replace(/\b(many\s+geos|official\s+store|store|shop|inc|llc|ltd|com)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  const merchantMatches =
    couponMerchLower === prodMerchLower ||
    (cleanCouponToken.length >= 3 &&
      cleanProdToken.length >= 3 &&
      (cleanCouponToken === cleanProdToken ||
        cleanProdToken.includes(cleanCouponToken) ||
        cleanCouponToken.includes(cleanProdToken)));

  if (!merchantMatches) {
    return {
      valid: false,
      discountAmount: 0,
      reason: 'Coupon does not apply to this merchant.',
    };
  }
  if (subtotal < coupon.minSpend) {
    return {
      valid: false,
      discountAmount: 0,
      reason: `Minimum spend of ${coupon.currency} ${coupon.minSpend} required.`,
    };
  }

  let discountAmount = 0;
  if (coupon.discountType === 'percentage') {
    discountAmount = Number(((subtotal * coupon.discountValue) / 100).toFixed(2));
  } else if (coupon.discountType === 'fixed') {
    discountAmount = Math.min(subtotal, coupon.discountValue);
  } else {
    discountAmount = 0;
  }

  return {
    valid: discountAmount > 0,
    discountAmount,
  };
}

export function rankAndCompareOffers(
  products: ProductOffer[],
  coupons: CouponItem[],
  intent: Pick<ExtractedShoppingIntent, 'category' | 'maxBudget' | 'keywords'>
): RankedProductOffer[] {
  const deduplicated = deduplicateRealOffers(products);

  const evaluated = deduplicated.map((product): RankedProductOffer => {
    let bestCoupon: CouponItem | null = null;
    let maxDiscount = 0;

    if (product.price !== null && product.priceStatus === 'verified') {
      for (const coupon of coupons) {
        const evaluation = evaluateCoupon(coupon, product, product.price);
        if (evaluation.valid && evaluation.discountAmount > maxDiscount) {
          maxDiscount = evaluation.discountAmount;
          bestCoupon = coupon;
        }
      }
    }

    const netItemPrice =
      product.price !== null && product.priceStatus === 'verified'
        ? Number(Math.max(0, product.price - maxDiscount).toFixed(2))
        : null;

    // A product satisfies a budget requirement ONLY when its price is verified and <= maxBudget
    const withinBudget =
      intent.maxBudget === null
        ? true
        : netItemPrice !== null && netItemPrice <= intent.maxBudget;

    // Completeness & verification score based strictly on verified attributes
    let completenessScore = 0;
    if (product.canonicalUrl) completenessScore += 25;
    if (product.price !== null && product.priceStatus === 'verified') completenessScore += 35;
    if (product.availabilityStatus === 'verified_in_stock') completenessScore += 20;
    if (product.rating !== null) completenessScore += Math.round((product.rating / 5) * 15);
    if (bestCoupon) completenessScore += 5;

    return {
      ...product,
      bestCoupon,
      couponDiscountAmount: maxDiscount,
      netItemPrice,
      withinBudget,
      completenessScore,
    };
  });

  // Search Execution Protocol #7: Rank only the products that satisfy the user's requirements
  const matchingRequirements = evaluated.filter((item) => item.withinBudget);

  return matchingRequirements.sort((a, b) => {
    if (a.priceStatus !== b.priceStatus) {
      return a.priceStatus === 'verified' ? -1 : 1;
    }
    return b.completenessScore - a.completenessScore;
  });
}

export function buildApprovalHash(params: {
  sourceId: string;
  productId: string;
  merchant: string;
  quantity: number;
  totalAmount: number | null;
  currency: string;
  couponCode: string | null;
}): string {
  const payload = [
    params.sourceId,
    params.productId,
    params.merchant.toLowerCase(),
    String(params.quantity),
    params.totalAmount !== null ? params.totalAmount.toFixed(2) : 'UNVERIFIED_TOTAL',
    params.currency.toUpperCase(),
    (params.couponCode || 'NONE').toUpperCase(),
  ].join('|');

  let hash = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `spk_appr_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Rule 10 Compliance:
 * Never infer the final purchase cost from the product price alone when shipping, taxes,
 * or other applicable charges remain unknown.
 */
export function computeOrderSummary(
  product: ProductOffer,
  quantity: number,
  coupon: CouponItem | null
): OrderSummaryCalculation {
  const safeQty = Math.max(1, Math.floor(quantity));

  if (product.price === null || product.priceStatus !== 'verified') {
    const approvalHash = buildApprovalHash({
      sourceId: product.sourceId,
      productId: product.id,
      merchant: product.merchant,
      quantity: safeQty,
      totalAmount: null,
      currency: product.currency,
      couponCode: null,
    });
    return {
      productId: product.id,
      sourceId: product.sourceId,
      productName: product.name,
      merchant: product.merchant,
      canonicalUrl: product.canonicalUrl,
      quantity: safeQty,
      unitPrice: null,
      subtotal: null,
      couponCode: null,
      couponDiscount: 0,
      discountedSubtotal: null,
      shippingCost: product.shippingCost,
      shippingStatus: product.shippingStatus,
      estimatedTax: null,
      taxStatus: product.taxStatus,
      totalAmount: null,
      totalCalculationState: 'price_could_not_be_verified',
      canInitiateCheckout: false,
      checkoutBlockerReason: 'Price could not be verified from the upstream source.',
      currency: product.currency,
      terms: `Source: ${product.sourceName}. Price could not be verified.`,
      approvalHash,
    };
  }

  const subtotal = Number((product.price * safeQty).toFixed(2));
  let couponDiscount = 0;
  let appliedCode: string | null = null;

  if (coupon) {
    const evalResult = evaluateCoupon(coupon, product, subtotal);
    if (evalResult.valid) {
      couponDiscount = evalResult.discountAmount;
      appliedCode = coupon.code;
    }
  }

  const discountedSubtotal = Number(Math.max(0, subtotal - couponDiscount).toFixed(2));

  // Check if shipping and taxes are known and verified
  const shippingKnown =
    product.shippingStatus === 'not_applicable_digital' ||
    (product.shippingStatus === 'verified' && product.shippingCost !== null);
  const taxKnown = product.taxStatus === 'verified' && product.estimatedTaxRate !== null;

  const shippingCost =
    product.shippingStatus === 'not_applicable_digital'
      ? 0
      : product.shippingStatus === 'verified'
      ? product.shippingCost
      : null;

  const estimatedTax =
    taxKnown && product.estimatedTaxRate !== null
      ? Number((discountedSubtotal * product.estimatedTaxRate).toFixed(2))
      : null;

  // Rule 10: Do NOT infer final purchase cost when shipping or taxes remain unknown!
  const canCalculateFinalTotal = shippingKnown && taxKnown && shippingCost !== null && estimatedTax !== null;
  const totalAmount = canCalculateFinalTotal
    ? Number((discountedSubtotal + shippingCost + estimatedTax).toFixed(2))
    : null;

  const totalCalculationState: OrderSummaryCalculation['totalCalculationState'] =
    canCalculateFinalTotal
      ? 'verified_complete'
      : 'cannot_infer_final_cost_charges_unknown';

  let checkoutBlockerReason: string | null = null;
  if (!canCalculateFinalTotal) {
    checkoutBlockerReason =
      'Final purchase cost cannot be inferred because merchant shipping or tax charges are unknown from this source.';
  } else if (product.checkoutStatus !== 'supported_paypal') {
    checkoutBlockerReason =
      'Checkout unsupported: Direct automated PayPal merchant checkout is not supported for this external source. Visit the canonical merchant URL directly.';
  }

  const canInitiateCheckout = canCalculateFinalTotal && product.checkoutStatus === 'supported_paypal';

  const approvalHash = buildApprovalHash({
    sourceId: product.sourceId,
    productId: product.id,
    merchant: product.merchant,
    quantity: safeQty,
    totalAmount,
    currency: product.currency,
    couponCode: appliedCode,
  });

  return {
    productId: product.id,
    sourceId: product.sourceId,
    productName: product.name,
    merchant: product.merchant,
    canonicalUrl: product.canonicalUrl,
    quantity: safeQty,
    unitPrice: product.price,
    subtotal,
    couponCode: appliedCode,
    couponDiscount,
    discountedSubtotal,
    shippingCost,
    shippingStatus: product.shippingStatus,
    estimatedTax,
    taxStatus: product.taxStatus,
    totalAmount,
    totalCalculationState,
    canInitiateCheckout,
    checkoutBlockerReason,
    currency: product.currency,
    terms: `Source: ${product.sourceName} (Retrieved ${product.retrievedAt}).`,
    approvalHash,
  };
}

export function verifyApprovalIntegrity(
  approvedHash: string,
  currentSummary: OrderSummaryCalculation
): { verified: boolean; reason?: string } {
  if (!currentSummary.canInitiateCheckout || currentSummary.totalAmount === null) {
    return {
      verified: false,
      reason:
        currentSummary.checkoutBlockerReason ||
        'Checkout unsupported or final total could not be verified.',
    };
  }
  if (!approvedHash || !approvedHash.startsWith('spk_appr_')) {
    return {
      verified: false,
      reason: 'Explicit user purchase confirmation is required before initiating payment.',
    };
  }
  if (approvedHash !== currentSummary.approvalHash) {
    return {
      verified: false,
      reason:
        'Order amount, quantity, coupon, or merchant details changed after confirmation. Fresh approval is required.',
    };
  }
  return { verified: true };
}

export function evaluateLipinskiProfile(props: {
  molecularWeight?: string | number;
  xLogP?: number;
  hBondDonorCount?: number;
  hBondAcceptorCount?: number;
}): Pick<ScienceCompoundMetadata, 'lipinskiPass' | 'lipinskiViolations'> {
  const mw = Number(props.molecularWeight ?? 0);
  const logP = Number(props.xLogP ?? 0);
  const hbd = Number(props.hBondDonorCount ?? 0);
  const hba = Number(props.hBondAcceptorCount ?? 0);

  let violations = 0;
  if (mw > 500) violations++;
  if (logP > 5) violations++;
  if (hbd > 5) violations++;
  if (hba > 10) violations++;

  return {
    lipinskiViolations: violations,
    lipinskiPass: violations <= 1,
  };
}

export function computePriceFreshness(
  retrievedAt: string,
  priceStatus: ProductOffer['priceStatus'],
  nowMs: number = Date.now()
): PriceFreshnessInfo {
  if (priceStatus !== 'verified') {
    return {
      status: 'unverified',
      ageMinutes: null,
      label: 'Price could not be verified.',
      retrievedAt,
    };
  }
  const parsedMs = Date.parse(retrievedAt);
  if (Number.isNaN(parsedMs)) {
    return {
      status: 'unverified',
      ageMinutes: null,
      label: 'Retrieval timestamp unknown',
      retrievedAt,
    };
  }
  const ageMinutes = Math.max(0, Math.floor((nowMs - parsedMs) / 60000));
  if (ageMinutes < 5) {
    return {
      status: 'fresh',
      ageMinutes,
      label: ageMinutes === 0 ? 'Verified just now' : `Verified ${ageMinutes}m ago`,
      retrievedAt,
    };
  }
  if (ageMinutes <= 60) {
    return {
      status: 'recent',
      ageMinutes,
      label: `Verified ${ageMinutes}m ago`,
      retrievedAt,
    };
  }
  return {
    status: 'stale',
    ageMinutes,
    label: `Retrieved ${Math.floor(ageMinutes / 60)}h ago — refresh recommended`,
    retrievedAt,
  };
}

export function generateConversationTitle(prompt: string): string {
  const cleaned = prompt
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'New Shopping Session';
  if (cleaned.length <= 54) return cleaned;
  return `${cleaned.slice(0, 51).trim()}...`;
}

const FOLLOW_UP_META_WORDS = new Set([
  'only',
  'show',
  'products',
  'items',
  'options',
  'results',
  'compare',
  'comparison',
  'first',
  'two',
  'three',
  'four',
  'top',
  'include',
  'shipping',
  'whether',
  'this',
  'valid',
  'these',
  'them',
  'cheaper',
  'alternative',
  'alternatives',
  'check',
  'coupons',
  'coupon',
  'verified',
  'price',
  'prices',
  'stock',
  'available',
  'sort',
  'filter',
  'lowest',
  'highest',
  'rating',
  'free',
  'camera',
  'battery',
  'display',
  'screen',
  'gaming',
  'worth',
  'value',
  'better',
  'best',
  'samsung',
  'google',
  'pixel',
  'galaxy',
  'apple',
  'alternative',
  'alternatives',
]);

export function isContextualFollowUp(prompt: string, hasExistingContext: boolean): boolean {
  if (!hasExistingContext) return false;
  const lower = prompt.trim().toLowerCase();
  const explicitFollowUpPatterns = [
    /^only\s+show\b/i,
    /\bthese\s+(products|options|items|offers|results)\b/i,
    /\b(compare|filter|sort)\s+(them|these|results|the\s+results|the\s+first|the\s+top)\b/i,
    /\bcompare\s+(it|this|that)\s+with\b/i,
    /\bfind\s+a?\s*cheaper\s+alternative\b/i,
    /\bcheaper\s+(one|option|alternative)\b/i,
    /\bcheck\s+(for\s+coupons|whether\s+this\s+coupon\s+is\s+valid|coupon)\b/i,
    /\binclude\s+shipping\b/i,
    /\bwhich\s+(one|of\s+these)\b/i,
    /\bin\s+stock\s+only\b/i,
    /\bwhat\s+about\s+(its|the|their)\s+(camera|battery|display|screen|processor|performance|storage|warranty|price|charging)\b/i,
    /\bhow\s+is\s+(its|the|their)\s+(camera|battery|display|screen|performance)\b/i,
    /\bis\s+(it|this|that)\s+worth\s+the\s+price\b/i,
    /\bwhich\s+(one\s+)?is\s+better\s+for\s+(gaming|photography|camera|battery|daily\s+use|work|coding)\b/i,
  ];
  if (explicitFollowUpPatterns.some((re) => re.test(lower))) {
    return true;
  }

  // A bare budget constraint (e.g., "under $50", "show options under $20") is a contextual follow-up
  // ONLY when the prompt does not introduce a new product category or new product subject nouns.
  if (/\bunder\s*[$€£]?\s*\d+(\.\d+)?\b/i.test(lower)) {
    const parsed = parseShoppingIntent(prompt, true);
    const nonMetaTopicWords = parsed.keywords.filter(
      (k) => !FOLLOW_UP_META_WORDS.has(k) && !/^\d+(\.\d+)?$/.test(k)
    );
    if (parsed.category === null && nonMetaTopicWords.length === 0) {
      return true;
    }
  }

  return false;
}

export function buildContextualFollowUpAdvisorResponse(
  prompt: string,
  offers: RankedProductOffer[],
  actionSummary: string
): string {
  const lower = prompt.trim().toLowerCase();
  const top = offers[0] || null;
  if (!top) {
    return `No retained products in the current conversation matched your follow-up filter ("${prompt.trim()}"). Try relaxing the budget or filter constraint.`;
  }

  const getSpecs = (o: RankedProductOffer) =>
    o.richProfile?.technicalSpecsByCategory || o.specs || {};
  const getScore10 = (o: RankedProductOffer) =>
    o.qualityAdjustedScore?.scoreOutOf10 ??
    Number(((o.qualityAdjustedScore?.totalQualityAdjustedScore ?? o.completenessScore) / 10).toFixed(1));
  const getScore100 = (o: RankedProductOffer) =>
    o.qualityAdjustedScore?.totalQualityAdjustedScore ?? o.completenessScore;
  const formatPrice = (o: RankedProductOffer) =>
    o.price !== null && o.priceStatus === 'verified'
      ? `${o.currency} ${(o.netItemPrice ?? o.price).toFixed(2)}`
      : 'Price could not be verified';

  // 1. Aspect-focused follow-up ("What about its camera?", "How is its battery?", etc.)
  const aspectMatch = lower.match(
    /\b(camera|battery|display|screen|processor|performance|storage|warranty|charging)\b/i
  );
  if (aspectMatch && /\b(what\s+about|how\s+is)\b/i.test(lower)) {
    const aspect = aspectMatch[1].toLowerCase();
    const specs = getSpecs(top);
    const matchingEntries = Object.entries(specs).filter(
      ([k, v]) =>
        k.toLowerCase().includes(aspect) ||
        v.toLowerCase().includes(aspect) ||
        (aspect === 'camera' && /\b(mp|ois|ultrawide|telephoto|video)\b/i.test(`${k} ${v}`)) ||
        (aspect === 'battery' && /\b(mah|charging|watt|wireless)\b/i.test(`${k} ${v}`)) ||
        ((aspect === 'display' || aspect === 'screen') && /\b(oled|amoled|hz|nits|inch)\b/i.test(`${k} ${v}`))
    );
    const specDetail =
      matchingEntries.length > 0
        ? matchingEntries.map(([k, v]) => `**${k}:** ${v}`).join(' · ')
        : top.summary;

    const second = offers[1];
    const comparisonNote = second
      ? `Compared with **${second.name}** (${formatPrice(second)}), which offers ${
          Object.entries(getSpecs(second))
            .filter(([k]) => k.toLowerCase().includes(aspect))
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ') || second.summary
        }.`
      : 'Top standalone candidate in your active comparison pool.';

    return `### Product Overview\n- **Focused ${aspect.charAt(0).toUpperCase() + aspect.slice(1)} Analysis:** **${top.name}** via **${top.merchant}** (${formatPrice(top)}).\n\n### Technical Specifications\n- ${specDetail}\n\n### Performance Analysis\n- **Specialist Assessment:** ${top.summary}\n\n### Product Evaluation\n- **Rating:** **${getScore10(top).toFixed(1)} / 10** (**${getScore100(top)} / 100** Quality-Adjusted Score).\n\n### Comparison\n- ${comparisonNote}\n\n### Final Verdict\n- **${top.name}** delivers verified ${aspect} capability backed by ${top.sourceName} (${top.canonicalUrl}).`;
  }

  // 2. Gaming / Use-Case Comparison ("Which one is better for gaming?")
  const useCaseMatch = lower.match(
    /\bwhich\s+(?:one\s+)?is\s+better\s+for\s+(gaming|photography|camera|battery|daily\s+use|work|coding)\b/i
  );
  if (useCaseMatch) {
    const useCaseLabel = useCaseMatch[1].toLowerCase();
    const rankedForUseCase = [...offers].sort((a, b) => {
      const scoreA = a.qualityAdjustedScore?.technicalQualityAndPerformance ?? a.completenessScore;
      const scoreB = b.qualityAdjustedScore?.technicalQualityAndPerformance ?? b.completenessScore;
      return scoreB - scoreA;
    });
    const winner = rankedForUseCase[0];
    const runnerUp = rankedForUseCase[1];
    const winnerSpecs = getSpecs(winner);
    const procAndDisplay = Object.entries(winnerSpecs)
      .filter(([k]) => /\b(processor|soc|ram|display|battery|gpu|camera)\b/i.test(k))
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ');

    return `### Product Overview\n- **Use-Case Winner (${useCaseLabel}):** **${winner.name}** (${winner.merchant} — ${formatPrice(winner)}) ranks #1 in your retained context for **${useCaseLabel}**.\n\n### Technical Specifications\n- ${procAndDisplay || winner.summary}\n\n### Performance Analysis\n- **Technical Performance Score:** ${winner.qualityAdjustedScore?.technicalQualityAndPerformance ?? getScore100(winner)}/100 · **Overall Rating:** **${getScore10(winner).toFixed(1)} / 10** (**${getScore100(winner)} / 100**).\n\n### Comparison\n- ${
      runnerUp
        ? `Outperforms **${runnerUp.name}** (${formatPrice(runnerUp)}, Rating ${getScore10(runnerUp).toFixed(1)}/10) for ${useCaseLabel} on sustained technical specifications and display/SoC headroom.`
        : 'Only eligible candidate in current context.'
    }\n\n### Final Verdict\n- Choose **${winner.name}** for superior ${useCaseLabel} hardware headroom and verified ${winner.sourceName} provenance.`;
  }

  // 3. Value / Worth the Price ("Is it worth the price?")
  if (/\bis\s+(it|this|that)\s+worth\s+the\s+price\b/i.test(lower)) {
    const valueScore =
      top.qualityAdjustedScore?.priceToPerformanceValue ?? getScore100(top);
    const cheaperPeer = offers
      .filter((o) => o.id !== top.id && o.price !== null && top.price !== null && o.price < top.price)
      .sort((a, b) => (a.price ?? 999999) - (b.price ?? 999999))[0];

    return `### Price & Value\n- **Price & Value Assessment:** **${top.name}** at **${formatPrice(top)}** via **${top.merchant}**.\n- **Price-to-Performance Score:** **${valueScore}/100** · **Overall Rating:** **${getScore10(top).toFixed(1)} / 10** (**${getScore100(top)} / 100**).\n- **Landed Cost Integrity:** ${
      top.richProfile?.pricingIntelligence.priceIntegrityNote ||
      'Verified unit price; regional taxes/shipping depend on checkout destination.'
    }\n\n### Advantages\n- ${
      top.richProfile?.purchasingInsights.practicalAdvantages.join('; ') || top.summary
    }\n\n### Disadvantages\n- ${
      top.richProfile?.purchasingInsights.importantLimitations.join('; ') ||
      'Standard regional tax and shipping terms apply.'
    }\n\n### Comparison\n- ${
      cheaperPeer
        ? `Cheaper Verified Alternatives in context: **${cheaperPeer.name}** at **${formatPrice(cheaperPeer)}** (Rating ${getScore10(cheaperPeer).toFixed(1)}/10 · ${getScore100(cheaperPeer)}/100).`
        : 'Lowest-priced top-tier option in your current comparison set.'
    }\n\n### Final Verdict\n- **Yes — ${top.recommendationTier || 'Best Overall'} (${getScore10(top).toFixed(1)}/10):** Strong price-to-performance balance backed by verified catalog evidence.`;
  }

  // 4. Default / Comparison / Cheaper Alternative follow-up summary
  const isCheaperQuery = /\bcheaper\b/i.test(lower);
  const listSummary = offers
    .slice(0, 3)
    .map(
      (o, idx) =>
        `${idx + 1}. **${o.name}** (${o.merchant}) — **${formatPrice(o)}** · Rating **${getScore10(o).toFixed(1)}/10** (**${getScore100(o)}/100**)`
    )
    .join('\n');

  return `### Product Overview\n- **${isCheaperQuery ? 'Cheaper Verified Alternatives' : 'Contextual Refinement Applied'}:** ${actionSummary} (${offers.length} verified option(s) matched).\n\n### Comparison\n${listSummary}\n\n### Final Verdict\n- **Top Retained Pick:** **${top.name}** (${formatPrice(top)}) with a **${getScore10(top).toFixed(1)}/10** (**${getScore100(top)}/100**) specialist evaluation score.`;
}

export function applyFollowUpConstraints(
  prompt: string,
  previousOffers: RankedProductOffer[],
  previousIntent: ExtractedShoppingIntent
): {
  filteredOffers: RankedProductOffer[];
  mergedIntent: ExtractedShoppingIntent;
  actionSummary: string;
  shouldRunNewUpstreamSearch: boolean;
  followUpAdvisorMessage?: string;
} {
  const followIntent = parseShoppingIntent(prompt, previousOffers.length > 0);
  const lower = prompt.trim().toLowerCase();

  const mergedIntent: ExtractedShoppingIntent = {
    ...previousIntent,
    rawQuery: prompt.trim(),
    responseType: followIntent.responseType,
    maxBudget: followIntent.maxBudget !== null ? followIntent.maxBudget : previousIntent.maxBudget,
    couponRequested: previousIntent.couponRequested || followIntent.couponRequested,
    comparisonRequested:
      previousIntent.comparisonRequested ||
      followIntent.comparisonRequested ||
      Boolean(followIntent.shippingIncludedRequested) ||
      /\bcompare\b|\bwhich\s+(one\s+)?is\s+better\b/i.test(lower),
    shippingIncludedRequested:
      previousIntent.shippingIncludedRequested || followIntent.shippingIncludedRequested,
    compareTopCount: followIntent.compareTopCount ?? previousIntent.compareTopCount,
    preferredFeatures: Array.from(
      new Set([...previousIntent.preferredFeatures, ...followIntent.preferredFeatures])
    ),
  };

  // Check if a brand mentioned in "Compare it with Samsung" is already present in previousOffers
  const mentionedBrandInPool = previousOffers.some((o) =>
    followIntent.keywords.some(
      (kw) =>
        kw.length > 2 &&
        !FOLLOW_UP_META_WORDS.has(kw) &&
        `${o.name} ${o.merchant}`.toLowerCase().includes(kw.toLowerCase())
    )
  );

  // Check if the user introduced a brand new subject/product noun outside the existing context
  const newTopicWords = followIntent.keywords.filter(
    (k) =>
      !FOLLOW_UP_META_WORDS.has(k) &&
      !/^\d+(\.\d+)?$/.test(k) &&
      !previousIntent.keywords.includes(k) &&
      !previousOffers.some((o) => `${o.name} ${o.merchant}`.toLowerCase().includes(k.toLowerCase()))
  );
  const hasExplicitContextPronoun =
    /^only\s+show\b|\bthese\s+(products|options|items|offers|results)\b|\b(compare|filter|sort)\s+(them|these|results|the\s+results|the\s+first|the\s+top)\b|\bcompare\s+(it|this|that)\s+with\b|\bwhich\s+(one|of\s+these)\b|\bwhat\s+about\s+(its|the|their)\b|\bhow\s+is\s+(its|the|their)\b|\bis\s+(it|this|that)\s+worth\s+the\s+price\b|\bwhich\s+(one\s+)?is\s+better\s+for\b/i.test(
      lower
    );
  const categoryChanged =
    followIntent.category !== null &&
    previousIntent.category !== null &&
    followIntent.category !== previousIntent.category;

  // If the user asked for a completely new product subject or changed product category, run an upstream search
  if (
    (newTopicWords.length > 0 && !hasExplicitContextPronoun && !mentionedBrandInPool) ||
    categoryChanged
  ) {
    return {
      filteredOffers: previousOffers,
      mergedIntent: followIntent,
      actionSummary: `Starting live source search for "${prompt.trim()}"`,
      shouldRunNewUpstreamSearch: true,
    };
  }

  let nextOffers = [...previousOffers];
  const actions: string[] = [];

  if (followIntent.maxBudget !== null) {
    nextOffers = nextOffers.filter(
      (o) =>
        o.price !== null &&
        o.priceStatus === 'verified' &&
        (o.netItemPrice ?? o.price) <= followIntent.maxBudget!
    );
    actions.push(`Filtered retained context to verified prices <= ${mergedIntent.currency} ${followIntent.maxBudget}`);
  }

  if (/\bfree\b/i.test(lower)) {
    nextOffers = nextOffers.filter(
      (o) => o.price !== null && o.priceStatus === 'verified' && o.price === 0
    );
    actions.push('Filtered retained context to verified $0.00 items');
  }

  if (/\bcheaper\b|\blowest\s+price\b/i.test(lower)) {
    nextOffers = nextOffers
      .filter((o) => o.price !== null && o.priceStatus === 'verified')
      .sort((a, b) => (a.netItemPrice ?? a.price ?? 0) - (b.netItemPrice ?? b.price ?? 0));
    actions.push('Sorted retained offers by lowest verified price');
  }

  if (/\bin\s+stock\b|\bavailable\b/i.test(lower)) {
    nextOffers = nextOffers.filter((o) => o.availabilityStatus === 'verified_in_stock');
    actions.push('Filtered retained context to verified in-stock records');
  }

  if (/\bcompare\s+(it|this|that)\s+with\s+([a-z0-9]+)/i.test(lower)) {
    const brandMatch = lower.match(/\bcompare\s+(?:it|this|that)\s+with\s+([a-z0-9]+)/i);
    const targetBrand = brandMatch?.[1]?.toLowerCase();
    if (targetBrand) {
      const topCurrent = nextOffers[0];
      const brandMatches = nextOffers.filter((o) =>
        `${o.name} ${o.merchant} ${JSON.stringify(o.specs || {})}`
          .toLowerCase()
          .includes(targetBrand)
      );
      if (topCurrent && brandMatches.length > 0) {
        const combined = [
          topCurrent,
          ...brandMatches.filter((b) => b.id !== topCurrent.id),
        ];
        nextOffers = combined;
        actions.push(
          `Compared "${topCurrent.name}" directly against ${brandMatches[0].name}`
        );
      }
    }
  } else if (followIntent.compareTopCount) {
    nextOffers = nextOffers.slice(0, followIntent.compareTopCount);
    actions.push(`Selected the first ${nextOffers.length} verified products for side-by-side comparison`);
  } else if (/\bcompare\b/i.test(lower)) {
    actions.push(`Prepared side-by-side comparison across ${nextOffers.length} retained records`);
  }

  if (/\bwhat\s+about\s+(its|the|their)\s+(\w+)/i.test(lower)) {
    const m = lower.match(/\bwhat\s+about\s+(?:its|the|their)\s+(\w+)/i);
    actions.push(`Inspected verified ${m?.[1] || 'technical'} specifications on retained context`);
  } else if (/\bwhich\s+(one\s+)?is\s+better\s+for\s+(\w+)/i.test(lower)) {
    const m = lower.match(/\bwhich\s+(?:one\s+)?is\s+better\s+for\s+(\w+)/i);
    actions.push(`Evaluated retained candidates for ${m?.[1] || 'target'} workload`);
  } else if (/\bis\s+(it|this|that)\s+worth\s+the\s+price\b/i.test(lower)) {
    actions.push('Evaluated price-to-performance ratio and landed-cost value on retained candidate');
  }

  if (followIntent.shippingIncludedRequested) {
    actions.push(
      'Included verified shipping details in comparison ($0.00 digital delivery vs unverified physical shipping)'
    );
  }

  if (/\bcoupon\b|\bpromo\b|\bdiscount\b/i.test(lower)) {
    actions.push(
      'Evaluated coupon status on retained products (Authorized coupon feed: Source not configured · Coupon validity unknown)'
    );
  }

  const finalActionSummary =
    actions.length > 0
      ? actions.join(' · ')
      : `Refined ${nextOffers.length} retained product records in conversation context`;

  return {
    filteredOffers: nextOffers,
    mergedIntent,
    actionSummary: finalActionSummary,
    shouldRunNewUpstreamSearch: false,
    followUpAdvisorMessage: buildContextualFollowUpAdvisorResponse(
      prompt,
      nextOffers,
      finalActionSummary
    ),
  };
}

export function buildActivityTimelineStages(
  response: OrchestrationResponse | null,
  isExecuting: boolean,
  errorMessage: string | null = null
): ActivityTimelineStage[] {
  if (isExecuting && !response) {
    return [
      {
        id: 'understand_request',
        label: 'Understanding the request',
        state: 'in_progress',
        sourceQueried: 'Intent Parser & Gemini 3.1 Flash-Lite',
        summary: 'Parsing shopping constraints, budget, currency, and product category...',
        details: [],
      },
      {
        id: 'search_sources',
        label: 'Searching connected product sources',
        state: 'pending',
        sourceQueried:
          'Channel3 Product Graph API & Open Library Catalog API',
        summary: 'Waiting to query configured live product sources...',
        details: [],
      },
      {
        id: 'verify_availability',
        label: 'Retrieving product information',
        state: 'pending',
        sourceQueried: 'Upstream Source Schema Validator',
        summary: 'Waiting for source records to validate price and stock fields...',
        details: [],
      },
      {
        id: 'check_coupons',
        label: 'Checking coupon availability',
        state: 'pending',
        sourceQueried: 'Authorized Merchant Coupon Verification API',
        summary: 'Waiting to check configured coupon feeds...',
        details: [],
      },
      {
        id: 'compare_options',
        label: 'Comparing prices & preparing results',
        state: 'pending',
        sourceQueried: 'Deterministic Field-Completeness Ranker',
        summary: 'Waiting to deduplicate and rank verified offers...',
        details: [],
      },
    ];
  }

  if (errorMessage && !response) {
    return [
      {
        id: 'understand_request',
        label: 'Understanding the request',
        state: 'completed',
        sourceQueried: 'Deterministic Intent Parser',
        summary: 'Parsed user shopping request.',
        details: [],
      },
      {
        id: 'search_sources',
        label: 'Searching connected product sources',
        state: 'failed',
        sourceQueried: 'Server-Side Source Adapters',
        summary: 'Live search failed.',
        details: [],
        errorReason: errorMessage,
      },
    ];
  }

  if (!response) return [];

  const intentStep = response.agentSteps.find((s) => s.agentId === 'intent');
  const coordinatorStep = response.agentSteps.find((s) => s.agentId === 'coordinator');

  // If this was a general question or missing-information clarification, only show the relevant stages
  if (
    response.responseType === 'general_question' ||
    response.responseType === 'missing_information'
  ) {
    return [
      {
        id: 'understand_request',
        label: 'Understanding the request',
        state: 'completed',
        sourceQueried: intentStep?.modelUsed || 'Deterministic Intent Parser',
        summary:
          intentStep?.summary ||
          `Classified request as ${
            response.responseType === 'general_question'
              ? 'general assistant question'
              : 'clarification required'
          }.`,
        details: intentStep?.details || [],
        durationMs: intentStep?.durationMs,
      },
      {
        id: 'prepare_results',
        label:
          response.responseType === 'missing_information'
            ? 'Waiting for user approval / clarification'
            : 'Preparing results',
        state:
          response.responseType === 'missing_information'
            ? 'requires_user_input'
            : 'completed',
        sourceQueried: coordinatorStep?.modelUsed || 'Spark Shopping Coordinator',
        summary:
          coordinatorStep?.summary ||
          'Prepared response without triggering unnecessary product source queries.',
        details: coordinatorStep?.details || [],
        durationMs: coordinatorStep?.durationMs,
      },
    ];
  }

  const discoveryStep = response.agentSteps.find((s) => s.agentId === 'discovery');
  const couponStep = response.agentSteps.find((s) => s.agentId === 'coupon');
  const comparisonStep = response.agentSteps.find((s) => s.agentId === 'comparison');

  const verifiedPriceCount = response.offers.filter(
    (o) => o.price !== null && o.priceStatus === 'verified'
  ).length;
  const unverifiedPriceCount = response.offers.length - verifiedPriceCount;

  const queriedSourcesList = response.sourceReports
    .filter((r) => r.queried)
    .map((r) => r.sourceName)
    .join(', ');

  return [
    {
      id: 'understand_request',
      label: 'Understanding the request',
      state: 'completed',
      sourceQueried: intentStep?.modelUsed || 'Deterministic Intent Parser',
      summary:
        intentStep?.summary ||
        `Parsed query "${response.intent.rawQuery}" (${response.intent.category || 'general'}).`,
      details:
        intentStep?.details && intentStep.details.length > 0
          ? intentStep.details
          : [`Currency: ${response.intent.currency}`, `Action: ${response.intent.actionType}`],
      durationMs: intentStep?.durationMs,
    },
    {
      id: 'search_sources',
      label: 'Searching product sources',
      state:
        discoveryStep?.status === 'live_search_failed'
          ? 'failed'
          : response.offers.length > 0
          ? 'completed'
          : 'failed',
      sourceQueried:
        queriedSourcesList || 'Channel3 Product Graph API, Open Library API',
      summary:
        discoveryStep?.summary ||
        `Queried ${response.sourceReports.length} source adapters (${response.offers.length} records returned).`,
      details: response.sourceReports.map(
        (r) => `${r.sourceName} [${r.sourceId}]: ${r.explicitStateMessage}`
      ),
      errorReason:
        response.offers.length === 0
          ? 'No verified results found for all active constraints.'
          : undefined,
      durationMs: discoveryStep?.durationMs,
    },
    {
      id: 'verify_availability',
      label: 'Verifying prices and availability',
      state: response.offers.length > 0 ? 'completed' : 'failed',
      sourceQueried: 'Live Record Field & Freshness Inspector',
      summary:
        response.offers.length > 0
          ? `${verifiedPriceCount} record(s) with verified live price; ${unverifiedPriceCount} record(s) where price could not be verified.`
          : 'No product records available for price verification.',
      details: [
        `Verified prices: ${verifiedPriceCount}`,
        `Unverified prices (Open Library catalog): ${unverifiedPriceCount}`,
        'Regional tax & physical shipping: Not inferred when omitted by source (Rule 10).',
      ],
    },
    {
      id: 'check_coupons',
      label: 'Checking coupons and discounts',
      state:
        couponStep?.status === 'completed' && response.verifiedCoupons.length > 0
          ? 'completed'
          : 'requires_user_input',
      sourceQueried: 'Authorized Merchant Coupon Verification API',
      summary: response.couponSubsystemState,
      details: [
        'Rule 8: Spark never claims a coupon works unless verified by an authorized source.',
        response.couponSubsystemState,
      ],
      errorReason:
        response.verifiedCoupons.length === 0 ? 'Source not configured. Coupon validity unknown.' : undefined,
      durationMs: couponStep?.durationMs,
    },
    {
      id: 'compare_options',
      label: 'Comparing best options',
      state: response.offers.length > 0 ? 'completed' : 'failed',
      sourceQueried: comparisonStep?.modelUsed || 'Strict Field-Completeness Comparator',
      summary:
        comparisonStep?.summary ||
        `Ranked ${response.offers.length} verified records by completeness and budget compliance.`,
      details: comparisonStep?.details || [],
      durationMs: comparisonStep?.durationMs,
    },
  ];
}

export interface ProductCardPoint {
  title: string;
  description: string;
}

export interface DerivedCardAnalysis {
  pros: [ProductCardPoint, ProductCardPoint, ProductCardPoint];
  cons: [ProductCardPoint, ProductCardPoint, ProductCardPoint];
}

/**
 * Derives 3 verified strengths (✓) and 3 explicit limitations/trade-offs (✕)
 * strictly from the real source-backed fields of a ProductOffer without inventing data.
 */
export function deriveCardAnalysis(product: RankedProductOffer): DerivedCardAnalysis {
  const genreOrCategory =
    product.specs['Primary Genre'] ||
    product.specs['Author'] ||
    product.category ||
    'Catalog Item';

  const pro1: ProductCardPoint = {
    title: `Verified ${product.sourceName.split(' ')[0]} Source`,
    description: `Authenticated live record (${product.id}) retrieved from ${product.sourceName}.`,
  };

  const pro2: ProductCardPoint = {
    title:
      product.availabilityStatus === 'verified_in_stock'
        ? `Verified Available · ${genreOrCategory}`
        : `Catalog Work · ${genreOrCategory}`,
    description:
      product.summary.length > 95
        ? `${product.summary.slice(0, 92).trim()}...`
        : product.summary,
  };

  const pro3: ProductCardPoint =
    product.rating !== null
      ? {
          title: `Verified Rating (${product.rating.toFixed(1)} ★)`,
          description: `Backed by ${
            product.reviewCount !== null ? product.reviewCount.toLocaleString() : 'verified'
          } upstream customer ratings from ${product.merchant}.`,
        }
      : product.specs['Compare At Price']
      ? {
          title: `Verified Sale Markdown (was ${product.specs['Compare At Price']})`,
          description: `Live merchant offer on ${product.merchant} via Channel3 Product Graph.`,
        }
      : {
          title:
            product.shippingStatus === 'not_applicable_digital'
              ? 'Instant Digital Delivery ($0 Shipping)'
              : 'Direct Canonical Provenance',
          description:
            product.shippingStatus === 'not_applicable_digital'
              ? `Published by ${product.merchant} with zero physical shipping fees.`
              : `Direct canonical link verified at ${product.merchant}.`,
        };

  const con1: ProductCardPoint =
    product.price !== null && product.priceStatus === 'verified'
      ? product.price > 25
        ? {
            title: 'Premium Tier Pricing',
            description: `Listed at ${product.currency} ${product.price.toFixed(
              2
            )} before applicable regional taxes.`,
          }
        : {
            title: 'Regional Taxes Unverified',
            description: `Base price is ${product.currency} ${product.price.toFixed(
              2
            )}; jurisdiction tax is calculated at store checkout.`,
          }
      : {
          title: 'Price Could Not Be Verified',
          description:
            'Upstream catalog source does not expose live retail pricing for this edition.',
        };

  const con2: ProductCardPoint = product.bestCoupon
    ? {
        title: `Minimum Spend Requirement`,
        description: `Coupon ${product.bestCoupon.code} requires ${product.bestCoupon.currency} ${product.bestCoupon.minSpend} minimum spend.`,
      }
    : {
        title: 'Coupon Validity Unknown',
        description: `No verified promotional code confirmed from authorized feed for ${product.merchant}.`,
      };

  const con3: ProductCardPoint =
    product.checkoutStatus !== 'supported_paypal'
      ? {
          title: 'External Merchant Checkout',
          description:
            'Automated in-app payment is unsupported; purchase completes on the official store website.',
        }
      : {
          title: 'Explicit Confirmation Required',
          description: 'Requires manual review and approval of final order totals.',
        };

  return {
    pros: [pro1, pro2, pro3],
    cons: [con1, con2, con3],
  };
}

export interface InteractiveFilterChip {
  id: string;
  label: string;
  type: 'all' | 'category' | 'verified_price' | 'budget' | 'free' | 'source';
  value?: string | number;
}

export function deriveFilterChips(
  offers: RankedProductOffer[],
  intent: ExtractedShoppingIntent
): InteractiveFilterChip[] {
  const chips: InteractiveFilterChip[] = [
    { id: 'all', label: 'All Results', type: 'all' },
  ];

  // Add primary genre or category chip from real offers
  const genres = Array.from(
    new Set(
      offers
        .map((o) => o.specs['Primary Genre'] || o.category)
        .filter((g): g is string => Boolean(g && g !== 'digital_item'))
    )
  );
  if (genres[0]) {
    chips.push({
      id: `cat_${genres[0]}`,
      label: genres[0],
      type: 'category',
      value: genres[0],
    });
  }

  // Add verified price filter chip
  if (offers.some((o) => o.price !== null && o.priceStatus === 'verified')) {
    chips.push({
      id: 'verified_price',
      label: 'Verified price',
      type: 'verified_price',
    });
  }

  // Add budget range chip matching reference ($100_$200 or Under $X)
  if (intent.maxBudget !== null) {
    chips.push({
      id: `budget_${intent.maxBudget}`,
      label: `$0_$${intent.maxBudget}`,
      type: 'budget',
      value: intent.maxBudget,
    });
  } else {
    const priced = offers
      .map((o) => o.price)
      .filter((p): p is number => p !== null && p > 0);
    if (priced.length > 0) {
      const maxP = Math.ceil(Math.max(...priced));
      chips.push({
        id: `budget_${maxP}`,
        label: `$0_$${maxP}`,
        type: 'budget',
        value: maxP,
      });
    }
  }

  if (offers.some((o) => o.price === 0 && o.priceStatus === 'verified')) {
    chips.push({
      id: 'free_only',
      label: 'Free ($0)',
      type: 'free',
    });
  }

  if (offers.some((o) => o.sourceId === 'channel3_api')) {
    chips.push({
      id: 'source_channel3',
      label: 'Channel3 Graph',
      type: 'source',
      value: 'channel3_api',
    });
  }

  return chips;
}

export interface ExplainableInterestTag {
  tag: string;
  category: 'category' | 'brand' | 'budget' | 'priority';
  reason: string;
}

/**
 * Stage 5: Explainable, Consent-Driven Interest Tag Derivation
 * Never generates or retains interest tags unless explicit user consent (`consentGranted === true`) is active.
 */
export function deriveExplainableInterestTags(
  prompts: string[],
  consentGranted: boolean
): ExplainableInterestTag[] {
  if (!consentGranted || !Array.isArray(prompts) || prompts.length === 0) {
    return [];
  }

  const tags: ExplainableInterestTag[] = [];
  const seen = new Set<string>();
  const addTag = (tag: string, category: ExplainableInterestTag['category'], reason: string) => {
    const key = tag.toLowerCase();
    if (!seen.has(key) && tags.length < 12) {
      seen.add(key);
      tags.push({ tag, category, reason });
    }
  };

  for (const rawPrompt of prompts) {
    const prompt = String(rawPrompt || '').trim();
    if (!prompt) continue;
    const intent = parseShoppingIntent(prompt);

    if (intent.category && intent.category !== 'general') {
      const label = intent.category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      addTag(label, 'category', `Learned from your product research in ${label}.`);
    }

    if (intent.maxBudget !== null && intent.maxBudget > 0) {
      addTag(
        `Budget <= $${intent.maxBudget}`,
        'budget',
        `Derived from your explicit price cap of $${intent.maxBudget}.`
      );
    }

    const brandMatches = prompt.match(
      /\b(Apple|Sony|Samsung|Dell|Lenovo|ASUS|HP|Bose|Sennheiser|Logitech|Nintendo|Dyson|Garmin|Canon|Nikon|LG|Acer|MSI)\b/gi
    );
    if (brandMatches) {
      for (const brand of brandMatches) {
        const cleanBrand = brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
        addTag(cleanBrand, 'brand', `Mentioned ${cleanBrand} in your shopping queries.`);
      }
    }

    if (intent.comparisonRequested) {
      addTag('Side-by-Side Comparisons', 'priority', 'You frequently request multi-model spec comparisons.');
    }
    if (intent.couponRequested) {
      addTag('Verified Coupons & Deals', 'priority', 'You prioritize active promo codes and verified discounts.');
    }
  }

  return tags;
}



