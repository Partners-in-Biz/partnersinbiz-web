import { cookies } from 'next/headers'

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from './types'

export async function getCurrentAdminUserFromCookies(): Promise<ApiUser | null> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(process.env.SESSION_COOKIE_NAME ?? '__session')?.value
  if (!sessionCookie) return null

  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true)
    const userDoc = await adminDb.collection('users').doc(decoded.uid).get()
    const data = userDoc.exists ? userDoc.data() : null
    if (data?.role !== 'admin') return null

    const allowedOrgIds = Array.isArray(data.allowedOrgIds)
      ? data.allowedOrgIds.filter((v: unknown): v is string => typeof v === 'string' && v.length > 0)
      : undefined
    const orgId = typeof data.orgId === 'string' ? data.orgId : undefined

    return {
      uid: decoded.uid,
      role: 'admin',
      orgId,
      allowedOrgIds,
    }
  } catch {
    return null
  }
}
