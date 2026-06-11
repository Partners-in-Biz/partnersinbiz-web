import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { adminAuth } from '@/lib/firebase/admin'
import PortalLayoutClient from './PortalLayoutClient'

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

  try {
    await adminAuth.verifySessionCookie(sessionCookie, true)
  } catch {
    redirect('/login')
  }

  return <PortalLayoutClient>{children}</PortalLayoutClient>
}
