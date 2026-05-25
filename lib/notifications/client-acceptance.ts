import crypto from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'

import { canAccessOrg } from '@/lib/api/platformAdmin'
import type { ApiUser } from '@/lib/api/types'
import { adminDb } from '@/lib/firebase/admin'
import { normaliseAdminNotificationPreference, preferenceDocId } from '@/lib/notifications/adminPreferences'

export type ClientAcceptanceEventName = 'client_document.accepted' | 'client_document.approved' | 'quote.accepted'

type AdminRecipient = {
  id: string
  displayName?: string
  email?: string
}

type NotificationChannel = 'platform' | 'email'

type ClientDocumentAcceptanceInput = {
  orgId: string
  documentId: string
  documentTitle?: string
  versionId: string
  approvalId: string
  actorName: string
  mode: 'formal_acceptance' | 'operational'
}

type QuoteAcceptanceInput = {
  orgId: string
  quoteId: string
  quoteNumber?: string
  total?: number
  currency?: string
  companyName?: string
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  return values.length > 0 ? values : undefined
}

function readPath(data: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[part]
  }, data)
}

function explicitlyFalse(data: Record<string, unknown>, paths: string[], channel?: NotificationChannel): boolean {
  return paths.some((path) => {
    const value = readPath(data, path)
    if (value === false) return true
    if (channel && value && typeof value === 'object' && (value as Record<string, unknown>)[channel] === false) return true
    return false
  })
}

function includesEventOrCategory(value: unknown, eventName: ClientAcceptanceEventName): boolean | undefined {
  const values = stringList(value)
  if (!values) return undefined
  return values.includes(eventName) || values.includes('client_acceptance') || values.includes('clientAcceptance')
}

function isSubscribedToAcceptanceChannel(
  data: Record<string, unknown>,
  eventName: ClientAcceptanceEventName,
  channel: NotificationChannel,
): boolean {
  if (explicitlyFalse(data, [
    channel === 'platform' ? 'notificationsEnabled' : 'emailNotificationsEnabled',
    channel === 'platform' ? 'platformNotifications' : 'emailNotifications',
    `notificationPreferences.${channel}`,
    `notificationPreferences.channels.${channel}`,
    'notificationPreferences.clientAcceptance',
    `notificationPreferences.clientAcceptance.${channel}`,
    `notificationPreferences.events.${eventName}`,
    `notificationPreferences.${channel}Events.${eventName}`,
  ], channel)) {
    return false
  }

  const explicitSubscriptions = [
    includesEventOrCategory(readPath(data, `notificationSubscriptions.${channel}`), eventName),
    includesEventOrCategory(readPath(data, 'notificationSubscriptions.events'), eventName),
    includesEventOrCategory(readPath(data, 'notificationPreferences.subscribedEvents'), eventName),
    includesEventOrCategory(readPath(data, `notificationPreferences.${channel}Events`), eventName),
  ].filter((value): value is boolean => typeof value === 'boolean')

  if (explicitSubscriptions.length > 0) return explicitSubscriptions.some(Boolean)

  return true
}

async function storedPreferenceAllows(userId: string, orgId: string, channel: NotificationChannel): Promise<boolean> {
  const snap = await adminDb.collection('admin_notification_preferences').doc(preferenceDocId(userId, orgId)).get()
  const preference = normaliseAdminNotificationPreference(snap.exists ? snap.data() : undefined, userId, orgId)
  const eventChannels = preference.eventClasses.client_acceptance
  if (channel === 'platform') return preference.channels.inApp && eventChannels.inApp
  return preference.channels.email && eventChannels.email
}

async function subscribedAdminRecipients(
  orgId: string,
  eventName: ClientAcceptanceEventName,
  channel: NotificationChannel,
): Promise<AdminRecipient[]> {
  const snap = await adminDb.collection('users').where('role', '==', 'admin').get()
  const recipients: AdminRecipient[] = []

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>
    const user: ApiUser = {
      uid: doc.id,
      role: 'admin',
      orgId: text(data.orgId),
      orgIds: stringList(data.orgIds),
      allowedOrgIds: stringList(data.allowedOrgIds),
    }

    if (!canAccessOrg(user, orgId)) continue
    if (!isSubscribedToAcceptanceChannel(data, eventName, channel)) continue
    if (!(await storedPreferenceAllows(doc.id, orgId, channel))) continue

    const email = text(data.email)
    if (channel === 'email' && !email) continue

    recipients.push({ id: doc.id, displayName: text(data.displayName), email })
  }

  return recipients
}

function stableNotificationId(parts: Array<string | number | undefined | null>): string {
  const key = parts.map((part) => String(part ?? '')).join('|')
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 40)
}

