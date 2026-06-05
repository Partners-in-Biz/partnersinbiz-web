import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { MessagesWorkspace } from '@/components/messages/MessagesWorkspace'

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function MessagesPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const initialConvId = typeof sp.convId === 'string' ? sp.convId : undefined
  const initialAgentId = typeof sp.agent === 'string' ? sp.agent : undefined
  const initialRunId = typeof sp.runId === 'string' ? sp.runId : undefined
  const initialTaskId = typeof sp.taskId === 'string' ? sp.taskId : undefined
  const initialTaskTitle = typeof sp.taskTitle === 'string' ? sp.taskTitle : undefined

  // Auth — same pattern as WorkspaceLayout
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(process.env.SESSION_COOKIE_NAME ?? '__session')?.value
  if (!sessionCookie) redirect('/login')

  let uid: string
  let displayName: string
  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true)
    uid = decoded.uid
    displayName = decoded.name ?? decoded.email ?? uid
  } catch {
    redirect('/login')
  }

  // Resolve org by slug
  const orgSnap = await adminDb
    .collection('organizations')
    .where('slug', '==', slug)
    .get()
  if (orgSnap.empty) redirect('/admin/dashboard')

  const orgId = orgSnap.docs[0].id

  return (
    <MessagesWorkspace
      surface="admin"
      orgId={orgId}
      currentUserUid={uid}
      currentUserDisplayName={displayName}
      orgSlug={slug}
      initialConvId={initialConvId}
      initialAgentId={initialAgentId}
      initialRunId={initialRunId}
      initialTaskId={initialTaskId}
      initialTaskTitle={initialTaskTitle}
    />
  )
}
