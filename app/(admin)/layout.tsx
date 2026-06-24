import { Suspense } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { AdminShell } from '@/components/admin/AdminShell'
import { AdminTwoFactorGate } from '@/components/admin/AdminTwoFactorGate'
import { headers } from 'next/headers'
import { OrgProvider } from '@/lib/contexts/OrgContext'
import { LastPathTracker } from '@/components/pwa/LastPathTracker'
import { AdminRouteOrgSync } from '@/components/admin/AdminRouteOrgSync'
import { ADMIN_2FA_COOKIE, verifyAdmin2faToken } from '@/lib/auth/admin-2fa'

const ADMIN_MATERIAL_SYMBOLS =
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap'

export default async function AdminLayout({
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

  const userDoc = await adminDb.collection('users').doc(uid).get()
  const role = userDoc.exists ? userDoc.data()?.role : 'client'
  const email = userDoc.exists ? userDoc.data()?.email : ''

  if (role !== 'admin') redirect('/admin-access-denied')

  // US-277: SERVER-SIDE 2FA enforcement.
  //
  // The client AdminTwoFactorGate is bypassable (its sessionStorage flag can be
  // forged). Here we enforce on the server: if this admin has 2FA enabled but
  // the current session presents no valid signed verification cookie, force a
  // re-challenge. We only ever redirect admins who have ALREADY set up 2FA, so
  // password-only admins are never blocked.
  const twoFactorEnabled = userDoc.exists ? userDoc.data()?.twoFactor?.enabled === true : false

  if (twoFactorEnabled) {
    const verificationCookie = cookieStore.get(ADMIN_2FA_COOKIE)?.value
    const verified = verifyAdmin2faToken(verificationCookie, uid, sessionCookie)

    if (!verified) {
      // FAIL CLOSED. The trusted `x-pathname` header is stamped server-side by
      // middleware.ts for every `/admin/*` request, so we can reliably detect
      // the challenge page and avoid a redirect loop. If the path genuinely
      // cannot be determined we still redirect (the admin shell must never
      // render without a satisfied challenge) — the only path we skip is the
      // challenge page itself.
      const hdrs = await headers()
      const currentPath =
        hdrs.get('x-pathname') ||
        hdrs.get('next-url') ||
        hdrs.get('x-invoke-path') ||
        ''
      const onChallengePage = currentPath.startsWith('/admin/2fa')

      if (!onChallengePage) {
        const returnTo = currentPath || '/admin'
        redirect(`/admin/2fa?challenge=1&returnTo=${encodeURIComponent(returnTo)}`)
      }
    }
  }

  return (
    <>
      <link rel="stylesheet" href={ADMIN_MATERIAL_SYMBOLS} />
      <OrgProvider>
        <AdminRouteOrgSync />
        <AdminTwoFactorGate />
        <Suspense fallback={null}>
          <LastPathTracker />
        </Suspense>
        <AdminShell userEmail={email} userUid={uid}>{children}</AdminShell>
      </OrgProvider>
    </>
  )
}
