import { PIB_PLATFORM_ORG_ID } from '@/lib/platform/constants'
import type { BriefingPriority, BriefingSourceAdapter } from '../types'
import { extractMultiFieldExcerpt, hashSourceDocument, normalizeTimestamp } from '../utils'

interface BookingDocument extends Record<string, unknown> {
  name?: string | null
  email?: string | null
  company?: string | null
  brief?: string | null
  date?: string | null
  time?: string | null
  durationMins?: number | null
  timezone?: string | null
  googleEventId?: string | null
  meetLink?: string | null
  status?: string | null
  createdAt?: unknown
  updatedAt?: unknown
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function numeric(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function bookingName(doc: BookingDocument, docId: string): string {
  return clean(doc.name) ?? clean(doc.email) ?? docId
}

function sourceUrl(docId: string): string {
  return `/admin/briefings?source=booking&id=${encodeURIComponent(docId)}`
}

function bookingStart(doc: BookingDocument): Date | null {
  const date = clean(doc.date)
  const time = clean(doc.time)
  if (!date || !time) return null
  const start = new Date(`${date}T${time}:00+02:00`)
  return Number.isNaN(start.getTime()) ? null : start
}

export const bookingAdapter: BriefingSourceAdapter<BookingDocument> = {
  sourceType: 'booking',
  collectionPath: 'bookings',

  hashSource(doc: BookingDocument, docId: string): string {
    return hashSourceDocument(doc, docId, ['name', 'email', 'company', 'brief', 'date', 'time', 'durationMins', 'timezone', 'googleEventId', 'meetLink', 'status', 'updatedAt'])
  },

  shouldGenerate(doc: BookingDocument): boolean {
    return doc.status === 'confirmed'
  },

  extractPriority(doc: BookingDocument): BriefingPriority {
    if (!clean(doc.googleEventId) || !clean(doc.meetLink)) return 'critical'
    return 'needs-peet'
  },

  extractActor(doc: BookingDocument, docId: string) {
    const email = clean(doc.email)
    return {
      id: email ? `booking:${email}` : `booking:${docId}`,
      name: bookingName(doc, docId),
      role: 'client' as const,
      type: 'user' as const,
    }
  },

  extractContext(doc: BookingDocument, docId: string) {
    return {
      orgId: PIB_PLATFORM_ORG_ID,
      bookingId: docId,
      bookingName: bookingName(doc, docId),
    }
  },

  extractTitle(doc: BookingDocument, docId: string): string {
    const label = bookingName(doc, docId)
    if (!clean(doc.googleEventId) || !clean(doc.meetLink)) return `Booking needs Meet link: ${label}`
    return `Upcoming booking: ${label}`
  },

  extractSummary(doc: BookingDocument, docId: string): string {
    const parts: string[] = []
    const duration = numeric(doc.durationMins, 20)
    const label = bookingName(doc, docId)
    const date = clean(doc.date)
    const time = clean(doc.time)
    const timezone = clean(doc.timezone) ?? 'Africa/Johannesburg'
    parts.push(`${duration}-minute call with ${label}${date && time ? ` on ${date} at ${time}` : ''}`)
    parts.push(timezone)
    const company = clean(doc.company)
    const email = clean(doc.email)
    const meetLink = clean(doc.meetLink)
    if (company) parts.push(`Company: ${company}`)
    if (email) parts.push(`Email: ${email}`)
    if (!meetLink) parts.push('Meet link missing')
    const brief = extractMultiFieldExcerpt(doc, ['brief'], { maxLength: 140 })
    if (brief) parts.push(brief)
    return parts.join('. ')
  },

  extractExcerpt(doc: BookingDocument, docId: string, maxLength = 300): string | null {
    return extractMultiFieldExcerpt(doc, ['brief', 'company', 'email'], { maxLength })
      ?? this.extractSummary(doc, docId)
  },

  extractOccurredAt(doc: BookingDocument): Date | null {
    return bookingStart(doc) ?? normalizeTimestamp(doc.createdAt) ?? normalizeTimestamp(doc.updatedAt)
  },

  extractMetadata(doc: BookingDocument): Record<string, unknown> | null {
    return {
      bookingStatus: clean(doc.status),
      email: clean(doc.email),
      company: clean(doc.company),
      date: clean(doc.date),
      time: clean(doc.time),
      timezone: clean(doc.timezone),
      durationMins: numeric(doc.durationMins, 20),
      googleEventId: clean(doc.googleEventId),
      meetLink: clean(doc.meetLink),
    }
  },

  toItem(doc: BookingDocument, docId: string) {
    const occurredAt = this.extractOccurredAt(doc, docId) ?? new Date()
    return {
      orgId: PIB_PLATFORM_ORG_ID,
      source: {
        type: this.sourceType,
        id: docId,
        collectionPath: this.collectionPath,
        url: sourceUrl(docId),
      },
      priority: this.extractPriority(doc, docId),
      status: 'active',
      title: this.extractTitle(doc, docId),
      summary: this.extractSummary(doc, docId),
      excerpt: this.extractExcerpt(doc, docId),
      actor: this.extractActor(doc, docId),
      context: this.extractContext(doc, docId),
      occurredAt,
      sourceHash: this.hashSource(doc, docId),
      metadata: this.extractMetadata?.(doc, docId),
      createdAt: occurredAt,
      updatedAt: occurredAt,
    }
  },
}
