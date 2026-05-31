import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, extractOrgId, hashSourceDocument, normalizeTimestamp } from '../utils'

interface CalendarAttendee {
  name?: string | null
  email?: string | null
  userId?: string | null
  status?: 'pending' | 'accepted' | 'declined' | 'tentative' | string
}

interface CalendarEventDocument extends Record<string, unknown> {
  id: string
  orgId: string
  title?: string | null
  description?: string | null
  startAt?: unknown
  endAt?: unknown
  timezone?: string | null
  location?: string | null
  meetingUrl?: string | null
  attendees?: CalendarAttendee[] | null
  relatedTo?: { type?: string | null; id?: string | null } | null
  assignedTo?: { type?: string | null; id?: string | null } | null
  createdBy?: string | null
  createdByType?: 'user' | 'agent' | 'system' | string | null
  deleted?: boolean
  createdAt?: unknown
  updatedAt?: unknown
}

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function eventTitle(doc: CalendarEventDocument, docId: string): string {
  return cleanString(doc.title) ?? `Calendar event ${docId}`
}

function attendees(doc: CalendarEventDocument): CalendarAttendee[] {
  return Array.isArray(doc.attendees) ? doc.attendees : []
}

function pendingAttendee(doc: CalendarEventDocument): CalendarAttendee | null {
  return attendees(doc).find((attendee) => attendee?.status === 'pending') ?? null
}

function attendeeLabel(attendee: CalendarAttendee | null): string | null {
  return cleanString(attendee?.name) ?? cleanString(attendee?.email)
}

function formatEventTime(value: unknown): string | null {
  const date = normalizeTimestamp(value)
  if (!date) return null
  return date.toISOString()
}

function relatedContext(doc: CalendarEventDocument) {
  const type = cleanString(doc.relatedTo?.type)
  const id = cleanString(doc.relatedTo?.id)
  return {
    contactId: type === 'contact' ? id : null,
    dealId: type === 'deal' ? id : null,
    projectId: type === 'project' ? id : null,
  }
}

function sourceUrl(doc: CalendarEventDocument, docId: string): string {
  const type = cleanString(doc.relatedTo?.type)
  const id = cleanString(doc.relatedTo?.id)
  const eventParam = `event=${encodeURIComponent(docId)}`
  if (type === 'contact' && id) return `/portal/contacts/${encodeURIComponent(id)}?${eventParam}`
  if (type === 'deal' && id) return `/portal/deals/${encodeURIComponent(id)}?${eventParam}`
  if (type === 'project' && id) return `/portal/projects/${encodeURIComponent(id)}?${eventParam}`
  return `/portal/crm?${eventParam}`
}

export const calendarEventAdapter: BriefingSourceAdapter<CalendarEventDocument> = {
  sourceType: 'calendar-event',
  collectionPath: 'calendar_events',

  hashSource(doc: CalendarEventDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['title', 'description', 'startAt', 'endAt', 'attendees', 'assignedTo', 'updatedAt'])
  },

  shouldGenerate(doc: CalendarEventDocument): boolean {
    if (doc.deleted === true) return false
    if (!normalizeTimestamp(doc.startAt)) return false
    return Boolean(pendingAttendee(doc))
  },

  extractPriority(): BriefingPriority {
    return 'needs-peet'
  },

  extractActor(doc: CalendarEventDocument) {
    const createdBy = cleanString(doc.createdBy)
    if (doc.createdByType === 'agent' && createdBy) {
      const agentId = createdBy.replace(/^agent:/, '')
      return {
        id: `agent:${agentId}`,
        name: agentId.charAt(0).toUpperCase() + agentId.slice(1),
        role: 'ai' as const,
        type: 'agent' as const,
      }
    }
    if (createdBy) {
      return {
        id: createdBy.startsWith('user:') ? createdBy : `user:${createdBy}`,
        role: 'admin' as const,
        type: 'user' as const,
      }
    }
    return { id: 'system', name: 'System', role: 'system' as const, type: 'system' as const }
  },

  extractContext(doc: CalendarEventDocument, docId: string) {
    const orgId = extractOrgId(doc) ?? ''
    const related = relatedContext(doc)
    return {
      orgId,
      ...related,
      calendarEventId: docId,
      calendarEventTitle: eventTitle(doc, docId),
    }
  },

  extractTitle(doc: CalendarEventDocument, docId: string): string {
    return `RSVP needed: ${eventTitle(doc, docId)}`
  },

  extractSummary(doc: CalendarEventDocument): string {
    const startAt = formatEventTime(doc.startAt)
    const endAt = formatEventTime(doc.endAt)
    const attendee = attendeeLabel(pendingAttendee(doc))
    const parts = [`Starts ${startAt ?? 'time unavailable'}`]
    if (endAt) parts.push(`Ends ${endAt}`)
    if (doc.timezone) parts.push(String(doc.timezone))
    if (attendee) parts.push(`RSVP pending for ${attendee}`)
    if (doc.location) parts.push(`Location: ${doc.location}`)
    return parts.join('. ')
  },

  extractExcerpt(doc: CalendarEventDocument, docIdOrMaxLength: string | number = 300, maxLength = 300): string | null {
    const limit = typeof docIdOrMaxLength === 'number' ? docIdOrMaxLength : maxLength
    return extractMultiFieldExcerpt(doc, ['description', 'location', 'meetingUrl'], { maxLength: limit })
  },

  extractOccurredAt(doc: CalendarEventDocument): Date | null {
    return normalizeTimestamp(doc.updatedAt) ?? normalizeTimestamp(doc.createdAt) ?? normalizeTimestamp(doc.startAt)
  },

  extractMetadata(doc: CalendarEventDocument): Record<string, unknown> | null {
    const attendee = pendingAttendee(doc)
    return {
      rsvpStatus: attendee?.status ?? null,
      attendeeEmail: cleanString(attendee?.email),
      attendeeName: cleanString(attendee?.name),
      startAt: formatEventTime(doc.startAt),
      endAt: formatEventTime(doc.endAt),
      timezone: cleanString(doc.timezone),
      location: cleanString(doc.location),
      meetingUrl: cleanString(doc.meetingUrl),
      relatedToType: cleanString(doc.relatedTo?.type),
      relatedToId: cleanString(doc.relatedTo?.id),
    }
  },

  toItem(doc: CalendarEventDocument, docId: string) {
    const orgId = extractOrgId(doc) ?? ''
    const priority = this.extractPriority(doc, docId)
    const actor = this.extractActor(doc, docId)
    const context = this.extractContext(doc, docId)
    const title = this.extractTitle(doc, docId)
    const summary = this.extractSummary(doc, docId)
    const excerpt = this.extractExcerpt(doc, docId)
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()
    const metadata = this.extractMetadata?.(doc, docId)
    const sourceHash = this.hashSource(doc, docId)

    return {
      orgId,
      source: {
        type: this.sourceType,
        id: docId,
        collectionPath: this.collectionPath,
        url: sourceUrl(doc, docId),
      },
      priority,
      status: 'new' as const,
      title,
      summary,
      excerpt,
      actor,
      context,
      occurredAt,
      sourceHash,
      metadata,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    }
  },
}
