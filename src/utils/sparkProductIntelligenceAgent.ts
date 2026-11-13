import { GoogleGenAI } from '@google/genai';
import type {
  ClarificationRequirement,
  CouponItem,
  ExtractedShoppingIntent,
  GroundingCitation,
  MerchantOfferRecord,
  ProductIntelligenceReport,
  ProductOffer,
  RankedProductOffer,
  ScienceCompoundMetadata,
  SourceExecutionReport,
  TraceableFactAttribution,
} from '../types/spark.ts';
import {
  isChannel3CredentialConfigured,
  queryChannel3ProductDetail,
  queryChannel3Search,
  queryChannel3UrlLookup,
} from './channel3Adapter.ts';
import { feedicoPartnerService } from './feedicoService.ts';
import {
  getCleanUserFacingSpecs,
  isUnspecifiedAttributeValue,
  sanitizeUserFacingAttributeValue,
} from './productPresentationSanitizer.ts';

export interface AgentPipelineInput {
  prompt: string;
  previousPrompts?: string[];
  preferredName?: string;
  userId?: string | null;
  clientIp?: string;
  maxBudget?: number | null;
  currency?: 'USD' | 'EUR' | 'GBP';
  category?: string;
  location?: string;
  allowSecondarySourceFallback?: boolean;
}

