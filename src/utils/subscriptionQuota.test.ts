import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPARK_SUBSCRIPTION_PLANS,
  acquireConcurrency,
  cancelSubscription,
  deleteUserSubscriptionData,
  expireSubscription,
  exportAllSubscriptionData,
  getSubscriptionPayments,
  getUserDashboardPreferences,
  getUserQuotaStatus,
  getUserSubscription,
  importSubscriptionData,
  markSubscriptionFailedRenewal,
  recordFeatureUsage,
  releaseConcurrency,
  reserveFeatureQuota,
  resetUserMonthlyQuota,
  saveUserDashboardPreferences,
  setUserSubscriptionPlan,
} from './subscriptionQuotaEngine';
import {
  PAYPAL_BILLING_PLANS,
  activatePayPalSubscription,
  approvePayPalSubscription,
  cancelPendingPayPalSubscription,
  changePayPalSubscriptionPlan,
  createPayPalSubscription,
  evaluatePayPalSubscriptionEligibility,
  handlePayPalSubscriptionWebhook,
} from './paypalSubscriptionService';
import { PayPalSandboxEngine } from './paypalSandboxService';

test('1. Subscription Plan Specifications (Luna, Terra, Sol, Free)', () => {
  // Free Tier
  assert.equal(SPARK_SUBSCRIPTION_PLANS.free.priceMonthly, 0);
  assert.equal(SPARK_SUBSCRIPTION_PLANS.free.monthlyWorkflows, 3);
  assert.equal(SPARK_SUBSCRIPTION_PLANS.free.maxConcurrency, 1);

  // Luna Plan ($9.99/mo)
  assert.equal(SPARK_SUBSCRIPTION_PLANS.luna.priceMonthly, 9.99);
  assert.equal(SPARK_SUBSCRIPTION_PLANS.luna.monthlySearches, 120);
  assert.equal(SPARK_SUBSCRIPTION_PLANS.luna.monthlyAnalyses, 30);
  assert.equal(SPARK_SUBSCRIPTION_PLANS.luna.monthlyCoupons, 40);
  assert.equal(SPARK_SUBSCRIPTION_PLANS.luna.monthlyWorkflows, 20);
  assert.equal(SPARK_SUBSCRIPTION_PLANS.luna.maxConcurrency, 1);

  // Terra Plan ($19.99/mo)
  assert.equal(SPARK_SUBSCRIPTION_PLANS.terra.priceMonthly, 19.99);
  assert.equal(SPARK_SUBSCRIPTION_PLANS.terra.monthlySearches, 600);
  assert.equal(SPARK_SUBSCRIPTION_PLANS.terra.monthlyAnalyses, 150);
  assert.equal(SPARK_SUBSCRIPTION_PLANS.terra.monthlyCoupons, 200);
  assert.equal(SPARK_SUBSCRIPTION_PLANS.terra.monthlyWorkflows, 100);
  assert.equal(SPARK_SUBSCRIPTION_PLANS.terra.maxConcurrency, 3);
  assert.equal(SPARK_SUBSCRIPTION_PLANS.terra.isPopular, true);

  // Sol Plan ($39.99/mo)
  assert.equal(SPARK_SUBSCRIPTION_PLANS.sol.priceMonthly, 39.99);
  assert.equal(SPARK_SUBSCRIPTION_PLANS.sol.monthlySearches, 2500);
  assert.equal(SPARK_SUBSCRIPTION_PLANS.sol.monthlyAnalyses, 700);
  assert.equal(SPARK_SUBSCRIPTION_PLANS.sol.monthlyCoupons, 1000);
  assert.equal(SPARK_SUBSCRIPTION_PLANS.sol.monthlyWorkflows, 350);
  assert.equal(SPARK_SUBSCRIPTION_PLANS.sol.maxConcurrency, 5);
  assert.ok(PAYPAL_BILLING_PLANS.luna);
});

