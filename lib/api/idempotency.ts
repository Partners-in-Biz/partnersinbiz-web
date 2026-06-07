import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import type { ApiUser } from './types'

type IdempotentHandler = (
  req: NextRequest,
  user: ApiUser,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context?: any,
) => Promise<Response>

const WINDOW_MS = 24 * 60 * 60 * 1000 // 24h
const COLLECTION = 'idempotency_keys'

/**
 * Wraps a handler (downstream of `withAuth`) with idempotency caching.
 *
 * If the request carries an `Idempotency-Key` header and the same
 * `${uid}:${pathname}:${key}` tuple has a cached response less than 24h old,
 * that cached `{ responseStatus, responseBody }` is replayed. Otherwise the
 * handler runs, and its response body + status are stored for replay.
 *
 * Without the header, the handler is passed through unchanged.
 *
 * Compose after `withAuth`:
 *
 *   export const POST = withAuth('admin', withIdempotency(async (req, user) => { ... }))
 */
export function withIdempotency(handler: IdempotentHandler): IdempotentHandler {
  return async (req, user, context) => {
    const idempotencyKey = req.headers.get('idempotency-key')
    if (!idempotencyKey) return handler(req, user, context)

    // Firestore document IDs cannot contain '/'. Replace slashes from the
    // pathname so deeper routes (e.g. /api/v1/foo/[id]/bar) don't blow up.
    const safePath = req.nextUrl.pathname.replace(/\//g, '_')
    const cacheKey = `${user.uid}:${safePath}:${idempotencyKey}`
    const docRef = adminDb.collection(COLLECTION).doc(cacheKey)

    const snap = await docRef.get()
    if (snap.exists) {
      const data = snap.data() as
        | {
            responseStatus: number
            responseBody: unknown
            createdAt?: Timestamp
          }
        | undefined
      const createdAtMs = data?.createdAt?.toMillis?.() ?? 0
      const fresh = createdAtMs > 0 && Date.now() - createdAtMs < WINDOW_MS
      if (fresh && data) {
        return NextResponse.json(data.responseBody, { status: data.responseStatus })
      }
    }

    const response = await handler(req, user, context)
    const responseStatus = response.status

    // Clone so the original response body stream stays readable for the caller.
    let responseBody: unknown = null
    try {
      responseBody = await response.clone().json()
    } catch {
      // Non-JSON responses are not cached; just return as-is.
      return response
    }

    await docRef.set({
      key: idempotencyKey,
      userId: user.uid,
      path: req.nextUrl.pathname,
      responseStatus,
      responseBody,
      createdAt: FieldValue.serverTimestamp(),
      // Firestore TTL deletes the doc when expiresAt is reached.
      // Set via gcloud: `gcloud firestore fields ttls update expiresAt \
      //   --collection-group=idempotency_keys --enable-ttl`
      expiresAt: Timestamp.fromMillis(Date.now() + WINDOW_MS),
    })

    return response
  }
}
