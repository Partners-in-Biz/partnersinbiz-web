import {
  grantedLinkedInScopes,
  isLinkedInCmaEnabled,
  selectLinkedInCallbackAccounts,
} from '@/lib/social/linkedin-cma'

describe('isLinkedInCmaEnabled', () => {
  it('defaults off', () => {
    expect(isLinkedInCmaEnabled({})).toBe(false)
    expect(isLinkedInCmaEnabled({ LINKEDIN_CMA_ENABLED: '' })).toBe(false)
    expect(isLinkedInCmaEnabled({ LINKEDIN_CMA_ENABLED: 'false' })).toBe(false)
  })

  it('turns on for explicit truthy values', () => {
    expect(isLinkedInCmaEnabled({ LINKEDIN_CMA_ENABLED: 'true' })).toBe(true)
    expect(isLinkedInCmaEnabled({ LINKEDIN_CMA_ENABLED: '1' })).toBe(true)
    expect(isLinkedInCmaEnabled({ LINKEDIN_CMA_ENABLED: 'YES' })).toBe(true)
    expect(isLinkedInCmaEnabled({ LINKEDIN_CMA_ENABLED: 'on' })).toBe(true)
  })
})

describe('selectLinkedInCallbackAccounts', () => {
  const originalCma = process.env.LINKEDIN_CMA_ENABLED

  afterEach(() => {
    if (originalCma === undefined) delete process.env.LINKEDIN_CMA_ENABLED
    else process.env.LINKEDIN_CMA_ENABLED = originalCma
  })

  it('keeps the personal profile and hides the picker when CMA is off', () => {
    delete process.env.LINKEDIN_CMA_ENABLED
    const result = selectLinkedInCallbackAccounts([
      { accountType: 'personal' as const, name: 'Peet' },
      { accountType: 'page' as const, name: 'PiB' },
    ])
    expect(result.usePicker).toBe(false)
    expect(result.accounts).toEqual([{ accountType: 'personal', name: 'Peet' }])
  })

  it('shows the picker when CMA is on and a company page is present', () => {
    process.env.LINKEDIN_CMA_ENABLED = 'true'
    const result = selectLinkedInCallbackAccounts([
      { accountType: 'personal' as const, name: 'Peet' },
      { accountType: 'page' as const, name: 'PiB' },
    ])
    expect(result.usePicker).toBe(true)
    expect(result.accounts).toHaveLength(2)
  })
})

describe('grantedLinkedInScopes', () => {
  it('drops org scopes from the stored grant when CMA is off', () => {
    expect(grantedLinkedInScopes(
      undefined,
      ['w_member_social', 'openid', 'profile', 'w_organization_social'],
    )).toEqual(['w_member_social', 'openid', 'profile'])
  })
})
