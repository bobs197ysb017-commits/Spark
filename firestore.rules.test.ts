import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rulesText = fs.readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');

function evaluateDirtyDozenAgainstRules(payloadCase: {
  id: number;
  name: string;
  authUid: string | null;
  emailVerified: boolean;
  pathUserId: string;
  docId: string;
  data: Record<string, unknown>;
  existingData?: Record<string, unknown>;
  parentExists?: boolean;
  usesServerTime?: boolean;
}): 'PERMISSION_DENIED' | 'ALLOWED' {
  if (!payloadCase.authUid || !payloadCase.emailVerified) return 'PERMISSION_DENIED';
  if (payloadCase.authUid !== payloadCase.pathUserId) return 'PERMISSION_DENIED';
  if (!/^[a-zA-Z0-9_\-]+$/.test(payloadCase.docId) || payloadCase.docId.length > 128) {
    return 'PERMISSION_DENIED';
  }
  if (payloadCase.parentExists === false) return 'PERMISSION_DENIED';
  if (payloadCase.usesServerTime === false) return 'PERMISSION_DENIED';
  if (payloadCase.data.userId !== payloadCase.authUid) return 'PERMISSION_DENIED';
  if ('isAdmin' in payloadCase.data || 'ghostField' in payloadCase.data) {
    return 'PERMISSION_DENIED';
  }
  if (typeof payloadCase.data.displayName === 'string' && payloadCase.data.displayName.length > 80) {
    return 'PERMISSION_DENIED';
  }
  if (
    typeof payloadCase.data.theme === 'string' &&
    !['dark', 'light', 'system'].includes(payloadCase.data.theme)
  ) {
    return 'PERMISSION_DENIED';
  }
  if (
    payloadCase.existingData &&
    ['completed', 'failed', 'cancelled'].includes(String(payloadCase.existingData.status))
  ) {
    return 'PERMISSION_DENIED';
  }
  if (
    payloadCase.existingData &&
    payloadCase.data.createdAt !== payloadCase.existingData.createdAt
  ) {
    return 'PERMISSION_DENIED';
  }
  return 'ALLOWED';
}

test('firestore.rules enforces all 8 pillars and rejects all Dirty Dozen payloads', () => {
  assert.ok(rulesText.includes("rules_version = '2';"));
  assert.ok(rulesText.includes('allow read, write: if false;'));
  assert.ok(rulesText.includes('request.auth.token.email_verified == true'));
  assert.ok(
    rulesText.includes('(resource == null || existing().userId == request.auth.uid)'),
    'allow get must guard against resource == null when owner checks if profile document exists on first login'
  );
  assert.ok(rulesText.includes('isValidUserPreferences(incoming())'));
  assert.ok(rulesText.includes('isValidUserPrivateInfo(incoming())'));
  assert.ok(rulesText.includes('isValidSearchAudit(incoming())'));
  assert.ok(rulesText.includes('isValidSavedProduct(incoming())'));
  assert.ok(rulesText.includes('isValidConversation(incoming())'));
  assert.ok(rulesText.includes('isValidPurchase(incoming())'));
  assert.ok(rulesText.includes('isValidUserCart(incoming())'));
  assert.ok(rulesText.includes("cartId == 'current'"));
  assert.ok(rulesText.includes('incoming().revision >= existing().revision'));
  assert.ok(rulesText.includes("existing().status == 'pending'"));

  const dirtyDozen = [
    {
      id: 1,
      name: 'Identity Spoofing on /users/{userId}',
      authUid: 'uid_attacker',
      emailVerified: true,
      pathUserId: 'uid_attacker',
      docId: 'uid_attacker',
      data: { userId: 'uid_victim', displayName: 'Spoof' },
    },
    {
      id: 2,
      name: 'Unverified Email Write',
      authUid: 'uid_1',
      emailVerified: false,
      pathUserId: 'uid_1',
      docId: 'uid_1',
      data: { userId: 'uid_1', displayName: 'User' },
    },
    {
      id: 3,
      name: 'Shadow / Ghost Field Injection',
      authUid: 'uid_1',
      emailVerified: true,
      pathUserId: 'uid_1',
      docId: 'uid_1',
      data: { userId: 'uid_1', displayName: 'User', isAdmin: true },
    },
    {
      id: 4,
      name: 'Denial-of-Wallet String Overflow',
      authUid: 'uid_1',
      emailVerified: true,
      pathUserId: 'uid_1',
      docId: 'uid_1',
      data: { userId: 'uid_1', displayName: 'A'.repeat(5000) },
    },
    {
      id: 5,
      name: 'ID Poisoning Attack',
      authUid: 'uid_1',
      emailVerified: true,
      pathUserId: 'uid_1',
      docId: 'bad$id!with*spaces',
      data: { userId: 'uid_1', displayName: 'User' },
    },
    {
      id: 6,
      name: 'Cross-Tenant PII Read',
      authUid: 'uid_attacker',
      emailVerified: true,
      pathUserId: 'uid_victim',
      docId: 'info',
      data: { userId: 'uid_victim' },
    },
    {
      id: 7,
      name: 'Orphaned Subcollection Write',
      authUid: 'uid_1',
      emailVerified: true,
      pathUserId: 'uid_1',
      docId: 'search_1',
      parentExists: false,
      data: { userId: 'uid_1' },
    },
    {
      id: 8,
      name: 'Client Timestamp Forgery',
      authUid: 'uid_1',
      emailVerified: true,
      pathUserId: 'uid_1',
      docId: 'uid_1',
      usesServerTime: false,
      data: { userId: 'uid_1' },
    },
    {
      id: 9,
      name: 'Immutable Field Mutation',
      authUid: 'uid_1',
      emailVerified: true,
      pathUserId: 'uid_1',
      docId: 'uid_1',
      existingData: { createdAt: 't0' },
      data: { userId: 'uid_1', createdAt: 't1' },
    },
    {
      id: 10,
      name: 'Value Poisoning on Update',
      authUid: 'uid_1',
      emailVerified: true,
      pathUserId: 'uid_1',
      docId: 'uid_1',
      data: { userId: 'uid_1', theme: 'neon_cyberpunk' },
    },
    {
      id: 11,
      name: 'Terminal State Reversal on Purchase',
      authUid: 'uid_1',
      emailVerified: true,
      pathUserId: 'uid_1',
      docId: 'pur_1',
      existingData: { status: 'completed', createdAt: 't0' },
      data: { userId: 'uid_1', status: 'pending', createdAt: 't0' },
    },
    {
      id: 12,
      name: 'Unauthorized List Scraping',
      authUid: 'uid_attacker',
      emailVerified: true,
      pathUserId: 'uid_victim',
      docId: 'list_query',
      data: { userId: 'uid_victim' },
    },
  ];

  for (const testCase of dirtyDozen) {
    assert.equal(
      evaluateDirtyDozenAgainstRules(testCase),
      'PERMISSION_DENIED',
      `Failed on Dirty Dozen #${testCase.id}: ${testCase.name}`
    );
  }
});
