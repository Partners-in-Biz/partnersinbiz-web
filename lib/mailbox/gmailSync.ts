import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { decryptCredentials, encryptCredentials, type EncryptedCredentials } from '@/lib/integrations/crypto'
import { GOOGLE_TOKEN_ENDPOINT, readMailboxGoogleOAuthEnv } from './googleOAuth'

const GMAIL_MESSAGES_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages'
const REFRESH_SKEW_MS = 2 * 60 * 1000

type GmailCredentials = {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  scope?: string
  tokenType?: string
  emailAddress?: string
  displayName?: string
  connectedAt?: string
}

type GmailListResponse = { messages?: Array<{ id?: string; threadId?: string }>; nextPageToken?: string }
type GmailHeader = { name?: string; value?: string }
type GmailPayloadPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPayloadPart[]; headers?: GmailHeader[] }
type GmailMessage = {
  id?: string
  threadId?: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  payload?: GmailPayloadPart
}

type MailboxAccountDoc = {
  orgId?: string
  uid?: string
  profileId?: string
  provider?: string
  emailAddress?: string
  displayName?: string
  status?: string
  deletedAt?: unknown
  googleEnc?: EncryptedCredentials
}

export type GmailMailboxSyncInput = {
  orgId: string
  uid: string
  accountId: string
  mode?: 'incremental' | 'backfill'
  maxResults?: number
}

export type GmailMailboxSyncResult = {
  ok: boolean
  imported: number
  updated: number
  skipped: number
  errored: number
  needsReconnect: boolean
  error?: string
}

function emptyResult(patch: Partial<GmailMailboxSyncResult> = {}): GmailMailboxSyncResult {
  return { ok: true, imported: 0, updated: 0, skipped: 0, errored: 0, needsReconnect: false, ...patch }
}

function firstHeader(headers: GmailHeader[] | undefined, name: string): string {
  const target = name.toLowerCase()
  return headers?.find((header) => header.name?.toLowerCase() === target)?.value ?? ''
}

export function parseEmailAddresses(value: string): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((part) => {
      const match = part.match(/<([^>]+)>/)
      return (match?.[1] ?? part).trim().replace(/^mailto:/i, '').toLowerCase()
    })
    .filter((part) => part.includes('@'))
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
  return Buffer.from(padded, 'base64').toString('utf8')
}

function extractBody(payload: GmailPayloadPart | undefined, preferredMime: 'text/plain' | 'text/html'): string {
  if (!payload) return ''
  if (payload.mimeType === preferredMime && payload.body?.data) return decodeBase64Url(payload.body.data)
  for (const part of payload.parts ?? []) {
    const extracted = extractBody(part, preferredMime)
    if (extracted) return extracted
  }
  return ''
}

function docIdSafe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 140)
}

function messageTimestamp(message: GmailMessage, headers: GmailHeader[] | undefined): Date {
  const internalMs = Number(message.internalDate)
  if (Number.isFinite(internalMs) && internalMs > 0) return new Date(internalMs)
  const dateHeader = firstHeader(headers, 'date')
  const headerDate = new Date(dateHeader)
  return Number.isNaN(headerDate.getTime()) ? new Date() : headerDate
}

async function markNeedsReconnect(accountRef: FirebaseFirestore.DocumentReference, error: string): Promise<GmailMailboxSyncResult> {
  await accountRef.set({
    status: 'needs_setup',
    lastSyncError: error,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return emptyResult({ ok: false, needsReconnect: true, error })
}

async function refreshAccessTokenIfNeeded(
  accountRef: FirebaseFirestore.DocumentReference,
  orgId: string,
  credentials: GmailCredentials,
): Promise<GmailCredentials | null> {
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

  const refreshed: GmailCredentials = {
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

async function gmailFetch<T>(url: string, accessToken: string): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } })
  if (!res.ok) return { ok: false, status: res.status }
  return { ok: true, data: await res.json() as T }
}

