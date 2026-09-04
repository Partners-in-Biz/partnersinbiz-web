/**
 * GET /api/v1/workspace/calendar/today
 *
 * Google Calendar events for the signed-in workspace user.
 *
 * Query params (all optional):
 *   orgId   — workspace org (resolved by resolveWorkspaceUser)
 *   tz      — IANA timezone used to interpret `date` and for day bounds.
 *             Defaults to UTC in today-mode (legacy behaviour) and to
 *             Africa/Johannesburg when `date` is supplied.
 *   date    — YYYY-MM-DD; return events for that whole local day instead of today.
 *   from/to — ISO datetimes (both required together); return events in that
 *             range. Max 7 days. Cannot be combined with `date`.
 *
 * With no params the behaviour is unchanged: today's events in `tz` (UTC).
 *
 * Response `data`:
 *   { status: 'connected' | 'not_connected' | 'needs_reconnect',
 *     meetings: Meeting[], accountEmail?, date?: 'YYYY-MM-DD', range: { from, to, tz } }
 *   Meeting: { id, title, start, end, allDay, busy, meetUrl, htmlLink, status, attendeeCount, location }
 *   `busy` is false for transparent ("free") events or events the user declined; true otherwise.
 */
import { apiSuccess, apiError, apiErrorFromException } from '@/lib/api/response'
import { resolveWorkspaceUser } from '@/lib/workspace/currentUser'
import { getFreshGoogleAccessToken, googleAccountHasScopes } from '@/lib/google/userToken'

export const dynamic = 'force-dynamic'

type GoogleEvent = {
  id?: string
  summary?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  hangoutLink?: string
  htmlLink?: string
  status?: string
  transparency?: 'opaque' | 'transparent' | string
  attendees?: Array<{ email?: string; responseStatus?: string; self?: boolean }>
  location?: string
}

const DEFAULT_TZ_TODAY = 'UTC'
const DEFAULT_TZ_DATE = 'Africa/Johannesburg'
const MAX_RANGE_MS = 7 * 24 * 60 * 60 * 1000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** YYYY-MM-DD of `date` as seen in `tz`. */
function localDateString(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

/**
 * UTC offset (ms) of `timezone` at `date`, found by comparing the wall-clock
 * time in the target timezone with the UTC instant.
 */
function getUTCOffsetMs(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0')
  const h = get('hour')
  const localUTC = Date.UTC(get('year'), get('month') - 1, get('day'), h === 24 ? 0 : h, get('minute'), get('second'))
  return localUTC - date.getTime()
}

/** [00:00:00, 23:59:59] of the local calendar day `localDate` in `tz`, as UTC instants. */
function dayBounds(localDate: string, tz: string): { start: Date; end: Date } {
  // Approximate reference: midnight UTC for this date string, then shift by the tz offset.
  const approxMidnight = new Date(`${localDate}T00:00:00Z`)
  const offsetMs = getUTCOffsetMs(approxMidnight, tz)
  const start = new Date(approxMidnight.getTime() - offsetMs)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1000)
  return { start, end }
}

function isRealCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

