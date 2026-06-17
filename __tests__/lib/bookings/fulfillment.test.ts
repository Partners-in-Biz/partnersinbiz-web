const mockArrayUnion = jest.fn((...values: unknown[]) => ({ op: 'arrayUnion', values }))
const mockServerTimestamp = jest.fn(() => ({ op: 'serverTimestamp' }))
const mockCreateCalendarEvent = jest.fn()

const bookingSet = jest.fn()
const contactSet = jest.fn()
const contactUpdate = jest.fn()
const calendarSet = jest.fn()
const calendarUpdate = jest.fn()

const existingContact = {
  id: 'contact-existing',
  data: () => ({ email: 'buhle@example.test', tags: ['existing'], notes: 'Old note' }),
  ref: { update: contactUpdate },
}

const existingCalendarEvent = {
  id: 'event-existing',
  data: () => ({}),
  ref: { update: calendarUpdate },
}

let contactDocs: unknown[] = []
let bookingEventDocs: unknown[] = []
let contactEventDocs: unknown[] = []

function chain(docs: unknown[], collection?: string, filters: unknown[] = []) {
  const api = {
    where: jest.fn((field: string, _op: string, value: unknown) => {
      if (collection === 'calendar_events') {
        const nextFilters = [...filters, [field, value]]
        const hasBookingFilter = nextFilters.some((filter) => Array.isArray(filter) && filter[0] === 'sourceBookingId')
        const hasRelatedFilter = nextFilters.some((filter) => Array.isArray(filter) && filter[0] === 'relatedTo.id')
        return chain(hasBookingFilter ? bookingEventDocs : hasRelatedFilter ? contactEventDocs : docs, collection, nextFilters)
      }
      return api
    }),
    limit: jest.fn(() => api),
    get: jest.fn(async () => ({ empty: docs.length === 0, docs })),
  }
  return api
}

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    arrayUnion: (...values: unknown[]) => mockArrayUnion(...values),
    serverTimestamp: () => mockServerTimestamp(),
  },
}))

jest.mock('@/lib/google/calendar', () => ({
  createCalendarEvent: (...args: unknown[]) => mockCreateCalendarEvent(...args),
}))

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: jest.fn((name: string) => {
      if (name === 'contacts') {
        return {
          where: jest.fn(() => chain(contactDocs, 'contacts')),
          doc: jest.fn(() => ({ id: 'contact-created', set: contactSet })),
        }
      }
      if (name === 'calendar_events') {
        return {
          doc: jest.fn((id?: string) => id ? ({ get: jest.fn(async () => ({ exists: false })) }) : ({ id: 'calendar-created', set: calendarSet })),
          where: jest.fn(() => chain([], 'calendar_events')),
        }
      }
      if (name === 'bookings') {
        return { doc: jest.fn(() => ({ set: bookingSet })) }
      }
      return { doc: jest.fn(), where: jest.fn(() => chain([])) }
    }),
  },
}))

describe('booking fulfillment', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    contactDocs = []
    bookingEventDocs = []
    contactEventDocs = []
    mockCreateCalendarEvent.mockResolvedValue({ eventId: 'google-1', meetLink: 'https://meet.google.test/abc' })
  })

  it('creates CRM contact, Google Meet, internal calendar event, and booking links', async () => {
    const { fulfillConfirmedBooking } = await import('@/lib/bookings/fulfillment')

    const result = await fulfillConfirmedBooking({
      id: 'booking-1',
      name: 'Buhle Magagula',
      email: 'BUHLE@example.test',
      date: '2026-06-29',
      time: '11:00',
      company: 'Buhle Co',
      brief: 'Needs a website',
    }, { sendGoogleUpdates: 'none' })

    expect(result).toEqual(expect.objectContaining({
      crmContactId: expect.any(String),
      calendarEventId: expect.any(String),
      googleEventId: 'google-1',
      meetLink: 'https://meet.google.test/abc',
      errors: [],
    }))
    expect(mockCreateCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'booking-1', sendUpdates: 'none' }))
    expect(contactSet).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'pib-platform-owner',
      email: 'buhle@example.test',
      tags: ['public-booking', 'booking'],
    }))
    expect(calendarSet).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'pib-platform-owner',
      sourceBookingId: 'booking-1',
      meetingUrl: 'https://meet.google.test/abc',
      relatedTo: expect.objectContaining({ type: 'contact' }),
    }))
    expect(bookingSet).toHaveBeenCalledWith(expect.objectContaining({
      crmContactId: expect.any(String),
      calendarEventId: expect.any(String),
      googleEventId: 'google-1',
      meetLink: 'https://meet.google.test/abc',
      fulfillmentStatus: 'ok',
    }), { merge: true })
  })

  it('recovers missing links without duplicating an existing contact or calendar event', async () => {
    contactDocs = [existingContact]
    bookingEventDocs = [existingCalendarEvent]
    const { fulfillConfirmedBooking } = await import('@/lib/bookings/fulfillment')

    const result = await fulfillConfirmedBooking({
      id: 'booking-1',
      name: 'Buhle Magagula',
      email: 'buhle@example.test',
      date: '2026-06-29',
      time: '11:00',
      googleEventId: 'google-existing',
      meetLink: 'https://meet.google.test/existing',
    })

    expect(result.crmContactId).toBe('contact-existing')
    expect(result.calendarEventId).toBe('event-existing')
    expect(mockCreateCalendarEvent).not.toHaveBeenCalled()
    expect(contactUpdate).toHaveBeenCalledWith(expect.objectContaining({
      publicBookingIds: { op: 'arrayUnion', values: ['booking-1'] },
    }))
    expect(calendarUpdate).toHaveBeenCalledWith(expect.objectContaining({
      meetingUrl: 'https://meet.google.test/existing',
      sourceBookingId: 'booking-1',
    }))
  })

  it('still creates internal records and logs partial fulfillment when Google Calendar fails', async () => {
    mockCreateCalendarEvent.mockRejectedValue(new Error('GOOGLE_CALENDAR_ID not set'))
    const { fulfillConfirmedBooking } = await import('@/lib/bookings/fulfillment')

    const result = await fulfillConfirmedBooking({
      id: 'booking-1',
      name: 'Buhle Magagula',
      email: 'buhle@example.test',
      date: '2026-06-29',
      time: '11:00',
    })

    expect(result.errors).toEqual(['google_calendar: GOOGLE_CALENDAR_ID not set'])
    expect(contactSet).toHaveBeenCalled()
    expect(calendarSet).toHaveBeenCalledWith(expect.objectContaining({ meetingUrl: '' }))
    expect(bookingSet).toHaveBeenCalledWith(expect.objectContaining({
      fulfillmentStatus: 'partial',
      fulfillmentErrors: ['google_calendar: GOOGLE_CALENDAR_ID not set'],
    }), { merge: true })
  })
})
