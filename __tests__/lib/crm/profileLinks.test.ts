import {
  companySocialFromValues,
  contactPayloadFromValues,
  contactValuesFromRecord,
  hrefForProfileUrl,
  sanitizeOtherLinks,
  sanitizeProfileUrl,
  sanitizeSocialProfiles,
} from '@/lib/crm/profileLinks'

describe('profileLinks', () => {
  it('strips unsafe profile URLs', () => {
    expect(sanitizeProfileUrl('  https://github.com/acme  ')).toBe('https://github.com/acme')
    expect(sanitizeProfileUrl('javascript:alert(1)')).toBe('')
    expect(sanitizeProfileUrl('data:text/html,hi')).toBe('')
    expect(sanitizeProfileUrl(12)).toBeUndefined()
  })

  it('keeps labelled extra links and drops incomplete or unsafe ones', () => {
    expect(sanitizeOtherLinks(undefined)).toBeUndefined()
    expect(sanitizeOtherLinks('nope')).toEqual([])
    expect(sanitizeOtherLinks([
      { label: '  Docs  ', url: '  docs.acme.com  ' },
      { label: '', url: 'https://empty-label.com' },
      { label: 'Bad', url: 'javascript:alert(1)' },
      { label: 9, url: 'https://x.com' },
    ])).toEqual([{ label: 'Docs', url: 'docs.acme.com' }])
  })

  it('sanitizes known social profile keys only', () => {
    expect(sanitizeSocialProfiles(undefined)).toBeUndefined()
    expect(sanitizeSocialProfiles('nope')).toEqual({})
    expect(sanitizeSocialProfiles({
      linkedin: '  https://linkedin.com/company/acme  ',
      github: 'github.com/acme',
      tiktok: 'https://tiktok.com/@acme',
      youtube: 'javascript:alert(1)',
    })).toEqual({
      linkedin: 'https://linkedin.com/company/acme',
      github: 'github.com/acme',
      youtube: '',
    })
  })

  it('maps contact records to shared field values and back', () => {
    const values = contactValuesFromRecord({
      website: 'acme.com',
      linkedinUrl: 'https://linkedin.com/in/ava',
      githubUrl: 'https://github.com/ava',
    })
    expect(values.website).toBe('acme.com')
    expect(values.linkedin).toBe('https://linkedin.com/in/ava')
    expect(values.github).toBe('https://github.com/ava')
    expect(contactPayloadFromValues(values)).toMatchObject({
      website: 'acme.com',
      linkedinUrl: 'https://linkedin.com/in/ava',
      githubUrl: 'https://github.com/ava',
      twitterUrl: '',
    })
    expect(companySocialFromValues(values)).toMatchObject({
      linkedin: 'https://linkedin.com/in/ava',
      github: 'https://github.com/ava',
    })
  })

  it('prefixes bare hosts for clickable hrefs', () => {
    expect(hrefForProfileUrl('github.com/acme')).toBe('https://github.com/acme')
    expect(hrefForProfileUrl('https://x.com/acme')).toBe('https://x.com/acme')
  })
})
