import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { enforcePublicRateLimit, publicRequestIp } from '@/lib/api/public-rate-limit'

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? '__session'
const EXPIRY_DAYS = parseInt(process.env.SESSION_EXPIRY_DAYS ?? '14')
const EXPIRY_MS = EXPIRY_DAYS * 24 * 60 * 60 * 1000
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'peet.stander@partnersinbiz.online'

export async function POST(request: NextRequest) {
  // PUBLIC: browser session minting endpoint for Firebase-authenticated users.
  const ip = publicRequestIp(request)
  const ipLimited = await enforcePublicRateLimit(request, {
    key: `auth_session:${ip}`,
    limit: 20,
    windowMs: 15 * 60 * 1000,
  })
  if (ipLimited) return ipLimited

  const { idToken } = await request.json()
  if (!idToken) {
    return NextResponse.json({ error: 'idToken required' }, { status: 400 })
  }
  try {
    const decoded = await adminAuth.verifyIdToken(idToken)
    const uidLimited = await enforcePublicRateLimit(request, {
      key: `auth_session_uid:${decoded.uid}`,
      limit: 30,
      windowMs: 15 * 60 * 1000,
    })
    if (uidLimited) return uidLimited

    const sessionCookie = await adminAuth.createSessionCookie(idToken, { expiresIn: EXPIRY_MS })

    // Bootstrap user document in Firestore
    const userRef = adminDb.collection('users').doc(decoded.uid)
    const userDoc = await userRef.get()
    const isAdmin = decoded.email === ADMIN_EMAIL

    if (!userDoc.exists) {
      await userRef.set({
        email: decoded.email ?? '',
        name: decoded.name ?? decoded.email ?? '',
        role: isAdmin ? 'admin' : 'client',
        createdAt: FieldValue.serverTimestamp(),
      })
    } else if (isAdmin && userDoc.data()?.role !== 'admin') {
      // Promote to admin based on ADMIN_EMAIL match
      await userRef.update({ role: 'admin' })
    }
    // If doc exists and user already has admin role (manually assigned), no action needed — preserve it

    const response = NextResponse.json({ status: 'ok' })
    response.cookies.set(COOKIE_NAME, sessionCookie, {
      maxAge: EXPIRY_MS / 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      sameSite: 'lax',
    })
    return response
  } catch (err: any) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }
}

export async function DELETE() {
  const response = NextResponse.json({ status: 'ok' })
  response.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' })
  return response
}
