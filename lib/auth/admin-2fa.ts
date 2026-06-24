// lib/auth/admin-2fa.ts
//
// Server-side admin 2FA enforcement helpers (US-277).
//
// The pre-existing 2FA gate was CLIENT-SIDE only: a `sessionStorage` flag
// (`pib_2fa_ok`) plus a React overlay. That is trivially bypassable — a user
// can set the flag in devtools, or hit admin API routes directly, and never
// satisfy the TOTP challenge.
//
// This module adds the SERVER-SIDE half:
//
//  1. A signed, HttpOnly verification cookie (`__admin2fa`) minted only after a
//     successful TOTP/backup-code challenge. The admin server layout reads this
//     cookie; if the admin has 2FA enabled but presents no valid cookie, it
//     redirects to the challenge. The cookie is bound to the user's uid and the
//     active session cookie, so it cannot be replayed across users or after the
//     session is revoked.
//
//  2. A failed-attempt lockout (5 fails / 30 min) keyed per-uid in Firestore,
//     so brute-forcing the 6-digit TOTP code is not viable.
//
// No external deps — HMAC-SHA256 via Node crypto, same posture as totp.ts.
import crypto from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'

export const ADMIN_2FA_COOKIE = '__admin2fa'

// Verified sessions stay trusted for 12 hours, then re-challenge.
const VERIFY_TTL_MS = 12 * 60 * 60 * 1000

// Lockout policy.
export const MAX_FAILED_ATTEMPTS = 5
export const LOCKOUT_WINDOW_MS = 30 * 60 * 1000

const LOCKOUT_COLLECTION = 'admin_2fa_lockouts'

/**
 * Secret used to sign the verification cookie. Falls back through the
 * platform's existing server secrets so deployments that already set one of
 * these keep working without new env wiring. There is always at least
 * AI_API_KEY on this platform, so this never silently degrades to an empty key.
 */
function signingSecret(): string {
  const secret =
    process.env.ADMIN_2FA_COOKIE_SECRET ||
    process.env.SESSION_COOKIE_SECRET ||
    process.env.AI_API_KEY ||
    ''
  if (!secret) {
    throw new Error('admin-2fa: no signing secret configured (ADMIN_2FA_COOKIE_SECRET / AI_API_KEY)')
  }
  return secret
}

/**
 * Bind the marker to the active session cookie so a stolen __admin2fa cookie is
 * useless without the matching session, and so the marker dies when the session
 * is rotated/revoked. We hash the session value (never store it raw).
 */
function sessionFingerprint(sessionCookieValue: string): string {
  return crypto.createHash('sha256').update(sessionCookieValue).digest('hex').slice(0, 32)
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', signingSecret()).update(payload).digest('hex')
}

/**
 * Mint a signed verification token for a successful challenge.
 * Format: `<uid>.<sessionFingerprint>.<issuedAtMs>.<hmac>`
 */
export function issueAdmin2faToken(uid: string, sessionCookieValue: string): string {
  const issuedAt = Date.now()
  const fp = sessionFingerprint(sessionCookieValue)
  const payload = `${uid}.${fp}.${issuedAt}`
  return `${payload}.${sign(payload)}`
}

/**
 * Verify a presented token against the current uid + session. Constant-time
 * HMAC comparison; rejects on tamper, wrong user, rotated session, or expiry.
 */
export function verifyAdmin2faToken(
  token: string | undefined,
  uid: string,
  sessionCookieValue: string,
): boolean {
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 4) return false
  const [tokenUid, fp, issuedAtRaw, providedHmac] = parts

  if (tokenUid !== uid) return false
  if (fp !== sessionFingerprint(sessionCookieValue)) return false

  const issuedAt = Number(issuedAtRaw)
  if (!Number.isFinite(issuedAt)) return false
  if (Date.now() - issuedAt > VERIFY_TTL_MS) return false

  const expected = sign(`${tokenUid}.${fp}.${issuedAtRaw}`)
  if (expected.length !== providedHmac.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(providedHmac))
  } catch {
    return false
  }
}

