import type { Firestore } from 'firebase-admin/firestore'

export async function resolveOrgSlugForLink(db: Firestore, orgId: string): Promise<string | null> {
  const cleanOrgId = orgId.trim()
  if (!cleanOrgId) return null

  const directDoc = await db.collection('organizations').doc(cleanOrgId).get()
  const directSlug = directDoc.exists ? directDoc.data()?.slug : null
  if (typeof directSlug === 'string' && directSlug.trim()) return directSlug.trim()

  const byIdSnap = await db
    .collection('organizations')
    .where('orgId', '==', cleanOrgId)
    .limit(1)
    .get()
  const byIdSlug = byIdSnap.docs[0]?.data()?.slug
  if (typeof byIdSlug === 'string' && byIdSlug.trim()) return byIdSlug.trim()

  return null
}

export async function adminProjectTaskLink(args: {
  db: Firestore
  orgId: string
  projectId: string
  taskId: string
}): Promise<string> {
  const orgSlug = await resolveOrgSlugForLink(args.db, args.orgId).catch(() => null)
  const encodedProjectId = encodeURIComponent(args.projectId)
  const encodedTaskId = encodeURIComponent(args.taskId)

  if (orgSlug) {
    return `/admin/org/${encodeURIComponent(orgSlug)}/projects/${encodedProjectId}?taskId=${encodedTaskId}`
  }

  return `/admin/projects?projectId=${encodedProjectId}&taskId=${encodedTaskId}`
}
