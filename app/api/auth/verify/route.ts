import { NextRequest, NextResponse } from 'next/server'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { isSuperAdmin } from '@/lib/api/platformAdmin'

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? '__session'

export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(COOKIE_NAME)?.value
  if (!cookie) {
    return NextResponse.json({ error: 'No cookie' }, { status: 401 })
  }
  try {
    const decoded = await adminAuth.verifySessionCookie(cookie, true)
    const userDoc = await adminDb.collection('users').doc(decoded.uid).get()
    const data = userDoc.exists ? userDoc.data() : null
    const role = data?.role ?? 'client'
    const name = typeof data?.name === 'string' ? data.name : null
    const email = typeof data?.email === 'string' ? data.email : decoded.email ?? null
    const allowedOrgIds = Array.isArray(data?.allowedOrgIds)
      ? data.allowedOrgIds.filter((v: unknown): v is string => typeof v === 'string' && v.length > 0)
      : undefined
    return NextResponse.json({
      uid: decoded.uid,
      role,
      name,
      email,
      isSuperAdmin: isSuperAdmin({ uid: decoded.uid, role, allowedOrgIds }),
    })
  } catch {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }
}

export async function POST(request: NextRequest) {
  const { sessionCookie } = await request.json()
  if (!sessionCookie) {
    return NextResponse.json({ error: 'No cookie' }, { status: 401 })
  }
  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true)
    const userDoc = await adminDb.collection('users').doc(decoded.uid).get()
    const data = userDoc.exists ? userDoc.data() : null
    const role = data?.role ?? 'client'
    const name = typeof data?.name === 'string' ? data.name : null
    const email = typeof data?.email === 'string' ? data.email : decoded.email ?? null
    const allowedOrgIds = Array.isArray(data?.allowedOrgIds)
      ? data.allowedOrgIds.filter((v: unknown): v is string => typeof v === 'string' && v.length > 0)
      : undefined
    return NextResponse.json({
      uid: decoded.uid,
      role,
      name,
      email,
      isSuperAdmin: isSuperAdmin({ uid: decoded.uid, role, allowedOrgIds }),
    })
  } catch {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }
}
