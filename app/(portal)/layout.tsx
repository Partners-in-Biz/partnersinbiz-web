import { headers } from 'next/headers'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import PortalLayoutClient from './PortalLayoutClient'
import { getMaintenanceState, isMaintenanceActiveNow, requestBypassesMaintenance } from '@/lib/governance/maintenance'
import { MaintenanceShell } from '@/components/governance/MaintenanceShell'

// Server-side session gate. The proxy only checks that a __session cookie
// EXISTS; without this layout a junk cookie renders the full portal shell
// (admin has had the equivalent check since day one — this brings the two
// surfaces to parity). Data was always API-gated; this gates the shell.
export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = await cookies()
  const cookieName = process.env.SESSION_COOKIE_NAME ?? '__session'
  const sessionCookie = cookieStore.get(cookieName)?.value

  if (!sessionCookie) redirect('/login')

  let uid: string
  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true)
    uid = decoded.uid
  } catch {
    redirect('/login')
  }

  const maintenance = await getMaintenanceState()
  if (isMaintenanceActiveNow(maintenance)) {
    const headerStore = await headers()
    const userDoc = await adminDb.collection('users').doc(uid).get()
    const role = userDoc.exists && userDoc.data()?.role === 'admin' ? 'admin' : 'client'
    if (!requestBypassesMaintenance(headerStore, maintenance, role)) {
      return <MaintenanceShell message={maintenance.message} />
    }
  }

  return <PortalLayoutClient>{children}</PortalLayoutClient>
}