test('2. Subscription Lifecycle: Luna, Terra, Sol Activation, Upgrade, Downgrade, Cancellation, Expiration & Failed Renewal', () => {
  const userId = `test_lifecycle_${Date.now()}`;

  // Luna activation
  const lunaInit = createPayPalSubscription({ userId, userEmail: 'u@spark.app', planId: 'luna' });
  const lunaAct = activatePayPalSubscription({
    userId,
    subscriptionId: lunaInit.subscriptionId,
    planId: 'luna',
  });
  assert.equal(lunaAct.ok, true);
  assert.equal(getUserQuotaStatus(userId).plan.id, 'luna');
  assert.equal(getUserQuotaStatus(userId).limits.searches, 120);

  // Upgrade Luna -> Terra
  const upTerra = changePayPalSubscriptionPlan({ userId, newPlanId: 'terra' });
  assert.equal(upTerra.changeType, 'upgrade');
  assert.equal(getUserQuotaStatus(userId).plan.id, 'terra');
  assert.equal(getUserQuotaStatus(userId).limits.searches, 600);

  // Upgrade Terra -> Sol
  const upSol = changePayPalSubscriptionPlan({ userId, newPlanId: 'sol' });
  assert.equal(upSol.changeType, 'upgrade');
  assert.equal(getUserQuotaStatus(userId).plan.id, 'sol');
  assert.equal(getUserQuotaStatus(userId).limits.searches, 2500);

  // Downgrade Sol -> Luna
  const downLuna = changePayPalSubscriptionPlan({ userId, newPlanId: 'luna' });
  assert.equal(downLuna.changeType, 'downgrade');
  assert.equal(getUserQuotaStatus(userId).plan.id, 'luna');

  // Cancellation
  const cancelled = cancelSubscription(userId);
  assert.equal(cancelled.cancelAtPeriodEnd, true);
  assert.equal(cancelled.status, 'cancelled');

  // Failed Renewal
  const pastDue = markSubscriptionFailedRenewal(userId);
  assert.equal(pastDue.status, 'past_due');

  // Expiration (downgrades to free limits without deleting user data)
  const expired = expireSubscription(userId);
  assert.equal(expired.status, 'expired');
  assert.equal(expired.planId, 'free');
  assert.equal(getUserQuotaStatus(userId).limits.workflows, 3);
});

test('3. Usage Engine: Exact Limits, Quota Exhaustion, Idempotency, Failed Workflows & Monthly Reset', () => {
  const userId = `test_quota_${Date.now()}`;
  setUserSubscriptionPlan(userId, 'free');

  // Idempotent usage recording with operationId prevents duplicate counting
  recordFeatureUsage(userId, 'workflow', 500, 0.001, 'op_unique_01');
  recordFeatureUsage(userId, 'workflow', 500, 0.001, 'op_unique_01'); // Duplicate!
  assert.equal(getUserQuotaStatus(userId).usage.workflowsUsed, 1);

  // Consume remaining 2 workflows
  recordFeatureUsage(userId, 'workflow', 500, 0.001, 'op_unique_02');
  recordFeatureUsage(userId, 'workflow', 500, 0.001, 'op_unique_03');
  assert.equal(getUserQuotaStatus(userId).usage.workflowsUsed, 3);

  // 4th workflow must be rejected due to quota exhaustion
  const exhausted = reserveFeatureQuota(userId, 'workflow');
  assert.equal(exhausted.allowed, false);
  assert.equal(exhausted.remaining, 0);

  // Monthly reset restores full quota
  const resetRec = resetUserMonthlyQuota(userId);
  assert.equal(resetRec.workflowsUsed, 0);
  assert.equal(reserveFeatureQuota(userId, 'workflow').allowed, true);
});

test('4. Concurrency Limiter & Failed Workflow Slot Release', () => {
  const userId = `test_conc_${Date.now()}`;
  setUserSubscriptionPlan(userId, 'luna'); // Max concurrency = 1

  const slot1 = acquireConcurrency(userId);
  assert.equal(slot1.allowed, true);
  assert.equal(slot1.current, 1);

  // Concurrent 2nd request blocked on Luna
  const slot2 = acquireConcurrency(userId);
  assert.equal(slot2.allowed, false);

  // Simulate failed workflow: release concurrency without recording usage
  releaseConcurrency(userId);
  assert.equal(getUserQuotaStatus(userId).usage.workflowsUsed, 0);

  // Slot is available again
  const slot3 = acquireConcurrency(userId);
  assert.equal(slot3.allowed, true);
  releaseConcurrency(userId);
});

