jest.mock('@/lib/google/userToken', () => ({
  getFreshGoogleAccessToken: jest.fn(),
  googleAccountHasScopes: (granted: string[], required: string[]) =>
    required.every((s) => granted.includes(s)),
}))
jest.mock('@/lib/workspace/currentUser', () => ({ resolveWorkspaceUser: jest.fn() }))

import { getFreshGoogleAccessToken } from '@/lib/google/userToken'
import { resolveWorkspaceUser } from '@/lib/workspace/currentUser'

describe('GET /api/v1/workspace/calendar/today', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns today meetings normalized from Google Calendar', async () => {
    ;(resolveWorkspaceUser as jest.Mock).mockResolvedValue({ orgId: 'org-1', uid: 'u1' })
    ;(getFreshGoogleAccessToken as jest.Mock).mockResolvedValue({ ok: true, accessToken: 'tok', scopes: ['https://www.googleapis.com/auth/calendar.events'], accountId: 'a1', emailAddress: 'me@x.com', displayName: 'Me' })
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ items: [
      { id: 'e1', summary: 'Loyalty Plus review', start: { dateTime: '2026-06-18T10:30:00+02:00' }, end: { dateTime: '2026-06-18T11:00:00+02:00' }, hangoutLink: 'https://meet.google.com/abc', status: 'confirmed', attendees: [{ email: 'a@x.com' }] },
      { id: 'e2', summary: 'All day thing', start: { date: '2026-06-18' }, end: { date: '2026-06-19' }, status: 'confirmed' },
    ] }) })) as unknown as typeof fetch

    const { GET } = await import('@/app/api/v1/workspace/calendar/today/route')
    const res = await GET(new Request('http://localhost/api/v1/workspace/calendar/today?tz=Africa/Johannesburg'))
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.status).toBe('connected')
    expect(body.data.meetings).toHaveLength(2)
    expect(body.data.meetings[0]).toMatchObject({ id: 'e1', title: 'Loyalty Plus review', meetUrl: 'https://meet.google.com/abc', allDay: false })
    expect(body.data.meetings[1]).toMatchObject({ id: 'e2', allDay: true })
  })

  it('returns status=not_connected (200) when the user has no Google account', async () => {
    ;(resolveWorkspaceUser as jest.Mock).mockResolvedValue({ orgId: 'org-1', uid: 'u1' })
    ;(getFreshGoogleAccessToken as jest.Mock).mockResolvedValue({ ok: false, notConnected: true, reason: 'none' })
    const { GET } = await import('@/app/api/v1/workspace/calendar/today/route')
    const res = await GET(new Request('http://localhost/api/v1/workspace/calendar/today'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data).toMatchObject({ status: 'not_connected', meetings: [] })
  })
})
