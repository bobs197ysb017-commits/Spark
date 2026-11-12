/**
 * SPARK — Clean Product Intelligence Output & Internal Metadata Separation
 *
 * Strictly separates internal catalog/provenance/checkout metadata (Channel3 IDs,
 * merchant offer IDs, raw feed conditions, commission rates, etc.) from user-facing
 * product intelligence reports, cards, and comparison tables.
 */

export const INTERNAL_METADATA_SPEC_KEYS = new Set<string>([
  'Source ID',
  'Channel3 Product ID',
  'Channel3 Offer ID',
  'Merchant Offer ID',
  'Offer ID',
  'Merchant Domain',
  'Merchant Product URL',
  'Raw Channel3 Condition',
  'Catalog API',
  'Source Provider',
  'Max Commission Rate',
  'Direct Checkout',
  'Price Verification',
  'Availability Status',
  'Shipping & Tax',
  'Shipping & Tax Status',
  'Merchant Offer',
  'Merchant Source',
  'Lowest Listed Price',
  'Lowest In-Stock Price',
  'Stock Availability',
  'Availability',
  'Primary Genre',
  'Compare At Price',
]);

export const MODEL_IDENTIFIER_SPEC_KEYS = new Set<string>([
  'Manufacturer Model Number',
  'Manufacturer SKU',
  'Model Number',
  'MPN',
  'SKU',
  'Model / SKU Identifier',
  'GTIN',
  'UPC',
  'EAN',
]);

/**
 * Checks whether a specification key is an internal technical/provenance field
 * that must never be displayed in user-facing product evaluations.
 */
export function isInternalMetadataSpecKey(key: string, value?: string): boolean {
  const trimmedKey = key.trim();
  if (INTERNAL_METADATA_SPEC_KEYS.has(trimmedKey)) {
    return true;
  }
  if (/^(?:source\s*id|channel3|merchant\s*offer\s*id|merchant\s*domain|raw\s*channel3|catalog\s*api|max\s*commission)/i.test(trimmedKey)) {
    return true;
  }
  if (MODEL_IDENTIFIER_SPEC_KEYS.has(trimmedKey)) {
    if (!value) return true;
    const v = String(value).trim();
    if (
      !v ||
      /^(?:unknown|unverified|none|n\/a|undisclosed)$/i.test(v) ||
      /manufacturer\s+sku:\s*unknown/i.test(v) ||
      /not\s+disclosed|not\s+specified|unavailable/i.test(v)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Transforms raw feed strings and placeholder labels into natural, concise,
 * user-friendly product analysis statements without inventing missing facts.
 */
export function sanitizeUserFacingAttributeValue(rawValue: string, key?: string): string {
  const trimmed = String(rawValue || '').trim();
  if (!trimmed) {
    return 'Not specified in the available product information.';
  }

  // 1. Never expose malformed "cushioning Midsole Cushioning"
  if (/^cushion(?:ing)?\s+midsole\s+cushioning$/i.test(trimmed)) {
    return 'Not specified in the available product information.';
  }

  // 2. Transform "Road Running Outsole" -> "Designed for road running"
  if (/^road\s+running\s+outsole$/i.test(trimmed)) {
    return 'Designed for road running';
  }
  if (/^trail\s+lugged\s+outsole(?:\s*\(source-verified\))?$/i.test(trimmed)) {
    return 'Designed for trail running';
  }

  // 3. Transform "Standard Athletic Upper (material not disclosed in feed)" -> "Upper material not specified."
  if (/^standard\s+athletic\s+upper\s*\(material\s+not\s+disclosed\s+in\s+(?:merchant\s+)?feed\)$/i.test(trimmed)) {
    return 'Upper material not specified.';
  }
  if (/^ergonomic\s+seating\s+frame\s*\(upholstery\s+material\s+not\s+disclosed\s+in\s+(?:merchant\s+)?feed\)$/i.test(trimmed)) {
    return 'Upholstery material not specified.';
  }

  // 4. Transform "Not disclosed in merchant feed" and variants -> "Not specified in the available product information."
  if (/^not\s+disclosed\s+in\s+merchant\s+feed(?:\s*\([^)]*\))?(?:\s*—.*)?$/i.test(trimmed)) {
    return 'Not specified in the available product information.';
  }

  // 5. Transform inline feed jargon inside composite strings
  let cleaned = trimmed
    .replace(/\bcushion(?:ing)?\s+Midsole\s+Cushioning\b/gi, 'Not specified in the available product information.')
    .replace(/\bNot\s+disclosed\s+in\s+merchant\s+feed(?:\s*\([^)]*\))?/gi, 'Not specified in the available product information.')
    .replace(/\bStandard\s+Athletic\s+Upper\s*\(material\s+not\s+disclosed\s+in\s+feed\)/gi, 'Upper material not specified.')
    .replace(/\bRoad\s+Running\s+Outsole\b/gi, 'Designed for road running')
    .replace(/\s*\(exact\s+([^)]*?)\s+not\s+disclosed\s+in\s+(?:merchant\s+)?feed\)/gi, ' (exact $1 not specified)')
    .replace(/\s*\(no\s+discrete\s+VRAM\s+disclosed\s+in\s+feed\)/gi, ' (discrete VRAM not specified)')
    .replace(/\s*\[Architecture\s+Claim\]/gi, '')
    .replace(/\s*\(Source-Verified\)/gi, '')
    .replace(/\s*listed\s+on\s+([^.]+?)\s+via\s+Channel3\s+Product\s+Graph\.?/gi, ' available from $1.')
    .replace(/\s*via\s+Channel3\s+(?:Live\s+)?Product\s+Graph(?:\s+API)?/gi, '')
    .trim();

  if (key && MODEL_IDENTIFIER_SPEC_KEYS.has(key) && /unknown|not\s+specified/i.test(cleaned)) {
    return 'Not specified in the available product information.';
  }

  return cleaned || 'Not specified in the available product information.';
}

