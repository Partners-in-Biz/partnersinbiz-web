import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import { resolveOrgScope } from '@/lib/api/orgScope'

export const dynamic = 'force-dynamic'

const MAX_HIDDEN_FOLDERS = 100
const HIDEABLE_FOLDER_KEY = /^(workspace|agent):[A-Za-z0-9._-]{1,128}$/

export function normalizeHiddenMessagesFolderKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((entry): entry is string =>
    typeof entry === 'string' && HIDEABLE_FOLDER_KEY.test(entry),
  ))).slice(0, MAX_HIDDEN_FOLDERS)
}

function preferenceRef(uid: string, orgId: string) {
  return adminDb
    .collection('users')
    .doc(uid)
    .collection('messagesSidebarPreferences')
    .doc(orgId)
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const scope = resolveOrgScope(user, new URL(req.url).searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)
  const { orgId } = scope

  const snapshot = await preferenceRef(user.uid, orgId).get()
  const hiddenFolderKeys = normalizeHiddenMessagesFolderKeys(snapshot.data()?.hiddenFolderKeys)
  return apiSuccess({ hiddenFolderKeys })
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const scope = resolveOrgScope(user, new URL(req.url).searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)
  const { orgId } = scope

  const body = await req.json().catch(() => ({})) as { hiddenFolderKeys?: unknown }
  if (!Array.isArray(body.hiddenFolderKeys)) {
    return apiError('hiddenFolderKeys array is required', 400)
  }
  if (body.hiddenFolderKeys.length > MAX_HIDDEN_FOLDERS) {
    return apiError(`hiddenFolderKeys cannot contain more than ${MAX_HIDDEN_FOLDERS} items`, 400)
  }
  if (body.hiddenFolderKeys.some((entry) => typeof entry !== 'string' || !HIDEABLE_FOLDER_KEY.test(entry))) {
    return apiError('Only workspace and agent folders can be hidden', 400)
  }

  const hiddenFolderKeys = normalizeHiddenMessagesFolderKeys(body.hiddenFolderKeys)
  await preferenceRef(user.uid, orgId).set({
    orgId,
    uid: user.uid,
    hiddenFolderKeys,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  return apiSuccess({ hiddenFolderKeys })
})