function parseIso(value: string): Date | null {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

type ResolvedWindow =
  | { ok: true; mode: 'today' | 'date' | 'range'; tz: string; from: Date; to: Date; date: string | null; maxResults: number }
  | { ok: false; error: string }

function resolveWindow(searchParams: URLSearchParams): ResolvedWindow {
  const dateParam = searchParams.get('date')
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const tzParam = searchParams.get('tz')?.trim() || null

  if (dateParam !== null && (fromParam !== null || toParam !== null)) {
    return { ok: false, error: 'Use either date or from/to, not both' }
  }
  if ((fromParam === null) !== (toParam === null)) {
    return { ok: false, error: 'from and to must be supplied together' }
  }

  const tz = tzParam ?? (dateParam !== null ? DEFAULT_TZ_DATE : DEFAULT_TZ_TODAY)
  if (!isValidTimeZone(tz)) return { ok: false, error: 'Invalid tz (expected an IANA timezone name)' }

  if (fromParam !== null && toParam !== null) {
    const from = parseIso(fromParam)
    const to = parseIso(toParam)
    if (!from) return { ok: false, error: 'Invalid from (expected an ISO datetime)' }
    if (!to) return { ok: false, error: 'Invalid to (expected an ISO datetime)' }
    if (to.getTime() <= from.getTime()) return { ok: false, error: 'to must be after from' }
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) return { ok: false, error: 'Range too large (max 7 days)' }
    return { ok: true, mode: 'range', tz, from, to, date: null, maxResults: 250 }
  }

  if (dateParam !== null) {
    const date = dateParam.trim()
    if (!isRealCalendarDate(date)) return { ok: false, error: 'Invalid date (expected YYYY-MM-DD)' }
    const { start, end } = dayBounds(date, tz)
    return { ok: true, mode: 'date', tz, from: start, to: end, date, maxResults: 100 }
  }

  const today = localDateString(new Date(), tz)
  const { start, end } = dayBounds(today, tz)
  return { ok: true, mode: 'today', tz, from: start, to: end, date: today, maxResults: 20 }
}

/**
 * Whether the event blocks the user's time. Transparent ("Free") events and
 * events the user declined do not; everything else does (default true).
 */
function isBusy(event: GoogleEvent, accountEmail: string | null | undefined): boolean {
  if (event.transparency === 'transparent') return false
  const attendees = Array.isArray(event.attendees) ? event.attendees : []
  const me = attendees.find((a) => a.self === true)
    ?? (accountEmail ? attendees.find((a) => a.email?.toLowerCase() === accountEmail.toLowerCase()) : undefined)
  if (me?.responseStatus === 'declined') return false
  return true
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const orgIdParam = url.searchParams.get('orgId')
    const user = await resolveWorkspaceUser(orgIdParam)
    if (!user) return apiError('Not authenticated', 401)

    const window = resolveWindow(url.searchParams)
    if (!window.ok) return apiError(window.error, 400)
    const { tz, from, to, date, maxResults } = window
    const range = { from: from.toISOString(), to: to.toISOString(), tz }

    const token = await getFreshGoogleAccessToken({ orgId: user.orgId, uid: user.uid })
    if (!token.ok) {
      const status = token.notConnected ? 'not_connected' : 'needs_reconnect'
      return apiSuccess({ status, meetings: [], date, range })
    }
    if (!googleAccountHasScopes(token.scopes, ['https://www.googleapis.com/auth/calendar.events'])) {
      return apiSuccess({ status: 'needs_reconnect', meetings: [], date, range })
    }

    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin: range.from,
      timeMax: range.to,
      timeZone: tz,
      maxResults: String(maxResults),
    })
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
      headers: { authorization: `Bearer ${token.accessToken}` },
    })
    if (!res.ok) return apiError('Google Calendar request failed', 502)
    const json = (await res.json()) as { items?: GoogleEvent[] }
    const meetings = (json.items ?? []).map((e) => {
      const allDay = Boolean(e.start?.date && !e.start?.dateTime)
      return {
        id: e.id ?? '',
        title: e.summary ?? '(no title)',
        start: e.start?.dateTime ?? e.start?.date ?? '',
        end: e.end?.dateTime ?? e.end?.date ?? '',
        allDay,
        busy: isBusy(e, token.emailAddress),
        meetUrl: e.hangoutLink ?? null,
        htmlLink: e.htmlLink ?? null,
        status: e.status ?? 'confirmed',
        attendeeCount: e.attendees?.length ?? 0,
        location: e.location ?? null,
      }
    })
    return apiSuccess({ status: 'connected', meetings, accountEmail: token.emailAddress, date, range })
  } catch (err) {
    return apiErrorFromException(err)
  }
}
