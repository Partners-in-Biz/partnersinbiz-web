import type { BriefingCard } from '../cockpit/cockpitTypes'
import { humanText } from '@/lib/briefing/cardFacts'

export function metaString(item: BriefingCard, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = item.metadata?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function parseWhen(item: BriefingCard): Date | null {
  const iso = metaString(item, 'startAt', 'start', 'scheduledFor', 'dueDate')
  if (iso) {
    const parsed = new Date(iso)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  const date = metaString(item, 'date')
  const time = metaString(item, 'time')
  if (date) {
    const parsed = new Date(time ? `${date}T${time}` : date)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return null
}

function startOfDay(date: Date): number {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy.getTime()
}

/**
 * "Today 10:00", "Tomorrow 14:30", "Mon 8 Sep 10:00", or the raw date/time
 * strings when they cannot be parsed.
 */
export function whenLabel(item: BriefingCard, now: Date = new Date()): string | null {
  const when = parseWhen(item)
  if (!when) {
    const date = metaString(item, 'date')
    const time = metaString(item, 'time')
    if (date && time) return `${date} ${time}`
    return date ?? metaString(item, 'startAt', 'start') ?? null
  }
  const hasTime = Boolean(metaString(item, 'time')) || /T\d{2}:\d{2}/.test(metaString(item, 'startAt', 'start', 'scheduledFor') ?? '')
  const time = hasTime ? when.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''
  const dayDiff = Math.round((startOfDay(when) - startOfDay(now)) / 86_400_000)
  let day: string
  if (dayDiff === 0) day = 'Today'
  else if (dayDiff === 1) day = 'Tomorrow'
  else if (dayDiff === -1) day = 'Yesterday'
  else day = when.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })
  return time ? `${day} ${time}` : day
}

/** ISO start time of the meeting/booking on the item, when it can be parsed. */
export function whenIso(item: BriefingCard): string | null {
  const when = parseWhen(item)
  return when ? when.toISOString() : null
}

export function isPastWhen(item: BriefingCard, now: Date = new Date()): boolean {
  const when = parseWhen(item)
  return Boolean(when && when.getTime() < now.getTime())
}

export function meetLink(item: BriefingCard): string | null {
  return metaString(item, 'meetLink', 'meetingUrl', 'meetUrl', 'hangoutLink')
}

export function personLine(item: BriefingCard): string | null {
  return humanText(item.context.contactName)
    ?? humanText(item.context.bookingName)
    ?? humanText(item.context.enquiryName)
    ?? humanText(item.context.mailboxFrom)
    ?? humanText(item.context.socialInboxFrom)
    ?? metaString(item, 'contactName', 'attendeeName', 'recipientName', 'requesterName', 'fromLabel', 'name')
}

export function companyLine(item: BriefingCard): string | null {
  return humanText(item.context.companyName) ?? metaString(item, 'company', 'companyName', 'recipientCompanyName')
}

export function agentDisplayName(id: string | null | undefined): string | null {
  if (!id) return null
  const clean = id.replace(/^agent:/, '').trim()
  if (!clean) return null
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}

export function actorAgentName(item: BriefingCard): string | null {
  const assigned = metaString(item, 'assigneeAgentId', 'assignedAgentId', 'agentId')
  if (assigned) return agentDisplayName(assigned)
  if (item.actor?.type === 'agent') return agentDisplayName(item.actor.name ?? item.actor.id)
  return null
}

export function stripViewLinks(value: string | null | undefined): string {
  if (!value) return ''
  return value.replace(/(?:^|\.\s*)View:\s*\S+/g, '').replace(/\s{2,}/g, ' ').trim()
}
