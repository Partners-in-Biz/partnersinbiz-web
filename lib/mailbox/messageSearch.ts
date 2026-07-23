import type { MailboxMessageSafe } from './types'

const STOPWORDS = new Set([
  'a', 'an', 'and', 'or', 'the', 'from', 'to', 'on', 'for', 'of', 'in', 'at', 'by',
  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'that', 'this', 'these', 'those',
  'please', 'find', 'email', 'emails', 'mail', 'mails', 'message', 'messages',
  'specifically', 'july', 'august', 'september', 'october', 'november', 'december',
  'january', 'february', 'march', 'april', 'may', 'june',
  'th', 'st', 'nd', 'rd',
])

const MONTHS: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
}

export type MailboxSearchableMessage = Pick<
  MailboxMessageSafe,
  'subject' | 'from' | 'accountEmail' | 'snippet' | 'to' | 'cc' | 'receivedAt' | 'sentAt' | 'createdAt'
> & { fromName?: string | null }

export function parseFromHeader(value: string): { email: string; name: string; raw: string } {
  const raw = value.trim()
  if (!raw) return { email: '', name: '', raw: '' }
  const angled = raw.match(/^(.*?)\s*<([^>]+)>\s*$/)
  if (angled) {
    const name = angled[1].replace(/^["']|["']$/g, '').trim()
    const email = angled[2].trim().toLowerCase().replace(/^mailto:/i, '')
    return { email, name, raw }
  }
  if (raw.includes('@')) {
    return { email: raw.toLowerCase().replace(/^mailto:/i, ''), name: '', raw }
  }
  return { email: '', name: raw, raw }
}

/** Split agent/user q into searchable tokens. Treats OR/AND/commas as separators. */
export function tokenizeMailboxQuery(q: string): string[] {
  const cleaned = q
    .toLowerCase()
    .replace(/\b(from|to|subject|cc|bcc|after|before|newer_than|older_than):/g, ' ')
    .replace(/[|/\\]+/g, ' ')
    .replace(/\b(or|and)\b/g, ' ')
    .replace(/[,;]+/g, ' ')

  const tokens: string[] = []
  const phraseRe = /"([^"]+)"|'([^']+)'/g
  let match: RegExpExecArray | null
  let remainder = cleaned
  while ((match = phraseRe.exec(cleaned)) !== null) {
    const phrase = (match[1] ?? match[2] ?? '').trim()
    if (phrase.length >= 2) tokens.push(phrase)
    remainder = remainder.replace(match[0], ' ')
  }

  for (const part of remainder.split(/\s+/)) {
    const token = part.replace(/^["']+|["']+$/g, '').replace(/^\(+|\)+$/g, '').trim()
    if (token.length < 2) continue
    if (STOPWORDS.has(token)) continue
    if (/^\d{1,2}(st|nd|rd|th)?$/.test(token) && token.replace(/\D/g, '').length <= 2) {
      // Keep day numbers only when paired with a month elsewhere — handled via date window.
      continue
    }
    tokens.push(token)
  }

  return [...new Set(tokens)]
}

export function extractMailboxDateWindow(q: string, now = new Date()): { start: Date; end: Date } | null {
  const lower = q.toLowerCase()
  const iso = lower.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
  if (iso) {
    const start = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 0, 0, 0))
    const end = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]) + 1, 0, 0, 0))
    return { start, end }
  }

  const gmailDate = lower.match(/\b(20\d{2})\/(\d{1,2})\/(\d{1,2})\b/)
  if (gmailDate) {
    const start = new Date(Date.UTC(Number(gmailDate[1]), Number(gmailDate[2]) - 1, Number(gmailDate[3]), 0, 0, 0))
    const end = new Date(Date.UTC(Number(gmailDate[1]), Number(gmailDate[2]) - 1, Number(gmailDate[3]) + 1, 0, 0, 0))
    return { start, end }
  }

  const named = lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:[,\s]+(20\d{2}))?\b/)
  if (named) {
    const month = MONTHS[named[1]]
    const day = Number(named[2])
    const year = named[3] ? Number(named[3]) : now.getUTCFullYear()
    if (month === undefined || !Number.isFinite(day)) return null
    const start = new Date(Date.UTC(year, month, day, 0, 0, 0))
    const end = new Date(Date.UTC(year, month, day + 1, 0, 0, 0))
    return { start, end }
  }

  return null
}

/** Build a Gmail `q` that prefers live provider search for names/emails/dates. */
export function buildGmailSearchQuery(q: string, now = new Date()): string {
  const raw = q.trim()
  if (!raw) return ''
  // If the caller already used Gmail operators, pass through.
  if (/\b(from|to|subject|after|before|newer_than|older_than|in|label|has):/i.test(raw)) {
    return raw
  }

  const tokens = tokenizeMailboxQuery(raw)
  const emails = tokens.filter((token) => token.includes('@'))
  const names = tokens.filter((token) => !token.includes('@') && !/^\d{4}$/.test(token))
  const window = extractMailboxDateWindow(raw, now)

  const parts: string[] = []
  if (emails.length === 1 && names.length === 0) {
    parts.push(`from:${emails[0]}`)
  } else if (emails.length > 0 && names.length === 0) {
    parts.push(`(${emails.map((email) => `from:${email}`).join(' OR ')})`)
  } else if (names.length > 0 && emails.length === 0) {
    parts.push(names.join(' '))
  } else if (names.length > 0 && emails.length > 0) {
    parts.push(`((${names.join(' ')}) OR ${emails.map((email) => `from:${email}`).join(' OR ')})`)
  } else {
    parts.push(raw)
  }

  if (window) {
    const y = window.start.getUTCFullYear()
    const m = String(window.start.getUTCMonth() + 1).padStart(2, '0')
    const d = String(window.start.getUTCDate()).padStart(2, '0')
    const y2 = window.end.getUTCFullYear()
    const m2 = String(window.end.getUTCMonth() + 1).padStart(2, '0')
    const d2 = String(window.end.getUTCDate()).padStart(2, '0')
    parts.push(`after:${y}/${m}/${d}`)
    parts.push(`before:${y2}/${m2}/${d2}`)
  }

  return parts.join(' ').trim()
}

function messageInstant(message: MailboxSearchableMessage): number | null {
  const raw = message.receivedAt ?? message.sentAt ?? message.createdAt
  if (!raw) return null
  const ms = new Date(raw).getTime()
  return Number.isFinite(ms) ? ms : null
}

export function mailboxMessageMatchesQuery(message: MailboxSearchableMessage, q: string, now = new Date()): boolean {
  const query = q.trim()
  if (!query) return true

  const haystack = [
    message.subject,
    message.from,
    message.fromName ?? '',
    message.accountEmail,
    message.snippet,
    ...message.to,
    ...message.cc,
  ].join(' ').toLowerCase()

  const tokens = tokenizeMailboxQuery(query)
  const window = extractMailboxDateWindow(query, now)

  const textOk = tokens.length === 0
    ? true
    : tokens.some((token) => haystack.includes(token))

  if (!textOk) return false
  if (!window) return true

  const instant = messageInstant(message)
  if (instant === null) return textOk && tokens.length > 0
  return instant >= window.start.getTime() && instant < window.end.getTime()
}
