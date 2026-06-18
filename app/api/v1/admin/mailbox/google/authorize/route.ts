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

export const GET = withAuth('admin', async (req: NextRequest, user) => {
  const env = readMailboxGoogleOAuthEnv()
  if (!env) return apiError('Google OAuth is not configured for mailbox linking.', 500)

  const url = new URL(req.url)
  const orgId = PIB_PLATFORM_ORG_ID
  const uid = user.uid
  const emailAddress = normalizeEmail(url.searchParams.get('emailAddress'))
  const displayName = (url.searchParams.get('displayName') ?? '').trim()
  const scopes = url.searchParams.get('scope') === 'workspace'
    ? UNIFIED_GOOGLE_WORKSPACE_SCOPES
    : MAILBOX_GOOGLE_SCOPES
  const returnToParam = url.searchParams.get('returnTo')?.trim() || ''
  const returnTo = returnToParam.startsWith('/') ? returnToParam : '/admin/email/mailbox'
  const state = crypto.randomBytes(16).toString('hex')
  const appBase = appBaseUrl(req.url)
  const redirectUri = `${appBase}/api/v1/admin/mailbox/google/callback`

  await adminDb.collection(MAILBOX_GOOGLE_STATE_COLLECTION).doc(state).set({
    orgId,
    uid,
    profileId: `${orgId}_${uid}`,
    emailAddress,
    displayName,
    redirectUri,
    returnTo,
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromMillis(Date.now() + MAILBOX_GOOGLE_STATE_TTL_MINUTES * 60_000),
  })

  return NextResponse.redirect(buildMailboxGoogleAuthorizeUrl({
    clientId: env.clientId,
    redirectUri,
    state,
    emailAddress,
    scopes,
  }), { status: 302 })
})
