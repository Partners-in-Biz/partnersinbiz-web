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
} from '@/lib/mailbox/googleOAuth'
import { normalizeEmail } from '@/lib/mailbox/serializers'

export const dynamic = 'force-dynamic'

type MailboxGoogleState = {
  orgId: string
  uid: string
  profileId: string
  emailAddress?: string
  displayName?: string
  redirectUri: string
  returnTo?: string
  expiresAt?: { toMillis: () => number }
}

function redirectToEmail(req: NextRequest, status: 'connected' | 'error', message?: string, returnTo?: string) {
  const path = returnTo && returnTo.startsWith('/') ? returnTo : '/portal/email'
  const url = new URL(`${appBaseUrl(req.url)}${path}`)
  url.searchParams.set('emailStatus', status)
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

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (error) return redirectToEmail(req, 'error', error)
  if (!code || !state) return redirectToEmail(req, 'error', 'missing_code_or_state')

  const stateRef = adminDb.collection(MAILBOX_GOOGLE_STATE_COLLECTION).doc(state)
  const stateDoc = await stateRef.get()
  if (!stateDoc.exists) return redirectToEmail(req, 'error', 'invalid_state')

  const stateData = stateDoc.data() as MailboxGoogleState
  const expiresAtMillis = stateData.expiresAt?.toMillis()
  if (!stateData.orgId || !stateData.uid || !stateData.redirectUri || !expiresAtMillis || expiresAtMillis < Date.now()) {
    await stateRef.delete()
    return redirectToEmail(req, 'error', 'expired_or_invalid_state')
  }
  await stateRef.delete()

  const env = readMailboxGoogleOAuthEnv()
  if (!env) return redirectToEmail(req, 'error', 'missing_google_oauth_env')

  const tokens = await exchangeMailboxGoogleCode({
    code,
    redirectUri: stateData.redirectUri,
    clientId: env.clientId,
    clientSecret: env.clientSecret,
  })
  if (!tokens?.access_token) return redirectToEmail(req, 'error', 'token_exchange_failed')
  if (!tokens.refresh_token) return redirectToEmail(req, 'error', 'missing_refresh_token')

  const profile = await fetchMailboxGoogleUserInfo(tokens.access_token)
  const emailAddress = normalizeEmail(profile?.email) || normalizeEmail(stateData.emailAddress)
  if (!emailAddress || !emailAddress.includes('@')) return redirectToEmail(req, 'error', 'missing_google_email')
  const displayName = (profile?.name ?? stateData.displayName ?? emailAddress).trim() || emailAddress

  const credentials = {
    authType: 'oauth2',
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    scope: tokens.scope ?? MAILBOX_GOOGLE_SCOPES.join(' '),
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

  if (existing) {
    await existing.ref.set(patch, { merge: true })
  } else {
    await adminDb.collection('mailbox_accounts').add({
      ...patch,
      createdAt: FieldValue.serverTimestamp(),
    })
  }

  return redirectToEmail(req, 'connected', undefined, stateData.returnTo)
}
