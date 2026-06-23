// app/api/v1/account/sessions/route.ts
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withPortalAuth } from '@/lib/auth/portal-middleware'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { apiSuccess, apiErrorFromException } from '@/lib/api/response'
import { getClientIp, sessionFingerprint } from '@/lib/auth/session-registry'

export const dynamic = 'force-dynamic'

function tsToMillis(value: unknown): number | null {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis()
  }
  return null
}

export const GET = withPortalAuth(async (req: NextRequest, uid: string) => {
  try {
    const userAgent = req.headers.get('user-agent') || 'Unknown device'
    const ip = getClientIp(req)
    const currentId = sessionFingerprint(userAgent, ip)

    const userRef = adminDb.collection('users').doc(uid)

    // Self-heal: ensure the requesting device shows up in the registry.
    const currentRef = userRef.collection('sessions').doc(currentId)
    const currentDoc = await currentRef.get()
    await currentRef.set(
      {
        userAgent,
        ip,
        revoked: false,
        lastSeenAt: FieldValue.serverTimestamp(),
        ...(currentDoc.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    )

    const snap = await userRef.collection('sessions').get()
    const sessions = snap.docs
      .map((doc) => {
        const d = doc.data()
        return {
          id: doc.id,
          userAgent: d.userAgent ?? 'Unknown device',
          ip: d.ip ?? 'unknown',
          createdAt: tsToMillis(d.createdAt),
          lastSeenAt: tsToMillis(d.lastSeenAt),
          revoked: d.revoked === true,
          current: doc.id === currentId,
        }
      })
      .sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))

    const historySnap = await userRef
      .collection('loginHistory')
      .orderBy('at', 'desc')
      .limit(20)
      .get()
      .catch(() => null)
    const loginHistory = historySnap
      ? historySnap.docs.map((doc) => {
          const d = doc.data()
          return {
            id: doc.id,
            userAgent: d.userAgent ?? '',
            ip: d.ip ?? '',
            event: d.event ?? 'login',
            at: tsToMillis(d.at),
          }
        })
      : []

    return apiSuccess({ sessions, loginHistory })
  } catch (err) {
    return apiErrorFromException(err)
  }
})

export const DELETE = withPortalAuth(async (_req: NextRequest, uid: string) => {
  try {
    // Revoke ALL refresh tokens — forces re-auth everywhere on next token refresh.
    await adminAuth.revokeRefreshTokens(uid)

    const userRef = adminDb.collection('users').doc(uid)
    const snap = await userRef.collection('sessions').get()
    const batch = adminDb.batch()
    snap.docs.forEach((doc) =>
      batch.set(doc.ref, { revoked: true, revokedAt: FieldValue.serverTimestamp() }, { merge: true }),
    )
    await batch.commit()

    return apiSuccess({ revoked: true, count: snap.size })
  } catch (err) {
    return apiErrorFromException(err)
  }
})
