import { cookies } from 'next/headers'
import { adminAuth } from '@/lib/firebase/admin'

export type WorkspaceUser = { uid: string; orgId: string; displayName: string; email: string }

/**
 * Resolve the current user from the session cookie. orgId precedence:
 * explicit ?orgId (admin cross-client) → user's home org claim → platform org.
 */
export async function resolveWorkspaceUser(orgIdParam?: string | null): Promise<WorkspaceUser | null> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(process.env.SESSION_COOKIE_NAME ?? '__session')?.value
  if (!sessionCookie) return null
  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true)
    const orgId = (orgIdParam && orgIdParam.trim())
      || (decoded.orgId as string | undefined)
      || (process.env.PIB_PLATFORM_ORG_ID ?? '')
    return {
      uid: decoded.uid,
      orgId,
      displayName: (decoded.name as string) ?? (decoded.email as string) ?? decoded.uid,
      email: (decoded.email as string) ?? '',
    }
  } catch {
    return null
  }
}