test('5. Security & Payment Integrity: Browser Redirect Rejection, Cross-User Tampering, Duplicate/Invalid Webhooks, Refund & Reversal', () => {
  const userA = `user_a_${Date.now()}`;
  const userB = `user_b_${Date.now()}`;

  const subSession = createPayPalSubscription({
    userId: userA,
    userEmail: 'a@spark.app',
    planId: 'terra',
  });

  // 1. Browser redirect alone without server verification is rejected
  const redirectAttempt = activatePayPalSubscription({
    userId: userA,
    subscriptionId: subSession.subscriptionId,
    planId: 'terra',
    browserRedirectOnly: true,
  });
  assert.equal(redirectAttempt.ok, false);
  assert.equal(redirectAttempt.errorCode, 'unverified_browser_redirect_rejected');

  // 2. Cross-user activation tampering is rejected
  const crossUserAttempt = activatePayPalSubscription({
    userId: userB,
    subscriptionId: subSession.subscriptionId,
    planId: 'terra',
  });
  assert.equal(crossUserAttempt.ok, false);
  assert.equal(crossUserAttempt.errorCode, 'cross_user_subscription_mismatch');

  // 3. Plan tampering (creating Terra but trying to activate Sol) is rejected
  const planTamperAttempt = activatePayPalSubscription({
    userId: userA,
    subscriptionId: subSession.subscriptionId,
    planId: 'sol',
  });
  assert.equal(planTamperAttempt.ok, false);
  assert.equal(planTamperAttempt.errorCode, 'plan_tampering_detected');

  // 4. Legitimate server-verified activation succeeds
  const validAct = activatePayPalSubscription({
    userId: userA,
    subscriptionId: subSession.subscriptionId,
    planId: 'terra',
  });
  assert.equal(validAct.ok, true);
  const paymentTxnId = validAct.payment!.paypalTransactionId;

  // 5. Invalid webhook signature is rejected
  const invalidSigWh = handlePayPalSubscriptionWebhook(
    {
      id: `WH-INV-${Date.now()}`,
      event_version: '1.0',
      create_time: new Date().toISOString(),
      resource_type: 'subscription',
      event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
      summary: 'Invalid sig',
      resource: { id: subSession.subscriptionId, custom_id: userA },
    },
    { signatureHeader: 'invalid', rejectInvalidSignature: true }
  );
  assert.equal(invalidSigWh.handled, false);
  assert.equal(invalidSigWh.actionTaken, 'invalid_webhook_signature');

  // 6. Duplicate webhook event ID is ignored idempotently
  const whId = `WH-DUP-${Date.now()}`;
  const whPayload = {
    id: whId,
    event_version: '1.0',
    create_time: new Date().toISOString(),
    resource_type: 'sale',
    event_type: 'PAYMENT.SALE.COMPLETED',
    summary: 'Sale completed',
    resource: {
      id: `TXN-WH-${Date.now()}`,
      custom_id: userA,
      billing_info: { last_payment: { amount: { value: '19.99', currency_code: 'USD' } } },
    },
  };
  const firstWh = handlePayPalSubscriptionWebhook(whPayload);
  const secondWh = handlePayPalSubscriptionWebhook(whPayload);
  assert.equal(firstWh.handled, true);
  assert.equal(firstWh.duplicate, undefined);
  assert.equal(secondWh.handled, true);
  assert.equal(secondWh.duplicate, true);
  assert.equal(secondWh.actionTaken, 'duplicate_event_ignored');

  // 7. Refund & Reversal webhook handling
  const refundWh = handlePayPalSubscriptionWebhook({
    id: `WH-REF-${Date.now()}`,
    event_version: '1.0',
    create_time: new Date().toISOString(),
    resource_type: 'refund',
    event_type: 'PAYMENT.SALE.REFUNDED',
    summary: 'Refunded',
    resource: { id: paymentTxnId, parent_payment: paymentTxnId, custom_id: userA },
  });
  assert.equal(refundWh.actionTaken, 'payment_refunded');
  const userPayments = getSubscriptionPayments(userA);
  assert.ok(userPayments.some((p) => p.paypalTransactionId === paymentTxnId && p.status === 'REFUNDED'));

  const reversalWh = handlePayPalSubscriptionWebhook({
    id: `WH-REV-${Date.now()}`,
    event_version: '1.0',
    create_time: new Date().toISOString(),
    resource_type: 'reversal',
    event_type: 'PAYMENT.SALE.REVERSED',
    summary: 'Reversed',
    resource: { id: paymentTxnId, custom_id: userA },
  });
  assert.equal(reversalWh.actionTaken, 'payment_reversed_and_expired');
  assert.equal(getUserSubscription(userA).status, 'expired');
});

