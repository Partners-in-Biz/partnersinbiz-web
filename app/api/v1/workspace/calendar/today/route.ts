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
  attendees?: Array<{ email?: string; responseStatus?: string }>
  location?: string
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const orgIdParam = url.searchParams.get('orgId')
    const tz = url.searchParams.get('tz') || 'UTC'
    const user = await resolveWorkspaceUser(orgIdParam)
    if (!user) return apiError('Not authenticated', 401)

    const token = await getFreshGoogleAccessToken({ orgId: user.orgId, uid: user.uid })
    if (!token.ok) {
      const status = token.notConnected ? 'not_connected' : 'needs_reconnect'
      return apiSuccess({ status, meetings: [] })
    }
    if (!googleAccountHasScopes(token.scopes, ['https://www.googleapis.com/auth/calendar.events'])) {
      return apiSuccess({ status: 'needs_reconnect', meetings: [] })
    }

    const now = new Date()
    // Get today's date string in the requested timezone (YYYY-MM-DD)
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)

    // Compute UTC timestamps for start and end of today in the requested timezone.
    // Strategy: find the UTC offset by comparing what a Date looks like in the target
    // timezone vs UTC, then shift accordingly.
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

    // Approximate reference: midnight UTC for this date string
    const approxMidnight = new Date(`${localDate}T00:00:00Z`)
    const offsetMs = getUTCOffsetMs(approxMidnight, tz)
    // Actual UTC time corresponding to 00:00:00 in tz
    const dayStartUTC = new Date(approxMidnight.getTime() - offsetMs)
    const dayEndUTC = new Date(dayStartUTC.getTime() + 24 * 60 * 60 * 1000 - 1000)

    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin: dayStartUTC.toISOString(),
      timeMax: dayEndUTC.toISOString(),
      timeZone: tz,
      maxResults: '20',
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
        meetUrl: e.hangoutLink ?? null,
        htmlLink: e.htmlLink ?? null,
        status: e.status ?? 'confirmed',
        attendeeCount: e.attendees?.length ?? 0,
        location: e.location ?? null,
      }
    })
    return apiSuccess({ status: 'connected', meetings, accountEmail: token.emailAddress })
  } catch (err) {
    return apiErrorFromException(err)
  }
}
