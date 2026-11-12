# Spark Firestore Security Specification (`security_spec.md`)

## 1. Data Invariants

1. **Default-Deny Catch-All**: Every path not explicitly matched is unconditionally denied (`allow read, write: if false;`).
2. **Verified Identity & Ownership**: Every write operation requires an authenticated user (`request.auth != null`) with `request.auth.token.email_verified == true` and path/payload ownership (`userId == request.auth.uid`).
3. **PII Isolation (Split Collection Strategy)**: User email PII is isolated in `/users/{userId}/private/{docId}` and never exposed to non-owners.
4. **Master Gate Relational Sync**: Subcollections (`/users/{userId}/private/{docId}`, `/users/{userId}/searches/{searchId}`, `/users/{userId}/purchases/{purchaseId}`) verify that the parent `/users/{userId}` document exists and belongs to `request.auth.uid`.
5. **Strict Key & Size Enforcement**: Every create and update operation validates exact allowed keys (`hasAll` and `hasOnly`), string length bounds (`.size()`), regex ID patterns (`isValidId`), and server timestamps (`request.time`).
6. **Terminal State Locking**: Once a `PurchaseDoc` reaches a terminal status (`failed`, `cancelled`, or `refunded`), no subsequent update is permitted; a `completed` purchase may only transition to `refunded`.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 1 (Identity Spoofing on `/users/{userId}`)**: Authenticated user `uid_attacker` writes a profile where `userId: "uid_victim"`. -> `PERMISSION_DENIED`.
2. **Payload 2 (Unverified Email Write)**: User with `email_verified: false` attempts to create `/users/{userId}`. -> `PERMISSION_DENIED`.
3. **Payload 3 (Shadow / Ghost Field Injection)**: User sends valid `UserPreferencesDoc` plus `"isAdmin": true`. -> Rejected by `.keys().hasOnly(...)` -> `PERMISSION_DENIED`.
4. **Payload 4 (Denial-of-Wallet String Overflow)**: User submits `displayName` with 5,000 characters (`maxLength` is 80). -> `PERMISSION_DENIED`.
5. **Payload 5 (ID Poisoning Attack)**: User attempts to create `/users/{userId}/searches/invalid$id!with*spaces`. -> Rejected by `isValidId(searchId)` -> `PERMISSION_DENIED`.
6. **Payload 6 (Cross-Tenant PII Read)**: User `uid_attacker` attempts `get` on `/users/uid_victim/private/info`. -> `PERMISSION_DENIED`.
7. **Payload 7 (Orphaned Subcollection Write)**: User attempts to create `/users/{userId}/searches/{searchId}` before parent `/users/{userId}` exists. -> Rejected by `exists(...)` Master Gate -> `PERMISSION_DENIED`.
8. **Payload 8 (Client Timestamp Forgery)**: User sets `createdAt` to a past timestamp (`2020-01-01T00:00:00Z`) instead of `request.time`. -> `PERMISSION_DENIED`.
9. **Payload 9 (Immutable Field Mutation)**: User attempts to update `createdAt` or `userId` on `/users/{userId}`. -> Rejected by `affectedKeys().hasOnly(...)` and immutability gate -> `PERMISSION_DENIED`.
10. **Payload 10 (Value Poisoning on Update)**: User updates `theme` to `"neon_cyberpunk"` (not in `['dark', 'light', 'system']`). -> Rejected by `isValidUserPreferences(incoming())` -> `PERMISSION_DENIED`.
11. **Payload 11 (Terminal State Reversal on Purchase)**: User attempts to update a `PurchaseDoc` whose existing `status` is `'completed'`. -> Rejected by Terminal State Lock -> `PERMISSION_DENIED`.
12. **Payload 12 (Unauthorized List Scraping)**: User attempts a collection list query on another user's subcollection or without `resource.data.userId == request.auth.uid`. -> `PERMISSION_DENIED`.
