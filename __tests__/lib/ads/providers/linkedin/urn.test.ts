// __tests__/lib/ads/providers/linkedin/urn.test.ts
import {
  composeUrn,
  parseUrn,
  tryParseUrn,
  urnId,
  isUrnOf,
  type LinkedinUrnNamespace,
} from '@/lib/ads/providers/linkedin/urn'

describe('composeUrn', () => {
  it('builds correct URN format for each namespace', () => {
    expect(composeUrn('sponsoredAccount', '12345')).toBe('urn:li:sponsoredAccount:12345')
    expect(composeUrn('sponsoredCampaignGroup', '999')).toBe('urn:li:sponsoredCampaignGroup:999')
    expect(composeUrn('sponsoredCampaign', '42')).toBe('urn:li:sponsoredCampaign:42')
    expect(composeUrn('sponsoredCreative', '777')).toBe('urn:li:sponsoredCreative:777')
    expect(composeUrn('organization', '100200300')).toBe('urn:li:organization:100200300')
    expect(composeUrn('person', 'abc123')).toBe('urn:li:person:abc123')
    expect(composeUrn('dmpSegment', 'seg-001')).toBe('urn:li:dmpSegment:seg-001')
  })
})

describe('parseUrn', () => {
  it('parses all 7 recognised namespaces correctly', () => {
    const cases: Array<{ urn: string; ns: LinkedinUrnNamespace; id: string }> = [
      { urn: 'urn:li:sponsoredAccount:12345', ns: 'sponsoredAccount', id: '12345' },
      { urn: 'urn:li:sponsoredCampaignGroup:999', ns: 'sponsoredCampaignGroup', id: '999' },
      { urn: 'urn:li:sponsoredCampaign:42', ns: 'sponsoredCampaign', id: '42' },
      { urn: 'urn:li:sponsoredCreative:777', ns: 'sponsoredCreative', id: '777' },
      { urn: 'urn:li:organization:100200300', ns: 'organization', id: '100200300' },
      { urn: 'urn:li:person:abc123', ns: 'person', id: 'abc123' },
      { urn: 'urn:li:dmpSegment:seg-001', ns: 'dmpSegment', id: 'seg-001' },
    ]
    for (const { urn, ns, id } of cases) {
      const parsed = parseUrn(urn)
      expect(parsed.namespace).toBe(ns)
      expect(parsed.id).toBe(id)
    }
  })

  it('throws on invalid format strings', () => {
    expect(() => parseUrn('not:a:urn')).toThrow()
    expect(() => parseUrn('urn:li:')).toThrow()
    expect(() => parseUrn('')).toThrow()
    expect(() => parseUrn('urn:li:unknownNamespace:123')).toThrow()
  })
})

describe('tryParseUrn', () => {
  it('returns null on invalid format (no throw)', () => {
    expect(tryParseUrn('not:a:urn')).toBeNull()
    expect(tryParseUrn('urn:li:')).toBeNull()
    expect(tryParseUrn('')).toBeNull()
    expect(tryParseUrn('urn:li:badNamespace:99')).toBeNull()
  })

  it('returns a ParsedLinkedinUrn for valid input', () => {
    const result = tryParseUrn('urn:li:sponsoredCampaign:42')
    expect(result).not.toBeNull()
    expect(result?.namespace).toBe('sponsoredCampaign')
    expect(result?.id).toBe('42')
  })
})

describe('urnId', () => {
  it('extracts the id segment from a valid URN', () => {
    expect(urnId('urn:li:sponsoredAccount:12345')).toBe('12345')
    expect(urnId('urn:li:organization:100200300')).toBe('100200300')
    expect(urnId('urn:li:dmpSegment:seg-001')).toBe('seg-001')
  })
})

describe('isUrnOf', () => {
  it('returns true when namespace matches', () => {
    expect(isUrnOf('urn:li:sponsoredAccount:12345', 'sponsoredAccount')).toBe(true)
    expect(isUrnOf('urn:li:organization:99', 'organization')).toBe(true)
  })

  it('returns false when namespace does not match', () => {
    expect(isUrnOf('urn:li:sponsoredCampaign:42', 'sponsoredAccount')).toBe(false)
    expect(isUrnOf('urn:li:person:abc', 'organization')).toBe(false)
  })

  it('returns false for invalid URNs (no throw)', () => {
    expect(isUrnOf('not:a:urn', 'sponsoredAccount')).toBe(false)
    expect(isUrnOf('', 'person')).toBe(false)
  })
})
