import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PayPalSandboxEngine, SPARK_SANDBOX_TEST_CATALOG } from './paypalSandboxService';
import type { RankedProductOffer } from '../types/spark';

function createTestOffer(overrides: Partial<RankedProductOffer> = {}): RankedProductOffer {
  const effectivePrice = overrides.price !== undefined ? overrides.price : 348.0;
  return {
    id: overrides.id || overrides.productId || 'ch3_offer_sony_xm5',
    productId: overrides.productId || overrides.id || 'ch3_prod_sony_xm5',
    name: overrides.name || 'Sony WH-1000XM5 Wireless Noise-Canceling Headphones',
    brand: overrides.brand || 'Sony',
    category: overrides.category || 'Audio & Headphones',
    description: overrides.description || 'Flagship active noise-canceling wireless headphones.',
    summary: overrides.summary || 'Flagship active noise-canceling wireless headphones.',
    price: effectivePrice,
    currency: overrides.currency || 'USD',
    priceStatus: overrides.priceStatus || 'verified',
    availabilityStatus: overrides.availabilityStatus || 'verified_in_stock',
    shippingText: overrides.shippingText ?? '$0.00 Free Verified Shipping',
    shippingCost: overrides.shippingCost !== undefined ? overrides.shippingCost : 0,
    shippingStatus: overrides.shippingStatus || 'verified',
    estimatedTaxRate: overrides.estimatedTaxRate !== undefined ? overrides.estimatedTaxRate : null,
    taxStatus: overrides.taxStatus || 'unknown',
    merchant: overrides.merchant || 'B&H Photo Video',
    rating: 4.8,
    reviewCount: 1420,
    ratingStatus: 'verified',
    imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600',
    canonicalUrl: 'https://www.bhphotovideo.com/c/product/sony-wh1000xm5',
    sourceUrl: 'https://www.bhphotovideo.com/c/product/sony-wh1000xm5',
    sourceType: overrides.sourceType || 'channel3_api',
    sourceId: overrides.sourceId || 'channel3_api',
    sourceName: overrides.sourceName || 'Channel3 Product Graph API',
    sourceLabel: 'Channel3 Product Graph API',
    retrievedAt: new Date().toISOString(),
    freshnessStatus: 'live',
    verified: true,
    verificationStatus: 'verified_live_source',
    verificationSummary: 'Live Channel3 product record',
    keySpecs: ['Color: Midnight Black', 'Edition: Standard Edition', 'Connectivity: Bluetooth 5.2'],
    specs: {
      Color: 'Midnight Black',
      Edition: 'Standard Edition',
      Category: overrides.category || 'Audio & Headphones',
      ...(overrides.specs || {}),
    },
    pros: ['Industry-leading ANC', '30-hour battery life'],
    cons: ['Non-folding earcups'],
    whyRecommended: 'Verified lowest price from authorized merchant.',
    valueScore: 95,
    trustScore: 98,
    relevanceScore: 96,
    overallScore: 96,
    bestCoupon: null,
    couponDiscountAmount: 0,
    netItemPrice: effectivePrice,
    withinBudget: true,
    completenessScore: 96,
    couponStatus: 'no_verified_coupon',
    checkoutStatus: 'supported_paypal',
    effectivePrice,
    savingsAmount: 0,
    hasVerifiedCoupon: false,
  };
}