/**
 * Determines whether a sanitized attribute value represents missing/unspecified information.
 */
export function isUnspecifiedAttributeValue(value: string): boolean {
  const s = String(value || '').trim();
  if (!s) return true;
  return (
    /not\s+specified\s+in\s+the\s+available\s+product\s+information/i.test(s) ||
    /not\s+disclosed\s+in\s+(?:merchant\s+)?feed/i.test(s) ||
    /upper\s+material\s+not\s+specified/i.test(s) ||
    /upholstery\s+material\s+not\s+specified/i.test(s) ||
    /cushioning\s+specifications\s+are\s+unavailable/i.test(s) ||
    /^(?:unknown|unverified|undisclosed|unavailable|none|n\/a|—|-)$/i.test(s) ||
    /manufacturer\s+sku:\s*unknown/i.test(s)
  );
}

/**
 * Returns a clean dictionary of user-facing product specifications with all internal
 * Channel3 / API / offer metadata removed and all values translated into natural language.
 *
 * @param specs Raw specifications map (e.g., `offer.specs` or `prod.specifications`)
 * @param options.includeUnspecified Whether to keep category attributes whose value is unspecified (default: true for full spec analysis, false for compact card badges)
 */
export function getCleanUserFacingSpecs(
  specs: Record<string, string> | undefined | null,
  options?: { includeUnspecified?: boolean; includeCondition?: boolean }
): Record<string, string> {
  if (!specs || typeof specs !== 'object') return {};
  const includeUnspecified = options?.includeUnspecified ?? true;
  const includeCondition = options?.includeCondition ?? false;
  const result: Record<string, string> = {};

  for (const [rawKey, rawVal] of Object.entries(specs)) {
    const key = rawKey.trim();
    if (!key) continue;
    if (key === 'Condition' && !includeCondition) continue;
    if (key === 'Brand') continue;
    if (isInternalMetadataSpecKey(key, rawVal)) continue;

    const sanitizedVal = sanitizeUserFacingAttributeValue(rawVal, key);

    // Never expose raw internal IDs in values (e.g. ch3_..., channel3_api)
    if (/\b(?:channel3_api|openlibrary_api|ch3_[a-zA-Z0-9_]+)\b/i.test(sanitizedVal)) {
      continue;
    }

    if (!includeUnspecified && isUnspecifiedAttributeValue(sanitizedVal)) {
      continue;
    }

    result[key] = sanitizedVal;
  }

  return result;
}
