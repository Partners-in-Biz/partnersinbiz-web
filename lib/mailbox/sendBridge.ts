import * as net from 'node:net'
import * as tls from 'node:tls'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { decryptCredentials, type EncryptedCredentials } from '@/lib/integrations/crypto'
import type { MailboxAttachmentStored } from '@/lib/mailbox/attachments'

const GMAIL_SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
const REFRESH_SKEW_MS = 2 * 60 * 1000

type MailboxProvider = 'google' | 'smtp_imap'

type MailboxAccountDoc = {
  orgId?: string
  uid?: string
  profileId?: string
  provider?: MailboxProvider
  emailAddress?: string
  displayName?: string
  status?: string
  deletedAt?: unknown
  googleEnc?: EncryptedCredentials
  smtpEnc?: EncryptedCredentials
}

type GoogleCredentials = {
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
}

type SmtpCredentials = {
  host?: string
  port?: number
  username?: string
  password?: string
  secure?: boolean
}

export type SendMailboxMessageInput = {
  orgId: string
  uid: string
  accountId: string
  approved?: boolean
  dryRun?: boolean
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  bodyText: string
  bodyHtml?: string
  attachments?: MailboxAttachmentStored[]
  approvalGateTaskId?: string
  actorId?: string
  actorType?: 'user' | 'agent' | 'system'
}

export type SmtpSend = (
  config: SmtpCredentials,
  message: {
    from: string
    to: string[]
    cc: string[]
    bcc: string[]
    subject: string
    text: string
    html?: string
    attachments?: MailboxAttachmentStored[]
  },
) => Promise<{ messageId?: string; response?: string }>

export type SendMailboxMessageDeps = {
  smtpSend?: SmtpSend
}

export type SendMailboxMessageResult =
  | { ok: true; provider: 'google' | 'smtp'; providerMessageId?: string; threadId?: string | null; messageId?: string; dryRun?: boolean }
  | { ok: false; error: string }

function normalizeList(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean)
}

function snippet(bodyText: string): string {
  return bodyText.replace(/\s+/g, ' ').slice(0, 180)
}

function encodeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function buildBodyPart(input: SendMailboxMessageInput, boundarySeed: string): string[] {
  if (input.bodyHtml) {
    const boundary = `${boundarySeed}-alt`
    return [
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      input.bodyText,
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      input.bodyHtml,
      `--${boundary}--`,
      '',
    ]
  }

  return [
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    input.bodyText,
  ]
}

