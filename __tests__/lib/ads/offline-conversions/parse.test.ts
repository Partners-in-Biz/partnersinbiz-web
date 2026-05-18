// __tests__/lib/ads/offline-conversions/parse.test.ts

import { parseCsv } from '@/lib/ads/offline-conversions/parse'

const HEADER = 'event_id,event_time_iso,email,phone,value,currency,gclid,ttclid,li_fat_id'

function makeRow(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    event_id: 'evt-001',
    event_time_iso: '2024-01-15T10:00:00Z',
    email: 'test@example.com',
    phone: '',
    value: '99.99',
    currency: 'USD',
    gclid: '',
    ttclid: '',
    li_fat_id: '',
  }
  const merged = { ...defaults, ...overrides }
  return Object.values(merged).join(',')
}

describe('parseCsv', () => {
  it('returns error when CSV has no data rows', () => {
    const result = parseCsv(HEADER)
    expect(result.rows).toHaveLength(0)
    expect(result.errors[0].message).toMatch(/no data rows/)
  })

  it('returns error when event_id column is missing', () => {
    const csv = 'event_time_iso,email\n2024-01-01T00:00:00Z,foo@bar.com'
    const result = parseCsv(csv)
    expect(result.rows).toHaveLength(0)
    expect(result.errors[0].message).toMatch(/event_id/)
  })

  it('skips rows missing eventId and records an error', () => {
    const csv = `${HEADER}\n,2024-01-15T10:00:00Z,test@example.com,,,,,,`
    const result = parseCsv(csv)
    expect(result.rows).toHaveLength(0)
    expect(result.errors.some((e) => e.message.match(/event_id/))).toBe(true)
  })

  it('parses value as float when present', () => {
    const csv = `${HEADER}\n${makeRow({ value: '123.45' })}`
    const result = parseCsv(csv)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].value).toBe(123.45)
  })

  it('handles quoted commas in cell values', () => {
    const csv = `event_id,event_time_iso,email,phone,value,currency,gclid,ttclid,li_fat_id\n"evt,001",2024-01-15T10:00:00Z,test@example.com,,,,,,`
    const result = parseCsv(csv)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].eventId).toBe('evt,001')
  })

  it('records errors for each malformed line independently', () => {
    const csv = [
      HEADER,
      `,2024-01-01T00:00:00Z,a@b.com,,,,,,`, // missing event_id
      `evt-002,,c@d.com,,,,,,`,               // missing event_time_iso
    ].join('\n')
    const result = parseCsv(csv)
    expect(result.rows).toHaveLength(0)
    expect(result.errors).toHaveLength(2)
  })

  it('accepts an email-only row', () => {
    const csv = `${HEADER}\n${makeRow({ phone: '' })}`
    const result = parseCsv(csv)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].email).toBe('test@example.com')
    expect(result.rows[0].phone).toBeUndefined()
  })

  it('accepts a phone-only row', () => {
    const csv = `${HEADER}\n${makeRow({ email: '', phone: '+27821234567' })}`
    const result = parseCsv(csv)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].phone).toBe('+27821234567')
    expect(result.rows[0].email).toBeUndefined()
  })

  it('returns error for empty input', () => {
    const result = parseCsv('')
    expect(result.rows).toHaveLength(0)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})
