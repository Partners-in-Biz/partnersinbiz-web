/**
 * Gmail sendAs signature: fetch, cache, and append for API sends.
 * Gmail only auto-applies signatures in the Gmail UI — raw API send must append them.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { decryptCredentials, encryptCredentials, type EncryptedCredentials } from '@/lib/integrations/crypto'
import { GOOGLE_TOKEN_ENDPOINT, readMailboxGoogleOAuthEnv } from '@/lib/mailbox/googleOAuth'

const GMAIL_SEND_AS_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs'
const REFRESH_SKEW_MS = 2 * 60 * 1000
const SIGNATURE_CACHE_MS = 24 * 60 * 60 * 1000

export type GmailSignatureCredentials = {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  scope?: string
  tokenType?: string
  emailAddress?: string
  displayName?: string
}

export type MailboxSignatureAccount = {
  emailAddress?: string
  provider?: string
  googleEnc?: EncryptedCredentials
  signatureHtml?: string | null
  signatureText?: string | null
  signatureFetchedAt?: unknown
}

export type AppendSignatureInput = {
  bodyText: string
  bodyHtml?: string
  signatureHtml?: string
  signatureText?: string
}

export type AppendSignatureResult = {
  bodyText: string
  bodyHtml?: string
  appended: boolean
}

function toMillis(value: unknown): number {
  if (!value) return 0
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isFinite(ms) ? ms : 0
  }
  if (typeof value === 'object' && value) {
    const row = value as { toMillis?: () => number; seconds?: number; _seconds?: number }
    if (typeof row.toMillis === 'function') return row.toMillis()
    if (typeof row.seconds === 'number') return row.seconds * 1000
    if (typeof row._seconds === 'number') return row._seconds * 1000
  }
  return 0
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*p\s*>/gi, '\n\n')
    .replace(/<\/\s*div\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function normalizeForCompare(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** True if body already ends with the signature (avoid double-append). */
export function bodyAlreadyHasSignature(bodyText: string, bodyHtml: string | undefined, signatureText: string, signatureHtml: string): boolean {
  const sigPlain = normalizeForCompare(signatureText || htmlToPlainText(signatureHtml))
  if (!sigPlain || sigPlain.length < 8) return false
  const plainBody = normalizeForCompare(bodyText || htmlToPlainText(bodyHtml || ''))
  if (plainBody.endsWith(sigPlain) || plainBody.includes(sigPlain)) return true
  if (bodyHtml && signatureHtml) {
    const compactBody = bodyHtml.replace(/\s+/g, ' ')
    const compactSig = signatureHtml.replace(/\s+/g, ' ').trim()
    if (compactSig.length >= 12 && compactBody.includes(compactSig)) return true
  }
  return false
}

export function appendEmailSignature(input: AppendSignatureInput): AppendSignatureResult {
  const signatureHtml = (input.signatureHtml ?? '').trim()
  const signatureText = (input.signatureText ?? (signatureHtml ? htmlToPlainText(signatureHtml) : '')).trim()
  if (!signatureHtml && !signatureText) {
    return {
      bodyText: input.bodyText,
      ...(input.bodyHtml ? { bodyHtml: input.bodyHtml } : {}),
      appended: false,
    }
  }

  if (bodyAlreadyHasSignature(input.bodyText, input.bodyHtml, signatureText, signatureHtml)) {
    return {
      bodyText: input.bodyText,
      ...(input.bodyHtml ? { bodyHtml: input.bodyHtml } : {}),
      appended: false,
    }
  }

  const textBase = input.bodyText.trimEnd()
  const nextText = textBase
    ? `${textBase}\n\n-- \n${signatureText}`
    : `-- \n${signatureText}`

  let nextHtml: string | undefined
  if (input.bodyHtml || signatureHtml) {
    const htmlBody = (input.bodyHtml ?? input.bodyText.replace(/\n/g, '<br>\n')).trimEnd()
    const sigBlock = signatureHtml || `<pre style="font-family:inherit;white-space:pre-wrap;margin:0">${signatureText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</pre>`
    nextHtml = htmlBody
      ? `${htmlBody}<br><br><div class="pib-email-signature">${sigBlock}</div>`
      : `<div class="pib-email-signature">${sigBlock}</div>`
  }

  return {
    bodyText: nextText,
    ...(nextHtml ? { bodyHtml: nextHtml } : {}),
    appended: true,
  }
}