export interface LockoutState {
  /** True if the account is currently locked and challenges must be refused. */
  locked: boolean
  /** Failed attempts counted inside the active window. */
  failedAttempts: number
  /** Attempts remaining before lockout (0 when locked). */
  remainingAttempts: number
  /** Epoch ms when the lockout lifts, when locked. */
  lockedUntil: number | null
}

interface LockoutDoc {
  failedAttempts?: number
  windowStartedAt?: number
  lockedUntil?: number
}

/**
 * Read current lockout state for a uid, transparently expiring stale windows.
 * Pure read — does not record an attempt.
 */
export async function getLockoutState(uid: string): Promise<LockoutState> {
  const snap = await adminDb.collection(LOCKOUT_COLLECTION).doc(uid).get()
  const now = Date.now()
  const data: LockoutDoc = snap.exists ? (snap.data() as LockoutDoc) ?? {} : {}

  if (typeof data.lockedUntil === 'number' && data.lockedUntil > now) {
    return { locked: true, failedAttempts: MAX_FAILED_ATTEMPTS, remainingAttempts: 0, lockedUntil: data.lockedUntil }
  }

  // Window expired → no active failures.
  if (typeof data.windowStartedAt !== 'number' || now - data.windowStartedAt > LOCKOUT_WINDOW_MS) {
    return { locked: false, failedAttempts: 0, remainingAttempts: MAX_FAILED_ATTEMPTS, lockedUntil: null }
  }

  const failed = typeof data.failedAttempts === 'number' ? data.failedAttempts : 0
  return {
    locked: false,
    failedAttempts: failed,
    remainingAttempts: Math.max(0, MAX_FAILED_ATTEMPTS - failed),
    lockedUntil: null,
  }
}

/**
 * Record a failed attempt and return the resulting state. Locks the account for
 * LOCKOUT_WINDOW_MS once MAX_FAILED_ATTEMPTS is reached inside the window.
 */
export async function recordFailedAttempt(uid: string): Promise<LockoutState> {
  const ref = adminDb.collection(LOCKOUT_COLLECTION).doc(uid)
  const now = Date.now()

  return adminDb.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    const data: LockoutDoc = snap.exists ? (snap.data() as LockoutDoc) ?? {} : {}

    // Already locked — keep it locked, do not extend.
    if (typeof data.lockedUntil === 'number' && data.lockedUntil > now) {
      return { locked: true, failedAttempts: MAX_FAILED_ATTEMPTS, remainingAttempts: 0, lockedUntil: data.lockedUntil }
    }

    const windowActive = typeof data.windowStartedAt === 'number' && now - data.windowStartedAt <= LOCKOUT_WINDOW_MS
    const windowStartedAt = windowActive ? (data.windowStartedAt as number) : now
    const failedAttempts = (windowActive ? data.failedAttempts ?? 0 : 0) + 1

    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
      const lockedUntil = now + LOCKOUT_WINDOW_MS
      txn.set(ref, {
        failedAttempts,
        windowStartedAt,
        lockedUntil,
        updatedAt: FieldValue.serverTimestamp(),
      })
      return { locked: true, failedAttempts, remainingAttempts: 0, lockedUntil }
    }

    txn.set(ref, {
      failedAttempts,
      windowStartedAt,
      lockedUntil: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return {
      locked: false,
      failedAttempts,
      remainingAttempts: Math.max(0, MAX_FAILED_ATTEMPTS - failedAttempts),
      lockedUntil: null,
    }
  })
}

/** Clear lockout state after a successful challenge. */
export async function clearFailedAttempts(uid: string): Promise<void> {
  await adminDb.collection(LOCKOUT_COLLECTION).doc(uid).delete().catch(() => {})
}

/** Cookie options for the verification marker (HttpOnly, Lax, secure in prod). */
export function admin2faCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.floor(VERIFY_TTL_MS / 1000),
  }
}
