jest.mock('@/lib/google/userToken', () => ({
  getFreshGoogleAccessToken: jest.fn(),
  googleAccountHasScopes: (granted: string[], required: string[]) =>
    required.every((s) => granted.includes(s)),
}))
jest.mock('@/lib/workspace/currentUser', () => ({ resolveWorkspaceUser: jest.fn() }))

import { getFreshGoogleAccessToken } from '@/lib/google/userToken'
import { resolveWorkspaceUser } from '@/lib/workspace/currentUser'

const CONNECTED_TOKEN = { ok: true, accessToken: 'tok', scopes: ['https://www.googleapis.com/auth/calendar.events'], accountId: 'a1', emailAddress: 'me@x.com', displayName: 'Me' }

function mockConnected(items: unknown[] = []) {
  ;(resolveWorkspaceUser as jest.Mock).mockResolvedValue({ orgId: 'org-1', uid: 'u1' })
  ;(getFreshGoogleAccessToken as jest.Mock).mockResolvedValue(CONNECTED_TOKEN)
  const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ items }) }))
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

function googleParams(fetchMock: jest.Mock): URLSearchParams {
  const calledUrl = (fetchMock.mock.calls[0] as unknown[])[0] as string
  return new URL(calledUrl).searchParams
}

async function callRoute(query: string) {
  const { GET } = await import('@/app/api/v1/workspace/calendar/today/route')
  const res = await GET(new Request(`http://localhost/api/v1/workspace/calendar/today${query}`))
  return { res, body: await res.json() }
}

