// lib/account/purge.ts
//
// Real account purge helper. Deletes a user's Firestore footprint and Storage
// avatars. Intended to be called by a future cron/job processor once an
// `account_deletions` job has passed its 30-day `purgeAfter` recovery window.
//
// NOTE: there is no queue in this environment. The deletion API records a
// scheduled job with `purgeAfter = requestedAt + 30 days`. A cron processor
// should query `account_deletions` where status == 'scheduled' and
// purgeAfter <= now, then call `purgeAccount(uid)` for each.

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { getStorage } from 'firebase-admin/storage'

export interface AccountDataSummary {
  orgMemberships: number
  ownedOrgs: number
  notifications: number
  apiKeys: number
  hasUserDoc: boolean
}

const USER_SUBCOLLECTIONS = ['notifications', 'sessions', 'apiKeys', 'preferences', 'auditLog']

/**
 * Compute a count of what would be purged for a user. Used to show the data
 * list on the deletion confirmation screen and stored on the job record.
 */
export async function summariseAccountData(uid: string): Promise<AccountDataSummary> {
  const userRef = adminDb.collection('users').doc(uid)
  const [userSnap, memberSnap, notifSnap, keySnap, ownedSnap] = await Promise.all([
    userRef.get(),
    adminDb.collection('orgMembers').where('userId', '==', uid).get(),
    userRef.collection('notifications').limit(1000).get(),
    userRef.collection('apiKeys').limit(1000).get(),
    adminDb.collection('organizations').where('ownerId', '==', uid).get(),
  ])

  return {
    orgMemberships: memberSnap.size,
    ownedOrgs: ownedSnap.size,
    notifications: notifSnap.size,
    apiKeys: keySnap.size,
    hasUserDoc: userSnap.exists,
  }
}

async function deleteSubcollection(uid: string, name: string): Promise<void> {
  const ref = adminDb.collection('users').doc(uid).collection(name)
  while (true) {
    const snap = await ref.limit(400).get()
    if (snap.empty) break
    const batch = adminDb.batch()
    snap.docs.forEach((doc) => batch.delete(doc.ref))
    await batch.commit()
    if (snap.size < 400) break
  }
}

async function deleteStorageAvatars(uid: string): Promise<void> {
  try {
    const bucket = getStorage().bucket()
    await bucket.deleteFiles({ prefix: `avatars/${uid}/` })
    await bucket.deleteFiles({ prefix: `users/${uid}/avatar` })
  } catch (err) {
    // Avatar storage is best-effort — a missing path must not block the purge.
    console.warn('[account-purge] avatar cleanup skipped:', err)
  }
}

/**
 * Permanently purge a user's data. Deletes Firestore docs (users/{uid} and its
 * subcollections, orgMembers where userId==uid), Storage avatars, and the
 * Firebase Auth user. Callable by a future cron after the recovery window.
 */
export async function purgeAccount(uid: string): Promise<{ uid: string; summary: AccountDataSummary }> {
  const summary = await summariseAccountData(uid)

  // 1. orgMembers where this user is a member
  const memberSnap = await adminDb.collection('orgMembers').where('userId', '==', uid).get()
  for (let i = 0; i < memberSnap.docs.length; i += 400) {
    const batch = adminDb.batch()
    memberSnap.docs.slice(i, i + 400).forEach((doc) => batch.delete(doc.ref))
    await batch.commit()
  }

  // 2. user subcollections
  for (const name of USER_SUBCOLLECTIONS) {
    await deleteSubcollection(uid, name)
  }

  // 3. Storage avatars
  await deleteStorageAvatars(uid)

  // 4. user doc
  await adminDb.collection('users').doc(uid).delete().catch(() => {})

  // 5. Firebase Auth user
  await adminAuth.deleteUser(uid).catch((err) => {
    console.warn('[account-purge] auth deleteUser skipped:', err)
  })

  return { uid, summary }
}