test('6. Multi-User Data Isolation, Dashboard Preferences, Persistence & Data Deletion', () => {
  const u1 = `iso_u1_${Date.now()}`;
  const u2 = `iso_u2_${Date.now()}`;

  setUserSubscriptionPlan(u1, 'sol');
  setUserSubscriptionPlan(u2, 'luna');
  recordFeatureUsage(u1, 'search');
  recordFeatureUsage(u1, 'search');

  // Verify strict isolation between u1 and u2
  assert.equal(getUserQuotaStatus(u1).plan.id, 'sol');
  assert.equal(getUserQuotaStatus(u1).usage.searchesUsed, 2);
  assert.equal(getUserQuotaStatus(u2).plan.id, 'luna');
  assert.equal(getUserQuotaStatus(u2).usage.searchesUsed, 0);

  // Dashboard preferences persistence
  saveUserDashboardPreferences(u1, { defaultTab: 'coupon_savings', pageSize: 25 });
  assert.equal(getUserDashboardPreferences(u1).defaultTab, 'coupon_savings');
  assert.equal(getUserDashboardPreferences(u1).pageSize, 25);
  assert.equal(getUserDashboardPreferences(u2).defaultTab, 'saved_products');

  // Snapshot export & import
  const snapshot = exportAllSubscriptionData();
  assert.ok(Array.isArray(snapshot.subscriptions));
  assert.ok(Array.isArray(snapshot.dashboardPreferences));
  importSubscriptionData(snapshot);

  // User data deletion
  deleteUserSubscriptionData(u1);
  assert.equal(getUserSubscription(u1).planId, 'free');
  assert.equal(getUserDashboardPreferences(u1).defaultTab, 'saved_products');

  // Eligibility check
  const eligibility = evaluatePayPalSubscriptionEligibility();
  assert.ok(eligibility.environment === 'sandbox' || eligibility.environment === 'live');
});