describe('GET /api/v1/workspace/calendar/today', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns today meetings normalized from Google Calendar', async () => {
    mockConnected([
      { id: 'e1', summary: 'Loyalty Plus review', start: { dateTime: '2026-06-18T10:30:00+02:00' }, end: { dateTime: '2026-06-18T11:00:00+02:00' }, hangoutLink: 'https://meet.google.com/abc', status: 'confirmed', attendees: [{ email: 'a@x.com' }] },
      { id: 'e2', summary: 'All day thing', start: { date: '2026-06-18' }, end: { date: '2026-06-19' }, status: 'confirmed' },
    ])

    const { body } = await callRoute('?tz=Africa/Johannesburg')
    expect(body.success).toBe(true)
    expect(body.data.status).toBe('connected')
    expect(body.data.meetings).toHaveLength(2)
    expect(body.data.meetings[0]).toMatchObject({ id: 'e1', title: 'Loyalty Plus review', meetUrl: 'https://meet.google.com/abc', allDay: false, busy: true })
    expect(body.data.meetings[1]).toMatchObject({ id: 'e2', allDay: true, busy: true })
    expect(body.data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(body.data.range).toMatchObject({ tz: 'Africa/Johannesburg' })
  })

  it('returns status=not_connected (200) when the user has no Google account', async () => {
    ;(resolveWorkspaceUser as jest.Mock).mockResolvedValue({ orgId: 'org-1', uid: 'u1' })
    ;(getFreshGoogleAccessToken as jest.Mock).mockResolvedValue({ ok: false, notConnected: true, reason: 'none' })
    const { res, body } = await callRoute('')
    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({ status: 'not_connected', meetings: [] })
  })

  it('queries the whole chosen day in the requested timezone when date= is supplied', async () => {
    const fetchMock = mockConnected()
    const { res, body } = await callRoute('?date=2026-09-10&tz=Africa/Johannesburg')
    expect(res.status).toBe(200)
    expect(body.data.date).toBe('2026-09-10')
    // 00:00 SAST (UTC+2) → 22:00Z the day before; 23:59:59 SAST → 21:59:59Z
    expect(body.data.range).toEqual({ from: '2026-09-09T22:00:00.000Z', to: '2026-09-10T21:59:59.000Z', tz: 'Africa/Johannesburg' })
    const params = googleParams(fetchMock)
    expect(params.get('timeMin')).toBe('2026-09-09T22:00:00.000Z')
    expect(params.get('timeMax')).toBe('2026-09-10T21:59:59.000Z')
    expect(params.get('timeZone')).toBe('Africa/Johannesburg')
  })

  it('defaults date= to Africa/Johannesburg when no tz is given', async () => {
    mockConnected()
    const { body } = await callRoute('?date=2026-01-15')
    expect(body.data.range).toEqual({ from: '2026-01-14T22:00:00.000Z', to: '2026-01-15T21:59:59.000Z', tz: 'Africa/Johannesburg' })
  })

  it('accepts a from/to range up to 7 days', async () => {
    const fetchMock = mockConnected()
    const { res, body } = await callRoute('?from=2026-09-07T00:00:00Z&to=2026-09-14T00:00:00Z&tz=UTC')
    expect(res.status).toBe(200)
    expect(body.data.date).toBeNull()
    expect(body.data.range).toEqual({ from: '2026-09-07T00:00:00.000Z', to: '2026-09-14T00:00:00.000Z', tz: 'UTC' })
    const params = googleParams(fetchMock)
    expect(params.get('timeMin')).toBe('2026-09-07T00:00:00.000Z')
    expect(params.get('timeMax')).toBe('2026-09-14T00:00:00.000Z')
  })

  it('marks transparent and declined events as not busy', async () => {
    mockConnected([
      { id: 'busy', summary: 'Client call', start: { dateTime: '2026-09-10T09:00:00+02:00' }, end: { dateTime: '2026-09-10T09:30:00+02:00' }, attendees: [{ email: 'me@x.com', self: true, responseStatus: 'accepted' }] },
      { id: 'free', summary: 'Focus block', transparency: 'transparent', start: { dateTime: '2026-09-10T10:00:00+02:00' }, end: { dateTime: '2026-09-10T12:00:00+02:00' } },
      { id: 'declined-self', summary: 'Optional sync', start: { dateTime: '2026-09-10T13:00:00+02:00' }, end: { dateTime: '2026-09-10T13:30:00+02:00' }, attendees: [{ email: 'other@x.com', responseStatus: 'accepted' }, { email: 'me@x.com', self: true, responseStatus: 'declined' }] },
      { id: 'declined-by-email', summary: 'Vendor demo', start: { dateTime: '2026-09-10T14:00:00+02:00' }, end: { dateTime: '2026-09-10T14:30:00+02:00' }, attendees: [{ email: 'ME@x.com', responseStatus: 'declined' }] },
      { id: 'other-declined', summary: 'Team standup', start: { dateTime: '2026-09-10T15:00:00+02:00' }, end: { dateTime: '2026-09-10T15:15:00+02:00' }, attendees: [{ email: 'other@x.com', responseStatus: 'declined' }] },
    ])
    const { body } = await callRoute('?date=2026-09-10&tz=Africa/Johannesburg')
    const busyById = Object.fromEntries(body.data.meetings.map((m: { id: string; busy: boolean }) => [m.id, m.busy]))
    expect(busyById).toEqual({ busy: true, free: false, 'declined-self': false, 'declined-by-email': false, 'other-declined': true })
  })

  it('rejects malformed or impossible dates with 400', async () => {
    mockConnected()
    for (const bad of ['2026-9-1', 'tomorrow', '2026-02-30', '2026-13-01']) {
      const { res, body } = await callRoute(`?date=${bad}`)
      expect(res.status).toBe(400)
      expect(body.success).toBe(false)
    }
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects invalid from/to combinations with 400', async () => {
    mockConnected()
    const cases = [
      '?from=2026-09-07T00:00:00Z',                                   // missing to
      '?from=not-a-date&to=2026-09-08T00:00:00Z',                     // bad from
      '?from=2026-09-08T00:00:00Z&to=2026-09-07T00:00:00Z',           // to before from
      '?from=2026-09-01T00:00:00Z&to=2026-09-09T00:00:00Z',           // > 7 days
      '?date=2026-09-10&from=2026-09-07T00:00:00Z&to=2026-09-08T00:00:00Z', // date + range
    ]
    for (const query of cases) {
      const { res } = await callRoute(query)
      expect(res.status).toBe(400)
    }
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects an unknown tz with 400', async () => {
    mockConnected()
    const { res } = await callRoute('?tz=Mars/Olympus')
    expect(res.status).toBe(400)
  })
})
