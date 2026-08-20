/**
 * Task-specific briefing facts and copy.
 *
 * Cards should show the useful fields for that source (deal, contact, value,
 * email, next action) and omit empty/unknown/opaque-id placeholders.
 */

import type { BriefingCard, BriefingSourceItem } from './types'

export type BriefingFact = {
  id: string
  label: string
  value: string
  href?: string
}

export type CrmDisplayRecord = {
  id: string
  name?: string | null
  title?: string | null
  email?: string | null
  phone?: string | null
  company?: string | null
  companyId?: string | null
  companyName?: string | null
  contactId?: string | null
  value?: number | null
  amount?: number | null
  currency?: string | null
  stageLabel?: string | null
  stageName?: string | null
  stage?: string | null
  jobTitle?: string | null
}

const OPAQUE_ID = /^[A-Za-z0-9_-]{16,}$|^[a-z]+_[A-Za-z0-9_-]{8,}$/i

export function looksLikeOpaqueId(value: string | null | undefined): boolean {
  if (!value) return false
  return OPAQUE_ID.test(value.trim())
}

export function humanText(value: unknown, maxLength = 240): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  if (!text || looksLikeOpaqueId(text) || text.toLowerCase() === 'unknown') return null
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text
}

export function formatBriefingMoney(amount: unknown, currency: unknown): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null
  const code = humanText(currency, 8) ?? 'ZAR'
  const symbol = code === 'ZAR' ? 'R' : code === 'USD' ? '$' : code === 'EUR' ? '€' : `${code} `
  return `${symbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function meta(item: BriefingSourceItem, key: string): unknown {
  return item.metadata?.[key]
}

function metaText(item: BriefingSourceItem, ...keys: string[]): string | null {
  for (const key of keys) {
    const text = humanText(meta(item, key))
    if (text) return text
  }
  return null
}

function metaNumber(item: BriefingSourceItem, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = meta(item, key)
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function pushFact(facts: BriefingFact[], id: string, label: string, value: string | null | undefined, href?: string | null) {
  const clean = humanText(value, 280)
  if (!clean) return
  if (facts.some((fact) => fact.id === id || fact.value === clean)) return
  facts.push({ id, label, value: clean, ...(href ? { href } : {}) })
}

function dealValue(item: BriefingSourceItem): string | null {
  return formatBriefingMoney(metaNumber(item, 'value', 'amount', 'dealValue', 'total'), metaText(item, 'currency') ?? 'ZAR')
}

function contactEmail(item: BriefingSourceItem): string | null {
  const email = metaText(item, 'email', 'contactEmail')
  return email && email.includes('@') ? email : null
}

function contactPhone(item: BriefingSourceItem): string | null {
  return metaText(item, 'phone', 'contactPhone')
}

export function briefingContactChannels(item: BriefingSourceItem): { email: string | null; phone: string | null } {
  return { email: contactEmail(item), phone: contactPhone(item) }
}

export function briefingHasContactChannel(item: BriefingSourceItem): boolean {
  const channels = briefingContactChannels(item)
  return Boolean(channels.email || channels.phone)
}

export function isCrmRelationshipSource(type: string): boolean {
  return ['activity', 'contact', 'deal', 'booking', 'enquiry', 'form-submission', 'quote'].includes(type)
}

function activityType(item: BriefingSourceItem): string {
  return (metaText(item, 'activityType') ?? item.source.type).toLowerCase()
}

function stageChangeLabel(item: BriefingSourceItem): string | null {
  const from = metaText(item, 'fromStageLabel', 'previousStageLabel')
  const to = metaText(item, 'toStageLabel', 'stageLabel')
  if (from && to) return `${from} → ${to}`
  return to ?? from
}

function defaultNextAction(item: BriefingSourceItem): string | null {
  const explicit = metaText(item, 'nextAction')
  if (explicit) return explicit
  const type = item.source.type
  if (type === 'contact') return 'Call or email the contact, then log the next CRM step.'
  if (type === 'deal' || (type === 'activity' && activityType(item).includes('stage'))) {
    return 'Confirm the new stage with the contact and schedule the next sales step.'
  }
  if (type === 'activity') return 'Log the outcome against this CRM record or schedule the next follow-up.'
  if (type === 'booking') return 'Confirm the meeting details and prepare for the call.'
  if (type === 'enquiry' || type === 'form-submission') return 'Qualify the enquiry and reply or create the next internal follow-up.'
  if (type === 'mailbox-message') return 'Read the email and draft a reply without sending until it is approved.'
  if (type === 'support-ticket') return 'Reply to the ticket or route it to the owning specialist.'
  if (type === 'invoice') return 'Review the invoice status and take the next billing step.'
  if (type === 'quote') return 'Review the quote and accept, decline, or convert it.'
  if (type === 'agent-output' || type === 'agent-learning-review') return 'Review the evidence, then approve or send it back.'
  return null
}

export function briefingDisplayFacts(item: BriefingSourceItem): BriefingFact[] {
  const facts: BriefingFact[] = []
  const ctx = item.context

  pushFact(facts, 'deal', 'Deal', humanText(ctx.dealTitle) ?? (activityType(item).includes('stage') ? null : null))
  pushFact(facts, 'value', 'Value', dealValue(item))
  pushFact(facts, 'stage', 'Stage', stageChangeLabel(item) ?? metaText(item, 'stageLabel', 'contactStage', 'stage'))
  pushFact(facts, 'company', 'Company', humanText(ctx.companyName) ?? metaText(item, 'company', 'companyName'))
  pushFact(facts, 'contact', 'Contact', humanText(ctx.contactName))
  const email = contactEmail(item)
  const phone = contactPhone(item)
  pushFact(facts, 'email', 'Email', email, email ? `mailto:${email}` : null)
  pushFact(facts, 'phone', 'Phone', phone, phone ? `tel:${phone}` : null)
  pushFact(facts, 'job-title', 'Role', metaText(item, 'jobTitle'))
  pushFact(facts, 'project', 'Project', humanText(ctx.projectName))
  pushFact(facts, 'task', 'Task', humanText(ctx.taskTitle))
  pushFact(facts, 'document', 'Document', humanText(ctx.documentTitle))
  pushFact(facts, 'report', 'Report', humanText(ctx.reportTitle))
  pushFact(facts, 'conversation', 'Conversation', humanText(ctx.conversationTitle))
  pushFact(facts, 'quote', 'Quote', humanText(ctx.quoteNumber))
  pushFact(facts, 'invoice', 'Invoice', humanText(ctx.invoiceNumber))
  pushFact(facts, 'order', 'Order', humanText(ctx.orderTitle))
  pushFact(facts, 'ticket', 'Ticket', humanText(ctx.supportTicketSubject))
  pushFact(facts, 'status', 'Status', metaText(item, 'invoiceStatus', 'quoteStatus', 'orderStatus', 'shipmentStatus', 'fulfillmentStatus', 'seoTaskStatus', 'contactStage'))
  pushFact(facts, 'campaign', 'Campaign', humanText(ctx.campaignName) ?? humanText(ctx.adCampaignName) ?? humanText(ctx.broadcastName))
  pushFact(facts, 'booking', 'Booking', humanText(ctx.bookingName))
  pushFact(facts, 'calendar', 'Meeting', humanText(ctx.calendarEventTitle))
  pushFact(facts, 'mailbox', 'From', humanText(ctx.mailboxFrom))
  pushFact(facts, 'subject', 'Subject', humanText(ctx.mailboxSubject) ?? metaText(item, 'subject'))
  pushFact(facts, 'enquiry', 'Enquiry', humanText(ctx.enquiryName))
  pushFact(facts, 'seo', 'SEO', humanText(ctx.seoTaskTitle) ?? humanText(ctx.seoContentTitle))
  pushFact(facts, 'workspace', 'Workspace', humanText(ctx.orgName))
  const next = defaultNextAction(item)
  pushFact(facts, 'next', 'Next', next)

  return facts
}

export function briefingListFacts(item: BriefingSourceItem, limit = 4): BriefingFact[] {
  const preferred = ['deal', 'value', 'company', 'contact', 'stage', 'email', 'phone', 'invoice', 'quote', 'ticket', 'booking', 'subject', 'project', 'task', 'next']
  const facts = briefingDisplayFacts(item)
  const ranked = preferred
    .map((id) => facts.find((fact) => fact.id === id))
    .filter((fact): fact is BriefingFact => Boolean(fact))
  const rest = facts.filter((fact) => !ranked.some((row) => row.id === fact.id) && fact.id !== 'workspace' && fact.id !== 'next')
  return [...ranked, ...rest].slice(0, limit)
}

export function briefingUsefulSummary(item: BriefingSourceItem): string {
  const facts = briefingDisplayFacts(item).filter((fact) => fact.id !== 'next' && fact.id !== 'workspace')
  if (facts.length === 0) {
    const copy = humanText(item.excerpt, 280) ?? humanText(item.summary, 280) ?? ''
    return copy.replace(/(?:^|\.\s*)View:\s*\S+/g, '').replace(/\s{2,}/g, ' ').trim()
  }
  const headlineFacts = facts.filter((fact) => ['deal', 'value', 'company', 'contact', 'stage'].includes(fact.id))
  if (headlineFacts.length >= 2) {
    return headlineFacts.map((fact) => `${fact.label}: ${fact.value}`).join(' · ')
  }
  return facts.slice(0, 4).map((fact) => `${fact.label}: ${fact.value}`).join(' · ')
}

export function isGenericBriefingDecision(item: BriefingSourceItem): boolean {
  const ids = (item.options ?? []).map((option) => option.id).sort().join(',')
  return ids === 'create-follow-up,review'
}

export function isBoilerplateDisabledReason(reason: string | null | undefined): boolean {
  if (!reason) return true
  return /unsafe external actions are unavailable|production deploys, main merges|gated-external-actions/i.test(reason)
}

function recordName(record: CrmDisplayRecord | null | undefined): string | null {
  if (!record) return null
  return humanText(record.name) ?? humanText(record.title) ?? null
}

function recordCompany(record: CrmDisplayRecord | null | undefined): { id: string | null; name: string | null } {
  if (!record) return { id: null, name: null }
  return {
    id: humanText(record.companyId, 80) ?? (typeof record.companyId === 'string' ? record.companyId : null),
    name: humanText(record.companyName) ?? humanText(record.company),
  }
}

function activityHeadline(item: BriefingSourceItem): string | null {
  const type = activityType(item)
  const deal = humanText(item.context.dealTitle)
  const contact = humanText(item.context.contactName)
  const value = dealValue(item)
  const stage = stageChangeLabel(item)
  const toStage = metaText(item, 'toStageLabel')

  if (type.includes('stage') || /deal moved/i.test(item.title) || /deal moved/i.test(item.summary)) {
    const subject = deal ?? contact
    if (subject && toStage) return `${subject}${value ? ` · ${value}` : ''} → ${toStage}`
    if (subject && stage) return `${subject}${value ? ` · ${value}` : ''}: ${stage}`
    if (subject) return value ? `${subject} · ${value}` : subject
  }

  if (metaText(item, 'followUpIntent') && contact) return `Follow up with ${contact}${deal ? ` · ${deal}` : ''}${value ? ` (${value})` : ''}`
  if (deal && contact) return `${deal} · ${contact}`
  return deal ?? null
}

export function briefingSpecificTitle(item: BriefingSourceItem): string {
  if (item.source.type === 'activity') {
    return activityHeadline(item) ?? item.title
  }
  return item.title
}

export function applyCrmDisplayRecords(
  item: BriefingCard,
  records: { contact?: CrmDisplayRecord | null; deal?: CrmDisplayRecord | null; company?: CrmDisplayRecord | null },
): BriefingCard {
  const contact = records.contact ?? null
  const deal = records.deal ?? null
  const company = records.company ?? null
  const contactName = humanText(item.context.contactName) ?? recordName(contact)
  const dealTitle = humanText(item.context.dealTitle) ?? recordName(deal)
  const companyFromRecords = recordCompany(company).name ?? recordCompany(deal).name ?? recordCompany(contact).name
  const companyName = humanText(item.context.companyName) ?? companyFromRecords
  const companyId = item.context.companyId ?? deal?.companyId ?? contact?.companyId ?? company?.id ?? null
  const email = contactEmail(item) ?? humanText(contact?.email)
  const phone = contactPhone(item) ?? humanText(contact?.phone)
  const value = metaNumber(item, 'value', 'amount', 'dealValue') ?? deal?.value ?? deal?.amount ?? null
  const currency = metaText(item, 'currency') ?? humanText(deal?.currency, 8)
  const stageLabel = metaText(item, 'stageLabel', 'toStageLabel') ?? humanText(deal?.stageLabel) ?? humanText(deal?.stageName) ?? humanText(deal?.stage)

  const context = {
    ...item.context,
    contactName: contactName ?? item.context.contactName ?? null,
    dealTitle: dealTitle ?? item.context.dealTitle ?? null,
    companyName: companyName ?? item.context.companyName ?? null,
    companyId: typeof companyId === 'string' ? companyId : item.context.companyId ?? null,
    contactId: item.context.contactId ?? contact?.id ?? deal?.contactId ?? null,
    dealId: item.context.dealId ?? deal?.id ?? null,
  }

  const metadata = {
    ...(item.metadata ?? {}),
    email: email ?? meta(item, 'email') ?? null,
    phone: phone ?? meta(item, 'phone') ?? null,
    company: companyName ?? meta(item, 'company') ?? null,
    companyName: companyName ?? meta(item, 'companyName') ?? null,
    value: value ?? meta(item, 'value') ?? null,
    currency: currency ?? meta(item, 'currency') ?? null,
    stageLabel: stageLabel ?? meta(item, 'stageLabel') ?? null,
    jobTitle: metaText(item, 'jobTitle') ?? humanText(contact?.jobTitle) ?? null,
    dealTitle: dealTitle ?? meta(item, 'dealTitle') ?? null,
    contactName: contactName ?? meta(item, 'contactName') ?? null,
  }

  const next: BriefingCard = { ...item, context, metadata }
  const shouldRetitle = item.source.type === 'activity' && (
    /deal moved|activity:\s*stage/i.test(`${item.title} ${item.summary}`)
    || activityType(item).includes('stage')
  )
  if (!shouldRetitle) return next

  const title = briefingSpecificTitle(next)
  const summaryFacts = briefingUsefulSummary(next)
  const nextAction = defaultNextAction(next)
  const summary = summaryFacts
    ? (nextAction && !summaryFacts.includes(nextAction) ? `${summaryFacts}. Next: ${nextAction}` : summaryFacts)
    : item.summary

  return {
    ...next,
    title,
    summary,
    excerpt: humanText(item.excerpt) && !/deal moved|activity:/i.test(item.excerpt ?? '') ? item.excerpt : summary,
  }
}

export function crmIdsFromItem(item: BriefingSourceItem): { contactId: string | null; dealId: string | null; companyId: string | null } {
  return {
    contactId: typeof item.context.contactId === 'string' && item.context.contactId ? item.context.contactId : typeof item.metadata?.contactId === 'string' ? item.metadata.contactId : null,
    dealId: typeof item.context.dealId === 'string' && item.context.dealId ? item.context.dealId : typeof item.metadata?.dealId === 'string' ? item.metadata.dealId : null,
    companyId: typeof item.context.companyId === 'string' && item.context.companyId ? item.context.companyId : typeof item.metadata?.companyId === 'string' ? item.metadata.companyId : null,
  }
}
