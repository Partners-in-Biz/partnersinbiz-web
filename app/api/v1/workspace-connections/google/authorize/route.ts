import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { withAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/response'
import { actorFrom } from '@/lib/api/actor'
import { adminDb } from '@/lib/firebase/admin'
import { normalizeEmail } from '@/lib/mailbox/serializers'
import {
  MAILBOX_GOOGLE_STATE_COLLECTION,
  MAILBOX_GOOGLE_STATE_TTL_MINUTES,
  UNIFIED_GOOGLE_WORKSPACE_CONNECTION_KEY,
  UNIFIED_GOOGLE_WORKSPACE_SCOPES,
  appBaseUrl,
  buildMailboxGoogleAuthorizeUrl,
  readMailboxGoogleOAuthEnv,
  uniqueGoogleScopes,
} from '@/lib/mailbox/googleOAuth'
import { orgAccessError, resolveOrgId } from '@/lib/workspace-os/api'
import { WORKSPACE_CONNECTION_COLLECTION, serializeWorkspaceConnection } from '@/lib/workspace-os/connections'

export const dynamic = 'force-dynamic'

export const GET = withAuth('admin', async (req: NextRequest, user) => {
  const env = readMailboxGoogleOAuthEnv()
  if (!env) return apiError('Google OAuth is not configured for Workspace connection linking.', 500)

  const url = new URL(req.url)
  const resolved = resolveOrgId(req, user)
  const accessError = orgAccessError(user, resolved.orgId, resolved.mismatch, resolved)
  if (accessError) return accessError
  const orgId = resolved.orgId!
  const uid = user.uid
  const emailAddress = normalizeEmail(url.searchParams.get('emailAddress'))
  const displayName = (url.searchParams.get('displayName') ?? '').trim()
  const connectionKey = (url.searchParams.get('connectionKey') ?? UNIFIED_GOOGLE_WORKSPACE_CONNECTION_KEY).trim()
  const returnTo = url.searchParams.get('returnTo') ?? '/portal/email'
  const appBase = appBaseUrl(req.url)
  const redirectUri = `${appBase}/api/v1/workspace-connections/google/callback`

  const snapshot = await adminDb.collection(WORKSPACE_CONNECTION_COLLECTION)
    .where('orgId', '==', orgId)
    .where('connectionKey', '==', connectionKey)
    .limit(1)
    .get()
  const existing = snapshot.docs[0]
  const connection = existing ? serializeWorkspaceConnection(existing.id, existing.data()) : null
  const registryScopes = connection?.scopes?.map((row) => row.scope).filter(Boolean) ?? []
  const scopes = uniqueGoogleScopes(registryScopes.length ? registryScopes : UNIFIED_GOOGLE_WORKSPACE_SCOPES)
  const state = crypto.randomBytes(16).toString('hex')

  await adminDb.collection(MAILBOX_GOOGLE_STATE_COLLECTION).doc(state).set({
    orgId,
    uid,
    profileId: `${orgId}_${uid}`,
    emailAddress,
    displayName,
    redirectUri,
    returnTo,
    connectionId: existing?.id ?? null,
    connectionKey,
    requestedScopes: scopes,
    source: 'workspace_connection_google_authorize',
    actor: actorFrom(user),
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
