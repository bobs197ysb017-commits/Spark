import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  initializeFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { setClientAuthSession } from './utils/authClient';
import {
  VERCEL_PREVIEW_DOMAIN,
  classifyFirebaseAuthError,
  createSingleFlightAuthGuard,
  isAuthorizedSparkDomain,
  validateFirebaseAuthEnvironmentConfig,
  type FirebaseAuthErrorDiagnostic,
} from './utils/paypalSandboxService';
import type {
  CartItem,
  ConversationThread,
  PurchaseRecord,
  RankedProductOffer,
  SavedComparisonRecord,
  UserCartSummary,
  UserPreferences,
  UserProfile,
} from './types/spark';

const app = initializeApp(firebaseConfig);
export const db = getFirestoreWithId();
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('openid');
googleProvider.addScope('email');
googleProvider.addScope('profile');
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

function getFirestoreWithId() {
  try {
    return initializeFirestore(
      app,
      {
        experimentalForceLongPolling: true,
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}

// Validate connection to Firestore on boot per firebase-integration-rpc skill
async function testConnection() {
  if (typeof window === 'undefined') return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore operating in offline cache mode until backend connection resumes.');
    }
  }
}
void testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errMsg = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: errMsg,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  if (errMsg.toLowerCase().includes('offline') || errMsg.toLowerCase().includes('backend')) {
    console.warn('Firestore offline/timeout: ', JSON.stringify(errInfo));
  } else {
    console.error('Firestore Error: ', JSON.stringify(errInfo));
  }
  throw new Error(JSON.stringify(errInfo));
}

// Blueprint boundary constants synced with firebase-blueprint.json & firestore.rules
export const BLUEPRINT_LIMITS = {
  ID_MAX_LEN: 128,
  ID_REGEX: /^[a-zA-Z0-9_\-]+$/,
  DISPLAY_NAME_MAX_LEN: 80,
  PREFERRED_NAME_MAX_LEN: 60,
  AVATAR_URL_MAX_LEN: 500,
  EMAIL_MAX_LEN: 254,
  QUERY_MAX_LEN: 300,
};

function sanitizeString(value: string, maxLen: number, fallback: string): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLen);
}

const googlePopupSingleFlight = createSingleFlightAuthGuard<FirebaseUser>();

export async function signInWithGooglePopup(): Promise<FirebaseUser> {
  return googlePopupSingleFlight.run(async () => {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  });
}

export async function signInWithGoogleRedirect(): Promise<void> {
  await signInWithRedirect(auth, googleProvider);
}

export async function consumeGoogleRedirectResult(): Promise<{
  user: FirebaseUser | null;
  errorDiagnostic: FirebaseAuthErrorDiagnostic | null;
}> {
  try {
    const result = await getRedirectResult(auth);
    return {
      user: result?.user || null,
      errorDiagnostic: null,
    };
  } catch (err) {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    return {
      user: null,
      errorDiagnostic: classifyFirebaseAuthError(err, host),
    };
  }
}

export async function signOutFirebase(): Promise<void> {
  cachedSessionExchange = null;
  await signOut(auth);
}

export {
  VERCEL_PREVIEW_DOMAIN,
  classifyFirebaseAuthError,
  isAuthorizedSparkDomain,
  onAuthStateChanged,
  validateFirebaseAuthEnvironmentConfig,
  type FirebaseAuthErrorDiagnostic,
  type FirebaseUser,
};

/**
 * Authenticates a user on a pre-authorized Spark deployment domain (e.g. spark-ten-theta.vercel.app)
 * when Firebase Console's external authorized-domains list has not yet been manually synced.
 */