async function writeNotification(args: {
  orgId: string
  userId: string
  eventName: ClientAcceptanceEventName
  resourceId: string
  dedupeKey: string
  title: string
  body: string
  link: string
  priority?: 'normal' | 'high'
  data: Record<string, unknown>
}) {
  const id = stableNotificationId([args.orgId, args.userId, args.eventName, args.resourceId, args.dedupeKey])
  await adminDb.collection('notifications').doc(id).set({
    orgId: args.orgId,
    userId: args.userId,
    agentId: null,
    type: args.eventName,
    title: args.title,
    body: args.body,
    link: args.link,
    data: args.data,
    priority: args.priority ?? 'normal',
    status: 'unread',
    snoozedUntil: null,
    readAt: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
}

function plainTextFromHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function acceptanceEmailHtml(args: { heading: string; body: string; href: string }): string {
  return `<!DOCTYPE html><html lang="en"><body style="font-family:sans-serif;color:#111827;line-height:1.6">
    <p style="color:#16a34a;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;font-weight:700">✓ Client acceptance</p>
    <h1 style="font-size:22px;margin:0 0 16px">${args.heading}</h1>
    <p>${args.body}</p>
    <p><a href="${args.href}" style="display:inline-block;background:#F5A623;color:#000;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:700">Open in Partners in Biz</a></p>
  </body></html>`
}

async function enqueueAcceptanceEmail(args: {
  orgId: string
  userId: string
  to: string
  eventName: ClientAcceptanceEventName
  resourceId: string
  dedupeKey: string
  subject: string
  html: string
  metadata: Record<string, unknown>
}): Promise<boolean> {
  const id = stableNotificationId([args.orgId, args.userId, args.eventName, args.resourceId, args.dedupeKey, 'email'])
  try {
    await adminDb.collection('emails').doc(id).create({
      orgId: args.orgId,
      to: args.to,
      cc: [],
      subject: args.subject,
      bodyHtml: args.html,
      bodyText: plainTextFromHtml(args.html),
      status: 'scheduled',
      scheduledFor: FieldValue.serverTimestamp(),
      source: 'client_acceptance_notification',
      metadata: args.metadata,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return true
  } catch (err) {
    const code = (err as { code?: number | string }).code
    if (code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS') return false
    throw err
  }
}

export async function notifyClientDocumentAccepted(input: ClientDocumentAcceptanceInput): Promise<{ notified: number; emailsQueued: number }> {
  const eventName: ClientAcceptanceEventName = input.mode === 'formal_acceptance'
    ? 'client_document.accepted'
    : 'client_document.approved'
  const platformRecipients = await subscribedAdminRecipients(input.orgId, eventName, 'platform')
  const emailRecipients = await subscribedAdminRecipients(input.orgId, eventName, 'email')
  const documentTitle = input.documentTitle?.trim() || 'Client document'
  const actorName = input.actorName?.trim() || 'A client'
  const title = input.mode === 'formal_acceptance' ? 'Proposal accepted' : 'Document approved'
  const body = input.mode === 'formal_acceptance'
    ? `${actorName} accepted ${documentTitle}.`
    : `${actorName} approved ${documentTitle}.`

  await Promise.all(platformRecipients.map((recipient) => writeNotification({
    orgId: input.orgId,
    userId: recipient.id,
    eventName,
    resourceId: input.documentId,
    dedupeKey: `${input.versionId}:${input.mode}`,
    title,
    body,
    link: `/admin/documents/${input.documentId}`,
    priority: 'high',
    data: {
      documentId: input.documentId,
      documentTitle,
      versionId: input.versionId,
      approvalId: input.approvalId,
      actorName,
      mode: input.mode,
    },
  })))

  const subject = input.mode === 'formal_acceptance'
    ? `${documentTitle} — Accepted ✓`
    : `${documentTitle} — Approved ✓`
  const href = `https://partnersinbiz.online/admin/documents/${input.documentId}`
  const html = acceptanceEmailHtml({ heading: title, body, href })
  const emailResults = await Promise.all(emailRecipients.map((recipient) => enqueueAcceptanceEmail({
    orgId: input.orgId,
    userId: recipient.id,
    to: recipient.email!,
    eventName,
    resourceId: input.documentId,
    dedupeKey: `${input.versionId}:${input.mode}`,
    subject,
    html,
    metadata: {
      eventName,
      documentId: input.documentId,
      documentTitle,
      versionId: input.versionId,
      approvalId: input.approvalId,
      actorName,
      mode: input.mode,
    },
  })))

  return { notified: platformRecipients.length, emailsQueued: emailResults.filter(Boolean).length }
}

export async function notifyQuoteAccepted(input: QuoteAcceptanceInput): Promise<{ notified: number; emailsQueued: number }> {
  const eventName: ClientAcceptanceEventName = 'quote.accepted'
  const platformRecipients = await subscribedAdminRecipients(input.orgId, eventName, 'platform')
  const emailRecipients = await subscribedAdminRecipients(input.orgId, eventName, 'email')
  const quoteLabel = input.quoteNumber?.trim() || input.quoteId
  const clientLabel = input.companyName?.trim() ? ` for ${input.companyName.trim()}` : ''
  const amount = typeof input.total === 'number'
    ? ` (${new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: input.currency || 'ZAR',
    }).format(input.total)})`
    : ''
  const title = 'Quote accepted'
  const body = `Quote ${quoteLabel}${clientLabel} was accepted${amount}.`
  const link = `/admin/quotes/${input.quoteId}`
  const metadata = {
    eventName,
    quoteId: input.quoteId,
    quoteNumber: input.quoteNumber ?? null,
    total: input.total ?? null,
    currency: input.currency ?? null,
    companyName: input.companyName ?? null,
  }

  await Promise.all(platformRecipients.map((recipient) => writeNotification({
    orgId: input.orgId,
    userId: recipient.id,
    eventName,
    resourceId: input.quoteId,
    dedupeKey: 'accepted',
    title,
    body,
    link,
    priority: 'high',
    data: metadata,
  })))

  const html = acceptanceEmailHtml({ heading: title, body, href: `https://partnersinbiz.online${link}` })
  const emailResults = await Promise.all(emailRecipients.map((recipient) => enqueueAcceptanceEmail({
    orgId: input.orgId,
    userId: recipient.id,
    to: recipient.email!,
    eventName,
    resourceId: input.quoteId,
    dedupeKey: 'accepted',
    subject: `${quoteLabel} — Accepted ✓`,
    html,
    metadata,
  })))

  return { notified: platformRecipients.length, emailsQueued: emailResults.filter(Boolean).length }
}