async function refreshGoogleAccessToken(
  accountRef: FirebaseFirestore.DocumentReference,
  orgId: string,
  credentials: GmailSignatureCredentials,
): Promise<GmailSignatureCredentials | null> {
  const expiresAt = Number(credentials.expiresAt ?? 0)
  if (credentials.accessToken && expiresAt > Date.now() + REFRESH_SKEW_MS) return credentials
  if (!credentials.refreshToken) return null
  const env = readMailboxGoogleOAuthEnv()
  if (!env) return null

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
  if (!res.ok) return null
  const json = await res.json() as { access_token?: string; expires_in?: number; scope?: string; token_type?: string }
  if (!json.access_token) return null

  const refreshed: GmailSignatureCredentials = {
    ...credentials,
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    scope: json.scope ?? credentials.scope,
    tokenType: json.token_type ?? credentials.tokenType ?? 'Bearer',
  }
  await accountRef.set({
    googleEnc: encryptCredentials(refreshed as Record<string, unknown>, orgId),
    status: 'connected',
    lastTokenRefreshAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return refreshed
}

type SendAsRow = {
  sendAsEmail?: string
  isPrimary?: boolean
  isDefault?: boolean
  signature?: string
}

async function fetchSendAsSignature(accessToken: string, emailAddress: string): Promise<{ html: string; text: string } | null> {
  const encoded = encodeURIComponent(emailAddress)
  // Prefer the exact sendAs address first.
  const direct = await fetch(`${GMAIL_SEND_AS_ENDPOINT}/${encoded}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (direct.ok) {
    const row = await direct.json() as SendAsRow
    const html = typeof row.signature === 'string' ? row.signature.trim() : ''
    if (html) return { html, text: htmlToPlainText(html) }
  }

  const list = await fetch(GMAIL_SEND_AS_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (!list.ok) return null
  const payload = await list.json() as { sendAs?: SendAsRow[] }
  const rows = Array.isArray(payload.sendAs) ? payload.sendAs : []
  const match = rows.find((row) => (row.sendAsEmail || '').toLowerCase() === emailAddress.toLowerCase())
    ?? rows.find((row) => row.isDefault)
    ?? rows.find((row) => row.isPrimary)
    ?? rows[0]
  const html = typeof match?.signature === 'string' ? match.signature.trim() : ''
  if (!html) return null
  return { html, text: htmlToPlainText(html) }
}

export type ResolvedGmailSignature = {
  signatureHtml: string
  signatureText: string
  accessToken: string
  fromCache: boolean
}

/**
 * Resolve Gmail signature for an account (cache → Gmail settings API).
 * Also refreshes access token when needed (shared with send path).
 */
export async function resolveGmailSignature(input: {
  orgId: string
  accountId: string
  account: MailboxSignatureAccount
  forceRefresh?: boolean
}): Promise<ResolvedGmailSignature | null> {
  if (input.account.provider !== 'google' || !input.account.googleEnc) return null
  const accountRef = adminDb.collection('mailbox_accounts').doc(input.accountId)

  let credentials: GmailSignatureCredentials
  try {
    credentials = decryptCredentials<GmailSignatureCredentials>(input.account.googleEnc, input.orgId)
  } catch {
    return null
  }

  const refreshed = await refreshGoogleAccessToken(accountRef, input.orgId, credentials)
  if (!refreshed?.accessToken) return null

  const emailAddress = (input.account.emailAddress || credentials.emailAddress || '').trim()
  if (!emailAddress) return null

  const cachedAt = toMillis(input.account.signatureFetchedAt)
  const cachedHtml = typeof input.account.signatureHtml === 'string' ? input.account.signatureHtml.trim() : ''
  const cachedText = typeof input.account.signatureText === 'string'
    ? input.account.signatureText.trim()
    : (cachedHtml ? htmlToPlainText(cachedHtml) : '')
  if (
    !input.forceRefresh
    && cachedHtml
    && cachedAt > Date.now() - SIGNATURE_CACHE_MS
  ) {
    return {
      signatureHtml: cachedHtml,
      signatureText: cachedText,
      accessToken: refreshed.accessToken,
      fromCache: true,
    }
  }

  const fetched = await fetchSendAsSignature(refreshed.accessToken, emailAddress)
  if (!fetched) {
    // Clear stale cache if Google returns empty (user removed signature).
    if (cachedHtml) {
      await accountRef.set({
        signatureHtml: null,
        signatureText: null,
        signatureFetchedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true })
    }
    return {
      signatureHtml: '',
      signatureText: '',
      accessToken: refreshed.accessToken,
      fromCache: false,
    }
  }

  await accountRef.set({
    signatureHtml: fetched.html,
    signatureText: fetched.text,
    signatureFetchedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })

  return {
    signatureHtml: fetched.html,
    signatureText: fetched.text,
    accessToken: refreshed.accessToken,
    fromCache: false,
  }
}

/** Warm signature cache right after OAuth connect (best-effort). */
export async function warmGmailSignatureCache(input: {
  orgId: string
  accountId: string
  account: MailboxSignatureAccount
}): Promise<void> {
  try {
    await resolveGmailSignature({ ...input, forceRefresh: true })
  } catch {
    // Non-fatal: send path will retry.
  }
}
