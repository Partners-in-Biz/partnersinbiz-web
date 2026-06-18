import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { adminAuth } from '@/lib/firebase/admin'
import { BriefingControlDesk } from '@/components/briefing/BriefingControlDesk'

export const dynamic = 'force-dynamic'

export default async function AdminBriefingsPage() {
  const c = await cookies()
  const sc = c.get(process.env.SESSION_COOKIE_NAME ?? '__session')?.value
  if (!sc) redirect('/login')
  let currentUser: { uid: string; displayName: string }
  try {
    const d = await adminAuth.verifySessionCookie(sc, true)
    currentUser = { uid: d.uid, displayName: (d.name as string) ?? (d.email as string) ?? d.uid }
  } catch {
    redirect('/login')
  }
  return <BriefingControlDesk mode="admin" currentUser={currentUser} />
}
