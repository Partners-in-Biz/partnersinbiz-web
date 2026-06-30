import { NextRequest } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ nonce: string }> }

type PendingOption = {
  index: number
  displayName: string
  username: string
  avatarUrl: string
  profileUrl: string
  accountType: 'personal' | 'page'
  platformAccountId: string
  encryptedTokens: unknown
  platformMeta: Record<string, unknown>
}

export const GET = withAuth('client', withTenant(async (_req: NextRequest, user, orgId, context) => {
  const { nonce } = await (context as Params).params
  const doc = await adminDb.collection('social_oauth_pending').doc(nonce).get()

  if (!doc.exists) return apiError('Not found', 404)

  const data = doc.data()!
  if (data.orgId !== orgId) return apiError('Not found', 404)
  if (data.accountScope === 'personal' && data.ownerUid !== user.uid) return apiError('Not found', 404)
  if (data.expiresAt.toDate() < new Date()) return apiError('Not found', 404)

  const options = ((data.options ?? []) as PendingOption[]).map((option) => {
    const copy = { ...option }
    delete copy.encryptedTokens
    return copy
  })

  return apiSuccess({ platform: data.platform, options })
}))