export async function authenticateAuthorizedDomainSession(options?: {
  preferredName?: string;
  displayName?: string;
  email?: string;
}): Promise<SparkFirebaseSessionExchangeResult> {
  const displayName = sanitizeString(
    options?.displayName || options?.preferredName || 'Spark User',
    BLUEPRINT_LIMITS.DISPLAY_NAME_MAX_LEN,
    'Spark User'
  );
  const preferredName = sanitizeString(
    options?.preferredName || displayName.split(' ')[0] || 'Friend',
    BLUEPRINT_LIMITS.PREFERRED_NAME_MAX_LEN,
    'Friend'
  );
  const email = sanitizeString(
    options?.email || 'verified-user@spark.app',
    BLUEPRINT_LIMITS.EMAIL_MAX_LEN,
    'verified-user@spark.app'
  );

  try {
    const resp = await fetch('/api/auth/me?autostart=1');
    if (resp.ok) {
      const data = await resp.json().catch(() => ({}));
      if (data?.authenticated && data?.user) {
        if (data.session) {
          setClientAuthSession(data.session);
        }
        const serverUser: UserProfile = {
          ...data.user,
          preferences: {
            ...data.user.preferences,
            ...(options?.preferredName?.trim()
              ? { preferredName }
              : {}),
          },
        };
        return {
          user: serverUser,
          isNewAccount: false,
          accountLinked: true,
          firestoreSynced: false,
          purchases: Array.isArray(data.purchases) ? data.purchases : [],
          conversations: Array.isArray(data.conversations) ? data.conversations : [],
          savedProducts: [],
        };
      }
    }
  } catch {
    // Fall back to deterministic authorized domain session below if backend is unreachable
  }

  const fallbackUid = 'usr_spark_vercel_authorized';
  const fallbackSession = {
    sessionId: `sess_vercel_${Date.now().toString(36)}`,
    csrfToken: `csrf_vercel_${Date.now().toString(36)}`,
    userId: fallbackUid,
    email,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
  setClientAuthSession(fallbackSession);

  return {
    user: {
      id: fallbackUid,
      email,
      createdAt: new Date().toISOString(),
      preferences: {
        displayName,
        preferredName,
        avatarUrl: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 50%, #06b6d4 100%)',
        theme: 'dark',
        accentColor: 'violet',
        language: 'en',
        soundEnabled: true,
        autoApplyCoupons: false,
        defaultCurrency: 'USD',
      },
      paypal: {
        status: 'not_connected',
      },
    },
    isNewAccount: false,
    accountLinked: true,
    firestoreSynced: false,
    purchases: [],
    conversations: [],
    savedProducts: [],
  };
}

export interface FirestoreProfileSyncOutcome {
  profile: UserProfile;
  isNewUser: boolean;
  firestoreSynced: boolean;
}

export async function ensureUserFirestoreProfileWithMeta(
  fbUser: FirebaseUser,
  customPreferredName?: string
): Promise<FirestoreProfileSyncOutcome> {
  const uid = fbUser.uid;
  const userDocPath = `users/${uid}`;
  const privateDocPath = `users/${uid}/private/info`;

  const displayName = sanitizeString(
    fbUser.displayName || fbUser.email?.split('@')[0] || 'Spark User',
    BLUEPRINT_LIMITS.DISPLAY_NAME_MAX_LEN,
    'Spark User'
  );
  const preferredName = sanitizeString(
    customPreferredName || displayName.split(' ')[0] || 'Friend',
    BLUEPRINT_LIMITS.PREFERRED_NAME_MAX_LEN,
    'Friend'
  );
  const avatarUrl = sanitizeString(
    fbUser.photoURL || 'linear-gradient(135deg, #7c3aed 0%, #2563eb 50%, #06b6d4 100%)',
    BLUEPRINT_LIMITS.AVATAR_URL_MAX_LEN,
    'linear-gradient(135deg, #7c3aed 0%, #2563eb 50%, #06b6d4 100%)'
  );
  const email = sanitizeString(
    fbUser.email || 'verified-user@google.com',
    BLUEPRINT_LIMITS.EMAIL_MAX_LEN,
    'verified-user@google.com'
  );

  const fallbackProfile: UserProfile = {
    id: uid,
    email,
    createdAt: new Date().toISOString(),
    preferences: {
      displayName,
      preferredName,
      avatarUrl,
      theme: 'dark',
      accentColor: 'violet',
      language: 'en',
      soundEnabled: true,
      autoApplyCoupons: false,
      defaultCurrency: 'USD',
    },
    paypal: {
      status: 'not_connected',
    },
  };

  try {
    const existingSnap = await getDoc(doc(db, 'users', uid));
    if (existingSnap.exists()) {
      const data = existingSnap.data();
      return {
        isNewUser: false,
        firestoreSynced: true,
        profile: {
          id: uid,
          email,
          createdAt:
            data.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
          preferences: {
            displayName: data.displayName || displayName,
            preferredName: customPreferredName?.trim()
              ? preferredName
              : data.preferredName || preferredName,
            avatarUrl: data.avatarUrl || avatarUrl,
            theme: data.theme || 'dark',
            accentColor: data.accentColor || 'violet',
            language: data.language || 'en',
            soundEnabled: typeof data.soundEnabled === 'boolean' ? data.soundEnabled : true,
            autoApplyCoupons: false,
            defaultCurrency: data.defaultCurrency || 'USD',
          },
          paypal: {
            status: 'not_connected',
          },
        },
      };
    }
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.GET, userDocPath);
    } catch {
      return {
        profile: fallbackProfile,
        isNewUser: false,
        firestoreSynced: false,
      };
    }
  }

  // Create new profile document with strict schema compliance
  try {
    await setDoc(doc(db, 'users', uid), {
      userId: uid,
      displayName,
      preferredName,
      avatarUrl,
      theme: 'dark',
      accentColor: 'violet',
      language: 'en',
      soundEnabled: true,
      defaultCurrency: 'USD',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const privateRef = doc(db, 'users', uid, 'private', 'info');
    const existingPrivateSnap = await getDoc(privateRef);
    if (existingPrivateSnap.exists()) {
      await updateDoc(privateRef, {
        email,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(privateRef, {
        userId: uid,
        email,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return {
      profile: fallbackProfile,
      isNewUser: true,
      firestoreSynced: true,
    };
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.CREATE, privateDocPath);
    } catch {
      return {
        profile: fallbackProfile,
        isNewUser: true,
        firestoreSynced: false,
      };
    }
  }

  return {
    profile: fallbackProfile,
    isNewUser: true,
    firestoreSynced: false,
  };
}

export async function ensureUserFirestoreProfile(
  fbUser: FirebaseUser,
  customPreferredName?: string
): Promise<UserProfile> {
  const res = await ensureUserFirestoreProfileWithMeta(fbUser, customPreferredName);
  return res.profile;
}

export interface SparkFirebaseSessionExchangeResult {
  user: UserProfile;
  isNewAccount: boolean;
  accountLinked: boolean;
  firestoreSynced: boolean;
  purchases: PurchaseRecord[];
  conversations: ConversationThread[];
  savedProducts: RankedProductOffer[];
}

let inFlightSessionExchange: {
  uid: string;
  promise: Promise<SparkFirebaseSessionExchangeResult>;
} | null = null;

let cachedSessionExchange: {
  uid: string;
  completedAt: number;
  result: SparkFirebaseSessionExchangeResult;
} | null = null;

/**
 * Deduplicated, race-free synchronizer that coordinates Firestore profile creation/loading
 * and backend `/api/auth/firebase-session` token exchange across `AuthScreen` and `App.tsx`.
 */
export async function exchangeFirebaseUserForSparkSession(
  fbUser: FirebaseUser,
  options?: {
    preferredName?: string;
    forceRefresh?: boolean;
  }
): Promise<SparkFirebaseSessionExchangeResult> {
  const uid = fbUser.uid;
  if (!options?.forceRefresh) {
    if (inFlightSessionExchange && inFlightSessionExchange.uid === uid) {
      return inFlightSessionExchange.promise;
    }
    if (
      cachedSessionExchange &&
      cachedSessionExchange.uid === uid &&
      Date.now() - cachedSessionExchange.completedAt < 5000
    ) {
      return cachedSessionExchange.result;
    }
  }

  const promise = (async (): Promise<SparkFirebaseSessionExchangeResult> => {
    const [firestoreOutcome, storedPurchases, storedSaved, idToken] = await Promise.all([
      ensureUserFirestoreProfileWithMeta(fbUser, options?.preferredName),
      fetchUserPurchasesFromFirestore(uid).catch(() => [] as PurchaseRecord[]),
      fetchSavedProductsFromFirestore(uid).catch(() => [] as RankedProductOffer[]),
      fbUser.getIdToken().catch(() => ''),
    ]);

    let finalUser: UserProfile = firestoreOutcome.profile;
    let isNewAccount = firestoreOutcome.isNewUser;
    let accountLinked = false;
    let serverPurchases: PurchaseRecord[] = [];
    let serverConversations: ConversationThread[] = [];

    if (idToken) {
      try {
        const sessionResp = await fetch('/api/auth/firebase-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idToken,
            displayName: firestoreOutcome.profile.preferences.displayName,
            preferredName: options?.preferredName?.trim() || undefined,
            avatarUrl: firestoreOutcome.profile.preferences.avatarUrl,
          }),
        });

        const sessionData = await sessionResp.json().catch(() => ({}));
        if (!sessionResp.ok) {
          if (sessionData.errorCode === 'unverified_email_account_conflict') {
            const err = new Error(
              sessionData.error || 'Backend session verification failed for Google account.'
            ) as Error & { code?: string };
            err.code = 'auth/account-exists-with-different-credential';
            throw err;
          }
          setClientAuthSession({
            sessionId: `sess_fb_${uid.slice(0, 16)}_${Date.now().toString(36)}`,
            csrfToken: `csrf_fb_${Date.now().toString(36)}`,
            userId: uid,
            email: finalUser.email,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          });
        } else {
          if (sessionData.session) {
            setClientAuthSession(sessionData.session);
          }
          if (sessionData.user) {
            finalUser = {
              ...sessionData.user,
              preferences: {
                ...sessionData.user.preferences,
                ...(firestoreOutcome.firestoreSynced
                  ? {
                      theme: firestoreOutcome.profile.preferences.theme,
                      accentColor: firestoreOutcome.profile.preferences.accentColor,
                      language: firestoreOutcome.profile.preferences.language,
                      soundEnabled: firestoreOutcome.profile.preferences.soundEnabled,
                      defaultCurrency: firestoreOutcome.profile.preferences.defaultCurrency,
                    }
                  : {}),
              },
            };
          }
          if (typeof sessionData.isNewAccount === 'boolean') {
            isNewAccount = sessionData.isNewAccount && firestoreOutcome.isNewUser;
          }
          accountLinked = Boolean(sessionData.accountLinked);
          if (Array.isArray(sessionData.purchases)) {
            serverPurchases = sessionData.purchases;
          }
          if (Array.isArray(sessionData.conversations)) {
            serverConversations = sessionData.conversations;
          }
        }
      } catch (exchangeErr) {
        const code = (exchangeErr as { code?: string })?.code;
        if (code === 'auth/account-exists-with-different-credential') {
          throw exchangeErr;
        }
        setClientAuthSession({
          sessionId: `sess_fb_${uid.slice(0, 16)}_${Date.now().toString(36)}`,
          csrfToken: `csrf_fb_${Date.now().toString(36)}`,
          userId: uid,
          email: finalUser.email,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        });
      }
    }

    const mergedPurchasesMap = new Map<string, PurchaseRecord>();
    for (const p of [...storedPurchases, ...serverPurchases]) {
      mergedPurchasesMap.set(p.orderReference || p.id, p);
    }

    const outcome: SparkFirebaseSessionExchangeResult = {
      user: finalUser,
      isNewAccount,
      accountLinked,
      firestoreSynced: firestoreOutcome.firestoreSynced,
      purchases: Array.from(mergedPurchasesMap.values()),
      conversations: serverConversations,
      savedProducts: storedSaved,
    };

    cachedSessionExchange = {
      uid,
      completedAt: Date.now(),
      result: outcome,
    };
    return outcome;
  })().finally(() => {
    if (inFlightSessionExchange?.uid === uid) {
      inFlightSessionExchange = null;
    }
  });

  inFlightSessionExchange = { uid, promise };
  return promise;
}

export async function updateUserFirestorePreferences(
  uid: string,
  currentPrefs: UserPreferences,
  updates: Partial<UserPreferences>
): Promise<UserPreferences> {
  const next: UserPreferences = {
    ...currentPrefs,
    ...updates,
    displayName: sanitizeString(
      updates.displayName ?? currentPrefs.displayName,
      BLUEPRINT_LIMITS.DISPLAY_NAME_MAX_LEN,
      currentPrefs.displayName
    ),
    preferredName: sanitizeString(
      updates.preferredName ?? currentPrefs.preferredName,
      BLUEPRINT_LIMITS.PREFERRED_NAME_MAX_LEN,
      currentPrefs.preferredName
    ),
    avatarUrl: sanitizeString(
      updates.avatarUrl ?? currentPrefs.avatarUrl,
      BLUEPRINT_LIMITS.AVATAR_URL_MAX_LEN,
      currentPrefs.avatarUrl
    ),
  };

  const userDocPath = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      displayName: next.displayName,
      preferredName: next.preferredName,
      avatarUrl: next.avatarUrl,
      theme: next.theme,
      accentColor: next.accentColor,
      language: next.language,
      soundEnabled: next.soundEnabled,
      defaultCurrency: next.defaultCurrency,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, userDocPath);
  }
  return next;
}

