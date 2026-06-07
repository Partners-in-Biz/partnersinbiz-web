import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { encryptCredentials } from '@/lib/integrations/crypto'
import {
  MAILBOX_GOOGLE_SCOPES,
  MAILBOX_GOOGLE_STATE_COLLECTION,
  appBaseUrl,
  exchangeMailboxGoogleCode,
  fetchMailboxGoogleUserInfo,
  readMailboxGoogleOAuthEnv,
  uniqueGoogleScopes,
} from '@/lib/mailbox/googleOAuth'
import { normalizeEmail } from '@/lib/mailbox/serializers'
import { WORKSPACE_CONNECTION_COLLECTION } from '@/lib/workspace-os/connections'
import { asRecord, cleanString } from '@/lib/workspace-os/common'

export const dynamic = 'force-dynamic'

type WorkspaceGoogleState = {
  orgId: string
  uid: string
  profileId: string
  emailAddress?: string
  displayName?: string
  redirectUri: string
  returnTo?: string
  connectionId?: string | null
  connectionKey?: string | null
  requestedScopes?: string[]
  expiresAt?: { toMillis: () => number }
}

function safeReturnPath(value?: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/admin/email/mailbox'
  return value
}

function redirectToReturn(req: NextRequest, returnTo: string | undefined, status: 'connected' | 'error', message?: string) {
  const url = new URL(`${appBaseUrl(req.url)}${safeReturnPath(returnTo)}`)
  url.searchParams.set('googleWorkspaceStatus', status)
  if (message) url.searchParams.set('message', message)
  return NextResponse.redirect(url.toString(), { status: 302 })
}

async function loadActiveAccounts(orgId: string, uid: string) {
  const snap = await adminDb.collection('mailbox_accounts').where('orgId', '==', orgId).where('uid', '==', uid).get()
  return snap.docs.filter((doc) => !doc.data().deletedAt)
}

async function clearDefault(orgId: string, uid: string) {
  const docs = await loadActiveAccounts(orgId, uid)
  await Promise.all(docs.map((doc) => doc.ref.update({ isDefault: false, updatedAt: FieldValue.serverTimestamp() })))
}

async function resolveConnectionRef(stateData: WorkspaceGoogleState) {
  if (stateData.connectionId) {
    const ref = adminDb.collection(WORKSPACE_CONNECTION_COLLECTION).doc(stateData.connectionId)
    const doc = await ref.get()
    if (doc.exists && cleanString(doc.data()?.orgId) === cleanString(stateData.orgId)) return { ref, data: doc.data() ?? {} }
  }
  if (stateData.connectionKey) {
    const snap = await adminDb.collection(WORKSPACE_CONNECTION_COLLECTION)
      .where('orgId', '==', stateData.orgId)
      .where('connectionKey', '==', stateData.connectionKey)
      .limit(1)
      .get()
    const doc = snap.docs[0]
    if (doc) return { ref: doc.ref, data: doc.data() ?? {} }
  }
  return null
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) return redirectToReturn(req, undefined, 'error', error)
  if (!code || !state) return redirectToReturn(req, undefined, 'error', 'missing_code_or_state')

  const stateRef = adminDb.collection(MAILBOX_GOOGLE_STATE_COLLECTION).doc(state)
  const stateDoc = await stateRef.get()
  if (!stateDoc.exists) return redirectToReturn(req, undefined, 'error', 'invalid_state')

  const stateData = stateDoc.data() as WorkspaceGoogleState
  const expiresAtMillis = stateData.expiresAt?.toMillis()
  if (!stateData.orgId || !stateData.uid || !stateData.redirectUri || !expiresAtMillis || expiresAtMillis < Date.now()) {
    await stateRef.delete()
    return redirectToReturn(req, stateData.returnTo, 'error', 'expired_or_invalid_state')
  }
  await stateRef.delete()

  const env = readMailboxGoogleOAuthEnv()
  if (!env) return redirectToReturn(req, stateData.returnTo, 'error', 'missing_google_oauth_env')

  const tokens = await exchangeMailboxGoogleCode({
    code,
    redirectUri: stateData.redirectUri,
    clientId: env.clientId,
    clientSecret: env.clientSecret,
  })
  if (!tokens?.access_token) return redirectToReturn(req, stateData.returnTo, 'error', 'token_exchange_failed')
  if (!tokens.refresh_token) return redirectToReturn(req, stateData.returnTo, 'error', 'missing_refresh_token')

  const profile = await fetchMailboxGoogleUserInfo(tokens.access_token)
  const emailAddress = normalizeEmail(profile?.email) || normalizeEmail(stateData.emailAddress)
  if (!emailAddress || !emailAddress.includes('@')) return redirectToReturn(req, stateData.returnTo, 'error', 'missing_google_email')
  const displayName = (profile?.name ?? stateData.displayName ?? emailAddress).trim() || emailAddress
  const grantedScopes = uniqueGoogleScopes((tokens.scope ?? stateData.requestedScopes?.join(' ') ?? MAILBOX_GOOGLE_SCOPES.join(' ')).split(/\s+/))

  const credentials = {
    authType: 'oauth2',
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    scope: grantedScopes.join(' '),
    tokenType: tokens.token_type ?? 'Bearer',
    emailAddress,
    displayName,
    connectedAt: new Date().toISOString(),
  }

  const accounts = await loadActiveAccounts(stateData.orgId, stateData.uid)
  const existing = accounts.find((doc) => doc.data().emailAddress === emailAddress)
  const shouldDefault = accounts.length === 0
  if (shouldDefault) await clearDefault(stateData.orgId, stateData.uid)

  const patch = {
    orgId: stateData.orgId,
    uid: stateData.uid,
    profileId: stateData.profileId || `${stateData.orgId}_${stateData.uid}`,
    provider: 'google',
    emailAddress,
    displayName,
    status: 'connected',
    googleEnc: encryptCredentials(credentials, stateData.orgId),
    isDefault: existing ? existing.data().isDefault === true || shouldDefault : shouldDefault,
    updatedAt: FieldValue.serverTimestamp(),
  }

  let accountId = existing?.id
  if (existing) {
    await existing.ref.set(patch, { merge: true })
  } else {
    const accountRef = await adminDb.collection('mailbox_accounts').add({
      ...patch,
      createdAt: FieldValue.serverTimestamp(),
    })
    accountId = accountRef.id
  }

  const connection = await resolveConnectionRef(stateData)
  if (connection) {
    const previousSafeMetadata = asRecord(connection.data.safeMetadata)
    await connection.ref.set({
      status: 'active',
      tokenStatus: 'active',
      ownerUserId: stateData.uid,
      owner: { type: 'user', id: stateData.uid },
      credentialRef: {
        secretName: null,
        envVarName: null,
        tokenStorePath: null,
        keyPrefix: `mailbox_accounts/${accountId}`,
      },
      safeMetadata: {
        ...previousSafeMetadata,
        linkedMailboxAccountId: accountId ?? null,
        authorizedEmail: emailAddress,
        grantedScopes,
        connectedVia: 'workspace_connection_google_oauth',
      },
      lastReviewedAt: new Date().toISOString(),
      lastReviewedBy: stateData.uid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  }

  return redirectToReturn(req, stateData.returnTo, 'connected')
}
