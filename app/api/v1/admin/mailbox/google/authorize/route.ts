import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import {
  MAILBOX_GOOGLE_SCOPES,
  MAILBOX_GOOGLE_STATE_COLLECTION,
  MAILBOX_GOOGLE_STATE_TTL_MINUTES,
  UNIFIED_GOOGLE_WORKSPACE_SCOPES,
  appBaseUrl,
  buildMailboxGoogleAuthorizeUrl,
  readMailboxGoogleOAuthEnv,
} from '@/lib/mailbox/googleOAuth'
import { normalizeEmail } from '@/lib/mailbox/serializers'
import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'

export const dynamic = 'force-dynamic'

type MailboxOAuthTarget = {
  orgId: string
  uid: string
  profileId: string
  emailAddress?: string
  displayName?: string
}

async function resolveMailboxOAuthTarget(input: {
  mailboxAccountId: string
  fallback: MailboxOAuthTarget
}): Promise<MailboxOAuthTarget | Response> {
  if (!input.mailboxAccountId) return input.fallback

  const doc = await adminDb.collection('mailbox_accounts').doc(input.mailboxAccountId).get()
  if (!doc.exists) return apiError('Mailbox account not found', 404)

  const data = doc.data() ?? {}
  if (data.deletedAt) return apiError('Mailbox account not found', 404)
  if (data.orgId !== PIB_PLATFORM_ORG_ID) return apiError('Mailbox account is outside the platform workspace', 403)
  if (data.provider && data.provider !== 'google') return apiError('Only Google mailbox accounts can be reconnected through Google OAuth.', 400)

  const uid = typeof data.uid === 'string' ? data.uid.trim() : ''
  if (!uid) return apiError('Mailbox account is missing an owner profile', 400)

  const emailAddress = normalizeEmail(data.emailAddress) || input.fallback.emailAddress
  const displayName = typeof data.displayName === 'string' && data.displayName.trim()
    ? data.displayName.trim()
    : input.fallback.displayName

  return {
    orgId: PIB_PLATFORM_ORG_ID,
    uid,
    profileId: typeof data.profileId === 'string' && data.profileId.trim()
      ? data.profileId.trim()
      : `${PIB_PLATFORM_ORG_ID}_${uid}`,
    emailAddress,
    displayName,
  }
}

export const GET = withAuth('admin', async (req: NextRequest, user) => {
  const env = readMailboxGoogleOAuthEnv()
  if (!env) return apiError('Google OAuth is not configured for mailbox linking.', 500)

  const url = new URL(req.url)
  const orgId = PIB_PLATFORM_ORG_ID
  const uid = user.uid
  const mailboxAccountId = url.searchParams.get('mailboxAccountId')?.trim() || ''
  const emailAddress = normalizeEmail(url.searchParams.get('emailAddress'))
  const displayName = (url.searchParams.get('displayName') ?? '').trim()
  const target = await resolveMailboxOAuthTarget({
    mailboxAccountId,
    fallback: {
      orgId,
      uid,
      profileId: `${orgId}_${uid}`,
      emailAddress,
      displayName,
    },
  })
  if (target instanceof Response) return target
  const scopes = url.searchParams.get('scope') === 'workspace'
    ? UNIFIED_GOOGLE_WORKSPACE_SCOPES
    : MAILBOX_GOOGLE_SCOPES
  const returnToParam = url.searchParams.get('returnTo')?.trim() || ''
  const returnTo = returnToParam.startsWith('/') ? returnToParam : '/admin/email/mailbox'
  const state = crypto.randomBytes(16).toString('hex')
  const appBase = appBaseUrl(req.url)
  const redirectUri = `${appBase}/api/v1/admin/mailbox/google/callback`

  await adminDb.collection(MAILBOX_GOOGLE_STATE_COLLECTION).doc(state).set({
    orgId: target.orgId,
    uid: target.uid,
    profileId: target.profileId,
    emailAddress: target.emailAddress,
    displayName: target.displayName,
    mailboxAccountId: mailboxAccountId || null,
    redirectUri,
    returnTo,
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromMillis(Date.now() + MAILBOX_GOOGLE_STATE_TTL_MINUTES * 60_000),
  })

  return NextResponse.redirect(buildMailboxGoogleAuthorizeUrl({
    clientId: env.clientId,
    redirectUri,
    state,
    emailAddress: target.emailAddress,
    scopes,
  }), { status: 302 })
})
