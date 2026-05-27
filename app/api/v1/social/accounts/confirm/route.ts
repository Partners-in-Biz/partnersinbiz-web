import { NextRequest } from 'next/server'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { withTenant } from '@/lib/api/tenant'
import { apiSuccess, apiError } from '@/lib/api/response'

export const dynamic = 'force-dynamic'
const PERSONAL_SCOPE = 'personal'

interface PendingOption {
  platformAccountId: string
  displayName: string
  username: string
  avatarUrl: string
  profileUrl: string
  accountType: 'personal' | 'page'
  scopes?: string[]
  encryptedTokens?: { expiresAt?: Date | { seconds: number } | null; [key: string]: unknown }
  platformMeta?: Record<string, unknown>
}

export const POST = withAuth('client', withTenant(async (req: NextRequest, user: any, orgId: string) => {
  const body = await req.json()
  const { nonce, selections } = body as {
    nonce: string
    selections: Array<{ index: number; isDefault: boolean }>
  }

  if (!nonce || !Array.isArray(selections) || selections.length === 0) {
    return apiError('nonce and selections are required', 400)
  }

  const defaultCount = selections.filter(s => s.isDefault).length
  if (defaultCount > 1) return apiError('Only one default allowed per platform', 400)

  const pendingDoc = await adminDb.collection('social_oauth_pending').doc(nonce).get()
  if (!pendingDoc.exists) return apiError('Pending selection not found or expired', 404)

  const pending = pendingDoc.data()!
  if (pending.orgId !== orgId) return apiError('Not found', 404)
  const personalScope = pending.accountScope === PERSONAL_SCOPE
  if (personalScope && pending.ownerUid !== user?.uid) return apiError('Not found', 404)
  if (pending.expiresAt.toDate() < new Date()) return apiError('Not found', 404)

  const platform: string = pending.platform
  const options = (pending.options ?? []) as PendingOption[]

  // Pre-validate all selection indexes and accountType values before writing
  for (const sel of selections) {
    if (!options[sel.index]) return apiError(`Invalid selection index: ${sel.index}`, 400)
    if (!['personal', 'page'].includes(options[sel.index].accountType)) {
      return apiError(`Invalid accountType: ${options[sel.index].accountType}`, 400)
    }
  }

  const batch = adminDb.batch()

  let defaultsQuery: any = adminDb
    .collection('social_accounts')
    .where('orgId', '==', orgId)
    .where('platform', '==', platform)
    .where('isDefault', '==', true)

  if (personalScope) {
    defaultsQuery = defaultsQuery.where('accountScope', '==', PERSONAL_SCOPE).where('ownerUid', '==', user?.uid ?? '')
  }

  const existingDefaults = await defaultsQuery.get()

  for (const d of existingDefaults.docs) {
    const data = d.data?.() ?? {}
    if (personalScope || data.accountScope !== PERSONAL_SCOPE) {
      batch.update(d.ref, { isDefault: false, updatedAt: FieldValue.serverTimestamp() })
    }
  }

  const accountIds: string[] = []

  for (const sel of selections) {
    const option = options[sel.index]

    const encryptedTokens = {
      ...option.encryptedTokens,
      expiresAt: option.encryptedTokens?.expiresAt
        ? (option.encryptedTokens.expiresAt instanceof Date
            ? Timestamp.fromDate(option.encryptedTokens.expiresAt)
            : option.encryptedTokens.expiresAt)
        : null,
    }

    let existingQuery: any = adminDb
      .collection('social_accounts')
      .where('orgId', '==', orgId)
      .where('platform', '==', platform)
      .where('platformAccountId', '==', option.platformAccountId)

    if (personalScope) {
      existingQuery = existingQuery.where('accountScope', '==', PERSONAL_SCOPE).where('ownerUid', '==', user?.uid ?? '')
    }

    const existing = await existingQuery.limit(1).get()

    const accountData = {
      orgId,
      platform,
      platformAccountId: option.platformAccountId,
      displayName: option.displayName,
      username: option.username,
      avatarUrl: option.avatarUrl,
      profileUrl: option.profileUrl,
      subAccountType: option.accountType,
      isDefault: sel.isDefault ?? false,
      status: 'active',
      scopes: option.scopes ?? [],
      encryptedTokens,
      platformMeta: option.platformMeta ?? {},
      ...(personalScope ? { accountScope: PERSONAL_SCOPE, ownerUid: user?.uid ?? '' } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }

    if (!existing.empty) {
      const ref = existing.docs[0].ref
      batch.update(ref, accountData)
      accountIds.push(existing.docs[0].id)
    } else {
      const ref = adminDb.collection('social_accounts').doc()
      batch.set(ref, {
        ...accountData,
        connectedBy: user?.uid ?? '',
        connectedAt: FieldValue.serverTimestamp(),
        lastTokenRefresh: null,
        lastUsed: null,
        createdAt: FieldValue.serverTimestamp(),
      })
      accountIds.push(ref.id)
    }
  }

  batch.delete(pendingDoc.ref)
  await batch.commit()

  return apiSuccess({ accountIds }, 201)
}))