async function listGmailMessageIds(accessToken: string, query: string, maxResults: number): Promise<string[] | null> {
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const url = new URL(GMAIL_MESSAGES_ENDPOINT)
    url.searchParams.set('q', query)
    url.searchParams.set('maxResults', String(Math.min(maxResults - ids.length, 100)))
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const result = await gmailFetch<GmailListResponse>(url.toString(), accessToken)
    if (!result.ok) return null
    ids.push(...(result.data.messages ?? []).map((message) => message.id).filter((id): id is string => Boolean(id)))
    pageToken = result.data.nextPageToken
  } while (pageToken && ids.length < maxResults)
  return ids.slice(0, maxResults)
}

async function fetchGmailMessage(accessToken: string, id: string): Promise<GmailMessage | null | 'unauthorized'> {
  const result = await gmailFetch<GmailMessage>(`${GMAIL_MESSAGES_ENDPOINT}/${encodeURIComponent(id)}?format=full`, accessToken)
  if (result.ok) return result.data
  const status = (result as { status: number }).status
  return status === 401 || status === 403 ? 'unauthorized' : null
}

async function findExistingMessage(orgId: string, uid: string, accountId: string, providerMessageId: string) {
  const snap = await adminDb.collection('mailbox_messages')
    .where('orgId', '==', orgId)
    .where('uid', '==', uid)
    .where('accountId', '==', accountId)
    .where('providerMessageId', '==', providerMessageId)
    .get()
  return snap.docs[0] ?? null
}

function buildMessagePayload(input: {
  orgId: string
  uid: string
  accountId: string
  accountEmail: string
  profileId: string
  gmail: GmailMessage
}) {
  const headers = input.gmail.payload?.headers ?? []
  const labelIds = new Set(input.gmail.labelIds ?? [])
  const isSent = labelIds.has('SENT')
  const isDraft = labelIds.has('DRAFT')
  const isTrash = labelIds.has('TRASH')
  const isInbox = labelIds.has('INBOX')
  const bodyText = extractBody(input.gmail.payload, 'text/plain') || input.gmail.snippet || ''
  const bodyHtml = extractBody(input.gmail.payload, 'text/html') || undefined
  const messageDate = messageTimestamp(input.gmail, headers)
  const subject = firstHeader(headers, 'subject')
  return {
    orgId: input.orgId,
    uid: input.uid,
    profileId: input.profileId,
    accountId: input.accountId,
    accountEmail: input.accountEmail,
    folder: isDraft ? 'drafts' : isTrash ? 'trash' : isSent ? 'sent' : isInbox ? 'inbox' : 'archive',
    direction: isDraft ? 'draft' : isSent ? 'outbound' : 'inbound',
    status: isDraft ? 'draft' : isSent ? 'sent' : 'received',
    read: !labelIds.has('UNREAD'),
    starred: labelIds.has('STARRED'),
    from: parseEmailAddresses(firstHeader(headers, 'from'))[0] ?? firstHeader(headers, 'from'),
    to: parseEmailAddresses(firstHeader(headers, 'to')),
    cc: parseEmailAddresses(firstHeader(headers, 'cc')),
    bcc: parseEmailAddresses(firstHeader(headers, 'bcc')),
    subject,
    bodyText,
    ...(bodyHtml ? { bodyHtml } : {}),
    snippet: input.gmail.snippet || bodyText.replace(/\s+/g, ' ').slice(0, 180),
    provider: 'google',
    providerMessageId: input.gmail.id ?? null,
    threadId: input.gmail.threadId ?? null,
    providerThreadId: input.gmail.threadId ?? null,
    providerInternalDate: input.gmail.internalDate ?? null,
    providerLabelIds: Array.from(labelIds),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...(isSent ? { sentAt: messageDate } : {}),
    ...(!isSent && !isDraft ? { receivedAt: messageDate } : {}),
  }
}

