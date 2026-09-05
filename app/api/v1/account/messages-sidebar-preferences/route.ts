import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiError, apiSuccess } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import type { ApiUser } from '@/lib/api/types'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { normalizePinnedBotId, PINNED_BOT_ID_RE } from '@/lib/messages/bot-profile'

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
  const data = snapshot.data()
  const hiddenFolderKeys = normalizeHiddenMessagesFolderKeys(data?.hiddenFolderKeys)
  const pinnedBotId = normalizePinnedBotId(data?.pinnedBotId)
  return apiSuccess({ hiddenFolderKeys, pinnedBotId })
})

export const POST = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const scope = resolveOrgScope(user, new URL(req.url).searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)
  const { orgId } = scope

  const body = await req.json().catch(() => ({})) as { hiddenFolderKeys?: unknown; pinnedBotId?: unknown }
  const hasHiddenFolders = body.hiddenFolderKeys !== undefined
  const hasPinnedBot = Object.prototype.hasOwnProperty.call(body, 'pinnedBotId')
  if (!hasHiddenFolders && !hasPinnedBot) {
    return apiError('hiddenFolderKeys array or pinnedBotId is required', 400)
  }

  const patch: Record<string, unknown> = {
    orgId,
    uid: user.uid,
    updatedAt: FieldValue.serverTimestamp(),
  }

  if (hasHiddenFolders) {
    if (!Array.isArray(body.hiddenFolderKeys)) {
      return apiError('hiddenFolderKeys array is required', 400)
    }
    if (body.hiddenFolderKeys.length > MAX_HIDDEN_FOLDERS) {
      return apiError(`hiddenFolderKeys cannot contain more than ${MAX_HIDDEN_FOLDERS} items`, 400)
    }
    if (body.hiddenFolderKeys.some((entry) => typeof entry !== 'string' || !HIDEABLE_FOLDER_KEY.test(entry))) {
      return apiError('Only workspace and agent folders can be hidden', 400)
    }
    patch.hiddenFolderKeys = normalizeHiddenMessagesFolderKeys(body.hiddenFolderKeys)
  }

  if (hasPinnedBot) {
    if (body.pinnedBotId !== null && (typeof body.pinnedBotId !== 'string' || !PINNED_BOT_ID_RE.test(body.pinnedBotId))) {
      return apiError('pinnedBotId must be a bot id or null', 400)
    }
    patch.pinnedBotId = body.pinnedBotId
  }

  const ref = preferenceRef(user.uid, orgId)
  await ref.set(patch, { merge: true })
  const saved = (await ref.get()).data()

  return apiSuccess({
    hiddenFolderKeys: normalizeHiddenMessagesFolderKeys(saved?.hiddenFolderKeys),
    pinnedBotId: normalizePinnedBotId(saved?.pinnedBotId),
  })
})
