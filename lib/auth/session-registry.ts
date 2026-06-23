// lib/auth/session-registry.ts
// Lightweight session registry stored under users/{uid}/sessions and
// users/{uid}/loginHistory. Firebase session cookies are opaque, so this is a
// best-effort registry of device/UA/IP records that the portal can display and
// individually mark revoked. Revoke-all maps onto adminAuth.revokeRefreshTokens.
import crypto from 'crypto'
import type { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'

export type SessionRecord = {
  id: string
  userAgent: string
  ip: string
  createdAt: number | null
  lastSeenAt: number | null
  current: boolean
  revoked: boolean
}

/** Extract the best-guess client IP from a request's forwarding headers. */
export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

/** Stable per-device fingerprint so repeated logins from one device coalesce. */
export function sessionFingerprint(userAgent: string, ip: string): string {
  return crypto.createHash('sha256').update(`${userAgent}|${ip}`).digest('hex').slice(0, 24)
}

/**
 * Record (or refresh) a session for a user and append a login-history entry.
 * Intended to be called from the login/session-creation route by another agent;
 * it does not itself create or read the Firebase session cookie.
 *
 * Wiring note: call `await recordSession(uid, req)` inside the POST handler of
 * app/api/v1/portal/session/route.ts (or wherever the __session cookie is minted)
 * right after the session cookie is successfully created.
 */
export async function recordSession(uid: string, req: NextRequest): Promise<string> {
  const userAgent = req.headers.get('user-agent') || 'Unknown device'
  const ip = getClientIp(req)
  const id = sessionFingerprint(userAgent, ip)

  const sessionRef = adminDb.collection('users').doc(uid).collection('sessions').doc(id)
  const existing = await sessionRef.get()

  await sessionRef.set(
    {
      userAgent,
      ip,
      revoked: false,
      lastSeenAt: FieldValue.serverTimestamp(),
      ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true },
  )

  await adminDb
    .collection('users')
    .doc(uid)
    .collection('loginHistory')
    .add({
      userAgent,
      ip,
      sessionId: id,
      at: FieldValue.serverTimestamp(),
    })

  return id
}

/** Mark a single session record as revoked (does not invalidate the cookie itself). */
export async function revokeSessionRecord(uid: string, sessionId: string): Promise<void> {
  await adminDb
    .collection('users')
    .doc(uid)
    .collection('sessions')
    .doc(sessionId)
    .set({ revoked: true, revokedAt: FieldValue.serverTimestamp() }, { merge: true })
}