describe('Spark Intelligent Cart System — Full-Stack Unit & Integration Suite', () => {
  let service: PayPalSandboxEngine;
  const userA = 'usr_alice_spark_01';
  const userB = 'usr_bob_spark_02';

  beforeEach(() => {
    service = new PayPalSandboxEngine();
  });

  describe('1. Cart Operations & Variant Identity', () => {
    it('adds a single verified product and computes authoritative breakdown', () => {
      const offer = createTestOffer({ price: 120.5, shippingCost: 5.25, shippingStatus: 'verified' });
      const res = service.addToCart({ userId: userA, product: offer, quantity: 1 });
      assert.equal(res.ok, true);
      assert.ok(res.cart);
      assert.equal(res.cart.userId, userA);
      assert.equal(res.cart.cartId, 'current');
      assert.equal(res.cart.items.length, 1);
      assert.equal(res.cart.itemCount, 1);
      assert.equal(res.cart.subtotal, 120.5);
      assert.equal(res.cart.shippingCost, 5.25);
      assert.equal(res.cart.estimatedTotal, 125.75);
      assert.equal(res.cart.canProceedToCheckout, true);
    });

    it('adds multiple distinct products and increments quantity when adding same product + variant', () => {
      const offer1 = createTestOffer({ id: 'offer_1', productId: 'prod_1', price: 50 });
      const offer2 = createTestOffer({ id: 'offer_2', productId: 'prod_2', name: 'Keychron Q1 Pro', price: 199 });

      service.addToCart({ userId: userA, product: offer1, quantity: 1, variantLabel: 'Midnight Black' });
      service.addToCart({ userId: userA, product: offer2, quantity: 2, variantLabel: 'Silver Grey' });
      const res = service.addToCart({
        userId: userA,
        product: offer1,
        quantity: 2,
        variantLabel: 'Midnight Black',
      });

      assert.equal(res.ok, true);
      assert.ok(res.cart);
      assert.equal(res.cart.items.length, 2);
      assert.equal(res.cart.itemCount, 5); // 3 of offer1 + 2 of offer2
      assert.equal(res.cart.subtotal, 3 * 50 + 2 * 199);
    });

    it('preserves different variants of the same product as separate cart items and merges when switched to matching variant', () => {
      const offer = createTestOffer({ id: 'offer_var', productId: 'prod_var', price: 100 });

      const addBlack = service.addToCart({
        userId: userA,
        product: offer,
        quantity: 1,
        variantLabel: 'Midnight Black',
        selectedOptions: { Color: 'Midnight Black' },
      });
      assert.equal(addBlack.cart?.items.length, 1);

      const addSilver = service.addToCart({
        userId: userA,
        product: offer,
        quantity: 2,
        variantLabel: 'Platinum Silver',
        selectedOptions: { Color: 'Platinum Silver' },
      });
      assert.equal(addSilver.cart?.items.length, 2);
      assert.equal(addSilver.cart?.itemCount, 3);

      // Update second item's variant to 'Midnight Black' -> should automatically merge quantities
      const silverItem = addSilver.cart!.items.find((i) => i.variantLabel === 'Platinum Silver')!;
      const merged = service.updateCartItemQuantity({
        userId: userA,
        itemId: silverItem.itemId,
        quantity: silverItem.quantity,
        variantLabel: 'Midnight Black',
        selectedOptions: { Color: 'Midnight Black' },
      });
      assert.equal(merged.ok, true);
      assert.equal(merged.cart?.items.length, 1);
      assert.equal(merged.cart?.items[0].variantLabel, 'Midnight Black');
      assert.equal(merged.cart?.items[0].quantity, 3);
    });

    it('updates item quantity, removes individual item, restores accidentally removed item, and clears cart', () => {
      const offer = createTestOffer({ price: 80 });
      const added = service.addToCart({ userId: userA, product: offer, quantity: 2 });
      const itemId = added.cart!.items[0].itemId;

      const updated = service.updateCartItemQuantity({ userId: userA, itemId, quantity: 4 });
      assert.equal(updated.ok, true);
      assert.equal(updated.cart?.itemCount, 4);
      assert.equal(updated.cart?.subtotal, 320);

      const removed = service.removeCartItem({ userId: userA, itemId });
      assert.equal(removed.ok, true);
      assert.equal(removed.cart?.items.length, 0);
      assert.ok(removed.cart?.lastRemovedItem);
      assert.equal(removed.cart?.lastRemovedItem?.itemId, itemId);

      // Restore accidentally removed item
      const restored = service.restoreLastRemovedCartItem(userA);
      assert.equal(restored.ok, true);
      assert.equal(restored.cart?.items.length, 1);
      assert.equal(restored.cart?.items[0].quantity, 4);
      assert.equal(restored.cart?.lastRemovedItem, null);

      // Clear entire cart
      const cleared = service.clearUserCart(userA);
      assert.equal(cleared.items.length, 0);
      assert.equal(cleared.subtotal, 0);
    });
  });

  describe('2. Multi-Device Sync, Concurrency Revision & User Ownership Isolation', () => {
    it('isolates carts strictly by userId and never leaks or merges items across accounts', () => {
      const offerA = createTestOffer({ id: 'offer_alice', productId: 'prod_alice', price: 110 });
      const offerB = createTestOffer({ id: 'offer_bob', productId: 'prod_bob', price: 240 });

      service.addToCart({ userId: userA, product: offerA, quantity: 1 });
      service.addToCart({ userId: userB, product: offerB, quantity: 2 });

      const cartA = service.getUserCart(userA);
      const cartB = service.getUserCart(userB);

      assert.equal(cartA.userId, userA);
      assert.equal(cartA.items.length, 1);
      assert.equal(cartA.items[0].productId, 'offer_alice');

      assert.equal(cartB.userId, userB);
      assert.equal(cartB.items.length, 1);
      assert.equal(cartB.items[0].productId, 'offer_bob');

      // Cross-user attempt to sync Bob's items into Alice's account strips Bob's items
      const crossSync = service.syncUserCartFromClient({
        userId: userA,
        revision: (cartA.revision || 1) + 5,
        items: cartB.items,
      });
      assert.equal(crossSync.ok, true);
      assert.equal(crossSync.cart.items.length, 0);
    });

    it('prevents stale client state from overwriting newer server state using monotonic revisions', () => {
      const offer = createTestOffer({ price: 95 });
      const rev1 = service.addToCart({ userId: userA, product: offer, quantity: 1 }).cart!;
      const rev2 = service.updateCartItemQuantity({
        userId: userA,
        itemId: rev1.items[0].itemId,
        quantity: 3,
      }).cart!;

      assert.ok((rev2.revision || 0) > (rev1.revision || 0));

      // Attempt to sync older rev1 snapshot over newer rev2 state
      const staleSync = service.syncUserCartFromClient({
        userId: userA,
        revision: rev1.revision || 1,
        items: rev1.items,
      });
      assert.equal(staleSync.ok, true);
      assert.equal(staleSync.staleRejected, true);
      // Server preserves rev2 quantity (3) rather than reverting to stale rev1 quantity (1)
      assert.equal(staleSync.cart.items[0].quantity, 3);
    });
  });

  describe('3. Channel3 Product Validation (Price Change, Out-of-Stock & Missing Price)', () => {
    it('detects live Channel3 price change, blocks checkout until user accepts, and unblocks after acceptance', async () => {
      const offer = createTestOffer({ id: 'ch3_live_1', productId: 'ch3_prod_live_1', price: 200 });
      const added = service.addToCart({ userId: userA, product: offer, quantity: 1 });
      const itemId = added.cart!.items[0].itemId;

      // Simulate Channel3 returning an updated price of $219.99
      const validation = await service.validateCartItems(userA, {
        channel3LookupFn: async () => ({
          price: 219.99,
          currency: 'USD',
          availability: 'in_stock',
          validationSource: 'channel3_api',
          statusMessage: 'Price updated on Channel3 live product graph.',
        }),
      });

      assert.equal(validation.canProceedToCheckout, false);
      assert.equal(validation.priceChangesDetected, 1);
      assert.equal(validation.cart.requiresPriceChangeReview, true);
      assert.equal(validation.cart.items[0].previousPrice, 200);
      assert.equal(validation.cart.items[0].unitPrice, 219.99);
      assert.equal(validation.cart.items[0].priceChanged, true);

      // Checkout preparation must block while price change is unaccepted
      const blockedPrep = await service.prepareCartCheckout(userA);
      assert.equal(blockedPrep.ok, false);
      assert.equal(blockedPrep.preparation.ready, false);
      assert.ok(blockedPrep.preparation.blockers.some((b) => /changed from/i.test(b)));

      // User reviews and accepts updated price
      const accepted = service.acceptCartPriceChanges({ userId: userA, itemId });
      assert.equal(accepted.ok, true);
      assert.equal(accepted.cart.requiresPriceChangeReview, false);
      assert.equal(accepted.cart.canProceedToCheckout, true);

      const readyPrep = await service.prepareCartCheckout(userA);
      assert.equal(readyPrep.ok, true);
      assert.equal(readyPrep.preparation.ready, true);
      assert.equal(readyPrep.preparation.cart.subtotal, 219.99);
    });

    it('detects out-of-stock transition, blocks checkout, and unblocks when unavailable items are removed', async () => {
      const offer1 = createTestOffer({ id: 'offer_in', productId: 'prod_in', price: 100 });
      const offer2 = createTestOffer({ id: 'offer_oos', productId: 'prod_oos', name: 'Sold Out GPU', price: 499 });

      service.addToCart({ userId: userA, product: offer1, quantity: 1 });
      service.addToCart({ userId: userA, product: offer2, quantity: 1 });

      const validation = await service.validateCartItems(userA, {
        channel3LookupFn: async (item) => {
          if (item.productId === 'offer_oos') {
            return {
              price: 499,
              currency: 'USD',
              availability: 'out_of_stock',
              validationSource: 'channel3_api',
              statusMessage: 'Out of stock on Channel3.',
            };
          }
          return {
            price: 100,
            currency: 'USD',
            availability: 'in_stock',
            validationSource: 'channel3_api',
            statusMessage: 'In stock on Channel3.',
          };
        },
      });

      assert.equal(validation.unavailableItemsDetected, 1);
      assert.equal(validation.canProceedToCheckout, false);

      // Remove unavailable items
      const cleaned = service.removeUnavailableCartItems(userA);
      assert.equal(cleaned.ok, true);
      assert.equal(cleaned.removedCount, 1);
      assert.equal(cleaned.cart.items.length, 1);
      assert.equal(cleaned.cart.canProceedToCheckout, true);
    });

    it('never invents replacement prices when Channel3 reports missing price', async () => {
      const offer = createTestOffer({ id: 'offer_missing_p', productId: 'prod_missing_p', price: 150 });
      service.addToCart({ userId: userA, product: offer, quantity: 1 });

      const validation = await service.validateCartItems(userA, {
        channel3LookupFn: async () => ({
          price: null,
          currency: 'USD',
          availability: 'in_stock',
          validationSource: 'channel3_api',
          statusMessage: 'Price missing from upstream merchant feed.',
        }),
      });

      assert.equal(validation.unverifiedItemsDetected, 1);
      assert.equal(validation.canProceedToCheckout, false);
      assert.equal(validation.cart.items[0].priceStatus, 'price_could_not_be_verified');
    });
  });

  describe('4. Coupons, Discounts & Authoritative Pricing Breakdown', () => {
    it('applies verified percentage and fixed coupons, enforces min-spend/category/expiry/currency, and recalculates on quantity change', () => {
      const audioOffer = createTestOffer({
        id: 'offer_audio',
        productId: 'prod_audio',
        category: 'Audio & Headphones',
        price: 100,
      });
      service.addToCart({ userId: userA, product: audioOffer, quantity: 1 });

      // 1. Expired coupon rejected
      const expired = service.applyCartCoupon({ userId: userA, couponCode: 'EXPIRED20' });
      assert.equal(expired.ok, false);
      assert.match(expired.message, /expired/i);

      // 2. Currency mismatch coupon rejected (EURONLY15 on USD cart)
      const wrongCurrency = service.applyCartCoupon({ userId: userA, couponCode: 'EURONLY15' });
      assert.equal(wrongCurrency.ok, false);
      assert.match(wrongCurrency.message, /requires EUR/i);

      // 3. Minimum spend check: SAVE25 requires $150+
      const belowMin = service.applyCartCoupon({ userId: userA, couponCode: 'SAVE25' });
      assert.equal(belowMin.ok, false);
      assert.match(belowMin.message, /minimum|spend/i);

      // 4. Apply AUDIO15 (15% off Audio & Headphones, min $80) -> $15.00 discount
      const audioApplied = service.applyCartCoupon({ userId: userA, couponCode: 'AUDIO15' });
      assert.equal(audioApplied.ok, true);
      assert.equal(audioApplied.cart.verifiedDiscountTotal, 15);
      assert.equal(audioApplied.cart.finalPayableTotal, 85);

      // 5. Increase quantity to 2 ($200 subtotal) -> discount automatically recalculates to $30.00
      const itemId = audioApplied.cart.items[0].itemId;
      const updated = service.updateCartItemQuantity({ userId: userA, itemId, quantity: 2 });
      assert.equal(updated.cart?.subtotal, 200);
      assert.equal(updated.cart?.verifiedDiscountTotal, 30);
      assert.equal(updated.cart?.finalPayableTotal, 170);

      // 6. Remove coupon -> discount resets to 0
      const removedCoupon = service.removeCartCoupon(userA);
      assert.equal(removedCoupon.cart.verifiedDiscountTotal, 0);
      assert.equal(removedCoupon.cart.finalPayableTotal, 200);
    });

    it('never assumes shipping is free or taxes are zero when unknown, and maintains minor-unit rounding accuracy', () => {
      const offerUnknownShip = createTestOffer({
        id: 'offer_unk_ship',
        productId: 'prod_unk_ship',
        price: 33.33,
        shippingCost: null,
        shippingStatus: 'unknown',
      });
      const added = service.addToCart({ userId: userA, product: offerUnknownShip, quantity: 3 });

      assert.equal(added.cart?.subtotal, 99.99);
      assert.equal(added.cart?.shippingStatusSummary, 'unknown');
      assert.equal(added.cart?.shippingCost, null);
      assert.equal(added.cart?.taxStatusSummary, 'unknown');
      assert.equal(added.cart?.taxAmount, null);
      assert.equal(added.cart?.hasUnknownShipping, true);
      assert.equal(added.cart?.hasUnknownTax, true);
      assert.equal(added.cart?.finalPayableTotal, 99.99);
    });
  });

  describe('5. Security & Abuse Prevention', () => {
    it('ignores forged client prices when adding a sandbox SKU or existing session offer', () => {
      const sandboxSku = SPARK_SANDBOX_TEST_CATALOG[0];
      const res = service.addToCart({
        userId: userA,
        itemId: sandboxSku.id,
        quantity: 1,
        clientSubmittedPrice: 1.0,
      });

      assert.equal(res.ok, true);
      // Must use authoritative unitPrice from catalog, ignoring forged $1.00
      assert.equal(res.cart?.items[0].unitPrice, sandboxSku.unitPrice);
      assert.equal(res.cart?.subtotal, sandboxSku.unitPrice);
    });

    it('rejects unverified product prices and invalid quantities', () => {
      const unverified = createTestOffer({ price: null, priceStatus: 'unavailable' });
      const rejected = service.addToCart({ userId: userA, product: unverified, quantity: 1 });
      assert.equal(rejected.ok, false);

      const valid = createTestOffer({ price: 45 });
      const negativeQty = service.addToCart({ userId: userA, product: valid, quantity: -2 });
      assert.equal(negativeQty.ok, false);

      const excessiveQty = service.addToCart({ userId: userA, product: valid, quantity: 99 });
      assert.equal(excessiveQty.ok, false);
    });
  });
});
