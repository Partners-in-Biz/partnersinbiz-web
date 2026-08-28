/**
 * GET  /api/v1/social/accounts  — list connected social accounts
 * POST /api/v1/social/accounts  — create/connect a social account
 */
import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'
import type { AccountStatus } from '@/lib/social/providers'
import { ACTIVE_PLATFORMS } from '@/lib/social/providers'
import { logAudit } from '@/lib/social/audit'
import { isCompanyLinkedAccount, isPersonalAccountRecord, storedAccountTypeForScope, PERSONAL_SCOPE, ORG_SCOPE } from '@/lib/social/account-scope'
import { isLinkedInCmaEnabled } from '@/lib/social/linkedin-cma'

export const dynamic = 'force-dynamic'

const VALID_STATUSES: AccountStatus[] = ['active', 'token_expired', 'disconnected', 'rate_limited']

type SocialAccountDoc = {
  id: string
  data: () => Record<string, unknown>
}

type SocialAccountQuery = {
  where: (fieldPath: string, opStr: FirebaseFirestore.WhereFilterOp, value: unknown) => SocialAccountQuery
  limit: (limit: number) => SocialAccountQuery
  get: () => Promise<{ docs: SocialAccountDoc[] }>
}

function wantsPersonalScope(req: NextRequest): boolean {
  return new URL(req.url).searchParams.get('scope') === PERSONAL_SCOPE
}

function isPersonalAccountForUser(account: Record<string, unknown>, uid: string): boolean {
  return isPersonalAccountRecord(account) && account.ownerUid === uid
}

export const GET = withAuth('client', withTenant(async (req, user, orgId) => {
  const { searchParams } = new URL(req.url)
  const platform = searchParams.get('platform')
  const status = searchParams.get('status') as AccountStatus | null
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))
  const personalScope = wantsPersonalScope(req)

  let query = adminDb.collection('social_accounts')
    .where('orgId', '==', orgId) as unknown as SocialAccountQuery

  if (platform && ACTIVE_PLATFORMS.includes(platform as (typeof ACTIVE_PLATFORMS)[number])) {
    query = query.where('platform', '==', platform)
  }

  if (status && VALID_STATUSES.includes(status)) {
    query = query.where('status', '==', status)
  }

  if (personalScope) {
    query = query.where('accountScope', '==', PERSONAL_SCOPE).where('ownerUid', '==', user.uid)
  }

  query = query.limit((page * limit) + 1)
  const snapshot = await query.get()

  const allAccounts = snapshot.docs.map((doc) => {
    const data = doc.data()
    const safe = { ...data }
    delete safe.encryptedTokens
    return { id: doc.id, ...safe }
  }).filter((account: Record<string, unknown>) => {
    if (personalScope) return isPersonalAccountForUser(account, user.uid)
    return isCompanyLinkedAccount(account)
  })

  const start = (page - 1) * limit
  const accounts = allAccounts.slice(start, start + limit)
  const hasMore = allAccounts.length > start + limit
  const total = hasMore ? start + accounts.length + 1 : start + accounts.length

  return apiSuccess(accounts, 200, { total, page, limit, hasMore, linkedinCmaEnabled: isLinkedInCmaEnabled() })
}))

export const POST = withAuth('client', withTenant(async (req, user, orgId) => {
  const body = await req.json()
  const personalScope = wantsPersonalScope(req)

  if (!body.platform || !ACTIVE_PLATFORMS.includes(body.platform)) {
    return apiError(`platform must be one of: ${ACTIVE_PLATFORMS.join(', ')}`)
  }
  if (!body.displayName || typeof body.displayName !== 'string') {
    return apiError('displayName is required')
  }

  const doc = {
    orgId,
    platform: body.platform,
    platformAccountId: body.platformAccountId ?? '',
    displayName: body.displayName,
    username: body.username ?? '',
    avatarUrl: body.avatarUrl ?? '',
    profileUrl: body.profileUrl ?? '',
    accountType: storedAccountTypeForScope({
      profileType: body.accountType,
      accountScope: personalScope ? PERSONAL_SCOPE : ORG_SCOPE,
      platform: body.platform,
    }),
    status: 'active' as AccountStatus,
    scopes: body.scopes ?? [],
    encryptedTokens: body.encryptedTokens ?? {
      accessToken: '',
      refreshToken: null,
      tokenType: 'bearer',
      expiresAt: null,
      iv: '',
      tag: '',
    },
    platformMeta: body.platformMeta ?? {},
    connectedBy: user.uid,
    ...(personalScope ? { accountScope: PERSONAL_SCOPE, ownerUid: user.uid } : { accountScope: ORG_SCOPE, ownerUid: null }),
    connectedAt: FieldValue.serverTimestamp(),
    lastTokenRefresh: null,
    lastUsed: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }

  const docRef = await adminDb.collection('social_accounts').add(doc)

  await logAudit({
    orgId,
    action: 'account.connected',
    entityType: 'account',
    entityId: docRef.id,
    performedBy: user.uid,
    performedByRole: user.role === 'ai' ? 'ai' : user.role === 'admin' ? 'admin' : 'client',
    details: { platform: body.platform, displayName: body.displayName },
    ip: req.headers.get('x-forwarded-for'),
  })

  return apiSuccess({ id: docRef.id }, 201)
}))