async function upsertThread(input: {
  orgId: string
  uid: string
  accountId: string
  accountEmail: string
  profileId: string
  threadId: string
  subject: string
  messageCount: number
}) {
  const id = docIdSafe(`${input.orgId}_${input.uid}_${input.accountId}_${input.threadId}`)
  await adminDb.collection('mailbox_threads').doc(id).set({
    orgId: input.orgId,
    uid: input.uid,
    profileId: input.profileId,
    accountId: input.accountId,
    accountEmail: input.accountEmail,
    provider: 'google',
    providerThreadId: input.threadId,
    subject: input.subject,
    messageCount: input.messageCount,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
}

export async function syncGmailMailboxAccount(input: GmailMailboxSyncInput): Promise<GmailMailboxSyncResult> {
  const accountRef = adminDb.collection('mailbox_accounts').doc(input.accountId)
  const accountDoc = await accountRef.get()
  if (!accountDoc.exists) return emptyResult({ ok: false, error: 'Mailbox account not found', errored: 1 })
  const account = accountDoc.data() as MailboxAccountDoc
  if (account.orgId !== input.orgId || account.uid !== input.uid || account.deletedAt) {
    return emptyResult({ ok: false, error: 'Mailbox account not found', errored: 1 })
  }
  if (account.provider !== 'google' || !account.googleEnc) {
    return emptyResult({ ok: false, error: 'Mailbox account is not a connected Google account', errored: 1 })
  }

  let credentials: GmailCredentials
  try {
    credentials = decryptCredentials<GmailCredentials>(account.googleEnc, input.orgId)
  } catch (_err) {
    return markNeedsReconnect(accountRef, 'Google credentials could not be decrypted; reconnect this mailbox')
  }

  const refreshed = await refreshAccessTokenIfNeeded(accountRef, input.orgId, credentials)
  if (!refreshed?.accessToken) return markNeedsReconnect(accountRef, 'Google access expired; reconnect this mailbox')
  const accessToken = refreshed.accessToken
  credentials = refreshed

  const maxResults = Math.min(Math.max(Number(input.maxResults ?? (input.mode === 'backfill' ? 200 : 100)), 1), 500)
  const currentMailboxWindow = input.mode === 'backfill' ? '' : ' newer_than:30d'
  const [inboxIds, sentIds] = await Promise.all([
    listGmailMessageIds(accessToken, `in:inbox${currentMailboxWindow}`, maxResults),
    listGmailMessageIds(accessToken, `in:sent${currentMailboxWindow}`, maxResults),
  ])
  if (!inboxIds || !sentIds) return markNeedsReconnect(accountRef, 'Google mailbox sync failed; reconnect this mailbox if the problem persists')

  const result = emptyResult()
  const threadCounts = new Map<string, { count: number; subject: string }>()
  const seen = new Set<string>()
  for (const id of [...inboxIds, ...sentIds]) {
    if (seen.has(id)) continue
    seen.add(id)
    const gmail = await fetchGmailMessage(accessToken, id)
    if (gmail === 'unauthorized') return markNeedsReconnect(accountRef, 'Google access was rejected; reconnect this mailbox')
    if (!gmail?.id) {
      result.skipped += 1
      continue
    }
    const payload = buildMessagePayload({
      orgId: input.orgId,
      uid: input.uid,
      accountId: input.accountId,
      accountEmail: String(account.emailAddress ?? credentials.emailAddress ?? ''),
      profileId: String(account.profileId ?? `${input.orgId}_${input.uid}`),
      gmail,
    })
    const existing = await findExistingMessage(input.orgId, input.uid, input.accountId, gmail.id)
    if (existing) {
      const { createdAt: _createdAt, ...patch } = payload
      await existing.ref.set(patch, { merge: true })
      result.updated += 1
    } else {
      await adminDb.collection('mailbox_messages').add(payload)
      result.imported += 1
    }
    if (gmail.threadId) {
      const current = threadCounts.get(gmail.threadId) ?? { count: 0, subject: String(payload.subject ?? '') }
      current.count += 1
      if (!current.subject && payload.subject) current.subject = String(payload.subject)
      threadCounts.set(gmail.threadId, current)
    }
  }

  await Promise.all(Array.from(threadCounts.entries()).map(([threadId, data]) => upsertThread({
    orgId: input.orgId,
    uid: input.uid,
    accountId: input.accountId,
    accountEmail: String(account.emailAddress ?? credentials.emailAddress ?? ''),
    profileId: String(account.profileId ?? `${input.orgId}_${input.uid}`),
    threadId,
    subject: data.subject,
    messageCount: data.count,
  })))

  await accountRef.set({
    status: 'connected',
    lastSyncAt: FieldValue.serverTimestamp(),
    lastSyncError: null,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return result
}
