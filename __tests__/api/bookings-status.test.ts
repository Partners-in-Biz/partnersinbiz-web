import { NextRequest } from 'next/server'

const mockVerifySessionCookie = jest.fn()
const mockUserGet = jest.fn()
const mockBookingUpdate = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: {
    verifySessionCookie: mockVerifySessionCookie,
  },
  adminDb: {
    collection: jest.fn((name: string) => {
      if (name === 'users') {
        return { doc: jest.fn(() => ({ get: mockUserGet })) }
      }
      if (name === 'bookings') {
        return { doc: jest.fn(() => ({ update: mockBookingUpdate })) }
      }
      return { doc: jest.fn() }
    }),
  },
}))

function patchRequest(body: Record<string, unknown>, cookie = '__session=ok') {
  return new NextRequest('http://localhost/api/bookings/booking-1', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      cookie,
    },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/bookings/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockVerifySessionCookie.mockResolvedValue({ uid: 'admin-1' })
    mockUserGet.mockResolvedValue({ exists: true, data: () => ({ role: 'admin' }) })
    mockBookingUpdate.mockResolvedValue(undefined)
  })

  it('lets admins mark bookings completed or cancelled', async () => {
    const { PATCH } = await import('@/app/api/bookings/[id]/route')

    const res = await PATCH(patchRequest({ status: 'completed' }), {
      params: Promise.resolve({ id: 'booking-1' }),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ id: 'booking-1', status: 'completed' })
    expect(mockBookingUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
  })

  it('rejects invalid booking statuses', async () => {
    const { PATCH } = await import('@/app/api/bookings/[id]/route')

    const res = await PATCH(patchRequest({ status: 'confirmed' }), {
      params: Promise.resolve({ id: 'booking-1' }),
    })

    expect(res.status).toBe(400)
    expect(mockBookingUpdate).not.toHaveBeenCalled()
  })
})
