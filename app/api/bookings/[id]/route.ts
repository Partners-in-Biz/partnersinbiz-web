import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? '__session'
const VALID_STATUSES = ['completed', 'cancelled']

type Params = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value
  if (!sessionCookie) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let uid: string
  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true)
    uid = decoded.uid
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userDoc = await adminDb.collection('users').doc(uid).get()
  if (!userDoc.exists || userDoc.data()?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { status } = await request.json().catch(() => ({}))
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  await adminDb.collection('bookings').doc(id).update({
    status,
    updatedAt: FieldValue.serverTimestamp(),
  })
  return NextResponse.json({ id, status })
}
