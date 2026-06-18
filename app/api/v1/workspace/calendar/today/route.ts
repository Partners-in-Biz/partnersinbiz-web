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
    const y = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
    const timeMin = `${y}T00:00:00`
    const timeMax = `${y}T23:59:59`
    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin: new Date(`${timeMin}Z`).toISOString(),
      timeMax: new Date(`${timeMax}Z`).toISOString(),
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
