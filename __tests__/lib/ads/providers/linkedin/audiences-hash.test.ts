// __tests__/lib/ads/providers/linkedin/audiences-hash.test.ts
import { createHash } from 'crypto'
import {
  sha256Email,
  sha256Phone,
  rowToMember,
  chunk,
  LINKEDIN_AUDIENCE_CHUNK_SIZE,
} from '@/lib/ads/providers/linkedin/audiences-hash'

function manualSha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

describe('sha256Email', () => {
  it('lowercases + trims + returns 64-char lowercase hex', () => {
    const result = sha256Email('  Foo@Bar.com  ')
    const expected = manualSha256('foo@bar.com')
    expect(result).toBe(expected)
    expect(result).toHaveLength(64)
    expect(result).toMatch(/^[0-9a-f]+$/)
    // deterministic
    expect(sha256Email('  Foo@Bar.com  ')).toBe(sha256Email('  Foo@Bar.com  '))
  })

  it('throws on empty string', () => {
    expect(() => sha256Email('')).toThrow('sha256Email: input must be non-empty string')
  })

  it('throws on undefined input', () => {
    expect(() => sha256Email(undefined as unknown as string)).toThrow(
      'sha256Email: input must be non-empty string',
    )
  })
})

describe('sha256Phone', () => {
  it('strips formatting and preserves + for E.164', () => {
    const formatted = sha256Phone('+1 (202) 555-1234')
    const clean = sha256Phone('+12025551234')
    expect(formatted).toBe(clean)
    expect(formatted).toHaveLength(64)
    expect(formatted).toMatch(/^[0-9a-f]+$/)
  })
})

describe('rowToMember', () => {
  it('produces SHA256_EMAIL + SHA256_PHONE entries when both present', () => {
    const member = rowToMember({ email: 'foo@bar.com', phone: '+12025551234' })
    expect(member.action).toBe('ADD')
    expect(member.userIds).toHaveLength(2)
    expect(member.userIds[0].idType).toBe('SHA256_EMAIL')
    expect(member.userIds[0].idValue).toBe(sha256Email('foo@bar.com'))
    expect(member.userIds[1].idType).toBe('SHA256_PHONE')
    expect(member.userIds[1].idValue).toBe(sha256Phone('+12025551234'))
  })

  it('throws on row with neither email nor phone', () => {
    expect(() => rowToMember({})).toThrow(
      'rowToMember: row must have at least email or phone',
    )
  })

  it('respects REMOVE action', () => {
    const member = rowToMember({ email: 'foo@bar.com' }, 'REMOVE')
    expect(member.action).toBe('REMOVE')
  })
})

describe('chunk', () => {
  it('splits a 12500-element array into chunks of [5000, 5000, 2500]', () => {
    const items = Array(12500).fill({})
    const chunks = chunk(items, 5000)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toHaveLength(5000)
    expect(chunks[1]).toHaveLength(5000)
    expect(chunks[2]).toHaveLength(2500)
  })

  it('uses LINKEDIN_AUDIENCE_CHUNK_SIZE as default size', () => {
    expect(LINKEDIN_AUDIENCE_CHUNK_SIZE).toBe(5000)
    const items = Array(5001).fill({})
    const chunks = chunk(items)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toHaveLength(5000)
    expect(chunks[1]).toHaveLength(1)
  })

  it('throws on size <= 0', () => {
    expect(() => chunk([1, 2, 3], 0)).toThrow('chunk: size must be > 0')
  })
})