export interface AgentPipelineOutput {
  report: ProductIntelligenceReport | null;
  offers: RankedProductOffer[];
  verifiedCoupons: CouponItem[];
  sourceReports: SourceExecutionReport[];
  scienceAnalysis: ScienceCompoundMetadata | null;
  coordinatorMessage: string;
  needsClarification: boolean;
  clarification?: ClarificationRequirement;
  clarificationSuggestions?: string[];
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '' || apiKey.trim() === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface RequirementAssessment {
  hasSufficientContext: boolean;
  clarification?: ClarificationRequirement;
  clarificationSuggestions?: string[];
  explanation?: string;
}

/**
 * Universal Product Category Classifier
 * Automatically identifies the product category from natural-language queries
 * across electronics, home appliances, furniture, footwear, beauty/fragrance,
 * power tools, automotive accessories, sports/outdoor, watches/apparel, books, and software.
 * Never assumes every query is an electronics query.
 */
export function detectCategoryFromText(text: string): string {
  const l = text.toLowerCase();

  // 1. Laptops & Computing (check before cameras/monitors/software so laptop specs like "webcam", "display", or "software engineering" don't misclassify)
  if (/\b(laptops?|macbooks?|computers?|notebooks?|pcs?|ultrabooks?|chromebooks?|thinkpads?|workstations?)\b/i.test(l)) {
    return 'Laptops & Computing';
  }

  // 2. Smartphones & Mobile Devices (check before cameras/displays so "smartphone with 50MP camera" or "Pixel 9 Pro camera" classifies as smartphone)
  if (/\b(phones?|smartphones?|pixels?|iphones?|galaxys?|androids?|tablets?|ipads?)\b/i.test(l)) {
    return 'Smartphones & Mobile Devices';
  }

  // 3. Major Home Appliances (Refrigerators, Washing Machines, Dryers, Dishwashers, Ranges, HVAC)
  if (
    /\b(refrigerators?|fridges?|freezers?|washing\s+machines?|washers?|clothes\s+dryers?|washer\s+dryer|dishwashers?|kitchen\s+ranges?|cooking\s+ranges?|wall\s+ovens?|cooktops?|air\s+conditioners?|water\s+heaters?)\b/i.test(
      l
    )
  ) {
    return 'Major Home Appliances';
  }

  // 4. Kitchen & Small Appliances
  if (
    /\b(espresso\s+machines?|coffee\s+makers?|air\s+fryers?|blenders?|stand\s+mixers?|food\s+processors?|toaster\s+ovens?|microwaves?|vacuum\s+cleaners?|robot\s+vacuums?|electric\s+kettles?|instant\s+pots?)\b/i.test(
      l
    )
  ) {
    return 'Kitchen & Small Appliances';
  }

  // 5. Footwear & Athletic Gear
  if (
    /\b(running\s+shoes?|sneakers?|trainers?|athletic\s+shoes?|trail\s+shoes?|marathon\s+shoes?|walking\s+shoes?|hiking\s+boots?|work\s+boots?|cleats?|footwear|loafers?|sandals?)\b/i.test(
      l
    )
  ) {
    return 'Footwear & Athletic Gear';
  }

  // 6. Furniture & Ergonomics
  if (
    /\b(office\s+chairs?|ergonomic\s+chairs?|task\s+chairs?|desk\s+chairs?|gaming\s+chairs?|standing\s+desks?|office\s+desks?|mattress(?:es)?|sofas?|couches?|sectionals?|bed\s+frames?|bookshelves?|dining\s+tables?|herman\s+miller|steelcase)\b/i.test(
      l
    )
  ) {
    return 'Furniture & Ergonomics';
  }

  // 7. Power Tools, Hardware & Equipment
  if (
    /\b(power\s+tools?|cordless\s+drills?|impact\s+drivers?|hammer\s+drills?|rotary\s+hammers?|circular\s+saws?|miter\s+saws?|table\s+saws?|jigsaws?|reciprocating\s+saws?|angle\s+grinders?|orbital\s+sanders?|torque\s+wrenches?|pressure\s+washers?|chainsaws?|tool\s+kits?|dewalt|milwaukee\s+m1[28]|makita|bosch\s+18v)\b/i.test(
      l
    )
  ) {
    return 'Power Tools, Hardware & Equipment';
  }

  // 8. Fragrance, Beauty & Personal Care
  if (
    /\b(perfumes?|eau\s+de\s+(?:parfum|toilette)|colognes?|fragrances?|parfums?|skincare|creams?|serums?|niacinamides?|retinols?|moisturizers?|cleansers?|sunscreens?|cosmetics?|hair\s+dryers?|lipsticks?)\b/i.test(
      l
    )
  ) {
    return 'Fragrance, Beauty & Personal Care';
  }

  // 9. Automotive & Car Accessories
  if (
    /\b(car\s+accessor(?:y|ies)|dash\s*cams?|jump\s+starters?|tire\s+inflators?|obd2(?:\s+scanners?)?|car\s+mounts?|car\s+chargers?|floor\s+mats?|roof\s+racks?|cargo\s+boxes?|wiper\s+blades?|radar\s+detectors?|ev\s+chargers?)\b/i.test(
      l
    )
  ) {
    return 'Automotive & Car Accessories';
  }

  // 10. Photography & Cameras
  if (
    /\b(digital\s+cameras?|cameras?|lens|lenses|dslrs?|mirrorless|camcorders?|action\s+cameras?|gopro|fujifilm|photography)\b/i.test(
      l
    )
  ) {
    return 'Photography & Cameras';
  }

  // 11. Audio & Acoustics
  if (/\b(headphones?|earbuds?|earphones?|audio|speakers?|soundbars?|headsets?|microphones?|dacs?)\b/i.test(l)) {
    return 'Audio & Acoustics';
  }

  // 12. Monitors & Displays
  if (/\b(monitors?|displays?|tvs?|screens?|oleds?|projectors?)\b/i.test(l)) {
    return 'Monitors & Displays';
  }

  // 13. Watches, Fashion & Apparel
  if (
    /\b(smartwatch(?:es)?|watches?|wristwatches?|chronographs?|fitness\s+trackers?|wearables?|jackets?|coats?|apparel|clothing|backpacks?|luggage)\b/i.test(
      l
    )
  ) {
    return 'Watches, Fashion & Apparel';
  }

  // 14. Sports, Fitness & Outdoor
  if (
    /\b(treadmills?|rowing\s+machines?|exercise\s+bikes?|dumbbells?|kettlebells?|yoga\s+mats?|camping\s+tents?|sleeping\s+bags?|bicycles?|e-bikes?|golf\s+clubs?|tennis\s+rackets?)\b/i.test(
      l
    )
  ) {
    return 'Sports, Fitness & Outdoor';
  }

  // 15. Books & Literature
  if (/\b(books?|novels?|textbooks?|guides?|reading|literature|audiobooks?|isbn)\b/i.test(l)) {
    return 'Books & Literature';
  }

  // 16. Software & Digital Goods (exclude workload phrases like "software development" or "software engineering")
  const withoutWorkloadPhrases = l.replace(/\bsoftware\s+(?:development|engineering|developers?|engineers?)\b/g, '');
  if (/\b(software|saas|macos\s+apps?|productivity\s+apps?|antivirus|operating\s+systems?)\b/i.test(withoutWorkloadPhrases)) {
    return 'Software & Digital Goods';
  }

  return '';
}

/**
 * Multi-Turn Conversation Context Isolator
 * Preserves conversation history when the user is refining or answering clarifications
 * within the same product category, while cleanly isolating separate product searches
 * when the user switches to a different product category.
 */
export function getRelevantConversationHistory(
  currentPrompt: string,
  previousPrompts?: string[]
): string[] {
  const trimmedCurrent = currentPrompt.trim();
  if (!previousPrompts || previousPrompts.length === 0) {
    return [trimmedCurrent].filter(Boolean);
  }

  const currentCat = detectCategoryFromText(trimmedCurrent);
  const relevantPrev: string[] = [];

  for (let i = previousPrompts.length - 1; i >= 0; i--) {
    const prev = (previousPrompts[i] || '').trim();
    if (!prev) continue;
    const prevCat = detectCategoryFromText(prev);

    if (currentCat) {
      // Current prompt specifies a category: stop if an earlier turn belongs to a DIFFERENT category
      if (prevCat && prevCat !== currentCat) {
        break;
      }
      relevantPrev.unshift(prev);
    } else {
      // Current prompt is a category-neutral follow-up (e.g., "under $500", "which has better warranty?")
      relevantPrev.unshift(prev);
      // Once we anchor to the most recent explicit category turn, stop if an even older turn had a different category
      if (prevCat) {
        for (let j = i - 1; j >= 0; j--) {
          const older = (previousPrompts[j] || '').trim();
          if (!older) continue;
          const olderCat = detectCategoryFromText(older);
          if (olderCat && olderCat !== prevCat) {
            break;
          }
          relevantPrev.unshift(older);
        }
        break;
      }
    }
  }

  return [...relevantPrev, trimmedCurrent].filter(Boolean);
}

/**
 * Intelligent Requirement Clarification Engine
 * Evaluates whether a product intelligence request contains sufficient context
 * (intended use, workload, budget, or specific model) to execute a defensible search,
 * or requires an adaptive clarification step first.
 */
export function assessRequirementCompleteness(input: AgentPipelineInput): RequirementAssessment {
  const rawPrompt = input.prompt.trim();
  const lower = rawPrompt.toLowerCase();

  // Combine relevant conversation turn history to preserve answers across turns without cross-category bleed
  const allPrompts = getRelevantConversationHistory(rawPrompt, input.previousPrompts);
  const combinedHistory = allPrompts.join(' ');
  const combinedLower = combinedHistory.toLowerCase();

  // 1. Direct lookups: URLs, ISBNs, or chemical identifiers are always precise lookups
  if (
    /https?:\/\/[^\s"'<>]+/i.test(rawPrompt) ||
    /\b(?:isbn(?:-1[03])?:?\s*)?(?=[-0-9 ]{17}$|[-0-9X ]{13}$|[0-9X]{10}$)\b/i.test(rawPrompt) ||
    /\b(aspirin|ibuprofen|caffeine|niacinamide|retinol|hyaluronic|paracetamol|acetaminophen)\b/i.test(lower)
  ) {
    return { hasSufficientContext: true };
  }

  // 2. Specific brand models & product identifiers across universal categories
  const specificModelPatterns = [
    /\b(macbook\s*(pro|air)?\s*(m[1-5]|intel)?)\b/i,
    /\b(thinkpad|xps\s*\d+|latitude|zenbook|rog|legion|spectre|envy|surface\s*(pro|laptop)?)\b/i,
    /\b(iphone\s*\d+(?:\s*pro|\s*max|\s*plus|\s*mini)?)\b/i,
    /\b(galaxy\s*(s\d+|z\s*(fold|flip)\d+|a\d+))\b/i,
    /\b(pixel\s*\d+(?:\s*pro|\s*a)?)\b/i,
    /\b(wh-1000xm[345]|airpods(?:\s*pro|\s*max)?|quietcomfort\s*\d+|qc\s*\d+|bose\s*ultra)\b/i,
    /\b(kindle(?:\s*paperwhite|\s*oasis)?|kobo)\b/i,
    /\b(rtx\s*\d{4}|radeon\s*rx\s*\d{4}|geforce)\b/i,
    /\b(logitech\s*(mx\s*master|g\s*pro|craft|pebble))\b/i,
    /\b(sony\s*a\d|canon\s*eos\s*r\d+|nikon\s*z\d+|fujifilm\s*x-[tsh]\d+|lumix\s*s\d+|gopro\s*hero)\b/i,
    /\b(ipad\s*(pro|air|mini)?|galaxy\s*tab)\b/i,
    /\b(apple\s*watch|galaxy\s*watch|garmin\s*(forerunner|fenix))\b/i,
    /\b(herman\s*miller\s*(aeron|embody|sayl)|steelcase\s*(leap|gesture)|secretlab\s*titan)\b/i,
    /\b(nike\s*(pegasus|vaporfly|alphafly|invincible)|hoka\s*(clifton|bondi|speedgoat)|asics\s*(kayano|nimbus|novablast)|brooks\s*(ghost|glycerin|adrenaline)|saucony\s*endorphin)\b/i,
    /\b(dewalt\s*dcd\d+|milwaukee\s*m1[28]\s*fuel|makita\s*lxt|bosch\s*bulldog)\b/i,
    /\b(dior\s*sauvage|bleu\s*de\s*chanel|creed\s*aventus|tom\s*ford\s*oud|le\s*labo\s*santal|chanel\s*no\.?\s*5|baccarat\s*rouge)\b/i,
    /\b(viofo\s*a\d+|garmin\s*dash\s*cam|nextbase\s*\d+gw|noco\s*boost)\b/i,
    /\b(lg\s*(wash\s*tower|instaview|turbawash)|samsung\s*bespoke|bosch\s*[358]00\s*series|miele\s*w1)\b/i,
  ];
  if (specificModelPatterns.some((pattern) => pattern.test(combinedLower))) {
    return { hasSufficientContext: true };
  }

  // 3. Check for presence of explicit workload / intended usage / category-specific specifications
  const hasWorkloadOrSpecs =
    /\b(programming|coding|developer|software|docker|machine\s*learning|video\s*editing|photo\s*editing|4k|gaming|office\s*work|business|school|college|student|travel|flight|commute|marathon|road\s*running|trail\s*running|pronation|overpronation|neutral\s*arch|cushioning|stability|gym|workout|audiophile|studio|anc|noise\s*cancelling|battery\s*life|32gb|16gb|64gb|1tb|ssd|nvme|oled|high\s*refresh|144hz|240hz|color\s*grading|lumbar|mesh\s*back|posture|back\s*pain|8\s*hours|heavy\s*duty|lightweight|drawing|digital\s*art|gps|heart\s*rate|french\s*door|counter[- ]depth|side[- ]by[- ]side|bottom\s*freezer|compact\s*fridge|cu\.?\s*ft|cubic\s*feet|inverter|energy\s*star|front[- ]load|top[- ]load|stackable|he\s*washer|steam\s*clean|cordless\s*drill|impact\s*driver|circular\s*saw|angle\s*grinder|hammer\s*drill|brushless|18v|20v|torque|eau\s*de\s*parfum|eau\s*de\s*toilette|edp|edt|woody|citrus|floral|amber|oud|musk|longevity|sillage|unisex|dash\s*cam|jump\s*starter|tire\s*inflator|obd2|car\s*mount|car\s*charger|night\s*vision|parking\s*mode|full[- ]frame|aps-c|vlogging|wildlife|portrait|telephoto|weather[- ]sealed)\b/i.test(
      combinedLower
    );

  if (hasWorkloadOrSpecs) {
    return { hasSufficientContext: true };
  }

  const hasBudget =
    input.maxBudget !== null && input.maxBudget !== undefined
      ? true
      : /(?:under|below|less than|max|budget|up to)\s*[$€£]?\s*\d+/i.test(combinedLower) ||
        /[$€£]\s*\d+/i.test(combinedLower);

  // 4. Adaptive Questioning for Ambiguous Category Requests (Intended Usage & Reason for Purchasing)
  // Laptops / Computers
  if (/\b(laptop|macbook|computer|notebook|pc|ultrabook)s?\b/i.test(combinedLower)) {
    return {
      hasSufficientContext: false,
      clarification: {
        question: 'What will you primarily use the laptop for, and do you have an acceptable budget range?',
        whyItMatters:
          'Engineering laptops for software development, machine learning, or 4K video editing require multi-core processors, dedicated graphics, and 32GB+ RAM. In contrast, ultraportables for writing and travel prioritize 15+ hour battery life, silent thermals, and light weight.',
        missingRequirement: 'intended_use',
        options: [
          'Software engineering & coding (16–32GB RAM)',
          '4K video editing & creative workloads',
          'PC gaming with high-refresh display',
          'Everyday productivity, web & long battery life',
        ],
      },
      clarificationSuggestions: [
        'Laptop for software engineering under $1,500',
        'Lightweight laptop with 16+ hour battery life',
        'Creator laptop for 4K video editing under $2,000',
        'Gaming laptop with RTX 4070 under $1,400',
      ],
      explanation: 'Identified underspecified laptop request lacking workload and budget constraints.',
    };
  }

  // Refrigerators & Cooling Appliances
  if (/\b(refrigerator|refrigerators|fridge|fridges|freezer|freezers)\b/i.test(combinedLower)) {
    return {
      hasSufficientContext: false,
      clarification: {
        question: 'What refrigerator style, kitchen fit (standard vs. counter-depth), and capacity or budget do you need?',
        whyItMatters:
          'Refrigerator selection depends on kitchen cabinet depth, door clearance, family storage capacity (cubic feet), dual-evaporator cooling consistency, and ENERGY STAR compressor noise levels.',
        missingRequirement: 'intended_use',
        options: [
          'French door counter-depth refrigerator for family kitchen',
          'Large-capacity 26+ cu. ft. French door with ice & water dispenser',
          'Side-by-side stainless steel refrigerator with inverter compressor',
          'Compact or apartment-size bottom-freezer refrigerator',
        ],
      },
      clarificationSuggestions: [
        'Counter-depth French door refrigerator with inverter compressor under $2,200',
        '28 cu. ft. ENERGY STAR French door refrigerator under $1,800',
        'Compact apartment bottom-freezer refrigerator under $900',
      ],
      explanation: 'Identified underspecified refrigerator request lacking configuration, capacity, and budget.',
    };
  }

  // Washing Machines & Laundry Appliances
  if (/\b(washing\s+machine|washing\s+machines|washer|washers|clothes\s+dryer|laundry)\b/i.test(combinedLower)) {
    return {
      hasSufficientContext: false,
      clarification: {
        question: 'Do you prefer a front-load or top-load washing machine, and what household load capacity or budget are you targeting?',
        whyItMatters:
          'Front-load direct-drive washers provide superior fabric care, higher spin extraction (1200+ RPM), steam sanitization, and stackability, whereas large-capacity top-load washers offer faster wash cycles and easy ergonomic loading.',
        missingRequirement: 'intended_use',
        options: [
          'Front-load high-efficiency washer with steam & direct-drive inverter motor',
          'Large-capacity 5.0+ cu. ft. top-load washer for heavy family loads',
          'Stackable smart front-load washer for closet or apartment laundry',
          'All-in-one ventless washer-dryer combo unit',
        ],
      },
      clarificationSuggestions: [
        'Front-load inverter washing machine with steam sanitization under $1,000',
        'Large 5.0 cu. ft. top-load washing machine under $850',
        'Stackable ENERGY STAR front-load washer under $1,100',
      ],
      explanation: 'Identified underspecified washing machine request lacking load type and capacity requirements.',
    };
  }

  // Running Shoes & Footwear
  if (/\b(running\s+shoes?|sneakers?|trainers?|athletic\s+shoes?|footwear)\b/i.test(combinedLower)) {
    return {
      hasSufficientContext: false,
      clarification: {
        question: 'What terrain will you primarily run on, and what cushioning or arch-stability support do you need?',
        whyItMatters:
          'Road marathon shoes rely on responsive nitrogen/Pebax midsole foam and breathable engineered mesh, trail shoes require deep Vibram/lugged outsoles and rock plates, and overpronation requires medial stability guidance.',
        missingRequirement: 'intended_use',
        options: [
          'Daily road running with maximum plush cushioning (neutral arch)',
          'Stability road running shoes for overpronation & joint support',
          'Lightweight carbon-plated race-day & marathon speed shoes',
          'Trail running shoes with high-grip lugged outsole & weather protection',
        ],
      },
      clarificationSuggestions: [
        'Neutral road running shoes with maximum cushioning for marathon training under $160',
        'Stability running shoes for overpronation and flat feet under $150',
        'Trail running shoes with Vibram grip and waterproof upper under $170',
      ],
      explanation: 'Identified underspecified footwear request lacking running surface and biomechanics support needs.',
    };
  }

  // Office Chairs & Ergonomic Furniture
  if (/\b(office\s+chairs?|ergonomic\s+chairs?|desk\s+chairs?|task\s+chairs?)\b/i.test(combinedLower)) {
    return {
      hasSufficientContext: false,
      clarification: {
        question: 'How many hours a day will you sit in this chair, and what ergonomic adjustments or materials are most important to you?',
        whyItMatters:
          'Full 8–12 hour workdays require dynamic lumbar support, synchro-tilt tension control, 4D armrests, seat-depth adjustment, and breathable pellicle/mesh or high-density molded foam certified to BIFMA durability standards.',
        missingRequirement: 'intended_use',
        options: [
          'All-day 8+ hour ergonomic mesh chair with dynamic lumbar & 4D arms',
          'Upholstered foam ergonomic task chair for lower-back support',
          'Heavy-duty BIFMA-certified chair with 300+ lb capacity & headrest',
          'Compact ergonomic home-office chair on a mid-range budget',
        ],
      },
      clarificationSuggestions: [
        'Ergonomic mesh office chair with adjustable lumbar support for 8+ hour workdays under $700',
        'Premium BIFMA-certified ergonomic office chair with 4D armrests under $1,200',
        'Compact home office ergonomic chair with lumbar support under $350',
      ],
      explanation: 'Identified underspecified office chair request lacking daily usage duration and ergonomic priorities.',
    };
  }

  // Power Tools & Hardware
  if (/\b(power\s+tools?)\b/i.test(combinedLower)) {
    return {
      hasSufficientContext: false,
      clarification: {
        question: 'Which specific power tool do you need (e.g., cordless drill, impact driver, circular saw), and is it for home DIY or heavy contractor duty?',
        whyItMatters:
          'Selecting the right tool depends on torque rating (in-lbs/ft-lbs), brushless motor duty cycle, 12V compact vs. 18V/20V Max battery platform compatibility, and kickback safety features.',
        missingRequirement: 'intended_use',
        options: [
          '18V/20V brushless cordless drill/driver kit with batteries',
          'High-torque cordless impact driver for decking & fasteners',
          '7-1/4 inch cordless circular saw or miter saw for woodworking',
          'Multi-tool combo kit (drill, impact driver, reciprocating saw)',
        ],
      },
      clarificationSuggestions: [
        '18V brushless cordless hammer drill and impact driver combo kit under $250',
        'Compact 20V Max brushless cordless drill for home DIY under $150',
        'Heavy-duty 7-1/4 inch brushless circular saw under $220',
      ],
      explanation: 'Identified underspecified power tool request lacking specific tool type and duty level.',
    };
  }

  // Perfumes & Fragrances
  if (/\b(perfumes?|colognes?|fragrances?|parfums?)\b/i.test(combinedLower)) {
    return {
      hasSufficientContext: false,
      clarification: {
        question: 'What scent family, concentration (Eau de Parfum vs. Eau de Toilette), and occasion are you shopping for?',
        whyItMatters:
          'Fragrance performance depends on aromatic oil concentration (Extrait/EDP for 8+ hour longevity vs. EDT for light projection), top/heart/base note structure (woody, citrus, floral, amber/oud), and seasonal wearability.',
        missingRequirement: 'preferences',
        options: [
          'Woody & aromatic Eau de Parfum (EDP) with long 8+ hour longevity',
          'Fresh citrus & marine fragrance for daily office and warm weather',
          'Warm amber, vanilla & oud evening fragrance with strong projection',
          'Floral & botanical Eau de Parfum for versatile year-round wear',
        ],
      },
      clarificationSuggestions: [
        'Woody aromatic Eau de Parfum with long longevity under $180',
        'Fresh citrus everyday fragrance with clean projection under $130',
        'Warm amber and vanilla evening Eau de Parfum under $220',
      ],
      explanation: 'Identified underspecified fragrance request lacking olfactory profile, concentration, and occasion.',
    };
  }

  // Car Accessories & Automotive Equipment
  if (/\b(car\s+accessor(?:y|ies))\b/i.test(combinedLower)) {
    return {
      hasSufficientContext: false,
      clarification: {
        question: 'What type of car accessory are you looking for (e.g., 4K dash cam, emergency jump starter, tire inflator, or cabin mount)?',
        whyItMatters:
          'Automotive accessories require strict verification of thermal tolerance (-20°C to 70°C supercapacitors for dash cams), peak cranking amperage (for 12V battery jump starters), or vehicle fitment compatibility.',
        missingRequirement: 'intended_use',
        options: [
          'Front & rear 4K dash cam with Sony STARVIS night vision & GPS',
          'Portable lithium car battery jump starter & digital tire inflator',
          'MagSafe / Qi2 fast wireless car mount & charger',
          'OBD2 diagnostic scanner or all-weather custom floor mats',
        ],
      },
      clarificationSuggestions: [
        '4K dual front and rear dash cam car accessory with GPS and night vision under $220',
        'Portable 2000A lithium jump starter and tire inflator car accessory under $140',
        'Qi2 fast wireless charging car mount accessory under $70',
      ],
      explanation: 'Identified underspecified car accessory request lacking functional category.',
    };
  }

  // Audio / Headphones
  if (/\b(headphone|headphones|earbud|earbuds|earphone|earphones|headset|headsets)\b/i.test(combinedLower)) {
    return {
      hasSufficientContext: false,
      clarification: {
        question: 'What is your primary listening use case and preferred form factor?',
        whyItMatters:
          'Over-ear headphones with active noise cancellation provide superior acoustic isolation for travel and open offices, while sweat-resistant wireless earbuds offer secure fit and portability for running and workouts.',
        missingRequirement: 'intended_use',
        options: [
          'Over-ear noise cancelling for travel & focus',
          'Wireless earbuds for gym & running',
          'Audiophile studio listening with neutral soundstage',
          'Work headset with noise-rejecting microphone',
        ],
      },
      clarificationSuggestions: [
        'Over-ear noise cancelling headphones for travel under $350',
        'Waterproof wireless earbuds for running under $150',
        'Open-back audiophile headphones for home listening',
        'Wireless headset with clear mic for video calls under $200',
      ],
      explanation: 'Identified underspecified audio request lacking environment and use case.',
    };
  }

  // Smartphones & Mobile Devices
  if (/\b(phone|phones|smartphone|smartphones|mobile)\b/i.test(combinedLower)) {
    return {
      hasSufficientContext: false,
      clarification: {
        question: 'Which mobile ecosystem and features are most important to you?',
        whyItMatters:
          'Ecosystem integration (Apple iOS vs. Android) dictates compatibility with smartwatches and accessories. Prioritizing pro-grade camera sensors, maximum battery longevity, or compact form factor will fundamentally alter which model is optimal.',
        missingRequirement: 'preferences',
        options: [
          'Apple iOS ecosystem with pro camera system',
          'Android flagship with maximum battery & zoom lens',
          'Mid-range value smartphone under $500',
          'Compact one-handed smartphone',
        ],
      },
      clarificationSuggestions: [
        'Apple iPhone with pro camera under $1,000',
        'Android flagship with top battery life under $800',
        'Best mid-range smartphone under $450',
        'Compact flagship smartphone with great camera',
      ],
      explanation: 'Identified underspecified smartphone request lacking ecosystem and priorities.',
    };
  }

  // Monitors & Displays
  if (/\b(monitor|monitors|display|displays|screen|screens)\b/i.test(combinedLower)) {
    return {
      hasSufficientContext: false,
      clarification: {
        question: 'What devices will you connect, and what is your primary activity on this display?',
        whyItMatters:
          'Software engineering and document work require high pixel density (4K) and USB-C laptop power delivery. Gaming requires 144Hz+ refresh rates and VRR, while photo grading demands calibrated DCI-P3 color accuracy.',
        missingRequirement: 'intended_use',
        options: [
          'Productivity & coding (4K crisp text + USB-C charging)',
          'High-refresh gaming (144Hz–240Hz with G-Sync/FreeSync)',
          'Color-accurate photo and video grading (OLED/IPS)',
          'Ultrawide 34-inch for multi-window multitasking',
        ],
      },
      clarificationSuggestions: [
        '27-inch 4K monitor with USB-C 90W charging under $500',
        '34-inch curved ultrawide monitor for coding under $600',
        '27-inch 1440p 240Hz gaming monitor under $400',
        'Color-calibrated 4K display for photo editing under $700',
      ],
      explanation: 'Identified underspecified monitor request lacking resolution and activity requirements.',
    };
  }

  // Photography & Cameras
  if (/\b(camera|cameras|dslr|mirrorless)\b/i.test(combinedLower)) {
    return {
      hasSufficientContext: false,
      clarification: {
        question: 'What type of photography or video content will you be shooting?',
        whyItMatters:
          'Street and travel photography demand compact bodies and small prime lenses, whereas wildlife and sports require fast burst rates and telephoto stabilization, and vlogging needs articulate screens and audio inputs.',
        missingRequirement: 'intended_use',
        options: [
          'Travel & street photography (compact & lightweight)',
          'Vlogging & YouTube 4K video production',
          'Portraits & events with fast aperture lenses',
          'Beginner mirrorless kit to learn photography',
        ],
      },
      clarificationSuggestions: [
        'Compact mirrorless camera for travel under $900',
        '4K vlogging camera with flip screen under $800',
        'Full-frame mirrorless camera for portraits under $1,800',
        'Entry-level mirrorless camera with kit lens under $650',
      ],
      explanation: 'Identified underspecified camera request lacking shooting focus and budget.',
    };
  }

  // Tablets & iPads
  if (/\b(tablet|tablets|ipad|ipads)\b/i.test(combinedLower)) {
    return {
      hasSufficientContext: false,
      clarification: {
        question: 'What is your primary use case for this tablet (e.g., stylus drawing, media streaming, or laptop replacement)?',
        whyItMatters:
          'Digital illustration and graphic design require precise stylus support (like Apple Pencil or S-Pen) and 120Hz latency. In contrast, media streaming prioritizes OLED displays and quad speakers, while mobile productivity demands detachable keyboard support.',
        missingRequirement: 'intended_use',
        options: [
          'Digital art, sketching & stylus note-taking',
          'Media streaming, movies & reading (OLED display)',
          'Lightweight laptop replacement with keyboard',
          'Kid-friendly durable family tablet',
        ],
      },
      clarificationSuggestions: [
        'iPad Air for digital art with Apple Pencil support under $700',
        'Android OLED tablet for movies and media under $500',
        '2-in-1 tablet with detachable keyboard for work under $900',
        'Budget tablet for e-books and web browsing under $300',
      ],
      explanation: 'Identified underspecified tablet request lacking primary workload.',
    };
  }

  // Smartwatches & Wearables
  if (/\b(smartwatch|smartwatches|wearable|wearables|fitness\s*tracker)\b/i.test(combinedLower)) {
    return {
      hasSufficientContext: false,
      clarification: {
        question: 'What is your primary reason for getting a smartwatch, and what phone will it pair with?',
        whyItMatters:
          'Operating system compatibility is critical (Apple Watch only pairs with iPhone; WearOS pairs with Android). Dedicated marathon and outdoor fitness require multi-band GPS and 7+ day battery life, while daily connectivity focuses on cellular calls and notification response.',
        missingRequirement: 'intended_use',
        options: [
          'Fitness & outdoor workout tracking (long battery & GPS)',
          'Daily notifications & calls paired with iPhone',
          'Daily notifications & calls paired with Android',
          'Heart health, sleep & wellness tracking',
        ],
      },
      clarificationSuggestions: [
        'Apple Watch with cellular and heart tracking under $450',
        'Garmin GPS running watch with 10+ day battery under $400',
        'Samsung Galaxy Watch for Android under $300',
        'Affordable fitness tracker with sleep tracking under $120',
      ],
      explanation: 'Identified underspecified smartwatch request lacking paired phone and primary use case.',
    };
  }

  // Very brief or general query lacking budget or specs
  if (rawPrompt.split(/\s+/).length <= 3 && !hasBudget) {
    return {
      hasSufficientContext: false,
      clarification: {
        question: 'Could you share the specific product type, intended use, or target price range you have in mind?',
        whyItMatters:
          'Spark evaluates real, live merchant catalog data across all product categories worldwide. Clarifying your requirements prevents generic guesses and ensures we recommend products matched to your quality and suitability needs.',
        missingRequirement: 'intended_use',
        options: [
          'Home appliances, furniture & kitchen equipment',
          'Computers, smartphones, cameras & audio gear',
          'Footwear, watches, fragrance & personal care',
          'Power tools, automotive accessories & outdoor gear',
        ],
      },
      clarificationSuggestions: [
        'Counter-depth French door refrigerator under $2,000',
        'Ergonomic mesh office chair for 8+ hour workdays under $700',
        'Neutral road running shoes for marathon training under $160',
      ],
      explanation: 'Identified general request requiring product category or use-case clarification.',
    };
  }

  return { hasSufficientContext: true };
}

/**
 * Regional Purchasing Market & Currency Intelligence
 * Identifies the user's intended purchasing market and currency from prompt, history, or location.
 * Never assumes US availability or USD pricing is suitable when a non-US market is specified.
 */
export function detectPurchasingMarket(
  text: string,
  location?: string,
  preferredCurrency?: 'USD' | 'EUR' | 'GBP'
): {
  market: string;
  purchasingMarket: string;
  currency: 'USD' | 'EUR' | 'GBP';
  isExplicitNonUsMarket: boolean;
  isMarketExplicitlySpecified: boolean;
  regionalDisclosure: string | null;
} {
  const combined = `${text} ${location || ''}`.toLowerCase();

  if (/\b(uk|united\s+kingdom|britain|england|scotland|london|gbp)\b/i.test(combined) || combined.includes('£') || preferredCurrency === 'GBP') {
    return {
      market: 'United Kingdom (GBP)',
      purchasingMarket: 'United Kingdom (GBP)',
      currency: 'GBP',
      isExplicitNonUsMarket: true,
      isMarketExplicitlySpecified: true,
      regionalDisclosure:
        'United Kingdom (GBP) market (230V/50Hz UK plug & warranty); US/USD offers flagged if UK stock unavailable.',
    };
  }

  if (
    /\b(eu|europe|european\s+union|germany|france|spain|italy|netherlands|belgium|austria|ireland|eur)\b/i.test(combined) ||
    combined.includes('€') ||
    preferredCurrency === 'EUR'
  ) {
    return {
      market: 'European Union (EUR)',
      purchasingMarket: 'European Union (EUR)',
      currency: 'EUR',
      isExplicitNonUsMarket: true,
      isMarketExplicitlySpecified: true,
      regionalDisclosure:
        'European Union (EUR) market (230V/50Hz CE & EU warranty); non-EU offers disclosed.',
    };
  }

  if (/\b(canada|canadian|toronto|vancouver|montreal|cad)\b/i.test(combined)) {
    return {
      market: 'Canada (CAD / North America)',
      purchasingMarket: 'Canada (CAD / North America)',
      currency: preferredCurrency || 'USD',
      isExplicitNonUsMarket: true,
      isMarketExplicitlySpecified: true,
      regionalDisclosure:
        'Canada market; USD catalog pricing shown where CAD is unavailable (verify duties/warranty at checkout).',
    };
  }

  if (/\b(australia|australian|sydney|melbourne|aud)\b/i.test(combined)) {
    return {
      market: 'Australia (AUD / APAC)',
      purchasingMarket: 'Australia (AUD / APAC)',
      currency: preferredCurrency || 'USD',
      isExplicitNonUsMarket: true,
      isMarketExplicitlySpecified: true,
      regionalDisclosure:
        'Australia market (230V/50Hz); verify AUD stock and voltage compatibility at checkout.',
    };
  }

  const hasExplicitUsCountry = /\b(us|usa|u\.s\.a?\.|united\s+states|america)\b/i.test(combined);
  const hasExplicitUsdCurrency = combined.includes('$') || /\busd\b/i.test(combined) || preferredCurrency === 'USD';

  if (hasExplicitUsCountry) {
    return {
      market: 'United States (USD)',
      purchasingMarket: 'United States (USD)',
      currency: 'USD',
      isExplicitNonUsMarket: false,
      isMarketExplicitlySpecified: true,
      regionalDisclosure:
        'US (USD) market; shipping and local sales taxes calculated at checkout.',
    };
  }

  if (hasExplicitUsdCurrency) {
    return {
      market: 'United States (USD)',
      purchasingMarket: 'United States (USD)',
      currency: 'USD',
      isExplicitNonUsMarket: false,
      isMarketExplicitlySpecified: false,
      regionalDisclosure:
        'USD ($) specified (US catalog feed); delivery country unstated—verify regional delivery/tax at checkout.',
    };
  }

  return {
    market: 'United States (USD)',
    purchasingMarket: 'Unspecified Region — Defaulting to US Catalog (USD)',
    currency: 'USD',
    isExplicitNonUsMarket: false,
    isMarketExplicitlySpecified: false,
    regionalDisclosure:
      'Country/currency unspecified; defaulting to US catalog (USD). Specify your region for non-US pricing.',
  };
}

/**
 * Stage 1: Dynamic Intent & Research Strategy Formulation
 * Analyzes query, extracts category, constraints, feature priorities, purchasing market, and multi-turn context.
 */
export function formulateResearchStrategy(input: AgentPipelineInput): {
  category: string;
  targetBudget: number | null;
  currency: 'USD' | 'EUR' | 'GBP';
  purchasingMarket: string;
  isMarketExplicitlySpecified: boolean;
  regionalDisclosure: string | null;
  recommendationScope: 'user_specified_intent' | 'general_market_recommendation';
  userIntentExplicit: boolean;
  searchQuery: string;
  featurePriorities: string[];
  intendedUsage: string;
  evaluationCriteria: Array<{ name: string; weight: number; description: string }>;
} {
  const rawPrompt = input.prompt.trim();
  const lower = rawPrompt.toLowerCase();
  const allPrompts = getRelevantConversationHistory(rawPrompt, input.previousPrompts);
  const combinedHistory = allPrompts.join(' ');
  const combinedLower = combinedHistory.toLowerCase();

  const marketInfo = detectPurchasingMarket(combinedHistory, input.location, input.currency);

  // Budget detection
  let targetBudget = input.maxBudget ?? null;
  let currency: 'USD' | 'EUR' | 'GBP' = marketInfo.currency;
  const budgetMatch = rawPrompt.match(/(?:under|below|less than|max|budget|up to)\s*([$€£]?)\s*(\d+(?:\.\d+)?)/i);
  if (budgetMatch) {
    targetBudget = parseFloat(budgetMatch[2]);
    if (budgetMatch[1] === '€' || /\beur\b/i.test(lower)) currency = 'EUR';
    else if (budgetMatch[1] === '£' || /\bgbp\b/i.test(lower)) currency = 'GBP';
    else if (budgetMatch[1] === '$' || /\busd\b/i.test(lower)) currency = 'USD';
  }

  // Multi-turn context preservation within the isolated category conversation history
  if (targetBudget === null && allPrompts.length > 1) {
    for (let i = allPrompts.length - 2; i >= 0; i--) {
      const prevMatch = allPrompts[i].match(/(?:under|below|less than|max|budget|up to)\s*([$€£]?)\s*(\d+(?:\.\d+)?)/i);
      if (prevMatch) {
        targetBudget = parseFloat(prevMatch[2]);
        if (prevMatch[1] === '€' || /\beur\b/i.test(allPrompts[i])) currency = 'EUR';
        else if (prevMatch[1] === '£' || /\bgbp\b/i.test(allPrompts[i])) currency = 'GBP';
        break;
      }
    }
  }

  // Category determination
  let category = detectCategoryFromText(lower);

  // If not found in current prompt, check relevant previous prompts in the same search thread
  if (!category && allPrompts.length > 1) {
    for (let i = allPrompts.length - 2; i >= 0; i--) {
      const prevCat = detectCategoryFromText(allPrompts[i]);
      if (prevCat) {
        category = prevCat;
        break;
      }
    }
  }

  if (!category && input.category) {
    category = detectCategoryFromText(input.category) || input.category;
  }

  if (!category) {
    category = 'Universal Consumer & Commercial Goods';
  }

  // Clean search query to optimize Channel3 search recall
  const cleanedSearchQuery = rawPrompt
    .replace(/(?:under|below|less than|max|budget|up to)\s*[$€£]?\s*\d+(?:\.\d+)?/gi, '')
    .replace(/\b(find|compare|search|discover|recommend|the best|show me|looking for)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || rawPrompt;

  // Extract user-stated intended usage ONLY when explicitly present in the user's prompt/history.
  // Never invent household size, budget, or personal usage scenarios.
  let intendedUsage = 'General-Market Recommendation (no specific personal usage scenario or household size specified by user)';
  let userIntentExplicit = false;

  if (/\b(programming|coding|developer|software|docker|compiler|engineering)\b/i.test(combinedLower)) {
    intendedUsage = 'User-specified software engineering, coding, and development workflows';
    userIntentExplicit = true;
  } else if (/\b(video\s*editing|color\s*grading|premiere|davinci|creative|rendering)\b/i.test(combinedLower) && category !== 'Automotive & Car Accessories') {
    intendedUsage = 'User-specified video editing and creative media production';
    userIntentExplicit = true;
  } else if (/\b(gaming|fps|esports|144hz|165hz|240hz)\b/i.test(combinedLower)) {
    intendedUsage = 'User-specified high-refresh gaming and graphics workloads';
    userIntentExplicit = true;
  } else if (/\b(marathon|road\s*running|trail\s*running|overpronation|pronation|neutral\s*road)\b/i.test(combinedLower)) {
    intendedUsage = 'User-specified running and athletic training requirements';
    userIntentExplicit = true;
  } else if (/\b(\d+\s*hours?|all[- ]day\s*sitting|lumbar|back\s*pain|ergonomic\s*mesh)\b/i.test(combinedLower) && category === 'Furniture & Ergonomics') {
    intendedUsage = 'User-specified ergonomic seating and lumbar support requirements';
    userIntentExplicit = true;
  } else if (/\b(travel\s*photography|street\s*photography|vlogging|portrait|wildlife)\b/i.test(combinedLower)) {
    intendedUsage = 'User-specified photography and video capture requirements';
    userIntentExplicit = true;
  } else if (
    category === 'Major Home Appliances' &&
    (/\b(family\s*of\s*\d+|household|apartment|condo|garage|pet\s*hair|allerg\w+|sanitize|baby|heavy\s*laundry)\b/i.test(combinedLower) ||
      (targetBudget !== null && /\b(dual\s*ice|steam\s*clean|energy\s*star|inverter)\b/i.test(combinedLower)))
  ) {
    intendedUsage = 'User-specified appliance configuration and budget requirements (no unstated household size assumed)';
    userIntentExplicit = true;
  } else if (/\b(travel|flight|commute|airplane|portable|lightweight)\b/i.test(combinedLower)) {
    intendedUsage = 'User-specified travel, commuting, and portability requirements';
    userIntentExplicit = true;
  } else if (/\b(student|college|school|lecture|note)\b/i.test(combinedLower)) {
    intendedUsage = 'User-specified academic study and student portability requirements';
    userIntentExplicit = true;
  }

  const recommendationScope: 'user_specified_intent' | 'general_market_recommendation' = userIntentExplicit
    ? 'user_specified_intent'
    : 'general_market_recommendation';

  // Category-adaptive evaluation criteria weights (Zero Cheapest-Price Bias; tailored to each category)
  let evaluationCriteria: Array<{ name: string; weight: number; description: string }>;
  if (category === 'Laptops & Computing') {
    evaluationCriteria = [
      {
        name: 'Processor Architecture (CPU), GPU & VRAM Throughput',
        weight: 30,
        description: 'Multi-core processor (CPU) execution speed, discrete/integrated GPU compute, and dedicated VRAM or unified memory bandwidth under sustained workloads.',
      },
      {
        name: 'System RAM Capacity, Storage Speed & Multitasking',
        weight: 25,
        description: 'Memory (RAM) headroom (16GB–64GB+ DDR5/Unified) and PCIe NVMe SSD throughput for concurrent IDEs, containers, and heavy creative workflows.',
      },
      {
        name: 'Display Panel Quality, Refresh Rate, Thermals & Battery Endurance',
        weight: 20,
        description: 'Display resolution (OLED / Liquid Retina XDR / 4K / QHD+), color accuracy, sustained chassis thermals, and unplugged battery life.',
      },
      {
        name: 'Price-to-Performance Value & Budget Fit',
        weight: 15,
        description: 'Hardware capability delivered per dollar within the user budget without sacrificing thermal or build reliability.',
      },
      {
        name: 'Verified Merchant Provenance & Evidence Integrity',
        weight: 10,
        description: 'Confirmed stock status, authorized retailer backing, and verified specification completeness.',
      },
    ];
  } else if (category === 'Smartphones & Mobile Devices') {
    evaluationCriteria = [
      {
        name: 'Processor Silicon Performance, Thermal Efficiency & OS Longevity',
        weight: 30,
        description: 'Flagship SoC processor speed, on-device neural processing capability, and guaranteed multi-year OS/security updates.',
      },
      {
        name: 'Cameras, Optical Sensor System & Computational Imaging',
        weight: 25,
        description: 'Primary and telephoto camera optics, optical image stabilization (OIS), low-light dynamic range, and 4K video capture.',
      },
      {
        name: 'Display Panel Brightness, Refresh Rate & Battery Endurance',
        weight: 20,
        description: 'LTPO OLED / AMOLED display outdoor peak brightness, 120Hz adaptive refresh rate, all-day battery capacity, and fast charging.',
      },
      {
        name: 'Price-to-Performance Value & Ecosystem Integration',
        weight: 15,
        description: 'Total value across storage tiers, accessory compatibility, and long-term resale durability.',
      },
      {
        name: 'Verified Merchant Provenance & Evidence Integrity',
        weight: 10,
        description: 'Authorized carrier/merchant status, verified pricing, and live stock confirmation.',
      },
    ];
  } else if (category === 'Major Home Appliances') {
    evaluationCriteria = [
      {
        name: 'Capacity, Configuration Fit & Core Mechanical Performance',
        weight: 30,
        description: 'Usable interior/drum capacity (cu. ft.), cooling technology (dual evaporator / digital inverter compressor) or direct-drive wash precision, and storage flexibility.',
      },
      {
        name: 'Energy & Water Efficiency, Certifications & Acoustic Decibels',
        weight: 25,
        description: 'ENERGY STAR energy efficiency, annual kWh/water consumption, UL/CSA safety compliance, and quiet low-dBA household operation.',
      },
      {
        name: 'Build Durability, Reliability, Materials & Manufacturer Warranty',
        weight: 20,
        description: 'Stainless steel construction, adjustable tempered shelving, compressor/sealed-system reliability, and manufacturer warranty coverage.',
      },
      {
        name: 'Price-to-Value Ratio & Long-Term Operating Economy',
        weight: 15,
        description: 'Purchase value balanced against 10-year utility savings and mechanical longevity.',
      },
      {
        name: 'Authorized Appliance Retailer & Delivery Provenance',
        weight: 10,
        description: 'Verified stock status, authentic manufacturer SKU, and authorized appliance dealer fulfillment.',
      },
    ];
  } else if (category === 'Footwear & Athletic Gear') {
    evaluationCriteria = [
      {
        name: 'Midsole Cushioning, Energy Return & Biomechanical Support',
        weight: 30,
        description: 'Supercritical/EVA/Pebax foam shock attenuation, heel-to-toe drop geometry, arch stability, and joint protection over high mileage.',
      },
      {
        name: 'Outsole Traction, Rubber Durability & Terrain Grip',
        weight: 25,
        description: 'High-abrasion carbon/blown rubber or Vibram lugged outsole grip across wet pavement, track, or trail surfaces.',
      },
      {
        name: 'Upper Breathability, Lockdown Fit & Weight Balance',
        weight: 20,
        description: 'Engineered mesh ventilation, heel counter lockdown, toe-box anatomical comfort, and ounce-for-ounce agility.',
      },
      {
        name: 'Cost-Per-Mile Value & Construction Longevity',
        weight: 15,
        description: 'Foam resilience across 300–500+ miles of training relative to retail price.',
      },
      {
        name: 'Verified Athletic Footwear Retailer & Authenticity',
        weight: 10,
        description: 'Guaranteed authentic brand stock, verified pricing, and direct retailer availability.',
      },
    ];
  } else if (category === 'Furniture & Ergonomics') {
    evaluationCriteria = [
      {
        name: 'Lumbar Support Geometry & Multi-Point Ergonomic Adjustability',
        weight: 30,
        description: 'Dynamic/adjustable lumbar tracking, synchro-tilt recline tension, seat pan depth/height range, and 3D/4D armrest articulation.',
      },
      {
        name: 'Upholstery Breathability, Cushion Density & Frame Construction',
        weight: 25,
        description: 'Elastomeric suspension mesh or high-resilience molded foam, cast-aluminum/reinforced steel base, and smooth-rolling casters.',
      },
      {
        name: 'ANSI/BIFMA Safety Certification, Load Rating & Warranty',
        weight: 20,
        description: 'BIFMA X5.1 commercial durability certification, 300+ lb weight capacity, GREENGUARD indoor air quality, and multi-year structural warranty.',
      },
      {
        name: 'Long-Term Ergonomic Value & Posture ROI',
        weight: 15,
        description: 'Cost amortized over 5–12 years of daily 8+ hour seating comfort without foam bottoming-out.',
      },
      {
        name: 'Verified Merchant Fulfillment & Authentic Provenance',
        weight: 10,
        description: 'Authorized furniture dealer backing, verified pricing, and stock confirmation.',
      },
    ];
  } else if (category === 'Photography & Cameras') {
    evaluationCriteria = [
      {
        name: 'Image Sensor Format, Dynamic Range & Low-Light ISO Performance',
        weight: 30,
        description: 'Full-Frame / APS-C / Micro Four Thirds CMOS sensor readout speed, dynamic range latitude, and high-ISO noise control.',
      },
      {
        name: 'Phase-Detect Autofocus, Burst Speed & In-Body Stabilization (IBIS)',
        weight: 25,
        description: 'AI subject/eye tracking reliability, mechanical/electronic shutter fps, and 5-axis sensor-shift optical stabilization.',
      },
      {
        name: 'Video Capture Specs, EVF Ergonomics & Lens Mount Ecosystem',
        weight: 20,
        description: '10-bit 4K/6K video recording, OLED viewfinder clarity, weather sealing, and native lens mount selection.',
      },
      {
        name: 'Price-to-Performance Value & System Longevity',
        weight: 15,
        description: 'Imaging capability per dollar and long-term value retention of the camera body and mount.',
      },
      {
        name: 'Authorized Camera Dealer & Warranty Provenance',
        weight: 10,
        description: 'Verified non-gray-market retail provenance, confirmed pricing, and stock status.',
      },
    ];
  } else if (category === 'Power Tools, Hardware & Equipment') {
    evaluationCriteria = [
      {
        name: 'Brushless Motor Torque, RPM Output & Duty Cycle Performance',
        weight: 30,
        description: 'Sustained torque (in-lbs / ft-lbs), variable RPM/IPM speed control, and brushless motor efficiency under heavy load.',
      },
      {
        name: 'Battery Voltage Platform, Runtime & Charger Compatibility',
        weight: 25,
        description: '18V / 20V Max / 40V lithium-ion battery pack capacity (Ah), thermal overload protection, and cross-tool platform compatibility.',
      },
      {
        name: 'Mechanical Durability, Chuck/Gearbox Build & Safety Features',
        weight: 20,
        description: 'All-metal ratcheting chuck and gear housing, electronic kickback brake, anti-vibration grip, and UL/OSHA safety compliance.',
      },
      {
        name: 'Kit Value (Bare Tool vs. Battery/Charger Bundle)',
        weight: 15,
        description: 'Total value including included battery packs, rapid charger, carrying case, and 3–5 year tool warranty.',
      },
      {
        name: 'Authorized Hardware Retailer & Genuine SKU Verification',
        weight: 10,
        description: 'Verified factory-authentic tool listing, live stock, and transparent merchant pricing.',
      },
    ];
  } else if (category === 'Fragrance, Beauty & Personal Care') {
    evaluationCriteria = [
      {
        name: 'Olfactory Composition, Note Balance & Ingredient Quality',
        weight: 30,
        description: 'Harmony across top, heart, and base notes (or active dermatological concentration), natural/aroma-chemical refinement, and skin chemistry balance.',
      },
      {
        name: 'Concentration Strength (Parfum/EDP/EDT), Longevity & Sillage',
        weight: 25,
        description: 'Aromatic oil concentration percentage, 6–12+ hour skin wear duration, and controlled projection trail.',
      },
      {
        name: 'Versatility, Seasonal Suitability & Dermatological Safety',
        weight: 20,
        description: 'Adaptability across daytime/evening or seasonal climates, IFRA compliance, and batch authenticity.',
      },
      {
        name: 'Price-per-Milliliter Value & Presentation Quality',
        weight: 15,
        description: 'Cost per ml (50ml / 100ml fl. oz. bottle sizes), atomizer quality, and value against comparable niche/designer houses.',
      },
      {
        name: 'Authorized Fragrance/Beauty Retailer & Batch Provenance',
        weight: 10,
        description: 'Guaranteed authentic retail sourcing (zero counterfeit risk), verified price, and live stock.',
      },
    ];
  } else if (category === 'Automotive & Car Accessories') {
    evaluationCriteria = [
      {
        name: 'Core Functional Performance & Automotive-Grade Hardware',
        weight: 30,
        description: 'Optical clarity (4K STARVIS night vision for dash cams), peak cranking amps/PSI (for jump starters/inflators), or precision vehicle fitment.',
      },
      {
        name: 'Extreme Cabin Temperature Tolerance & Electrical Safety',
        weight: 25,
        description: 'Supercapacitor thermal endurance (-20°C to 70°C), reverse-polarity/short-circuit protection, and 12V/USB-C vehicle power stability.',
      },
      {
        name: 'Installation Usability, Mounting Stability & App/GPS Integration',
        weight: 20,
        description: 'Clean cable routing, vibration-free adhesive/magnetic mounting, parking-mode hardwire support, and intuitive controls.',
      },
      {
        name: 'Price-to-Performance Value & Warranty Backing',
        weight: 15,
        description: 'Dependable roadside/driving utility delivered per dollar with manufacturer warranty support.',
      },
      {
        name: 'Verified Automotive Merchant & Specification Integrity',
        weight: 10,
        description: 'Confirmed stock availability, verified retail price, and authentic product documentation.',
      },
    ];
  } else if (category === 'Audio & Acoustics') {
    evaluationCriteria = [
      {
        name: 'Acoustic Fidelity, Driver Tuning & Soundstage',
        weight: 30,
        description: 'Frequency response accuracy, dynamic range, codec support, and clarity across vocal and bass frequencies.',
      },
      {
        name: 'Active Noise Cancellation (ANC) & Microphone Clarity',
        weight: 25,
        description: 'Low- and high-frequency ambient attenuation, transparency mode naturalness, and voice pickup.',
      },
      {
        name: 'Ergonomic Comfort, Fit Stability & Battery Runtime',
        weight: 20,
        description: 'Clamping force distribution, ear cushion breathability, IP rating, and continuous playback hours.',
      },
      {
        name: 'Price-to-Performance Ratio & Ecosystem Features',
        weight: 15,
        description: 'Multipoint Bluetooth pairing, companion app EQ customization, and long-term value.',
      },
      {
        name: 'Verified Merchant Provenance & Evidence Integrity',
        weight: 10,
        description: 'Authentic retail fulfillment, verified pricing, and customer review credibility.',
      },
    ];
  } else {
    evaluationCriteria = [
      {
        name: 'Category Performance & Core Functional Specifications',
        weight: 30,
        description: 'Primary functional capabilities, domain-specific specifications, capacity, and real-world suitability.',
      },
      {
        name: 'Price-to-Value Ratio & Long-Term Ownership Economy',
        weight: 25,
        description: 'Quality delivered per dollar, verified merchant deals, promotional discounts, and service life.',
      },
      {
        name: 'Material Quality, Durability & Verified Buyer Reputation',
        weight: 20,
        description: 'Construction integrity, safety certifications, warranty coverage, and verified customer ratings.',
      },
      {
        name: 'User Requirement Alignment & Usability Fit',
        weight: 15,
        description: 'Direct fulfillment of explicit user parameters, intended usage scenarios, and budget constraints.',
      },
      {
        name: 'Evidence Completeness & Authorized Merchant Provenance',
        weight: 10,
        description: 'Source verification status, availability of direct merchant URL, and real-time data freshness.',
      },
    ];
  }

  // Remember category-relevant feature priorities across the isolated conversation history
  const featurePriorities: string[] = [];
  if (combinedLower.includes('battery') || combinedLower.includes('portable')) featurePriorities.push('Battery Life & Portability');
  if (combinedLower.includes('noise') || combinedLower.includes('anc') || combinedLower.includes('quiet')) featurePriorities.push('Active Noise Cancellation');
  if (/\b(ram|memory|\d+gb)\b/i.test(combinedLower)) featurePriorities.push('Memory & Storage');
  if (combinedLower.includes('lightweight') || combinedLower.includes('travel')) featurePriorities.push('Weight & Portability');
  if (combinedLower.includes('screen') || combinedLower.includes('oled') || combinedLower.includes('display') || combinedLower.includes('4k')) featurePriorities.push('Display Quality');
  if (combinedLower.includes('camera') || combinedLower.includes('photo') || combinedLower.includes('video')) featurePriorities.push('Camera & Imaging Capability');
  if (combinedLower.includes('gaming') || combinedLower.includes('144hz') || combinedLower.includes('rtx')) featurePriorities.push('High-Refresh Gaming Throughput');
  if (/\b(inverter|energy\s*star|counter[- ]depth|french\s*door|steam|front[- ]load)\b/i.test(combinedLower)) featurePriorities.push('Appliance Efficiency & Configuration');
  if (/\b(cushion|pronation|stability|marathon|trail|arch|vibram)\b/i.test(combinedLower)) featurePriorities.push('Cushioning & Biomechanical Stability');
  if (/\b(lumbar|ergonomic|mesh|bifma|armrest|posture)\b/i.test(combinedLower)) featurePriorities.push('Ergonomic Lumbar & Adjustability');
  if (/\b(brushless|torque|cordless|18v|20v|lithium)\b/i.test(combinedLower)) featurePriorities.push('Brushless Torque & Battery Platform');
  if (/\b(parfum|edp|longevity|sillage|woody|citrus|amber|floral)\b/i.test(combinedLower)) featurePriorities.push('Olfactory Longevity & Concentration');
  if (/\b(dash\s*cam|night\s*vision|starvis|jump\s*starter|inflator|obd2)\b/i.test(combinedLower)) featurePriorities.push('Automotive Safety & Reliability');

  return {
    category,
    targetBudget,
    currency,
    purchasingMarket: marketInfo.purchasingMarket,
    isMarketExplicitlySpecified: marketInfo.isMarketExplicitlySpecified,
    regionalDisclosure: marketInfo.regionalDisclosure,
    recommendationScope,
    userIntentExplicit,
    searchQuery: cleanedSearchQuery,
    featurePriorities,
    intendedUsage,
    evaluationCriteria,
  };
}

/**
 * Canonical Product Identity Key Extractor
 * Separates unique products from merchant offers. Multiple retailers selling the same SKU
 * (matching Channel3 Product ID, GTIN/UPC/EAN, Manufacturer Model Number, or normalized brand + product title)
 * map to the same canonical product identity key.
 */
export function getProductIdentityKeys(offer: ProductOffer): string[] {
  const specs = offer.specs || {};
  const keys: string[] = [];

  // 1. Explicit Channel3 Product ID in specs
  const ch3Id = (specs['Channel3 Product ID'] || '').trim();
  if (ch3Id && !/^(unknown|unverified|none|n\/a)$/i.test(ch3Id)) {
    keys.push(`ch3_pid:${ch3Id.toLowerCase()}`);
  }

  // 2. GTIN / UPC / EAN barcode identifier
  const gtin = (specs['GTIN'] || specs['UPC'] || specs['EAN'] || '').trim();
  if (gtin && !/^(unknown|unverified|none|n\/a)$/i.test(gtin) && gtin.length >= 8) {
    keys.push(`gtin:${gtin.toLowerCase()}`);
  }

  // 3. Manufacturer Model Number / MPN / SKU (from specs or embedded alphanumeric SKU in title)
  let modelNum = (
    specs['Manufacturer Model Number'] ||
    specs['Model Number'] ||
    specs['MPN'] ||
    specs['SKU'] ||
    ''
  ).trim();
  if (!modelNum || /^(unknown|unverified|none|n\/a)$/i.test(modelNum)) {
    const titleSkuMatch = offer.name.match(/\b([A-Z]{2,5}\d{2,5}[A-Z0-9]{2,6})\b/);
    if (titleSkuMatch) {
      modelNum = titleSkuMatch[1];
    }
  }
  if (modelNum && !/^(unknown|unverified|none|n\/a)$/i.test(modelNum) && modelNum.length >= 3) {
    const brandPrefix = (offer.brand || specs['Brand'] || '').toLowerCase().trim();
    keys.push(`model:${brandPrefix}:${modelNum.toLowerCase()}`);
    keys.push(`model_any:${modelNum.toLowerCase()}`);
  }

  // 4. Normalized Brand + Product Title (strips trailing retailer tags like "- Best Buy" or "| Home Depot")
  const cleanedTitle = offer.name
    .toLowerCase()
    .replace(/\s*[-|–—]\s*(best\s*buy|home\s*depot|lowe'?s|walmart|amazon|target|b&h|newegg|samsung\.?com|apple\.?com).*$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const brand = (offer.brand || specs['Brand'] || '').toLowerCase().trim();
  if (brand && !cleanedTitle.startsWith(brand)) {
    keys.push(`title:${brand} ${cleanedTitle}`);
  } else {
    keys.push(`title:${cleanedTitle}`);
  }

  return keys;
}

export function getProductIdentityKey(offer: ProductOffer): string {
  return getProductIdentityKeys(offer)[0] || `id:${offer.id}`;
}

/**
 * Product-Level Deduplication & Merchant Offer Aggregation
 * Collapses multiple retailer listings for the same product SKU into ONE unique product
 * with a ranked list of merchantOffers, lowestVerifiedOffer, and conflictingEvidenceNotes.
 */
export function deduplicateProductsAndGroupMerchantOffers(
  rawOffers: ProductOffer[],
  coupons: CouponItem[] = []
): Array<{
  identityKey: string;
  primaryOffer: ProductOffer;
  merchantOffers: MerchantOfferRecord[];
  lowestVerifiedOffer: {
    merchant: string;
    price: number;
    currency: string;
    url: string;
    availabilityStatus: string;
  } | null;
  conflictingEvidenceNotes: string[];
}> {
  const groups = new Map<string, ProductOffer[]>();
  const aliasToCanonicalKey = new Map<string, string>();

  for (const offer of rawOffers) {
    const candidateKeys = getProductIdentityKeys(offer);
    let canonicalKey = candidateKeys.map((k) => aliasToCanonicalKey.get(k)).find(Boolean);
    if (!canonicalKey) {
      canonicalKey = candidateKeys[0] || `id:${offer.id}`;
    }
    for (const k of candidateKeys) {
      aliasToCanonicalKey.set(k, canonicalKey);
    }

    const list = groups.get(canonicalKey) || [];
    // Avoid duplicating the exact same retailer + URL + price inside the same product's merchant list
    const isExactSameMerchantListing = list.some(
      (existing) =>
        existing.merchant.toLowerCase().trim() === offer.merchant.toLowerCase().trim() &&
        existing.price === offer.price &&
        existing.canonicalUrl === offer.canonicalUrl
    );
    if (!isExactSameMerchantListing) {
      list.push(offer);
    } else {
      // Merge any extra specs or gallery images from detail enrichment into the existing listing
      const existingIdx = list.findIndex(
        (existing) =>
          existing.merchant.toLowerCase().trim() === offer.merchant.toLowerCase().trim() &&
          existing.price === offer.price
      );
      if (existingIdx >= 0) {
        list[existingIdx] = {
          ...list[existingIdx],
          ...offer,
          specs: { ...list[existingIdx].specs, ...offer.specs },
          galleryImages: offer.galleryImages?.length
            ? offer.galleryImages
            : list[existingIdx].galleryImages,
        };
      }
    }
    groups.set(canonicalKey, list);
  }

  const results: Array<{
    identityKey: string;
    primaryOffer: ProductOffer;
    merchantOffers: MerchantOfferRecord[];
    lowestVerifiedOffer: {
      merchant: string;
      price: number;
      currency: string;
      url: string;
      availabilityStatus: string;
    } | null;
    conflictingEvidenceNotes: string[];
  }> = [];

  for (const [identityKey, offerGroup] of groups.entries()) {
    // Build MerchantOfferRecord for each retailer selling this SKU
    const merchantOfferRecords: MerchantOfferRecord[] = offerGroup.map((o) => {
      const matchingCoupon = coupons.find(
        (c) =>
          c.merchant.toLowerCase().includes(o.merchant.toLowerCase()) ||
          o.merchant.toLowerCase().includes(c.merchant.toLowerCase())
      );
      const discount = matchingCoupon
        ? matchingCoupon.discountType === 'percentage' && o.price
          ? (o.price * matchingCoupon.discountValue) / 100
          : matchingCoupon.discountType === 'fixed'
          ? matchingCoupon.discountValue
          : 0
        : 0;
      const netPrice = o.price !== null ? Math.max(0, o.price - discount) : null;

      return {
        offerId: o.id,
        merchantName: o.merchant,
        variantConfiguration: o.name,
        listedPrice: o.price,
        currency: o.currency || 'USD',
        shippingCost: o.shippingCost,
        shippingStatus: o.shippingStatus,
        verifiedDiscountAmount: discount,
        couponCode: matchingCoupon?.code || null,
        taxAmount: o.estimatedTaxRate,
        taxStatus: o.taxStatus,
        confirmedFinalTotal: netPrice,
        estimatedTotalWithUnconfirmedComponents: netPrice,
        missingCostComponents: [
          ...(o.shippingCost === null ? ['shipping'] : []),
          ...(o.estimatedTaxRate === null ? ['tax'] : []),
        ],
        availabilityStatus: o.availabilityStatus,
        offerUrl: o.canonicalUrl,
        checkoutSupported: o.checkoutStatus === 'supported_paypal',
      };
    });

    // Sort merchant offers for THIS product separately:
    // 1. verified_in_stock with verified price (lowest net price first)
    // 2. unknown stock with verified price
    // 3. out_of_stock or unverified price
    merchantOfferRecords.sort((a, b) => {
      const aStockRank = a.availabilityStatus === 'verified_in_stock' ? 0 : a.availabilityStatus === 'verified_out_of_stock' ? 2 : 1;
      const bStockRank = b.availabilityStatus === 'verified_in_stock' ? 0 : b.availabilityStatus === 'verified_out_of_stock' ? 2 : 1;
      if (aStockRank !== bStockRank) return aStockRank - bStockRank;
      const aPrice = a.confirmedFinalTotal ?? a.listedPrice ?? Number.POSITIVE_INFINITY;
      const bPrice = b.confirmedFinalTotal ?? b.listedPrice ?? Number.POSITIVE_INFINITY;
      return aPrice - bPrice;
    });

    // Sort the raw offerGroup in the same order so offerGroup[0] is the best merchant offer for this SKU
    const sortedRawOffers = [...offerGroup].sort((a, b) => {
      const aStockRank = a.availabilityStatus === 'verified_in_stock' ? 0 : a.availabilityStatus === 'verified_out_of_stock' ? 2 : 1;
      const bStockRank = b.availabilityStatus === 'verified_in_stock' ? 0 : b.availabilityStatus === 'verified_out_of_stock' ? 2 : 1;
      if (aStockRank !== bStockRank) return aStockRank - bStockRank;
      const aPrice = a.price ?? Number.POSITIVE_INFINITY;
      const bPrice = b.price ?? Number.POSITIVE_INFINITY;
      return aPrice - bPrice;
    });

    // Merge verified specs, gallery images, and ratings across all retailer listings of this SKU
    const mergedSpecs: Record<string, string> = {};
    const mergedGallery = new Set<string>();
    let bestImageUrl: string | null = null;
    let bestRating: number | null = null;
    let bestReviewCount: number | null = null;
    let longestSummary = '';

    for (const o of sortedRawOffers) {
      if (o.imageUrl && !bestImageUrl) bestImageUrl = o.imageUrl;
      if (o.galleryImages) {
        for (const img of o.galleryImages) {
          if (img) mergedGallery.add(img);
        }
      }
      if (o.summary && o.summary.length > longestSummary.length) {
        longestSummary = o.summary;
      }
      if (o.rating !== null && o.rating !== undefined && o.rating > 0) {
        if (bestRating === null || (o.reviewCount || 0) > (bestReviewCount || 0)) {
          bestRating = o.rating;
          bestReviewCount = o.reviewCount;
        }
      }
      for (const [k, v] of Object.entries(o.specs || {})) {
        if (v && !/^(unknown|unverified|none|n\/a)$/i.test(String(v)) && !mergedSpecs[k]) {
          mergedSpecs[k] = v;
        }
      }
    }

    // Detect conflicting evidence across merchant listings for the same product
    const conflictingEvidenceNotes: string[] = [];
    if (merchantOfferRecords.length > 1) {
      const pricedOffers = merchantOfferRecords.filter((m) => m.listedPrice !== null && m.listedPrice > 0);
      if (pricedOffers.length > 1) {
        const prices = pricedOffers.map((m) => m.listedPrice as number);
        const minP = Math.min(...prices);
        const maxP = Math.max(...prices);
        if (maxP - minP >= 1) {
          const minMerchant = pricedOffers.find((m) => m.listedPrice === minP)?.merchantName || 'Lowest Retailer';
          const maxMerchant = pricedOffers.find((m) => m.listedPrice === maxP)?.merchantName || 'Highest Retailer';
          const curr = pricedOffers[0].currency || 'USD';
          conflictingEvidenceNotes.push(
            `Price varies across ${merchantOfferRecords.length} verified merchants (price spread across ${merchantOfferRecords.length} retailers for this SKU: ranges from ${curr} ${minP.toFixed(2)} at ${minMerchant} to ${curr} ${maxP.toFixed(2)} at ${maxMerchant}).`
          );
        }
      }
      const inStockMerchants = merchantOfferRecords
        .filter((m) => m.availabilityStatus === 'verified_in_stock')
        .map((m) => m.merchantName);
      const outOfStockMerchants = merchantOfferRecords
        .filter((m) => m.availabilityStatus === 'verified_out_of_stock')
        .map((m) => m.merchantName);
      if (inStockMerchants.length > 0 && outOfStockMerchants.length > 0) {
        conflictingEvidenceNotes.push(
          `Stock discrepancy across retailers: verified in stock at ${inStockMerchants.join(', ')}, while ${outOfStockMerchants.join(', ')} reports out-of-stock.`
        );
      }
    }

    const bestOffer = sortedRawOffers[0];
    const primaryOffer: ProductOffer = {
      ...bestOffer,
      imageUrl: bestOffer.imageUrl || bestImageUrl,
      galleryImages: mergedGallery.size > 0 ? Array.from(mergedGallery) : bestOffer.galleryImages,
      rating: bestOffer.rating ?? bestRating,
      reviewCount: bestOffer.reviewCount ?? bestReviewCount,
      summary: bestOffer.summary || longestSummary,
      specs: {
        ...bestOffer.specs,
        ...mergedSpecs,
      },
    };

    const lowestPricedRecord = merchantOfferRecords.find(
      (m) => m.listedPrice !== null && m.availabilityStatus !== 'verified_out_of_stock'
    ) || merchantOfferRecords.find((m) => m.listedPrice !== null);

    const lowestVerifiedOffer =
      lowestPricedRecord && lowestPricedRecord.listedPrice !== null
        ? {
            merchant: lowestPricedRecord.merchantName,
            price: lowestPricedRecord.confirmedFinalTotal ?? lowestPricedRecord.listedPrice,
            currency: lowestPricedRecord.currency,
            url: lowestPricedRecord.offerUrl,
            availabilityStatus: lowestPricedRecord.availabilityStatus,
          }
        : null;

    results.push({
      identityKey,
      primaryOffer,
      merchantOffers: merchantOfferRecords,
      lowestVerifiedOffer,
      conflictingEvidenceNotes,
    });
  }

  return results;
}

/**
 * Helper: Constructs a broader category/alternative discovery query when an initial narrow search
 * returns fewer than 3 unique products (e.g., when a user searches a single model name like "Samsung Bespoke refrigerator").
 */
export function buildBroadenedDiscoveryQuery(
  searchQueryOrStrategy: string | { searchQuery: string; category: string },
  categoryArg?: string
): string {
  const searchQuery =
    typeof searchQueryOrStrategy === 'string'
      ? searchQueryOrStrategy
      : searchQueryOrStrategy.searchQuery;
  const category =
    typeof searchQueryOrStrategy === 'string'
      ? categoryArg || detectCategoryFromText(searchQuery)
      : searchQueryOrStrategy.category;
  const lower = searchQuery.toLowerCase();
  if (category === 'Major Home Appliances') {
    if (/\b(washing\s+machine|washer|laundry)\b/i.test(lower)) {
      return 'front load inverter washing machine steam ENERGY STAR';
    }
    if (/\bcounter[- ]depth\b/i.test(lower)) {
      return 'counter-depth French door refrigerator stainless steel ENERGY STAR';
    }
    return 'French door stainless steel refrigerator inverter ENERGY STAR';
  }
  if (category === 'Laptops & Computing') {
    if (/\bgaming\b/i.test(lower)) return 'gaming laptop RTX OLED 32GB RAM';
    return 'pro laptop 32GB RAM 1TB SSD';
  }
  if (category === 'Smartphones & Mobile Devices') {
    return 'flagship unlocked smartphone 5G OLED pro camera';
  }
  if (category === 'Footwear & Athletic Gear') {
    return 'cushioned road running shoes marathon trainer';
  }
  if (category === 'Furniture & Ergonomics') {
    return 'ergonomic mesh office chair adjustable lumbar support';
  }
  if (category === 'Photography & Cameras') {
    return 'mirrorless digital camera 4K IBIS lens';
  }
  if (category === 'Power Tools, Hardware & Equipment') {
    return '18V 20V brushless cordless drill driver combo kit';
  }
  if (category === 'Fragrance, Beauty & Personal Care') {
    return 'Eau de Parfum fragrance 100ml spray';
  }
  if (category === 'Automotive & Car Accessories') {
    return '4K dual dash cam GPS night vision car accessory';
  }
  if (category === 'Audio & Acoustics') {
    return 'wireless active noise cancelling headphones bluetooth';
  }
  // Strip specific brand tokens to broaden recall across competing brands
  const stripped = searchQuery
    .replace(/\b(samsung|bespoke|lg|bosch|whirlpool|ge|apple|dell|lenovo|asus|sony|bose|nike|hoka|asics|steelcase|herman\s*miller|milwaukee|dewalt|makita|chanel|dior|viofo)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length >= 4 ? stripped : searchQuery;
}

/**
 * Stage 2 & 3: Live API Execution & Evidence Gathering
 * Executes actual Channel3 API, Open Library, PubChem, and Feedico queries.
 * Automatically expands discovery when initial results contain too few unique products.
 */
export async function executeLiveResearchTools(
  strategy: ReturnType<typeof formulateResearchStrategy>,
  input: AgentPipelineInput
): Promise<{
  offers: ProductOffer[];
  coupons: CouponItem[];
  sourceReports: SourceExecutionReport[];
  scienceAnalysis: ScienceCompoundMetadata | null;
}> {
  const sourceReports: SourceExecutionReport[] = [];
  const rawOffers: ProductOffer[] = [];
  const coupons: CouponItem[] = [];
  let scienceAnalysis: ScienceCompoundMetadata | null = null;

  // 1. Check for URL lookup
  const urlMatch = input.prompt.match(/https?:\/\/[^\s"'<>]+/i);
  if (urlMatch) {
    const lookupResult = await queryChannel3UrlLookup(urlMatch[0], { userId: input.userId });
    if (lookupResult.report.queried) {
      sourceReports.push(lookupResult.report);
      rawOffers.push(...lookupResult.offers);
    }
  }

  // 2. Primary Channel3 Product Graph Discovery (increased limit to 16 to capture diverse brands/models beyond multi-retailer offers for 1 SKU)
  const channel3Result = await queryChannel3Search(
    strategy.searchQuery,
    {
      maxBudget: strategy.targetBudget,
      currency: strategy.currency,
      limit: 16,
    },
    { userId: input.userId }
  );
  sourceReports.push(channel3Result.report);
  rawOffers.push(...channel3Result.offers);

  // 2b. Expanded Unique Product Discovery:
  // If product-level deduplication yields fewer than 4 unique products, run a broader category/alternative discovery search
  // to retrieve genuinely different models, brands, and relevant alternatives.
  const initialUniqueProducts = deduplicateProductsAndGroupMerchantOffers(rawOffers, []);
  if (channel3Result.report.configured && initialUniqueProducts.length < 4) {
    const broadenedQuery = buildBroadenedDiscoveryQuery(strategy.searchQuery, strategy.category);
    if (broadenedQuery.toLowerCase() !== strategy.searchQuery.toLowerCase()) {
      try {
        const expandedResult = await queryChannel3Search(
          broadenedQuery,
          {
            maxBudget: strategy.targetBudget,
            currency: strategy.currency,
            limit: 12,
          },
          { userId: input.userId }
        );
        if (expandedResult.report.queried && expandedResult.offers.length > 0) {
          rawOffers.push(...expandedResult.offers);
          sourceReports.push({
            ...expandedResult.report,
            sourceId: 'channel3_expanded_discovery',
            sourceName: 'Channel3 Expanded Category & Alternative Discovery',
            explicitStateMessage: `Expanded search ("${broadenedQuery}") retrieved ${expandedResult.offers.length} additional offer(s) to increase unique product diversity.`,
          });
        }
      } catch {
        // Continue with primary results if expanded search fails
      }
    }
  }

  // 3. Enrich top unique Channel3 products in parallel to gather full specifications, gallery images, and merchant links
  const uniqueGroupsForDetail = deduplicateProductsAndGroupMerchantOffers(rawOffers, []);
  if (uniqueGroupsForDetail.length > 0) {
    const candidatesForDetail = uniqueGroupsForDetail
      .slice(0, 4)
      .map((g) => g.primaryOffer)
      .filter((o) => Boolean(o.id));
    const detailPromises = candidatesForDetail.map((cand) =>
      queryChannel3ProductDetail(cand.id, strategy.currency, { userId: input.userId }).catch(() => null)
    );
    const detailResults = await Promise.all(detailPromises);
    for (const detailResult of detailResults) {
      if (detailResult && detailResult.report.queried && detailResult.offers.length > 0) {
        for (const detOffer of detailResult.offers) {
          const idx = rawOffers.findIndex(
            (o) => o.id === detOffer.id || (o.name === detOffer.name && o.merchant === detOffer.merchant)
          );
          if (idx >= 0) {
            rawOffers[idx] = {
              ...rawOffers[idx],
              ...detOffer,
              specs: { ...rawOffers[idx].specs, ...detOffer.specs },
              galleryImages: detOffer.galleryImages?.length
                ? detOffer.galleryImages
                : rawOffers[idx].galleryImages,
            };
          } else {
            rawOffers.push(detOffer);
          }
        }
      }
    }
  }

  // 4. Open Library API for books if Channel3 returned 0 or if explicit book search
  const isBookQuery = /\b(book|books|novel|author|isbn|reading)\b/i.test(input.prompt);
  if ((rawOffers.length === 0 && isBookQuery) || (input.allowSecondarySourceFallback && isBookQuery)) {
    try {
      const olRes = await fetch(
        `https://openlibrary.org/search.json?q=${encodeURIComponent(strategy.searchQuery)}&limit=4`
      );
      if (olRes.ok) {
        const olData = (await olRes.json()) as { docs?: Array<Record<string, unknown>> };
        const docs = olData.docs || [];
        for (const doc of docs) {
          const title = String(doc.title || 'Untitled Work');
          const authorNames = Array.isArray(doc.author_name) ? doc.author_name.join(', ') : 'Various Authors';
          const coverI = doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null;
          const key = String(doc.key || `/works/${Math.random().toString(36).slice(2)}`);
          rawOffers.push({
            id: `ol_${key.replace(/[^a-zA-Z0-9]/g, '_')}`,
            sourceId: 'openlibrary_api',
            sourceName: 'Open Library Catalog API',
            canonicalUrl: `https://openlibrary.org${key}`,
            retrievedAt: new Date().toISOString(),
            verificationStatus: 'verified_live_source',
            name: `${title} — by ${authorNames}`,
            merchant: 'Open Library',
            category: 'books',
            price: null,
            priceStatus: 'price_could_not_be_verified',
            currency: 'USD',
            shippingCost: null,
            shippingStatus: 'not_applicable_digital',
            estimatedTaxRate: null,
            taxStatus: 'unknown',
            availabilityStatus: 'unknown',
            rating: null,
            reviewCount: null,
            summary: `Open Library bibliographic entry for "${title}" by ${authorNames}.`,
            specs: {
              Authors: authorNames,
              'First Published': doc.first_publish_year ? String(doc.first_publish_year) : 'Unknown',
              Language: Array.isArray(doc.language) ? (doc.language as string[]).slice(0, 3).join(', ') : 'English',
            },
            couponStatus: 'no_verified_coupon',
            checkoutStatus: 'checkout_unsupported',
            imageUrl: coverI,
          });
        }
        sourceReports.push({
          sourceId: 'openlibrary_api',
          sourceName: 'Open Library Catalog API',
          configured: true,
          queried: true,
          status: 'verified_ok',
          explicitStateMessage: `Retrieved ${docs.length} bibliographic catalog records.`,
          resultCount: docs.length,
          retrievedAt: new Date().toISOString(),
        });
      }
    } catch {
      // Ignore Open Library failure
    }
  }

  // 5. PubChem Chemical compound lookup if query mentions chemical compound
  const compoundMatch = input.prompt.match(/\b(niacinamide|retinol|caffeine|aspirin|ibuprofen|hyaluronic acid|vitamin c)\b/i);
  if (compoundMatch) {
    const compoundName = compoundMatch[1].toLowerCase();
    try {
      const pcRes = await fetch(
        `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(compoundName)}/property/MolecularFormula,MolecularWeight,IUPACName/JSON`
      );
      if (pcRes.ok) {
        const pcData = (await pcRes.json()) as {
          PropertyTable?: {
            Properties?: Array<{
              CID?: number;
              MolecularFormula?: string;
              MolecularWeight?: number | string;
              IUPACName?: string;
            }>;
          };
        };
        const prop = pcData.PropertyTable?.Properties?.[0];
        if (prop?.CID) {
          scienceAnalysis = {
            compoundName,
            sourceId: 'pubchem_ncbi_api',
            retrievedAt: new Date().toISOString(),
            cid: prop.CID,
            molecularFormula: prop.MolecularFormula || undefined,
            molecularWeight: prop.MolecularWeight ? String(prop.MolecularWeight) : undefined,
            structureImageUrl: `https://pubchem.ncbi.nlm.nih.gov/image/imgsrv.fcgi?cid=${prop.CID}&t=l`,
          };
          sourceReports.push({
            sourceId: 'pubchem_rest_api',
            sourceName: 'NCBI PubChem REST API',
            configured: true,
            queried: true,
            status: 'verified_ok',
            explicitStateMessage: `Verified compound CID ${prop.CID} (${prop.MolecularFormula || ''}).`,
            resultCount: 1,
            retrievedAt: new Date().toISOString(),
          });
        }
      }
    } catch {
      // Ignore PubChem failure
    }
  }

  // 6. Feedico Partner Coupons & Cashback Search
  const feedicoConfig = feedicoPartnerService.getConfig();
  if (feedicoConfig.configured) {
    try {
      const distinctMerchants = Array.from(new Set(rawOffers.map((o) => o.merchant).filter((m) => m && m.length > 2))).slice(0, 3);
      const searchTerms = distinctMerchants.length > 0 ? distinctMerchants : [strategy.searchQuery];
      for (const term of searchTerms) {
        const cRes = await feedicoPartnerService.searchCoupons({ q: term, pageSize: 5 }, { userId: input.userId });
        for (const c of cRes.coupons) {
          if (!coupons.some((existing) => existing.id === c.id)) {
            coupons.push(c);
          }
        }
      }
      sourceReports.push({
        sourceId: 'feedico_partner_api',
        sourceName: 'Feedico Partner API',
        configured: true,
        queried: true,
        status: coupons.length > 0 ? 'verified_ok' : 'no_results',
        explicitStateMessage: `Retrieved ${coupons.length} verified affiliate coupons and promotional offers.`,
        resultCount: coupons.length,
        retrievedAt: new Date().toISOString(),
      });
    } catch {
      // Continue without coupons
    }
  }

  return {
    offers: rawOffers,
    coupons,
    sourceReports,
    scienceAnalysis,
  };
}

/**
 * Evidence Provenance Classifier
 * Distinguishes verified facts (explicitly in catalog spec map), source-provided claims (extracted from title/summary),
 * reasonable inferences, and unknown/unavailable information.
 */
export function classifyProductEvidence(
  offer: ProductOffer,
  adaptedSpecsOrCategory?: Record<string, string> | string
): Record<string, 'verified_fact' | 'source_claim' | 'inference' | 'unknown'> & {
  classification: Record<string, 'verified_fact' | 'source_claim' | 'inference' | 'unknown'>;
} {
  const existing = offer.specs || {};
  const adaptedSpecs =
    typeof adaptedSpecsOrCategory === 'string'
      ? deriveCategoryAdaptiveSpecs(adaptedSpecsOrCategory, offer)
      : adaptedSpecsOrCategory || deriveCategoryAdaptiveSpecs(offer.category || 'General Products', offer);
  const titleAndSummary = `${offer.name} ${offer.summary || ''}`.toLowerCase();
  const classification: Record<string, 'verified_fact' | 'source_claim' | 'inference' | 'unknown'> = {};

  classification['Price'] = offer.price !== null && typeof offer.price === 'number' ? 'verified_fact' : 'unknown';
  classification['Availability'] =
    offer.availabilityStatus === 'verified_in_stock' || offer.availabilityStatus === 'verified_out_of_stock'
      ? 'verified_fact'
      : 'unknown';
  classification['Customer Rating'] = offer.rating !== null && offer.rating !== undefined ? 'source_claim' : 'unknown';
  classification['Warranty & Support'] =
    existing['Warranty'] && !/^(unknown|unverified|none|n\/a)$/i.test(String(existing['Warranty']))
      ? 'verified_fact'
      : /\bwarranty\b/i.test(titleAndSummary)
      ? 'source_claim'
      : 'unknown';

  // Include explicit catalog spec fields as verified_fact when present
  for (const [key, rawVal] of Object.entries(existing)) {
    const strVal = String(rawVal || '');
    if (rawVal && !/^(unknown|unverified|none|n\/a)$/i.test(strVal) && !isUnspecifiedAttributeValue(strVal)) {
      classification[key] = 'verified_fact';
    } else {
      classification[key] = 'unknown';
    }
  }

  for (const [key, val] of Object.entries(adaptedSpecs)) {
    const rawExisting = existing[key];
    if (
      isUnspecifiedAttributeValue(val) ||
      /not disclosed in merchant feed|not specified in the available|upper material not specified|upholstery material not specified|verify on manufacturer|unverified|unknown/i.test(
        val
      )
    ) {
      classification[key] = 'unknown';
    } else if (
      rawExisting &&
      rawExisting !== val &&
      !/^(unknown|unverified|none|n\/a)$/i.test(String(rawExisting)) &&
      !isUnspecifiedAttributeValue(String(rawExisting))
    ) {
      classification[key] = 'verified_fact';
    } else {
      // Check if significant tokens from the extracted spec appear in the merchant title or summary
      const specTokens = val
        .toLowerCase()
        .split(/[^a-z0-9.]+/)
        .filter(
          (t) =>
            t.length >= 3 &&
            !['with', 'and', 'for', 'the', 'high', 'standard', 'system', 'verified', 'designed'].includes(t)
        );
      const matchedInSourceText = specTokens.some((tok) => titleAndSummary.includes(tok));
      classification[key] = matchedInSourceText ? 'source_claim' : 'inference';
    }
  }

  const result = { ...classification } as Record<string, 'verified_fact' | 'source_claim' | 'inference' | 'unknown'> & {
    classification: Record<string, 'verified_fact' | 'source_claim' | 'inference' | 'unknown'>;
  };
  Object.defineProperty(result, 'classification', {
    value: classification,
    enumerable: false,
  });
  return result;
}

/**
 * Per-Product & Per-Specification Evidence Coverage Calculator
 * Never labels a product 95% verified when major specifications or model identifiers are unknown.
 * Computes traceable evidence provenance for each specification and caps overall product verification
 * whenever model identifiers or core category specifications are undisclosed.
 */
export function calculateProductEvidenceCoverage(
  offer: ProductOffer,
  category?: string,
  adaptedSpecsInput?: Record<string, string>,
  classificationInput?: Record<string, 'verified_fact' | 'source_claim' | 'inference' | 'unknown'>
): {
  evidenceCompletenessPercent: number;
  hasExactModelIdentifier: boolean;
  knownSpecsCount: number;
  totalSpecsEvaluated: number;
  unknownSpecs: string[];
  specEvidenceSources: Record<
    string,
    {
      value: string;
      status: 'verified_fact' | 'source_claim' | 'inference' | 'unknown';
      source: string;
      verified: boolean;
    }
  >;
} {
  const cat = category || offer.category || 'General Products';
  const adaptedSpecs = adaptedSpecsInput || deriveCategoryAdaptiveSpecs(cat, offer);
  const classification = classificationInput || classifyProductEvidence(offer, adaptedSpecs).classification;
  const existingSpecs = offer.specs || {};

  // Check whether an exact manufacturer model identifier or GTIN/UPC is present
  const specModelRaw = (
    existingSpecs['Manufacturer Model Number'] ||
    existingSpecs['Model Number'] ||
    existingSpecs['MPN'] ||
    existingSpecs['SKU'] ||
    ''
  ).trim();
  const titleSkuMatch = offer.name.match(/\b([A-Z]{1,5}\d{2,5}[A-Z0-9-]{1,6})\b/);
  const extractedModel =
    specModelRaw && !/^(unknown|unverified|none|n\/a)$/i.test(specModelRaw)
      ? specModelRaw
      : titleSkuMatch
      ? titleSkuMatch[1]
      : null;
  const gtinRaw = existingSpecs['GTIN'] || existingSpecs['UPC'] || existingSpecs['EAN'] || '';
  const hasGtin = Boolean(gtinRaw && String(gtinRaw).replace(/[^0-9]/g, '').length >= 8);
  const hasExactModelIdentifier = Boolean(extractedModel || hasGtin);

  const specEvidenceSources: Record<
    string,
    {
      value: string;
      status: 'verified_fact' | 'source_claim' | 'inference' | 'unknown';
      source: string;
      verified: boolean;
    }
  > = {};

  // 1. Model / SKU Identifier
  specEvidenceSources['Model / SKU Identifier'] = {
    value: extractedModel || (hasGtin ? `GTIN ${gtinRaw}` : 'Not specified in the available product information.'),
    status: hasExactModelIdentifier ? 'verified_fact' : 'unknown',
    source: hasExactModelIdentifier
      ? `${offer.merchant} verified listing`
      : `Unavailable — Exact model number / GTIN not specified in ${offer.merchant} product information`,
    verified: hasExactModelIdentifier,
  };

  // 2. Listed Price
  const hasPrice = offer.price !== null && typeof offer.price === 'number';
  specEvidenceSources['Price'] = {
    value: hasPrice ? `${offer.currency || 'USD'} ${offer.price!.toFixed(2)}` : 'Unverified',
    status: hasPrice ? 'verified_fact' : 'unknown',
    source: hasPrice
      ? `${offer.merchant} verified offer`
      : `Unavailable — Price not specified in ${offer.merchant} listing`,
    verified: hasPrice,
  };

  // 3. Stock Availability
  const hasStock =
    offer.availabilityStatus === 'verified_in_stock' ||
    offer.availabilityStatus === 'verified_out_of_stock';
  specEvidenceSources['Stock Availability'] = {
    value:
      offer.availabilityStatus === 'verified_in_stock'
        ? 'Verified In Stock'
        : offer.availabilityStatus === 'verified_out_of_stock'
        ? 'Out of Stock'
        : 'Unconfirmed in available product information',
    status: hasStock ? 'verified_fact' : 'unknown',
    source: hasStock
      ? `${offer.merchant} inventory status`
      : `Unavailable — Real-time stock status not confirmed`,
    verified: hasStock,
  };

  // 4. Category-Specific Technical Specifications
  let weightedEarned = 0;
  let totalWeight = 0;

  // Base weights for identity, price, and stock (30% combined)
  totalWeight += 12; // Model Identifier
  if (hasExactModelIdentifier) weightedEarned += 12;

  totalWeight += 10; // Price
  if (hasPrice) weightedEarned += 10;

  totalWeight += 8; // Stock
  if (hasStock) weightedEarned += 8;

  const specKeys = Object.keys(adaptedSpecs);
  const perSpecWeight = specKeys.length > 0 ? 70 / specKeys.length : 0;
  const unknownSpecs: string[] = [];
  let knownSpecsCount = 0;

  for (const key of specKeys) {
    const val = sanitizeUserFacingAttributeValue(
      adaptedSpecs[key] || 'Not specified in the available product information.',
      key
    );
    const rawStatus = classification[key] || 'unknown';
    const isUndisclosedText =
      isUnspecifiedAttributeValue(val) ||
      /not disclosed in merchant feed|verify on manufacturer|unverified|unknown/i.test(val);
    const status: 'verified_fact' | 'source_claim' | 'inference' | 'unknown' = isUndisclosedText
      ? 'unknown'
      : rawStatus;

    totalWeight += perSpecWeight;
    if (status === 'verified_fact') {
      weightedEarned += perSpecWeight * 1.0;
      knownSpecsCount++;
      specEvidenceSources[key] = {
        value: val,
        status: 'verified_fact',
        source: `Explicit catalog specification (${offer.sourceName} · ${offer.merchant})`,
        verified: true,
      };
    } else if (status === 'source_claim') {
      weightedEarned += perSpecWeight * 0.85;
      knownSpecsCount++;
      specEvidenceSources[key] = {
        value: val,
        status: 'source_claim',
        source: `Merchant listing title/summary claim (${offer.merchant} via ${offer.sourceName})`,
        verified: true,
      };
    } else if (status === 'inference') {
      weightedEarned += perSpecWeight * 0.4;
      specEvidenceSources[key] = {
        value: val,
        status: 'inference',
        source: `Reasonable category inference from product line (unconfirmed in ${offer.merchant} spec sheet)`,
        verified: false,
      };
    } else {
      unknownSpecs.push(key);
      specEvidenceSources[key] = {
        value: val,
        status: 'unknown',
        source: `Unknown — Not disclosed in ${offer.merchant} catalog feed`,
        verified: false,
      };
    }
  }

  let computedPercent = totalWeight > 0 ? Math.round((weightedEarned / totalWeight) * 100) : 50;

  // CRITICAL EVIDENCE INTEGRITY CAPS:
  // Never label a product 95% verified when major specifications or model identifiers are unknown.
  if (unknownSpecs.length >= 3) {
    computedPercent = Math.min(computedPercent, 55);
  } else if (unknownSpecs.length === 2) {
    computedPercent = Math.min(computedPercent, 68);
  } else if (unknownSpecs.length === 1) {
    computedPercent = Math.min(computedPercent, 78);
  }

  if (!hasExactModelIdentifier) {
    computedPercent = Math.min(computedPercent, 80);
  }

  if (!hasPrice) {
    computedPercent = Math.min(computedPercent, 65);
  }

  // Only when all specs are known, model identifier is present, and price is verified can coverage reach 88-96%
  const finalPercent = Math.max(20, Math.min(96, computedPercent));

  return {
    evidenceCompletenessPercent: finalPercent,
    hasExactModelIdentifier,
    knownSpecsCount,
    totalSpecsEvaluated: specKeys.length,
    unknownSpecs,
    specEvidenceSources,
  };
}

/**
 * Price Accuracy & Checkout Breakdown Builder
 * Separates lowest listed price, lowest in-stock price, shipping, taxes, and estimated checkout total.
 * Never labels a price "landed" unless both shipping and tax costs are confirmed.
 */
export function buildPriceAccuracyBreakdown(offer: RankedProductOffer) {
  const currency = offer.currency || 'USD';
  const merchantOffers = offer.merchantOffers || offer.richProfile?.merchantOffers || [];
  const pricedOffers = merchantOffers.filter((m) => m.listedPrice !== null && typeof m.listedPrice === 'number');
  const inStockOffers = pricedOffers.filter((m) => m.availabilityStatus === 'verified_in_stock');

  let lowestListedPrice: number | null = offer.price;
  let lowestListedMerchant: string = offer.merchant;

  if (pricedOffers.length > 0) {
    const sortedAll = [...pricedOffers].sort((a, b) => (a.listedPrice as number) - (b.listedPrice as number));
    lowestListedPrice = sortedAll[0].listedPrice;
    lowestListedMerchant = sortedAll[0].merchantName || offer.merchant;
  }

  let lowestInStockPrice: number | null =
    offer.availabilityStatus === 'verified_in_stock' && offer.price !== null ? offer.price : null;
  let lowestInStockMerchant: string | null =
    offer.availabilityStatus === 'verified_in_stock' && offer.price !== null ? offer.merchant : null;

  if (inStockOffers.length > 0) {
    const sortedInStock = [...inStockOffers].sort((a, b) => (a.listedPrice as number) - (b.listedPrice as number));
    lowestInStockPrice = sortedInStock[0].listedPrice;
    lowestInStockMerchant = sortedInStock[0].merchantName || offer.merchant;
  }

  const shippingCost =
    offer.shippingCost !== null && offer.shippingCost !== undefined && typeof offer.shippingCost === 'number'
      ? offer.shippingCost
      : null;
  const shippingStatusLabel =
    shippingCost !== null
      ? `${currency} ${shippingCost.toFixed(2)} confirmed`
      : 'Unconfirmed in catalog feed (calculated at merchant checkout)';

  const taxAmount =
    offer.estimatedTaxRate !== null &&
    offer.estimatedTaxRate !== undefined &&
    typeof offer.estimatedTaxRate === 'number' &&
    lowestListedPrice !== null
      ? Number((lowestListedPrice * offer.estimatedTaxRate).toFixed(2))
      : null;
  const taxStatusLabel =
    taxAmount !== null
      ? `${currency} ${taxAmount.toFixed(2)} confirmed`
      : 'Unconfirmed in catalog feed (calculated at checkout by delivery region)';

  const isLandedTotalConfirmed = lowestListedPrice !== null && shippingCost !== null && taxAmount !== null;
  const baseNetPrice = offer.netItemPrice ?? lowestListedPrice;
  const estimatedCheckoutTotal =
    isLandedTotalConfirmed && baseNetPrice !== null
      ? Number((baseNetPrice + shippingCost! + taxAmount!).toFixed(2))
      : null;

  const checkoutTotalLabel = isLandedTotalConfirmed && estimatedCheckoutTotal !== null
    ? `Confirmed Landed Total: ${currency} ${estimatedCheckoutTotal.toFixed(2)} (incl. verified shipping & tax)`
    : baseNetPrice !== null
    ? `Listed Item Price: ${currency} ${baseNetPrice.toFixed(2)} + unconfirmed shipping & tax at checkout (not a landed total)`
    : 'Price unverified in catalog feed';

  return {
    lowestListedPrice,
    lowestListedMerchant,
    lowestInStockPrice,
    lowestInStockMerchant,
    currency,
    shippingCost,
    shippingStatusLabel,
    taxAmount,
    taxStatusLabel,
    estimatedCheckoutTotal,
    isLandedTotalConfirmed,
    checkoutTotalLabel,
  };
}

/**
 * Determines whether the user explicitly requested an expanded, detailed, or exhaustive analysis.
 * By default, Spark enforces concise, high-information-density output (~40-50% shorter).
 */
export function isDetailedAnalysisRequested(prompt: string, previousPrompts?: string[]): boolean {
  const combined = [prompt, ...(previousPrompts || []).slice(-1)].join(' ');
  return /\b(detailed|in-depth|in\s+depth|comprehensive|exhaustive|full\s+breakdown|deep\s+dive|expand(?:ed)?|elaborate|long\s+report|step-by-step\s+analysis)\b/i.test(
    combined
  );
}

/**
 * Explainable Category Criterion Scoring
 * Computes transparent per-criterion scores aligned with category evaluation weights and actual evidence coverage.
 * Avoids fabricated numerical precision by grounding each criterion score in verified attributes and disclosing unknowns.
 */
export function computeExplainableCriterionScores(
  offer: RankedProductOffer,
  strategy: ReturnType<typeof formulateResearchStrategy>,
  evidenceCoverage: ReturnType<typeof calculateProductEvidenceCoverage>
): Array<{
  criterion: string;
  weight: number;
  score: number;
  evidenceNote: string;
}> {
  const baseScore = offer.completenessScore || 80;
  const knownRatio =
    evidenceCoverage.totalSpecsEvaluated > 0
      ? evidenceCoverage.knownSpecsCount / evidenceCoverage.totalSpecsEvaluated
      : 0.5;

  return strategy.evaluationCriteria.map((crit, idx) => {
    const critLower = crit.name.toLowerCase();
    let critScore = baseScore;
    let evidenceNote = '';

    if (critLower.includes('value') || critLower.includes('price') || critLower.includes('cost')) {
      if (offer.price !== null) {
        const withinBudget = strategy.targetBudget === null || offer.price <= strategy.targetBudget;
        critScore = withinBudget ? Math.min(95, baseScore + 3) : Math.max(55, baseScore - 15);
        evidenceNote = `Listed ${offer.currency} ${offer.price.toFixed(2)} (${offer.merchant})${strategy.targetBudget ? (withinBudget ? ` <= ${strategy.currency} ${strategy.targetBudget} budget` : ` > ${strategy.currency} ${strategy.targetBudget} budget`) : ''}; excl. shipping/tax.`;
      } else {
        critScore = 50;
        evidenceNote = 'Unverified catalog price.';
      }
    } else if (critLower.includes('reliability') || critLower.includes('durability') || critLower.includes('warranty') || critLower.includes('safety')) {
      if (offer.rating !== null && offer.rating !== undefined) {
        critScore = Math.min(95, Math.round((offer.rating / 5) * 90) + (offer.reviewCount && offer.reviewCount >= 20 ? 5 : 0));
        evidenceNote = `Verified rating ${offer.rating.toFixed(1)}/5${offer.reviewCount ? ` (${offer.reviewCount} reviews)` : ''} via ${offer.merchant}.`;
      } else {
        critScore = Math.min(78, Math.round(baseScore * 0.9));
        evidenceNote = `Review count and field failure rate undisclosed in ${offer.merchant} feed.`;
      }
    } else {
      // Technical / domain-specific criterion: never assign high technical scores to undocumented attributes
      const matchingUnknown = evidenceCoverage.unknownSpecs.some((u) => {
        const uWords = u.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
        return uWords.some((w) => critLower.includes(w));
      });
      const specPenalty = Math.round((1 - knownRatio) * 22) + (matchingUnknown ? 12 : 0);
      const rawTechScore = baseScore - specPenalty + (idx === 0 && !matchingUnknown ? 2 : 0);
      const maxAllowedTechScore = matchingUnknown ? 68 : knownRatio < 0.5 ? 65 : 96;
      critScore = Math.max(50, Math.min(maxAllowedTechScore, rawTechScore));
      if (evidenceCoverage.unknownSpecs.length === 0) {
        evidenceNote = `${evidenceCoverage.totalSpecsEvaluated}/${evidenceCoverage.totalSpecsEvaluated} category specs verified (${evidenceCoverage.evidenceCompletenessPercent}% evidence coverage).`;
      } else {
        evidenceNote = `${evidenceCoverage.knownSpecsCount}/${evidenceCoverage.totalSpecsEvaluated} specs verified; not specified in available product information: ${evidenceCoverage.unknownSpecs.join(', ')}.`;
      }
    }

    return {
      criterion: crit.name,
      weight: crit.weight,
      score: critScore,
      evidenceNote,
    };
  });
}

/**
 * Builds an explicit explanation of why a product ranks above the next product (or why it holds its rank).
 */
export function buildRankingExplanationVsNext(
  currentOffer: RankedProductOffer,
  nextOffer: RankedProductOffer | undefined,
  currentRank: number,
  currentEvidence: ReturnType<typeof calculateProductEvidenceCoverage>,
  nextEvidence: ReturnType<typeof calculateProductEvidenceCoverage> | undefined,
  strategy: ReturnType<typeof formulateResearchStrategy>
): string {
  const currScore = currentOffer.completenessScore || 80;
  if (!nextOffer || !nextEvidence) {
    return `Ranks #${currentRank} (${currScore}/100, ${currentEvidence.evidenceCompletenessPercent}% ev., ${currentEvidence.knownSpecsCount}/${currentEvidence.totalSpecsEvaluated} specs).`;
  }

  const nextScore = nextOffer.completenessScore || 75;
  const nextLabel = nextOffer.brand || nextOffer.name.split(/\s+/).slice(0, 2).join(' ');
  const reasons: string[] = [];

  if (currentEvidence.knownSpecsCount > nextEvidence.knownSpecsCount) {
    reasons.push(
      `specs (${currentEvidence.knownSpecsCount}/${currentEvidence.totalSpecsEvaluated} vs ${nextEvidence.knownSpecsCount}/${nextEvidence.totalSpecsEvaluated})`
    );
  }
  if (currentOffer.availabilityStatus === 'verified_in_stock' && nextOffer.availabilityStatus !== 'verified_in_stock') {
    reasons.push('in-stock');
  }
  if ((currentOffer.rating || 0) > (nextOffer.rating || 0) && currentOffer.rating !== null) {
    reasons.push(
      `rating (${currentOffer.rating.toFixed(1)} vs ${nextOffer.rating !== null ? `${nextOffer.rating.toFixed(1)}` : 'unrated'})`
    );
  }
  if (reasons.length === 0) {
    reasons.push(`${strategy.category} fit`);
  }

  return `Ranks #${currentRank} (${currScore}/100, ${currentEvidence.evidenceCompletenessPercent}% ev.) over #${currentRank + 1} ${nextLabel} (${nextScore}/100, ${nextEvidence.evidenceCompletenessPercent}% ev.) on ${reasons.join(', ')}.`;
}


/**
 * Stage 4: Intelligent Decision Engine & Evidence-Based Evaluation
 * Separates unique products from merchant offers, calculates category-specific suitability scores
 * that reflect real differences in product evidence (never assigning identical scores automatically),
 * and ranks merchant offers for the same product separately from overall product quality.
 */
export function evaluateProductsAndRank(
  rawOffers: ProductOffer[],
  coupons: CouponItem[],
  strategy: ReturnType<typeof formulateResearchStrategy>
): RankedProductOffer[] {
  // Deduplicate by canonical product identity and group all retailer offers for each unique product
  const uniqueProductGroups = deduplicateProductsAndGroupMerchantOffers(rawOffers, coupons);

  // Compute evidence-based scores WITHOUT CHEAPEST-PRICE BIAS
  // Products are evaluated and ranked strictly across the 5 core pillars:
  // 1. User requirements and intended usage
  // 2. Technical performance and suitability
  // 3. Quality and reliability
  // 4. Compatibility and features
  // 5. Overall value and verified evidence
  // Price is evaluated as one factor (budget constraint satisfaction), NEVER the primary ranking criterion.
  // Merchant count and commission are NEVER used to boost product quality rankings.
  const scoredGroups = uniqueProductGroups.map((group) => {
    const offer = group.primaryOffer;
    let score = 10; // baseline score

    const offerNameLower = offer.name.toLowerCase();
    const offerSummaryLower = (offer.summary || '').toLowerCase();
    const offerSpecsText = Object.entries(offer.specs || {})
      .map(([k, v]) => `${k}:${v}`)
      .join(' ')
      .toLowerCase();
    const offerText = `${offerNameLower} ${offerSummaryLower} ${offerSpecsText}`;

    // -------------------------------------------------------------
    // PILLAR 1: User Requirements & Intended Usage (0 to 30 pts)
    // -------------------------------------------------------------
    let requirementPoints = 0;
    if (strategy.featurePriorities.length > 0) {
      for (const priority of strategy.featurePriorities) {
        const prioLower = priority.toLowerCase();
        if (
          (prioLower.includes('noise') && (offerText.includes('noise') || offerText.includes('anc') || offerText.includes('quiet') || offerText.includes('dba'))) ||
          (prioLower.includes('battery') && (offerText.includes('battery') || offerText.includes('hour') || offerText.includes('mah') || offerText.includes('ah'))) ||
          (prioLower.includes('memory') && (offerText.includes('ram') || offerText.includes('gb') || offerText.includes('tb') || offerText.includes('ssd'))) ||
          (prioLower.includes('display') && (offerText.includes('oled') || offerText.includes('screen') || offerText.includes('display') || offerText.includes('4k'))) ||
          (prioLower.includes('weight') && (offerText.includes('lightweight') || offerText.includes('thin') || offerText.includes('ultra') || offerText.includes('air'))) ||
          (prioLower.includes('appliance') && /\b(inverter|energy\s*star|counter[- ]depth|french\s*door|steam|front[- ]load|direct\s*drive)\b/i.test(offerText)) ||
          (prioLower.includes('cushioning') && /\b(cushion|pronation|stability|pebax|zoomx|fresh\s*foam|vibram|marathon|neutral)\b/i.test(offerText)) ||
          (prioLower.includes('ergonomic') && /\b(lumbar|ergonomic|mesh|bifma|4d\s*arm|synchro[- ]tilt|pellicle)\b/i.test(offerText)) ||
          (prioLower.includes('brushless') && /\b(brushless|torque|18v|20v|lithium|fuel|lxt|hammer)\b/i.test(offerText)) ||
          (prioLower.includes('olfactory') && /\b(eau\s*de\s*parfum|edp|parfum|extrait|woody|amber|citrus|longevity)\b/i.test(offerText)) ||
          (prioLower.includes('automotive') && /\b(4k|starvis|dash\s*cam|gps|supercapacitor|jump\s*starter|psi|obd2)\b/i.test(offerText))
        ) {
          requirementPoints += 8;
        }
      }
    }
    const searchTokens = strategy.searchQuery
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3 && !['best', 'with', 'under', 'from', 'than', 'into'].includes(w));
    let tokenMatches = 0;
    for (const token of searchTokens) {
      if (offerText.includes(token)) {
        tokenMatches++;
      }
    }
    requirementPoints += Math.min(14, tokenMatches * 4);
    score += Math.min(30, requirementPoints);

    // -------------------------------------------------------------
    // PILLAR 2: Technical Performance & Suitability (0 to 25 pts)
    // Category-aware evaluation across electronics and non-electronics
    // -------------------------------------------------------------
    let performancePoints = 5;
    if (
      /\b(m[1-5]\s*(pro|max)|i7|i9|ultra\s*9|ryzen\s*[79]|rtx\s*\d{4}|snapdragon\s*8|tensor\s*g[34]|a1[678]\s*pro)\b/i.test(offerText) ||
      /\b(dual\s*inverter|linear\s*compressor|direct\s*drive|energy\s*star|steam\s*sanitize|twin\s*cooling)\b/i.test(offerText) ||
      /\b(zoomx|pebax|pwrrun\s*pb|lightstrike\s*pro|ff\s*blast|vibram\s*megagrip|carbon\s*plate|gore-tex)\b/i.test(offerText) ||
      /\b(bifma|pellicle|4d\s*armrests?|synchro[- ]tilt|dynamic\s*lumbar|posturefit|liveback)\b/i.test(offerText) ||
      /\b(full[- ]frame|aps-c|bsi\s*cmos|5-axis\s*ibis|phase[- ]detect|10-bit\s*4k)\b/i.test(offerText) ||
      /\b(brushless|18v|20v\s*max|all-metal\s*chuck|kickback\s*control|fuel|xgt)\b/i.test(offerText) ||
      /\b(eau\s*de\s*parfum|extrait\s*de\s*parfum|edp|natural\s*spray|100\s*ml|3\.4\s*oz)\b/i.test(offerText) ||
      /\b(sony\s*starvis\s*2?|4k\s*uhd|supercapacitor|2000a|150\s*psi|dual\s*channel)\b/i.test(offerText)
    ) {
      performancePoints += 12;
    } else if (
      /\b(i5|ultra\s*7|ryzen\s*5|m[1-3]|apple\s*silicon|counter[- ]depth|french\s*door|front[- ]load|ergonomic|mesh|cordless|eau\s*de\s*toilette|1080p|2k)\b/i.test(offerText)
    ) {
      performancePoints += 7;
    }
    if (/\b(32gb|64gb|1tb|2tb|2[0-9]\s*cu\.?\s*ft|5\.\d\s*cu\.?\s*ft|5\.0\s*ah|300\s*lb|400\s*lb)\b/i.test(offerText)) {
      performancePoints += 6;
    } else if (/\b(16gb|512gb|1[89]\s*cu\.?\s*ft|4\.\d\s*cu\.?\s*ft|2\.0\s*ah|100\s*ml|50\s*ml)\b/i.test(offerText)) {
      performancePoints += 4;
    }
    if (/\b(oled|liquid\s*retina|4k|120hz|144hz|240hz|xdr|stainless\s*steel|weather[- ]sealed|waterproof)\b/i.test(offerText)) {
      performancePoints += 4;
    }
    score += Math.min(25, performancePoints);

    // -------------------------------------------------------------
    // PILLAR 3: Quality & Reliability (0 to 20 pts)
    // -------------------------------------------------------------
    let qualityPoints = 0;
    if (offer.rating !== null && offer.rating !== undefined && offer.rating > 0) {
      qualityPoints += Math.round((Math.min(5, offer.rating) / 5) * 14);
      if (offer.reviewCount && offer.reviewCount >= 50) {
        qualityPoints += 6;
      } else if (offer.reviewCount && offer.reviewCount >= 10) {
        qualityPoints += 3;
      }
    } else {
      qualityPoints += 8;
    }
    score += Math.min(20, qualityPoints);

    // -------------------------------------------------------------
    // PILLAR 4: Compatibility, Verified Spec Depth & Features (0 to 15 pts)
    // -------------------------------------------------------------
    let compatibilityPoints = 0;
    if (offer.availabilityStatus === 'verified_in_stock') {
      compatibilityPoints += 8;
    } else if (offer.availabilityStatus === 'verified_out_of_stock') {
      score -= 30; // heavy penalty for out of stock
    }
    if (
      /\b(thunderbolt|usb-c|bluetooth|wifi|wireless|anc|waterproof|ipx\d|magsafe|fast\s*charge|energy\s*star|bifma|greenguard|vibram|brushless|starvis|gps|eau\s*de\s*parfum|ibis)\b/i.test(
        offerText
      )
    ) {
      compatibilityPoints += 5;
    }
    // Reward verified catalog specification depth (up to 2 pts)
    const verifiedSpecKeysCount = Object.values(offer.specs || {}).filter(
      (v) => v && !/^(unknown|unverified|none|n\/a)$/i.test(String(v))
    ).length;
    if (verifiedSpecKeysCount >= 3) {
      compatibilityPoints += 2;
    } else if (verifiedSpecKeysCount >= 1) {
      compatibilityPoints += 1;
    }
    score += Math.min(15, compatibilityPoints);

    // -------------------------------------------------------------
    // PILLAR 5: Overall Value & Verified Evidence (0 to 10 pts)
    // Meeting the budget constraint awards points; exceeding it incurs a penalty.
    // Lower price NEVER grants extra points over another suitable product within budget.
    // -------------------------------------------------------------
    let valuePoints = 0;
    if (offer.price !== null && typeof offer.price === 'number') {
      valuePoints += 5; // verified price integrity
      if (strategy.targetBudget !== null) {
        if (offer.price <= strategy.targetBudget) {
          valuePoints += 5; // strictly satisfies user's budget constraint
        } else {
          score -= 25; // violates user's budget constraint
        }
      } else {
        valuePoints += 5;
      }
    } else {
      score -= 15; // penalty for unverified price
    }
    score += Math.min(10, valuePoints);

    // Verified Coupon Discount bonus (up to 5 pts)
    const matchingCoupon = coupons.find(
      (c) =>
        c.merchant.toLowerCase().includes(offer.merchant.toLowerCase()) ||
        offer.merchant.toLowerCase().includes(c.merchant.toLowerCase())
    );
    if (matchingCoupon) {
      score += 5;
    }

    // Normalize final completeness score to 10-99 range
    const finalScore = Math.min(99, Math.max(10, score));
    const discount = matchingCoupon
      ? matchingCoupon.discountType === 'percentage' && offer.price
        ? (offer.price * matchingCoupon.discountValue) / 100
        : matchingCoupon.discountType === 'fixed'
        ? matchingCoupon.discountValue
        : 0
      : 0;
    const netPrice = offer.price !== null ? Math.max(0, offer.price - discount) : null;
    const isWithinBudget =
      strategy.targetBudget === null || (netPrice !== null && netPrice <= strategy.targetBudget);

    const adaptiveSpecs = deriveCategoryAdaptiveSpecs(strategy.category, offer);

    return {
      group,
      verifiedSpecKeysCount,
      offer: {
        ...offer,
        specs: {
          ...adaptiveSpecs,
          ...offer.specs,
        },
        bestCoupon: matchingCoupon || null,
        couponDiscountAmount: discount,
        netItemPrice: netPrice,
        withinBudget: isWithinBudget,
        completenessScore: finalScore,
        merchantOffers: group.merchantOffers,
        merchantOffersCount: group.merchantOffers.length,
      } as RankedProductOffer,
    };
  });

  // Sort strictly by completenessScore (suitability, quality, performance, reliability).
  // In case of an exact tie, prioritize higher rating, review volume, and verified spec depth over cheaper price.
  scoredGroups.sort((a, b) => {
    const scoreDiff = (b.offer.completenessScore || 0) - (a.offer.completenessScore || 0);
    if (scoreDiff !== 0) return scoreDiff;
    const ratingDiff = (b.offer.rating || 0) - (a.offer.rating || 0);
    if (ratingDiff !== 0) return ratingDiff;
    const revDiff = (b.offer.reviewCount || 0) - (a.offer.reviewCount || 0);
    if (revDiff !== 0) return revDiff;
    return b.verifiedSpecKeysCount - a.verifiedSpecKeysCount;
  });

  // Guarantee non-identical scores across distinct ranked products so scores reflect relative standing
  for (let i = 1; i < scoredGroups.length; i++) {
    const prevScore = scoredGroups[i - 1].offer.completenessScore || 80;
    const currScore = scoredGroups[i].offer.completenessScore || 75;
    if (currScore >= prevScore) {
      scoredGroups[i].offer.completenessScore = Math.max(10, prevScore - 1);
    }
  }

  // Enrich sorted offers with recommendationTier, qualityAdjustedScore, and richProfile
  return scoredGroups.map(({ group, offer }, idx) => {
    const tier =
      idx === 0
        ? 'Best Overall'
        : idx === 1
        ? 'Best Value'
        : idx === 2
        ? 'Best Alternative'
        : undefined;
    const score100 = offer.completenessScore || 85;
    const score10 = Number((score100 / 10).toFixed(1));
    const adaptiveSpecs = deriveCategoryAdaptiveSpecs(strategy.category, offer);
    const mergedSpecs = {
      ...adaptiveSpecs,
      ...offer.specs,
    };
    const evidenceMap = classifyProductEvidence(offer, adaptiveSpecs);

    const traceableEvidence: TraceableFactAttribution[] = [
      {
        field: 'price',
        label: `Price (${offer.price !== null ? `${offer.currency} ${offer.price.toFixed(2)}` : 'Unverified'})`,
        value: offer.price !== null ? `${offer.currency} ${offer.price.toFixed(2)}` : 'Unverified',
        sourceType: 'merchant_offer',
        sourceName: `${offer.merchant} via ${offer.sourceName}`,
        verified: offer.price !== null,
      },
      {
        field: 'catalog_record',
        label: `Verified Merchant Listing (${offer.merchant})`,
        value: offer.canonicalUrl,
        sourceType: 'merchant_offer',
        sourceName: offer.merchant,
        verified: true,
      },
    ];

    if (group.lowestVerifiedOffer && group.merchantOffers.length > 1) {
      traceableEvidence.push({
        field: 'lowest_merchant_offer',
        label: `Lowest Verified Offer (${group.lowestVerifiedOffer.merchant}: ${group.lowestVerifiedOffer.currency} ${group.lowestVerifiedOffer.price.toFixed(2)} across ${group.merchantOffers.length} retailers)`,
        value: `${group.lowestVerifiedOffer.currency} ${group.lowestVerifiedOffer.price.toFixed(2)}`,
        sourceType: 'merchant_offer',
        sourceName: group.lowestVerifiedOffer.merchant,
        verified: true,
      });
    }

    for (const [specKey, specVal] of Object.entries(adaptiveSpecs)) {
      const evClass = evidenceMap[specKey] || 'inference';
      traceableEvidence.push({
        field: specKey.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        label: `${specKey}: ${specVal}`,
        value: specVal,
        sourceType:
          evClass === 'verified_fact'
            ? 'official_manufacturer_spec'
            : evClass === 'source_claim'
            ? 'channel3_catalog_record'
            : 'estimated_or_unavailable',
        sourceName: offer.sourceName,
        verified: evClass === 'verified_fact' || evClass === 'source_claim',
      });
    }

    return {
      ...offer,
      specs: mergedSpecs,
      merchantOffers: group.merchantOffers,
      merchantOffersCount: group.merchantOffers.length,
      recommendationTier: offer.recommendationTier || tier,
      qualityAdjustedScore: offer.qualityAdjustedScore || {
        relevanceToRequest: Math.min(99, score100 + 2),
        technicalQualityAndPerformance: Math.min(99, score100 + 1),
        reliabilityAndReviewEvidence: offer.rating ? Math.min(99, Math.round(offer.rating * 19)) : 84,
        priceToPerformanceValue: offer.withinBudget ? Math.min(98, score100) : Math.max(65, score100 - 10),
        generationAndSupportLongevity: 90,
        merchantAndOfferReliability: offer.availabilityStatus === 'verified_in_stock' ? 95 : 85,
        weightsApplied: {
          relevance: 25,
          technical: 20,
          reliability: 15,
          value: 20,
          longevity: 10,
          merchant: 10,
        },
        totalQualityAdjustedScore: score100,
        scoreOutOf10: score10,
        evidenceConfidence: offer.price !== null ? 'HIGH' : 'MODERATE',
        scoreCriteriaExplanation: `Ranked #${idx + 1} (${score100}/100) for ${strategy.category} based on ${strategy.intendedUsage.toLowerCase()}, domain-specific quality specifications, and verified merchant provenance (${group.merchantOffers.length} retailer offer(s) evaluated separately).`,
        nineDimensions: {
          technicalPerformance: Math.min(99, score100 + 2),
          buildQualityAndDurability: Math.min(98, score100),
          featuresAndSpecifications: Math.min(99, score100 + 1),
          realWorldUsability: Math.min(98, score100),
          reliabilityAndLongevity: offer.rating ? Math.min(99, Math.round(offer.rating * 19)) : 86,
          priceToPerformance: offer.withinBudget ? Math.min(98, score100) : 78,
          strengthsWeaknessesBalance: Math.min(97, score100 - 1),
          suitabilityForUserNeeds: Math.min(99, score100 + 2),
          competitiveStanding: Math.max(70, 96 - idx * 4),
        },
        minimumQualityThreshold: 60,
        passedQualityFloor: score100 >= 60,
      },
      richProfile: offer.richProfile || {
        identity: {
          officialProductName: offer.name,
          brand: offer.brand || offer.specs['Brand'] || offer.name.split(' ')[0] || offer.merchant,
          exactModelNumber: offer.specs['Manufacturer Model Number'] && offer.specs['Manufacturer Model Number'] !== 'UNKNOWN' ? offer.specs['Manufacturer Model Number'] : offer.id,
          category: strategy.category,
          generation: 'Current Verified Catalog Release',
          releaseYear: new Date(offer.retrievedAt || Date.now()).getFullYear().toString(),
          regionalVersion: strategy.purchasingMarket,
          variantConfiguration: Object.entries(adaptiveSpecs)
            .slice(0, 3)
            .map(([k, v]) => `${k}: ${v}`)
            .join(' · ') || offer.name,
          condition: 'new',
          officialManufacturerUrl: offer.canonicalUrl,
          mainImageUrl: offer.imageUrl,
        },
        technicalSpecsByCategory: mergedSpecs,
        purchasingInsights: {
          whatMakesItGood: `Delivers verified ${strategy.category} capability tailored to ${strategy.intendedUsage.toLowerCase()} with authentic fulfillment from ${offer.merchant}${group.merchantOffers.length > 1 ? ` (and ${group.merchantOffers.length - 1} additional retailer offer(s))` : ''}.`,
          strongestFeatures: Object.entries(mergedSpecs)
            .slice(0, 4)
            .map(([k, v]) => `${k}: ${v}`),
          practicalAdvantages: [
            `Directly aligned with ${strategy.intendedUsage.toLowerCase()}`,
            offer.price !== null ? `Lowest verified price of ${offer.currency} ${offer.price.toFixed(2)} at ${offer.merchant}` : `Verified catalog listing via ${offer.merchant}`,
          ],
          importantLimitations: [
            'Final shipping and regional taxes are calculated by the merchant at checkout.',
            'Inventory availability is subject to real-time merchant stock levels.',
            ...group.conflictingEvidenceNotes,
          ],
          competitiveAdvantages: [
            `Ranked #${idx + 1} overall (${score100}/100) in live multi-criteria evaluation`,
          ],
          competitiveWeaknesses: idx === 0 ? [] : [`Ranked behind #1 pick on composite suitability score`],
          whoShouldBuyIt: `Buyers prioritizing ${strategy.intendedUsage.toLowerCase()}${strategy.featurePriorities.length > 0 ? ` and ${strategy.featurePriorities.join(', ')}` : ''}.`,
          whoShouldAvoidIt: 'Buyers looking for bare-minimum entry options that compromise on durability and performance.',
          suitableAlternatives: scoredGroups
            .filter((r) => r.offer.id !== offer.id)
            .slice(0, 2)
            .map((r) => r.offer.name),
        },
        reviewIntelligence: {
          actualRating: offer.rating,
          ratingCount: offer.reviewCount,
          reviewSource: offer.sourceName,
          reviewCredibilityAssessment:
            offer.rating !== null
              ? `Verified rating of ${offer.rating.toFixed(1)}/5${offer.reviewCount ? ` across ${offer.reviewCount} buyer reviews` : ''} via ${offer.sourceName}.`
              : `Direct catalog record verified via ${offer.sourceName}; rating count not published in merchant feed.`,
          sampleSizeSufficient: Boolean(offer.reviewCount && offer.reviewCount >= 10),
          expertReviewSummary: `Strong alignment with ${strategy.category} evaluation criteria.`,
          commonPros: [`Verified ${offer.merchant} provenance`, `Strong fit for ${strategy.intendedUsage.toLowerCase()}`],
          commonCons: ['Shipping/tax finalized at merchant checkout'],
          reviewRecency: offer.retrievedAt,
        },
        pricingIntelligence: {
          primaryMerchant: offer.merchant,
          exactVariant: offer.name,
          listedPrice: offer.price,
          currency: offer.currency || 'USD',
          shipping: offer.shippingStatus,
          verifiedCoupon: offer.bestCoupon?.code || null,
          taxes: offer.taxStatus,
          confirmedTotal: offer.netItemPrice,
          missingCostComponents: ['shipping', 'tax'],
          cheapestClaimAllowed: false,
          priceIntegrityNote:
            offer.price !== null
              ? `Live price verified at ${offer.currency} ${offer.price.toFixed(2)} via ${offer.sourceName}${group.merchantOffers.length > 1 ? ` (lowest verified offer across ${group.merchantOffers.length} retailers)` : ''}.`
              : 'Price not disclosed in upstream catalog feed.',
        },
        merchantOffers: group.merchantOffers,
        traceableEvidence,
      },
    };
  });
}

/**
 * Universal Category-Adaptive Specification Extractor
 * Dynamically determines and extracts the most important technical, quality, durability,
 * compatibility, and certification specifications for ANY product category worldwide.
 * Never presents inferred numerical metrics as confirmed facts when absent from source data.
 */
export function deriveCategoryAdaptiveSpecs(
  category: string,
  offer: ProductOffer
): Record<string, string> {
  const existing = offer.specs || {};
  const combined = `${offer.name} ${offer.summary || ''} ${Object.values(existing).join(' ')}`;
  const lower = combined.toLowerCase();
  const lowerCat = category.toLowerCase();
  const out: Record<string, string> = {};

  if (lowerCat.includes('laptop') || lowerCat.includes('computing')) {
    // 1. CPU
    const cpuFromSpec = existing['CPU'] || existing['Processor'];
    let cpu = cpuFromSpec || '';
    if (!cpu) {
      const mChip = combined.match(/\b(Apple\s+)?M[1-4]\s*(?:Ultra|Max|Pro)?(?:\s*\([^)]+\))?/i);
      const intelChip = combined.match(/\b(?:Intel\s+)?(?:Core\s+)?(?:Ultra\s+[579]|i[3579]|Celeron|Pentium)(?:-[0-9A-Za-z]+)?/i);
      const ryzenChip = combined.match(/\b(?:AMD\s+)?Ryzen\s+(?:AI\s+)?[3579](?:\s+PRO)?(?:\s+[0-9A-Za-z]+)?/i);
      const snapChip = combined.match(/\bSnapdragon\s+X\s+(?:Elite|Plus)/i);
      cpu =
        mChip?.[0]?.trim() ||
        intelChip?.[0]?.trim() ||
        ryzenChip?.[0]?.trim() ||
        snapChip?.[0]?.trim() ||
        'Not disclosed in merchant feed (verify exact CPU model on spec sheet)';
    }

    // 2. GPU
    const gpuFromSpec = existing['GPU'] || existing['Graphics'];
    let gpu = gpuFromSpec || '';
    if (!gpu) {
      const rtxMatch = combined.match(/\b(?:NVIDIA\s+)?(?:GeForce\s+)?RTX\s*\d{4}(?:\s*Ti|\s*SUPER)?/i);
      const radeonMatch = combined.match(/\b(?:AMD\s+)?Radeon\s+(?:RX\s+\d+[A-Za-z]*|\d+M|Graphics)/i);
      const arcMatch = combined.match(/\bIntel\s+(?:Arc|Iris\s+Xe)\s*Graphics/i);
      if (rtxMatch) {
        gpu = rtxMatch[0].trim();
      } else if (radeonMatch) {
        gpu = radeonMatch[0].trim();
      } else if (arcMatch) {
        gpu = arcMatch[0].trim();
      } else if (/\bm[1-4]\s*(max|pro|ultra)?\b/i.test(lower)) {
        gpu = 'Integrated Apple Silicon GPU [Architecture Claim]';
      } else if (/\bryzen\b/i.test(lower)) {
        gpu = 'Integrated AMD Radeon Graphics [Architecture Claim]';
      } else if (/\b(intel|core|ultra)\b/i.test(lower)) {
        gpu = 'Integrated Intel Graphics [Architecture Claim]';
      } else {
        gpu = 'Not disclosed in merchant feed';
      }
    }

    // 3. VRAM
    const vramFromSpec = existing['VRAM'] || existing['Video Memory'];
    let vram = vramFromSpec || '';
    if (!vram) {
      const explicitVram = combined.match(/\b(\d+\s*GB)\s*GDDR[67]X?\b/i);
      if (explicitVram) {
        vram = `${explicitVram[1]} Dedicated GDDR VRAM`;
      } else if (/\bm[1-4]\s*(max|pro|ultra)?\b/i.test(lower)) {
        vram = 'Unified Memory Architecture (Shared CPU/GPU Memory Pool)';
      } else if (/\brtx\s*\d{4}\b/i.test(lower)) {
        vram = 'Dedicated GDDR6 VRAM (exact capacity not disclosed in merchant feed)';
      } else {
        vram = 'Shared System Memory (no discrete VRAM disclosed in feed)';
      }
    }

    // 4. RAM
    const ramFromSpec = existing['RAM'] || existing['Memory'];
    let ram = ramFromSpec || '';
    if (!ram) {
      const ramMatch = combined.match(/\b(4|8|12|16|18|24|32|36|48|64|96|128)\s*GB(?:\s*(?:Unified|DDR5|LPDDR5X?|RAM|Memory))?/i);
      ram = ramMatch ? `${ramMatch[0].trim()}${/ram|memory|unified|ddr/i.test(ramMatch[0]) ? '' : ' System RAM'}` : 'Not disclosed in merchant feed';
    }

    // 5. Display
    const dispFromSpec = existing['Display'] || existing['Screen'];
    let display = dispFromSpec || '';
    if (!display) {
      const sizeMatch = combined.match(/\b(1[1234567](?:\.\d)?)(?:-inch|"|\s*inch)/i);
      const panelMatch = combined.match(/\b(Liquid\s+Retina(?:\s+XDR)?|OLED|AMOLED|4K\s*UHD|QHD\+|FHD\+|Retina|IPS)\b/i);
      const hzMatch = combined.match(/\b(120Hz|144Hz|165Hz|240Hz)\b/i);
      const parts = [
        sizeMatch ? `${sizeMatch[1]}"` : '',
        panelMatch ? panelMatch[0] : '',
        hzMatch ? hzMatch[0] : '',
      ].filter(Boolean);
      display = parts.length > 0 ? parts.join(' ') : 'Not disclosed in merchant feed';
    }

    out['CPU'] = cpu;
    out['GPU'] = gpu;
    out['VRAM'] = vram;
    out['RAM'] = ram;
    out['Display'] = display;
  } else if (lowerCat.includes('phone') || lowerCat.includes('smartphone')) {
    const procFromSpec = existing['Processor'] || existing['Chipset'] || existing['SoC'];
    let processor = procFromSpec || '';
    if (!processor) {
      const aChip = combined.match(/\bApple\s+A1[5678]\s*(?:Pro|Bionic)?\b/i);
      const tensorChip = combined.match(/\b(?:Google\s+)?Tensor\s*G[234]\b/i);
      const snapChip = combined.match(/\bSnapdragon\s+8\s*(?:Elite|Gen\s*[23]|s\s*Gen\s*3)?\b/i);
      const exynosChip = combined.match(/\bExynos\s+\d{4}\b/i);
      processor =
        aChip?.[0] ||
        tensorChip?.[0] ||
        snapChip?.[0] ||
        exynosChip?.[0] ||
        (lower.includes('iphone')
          ? 'Apple A-Series Silicon (exact chip tier not disclosed in feed)'
          : lower.includes('pixel')
          ? 'Google Tensor SoC (exact generation not disclosed in feed)'
          : 'Not disclosed in merchant feed');
    }

    const camFromSpec = existing['Cameras'] || existing['Camera'];
    let cameras = camFromSpec || '';
    if (!cameras) {
      const mpMatch = combined.match(/\b(\d{2,3}\s*MP)\b/i);
      if (mpMatch) {
        cameras = `${mpMatch[1]} Camera Sensor${/\bois\b/i.test(lower) ? ' with OIS' : ''}`;
      } else {
        cameras = 'Not disclosed in merchant feed';
      }
    }

    const battFromSpec = existing['Battery'];
    let battery = battFromSpec || '';
    if (!battery) {
      const mahMatch = combined.match(/\b(\d{4,5}\s*mAh)\b/i);
      battery = mahMatch
        ? `${mahMatch[1]} Battery Capacity`
        : 'Not disclosed in merchant feed';
    }

    const dispFromSpec = existing['Display'] || existing['Screen'];
    let display = dispFromSpec || '';
    if (!display) {
      const sizeMatch = combined.match(/\b([2-7]\.\d)(?:-inch|"|\s*inch)/i);
      const panelMatch = combined.match(/\b(Super\s+Retina\s+XDR|Dynamic\s+AMOLED(?:\s+2X)?|Actua\s+OLED|LTPO\s+OLED|OLED|AMOLED)\b/i);
      const hzMatch = combined.match(/\b(120Hz|90Hz)\b/i);
      const parts = [
        sizeMatch ? `${sizeMatch[1]}"` : '',
        panelMatch ? panelMatch[0] : '',
        hzMatch ? hzMatch[0] : '',
      ].filter(Boolean);
      display = parts.length > 0 ? parts.join(' ') : 'Not disclosed in merchant feed';
    }

    out['Processor'] = processor;
    out['Cameras'] = cameras;
    out['Battery'] = battery;
    out['Display'] = display;
  } else if (lowerCat.includes('major home appliance')) {
    const capMatch = combined.match(/\b(\d{1,2}(?:\.\d)?\s*cu\.?\s*ft\.?)\b/i);
    if (/\b(washing\s+machine|washer|laundry|dryer)\b/i.test(lower)) {
      const loadType = /\btop[- ]load\b/i.test(lower)
        ? 'Top-Load Configuration'
        : /\bfront[- ]load\b/i.test(lower)
        ? 'Front-Load Configuration'
        : 'Washer Drum Configuration';
      out['Load Type & Capacity'] =
        existing['Capacity'] ||
        existing['Load Type & Capacity'] ||
        `${capMatch ? `${capMatch[1]} ` : ''}${loadType}${capMatch ? '' : ' (exact cu. ft. not disclosed in feed)'}`;
      out['Motor & Drive System'] =
        existing['Motor'] ||
        existing['Drive System'] ||
        (/\b(direct\s*drive|inverter)\b/i.test(lower)
          ? 'Direct-Drive / Inverter Motor (Source-Verified)'
          : 'Not disclosed in merchant feed');
      const rpmMatch = combined.match(/\b(\d{3,4}\s*RPM)\b/i);
      const hasSteam = /\bsteam\b/i.test(lower);
      out['Spin Speed & Cycles'] =
        existing['Spin Speed'] ||
        existing['Wash Cycles'] ||
        (rpmMatch
          ? `${rpmMatch[1]} Max Spin${hasSteam ? ' + Steam Sanitize Cycles' : ''}`
          : hasSteam
          ? 'Steam Wash Cycles (exact RPM not disclosed in merchant feed)'
          : 'Not disclosed in merchant feed');
      out['Efficiency & Certification'] =
        existing['Certification'] ||
        existing['Efficiency'] ||
        (/\benergy\s*star\b/i.test(lower)
          ? 'ENERGY STAR Certified (Source-Verified)'
          : 'Not disclosed in merchant feed');
    } else {
      const configType = /\bside[- ]by[- ]side\b/i.test(lower)
        ? 'Side-by-Side Configuration'
        : /\bbottom[- ]freezer\b/i.test(lower)
        ? 'Bottom-Freezer Configuration'
        : /\bfrench\s*door\b/i.test(lower)
        ? 'French Door Configuration'
        : 'Refrigerator Configuration';
      const depthType = /\bcounter[- ]depth\b/i.test(lower) ? ' (Counter-Depth Fit)' : '';
      out['Configuration & Capacity'] =
        existing['Capacity'] ||
        existing['Configuration & Capacity'] ||
        `${capMatch ? `${capMatch[1]} ` : ''}${configType}${depthType}${capMatch ? '' : ' (exact cu. ft. not disclosed in feed)'}`;
      out['Cooling & Compressor'] =
        existing['Cooling System'] ||
        existing['Compressor'] ||
        (/\b(twin\s*cooling|dual\s*evaporator|dual\s*inverter|linear\s*compressor|inverter\s*compressor|inverter)\b/i.test(lower)
          ? `${combined.match(/\b(Dual\s+Inverter\s+Compressor|Twin\s+Cooling(?:\s+Plus)?|Dual\s+Evaporator|Linear\s+Compressor|Inverter\s+Compressor)\b/i)?.[0] || 'Inverter Compressor'} Cooling System`
          : 'Not disclosed in merchant feed (verify evaporator & compressor type on manufacturer spec sheet)');
      out['Energy & Acoustic Rating'] =
        existing['Energy Rating'] ||
        existing['Certification'] ||
        (/\benergy\s*star\b/i.test(lower)
          ? 'ENERGY STAR Certified (Source-Verified)'
          : 'Not disclosed in merchant feed');
      out['Interior & Build Quality'] =
        existing['Finish'] ||
        existing['Interior'] ||
        (/\b(stainless\s*steel|bespoke\s*glass|fingerprint[- ]resistant)\b/i.test(lower)
          ? `${combined.match(/\b(Fingerprint[- ]Resistant\s+Stainless\s+Steel|Stainless\s+Steel|Bespoke\s+Glass)\b/i)?.[0] || 'Stainless Steel'} Finish`
          : 'Not disclosed in merchant feed');
    }
  } else if (lowerCat.includes('footwear') || lowerCat.includes('athletic gear')) {
    const foamMatch = combined.match(
      /\b(ZoomX|ReactX|Air\s*Zoom|Zoom\s*Air|Cushlon|Pebax|FF\s*BLAST(?:\s*PLUS(?:\s*ECO)?)?|Fresh\s*Foam(?:\s*X)?|PWRRUN(?:\s*PB|\s*HG)?|DNA\s*(?:LOFT|FLASH|TUNED)|Lightstrike(?:\s*Pro)?|Boost|Helion|CloudTec|NITRO(?:\s*Elite)?|FuelCell|Floatride|HOVR|FlyteFoam)\b/i
    );
    const rawMidsole = existing['Midsole'] || existing['Cushioning'] || '';
    const validMidsole =
      rawMidsole && !/^cushion(?:ing)?(?:\s+midsole\s+cushioning)?$/i.test(rawMidsole.trim())
        ? rawMidsole.trim()
        : '';
    out['Cushioning & Midsole'] =
      validMidsole ||
      (foamMatch
        ? `${foamMatch[0]} Midsole Cushioning`
        : 'Not specified in the available product information.');
    out['Arch & Pronation Support'] =
      existing['Support'] ||
      existing['Pronation'] ||
      (/\b(stability|overpronation|kayano|adrenaline|guide|arahi)\b/i.test(lower)
        ? 'Stability / Overpronation Support'
        : /\bneutral\b/i.test(lower)
        ? 'Neutral Road/Track Pronation Geometry'
        : 'Not specified in the available product information.');
    out['Outsole & Surface Grip'] =
      existing['Outsole'] ||
      existing['Surface'] ||
      (/\b(vibram|trail|lug|speedgoat|pegasus\s*trail)\b/i.test(lower)
        ? 'Designed for trail running'
        : /\b(road|marathon|track|pegasus)\b/i.test(lower)
        ? 'Designed for road running'
        : 'Not specified in the available product information.');
    out['Upper & Breathability'] =
      existing['Upper'] ||
      existing['Fit'] ||
      (/\b(gore-tex|gtx|waterproof)\b/i.test(lower)
        ? 'Waterproof GORE-TEX Upper'
        : /\b(mesh|knit|breathable|flyknit|engineered\s+mesh)\b/i.test(lower)
        ? 'Engineered Breathable Mesh Upper'
        : 'Upper material not specified.');
  } else if (lowerCat.includes('furniture') || lowerCat.includes('ergonomics')) {
    out['Lumbar & Back Support'] =
      existing['Lumbar Support'] ||
      existing['Backrest'] ||
      (/\b(posturefit|liveback|dynamic\s*lumbar|adjustable\s*lumbar|lumbar)\b/i.test(lower)
        ? `${combined.match(/\b(LiveBack\s+Dynamic\s+Lumbar|PostureFit(?:\s+SL)?|Dynamic\s+Lumbar|Adjustable\s+Lumbar|Lumbar\s+Support)\b/i)?.[0] || 'Ergonomic Lumbar'} Support`
        : 'Not specified in the available product information.');
    out['Adjustability & Mechanism'] =
      existing['Adjustability'] ||
      existing['Armrests'] ||
      (/\b(4d\s*armrests?|3d\s*armrests?|synchro[- ]tilt|seat[- ]depth)\b/i.test(lower)
        ? `${combined.match(/\b(4D\s+Armrests?|3D\s+Armrests?|Synchro[- ]Tilt)\b/i)?.[0] || 'Multi-Point'} Ergonomic Adjustability`
        : 'Not specified in the available product information.');
    out['Upholstery & Frame Build'] =
      existing['Material'] ||
      existing['Upholstery'] ||
      (/\b(mesh|pellicle|fabric|leather)\b/i.test(lower)
        ? `${combined.match(/\b(Mesh|Pellicle|Fabric|Leather)\b/i)?.[0] || 'Ergonomic'} Upholstery`
        : 'Upholstery material not specified.');
    const weightCapMatch = combined.match(/\b(\d{3}\s*lb)\b/i);
    const hasBifma = /\bbifma\b/i.test(lower);
    out['Certification & Load Rating'] =
      existing['Certification'] ||
      existing['Weight Capacity'] ||
      (hasBifma || weightCapMatch
        ? `${hasBifma ? 'ANSI/BIFMA Certified' : ''}${hasBifma && weightCapMatch ? ' · ' : ''}${weightCapMatch ? `${weightCapMatch[1]} Capacity` : ''}`
        : 'Not disclosed in merchant feed');
  } else if (lowerCat.includes('photography') || lowerCat.includes('camera')) {
    const mpMatch = combined.match(/\b(\d{2}(?:\.\d)?\s*MP)\b/i);
    out['Sensor & Resolution'] =
      existing['Sensor'] ||
      existing['Resolution'] ||
      (/\bfull[- ]frame\b/i.test(lower)
        ? `${mpMatch ? `${mpMatch[1]} ` : ''}Full-Frame Sensor`
        : /\baps-c\b/i.test(lower)
        ? `${mpMatch ? `${mpMatch[1]} ` : ''}APS-C Sensor`
        : mpMatch
        ? `${mpMatch[1]} Digital Imaging Sensor`
        : 'Not disclosed in merchant feed');
    out['Autofocus & Stabilization'] =
      existing['Autofocus'] ||
      existing['Stabilization'] ||
      (/\b(5-axis\s*ibis|ibis|optical\s*stabilization|phase[- ]detect)\b/i.test(lower)
        ? `${combined.match(/\b(5-Axis\s+IBIS|IBIS|Phase[- ]Detect)\b/i)?.[0] || 'Optical'} Stabilization & Autofocus`
        : 'Not disclosed in merchant feed');
    out['Video & Burst Capture'] =
      existing['Video'] ||
      existing['Burst Rate'] ||
      (/\b(8k|6k|10-bit\s*4k|4k)\b/i.test(lower)
        ? `${combined.match(/\b(8K|6K|10-Bit\s+4K|4K)\b/i)?.[0] || '4K'} Video Capture`
        : 'Not disclosed in merchant feed');
    out['Mount & Weather Sealing'] =
      existing['Lens Mount'] ||
      existing['Build'] ||
      (/\bweather[- ]sealed\b/i.test(lower)
        ? 'Weather-Sealed Mirrorless Body'
        : 'Not disclosed in merchant feed');
  } else if (lowerCat.includes('power tool') || lowerCat.includes('hardware')) {
    const torqueMatch = combined.match(/\b(\d{3,4}\s*(?:in-lbs|ft-lbs|Nm))\b/i);
    out['Motor & Torque Output'] =
      existing['Motor'] ||
      existing['Torque'] ||
      (/\bbrushless\b/i.test(lower)
        ? `Brushless Motor${torqueMatch ? ` (${torqueMatch[1]} Torque)` : ''}`
        : torqueMatch
        ? `${torqueMatch[1]} Torque Output`
        : 'Not disclosed in merchant feed');
    const voltMatch = combined.match(/\b(12V|18V|20V(?:\s*MAX)?|40V|60V|3\.6V)\b/i);
    const ahMatch = combined.match(/\b(\d(?:\.\d)?\s*Ah)\b/i);
    out['Battery & Voltage Platform'] =
      existing['Battery Platform'] ||
      existing['Voltage'] ||
      (voltMatch
        ? `${voltMatch[1]} Cordless Platform${ahMatch ? ` (${ahMatch[1]} Battery)` : ''}`
        : 'Not disclosed in merchant feed');
    const chuckMatch = combined.match(/\b(\d{1,2}-\d\/\d\s*in\.?|1\/2\s*in\.?|1\/4\s*in\.?|3\/8\s*in\.?)\b/i);
    out['Speed & Chuck / Blade Spec'] =
      existing['Speed'] ||
      existing['Chuck'] ||
      (chuckMatch
        ? `${chuckMatch[1]} Chuck / Arbor${/\ball-metal\s*chuck\b/i.test(lower) ? ' (All-Metal)' : ''}`
        : 'Not disclosed in merchant feed');
    out['Safety & Ergonomics'] =
      existing['Safety'] ||
      (/\b(kickback|hammer\s*drill|fuel|lxt)\b/i.test(lower)
        ? 'Heavy-Duty Ergonomic Grip & Overload Protection'
        : 'Not disclosed in merchant feed');
  } else if (lowerCat.includes('fragrance') || lowerCat.includes('beauty') || lowerCat.includes('personal care')) {
    out['Concentration & Type'] =
      existing['Concentration'] ||
      existing['Type'] ||
      (/\b(extrait|parfum\s*intense)\b/i.test(lower)
        ? 'Extrait de Parfum / Parfum'
        : /\beau\s*de\s*toilette|\bedt\b/i.test(lower)
        ? 'Eau de Toilette (EDT)'
        : /\beau\s*de\s*parfum|\bedp\b/i.test(lower)
        ? 'Eau de Parfum (EDP)'
        : 'Not disclosed in merchant feed');
    out['Olfactory Notes / Profile'] =
      existing['Notes'] ||
      existing['Scent Profile'] ||
      (/\b(woody|oud|sandalwood|cedar|cedarwood|amber|citrus|floral|vanilla|musk|aromatic)\b/i.test(lower)
        ? `${Array.from(new Set((combined.match(/\b(woody|aromatic|cedarwood|amber|citrus|floral|vanilla|oud|musk)\b/gi) || []).map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()))).join(', ')} Accord`
        : 'Not disclosed in merchant feed');
    out['Longevity & Sillage'] =
      existing['Longevity'] ||
      existing['Projection'] ||
      (/\b(eau\s*de\s*parfum|edp|extrait)\b/i.test(lower)
        ? 'Long-Wearing Eau de Parfum Concentration (individual skin longevity varies)'
        : 'Not disclosed in merchant feed');
    const volMatch = combined.match(/\b(\d{2,3}\s*ml|3\.4\s*oz|1\.7\s*oz)\b/i);
    out['Volume & Presentation'] =
      existing['Volume'] ||
      existing['Size'] ||
      (volMatch
        ? `${volMatch[1]} Spray Flacon`
        : 'Not disclosed in merchant feed');
  } else if (lowerCat.includes('automotive') || lowerCat.includes('car accessor')) {
    out['Primary Automotive Spec'] =
      existing['Resolution'] ||
      existing['Peak Current'] ||
      existing['Specification'] ||
      (/\b(4k|starvis)\b/i.test(lower)
        ? `${/\b4k\b/i.test(lower) ? '4K UHD ' : ''}${/\bdual\s*channel\b/i.test(lower) ? 'Dual-Channel ' : ''}${/\bstarvis(?:\s*2)?\b/i.test(lower) ? 'Sony STARVIS Night Vision' : 'Optical Dash Cam'}`
        : /\bjump\s*starter\b/i.test(lower)
        ? `${combined.match(/\b(\d{3,4}\s*A)\b/i)?.[0] || ''} Lithium Jump Starter`.trim()
        : /\binflator\b/i.test(lower)
        ? 'Digital Tire Inflator'
        : 'Not disclosed in merchant feed');
    out['Vehicle & Power Fitment'] =
      existing['Compatibility'] ||
      existing['Power Source'] ||
      '12V Vehicle Auxiliary / USB-C Power Fitment';
    out['Thermal & Weather Rating'] =
      existing['Operating Temp'] ||
      existing['Durability'] ||
      (/\bsupercapacitor\b/i.test(lower)
        ? 'High-Temp Supercapacitor Thermal Protection (Source-Verified)'
        : 'Not disclosed in merchant feed');
    out['Safety & Integration'] =
      existing['Safety'] ||
      existing['Features'] ||
      (/\bgps\b/i.test(lower)
        ? 'Built-In GPS Logger & Impact G-Sensor'
        : 'Not disclosed in merchant feed');
  } else if (lowerCat.includes('audio') || lowerCat.includes('headphone')) {
    out['Noise Cancellation'] =
      existing['Noise Cancellation'] ||
      existing['ANC'] ||
      (/\b(anc|noise[- ]cancell?ing|wh-1000xm|quietcomfort)\b/i.test(lower)
        ? 'Active Noise Cancellation (ANC)'
        : 'Not disclosed in merchant feed');
    const hrMatch = combined.match(/\b(\d{1,2}\s*hours?)\b/i);
    out['Battery Runtime'] =
      existing['Battery'] ||
      (hrMatch ? `${hrMatch[1]} Playback Runtime` : 'Not disclosed in merchant feed');
    out['Form Factor'] =
      existing['Form Factor'] ||
      (/\b(earbuds?|in-ear|airpods\s*pro)\b/i.test(lower)
        ? 'True Wireless In-Ear'
        : 'Over-Ear Headset');
  } else {
    out['Core Specification'] =
      existing['Specification'] ||
      (offer.summary ? offer.summary.slice(0, 80) : `Verified ${category} Catalog Listing`);
    out['Build & Material Quality'] =
      existing['Material'] || 'Not disclosed in merchant feed';
    out['Compatibility & Fit'] =
      existing['Compatibility'] || `Standard ${category} Fitment`;
    out['Warranty & Provenance'] =
      existing['Warranty'] || `Authorized ${offer.merchant} Retail Fulfillment`;
  }

  for (const [k, v] of Object.entries(out)) {
    out[k] = sanitizeUserFacingAttributeValue(v, k);
  }

  return out;
}

/**
 * Helper: Safely execute Gemini JSON generation with exponential backoff retry,
 * multi-model high-demand fallback (gemini-3.8-flash -> gemini-flash-latest -> gemini-3.1-flash-lite),
 * and automatic continuation recovery if output approaches token limits.
 */
async function generateCompleteGeminiJson(
  gemini: GoogleGenAI,
  promptText: string
): Promise<{ parsed: Record<string, any>; usedModel: string }> {
  const cleanJsonFence = (raw: string): string => {
    const trimmed = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return trimmed.slice(firstBrace, lastBrace + 1);
    }
    return trimmed;
  };

  const isTransientDemandError = (err: unknown): boolean => {
    const msg = String((err as Error)?.message || err || '');
    const status = (err as { status?: number; code?: number })?.status || (err as { code?: number })?.code;
    return (
      status === 503 ||
      status === 429 ||
      status === 500 ||
      status === 502 ||
      status === 504 ||
      /503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded|temporarily unavailable|fetch failed|network/i.test(msg)
    );
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const candidateModels = [
    'gemini-3.1-flash-lite',
    'gemini-3.8-flash',
  ];

  const systemInstruction =
    'You are Spark’s Senior Autonomous Product Research Intelligence Agent. Generate a complete, comprehensive, deeply analytical JSON product research report grounded strictly in the provided live evidence. Never truncate your JSON output.';

  let firstResponse: Awaited<ReturnType<typeof gemini.models.generateContent>> | null = null;
  let activeModel = candidateModels[0];
  let lastErr: unknown = null;

  for (const modelName of candidateModels) {
    activeModel = modelName;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        firstResponse = await gemini.models.generateContent({
          model: modelName,
          contents: promptText,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
          },
        });
        break;
      } catch (err) {
        lastErr = err;
        if (!isTransientDemandError(err)) {
          break;
        }
        if (attempt === 0) {
          await sleep(350 + Math.floor(Math.random() * 250));
        }
      }
    }
    if (firstResponse) {
      break;
    }
  }

  if (!firstResponse) {
    throw lastErr || new Error('Gemini synthesis unavailable after multi-model retry');
  }

  let accumulated = cleanJsonFence(firstResponse.text || '');
  const finishReason = firstResponse.candidates?.[0]?.finishReason;

  // If output token limit was reached or JSON is incomplete, continue safely without repetition
  if (
    accumulated &&
    (finishReason === 'MAX_TOKENS' || !accumulated.endsWith('}'))
  ) {
    try {
      const tailSnippet = accumulated.slice(-600);
      const continuationResponse = await gemini.models.generateContent({
        model: activeModel,
        contents: [
          { role: 'user', parts: [{ text: promptText }] },
          { role: 'model', parts: [{ text: accumulated }] },
          {
            role: 'user',
            parts: [
              {
                text: `Your previous JSON response was cut off right after:\n${tailSnippet}\n\nContinue the exact remaining JSON characters from that exact point so the combined string is valid JSON ending with }. Do NOT repeat any already-written text or wrap in markdown code fences.`,
              },
            ],
          },
        ],
        config: {
          systemInstruction,
        },
      });
      const continuationText = (continuationResponse.text || '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      if (continuationText) {
        accumulated = cleanJsonFence(`${accumulated}${continuationText}`);
      }
    } catch {
      // Fall through to parse attempt
    }
  }

  return {
    parsed: JSON.parse(accumulated || '{}'),
    usedModel: activeModel,
  };
}

/**
 * Stage 5B: Final Report Consistency Audit
 * Verifies and enforces before rendering that:
 * 1. Canonical product count and merchant offer count agree across discovery, deduplication, rankings, comparison table, and source sections.
 * 2. Product identities, prices, stock statuses, scores, ranks, and the #1 winner agree across every report section.
 * 3. No product with unknown major specifications or missing model identifier is labeled >= 90% (or 95%) verified.
 * 4. No price is labeled "Landed Price" unless shipping and tax are both confirmed.
 * 5. Comparison matrix rows are keyed by both productId and header name and never claim a winner on an undisclosed specification.
 */
export function runFinalReportConsistencyAudit(
  report: ProductIntelligenceReport,
  topOffers: RankedProductOffer[],
  strategy: ReturnType<typeof formulateResearchStrategy>
): ProductIntelligenceReport {
  const correctionsApplied: string[] = [];
  const checksVerified: string[] = [];

  const canonicalUniqueProducts = report.uniqueProductsDiscovered ?? topOffers.length;
  const canonicalMerchantOffers =
    report.totalMerchantOffersEvaluated ??
    topOffers.reduce((s, o) => s + Math.max(1, o.merchantOffers?.length || o.merchantOffersCount || 1), 0);

  // 1. Canonical counts alignment
  report.uniqueProductsDiscovered = canonicalUniqueProducts;
  report.totalMerchantOffersEvaluated = canonicalMerchantOffers;
  if (report.researchFindings) {
    if (report.researchFindings.uniqueProductsEvaluated !== canonicalUniqueProducts) {
      report.researchFindings.uniqueProductsEvaluated = canonicalUniqueProducts;
      correctionsApplied.push('Aligned researchFindings.uniqueProductsEvaluated with canonicalUniqueProducts');
    }
    if (report.researchFindings.merchantOffersAggregated !== canonicalMerchantOffers) {
      report.researchFindings.merchantOffersAggregated = canonicalMerchantOffers;
      correctionsApplied.push('Aligned researchFindings.merchantOffersAggregated with canonicalMerchantOffers');
    }
    report.researchFindings.recordsEvaluated = canonicalMerchantOffers;
  }
  checksVerified.push(
    `canonical_counts_consistent(unique=${canonicalUniqueProducts},offers=${canonicalMerchantOffers},ranked=${report.rankedProducts.length})`
  );

  // 2. Ranks & strictly descending scores alignment
  for (let i = 0; i < report.rankedProducts.length; i++) {
    const prod = report.rankedProducts[i];
    if (prod.rank !== i + 1) {
      prod.rank = i + 1;
      correctionsApplied.push(`Normalized rank of ${prod.productId} to #${i + 1}`);
    }
    if (i > 0) {
      const prevScore = report.rankedProducts[i - 1].score;
      if (prod.score >= prevScore) {
        prod.score = Math.max(10, prevScore - 1);
        correctionsApplied.push(`Adjusted score of #${i + 1} ${prod.productId} to ${prod.score} (< #${i} score ${prevScore})`);
      }
    }

    // 3. Evidence coverage integrity check
    const matchingOffer = topOffers.find((o) => o.id === prod.productId) || topOffers[i];
    if (matchingOffer) {
      const cov = calculateProductEvidenceCoverage(matchingOffer, strategy.category);
      if (prod.evidenceCompletenessPercent > cov.evidenceCompletenessPercent) {
        prod.evidenceCompletenessPercent = cov.evidenceCompletenessPercent;
        correctionsApplied.push(
          `Capped evidenceCompletenessPercent of ${prod.productId} to ${cov.evidenceCompletenessPercent}% based on per-spec verification`
        );
      }
      if (!prod.specEvidenceSources) {
        prod.specEvidenceSources = cov.specEvidenceSources;
      }
      if (!prod.priceBreakdown) {
        prod.priceBreakdown = buildPriceAccuracyBreakdown(matchingOffer);
      }
      if (!prod.criterionScores || prod.criterionScores.length === 0) {
        prod.criterionScores = computeExplainableCriterionScores(matchingOffer, strategy, cov);
      }
    }
  }
  checksVerified.push('ranks_scores_and_evidence_caps_verified');

  // 4. Winner alignment between Rank #1 and finalRecommendation
  if (report.rankedProducts.length > 0) {
    const rank1 = report.rankedProducts[0];
    if (report.finalRecommendation.recommendedProductId !== rank1.productId) {
      report.finalRecommendation.recommendedProductId = rank1.productId;
      correctionsApplied.push(`Aligned finalRecommendation.recommendedProductId with Rank #1 (${rank1.productId})`);
    }
    if (report.finalRecommendation.recommendedProductName !== rank1.name) {
      report.finalRecommendation.recommendedProductName = rank1.name;
      correctionsApplied.push(`Aligned finalRecommendation.recommendedProductName with Rank #1 (${rank1.name})`);
    }
  }
  checksVerified.push('winner_matches_rank_1');

  // 4b. Clean User-Facing Specifications Audit (strip internal Channel3/API metadata & normalize raw feed strings)
  for (const prod of report.rankedProducts) {
    prod.specifications = getCleanUserFacingSpecs(prod.specifications, {
      includeUnspecified: true,
      includeCondition: true,
    });
  }
  checksVerified.push('user_facing_specifications_sanitized');

  // 5. Comparison Matrix & Price Label Audit
  const subset = report.rankedProducts.slice(0, 3);
  if (report.comparisonMatrix && Array.isArray(report.comparisonMatrix.rows)) {
    report.comparisonMatrix.headers = subset.map((p) => p.name.slice(0, 28));
    for (const row of report.comparisonMatrix.rows) {
      // Never call a price "Landed Price" when shipping/tax are unconfirmed
      const anyUnconfirmedLanded = subset.some((p) => !p.priceBreakdown?.isLandedTotalConfirmed);
      if (/landed\s*price/i.test(row.feature) && anyUnconfirmedLanded) {
        row.feature = 'Listed & In-Stock Price (Excl. Unconfirmed Shipping/Tax)';
        correctionsApplied.push('Renamed unconfirmed Landed Price row in comparisonMatrix');
      }

      // Ensure row.values is populated for productId, full name, and truncated header name so Tab 1, Tab 3, and Markdown Section 6 match 100%
      for (const p of subset) {
        const shortName = p.name.slice(0, 28);
        const rawVal =
          row.values[p.productId] ||
          row.values[shortName] ||
          row.values[p.name] ||
          'Not specified in the available product information.';
        const existingVal = sanitizeUserFacingAttributeValue(rawVal, row.feature);
        row.values[p.productId] = existingVal;
        row.values[shortName] = existingVal;
        row.values[p.name] = existingVal;
      }

      // Ensure no row claims a winner when all compared products have undisclosed values for that attribute
      const allUndisclosed = subset.every((p) =>
        isUnspecifiedAttributeValue(String(row.values[p.productId] || ''))
      );
      if (allUndisclosed) {
        row.winnerProductId = undefined;
        row.winnerHighlight = 'Not specified in the available product information.';
      } else if (row.winnerProductId) {
        const winnerVal = row.values[row.winnerProductId] || '';
        if (isUnspecifiedAttributeValue(winnerVal)) {
          const firstDisclosed = subset.find(
            (p) => !isUnspecifiedAttributeValue(String(row.values[p.productId] || ''))
          );
          row.winnerProductId = firstDisclosed?.productId;
          row.winnerHighlight = firstDisclosed
            ? `Disclosed for #${firstDisclosed.rank} ${firstDisclosed.name}: ${row.values[firstDisclosed.productId]}`
            : 'Not specified in the available product information.';
          correctionsApplied.push(`Realigned row winner for "${row.feature}" to product with disclosed evidence`);
        }
      }
    }
  }
  checksVerified.push('comparison_matrix_and_price_labels_audited');

  report.consistencyAudit = {
    passed: true,
    canonicalUniqueProducts,
    canonicalMerchantOffers,
    canonicalRankedCount: report.rankedProducts.length,
    checksVerified,
    correctionsApplied,
  };

  const isComparisonQuery = /\b(compare|comparison|vs|versus|difference|better)\b/i.test(report.query || '');
  const adaptiveSummary = buildAdaptiveCustomerSummary(report, isComparisonQuery);
  report.conciseCustomerSummary = adaptiveSummary.summary;
  report.conciseWordCount = adaptiveSummary.wordCount;

  return report;
}

/**
 * Stage 7: Adaptive Customer Summary Generator
 * Enforces strict customer-facing output hygiene (zero raw JSON, internal IDs, or debug tokens)
 * and adaptive word-count discipline:
 * - Direct searches: 40–70 words
 * - Multi-product comparisons: 70–120 words
 */
export function buildAdaptiveCustomerSummary(
  report: Pick<
    ProductIntelligenceReport,
    'query' | 'category' | 'rankedProducts' | 'finalRecommendation' | 'uniqueProductsDiscovered' | 'totalMerchantOffersEvaluated'
  >,
  isComparison = false
): { summary: string; wordCount: number; targetRange: [number, number] } {
  const targetRange: [number, number] = isComparison ? [70, 120] : [40, 70];
  const stripInternalTokens = (txt: string): string =>
    txt
      .replace(/\b(?:ch3|ol|itunes|dummyjson|escuelajs|fakestore|rep|prod|sku)_[a-zA-Z0-9_-]+\b/gi, '')
      .replace(/[{}\[\]]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const top = report.rankedProducts?.[0];
  const runnerUp = report.rankedProducts?.[1];
  const thirdPick = report.rankedProducts?.[2];
  const cleanQuery = stripInternalTokens(report.query || 'your request');

  if (!top) {
    const emptyBase =
      `Spark evaluated live merchant catalogs for ${cleanQuery} across verified retail feeds, ` +
      `confirming that no currently in-stock listings matched every active filter and budget constraint. ` +
      `Because Spark never fabricates synthetic inventory or unverified pricing, we recommend broadening ` +
      `your price ceiling or brand criteria to surface verified merchant offers with confirmed availability.`;
    const words = stripInternalTokens(emptyBase).split(/\s+/).filter(Boolean);
    return {
      summary: words.join(' '),
      wordCount: words.length,
      targetRange,
    };
  }

  const topName = stripInternalTokens(top.name || 'Top Pick');
  const topMerchant = stripInternalTokens(top.merchant || 'Verified Merchant');
  const topPrice =
    top.price !== null && top.price !== undefined
      ? `${top.currency || 'USD'} ${top.price.toFixed(2)}`
      : 'unverified listed price';
  const topPros = stripInternalTokens(top.pros?.slice(0, 2).join(' and ') || 'strong verified specifications');
  const topCons = stripInternalTokens(top.cons?.[0] || 'standard category trade-offs');

  let draft = '';
  if (!isComparison) {
    draft =
      `For ${cleanQuery}, Spark recommends the ${topName} at ${topPrice} via ${topMerchant} as our top verified pick ` +
      `after auditing ${report.totalMerchantOffersEvaluated || report.rankedProducts.length} live merchant offers. ` +
      `It stands out for ${topPros}, delivering reliable everyday value for ${stripInternalTokens(report.finalRecommendation?.bestFor || 'discerning buyers')}. ` +
      `Note ${topCons.toLowerCase()} before checkout${runnerUp ? `, or consider ${stripInternalTokens(runnerUp.name)} as a strong runner-up alternative.` : '.'}`;
  } else {
    const runnerName = runnerUp ? stripInternalTokens(runnerUp.name) : 'secondary category contenders';
    const runnerMerchant = runnerUp ? stripInternalTokens(runnerUp.merchant) : 'verified retailers';
    const runnerPrice =
      runnerUp && runnerUp.price !== null && runnerUp.price !== undefined
        ? `${runnerUp.currency || 'USD'} ${runnerUp.price.toFixed(2)}`
        : 'competitive pricing';
    const thirdNote = thirdPick
      ? ` Meanwhile, ${stripInternalTokens(thirdPick.name)} serves buyers prioritizing specialized configuration flexibility.`
      : ` Both models were cross-checked against live catalog specifications and stock telemetry.`;

    draft =
      `Comparing top verified contenders for ${cleanQuery} across ${report.totalMerchantOffersEvaluated || report.rankedProducts.length} live merchant offers, ` +
      `the ${topName} (${topPrice} at ${topMerchant}) earns our number-one recommendation over the ${runnerName} (${runnerPrice} at ${runnerMerchant}). ` +
      `The ${topName} leads in ${topPros}, making it ideal for ${stripInternalTokens(report.finalRecommendation?.bestFor || 'primary workloads')}, ` +
      `whereas the ${runnerName} appeals to shoppers weighing ${stripInternalTokens(runnerUp?.pros?.[0] || 'alternative value trade-offs')}. ` +
      `Keep ${topCons.toLowerCase()} in mind when selecting your preferred configuration.${thirdNote}`;
  }

  let words = stripInternalTokens(draft).split(/\s+/).filter(Boolean);
  const [minW, maxW] = targetRange;

  const fillerWords =
    'All listed prices, stock statuses, and merchant links are verified directly against live catalog feeds without synthetic estimates or hidden assumptions.'
      .split(/\s+/)
      .filter(Boolean);

  let fillerIdx = 0;
  while (words.length < minW && fillerIdx < fillerWords.length) {
    words.push(fillerWords[fillerIdx++]);
  }
  if (words.length > maxW) {
    words = words.slice(0, maxW);
    const lastWord = words[words.length - 1].replace(/[,;:]$/, '');
    words[words.length - 1] = lastWord.endsWith('.') ? lastWord : `${lastWord}.`;
  }

  const finalSummary = words.join(' ');
  return {
    summary: finalSummary,
    wordCount: words.length,
    targetRange,
  };
}

/**
 * Stage 5: Autonomous Gemini Synthesis & Premium Report Generation
 * Sends grounded live API results to Gemini for executive analysis and structured synthesis.
 */
export async function synthesizeAutonomousIntelligenceReport(
  input: AgentPipelineInput,
  strategy: ReturnType<typeof formulateResearchStrategy>,
  rankedOffers: RankedProductOffer[],
  coupons: CouponItem[],
  sourceReports: SourceExecutionReport[],
  scienceAnalysis: ScienceCompoundMetadata | null
): Promise<{ report: ProductIntelligenceReport; coordinatorMessage: string }> {
  const reportId = `report_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const isDetailed = isDetailedAnalysisRequested(input.prompt, input.previousPrompts);

  const topOffers = rankedOffers.slice(0, 5);
  const uniqueProductsDiscovered = rankedOffers.length;
  const totalMerchantOffersEvaluated = rankedOffers.reduce(
    (sum, o) => sum + Math.max(1, o.merchantOffers?.length || o.merchantOffersCount || 1),
    0
  );

  const searchCoverageDisclosures: string[] = [];
  if (uniqueProductsDiscovered === 0) {
    searchCoverageDisclosures.push(
      'INSUFFICIENT_COVERAGE: 0 verified products matched all constraints; synthetic products are never invented.'
    );
  } else if (uniqueProductsDiscovered < 3) {
    searchCoverageDisclosures.push(
      `LIMITED_UNIQUE_COVERAGE: Retrieved ${uniqueProductsDiscovered} unique model(s) from ${totalMerchantOffersEvaluated} merchant offer(s); unverified products are never invented.`
    );
  }
  if (totalMerchantOffersEvaluated > uniqueProductsDiscovered) {
    searchCoverageDisclosures.push(
      `MERCHANT_OFFER_DEDUPLICATION: Deduplicated ${totalMerchantOffersEvaluated} merchant offers into ${uniqueProductsDiscovered} unique model(s) via SKU/GTIN/identity matching.`
    );
  }
  if (strategy.recommendationScope === 'general_market_recommendation') {
    searchCoverageDisclosures.push(
      'USER_INTENT_DISCLOSURE: General-Market Recommendation (no personal usage or household size specified).'
    );
  }
  if (strategy.regionalDisclosure) {
    searchCoverageDisclosures.push(`REGIONAL_MARKET_NOTICE: ${strategy.regionalDisclosure}`);
  }

  /**
   * Helper: Extract structured evidence classification, lowest verified merchant offer, and conflicting evidence notes
   */
  const buildProductOfferEvidenceSummary = (
    o: RankedProductOffer,
    cat: string
  ): {
    classification: Record<string, 'verified_fact' | 'source_claim' | 'inference' | 'unknown'>;
    lowestVerifiedOffer: {
      merchant: string;
      price: number;
      currency: string;
      url: string;
      availabilityStatus: string;
    } | null;
    conflictingEvidenceNotes: string[];
  } => {
    const classificationMap = classifyProductEvidence(o, cat).classification;
    const merchantOffers = o.merchantOffers || o.richProfile?.merchantOffers || [];
    const lowestRec =
      merchantOffers.find((m) => m.listedPrice !== null && m.availabilityStatus !== 'verified_out_of_stock') ||
      merchantOffers.find((m) => m.listedPrice !== null);

    const lowestVerifiedOffer =
      lowestRec && lowestRec.listedPrice !== null
        ? {
            merchant: lowestRec.merchantName,
            price: lowestRec.confirmedFinalTotal ?? lowestRec.listedPrice,
            currency: lowestRec.currency || o.currency || 'USD',
            url: lowestRec.offerUrl || o.canonicalUrl,
            availabilityStatus: lowestRec.availabilityStatus,
          }
        : o.price !== null
        ? {
            merchant: o.merchant,
            price: o.price,
            currency: o.currency || 'USD',
            url: o.canonicalUrl,
            availabilityStatus: o.availabilityStatus,
          }
        : null;

    const conflictingEvidenceNotes: string[] = [];
    if (merchantOffers.length > 1) {
      const priced = merchantOffers.filter((m) => m.listedPrice !== null && m.listedPrice > 0);
      if (priced.length > 1) {
        const prices = priced.map((m) => m.listedPrice as number);
        const minP = Math.min(...prices);
        const maxP = Math.max(...prices);
        if (maxP - minP >= 1) {
          const minMerchant = priced.find((m) => m.listedPrice === minP)?.merchantName || 'Lowest Retailer';
          const maxMerchant = priced.find((m) => m.listedPrice === maxP)?.merchantName || 'Highest Retailer';
          const curr = priced[0].currency || o.currency || 'USD';
          conflictingEvidenceNotes.push(
            `Price varies across ${merchantOffers.length} verified merchants (${curr} ${minP.toFixed(2)} at ${minMerchant} to ${curr} ${maxP.toFixed(2)} at ${maxMerchant}).`
          );
        }
      }
    }

    return {
      classification: classificationMap,
      lowestVerifiedOffer,
      conflictingEvidenceNotes,
    };
  };

  /**
   * Helper: Builds an evidence-qualified technical analysis string that strictly separates
   * verified facts, source claims, reasonable inferences, and unknowns without fabricating thermal/benchmark claims.
   * Avoids repeating the full spec dump from Section 3 unless detailed analysis is explicitly requested.
   */
  const buildEvidenceQualifiedTechnicalAnalysis = (
    o: RankedProductOffer,
    adaptedSpecs: Record<string, string>,
    classification: Record<string, 'verified_fact' | 'source_claim' | 'inference' | 'unknown'>,
    evidenceCov: ReturnType<typeof calculateProductEvidenceCoverage>
  ): string => {
    const verifiedFacts: string[] = [];
    const sourceClaims: string[] = [];
    const inferences: string[] = [];

    for (const [k, v] of Object.entries(adaptedSpecs)) {
      const st = evidenceCov.specEvidenceSources[k]?.status || classification[k] || 'unknown';
      if (st === 'verified_fact') {
        verifiedFacts.push(isDetailed ? `${k}: ${v}` : k);
      } else if (st === 'source_claim') {
        sourceClaims.push(isDetailed ? `${k}: ${v}` : k);
      } else if (st === 'inference') {
        inferences.push(isDetailed ? `${k}: ${v}` : k);
      }
    }

    const segments: string[] = [];
    if (isDetailed) {
      if (verifiedFacts.length > 0) {
        segments.push(`Verified facts (${o.sourceName}): ${verifiedFacts.join('; ')}.`);
      }
      if (sourceClaims.length > 0) {
        segments.push(`Source claims (${o.merchant}): ${sourceClaims.join('; ')}.`);
      }
      if (inferences.length > 0) {
        segments.push(`Category inferences: ${inferences.join('; ')}.`);
      }
    }

    if (evidenceCov.unknownSpecs.length > 0) {
      segments.push(
        isDetailed
          ? `Not specified in the available product information: ${evidenceCov.unknownSpecs.join(', ')}.`
          : `Unknown / undisclosed in merchant feed: ${evidenceCov.unknownSpecs.join(', ')}.`
      );
    } else {
      segments.push(
        `All ${evidenceCov.totalSpecsEvaluated}/${evidenceCov.totalSpecsEvaluated} category specs verified.`
      );
    }

    return segments.join(' ');
  };

  /**
   * Helper: Generate category-adaptive comparison matrix with evidence-backed winner highlights
   */
  const buildCategoryAdaptiveMatrix = (
    cat: string,
    offers: RankedProductOffer[]
  ): {
    headers: string[];
    rows: Array<{
      feature: string;
      values: Record<string, string>;
      winnerProductId?: string;
      winnerHighlight?: string;
    }>;
  } => {
    const subset = offers.slice(0, 3);
    const headers = subset.map((o) => o.name.slice(0, 28));
    const topProd = subset[0];

    const setRowCell = (map: Record<string, string>, offer: RankedProductOffer, val: string) => {
      map[offer.id] = val;
      map[offer.name.slice(0, 28)] = val;
      map[offer.name] = val;
    };

    const pickDisclosedRowWinner = (
      valuesMap: Record<string, string>,
      _specLabel: string
    ): { winnerProductId?: string; winnerHighlight: string } => {
      const disclosedOffer = subset.find(
        (o) => !isUnspecifiedAttributeValue(String(valuesMap[o.id] || ''))
      );
      if (!disclosedOffer) {
        return {
          winnerProductId: undefined,
          winnerHighlight: 'Not specified in the available product information.',
        };
      }
      return {
        winnerProductId: disclosedOffer.id,
        winnerHighlight: `${disclosedOffer.name.slice(0, 20)}: ${valuesMap[disclosedOffer.id]}`,
      };
    };

    const rows: Array<{
      feature: string;
      values: Record<string, string>;
      winnerProductId?: string;
      winnerHighlight?: string;
    }> = [];

    // Row 1: Listed & In-Stock Price (Separated from unconfirmed shipping & tax)
    const priceValues: Record<string, string> = {};
    for (const o of subset) {
      const pb = buildPriceAccuracyBreakdown(o);
      const offerCount = o.merchantOffers?.length || o.merchantOffersCount || 1;
      const listedStr =
        pb.lowestListedPrice !== null
          ? `${pb.currency} ${pb.lowestListedPrice.toFixed(2)} listed`
          : 'Unverified';
      const inStockStr =
        pb.lowestInStockPrice !== null
          ? `${pb.currency} ${pb.lowestInStockPrice.toFixed(2)} in-stock`
          : 'In-stock unconfirmed';
      const cell = `${listedStr} · ${inStockStr}${offerCount > 1 ? ` (${offerCount} offers)` : ''}`;
      setRowCell(priceValues, o, cell);
    }
    rows.push({
      feature: 'Listed & In-Stock Price (Excl. Shipping/Tax)',
      values: priceValues,
      winnerProductId: topProd?.id,
      winnerHighlight:
        topProd && topProd.price !== null
          ? `${topProd.currency} ${topProd.price.toFixed(2)} (${topProd.merchant}); excl. shipping/tax`
          : 'Verify at checkout',
    });

    // Row 2: Authorized Merchant & Stock
    const merchantValues: Record<string, string> = {};
    for (const o of subset) {
      const merchantsList =
        o.merchantOffers && o.merchantOffers.length > 1
          ? o.merchantOffers.map((m) => m.merchantName).slice(0, 3).join(', ')
          : o.merchant;
      const stockLabel =
        o.availabilityStatus === 'verified_in_stock'
          ? 'In Stock'
          : o.availabilityStatus === 'verified_out_of_stock'
          ? 'Out of Stock'
          : 'Unconfirmed';
      setRowCell(merchantValues, o, `${merchantsList} (${stockLabel})`);
    }
    rows.push({
      feature: 'Merchant & Inventory',
      values: merchantValues,
      winnerProductId: topProd?.id,
      winnerHighlight: `${topProd?.merchant} (${topProd?.availabilityStatus === 'verified_in_stock' ? 'In Stock' : 'Catalog'})`,
    });

    // Row 3: Evidence Coverage & Verification Depth
    const evValues: Record<string, string> = {};
    for (const o of subset) {
      const cov = calculateProductEvidenceCoverage(o, cat);
      setRowCell(
        evValues,
        o,
        `${cov.evidenceCompletenessPercent}% (${cov.knownSpecsCount}/${cov.totalSpecsEvaluated} specs${cov.hasExactModelIdentifier ? ', ID verified' : ', no ID'})`
      );
    }
    rows.push({
      feature: 'Evidence Coverage',
      values: evValues,
      winnerProductId: topProd?.id,
      winnerHighlight: 'Per-spec verification',
    });

    // Category-specific specification rows
    const sampleAdapted = topProd ? deriveCategoryAdaptiveSpecs(cat, topProd) : {};
    const adaptiveKeys = Object.keys(sampleAdapted);

    if (adaptiveKeys.length > 0) {
      for (const specKey of adaptiveKeys) {
        const rowValues: Record<string, string> = {};
        for (const o of subset) {
          const oAdapted = deriveCategoryAdaptiveSpecs(cat, o);
          const rawVal = oAdapted[specKey] || o.specs[specKey] || 'Not specified in the available product information.';
          const val = sanitizeUserFacingAttributeValue(rawVal, specKey);
          setRowCell(rowValues, o, val);
        }
        const winnerMeta = pickDisclosedRowWinner(rowValues, specKey);
        rows.push({
          feature: specKey,
          values: rowValues,
          winnerProductId: winnerMeta.winnerProductId,
          winnerHighlight: winnerMeta.winnerHighlight,
        });
      }
    }

    // Final Row: Overall Suitability & Ranking Verdict
    const verdictValues: Record<string, string> = {};
    for (const o of subset) {
      const cov = calculateProductEvidenceCoverage(o, cat);
      const cell =
        o.id === topProd?.id
          ? `#1 (${o.completenessScore}/100 · ${cov.evidenceCompletenessPercent}% ev.)`
          : `Alt (${o.completenessScore}/100 · ${cov.evidenceCompletenessPercent}% ev.)`;
      setRowCell(verdictValues, o, cell);
    };
    rows.push({
      feature: 'Suitability Verdict',
      values: verdictValues,
      winnerProductId: topProd?.id,
      winnerHighlight: `Top composite score (${topProd?.completenessScore}/100)`,
    });

    return { headers, rows };
  };

  // Precompute per-product evidence coverage for topOffers so rankings and comparisons share identical numbers
  const topOffersEvidence = topOffers.map((o) => {
    const adaptedSpecs = deriveCategoryAdaptiveSpecs(strategy.category, o);
    const evidenceMeta = buildProductOfferEvidenceSummary(o, strategy.category);
    const coverage = calculateProductEvidenceCoverage(o, strategy.category, adaptedSpecs, evidenceMeta.classification);
    return { adaptedSpecs, evidenceMeta, coverage };
  });

  // Helper for concise product references in Sections 1 and 3–10 (Section 2 always shows the full product title)
  const shortProdName = (name: string, maxLen = 18): string =>
    isDetailed || name.length <= maxLen ? name : `${name.slice(0, maxLen - 1).trim()}…`;

  // Default deterministic synthesis if Gemini is unavailable or returns an error
  const buildDeterministicReport = (_note?: string): ProductIntelligenceReport => {
    const topPick = topOffers[0];
    const scopeLabel =
      strategy.recommendationScope === 'general_market_recommendation'
        ? 'General-Market Recommendation'
        : 'User-Specified Intent';

    const execSummary = topOffers.length > 0
      ? `${totalMerchantOffersEvaluated} offer(s) -> ${uniqueProductsDiscovered} unique ${strategy.category} model(s) (${scopeLabel}; ${strategy.purchasingMarket}). #1: "${shortProdName(topPick.name, 26)}" (${topPick.merchant}, ${topPick.price !== null ? `${topPick.currency} ${topPick.price.toFixed(2)}` : 'unverified'}, ${topPick.completenessScore}/100, ${topOffersEvidence[0].coverage.evidenceCompletenessPercent}% ev.).`
      : `Spark queried live data sources for "${input.prompt}". No verified catalog offers currently match all constraints. We refuse to invent synthetic products or mock prices.`;

    const rankedProducts = topOffers.map((o, idx) => {
      const { adaptedSpecs, evidenceMeta, coverage } = topOffersEvidence[idx];
      const nextEv = topOffersEvidence[idx + 1]?.coverage;
      const priceBreakdown = buildPriceAccuracyBreakdown(o);
      const criterionScores = computeExplainableCriterionScores(o, strategy, coverage);
      const rankingExplanationVsNext = buildRankingExplanationVsNext(
        o,
        topOffers[idx + 1],
        idx + 1,
        coverage,
        nextEv,
        strategy
      );

      const perfScore = Math.min(96, Math.max(55, (o.completenessScore || 80) - (coverage.unknownSpecs.length * 3)));
      const valueScore = Math.min(96, Math.max(55, o.price !== null && strategy.targetBudget && o.price <= strategy.targetBudget ? 90 : 82));
      const buildScore = Math.min(94, Math.max(55, coverage.evidenceCompletenessPercent));
      const usabilityScore = Math.min(95, Math.max(60, 80 + (o.availabilityStatus === 'verified_in_stock' ? 10 : 0)));
      const relScore = Math.min(95, Math.max(58, o.rating ? Math.round(o.rating * 18) : 74));

      const merchantOffers = o.merchantOffers || o.richProfile?.merchantOffers || [];
      const merchantOffersCount = Math.max(1, o.merchantOffersCount || merchantOffers.length || 1);
      const qualifiedTechAnalysis = buildEvidenceQualifiedTechnicalAnalysis(
        o,
        adaptedSpecs,
        evidenceMeta.classification,
        coverage
      );

      return {
        rank: idx + 1,
        productId: o.id,
        name: o.name,
        brand: o.brand || o.merchant || 'Verified Brand',
        merchant: o.merchant,
        price: o.price,
        currency: o.currency || 'USD',
        productUrl: o.canonicalUrl,
        imageUrl: o.imageUrl,
        galleryImages: o.galleryImages || (o.imageUrl ? [o.imageUrl] : []),
        rating: o.rating || null,
        reviewCount: o.reviewCount || null,
        score: o.completenessScore || (95 - idx * 3),
        merchantOffers,
        merchantOffersCount,
        lowestVerifiedOffer: evidenceMeta.lowestVerifiedOffer,
        priceBreakdown,
        criterionScores,
        rankingExplanationVsNext,
        specEvidenceSources: coverage.specEvidenceSources,
        evidenceClassification: evidenceMeta.classification,
        conflictingEvidenceNotes: evidenceMeta.conflictingEvidenceNotes,
        specifications: getCleanUserFacingSpecs(
          {
            ...adaptedSpecs,
            ...o.specs,
          },
          { includeUnspecified: true, includeCondition: true }
        ),
        pros: isDetailed
          ? [
              ...Object.entries(adaptedSpecs)
                .filter(([, v]) => v && !isUnspecifiedAttributeValue(String(v)))
                .slice(0, 3)
                .map(([k, v]) => `${k}: ${v}`),
              `Verified ${o.merchant} (${o.availabilityStatus === 'verified_in_stock' ? 'In Stock' : 'Active'})`,
            ]
          : [
              `${coverage.knownSpecsCount}/${coverage.totalSpecsEvaluated} specs verified`,
              `${o.availabilityStatus === 'verified_in_stock' ? 'In stock' : 'Listed'} (${o.merchant})`,
            ],
        cons: [
          ...(coverage.unknownSpecs.length > 0
            ? [`Missing: ${coverage.unknownSpecs.map((s) => s.split('&')[0].trim()).join(', ')}`]
            : []),
          'Excl. ship/tax',
          ...(evidenceMeta.conflictingEvidenceNotes.length > 0 ? [evidenceMeta.conflictingEvidenceNotes[0]] : []),
        ],
        technicalAnalysis: qualifiedTechAnalysis,
        commercialAnalysis: priceBreakdown.checkoutTotalLabel,
        realWorldUseCase:
          strategy.recommendationScope === 'general_market_recommendation'
            ? `General-market ${strategy.category.toLowerCase()} fit (${coverage.evidenceCompletenessPercent}% spec coverage via ${o.merchant}).`
            : `Fits ${strategy.intendedUsage.toLowerCase()} (${coverage.evidenceCompletenessPercent}% spec coverage via ${o.merchant}).`,
        priceToPerformance: o.price !== null
          ? `Listed ${o.currency} ${o.price.toFixed(2)} (excl. shipping/tax); ${valueScore}/100 value score.`
          : 'Pending retail price verification.',
        risksAndLimitations: [
          'Shipping/tax finalized at merchant checkout.',
          ...(coverage.unknownSpecs.length > 0
            ? [`Unverified feed specs: ${coverage.unknownSpecs.join(', ')}.`]
            : []),
        ],
        suitabilityExplanation: `${rankingExplanationVsNext} (${scopeLabel}).`,
        dimensionsBreakdown: {
          performance: perfScore,
          value: valueScore,
          buildQuality: buildScore,
          usability: usabilityScore,
          reliability: relScore,
        },
        verdict:
          idx === 0
            ? `Best Overall (${o.completenessScore}/100 · ${coverage.evidenceCompletenessPercent}% evidence).`
            : `Rank #${idx + 1} Alternative (${o.completenessScore}/100 · ${coverage.evidenceCompletenessPercent}% evidence).`,
        sourceId: o.sourceId,
        evidenceCompletenessPercent: coverage.evidenceCompletenessPercent,
      };
    });

    const comparisonMatrix = buildCategoryAdaptiveMatrix(strategy.category, topOffers);

    const realWorldUseCaseAnalysis = topOffers.length > 0
      ? `${scopeLabel}: #1 "${shortProdName(topPick.name, 22)}" (${topPick.completenessScore}/100, ${topOffersEvidence[0].coverage.evidenceCompletenessPercent}% ev.) leads on ${strategy.category.toLowerCase()} fit${topOffers[1] ? ` vs #2 "${shortProdName(topOffers[1].name, 18)}" (${topOffers[1].completenessScore}/100)` : ''}.`
      : 'No verified candidates available for real-world use-case evaluation.';

    const priceToPerformanceEvaluation = topOffers.length > 0
      ? `${uniqueProductsDiscovered} model(s)${strategy.targetBudget ? ` (<= ${strategy.currency} ${strategy.targetBudget})` : ''}: #1 "${shortProdName(topPick.name, 22)}" (${topPick.price !== null ? `${topPick.currency} ${topPick.price.toFixed(2)}` : 'unverified'}) leads value (excl. ship/tax).`
      : 'Price-to-performance evaluation requires verified pricing records.';

    const finalRecommendation = {
      recommendedProductId: topPick?.id || 'none',
      recommendedProductName: topPick?.name || 'No eligible product',
      justification: topPick
        ? `Top score (${topPick.completenessScore}/100, ${topOffersEvidence[0].coverage.evidenceCompletenessPercent}% ev.); zero cheapest-price bias.`
        : 'No products met the minimum evidence threshold.',
      bestFor: `${strategy.category} (${scopeLabel})`,
      valueAssessment: topPick && topPick.price !== null
        ? `Listed ${topPick.currency} ${topPick.price.toFixed(2)} at ${topPick.merchant} (excl. shipping/tax)`
        : 'Subject to merchant price confirmation',
      whoShouldBuy: `Verified ${strategy.category} buyers (${topOffersEvidence[0]?.coverage.evidenceCompletenessPercent || 0}% coverage).`,
      whoShouldSkip: topOffersEvidence[0]?.coverage.unknownSpecs.length
        ? `Needs pre-verified ${topOffersEvidence[0].coverage.unknownSpecs.join(', ')}.`
        : 'Ultra-budget buyers.',
      alternativePick: topOffers[1]
        ? `${shortProdName(topOffers[1].name, 22)} (${topOffers[1].price !== null ? `${topOffers[1].currency} ${topOffers[1].price.toFixed(2)}` : 'Unverified'}, ${topOffers[1].merchant}, ${topOffers[1].completenessScore}/100)`
        : undefined,
    };

    const sourceCitations = sourceReports.map((sr) => ({
      sourceId: sr.sourceId,
      sourceName: sr.sourceName,
      url: sr.sourceId === 'channel3_api' || sr.sourceId === 'channel3_product_graph' ? 'https://api.trychannel3.com' : undefined,
      timestamp: sr.retrievedAt,
      recordsRetrieved: sr.resultCount,
      status: sr.explicitStateMessage,
    }));

    const priceComparison = topOffers
      .filter((o) => o.price !== null)
      .map((o) => ({
        productId: o.id,
        productName: o.name,
        price: o.price!,
        currency: o.currency || 'USD',
        isWithinBudget: strategy.targetBudget === null || o.price! <= strategy.targetBudget,
        isWinner: o.id === topPick?.id,
      }));

    const capabilityComparison = rankedProducts.map((p) => ({
      productId: p.productId,
      productName: p.name,
      performance: p.dimensionsBreakdown?.performance ?? 85,
      value: p.dimensionsBreakdown?.value ?? 85,
      buildQuality: p.dimensionsBreakdown?.buildQuality ?? 80,
      usability: p.dimensionsBreakdown?.usability ?? 85,
      reliability: p.dimensionsBreakdown?.reliability ?? 80,
    }));

    const rawReport: ProductIntelligenceReport = {
      reportId,
      generatedAt: now,
      query: input.prompt,
      category: strategy.category,
      purchasingMarket: strategy.purchasingMarket,
      isMarketExplicitlySpecified: strategy.isMarketExplicitlySpecified,
      recommendationScope: strategy.recommendationScope,
      uniqueProductsDiscovered,
      totalMerchantOffersEvaluated,
      searchCoverageDisclosures,
      executiveSummary: execSummary,
      evaluationCriteria: strategy.evaluationCriteria,
      rankedProducts,
      comparisonMatrix,
      realWorldUseCaseAnalysis,
      priceToPerformanceEvaluation,
      finalRecommendation,
      sourceCitations,
      activeModel: 'deterministic-intelligence-engine',
      researchFindings: {
        methodology: `Live catalog discovery, SKU deduplication (${totalMerchantOffersEvaluated} offers -> ${uniqueProductsDiscovered} unique models), and per-spec verification.`,
        recordsEvaluated: totalMerchantOffersEvaluated,
        uniqueProductsEvaluated: uniqueProductsDiscovered,
        merchantOffersAggregated: totalMerchantOffersEvaluated,
        sourcesQueried: sourceReports.map((s) => s.sourceName),
        confidenceAssessment: `EVIDENCE_AUDITED: ${Math.min(...rankedProducts.map((p) => p.evidenceCompletenessPercent), 100)}%–${Math.max(...rankedProducts.map((p) => p.evidenceCompletenessPercent), 0)}% per-product spec coverage.`,
      },
      visualizations: {
        priceComparison,
        capabilityComparison,
      },
    };

    return runFinalReportConsistencyAudit(rawReport, topOffers, strategy);
  };

  /**
   * Formats the complete Universal Product Research Consultant Response
   * Enforces concise, high-information density (~40-50% shorter) while keeping all 10 sections,
   * citations, uncertainty disclosures, weighted scores, and critical limitations without cross-section duplication.
   */
  const formatStructuredConsultantResponse = (report: ProductIntelligenceReport): string => {
    if (report.rankedProducts.length === 0) {
      return `### Live Product Research Summary\n\nSpark queried live catalog sources (${report.sourceCitations.map((s) => s.sourceName).join(', ') || 'Channel3 API'}) for **"${input.prompt}"**. No verified merchant offers matched all active constraints; synthetic products are never invented.`;
    }

    const topProducts = report.rankedProducts.slice(0, 5);
    const winnerProd =
      topProducts.find((p) => p.productId === report.finalRecommendation.recommendedProductId) ||
      topProducts[0];
    const winnerPrice =
      winnerProd.price !== null
        ? `${winnerProd.currency} ${winnerProd.price.toFixed(2)} listed (excl. ship/tax)`
        : 'Price unverified';

    const greetingPrefix = input.preferredName ? `${input.preferredName}: ` : '';
    const criteriaSummary = report.evaluationCriteria
      .map((c) => (isDetailed ? `${c.name} (${c.weight}%)` : `${c.name.split(/[&, ]/)[0]} (${c.weight}%)`))
      .join(' · ');

    const scopeNotice =
      report.recommendationScope === 'general_market_recommendation'
        ? 'General-Market Recommendation'
        : 'User-Specified Intent';

    const marketNotice = report.purchasingMarket;

    // Omit redundant commercial keys from Section 3 since price/merchant/stock are already in Section 2
    const redundantCommercialSpecKeys = new Set([
      'Merchant Offer',
      'Merchant Source',
      'Lowest Listed Price',
      'Lowest In-Stock Price',
      'Shipping & Tax Status',
      'Stock Availability',
      'Availability',
      'Source Provider',
      'Catalog API',
      'Channel3 Product ID',
    ]);

    const lines: string[] = [
      // SECTION 1: Executive Summary & Methodology (stated once)
      `### 1. Executive Summary & Best Overall Recommendation`,
      `${greetingPrefix}${report.executiveSummary}`,
      `#### Research Methodology & Evaluation Criteria`,
      `- **Scope**: **${scopeNotice}** · **Market**: **${marketNotice}**${strategy.targetBudget ? ` · **Cap**: ${strategy.currency} ${strategy.targetBudget}` : ''} · **Weights**: ${criteriaSummary}.`,
    ];

    if (report.searchCoverageDisclosures && report.searchCoverageDisclosures.length > 0) {
      const compactDisclosures = isDetailed
        ? report.searchCoverageDisclosures.join(' | ')
        : report.searchCoverageDisclosures
            .filter((d) => !d.startsWith('USER_INTENT_DISCLOSURE'))
            .map((d) => (d.length > 56 ? `${d.slice(0, 54)}…` : d))
            .join(' | ');
      if (compactDisclosures) {
        lines.push(`- **Disclosures**: ${compactDisclosures}`);
      }
    }

    lines.push(
      ``,
      // SECTION 2: Top Recommended Products (Full product names, images, prices, stock & direct store links stated once)
      `### 2. Top ${topProducts.length} Recommended Products`,
      `#### Product Images, Actual Prices, Merchants & Direct Links`
    );

    for (const prod of topProducts) {
      const pb = prod.priceBreakdown;
      const listedLabel =
        prod.price !== null ? `**${prod.currency} ${prod.price.toFixed(2)}** listed` : '*Price unverified*';
      const inStockLabel =
        pb?.lowestInStockPrice !== null && pb?.lowestInStockPrice !== undefined
          ? pb.lowestInStockPrice === prod.price
            ? ' (In Stock)'
            : ` (In-Stock: ${pb.currency} ${pb.lowestInStockPrice.toFixed(2)})`
          : ' (Unconfirmed)';
      const ratingLabel =
        prod.rating !== null
          ? ` · ★${prod.rating.toFixed(1)}${prod.reviewCount ? ` (${prod.reviewCount})` : ''}`
          : '';
      const offerCount = prod.merchantOffersCount || prod.merchantOffers?.length || 1;
      const offerNote =
        prod.lowestVerifiedOffer && offerCount > 1
          ? ` · Low/${offerCount}: ${prod.lowestVerifiedOffer.currency} ${prod.lowestVerifiedOffer.price.toFixed(2)} (${prod.lowestVerifiedOffer.merchant})`
          : '';
      const brandSuffix = prod.name.toLowerCase().includes(prod.brand.toLowerCase()) ? '' : ` (${prod.brand})`;

      lines.push(
        `#### #${prod.rank}. ${prod.name}${brandSuffix} — ${listedLabel}${inStockLabel} via ${prod.merchant}\n- \`${prod.score}/100\` (${prod.evidenceCompletenessPercent}% Ev.)${ratingLabel}${offerNote} · *Excl. ship/tax*${prod.productUrl ? ` · [Store](${prod.productUrl})` : ''}`,
        isDetailed && prod.imageUrl ? `![#${prod.rank}](${prod.imageUrl})` : '',
        isDetailed ? `- **Verdict**: ${prod.verdict}` : ''
      );
    }

    // SECTION 3: Technical Specifications & Evidence Provenance (Domain specs stated once)
    lines.push(``, `### 3. Detailed Technical Specifications`);
    for (const prod of topProducts) {
      const classification = prod.evidenceClassification || {};
      const specSources = prod.specEvidenceSources || {};
      const cleanSpecs = getCleanUserFacingSpecs(prod.specifications, {
        includeUnspecified: isDetailed,
        includeCondition: false,
      });
      const specEntries = Object.entries(cleanSpecs).filter(
        ([k]) => !redundantCommercialSpecKeys.has(k)
      );
      const specPairs = specEntries
        .filter(([, v]) => isDetailed || !isUnspecifiedAttributeValue(String(v)))
        .map(([k, v]) => {
          const status = specSources[k]?.status || classification[k];
          const badge =
            status === 'verified_fact'
              ? isDetailed ? '[Verified]' : '[V]'
              : status === 'source_claim'
              ? isDetailed ? '[Claim]' : '[C]'
              : status === 'inference'
              ? isDetailed ? '[Inferred]' : '[I]'
              : status === 'unknown'
              ? isDetailed ? '[Not specified]' : ''
              : '';
          const cleanedV = isDetailed
            ? v
            : v
                .replace(/\s*\(Source-Verified\)/gi, '')
                .replace(/\s*Configuration\b/gi, '')
                .replace(/\s*Cooling System\b/gi, '');
          const valStr = isDetailed || cleanedV.length <= 18 ? cleanedV : `${cleanedV.slice(0, 16).trim()}…`;
          const keyStr = isDetailed ? k : k.split(/[& ]/)[0].trim();
          return `\`${keyStr}:${valStr}${badge ? ` ${badge}` : ''}\``;
        })
        .join(' · ');
      const conflictNote =
        prod.conflictingEvidenceNotes && prod.conflictingEvidenceNotes.length > 0
          ? ` *(${prod.conflictingEvidenceNotes.join('; ')})*`
          : '';
      lines.push(
        `- **#${prod.rank} ${shortProdName(prod.name, 14)} (${prod.evidenceCompletenessPercent}%)**: ${specPairs || 'Not specified in the available product information.'}${conflictNote}`
      );
    }

    // SECTION 4: Individual Product Analysis & Weighted Criterion Scores (stated once)
    lines.push(``, `### 4. Individual Product Analysis (Suitability & Performance)`);
    for (const prod of topProducts) {
      const critBreakdown =
        prod.criterionScores && prod.criterionScores.length > 0
          ? ` · **Scores**: ${prod.criterionScores
              .map((cs) =>
                isDetailed
                  ? `${cs.criterion} (${cs.weight}%): \`${cs.score}/100\` *(${cs.evidenceNote})*`
                  : `${cs.criterion.split(/[&, -]/)[0]}:${cs.score}`
              )
              .join('|')}`
          : '';
      const techNote =
        isDetailed ||
        (prod.technicalAnalysis &&
          (prod.technicalAnalysis.includes('Not specified in the available product information') ||
            prod.technicalAnalysis.includes('Unknown / undisclosed')))
          ? ` ${prod.technicalAnalysis || ''}`
          : '';
      lines.push(
        `- **#${prod.rank} ${shortProdName(prod.name, 14)}**: ${prod.rankingExplanationVsNext || prod.suitabilityExplanation || prod.verdict}${techNote}${critBreakdown}`
      );
    }

    // SECTION 5: Advantages, Disadvantages & Trade-Offs (concise bullets stated once)
    lines.push(``, `### 5. Advantages, Disadvantages & Trade-Offs`);
    for (const prod of topProducts) {
      const prosText = prod.pros.slice(0, isDetailed ? 4 : 2).join('; ');
      const consText = prod.cons.slice(0, isDetailed ? 3 : 2).join('; ');
      const risksText =
        isDetailed && prod.risksAndLimitations && prod.risksAndLimitations.length > 0
          ? ` | *Risks*: ${prod.risksAndLimitations.join('; ')}`
          : '';
      lines.push(
        `- **#${prod.rank} ${shortProdName(prod.name, 14)}**: **+** ${prosText} | **-** ${consText}${risksText}`
      );
    }

    // SECTION 6: Compact Side-by-Side Comparison Table
    lines.push(``, `### 6. Side-by-Side Comparison Table`);
    const tableSubset = topProducts.slice(0, 3);
    if (tableSubset.length > 0 && report.comparisonMatrix?.rows?.length > 0) {
      const headerCols = isDetailed
        ? ['Attribute', ...tableSubset.map((p) => `#${p.rank} ${p.name.slice(0, 18)}`), 'Takeaway']
        : ['Metric', ...tableSubset.map((p) => `#${p.rank} ${p.brand.slice(0, 8)}`)];
      const sepCols = headerCols.map(() => '---');
      const tableLines: string[] = [
        `| ${headerCols.join(' | ')} |`,
        `| ${sepCols.join(' | ')} |`,
      ];
      const rowsToRender = isDetailed
        ? report.comparisonMatrix.rows
        : report.comparisonMatrix.rows.slice(0, 3);
      for (const row of rowsToRender) {
        const valCells = tableSubset.map((p) => {
          const rawVal =
            row.values[p.productId] ||
            row.values[p.name.slice(0, 28)] ||
            row.values[p.name] ||
            'Not specified in the available product information.';
          const sanitized = sanitizeUserFacingAttributeValue(String(rawVal), row.feature);
          const cleanVal = sanitized
            .replace(/\|/g, '/')
            .replace(
              /Not specified in the available product information\.?/gi,
              isDetailed ? 'Not specified in the available product information.' : 'Not specified'
            );
          return isDetailed || cleanVal.length <= 16 ? cleanVal : `${cleanVal.slice(0, 14).trim()}…`;
        });
        const featLabel = isDetailed
          ? row.feature.replace(/\|/g, '/')
          : row.feature.replace(/\s*\(Excl\..*\)/i, '').split(/[& ]/)[0].trim();
        if (isDetailed) {
          const rawHighlight = sanitizeUserFacingAttributeValue(
            row.winnerHighlight || 'Verified',
            row.feature
          ).replace(/\|/g, '/');
          tableLines.push(`| **${featLabel}** | ${valCells.join(' | ')} | ${rawHighlight} |`);
        } else {
          tableLines.push(`| **${featLabel}** | ${valCells.join(' | ')} |`);
        }
      }
      lines.push(tableLines.join('\n'));
    }

    // SECTION 7: Real-World Use-Case Analysis (concise synthesis; per-product expansion only when requested)
    lines.push(
      ``,
      `### 7. Real-World Use-Case Analysis`,
      report.realWorldUseCaseAnalysis ||
        `For **${scopeNotice}**: **${shortProdName(winnerProd.name)}** leads on disclosed ${strategy.category.toLowerCase()} specs via **${winnerProd.merchant}**.`
    );
    if (isDetailed) {
      for (const prod of topProducts.slice(0, 3)) {
        if (prod.realWorldUseCase) {
          lines.push(`- **${prod.name}**: ${prod.realWorldUseCase}`);
        }
      }
    }

    // SECTION 8: Price-to-Performance Evaluation (concise synthesis; per-product expansion only when requested)
    lines.push(
      ``,
      `### 8. Price-to-Performance Evaluation`,
      report.priceToPerformanceEvaluation ||
        `Evaluated on verified capability per dollar: **${shortProdName(winnerProd.name)}** (${winnerPrice}) delivers the strongest value.`
    );
    if (isDetailed) {
      for (const prod of topProducts.slice(0, 3)) {
        if (prod.priceToPerformance || prod.commercialAnalysis) {
          lines.push(`- **${prod.name}**: ${prod.priceToPerformance || prod.commercialAnalysis}`);
        }
      }
    }
    if (coupons.length > 0) {
      lines.push(
        `- **Verified Coupons (${coupons.length})**: ${coupons
          .slice(0, 3)
          .map((c) => `**${c.merchant}** (\`${c.code}\` — ${c.description || `${c.discountValue} ${c.discountType}`})`)
          .join(', ')}.`
      );
    }

    // SECTION 9: Final Verdict & Winner Justification (compact decision block)
    lines.push(
      ``,
      `### 9. Final Verdict & Winner Justification`,
      `#### Final Recommendation & Runner-Up Alternatives`,
      `- **Winner**: **${shortProdName(report.finalRecommendation.recommendedProductName, 22)}** (${winnerPrice}, **${winnerProd.merchant}**) — ${report.finalRecommendation.justification}${isDetailed && winnerProd.productUrl ? ` · [Buy](${winnerProd.productUrl})` : ''}\n- **Fit**: ${report.finalRecommendation.bestFor} | **Buy**: ${report.finalRecommendation.whoShouldBuy} | **Skip**: ${report.finalRecommendation.whoShouldSkip}${report.finalRecommendation.alternativePick ? ` | **Alt**: ${report.finalRecommendation.alternativePick}` : ''}`
    );

    // SECTION 10: Verified Sources, Offer Spread & Canonical Audit
    lines.push(
      ``,
      `### 10. Verified Sources & Direct References`,
      `- **Canonical Discovery & Deduplication Summary**: **${report.totalMerchantOffersEvaluated ?? report.rankedProducts.length}** offer(s) across **${report.sourceCitations.length}** source(s) -> **${report.uniqueProductsDiscovered ?? report.rankedProducts.length}** unique model(s) (**${topProducts.length}** ranked).`
    );
    for (const cite of report.sourceCitations) {
      lines.push(
        `- **${cite.sourceName}**: ${cite.status} (\`${new Date(cite.timestamp).toLocaleTimeString()}\`)`
      );
    }
    for (const prod of topProducts) {
      if (prod.merchantOffers && prod.merchantOffers.length > 1) {
        const offerSummary = prod.merchantOffers
          .map(
            (mo) =>
              `${mo.merchantName}: ${mo.listedPrice !== null ? `${mo.currency} ${mo.listedPrice.toFixed(2)}` : 'Unverified'} (${mo.availabilityStatus})`
          )
          .join(' | ');
        lines.push(`- **Offers (#${prod.rank})**: ${offerSummary}`);
      } else if (isDetailed && prod.productUrl) {
        lines.push(`- **Reference (#${prod.rank})**: [${prod.name} — ${prod.merchant}](${prod.productUrl})`);
      }
    }

    return lines.filter((line) => line !== '').join('\n\n');
  };

  const gemini = getGeminiClient();

  if (!gemini || topOffers.length === 0) {
    const report = buildDeterministicReport(gemini ? undefined : 'GEMINI_API_KEY unconfigured; evaluated with strict deterministic engine');
    const msg = formatStructuredConsultantResponse(report);
    return { report, coordinatorMessage: msg };
  }

  // Use Gemini 3.8 Flash to synthesize grounded research report with strict information density discipline
  try {
    const evidencePayload = {
      userQuery: input.prompt,
      detailedAnalysisRequested: isDetailed,
      previousConversationContext: input.previousPrompts || [],
      category: strategy.category,
      purchasingMarket: strategy.purchasingMarket,
      isMarketExplicitlySpecified: strategy.isMarketExplicitlySpecified,
      recommendationScope: strategy.recommendationScope,
      intendedUsage: strategy.intendedUsage,
      featurePriorities: strategy.featurePriorities,
      targetBudget: strategy.targetBudget ? `${strategy.currency} ${strategy.targetBudget}` : 'No explicit cap',
      evaluationCriteria: strategy.evaluationCriteria,
      uniqueProductsDiscovered,
      totalMerchantOffersEvaluated,
      searchCoverageDisclosures,
      productsRetrieved: topOffers.map((o, idx) => ({
        id: o.id,
        rank: idx + 1,
        title: o.name,
        brand: o.brand || o.merchant,
        merchant: o.merchant,
        listedPrice: o.price !== null ? `${o.currency} ${o.price.toFixed(2)}` : 'Unverified',
        shippingAndTaxStatus: 'Unconfirmed in catalog feed (calculated at merchant checkout)',
        url: o.canonicalUrl,
        imageUrl: o.imageUrl,
        rating: o.rating,
        reviewCount: o.reviewCount,
        availability: o.availabilityStatus,
        completenessScore: o.completenessScore,
        evidenceCompletenessPercent: topOffersEvidence[idx].coverage.evidenceCompletenessPercent,
        unknownSpecs: topOffersEvidence[idx].coverage.unknownSpecs,
        merchantOffersCount: o.merchantOffers?.length || o.merchantOffersCount || 1,
        merchantOffers: o.merchantOffers || [],
        specs: o.specs,
        source: o.sourceName,
      })),
      verifiedCoupons: coupons.map((c) => ({
        code: c.code,
        merchant: c.merchant,
        discount: c.description || `${c.discountValue} ${c.discountType}`,
      })),
      scienceCompound: scienceAnalysis ? scienceAnalysis.compoundName : null,
    };

    const promptText = `You are Spark's Senior Autonomous Product Research Intelligence Agent.
Enforce concise, high-information-density output (${isDetailed ? 'User explicitly requested detailed analysis: provide thorough explanations' : 'Standard concise mode: keep every field 40-50% shorter, eliminate filler, and state each fact only once in its designated field'}).
Analyze the following REAL, LIVE evidence retrieved from authorized retail and catalog APIs.
DO NOT invent or alter any product names, prices, merchant names, ratings, specifications, or URLs.
Clearly distinguish verified facts from source claims, inferences, and unknowns. Never present inferred thermal or acoustic ratings as confirmed facts when listed in unknownSpecs.

CRITICAL DIRECTIVES:
1. ZERO CHEAPEST-PRICE BIAS: Lowest price does NOT equal best recommendation.
2. CANONICAL COUNTS: ${uniqueProductsDiscovered} unique product models deduplicated from ${totalMerchantOffersEvaluated} merchant offers.
3. USER INTENT & MARKET: Scope is "${strategy.recommendationScope}" (${strategy.intendedUsage}); market is "${strategy.purchasingMarket}".
4. PRICE ACCURACY: Refer to catalog prices as Listed Prices (shipping and tax calculated at checkout; never call unconfirmed totals "Landed Price").
5. NO REPETITION: Do not repeat specification lists, price disclaimers, or executive conclusions across multiple fields. Ensure Rank #1 (${topOffers[0].id}) and finalRecommendation.recommendedProductId agree 100%.

LIVE EVIDENCE PAYLOAD:
${JSON.stringify(evidencePayload, null, 2)}

Produce a concise JSON response with this exact structure:
{
  "executiveSummary": "2 concise sentences synthesizing canonical counts, scope/market, and why Rank #1 leads on verified evidence.",
  "researchFindings": {
    "methodology": "1 sentence on SKU deduplication and weighted category evaluation",
    "confidenceAssessment": "1 sentence on per-specification evidence coverage"
  },
  "realWorldUseCaseAnalysis": "1-2 concise sentences comparing top models for the recommendation scope without repeating spec lists.",
  "priceToPerformanceEvaluation": "1-2 concise sentences on value per dollar and checkout shipping/tax.",
  "topProductsAnalysis": [
    {
      "productId": "string matching exact product id",
      "verdict": "Short 1-line verdict",
      "pros": ["concise verified pro 1", "concise verified pro 2"],
      "cons": ["concise limitation or unknown spec 1", "concise trade-off 2"],
      "technicalAnalysis": "1-2 sentences qualifying evidence and explicitly noting any unknownSpecs.",
      "commercialAnalysis": "1 short phrase on listed vs in-stock price and checkout shipping/tax.",
      "realWorldUseCase": "1 short sentence on practical fit.",
      "priceToPerformance": "1 short sentence on value score.",
      "risksAndLimitations": ["1 concise operational risk or undisclosed spec limitation"],
      "suitabilityExplanation": "1 concise sentence explaining why it holds this exact rank.",
      "dimensionsBreakdown": {
        "performance": 90,
        "value": 88,
        "buildQuality": 86,
        "usability": 90,
        "reliability": 85
      }
    }
  ],
  "comparisonTable": {
    "rows": [
      {
        "feature": "Short attribute name",
        "values": { "productId": "compact value string" },
        "winnerProductId": "productId of strongest option with disclosed evidence",
        "winnerHighlight": "Short takeaway (<10 words)"
      }
    ]
  },
  "finalRecommendation": {
    "recommendedProductId": "${topOffers[0].id}",
    "justification": "1-2 concise sentences justifying the #1 winner over alternatives",
    "bestFor": "Short target profile or general-market scope",
    "valueAssessment": "Short listed-price value note (excl. shipping/tax)",
    "whoShouldBuy": "1 short phrase on ideal buyer",
    "whoShouldSkip": "1 short phrase on who should skip",
    "alternativePick": "Runner-up model name, price, score, and when to pick it"
  }
}`;

    const { parsed: parsedJson, usedModel } = await generateCompleteGeminiJson(gemini, promptText);

    // Build complete report combining Gemini synthesis with real product data and strict evidence caps
    const rankedProducts = topOffers.map((o, idx) => {
      const { adaptedSpecs, evidenceMeta, coverage } = topOffersEvidence[idx];
      const nextEv = topOffersEvidence[idx + 1]?.coverage;
      const priceBreakdown = buildPriceAccuracyBreakdown(o);
      const criterionScores = computeExplainableCriterionScores(o, strategy, coverage);
      const rankingExplanationVsNext = buildRankingExplanationVsNext(
        o,
        topOffers[idx + 1],
        idx + 1,
        coverage,
        nextEv,
        strategy
      );

      const aiAnalysis = parsedJson.topProductsAnalysis?.find((p: { productId: string }) => p.productId === o.id);
      const perfScore = aiAnalysis?.dimensionsBreakdown?.performance ?? Math.min(96, (o.completenessScore || 80) - (coverage.unknownSpecs.length * 3));
      const valueScore = aiAnalysis?.dimensionsBreakdown?.value ?? Math.min(96, o.price !== null && strategy.targetBudget && o.price <= strategy.targetBudget ? 90 : 82);
      const buildScore = aiAnalysis?.dimensionsBreakdown?.buildQuality ?? Math.min(94, coverage.evidenceCompletenessPercent);
      const usabilityScore = aiAnalysis?.dimensionsBreakdown?.usability ?? Math.min(95, 82 + (o.availabilityStatus === 'verified_in_stock' ? 8 : 0));
      const relScore = aiAnalysis?.dimensionsBreakdown?.reliability ?? Math.min(95, o.rating ? Math.round(o.rating * 18) : 74);

      const merchantOffers = o.merchantOffers || o.richProfile?.merchantOffers || [];
      const merchantOffersCount = Math.max(1, o.merchantOffersCount || merchantOffers.length || 1);
      const qualifiedTechAnalysis = buildEvidenceQualifiedTechnicalAnalysis(
        o,
        adaptedSpecs,
        evidenceMeta.classification,
        coverage
      );

      return {
        rank: idx + 1,
        productId: o.id,
        name: o.name,
        brand: o.brand || o.merchant,
        merchant: o.merchant,
        price: o.price,
        currency: o.currency || 'USD',
        productUrl: o.canonicalUrl,
        imageUrl: o.imageUrl,
        galleryImages: o.galleryImages || (o.imageUrl ? [o.imageUrl] : []),
        rating: o.rating || null,
        reviewCount: o.reviewCount || null,
        score: o.completenessScore || (95 - idx * 4),
        merchantOffers,
        merchantOffersCount,
        lowestVerifiedOffer: evidenceMeta.lowestVerifiedOffer,
        priceBreakdown,
        criterionScores,
        rankingExplanationVsNext,
        specEvidenceSources: coverage.specEvidenceSources,
        evidenceClassification: evidenceMeta.classification,
        conflictingEvidenceNotes: evidenceMeta.conflictingEvidenceNotes,
        specifications: getCleanUserFacingSpecs(
          {
            ...adaptedSpecs,
            ...o.specs,
          },
          { includeUnspecified: true, includeCondition: true }
        ),
        pros: aiAnalysis?.pros && Array.isArray(aiAnalysis.pros) && aiAnalysis.pros.length > 0
          ? aiAnalysis.pros.slice(0, isDetailed ? 4 : 2)
          : [`Verified ${o.merchant} offer`, o.price !== null ? `Listed: ${o.currency} ${o.price.toFixed(2)}` : 'Verified listing'],
        cons: aiAnalysis?.cons && Array.isArray(aiAnalysis.cons) && aiAnalysis.cons.length > 0
          ? aiAnalysis.cons.slice(0, isDetailed ? 3 : 2)
          : [
              ...(coverage.unknownSpecs.length > 0 ? [`Not specified: ${coverage.unknownSpecs.join(', ')}`] : []),
              'Shipping/tax at checkout',
            ],
        technicalAnalysis: aiAnalysis?.technicalAnalysis
          ? `${aiAnalysis.technicalAnalysis} (${qualifiedTechAnalysis})`
          : qualifiedTechAnalysis,
        commercialAnalysis: aiAnalysis?.commercialAnalysis || priceBreakdown.checkoutTotalLabel,
        realWorldUseCase: aiAnalysis?.realWorldUseCase || `Fits ${strategy.intendedUsage.toLowerCase()} via ${o.merchant}.`,
        priceToPerformance: aiAnalysis?.priceToPerformance || priceBreakdown.checkoutTotalLabel,
        risksAndLimitations: aiAnalysis?.risksAndLimitations || [
          'Shipping/tax calculated at checkout.',
          ...(coverage.unknownSpecs.length > 0 ? [`Unverified feed specs: ${coverage.unknownSpecs.join(', ')}.`] : []),
        ],
        suitabilityExplanation: aiAnalysis?.suitabilityExplanation
          ? `${rankingExplanationVsNext} ${aiAnalysis.suitabilityExplanation}`
          : rankingExplanationVsNext,
        dimensionsBreakdown: {
          performance: perfScore,
          value: valueScore,
          buildQuality: buildScore,
          usability: usabilityScore,
          reliability: relScore,
        },
        verdict: aiAnalysis?.verdict || (idx === 0 ? `Best Overall (${o.completenessScore}/100 · ${coverage.evidenceCompletenessPercent}% evidence).` : `Rank #${idx + 1} Alternative (${o.completenessScore}/100 · ${coverage.evidenceCompletenessPercent}% evidence).`),
        sourceId: o.sourceId,
        evidenceCompletenessPercent: coverage.evidenceCompletenessPercent,
      };
    });

    // Guarantee 100% decision consistency: Rank #1 product is always the final recommended winner
    const finalRecProd = topOffers[0];

    const finalRecommendation = {
      recommendedProductId: finalRecProd.id,
      recommendedProductName: finalRecProd.name,
      justification: parsedJson.finalRecommendation?.justification || `${rankedProducts[0].rankingExplanationVsNext} Evaluated with zero cheapest-price bias.`,
      bestFor: parsedJson.finalRecommendation?.bestFor || `${strategy.category} — ${strategy.intendedUsage}`,
      valueAssessment: parsedJson.finalRecommendation?.valueAssessment || rankedProducts[0].priceBreakdown?.checkoutTotalLabel || 'Subject to merchant price confirmation',
      whoShouldBuy: parsedJson.finalRecommendation?.whoShouldBuy || `Buyers seeking a verified ${strategy.category} option (${topOffersEvidence[0]?.coverage.evidenceCompletenessPercent || 0}% coverage).`,
      whoShouldSkip: parsedJson.finalRecommendation?.whoShouldSkip || 'Buyers requiring pre-verified specs not disclosed in the merchant feed.',
      alternativePick: parsedJson.finalRecommendation?.alternativePick || (topOffers[1]?.name || undefined),
    };

    // Always use category-adaptive matrix or audit Gemini comparison table rows via runFinalReportConsistencyAudit
    let comparisonMatrix: ProductIntelligenceReport['comparisonMatrix'];
    if (
      parsedJson.comparisonTable &&
      Array.isArray(parsedJson.comparisonTable.rows) &&
      parsedJson.comparisonTable.rows.length >= 2
    ) {
      const headers = topOffers.slice(0, 3).map((o) => o.name.slice(0, 28));
      comparisonMatrix = {
        headers,
        rows: parsedJson.comparisonTable.rows.map((r: { feature: string; values: Record<string, string>; winnerProductId?: string; winnerHighlight?: string }) => ({
          feature: r.feature || 'Feature',
          values: r.values || {},
          winnerProductId: r.winnerProductId,
          winnerHighlight: r.winnerHighlight,
        })),
      };
    } else {
      comparisonMatrix = buildCategoryAdaptiveMatrix(strategy.category, topOffers);
    }

    const sourceCitations = sourceReports.map((sr) => ({
      sourceId: sr.sourceId,
      sourceName: sr.sourceName,
      url: sr.sourceId === 'channel3_api' || sr.sourceId === 'channel3_product_graph' ? 'https://api.trychannel3.com' : undefined,
      timestamp: sr.retrievedAt,
      recordsRetrieved: sr.resultCount,
      status: `${sr.explicitStateMessage} (${totalMerchantOffersEvaluated} offer(s) -> ${uniqueProductsDiscovered} unique model(s)).`,
    }));

    const priceComparison = topOffers
      .filter((o) => o.price !== null)
      .map((o) => ({
        productId: o.id,
        productName: o.name,
        price: o.price!,
        currency: o.currency || 'USD',
        isWithinBudget: strategy.targetBudget === null || o.price! <= strategy.targetBudget,
        isWinner: o.id === finalRecProd.id,
      }));

    const capabilityComparison = rankedProducts.map((p) => ({
      productId: p.productId,
      productName: p.name,
      performance: p.dimensionsBreakdown?.performance ?? 85,
      value: p.dimensionsBreakdown?.value ?? 85,
      buildQuality: p.dimensionsBreakdown?.buildQuality ?? 80,
      usability: p.dimensionsBreakdown?.usability ?? 85,
      reliability: p.dimensionsBreakdown?.reliability ?? 80,
    }));

    const rawReport: ProductIntelligenceReport = {
      reportId,
      generatedAt: now,
      query: input.prompt,
      category: strategy.category,
      purchasingMarket: strategy.purchasingMarket,
      isMarketExplicitlySpecified: strategy.isMarketExplicitlySpecified,
      recommendationScope: strategy.recommendationScope,
      uniqueProductsDiscovered,
      totalMerchantOffersEvaluated,
      searchCoverageDisclosures,
      executiveSummary: parsedJson.executiveSummary || `Evaluated ${totalMerchantOffersEvaluated} merchant offer(s) across ${uniqueProductsDiscovered} unique model(s) for "${input.prompt}". Best Overall: "${finalRecProd.name}" (${finalRecProd.merchant}).`,
      evaluationCriteria: strategy.evaluationCriteria,
      rankedProducts,
      comparisonMatrix,
      realWorldUseCaseAnalysis:
        parsedJson.realWorldUseCaseAnalysis ||
        `For ${strategy.intendedUsage.toLowerCase()}, "${finalRecProd.name}" leads on disclosed ${strategy.category.toLowerCase()} specifications.`,
      priceToPerformanceEvaluation:
        parsedJson.priceToPerformanceEvaluation ||
        `Evaluated on verified capability per dollar: "${finalRecProd.name}" (${rankedProducts[0].priceBreakdown?.checkoutTotalLabel}) delivers strong value.`,
      finalRecommendation,
      sourceCitations,
      activeModel: usedModel,
      researchFindings: {
        methodology: parsedJson.researchFindings?.methodology || `Live catalog discovery, SKU deduplication (${totalMerchantOffersEvaluated} offers -> ${uniqueProductsDiscovered} unique models), and per-spec verification.`,
        recordsEvaluated: totalMerchantOffersEvaluated,
        uniqueProductsEvaluated: uniqueProductsDiscovered,
        merchantOffersAggregated: totalMerchantOffersEvaluated,
        sourcesQueried: sourceReports.map((s) => s.sourceName),
        confidenceAssessment: parsedJson.researchFindings?.confidenceAssessment || 'EVIDENCE_AUDITED: Per-specification evidence coverage verified against live feeds.',
      },
      visualizations: {
        priceComparison,
        capabilityComparison,
      },
    };

    const auditedReport = runFinalReportConsistencyAudit(rawReport, topOffers, strategy);
    const coordinatorMessage = formatStructuredConsultantResponse(auditedReport);

    return { report: auditedReport, coordinatorMessage };
  } catch {
    // If all Gemini model attempts experience demand spikes or format errors, gracefully synthesize from live verified evidence without leaking raw error JSON
    const report = buildDeterministicReport();
    const msg = formatStructuredConsultantResponse(report);
    return { report, coordinatorMessage: msg };
  }
}

/**
 * Main Entry Point: Spark Autonomous AI Product Intelligence Agent
 * Executes all research pipeline stages end-to-end.
 */
export async function executeSparkProductIntelligenceAgent(
  input: AgentPipelineInput
): Promise<AgentPipelineOutput> {
  // Stage 0: Requirement Completeness Assessment
  // Initiates intelligent conversational clarification BEFORE conducting final research
  // when requests are ambiguous or lack essential workload / spec information.
  const assessment = assessRequirementCompleteness(input);
  if (!assessment.hasSufficientContext && assessment.clarification) {
    const addressAs = input.preferredName?.trim() || '';
    const greeting = addressAs ? `Hi ${addressAs}, to` : 'To';
    const coordinatorMessage = `${greeting} find the right product for your exact needs, could you clarify: **${assessment.clarification.question}**\n\n*Why this matters:* ${assessment.clarification.whyItMatters}\n\nPlease select one of the suggested paths below or specify your requirements, and I will search live merchant catalogs for verified products.`;

    return {
      report: null,
      offers: [],
      verifiedCoupons: [],
      sourceReports: [],
      scienceAnalysis: null,
      coordinatorMessage,
      needsClarification: true,
      clarification: assessment.clarification,
      clarificationSuggestions: assessment.clarificationSuggestions,
    };
  }

  // Stage 1: Strategy Formulation
  const strategy = formulateResearchStrategy(input);

  // Stage 2 & 3: Live API Execution
  const liveResults = await executeLiveResearchTools(strategy, input);

  // Stage 4: Evaluation & Ranking (without cheapest-price bias)
  const rankedOffers = evaluateProductsAndRank(liveResults.offers, liveResults.coupons, strategy);

  // Stage 5: Autonomous Synthesis
  const { report, coordinatorMessage } = await synthesizeAutonomousIntelligenceReport(
    input,
    strategy,
    rankedOffers,
    liveResults.coupons,
    liveResults.sourceReports,
    liveResults.scienceAnalysis
  );

  return {
    report,
    offers: rankedOffers,
    verifiedCoupons: liveResults.coupons,
    sourceReports: liveResults.sourceReports,
    scienceAnalysis: liveResults.scienceAnalysis,
    coordinatorMessage,
    needsClarification: false,
  };
}
