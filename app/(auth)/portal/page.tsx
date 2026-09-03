import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { adminAuth, adminDb } from '@/lib/firebase/admin'

export default async function PortalPage() {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(process.env.SESSION_COOKIE_NAME ?? '__session')?.value

  // No session, redirect to login
  if (!sessionCookie) {
    redirect('/login')
  }

  let uid: string
  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true)
    uid = decoded.uid
  } catch {
    redirect('/login')
  }

  // Get the user's document to check their role
  const userDoc = await adminDb.collection('users').doc(uid).get()
  if (!userDoc.exists) {
    redirect('/login')
  }

  // Check the user's role and redirect accordingly
  const userRole = userDoc.data()?.role

  if (userRole === 'admin') {
    redirect('/admin/dashboard')
  }

  // Default to client portal for all other roles
  redirect('/portal/dashboard')

  // This return is never reached if redirect() fires, but it satisfies TypeScript
  return (
    <main className="st-auth-frame">
      <div className="st-auth-form">
        <p className="sc-body">Redirecting to your workspace.</p>
      </div>
    </main>
  )
}