test('7. PayPal Wallet Deduction on Subscription Activation & Insufficient Balance Rejection', () => {
  const engine = new PayPalSandboxEngine();
  const userId = `wallet_sub_user_${Date.now()}`;
  const userEmail = 'wallet-subscriber@spark.app';

  // Initial PayPal wallet balance is $500.00
  const initialWallet = engine.getBuyerSandboxWallet(userId, userEmail);
  assert.equal(initialWallet.availableBalance, 500);

  // 1. Subscribe to Luna ($9.99/mo) -> deducts $9.99 -> balance becomes $490.01
  const lunaSession = createPayPalSubscription({ userId, userEmail, planId: 'luna' });
  const lunaRes = activatePayPalSubscription({
    userId,
    userEmail,
    subscriptionId: lunaSession.subscriptionId,
    planId: 'luna',
    chargeWallet: (input) => engine.chargeSubscriptionPlanFromPayPalWallet(input),
  });
  assert.equal(lunaRes.ok, true);
  assert.equal(lunaRes.balanceBefore, 500);
  assert.equal(lunaRes.balanceAfter, 490.01);
  assert.equal(engine.getBuyerSandboxWallet(userId, userEmail).availableBalance, 490.01);
  assert.equal(engine.getBuyerSandboxWallet(userId, userEmail).totalDeducted, 9.99);
  assert.equal(getUserQuotaStatus(userId).plan.id, 'luna');

  // 2. Subscribe to Terra ($19.99/mo) -> deducts $19.99 -> balance becomes $470.02
  const terraSession = createPayPalSubscription({ userId, userEmail, planId: 'terra' });
  const terraRes = activatePayPalSubscription({
    userId,
    userEmail,
    subscriptionId: terraSession.subscriptionId,
    planId: 'terra',
    chargeWallet: (input) => engine.chargeSubscriptionPlanFromPayPalWallet(input),
  });
  assert.equal(terraRes.ok, true);
  assert.equal(terraRes.balanceBefore, 490.01);
  assert.equal(terraRes.balanceAfter, 470.02);
  assert.equal(engine.getBuyerSandboxWallet(userId, userEmail).availableBalance, 470.02);
  assert.equal(engine.getBuyerSandboxWallet(userId, userEmail).totalDeducted, 29.98);
  assert.equal(getUserQuotaStatus(userId).plan.id, 'terra');
  assert.equal(engine.getUserPurchases(userId).length, 2);

  // 3. Configure wallet to $5.00 and attempt to subscribe to Sol ($39.99/mo) -> must fail with INSUFFICIENT_FUNDS and NOT activate Sol
  engine.configureBuyerSandboxBalance(userId, 5.0, userEmail);
  const solSession = createPayPalSubscription({ userId, userEmail, planId: 'sol' });
  const solFailRes = activatePayPalSubscription({
    userId,
    userEmail,
    subscriptionId: solSession.subscriptionId,
    planId: 'sol',
    chargeWallet: (input) => engine.chargeSubscriptionPlanFromPayPalWallet(input),
  });
  assert.equal(solFailRes.ok, false);
  assert.equal(solFailRes.errorCode, 'INSUFFICIENT_FUNDS');
  assert.equal(engine.getBuyerSandboxWallet(userId, userEmail).availableBalance, 5.0);
  // Plan remains Terra, NOT upgraded to Sol for free
  assert.equal(getUserQuotaStatus(userId).plan.id, 'terra');
});

test('8. Two-Step Explicit PayPal Subscription Approval & Pending Cancellation', () => {
  const userId = `two_step_${Date.now()}`;
  const session = createPayPalSubscription({ userId, userEmail: 'twostep@spark.app', planId: 'luna' });
  assert.equal(session.status, 'APPROVAL_PENDING');

  // Reject activation if requireExplicitApproval is true and buyer has not approved yet
  const unapprovedAttempt = activatePayPalSubscription({
    userId,
    subscriptionId: session.subscriptionId,
    planId: 'luna',
    requireExplicitApproval: true,
  });
  assert.equal(unapprovedAttempt.ok, false);
  assert.equal(unapprovedAttempt.errorCode, 'subscription_not_approved');

  // Approve explicitly, then activate succeeds
  const approval = approvePayPalSubscription({
    userId,
    subscriptionId: session.subscriptionId,
    payerId: 'PAYER-TWOSTEP-1',
  });
  assert.equal(approval.ok, true);
  assert.equal(approval.session?.approved, true);

  const activated = activatePayPalSubscription({
    userId,
    subscriptionId: session.subscriptionId,
    planId: 'luna',
    requireExplicitApproval: true,
  });
  assert.equal(activated.ok, true);
  assert.equal(getUserQuotaStatus(userId).plan.id, 'luna');

  // Create another pending session and cancel it cleanly
  const session2 = createPayPalSubscription({ userId, userEmail: 'twostep@spark.app', planId: 'terra' });
  const cancelledPending = cancelPendingPayPalSubscription({
    userId,
    subscriptionId: session2.subscriptionId,
  });
  assert.equal(cancelledPending.ok, true);
  assert.equal(cancelledPending.session?.cancelled, true);
});