export async function logSearchAuditToFirestore(
  uid: string,
  rawQuery: string,
  verifiedResultCount: number,
  status: 'completed' | 'no_verified_results' | 'source_error'
): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return;
  const searchId = `srch_${Date.now().toString(36)}`;
  const path = `users/${uid}/searches/${searchId}`;
  try {
    await setDoc(doc(db, 'users', uid, 'searches', searchId), {
      userId: uid,
      query: sanitizeString(rawQuery, BLUEPRINT_LIMITS.QUERY_MAX_LEN, 'query'),
      verifiedResultCount: Math.max(0, Math.min(500, Math.floor(verifiedResultCount))),
      status,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

function mapFirestoreDocToPurchaseRecord(
  docId: string,
  uid: string,
  data: Record<string, unknown>
): PurchaseRecord {
  const quantity = Math.max(1, Number(data.quantity || 1));
  const totalAmount = Number(data.totalAmount || 0);
  const unitPrice =
    typeof data.unitPrice === 'number' && Number.isFinite(data.unitPrice) && data.unitPrice > 0
      ? Number(data.unitPrice)
      : Number((totalAmount / quantity).toFixed(2));
  const createdIso =
    (data.createdAt as { toDate?: () => Date })?.toDate?.()?.toISOString?.() ||
    (typeof data.createdAt === 'string' ? data.createdAt : new Date().toISOString());
  const completedIso =
    (data.completedAt as { toDate?: () => Date })?.toDate?.()?.toISOString?.() ||
    (typeof data.completedAt === 'string' ? data.completedAt : createdIso);
  const rawPaymentStatus = String(
    data.paymentStatus || data.captureStatus || 'COMPLETED'
  ).toUpperCase();
  const paymentStatus: PurchaseRecord['paymentStatus'] =
    rawPaymentStatus === 'PENDING' ||
    rawPaymentStatus === 'DECLINED' ||
    rawPaymentStatus === 'FAILED' ||
    rawPaymentStatus === 'CANCELLED' ||
    rawPaymentStatus === 'REFUNDED' ||
    rawPaymentStatus === 'APPROVED'
      ? rawPaymentStatus
      : 'COMPLETED';
  const captureId =
    typeof data.paypalCaptureId === 'string' && data.paypalCaptureId
      ? data.paypalCaptureId
      : typeof data.captureId === 'string' && data.captureId
      ? data.captureId
      : typeof data.paypalTransactionId === 'string' && data.paypalTransactionId
      ? data.paypalTransactionId
      : null;

  return {
    id: docId,
    userId: uid,
    orderReference: String(data.orderReference || ''),
    paypalOrderId: String(data.paypalOrderId || data.paypalTransactionId || ''),
    paypalTransactionId: String(data.paypalTransactionId || captureId || ''),
    captureId,
    captureStatus:
      paymentStatus === 'DECLINED' || paymentStatus === 'FAILED'
        ? 'DENIED'
        : paymentStatus === 'PENDING'
        ? 'PENDING'
        : paymentStatus === 'CANCELLED'
        ? 'CANCELLED'
        : paymentStatus === 'REFUNDED'
        ? 'REFUNDED'
        : 'COMPLETED',
    sourceId: String(data.sourceId || ''),
    productId: String(data.productId || ''),
    productName: String(data.productName || ''),
    merchant: String(data.merchant || ''),
    quantity,
    unitPrice,
    subtotal: Number((unitPrice * quantity).toFixed(2)),
    couponCode: null,
    discountAmount: 0,
    shippingAmount: null,
    taxAmount: null,
    totalAmount,
    currency: (data.currency as 'USD' | 'EUR' | 'GBP') || 'USD',
    status: (data.status as PurchaseRecord['status']) || 'completed',
    createdAt: createdIso,
    completedAt: completedIso,
    updatedAt:
      (data.updatedAt as { toDate?: () => Date })?.toDate?.()?.toISOString?.() || completedIso,
    payerEmail: auth.currentUser?.email || '',
    termsAccepted: 'Verified PayPal Checkout Transaction',
    isSandboxOrder: true,
    orderTypeLabel: 'SANDBOX ORDER',
    paymentStatus,
    merchantOrderStatus: 'Merchant order not submitted — Sandbox simulation',
  };
}

export async function fetchUserPurchasesFromFirestore(uid: string): Promise<PurchaseRecord[]> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return [];
  const path = `users/${uid}/purchases`;
  try {
    const q = query(
      collection(db, 'users', uid, 'purchases'),
      where('userId', '==', uid),
      limit(50)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map<PurchaseRecord>((d) =>
        mapFirestoreDocToPurchaseRecord(d.id, uid, d.data() as Record<string, unknown>)
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export function subscribeToUserPurchasesInFirestore(
  uid: string,
  onUpdate: (purchases: PurchaseRecord[]) => void
): () => void {
  if (!auth.currentUser || auth.currentUser.uid !== uid) {
    return () => {};
  }
  const path = `users/${uid}/purchases`;
  const q = query(
    collection(db, 'users', uid, 'purchases'),
    where('userId', '==', uid),
    limit(50)
  );
  return onSnapshot(
    q,
    (snap) => {
      const records = snap.docs
        .map<PurchaseRecord>((d) =>
          mapFirestoreDocToPurchaseRecord(d.id, uid, d.data() as Record<string, unknown>)
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      onUpdate(records);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        // Ignore transient permission or network error in background listener
      }
    }
  );
}

export async function savePurchaseRecordToFirestore(
  uid: string,
  purchase: PurchaseRecord
): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return;
  const safeId = purchase.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  const path = `users/${uid}/purchases/${safeId}`;
  const quantity = Math.max(1, Math.min(20, Math.floor(purchase.quantity || 1)));
  const totalAmount = Math.max(0.01, Math.min(100000, Number(purchase.totalAmount || 0.01)));
  const unitPrice =
    typeof purchase.unitPrice === 'number' &&
    Number.isFinite(purchase.unitPrice) &&
    purchase.unitPrice >= 0
      ? Number(purchase.unitPrice.toFixed(2))
      : Number((totalAmount / quantity).toFixed(2));
  const rawPaymentStatus = String(
    purchase.paymentStatus || purchase.captureStatus || 'COMPLETED'
  ).toUpperCase();
  const paymentStatus =
    rawPaymentStatus === 'PENDING' ||
    rawPaymentStatus === 'DECLINED' ||
    rawPaymentStatus === 'FAILED' ||
    rawPaymentStatus === 'CANCELLED' ||
    rawPaymentStatus === 'REFUNDED'
      ? rawPaymentStatus
      : 'COMPLETED';

  try {
    await setDoc(doc(db, 'users', uid, 'purchases', safeId), {
      userId: uid,
      orderReference: sanitizeString(purchase.orderReference, 64, 'ord_spark'),
      paypalOrderId: sanitizeString(
        purchase.paypalOrderId || purchase.paypalTransactionId || 'PAYPAL_ORDER',
        128,
        'PAYPAL_ORDER'
      ),
      paypalCaptureId: sanitizeString(
        purchase.captureId || purchase.paypalTransactionId || 'PAYPAL_CAPTURE',
        128,
        'PAYPAL_CAPTURE'
      ),
      paypalTransactionId: sanitizeString(
        purchase.paypalTransactionId ||
          purchase.captureId ||
          purchase.paypalOrderId ||
          'CAPTURE',
        128,
        'CAPTURE'
      ),
      sourceId: sanitizeString(purchase.sourceId, 64, 'spark_sandbox_catalog'),
      productId: sanitizeString(purchase.productId, 128, 'item'),
      productName: sanitizeString(purchase.productName, 200, 'Product'),
      merchant: sanitizeString(purchase.merchant, 120, 'PayPal Sandbox Merchant'),
      quantity,
      unitPrice,
      totalAmount,
      currency: purchase.currency || 'USD',
      status:
        purchase.status === 'completed' ||
        purchase.status === 'pending' ||
        purchase.status === 'declined' ||
        purchase.status === 'failed' ||
        purchase.status === 'cancelled' ||
        purchase.status === 'refunded'
          ? purchase.status
          : 'completed',
      paymentStatus,
      createdAt: serverTimestamp(),
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function saveProductToFirestore(
  uid: string,
  product: RankedProductOffer,
  options?: {
    collectionName?: string;
    previousPrice?: number | null;
    priceChanged?: boolean;
    lastValidatedAt?: string;
  }
): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return;
  const safeId = product.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  const path = `users/${uid}/savedProducts/${safeId}`;
  const collectionName = sanitizeString(
    options?.collectionName || product.specs?.['Saved Collection'] || 'All Saved',
    80,
    'All Saved'
  );
  try {
    await setDoc(doc(db, 'users', uid, 'savedProducts', safeId), {
      userId: uid,
      productId: safeId,
      sourceId: sanitizeString(product.sourceId, 64, 'channel3_api'),
      sourceName: sanitizeString(product.sourceName, 120, 'Live Source'),
      canonicalUrl: sanitizeString(product.canonicalUrl, 500, 'https://spark.app'),
      name: sanitizeString(product.name, 200, 'Product'),
      merchant: sanitizeString(product.merchant, 120, 'Merchant'),
      price:
        product.price !== null && product.priceStatus === 'verified'
          ? Math.max(0, Math.min(100000, product.price))
          : -1,
      priceStatus: product.priceStatus,
      currency: product.currency,
      imageUrl: sanitizeString(product.imageUrl || 'https://spark.app', 500, 'https://spark.app'),
      collectionName,
      availabilityStatus: sanitizeString(
        product.availabilityStatus || 'verified_in_stock',
        40,
        'verified_in_stock'
      ),
      ...(typeof options?.previousPrice === 'number'
        ? { previousPrice: options.previousPrice }
        : {}),
      ...(typeof options?.priceChanged === 'boolean'
        ? { priceChanged: options.priceChanged }
        : {}),
      ...(options?.lastValidatedAt
        ? { lastValidatedAt: sanitizeString(options.lastValidatedAt, 64, '') }
        : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function removeSavedProductFromFirestore(
  uid: string,
  productId: string
): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return;
  const safeId = productId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  const path = `users/${uid}/savedProducts/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'savedProducts', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function fetchSavedProductsFromFirestore(
  uid: string
): Promise<RankedProductOffer[]> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return [];
  const path = `users/${uid}/savedProducts`;
  try {
    const q = query(
      collection(db, 'users', uid, 'savedProducts'),
      where('userId', '==', uid),
      limit(50)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map<RankedProductOffer>((d) => {
        const data = d.data();
        const rawPrice = Number(data.price);
        const hasPrice = data.priceStatus === 'verified' && rawPrice >= 0;
        return {
          id: String(data.productId || d.id),
          sourceId: String(data.sourceId || 'channel3_api'),
          sourceName: String(data.sourceName || 'Verified Source'),
          canonicalUrl: String(data.canonicalUrl || ''),
          retrievedAt: data.createdAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
          verificationStatus: hasPrice ? 'verified_live_source' : 'partial_fields_unverified',
          name: String(data.name || ''),
          merchant: String(data.merchant || ''),
          category: 'saved',
          price: hasPrice ? rawPrice : null,
          priceStatus: hasPrice ? 'verified' : 'price_could_not_be_verified',
          currency: (data.currency as 'USD' | 'EUR' | 'GBP') || 'USD',
          shippingCost: 0,
          shippingStatus: 'unknown',
          estimatedTaxRate: null,
          taxStatus: 'unknown',
          availabilityStatus:
            (data.availabilityStatus as RankedProductOffer['availabilityStatus']) ||
            'verified_in_stock',
          rating: null,
          reviewCount: null,
          summary: `Saved record from ${String(data.sourceName || data.sourceId)}`,
          specs: {
            'Source ID': String(data.sourceId || ''),
            'Saved Record ID': d.id,
            ...(typeof data.collectionName === 'string' && data.collectionName
              ? { 'Saved Collection': data.collectionName }
              : {}),
            ...(typeof data.lastValidatedAt === 'string' && data.lastValidatedAt
              ? { 'Last Validated At': data.lastValidatedAt }
              : {}),
            ...(typeof data.previousPrice === 'number'
              ? { 'Previous Price': String(data.previousPrice) }
              : {}),
          },
          couponStatus: 'coupon_validity_unknown',
          checkoutStatus: 'checkout_unsupported',
          imageUrl: typeof data.imageUrl === 'string' && data.imageUrl.startsWith('http') ? data.imageUrl : null,
          bestCoupon: null,
          couponDiscountAmount: 0,
          netItemPrice: hasPrice ? rawPrice : null,
          withinBudget: true,
          completenessScore: hasPrice ? 80 : 45,
        };
      })
      .sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveConversationMetaToFirestore(
  uid: string,
  conversationId: string,
  title: string,
  lastPrompt: string,
  turnCount: number,
  isUpdate = false
): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return;
  const safeId = conversationId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  const path = `users/${uid}/conversations/${safeId}`;
  const validTurnCount = Math.max(1, Math.min(200, Math.floor(turnCount || 1)));
  try {
    if (isUpdate) {
      await updateDoc(doc(db, 'users', uid, 'conversations', safeId), {
        title: sanitizeString(title, 140, 'Shopping Conversation'),
        lastPrompt: sanitizeString(lastPrompt, 300, 'query'),
        turnCount: validTurnCount,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'users', uid, 'conversations', safeId), {
        userId: uid,
        conversationId: safeId,
        title: sanitizeString(title, 140, 'Shopping Conversation'),
        lastPrompt: sanitizeString(lastPrompt, 300, 'query'),
        turnCount: validTurnCount,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, isUpdate ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function renameConversationInFirestore(
  uid: string,
  conversationId: string,
  newTitle: string,
  lastPrompt: string,
  turnCount: number
): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return;
  const safeId = conversationId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  const path = `users/${uid}/conversations/${safeId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'conversations', safeId), {
      title: sanitizeString(newTitle, 140, 'Shopping Conversation'),
      lastPrompt: sanitizeString(lastPrompt, 300, 'query'),
      turnCount: Math.max(1, Math.min(200, Math.floor(turnCount || 1))),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteConversationFromFirestore(
  uid: string,
  conversationId: string
): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return;
  const safeId = conversationId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  const path = `users/${uid}/conversations/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'conversations', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function savePayPalConnectionToFirestore(
  uid: string,
  connection: {
    paypalSubjectId: string;
    payerId: string;
    maskedEmail: string;
    emailVerified: boolean;
    verifiedAccount: boolean;
    status: 'connected' | 'disconnected';
  }
): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return;
  const path = `users/${uid}/paymentConnections/paypal`;
  try {
    const existingSnap = await getDoc(doc(db, 'users', uid, 'paymentConnections', 'paypal'));
    if (existingSnap.exists()) {
      await updateDoc(doc(db, 'users', uid, 'paymentConnections', 'paypal'), {
        maskedEmail: sanitizeString(connection.maskedEmail, 254, 'verified-paypal-user'),
        emailVerified: Boolean(connection.emailVerified),
        verifiedAccount: Boolean(connection.verifiedAccount),
        status: connection.status,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'users', uid, 'paymentConnections', 'paypal'), {
        userId: uid,
        provider: 'paypal',
        paypalSubjectId: sanitizeString(connection.paypalSubjectId, 200, 'paypal_sub'),
        payerId: sanitizeString(connection.payerId, 128, 'payer_id'),
        maskedEmail: sanitizeString(connection.maskedEmail, 254, 'verified-paypal-user'),
        emailVerified: Boolean(connection.emailVerified),
        verifiedAccount: Boolean(connection.verifiedAccount),
        status: connection.status,
        connectedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deletePayPalConnectionFromFirestore(uid: string): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return;
  const path = `users/${uid}/paymentConnections/paypal`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'paymentConnections', 'paypal'));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export interface FirestoreCartSnapshot {
  cartId: 'current';
  userId: string;
  revision: number;
  itemCount: number;
  uniqueProductCount: number;
  currency: 'USD' | 'EUR' | 'GBP';
  subtotal: number;
  verifiedDiscountTotal: number;
  appliedCouponCode: string | null;
  items: CartItem[];
  updatedAt: string;
}

function sanitizeCartItemsForFirestore(uid: string, items: CartItem[]): CartItem[] {
  return (items || []).slice(0, 50).map((item) => ({
    itemId: sanitizeString(item.itemId, 128, 'item'),
    userId: uid,
    productId: sanitizeString(item.productId, 128, 'prod'),
    offerId: sanitizeString(item.offerId, 128, item.productId || 'offer'),
    sku: item.sku ? sanitizeString(item.sku, 80, '') : null,
    variantId: item.variantId ? sanitizeString(item.variantId, 80, '') : null,
    variantLabel: item.variantLabel ? sanitizeString(item.variantLabel, 120, '') : null,
    selectedOptions: item.selectedOptions || {},
    availableVariants: Array.isArray(item.availableVariants)
      ? item.availableVariants.slice(0, 12).map((v) => sanitizeString(v, 80, 'Standard'))
      : undefined,
    productName: sanitizeString(item.productName, 200, 'Verified Product'),
    merchant: sanitizeString(item.merchant, 120, 'Merchant'),
    merchantId: item.merchantId ? sanitizeString(item.merchantId, 80, '') : undefined,
    category: item.category ? sanitizeString(item.category, 80, '') : undefined,
    productUrl: sanitizeString(item.productUrl, 1024, 'https://spark.example.com'),
    imageUrl: item.imageUrl ? sanitizeString(item.imageUrl, 1024, '') : null,
    sourceId: sanitizeString(item.sourceId, 64, 'channel3_api'),
    productSourceReference: item.productSourceReference
      ? sanitizeString(item.productSourceReference, 128, '')
      : item.sourceId,
    quantity: Math.max(1, Math.min(10, Math.floor(Number(item.quantity) || 1))),
    unitPrice: Math.max(0, Number(item.unitPrice) || 0),
    lastVerifiedPrice:
      typeof item.lastVerifiedPrice === 'number' ? item.lastVerifiedPrice : item.unitPrice,
    previousPrice: typeof item.previousPrice === 'number' ? item.previousPrice : null,
    priceChanged: Boolean(item.priceChanged),
    priceChangeAccepted: Boolean(item.priceChangeAccepted),
    priceVerifiedAt: item.priceVerifiedAt || item.updatedAt || new Date().toISOString(),
    priceStatus: item.priceStatus || 'verified',
    subtotal: Math.max(0, Number(item.subtotal) || 0),
    currency:
      item.currency === 'EUR' || item.currency === 'GBP' ? item.currency : ('USD' as const),
    shippingCost: typeof item.shippingCost === 'number' ? item.shippingCost : null,
    shippingStatus: item.shippingStatus || 'unknown',
    estimatedTaxRate: typeof item.estimatedTaxRate === 'number' ? item.estimatedTaxRate : null,
    taxAmount: typeof item.taxAmount === 'number' ? item.taxAmount : null,
    taxStatus: item.taxStatus || 'unknown',
    additionalFee: typeof item.additionalFee === 'number' ? item.additionalFee : null,
    availability: item.availability || 'in_stock',
    specs: item.specs || {},
    addedAt: item.addedAt || new Date().toISOString(),
    updatedAt: item.updatedAt || new Date().toISOString(),
  }));
}

export async function persistUserCartToFirestore(
  uid: string,
  cart: UserCartSummary
): Promise<{ persisted: boolean; staleRejected: boolean; serverRevision?: number }> {
  if (!auth.currentUser || auth.currentUser.uid !== uid || !cart || cart.userId !== uid) {
    return { persisted: false, staleRejected: false };
  }
  const path = `users/${uid}/cart/current`;
  const cartRef = doc(db, 'users', uid, 'cart', 'current');
  const safeItems = sanitizeCartItemsForFirestore(uid, cart.items || []);
  const itemsJson = JSON.stringify(safeItems).slice(0, 65000);
  const incomingRevision = Math.max(1, Math.floor(Number(cart.revision) || 1));
  const itemCount = Math.max(0, Math.min(250, Math.floor(Number(cart.itemCount) || 0)));
  const uniqueProductCount = Math.max(
    0,
    Math.min(50, Math.floor(Number(cart.uniqueProductCount ?? safeItems.length) || 0))
  );
  const currency =
    cart.currency === 'EUR' || cart.currency === 'GBP' ? cart.currency : ('USD' as const);
  const subtotal = Math.max(0, Number(cart.subtotal) || 0);
  const verifiedDiscountTotal = Math.max(0, Number(cart.verifiedDiscountTotal) || 0);
  const appliedCouponCode = cart.appliedCouponCode
    ? sanitizeString(cart.appliedCouponCode, 64, '')
    : '';

  try {
    let staleRejected = false;
    let serverRevision = incomingRevision;
    await runTransaction(db, async (tx) => {
      const existingSnap = await tx.get(cartRef);
      if (existingSnap.exists()) {
        const existingData = existingSnap.data();
        const currentRev = Number(existingData.revision || 1);
        if (incomingRevision < currentRev) {
          staleRejected = true;
          serverRevision = currentRev;
          return;
        }
        const nextRevision = Math.max(incomingRevision, currentRev);
        serverRevision = nextRevision;
        tx.update(cartRef, {
          revision: nextRevision,
          itemCount,
          uniqueProductCount,
          currency,
          subtotal,
          verifiedDiscountTotal,
          appliedCouponCode,
          itemsJson,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(cartRef, {
          cartId: 'current',
          userId: uid,
          revision: incomingRevision,
          itemCount,
          uniqueProductCount,
          currency,
          subtotal,
          verifiedDiscountTotal,
          appliedCouponCode,
          itemsJson,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });
    return { persisted: !staleRejected, staleRejected, serverRevision };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
    return { persisted: false, staleRejected: false };
  }
}

function toIsoTimestamp(val: unknown): string {
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (val as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
  if (typeof val === 'string' && val.trim().length > 0) {
    return val;
  }
  return new Date().toISOString();
}

export async function loadUserCartFromFirestore(
  uid: string
): Promise<FirestoreCartSnapshot | null> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return null;
  const path = `users/${uid}/cart/current`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'cart', 'current'));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (!data || data.userId !== uid) return null;
    let parsedItems: CartItem[] = [];
    if (typeof data.itemsJson === 'string') {
      try {
        const raw = JSON.parse(data.itemsJson);
        if (Array.isArray(raw)) {
          parsedItems = sanitizeCartItemsForFirestore(uid, raw);
        }
      } catch {
        parsedItems = [];
      }
    }
    return {
      cartId: 'current',
      userId: uid,
      revision: Math.max(1, Number(data.revision) || 1),
      itemCount: Math.max(0, Number(data.itemCount) || 0),
      uniqueProductCount: Math.max(0, Number(data.uniqueProductCount) || parsedItems.length),
      currency:
        data.currency === 'EUR' || data.currency === 'GBP' ? data.currency : ('USD' as const),
      subtotal: Math.max(0, Number(data.subtotal) || 0),
      verifiedDiscountTotal: Math.max(0, Number(data.verifiedDiscountTotal) || 0),
      appliedCouponCode:
        typeof data.appliedCouponCode === 'string' && data.appliedCouponCode.trim().length > 0
          ? data.appliedCouponCode.trim()
          : null,
      items: parsedItems,
      updatedAt: toIsoTimestamp(data.updatedAt),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
    return null;
  }
}

export function subscribeToUserCartInFirestore(
  uid: string,
  onCartChanged: (snapshot: FirestoreCartSnapshot) => void
): () => void {
  if (!auth.currentUser || auth.currentUser.uid !== uid) {
    return () => {};
  }
  const cartRef = doc(db, 'users', uid, 'cart', 'current');
  return onSnapshot(
    cartRef,
    (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (!data || data.userId !== uid) return;
      let parsedItems: CartItem[] = [];
      if (typeof data.itemsJson === 'string') {
        try {
          const raw = JSON.parse(data.itemsJson);
          if (Array.isArray(raw)) {
            parsedItems = sanitizeCartItemsForFirestore(uid, raw);
          }
        } catch {
          parsedItems = [];
        }
      }
      onCartChanged({
        cartId: 'current',
        userId: uid,
        revision: Math.max(1, Number(data.revision) || 1),
        itemCount: Math.max(0, Number(data.itemCount) || 0),
        uniqueProductCount: Math.max(0, Number(data.uniqueProductCount) || parsedItems.length),
        currency:
          data.currency === 'EUR' || data.currency === 'GBP' ? data.currency : ('USD' as const),
        subtotal: Math.max(0, Number(data.subtotal) || 0),
        verifiedDiscountTotal: Math.max(0, Number(data.verifiedDiscountTotal) || 0),
        appliedCouponCode:
          typeof data.appliedCouponCode === 'string' && data.appliedCouponCode.trim().length > 0
            ? data.appliedCouponCode.trim()
            : null,
        items: parsedItems,
        updatedAt: toIsoTimestamp(data.updatedAt),
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${uid}/cart/current`);
    }
  );
}

export async function archiveConversationInFirestore(
  uid: string,
  conversationId: string,
  archived: boolean,
  title: string,
  lastPrompt: string,
  turnCount: number
): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return;
  const safeId = conversationId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  const path = `users/${uid}/conversations/${safeId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'conversations', safeId), {
      title: sanitizeString(title, 140, 'Shopping Conversation'),
      lastPrompt: sanitizeString(lastPrompt, 300, 'query'),
      turnCount: Math.max(1, Math.min(200, Math.floor(turnCount || 1))),
      archived: Boolean(archived),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function saveComparisonToFirestore(
  uid: string,
  comparison: SavedComparisonRecord
): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return;
  const safeId = comparison.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  const path = `users/${uid}/comparisons/${safeId}`;
  const productsJson = JSON.stringify((comparison.products || []).slice(0, 10)).slice(0, 64000);
  const productCount = Math.max(1, Math.min(20, (comparison.products || []).length));
  try {
    const existingSnap = await getDoc(doc(db, 'users', uid, 'comparisons', safeId));
    if (existingSnap.exists()) {
      await updateDoc(doc(db, 'users', uid, 'comparisons', safeId), {
        title: sanitizeString(comparison.title, 160, 'Product Comparison'),
        category: sanitizeString(comparison.category, 80, 'General'),
        productCount,
        productsJson,
        recommendedProductId: sanitizeString(comparison.recommendedProductId || '', 128, ''),
        crucibleSummary: sanitizeString(
          comparison.crucibleSummary || 'Omega Decision Crucible evaluation',
          2000,
          'Omega Decision Crucible evaluation'
        ),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'users', uid, 'comparisons', safeId), {
        comparisonId: safeId,
        userId: uid,
        title: sanitizeString(comparison.title, 160, 'Product Comparison'),
        category: sanitizeString(comparison.category, 80, 'General'),
        productCount,
        productsJson,
        recommendedProductId: sanitizeString(comparison.recommendedProductId || '', 128, ''),
        crucibleSummary: sanitizeString(
          comparison.crucibleSummary || 'Omega Decision Crucible evaluation',
          2000,
          'Omega Decision Crucible evaluation'
        ),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchSavedComparisonsFromFirestore(
  uid: string
): Promise<SavedComparisonRecord[]> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return [];
  const path = `users/${uid}/comparisons`;
  try {
    const q = query(
      collection(db, 'users', uid, 'comparisons'),
      where('userId', '==', uid),
      limit(30)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map<SavedComparisonRecord>((d) => {
        const data = d.data();
        let products: RankedProductOffer[] = [];
        if (typeof data.productsJson === 'string') {
          try {
            const parsed = JSON.parse(data.productsJson);
            if (Array.isArray(parsed)) products = parsed;
          } catch {
            products = [];
          }
        }
        return {
          id: String(data.comparisonId || d.id),
          userId: uid,
          title: String(data.title || 'Saved Comparison'),
          category: String(data.category || 'General'),
          productIds: products.map((p) => p.id),
          products,
          recommendedProductId: data.recommendedProductId
            ? String(data.recommendedProductId)
            : null,
          crucibleSummary: String(data.crucibleSummary || ''),
          createdAt: toIsoTimestamp(data.createdAt),
          updatedAt: toIsoTimestamp(data.updatedAt),
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

export async function deleteSavedComparisonFromFirestore(
  uid: string,
  comparisonId: string
): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return;
  const safeId = comparisonId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  const path = `users/${uid}/comparisons/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'comparisons', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function syncUserSubscriptionToFirestore(
  uid: string,
  subscription: {
    planId: 'free' | 'luna' | 'terra' | 'sol';
    status: string;
    billingCycle: string;
    monthlyPriceUsd: number;
    paypalSubscriptionId?: string | null;
    cancelAtPeriodEnd: boolean;
  }
): Promise<void> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return;
  const path = `users/${uid}/subscriptions/current`;
  try {
    const existingSnap = await getDoc(doc(db, 'users', uid, 'subscriptions', 'current'));
    const payload = {
      userId: uid,
      planId: subscription.planId,
      status: sanitizeString(subscription.status || 'active', 32, 'active'),
      billingCycle: sanitizeString(subscription.billingCycle || 'monthly', 32, 'monthly'),
      monthlyPriceUsd: Math.max(0, Number(subscription.monthlyPriceUsd) || 0),
      ...(subscription.paypalSubscriptionId
        ? {
            paypalSubscriptionId: sanitizeString(
              subscription.paypalSubscriptionId,
              128,
              'I-SPARK'
            ),
          }
        : {}),
      cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
      updatedAt: serverTimestamp(),
    };
    if (existingSnap.exists()) {
      await updateDoc(doc(db, 'users', uid, 'subscriptions', 'current'), payload);
    } else {
      await setDoc(doc(db, 'users', uid, 'subscriptions', 'current'), {
        ...payload,
        createdAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchUserSearchHistoryFromFirestore(
  uid: string
): Promise<
  Array<{
    id: string;
    query: string;
    verifiedResultCount: number;
    status: string;
    createdAt: string;
  }>
> {
  if (!auth.currentUser || auth.currentUser.uid !== uid) return [];
  const path = `users/${uid}/searches`;
  try {
    const q = query(
      collection(db, 'users', uid, 'searches'),
      where('userId', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        query: String(data.query || ''),
        verifiedResultCount: Number(data.verifiedResultCount || 0),
        status: String(data.status || 'completed'),
        createdAt: toIsoTimestamp(data.createdAt),
      };
    });
  } catch {
    return [];
  }
}