function buildAttachmentPart(attachment: MailboxAttachmentStored): string[] {
  const filename = encodeHeader(attachment.name)
  return [
    `Content-Type: ${attachment.contentType}; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    attachment.contentBase64.replace(/(.{76})/g, '$1\r\n').trim(),
  ]
}

function buildRawEmail(input: SendMailboxMessageInput, from: string): string {
  const headers = [
    `From: ${encodeHeader(from)}`,
    `To: ${normalizeList(input.to).map(encodeHeader).join(', ')}`,
    ...(normalizeList(input.cc).length ? [`Cc: ${normalizeList(input.cc).map(encodeHeader).join(', ')}`] : []),
    ...(normalizeList(input.bcc).length ? [`Bcc: ${normalizeList(input.bcc).map(encodeHeader).join(', ')}`] : []),
    `Subject: ${encodeHeader(input.subject)}`,
    'MIME-Version: 1.0',
  ]

  const attachments = input.attachments ?? []
  const boundarySeed = `pib-mailbox-${Date.now()}`
  if (attachments.length) {
    const boundary = `${boundarySeed}-mixed`
    const parts = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      ...buildBodyPart(input, boundarySeed),
      ...attachments.flatMap((attachment) => [`--${boundary}`, ...buildAttachmentPart(attachment)]),
      `--${boundary}--`,
      '',
    ]
    return parts.join('\r\n')
  }

  return [...headers, ...buildBodyPart(input, boundarySeed)].join('\r\n')
}

async function writeAudit(input: SendMailboxMessageInput, patch: Record<string, unknown>) {
  await adminDb.collection('mailbox_audit_events').add({
    orgId: input.orgId,
    uid: input.uid,
    accountId: input.accountId,
    actor: { id: input.actorId ?? input.uid, type: input.actorType ?? 'user' },
    approved: Boolean(input.approved),
    approvalGateTaskId: input.approvalGateTaskId ?? null,
    createdAt: FieldValue.serverTimestamp(),
    ...patch,
  })
}

async function writeSentMessage(input: SendMailboxMessageInput, account: MailboxAccountDoc, provider: 'google' | 'smtp', providerMessageId?: string, threadId?: string | null) {
  const now = FieldValue.serverTimestamp()
  const ref = await adminDb.collection('mailbox_messages').add({
    orgId: input.orgId,
    uid: input.uid,
    profileId: account.profileId ?? `${input.orgId}_${input.uid}`,
    accountId: input.accountId,
    accountEmail: account.emailAddress ?? '',
    folder: 'sent',
    direction: 'outbound',
    status: 'sent',
    read: true,
    starred: false,
    from: account.emailAddress ?? '',
    to: normalizeList(input.to),
    cc: normalizeList(input.cc),
    bcc: normalizeList(input.bcc),
    subject: input.subject,
    bodyText: input.bodyText,
    ...(input.bodyHtml ? { bodyHtml: input.bodyHtml } : {}),
    attachments: (input.attachments ?? []).map(({ contentBase64: _contentBase64, ...attachment }) => attachment),
    snippet: snippet(input.bodyText),
    provider,
    providerMessageId: providerMessageId ?? null,
    threadId: threadId ?? null,
    sentAt: now,
    createdAt: now,
    updatedAt: now,
  })
  await adminDb.collection('activities').add({
    orgId: input.orgId,
    type: 'email_sent',
    source: 'mailbox_send_bridge',
    subject: input.subject,
    note: snippet(input.bodyText).slice(0, 500),
    mailboxMessageId: ref.id,
    provider,
    providerMessageId: providerMessageId ?? null,
    createdBy: { id: input.actorId ?? input.uid, type: input.actorType ?? 'user' },
    createdAt: now,
  })
  return ref.id
}

async function loadAccount(input: SendMailboxMessageInput): Promise<{ id: string; data: MailboxAccountDoc } | null> {
  const doc = await adminDb.collection('mailbox_accounts').doc(input.accountId).get()
  if (!doc.exists) return null
  const data = doc.data() as MailboxAccountDoc
  if (data.orgId !== input.orgId || data.uid !== input.uid || data.deletedAt) return null
  return { id: doc.id, data }
}

function decryptGoogle(account: MailboxAccountDoc, orgId: string): GoogleCredentials | null {
  if (!account.googleEnc) return null
  return decryptCredentials<GoogleCredentials>(account.googleEnc, orgId)
}

function decryptSmtp(account: MailboxAccountDoc, orgId: string): SmtpCredentials | null {
  if (!account.smtpEnc) return null
  return decryptCredentials<SmtpCredentials>(account.smtpEnc, orgId)
}

function hasFreshAccessToken(credentials: GoogleCredentials | null): credentials is GoogleCredentials & { accessToken: string } {
  return Boolean(credentials?.accessToken && Number(credentials.expiresAt ?? 0) > Date.now() + REFRESH_SKEW_MS)
}

function buildSmtpRaw(message: { from: string; to: string[]; cc: string[]; bcc: string[]; subject: string; text: string; html?: string; attachments?: MailboxAttachmentStored[] }): string {
  return buildRawEmail({
    orgId: '',
    uid: '',
    accountId: '',
    approved: true,
    to: message.to,
    cc: message.cc,
    bcc: [],
    subject: message.subject,
    bodyText: message.text,
    ...(message.html ? { bodyHtml: message.html } : {}),
    attachments: message.attachments ?? [],
  }, message.from)
}

async function smtpRead(socket: net.Socket | tls.TLSSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      socket.off('error', onError)
      resolve(chunk.toString('utf8'))
    }
    const onError = (error: Error) => {
      socket.off('data', onData)
      reject(error)
    }
    socket.once('data', onData)
    socket.once('error', onError)
  })
}

async function smtpExpect(socket: net.Socket | tls.TLSSocket, codes: number[]): Promise<string> {
  const response = await smtpRead(socket)
  const code = Number(response.slice(0, 3))
  if (!codes.includes(code)) throw new Error(`SMTP unexpected response ${response.trim()}`)
  return response
}

function smtpWrite(socket: net.Socket | tls.TLSSocket, line: string) {
  socket.write(`${line}\r\n`)
}

async function defaultSmtpSend(config: SmtpCredentials, message: Parameters<SmtpSend>[1]): Promise<{ messageId?: string; response?: string }> {
  if (!config.host || !config.port || !config.username || !config.password) throw new Error('SMTP credentials are incomplete')
  const socket = await new Promise<net.Socket | tls.TLSSocket>((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    const connected = () => resolve(socket)
    const socket = config.secure === false
      ? net.connect(config.port!, config.host!, connected)
      : tls.connect({ port: config.port!, host: config.host! }, connected)
    socket.once('error', onError)
    socket.setTimeout(30_000, () => reject(new Error('SMTP connection timed out')))
  })
  try {
    await smtpExpect(socket, [220])
    smtpWrite(socket, 'EHLO partnersinbiz.online')
    await smtpExpect(socket, [250])
    smtpWrite(socket, 'AUTH LOGIN')
    await smtpExpect(socket, [334])
    smtpWrite(socket, Buffer.from(config.username).toString('base64'))
    await smtpExpect(socket, [334])
    smtpWrite(socket, Buffer.from(config.password).toString('base64'))
    await smtpExpect(socket, [235])
    smtpWrite(socket, `MAIL FROM:<${message.from}>`)
    await smtpExpect(socket, [250])
    for (const recipient of [...message.to, ...message.cc, ...message.bcc]) {
      smtpWrite(socket, `RCPT TO:<${recipient}>`)
      await smtpExpect(socket, [250, 251])
    }
    smtpWrite(socket, 'DATA')
    await smtpExpect(socket, [354])
    smtpWrite(socket, `${buildSmtpRaw(message)}\r\n.`)
    const response = await smtpExpect(socket, [250])
    smtpWrite(socket, 'QUIT')
    const match = response.match(/<([^>]+)>|queued as ([^\s]+)/i)
    return { messageId: match?.[1] ?? match?.[2] ?? `smtp-${Date.now()}`, response }
  } finally {
    socket.end()
  }
}

export async function sendMailboxMessage(
  input: SendMailboxMessageInput,
  deps: SendMailboxMessageDeps = {},
): Promise<SendMailboxMessageResult> {
  const to = normalizeList(input.to)
  if (!input.approved) return { ok: false, error: 'Mailbox send must be approved before provider delivery' }
  if (to.length === 0) return { ok: false, error: 'At least one recipient is required' }
  if (!input.subject.trim() && !input.bodyText.trim()) return { ok: false, error: 'Subject or body is required' }

  const loaded = await loadAccount(input)
  if (!loaded) return { ok: false, error: 'Mailbox account not found' }
  const account = loaded.data
  if (account.status !== 'connected') return { ok: false, error: 'Mailbox account is not connected' }

  if (input.dryRun) {
    const provider = account.provider === 'google' ? 'google' : 'smtp'
    await writeAudit(input, { action: 'send_dry_run', provider, recipientCount: to.length, attachmentCount: input.attachments?.length ?? 0 })
    return { ok: true, dryRun: true, provider }
  }

  if (account.provider === 'google') {
    let credentials: GoogleCredentials | null
    try {
      credentials = decryptGoogle(account, input.orgId)
    } catch {
      return { ok: false, error: 'Google credentials could not be decrypted; reconnect this mailbox' }
    }
    if (!hasFreshAccessToken(credentials)) return { ok: false, error: 'Google access expired; sync or reconnect this mailbox before sending' }

    const res = await fetch(GMAIL_SEND_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${credentials.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ raw: base64Url(buildRawEmail(input, account.emailAddress ?? '')) }),
    })
    if (!res.ok) {
      await writeAudit(input, { action: 'send_failed', provider: 'google', status: res.status })
      return { ok: false, error: `Gmail send failed with status ${res.status}` }
    }
    const json = await res.json() as { id?: string; threadId?: string | null }
    const messageId = await writeSentMessage(input, account, 'google', json.id, json.threadId ?? null)
    await writeAudit(input, { action: 'send_success', provider: 'google', providerMessageId: json.id ?? null, threadId: json.threadId ?? null, mailboxMessageId: messageId })
    return { ok: true, provider: 'google', providerMessageId: json.id, threadId: json.threadId ?? null, messageId }
  }

  if (account.provider === 'smtp_imap') {
    let smtp: SmtpCredentials | null
    try {
      smtp = decryptSmtp(account, input.orgId)
    } catch {
      return { ok: false, error: 'SMTP credentials could not be decrypted; reconnect this mailbox' }
    }
    if (!smtp?.host || !smtp.username || !smtp.password) return { ok: false, error: 'SMTP credentials are incomplete' }
    const smtpSend = deps.smtpSend ?? defaultSmtpSend
    const sent = await smtpSend(smtp, {
      from: account.emailAddress ?? smtp.username,
      to,
      cc: normalizeList(input.cc),
      bcc: normalizeList(input.bcc),
      subject: input.subject,
      text: input.bodyText,
      ...(input.bodyHtml ? { html: input.bodyHtml } : {}),
      attachments: input.attachments ?? [],
    })
    const messageId = await writeSentMessage(input, account, 'smtp', sent.messageId, null)
    await writeAudit(input, { action: 'send_success', provider: 'smtp', providerMessageId: sent.messageId ?? null, smtpResponse: sent.response ?? null, mailboxMessageId: messageId })
    return { ok: true, provider: 'smtp', providerMessageId: sent.messageId, threadId: null, messageId }
  }

  return { ok: false, error: 'Unsupported mailbox provider' }
}
