import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { withPortalAuthAndRole } from '@/lib/auth/portal-middleware'
import { apiError } from '@/lib/api/response'
import { adminDb } from '@/lib/firebase/admin'
import {
  MAILBOX_GOOGLE_STATE_COLLECTION,
  MAILBOX_GOOGLE_STATE_TTL_MINUTES,
  appBaseUrl,
  buildMailboxGoogleAuthorizeUrl,
  readMailboxGoogleOAuthEnv,
} from '@/lib/mailbox/googleOAuth'
import { normalizeEmail } from '@/lib/mailbox/serializers'

export const dynamic = 'force-dynamic'

export const GET = withPortalAuthAndRole('member', async (req: NextRequest, uid: string, orgId: string) => {
  const env = readMailboxGoogleOAuthEnv()
  if (!env) return apiError('Google OAuth is not configured for mailbox linking.', 500)

  const url = new URL(req.url)
  const emailAddress = normalizeEmail(url.searchParams.get('emailAddress'))
  const displayName = (url.searchParams.get('displayName') ?? '').trim()
  const state = crypto.randomBytes(16).toString('hex')
  const appBase = appBaseUrl(req.url)
  const redirectUri = `${appBase}/api/v1/portal/email/google/callback`

  await adminDb.collection(MAILBOX_GOOGLE_STATE_COLLECTION).doc(state).set({
    orgId,
    uid,
    profileId: `${orgId}_${uid}`,
    emailAddress,
    displayName,
    redirectUri,
    createdAt: Timestamp.now(),
    expiresAt: Timestamp.fromMillis(Date.now() + MAILBOX_GOOGLE_STATE_TTL_MINUTES * 60_000),
  })

  return NextResponse.redirect(buildMailboxGoogleAuthorizeUrl({
    clientId: env.clientId,
    redirectUri,
    state,
    emailAddress,
  }), { status: 302 })
})
