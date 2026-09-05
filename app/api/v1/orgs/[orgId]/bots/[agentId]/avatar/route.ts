/**
 * POST /api/v1/orgs/[orgId]/bots/[agentId]/avatar — upload a still (png/jpg/webp, gif loop) for a Bot
 * multipart/form-data: file
 */
import { NextRequest } from 'next/server'
import { getStorage } from 'firebase-admin/storage'
import crypto from 'node:crypto'
import { getAdminApp } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiError, apiSuccess } from '@/lib/api/response'
import type { ApiUser } from '@/lib/api/types'
import { saveBotAppearance } from '@/lib/agents/bot-appearance'
import { resolveBotProfileAccess } from '@/lib/agents/bot-profile-access'
import { BOT_AVATAR_MAX_BYTES, isBotAvatarMimeAllowed } from '@/lib/messages/bot-profile'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ orgId: string; agentId: string }> }

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export const POST = withAuth(
  'client',
  async (req: NextRequest, user: ApiUser, context?: unknown) => {
    const { orgId: orgIdParam, agentId } = await (context as Params).params
    const scope = resolveOrgScope(user, orgIdParam)
    if (!scope.ok) return apiError(scope.error, scope.status)

    const formData = await req.formData().catch(() => null)
    if (!formData) return apiError('Invalid form data', 400)
    const file = formData.get('file')
    if (!(file instanceof Blob)) return apiError('No file provided', 400)
    const mime = file.type.toLowerCase()
    if (!isBotAvatarMimeAllowed(mime)) return apiError('Use a PNG, JPG, WebP, or GIF image', 400)
    if (file.size > BOT_AVATAR_MAX_BYTES) return apiError('Image is too large. Maximum size is 2MB.', 413)

    const access = await resolveBotProfileAccess({ user, orgId: scope.orgId, botId: agentId })
    if (!access.ok) return apiError(access.error, access.status)
    if (!access.canEditLook) return apiError('You cannot change this Bot\'s look', 403)

    const filename = `bot-avatars/${scope.orgId}/${agentId}/${Date.now()}-${crypto.randomUUID()}.${EXT_BY_MIME[mime]}`
    const buffer = Buffer.from(await file.arrayBuffer())

    try {
      const bucket = getStorage(getAdminApp()).bucket()
      const downloadToken = crypto.randomUUID()
      await bucket.file(filename).save(buffer, {
        metadata: {
          contentType: mime,
          metadata: { firebaseStorageDownloadTokens: downloadToken },
        },
      })
      const avatarUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filename)}?alt=media&token=${downloadToken}`
      const saved = await saveBotAppearance({
        orgId: scope.orgId,
        agentId,
        actorUserId: user.uid,
        avatarUrl,
        avatarStyle: 'image',
      })
      return apiSuccess({ agentId, ...saved })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[bots/avatar] Firebase Storage error:', message)
      return apiError(`Storage error: ${message}`, 500)
    }
  },
)
