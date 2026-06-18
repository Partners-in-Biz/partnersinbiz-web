import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { decryptCredentials, encryptCredentials, type EncryptedCredentials } from '@/lib/integrations/crypto'
import { GOOGLE_TOKEN_ENDPOINT, readMailboxGoogleOAuthEnv } from '@/lib/mailbox/googleOAuth'

const REFRESH_SKEW_MS = 2 * 60 * 1000

type GoogleCredentials = {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  scope?: string
  tokenType?: string
  emailAddress?: string
  displayName?: string
}

type GoogleAccountDoc = {
  orgId?: string
  uid?: string
  provider?: string
  status?: string
  emailAddress?: string
  displayName?: string
  isDefault?: boolean
  deletedAt?: unknown
  googleEnc?: EncryptedCredentials
}

export type GoogleTokenSuccess = {
  ok: true
  accessToken: string
  scopes: string[]
  accountId: string
  emailAddress: string
  displayName: string
}
export type GoogleTokenFailure = {
  ok: false
  notConnected?: boolean
  needsReconnect?: boolean
  reason: string
}
export type GoogleTokenResult = GoogleTokenSuccess | GoogleTokenFailure

function parseScopes(scope?: string): string[] {
  return (scope ?? '').split(/\s+/).map((s) => s.trim()).filter(Boolean)
}

export async function findDefaultGoogleAccountId(orgId: string, uid: string): Promise<string | null> {
  const snap = await adminDb
    .collection('mailbox_accounts')
    .where('orgId', '==', orgId)
    .where('uid', '==', uid)
    .where('provider', '==', 'google')
    .get()
  if (snap.empty) return null
  const rows = (snap.docs as Array<{ id: string; data: () => GoogleAccountDoc }>)
    .map((d) => ({ id: d.id, data: d.data() }))
    .filter((r) => !r.data.deletedAt)
  if (rows.length === 0) return null
  const def = rows.find((r) => r.data.isDefault === true)
  return (def ?? rows[0]).id
}

export async function getFreshGoogleAccessToken(input: {
  orgId: string
  uid: string
  accountId?: string
}): Promise<GoogleTokenResult> {
  const accountId = input.accountId ?? (await findDefaultGoogleAccountId(input.orgId, input.uid))
  if (!accountId) return { ok: false, notConnected: true, reason: 'No connected Google account' }

  const accountRef = adminDb.collection('mailbox_accounts').doc(accountId)
  const snap = await accountRef.get()
  if (!snap.exists) return { ok: false, notConnected: true, reason: 'Google account not found' }
  const account = snap.data() as GoogleAccountDoc
  if (account.orgId !== input.orgId || account.uid !== input.uid || account.deletedAt) {
    return { ok: false, notConnected: true, reason: 'Google account not found' }
  }
  if (account.provider !== 'google' || !account.googleEnc) {
    return { ok: false, notConnected: true, reason: 'Account is not a connected Google account' }
  }

  let credentials: GoogleCredentials
  try {
    credentials = decryptCredentials<GoogleCredentials>(account.googleEnc, input.orgId)
  } catch {
    await markNeedsReconnect(accountRef as FirebaseFirestore.DocumentReference, 'Google credentials could not be decrypted; reconnect')
    return { ok: false, needsReconnect: true, reason: 'Credentials could not be decrypted' }
  }

  const expiresAt = Number(credentials.expiresAt ?? 0)
  if (credentials.accessToken && expiresAt > Date.now() + REFRESH_SKEW_MS) {
    return success(account, accountId, credentials)
  }
  if (!credentials.refreshToken) {
    await markNeedsReconnect(accountRef as FirebaseFirestore.DocumentReference, 'Google access expired; reconnect')
    return { ok: false, needsReconnect: true, reason: 'No refresh token' }
  }
  const env = readMailboxGoogleOAuthEnv()
  if (!env) return { ok: false, reason: 'Google OAuth not configured' }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: credentials.refreshToken,
    client_id: env.clientId,
    client_secret: env.clientSecret,
  })
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    await markNeedsReconnect(accountRef as FirebaseFirestore.DocumentReference, 'Google access expired; reconnect')
    return { ok: false, needsReconnect: true, reason: 'Token refresh failed' }
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number; scope?: string; token_type?: string }
  if (!json.access_token) {
    await markNeedsReconnect(accountRef as FirebaseFirestore.DocumentReference, 'Google access expired; reconnect')
    return { ok: false, needsReconnect: true, reason: 'Token refresh returned no token' }
  }
  const refreshed: GoogleCredentials = {
    ...credentials,
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    scope: json.scope ?? credentials.scope,
    tokenType: json.token_type ?? credentials.tokenType ?? 'Bearer',
  }
  await accountRef.set(
    {
      googleEnc: encryptCredentials(refreshed as Record<string, unknown>, input.orgId),
      status: 'connected',
      lastTokenRefreshAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  return success(account, accountId, refreshed)
}

function success(account: GoogleAccountDoc, accountId: string, creds: GoogleCredentials): GoogleTokenSuccess {
  return {
    ok: true,
    accessToken: creds.accessToken!,
    scopes: parseScopes(creds.scope),
    accountId,
    emailAddress: account.emailAddress ?? creds.emailAddress ?? '',
    displayName: account.displayName ?? creds.displayName ?? account.emailAddress ?? '',
  }
}

async function markNeedsReconnect(accountRef: FirebaseFirestore.DocumentReference, error: string) {
  await accountRef.set(
    { status: 'needs_setup', lastSyncError: error, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  )
}

// Broader Google scopes satisfy narrower ones. A user who granted full
// `calendar` access has implicitly granted `calendar.events`; full `drive`
// covers every drive.* sub-scope. Google's consent screen often grants the
// broad scope, so an exact-string check would wrongly report "needs reconnect".
const SCOPE_IMPLICATIONS: Record<string, string[]> = {
  'https://www.googleapis.com/auth/calendar': [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.events.readonly',
    'https://www.googleapis.com/auth/calendar.readonly',
  ],
  'https://www.googleapis.com/auth/drive': [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive.metadata.readonly',
    'https://www.googleapis.com/auth/drive.metadata',
    'https://www.googleapis.com/auth/drive.readonly',
  ],
  'https://www.googleapis.com/auth/drive.readonly': [
    'https://www.googleapis.com/auth/drive.metadata.readonly',
    'https://www.googleapis.com/auth/drive.metadata',
  ],
}

export function googleAccountHasScopes(granted: string[], required: string[]): boolean {
  const set = new Set(granted)
  // Expand granted scopes with everything they imply.
  for (const g of granted) {
    for (const implied of SCOPE_IMPLICATIONS[g] ?? []) set.add(implied)
  }
  return required.every((s) => set.has(s))
}
